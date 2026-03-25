import { isIP } from "node:net";

interface PreviewResult {
  previewUrl: string | null;
}

interface GalleryResult {
  galleryUrls: string[];
}

interface YandexResource {
  mime_type?: string;
  media_type?: string;
  preview?: string;
  file?: string;
  _embedded?: {
    items?: YandexResource[];
  };
}

interface ResoSaleCatalogResponse {
  vin?: string;
  photos?: {
    ORIGINAL?: Array<string | null>;
    BIG?: Array<string | null>;
    SMALL?: Array<string | null>;
  };
}

const PREVIEW_CACHE_TTL_MS = 10 * 60 * 1000;
const URL_REACHABILITY_CACHE_TTL_MS = 15 * 60 * 1000;
const URL_REACHABILITY_TIMEOUT_MS = 4_000;
const URL_REACHABILITY_CONCURRENCY = 8;
const DEFAULT_MEDIA_ALLOWED_HOST_PATTERNS = [
  "yadi.sk",
  ".yadi.sk",
  "disk.yandex.ru",
  "downloader.disk.yandex.ru",
  "cloud-api.yandex.net",
  "storage.yandexcloud.net",
  "api-sale.resoleasing.com",
  "admin.resoleasing.com",
];
const BLOCKED_HOSTS = new Set(["localhost", "localhost.localdomain"]);
const previewCache = new Map<string, { previewUrl: string | null; expiresAt: number }>();
const galleryCache = new Map<string, { galleryUrls: string[]; expiresAt: number }>();
const urlReachabilityCache = new Map<string, { isReachable: boolean; expiresAt: number }>();
const RESO_IMAGE_BASE_URL = "https://api-sale.resoleasing.com";
const RESO_SALE_API_BASE_URL = "https://admin.resoleasing.com/api/sales-catalog";

function normalizeHostPattern(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  const wildcardSuffixPattern = normalized.startsWith(".")
    ? normalized.slice(1)
    : normalized;
  if (!wildcardSuffixPattern) {
    return null;
  }

  if (!/^[a-z0-9.-]+$/u.test(wildcardSuffixPattern)) {
    return null;
  }

  return normalized;
}

function resolveAllowedMediaHostPatterns(): string[] {
  const configured = process.env.MEDIA_ALLOWED_HOSTS
    ?.split(",")
    .map((item) => normalizeHostPattern(item))
    .filter((item): item is string => Boolean(item));

  const source = configured && configured.length > 0
    ? configured
    : DEFAULT_MEDIA_ALLOWED_HOST_PATTERNS;
  return [...new Set(source)];
}

const allowedMediaHostPatterns = resolveAllowedMediaHostPatterns();

function isTrustedDiskYandexHost(host: string): boolean {
  if (host === "disk.yandex.ru") {
    return true;
  }

  const labels = host.split(".");
  return labels.length === 3 && labels[0] === "disk" && labels[1] === "yandex";
}

function hostMatchesConfiguredPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith(".")) {
    const normalizedSuffix = pattern.slice(1);
    return host === normalizedSuffix || host.endsWith(`.${normalizedSuffix}`);
  }

  return host === pattern;
}

function isAllowedMediaHost(host: string): boolean {
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local")) {
    return false;
  }

  if (isIP(host) !== 0) {
    return false;
  }

  if (isTrustedDiskYandexHost(host)) {
    return true;
  }

  return allowedMediaHostPatterns.some((pattern) => hostMatchesConfiguredPattern(host, pattern));
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function isAllowedMediaRemoteUrl(value: string): boolean {
  const parsed = parseHttpUrl(value);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host) {
    return false;
  }

  return isAllowedMediaHost(host);
}

function getCachedGalleryUrls(cacheKey: string): string[] | null {
  const cached = galleryCache.get(cacheKey);
  if (!cached || cached.expiresAt <= Date.now()) {
    return null;
  }

  return cached.galleryUrls;
}

function setCachedGalleryUrls(cacheKey: string, galleryUrls: string[]): void {
  galleryCache.set(cacheKey, {
    galleryUrls,
    expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
  });
}

function isImageLikeUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(url);
}

function isDirectImageUrl(url: string): boolean {
  if (url.includes("downloader.disk.yandex.ru/preview/")) {
    return true;
  }

  if (isImageLikeUrl(url)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const contentType = parsed.searchParams.get("content_type")?.toLowerCase() ?? "";
    const fileName = parsed.searchParams.get("filename")?.toLowerCase() ?? "";

    if (contentType.startsWith("image/")) {
      return true;
    }

    if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(fileName)) {
      return true;
    }

    if (host === "downloader.disk.yandex.ru" && parsed.pathname.includes("/preview/")) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}

function isYandexPublicLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().trim();

    return isAllowedMediaHost(host) && (host === "yadi.sk" || host.endsWith(".yadi.sk") || isTrustedDiskYandexHost(host));
  } catch {
    return false;
  }
}

function extractHttpUrls(rawValue: string): string[] {
  const matches = rawValue.match(/https?:\/\/\S+/gi) ?? [];
  const cleaned = matches
    .map((item) => item.replace(/[),.;]+$/g, "").trim())
    .filter(Boolean);

  return [...new Set(cleaned)];
}

function extractDirectImageUrls(rawSource: string): string[] {
  const extractedUrls = extractHttpUrls(rawSource);
  if (extractedUrls.length > 0) {
    return extractedUrls.filter((url) => isDirectImageUrl(url) && isAllowedMediaRemoteUrl(url));
  }

  return isDirectImageUrl(rawSource) && isAllowedMediaRemoteUrl(rawSource) ? [rawSource] : [];
}

async function fetchWithTimeout(url: string, method: "HEAD" | "GET"): Promise<Response> {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), URL_REACHABILITY_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      signal: abortController.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function isImageUrlReachable(url: string): Promise<boolean> {
  const cached = urlReachabilityCache.get(url);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.isReachable;
  }

  let isReachable = false;

  try {
    const headResponse = await fetchWithTimeout(url, "HEAD");
    if (headResponse.ok) {
      isReachable = true;
    } else if (headResponse.status === 403 || headResponse.status === 405) {
      const getResponse = await fetchWithTimeout(url, "GET");
      isReachable = getResponse.ok;
    }
  } catch {
    isReachable = false;
  }

  urlReachabilityCache.set(url, {
    isReachable,
    expiresAt: Date.now() + URL_REACHABILITY_CACHE_TTL_MS,
  });

  return isReachable;
}

async function filterReachableImageUrls(urls: string[]): Promise<string[]> {
  if (urls.length === 0) {
    return [];
  }

  const reachable = new Array<boolean>(urls.length).fill(false);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < urls.length) {
      const index = currentIndex;
      currentIndex += 1;
      reachable[index] = await isImageUrlReachable(urls[index]);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(URL_REACHABILITY_CONCURRENCY, urls.length) },
      () => worker(),
    ),
  );

  return urls.filter((_, index) => reachable[index]);
}

function parseResoVinSourceUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toLowerCase().startsWith("reso-vin:")) {
    const vin = trimmed.slice("reso-vin:".length).trim().toUpperCase();
    return vin || null;
  }

  try {
    const parsed = new URL(trimmed);
    const vin = parsed.searchParams.get("vin")?.trim().toUpperCase();
    if (
      vin &&
      parsed.hostname.toLowerCase() === "admin.resoleasing.com" &&
      parsed.pathname === "/api/sales-catalog"
    ) {
      return vin;
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeResoImageUrl(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const value = raw.trim();
  if (!value) {
    return null;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  if (value.startsWith("/")) {
    return `${RESO_IMAGE_BASE_URL}${value}`;
  }

  return `${RESO_IMAGE_BASE_URL}/${value}`;
}

async function resolveResoGalleryByVin(vin: string): Promise<string[]> {
  const cacheKey = `reso-vin:${vin}`;
  const cached = getCachedGalleryUrls(cacheKey);
  if (cached) {
    return cached;
  }

  const apiUrl = new URL(RESO_SALE_API_BASE_URL);
  apiUrl.searchParams.set("vin", vin);

  const response = await fetch(apiUrl.toString(), { method: "GET" });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as ResoSaleCatalogResponse;
  const originalUrls = (payload.photos?.ORIGINAL ?? [])
    .map((value) => normalizeResoImageUrl(value))
    .filter((value): value is string => Boolean(value));
  const bigUrls = (payload.photos?.BIG ?? [])
    .map((value) => normalizeResoImageUrl(value))
    .filter((value): value is string => Boolean(value));
  const urls = [...new Set([...originalUrls, ...bigUrls])];

  setCachedGalleryUrls(cacheKey, urls);

  return urls;
}

function pickImageFromResource(resource: YandexResource): string | null {
  if (resource.preview) {
    return resource.preview;
  }

  const isImage =
    resource.media_type === "image" ||
    (resource.mime_type ? resource.mime_type.startsWith("image/") : false);

  if (isImage && resource.file) {
    return resource.file;
  }

  if (!resource._embedded?.items || resource._embedded.items.length === 0) {
    return null;
  }

  const firstImage = resource._embedded.items.find((item) => {
    return (
      item.media_type === "image" ||
      (item.mime_type ? item.mime_type.startsWith("image/") : false)
    );
  });

  if (!firstImage) {
    return null;
  }

  return firstImage.preview ?? firstImage.file ?? null;
}

function pickAllImagesFromResource(resource: YandexResource): string[] {
  const urls: string[] = [];

  const rootIsImage =
    resource.media_type === "image" ||
    (resource.mime_type ? resource.mime_type.startsWith("image/") : false);

  if (rootIsImage) {
    const rootImage = resource.preview ?? resource.file;
    if (rootImage) {
      urls.push(rootImage);
    }
  }

  const embeddedItems = resource._embedded?.items ?? [];
  for (const item of embeddedItems) {
    const isImage =
      item.media_type === "image" ||
      (item.mime_type ? item.mime_type.startsWith("image/") : false);
    if (!isImage) {
      continue;
    }

    const imageUrl = item.preview ?? item.file;
    if (imageUrl) {
      urls.push(imageUrl);
    }
  }

  return [...new Set(urls)];
}

async function resolveYandexPreview(url: string): Promise<string | null> {
  const apiUrl = new URL("https://cloud-api.yandex.net/v1/disk/public/resources");
  apiUrl.searchParams.set("public_key", url);
  apiUrl.searchParams.set("preview_size", "XL");
  apiUrl.searchParams.set("limit", "20");

  const response = await fetch(apiUrl.toString(), { method: "GET" });
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as YandexResource;
  return pickImageFromResource(payload);
}

async function resolveYandexGallery(url: string): Promise<string[]> {
  const apiUrl = new URL("https://cloud-api.yandex.net/v1/disk/public/resources");
  apiUrl.searchParams.set("public_key", url);
  apiUrl.searchParams.set("preview_size", "XL");
  apiUrl.searchParams.set("limit", "200");

  const response = await fetch(apiUrl.toString(), { method: "GET" });
  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as YandexResource;
  return pickAllImagesFromResource(payload);
}

export async function resolvePreviewUrl(sourceUrl: string): Promise<PreviewResult> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return { previewUrl: null };
  }

  const cached = previewCache.get(trimmed);
  if (cached && cached.expiresAt > Date.now()) {
    return { previewUrl: cached.previewUrl };
  }

  let previewUrl: string | null = null;

  try {
    const resoVin = parseResoVinSourceUrl(trimmed);
    if (resoVin) {
      const galleryUrls = await resolveResoGalleryByVin(resoVin);
      previewUrl = galleryUrls[0] ?? null;
    } else {
      const directImageUrls = extractDirectImageUrls(trimmed);
      if (directImageUrls.length > 0) {
        const reachableImageUrls = await filterReachableImageUrls(directImageUrls);
        previewUrl = reachableImageUrls[0] ?? null;
      } else if (isYandexPublicLink(trimmed)) {
        previewUrl = await resolveYandexPreview(trimmed);
      }
    }
  } catch {
    previewUrl = null;
  }

  previewCache.set(trimmed, {
    previewUrl,
    expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
  });

  return { previewUrl };
}

export async function resolveGalleryUrls(sourceUrl: string): Promise<GalleryResult> {
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return { galleryUrls: [] };
  }

  const cached = getCachedGalleryUrls(trimmed);
  if (cached) {
    return { galleryUrls: cached };
  }

  try {
    const resoVin = parseResoVinSourceUrl(trimmed);
    if (resoVin) {
      const galleryUrls = await resolveResoGalleryByVin(resoVin);
      setCachedGalleryUrls(trimmed, galleryUrls);
      return { galleryUrls };
    }

    const directImageUrls = extractDirectImageUrls(trimmed);
    if (directImageUrls.length > 0) {
      const galleryUrls = await filterReachableImageUrls(directImageUrls);
      setCachedGalleryUrls(trimmed, galleryUrls);
      return { galleryUrls };
    }

    if (isYandexPublicLink(trimmed)) {
      const galleryUrls = await resolveYandexGallery(trimmed);
      setCachedGalleryUrls(trimmed, galleryUrls);
      return { galleryUrls };
    }
  } catch {
    return { galleryUrls: [] };
  }

  return { galleryUrls: [] };
}

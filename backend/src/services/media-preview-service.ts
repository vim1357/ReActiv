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
const previewCache = new Map<string, { previewUrl: string | null; expiresAt: number }>();
const galleryCache = new Map<string, { galleryUrls: string[]; expiresAt: number }>();
const RESO_IMAGE_BASE_URL = "https://api-sale.resoleasing.com";
const RESO_SALE_API_BASE_URL = "https://admin.resoleasing.com/api/sales-catalog";

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
    const host = parsed.hostname.toLowerCase();

    if (host === "yadi.sk" || host.endsWith(".yadi.sk")) {
      return true;
    }

    if (host.startsWith("disk.yandex.")) {
      return true;
    }

    return host === "disk.yandex.ru";
  } catch {
    return false;
  }
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
  const cached = galleryCache.get(`reso-vin:${vin}`);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.galleryUrls;
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

  galleryCache.set(`reso-vin:${vin}`, {
    galleryUrls: urls,
    expiresAt: Date.now() + PREVIEW_CACHE_TTL_MS,
  });

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
    } else if (isDirectImageUrl(trimmed)) {
      previewUrl = trimmed;
    } else if (isYandexPublicLink(trimmed)) {
      previewUrl = await resolveYandexPreview(trimmed);
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

  try {
    const resoVin = parseResoVinSourceUrl(trimmed);
    if (resoVin) {
      return { galleryUrls: await resolveResoGalleryByVin(resoVin) };
    }

    if (isDirectImageUrl(trimmed)) {
      return { galleryUrls: [trimmed] };
    }

    if (isYandexPublicLink(trimmed)) {
      const galleryUrls = await resolveYandexGallery(trimmed);
      return { galleryUrls };
    }
  } catch {
    return { galleryUrls: [] };
  }

  return { galleryUrls: [] };
}

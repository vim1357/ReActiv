import type { FastifyInstance } from "fastify";
import { findCatalogItemById } from "../repositories/catalog-repository";

const DEFAULT_WEB_BASE_URL = "https://reactiv.pro";
const DEFAULT_SHARE_BASE_URL = "https://api.reactiv.pro";
const FALLBACK_PREVIEW_IMAGE_PATH = "/android-chrome-512x512.png";
const SHARE_DESCRIPTION = "Опубликовано на РеАктив";

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveWebBaseUrl(): string {
  return trimTrailingSlashes(process.env.PUBLIC_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL);
}

function resolveShareBaseUrl(): string {
  return trimTrailingSlashes(process.env.PUBLIC_SHARE_BASE_URL ?? DEFAULT_SHARE_BASE_URL);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractMediaUrls(rawValue: string): string[] {
  if (!rawValue.trim()) {
    return [];
  }

  const matches = rawValue.match(/https?:\/\/\S+/gi) ?? [];
  const cleaned = matches
    .map((item) => item.replace(/[),.;]+$/g, "").trim())
    .filter(Boolean);

  return [...new Set(cleaned)];
}

function formatPriceForShare(price: number | null): string {
  if (price === null) {
    return "цену по запросу";
  }

  return `${price.toLocaleString("ru-RU")} ₽`;
}

function buildCarNameForShare(item: {
  title: string;
  brand: string;
  model: string;
  year: number | null;
}): string {
  const baseName = item.title.trim() || `${item.brand} ${item.model}`.trim() || "лот";
  if (item.year === null) {
    return baseName;
  }

  return `${baseName} ${item.year} года`;
}

async function resolvePreviewImageUrl(yandexDiskUrl: string): Promise<string | null> {
  const firstMediaUrl = extractMediaUrls(yandexDiskUrl)[0];
  if (!firstMediaUrl) {
    return null;
  }

  return firstMediaUrl;
}

function buildShareHtml(args: {
  title: string;
  description: string;
  shareUrl: string;
  imageUrl: string;
  redirectUrl: string;
}): string {
  const title = escapeHtml(args.title);
  const description = escapeHtml(args.description);
  const shareUrl = escapeHtml(args.shareUrl);
  const imageUrl = escapeHtml(args.imageUrl);
  const redirectUrl = escapeHtml(args.redirectUrl);
  const redirectScriptUrl = JSON.stringify(args.redirectUrl);

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="РеАктив" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${shareUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:alt" content="${title}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <link rel="canonical" href="${redirectUrl}" />
    <meta http-equiv="refresh" content="0;url=${redirectUrl}" />
  </head>
  <body>
    <p>Переадресация на карточку лота...</p>
    <script>window.location.replace(${redirectScriptUrl});</script>
  </body>
</html>`;
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  app.get("/showcase/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = Number(id);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return reply.code(400).type("text/plain; charset=utf-8").send("Invalid showcase item id");
    }

    const item = findCatalogItemById(parsedId);
    if (!item) {
      return reply.code(404).type("text/plain; charset=utf-8").send("Catalog item not found");
    }

    const webBaseUrl = resolveWebBaseUrl();
    const shareBaseUrl = resolveShareBaseUrl();
    const redirectUrl = `${webBaseUrl}/showcase/${item.id}`;
    const shareUrl = `${shareBaseUrl}/showcase/${item.id}`;
    const previewSourceUrl = await resolvePreviewImageUrl(item.yandexDiskUrl);
    const previewImageUrl = previewSourceUrl
      ? `${shareBaseUrl}/api/media/preview-image?url=${encodeURIComponent(previewSourceUrl)}`
      : `${webBaseUrl}${FALLBACK_PREVIEW_IMAGE_PATH}`;
    const title = `Смотрите, какая машина: ${buildCarNameForShare(item)} за ${formatPriceForShare(item.price)} на платформе РеАктив!`;

    const html = buildShareHtml({
      title,
      description: SHARE_DESCRIPTION,
      shareUrl,
      imageUrl: previewImageUrl,
      redirectUrl,
    });

    return reply.code(200).type("text/html; charset=utf-8").send(html);
  });
}

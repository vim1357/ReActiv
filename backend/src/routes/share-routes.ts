import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { parseCatalogQuery } from "../catalog/catalog-query";
import {
  findCatalogItemById,
  searchCatalogItems,
} from "../repositories/catalog-repository";
import {
  isAllowedMediaRemoteUrl,
  resolvePreviewUrl,
} from "../services/media-preview-service";

const DEFAULT_WEB_BASE_URL = "https://reactiv.pro";
const DEFAULT_SHARE_BASE_URL = "https://api.reactiv.pro";
const FALLBACK_PREVIEW_IMAGE_PATH = "/android-chrome-512x512.png";
const SHARE_DESCRIPTION = "Опубликовано на РеАктив";
const SEO_KEYWORDS =
  "авто после лизинга, изъятые автомобили, конфискат авто, машины после лизинга, техника после лизинга";
const PUBLIC_CATALOG_TITLE = "Изъятые авто и автомобили после лизинга — каталог Reactiv";
const PUBLIC_CATALOG_DESCRIPTION =
  "Каталог авто после лизинга и изъятых автомобилей. В одном месте собраны машины и техника после лизинга, включая конфискат.";
const LANDING_TITLE =
  "Авто после лизинга и изъятые автомобили — витрина лизингового стока Reactiv";
const LANDING_DESCRIPTION =
  "Reactiv — платформа, где собраны авто после лизинга, изъятые автомобили и конфискат. Помогает находить машины и технику после лизинга.";
const CATALOG_SNAPSHOT_SIZE = 6;
const BOT_USER_AGENT_PATTERN =
  /(telegrambot|twitterbot|facebookexternalhit|vkshare|viber|whatsapp|discordbot|slackbot|linkedinbot|googlebot|yandexbot|bingbot)/i;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveWebBaseUrl(): string {
  return trimTrailingSlashes(process.env.PUBLIC_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL);
}

function resolveShareBaseUrl(): string {
  return trimTrailingSlashes(process.env.PUBLIC_SHARE_BASE_URL ?? DEFAULT_SHARE_BASE_URL);
}

function isCrawlerRequest(userAgent: string | undefined): boolean {
  if (!userAgent) {
    return false;
  }

  return BOT_USER_AGENT_PATTERN.test(userAgent);
}

function readUserAgent(request: FastifyRequest): string | undefined {
  const rawUserAgent = request.headers["user-agent"];
  return Array.isArray(rawUserAgent) ? rawUserAgent.join(" ") : rawUserAgent;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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

function formatPriceShort(price: number | null): string {
  if (price === null) {
    return "цена по запросу";
  }

  const valueInMillions = price / 1_000_000;
  if (valueInMillions >= 1) {
    return `${valueInMillions.toLocaleString("ru-RU", {
      maximumFractionDigits: 1,
      minimumFractionDigits: 0,
    })} млн ₽`;
  }

  return `${price.toLocaleString("ru-RU")} ₽`;
}

function formatMileage(mileageKm: number | null): string | null {
  if (mileageKm === null) {
    return null;
  }

  return `${mileageKm.toLocaleString("ru-RU")} км`;
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

async function resolvePreviewImageSourceUrl(yandexDiskUrl: string): Promise<string | null> {
  const firstMediaUrl = extractMediaUrls(yandexDiskUrl)[0];
  if (!firstMediaUrl) {
    return null;
  }

  return firstMediaUrl;
}

function buildShareHtml(args: {
  title: string;
  description: string;
  keywords?: string;
  shareUrl: string;
  imageUrl: string;
  canonicalUrl: string;
  robots?: string;
  bodyHtml?: string;
}): string {
  const title = escapeHtml(args.title);
  const description = escapeHtml(args.description);
  const shareUrl = escapeHtml(args.shareUrl);
  const imageUrl = escapeHtml(args.imageUrl);
  const canonicalUrl = escapeHtml(args.canonicalUrl);
  const keywords = escapeHtml(args.keywords ?? SEO_KEYWORDS);
  const robots = escapeHtml(args.robots ?? "index, follow, max-image-preview:large");
  const bodyHtml = args.bodyHtml ?? "<main><p>Preview metadata page.</p></main>";

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta name="keywords" content="${keywords}" />
    <meta name="robots" content="${robots}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="РеАктив" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${imageUrl}" />
    <meta property="og:image:alt" content="${title}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${imageUrl}" />
    <meta name="twitter:url" content="${shareUrl}" />
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #0f2a52;
        background: #f4f6fa;
      }
      main {
        max-width: 860px;
        margin: 0 auto;
        padding: 28px 20px 40px;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 34px;
        line-height: 1.15;
      }
      h2 {
        margin: 0 0 8px;
        font-size: 24px;
      }
      p {
        margin: 0;
        color: #43597b;
        line-height: 1.45;
      }
      .seo-card {
        margin-top: 18px;
        border: 1px solid #d7deec;
        border-radius: 16px;
        background: #ffffff;
        padding: 18px;
      }
      .seo-card ul {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 10px;
      }
      .seo-card li {
        display: grid;
        gap: 4px;
      }
      .seo-card a {
        color: #1e4ad8;
        text-decoration: none;
        font-weight: 600;
      }
      .seo-card a:hover {
        text-decoration: underline;
      }
      .seo-muted {
        font-size: 14px;
        color: #5c6f8f;
      }
      .seo-badges {
        margin-top: 14px;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .seo-badge {
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid #ccd6ea;
        background: #f7f9ff;
        font-size: 13px;
        color: #2f4770;
      }
    </style>
  </head>
  <body>${bodyHtml}
  </body>
</html>`;
}

async function resolvePreviewImageUrlForShare(args: {
  itemId: number;
  yandexDiskUrl: string;
  webBaseUrl: string;
  shareBaseUrl: string;
}): Promise<string> {
  const sourceUrl = await resolvePreviewImageSourceUrl(args.yandexDiskUrl);
  if (!sourceUrl) {
    return `${args.webBaseUrl}${FALLBACK_PREVIEW_IMAGE_PATH}`;
  }

  const resolved = await resolvePreviewUrl(sourceUrl);
  if (!resolved.previewUrl) {
    return `${args.webBaseUrl}${FALLBACK_PREVIEW_IMAGE_PATH}`;
  }

  return `${args.shareBaseUrl}/showcase/${args.itemId}/preview-image`;
}

function fallbackImageUrl(): string {
  return `${resolveWebBaseUrl()}${FALLBACK_PREVIEW_IMAGE_PATH}`;
}

function buildCatalogSnapshotBody(args: {
  webBaseUrl: string;
  total: number;
  newThisWeekCount: number;
  items: Array<{
    id: number;
    title: string;
    brand: string;
    model: string;
    year: number | null;
    mileageKm: number | null;
    price: number | null;
  }>;
}): string {
  const itemsHtml =
    args.items.length > 0
      ? args.items
          .map((item) => {
            const itemUrl = escapeHtml(`${args.webBaseUrl}/showcase/${item.id}`);
            const itemTitle = escapeHtml(
              item.title.trim() || `${item.brand} ${item.model}`.trim() || `Лот #${item.id}`,
            );
            const details = [
              item.year !== null ? `${item.year} г.` : null,
              formatMileage(item.mileageKm),
              formatPriceForShare(item.price),
            ]
              .filter((part): part is string => Boolean(part))
              .join(" • ");

            return `<li><a href="${itemUrl}">${itemTitle}</a><span class="seo-muted">${escapeHtml(details)}</span></li>`;
          })
          .join("")
      : '<li><span class="seo-muted">Каталог обновляется. Свежие карточки появятся после импорта.</span></li>';

  return `
<main>
  <h1>${escapeHtml(PUBLIC_CATALOG_TITLE)}</h1>
  <p>${escapeHtml(PUBLIC_CATALOG_DESCRIPTION)}</p>
  <div class="seo-badges">
    <span class="seo-badge">Сток: ${escapeHtml(args.total.toLocaleString("ru-RU"))}</span>
    <span class="seo-badge">Новые за неделю: +${escapeHtml(args.newThisWeekCount.toLocaleString("ru-RU"))}</span>
    <span class="seo-badge">Источники: 4 лизингодателя</span>
  </div>
  <section class="seo-card">
    <h2>Актуальные лоты</h2>
    <p class="seo-muted">Подборка карточек из каталога с фото и параметрами.</p>
    <ul>${itemsHtml}</ul>
  </section>
</main>`;
}

function buildLandingSnapshotBody(webBaseUrl: string): string {
  return `
<main>
  <h1>${escapeHtml(LANDING_TITLE)}</h1>
  <p>${escapeHtml(
    "Платформа объединяет лоты лизинговых компаний в единой витрине и помогает быстро находить нужную технику.",
  )}</p>
  <section class="seo-card">
    <h2>Что доступно на платформе</h2>
    <ul>
      <li><a href="${escapeHtml(`${webBaseUrl}/`)}">Каталог с фильтрами</a><span class="seo-muted">Поиск по типу техники, бренду, цене, пробегу и региону.</span></li>
      <li><a href="${escapeHtml(`${webBaseUrl}/favorites`)}">Избранное</a><span class="seo-muted">Сохранение интересных лотов для зарегистрированных пользователей.</span></li>
      <li><a href="${escapeHtml(`${webBaseUrl}/showcase`)}">Карточки лотов</a><span class="seo-muted">Фото, параметры и источник объявления в одном месте.</span></li>
    </ul>
  </section>
</main>`;
}

function buildShowcaseItemBody(args: {
  webBaseUrl: string;
  item: {
    id: number;
    title: string;
    brand: string;
    model: string;
    year: number | null;
    mileageKm: number | null;
    price: number | null;
    vehicleType: string;
    storageAddress: string;
  };
}): string {
  const details = [
    args.item.year !== null ? `${args.item.year} г.` : null,
    formatMileage(args.item.mileageKm),
    formatPriceShort(args.item.price),
    args.item.vehicleType.trim() || null,
  ].filter((value): value is string => Boolean(value));

  return `
<main>
  <h1>${escapeHtml(buildCarNameForShare(args.item))}</h1>
  <p>${escapeHtml(`Цена: ${formatPriceForShare(args.item.price)}.`)}</p>
  <div class="seo-badges">
    ${details.map((value) => `<span class="seo-badge">${escapeHtml(value)}</span>`).join("")}
  </div>
  <section class="seo-card">
    <h2>Карточка лота</h2>
    <p class="seo-muted">${escapeHtml(
      args.item.storageAddress.trim() || "Локация уточняется у лизингодателя.",
    )}</p>
    <ul>
      <li>
        <a href="${escapeHtml(`${args.webBaseUrl}/showcase/${args.item.id}`)}">Открыть лот на витрине ReActiv</a>
        <span class="seo-muted">Полная карточка с фотогалереей, характеристиками и контактами.</span>
      </li>
      <li>
        <a href="${escapeHtml(`${args.webBaseUrl}/`)}">Вернуться в каталог</a>
        <span class="seo-muted">Подборка техники со всей России в одном месте.</span>
      </li>
    </ul>
  </section>
</main>`;
}

function loadCatalogSnapshot() {
  const listQuery = parseCatalogQuery({
    page: 1,
    pageSize: CATALOG_SNAPSHOT_SIZE,
    sortBy: "created_at",
    sortDir: "desc",
    onlyWithPreview: true,
  });
  const summaryQuery = parseCatalogQuery({
    page: 1,
    pageSize: 1,
    sortBy: "created_at",
    sortDir: "desc",
  });

  const listResult = searchCatalogItems(listQuery);
  const summaryResult = searchCatalogItems(summaryQuery);

  return {
    total: summaryResult.total,
    newThisWeekCount: summaryResult.newThisWeekCount,
    items: listResult.items,
  };
}

function sendCrawlerHtml(reply: FastifyReply, html: string): ReturnType<FastifyReply["send"]> {
  return reply
    .code(200)
    .type("text/html; charset=utf-8")
    .header("Cache-Control", "public, max-age=300")
    .header("X-Share-Route-Version", "hybrid-seo-v1")
    .send(html);
}

export async function registerShareRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const webBaseUrl = resolveWebBaseUrl();
    const shareBaseUrl = resolveShareBaseUrl();
    if (!isCrawlerRequest(readUserAgent(request))) {
      return reply.redirect(`${webBaseUrl}/`, 302);
    }

    const snapshot = loadCatalogSnapshot();
    const html = buildShareHtml({
      title: PUBLIC_CATALOG_TITLE,
      description: PUBLIC_CATALOG_DESCRIPTION,
      shareUrl: `${shareBaseUrl}/`,
      canonicalUrl: `${webBaseUrl}/`,
      imageUrl: fallbackImageUrl(),
      bodyHtml: buildCatalogSnapshotBody({
        webBaseUrl,
        total: snapshot.total,
        newThisWeekCount: snapshot.newThisWeekCount,
        items: snapshot.items,
      }),
    });

    return sendCrawlerHtml(reply, html);
  });

  app.get("/landing", async (request, reply) => {
    const webBaseUrl = resolveWebBaseUrl();
    const shareBaseUrl = resolveShareBaseUrl();
    if (!isCrawlerRequest(readUserAgent(request))) {
      return reply.redirect(`${webBaseUrl}/landing`, 302);
    }

    const html = buildShareHtml({
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
      shareUrl: `${shareBaseUrl}/landing`,
      canonicalUrl: `${webBaseUrl}/landing`,
      imageUrl: fallbackImageUrl(),
      bodyHtml: buildLandingSnapshotBody(webBaseUrl),
    });

    return sendCrawlerHtml(reply, html);
  });

  app.get("/showcase", async (request, reply) => {
    const webBaseUrl = resolveWebBaseUrl();
    const shareBaseUrl = resolveShareBaseUrl();
    if (!isCrawlerRequest(readUserAgent(request))) {
      return reply.redirect(`${webBaseUrl}/`, 302);
    }

    const snapshot = loadCatalogSnapshot();
    const html = buildShareHtml({
      title: PUBLIC_CATALOG_TITLE,
      description: PUBLIC_CATALOG_DESCRIPTION,
      shareUrl: `${shareBaseUrl}/showcase`,
      canonicalUrl: `${webBaseUrl}/`,
      imageUrl: fallbackImageUrl(),
      bodyHtml: buildCatalogSnapshotBody({
        webBaseUrl,
        total: snapshot.total,
        newThisWeekCount: snapshot.newThisWeekCount,
        items: snapshot.items,
      }),
    });

    return sendCrawlerHtml(reply, html);
  });

  app.get("/showcase/:id/preview-image", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsedId = Number(id);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return reply.code(400).type("text/plain; charset=utf-8").send("Invalid showcase item id");
    }

    const item = findCatalogItemById(parsedId);
    if (!item) {
      return reply.code(404).type("text/plain; charset=utf-8").send("Catalog item not found");
    }

    const sourceUrl = await resolvePreviewImageSourceUrl(item.yandexDiskUrl);
    if (!sourceUrl) {
      return reply.redirect(fallbackImageUrl(), 302);
    }

    const resolved = await resolvePreviewUrl(sourceUrl);
    if (!resolved.previewUrl) {
      return reply.redirect(fallbackImageUrl(), 302);
    }
    if (!isAllowedMediaRemoteUrl(resolved.previewUrl)) {
      return reply.redirect(fallbackImageUrl(), 302);
    }

    try {
      const imageResponse = await fetch(resolved.previewUrl, { method: "GET" });
      if (!imageResponse.ok) {
        return reply.redirect(fallbackImageUrl(), 302);
      }

      const contentType = imageResponse.headers.get("content-type") ?? "image/jpeg";
      const arrayBuffer = await imageResponse.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return reply
        .code(200)
        .header("Content-Type", contentType)
        .header("Cache-Control", "public, max-age=600")
        .send(buffer);
    } catch {
      return reply.redirect(fallbackImageUrl(), 302);
    }
  });

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
    const userAgent = readUserAgent(request);

    if (!isCrawlerRequest(userAgent)) {
      return reply.redirect(redirectUrl, 302);
    }

    const shareUrl = `${shareBaseUrl}/showcase/${item.id}`;
    const previewImageUrl = await resolvePreviewImageUrlForShare({
      itemId: item.id,
      yandexDiskUrl: item.yandexDiskUrl,
      webBaseUrl,
      shareBaseUrl,
    });
    const title = `Смотрите, какая машина: ${buildCarNameForShare(item)} за ${formatPriceForShare(item.price)} на платформе РеАктив!`;

    const html = buildShareHtml({
      title,
      description: SHARE_DESCRIPTION,
      shareUrl,
      canonicalUrl: `${webBaseUrl}/showcase/${item.id}`,
      imageUrl: previewImageUrl,
      bodyHtml: buildShowcaseItemBody({
        webBaseUrl,
        item: {
          id: item.id,
          title: item.title,
          brand: item.brand,
          model: item.model,
          year: item.year,
          mileageKm: item.mileageKm,
          price: item.price,
          vehicleType: item.vehicleType,
          storageAddress: item.storageAddress,
        },
      }),
    });

    return sendCrawlerHtml(reply, html);
  });
}

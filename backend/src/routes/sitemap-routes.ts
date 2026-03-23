import type { FastifyInstance } from "fastify";
import {
  countCatalogSitemapItems,
  getCatalogSitemapLastModifiedAt,
  listCatalogSitemapItems,
} from "../repositories/catalog-repository";

const DEFAULT_WEB_BASE_URL = "https://reactiv.pro";
const DEFAULT_SITEMAP_BASE_URL = "https://api.reactiv.pro";
const SITEMAP_ITEMS_PAGE_SIZE = 5000;

interface StaticSitemapUrl {
  path: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: number;
}

const STATIC_SITEMAP_URLS: StaticSitemapUrl[] = [
  {
    path: "/",
    changefreq: "daily",
    priority: 1,
  },
  {
    path: "/landing",
    changefreq: "weekly",
    priority: 0.8,
  },
];

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveWebBaseUrl(): string {
  return trimTrailingSlashes(process.env.PUBLIC_WEB_BASE_URL ?? DEFAULT_WEB_BASE_URL);
}

function resolveSitemapBaseUrl(): string {
  return trimTrailingSlashes(
    process.env.PUBLIC_SITEMAP_BASE_URL ?? process.env.PUBLIC_SHARE_BASE_URL ?? DEFAULT_SITEMAP_BASE_URL,
  );
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toIsoDateOnly(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  const normalized = rawValue.includes("T") ? rawValue : rawValue.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function formatPriority(value: number): string {
  return value.toFixed(1);
}

function buildSitemapIndexXml(options: {
  sitemapBaseUrl: string;
  chunkCount: number;
  lastmod: string | null;
}): string {
  const items: string[] = [];
  const normalizedLastmod = options.lastmod ? `<lastmod>${options.lastmod}</lastmod>` : "";

  items.push(
    `<sitemap><loc>${escapeXml(`${options.sitemapBaseUrl}/sitemaps/static.xml`)}</loc>${normalizedLastmod}</sitemap>`,
  );

  for (let chunk = 1; chunk <= options.chunkCount; chunk += 1) {
    items.push(
      `<sitemap><loc>${escapeXml(`${options.sitemapBaseUrl}/sitemaps/items-${chunk}.xml`)}</loc>${normalizedLastmod}</sitemap>`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items
    .map((item) => `  ${item}`)
    .join("\n")}\n</sitemapindex>`;
}

function buildStaticSitemapXml(webBaseUrl: string): string {
  const items = STATIC_SITEMAP_URLS.map((item) => {
    const loc = escapeXml(`${webBaseUrl}${item.path}`);
    return [
      "  <url>",
      `    <loc>${loc}</loc>`,
      `    <changefreq>${item.changefreq}</changefreq>`,
      `    <priority>${formatPriority(item.priority)}</priority>`,
      "  </url>",
    ].join("\n");
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
}

function buildItemsSitemapXml(webBaseUrl: string, chunk: number): string {
  const offset = (chunk - 1) * SITEMAP_ITEMS_PAGE_SIZE;
  const rows = listCatalogSitemapItems(SITEMAP_ITEMS_PAGE_SIZE, offset);

  const items = rows
    .map((row) => {
      const loc = escapeXml(`${webBaseUrl}/showcase/${row.id}`);
      const lastmod = toIsoDateOnly(row.createdAt);
      const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : "";

      return [
        "  <url>",
        `    <loc>${loc}</loc>${lastmodTag}`,
        "    <changefreq>daily</changefreq>",
        "    <priority>0.7</priority>",
        "  </url>",
      ].join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</urlset>`;
}

export async function registerSitemapRoutes(app: FastifyInstance): Promise<void> {
  app.get("/sitemap.xml", async (_request, reply) => {
    const totalItems = countCatalogSitemapItems();
    const chunkCount = Math.max(1, Math.ceil(totalItems / SITEMAP_ITEMS_PAGE_SIZE));
    const lastmod = toIsoDateOnly(getCatalogSitemapLastModifiedAt());
    const xml = buildSitemapIndexXml({
      sitemapBaseUrl: resolveSitemapBaseUrl(),
      chunkCount,
      lastmod,
    });

    return reply
      .code(200)
      .type("application/xml; charset=utf-8")
      .header("Cache-Control", "public, max-age=600")
      .send(xml);
  });

  app.get("/sitemaps/static.xml", async (_request, reply) => {
    const xml = buildStaticSitemapXml(resolveWebBaseUrl());
    return reply
      .code(200)
      .type("application/xml; charset=utf-8")
      .header("Cache-Control", "public, max-age=1800")
      .send(xml);
  });

  app.get("/sitemaps/items-:chunk.xml", async (request, reply) => {
    const { chunk } = request.params as { chunk: string };
    const chunkNumber = Number(chunk);
    if (!Number.isInteger(chunkNumber) || chunkNumber <= 0) {
      return reply.code(400).type("text/plain; charset=utf-8").send("Invalid sitemap chunk");
    }

    const totalItems = countCatalogSitemapItems();
    const maxChunk = Math.max(1, Math.ceil(totalItems / SITEMAP_ITEMS_PAGE_SIZE));
    if (chunkNumber > maxChunk) {
      return reply.code(404).type("text/plain; charset=utf-8").send("Sitemap chunk not found");
    }

    const xml = buildItemsSitemapXml(resolveWebBaseUrl(), chunkNumber);
    return reply
      .code(200)
      .type("application/xml; charset=utf-8")
      .header("Cache-Control", "public, max-age=600")
      .send(xml);
  });
}

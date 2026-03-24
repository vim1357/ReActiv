import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { parseCatalogQuery } from "../catalog/catalog-query";
import { getLatestSuccessfulImportBatch } from "../repositories/import-batch-repository";
import {
  findCatalogItemById,
  getCatalogFiltersMetadata,
  getCatalogStructureSummaryMetrics,
  getCatalogStockValueRub,
  searchCatalogItems,
} from "../repositories/catalog-repository";

function parsePositiveIntEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  if (normalized < min) {
    return fallback;
  }

  return Math.min(normalized, max);
}

const PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS = parsePositiveIntEnv(
  "PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS",
  60_000,
  1_000,
  600_000,
);
const PUBLIC_CATALOG_SUMMARY_MAX_REQUESTS = parsePositiveIntEnv(
  "PUBLIC_CATALOG_SUMMARY_MAX_REQUESTS",
  120,
  10,
  20_000,
);
const PUBLIC_CATALOG_FILTERS_MAX_REQUESTS = parsePositiveIntEnv(
  "PUBLIC_CATALOG_FILTERS_MAX_REQUESTS",
  120,
  10,
  20_000,
);
const PUBLIC_CATALOG_ITEMS_MAX_REQUESTS = parsePositiveIntEnv(
  "PUBLIC_CATALOG_ITEMS_MAX_REQUESTS",
  180,
  10,
  20_000,
);
const PUBLIC_CATALOG_RATE_LIMIT_CLEANUP_INTERVAL_MS = parsePositiveIntEnv(
  "PUBLIC_CATALOG_RATE_LIMIT_CLEANUP_INTERVAL_MS",
  60_000,
  5_000,
  600_000,
);
const PUBLIC_CATALOG_RATE_LIMIT_MAX_BUCKETS = parsePositiveIntEnv(
  "PUBLIC_CATALOG_RATE_LIMIT_MAX_BUCKETS",
  20_000,
  1_000,
  500_000,
);
const PUBLIC_CATALOG_MAX_PAGE = parsePositiveIntEnv(
  "PUBLIC_CATALOG_MAX_PAGE",
  100,
  1,
  10_000,
);
const PUBLIC_CATALOG_MAX_PAGE_SIZE = parsePositiveIntEnv(
  "PUBLIC_CATALOG_MAX_PAGE_SIZE",
  40,
  5,
  100,
);
const PUBLIC_CATALOG_MAX_SEARCH_LENGTH = parsePositiveIntEnv(
  "PUBLIC_CATALOG_MAX_SEARCH_LENGTH",
  120,
  20,
  1_000,
);
const PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD = parsePositiveIntEnv(
  "PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD",
  12,
  1,
  100,
);
const PUBLIC_CATALOG_ITEM_DETAILS_MAX_REQUESTS = parsePositiveIntEnv(
  "PUBLIC_CATALOG_ITEM_DETAILS_MAX_REQUESTS",
  240,
  10,
  20_000,
);

const publicCatalogRateLimitBuckets = new Map<string, number[]>();
let lastPublicCatalogRateLimitCleanupMs = 0;

function cleanupPublicCatalogRateLimitBuckets(nowMs: number): void {
  if (
    lastPublicCatalogRateLimitCleanupMs > 0 &&
    nowMs - lastPublicCatalogRateLimitCleanupMs < PUBLIC_CATALOG_RATE_LIMIT_CLEANUP_INTERVAL_MS
  ) {
    return;
  }

  const threshold = nowMs - PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS;
  for (const [bucketKey, timestamps] of publicCatalogRateLimitBuckets.entries()) {
    const fresh = timestamps.filter((item) => item >= threshold);
    if (fresh.length === 0) {
      publicCatalogRateLimitBuckets.delete(bucketKey);
      continue;
    }

    publicCatalogRateLimitBuckets.set(bucketKey, fresh);
  }

  lastPublicCatalogRateLimitCleanupMs = nowMs;
}

function ensurePublicCatalogRateLimitCapacity(key: string, nowMs: number): void {
  if (publicCatalogRateLimitBuckets.has(key)) {
    return;
  }

  if (publicCatalogRateLimitBuckets.size < PUBLIC_CATALOG_RATE_LIMIT_MAX_BUCKETS) {
    return;
  }

  cleanupPublicCatalogRateLimitBuckets(nowMs);

  while (
    !publicCatalogRateLimitBuckets.has(key) &&
    publicCatalogRateLimitBuckets.size >= PUBLIC_CATALOG_RATE_LIMIT_MAX_BUCKETS
  ) {
    const oldestKey = publicCatalogRateLimitBuckets.keys().next().value;
    if (typeof oldestKey !== "string") {
      break;
    }

    publicCatalogRateLimitBuckets.delete(oldestKey);
  }
}

function isPublicCatalogRateLimited(
  key: string,
  maxRequests: number,
  nowMs: number,
): boolean {
  cleanupPublicCatalogRateLimitBuckets(nowMs);
  ensurePublicCatalogRateLimitCapacity(key, nowMs);

  const bucket = publicCatalogRateLimitBuckets.get(key) ?? [];
  const threshold = nowMs - PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS;
  const fresh = bucket.filter((item) => item >= threshold);

  if (fresh.length >= maxRequests) {
    publicCatalogRateLimitBuckets.set(key, fresh);
    return true;
  }

  fresh.push(nowMs);
  publicCatalogRateLimitBuckets.set(key, fresh);
  return false;
}

function rejectIfPublicCatalogRateLimited(
  request: FastifyRequest,
  reply: FastifyReply,
  endpointKey: string,
  maxRequests: number,
): boolean {
  if (request.authUser) {
    return false;
  }

  const nowMs = Date.now();
  const clientIp = request.ip || "unknown";
  const key = `${endpointKey}:${clientIp}`;
  const isLimited = isPublicCatalogRateLimited(key, maxRequests, nowMs);
  if (!isLimited) {
    return false;
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil(PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS / 1000),
  );
  reply.header("Retry-After", String(retryAfterSeconds));
  void reply.code(429).send({ message: "Too many catalog requests" });
  return true;
}

function sanitizeCatalogItemForRole<
  T extends {
    responsiblePerson?: string;
    websiteUrl?: string;
    daysOnSale?: number | null;
    externalId?: string;
    crmRef?: string;
  },
>(item: T, role: string | undefined): T {
  if (role === "admin" || role === "stock_owner") {
    return item;
  }

  return {
    ...item,
    ...(Object.prototype.hasOwnProperty.call(item, "responsiblePerson")
      ? { responsiblePerson: "" }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(item, "websiteUrl")
      ? { websiteUrl: "" }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(item, "daysOnSale")
      ? { daysOnSale: null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(item, "externalId")
      ? { externalId: "" }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(item, "crmRef")
      ? { crmRef: "" }
      : {}),
  };
}

function sanitizeCatalogFiltersForRole(
  metadata: Record<string, unknown>,
  role: string | undefined,
): Record<string, unknown> {
  if (role === "admin" || role === "stock_owner") {
    return metadata;
  }

  return {
    ...metadata,
    responsiblePerson: [],
    websiteUrl: [],
    externalId: [],
    crmRef: [],
    yandexDiskUrl: [],
    daysOnSaleMin: null,
    daysOnSaleMax: null,
  };
}

function buildWeakEtag(...parts: Array<string | number | null | undefined>): string {
  const normalized = parts
    .map((part) => (part === null || part === undefined ? "" : String(part)))
    .join("|");
  const digest = createHash("sha1").update(normalized).digest("base64url");
  return `W/"${digest}"`;
}

function applyScopedCacheHeaders(
  reply: { header: (name: string, value: string) => unknown },
  visibility: "private" | "public",
  maxAgeSec: number,
  staleWhileRevalidateSec: number,
): void {
  reply.header(
    "Cache-Control",
    `${visibility}, max-age=${maxAgeSec}, stale-while-revalidate=${staleWhileRevalidateSec}`,
  );
}

function capArray<T>(value: T[] | undefined, maxSize: number): T[] | undefined {
  if (!value || value.length <= maxSize) {
    return value;
  }

  return value.slice(0, maxSize);
}

function capStringLength(value: string | undefined, maxLength: number): string | undefined {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return value.slice(0, maxLength);
}

function applyPublicQueryCaps(
  query: ReturnType<typeof parseCatalogQuery>,
  isAuthenticated: boolean,
): ReturnType<typeof parseCatalogQuery> {
  if (isAuthenticated) {
    return query;
  }

  return {
    ...query,
    page: Math.min(query.page, PUBLIC_CATALOG_MAX_PAGE),
    pageSize: Math.min(query.pageSize, PUBLIC_CATALOG_MAX_PAGE_SIZE),
    search: capStringLength(query.search, PUBLIC_CATALOG_MAX_SEARCH_LENGTH),
    offerCode: capArray(query.offerCode, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    status: capArray(query.status, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    city: capArray(query.city, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    brand: capArray(query.brand, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    model: capArray(query.model, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    modification: capArray(query.modification, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    vehicleType: capArray(query.vehicleType, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    ptsType: capArray(query.ptsType, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    storageAddress: capArray(query.storageAddress, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    bookingStatus: capArray(query.bookingStatus, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    hasEncumbrance: capArray(query.hasEncumbrance, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    isDeregistered: capArray(query.isDeregistered, PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD),
    responsiblePerson: undefined,
    externalId: undefined,
    crmRef: undefined,
    websiteUrl: undefined,
    yandexDiskUrl: undefined,
    daysOnSaleMin: undefined,
    daysOnSaleMax: undefined,
  };
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/catalog/summary", async (request, reply) => {
    if (
      rejectIfPublicCatalogRateLimited(
        request,
        reply,
        "catalog-summary",
        PUBLIC_CATALOG_SUMMARY_MAX_REQUESTS,
      )
    ) {
      return;
    }

    try {
      const latestImportBatch = getLatestSuccessfulImportBatch();
      const stockValueRub = getCatalogStockValueRub();
      const structureMetrics = getCatalogStructureSummaryMetrics();
      const etag = buildWeakEtag(
        "catalog-summary",
        latestImportBatch?.id ?? "none",
        latestImportBatch?.added_rows ?? 0,
        stockValueRub,
        structureMetrics.avgPriceRub ?? "na",
        structureMetrics.medianPriceRub ?? "na",
        JSON.stringify(structureMetrics.avgPriceByVehicleType),
        JSON.stringify(structureMetrics.vehicleTypeShare),
      );

      if (request.headers["if-none-match"] === etag) {
        applyScopedCacheHeaders(
          reply,
          request.authUser ? "private" : "public",
          60,
          120,
        );
        reply.header("ETag", etag);
        return reply.code(304).send();
      }

      applyScopedCacheHeaders(
        reply,
        request.authUser ? "private" : "public",
        60,
        120,
      );
      reply.header("ETag", etag);
      return reply.code(200).send({
        newThisWeekCount: latestImportBatch?.added_rows ?? 0,
        stockValueRub,
        avgPriceRub: structureMetrics.avgPriceRub,
        medianPriceRub: structureMetrics.medianPriceRub,
        avgPriceByVehicleType: structureMetrics.avgPriceByVehicleType,
        vehicleTypeShare: structureMetrics.vehicleTypeShare,
      });
    } catch {
      return reply.code(500).send({ message: "Failed to fetch catalog summary" });
    }
  });

  app.get("/api/catalog/items", async (request, reply) => {
    if (
      rejectIfPublicCatalogRateLimited(
        request,
        reply,
        "catalog-items",
        PUBLIC_CATALOG_ITEMS_MAX_REQUESTS,
      )
    ) {
      return;
    }

    try {
      const parsedQuery = parseCatalogQuery(request.query);
      const query = applyPublicQueryCaps(parsedQuery, Boolean(request.authUser));
      const latestImportBatch = getLatestSuccessfulImportBatch();
      const roleBucket = request.authUser?.role ?? "public";
      const requestPath = request.raw.url?.split("#")[0] ?? "/api/catalog/items";
      const etag = buildWeakEtag(
        "catalog-items",
        latestImportBatch?.id ?? "none",
        roleBucket,
        requestPath,
      );

      if (request.headers["if-none-match"] === etag) {
        applyScopedCacheHeaders(
          reply,
          request.authUser ? "private" : "public",
          30,
          60,
        );
        reply.header("ETag", etag);
        return reply.code(304).send();
      }

      const result = searchCatalogItems(query);
      const items = result.items.map((item) =>
        sanitizeCatalogItemForRole(item, request.authUser?.role),
      );

      applyScopedCacheHeaders(
        reply,
        request.authUser ? "private" : "public",
        30,
        60,
      );
      reply.header("ETag", etag);
      return reply.code(200).send({
        items,
        newThisWeekCount: result.newThisWeekCount,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: result.total,
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          message: "Invalid query params",
          errors: error.flatten(),
        });
      }

      return reply.code(500).send({ message: "Failed to fetch catalog items" });
    }
  });

  app.get("/api/catalog/filters", async (request, reply) => {
    if (
      rejectIfPublicCatalogRateLimited(
        request,
        reply,
        "catalog-filters",
        PUBLIC_CATALOG_FILTERS_MAX_REQUESTS,
      )
    ) {
      return;
    }

    try {
      const latestImportBatch = getLatestSuccessfulImportBatch();
      const roleBucket = request.authUser?.role ?? "public";
      const etag = buildWeakEtag(
        "catalog-filters",
        latestImportBatch?.id ?? "none",
        roleBucket,
      );

      if (request.headers["if-none-match"] === etag) {
        applyScopedCacheHeaders(
          reply,
          request.authUser ? "private" : "public",
          300,
          600,
        );
        reply.header("ETag", etag);
        return reply.code(304).send();
      }

      const metadata = getCatalogFiltersMetadata();
      applyScopedCacheHeaders(
        reply,
        request.authUser ? "private" : "public",
        300,
        600,
      );
      reply.header("ETag", etag);
      return reply
        .code(200)
        .send(sanitizeCatalogFiltersForRole(metadata, request.authUser?.role));
    } catch {
      return reply.code(500).send({ message: "Failed to fetch filter metadata" });
    }
  });

  app.get("/api/catalog/items/:id", async (request, reply) => {
    if (
      rejectIfPublicCatalogRateLimited(
        request,
        reply,
        "catalog-item-details",
        PUBLIC_CATALOG_ITEM_DETAILS_MAX_REQUESTS,
      )
    ) {
      return;
    }

    const { id } = request.params as { id: string };
    const parsedId = Number(id);

    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return reply.code(400).send({ message: "Invalid catalog item id" });
    }

    try {
      const item = findCatalogItemById(parsedId);
      if (!item) {
        return reply.code(404).send({ message: "Catalog item not found" });
      }

      const latestImportBatch = getLatestSuccessfulImportBatch();
      const roleBucket = request.authUser?.role ?? "public";
      const etag = buildWeakEtag(
        "catalog-item-details",
        latestImportBatch?.id ?? "none",
        roleBucket,
        parsedId,
      );

      if (request.headers["if-none-match"] === etag) {
        applyScopedCacheHeaders(
          reply,
          request.authUser ? "private" : "public",
          60,
          120,
        );
        reply.header("ETag", etag);
        return reply.code(304).send();
      }

      applyScopedCacheHeaders(
        reply,
        request.authUser ? "private" : "public",
        60,
        120,
      );
      reply.header("ETag", etag);

      return reply
        .code(200)
        .send(sanitizeCatalogItemForRole(item, request.authUser?.role));
    } catch {
      return reply.code(500).send({ message: "Failed to fetch catalog item" });
    }
  });
}

import { db } from "../db/connection";
import type { CatalogQuery } from "../catalog/catalog-query";
import {
  buildStoredPreviewSourceUrl,
  storedMediaFileExists,
} from "../services/local-media-storage";
import {
  getLatestSuccessfulImportBatch,
  getLatestSuccessfulImportBatchId,
  getPreviousSuccessfulImportBatchId,
} from "./import-batch-repository";
import { listVehicleOfferSnapshotCodesByImportBatchId } from "./vehicle-offer-repository";

const FILTERS_METADATA_CACHE_TTL_MS = 5 * 60 * 1000;
const MAIN_SHOWCASE_MIX_CACHE_TTL_MS = 60 * 60 * 1000;
const MAIN_SHOWCASE_RANDOMIZED_MAX_PAGE = 3;

let filtersMetadataCache:
  | {
      latestImportBatchId: string | null;
      expiresAt: number;
      value: Record<string, unknown>;
    }
  | null = null;

const NORMALIZED_TEXT_VALUES_CACHE_TTL_MS = 5 * 60 * 1000;

let normalizedTextValuesCache:
  | {
      latestImportBatchId: string | null;
      expiresAt: number;
      brandByNormalized: Map<string, string[]>;
      modelByNormalized: Map<string, string[]>;
    }
  | null = null;

interface MainShowcaseMixCache {
  expiresAt: number;
  orderedOfferIds: number[];
}

interface NewThisWeekSqlContext {
  latestImportBatchId: string;
  latestTenantId: string;
  previousImportBatchId: string | null;
}

let mainShowcaseMixCache: MainShowcaseMixCache | null = null;

interface VehicleOfferDbRow {
  id: number;
  import_batch_id: string;
  offer_code: string;
  status: string;
  brand: string;
  model: string;
  modification: string;
  vehicle_type: string;
  year: number | null;
  mileage_km: number | null;
  key_count: number | null;
  pts_type: string;
  has_encumbrance: number | null;
  is_deregistered: number | null;
  responsible_person: string;
  storage_address: string;
  days_on_sale: number | null;
  price: number | null;
  yandex_disk_url: string;
  booking_status: string;
  external_id: string;
  crm_ref: string;
  website_url: string;
  title: string;
  card_preview_path: string;
  created_at: string;
}

export interface CatalogItem {
  id: number;
  importBatchId: string;
  offerCode: string;
  status: string;
  brand: string;
  model: string;
  modification: string;
  vehicleType: string;
  year: number | null;
  mileageKm: number | null;
  keyCount: number | null;
  ptsType: string;
  hasEncumbrance: boolean | null;
  isDeregistered: boolean | null;
  responsiblePerson: string;
  storageAddress: string;
  daysOnSale: number | null;
  price: number | null;
  yandexDiskUrl: string;
  bookingStatus: string;
  externalId: string;
  crmRef: string;
  websiteUrl: string;
  title: string;
  cardPreviewPath: string;
  createdAt: string;
}

export interface CatalogListItem {
  id: number;
  offerCode: string;
  status: string;
  brand: string;
  model: string;
  title: string;
  year: number | null;
  mileageKm: number | null;
  price: number | null;
  bookingStatus: string;
  storageAddress: string;
  responsiblePerson: string;
  previewUrl: string | null;
}

export interface CatalogSummaryAvgByVehicleTypeItem {
  vehicleType: string;
  avgPriceRub: number;
  count: number;
  pricedCount: number;
}

export interface CatalogSummaryVehicleTypeShareItem {
  vehicleType: string;
  count: number;
  sharePercent: number;
}

export interface CatalogStructureSummaryMetrics {
  avgPriceRub: number | null;
  medianPriceRub: number | null;
  avgPriceByVehicleType: CatalogSummaryAvgByVehicleTypeItem[];
  vehicleTypeShare: CatalogSummaryVehicleTypeShareItem[];
}

function mapDbBoolean(value: number | null): boolean | null {
  if (value === 1) {
    return true;
  }
  if (value === 0) {
    return false;
  }
  return null;
}

function mapDbRow(row: VehicleOfferDbRow): CatalogItem {
  return {
    id: row.id,
    importBatchId: row.import_batch_id,
    offerCode: row.offer_code,
    status: row.status,
    brand: row.brand,
    model: row.model,
    modification: row.modification,
    vehicleType: row.vehicle_type,
    year: row.year,
    mileageKm: row.mileage_km,
    keyCount: row.key_count,
    ptsType: row.pts_type,
    hasEncumbrance: mapDbBoolean(row.has_encumbrance),
    isDeregistered: mapDbBoolean(row.is_deregistered),
    responsiblePerson: row.responsible_person,
    storageAddress: row.storage_address,
    daysOnSale: row.days_on_sale,
    price: row.price,
    yandexDiskUrl: row.yandex_disk_url,
    bookingStatus: row.booking_status,
    externalId: row.external_id,
    crmRef: row.crm_ref,
    websiteUrl: row.website_url,
    title: row.title,
    cardPreviewPath: row.card_preview_path,
    createdAt: row.created_at,
  };
}

function toCatalogListItem(item: CatalogItem): CatalogListItem {
  const hasStoredPreview = item.cardPreviewPath.trim().length > 0;

  return {
    id: item.id,
    offerCode: item.offerCode,
    status: item.status,
    brand: item.brand,
    model: item.model,
    title: item.title,
    year: item.year,
    mileageKm: item.mileageKm,
    price: item.price,
    bookingStatus: item.bookingStatus,
    storageAddress: item.storageAddress,
    responsiblePerson: item.responsiblePerson,
    previewUrl: hasStoredPreview
      ? buildStoredPreviewSourceUrl(item.cardPreviewPath)
      : null,
  };
}

function hasValidStoredPreviewPath(pathValue: string): boolean {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return false;
  }

  return storedMediaFileExists(trimmed);
}

function computeDeterministicHash(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) {
    state = 1;
  }

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffleInPlace<T>(items: T[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
}

function getPriceBucket(price: number | null): string {
  if (price === null || !Number.isFinite(price)) {
    return "unknown";
  }
  if (price < 1_000_000) {
    return "lt_1m";
  }
  if (price < 3_000_000) {
    return "1m_3m";
  }
  if (price < 7_000_000) {
    return "3m_7m";
  }
  if (price < 15_000_000) {
    return "7m_15m";
  }
  return "gte_15m";
}

function normalizeMixDimension(value: string): string {
  const normalized = value.trim();
  return normalized || "unknown";
}

function buildMainShowcaseMixOrder(now: number): number[] {
  const candidateRows = db
    .prepare(
      `
      SELECT id, vehicle_type, modification, price
      FROM vehicle_offers
      WHERE TRIM(COALESCE(card_preview_path, '')) != ''
      `,
    )
    .all() as Array<{
    id: number;
    vehicle_type: string;
    modification: string;
    price: number | null;
  }>;

  if (candidateRows.length === 0) {
    return [];
  }

  const hourSeed = new Date(now).toISOString().slice(0, 13);
  const random = createSeededRandom(computeDeterministicHash(`main_mix:${hourSeed}`));
  const groups = new Map<string, number[]>();

  candidateRows.forEach((row) => {
    const groupKey = [
      normalizeMixDimension(row.vehicle_type),
      normalizeMixDimension(row.modification),
      getPriceBucket(row.price),
    ].join("|");

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)?.push(row.id);
  });

  const groupedQueues = Array.from(groups.values());
  groupedQueues.forEach((queue) => shuffleInPlace(queue, random));
  shuffleInPlace(groupedQueues, random);

  const result: number[] = [];
  let hasRemaining = true;
  while (hasRemaining) {
    hasRemaining = false;
    groupedQueues.forEach((queue) => {
      const nextId = queue.pop();
      if (nextId !== undefined) {
        result.push(nextId);
        hasRemaining = true;
      }
    });
  }

  return result;
}

function getMainShowcaseMixOrder(now = Date.now()): number[] {
  if (mainShowcaseMixCache && mainShowcaseMixCache.expiresAt > now) {
    return mainShowcaseMixCache.orderedOfferIds;
  }

  const orderedOfferIds = buildMainShowcaseMixOrder(now);
  mainShowcaseMixCache = {
    expiresAt: now + MAIN_SHOWCASE_MIX_CACHE_TTL_MS,
    orderedOfferIds,
  };

  return orderedOfferIds;
}

function hasAnyCatalogFilters(filters: CatalogQuery): boolean {
  return Boolean(
    filters.offerCode?.length ||
      filters.tenantId?.length ||
      filters.status?.length ||
      filters.city?.length ||
      filters.brand?.length ||
      filters.model?.length ||
      filters.modification?.length ||
      filters.vehicleType?.length ||
      filters.ptsType?.length ||
      filters.hasEncumbrance?.length ||
      filters.isDeregistered?.length ||
      filters.responsiblePerson?.length ||
      filters.storageAddress?.length ||
      filters.bookingStatus?.length ||
      filters.externalId?.length ||
      filters.crmRef?.length ||
      filters.websiteUrl?.length ||
      filters.yandexDiskUrl?.length ||
      filters.search ||
      filters.newThisWeek ||
      filters.priceMin !== undefined ||
      filters.priceMax !== undefined ||
      filters.yearMin !== undefined ||
      filters.yearMax !== undefined ||
      filters.mileageMin !== undefined ||
      filters.mileageMax !== undefined ||
      filters.keyCountMin !== undefined ||
      filters.keyCountMax !== undefined ||
      filters.daysOnSaleMin !== undefined ||
      filters.daysOnSaleMax !== undefined,
  );
}

function shouldUseMainShowcaseRandomMix(filters: CatalogQuery): boolean {
  if (!filters.randomMix) {
    return false;
  }

  if (filters.page > MAIN_SHOWCASE_RANDOMIZED_MAX_PAGE) {
    return false;
  }

  if (filters.sortBy !== "created_at" || filters.sortDir !== "desc") {
    return false;
  }

  return !hasAnyCatalogFilters(filters);
}

function getRandomizedWindowFromOrderedIds(
  orderedIds: number[],
  randomSeed: string,
  page: number,
  pageSize: number,
): number[] {
  if (orderedIds.length === 0) {
    return [];
  }

  const offset = computeDeterministicHash(randomSeed) % orderedIds.length;
  const start = (page - 1) * pageSize;
  const endExclusive = Math.min(start + pageSize, orderedIds.length);

  if (start >= endExclusive) {
    return [];
  }

  const pageIds: number[] = [];
  for (let index = start; index < endExclusive; index += 1) {
    const rotatedIndex = (offset + index) % orderedIds.length;
    pageIds.push(orderedIds[rotatedIndex]);
  }

  return pageIds;
}

function listRowsByIdsPreservingOrder(ids: number[]): VehicleOfferDbRow[] {
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT *
      FROM vehicle_offers
      WHERE id IN (${placeholders})
      `,
    )
    .all(...ids) as VehicleOfferDbRow[];

  const rowsById = new Map<number, VehicleOfferDbRow>();
  rows.forEach((row) => {
    rowsById.set(row.id, row);
  });

  return ids
    .map((id) => rowsById.get(id))
    .filter((row): row is VehicleOfferDbRow => Boolean(row));
}

function addInFilter(
  clauses: string[],
  params: unknown[],
  column: string,
  values?: string[] | number[],
): void {
  if (!values || values.length === 0) {
    return;
  }

  const placeholders = values.map(() => "?").join(", ");
  clauses.push(`${column} IN (${placeholders})`);
  params.push(...values);
}

function normalizeComparableText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function isAllUppercaseWord(value: string): boolean {
  const lettersOnly = value.replace(/[^A-Za-zА-Яа-яЁё]/g, "");
  if (lettersOnly.length < 2) {
    return false;
  }

  return (
    lettersOnly === lettersOnly.toLocaleUpperCase("ru-RU") &&
    lettersOnly !== lettersOnly.toLocaleLowerCase("ru-RU")
  );
}

function pickPreferredDisplayLabel(currentValue: string, candidateValue: string): string {
  if (currentValue === candidateValue) {
    return currentValue;
  }

  const currentIsUpper = isAllUppercaseWord(currentValue);
  const candidateIsUpper = isAllUppercaseWord(candidateValue);
  if (currentIsUpper !== candidateIsUpper) {
    return currentIsUpper ? candidateValue : currentValue;
  }

  return currentValue.length <= candidateValue.length ? currentValue : candidateValue;
}

function cleanDisplayValue(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function buildDisplayLabelMap(values: string[]): Map<string, string> {
  const labelsByKey = new Map<string, string>();

  values.forEach((rawValue) => {
    const cleanedValue = cleanDisplayValue(rawValue);
    if (!cleanedValue) {
      return;
    }

    const key = normalizeComparableText(cleanedValue);
    const existing = labelsByKey.get(key);
    if (!existing) {
      labelsByKey.set(key, cleanedValue);
      return;
    }

    labelsByKey.set(key, pickPreferredDisplayLabel(existing, cleanedValue));
  });

  return labelsByKey;
}

function sortDisplayValues(values: Iterable<string>): string[] {
  return Array.from(values).sort((left, right) =>
    left.localeCompare(right, "ru", { sensitivity: "base" }),
  );
}

function toSqlNormalizedTextExpression(column: string): string {
  return `LOWER(TRIM(REPLACE(REPLACE(REPLACE(REPLACE(${column}, char(8203), ''), char(8204), ''), char(8205), ''), char(65279), '')))`;
}

function addNormalizedTextInFilter(
  clauses: string[],
  params: unknown[],
  column: string,
  values?: string[],
): void {
  if (!values || values.length === 0) {
    return;
  }

  const normalizedValues = Array.from(
    new Set(values.map((value) => normalizeComparableText(value)).filter(Boolean)),
  );
  if (normalizedValues.length === 0) {
    return;
  }

  const placeholders = normalizedValues.map(() => "?").join(", ");
  clauses.push(`${toSqlNormalizedTextExpression(column)} IN (${placeholders})`);
  params.push(...normalizedValues);
}

function buildNormalizedValuesMapForColumn(column: "brand" | "model"): Map<string, string[]> {
  const rows = db
    .prepare(
      `
        SELECT DISTINCT ${column} AS value
        FROM vehicle_offers
        WHERE ${column} != ''
      `,
    )
    .all() as Array<{ value: string }>;

  const valuesByNormalized = new Map<string, Set<string>>();

  rows.forEach((row) => {
    const rawValue = row.value;
    const normalized = normalizeComparableText(rawValue);
    if (!normalized) {
      return;
    }

    if (!valuesByNormalized.has(normalized)) {
      valuesByNormalized.set(normalized, new Set<string>());
    }

    valuesByNormalized.get(normalized)?.add(rawValue);
  });

  return new Map(
    Array.from(valuesByNormalized.entries()).map(([key, valueSet]) => [key, Array.from(valueSet)]),
  );
}

function getNormalizedTextValuesCache(): {
  brandByNormalized: Map<string, string[]>;
  modelByNormalized: Map<string, string[]>;
} {
  const latestImportBatchId = getLatestSuccessfulImportBatchId();
  const now = Date.now();
  if (
    normalizedTextValuesCache &&
    normalizedTextValuesCache.latestImportBatchId === latestImportBatchId &&
    normalizedTextValuesCache.expiresAt > now
  ) {
    return {
      brandByNormalized: normalizedTextValuesCache.brandByNormalized,
      modelByNormalized: normalizedTextValuesCache.modelByNormalized,
    };
  }

  const brandByNormalized = buildNormalizedValuesMapForColumn("brand");
  const modelByNormalized = buildNormalizedValuesMapForColumn("model");
  normalizedTextValuesCache = {
    latestImportBatchId,
    expiresAt: now + NORMALIZED_TEXT_VALUES_CACHE_TTL_MS,
    brandByNormalized,
    modelByNormalized,
  };

  return {
    brandByNormalized,
    modelByNormalized,
  };
}

function addUnicodeSafeTextInFilter(
  clauses: string[],
  params: unknown[],
  column: "brand" | "model",
  values?: string[],
): void {
  if (!values || values.length === 0) {
    return;
  }

  const normalizedValues = Array.from(
    new Set(values.map((value) => normalizeComparableText(value)).filter(Boolean)),
  );
  if (normalizedValues.length === 0) {
    return;
  }

  const cache = getNormalizedTextValuesCache();
  const sourceMap =
    column === "brand" ? cache.brandByNormalized : cache.modelByNormalized;
  const matchedRawValues = new Set<string>();

  normalizedValues.forEach((normalized) => {
    const rawValues = sourceMap.get(normalized);
    if (!rawValues) {
      return;
    }

    rawValues.forEach((rawValue) => matchedRawValues.add(rawValue));
  });

  if (matchedRawValues.size === 0) {
    clauses.push("1 = 0");
    return;
  }

  const valuesList = Array.from(matchedRawValues);
  const placeholders = valuesList.map(() => "?").join(", ");
  clauses.push(`${column} IN (${placeholders})`);
  params.push(...valuesList);
}

function addLikeAnyFilter(
  clauses: string[],
  params: unknown[],
  column: string,
  values?: string[],
): void {
  if (!values || values.length === 0) {
    return;
  }

  const likeClauses = values.map(() => `${column} LIKE ?`).join(" OR ");
  clauses.push(`(${likeClauses})`);
  values.forEach((value) => {
    params.push(`%${value}%`);
  });
}

function addNullableRangeFilter(
  clauses: string[],
  params: unknown[],
  column: string,
  operator: ">=" | "<=",
  value: number | undefined,
): void {
  if (value === undefined) {
    return;
  }

  clauses.push(`${column} IS NOT NULL`);
  clauses.push(`${column} ${operator} ?`);
  params.push(value);
}

function normalizeRegionLabel(value: string): string {
  return value
    .replace(/^рф\s*,\s*/i, "")
    .replace(/^россия\s*,\s*/i, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/(^|[\s,;])респ\.?(?=($|[\s,;]))/gi, "$1Республика")
    .replace(/(^|[\s,;])обл\.?(?=($|[\s,;]))/gi, "$1область")
    .replace(/\/Якутия\//gi, "(Якутия)")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;]+$/g, "");
}

function canonicalizeRegionLabel(value: string): string {
  const normalized = normalizeRegionLabel(value);
  const lower = normalized.toLowerCase();
  const compact = lower.replace(/\./g, "").replace(/\s+/g, " ").trim();

  if (
    compact === "мо" ||
    compact === "московская область" ||
    compact === "московская обл" ||
    compact === "моск обл"
  ) {
    return "Московская область";
  }
  if (compact === "москва") {
    return "Москва";
  }
  if (compact === "спб" || compact === "санкт-петербург" || compact === "санкт петербург") {
    return "Санкт-Петербург";
  }
  if (compact === "севастополь") {
    return "Севастополь";
  }

  if (lower.includes("ханты-мансий")) {
    return "Ханты-Мансийский автономный округ - Югра";
  }
  if (lower.includes("ямало-ненец")) {
    return "Ямало-Ненецкий АО";
  }
  if (lower.includes("саха") && lower.includes("якут")) {
    return "Республика Саха (Якутия)";
  }
  if (lower.includes("татарстан")) {
    return "Республика Татарстан";
  }
  if (lower.includes("бурят")) {
    return "Республика Бурятия";
  }
  if (lower.includes("башкортостан")) {
    return "Республика Башкортостан";
  }
  if (lower.includes("коми")) {
    return "Республика Коми";
  }
  if (lower.includes("мордов")) {
    return "Республика Мордовия";
  }
  if (lower.includes("хакаси")) {
    return "Республика Хакасия";
  }
  if (lower.includes("удмурт")) {
    return "Удмуртская Республика";
  }
  if (lower.includes("чуваш")) {
    return "Чувашская Республика";
  }
  if (lower.includes("кемеровск") && lower.includes("кузбасс")) {
    return "Кемеровская область - Кузбасс";
  }
  if (lower.includes("санкт-петербург")) {
    return "Санкт-Петербург";
  }
  if (lower.includes("севастополь")) {
    return "Севастополь";
  }
  if (lower === "москва") {
    return "Москва";
  }

  return normalized;
}

function extractRegionFromAddress(address: string): string | null {
  const normalized = address.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }

  const withoutPostalIndex = normalized.replace(/^\d{5,6}(?:\s*,\s*|\s+)/, "");
  const parts = withoutPostalIndex
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const regionPart = parts.find((part) =>
    /(область|обл\.?|край|республика|респ\.?|автономный округ|автономная область|\bАО\b|кузбасс|чувашия)/i.test(
      part,
    ),
  );

  if (regionPart) {
    const truncatedRegion = regionPart.split(
      /\s+(?=(?:район|р-н|улус|г\.?|город|пгт|посел(?:ок|ение)?|село|деревня|тер|мкр|месторожд))/i,
    )[0];
    const normalizedRegion = canonicalizeRegionLabel(
      truncatedRegion.replace(/\s+\bАО\b$/i, ""),
    );
    if (normalizedRegion) {
      return normalizedRegion;
    }
  }

  const directRegionPart = parts.find((part) => {
    const cleaned = part.replace(/^(город|г\.?)\s*/i, "").trim();
    const candidate = canonicalizeRegionLabel(cleaned);
    return (
      candidate === "Москва" ||
      candidate === "Санкт-Петербург" ||
      candidate === "Севастополь" ||
      candidate === "Московская область"
    );
  });
  if (directRegionPart) {
    return canonicalizeRegionLabel(directRegionPart.replace(/^(город|г\.?)\s*/i, "").trim());
  }

  const federalCityPart = parts.find((part) =>
    /^(?:(?:город|г\.?)\s*)?(москва|санкт-петербург|севастополь)\b/i.test(part),
  );
  if (federalCityPart) {
    const cityName = federalCityPart.replace(/^(город|г\.?)\s*/i, "").trim();
    return cityName || null;
  }
  return null;
}

function normalizeRequestedRegions(values?: string[]): Set<string> {
  if (!values || values.length === 0) {
    return new Set<string>();
  }

  return new Set(
    values
      .map((value) => canonicalizeRegionLabel(value))
      .map((value) => value.toLowerCase())
      .filter(Boolean),
  );
}

function filterRowsByRegions(
  rows: VehicleOfferDbRow[],
  requestedRegions: Set<string>,
): VehicleOfferDbRow[] {
  if (requestedRegions.size === 0) {
    return rows;
  }

  return rows.filter((row) => {
    const extractedRegion = extractRegionFromAddress(row.storage_address);
    if (!extractedRegion) {
      return false;
    }

    return requestedRegions.has(extractedRegion.toLowerCase());
  });
}

function filterRowsByNewThisWeek(rows: VehicleOfferDbRow[]): VehicleOfferDbRow[] {
  const latestImportBatch = getLatestSuccessfulImportBatch();
  if (!latestImportBatch) {
    return [];
  }

  const currentRows = rows.filter((row) => row.import_batch_id === latestImportBatch.id);
  const previousImportBatchId = getPreviousSuccessfulImportBatchId(
    latestImportBatch.id,
    latestImportBatch.tenant_id,
  );
  if (!previousImportBatchId) {
    return currentRows;
  }

  const previousOfferCodes = new Set(
    listVehicleOfferSnapshotCodesByImportBatchId(
      previousImportBatchId,
      latestImportBatch.tenant_id,
    ),
  );

  return currentRows.filter((row) => !previousOfferCodes.has(row.offer_code));
}

function getNewThisWeekSqlContext(): NewThisWeekSqlContext | null {
  const latestImportBatch = getLatestSuccessfulImportBatch();
  if (!latestImportBatch) {
    return null;
  }

  return {
    latestImportBatchId: latestImportBatch.id,
    latestTenantId: latestImportBatch.tenant_id,
    previousImportBatchId: getPreviousSuccessfulImportBatchId(
      latestImportBatch.id,
      latestImportBatch.tenant_id,
    ),
  };
}

function appendNewThisWeekSqlCondition(
  whereClause: string,
  params: unknown[],
  context: NewThisWeekSqlContext,
): { whereClause: string; params: unknown[] } {
  const paramsWithCondition = [...params, context.latestImportBatchId];
  const baseWhereClause = whereClause
    ? `${whereClause} AND import_batch_id = ?`
    : "WHERE import_batch_id = ?";

  if (!context.previousImportBatchId) {
    return {
      whereClause: baseWhereClause,
      params: paramsWithCondition,
    };
  }

  return {
    whereClause: `
      ${baseWhereClause}
      AND TRIM(COALESCE(offer_code, '')) != ''
      AND offer_code NOT IN (
        SELECT DISTINCT offer_code
        FROM vehicle_offer_snapshots
        WHERE import_batch_id = ?
          AND tenant_id = ?
          AND TRIM(COALESCE(offer_code, '')) != ''
      )
    `,
    params: [
      ...paramsWithCondition,
      context.previousImportBatchId,
      context.latestTenantId,
    ],
  };
}

function countNewThisWeekRowsBySql(whereClause: string, params: unknown[]): number {
  const context = getNewThisWeekSqlContext();
  if (!context) {
    return 0;
  }

  const {
    whereClause: withNewThisWeekWhereClause,
    params: withNewThisWeekParams,
  } = appendNewThisWeekSqlCondition(whereClause, params, context);

  const row = db
    .prepare(
      `
        SELECT COUNT(*) AS total
        FROM vehicle_offers
        ${withNewThisWeekWhereClause}
      `,
    )
    .get(...withNewThisWeekParams) as { total: number };

  return row.total;
}

function buildWhere(filters: CatalogQuery): { whereClause: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  addInFilter(clauses, params, "offer_code", filters.offerCode);
  addInFilter(clauses, params, "tenant_id", filters.tenantId);
  addInFilter(clauses, params, "status", filters.status);
  addUnicodeSafeTextInFilter(clauses, params, "brand", filters.brand);
  addUnicodeSafeTextInFilter(clauses, params, "model", filters.model);
  addInFilter(clauses, params, "modification", filters.modification);
  addInFilter(clauses, params, "vehicle_type", filters.vehicleType);
  addInFilter(clauses, params, "pts_type", filters.ptsType);
  addInFilter(
    clauses,
    params,
    "has_encumbrance",
    filters.hasEncumbrance?.map((value) => (value ? 1 : 0)),
  );
  addInFilter(
    clauses,
    params,
    "is_deregistered",
    filters.isDeregistered?.map((value) => (value ? 1 : 0)),
  );
  addInFilter(clauses, params, "responsible_person", filters.responsiblePerson);
  addInFilter(clauses, params, "storage_address", filters.storageAddress);
  addInFilter(clauses, params, "booking_status", filters.bookingStatus);
  addInFilter(clauses, params, "external_id", filters.externalId);
  addInFilter(clauses, params, "crm_ref", filters.crmRef);
  addInFilter(clauses, params, "website_url", filters.websiteUrl);
  addInFilter(clauses, params, "yandex_disk_url", filters.yandexDiskUrl);
  if (filters.onlyWithPreview) {
    clauses.push("TRIM(COALESCE(card_preview_path, '')) != ''");
  }

  addNullableRangeFilter(clauses, params, "price", ">=", filters.priceMin);
  addNullableRangeFilter(clauses, params, "price", "<=", filters.priceMax);
  addNullableRangeFilter(clauses, params, "year", ">=", filters.yearMin);
  addNullableRangeFilter(clauses, params, "year", "<=", filters.yearMax);
  addNullableRangeFilter(clauses, params, "mileage_km", ">=", filters.mileageMin);
  addNullableRangeFilter(clauses, params, "mileage_km", "<=", filters.mileageMax);
  addNullableRangeFilter(clauses, params, "key_count", ">=", filters.keyCountMin);
  addNullableRangeFilter(clauses, params, "key_count", "<=", filters.keyCountMax);
  addNullableRangeFilter(clauses, params, "days_on_sale", ">=", filters.daysOnSaleMin);
  addNullableRangeFilter(clauses, params, "days_on_sale", "<=", filters.daysOnSaleMax);
  if (filters.search) {
    clauses.push(
      `
        (
          offer_code LIKE ?
          OR status LIKE ?
          OR brand LIKE ?
          OR model LIKE ?
          OR modification LIKE ?
          OR vehicle_type LIKE ?
          OR pts_type LIKE ?
          OR responsible_person LIKE ?
          OR storage_address LIKE ?
          OR booking_status LIKE ?
          OR external_id LIKE ?
          OR crm_ref LIKE ?
          OR website_url LIKE ?
          OR yandex_disk_url LIKE ?
          OR title LIKE ?
        )
      `,
    );
    const searchLike = `%${filters.search}%`;
    params.push(
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
      searchLike,
    );
  }

  if (clauses.length === 0) {
    return { whereClause: "", params };
  }

  return {
    whereClause: `WHERE ${clauses.join(" AND ")}`,
    params,
  };
}

function buildWhereForNewThisWeekCount(
  filters: CatalogQuery,
  fallbackWhereClause: string,
  fallbackParams: unknown[],
): { whereClause: string; params: unknown[] } {
  if (!filters.onlyWithPreview) {
    return {
      whereClause: fallbackWhereClause,
      params: fallbackParams,
    };
  }

  return buildWhere({
    ...filters,
    onlyWithPreview: undefined,
  });
}

export function searchCatalogItems(filters: CatalogQuery): {
  items: CatalogListItem[];
  total: number;
  newThisWeekCount: number;
} {
  const { whereClause, params } = buildWhere(filters);
  const {
    whereClause: newThisWeekCountWhereClause,
    params: newThisWeekCountParams,
  } = buildWhereForNewThisWeekCount(filters, whereClause, params);

  if (shouldUseMainShowcaseRandomMix(filters)) {
    const orderedOfferIds = getMainShowcaseMixOrder();
    const randomSeed = filters.randomSeed?.trim() || String(Date.now());
    const pageIds = getRandomizedWindowFromOrderedIds(
      orderedOfferIds,
      randomSeed,
      filters.page,
      filters.pageSize,
    );
    const rows = listRowsByIdsPreservingOrder(pageIds).filter((row) =>
      hasValidStoredPreviewPath(row.card_preview_path),
    );

    const totalRow = db
      .prepare(`SELECT COUNT(*) as total FROM vehicle_offers ${newThisWeekCountWhereClause}`)
      .get(...newThisWeekCountParams) as { total: number };

    return {
      items: rows.map(mapDbRow).map(toCatalogListItem),
      total: totalRow.total,
      newThisWeekCount: countNewThisWeekRowsBySql(
        newThisWeekCountWhereClause,
        newThisWeekCountParams,
      ),
    };
  }

  const requestedRegions = normalizeRequestedRegions(filters.city);
  const shouldFilterByRegion = requestedRegions.size > 0;
  const shouldFilterByNewThisWeek = filters.newThisWeek === true;
  const limit = filters.pageSize;
  const offset = (filters.page - 1) * filters.pageSize;
  const newThisWeekContext = shouldFilterByNewThisWeek
    ? getNewThisWeekSqlContext()
    : null;
  const {
    whereClause: selectWhereClause,
    params: selectParams,
  } = newThisWeekContext
    ? appendNewThisWeekSqlCondition(whereClause, params, newThisWeekContext)
    : { whereClause, params };

  const baseSelectQuery = `
    SELECT *
    FROM vehicle_offers
    ${selectWhereClause}
    ORDER BY
      has_photo DESC,
      ${filters.sortBy} ${filters.sortDir.toUpperCase()}
  `;

  if (shouldFilterByRegion || shouldFilterByNewThisWeek) {
    const rows = db.prepare(baseSelectQuery).all(...selectParams) as VehicleOfferDbRow[];
    let filteredRows = rows;
    if (shouldFilterByRegion) {
      filteredRows = filterRowsByRegions(filteredRows, requestedRegions);
    }
    const newThisWeekRows = shouldFilterByNewThisWeek
      ? filteredRows
      : filterRowsByNewThisWeek(filteredRows);
    if (shouldFilterByNewThisWeek) {
      filteredRows = newThisWeekRows;
    }
    const paginatedRows = filteredRows.slice(offset, offset + limit);

    return {
      items: paginatedRows.map(mapDbRow).map(toCatalogListItem),
      total: filteredRows.length,
      newThisWeekCount: newThisWeekRows.length,
    };
  }

  const totalRow = db
    .prepare(`SELECT COUNT(*) as total FROM vehicle_offers ${whereClause}`)
    .get(...params) as { total: number };

  const rows = db
    .prepare(`${baseSelectQuery}\nLIMIT ?\nOFFSET ?`)
    .all(...params, limit, offset) as VehicleOfferDbRow[];

  return {
    items: rows.map(mapDbRow).map(toCatalogListItem),
    total: totalRow.total,
    newThisWeekCount: countNewThisWeekRowsBySql(
      newThisWeekCountWhereClause,
      newThisWeekCountParams,
    ),
  };
}

export function findCatalogItemById(id: number): CatalogItem | null {
  const row = db
    .prepare(
      `
        SELECT *
        FROM vehicle_offers
        WHERE id = ?
        LIMIT 1
      `,
    )
    .get(id) as VehicleOfferDbRow | undefined;

  if (!row) {
    return null;
  }

  return mapDbRow(row);
}

export function getCatalogStockValueRub(): number {
  const row = db
    .prepare(
      `
        SELECT COALESCE(SUM(price), 0) AS total
        FROM vehicle_offers
        WHERE price IS NOT NULL
      `,
    )
    .get() as { total: number | null };

  if (row.total === null || !Number.isFinite(row.total)) {
    return 0;
  }

  return row.total;
}

export function getCatalogStructureSummaryMetrics(): CatalogStructureSummaryMetrics {
  const averageRow = db
    .prepare(
      `
        SELECT AVG(price) AS avgPriceRub
        FROM vehicle_offers
        WHERE price IS NOT NULL
          AND price > 0
      `,
    )
    .get() as { avgPriceRub: number | null };

  const medianRow = db
    .prepare(
      `
        SELECT AVG(price) AS medianPriceRub
        FROM (
          SELECT price
          FROM vehicle_offers
          WHERE price IS NOT NULL
            AND price > 0
          ORDER BY price
          LIMIT (
            2 - (
              SELECT COUNT(*)
              FROM vehicle_offers
              WHERE price IS NOT NULL
                AND price > 0
            ) % 2
          )
          OFFSET (
            SELECT CAST((COUNT(*) - 1) / 2 AS INTEGER)
            FROM vehicle_offers
            WHERE price IS NOT NULL
              AND price > 0
          )
        )
      `,
    )
    .get() as { medianPriceRub: number | null };

  const avgByVehicleTypeRows = db
    .prepare(
      `
        WITH typed_offers AS (
          SELECT
            CASE
              WHEN TRIM(COALESCE(vehicle_type, '')) = '' THEN 'Без типа'
              ELSE vehicle_type
            END AS vehicleType,
            price
          FROM vehicle_offers
        )
        SELECT
          vehicleType,
          COUNT(*) AS count,
          SUM(
            CASE
              WHEN price IS NOT NULL AND price > 0 THEN 1
              ELSE 0
            END
          ) AS pricedCount,
          AVG(
            CASE
              WHEN price IS NOT NULL AND price > 0 THEN price
              ELSE NULL
            END
          ) AS avgPriceRub
        FROM typed_offers
        GROUP BY vehicleType
        HAVING AVG(
          CASE
            WHEN price IS NOT NULL AND price > 0 THEN price
            ELSE NULL
          END
        ) IS NOT NULL
        ORDER BY avgPriceRub DESC
        LIMIT 4
      `,
    )
    .all() as Array<{
    vehicleType: string;
    count: number;
    pricedCount: number;
    avgPriceRub: number | null;
  }>;

  const vehicleTypeShareRows = db
    .prepare(
      `
        WITH typed_offers AS (
          SELECT
            CASE
              WHEN TRIM(COALESCE(vehicle_type, '')) = '' THEN 'Без типа'
              ELSE vehicle_type
            END AS vehicleType
          FROM vehicle_offers
        ),
        totals AS (
          SELECT COUNT(*) AS totalCount
          FROM typed_offers
        )
        SELECT
          typed_offers.vehicleType AS vehicleType,
          COUNT(*) AS count,
          CASE
            WHEN totals.totalCount > 0
              THEN COUNT(*) * 100.0 / totals.totalCount
            ELSE 0
          END AS sharePercent
        FROM typed_offers
        CROSS JOIN totals
        GROUP BY typed_offers.vehicleType
        ORDER BY count DESC, typed_offers.vehicleType ASC
      `,
    )
    .all() as Array<{
    vehicleType: string;
    count: number;
    sharePercent: number;
  }>;

  return {
    avgPriceRub:
      averageRow.avgPriceRub !== null && Number.isFinite(averageRow.avgPriceRub)
        ? averageRow.avgPriceRub
        : null,
    medianPriceRub:
      medianRow.medianPriceRub !== null && Number.isFinite(medianRow.medianPriceRub)
        ? medianRow.medianPriceRub
        : null,
    avgPriceByVehicleType: avgByVehicleTypeRows
      .filter(
        (
          item,
        ): item is {
          vehicleType: string;
          count: number;
          pricedCount: number;
          avgPriceRub: number;
        } =>
          item.avgPriceRub !== null && Number.isFinite(item.avgPriceRub),
      )
      .map((item) => ({
        vehicleType: item.vehicleType,
        count: item.count,
        pricedCount: item.pricedCount,
        avgPriceRub: item.avgPriceRub,
      })),
    vehicleTypeShare: vehicleTypeShareRows.map((item) => ({
      vehicleType: item.vehicleType,
      count: item.count,
      sharePercent: Number.isFinite(item.sharePercent) ? item.sharePercent : 0,
    })),
  };
}

export function getCatalogFiltersMetadata(): Record<string, unknown> {
  const latestImportBatchId = getLatestSuccessfulImportBatchId();
  const cached = filtersMetadataCache;
  if (
    cached &&
    cached.latestImportBatchId === latestImportBatchId &&
    cached.expiresAt > Date.now()
  ) {
    return cached.value;
  }

  const distinct = (column: string): string[] =>
    (
      db
        .prepare(`SELECT DISTINCT ${column} AS value FROM vehicle_offers ORDER BY ${column} ASC`)
        .all() as Array<{ value: string }>
    )
      .map((row) => row.value)
      .filter((value) => value !== null && value !== undefined && value !== "");

  const boolDistinct = (column: string): boolean[] =>
    (
      db
        .prepare(`SELECT DISTINCT ${column} AS value FROM vehicle_offers ORDER BY ${column} ASC`)
        .all() as Array<{ value: number | null }>
    )
      .filter((row) => row.value === 0 || row.value === 1)
      .map((row) => row.value === 1);

  const rangeRow = db
    .prepare(
      `
      SELECT
        MIN(price) AS priceMin,
        MAX(price) AS priceMax,
        MIN(year) AS yearMin,
        MAX(year) AS yearMax,
        MIN(mileage_km) AS mileageMin,
        MAX(mileage_km) AS mileageMax,
        MIN(key_count) AS keyCountMin,
        MAX(key_count) AS keyCountMax,
        MIN(days_on_sale) AS daysOnSaleMin,
        MAX(days_on_sale) AS daysOnSaleMax
      FROM vehicle_offers
      `,
    )
    .get() as Record<string, number | null>;

  const brandDisplayMap = buildDisplayLabelMap(distinct("brand"));
  const modelDisplayMap = buildDisplayLabelMap(distinct("model"));

  const mergeDisplayValue = (
    target: Map<string, string>,
    rawValue: string,
  ): void => {
    const cleaned = cleanDisplayValue(rawValue);
    if (!cleaned) {
      return;
    }

    const key = normalizeComparableText(cleaned);
    const current = target.get(key);
    if (!current) {
      target.set(key, cleaned);
      return;
    }

    target.set(key, pickPreferredDisplayLabel(current, cleaned));
  };

  const modelsByBrandRows = db
    .prepare(
      `
        SELECT brand, model
        FROM vehicle_offers
        WHERE brand != '' AND model != ''
        GROUP BY brand, model
        ORDER BY brand ASC, model ASC
      `,
    )
    .all() as Array<{ brand: string; model: string }>;

  const modelsByBrandMap = new Map<string, Map<string, string>>();
  modelsByBrandRows.forEach((row) => {
    const brandKey = normalizeComparableText(row.brand);
    const brandLabel = brandDisplayMap.get(brandKey) ?? cleanDisplayValue(row.brand);
    if (!brandLabel) {
      return;
    }

    if (!modelsByBrandMap.has(brandLabel)) {
      modelsByBrandMap.set(brandLabel, new Map<string, string>());
    }

    const modelMap = modelsByBrandMap.get(brandLabel);
    if (!modelMap) {
      return;
    }

    mergeDisplayValue(modelMap, row.model);
  });

  const modelsByBrand = Array.from(modelsByBrandMap.keys())
    .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }))
    .reduce<Record<string, string[]>>((accumulator, brandLabel) => {
      const modelMap = modelsByBrandMap.get(brandLabel);
      accumulator[brandLabel] = modelMap ? sortDisplayValues(modelMap.values()) : [];
      return accumulator;
    }, {});

  const brandsByVehicleTypeRows = db
    .prepare(
      `
        SELECT vehicle_type, brand
        FROM vehicle_offers
        WHERE vehicle_type != '' AND brand != ''
        GROUP BY vehicle_type, brand
        ORDER BY vehicle_type ASC, brand ASC
      `,
    )
    .all() as Array<{ vehicle_type: string; brand: string }>;

  const brandsByVehicleTypeMap = new Map<string, Map<string, string>>();
  brandsByVehicleTypeRows.forEach((row) => {
    const vehicleType = cleanDisplayValue(row.vehicle_type);
    if (!vehicleType) {
      return;
    }

    if (!brandsByVehicleTypeMap.has(vehicleType)) {
      brandsByVehicleTypeMap.set(vehicleType, new Map<string, string>());
    }

    const brandMap = brandsByVehicleTypeMap.get(vehicleType);
    if (!brandMap) {
      return;
    }

    const brandKey = normalizeComparableText(row.brand);
    const brandLabel = brandDisplayMap.get(brandKey) ?? cleanDisplayValue(row.brand);
    if (!brandLabel) {
      return;
    }

    const current = brandMap.get(brandKey);
    if (!current) {
      brandMap.set(brandKey, brandLabel);
      return;
    }

    brandMap.set(brandKey, pickPreferredDisplayLabel(current, brandLabel));
  });

  const brandsByVehicleType = Array.from(brandsByVehicleTypeMap.keys())
    .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }))
    .reduce<Record<string, string[]>>((accumulator, vehicleType) => {
      const brandMap = brandsByVehicleTypeMap.get(vehicleType);
      accumulator[vehicleType] = brandMap ? sortDisplayValues(brandMap.values()) : [];
      return accumulator;
    }, {});

  const modelsByBrandAndVehicleTypeRows = db
    .prepare(
      `
        SELECT vehicle_type, brand, model
        FROM vehicle_offers
        WHERE vehicle_type != '' AND brand != '' AND model != ''
        GROUP BY vehicle_type, brand, model
        ORDER BY vehicle_type ASC, brand ASC, model ASC
      `,
    )
    .all() as Array<{ vehicle_type: string; brand: string; model: string }>;

  const modelsByBrandAndVehicleTypeMap = new Map<
    string,
    Map<string, Map<string, string>>
  >();
  modelsByBrandAndVehicleTypeRows.forEach((row) => {
    const vehicleType = cleanDisplayValue(row.vehicle_type);
    if (!vehicleType) {
      return;
    }

    if (!modelsByBrandAndVehicleTypeMap.has(vehicleType)) {
      modelsByBrandAndVehicleTypeMap.set(vehicleType, new Map<string, Map<string, string>>());
    }

    const brandGroups = modelsByBrandAndVehicleTypeMap.get(vehicleType);
    if (!brandGroups) {
      return;
    }

    const brandKey = normalizeComparableText(row.brand);
    const brandLabel = brandDisplayMap.get(brandKey) ?? cleanDisplayValue(row.brand);
    if (!brandLabel) {
      return;
    }

    if (!brandGroups.has(brandLabel)) {
      brandGroups.set(brandLabel, new Map<string, string>());
    }

    const modelMap = brandGroups.get(brandLabel);
    if (!modelMap) {
      return;
    }

    mergeDisplayValue(modelMap, row.model);
  });

  const modelsByBrandAndVehicleType = Array.from(modelsByBrandAndVehicleTypeMap.keys())
    .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }))
    .reduce<Record<string, Record<string, string[]>>>((accumulator, vehicleType) => {
      const brandGroups = modelsByBrandAndVehicleTypeMap.get(vehicleType);
      if (!brandGroups) {
        accumulator[vehicleType] = {};
        return accumulator;
      }

      const groupedModels = Array.from(brandGroups.keys())
        .sort((left, right) => left.localeCompare(right, "ru", { sensitivity: "base" }))
        .reduce<Record<string, string[]>>((brandAccumulator, brandLabel) => {
          const modelMap = brandGroups.get(brandLabel);
          brandAccumulator[brandLabel] = modelMap ? sortDisplayValues(modelMap.values()) : [];
          return brandAccumulator;
        }, {});

      accumulator[vehicleType] = groupedModels;
      return accumulator;
    }, {});

  const citySet = new Set<string>();
  const storageAddresses = distinct("storage_address");
  storageAddresses.forEach((address) => {
    const region = extractRegionFromAddress(address);
    if (region) {
      citySet.add(region);
    }
  });
  const city = Array.from(citySet).sort((a, b) =>
    a.localeCompare(b, "ru", { sensitivity: "base" }),
  );

  const metadata = {
    offerCode: distinct("offer_code"),
    tenantId: distinct("tenant_id"),
    status: distinct("status"),
    city,
    brand: sortDisplayValues(brandDisplayMap.values()),
    model: sortDisplayValues(modelDisplayMap.values()),
    modification: distinct("modification"),
    vehicleType: distinct("vehicle_type"),
    ptsType: distinct("pts_type"),
    hasEncumbrance: boolDistinct("has_encumbrance"),
    isDeregistered: boolDistinct("is_deregistered"),
    responsiblePerson: distinct("responsible_person"),
    storageAddress: distinct("storage_address"),
    bookingStatus: distinct("booking_status"),
    externalId: distinct("external_id"),
    crmRef: distinct("crm_ref"),
    websiteUrl: distinct("website_url"),
    // Media URLs can be very large (multi-line galleries) and are not used in showcase filter UI.
    // Returning distinct values here can make /catalog/filters payload too heavy.
    yandexDiskUrl: [],
    modelsByBrand,
    brandsByVehicleType,
    modelsByBrandAndVehicleType,
    ...rangeRow,
  };

  filtersMetadataCache = {
    latestImportBatchId,
    expiresAt: Date.now() + FILTERS_METADATA_CACHE_TTL_MS,
    value: metadata,
  };

  return metadata;
}

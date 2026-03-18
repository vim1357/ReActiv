import { z } from "zod";

function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .flatMap((item) => String(item).split(","))
      .map((item) => item.trim())
      .filter(Boolean);
    return items.length ? items : undefined;
  }

  const singleItems = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return singleItems.length ? singleItems : undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toOptionalBooleanArray(value: unknown): boolean[] | undefined {
  const values = toStringArray(value);
  if (!values) {
    return undefined;
  }

  const parsed = values
    .map((item) => item.toLowerCase())
    .map((item) => {
      if (item === "true" || item === "1") {
        return true;
      }
      if (item === "false" || item === "0") {
        return false;
      }
      return null;
    })
    .filter((item): item is boolean => item !== null);

  return parsed.length ? parsed : undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1") {
    return true;
  }
  if (normalized === "false" || normalized === "0") {
    return false;
  }

  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized ? normalized : undefined;
}

const arrayField = z.preprocess(toStringArray, z.array(z.string()).optional());
const numberField = z.preprocess(toOptionalNumber, z.number().optional());
const booleanArrayField = z.preprocess(
  toOptionalBooleanArray,
  z.array(z.boolean()).optional(),
);
const booleanField = z.preprocess(toOptionalBoolean, z.boolean().optional());

const catalogQuerySchema = z.object({
  offerCode: arrayField,
  status: arrayField,
  city: arrayField,
  brand: arrayField,
  model: arrayField,
  modification: arrayField,
  vehicleType: arrayField,
  ptsType: arrayField,
  hasEncumbrance: booleanArrayField,
  isDeregistered: booleanArrayField,
  responsiblePerson: arrayField,
  storageAddress: arrayField,
  bookingStatus: arrayField,
  externalId: arrayField,
  crmRef: arrayField,
  websiteUrl: arrayField,
  yandexDiskUrl: arrayField,
  search: z.preprocess((value) => toStringArray(value)?.[0], z.string().optional()),
  newThisWeek: booleanField,
  randomMix: booleanField,
  randomSeed: z.preprocess(toOptionalString, z.string().max(128).optional()),
  sortBy: z
    .enum(["created_at", "price", "year", "mileage_km", "days_on_sale"])
    .default("created_at"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  page: z.preprocess(toOptionalNumber, z.number().int().min(1).default(1)),
  pageSize: z.preprocess(toOptionalNumber, z.number().int().min(1).max(100).default(20)),
  priceMin: numberField,
  priceMax: numberField,
  yearMin: numberField,
  yearMax: numberField,
  mileageMin: numberField,
  mileageMax: numberField,
  keyCountMin: numberField,
  keyCountMax: numberField,
  daysOnSaleMin: numberField,
  daysOnSaleMax: numberField,
});

export type CatalogQuery = z.infer<typeof catalogQuerySchema>;

export function parseCatalogQuery(rawQuery: unknown): CatalogQuery {
  return catalogQuerySchema.parse(rawQuery);
}

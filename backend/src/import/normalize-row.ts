import type { CanonicalField } from "../domain/types";
import type { ColumnMapResult } from "./resolve-column-map";
import { buildTitle } from "./build-title";
import { normalizeBrandWithMeta } from "./normalize-brand";
import { normalizeOfferCode } from "./normalize-offer-code";
import { normalizeString } from "./normalize-string";
import { normalizeUrl } from "./normalize-url";
import { normalizeVehicleTypeWithMeta } from "./normalize-vehicle-type";
import { parseBoolean } from "./parse-boolean";
import { parseInteger } from "./parse-integer";
import { parseKeyCount } from "./parse-key-count";
import { parsePrice } from "./parse-price";

export interface NormalizedVehicleOfferRow {
  offer_code: string | null;
  status: string | null;
  brand: string | null;
  brand_raw: string | null;
  brand_unknown_mapped: boolean;
  brand_composite_tail: string | null;
  model: string | null;
  modification: string | null;
  vehicle_type: string | null;
  vehicle_type_raw: string | null;
  vehicle_type_unknown_mapped: boolean;
  year: number | null;
  mileage_km: number | null;
  key_count: number | null;
  pts_type: string | null;
  has_encumbrance: boolean | null;
  is_deregistered: boolean | null;
  responsible_person: string | null;
  storage_address: string | null;
  days_on_sale: number | null;
  price: number | null;
  yandex_disk_url: string | null;
  booking_status: string | null;
  external_id: string | null;
  crm_ref: string | null;
  website_url: string | null;
  title: string;
  year_present: boolean;
  mileage_km_present: boolean;
  days_on_sale_present: boolean;
  is_deregistered_present: boolean;
  price_present: boolean;
}

function getValue(
  row: unknown[],
  fieldToColumnIndex: ColumnMapResult["fieldToColumnIndex"],
  field: CanonicalField,
): unknown {
  const columnIndex = fieldToColumnIndex[field];
  return columnIndex === undefined ? null : row[columnIndex];
}

interface NormalizeVehicleOfferRowOptions {
  offerCodeNormalizer?: (rawValue: unknown) => string | null;
  tenantId?: string;
  canonicalBrandHints?: string[];
}

export function normalizeVehicleOfferRow(
  row: unknown[],
  fieldToColumnIndex: ColumnMapResult["fieldToColumnIndex"],
  options: NormalizeVehicleOfferRowOptions = {},
): NormalizedVehicleOfferRow {
  const offerCodeNormalizer = options.offerCodeNormalizer ?? normalizeOfferCode;
  const offerCode = offerCodeNormalizer(getValue(row, fieldToColumnIndex, "offer_code"));
  const status = normalizeString(getValue(row, fieldToColumnIndex, "status")) || null;
  const brandMeta = normalizeBrandWithMeta(getValue(row, fieldToColumnIndex, "brand"), {
    tenantId: options.tenantId,
    canonicalBrandHints: options.canonicalBrandHints,
  });
  const brand = brandMeta.value;
  const model = normalizeString(getValue(row, fieldToColumnIndex, "model")) || null;
  const modification =
    normalizeString(getValue(row, fieldToColumnIndex, "modification")) || null;
  const rawYear = getValue(row, fieldToColumnIndex, "year");
  const rawMileage = getValue(row, fieldToColumnIndex, "mileage_km");
  const rawKeyCount = getValue(row, fieldToColumnIndex, "key_count");
  const rawIsDeregistered = getValue(row, fieldToColumnIndex, "is_deregistered");
  const rawDaysOnSale = getValue(row, fieldToColumnIndex, "days_on_sale");
  const rawPrice = getValue(row, fieldToColumnIndex, "price");
  const vehicleTypeMeta = normalizeVehicleTypeWithMeta(
    getValue(row, fieldToColumnIndex, "vehicle_type"),
    {
      tenantId: options.tenantId,
      statusRaw: status,
    },
  );

  const parsedKeyCount = parseKeyCount(rawKeyCount);
  const parsedHasEncumbrance = parseBoolean(getValue(row, fieldToColumnIndex, "has_encumbrance"));
  const hasDeregistrationValue = Boolean(normalizeString(rawIsDeregistered));

  return {
    offer_code: offerCode,
    status,
    brand,
    brand_raw: brandMeta.rawNormalized,
    brand_unknown_mapped: brandMeta.unknownMapped,
    brand_composite_tail: brandMeta.compositeTail,
    model,
    modification,
    vehicle_type: vehicleTypeMeta.normalized,
    vehicle_type_raw: vehicleTypeMeta.rawNormalized,
    vehicle_type_unknown_mapped: vehicleTypeMeta.usedFallback,
    year: parseInteger(rawYear),
    mileage_km: parseInteger(rawMileage),
    key_count: parsedKeyCount,
    pts_type: normalizeString(getValue(row, fieldToColumnIndex, "pts_type")) || null,
    has_encumbrance: parsedHasEncumbrance,
    is_deregistered: hasDeregistrationValue ? true : null,
    responsible_person:
      normalizeString(getValue(row, fieldToColumnIndex, "responsible_person")) || null,
    storage_address:
      normalizeString(getValue(row, fieldToColumnIndex, "storage_address")) || null,
    days_on_sale: parseInteger(rawDaysOnSale),
    price: parsePrice(rawPrice),
    yandex_disk_url: normalizeUrl(getValue(row, fieldToColumnIndex, "yandex_disk_url")),
    booking_status: normalizeString(getValue(row, fieldToColumnIndex, "booking_status")) || null,
    external_id: normalizeString(getValue(row, fieldToColumnIndex, "external_id")) || null,
    crm_ref: normalizeString(getValue(row, fieldToColumnIndex, "crm_ref")) || null,
    website_url: normalizeUrl(getValue(row, fieldToColumnIndex, "website_url")),
    title: buildTitle(brand, model, modification, offerCode),
    year_present: Boolean(normalizeString(rawYear)),
    mileage_km_present: Boolean(normalizeString(rawMileage)),
    days_on_sale_present: Boolean(normalizeString(rawDaysOnSale)),
    is_deregistered_present: hasDeregistrationValue,
    price_present: Boolean(normalizeString(rawPrice)),
  };
}

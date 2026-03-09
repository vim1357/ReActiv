import type { CanonicalField } from "../domain/types";
import { normalizeOfferCode, normalizeOfferCodePreserve } from "./normalize-offer-code";

export type ImportTenantId = "gpb" | "reso";

type HeaderAliases = Record<CanonicalField, string[]>;

export interface ImportTenantProfile {
  id: ImportTenantId;
  label: string;
  headerAliases: HeaderAliases;
  offerCodeNormalizer: (rawValue: unknown) => string | null;
}

const RESO_HEADER_OVERRIDES: Partial<HeaderAliases> = {
  offer_code: ["VIN / Зав.№"],
  status: ["Статус"],
  brand: ["Предмет лизинга.Марка"],
  model: ["Предмет лизинга.Модель"],
  modification: ["Предмет лизинга.Тип предмета лизинга"],
  vehicle_type: ["Предмет лизинга.Тип предмета лизинга"],
  year: ["Год выпуска"],
  mileage_km: ["Пробег (м/ч)"],
  is_deregistered: ["Дата снятия с учета"],
  responsible_person: ["Менеджер продающий"],
  storage_address: ["Местонахождение"],
  days_on_sale: ["Дней в продаже"],
  price: ["Утвержденная цена"],
  booking_status: ["Статус резерва"],
  external_id: ["№ п/п"],
  has_encumbrance: ["Арест"],
};

function mergeAliases(
  base: HeaderAliases,
  overrides: Partial<HeaderAliases>,
): HeaderAliases {
  const merged = { ...base };
  (Object.keys(overrides) as CanonicalField[]).forEach((field) => {
    const aliases = overrides[field];
    if (aliases && aliases.length > 0) {
      merged[field] = aliases;
    }
  });
  return merged;
}

export function createImportTenantProfiles(
  baseAliases: HeaderAliases,
): Record<ImportTenantId, ImportTenantProfile> {
  return {
    gpb: {
      id: "gpb",
      label: "ГПБ Лизинг",
      headerAliases: baseAliases,
      offerCodeNormalizer: normalizeOfferCode,
    },
    reso: {
      id: "reso",
      label: "РЕСО Лизинг",
      headerAliases: mergeAliases(baseAliases, RESO_HEADER_OVERRIDES),
      offerCodeNormalizer: normalizeOfferCodePreserve,
    },
  };
}

export function parseImportTenantId(
  rawValue: unknown,
): ImportTenantId | null {
  if (rawValue === "gpb" || rawValue === "reso") {
    return rawValue;
  }
  return null;
}

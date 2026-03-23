import { db } from "../db/connection";

export interface CardFillnessFieldMeta {
  key:
    | "price"
    | "mileageKm"
    | "year"
    | "brand"
    | "model"
    | "storageAddress"
    | "websiteUrl"
    | "hasPhoto";
  label: string;
}

export interface CardFillnessFieldMetric extends CardFillnessFieldMeta {
  filledCount: number;
  missingCount: number;
  fillPercent: number;
}

export interface CardFillnessTenantItem {
  tenantId: string;
  tenantLabel: string;
  totalOffers: number;
  overallFillPercent: number;
  fields: CardFillnessFieldMetric[];
}

export interface CardFillnessSummary {
  generatedAt: string;
  fields: CardFillnessFieldMeta[];
  tenants: CardFillnessTenantItem[];
  totals: {
    totalOffers: number;
    tenantCount: number;
    overallFillPercent: number;
  };
}

interface TenantFillnessDbRow {
  tenant_id: string;
  total_offers: number;
  price_filled: number;
  mileage_filled: number;
  year_filled: number;
  brand_filled: number;
  model_filled: number;
  storage_address_filled: number;
  website_url_filled: number;
  has_photo_filled: number;
}

const TENANT_LABELS: Record<string, string> = {
  gpb: "ГПБ Лизинг",
  reso: "РЕСО-Лизинг",
  alpha: "Альфа-Лизинг",
  sovcombank: "Совкомбанк Лизинг",
};

const TENANT_ORDER = ["gpb", "reso", "alpha", "sovcombank"];

const FIELD_DEFINITIONS: Array<{
  key: CardFillnessFieldMeta["key"];
  label: string;
  countSelector: (row: TenantFillnessDbRow) => number;
}> = [
  {
    key: "price",
    label: "Цена",
    countSelector: (row) => row.price_filled,
  },
  {
    key: "mileageKm",
    label: "Пробег",
    countSelector: (row) => row.mileage_filled,
  },
  {
    key: "year",
    label: "Год выпуска",
    countSelector: (row) => row.year_filled,
  },
  {
    key: "brand",
    label: "Марка",
    countSelector: (row) => row.brand_filled,
  },
  {
    key: "model",
    label: "Модель",
    countSelector: (row) => row.model_filled,
  },
  {
    key: "storageAddress",
    label: "Локация",
    countSelector: (row) => row.storage_address_filled,
  },
  {
    key: "websiteUrl",
    label: "Ссылка на источник",
    countSelector: (row) => row.website_url_filled,
  },
  {
    key: "hasPhoto",
    label: "Фото в карточке",
    countSelector: (row) => row.has_photo_filled,
  },
];

function formatTenantLabel(tenantId: string): string {
  return TENANT_LABELS[tenantId] ?? tenantId;
}

function sortTenantRows(left: TenantFillnessDbRow, right: TenantFillnessDbRow): number {
  const leftIndex = TENANT_ORDER.indexOf(left.tenant_id);
  const rightIndex = TENANT_ORDER.indexOf(right.tenant_id);

  if (leftIndex >= 0 && rightIndex >= 0) {
    return leftIndex - rightIndex;
  }
  if (leftIndex >= 0) {
    return -1;
  }
  if (rightIndex >= 0) {
    return 1;
  }

  return left.tenant_id.localeCompare(right.tenant_id);
}

function toPercent(filledCount: number, totalOffers: number): number {
  if (totalOffers <= 0) {
    return 0;
  }
  return (filledCount * 100) / totalOffers;
}

export function getCardFillnessSummary(): CardFillnessSummary {
  const rows = db
    .prepare(
      `
        SELECT
          tenant_id,
          COUNT(*) AS total_offers,
          SUM(CASE WHEN price IS NOT NULL AND price > 0 THEN 1 ELSE 0 END) AS price_filled,
          SUM(CASE WHEN mileage_km IS NOT NULL THEN 1 ELSE 0 END) AS mileage_filled,
          SUM(CASE WHEN year IS NOT NULL THEN 1 ELSE 0 END) AS year_filled,
          SUM(CASE WHEN TRIM(COALESCE(brand, '')) != '' THEN 1 ELSE 0 END) AS brand_filled,
          SUM(CASE WHEN TRIM(COALESCE(model, '')) != '' THEN 1 ELSE 0 END) AS model_filled,
          SUM(CASE WHEN TRIM(COALESCE(storage_address, '')) != '' THEN 1 ELSE 0 END) AS storage_address_filled,
          SUM(CASE WHEN TRIM(COALESCE(website_url, '')) != '' THEN 1 ELSE 0 END) AS website_url_filled,
          SUM(CASE WHEN has_photo = 1 THEN 1 ELSE 0 END) AS has_photo_filled
        FROM vehicle_offers
        GROUP BY tenant_id
      `,
    )
    .all() as TenantFillnessDbRow[];

  const sortedRows = rows.sort(sortTenantRows);
  const fields: CardFillnessFieldMeta[] = FIELD_DEFINITIONS.map((item) => ({
    key: item.key,
    label: item.label,
  }));

  const tenants = sortedRows.map((row) => {
    const fieldMetrics: CardFillnessFieldMetric[] = FIELD_DEFINITIONS.map((field) => {
      const filledCount = field.countSelector(row);
      return {
        key: field.key,
        label: field.label,
        filledCount,
        missingCount: Math.max(0, row.total_offers - filledCount),
        fillPercent: toPercent(filledCount, row.total_offers),
      };
    });

    const overallFilledPoints = fieldMetrics.reduce(
      (sum, metric) => sum + metric.filledCount,
      0,
    );
    const overallTotalPoints = row.total_offers * fieldMetrics.length;

    return {
      tenantId: row.tenant_id,
      tenantLabel: formatTenantLabel(row.tenant_id),
      totalOffers: row.total_offers,
      overallFillPercent:
        overallTotalPoints > 0 ? (overallFilledPoints * 100) / overallTotalPoints : 0,
      fields: fieldMetrics,
    };
  });

  const totalOffers = tenants.reduce((sum, item) => sum + item.totalOffers, 0);
  const totalFillPercentPoints = tenants.reduce(
    (sum, item) => sum + item.overallFillPercent * item.totalOffers,
    0,
  );

  return {
    generatedAt: new Date().toISOString(),
    fields,
    tenants,
    totals: {
      totalOffers,
      tenantCount: tenants.length,
      overallFillPercent: totalOffers > 0 ? totalFillPercentPoints / totalOffers : 0,
    },
  };
}

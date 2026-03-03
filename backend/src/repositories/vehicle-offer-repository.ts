import { db } from "../db/connection";
import type { NormalizedVehicleOfferRow } from "../import/normalize-row";

export interface StoredVehicleOfferRow {
  id: number;
  import_batch_id: string;
  offer_code: string | null;
  status: string | null;
  brand: string | null;
  model: string | null;
  modification: string | null;
  vehicle_type: string | null;
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
  title: string | null;
  created_at: string;
}

function toDbText(value: string | null): string {
  return value ?? "";
}

function toDbNullableBoolean(value: boolean | null): number | null {
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  return null;
}

function toDbNullableNumber(value: number | null): number | null {
  if (typeof value === "number") {
    return value;
  }
  return null;
}

function insertVehicleOfferIntoTable(
  tableName: "vehicle_offers" | "vehicle_offer_snapshots",
  importBatchId: string,
  row: NormalizedVehicleOfferRow,
): void {
  db.prepare(
    `
      INSERT INTO ${tableName} (
        import_batch_id,
        offer_code,
        status,
        brand,
        model,
        modification,
        vehicle_type,
        year,
        mileage_km,
        key_count,
        pts_type,
        has_encumbrance,
        is_deregistered,
        responsible_person,
        storage_address,
        days_on_sale,
        price,
        yandex_disk_url,
        booking_status,
        external_id,
        crm_ref,
        website_url,
        title
      ) VALUES (
        @import_batch_id,
        @offer_code,
        @status,
        @brand,
        @model,
        @modification,
        @vehicle_type,
        @year,
        @mileage_km,
        @key_count,
        @pts_type,
        @has_encumbrance,
        @is_deregistered,
        @responsible_person,
        @storage_address,
        @days_on_sale,
        @price,
        @yandex_disk_url,
        @booking_status,
        @external_id,
        @crm_ref,
        @website_url,
        @title
      )
    `,
  ).run({
    import_batch_id: importBatchId,
    offer_code: toDbText(row.offer_code),
    status: toDbText(row.status),
    brand: toDbText(row.brand),
    model: toDbText(row.model),
    modification: toDbText(row.modification),
    vehicle_type: toDbText(row.vehicle_type),
    year: toDbNullableNumber(row.year),
    mileage_km: toDbNullableNumber(row.mileage_km),
    key_count: toDbNullableNumber(row.key_count),
    pts_type: toDbText(row.pts_type),
    has_encumbrance: toDbNullableBoolean(row.has_encumbrance),
    is_deregistered: toDbNullableBoolean(row.is_deregistered),
    responsible_person: toDbText(row.responsible_person),
    storage_address: toDbText(row.storage_address),
    days_on_sale: toDbNullableNumber(row.days_on_sale),
    price: toDbNullableNumber(row.price),
    yandex_disk_url: toDbText(row.yandex_disk_url),
    booking_status: toDbText(row.booking_status),
    external_id: toDbText(row.external_id),
    crm_ref: toDbText(row.crm_ref),
    website_url: toDbText(row.website_url),
    title: toDbText(row.title),
  });
}

export function insertVehicleOffer(
  importBatchId: string,
  row: NormalizedVehicleOfferRow,
): void {
  insertVehicleOfferIntoTable("vehicle_offers", importBatchId, row);
}

export function insertVehicleOfferSnapshot(
  importBatchId: string,
  row: NormalizedVehicleOfferRow,
): void {
  insertVehicleOfferIntoTable("vehicle_offer_snapshots", importBatchId, row);
}

function mapDbText(value: string): string | null {
  return value === "" ? null : value;
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

function mapStoredRow(row: {
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
  created_at: string;
}): StoredVehicleOfferRow {
  return {
    id: row.id,
    import_batch_id: row.import_batch_id,
    offer_code: mapDbText(row.offer_code),
    status: mapDbText(row.status),
    brand: mapDbText(row.brand),
    model: mapDbText(row.model),
    modification: mapDbText(row.modification),
    vehicle_type: mapDbText(row.vehicle_type),
    year: row.year,
    mileage_km: row.mileage_km,
    key_count: row.key_count,
    pts_type: mapDbText(row.pts_type),
    has_encumbrance: mapDbBoolean(row.has_encumbrance),
    is_deregistered: mapDbBoolean(row.is_deregistered),
    responsible_person: mapDbText(row.responsible_person),
    storage_address: mapDbText(row.storage_address),
    days_on_sale: row.days_on_sale,
    price: row.price,
    yandex_disk_url: mapDbText(row.yandex_disk_url),
    booking_status: mapDbText(row.booking_status),
    external_id: mapDbText(row.external_id),
    crm_ref: mapDbText(row.crm_ref),
    website_url: mapDbText(row.website_url),
    title: mapDbText(row.title),
    created_at: row.created_at,
  };
}

export function listVehicleOffersByImportBatchId(importBatchId: string): StoredVehicleOfferRow[] {
  const rows = db
    .prepare(
      `
        SELECT *
        FROM vehicle_offers
        WHERE import_batch_id = ?
        ORDER BY id ASC
      `,
    )
    .all(importBatchId) as Array<Parameters<typeof mapStoredRow>[0]>;

  return rows.map(mapStoredRow);
}

export function replaceCurrentVehicleOffers(
  importBatchId: string,
  rows: NormalizedVehicleOfferRow[],
): void {
  const deleteCurrentOffers = db.prepare(`DELETE FROM vehicle_offers`);

  db.transaction(() => {
    deleteCurrentOffers.run();
    rows.forEach((row) => {
      insertVehicleOffer(importBatchId, row);
    });
  })();
}

export function appendVehicleOfferSnapshots(
  importBatchId: string,
  rows: NormalizedVehicleOfferRow[],
): void {
  db.transaction(() => {
    rows.forEach((row) => {
      insertVehicleOfferSnapshot(importBatchId, row);
    });
  })();
}

export function backfillVehicleOfferSnapshotsIfEmpty(): void {
  const snapshotsCountRow = db
    .prepare(`SELECT COUNT(*) AS total FROM vehicle_offer_snapshots`)
    .get() as { total: number };

  if (snapshotsCountRow.total > 0) {
    return;
  }

  db.exec(`
    INSERT INTO vehicle_offer_snapshots (
      import_batch_id,
      offer_code,
      status,
      brand,
      model,
      modification,
      vehicle_type,
      year,
      mileage_km,
      key_count,
      pts_type,
      has_encumbrance,
      is_deregistered,
      responsible_person,
      storage_address,
      days_on_sale,
      price,
      yandex_disk_url,
      booking_status,
      external_id,
      crm_ref,
      website_url,
      title,
      created_at
    )
    SELECT
      import_batch_id,
      offer_code,
      status,
      brand,
      model,
      modification,
      vehicle_type,
      year,
      mileage_km,
      key_count,
      pts_type,
      has_encumbrance,
      is_deregistered,
      responsible_person,
      storage_address,
      days_on_sale,
      price,
      yandex_disk_url,
      booking_status,
      external_id,
      crm_ref,
      website_url,
      title,
      created_at
    FROM vehicle_offers
  `);
}

export function listVehicleOfferSnapshotCodesByImportBatchId(importBatchId: string): string[] {
  const rows = db
    .prepare(
      `
        SELECT DISTINCT offer_code
        FROM vehicle_offer_snapshots
        WHERE import_batch_id = ?
          AND TRIM(COALESCE(offer_code, '')) != ''
      `,
    )
    .all(importBatchId) as Array<{ offer_code: string }>;

  return rows.map((row) => row.offer_code);
}

import { db } from "./connection";
import { normalizeBrand } from "../import/normalize-brand";
import { normalizeVehicleType } from "../import/normalize-vehicle-type";

const VEHICLE_OFFER_COLUMNS = [
  "id",
  "import_batch_id",
  "offer_code",
  "status",
  "brand",
  "model",
  "modification",
  "vehicle_type",
  "year",
  "mileage_km",
  "key_count",
  "pts_type",
  "has_encumbrance",
  "is_deregistered",
  "responsible_person",
  "storage_address",
  "days_on_sale",
  "price",
  "yandex_disk_url",
  "booking_status",
  "external_id",
  "crm_ref",
  "website_url",
  "title",
  "card_preview_path",
  "has_photo",
  "created_at",
] as const;

function createVehicleOffersTableSql(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_batch_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'gpb',
      offer_code TEXT NOT NULL,
      status TEXT NOT NULL,
      brand TEXT NOT NULL,
      model TEXT NOT NULL,
      modification TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      year INTEGER,
      mileage_km INTEGER,
      key_count INTEGER,
      pts_type TEXT NOT NULL,
      has_encumbrance INTEGER,
      is_deregistered INTEGER,
      responsible_person TEXT NOT NULL,
      storage_address TEXT NOT NULL,
      days_on_sale INTEGER,
      price REAL,
      yandex_disk_url TEXT NOT NULL,
      booking_status TEXT NOT NULL,
      external_id TEXT NOT NULL,
      crm_ref TEXT NOT NULL,
      website_url TEXT NOT NULL,
      title TEXT NOT NULL,
      card_preview_path TEXT NOT NULL DEFAULT '',
      has_photo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
    );
  `;
}

function createVehicleOfferIndexes(): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_tenant_id ON vehicle_offers(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_tenant_offer_code ON vehicle_offers(tenant_id, offer_code);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_offer_code ON vehicle_offers(offer_code);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_status ON vehicle_offers(status);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_brand ON vehicle_offers(brand);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_model ON vehicle_offers(model);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_modification ON vehicle_offers(modification);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_vehicle_type ON vehicle_offers(vehicle_type);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_pts_type ON vehicle_offers(pts_type);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_has_encumbrance ON vehicle_offers(has_encumbrance);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_is_deregistered ON vehicle_offers(is_deregistered);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_responsible_person ON vehicle_offers(responsible_person);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_storage_address ON vehicle_offers(storage_address);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_booking_status ON vehicle_offers(booking_status);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_external_id ON vehicle_offers(external_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_crm_ref ON vehicle_offers(crm_ref);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_website_url ON vehicle_offers(website_url);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_yandex_disk_url ON vehicle_offers(yandex_disk_url);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_has_photo ON vehicle_offers(has_photo);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_tenant_has_photo ON vehicle_offers(tenant_id, has_photo);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_price ON vehicle_offers(price);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_year ON vehicle_offers(year);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_mileage_km ON vehicle_offers(mileage_km);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_key_count ON vehicle_offers(key_count);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_days_on_sale ON vehicle_offers(days_on_sale);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offers_created_at ON vehicle_offers(created_at);
  `);
}

function createVehicleOfferSnapshotIndexes(): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vehicle_offer_snapshots_tenant_id ON vehicle_offer_snapshots(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offer_snapshots_tenant_offer_code ON vehicle_offer_snapshots(tenant_id, offer_code);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offer_snapshots_import_batch_id ON vehicle_offer_snapshots(import_batch_id);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offer_snapshots_offer_code ON vehicle_offer_snapshots(offer_code);
    CREATE INDEX IF NOT EXISTS idx_vehicle_offer_snapshots_created_at ON vehicle_offer_snapshots(created_at);
  `);
}

function ensureTenantColumn(tableName: string): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  const hasTenantColumn = columns.some((column) => column.name === "tenant_id");
  if (!hasTenantColumn) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gpb';`);
  }
}

function ensureCardPreviewPathColumn(
  tableName: "vehicle_offers" | "vehicle_offer_snapshots",
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  const hasCardPreviewPathColumn = columns.some(
    (column) => column.name === "card_preview_path",
  );
  if (!hasCardPreviewPathColumn) {
    db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN card_preview_path TEXT NOT NULL DEFAULT '';`,
    );
  }
}

function ensureHasPhotoColumn(
  tableName: "vehicle_offers" | "vehicle_offer_snapshots",
): void {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  const hasHasPhotoColumn = columns.some((column) => column.name === "has_photo");
  if (!hasHasPhotoColumn) {
    db.exec(
      `ALTER TABLE ${tableName} ADD COLUMN has_photo INTEGER NOT NULL DEFAULT 0;`,
    );
  }
}

function getHasPhotoSqlExpression(): string {
  return `
    CASE
      WHEN TRIM(COALESCE(card_preview_path, '')) != '' THEN 1
      WHEN TRIM(COALESCE(yandex_disk_url, '')) = '' THEN 0
      WHEN lower(yandex_disk_url) LIKE '%disk.yandex.%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%yadi.sk%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%downloader.disk.yandex.%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%.jpg%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%.jpeg%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%.png%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%.webp%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%.gif%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%.bmp%' THEN 1
      WHEN lower(yandex_disk_url) LIKE '%.svg%' THEN 1
      ELSE 0
    END
  `;
}

function syncHasPhotoColumn(
  tableName: "vehicle_offers" | "vehicle_offer_snapshots",
): void {
  const hasPhotoSql = getHasPhotoSqlExpression();
  db.exec(`
    UPDATE ${tableName}
    SET has_photo = ${hasPhotoSql}
    WHERE has_photo != ${hasPhotoSql}
  `);
}

function normalizeVehicleTypeLabels(tableName: "vehicle_offers" | "vehicle_offer_snapshots"): void {
  const rows = db
    .prepare(`SELECT id, vehicle_type FROM ${tableName}`)
    .all() as Array<{ id: number; vehicle_type: string }>;

  const update = db.prepare(
    `UPDATE ${tableName} SET vehicle_type = ? WHERE id = ?`,
  );

  db.transaction(() => {
    rows.forEach((row) => {
      const normalized = normalizeVehicleType(row.vehicle_type);
      if (!normalized || normalized === row.vehicle_type) {
        return;
      }
      update.run(normalized, row.id);
    });
  })();
}

function normalizeBrandLabels(tableName: "vehicle_offers" | "vehicle_offer_snapshots"): void {
  const rows = db
    .prepare(`SELECT id, brand FROM ${tableName}`)
    .all() as Array<{ id: number; brand: string }>;

  const update = db.prepare(
    `UPDATE ${tableName} SET brand = ? WHERE id = ?`,
  );

  db.transaction(() => {
    rows.forEach((row) => {
      const normalized = normalizeBrand(row.brand);
      if (!normalized || normalized === row.brand) {
        return;
      }
      update.run(normalized, row.id);
    });
  })();
}

function ensureVehicleOffersNullableColumns(): void {
  const columns = db
    .prepare(`PRAGMA table_info(vehicle_offers)`)
    .all() as Array<{ name: string; notnull: number }>;

  if (columns.length === 0) {
    return;
  }

  const nullableTargetColumns = new Set([
    "year",
    "mileage_km",
    "key_count",
    "has_encumbrance",
    "is_deregistered",
    "days_on_sale",
    "price",
  ]);

  const needsMigration = columns.some(
    (column) => nullableTargetColumns.has(column.name) && column.notnull === 1,
  );

  if (!needsMigration) {
    return;
  }

  db.exec(`PRAGMA foreign_keys = OFF`);
  try {
    const existingColumnNames = new Set(columns.map((column) => column.name));
    const selectColumns = VEHICLE_OFFER_COLUMNS.map((columnName) => {
      if (existingColumnNames.has(columnName)) {
        return columnName;
      }

      if (columnName === "card_preview_path") {
        return "'' AS card_preview_path";
      }

      if (columnName === "has_photo") {
        return "0 AS has_photo";
      }

      return `NULL AS ${columnName}`;
    });

    const migrate = db.transaction(() => {
      db.exec(createVehicleOffersTableSql("vehicle_offers_new"));
      db.prepare(
        `
          INSERT INTO vehicle_offers_new (${VEHICLE_OFFER_COLUMNS.join(", ")})
          SELECT ${selectColumns.join(", ")}
          FROM vehicle_offers
        `,
      ).run();
      db.exec(`DROP TABLE vehicle_offers`);
      db.exec(`ALTER TABLE vehicle_offers_new RENAME TO vehicle_offers`);
    });

    migrate();
  } finally {
    db.exec(`PRAGMA foreign_keys = ON`);
  }
}

export function initializeSchema(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'gpb',
      filename TEXT NOT NULL,
      status TEXT NOT NULL,
      total_rows INTEGER NOT NULL DEFAULT 0,
      imported_rows INTEGER NOT NULL DEFAULT 0,
      skipped_rows INTEGER NOT NULL DEFAULT 0,
      added_rows INTEGER NOT NULL DEFAULT 0,
      updated_rows INTEGER NOT NULL DEFAULT 0,
      removed_rows INTEGER NOT NULL DEFAULT 0,
      unchanged_rows INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS import_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      import_batch_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'gpb',
      row_number INTEGER NOT NULL,
      field TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (import_batch_id) REFERENCES import_batches(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      notes TEXT,
      role TEXT NOT NULL DEFAULT 'manager',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      offer_code TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, tenant_id, offer_code)
    );

    CREATE TABLE IF NOT EXISTS user_activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      login TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page TEXT,
      entity_type TEXT,
      entity_id TEXT,
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS guest_activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      page TEXT,
      entity_type TEXT,
      entity_id TEXT,
      payload_json TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT,
      referrer TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_health_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_date TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'success',
      preview_candidates_count INTEGER NOT NULL DEFAULT 0,
      preview_alive_count INTEGER NOT NULL DEFAULT 0,
      preview_missing_count INTEGER NOT NULL DEFAULT 0,
      preview_error_count INTEGER NOT NULL DEFAULT 0,
      preview_alive_percent REAL NOT NULL DEFAULT 0,
      external_sample_requested INTEGER NOT NULL DEFAULT 0,
      external_checked_with_source_count INTEGER NOT NULL DEFAULT 0,
      external_no_source_count INTEGER NOT NULL DEFAULT 0,
      external_alive_count INTEGER NOT NULL DEFAULT 0,
      external_no_preview_count INTEGER NOT NULL DEFAULT 0,
      external_error_count INTEGER NOT NULL DEFAULT 0,
      external_alive_percent REAL NOT NULL DEFAULT 0,
      host_stats_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_health_job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      metric_date TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      status TEXT NOT NULL,
      error_message TEXT,
      details_json TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    INSERT OR IGNORE INTO platform_settings (key, value)
    VALUES ('platform_mode', 'closed');

    CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token_hash ON auth_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_favorites_user_created_at ON user_favorites(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_favorites_user_offer ON user_favorites(user_id, tenant_id, offer_code);
    CREATE INDEX IF NOT EXISTS idx_activity_user_id_created_at ON user_activity_events(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_event_type_created_at ON user_activity_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_activity_session_id_created_at ON user_activity_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_guest_activity_event_type_created_at ON guest_activity_events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_guest_activity_session_id_created_at ON guest_activity_events(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_guest_activity_created_at ON guest_activity_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_media_health_daily_metric_date ON media_health_daily(metric_date);
    CREATE INDEX IF NOT EXISTS idx_media_health_job_runs_started_at ON media_health_job_runs(started_at);
    CREATE INDEX IF NOT EXISTS idx_media_health_job_runs_metric_date ON media_health_job_runs(metric_date);
  `);

  db.exec(createVehicleOffersTableSql("vehicle_offers"));
  db.exec(createVehicleOffersTableSql("vehicle_offer_snapshots"));
  ensureHasPhotoColumn("vehicle_offers");
  ensureHasPhotoColumn("vehicle_offer_snapshots");
  ensureVehicleOffersNullableColumns();
  ensureTenantColumn("import_batches");
  ensureTenantColumn("import_errors");
  ensureTenantColumn("vehicle_offers");
  ensureTenantColumn("vehicle_offer_snapshots");
  ensureCardPreviewPathColumn("vehicle_offers");
  ensureCardPreviewPathColumn("vehicle_offer_snapshots");
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_import_batches_tenant_created_at ON import_batches(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_import_errors_tenant_created_at ON import_errors(tenant_id, created_at);
  `);
  normalizeVehicleTypeLabels("vehicle_offers");
  normalizeVehicleTypeLabels("vehicle_offer_snapshots");
  normalizeBrandLabels("vehicle_offers");
  normalizeBrandLabels("vehicle_offer_snapshots");
  syncHasPhotoColumn("vehicle_offers");
  syncHasPhotoColumn("vehicle_offer_snapshots");
  createVehicleOfferIndexes();
  createVehicleOfferSnapshotIndexes();

  const importBatchColumns = db
    .prepare(`PRAGMA table_info(import_batches)`)
    .all() as Array<{ name: string }>;
  const requiredImportBatchColumns = [
    "tenant_id",
    "added_rows",
    "updated_rows",
    "removed_rows",
    "unchanged_rows",
  ] as const;
  requiredImportBatchColumns.forEach((columnName) => {
    const hasColumn = importBatchColumns.some((column) => column.name === columnName);
    if (!hasColumn) {
      if (columnName === "tenant_id") {
        db.exec(
          `ALTER TABLE import_batches ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'gpb';`,
        );
      } else {
        db.exec(
          `ALTER TABLE import_batches ADD COLUMN ${columnName} INTEGER NOT NULL DEFAULT 0;`,
        );
      }
    }
  });

  const userColumns = db
    .prepare(`PRAGMA table_info(users)`)
    .all() as Array<{ name: string }>;
  const hasRoleColumn = userColumns.some((column) => column.name === "role");
  if (!hasRoleColumn) {
    db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'manager';`);
  }

  const hasCompanyColumn = userColumns.some((column) => column.name === "company");
  if (!hasCompanyColumn) {
    db.exec(`ALTER TABLE users ADD COLUMN company TEXT;`);
  }

  const hasPhoneColumn = userColumns.some((column) => column.name === "phone");
  if (!hasPhoneColumn) {
    db.exec(`ALTER TABLE users ADD COLUMN phone TEXT;`);
  }

  const hasNotesColumn = userColumns.some((column) => column.name === "notes");
  if (!hasNotesColumn) {
    db.exec(`ALTER TABLE users ADD COLUMN notes TEXT;`);
  }

  db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);`);

  db.prepare(
    `
      UPDATE users
      SET role = 'admin'
      WHERE lower(login) = 'admin'
    `,
  ).run();

  const adminCountRow = db
    .prepare(`SELECT COUNT(*) AS total FROM users WHERE role = 'admin'`)
    .get() as { total: number };
  if (adminCountRow.total === 0) {
    db.prepare(
      `
        UPDATE users
        SET role = 'admin'
        WHERE id = (
          SELECT id
          FROM users
          ORDER BY created_at ASC, id ASC
          LIMIT 1
        )
      `,
    ).run();
  }
}

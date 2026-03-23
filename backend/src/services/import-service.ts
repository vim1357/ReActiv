import { randomUUID } from "node:crypto";
import {
  createImportBatch,
  getLatestSuccessfulImportBatchId,
  updateImportBatchSummary,
} from "../repositories/import-batch-repository";
import { insertImportError } from "../repositories/import-error-repository";
import {
  appendVehicleOfferSnapshots,
  backfillVehicleOfferSnapshotsIfEmpty,
  listDistinctBrands,
  listVehicleOffersByImportBatchId,
  replaceCurrentVehicleOffers,
  type StoredVehicleOfferRow,
} from "../repositories/vehicle-offer-repository";
import { HEADER_ALIASES } from "../import/header-aliases";
import {
  createImportTenantProfiles,
  type ImportTenantId,
} from "../import/import-tenants";
import { normalizeVehicleOfferRow } from "../import/normalize-row";
import { resolveColumnMap } from "../import/resolve-column-map";
import { validateNormalizedRow } from "../import/validate-normalized-row";
import { readExcel } from "./excel-reader";
import type { NormalizedVehicleOfferRow } from "../import/normalize-row";
import { runResoMediaEnrichmentInBackground } from "./reso-media-enrichment-service";

interface ImportServiceInput {
  filename: string;
  fileBuffer: Buffer;
  tenantId: ImportTenantId;
  logger?: {
    info: (context: Record<string, unknown>, message: string) => void;
    error: (context: Record<string, unknown>, message: string) => void;
  };
}

interface ImportServiceErrorItem {
  rowNumber: number;
  field: string | null;
  message: string;
}

export interface ImportServiceResult {
  importBatchId: string;
  tenantId: ImportTenantId;
  status: "completed" | "completed_with_errors" | "failed";
  summary: {
    totalRows: number;
    importedRows: number;
    skippedRows: number;
    addedRows: number;
    updatedRows: number;
    removedRows: number;
    unchangedRows: number;
  };
  errors: ImportServiceErrorItem[];
}

const MAX_RESPONSE_ERRORS = 100;
const BLOCKING_VALIDATION_FIELDS = new Set(["offer_code", "brand"]);
const IMPORT_TENANT_PROFILES = createImportTenantProfiles(HEADER_ALIASES);
const DIRECT_RESO_ENRICHMENT_ENABLED =
  String(process.env.ENABLE_DIRECT_RESO_ENRICHMENT ?? "").toLowerCase() === "true";

function toComparableString(value: string | null): string | null {
  return value ?? null;
}

function mapStoredToNormalizedRow(row: StoredVehicleOfferRow): NormalizedVehicleOfferRow {
  return {
    offer_code: toComparableString(row.offer_code),
    status: toComparableString(row.status),
    brand: toComparableString(row.brand),
    brand_raw: toComparableString(row.brand),
    brand_unknown_mapped: false,
    brand_composite_tail: null,
    model: toComparableString(row.model),
    modification: toComparableString(row.modification),
    vehicle_type: toComparableString(row.vehicle_type),
    vehicle_type_raw: toComparableString(row.vehicle_type),
    vehicle_type_unknown_mapped: false,
    year: row.year,
    mileage_km: row.mileage_km,
    key_count: row.key_count,
    pts_type: toComparableString(row.pts_type),
    has_encumbrance: row.has_encumbrance,
    is_deregistered: row.is_deregistered,
    responsible_person: toComparableString(row.responsible_person),
    storage_address: toComparableString(row.storage_address),
    days_on_sale: row.days_on_sale,
    price: row.price,
    yandex_disk_url: toComparableString(row.yandex_disk_url),
    booking_status: toComparableString(row.booking_status),
    external_id: toComparableString(row.external_id),
    crm_ref: toComparableString(row.crm_ref),
    website_url: toComparableString(row.website_url),
    title: toComparableString(row.title) ?? "",
    year_present: row.year !== null,
    mileage_km_present: row.mileage_km !== null,
    days_on_sale_present: row.days_on_sale !== null,
    is_deregistered_present: row.is_deregistered !== null,
    price_present: row.price !== null,
  };
}

export function importWorkbook(input: ImportServiceInput): ImportServiceResult {
  const tenantProfile = IMPORT_TENANT_PROFILES[input.tenantId];

  backfillVehicleOfferSnapshotsIfEmpty();
  const previousImportBatchId = getLatestSuccessfulImportBatchId(tenantProfile.id);
  const importBatchId = randomUUID();

  createImportBatch({
    id: importBatchId,
    filename: input.filename,
    tenant_id: tenantProfile.id,
    status: "failed",
  });

  const errors: ImportServiceErrorItem[] = [];
  let totalRows = 0;
  let importedRows = 0;
  let skippedRows = 0;
  let addedRows = 0;
  let updatedRows = 0;
  let removedRows = 0;
  let unchangedRows = 0;
  const seenOfferCodes = new Set<string>();
  const seenSovcomBrandWarnings = new Set<string>();

  input.logger?.info(
    {
      import_batch_id: importBatchId,
      tenant_id: tenantProfile.id,
      filename: input.filename,
    },
    "import_started",
  );

  try {
    const previousRowsByOfferCode = new Map<string, NormalizedVehicleOfferRow>();
    if (previousImportBatchId) {
      listVehicleOffersByImportBatchId(previousImportBatchId, tenantProfile.id).forEach((row) => {
        if (!row.offer_code) {
          return;
        }
        previousRowsByOfferCode.set(row.offer_code, mapStoredToNormalizedRow(row));
      });
    }

    const parsedWorkbook = readExcel(input.fileBuffer);
    totalRows = parsedWorkbook.rows.length;
    const rowsToImport: NormalizedVehicleOfferRow[] = [];

    const columnMap = resolveColumnMap(
      parsedWorkbook.headers,
      tenantProfile.headerAliases,
    );

    if (columnMap.missingRequiredFields.length > 0) {
      for (const missingField of columnMap.missingRequiredFields) {
        const message = `Missing required column: ${missingField}. Values will be imported as empty.`;
        insertImportError({
          import_batch_id: importBatchId,
          tenant_id: tenantProfile.id,
          row_number: 1,
          field: missingField,
          message,
        });

        if (errors.length < MAX_RESPONSE_ERRORS) {
          errors.push({ rowNumber: 1, field: missingField, message });
        }
      }
    }

    const canonicalBrandHints =
      tenantProfile.id === "sovcombank" ? listDistinctBrands("sovcombank") : undefined;

    parsedWorkbook.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const normalizedRow = normalizeVehicleOfferRow(row, columnMap.fieldToColumnIndex, {
        offerCodeNormalizer: tenantProfile.offerCodeNormalizer,
        tenantId: tenantProfile.id,
        canonicalBrandHints,
      });
      const validationErrors = validateNormalizedRow(normalizedRow);
      const blockingErrors = validationErrors.filter((validationError) =>
        BLOCKING_VALIDATION_FIELDS.has(validationError.field),
      );
      const nonBlockingErrors =
        blockingErrors.length > 0
          ? []
          : validationErrors.filter(
              (validationError) => !BLOCKING_VALIDATION_FIELDS.has(validationError.field),
            );

      if (blockingErrors.length > 0) {
        for (const validationError of blockingErrors) {
          insertImportError({
            import_batch_id: importBatchId,
            tenant_id: tenantProfile.id,
            row_number: rowNumber,
            field: validationError.field,
            message: validationError.message,
          });

          if (errors.length < MAX_RESPONSE_ERRORS) {
            errors.push({
              rowNumber,
              field: validationError.field,
              message: validationError.message,
            });
          }
        }

        skippedRows += 1;
        return;
      }

      if (!normalizedRow.offer_code) {
        skippedRows += 1;
        return;
      }

      if (seenOfferCodes.has(normalizedRow.offer_code)) {
        const message = "Duplicate offer_code in the import file";

        insertImportError({
          import_batch_id: importBatchId,
          tenant_id: tenantProfile.id,
          row_number: rowNumber,
          field: "offer_code",
          message,
        });

        if (errors.length < MAX_RESPONSE_ERRORS) {
          errors.push({
            rowNumber,
            field: "offer_code",
            message,
          });
        }

        skippedRows += 1;
        return;
      }

      if (normalizedRow.vehicle_type_unknown_mapped && normalizedRow.vehicle_type_raw) {
        const mappedVehicleType = normalizedRow.vehicle_type ?? "null";
        const message = `Unknown vehicle_type mapped to ${mappedVehicleType}: ${normalizedRow.vehicle_type_raw}`;
        insertImportError({
          import_batch_id: importBatchId,
          tenant_id: tenantProfile.id,
          row_number: rowNumber,
          field: "vehicle_type",
          message,
        });

        if (errors.length < MAX_RESPONSE_ERRORS) {
          errors.push({
            rowNumber,
            field: "vehicle_type",
            message,
          });
        }
      }

      if (
        tenantProfile.id === "sovcombank" &&
        normalizedRow.brand_unknown_mapped &&
        normalizedRow.brand_raw
      ) {
        const normalizedBrandWarningKey = normalizedRow.brand_raw.toLocaleLowerCase("ru-RU");
        if (!seenSovcomBrandWarnings.has(normalizedBrandWarningKey)) {
          seenSovcomBrandWarnings.add(normalizedBrandWarningKey);

          const message = `Ambiguous brand value kept as-is: ${normalizedRow.brand_raw}`;
          insertImportError({
            import_batch_id: importBatchId,
            tenant_id: tenantProfile.id,
            row_number: rowNumber,
            field: "brand",
            message,
          });

          if (errors.length < MAX_RESPONSE_ERRORS) {
            errors.push({
              rowNumber,
              field: "brand",
              message,
            });
          }
        }
      }

      if (nonBlockingErrors.length > 0) {
        for (const validationError of nonBlockingErrors) {
          switch (validationError.field) {
            case "year":
              normalizedRow.year = null;
              break;
            case "mileage_km":
              normalizedRow.mileage_km = null;
              break;
            case "key_count":
              normalizedRow.key_count = null;
              break;
            case "has_encumbrance":
              normalizedRow.has_encumbrance = null;
              break;
            case "is_deregistered":
              normalizedRow.is_deregistered = null;
              break;
            case "days_on_sale":
              normalizedRow.days_on_sale = null;
              break;
            case "price":
              normalizedRow.price = null;
              break;
            default:
              break;
          }

          insertImportError({
            import_batch_id: importBatchId,
            tenant_id: tenantProfile.id,
            row_number: rowNumber,
            field: validationError.field,
            message: validationError.message,
          });

          if (errors.length < MAX_RESPONSE_ERRORS) {
            errors.push({
              rowNumber,
              field: validationError.field,
              message: validationError.message,
            });
          }
        }
      }

      seenOfferCodes.add(normalizedRow.offer_code);
      rowsToImport.push(normalizedRow);
    });

    const nextOfferCodes = new Set(rowsToImport.map((row) => row.offer_code).filter(Boolean) as string[]);

    rowsToImport.forEach((row) => {
      if (!row.offer_code) {
        return;
      }

      const previousRow = previousRowsByOfferCode.get(row.offer_code);
      if (!previousRow) {
        addedRows += 1;
        return;
      }

      unchangedRows += 1;
    });

    previousRowsByOfferCode.forEach((_row, offerCode) => {
      if (!nextOfferCodes.has(offerCode)) {
        removedRows += 1;
      }
    });

    appendVehicleOfferSnapshots(importBatchId, rowsToImport, tenantProfile.id);
    replaceCurrentVehicleOffers(importBatchId, rowsToImport, tenantProfile.id);
    importedRows = rowsToImport.length;
    if (tenantProfile.id === "reso" && DIRECT_RESO_ENRICHMENT_ENABLED) {
      runResoMediaEnrichmentInBackground({
        tenantId: "reso",
        logger: input.logger,
      });
    }

    const status = errors.length > 0 ? "completed_with_errors" : "completed";

    updateImportBatchSummary({
      id: importBatchId,
      status,
      total_rows: totalRows,
      imported_rows: importedRows,
      skipped_rows: skippedRows,
      added_rows: addedRows,
      updated_rows: updatedRows,
      removed_rows: removedRows,
      unchanged_rows: unchangedRows,
    });

    return {
      importBatchId,
      tenantId: tenantProfile.id,
      status,
      summary: {
        totalRows,
        importedRows,
        skippedRows,
        addedRows,
        updatedRows,
        removedRows,
        unchangedRows,
      },
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown import error";
    insertImportError({
      import_batch_id: importBatchId,
      tenant_id: tenantProfile.id,
      row_number: 0,
      field: null,
      message,
    });

    updateImportBatchSummary({
      id: importBatchId,
      status: "failed",
      total_rows: totalRows,
      imported_rows: importedRows,
      skipped_rows: skippedRows,
      added_rows: addedRows,
      updated_rows: updatedRows,
      removed_rows: removedRows,
      unchanged_rows: unchangedRows,
    });

    input.logger?.error(
      {
        import_batch_id: importBatchId,
        tenant_id: tenantProfile.id,
        error: message,
      },
      "import_failed",
    );

    throw error;
  } finally {
    input.logger?.info(
      {
        import_batch_id: importBatchId,
        tenant_id: tenantProfile.id,
        total_rows: totalRows,
        imported_rows: importedRows,
        skipped_rows: skippedRows,
        added_rows: addedRows,
        updated_rows: updatedRows,
        removed_rows: removedRows,
        unchanged_rows: unchangedRows,
      },
      "import_completed",
    );
  }
}

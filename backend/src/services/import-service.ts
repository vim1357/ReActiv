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
  listVehicleOffersByImportBatchId,
  replaceCurrentVehicleOffers,
  type StoredVehicleOfferRow,
} from "../repositories/vehicle-offer-repository";
import { normalizeVehicleOfferRow } from "../import/normalize-row";
import { resolveColumnMap } from "../import/resolve-column-map";
import { validateNormalizedRow } from "../import/validate-normalized-row";
import { readExcel } from "./excel-reader";
import type { NormalizedVehicleOfferRow } from "../import/normalize-row";

interface ImportServiceInput {
  filename: string;
  fileBuffer: Buffer;
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

function toComparableString(value: string | null): string | null {
  return value ?? null;
}

function mapStoredToNormalizedRow(row: StoredVehicleOfferRow): NormalizedVehicleOfferRow {
  return {
    offer_code: toComparableString(row.offer_code),
    status: toComparableString(row.status),
    brand: toComparableString(row.brand),
    model: toComparableString(row.model),
    modification: toComparableString(row.modification),
    vehicle_type: toComparableString(row.vehicle_type),
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

function areRowsEquivalent(
  currentRow: NormalizedVehicleOfferRow,
  nextRow: NormalizedVehicleOfferRow,
): boolean {
  return (
    currentRow.offer_code === nextRow.offer_code &&
    currentRow.status === nextRow.status &&
    currentRow.brand === nextRow.brand &&
    currentRow.model === nextRow.model &&
    currentRow.modification === nextRow.modification &&
    currentRow.vehicle_type === nextRow.vehicle_type &&
    currentRow.year === nextRow.year &&
    currentRow.mileage_km === nextRow.mileage_km &&
    currentRow.key_count === nextRow.key_count &&
    currentRow.pts_type === nextRow.pts_type &&
    currentRow.has_encumbrance === nextRow.has_encumbrance &&
    currentRow.is_deregistered === nextRow.is_deregistered &&
    currentRow.responsible_person === nextRow.responsible_person &&
    currentRow.storage_address === nextRow.storage_address &&
    currentRow.days_on_sale === nextRow.days_on_sale &&
    currentRow.price === nextRow.price &&
    currentRow.yandex_disk_url === nextRow.yandex_disk_url &&
    currentRow.booking_status === nextRow.booking_status &&
    currentRow.external_id === nextRow.external_id &&
    currentRow.crm_ref === nextRow.crm_ref &&
    currentRow.website_url === nextRow.website_url &&
    currentRow.title === nextRow.title
  );
}

export function importWorkbook(input: ImportServiceInput): ImportServiceResult {
  backfillVehicleOfferSnapshotsIfEmpty();
  const previousImportBatchId = getLatestSuccessfulImportBatchId();
  const importBatchId = randomUUID();

  createImportBatch({
    id: importBatchId,
    filename: input.filename,
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

  input.logger?.info(
    {
      import_batch_id: importBatchId,
      filename: input.filename,
    },
    "import_started",
  );

  try {
    const previousRowsByOfferCode = new Map<string, NormalizedVehicleOfferRow>();
    if (previousImportBatchId) {
      listVehicleOffersByImportBatchId(previousImportBatchId).forEach((row) => {
        if (!row.offer_code) {
          return;
        }
        previousRowsByOfferCode.set(row.offer_code, mapStoredToNormalizedRow(row));
      });
    }

    const parsedWorkbook = readExcel(input.fileBuffer);
    totalRows = parsedWorkbook.rows.length;
    const rowsToImport: NormalizedVehicleOfferRow[] = [];

    const columnMap = resolveColumnMap(parsedWorkbook.headers);

    if (columnMap.missingRequiredFields.length > 0) {
      for (const missingField of columnMap.missingRequiredFields) {
        const message = `Missing required column: ${missingField}. Values will be imported as empty.`;
        insertImportError({
          import_batch_id: importBatchId,
          row_number: 1,
          field: missingField,
          message,
        });

        if (errors.length < MAX_RESPONSE_ERRORS) {
          errors.push({ rowNumber: 1, field: missingField, message });
        }
      }
    }

    parsedWorkbook.rows.forEach((row, index) => {
      const rowNumber = index + 2;
      const normalizedRow = normalizeVehicleOfferRow(row, columnMap.fieldToColumnIndex);
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

      if (!normalizedRow.offer_code) {
        skippedRows += 1;
        return;
      }

      if (seenOfferCodes.has(normalizedRow.offer_code)) {
        const message = "Duplicate offer_code in the import file";

        insertImportError({
          import_batch_id: importBatchId,
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

      if (areRowsEquivalent(previousRow, row)) {
        unchangedRows += 1;
        return;
      }

      updatedRows += 1;
    });

    previousRowsByOfferCode.forEach((_row, offerCode) => {
      if (!nextOfferCodes.has(offerCode)) {
        removedRows += 1;
      }
    });

    appendVehicleOfferSnapshots(importBatchId, rowsToImport);
    replaceCurrentVehicleOffers(importBatchId, rowsToImport);
    importedRows = rowsToImport.length;

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
        error: message,
      },
      "import_failed",
    );

    throw error;
  } finally {
    input.logger?.info(
      {
        import_batch_id: importBatchId,
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

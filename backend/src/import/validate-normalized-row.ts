import type { CanonicalField } from "../domain/types";
import type { NormalizedVehicleOfferRow } from "./normalize-row";

export interface RowValidationError {
  field: CanonicalField;
  message: string;
}

function pushIfEmpty(
  errors: RowValidationError[],
  field: CanonicalField,
  value: string | null,
): void {
  if (!value) {
    errors.push({ field, message: "Required field is empty" });
  }
}

export function validateNormalizedRow(
  row: NormalizedVehicleOfferRow,
): RowValidationError[] {
  const errors: RowValidationError[] = [];

  pushIfEmpty(errors, "offer_code", row.offer_code);
  pushIfEmpty(errors, "brand", row.brand);

  if (row.year === null) {
    errors.push({
      field: "year",
      message: row.year_present ? "Invalid year value" : "Field is empty",
    });
  } else if (row.year < 1950 || row.year > 2100) {
    errors.push({ field: "year", message: "Invalid year value" });
  }

  if (row.mileage_km === null) {
    errors.push({
      field: "mileage_km",
      message: row.mileage_km_present ? "Invalid mileage value" : "Field is empty",
    });
  }

  if (row.has_encumbrance === null) {
    errors.push({
      field: "has_encumbrance",
      message: "Invalid has_encumbrance value",
    });
  }

  if (!row.is_deregistered_present) {
    errors.push({
      field: "is_deregistered",
      message: "Deregistration date is empty",
    });
  }

  if (row.days_on_sale === null) {
    errors.push({
      field: "days_on_sale",
      message: row.days_on_sale_present ? "Invalid days_on_sale value" : "Field is empty",
    });
  }

  if (row.price === null) {
    errors.push({
      field: "price",
      message: row.price_present ? "Invalid price value" : "Field is empty",
    });
  }

  return errors;
}

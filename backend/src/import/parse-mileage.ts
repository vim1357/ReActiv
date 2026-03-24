import { normalizeString } from "./normalize-string";
import { parsePrice } from "./parse-price";

const THOUSANDS_UNIT_PATTERN = /тыс|thousand/i;

export function parseMileageKm(rawValue: unknown): number | null {
  const normalized = normalizeString(rawValue);
  if (!normalized) {
    return null;
  }

  const parsedNumber = parsePrice(rawValue);
  if (parsedNumber === null) {
    return null;
  }

  const normalizedCompact = normalized.replace(/\s+/g, "");
  const hasThousandsUnit = THOUSANDS_UNIT_PATTERN.test(normalizedCompact);
  const normalizedKm = hasThousandsUnit ? parsedNumber * 1000 : parsedNumber;

  if (!Number.isFinite(normalizedKm)) {
    return null;
  }

  return Math.round(normalizedKm);
}

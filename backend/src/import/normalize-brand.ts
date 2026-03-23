import { normalizeString } from "./normalize-string";

const CANONICAL_BRAND_ALIASES = new Map<string, string>([
  ["lixiang", "Li (Lixiang)"],
  ["li xiang", "Li (Lixiang)"],
  ["li (lixiang)", "Li (Lixiang)"],
]);

const SOVCOMBANK_BRAND_ALIASES = new Map<string, string>([
  ["mercedes benz", "Mercedes-Benz"],
  ["mercedes-benz", "Mercedes-Benz"],
  ["range rover", "Land Rover"],
  ["land rover", "Land Rover"],
]);

const SOVCOMBANK_FALLBACK_BRAND_HINTS = [
  "Mercedes-Benz",
  "Land Rover",
  "Porsche",
  "BMW",
  "Audi",
  "Toyota",
  "Lexus",
  "Volkswagen",
  "Volvo",
  "Nissan",
  "Mitsubishi",
  "Haval",
  "Chery",
  "Geely",
  "Exeed",
  "Tank",
  "Hongqi",
  "JAC",
  "FAW",
  "Kia",
  "Hyundai",
  "Skoda",
  "Renault",
  "Peugeot",
  "Citroen",
  "Suzuki",
  "Subaru",
  "Mazda",
  "Ford",
  "Chevrolet",
  "Opel",
  "UAZ",
  "ГАЗ",
  "КАМАЗ",
  "МАЗ",
];

export interface NormalizeBrandOptions {
  tenantId?: string;
  canonicalBrandHints?: string[];
}

export interface NormalizeBrandResult {
  value: string | null;
  rawNormalized: string | null;
  unknownMapped: boolean;
  compositeTail: string | null;
}

function normalizeLookupValue(value: string): string {
  return value
    .toLocaleLowerCase("ru-RU")
    .replace(/[^a-zа-яё0-9]+/giu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function collectSovcombankBrandHints(
  canonicalBrandHints: string[] | undefined,
): Array<{ canonical: string; normalized: string }> {
  const dedup = new Map<string, string>();

  const register = (rawValue: string) => {
    const cleaned = normalizeString(rawValue);
    if (!cleaned) {
      return;
    }
    const normalized = normalizeLookupValue(cleaned);
    if (!normalized) {
      return;
    }

    const current = dedup.get(normalized);
    if (!current) {
      dedup.set(normalized, cleaned);
      return;
    }

    if (cleaned.length < current.length) {
      dedup.set(normalized, cleaned);
    }
  };

  SOVCOMBANK_FALLBACK_BRAND_HINTS.forEach(register);
  canonicalBrandHints?.forEach(register);

  return Array.from(dedup.entries())
    .map(([normalized, canonical]) => ({ canonical, normalized }))
    .sort((left, right) => {
      const leftWords = left.normalized.split(" ").length;
      const rightWords = right.normalized.split(" ").length;
      if (rightWords !== leftWords) {
        return rightWords - leftWords;
      }
      return right.normalized.length - left.normalized.length;
    });
}

function toTitleCase(value: string): string {
  const lower = value.toLocaleLowerCase("ru-RU");
  const parts = lower.split(/(\s+|[-/])/g);

  return parts
    .map((part) => {
      if (!part || /^(?:\s+|[-/])$/.test(part)) {
        return part;
      }

      const [firstChar, ...restChars] = Array.from(part);
      if (!firstChar) {
        return part;
      }

      return firstChar.toLocaleUpperCase("ru-RU") + restChars.join("");
    })
    .join("");
}

export function normalizeBrand(rawValue: unknown): string | null {
  return normalizeBrandWithMeta(rawValue).value;
}

export function normalizeBrandWithMeta(
  rawValue: unknown,
  options: NormalizeBrandOptions = {},
): NormalizeBrandResult {
  const normalized = normalizeString(rawValue);
  if (!normalized) {
    return {
      value: null,
      rawNormalized: null,
      unknownMapped: false,
      compositeTail: null,
    };
  }

  const aliasKey = normalized.toLocaleLowerCase("ru-RU");
  const canonicalAlias = CANONICAL_BRAND_ALIASES.get(aliasKey);
  if (canonicalAlias) {
    return {
      value: canonicalAlias,
      rawNormalized: normalized,
      unknownMapped: false,
      compositeTail: null,
    };
  }

  if (options.tenantId === "sovcombank") {
    const sovcomAlias = SOVCOMBANK_BRAND_ALIASES.get(normalizeLookupValue(normalized));
    if (sovcomAlias) {
      return {
        value: sovcomAlias,
        rawNormalized: normalized,
        unknownMapped: false,
        compositeTail: null,
      };
    }

    const normalizedLookup = normalizeLookupValue(normalized);
    const hintCandidates = collectSovcombankBrandHints(options.canonicalBrandHints);
    const matchedCandidate = hintCandidates.find(
      (candidate) =>
        normalizedLookup === candidate.normalized ||
        normalizedLookup.startsWith(`${candidate.normalized} `),
    );

    if (matchedCandidate) {
      const tailCandidate = normalizedLookup.slice(matchedCandidate.normalized.length).trim();
      return {
        value: matchedCandidate.canonical,
        rawNormalized: normalized,
        unknownMapped: false,
        compositeTail: tailCandidate || null,
      };
    }

    const fallbackValue = toTitleCase(normalized);
    const maybeComposite = normalizedLookup.includes(" ");
    return {
      value: fallbackValue,
      rawNormalized: normalized,
      unknownMapped: maybeComposite,
      compositeTail: null,
    };
  }

  return {
    value: toTitleCase(normalized),
    rawNormalized: normalized,
    unknownMapped: false,
    compositeTail: null,
  };
}

import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCatalogSummary,
  getCatalogFilters,
  getCatalogItems,
  logActivityEvent,
  getMediaPreviewImageUrl,
} from "../api/client";
import type {
  CatalogFiltersResponse,
  CatalogItem,
  CatalogItemsResponse,
} from "../types/api";

interface ShowcasePageProps {
  publicMode?: boolean;
}

type BookingPreset = "Свободен" | "Забронирован" | "На согласовании";

const BOOKING_PRESETS: BookingPreset[] = [
  "Свободен",
  "Забронирован",
  "На согласовании",
];

type ViewMode = "grid" | "list";
type SortDirection = "asc" | "desc";

interface ShowcaseUiState {
  bookingPreset: "" | BookingPreset;
  city: string;
  selectedVehicleTypes: string[];
  brand: string;
  model: string;
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  mileageMin: string;
  mileageMax: string;
  sortBy: string;
  sortDir: SortDirection;
  dateSortDir: SortDirection;
  priceSortDir: SortDirection;
  newThisWeekOnly: boolean;
  viewMode: ViewMode;
  page: number;
}

interface FilterTrackingSnapshot {
  bookingPreset: string | null;
  city: string | null;
  vehicleTypes: string[];
  brand: string | null;
  model: string | null;
  priceMin: number | null;
  priceMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  mileageMin: number | null;
  mileageMax: number | null;
  newThisWeekOnly: boolean;
  sortBy: string;
  sortDir: string;
}

const SHOWCASE_UI_STATE_KEY = "showcase_ui_state_v1";
const SHOWCASE_RETURN_FLAG_KEY = "showcase_return_pending_v1";
const SHOWCASE_SCROLL_Y_KEY = "showcase_scroll_y_v1";
const SHOWCASE_PAGE_SIZE = 20;
const SHOWCASE_DEFAULT_SORT_BY = "created_at";
const SHOWCASE_DEFAULT_SORT_DIR: SortDirection = "desc";
const SHOWCASE_DEFAULT_DATE_SORT_DIR: SortDirection = "desc";
const SHOWCASE_DEFAULT_PRICE_SORT_DIR: SortDirection = "asc";
const SHOWCASE_DEFAULT_VIEW_MODE: ViewMode = "grid";
const SHOWCASE_ALLOWED_SORT_BY = new Set([
  "created_at",
  "price",
  "year",
  "mileage_km",
  "days_on_sale",
]);
const SHOWCASE_URL_FILTER_KEYS = new Set([
  "bookingStatus",
  "city",
  "vehicleType",
  "brand",
  "model",
  "priceMin",
  "priceMax",
  "yearMin",
  "yearMax",
  "mileageMin",
  "mileageMax",
  "sortBy",
  "sortDir",
  "page",
  "newThisWeek",
  "view",
]);

function createDefaultShowcaseUiState(): ShowcaseUiState {
  return {
    bookingPreset: "",
    city: "",
    selectedVehicleTypes: [],
    brand: "",
    model: "",
    priceMin: "",
    priceMax: "",
    yearMin: "",
    yearMax: "",
    mileageMin: "",
    mileageMax: "",
    sortBy: SHOWCASE_DEFAULT_SORT_BY,
    sortDir: SHOWCASE_DEFAULT_SORT_DIR,
    dateSortDir: SHOWCASE_DEFAULT_DATE_SORT_DIR,
    priceSortDir: SHOWCASE_DEFAULT_PRICE_SORT_DIR,
    newThisWeekOnly: false,
    viewMode: SHOWCASE_DEFAULT_VIEW_MODE,
    page: 1,
  };
}

function isBookingPreset(value: string): value is BookingPreset {
  return BOOKING_PRESETS.includes(value as BookingPreset);
}

function parseBooleanFlag(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function parsePositivePage(value: string | null): number {
  if (!value) {
    return 1;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return 1;
  }
  return parsed;
}

function parseSortDirection(value: string | null, fallback: SortDirection): SortDirection {
  if (value === "asc" || value === "desc") {
    return value;
  }
  return fallback;
}

function parseVehicleTypeParams(params: URLSearchParams): string[] {
  const values = params.getAll("vehicleType");
  if (values.length === 0) {
    return [];
  }

  const expanded = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(expanded));
}

function hasKnownShowcaseQueryParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (SHOWCASE_URL_FILTER_KEYS.has(key)) {
      return true;
    }
  }
  return false;
}

function parseShowcaseUiStateFromSearchParams(params: URLSearchParams): ShowcaseUiState {
  const defaults = createDefaultShowcaseUiState();
  const sortByRaw = params.get("sortBy");
  const sortBy = sortByRaw && SHOWCASE_ALLOWED_SORT_BY.has(sortByRaw) ? sortByRaw : defaults.sortBy;
  const sortDir = parseSortDirection(params.get("sortDir"), defaults.sortDir);

  const dateSortDir =
    sortBy === "created_at" ? sortDir : SHOWCASE_DEFAULT_DATE_SORT_DIR;
  const priceSortDir =
    sortBy === "price" ? sortDir : SHOWCASE_DEFAULT_PRICE_SORT_DIR;

  const viewRaw = params.get("view");
  const viewMode: ViewMode = viewRaw === "list" ? "list" : SHOWCASE_DEFAULT_VIEW_MODE;

  const bookingStatusRaw = (params.get("bookingStatus") ?? "").trim();
  const bookingPreset: "" | BookingPreset = isBookingPreset(bookingStatusRaw)
    ? bookingStatusRaw
    : "";

  return {
    bookingPreset,
    city: (params.get("city") ?? "").trim(),
    selectedVehicleTypes: parseVehicleTypeParams(params),
    brand: (params.get("brand") ?? "").trim(),
    model: (params.get("model") ?? "").trim(),
    priceMin: normalizeIntegerInput(params.get("priceMin") ?? ""),
    priceMax: normalizeIntegerInput(params.get("priceMax") ?? ""),
    yearMin: normalizeIntegerInput(params.get("yearMin") ?? ""),
    yearMax: normalizeIntegerInput(params.get("yearMax") ?? ""),
    mileageMin: normalizeIntegerInput(params.get("mileageMin") ?? ""),
    mileageMax: normalizeIntegerInput(params.get("mileageMax") ?? ""),
    sortBy,
    sortDir,
    dateSortDir,
    priceSortDir,
    newThisWeekOnly: parseBooleanFlag(params.get("newThisWeek")),
    viewMode,
    page: parsePositivePage(params.get("page")),
  };
}

function sanitizeRestoredShowcaseUiState(restored: Partial<ShowcaseUiState>): ShowcaseUiState {
  const defaults = createDefaultShowcaseUiState();
  const sortBy =
    typeof restored.sortBy === "string" && SHOWCASE_ALLOWED_SORT_BY.has(restored.sortBy)
      ? restored.sortBy
      : defaults.sortBy;
  const sortDir = parseSortDirection(restored.sortDir ?? null, defaults.sortDir);
  const dateSortDir =
    sortBy === "created_at" ? sortDir : SHOWCASE_DEFAULT_DATE_SORT_DIR;
  const priceSortDir =
    sortBy === "price" ? sortDir : SHOWCASE_DEFAULT_PRICE_SORT_DIR;

  return {
    bookingPreset:
      typeof restored.bookingPreset === "string" && isBookingPreset(restored.bookingPreset)
        ? restored.bookingPreset
        : "",
    city: typeof restored.city === "string" ? restored.city : "",
    selectedVehicleTypes: Array.isArray(restored.selectedVehicleTypes)
      ? restored.selectedVehicleTypes.filter((value) => typeof value === "string" && value.trim())
      : [],
    brand: typeof restored.brand === "string" ? restored.brand : "",
    model: typeof restored.model === "string" ? restored.model : "",
    priceMin: typeof restored.priceMin === "string" ? normalizeIntegerInput(restored.priceMin) : "",
    priceMax: typeof restored.priceMax === "string" ? normalizeIntegerInput(restored.priceMax) : "",
    yearMin: typeof restored.yearMin === "string" ? normalizeIntegerInput(restored.yearMin) : "",
    yearMax: typeof restored.yearMax === "string" ? normalizeIntegerInput(restored.yearMax) : "",
    mileageMin:
      typeof restored.mileageMin === "string" ? normalizeIntegerInput(restored.mileageMin) : "",
    mileageMax:
      typeof restored.mileageMax === "string" ? normalizeIntegerInput(restored.mileageMax) : "",
    sortBy,
    sortDir,
    dateSortDir,
    priceSortDir,
    newThisWeekOnly: Boolean(restored.newThisWeekOnly),
    viewMode: restored.viewMode === "list" ? "list" : SHOWCASE_DEFAULT_VIEW_MODE,
    page:
      Number.isInteger(restored.page) && (restored.page ?? 0) > 0 ? (restored.page as number) : 1,
  };
}

function buildShowcaseFilterSearchParams(state: ShowcaseUiState): URLSearchParams {
  const params = new URLSearchParams();

  if (state.bookingPreset) {
    params.set("bookingStatus", state.bookingPreset);
  }
  if (state.city) {
    params.set("city", state.city);
  }
  state.selectedVehicleTypes.forEach((value) => params.append("vehicleType", value));
  if (state.brand) {
    params.set("brand", state.brand);
  }
  if (state.model) {
    params.set("model", state.model);
  }
  if (state.priceMin) {
    params.set("priceMin", state.priceMin);
  }
  if (state.priceMax) {
    params.set("priceMax", state.priceMax);
  }
  if (state.yearMin) {
    params.set("yearMin", state.yearMin);
  }
  if (state.yearMax) {
    params.set("yearMax", state.yearMax);
  }
  if (state.mileageMin) {
    params.set("mileageMin", state.mileageMin);
  }
  if (state.mileageMax) {
    params.set("mileageMax", state.mileageMax);
  }
  if (state.sortBy !== SHOWCASE_DEFAULT_SORT_BY) {
    params.set("sortBy", state.sortBy);
  }
  if (
    state.sortDir !== SHOWCASE_DEFAULT_SORT_DIR ||
    state.sortBy !== SHOWCASE_DEFAULT_SORT_BY
  ) {
    params.set("sortDir", state.sortDir);
  }
  if (state.page > 1) {
    params.set("page", String(state.page));
  }
  if (state.newThisWeekOnly) {
    params.set("newThisWeek", "true");
  }
  if (state.viewMode !== SHOWCASE_DEFAULT_VIEW_MODE) {
    params.set("view", state.viewMode);
  }

  return params;
}

function mergeShowcaseSearchParams(
  current: URLSearchParams,
  showcaseFilters: URLSearchParams,
): URLSearchParams {
  const merged = new URLSearchParams();

  current.forEach((value, key) => {
    if (!SHOWCASE_URL_FILTER_KEYS.has(key)) {
      merged.append(key, value);
    }
  });

  showcaseFilters.forEach((value, key) => {
    merged.append(key, value);
  });

  return merged;
}

function readShowcaseUiState(): Partial<ShowcaseUiState> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(SHOWCASE_UI_STATE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Partial<ShowcaseUiState>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

function writeShowcaseUiState(state: ShowcaseUiState): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(SHOWCASE_UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function formatPrice(price: number | null): string {
  if (price === null) {
    return "—";
  }
  return `${price.toLocaleString("ru-RU")} ?`;
}

function extractMediaUrls(rawValue: string): string[] {
  if (!rawValue.trim()) {
    return [];
  }

  const matches = rawValue.match(/https?:\/\/\S+/gi) ?? [];
  const cleaned = matches
    .map((item) => item.replace(/[),.;]+$/g, "").trim())
    .filter(Boolean);

  return [...new Set(cleaned)];
}

function extractBracketDetails(value: string): string | null {
  if (!value.trim()) {
    return null;
  }

  const matches = [...value.matchAll(/\(([^()]+)\)/g)];
  if (!matches.length) {
    return null;
  }

  const detail = matches[matches.length - 1]?.[1]?.trim() ?? "";
  return detail || null;
}

function buildCardSubtitle(item: CatalogItem): string {
  const titleDetails = extractBracketDetails(item.title);
  const modificationDetails = extractBracketDetails(item.modification);
  const fallback = item.modification || item.vehicleType;
  const rawDetails = titleDetails || modificationDetails || fallback;
  const cleanedDetails = rawDetails
    .replace(/\s+/g, " ")
    .replace(/^\W+|\W+$/g, "")
    .trim();

  const yearPart = item.year !== null ? `${item.year} г` : "";
  return yearPart ? `${yearPart}, ${cleanedDetails}` : cleanedDetails;
}

function normalizeIntegerInput(raw: string): string {
  const digitsOnly = raw.replace(/[^\d]/g, "");
  if (!digitsOnly) {
    return "";
  }

  return digitsOnly.replace(/^0+(?=\d)/, "");
}

function formatIntegerWithSpaces(value: string): string {
  if (!value) {
    return "";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return parsed.toLocaleString("ru-RU");
}

function sortUniqueValues(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) =>
    left.localeCompare(right, "ru", { sensitivity: "base" }),
  );
}

function toNullableNumber(value: string): number | null {
  return value ? Number(value) : null;
}

function createFilterTrackingSnapshot(input: {
  bookingPreset: string;
  city: string;
  selectedVehicleTypes: string[];
  brand: string;
  model: string;
  priceMin: string;
  priceMax: string;
  yearMin: string;
  yearMax: string;
  mileageMin: string;
  mileageMax: string;
  newThisWeekOnly: boolean;
  sortBy: string;
  sortDir: string;
}): FilterTrackingSnapshot {
  return {
    bookingPreset: input.bookingPreset || null,
    city: input.city || null,
    vehicleTypes: [...input.selectedVehicleTypes],
    brand: input.brand || null,
    model: input.model || null,
    priceMin: toNullableNumber(input.priceMin),
    priceMax: toNullableNumber(input.priceMax),
    yearMin: toNullableNumber(input.yearMin),
    yearMax: toNullableNumber(input.yearMax),
    mileageMin: toNullableNumber(input.mileageMin),
    mileageMax: toNullableNumber(input.mileageMax),
    newThisWeekOnly: input.newThisWeekOnly,
    sortBy: input.sortBy,
    sortDir: input.sortDir,
  };
}

export function ShowcasePage({ publicMode = false }: ShowcasePageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const pageSize = SHOWCASE_PAGE_SIZE;
  const restoredState = useMemo(readShowcaseUiState, []);
  const hasKnownUrlParams = useMemo(
    () => hasKnownShowcaseQueryParams(searchParams),
    [searchParams],
  );
  const initialState = useMemo(() => {
    if (hasKnownUrlParams) {
      return parseShowcaseUiStateFromSearchParams(searchParams);
    }

    return sanitizeRestoredShowcaseUiState(restoredState);
  }, [hasKnownUrlParams, restoredState, searchParams]);

  const hasRestoredScrollRef = useRef(false);
  const restoreAttemptsRef = useRef(0);
  const restoreTimeoutRef = useRef<number | null>(null);
  const hasLoggedShowcaseOpenRef = useRef(false);
  const hasLoggedInitialFiltersRef = useRef(false);
  const hasLoggedInitialPageRef = useRef(false);
  const lastNoResultsSignatureRef = useRef("");
  const previousFilterSnapshotRef = useRef<FilterTrackingSnapshot | null>(null);
  const skipNextUrlToStateSyncRef = useRef(false);
  const lastKnownUrlFilterPresenceRef = useRef(hasKnownUrlParams);
  const hasInitializedUrlSyncRef = useRef(false);

  const [filters, setFilters] = useState<CatalogFiltersResponse | null>(null);
  const [itemsResponse, setItemsResponse] = useState<CatalogItemsResponse | null>(
    null,
  );
  const [bookingPreset, setBookingPreset] = useState<"" | BookingPreset>(initialState.bookingPreset);
  const [city, setCity] = useState(initialState.city);
  const [selectedVehicleTypes, setSelectedVehicleTypes] = useState<string[]>(
    initialState.selectedVehicleTypes,
  );
  const [brand, setBrand] = useState(initialState.brand);
  const [model, setModel] = useState(initialState.model);
  const [priceMin, setPriceMin] = useState(initialState.priceMin);
  const [priceMax, setPriceMax] = useState(initialState.priceMax);
  const [yearMin, setYearMin] = useState(initialState.yearMin);
  const [yearMax, setYearMax] = useState(initialState.yearMax);
  const [mileageMin, setMileageMin] = useState(initialState.mileageMin);
  const [mileageMax, setMileageMax] = useState(initialState.mileageMax);
  const [newThisWeekOnly, setNewThisWeekOnly] = useState(initialState.newThisWeekOnly);
  const [sortBy, setSortBy] = useState(initialState.sortBy);
  const [sortDir, setSortDir] = useState(initialState.sortDir);
  const [dateSortDir, setDateSortDir] = useState<SortDirection>(initialState.dateSortDir);
  const [priceSortDir, setPriceSortDir] = useState<SortDirection>(initialState.priceSortDir);
  const [viewMode, setViewMode] = useState<ViewMode>(initialState.viewMode);
  const [page, setPage] = useState(initialState.page);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [newThisWeekCount, setNewThisWeekCount] = useState(0);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") {
        return;
      }

      if (restoreTimeoutRef.current !== null) {
        window.clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncViewportState = () => {
      setIsMobileViewport(window.innerWidth <= 760);
    };

    syncViewportState();
    window.addEventListener("resize", syncViewportState);

    return () => {
      window.removeEventListener("resize", syncViewportState);
    };
  }, []);

  useEffect(() => {
    if (!isMobileViewport && isMobileFiltersOpen) {
      closeMobileFilters("viewport_change");
    }
  }, [isMobileFiltersOpen, isMobileViewport]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    if (isMobileViewport && isMobileFiltersOpen) {
      document.body.classList.add("showcase-mobile-lock");
      return () => {
        document.body.classList.remove("showcase-mobile-lock");
      };
    }

    document.body.classList.remove("showcase-mobile-lock");
  }, [isMobileFiltersOpen, isMobileViewport]);

  useEffect(() => {
    if (!isMobileViewport || !isMobileFiltersOpen || typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileFilters("escape_key");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileFiltersOpen, isMobileViewport]);

  useEffect(() => {
    async function loadFilters() {
      try {
        const data = await getCatalogFilters();
        setFilters(data);
      } catch (caughtError) {
        setError("Не удалось загрузить фильтры");
        void logActivityEvent({
          eventType: "api_error",
          page: "/showcase",
          payload: {
            endpoint: "/catalog/filters",
            message:
              caughtError instanceof Error ? caughtError.message : "unknown_error",
          },
        });
      }
    }

    void loadFilters();
  }, []);

  useEffect(() => {
    async function loadCatalogSummary() {
      try {
        const summary = await getCatalogSummary();
        setNewThisWeekCount(summary.newThisWeekCount);
      } catch (caughtError) {
        void logActivityEvent({
          eventType: "api_error",
          page: "/showcase",
          payload: {
            endpoint: "/catalog/summary",
            message:
              caughtError instanceof Error ? caughtError.message : "unknown_error",
          },
        });
      }
    }

    void loadCatalogSummary();
  }, []);

  useEffect(() => {
    if (hasLoggedShowcaseOpenRef.current) {
      return;
    }

    hasLoggedShowcaseOpenRef.current = true;
    void logActivityEvent({
      eventType: "showcase_open",
      page: "/showcase",
    });
  }, []);

  const query = useMemo(() => {
    const queryObject: Record<string, string | number | string[]> = {
      page,
      pageSize,
      sortBy,
      sortDir,
    };

    if (bookingPreset) {
      queryObject.bookingStatus = bookingPreset;
    }
    if (city) {
      queryObject.city = city;
    }
    if (selectedVehicleTypes.length > 0) {
      queryObject.vehicleType = selectedVehicleTypes;
    }
    if (brand) {
      queryObject.brand = brand;
    }
    if (model) {
      queryObject.model = model;
    }
    if (priceMin !== "") {
      queryObject.priceMin = Number(priceMin);
    }
    if (priceMax !== "") {
      queryObject.priceMax = Number(priceMax);
    }
    if (yearMin !== "") {
      queryObject.yearMin = Number(yearMin);
    }
    if (yearMax !== "") {
      queryObject.yearMax = Number(yearMax);
    }
    if (mileageMin !== "") {
      queryObject.mileageMin = Number(mileageMin);
    }
    if (mileageMax !== "") {
      queryObject.mileageMax = Number(mileageMax);
    }
    if (newThisWeekOnly) {
      queryObject.newThisWeek = "true";
    }

    return queryObject;
  }, [
    bookingPreset,
    brand,
    city,
    priceMax,
    priceMin,
    mileageMax,
    mileageMin,
    model,
    newThisWeekOnly,
    page,
    selectedVehicleTypes,
    sortBy,
    sortDir,
    yearMax,
    yearMin,
  ]);

  const showcaseUiState = useMemo<ShowcaseUiState>(
    () => ({
      bookingPreset,
      city,
      selectedVehicleTypes,
      brand,
      model,
      priceMin,
      priceMax,
      yearMin,
      yearMax,
      mileageMin,
      mileageMax,
      newThisWeekOnly,
      sortBy,
      sortDir,
      dateSortDir,
      priceSortDir,
      viewMode,
      page,
    }),
    [
      bookingPreset,
      city,
      selectedVehicleTypes,
      brand,
      model,
      priceMin,
      priceMax,
      yearMin,
      yearMax,
      mileageMin,
      mileageMax,
      newThisWeekOnly,
      sortBy,
      sortDir,
      dateSortDir,
      priceSortDir,
      viewMode,
      page,
    ],
  );

  useEffect(() => {
    if (!hasInitializedUrlSyncRef.current) {
      hasInitializedUrlSyncRef.current = true;
      if (!hasKnownShowcaseQueryParams(searchParams)) {
        return;
      }
    }

    const currentSearchParams = new URLSearchParams(searchParams);
    const nextFilterParams = buildShowcaseFilterSearchParams(showcaseUiState);
    const nextSearchParams = mergeShowcaseSearchParams(
      currentSearchParams,
      nextFilterParams,
    );

    if (nextSearchParams.toString() === currentSearchParams.toString()) {
      return;
    }

    skipNextUrlToStateSyncRef.current = true;
    setSearchParams(nextSearchParams, { replace: true });
  }, [searchParams, setSearchParams, showcaseUiState]);

  useEffect(() => {
    const hasKnownParams = hasKnownShowcaseQueryParams(searchParams);

    if (skipNextUrlToStateSyncRef.current) {
      skipNextUrlToStateSyncRef.current = false;
      lastKnownUrlFilterPresenceRef.current = hasKnownParams;
      return;
    }

    if (!hasKnownParams && !lastKnownUrlFilterPresenceRef.current) {
      return;
    }

    lastKnownUrlFilterPresenceRef.current = hasKnownParams;

    const parsedState = hasKnownParams
      ? parseShowcaseUiStateFromSearchParams(searchParams)
      : createDefaultShowcaseUiState();

    if (
      showcaseUiState.bookingPreset === parsedState.bookingPreset &&
      showcaseUiState.city === parsedState.city &&
      JSON.stringify(showcaseUiState.selectedVehicleTypes) ===
        JSON.stringify(parsedState.selectedVehicleTypes) &&
      showcaseUiState.brand === parsedState.brand &&
      showcaseUiState.model === parsedState.model &&
      showcaseUiState.priceMin === parsedState.priceMin &&
      showcaseUiState.priceMax === parsedState.priceMax &&
      showcaseUiState.yearMin === parsedState.yearMin &&
      showcaseUiState.yearMax === parsedState.yearMax &&
      showcaseUiState.mileageMin === parsedState.mileageMin &&
      showcaseUiState.mileageMax === parsedState.mileageMax &&
      showcaseUiState.newThisWeekOnly === parsedState.newThisWeekOnly &&
      showcaseUiState.sortBy === parsedState.sortBy &&
      showcaseUiState.sortDir === parsedState.sortDir &&
      showcaseUiState.dateSortDir === parsedState.dateSortDir &&
      showcaseUiState.priceSortDir === parsedState.priceSortDir &&
      showcaseUiState.viewMode === parsedState.viewMode &&
      showcaseUiState.page === parsedState.page
    ) {
      return;
    }

    setBookingPreset(parsedState.bookingPreset);
    setCity(parsedState.city);
    setSelectedVehicleTypes(parsedState.selectedVehicleTypes);
    setBrand(parsedState.brand);
    setModel(parsedState.model);
    setPriceMin(parsedState.priceMin);
    setPriceMax(parsedState.priceMax);
    setYearMin(parsedState.yearMin);
    setYearMax(parsedState.yearMax);
    setMileageMin(parsedState.mileageMin);
    setMileageMax(parsedState.mileageMax);
    setNewThisWeekOnly(parsedState.newThisWeekOnly);
    setSortBy(parsedState.sortBy);
    setSortDir(parsedState.sortDir);
    setDateSortDir(parsedState.dateSortDir);
    setPriceSortDir(parsedState.priceSortDir);
    setViewMode(parsedState.viewMode);
    setPage(parsedState.page);
  }, [searchParams, showcaseUiState]);

  useEffect(() => {
    async function loadItems() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await getCatalogItems(query);
        setItemsResponse(response);
      } catch (caughtError) {
        setError("Не удалось загрузить витрину");
        void logActivityEvent({
          eventType: "api_error",
          page: "/showcase",
          payload: {
            endpoint: "/catalog/items",
            message:
              caughtError instanceof Error ? caughtError.message : "unknown_error",
          },
        });
      } finally {
        setIsLoading(false);
      }
    }

    void loadItems();
  }, [query]);

  useEffect(() => {
    writeShowcaseUiState(showcaseUiState);
  }, [showcaseUiState]);

  const items: CatalogItem[] = itemsResponse?.items ?? [];
  const total = itemsResponse?.pagination.total ?? 0;
  const hasImportedData = total > 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const vehicleTypeOptions = filters?.vehicleType ?? [];
  const effectiveViewMode: ViewMode = isMobileViewport ? "list" : viewMode;
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (bookingPreset) {
      count += 1;
    }
    if (city) {
      count += 1;
    }
    if (selectedVehicleTypes.length > 0) {
      count += 1;
    }
    if (brand) {
      count += 1;
    }
    if (model) {
      count += 1;
    }
    if (priceMin) {
      count += 1;
    }
    if (priceMax) {
      count += 1;
    }
    if (yearMin) {
      count += 1;
    }
    if (yearMax) {
      count += 1;
    }
    if (mileageMin) {
      count += 1;
    }
    if (mileageMax) {
      count += 1;
    }
    if (newThisWeekOnly) {
      count += 1;
    }
    return count;
  }, [
    bookingPreset,
    brand,
    city,
    mileageMax,
    mileageMin,
    model,
    newThisWeekOnly,
    priceMax,
    priceMin,
    selectedVehicleTypes,
    yearMax,
    yearMin,
  ]);

  useEffect(() => {
    const nextSnapshot = createFilterTrackingSnapshot({
      bookingPreset,
      city,
      selectedVehicleTypes,
      brand,
      model,
      priceMin,
      priceMax,
      yearMin,
      yearMax,
      mileageMin,
      mileageMax,
      newThisWeekOnly,
      sortBy,
      sortDir,
    });

    if (!hasLoggedInitialFiltersRef.current) {
      hasLoggedInitialFiltersRef.current = true;
      previousFilterSnapshotRef.current = nextSnapshot;
      return;
    }

    const previousSnapshot = previousFilterSnapshotRef.current;
    if (!previousSnapshot) {
      previousFilterSnapshotRef.current = nextSnapshot;
      return;
    }

    const changedFields = (
      Object.keys(nextSnapshot) as Array<keyof FilterTrackingSnapshot>
    ).filter(
      (key) =>
        JSON.stringify(previousSnapshot[key]) !== JSON.stringify(nextSnapshot[key]),
    );

    if (changedFields.length === 0) {
      return;
    }

    const previousValues = changedFields.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = previousSnapshot[key];
      return acc;
    }, {});

    const nextValues = changedFields.reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = nextSnapshot[key];
      return acc;
    }, {});

    const timeoutId = window.setTimeout(() => {
      previousFilterSnapshotRef.current = nextSnapshot;
      void logActivityEvent({
        eventType: "showcase_filters_apply",
        page: "/showcase",
        payload: {
          changedFields,
          previousValues,
          nextValues,
        },
      });
    }, 600);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    bookingPreset,
    brand,
    city,
    mileageMax,
    mileageMin,
    model,
    newThisWeekOnly,
    priceMax,
    priceMin,
    selectedVehicleTypes,
    sortBy,
    sortDir,
    yearMax,
    yearMin,
  ]);

  useEffect(() => {
    if (!hasLoggedInitialPageRef.current) {
      hasLoggedInitialPageRef.current = true;
      return;
    }

    void logActivityEvent({
      eventType: "showcase_page_change",
      page: "/showcase",
      payload: {
        page,
        totalPages,
      },
    });
  }, [page, totalPages]);

  useEffect(() => {
    if (isLoading || !itemsResponse) {
      return;
    }

    if (itemsResponse.items.length > 0) {
      return;
    }

    if (activeFiltersCount === 0) {
      return;
    }

    const signature = JSON.stringify(query);
    if (lastNoResultsSignatureRef.current === signature) {
      return;
    }

    lastNoResultsSignatureRef.current = signature;
    void logActivityEvent({
      eventType: "showcase_no_results",
      page: "/showcase",
      payload: {
        activeFiltersCount,
        query,
      },
    });
  }, [activeFiltersCount, isLoading, itemsResponse, query]);

  useEffect(() => {
    if (hasRestoredScrollRef.current || isLoading || !itemsResponse) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    if (restoreTimeoutRef.current !== null) {
      return;
    }

    const returnPending = window.sessionStorage.getItem(SHOWCASE_RETURN_FLAG_KEY);
    if (returnPending !== "1") {
      return;
    }

    const rawScrollY = window.sessionStorage.getItem(SHOWCASE_SCROLL_Y_KEY);
    const scrollY = Number(rawScrollY);
    const targetY = Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;

    const maxAttempts = 40;

    const restoreScrollPosition = () => {
      window.scrollTo({ top: targetY, behavior: "auto" });

      const reachedTarget = Math.abs(window.scrollY - targetY) <= 2;
      if (reachedTarget || restoreAttemptsRef.current >= maxAttempts) {
        hasRestoredScrollRef.current = true;
        restoreAttemptsRef.current = 0;
        window.sessionStorage.removeItem(SHOWCASE_RETURN_FLAG_KEY);
        restoreTimeoutRef.current = null;
        return;
      }

      restoreAttemptsRef.current += 1;
      restoreTimeoutRef.current = window.setTimeout(restoreScrollPosition, 120);
    };

    window.requestAnimationFrame(restoreScrollPosition);

    return () => {
      if (restoreTimeoutRef.current !== null) {
        window.clearTimeout(restoreTimeoutRef.current);
        restoreTimeoutRef.current = null;
      }
    };
  }, [isLoading, itemsResponse, items.length]);

  useEffect(() => {
    if (vehicleTypeOptions.length === 0) {
      return;
    }

    setSelectedVehicleTypes((current) =>
      current.filter((value) => vehicleTypeOptions.includes(value)),
    );
  }, [vehicleTypeOptions]);

  const availableBrands = useMemo(() => {
    if (!filters) {
      return [];
    }

    if (selectedVehicleTypes.length === 0) {
      return filters.brand;
    }

    const brandsByVehicleType = filters.brandsByVehicleType ?? {};
    const modelsByBrandAndVehicleType = filters.modelsByBrandAndVehicleType ?? {};
    const hasVehicleTypeMetadata =
      Object.keys(brandsByVehicleType).length > 0 ||
      Object.keys(modelsByBrandAndVehicleType).length > 0;

    if (!hasVehicleTypeMetadata) {
      return filters.brand;
    }

    const selectedVehicleTypeKeys = new Set(
      selectedVehicleTypes.map((value) => value.trim().toLowerCase()),
    );
    const union = new Set<string>();

    Object.entries(brandsByVehicleType).forEach(([vehicleType, brands]) => {
      if (!selectedVehicleTypeKeys.has(vehicleType.trim().toLowerCase())) {
        return;
      }

      brands.forEach((value) => {
        union.add(value);
      });
    });

    if (union.size === 0) {
      Object.entries(modelsByBrandAndVehicleType).forEach(
        ([vehicleType, modelsByBrand]) => {
          if (!selectedVehicleTypeKeys.has(vehicleType.trim().toLowerCase())) {
            return;
          }

          Object.keys(modelsByBrand).forEach((value) => {
            union.add(value);
          });
        },
      );
    }

    return sortUniqueValues(union);
  }, [filters, selectedVehicleTypes]);

  const availableModels = useMemo(() => {
    if (!filters || !brand) {
      return [];
    }

    if (selectedVehicleTypes.length === 0) {
      return filters.modelsByBrand?.[brand] ?? [];
    }

    const modelsByBrandAndVehicleType = filters.modelsByBrandAndVehicleType ?? {};
    const hasVehicleTypeMetadata = Object.keys(modelsByBrandAndVehicleType).length > 0;

    if (!hasVehicleTypeMetadata) {
      return filters.modelsByBrand?.[brand] ?? [];
    }

    const selectedVehicleTypeKeys = new Set(
      selectedVehicleTypes.map((value) => value.trim().toLowerCase()),
    );
    const union = new Set<string>();

    Object.entries(modelsByBrandAndVehicleType).forEach(
      ([vehicleType, modelsByBrand]) => {
        if (!selectedVehicleTypeKeys.has(vehicleType.trim().toLowerCase())) {
          return;
        }

        (modelsByBrand[brand] ?? []).forEach((value) => {
          union.add(value);
        });
      },
    );

    return sortUniqueValues(union);
  }, [brand, filters, selectedVehicleTypes]);

  useEffect(() => {
    if (!brand) {
      return;
    }

    if (!availableBrands.includes(brand)) {
      setBrand("");
      setModel("");
      setPage(1);
    }
  }, [availableBrands, brand]);

  useEffect(() => {
    if (!model) {
      return;
    }

    if (!availableModels.includes(model)) {
      setModel("");
      setPage(1);
    }
  }, [availableModels, model]);

  const yearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return Array.from({ length: 16 }, (_, index) => String(currentYear - index));
  }, []);

  const visiblePages = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    const pages: Array<number | "ellipsis"> = [1];
    const left = Math.max(2, page - 1);
    const right = Math.min(totalPages - 1, page + 1);

    if (left > 2) {
      pages.push("ellipsis");
    }

    for (let pageNumber = left; pageNumber <= right; pageNumber += 1) {
      pages.push(pageNumber);
    }

    if (right < totalPages - 1) {
      pages.push("ellipsis");
    }

    pages.push(totalPages);
    return pages;
  }, [page, totalPages]);

  function openMobileFilters(source: string): void {
    if (isMobileFiltersOpen) {
      return;
    }

    void logActivityEvent({
      eventType: "showcase_filter_drawer_open",
      page: "/showcase",
      payload: {
        source,
        isMobileViewport,
      },
    });
    setIsMobileFiltersOpen(true);
  }

  function closeMobileFilters(source: string): void {
    if (!isMobileFiltersOpen) {
      return;
    }

    void logActivityEvent({
      eventType: "showcase_filter_drawer_close",
      page: "/showcase",
      payload: {
        source,
        isMobileViewport,
      },
    });
    setIsMobileFiltersOpen(false);
  }

  function setPageFromPagination(targetPage: number, control: "prev" | "next" | "number"): void {
    if (targetPage < 1 || targetPage > totalPages || targetPage === page) {
      return;
    }

    void logActivityEvent({
      eventType: "showcase_pagination_click",
      page: "/showcase",
      payload: {
        control,
        fromPage: page,
        toPage: targetPage,
        totalPages,
      },
    });
    setPage(targetPage);
  }

  function applyViewModeSelection(nextViewMode: ViewMode): void {
    if (viewMode === nextViewMode) {
      return;
    }

    void logActivityEvent({
      eventType: "showcase_view_mode_change",
      page: "/showcase",
      payload: {
        from: viewMode,
        to: nextViewMode,
      },
    });
    setViewMode(nextViewMode);
  }

  function applyDateSortSelection(value: "asc" | "desc"): void {
    if (sortBy === "created_at" && sortDir === value) {
      return;
    }

    void logActivityEvent({
      eventType: "showcase_sort_change",
      page: "/showcase",
      payload: {
        sortBy: "created_at",
        sortDir: value,
      },
    });
    setPage(1);
    setDateSortDir(value);
    setSortBy("created_at");
    setSortDir(value);
  }

  function applyPriceSortSelection(value: "asc" | "desc"): void {
    if (sortBy === "price" && sortDir === value) {
      return;
    }

    void logActivityEvent({
      eventType: "showcase_sort_change",
      page: "/showcase",
      payload: {
        sortBy: "price",
        sortDir: value,
      },
    });
    setPage(1);
    setPriceSortDir(value);
    setSortBy("price");
    setSortDir(value);
  }

  function clearFilters(): void {
    void logActivityEvent({
      eventType: "showcase_filters_reset",
      page: "/showcase",
      payload: {
        activeFiltersCount,
      },
    });

    setBookingPreset("");
    setCity("");
    setSelectedVehicleTypes([]);
    setBrand("");
    setModel("");
    setPriceMin("");
    setPriceMax("");
    setYearMin("");
    setYearMax("");
    setMileageMin("");
    setMileageMax("");
    setNewThisWeekOnly(false);
    setPage(1);
  }

  function toggleNewThisWeekOnly(): void {
    setPage(1);
    setNewThisWeekOnly((current) => !current);
  }

  function toggleBookingPreset(nextPreset: BookingPreset): void {
    setPage(1);
    setBookingPreset((current) => (current === nextPreset ? "" : nextPreset));
  }

  function toggleVehicleType(value: string): void {
    setPage(1);
    setSelectedVehicleTypes((current) => {
      if (current.includes(value)) {
        return current.filter((item) => item !== value);
      }

      return [...current, value];
    });
  }

  function clearVehicleTypeSelection(): void {
    setPage(1);
    setSelectedVehicleTypes([]);
  }

  function getBookingPresetChipClassName(preset: BookingPreset): string {
    const baseClass = "chip chip--booking";
    const isActive = bookingPreset === preset;

    if (preset === "Свободен") {
      return `${baseClass} chip--booking-free${isActive ? " active" : ""}`;
    }

    if (preset === "Забронирован") {
      return `${baseClass} chip--booking-booked${isActive ? " active" : ""}`;
    }

    return `${baseClass} chip--booking-review${isActive ? " active" : ""}`;
  }

  function getVehicleTypeLabel(value: string): string {
    return value.toUpperCase();
  }

  return (
    <section className={publicMode ? "showcase-page showcase-page--public" : "showcase-page"}>
      {!publicMode && <h1>Витрина</h1>}
      {error && <p className="error">{error}</p>}

      <main className="showcase-main">
        <div className="showcase-mobile-filter-bar" data-nosnippet>
          <button
            type="button"
            className="showcase-mobile-filter-toggle"
            onClick={() => openMobileFilters("mobile_filter_button")}
            aria-expanded={isMobileFiltersOpen}
            aria-controls="showcase-filter-panel"
          >
            <span>Фильтры</span>
            {activeFiltersCount > 0 && (
              <span className="showcase-mobile-filter-count">{activeFiltersCount}</span>
            )}
          </button>
        </div>

        <div
          data-nosnippet
          className={
            isMobileFiltersOpen
              ? "showcase-filter-drawer showcase-filter-drawer--open"
              : "showcase-filter-drawer"
          }
        >
          <button
            type="button"
            className="showcase-filter-drawer__backdrop"
            aria-label="Закрыть фильтры"
            onClick={() => closeMobileFilters("backdrop")}
          />

          <div
            className="showcase-filter-panel"
            id="showcase-filter-panel"
            role={isMobileViewport ? "dialog" : undefined}
            aria-modal={isMobileViewport ? "true" : undefined}
            aria-label={isMobileViewport ? "Фильтры витрины" : undefined}
          >
            <div className="showcase-filter-mobile-header">
              <strong>Фильтры</strong>
              <button
                type="button"
                className="secondary-button showcase-filter-mobile-close"
                onClick={() => closeMobileFilters("close_button")}
              >
                Закрыть
              </button>
            </div>

            <div className="showcase-filter-group">
              <p className="showcase-filter-group-title">Статус техники</p>
              <div className="showcase-presets">
                {BOOKING_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={getBookingPresetChipClassName(preset)}
                    onClick={() => toggleBookingPreset(preset)}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="showcase-filter-grid showcase-filter-grid--type">
              <div className="vehicle-type-picker">
                <div className="vehicle-type-picker__row">
                  <div className="vehicle-type-picker__chips">
                    <button
                      type="button"
                      className={selectedVehicleTypes.length === 0 ? "vehicle-type-chip active" : "vehicle-type-chip"}
                      onClick={clearVehicleTypeSelection}
                    >
                      Все виды техники
                    </button>

                    {vehicleTypeOptions.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className={selectedVehicleTypes.includes(value) ? "vehicle-type-chip active" : "vehicle-type-chip"}
                        onClick={() => toggleVehicleType(value)}
                        title={value}
                      >
                        {getVehicleTypeLabel(value)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="secondary-button showcase-reset-button"
                    onClick={clearFilters}
                  >
                    Сбросить фильтры
                  </button>
                </div>
              </div>
            </div>

            <div className="showcase-filter-grid showcase-filter-grid--triple">
              <select
                className={`${city ? "showcase-filter is-active" : "showcase-filter"} showcase-filter--select`}
                value={city}
                onChange={(event) => {
                  setPage(1);
                  setCity(event.target.value);
                }}
              >
                <option value="">Регион</option>
                {(filters?.city ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>

              <select
                className={`${brand ? "showcase-filter is-active" : "showcase-filter"} showcase-filter--select`}
                value={brand}
                disabled={availableBrands.length === 0}
                onChange={(event) => {
                  setPage(1);
                  setBrand(event.target.value);
                }}
              >
                <option value="">
                  {availableBrands.length === 0 ? "Нет марок" : "Марка"}
                </option>
                {availableBrands.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>

              <select
                className={`${model ? "showcase-filter is-active" : "showcase-filter"} showcase-filter--select`}
                value={model}
                disabled={brand === "" || availableModels.length === 0}
                onChange={(event) => {
                  setPage(1);
                  setModel(event.target.value);
                }}
              >
                <option value="">
                  {brand === ""
                    ? "Сначала выберите марку"
                    : availableModels.length === 0
                      ? "Нет моделей"
                      : "Модель"}
                </option>
                {availableModels.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>

            <div className="showcase-filter-grid showcase-filter-grid--paired">
              <div className="showcase-filter-pair">
                <input
                  type="text"
                  inputMode="numeric"
                  className={priceMin ? "showcase-filter is-active" : "showcase-filter"}
                  placeholder="Цена от, ?"
                  value={formatIntegerWithSpaces(priceMin)}
                  onChange={(event) => {
                    setPage(1);
                    setPriceMin(normalizeIntegerInput(event.target.value));
                  }}
                />

                <input
                  type="text"
                  inputMode="numeric"
                  className={priceMax ? "showcase-filter is-active" : "showcase-filter"}
                  placeholder="Цена до, ?"
                  value={formatIntegerWithSpaces(priceMax)}
                  onChange={(event) => {
                    setPage(1);
                    setPriceMax(normalizeIntegerInput(event.target.value));
                  }}
                />
              </div>

              <div className="showcase-filter-pair">
                <select
                  className={`${yearMin ? "showcase-filter is-active" : "showcase-filter"} showcase-filter--select`}
                  value={yearMin}
                  onChange={(event) => {
                    setPage(1);
                    const nextYearMin = event.target.value;
                    setYearMin(nextYearMin);
                    if (nextYearMin && yearMax && Number(nextYearMin) > Number(yearMax)) {
                      setYearMax(nextYearMin);
                    }
                  }}
                >
                  <option value="">Год от</option>
                  {yearOptions.map((yearValue) => (
                    <option key={`year-min-${yearValue}`} value={yearValue}>
                      {yearValue}
                    </option>
                  ))}
                </select>

                <select
                  className={`${yearMax ? "showcase-filter is-active" : "showcase-filter"} showcase-filter--select`}
                  value={yearMax}
                  onChange={(event) => {
                    setPage(1);
                    const nextYearMax = event.target.value;
                    setYearMax(nextYearMax);
                    if (nextYearMax && yearMin && Number(nextYearMax) < Number(yearMin)) {
                      setYearMin(nextYearMax);
                    }
                  }}
                >
                  <option value="">Год до</option>
                  {yearOptions.map((yearValue) => (
                    <option key={`year-max-${yearValue}`} value={yearValue}>
                      {yearValue}
                    </option>
                  ))}
                </select>
              </div>

              <div className="showcase-filter-pair">
                <input
                  type="text"
                  inputMode="numeric"
                  className={mileageMin ? "showcase-filter is-active" : "showcase-filter"}
                  placeholder="Пробег от, км"
                  value={formatIntegerWithSpaces(mileageMin)}
                  onChange={(event) => {
                    setPage(1);
                    setMileageMin(normalizeIntegerInput(event.target.value));
                  }}
                />

                <input
                  type="text"
                  inputMode="numeric"
                  className={mileageMax ? "showcase-filter is-active" : "showcase-filter"}
                  placeholder="Пробег до, км"
                  value={formatIntegerWithSpaces(mileageMax)}
                  onChange={(event) => {
                    setPage(1);
                    setMileageMax(normalizeIntegerInput(event.target.value));
                  }}
                />
              </div>
            </div>

            <div className="showcase-filter-mobile-footer">
              <button
                type="button"
                className="secondary-button"
                onClick={clearFilters}
              >
                Сбросить все
              </button>
              <button
                type="button"
                onClick={() => closeMobileFilters("show_results_button")}
              >
                Показать {total.toLocaleString("ru-RU")}
              </button>
            </div>
          </div>
        </div>

        <div className="showcase-meta">
          <div className="showcase-meta-summary">
            <strong>Найдено {total.toLocaleString("ru-RU")} позиций</strong>
            {newThisWeekCount > 0 && (
              <button
                type="button"
                className={
                  newThisWeekOnly
                    ? "showcase-new-week-badge showcase-new-week-badge--active"
                    : "showcase-new-week-badge"
                }
                onClick={toggleNewThisWeekOnly}
                aria-pressed={newThisWeekOnly}
                title={
                  newThisWeekOnly
                    ? "Показаны только новые поступления за последнюю загрузку"
                    : "Показать только новые поступления за последнюю загрузку"
                }
              >
                +{newThisWeekCount.toLocaleString("ru-RU")} за неделю
              </button>
            )}
          </div>
          <div className="showcase-meta-controls" data-nosnippet>
            <div className="showcase-sort showcase-sort--split">
              <select
                className="showcase-filter showcase-filter--select showcase-sort-select"
                value={dateSortDir}
                onChange={(event) =>
                  applyDateSortSelection(event.target.value as "asc" | "desc")
                }
                aria-label="Сортировка по дате"
              >
                <option value="desc">Сначала новые</option>
                <option value="asc">Сначала старые</option>
              </select>
              <select
                className="showcase-filter showcase-filter--select showcase-sort-select"
                value={priceSortDir}
                onChange={(event) =>
                  applyPriceSortSelection(event.target.value as "asc" | "desc")
                }
                aria-label="Сортировка по цене"
              >
                <option value="asc">Сначала дешевле</option>
                <option value="desc">Сначала дороже</option>
              </select>
            </div>

            <div className="view-switch showcase-view-switch">
              <button
                type="button"
                className={effectiveViewMode === "grid" ? "active" : ""}
                onClick={() => applyViewModeSelection("grid")}
                aria-label="Сетка"
                title="Сетка"
              >
                <svg viewBox="0 0 20 20" role="presentation" focusable="false">
                  <rect x="2.5" y="2.5" width="6" height="6" rx="1.2" />
                  <rect x="11.5" y="2.5" width="6" height="6" rx="1.2" />
                  <rect x="2.5" y="11.5" width="6" height="6" rx="1.2" />
                  <rect x="11.5" y="11.5" width="6" height="6" rx="1.2" />
                </svg>
              </button>
              <button
                type="button"
                className={effectiveViewMode === "list" ? "active" : ""}
                onClick={() => applyViewModeSelection("list")}
                aria-label="По порядку"
                title="По порядку"
              >
                <svg viewBox="0 0 20 20" role="presentation" focusable="false">
                  <rect x="2.5" y="3" width="15" height="3" rx="1.2" />
                  <rect x="2.5" y="8.5" width="15" height="3" rx="1.2" />
                  <rect x="2.5" y="14" width="15" height="3" rx="1.2" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {isLoading && <p>Загрузка витрины...</p>}

        {!isLoading && !hasImportedData && (
          <p className="empty">Импортированных данных пока нет.</p>
        )}

        {!isLoading && hasImportedData && items.length === 0 && (
          <p className="empty">По текущим фильтрам ничего не найдено.</p>
        )}

        {!isLoading && items.length > 0 && (
          <>
            <div className={effectiveViewMode === "list" ? "cards-grid cards-grid--list" : "cards-grid"}>
              {items.map((item, index) => {
                const primaryMediaUrl = extractMediaUrls(item.yandexDiskUrl)[0];

                return (
                  <Link
                    key={item.id}
                    to={`/showcase/${item.id}`}
                    state={{ fromShowcase: true }}
                    className="vehicle-card vehicle-card-link"
                    style={{ animationDelay: `${Math.min(index, 11) * 40}ms` }}
                    onClick={() => {
                      if (typeof window === "undefined") {
                        return;
                      }
                      void logActivityEvent({
                        eventType: "showcase_item_open",
                        page: "/showcase",
                        entityType: "catalog_item",
                        entityId: String(item.id),
                        payload: {
                          brand: item.brand,
                          model: item.model,
                        },
                      });
                      window.sessionStorage.setItem(SHOWCASE_RETURN_FLAG_KEY, "1");
                      window.sessionStorage.setItem(SHOWCASE_SCROLL_Y_KEY, String(window.scrollY));
                    }}
                  >
                    <div className="vehicle-card__image">
                      {primaryMediaUrl ? (
                        <>
                          <img
                            src={getMediaPreviewImageUrl(primaryMediaUrl)}
                            alt={item.title || `${item.brand} ${item.model}`}
                            onError={(event) => {
                              const target = event.currentTarget;
                              target.style.display = "none";
                              const fallback = target.nextElementSibling;
                              if (fallback) {
                                (fallback as HTMLElement).style.display = "flex";
                              }
                            }}
                          />
                          <span className="vehicle-card__fallback">
                            <span className="vehicle-card__fallback-icon" aria-hidden>
                              <svg viewBox="0 0 24 24" focusable="false">
                                <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                                <circle cx="8.25" cy="10" r="1.5" />
                                <path d="M5.5 16l4.1-4.1a1.2 1.2 0 0 1 1.7 0l1.8 1.8a1.2 1.2 0 0 0 1.7 0l1.7-1.7a1.2 1.2 0 0 1 1.7 0L20.5 14.3" />
                              </svg>
                            </span>
                            <span className="vehicle-card__fallback-text">Нет фотографии</span>
                          </span>
                        </>
                      ) : (
                        <span className="vehicle-card__fallback vehicle-card__fallback--visible">
                          <span className="vehicle-card__fallback-icon" aria-hidden>
                            <svg viewBox="0 0 24 24" focusable="false">
                              <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
                              <circle cx="8.25" cy="10" r="1.5" />
                              <path d="M5.5 16l4.1-4.1a1.2 1.2 0 0 1 1.7 0l1.8 1.8a1.2 1.2 0 0 0 1.7 0l1.7-1.7a1.2 1.2 0 0 1 1.7 0L20.5 14.3" />
                            </svg>
                          </span>
                          <span className="vehicle-card__fallback-text">Нет фотографии</span>
                        </span>
                      )}
                    </div>
                    <div className="vehicle-card__content">
                      <h3>{item.title || `${item.brand} ${item.model}`}</h3>
                      <p className="vehicle-card__subtitle">{buildCardSubtitle(item)}</p>
                      <div className="vehicle-card__bottom">
                        <p className="vehicle-card__price">{formatPrice(item.price)}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>

            {isMobileViewport ? (
              <div className="pager pager--compact">
                <button
                  className="pager-button pager-button--nav"
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPageFromPagination(page - 1, "prev")}
                  aria-label="Предыдущая страница"
                  title="Предыдущая страница"
                >
                  ←
                </button>
                <span className="pager-mobile-status">
                  Стр. {page} из {totalPages}
                </span>
                <button
                  className="pager-button pager-button--nav"
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPageFromPagination(page + 1, "next")}
                  aria-label="Следующая страница"
                  title="Следующая страница"
                >
                  →
                </button>
              </div>
            ) : (
              <div className="pager">
                <button
                  className="pager-button pager-button--nav"
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPageFromPagination(page - 1, "prev")}
                  aria-label="Предыдущая страница"
                  title="Предыдущая страница"
                >
                  ←
                </button>
                <div className="pager-pages">
                  {visiblePages.map((item, index) => {
                    if (item === "ellipsis") {
                      return (
                        <span key={`ellipsis-${index}`} className="pager-ellipsis">
                          ...
                        </span>
                      );
                    }

                    return (
                      <button
                        key={item}
                        type="button"
                        className={item === page ? "pager-page active" : "pager-page"}
                        onClick={() => setPageFromPagination(item, "number")}
                      >
                        {item}
                      </button>
                    );
                  })}
                </div>
                <button
                  className="pager-button pager-button--nav"
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPageFromPagination(page + 1, "next")}
                  aria-label="Следующая страница"
                  title="Следующая страница"
                >
                  →
                </button>
              </div>
            )}
          </>
        )}
      </main>
    </section>
  );
}





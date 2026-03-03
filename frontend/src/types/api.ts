export type UserRole = "admin" | "manager" | "stock_owner";
export type PlatformMode = "closed" | "open";

export interface ImportErrorItem {
  rowNumber: number;
  field: string | null;
  message: string;
}

export interface AuthUser {
  id: number;
  login: string;
  displayName: string;
  role: UserRole;
}

export interface AuthResponse {
  user: AuthUser;
}

export interface PlatformModeResponse {
  mode: PlatformMode;
}

export interface AdminUserListItem {
  id: number;
  login: string;
  displayName: string;
  company: string | null;
  phone: string | null;
  notes: string | null;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

export interface AdminUsersResponse {
  items: AdminUserListItem[];
}

export interface ResetAdminPasswordResponse {
  user: AuthUser;
  temporaryPassword: string;
}

export interface ImportResponse {
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
  errors: ImportErrorItem[];
}

export interface ImportBatchListItem {
  id: string;
  filename: string;
  status: "completed" | "completed_with_errors" | "failed";
  total_rows: number;
  imported_rows: number;
  skipped_rows: number;
  added_rows: number;
  updated_rows: number;
  removed_rows: number;
  unchanged_rows: number;
  created_at: string;
}

export interface ImportBatchesResponse {
  items: ImportBatchListItem[];
}

export interface ImportErrorRecord {
  id: number;
  import_batch_id: string;
  row_number: number;
  field: string | null;
  message: string;
  created_at: string;
}

export interface ImportBatchDetailsResponse {
  importBatch: ImportBatchListItem;
  errors: ImportErrorRecord[];
}

export interface ClearImportsResponse {
  message: string;
  importBatchesDeleted: number;
  importErrorsDeleted: number;
  vehicleOffersDeleted: number;
}

export interface CatalogItem {
  id: number;
  importBatchId: string;
  offerCode: string;
  status: string;
  brand: string;
  model: string;
  modification: string;
  vehicleType: string;
  year: number | null;
  mileageKm: number | null;
  keyCount: number | null;
  ptsType: string;
  hasEncumbrance: boolean | null;
  isDeregistered: boolean | null;
  responsiblePerson: string;
  storageAddress: string;
  daysOnSale: number | null;
  price: number | null;
  yandexDiskUrl: string;
  bookingStatus: string;
  externalId: string;
  crmRef: string;
  websiteUrl: string;
  title: string;
  createdAt: string;
}

export interface CatalogItemsResponse {
  items: CatalogItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface CatalogSummaryResponse {
  newThisWeekCount: number;
}

export interface CatalogFiltersResponse {
  offerCode: string[];
  status: string[];
  city: string[];
  brand: string[];
  model: string[];
  modification: string[];
  vehicleType: string[];
  ptsType: string[];
  hasEncumbrance: boolean[];
  isDeregistered: boolean[];
  responsiblePerson: string[];
  storageAddress: string[];
  bookingStatus: string[];
  externalId: string[];
  crmRef: string[];
  websiteUrl: string[];
  yandexDiskUrl: string[];
  modelsByBrand?: Record<string, string[]>;
  brandsByVehicleType?: Record<string, string[]>;
  modelsByBrandAndVehicleType?: Record<string, Record<string, string[]>>;
  priceMin: number | null;
  priceMax: number | null;
  yearMin: number | null;
  yearMax: number | null;
  mileageMin: number | null;
  mileageMax: number | null;
  keyCountMin: number | null;
  keyCountMax: number | null;
  daysOnSaleMin: number | null;
  daysOnSaleMax: number | null;
}

export type ActivityEventType =
  | "login_open"
  | "login_success"
  | "login_failed"
  | "logout"
  | "session_start"
  | "session_heartbeat"
  | "page_view"
  | "showcase_open"
  | "showcase_filter_drawer_open"
  | "showcase_filter_drawer_close"
  | "showcase_filters_apply"
  | "showcase_filters_reset"
  | "showcase_no_results"
  | "showcase_sort_change"
  | "showcase_view_mode_change"
  | "showcase_pagination_click"
  | "showcase_page_change"
  | "showcase_item_open"
  | "showcase_gallery_open"
  | "showcase_gallery_navigate"
  | "showcase_gallery_close"
  | "showcase_contact_click"
  | "showcase_source_open"
  | "api_error";

export interface ActivityEventItem {
  id: number;
  userId: number;
  login: string;
  sessionId: string;
  eventType: ActivityEventType;
  page: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ActivityEventsResponse {
  items: ActivityEventItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface GuestActivityEventItem {
  id: number;
  sessionId: string;
  eventType: ActivityEventType;
  page: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown> | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  referrer: string | null;
  userAgent: string | null;
  ipHash: string | null;
  createdAt: string;
}

export interface GuestActivityEventsResponse {
  items: GuestActivityEventItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface GuestActivitySummarySourceItem {
  source: string;
  sessions: number;
  sharePercent: number;
}

export interface GuestActivitySummaryFilterFieldItem {
  field: string;
  count: number;
  sharePercent: number;
}

export interface GuestActivitySummaryResponse {
  uniqueSessions: number;
  totalEvents: number;
  businessEvents: number;
  engagedSessions: number;
  engagedSessionsPercent: number;
  showcaseSessions: number;
  filtersSessions: number;
  itemSessions: number;
  loginSessions: number;
  noResultsSessions: number;
  apiErrors: number;
  showcaseToItemSessionCtrPercent: number;
  showcaseToLoginSessionPercent: number;
  filtersToNoResultsSessionPercent: number;
  totalEngagedTimeSec: number;
  avgEngagedTimeSec: number;
  medianEngagedTimeSec: number;
  topSources: GuestActivitySummarySourceItem[];
  topFilterFields: GuestActivitySummaryFilterFieldItem[];
}

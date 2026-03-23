import type {
  AdminCardFillnessResponse,
  AdminMediaHealthResponse,
  AdminUsersResponse,
  ActivityEventType,
  ActivityEventsResponse,
  AuthResponse,
  CatalogItem,
  FavoriteItemIdsResponse,
  FavoriteItemsResponse,
  FavoriteMutationResponse,
  ClearImportsResponse,
  GuestActivityEventsResponse,
  GuestActivitySummaryResponse,
  ImportBatchesResponse,
  ImportBatchDetailsResponse,
  CatalogFiltersResponse,
  CatalogItemsResponse,
  CatalogSummaryResponse,
  ImportResponse,
  ImportTenantId,
  PlatformMode,
  PlatformModeResponse,
  ResetAdminPasswordResponse,
  UserRole,
} from "../types/api";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:3001/api";
const ACTIVITY_SESSION_KEY = "activity_session_id_v1";
const ACTIVITY_ATTRIBUTION_KEY = "activity_attribution_v1";
const MEDIA_GALLERY_CACHE_TTL_MS = 5 * 60 * 1000;
const mediaGalleryCache = new Map<string, { galleryUrls: string[]; expiresAt: number }>();
const STORED_PREVIEW_PREFIX = "stored-preview:";

function buildUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

function resolveApiOrigin(): string | null {
  try {
    return new URL(API_BASE_URL).origin;
  } catch {
    return null;
  }
}

export function buildPublicShareUrl(itemId: number): string {
  const apiOrigin = resolveApiOrigin();
  if (apiOrigin) {
    return `${apiOrigin}/showcase/${itemId}`;
  }

  if (typeof window !== "undefined") {
    return `${window.location.origin}/showcase/${itemId}`;
  }

  return `https://api.reactiv.pro/showcase/${itemId}`;
}

export function buildTelegramShareUrl(itemId: number): string {
  const shareUrlObject = new URL(buildPublicShareUrl(itemId));
  shareUrlObject.searchParams.set("tg_preview", "compact_v2");
  const shareUrl = encodeURIComponent(shareUrlObject.toString());
  return `https://t.me/share/url?url=${shareUrl}`;
}

function createActivitySessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getActivitySessionId(): string {
  if (typeof window === "undefined") {
    return "server-session";
  }

  try {
    const existing = window.sessionStorage.getItem(ACTIVITY_SESSION_KEY);
    if (existing) {
      return existing;
    }

    const created = createActivitySessionId();
    window.sessionStorage.setItem(ACTIVITY_SESSION_KEY, created);
    return created;
  } catch {
    return createActivitySessionId();
  }
}

interface ActivityAttributionContext {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  referrer?: string;
}

function readStoredAttributionContext(): ActivityAttributionContext {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(ACTIVITY_ATTRIBUTION_KEY);
    if (!raw) {
      return {};
    }

    return JSON.parse(raw) as ActivityAttributionContext;
  } catch {
    return {};
  }
}

function writeStoredAttributionContext(context: ActivityAttributionContext): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(ACTIVITY_ATTRIBUTION_KEY, JSON.stringify(context));
  } catch {
    // ignore storage errors
  }
}

function getActivityAttributionContext(): ActivityAttributionContext {
  if (typeof window === "undefined") {
    return {};
  }

  const params = new URLSearchParams(window.location.search);
  const nextContext: ActivityAttributionContext = {
    utmSource: params.get("utm_source") ?? undefined,
    utmMedium: params.get("utm_medium") ?? undefined,
    utmCampaign: params.get("utm_campaign") ?? undefined,
    utmTerm: params.get("utm_term") ?? undefined,
    utmContent: params.get("utm_content") ?? undefined,
    referrer: document.referrer || undefined,
  };

  const hasAnyUtm =
    Boolean(nextContext.utmSource) ||
    Boolean(nextContext.utmMedium) ||
    Boolean(nextContext.utmCampaign) ||
    Boolean(nextContext.utmTerm) ||
    Boolean(nextContext.utmContent);

  const stored = readStoredAttributionContext();

  const merged: ActivityAttributionContext = {
    utmSource: nextContext.utmSource || stored.utmSource,
    utmMedium: nextContext.utmMedium || stored.utmMedium,
    utmCampaign: nextContext.utmCampaign || stored.utmCampaign,
    utmTerm: nextContext.utmTerm || stored.utmTerm,
    utmContent: nextContext.utmContent || stored.utmContent,
    referrer: nextContext.referrer || stored.referrer,
  };

  if (hasAnyUtm || !stored.referrer) {
    writeStoredAttributionContext(merged);
  }

  return merged;
}

function backendUnavailableError(): Error {
  return new Error("Бэкенд недоступен. Запустите сервер на порту 3001.");
}

export async function login(
  loginValue: string,
  password: string,
): Promise<AuthResponse> {
  try {
    const response = await fetch(buildUrl("/auth/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        login: loginValue,
        password,
      }),
    });

    if (!response.ok) {
      let errorMessage = "Не удалось войти";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as AuthResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getPlatformMode(): Promise<PlatformModeResponse> {
  try {
    const response = await fetch(buildUrl("/platform/mode"), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ СЂРµР¶РёРј РїР»Р°С‚С„РѕСЂРјС‹");
    }

    return (await response.json()) as PlatformModeResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function updatePlatformMode(
  mode: PlatformMode,
): Promise<PlatformModeResponse> {
  try {
    const response = await fetch(buildUrl("/admin/platform/mode"), {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ mode }),
    });

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (!response.ok) {
      let errorMessage = "РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±РЅРѕРІРёС‚СЊ СЂРµР¶РёРј РїР»Р°С‚С„РѕСЂРјС‹";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as PlatformModeResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getCurrentUser(): Promise<AuthResponse> {
  try {
    const response = await fetch(buildUrl("/auth/me"), {
      method: "GET",
      credentials: "include",
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error("Не удалось проверить сессию");
    }

    return (await response.json()) as AuthResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(buildUrl("/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export interface CreateAdminUserInput {
  login: string;
  password: string;
  displayName: string;
  company?: string;
  phone?: string;
  notes?: string;
  role?: UserRole;
}

export interface UpdateAdminUserMetaInput {
  company?: string;
  phone?: string;
  notes?: string;
}

export async function getAdminUsers(): Promise<AdminUsersResponse> {
  try {
    const response = await fetch(buildUrl("/admin/users"), {
      credentials: "include",
      cache: "no-store",
    });

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (!response.ok) {
      throw new Error("Не удалось загрузить пользователей");
    }

    return (await response.json()) as AdminUsersResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function createAdminUser(
  input: CreateAdminUserInput,
): Promise<AuthResponse> {
  try {
    const response = await fetch(buildUrl("/admin/users"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (response.status === 409) {
      throw new Error("Пользователь с таким логином уже существует");
    }

    if (!response.ok) {
      let errorMessage = "Не удалось создать пользователя";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as AuthResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function deleteAdminUser(userId: number): Promise<void> {
  try {
    const response = await fetch(buildUrl(`/admin/users/${userId}`), {
      method: "DELETE",
      credentials: "include",
    });

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (response.status === 404) {
      throw new Error("USER_NOT_FOUND");
    }

    if (!response.ok) {
      let errorMessage = "Не удалось удалить пользователя";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function resetAdminUserPassword(
  userId: number,
): Promise<ResetAdminPasswordResponse> {
  try {
    const response = await fetch(buildUrl(`/admin/users/${userId}/reset-password`), {
      method: "POST",
      credentials: "include",
    });

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (response.status === 404) {
      throw new Error("USER_NOT_FOUND");
    }

    if (!response.ok) {
      let errorMessage = "Не удалось сбросить пароль";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as ResetAdminPasswordResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function updateAdminUserMeta(
  userId: number,
  input: UpdateAdminUserMetaInput,
): Promise<void> {
  try {
    const response = await fetch(buildUrl(`/admin/users/${userId}/meta`), {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (response.status === 404) {
      throw new Error("USER_NOT_FOUND");
    }

    if (!response.ok) {
      let errorMessage = "Не удалось обновить данные пользователя";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function uploadImport(
  file: File,
  tenantId: ImportTenantId,
): Promise<ImportResponse> {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(
      buildUrl(`/imports?tenantId=${encodeURIComponent(tenantId)}`),
      {
      method: "POST",
      credentials: "include",
      body: formData,
      },
    );

    if (!response.ok) {
      let errorMessage = "Загрузка не удалась";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as ImportResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getImportBatches(
  limit = 20,
  tenantId?: ImportTenantId,
): Promise<ImportBatchesResponse> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (tenantId) {
    params.set("tenantId", tenantId);
  }

  const response = await fetch(buildUrl(`/imports?${params.toString()}`), {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Не удалось загрузить историю импортов");
  }
  return (await response.json()) as ImportBatchesResponse;
}

export async function getImportBatchDetails(
  importBatchId: string,
): Promise<ImportBatchDetailsResponse> {
  const response = await fetch(buildUrl(`/imports/${importBatchId}`), {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Не удалось загрузить данные импорта");
  }
  return (await response.json()) as ImportBatchDetailsResponse;
}

export async function clearImports(
  tenantId?: ImportTenantId,
): Promise<ClearImportsResponse> {
  try {
    const params = new URLSearchParams();
    if (tenantId) {
      params.set("tenantId", tenantId);
    }
    const query = params.toString();

    const response = await fetch(buildUrl(`/imports${query ? `?${query}` : ""}`), {
      method: "DELETE",
      credentials: "include",
    });

    if (!response.ok) {
      let errorMessage = "Не удалось очистить импортированные данные";
      try {
        const errorPayload = (await response.json()) as { message?: string };
        if (errorPayload.message) {
          errorMessage = errorPayload.message;
        }
      } catch {
        // keep default message
      }
      throw new Error(errorMessage);
    }

    return (await response.json()) as ClearImportsResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

interface MediaPreviewImageOptions {
  width?: number;
}

export function getMediaPreviewImageUrl(
  sourceUrl: string,
  options: MediaPreviewImageOptions = {},
): string {
  if (sourceUrl.startsWith(STORED_PREVIEW_PREFIX)) {
    const params = new URLSearchParams();
    params.set("path", sourceUrl.slice(STORED_PREVIEW_PREFIX.length));
    if (options.width && Number.isFinite(options.width) && options.width > 0) {
      params.set("w", String(Math.floor(options.width)));
    }
    return buildUrl(
      `/media/card-preview?${params.toString()}`,
    );
  }

  return buildUrl(`/media/preview-image?url=${encodeURIComponent(sourceUrl)}`);
}

export async function getMediaGalleryUrls(sourceUrl: string): Promise<string[]> {
  const trimmedSourceUrl = sourceUrl.trim();
  if (!trimmedSourceUrl) {
    return [];
  }

  const cached = mediaGalleryCache.get(trimmedSourceUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.galleryUrls;
  }

  try {
    const response = await fetch(
      buildUrl(`/media/gallery?url=${encodeURIComponent(trimmedSourceUrl)}`),
      {
        credentials: "include",
      },
    );

    if (!response.ok) {
      throw new Error("Не удалось загрузить галерею");
    }

    const payload = (await response.json()) as { galleryUrls?: string[] };
    const galleryUrls = payload.galleryUrls ?? [];
    mediaGalleryCache.set(trimmedSourceUrl, {
      galleryUrls,
      expiresAt: Date.now() + MEDIA_GALLERY_CACHE_TTL_MS,
    });
    return galleryUrls;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export interface CatalogItemsQuery {
  [key: string]: string | string[] | number | undefined;
}

interface CatalogRequestOptions {
  signal?: AbortSignal;
}

export async function getCatalogItems(
  query: CatalogItemsQuery,
  options: CatalogRequestOptions = {},
): Promise<CatalogItemsResponse> {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === "") {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => params.append(key, item));
      return;
    }

    params.set(key, String(value));
  });

  try {
    const response = await fetch(buildUrl(`/catalog/items?${params.toString()}`), {
      credentials: "include",
      signal: options.signal,
    });
    if (!response.ok) {
      throw new Error("Не удалось загрузить позиции каталога");
    }

    return (await response.json()) as CatalogItemsResponse;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getCatalogSummary(): Promise<CatalogSummaryResponse> {
  try {
    const response = await fetch(buildUrl("/catalog/summary"), {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Не удалось загрузить сводку витрины");
    }

    return (await response.json()) as CatalogSummaryResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getAdminMediaHealth(
  days = 30,
): Promise<AdminMediaHealthResponse> {
  const params = new URLSearchParams({ days: String(days) });
  try {
    const response = await fetch(
      buildUrl(`/admin/highlights/media-health?${params.toString()}`),
      {
        credentials: "include",
        cache: "no-store",
      },
    );

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (!response.ok) {
      throw new Error("Не удалось загрузить метрики живости медиа");
    }

    return (await response.json()) as AdminMediaHealthResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getAdminCardFillness(): Promise<AdminCardFillnessResponse> {
  try {
    const response = await fetch(buildUrl("/admin/highlights/card-fillness"), {
      credentials: "include",
      cache: "no-store",
    });

    if (response.status === 403) {
      throw new Error("FORBIDDEN");
    }

    if (!response.ok) {
      throw new Error("Не удалось загрузить заполненность карточек");
    }

    return (await response.json()) as AdminCardFillnessResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getCatalogFilters(): Promise<CatalogFiltersResponse> {
  try {
    const response = await fetch(buildUrl("/catalog/filters"), {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error("Не удалось загрузить фильтры");
    }
    return (await response.json()) as CatalogFiltersResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getCatalogItemById(id: number): Promise<CatalogItem> {
  try {
    const response = await fetch(buildUrl(`/catalog/items/${id}`), {
      credentials: "include",
    });

    if (response.status === 404) {
      throw new Error("Карточка не найдена");
    }

    if (!response.ok) {
      throw new Error("Не удалось загрузить карточку");
    }

    return (await response.json()) as CatalogItem;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getFavoriteItemIds(): Promise<FavoriteItemIdsResponse> {
  try {
    const response = await fetch(buildUrl("/favorites/ids"), {
      credentials: "include",
      cache: "no-store",
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error("Не удалось загрузить избранное");
    }

    return (await response.json()) as FavoriteItemIdsResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function getFavoriteItems(
  page = 1,
  pageSize = 20,
): Promise<FavoriteItemsResponse> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    const response = await fetch(buildUrl(`/favorites?${params.toString()}`), {
      credentials: "include",
      cache: "no-store",
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error("Не удалось загрузить избранное");
    }

    return (await response.json()) as FavoriteItemsResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function addFavoriteItem(itemId: number): Promise<FavoriteMutationResponse> {
  try {
    const response = await fetch(buildUrl(`/favorites/${itemId}`), {
      method: "POST",
      credentials: "include",
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error("Не удалось обновить избранное");
    }

    return (await response.json()) as FavoriteMutationResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export async function removeFavoriteItem(itemId: number): Promise<FavoriteMutationResponse> {
  try {
    const response = await fetch(buildUrl(`/favorites/${itemId}`), {
      method: "DELETE",
      credentials: "include",
    });

    if (response.status === 401) {
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error("Не удалось обновить избранное");
    }

    return (await response.json()) as FavoriteMutationResponse;
  } catch (error) {
    if (error instanceof TypeError) {
      throw backendUnavailableError();
    }
    throw error;
  }
}

export interface ActivityEventInput {
  eventType: ActivityEventType;
  page?: string;
  entityType?: string;
  entityId?: string;
  payload?: Record<string, unknown>;
}

async function postGuestActivityEvent(input: ActivityEventInput): Promise<void> {
  const attribution = getActivityAttributionContext();

  await fetch(buildUrl("/public/activity/events"), {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    keepalive: true,
    body: JSON.stringify({
      ...input,
      sessionId: getActivitySessionId(),
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign,
      utmTerm: attribution.utmTerm,
      utmContent: attribution.utmContent,
      referrer: attribution.referrer,
    }),
  });
}

export interface GetAdminActivityInput {
  page?: number;
  pageSize?: number;
  userId?: number;
  login?: string;
  eventType?: ActivityEventType;
  from?: string;
  to?: string;
}

export interface GetAdminGuestActivityInput {
  page?: number;
  pageSize?: number;
  sessionId?: string;
  eventType?: ActivityEventType;
  from?: string;
  to?: string;
}

export async function logActivityEvent(input: ActivityEventInput): Promise<void> {
  try {
    const response = await fetch(buildUrl("/activity/events"), {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      keepalive: true,
      body: JSON.stringify({
        ...input,
        sessionId: getActivitySessionId(),
      }),
    });

    if (response.status === 401) {
      await postGuestActivityEvent(input);
    }
  } catch {
    // analytics logging must never break the user flow
  }
}

export async function getAdminActivity(
  input: GetAdminActivityInput = {},
): Promise<ActivityEventsResponse> {
  const params = new URLSearchParams();

  if (input.page) {
    params.set("page", String(input.page));
  }
  if (input.pageSize) {
    params.set("pageSize", String(input.pageSize));
  }
  if (input.userId) {
    params.set("userId", String(input.userId));
  }
  if (input.login) {
    params.set("login", input.login);
  }
  if (input.eventType) {
    params.set("eventType", input.eventType);
  }
  if (input.from) {
    params.set("from", input.from);
  }
  if (input.to) {
    params.set("to", input.to);
  }

  const query = params.toString();
  const path = query ? `/admin/activity?${query}` : "/admin/activity";
  const response = await fetch(buildUrl(path), {
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 403) {
    throw new Error("FORBIDDEN");
  }

  if (!response.ok) {
    throw new Error("Не удалось загрузить активность пользователей");
  }

  return (await response.json()) as ActivityEventsResponse;
}

export async function getAdminGuestActivity(
  input: GetAdminGuestActivityInput = {},
): Promise<GuestActivityEventsResponse> {
  const params = new URLSearchParams();

  if (input.page) {
    params.set("page", String(input.page));
  }
  if (input.pageSize) {
    params.set("pageSize", String(input.pageSize));
  }
  if (input.sessionId) {
    params.set("sessionId", input.sessionId);
  }
  if (input.eventType) {
    params.set("eventType", input.eventType);
  }
  if (input.from) {
    params.set("from", input.from);
  }
  if (input.to) {
    params.set("to", input.to);
  }

  const query = params.toString();
  const path = query ? `/admin/activity/guests?${query}` : "/admin/activity/guests";
  const response = await fetch(buildUrl(path), {
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 403) {
    throw new Error("FORBIDDEN");
  }

  if (!response.ok) {
    throw new Error("Не удалось загрузить гостевую активность");
  }

  return (await response.json()) as GuestActivityEventsResponse;
}

export interface GetAdminGuestActivitySummaryInput {
  from?: string;
  to?: string;
}

export async function getAdminGuestActivitySummary(
  input: GetAdminGuestActivitySummaryInput = {},
): Promise<GuestActivitySummaryResponse> {
  const params = new URLSearchParams();

  if (input.from) {
    params.set("from", input.from);
  }
  if (input.to) {
    params.set("to", input.to);
  }

  const query = params.toString();
  const path = query
    ? `/admin/activity/guests/summary?${query}`
    : "/admin/activity/guests/summary";
  const response = await fetch(buildUrl(path), {
    credentials: "include",
    cache: "no-store",
  });

  if (response.status === 403) {
    throw new Error("FORBIDDEN");
  }

  if (!response.ok) {
    throw new Error("Не удалось загрузить сводку гостевой активности");
  }

  return (await response.json()) as GuestActivitySummaryResponse;
}

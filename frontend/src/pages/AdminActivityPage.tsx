import { useEffect, useMemo, useState } from "react";
import {
  getAdminActivity,
  getAdminGuestActivity,
  getAdminGuestActivitySummary,
} from "../api/client";
import type {
  ActivityEventItem,
  ActivityEventType,
  GuestActivityEventItem,
  GuestActivitySummaryFilterFieldItem,
  GuestActivitySummaryResponse,
  GuestActivitySummarySourceItem,
} from "../types/api";

const EVENT_TYPE_OPTIONS: Array<{ value: "" | ActivityEventType; label: string }> = [
  { value: "", label: "Все события" },
  { value: "login_open", label: "Открытие формы входа" },
  { value: "login_success", label: "Вход" },
  { value: "login_failed", label: "Ошибка входа" },
  { value: "logout", label: "Выход" },
  { value: "session_start", label: "Старт сессии" },
  { value: "session_heartbeat", label: "Heartbeat" },
  { value: "page_view", label: "Просмотр страницы" },
  { value: "showcase_open", label: "Открытие витрины" },
  { value: "showcase_filters_apply", label: "Применение фильтров" },
  { value: "showcase_page_change", label: "Смена страницы витрины" },
  { value: "showcase_item_open", label: "Открытие карточки" },
  { value: "showcase_contact_click", label: "Клик по контакту" },
  { value: "showcase_source_open", label: "Открытие источника" },
  { value: "api_error", label: "Ошибка API" },
];

const FILTER_FIELD_LABELS: Record<string, string> = {
  bookingPreset: "Статус техники",
  city: "Регион",
  selectedVehicleTypes: "Тип техники",
  brand: "Марка",
  model: "Модель",
  priceMin: "Цена от",
  priceMax: "Цена до",
  yearMin: "Год от",
  yearMax: "Год до",
  mileageMin: "Пробег от",
  mileageMax: "Пробег до",
  sortBy: "Сортировка: поле",
  sortDir: "Сортировка: направление",
};

type TimePresetId = "today" | "yesterday" | "week" | "month" | "quarter";

const TIME_PRESET_OPTIONS: Array<{ id: TimePresetId; label: string }> = [
  { id: "today", label: "Сегодня" },
  { id: "yesterday", label: "Вчера" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
  { id: "quarter", label: "Квартал" },
];

interface AppliedUserFilters {
  login: string;
  userId: string;
  eventType: "" | ActivityEventType;
  from: string;
  to: string;
}

interface AppliedGuestFilters {
  sessionId: string;
  eventType: "" | ActivityEventType;
  from: string;
  to: string;
}

function toDateTimeInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 0, 0);
}

function startOfWeek(date: Date): Date {
  const weekDay = date.getDay();
  const diffFromMonday = (weekDay + 6) % 7;
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() - diffFromMonday));
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function startOfQuarter(date: Date): Date {
  const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterStartMonth, 1, 0, 0, 0, 0);
}

function resolveTimePresetRange(presetId: TimePresetId): { from: string; to: string } {
  const now = new Date();

  if (presetId === "today") {
    return {
      from: toDateTimeInputValue(startOfDay(now)),
      to: toDateTimeInputValue(now),
    };
  }

  if (presetId === "yesterday") {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    return {
      from: toDateTimeInputValue(startOfDay(yesterday)),
      to: toDateTimeInputValue(endOfDay(yesterday)),
    };
  }

  if (presetId === "week") {
    return {
      from: toDateTimeInputValue(startOfWeek(now)),
      to: toDateTimeInputValue(now),
    };
  }

  if (presetId === "month") {
    return {
      from: toDateTimeInputValue(startOfMonth(now)),
      to: toDateTimeInputValue(now),
    };
  }

  return {
    from: toDateTimeInputValue(startOfQuarter(now)),
    to: toDateTimeInputValue(now),
  };
}

function eventTypeLabel(eventType: ActivityEventType): string {
  const found = EVENT_TYPE_OPTIONS.find((item) => item.value === eventType);
  return found?.label ?? eventType;
}

function formatPayload(payload: Record<string, unknown> | null): string {
  if (!payload) {
    return "-";
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return "-";
  }
}

function formatEntity(entityType: string | null, entityId: string | null): string {
  if (!entityType) {
    return "-";
  }

  return entityId ? `${entityType}:${entityId}` : entityType;
}

function textOrDash(value: string | null): string {
  return value && value.trim().length > 0 ? value : "-";
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) {
    return "0 сек";
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  if (minutes <= 0) {
    return `${restSeconds} сек`;
  }

  if (minutes < 60) {
    return `${minutes} мин ${restSeconds} сек`;
  }

  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `${hours} ч ${restMinutes} мин`;
}

function formatSourceLabel(source: string): string {
  if (source === "direct") {
    return "direct";
  }
  if (source.startsWith("utm:")) {
    return `utm:${source.slice(4)}`;
  }
  if (source.startsWith("ref:")) {
    return source.slice(4);
  }
  return source;
}

function formatFilterFieldLabel(field: string): string {
  return FILTER_FIELD_LABELS[field] ?? field;
}

export function AdminActivityPage() {
  const [items, setItems] = useState<ActivityEventItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);

  const [loginInput, setLoginInput] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  const [eventTypeInput, setEventTypeInput] = useState<"" | ActivityEventType>("");
  const [fromInput, setFromInput] = useState("");
  const [toInput, setToInput] = useState("");
  const [selectedUserTimePreset, setSelectedUserTimePreset] = useState<TimePresetId | null>(null);

  const [appliedFilters, setAppliedFilters] = useState<AppliedUserFilters>({
    login: "",
    userId: "",
    eventType: "",
    from: "",
    to: "",
  });

  const [guestItems, setGuestItems] = useState<GuestActivityEventItem[]>([]);
  const [isGuestLoading, setIsGuestLoading] = useState(true);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestPage, setGuestPage] = useState(1);
  const [guestTotal, setGuestTotal] = useState(0);
  const [guestPageSize] = useState(50);

  const [guestSessionInput, setGuestSessionInput] = useState("");
  const [guestEventTypeInput, setGuestEventTypeInput] = useState<"" | ActivityEventType>("");
  const [guestFromInput, setGuestFromInput] = useState("");
  const [guestToInput, setGuestToInput] = useState("");
  const [selectedGuestTimePreset, setSelectedGuestTimePreset] = useState<TimePresetId | null>(null);

  const [appliedGuestFilters, setAppliedGuestFilters] = useState<AppliedGuestFilters>({
    sessionId: "",
    eventType: "",
    from: "",
    to: "",
  });

  const [guestSummary, setGuestSummary] = useState<GuestActivitySummaryResponse | null>(null);
  const [isGuestSummaryLoading, setIsGuestSummaryLoading] = useState(true);
  const [guestSummaryError, setGuestSummaryError] = useState<string | null>(null);
  const [isUserEventsExpanded, setIsUserEventsExpanded] = useState(false);
  const [isGuestEventsExpanded, setIsGuestEventsExpanded] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canGoPrev = page > 1;
  const canGoNext = page < totalPages;

  const guestTotalPages = Math.max(1, Math.ceil(guestTotal / guestPageSize));
  const canGoGuestPrev = guestPage > 1;
  const canGoGuestNext = guestPage < guestTotalPages;
  const latestUserEventTime = items[0]?.createdAt ?? null;
  const latestGuestEventTime = guestItems[0]?.createdAt ?? null;

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.login) {
      count += 1;
    }
    if (appliedFilters.userId) {
      count += 1;
    }
    if (appliedFilters.eventType) {
      count += 1;
    }
    if (appliedFilters.from) {
      count += 1;
    }
    if (appliedFilters.to) {
      count += 1;
    }
    return count;
  }, [appliedFilters]);

  const activeGuestFilterCount = useMemo(() => {
    let count = 0;
    if (appliedGuestFilters.sessionId) {
      count += 1;
    }
    if (appliedGuestFilters.eventType) {
      count += 1;
    }
    if (appliedGuestFilters.from) {
      count += 1;
    }
    if (appliedGuestFilters.to) {
      count += 1;
    }
    return count;
  }, [appliedGuestFilters]);

  useEffect(() => {
    async function loadActivity() {
      setIsLoading(true);
      setError(null);

      try {
        const userId = appliedFilters.userId.trim();
        const userIdNumber = userId ? Number(userId) : undefined;

        const response = await getAdminActivity({
          page,
          pageSize,
          login: appliedFilters.login.trim() || undefined,
          userId:
            typeof userIdNumber === "number" && Number.isFinite(userIdNumber)
              ? userIdNumber
              : undefined,
          eventType: appliedFilters.eventType || undefined,
          from: appliedFilters.from || undefined,
          to: appliedFilters.to || undefined,
        });

        setItems(response.items);
        setTotal(response.pagination.total);
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.message === "FORBIDDEN") {
          setError("Доступ к журналу активности разрешен только администратору.");
          return;
        }

        if (caughtError instanceof Error) {
          setError(caughtError.message);
          return;
        }

        setError("Не удалось загрузить журнал активности.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadActivity();
  }, [appliedFilters, page, pageSize]);

  useEffect(() => {
    async function loadGuestActivity() {
      setIsGuestLoading(true);
      setGuestError(null);

      try {
        const response = await getAdminGuestActivity({
          page: guestPage,
          pageSize: guestPageSize,
          sessionId: appliedGuestFilters.sessionId || undefined,
          eventType: appliedGuestFilters.eventType || undefined,
          from: appliedGuestFilters.from || undefined,
          to: appliedGuestFilters.to || undefined,
        });

        setGuestItems(response.items);
        setGuestTotal(response.pagination.total);
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.message === "FORBIDDEN") {
          setGuestError("Доступ к гостевой активности разрешен только администратору.");
          return;
        }

        if (caughtError instanceof Error) {
          setGuestError(caughtError.message);
          return;
        }

        setGuestError("Не удалось загрузить гостевую активность.");
      } finally {
        setIsGuestLoading(false);
      }
    }

    void loadGuestActivity();
  }, [appliedGuestFilters, guestPage, guestPageSize]);

  useEffect(() => {
    async function loadGuestSummary() {
      setIsGuestSummaryLoading(true);
      setGuestSummaryError(null);

      try {
        const response = await getAdminGuestActivitySummary({
          from: appliedGuestFilters.from || undefined,
          to: appliedGuestFilters.to || undefined,
        });
        setGuestSummary(response);
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.message === "FORBIDDEN") {
          setGuestSummaryError("Доступ к дашборду гостевой активности запрещен.");
          return;
        }
        if (caughtError instanceof Error) {
          setGuestSummaryError(caughtError.message);
          return;
        }
        setGuestSummaryError("Не удалось загрузить дашборд гостевой активности.");
      } finally {
        setIsGuestSummaryLoading(false);
      }
    }

    void loadGuestSummary();
  }, [appliedGuestFilters.from, appliedGuestFilters.to]);

  function applyFilters(): void {
    setPage(1);
    setAppliedFilters({
      login: loginInput.trim(),
      userId: userIdInput.trim(),
      eventType: eventTypeInput,
      from: fromInput,
      to: toInput,
    });
  }

  function resetFilters(): void {
    setLoginInput("");
    setUserIdInput("");
    setEventTypeInput("");
    setFromInput("");
    setToInput("");
    setSelectedUserTimePreset(null);
    setPage(1);
    setAppliedFilters({
      login: "",
      userId: "",
      eventType: "",
      from: "",
      to: "",
    });
  }

  function applyUserTimePreset(presetId: TimePresetId): void {
    const { from, to } = resolveTimePresetRange(presetId);
    setSelectedUserTimePreset(presetId);
    setFromInput(from);
    setToInput(to);
    setPage(1);
    setAppliedFilters({
      login: loginInput.trim(),
      userId: userIdInput.trim(),
      eventType: eventTypeInput,
      from,
      to,
    });
  }

  function applyGuestFilters(): void {
    setGuestPage(1);
    setAppliedGuestFilters({
      sessionId: guestSessionInput.trim(),
      eventType: guestEventTypeInput,
      from: guestFromInput,
      to: guestToInput,
    });
  }

  function resetGuestFilters(): void {
    setGuestSessionInput("");
    setGuestEventTypeInput("");
    setGuestFromInput("");
    setGuestToInput("");
    setSelectedGuestTimePreset(null);
    setGuestPage(1);
    setAppliedGuestFilters({
      sessionId: "",
      eventType: "",
      from: "",
      to: "",
    });
  }

  function applyGuestTimePreset(presetId: TimePresetId): void {
    const { from, to } = resolveTimePresetRange(presetId);
    setSelectedGuestTimePreset(presetId);
    setGuestFromInput(from);
    setGuestToInput(to);
    setGuestPage(1);
    setAppliedGuestFilters({
      sessionId: guestSessionInput.trim(),
      eventType: guestEventTypeInput,
      from,
      to,
    });
  }

  return (
    <section>
      <h1>Активность пользователей и гостей</h1>

      <div className="panel">
        <h2>Активность авторизованных пользователей</h2>
        <div className="activity-presets" role="group" aria-label="User date presets">
          {TIME_PRESET_OPTIONS.map((preset) => (
            <button
              key={`user-preset-${preset.id}`}
              type="button"
              className={`activity-presets__button${
                selectedUserTimePreset === preset.id ? " activity-presets__button--active" : ""
              }`}
              onClick={() => applyUserTimePreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="toolbar activity-toolbar">
          <input
            type="text"
            placeholder="Логин"
            value={loginInput}
            onChange={(event) => setLoginInput(event.target.value)}
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder="User ID"
            value={userIdInput}
            onChange={(event) => setUserIdInput(event.target.value.replace(/[^\d]/g, ""))}
          />
          <select
            value={eventTypeInput}
            onChange={(event) => setEventTypeInput(event.target.value as "" | ActivityEventType)}
          >
            {EVENT_TYPE_OPTIONS.map((item) => (
              <option key={`user-${item.value || "all"}`} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={fromInput}
            onChange={(event) => {
              setFromInput(event.target.value);
              setSelectedUserTimePreset(null);
            }}
          />
          <input
            type="datetime-local"
            value={toInput}
            onChange={(event) => {
              setToInput(event.target.value);
              setSelectedUserTimePreset(null);
            }}
          />
          <button type="button" onClick={applyFilters}>
            Применить
          </button>
          <button type="button" className="secondary-button" onClick={resetFilters}>
            Сброс
          </button>
        </div>
        <p className="empty">
          Фильтров применено: {activeFilterCount}. Всего событий: {total.toLocaleString("ru-RU")}
        </p>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="panel activity-collapsible">
        <div className="activity-collapsible__header">
          <div className="activity-collapsible__body">
            <h3 className="activity-collapsible__title">Последние события пользователей</h3>
            <p className="activity-collapsible__meta">
              Всего событий: {total.toLocaleString("ru-RU")}
              {latestUserEventTime ? ` · Последнее: ${latestUserEventTime}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="secondary-button activity-collapsible__toggle"
            onClick={() => setIsUserEventsExpanded((current) => !current)}
            aria-expanded={isUserEventsExpanded}
          >
            {isUserEventsExpanded ? "Свернуть" : "Развернуть"}
          </button>
        </div>
      </div>

      {isUserEventsExpanded && (
      <div className="panel">
        {isLoading ? (
          <p>Загрузка активности...</p>
        ) : items.length === 0 ? (
          <p className="empty">События не найдены.</p>
        ) : (
          <>
            <div className="table-wrap desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Пользователь</th>
                    <th>Событие</th>
                    <th>Страница</th>
                    <th>Сущность</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`user-event-${item.id}`}>
                      <td>{item.createdAt}</td>
                      <td>
                        {item.login} (#{item.userId})
                      </td>
                      <td>{eventTypeLabel(item.eventType)}</td>
                      <td>{item.page || "-"}</td>
                      <td>{formatEntity(item.entityType, item.entityId)}</td>
                      <td>
                        <code className="activity-payload">{formatPayload(item.payload)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-cards">
              {items.map((item) => (
                <article key={`user-mobile-${item.id}`} className="mobile-card">
                  <div className="mobile-card__head">
                    <strong>{eventTypeLabel(item.eventType)}</strong>
                    <span className="mobile-card__meta">{item.createdAt}</span>
                  </div>
                  <dl className="mobile-card__list">
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Пользователь</dt>
                      <dd className="mobile-card__value">{item.login} (#{item.userId})</dd>
                    </div>
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Страница</dt>
                      <dd className="mobile-card__value">{item.page || "-"}</dd>
                    </div>
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Сущность</dt>
                      <dd className="mobile-card__value">{formatEntity(item.entityType, item.entityId)}</dd>
                    </div>
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Payload</dt>
                      <dd className="mobile-card__value">
                        <code className="activity-payload">{formatPayload(item.payload)}</code>
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="pager pager--compact">
              <button
                className="pager-button pager-button--nav"
                type="button"
                disabled={!canGoPrev}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                ←
              </button>
              <span className="pager-mobile-status">
                Стр. {page} из {totalPages}
              </span>
              <button
                className="pager-button pager-button--nav"
                type="button"
                disabled={!canGoNext}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                →
              </button>
            </div>
          </>
        )}
      </div>
      )}

      <div className="panel">
        <h2>Гостевая активность</h2>
        <div className="activity-presets" role="group" aria-label="Guest date presets">
          {TIME_PRESET_OPTIONS.map((preset) => (
            <button
              key={`guest-preset-${preset.id}`}
              type="button"
              className={`activity-presets__button${
                selectedGuestTimePreset === preset.id ? " activity-presets__button--active" : ""
              }`}
              onClick={() => applyGuestTimePreset(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="toolbar activity-toolbar">
          <input
            type="text"
            placeholder="Session ID"
            value={guestSessionInput}
            onChange={(event) => setGuestSessionInput(event.target.value)}
          />
          <select
            value={guestEventTypeInput}
            onChange={(event) => setGuestEventTypeInput(event.target.value as "" | ActivityEventType)}
          >
            {EVENT_TYPE_OPTIONS.map((item) => (
              <option key={`guest-${item.value || "all"}`} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={guestFromInput}
            onChange={(event) => {
              setGuestFromInput(event.target.value);
              setSelectedGuestTimePreset(null);
            }}
          />
          <input
            type="datetime-local"
            value={guestToInput}
            onChange={(event) => {
              setGuestToInput(event.target.value);
              setSelectedGuestTimePreset(null);
            }}
          />
          <button type="button" onClick={applyGuestFilters}>
            Применить
          </button>
          <button type="button" className="secondary-button" onClick={resetGuestFilters}>
            Сброс
          </button>
        </div>
        <p className="empty">
          Фильтров применено: {activeGuestFilterCount}. Всего событий: {guestTotal.toLocaleString("ru-RU")}
        </p>

        <div className="activity-summary-block">
          <h3>MVP-дашборд гостевой активности</h3>
          {isGuestSummaryLoading ? (
            <p>Загрузка дашборда...</p>
          ) : guestSummaryError ? (
            <p className="error">{guestSummaryError}</p>
          ) : guestSummary ? (
            <>
              <div className="activity-summary-grid">
                <article
                  className="activity-summary-card"
                  title="Количество уникальных session_id в выбранном периоде."
                >
                  <span>Уникальные сессии</span>
                  <strong>{guestSummary.uniqueSessions.toLocaleString("ru-RU")}</strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Сумма только бизнес-событий: витрина, фильтры, карточки, логин и контактные действия. Heartbeat и page_view не входят."
                >
                  <span>Бизнес-события</span>
                  <strong>{guestSummary.businessEvents.toLocaleString("ru-RU")}</strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Сессии считаются engaged, если был meaningful-ивент (например, open карточки/логина) или накоплено не менее 30 секунд engaged time."
                >
                  <span>Engaged-сессии</span>
                  <strong>
                    {guestSummary.engagedSessions.toLocaleString("ru-RU")} (
                    {guestSummary.engagedSessionsPercent.toFixed(2)}%)
                  </strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Среднее engaged time по сессиям: сумма интервалов между событиями внутри каждой сессии, каждый интервал ограничен 60 сек."
                >
                  <span>Среднее engaged время</span>
                  <strong>{formatDuration(guestSummary.avgEngagedTimeSec)}</strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Медиана engaged time по сессиям. Более устойчива к выбросам, чем среднее."
                >
                  <span>Медиана engaged времени</span>
                  <strong>{formatDuration(guestSummary.medianEngagedTimeSec)}</strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Доля сессий, где после открытия витрины было открытие карточки: sessions_with_item_open / sessions_with_showcase_open."
                >
                  <span>CTR витрина → карточка</span>
                  <strong>{guestSummary.showcaseToItemSessionCtrPercent.toFixed(2)}%</strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Доля сессий, где после открытия витрины был переход в форму логина: sessions_with_login_open / sessions_with_showcase_open."
                >
                  <span>CVR витрина → логин</span>
                  <strong>{guestSummary.showcaseToLoginSessionPercent.toFixed(2)}%</strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Доля сессий с no-results среди сессий, где применяли фильтры: sessions_with_no_results / sessions_with_filters."
                >
                  <span>Доля no-results среди сессий с фильтрами</span>
                  <strong>{guestSummary.filtersToNoResultsSessionPercent.toFixed(2)}%</strong>
                </article>
                <article
                  className="activity-summary-card"
                  title="Количество событий api_error в гостевом треке за выбранный период."
                >
                  <span>Ошибки API</span>
                  <strong>{guestSummary.apiErrors.toLocaleString("ru-RU")}</strong>
                </article>
              </div>

              <div className="activity-funnel-grid">
                <article
                  className="activity-funnel-step"
                  title="Количество уникальных сессий, в которых было событие showcase_open."
                >
                  <span>Сессии с открытием витрины</span>
                  <strong>{guestSummary.showcaseSessions.toLocaleString("ru-RU")}</strong>
                </article>
                <article
                  className="activity-funnel-step"
                  title="Количество уникальных сессий, в которых было хотя бы одно событие showcase_filters_apply."
                >
                  <span>Сессии с фильтрами</span>
                  <strong>{guestSummary.filtersSessions.toLocaleString("ru-RU")}</strong>
                </article>
                <article
                  className="activity-funnel-step"
                  title="Количество уникальных сессий, в которых было хотя бы одно событие showcase_item_open."
                >
                  <span>Сессии с открытием карточки</span>
                  <strong>{guestSummary.itemSessions.toLocaleString("ru-RU")}</strong>
                </article>
                <article
                  className="activity-funnel-step"
                  title="Количество уникальных сессий, в которых было хотя бы одно событие login_open."
                >
                  <span>Сессии с переходом в логин</span>
                  <strong>{guestSummary.loginSessions.toLocaleString("ru-RU")}</strong>
                </article>
                <article
                  className="activity-funnel-step"
                  title="Количество уникальных сессий, где после применения фильтров случался no-results."
                >
                  <span>Сессии с no-results</span>
                  <strong>{guestSummary.noResultsSessions.toLocaleString("ru-RU")}</strong>
                </article>
              </div>

              <div className="activity-breakdown-grid">
                <div className="activity-breakdown-card">
                  <h4>Источники (по сессиям)</h4>
                  {guestSummary.topSources.length === 0 ? (
                    <p className="empty">Нет данных.</p>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Источник</th>
                            <th>Сессий</th>
                            <th>Доля</th>
                          </tr>
                        </thead>
                        <tbody>
                          {guestSummary.topSources.map((item: GuestActivitySummarySourceItem) => (
                            <tr key={`source-${item.source}`}>
                              <td>{formatSourceLabel(item.source)}</td>
                              <td>{item.sessions.toLocaleString("ru-RU")}</td>
                              <td>{item.sharePercent.toFixed(2)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="activity-breakdown-card">
                  <h4>Часто меняемые фильтры</h4>
                  {guestSummary.topFilterFields.length === 0 ? (
                    <p className="empty">Нет данных.</p>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Поле фильтра</th>
                            <th>Изменений</th>
                            <th>Доля</th>
                          </tr>
                        </thead>
                        <tbody>
                          {guestSummary.topFilterFields.map(
                            (item: GuestActivitySummaryFilterFieldItem) => (
                              <tr key={`filter-${item.field}`}>
                                <td>{formatFilterFieldLabel(item.field)}</td>
                                <td>{item.count.toLocaleString("ru-RU")}</td>
                                <td>{item.sharePercent.toFixed(2)}%</td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="empty">Нет данных для дашборда.</p>
          )}
        </div>
      </div>

      {guestError && <p className="error">{guestError}</p>}

      <div className="panel activity-collapsible">
        <div className="activity-collapsible__header">
          <div className="activity-collapsible__body">
            <h3 className="activity-collapsible__title">Последние гостевые события</h3>
            <p className="activity-collapsible__meta">
              Всего событий: {guestTotal.toLocaleString("ru-RU")}
              {latestGuestEventTime ? ` · Последнее: ${latestGuestEventTime}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="secondary-button activity-collapsible__toggle"
            onClick={() => setIsGuestEventsExpanded((current) => !current)}
            aria-expanded={isGuestEventsExpanded}
          >
            {isGuestEventsExpanded ? "Свернуть" : "Развернуть"}
          </button>
        </div>
      </div>

      {isGuestEventsExpanded && (
      <div className="panel">
        {isGuestLoading ? (
          <p>Загрузка гостевой активности...</p>
        ) : guestItems.length === 0 ? (
          <p className="empty">Гостевые события не найдены.</p>
        ) : (
          <>
            <div className="table-wrap desktop-table">
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Session</th>
                    <th>Событие</th>
                    <th>Страница</th>
                    <th>Сущность</th>
                    <th>UTM source</th>
                    <th>Referrer</th>
                    <th>Payload</th>
                  </tr>
                </thead>
                <tbody>
                  {guestItems.map((item) => (
                    <tr key={`guest-event-${item.id}`}>
                      <td>{item.createdAt}</td>
                      <td>{item.sessionId}</td>
                      <td>{eventTypeLabel(item.eventType)}</td>
                      <td>{item.page || "-"}</td>
                      <td>{formatEntity(item.entityType, item.entityId)}</td>
                      <td>{textOrDash(item.utmSource)}</td>
                      <td>{textOrDash(item.referrer)}</td>
                      <td>
                        <code className="activity-payload">{formatPayload(item.payload)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mobile-cards">
              {guestItems.map((item) => (
                <article key={`guest-mobile-${item.id}`} className="mobile-card">
                  <div className="mobile-card__head">
                    <strong>{eventTypeLabel(item.eventType)}</strong>
                    <span className="mobile-card__meta">{item.createdAt}</span>
                  </div>
                  <dl className="mobile-card__list">
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Session</dt>
                      <dd className="mobile-card__value">{item.sessionId}</dd>
                    </div>
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Страница</dt>
                      <dd className="mobile-card__value">{item.page || "-"}</dd>
                    </div>
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">UTM source</dt>
                      <dd className="mobile-card__value">{textOrDash(item.utmSource)}</dd>
                    </div>
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Referrer</dt>
                      <dd className="mobile-card__value">{textOrDash(item.referrer)}</dd>
                    </div>
                    <div className="mobile-card__row">
                      <dt className="mobile-card__label">Payload</dt>
                      <dd className="mobile-card__value">
                        <code className="activity-payload">{formatPayload(item.payload)}</code>
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <div className="pager pager--compact">
              <button
                className="pager-button pager-button--nav"
                type="button"
                disabled={!canGoGuestPrev}
                onClick={() => setGuestPage((current) => Math.max(1, current - 1))}
              >
                ←
              </button>
              <span className="pager-mobile-status">
                Стр. {guestPage} из {guestTotalPages}
              </span>
              <button
                className="pager-button pager-button--nav"
                type="button"
                disabled={!canGoGuestNext}
                onClick={() => setGuestPage((current) => Math.min(guestTotalPages, current + 1))}
              >
                →
              </button>
            </div>
          </>
        )}
      </div>
      )}
    </section>
  );
}


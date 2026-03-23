import { useEffect, useMemo, useState } from "react";
import { getAdminCardFillness, getAdminMediaHealth } from "../api/client";
import type {
  AdminCardFillnessResponse,
  MediaHealthDailyItem,
  MediaHealthJobRunItem,
} from "../types/api";

const MEDIA_HEALTH_HISTORY_DAYS = 30;

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPercent(value: number): string {
  return `${value.toLocaleString("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function formatMetricDateLabel(metricDate: string): string {
  const [year, month, day] = metricDate.split("-");
  if (!year || !month || !day) {
    return metricDate;
  }

  return `${day}.${month}`;
}

function formatRatio(left: number, right: number): string {
  return `${left.toLocaleString("ru-RU")} / ${right.toLocaleString("ru-RU")}`;
}

function getFillnessToneClass(percent: number): string {
  if (percent >= 85) {
    return "is-good";
  }
  if (percent >= 65) {
    return "is-warn";
  }
  return "is-risk";
}

export function AdminOperationsPage() {
  const [mediaHealthHistory, setMediaHealthHistory] = useState<MediaHealthDailyItem[]>([]);
  const [mediaHealthLatestRun, setMediaHealthLatestRun] =
    useState<MediaHealthJobRunItem | null>(null);
  const [cardFillness, setCardFillness] = useState<AdminCardFillnessResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOperations(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const [mediaHealthResponse, cardFillnessResponse] = await Promise.all([
          getAdminMediaHealth(MEDIA_HEALTH_HISTORY_DAYS),
          getAdminCardFillness(),
        ]);

        if (!isMounted) {
          return;
        }

        setMediaHealthHistory(mediaHealthResponse.history ?? []);
        setMediaHealthLatestRun(mediaHealthResponse.recentRuns?.[0] ?? null);
        setCardFillness(cardFillnessResponse);
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }
        const nextError =
          caughtError instanceof Error
            ? caughtError.message
            : "Не удалось загрузить operations.";
        setError(nextError);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadOperations();
    return () => {
      isMounted = false;
    };
  }, []);

  const latestMediaHealth = useMemo<MediaHealthDailyItem | null>(() => {
    if (mediaHealthHistory.length === 0) {
      return null;
    }
    return mediaHealthHistory[mediaHealthHistory.length - 1];
  }, [mediaHealthHistory]);

  const latestMediaHealthFailedRun = useMemo(() => {
    if (
      mediaHealthLatestRun &&
      mediaHealthLatestRun.status === "failed" &&
      mediaHealthLatestRun.errorMessage
    ) {
      return mediaHealthLatestRun;
    }

    return null;
  }, [mediaHealthLatestRun]);

  const mediaHealthMetricRows = useMemo(
    () => [
      {
        key: "preview-alive-percent",
        label: "Превью живые, %",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success" ? formatPercent(item.previewAlivePercent) : "Ошибка",
      },
      {
        key: "preview-alive-ratio",
        label: "Превью: живые / всего",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success"
            ? formatRatio(item.previewAliveCount, item.previewCandidatesCount)
            : "Ошибка",
      },
      {
        key: "preview-missing",
        label: "Превью: отсутствуют",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success"
            ? item.previewMissingCount.toLocaleString("ru-RU")
            : "Ошибка",
      },
      {
        key: "external-alive-percent",
        label: "Внешние источники живые, %",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success" ? formatPercent(item.externalAlivePercent) : "Ошибка",
      },
      {
        key: "external-alive-ratio",
        label: "Внешние: живые / проверено",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success"
            ? formatRatio(item.externalAliveCount, item.externalCheckedWithSourceCount)
            : "Ошибка",
      },
      {
        key: "external-no-source",
        label: "Внешние: без source",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success"
            ? item.externalNoSourceCount.toLocaleString("ru-RU")
            : "Ошибка",
      },
      {
        key: "external-no-preview",
        label: "Внешние: без превью",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success"
            ? item.externalNoPreviewCount.toLocaleString("ru-RU")
            : "Ошибка",
      },
      {
        key: "external-errors",
        label: "Внешние: ошибки",
        value: (item: MediaHealthDailyItem) =>
          item.status === "success"
            ? item.externalErrorCount.toLocaleString("ru-RU")
            : "Ошибка",
      },
    ],
    [],
  );

  const worstFillnessTenant = useMemo(() => {
    if (!cardFillness || cardFillness.tenants.length === 0) {
      return null;
    }

    return cardFillness.tenants.reduce((worst, candidate) => {
      if (!worst || candidate.overallFillPercent < worst.overallFillPercent) {
        return candidate;
      }
      return worst;
    }, null as AdminCardFillnessResponse["tenants"][number] | null);
  }, [cardFillness]);

  const fillnessMetricsByFieldAndTenant = useMemo(() => {
    if (!cardFillness) {
      return new Map<string, Map<string, AdminCardFillnessResponse["tenants"][number]["fields"][number]>>();
    }

    const result = new Map<
      string,
      Map<string, AdminCardFillnessResponse["tenants"][number]["fields"][number]>
    >();

    cardFillness.tenants.forEach((tenant) => {
      tenant.fields.forEach((field) => {
        if (!result.has(field.key)) {
          result.set(field.key, new Map());
        }
        result.get(field.key)?.set(tenant.tenantId, field);
      });
    });

    return result;
  }, [cardFillness]);

  return (
    <section className="operations-page">
      <h1>Operations</h1>

      <div className="panel highlights-media-health">
        <div className="highlights-media-health__header">
          <h2>Актуальность медиа-данных</h2>
          <p>
            Ежесуточный контроль сохранности превью и доступности внешних источников.
          </p>
        </div>

        {isLoading ? (
          <p>Собираем данные по живости медиа...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : mediaHealthHistory.length === 0 ? (
          <p className="empty">
            Пока нет ежедневных срезов. Первый запуск заполнит таблицу.
          </p>
        ) : (
          <div className="highlights-media-health__content">
            <div className="highlights-media-health__kpis">
              <article className="highlights-media-health-kpi">
                <span>Превью живые</span>
                <strong>
                  {latestMediaHealth && latestMediaHealth.status === "success"
                    ? formatPercent(latestMediaHealth.previewAlivePercent)
                    : "—"}
                </strong>
                <p>
                  {latestMediaHealth && latestMediaHealth.status === "success"
                    ? formatRatio(
                        latestMediaHealth.previewAliveCount,
                        latestMediaHealth.previewCandidatesCount,
                      )
                    : "нет успешного среза"}
                </p>
              </article>
              <article className="highlights-media-health-kpi">
                <span>Внешние источники живые</span>
                <strong>
                  {latestMediaHealth && latestMediaHealth.status === "success"
                    ? formatPercent(latestMediaHealth.externalAlivePercent)
                    : "—"}
                </strong>
                <p>
                  {latestMediaHealth && latestMediaHealth.status === "success"
                    ? formatRatio(
                        latestMediaHealth.externalAliveCount,
                        latestMediaHealth.externalCheckedWithSourceCount,
                      )
                    : "нет успешного среза"}
                </p>
              </article>
              <article className="highlights-media-health-kpi">
                <span>Выборка внешних</span>
                <strong>
                  {latestMediaHealth && latestMediaHealth.status === "success"
                    ? latestMediaHealth.externalSampleRequested.toLocaleString("ru-RU")
                    : "—"}
                </strong>
                <p>позиций в суточном прогоне</p>
              </article>
              <article className="highlights-media-health-kpi">
                <span>Статус последнего запуска</span>
                <strong
                  className={
                    mediaHealthLatestRun?.status === "failed"
                      ? "is-danger"
                      : mediaHealthLatestRun?.status === "success"
                        ? "is-ok"
                        : ""
                  }
                >
                  {mediaHealthLatestRun?.status === "failed"
                    ? "Ошибка"
                    : mediaHealthLatestRun?.status === "success"
                      ? "Успех"
                      : mediaHealthLatestRun?.status === "running"
                        ? "В процессе"
                        : "—"}
                </strong>
                <p>
                  {mediaHealthLatestRun
                    ? formatDate(mediaHealthLatestRun.startedAt)
                    : "нет запусков"}
                </p>
              </article>
            </div>

            {latestMediaHealthFailedRun ? (
              <p className="highlights-media-health__run-error">
                Последний запуск завершился ошибкой: {latestMediaHealthFailedRun.errorMessage}
              </p>
            ) : null}

            <div className="highlights-media-health__table-wrap">
              <table className="highlights-media-health__table">
                <thead>
                  <tr>
                    <th>Метрика</th>
                    {mediaHealthHistory.map((item) => (
                      <th key={`metric-day-${item.metricDate}`}>
                        {formatMetricDateLabel(item.metricDate)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mediaHealthMetricRows.map((row) => (
                    <tr key={row.key}>
                      <th>{row.label}</th>
                      {mediaHealthHistory.map((item) => (
                        <td
                          key={`${row.key}-${item.metricDate}`}
                          className={item.status === "failed" ? "is-failed" : undefined}
                        >
                          {row.value(item)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {latestMediaHealth?.status === "success" &&
            latestMediaHealth.hostStats.length > 0 ? (
              <div className="highlights-media-health__hosts">
                <h3>Топ источников в последнем срезе</h3>
                <ul>
                  {latestMediaHealth.hostStats.slice(0, 5).map((host) => (
                    <li key={`host-${host.host}`}>
                      <span>{host.host}</span>
                      <strong>{formatPercent(host.alivePercent)}</strong>
                      <small>{formatRatio(host.alive, host.total)}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="panel operations-card-fillness">
        <div className="operations-card-fillness__header">
          <h2>Заполненность карточек</h2>
          <p>
            Процент заполнения ключевых полей по каждому лизингодателю для контроля
            качества данных.
          </p>
        </div>

        {isLoading ? (
          <p>Собираем метрики заполненности...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : !cardFillness || cardFillness.tenants.length === 0 ? (
          <p className="empty">Пока нет данных для расчёта заполненности карточек.</p>
        ) : (
          <div className="operations-card-fillness__content">
            <div className="operations-card-fillness__kpis">
              <article className="operations-card-fillness-kpi">
                <span>Лизингодатели</span>
                <strong>{cardFillness.totals.tenantCount.toLocaleString("ru-RU")}</strong>
                <p>в текущем срезе</p>
              </article>
              <article className="operations-card-fillness-kpi">
                <span>Лоты в расчёте</span>
                <strong>{cardFillness.totals.totalOffers.toLocaleString("ru-RU")}</strong>
                <p>актуальные карточки каталога</p>
              </article>
              <article className="operations-card-fillness-kpi">
                <span>Средняя заполненность</span>
                <strong>{formatPercent(cardFillness.totals.overallFillPercent)}</strong>
                <p>по всем ключевым полям</p>
              </article>
              <article className="operations-card-fillness-kpi">
                <span>Зона риска</span>
                <strong>
                  {worstFillnessTenant
                    ? formatPercent(worstFillnessTenant.overallFillPercent)
                    : "—"}
                </strong>
                <p>
                  {worstFillnessTenant
                    ? `${worstFillnessTenant.tenantLabel} — минимальный уровень`
                    : "нет данных"}
                </p>
              </article>
            </div>

            <div className="operations-card-fillness__table-wrap">
              <table className="operations-card-fillness__table">
                <thead>
                  <tr>
                    <th>Поле</th>
                    {cardFillness.tenants.map((tenant) => (
                      <th key={`fillness-tenant-${tenant.tenantId}`}>{tenant.tenantLabel}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cardFillness.fields.map((field) => (
                    <tr key={`fillness-field-${field.key}`}>
                      <th>{field.label}</th>
                      {cardFillness.tenants.map((tenant) => {
                        const metric =
                          fillnessMetricsByFieldAndTenant
                            .get(field.key)
                            ?.get(tenant.tenantId) ?? null;

                        if (!metric) {
                          return <td key={`${field.key}-${tenant.tenantId}`}>—</td>;
                        }

                        return (
                          <td
                            key={`${field.key}-${tenant.tenantId}`}
                            className={getFillnessToneClass(metric.fillPercent)}
                          >
                            <strong>{formatPercent(metric.fillPercent)}</strong>
                            <small>{formatRatio(metric.filledCount, tenant.totalOffers)}</small>
                          </td>
                        );
                      })}
                    </tr>
                  ))}

                  <tr className="is-overall">
                    <th>Итоговая заполненность</th>
                    {cardFillness.tenants.map((tenant) => (
                      <td
                        key={`fillness-overall-${tenant.tenantId}`}
                        className={getFillnessToneClass(tenant.overallFillPercent)}
                      >
                        <strong>{formatPercent(tenant.overallFillPercent)}</strong>
                        <small>{tenant.totalOffers.toLocaleString("ru-RU")} лотов</small>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>

            <p className="operations-card-fillness__updated">
              Обновлено: {formatDate(cardFillness.generatedAt)}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

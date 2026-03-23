import { useEffect, useMemo, useState } from "react";
import { getAdminMediaHealth } from "../api/client";
import type { MediaHealthDailyItem, MediaHealthJobRunItem } from "../types/api";

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

export function AdminOperationsPage() {
  const [mediaHealthHistory, setMediaHealthHistory] = useState<MediaHealthDailyItem[]>([]);
  const [mediaHealthLatestRun, setMediaHealthLatestRun] =
    useState<MediaHealthJobRunItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadOperations(): Promise<void> {
      setIsLoading(true);
      setError(null);
      try {
        const response = await getAdminMediaHealth(MEDIA_HEALTH_HISTORY_DAYS);
        if (!isMounted) {
          return;
        }

        setMediaHealthHistory(response.history ?? []);
        setMediaHealthLatestRun(response.recentRuns?.[0] ?? null);
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

  return (
    <section className="operations-page">
      <h1>Operations</h1>

      <div className="panel highlights-media-health">
        <div className="highlights-media-health__header">
          <h2>Актуальность медиа-данных</h2>
          <p>Ежесуточный контроль сохранности превью и доступности внешних источников.</p>
        </div>

        {isLoading ? (
          <p>Собираем данные по живости медиа...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : mediaHealthHistory.length === 0 ? (
          <p className="empty">Пока нет ежедневных срезов. Первый запуск заполнит таблицу.</p>
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
        <h2>Заполненность карточек</h2>
        <p className="operations-card-fillness__lead">
          Блок добавлен. Логика и расчет метрик будут подключены следующим этапом.
        </p>
      </div>
    </section>
  );
}

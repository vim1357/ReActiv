import { useEffect, useMemo, useState } from "react";
import {
  getCatalogFilters,
  getCatalogItems,
  getCatalogSummary,
  getImportBatches,
} from "../api/client";
import type { ImportTenantId } from "../types/api";

interface HighlightsKpiSnapshot {
  totalOffers: number;
  offersWithPreview: number;
  noPreviewOffers: number;
  photoCoveragePercent: number;
  coverageToGoalPercent: number;
  newThisWeekCount: number;
  previousImportNewCount: number | null;
  newThisWeekDeltaPercent: number | null;
  tenantCount: number;
  tenantLabels: string[];
  latestImportAt: string | null;
  importsLast30Days: number;
  importsLast7Days: number;
  importsPrev7Days: number;
  imports7dDeltaPercent: number | null;
}

interface WeeklyHighlightItem {
  period: string;
  title: string;
  points: string[];
}

interface MetricTrend {
  value: string;
  tone: "up" | "down" | "neutral";
}

interface HighlightMetric {
  label: string;
  value: string;
  help: string;
  caption?: string;
  trend?: MetricTrend;
  accent?: "primary" | "success";
}

interface HighlightMetricGroup {
  id: "supply" | "quality" | "operations";
  title: string;
  subtitle: string;
  metrics: HighlightMetric[];
}

const PHOTO_COVERAGE_GOAL_PERCENT = 85;

const TENANT_LABELS: Record<ImportTenantId, string> = {
  gpb: "ГПБ Лизинг",
  reso: "РЕСО-Лизинг",
  alpha: "Альфа-Лизинг",
  sovcombank: "Совкомбанк Лизинг",
};

const WEEKLY_HIGHLIGHTS: WeeklyHighlightItem[] = [
  {
    period: "19-22 февраля 2026",
    title: "Старт платформы",
    points: [
      "Запущен базовый контур ReActiv и продовый деплой.",
      "Собран фундамент каталога, карточек и админ-операций.",
      "Подготовлена основа для ролевого доступа и дальнейшего масштабирования.",
    ],
  },
  {
    period: "23 февраля - 1 марта 2026",
    title: "Admin и аналитика",
    points: [
      "Введены роли, управление пользователями и контроль доступа.",
      "Существенно улучшен мобильный UX витрины и таблиц.",
      "Запущены логи активности пользователей и гостей с первыми dashboard-метриками.",
    ],
  },
  {
    period: "2-8 марта 2026",
    title: "Стабильный импорт и бизнес-метрики",
    points: [
      "Импорт усилен предупреждениями, дельтами и историей загрузок.",
      "Запущен показатель новых позиций за неделю.",
      "Добавлены архитектурные guardrails и фиксированный import contract.",
    ],
  },
  {
    period: "9-15 марта 2026",
    title: "Мультилизинг и медиа-пайплайн",
    points: [
      "Подключен tenant-scoped импорт и нормализация техники между лизингодателями.",
      "Запущен VIN-based pipeline обогащения фото для RESO.",
      "Реализован защищенный bulk media sync API.",
    ],
  },
  {
    period: "16-20 марта 2026",
    title: "Масштабирование supply и скорости",
    points: [
      "Добавлены Альфа-Лизинг и Совкомбанк Лизинг.",
      "Запущен media sync pipeline для Альфы и расширена классификация импорта.",
      "Внедрен блок performance-улучшений по API, фильтрам и превью-медиа.",
      "Запущены избранное и улучшения админ-аналитики.",
    ],
  },
];

const NEXT_30_DAYS: string[] = [
  "Довести покрытие карточек фото до целевого уровня и стабилизировать источники медиа.",
  "Подключать новых лизингодателей через стандартный import onboarding с soft-мэппингом.",
  "Усилить воронку: сортировка, сигналы интереса, конверсионные сценарии.",
  "Подготовить investor-ready отчетность на базе автосводки в админке.",
];

function parseDateMs(raw: string): number | null {
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

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

function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "н/д";
  }

  if (Math.abs(value) < 0.05) {
    return "0%";
  }

  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function getDeltaPercent(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
}

function getTrendTone(value: number | null): "up" | "down" | "neutral" {
  if (value === null || Math.abs(value) < 0.05) {
    return "neutral";
  }

  return value > 0 ? "up" : "down";
}

function getProductStatus(snapshot: HighlightsKpiSnapshot | null): {
  label: string;
  description: string;
} {
  if (!snapshot) {
    return {
      label: "Обновление данных",
      description: "Собираем актуальную сводку по продукту.",
    };
  }

  if (snapshot.tenantCount >= 4 && snapshot.photoCoveragePercent >= 70) {
    return {
      label: "Scale Mode",
      description: "Платформа в фазе масштабирования supply и операционного контура.",
    };
  }

  if (snapshot.tenantCount >= 3) {
    return {
      label: "Growth Mode",
      description: "Платформа расширяет покрытие поставщиков и ускоряет витрину.",
    };
  }

  return {
    label: "Foundation Mode",
    description: "База продукта собрана, акцент на расширение источников и конверсии.",
  };
}

export function AdminHighlightsPage() {
  const [snapshot, setSnapshot] = useState<HighlightsKpiSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    let isMounted = true;

    async function loadSnapshot(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const [totalResult, withPreviewResult, summaryResult, filtersResult, importResult] =
          await Promise.all([
            getCatalogItems({ page: 1, pageSize: 1 }),
            getCatalogItems({ page: 1, pageSize: 1, onlyWithPreview: "true" }),
            getCatalogSummary(),
            getCatalogFilters(),
            getImportBatches(200),
          ]);

        if (!isMounted) {
          return;
        }

        const totalOffers = totalResult.pagination.total;
        const offersWithPreview = withPreviewResult.pagination.total;
        const noPreviewOffers = Math.max(0, totalOffers - offersWithPreview);
        const photoCoveragePercent =
          totalOffers > 0 ? Math.round((offersWithPreview / totalOffers) * 1000) / 10 : 0;
        const coverageToGoalPercent = Math.max(
          0,
          Math.round((PHOTO_COVERAGE_GOAL_PERCENT - photoCoveragePercent) * 10) / 10,
        );

        const tenantIds = (filtersResult.tenantId ?? []).filter((item) => item.trim().length > 0);
        const tenantLabels = tenantIds.map(
          (tenantId) => TENANT_LABELS[tenantId as ImportTenantId] ?? tenantId,
        );

        const successfulImports = importResult.items.filter(
          (item) => item.status === "completed" || item.status === "completed_with_errors",
        );

        const latestImportAt = successfulImports[0]?.created_at ?? importResult.items[0]?.created_at ?? null;
        const previousImportNewCount =
          successfulImports.length > 1 ? successfulImports[1].added_rows : null;
        const newThisWeekDeltaPercent = getDeltaPercent(
          summaryResult.newThisWeekCount,
          previousImportNewCount,
        );

        const nowMs = Date.now();
        const dayMs = 24 * 60 * 60 * 1000;
        const last7From = nowMs - 7 * dayMs;
        const prev7From = nowMs - 14 * dayMs;

        const importsLast30Days = successfulImports.filter((item) => {
          const createdAtMs = parseDateMs(item.created_at);
          return createdAtMs !== null && createdAtMs >= nowMs - 30 * dayMs;
        }).length;

        const importsLast7Days = successfulImports.filter((item) => {
          const createdAtMs = parseDateMs(item.created_at);
          return createdAtMs !== null && createdAtMs >= last7From;
        }).length;

        const importsPrev7Days = successfulImports.filter((item) => {
          const createdAtMs = parseDateMs(item.created_at);
          return createdAtMs !== null && createdAtMs >= prev7From && createdAtMs < last7From;
        }).length;

        const imports7dDeltaPercent = getDeltaPercent(importsLast7Days, importsPrev7Days || null);

        setSnapshot({
          totalOffers,
          offersWithPreview,
          noPreviewOffers,
          photoCoveragePercent,
          coverageToGoalPercent,
          newThisWeekCount: summaryResult.newThisWeekCount,
          previousImportNewCount,
          newThisWeekDeltaPercent,
          tenantCount: tenantIds.length,
          tenantLabels,
          latestImportAt,
          importsLast30Days,
          importsLast7Days,
          importsPrev7Days,
          imports7dDeltaPercent,
        });
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }

        if (caughtError instanceof Error) {
          setError(caughtError.message);
          return;
        }

        setError("Не удалось загрузить investor highlights.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadSnapshot();

    return () => {
      isMounted = false;
    };
  }, []);

  const productStatus = useMemo(() => getProductStatus(snapshot), [snapshot]);

  const heroTldr = useMemo(() => {
    if (!snapshot) {
      return [];
    }

    return [
      `Supply: ${snapshot.totalOffers.toLocaleString("ru-RU")} позиций от ${snapshot.tenantCount} лизингодателей.`,
      `New arrivals: +${snapshot.newThisWeekCount.toLocaleString("ru-RU")} за неделю (${formatSignedPercent(snapshot.newThisWeekDeltaPercent)} к прошлому циклу).`,
      `Coverage: ${snapshot.photoCoveragePercent.toFixed(1)}% карточек с превью (${snapshot.offersWithPreview.toLocaleString("ru-RU")} из ${snapshot.totalOffers.toLocaleString("ru-RU")}).`,
      `Operations: ${snapshot.importsLast7Days} импортов за 7 дней (${formatSignedPercent(snapshot.imports7dDeltaPercent)} vs предыдущие 7 дней).`,
    ];
  }, [snapshot]);

  const metricGroups = useMemo<HighlightMetricGroup[]>(() => {
    if (!snapshot) {
      return [];
    }

    return [
      {
        id: "supply",
        title: "Supply",
        subtitle: "Размер и приток предложения",
        metrics: [
          {
            label: "Позиции в каталоге",
            value: snapshot.totalOffers.toLocaleString("ru-RU"),
            help: "Текущий доступный объем предложения.",
            accent: "primary",
          },
          {
            label: "Новые за неделю",
            value: `+${snapshot.newThisWeekCount.toLocaleString("ru-RU")}`,
            help: "Темп обновления относительно прошлого импорт-цикла.",
            trend: {
              value: formatSignedPercent(snapshot.newThisWeekDeltaPercent),
              tone: getTrendTone(snapshot.newThisWeekDeltaPercent),
            },
          },
          {
            label: "Активные лизингодатели",
            value: snapshot.tenantCount.toLocaleString("ru-RU"),
            help: "Диверсификация и устойчивость supply-канала.",
            caption: snapshot.tenantLabels.join(", ") || "-",
          },
        ],
      },
      {
        id: "quality",
        title: "Quality / Coverage",
        subtitle: "Качество карточек и визуального контента",
        metrics: [
          {
            label: "Покрытие превью",
            value: `${snapshot.photoCoveragePercent.toFixed(1)}%`,
            help: "Доля карточек с визуально готовым превью на витрине.",
            accent: "success",
            caption:
              snapshot.coverageToGoalPercent > 0
                ? `До цели ${PHOTO_COVERAGE_GOAL_PERCENT}%: ${snapshot.coverageToGoalPercent.toFixed(1)} п.п.`
                : "Целевой порог покрытия достигнут",
          },
          {
            label: "Карточки с превью",
            value: snapshot.offersWithPreview.toLocaleString("ru-RU"),
            help: "Позиции, готовые к полноценному просмотру на витрине.",
          },
          {
            label: "Карточки без превью",
            value: snapshot.noPreviewOffers.toLocaleString("ru-RU"),
            help: "Зона ближайшей доработки для роста конверсии в просмотр.",
          },
        ],
      },
      {
        id: "operations",
        title: "Operations",
        subtitle: "Надежность и частота обновлений",
        metrics: [
          {
            label: "Импортов за 30 дней",
            value: snapshot.importsLast30Days.toLocaleString("ru-RU"),
            help: "Интенсивность обновления стока и рабочих циклов.",
            accent: "primary",
          },
          {
            label: "Импортов за последние 7 дней",
            value: snapshot.importsLast7Days.toLocaleString("ru-RU"),
            help: "Операционная активность в текущем темпе.",
            trend: {
              value: formatSignedPercent(snapshot.imports7dDeltaPercent),
              tone: getTrendTone(snapshot.imports7dDeltaPercent),
            },
            caption: `Предыдущие 7 дней: ${snapshot.importsPrev7Days.toLocaleString("ru-RU")}`,
          },
          {
            label: "Последний успешный импорт",
            value: formatDate(snapshot.latestImportAt),
            help: "Актуальность данных в контуре витрины.",
          },
        ],
      },
    ];
  }, [snapshot]);

  const summaryText = useMemo(() => {
    const lines: string[] = [];
    lines.push("ReActiv — Investor Highlights");
    lines.push(`Дата: ${new Date().toLocaleDateString("ru-RU")}`);
    lines.push(`Статус: ${productStatus.label}`);
    lines.push("");

    if (snapshot) {
      lines.push("TL;DR:");
      heroTldr.forEach((line) => lines.push(`- ${line}`));
      lines.push("");

      lines.push("Ключевые метрики:");
      lines.push(`- Позиции в каталоге: ${snapshot.totalOffers.toLocaleString("ru-RU")}`);
      lines.push(`- Позиции с превью: ${snapshot.offersWithPreview.toLocaleString("ru-RU")}`);
      lines.push(`- Покрытие превью: ${snapshot.photoCoveragePercent.toFixed(1)}%`);
      lines.push(`- Новые за неделю: +${snapshot.newThisWeekCount.toLocaleString("ru-RU")}`);
      lines.push(`- Активные лизингодатели: ${snapshot.tenantCount}`);
      lines.push(`- Импортов за 30 дней: ${snapshot.importsLast30Days}`);
      lines.push(`- Последний успешный импорт: ${formatDate(snapshot.latestImportAt)}`);
      lines.push("");
    }

    lines.push("Понедельные итоги:");
    WEEKLY_HIGHLIGHTS.forEach((week) => {
      lines.push(`${week.period} — ${week.title}`);
      week.points.forEach((point) => {
        lines.push(`- ${point}`);
      });
    });

    lines.push("");
    lines.push("Фокус на 30 дней:");
    NEXT_30_DAYS.forEach((item) => {
      lines.push(`- ${item}`);
    });

    return lines.join("\n");
  }, [heroTldr, productStatus.label, snapshot]);

  async function handleCopySummary(): Promise<void> {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }

    window.setTimeout(() => {
      setCopyStatus("idle");
    }, 1800);
  }

  return (
    <section className="highlights-page">
      <h1>Investor Highlights</h1>

      <div className="panel highlights-hero">
        <div className="highlights-hero__topline">
          <span className="highlights-status">{productStatus.label}</span>
          <span className="highlights-hero__updated">Последнее обновление: {formatDate(snapshot?.latestImportAt ?? null)}</span>
        </div>

        <div className="highlights-hero__grid">
          <div className="highlights-hero__main">
            <h2>Weekly snapshot для инвесторов и стейкхолдеров</h2>
            <p className="highlights-hero__subtitle">{productStatus.description}</p>

            {isLoading ? (
              <p>Собираем TL;DR...</p>
            ) : error ? (
              <p className="error">{error}</p>
            ) : (
              <ul className="highlights-hero__tldr">
                {heroTldr.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </div>

          <aside className="highlights-hero__aside">
            <article className="highlights-snapshot-card">
              <span>Supply</span>
              <strong>{snapshot ? snapshot.totalOffers.toLocaleString("ru-RU") : "-"}</strong>
              <p>позиций в каталоге</p>
            </article>
            <article className="highlights-snapshot-card">
              <span>Coverage</span>
              <strong>{snapshot ? `${snapshot.photoCoveragePercent.toFixed(1)}%` : "-"}</strong>
              <p>карточек с превью</p>
            </article>
            <article className="highlights-snapshot-card">
              <span>Cadence</span>
              <strong>{snapshot ? snapshot.importsLast7Days.toLocaleString("ru-RU") : "-"}</strong>
              <p>импортов за 7 дней</p>
            </article>
            <button type="button" className="secondary-button highlights-copy-button" onClick={() => void handleCopySummary()}>
              {copyStatus === "success" ? "Скопировано" : copyStatus === "error" ? "Ошибка копирования" : "Скопировать investor summary"}
            </button>
          </aside>
        </div>
      </div>

      <div className="panel">
        <h2>Ключевые метрики</h2>
        {isLoading ? (
          <p>Загрузка метрик...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : metricGroups.length === 0 ? (
          <p className="empty">Нет данных для отображения.</p>
        ) : (
          <div className="highlights-groups">
            {metricGroups.map((group) => (
              <article key={group.id} className="highlights-group-card">
                <header className="highlights-group-card__header">
                  <h3>{group.title}</h3>
                  <p>{group.subtitle}</p>
                </header>

                <div className="highlights-metrics-grid">
                  {group.metrics.map((metric) => (
                    <article
                      key={`${group.id}-${metric.label}`}
                      className={`highlights-metric-card${metric.accent ? ` highlights-metric-card--${metric.accent}` : ""}`}
                    >
                      <div className="highlights-metric-card__topline">
                        <span>{metric.label}</span>
                        {metric.trend && (
                          <em className={`highlights-trend highlights-trend--${metric.trend.tone}`}>
                            {metric.trend.tone === "up" ? "↑" : metric.trend.tone === "down" ? "↓" : "→"} {metric.trend.value}
                          </em>
                        )}
                      </div>
                      <strong>{metric.value}</strong>
                      <p>{metric.help}</p>
                      {metric.caption ? <small>{metric.caption}</small> : null}
                    </article>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Понедельные итоги (со старта)</h2>
        <div className="highlights-timeline">
          {WEEKLY_HIGHLIGHTS.map((week, index) => {
            const secondaryPoints = week.points.slice(1, 3);
            const hiddenCount = Math.max(0, week.points.length - 3);

            return (
              <article key={week.period} className="highlights-timeline__item">
                <div className="highlights-timeline__marker" aria-hidden>
                  {index + 1}
                </div>
                <div className="highlights-timeline__card">
                  <div className="highlights-timeline__meta">
                    <span>{week.period}</span>
                    <span>Спринт {index + 1}</span>
                  </div>
                  <h3>{week.title}</h3>
                  <p className="highlights-timeline__lead">{week.points[0]}</p>
                  {secondaryPoints.length > 0 ? (
                    <ul>
                      {secondaryPoints.map((point) => (
                        <li key={point}>{point}</li>
                      ))}
                    </ul>
                  ) : null}
                  {hiddenCount > 0 ? (
                    <p className="highlights-timeline__more">+{hiddenCount} дополнительных достижения</p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <h2>Фокус на 30 дней</h2>
        <ol className="highlights-next-grid">
          {NEXT_30_DAYS.map((item) => (
            <li key={item}>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

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
  stockValueRub: number | null;
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
  tenantGrowthPoints: TenantGrowthPoint[];
}

interface WeeklyHighlightItem {
  period: string;
  title: string;
  points: string[];
}

interface TenantGrowthPoint {
  tenantId: ImportTenantId;
  label: string;
  shortLabel: string;
  stockCount: number;
  cumulativeStock: number;
  cumulativeTenantCount: number;
}

interface HighlightMetric {
  label: string;
  value: string;
  help: string;
  caption?: string;
}

interface HighlightMetricGroup {
  id: "supply" | "quality";
  title: string;
  subtitle: string;
  metrics: HighlightMetric[];
}

const PHOTO_COVERAGE_GOAL_PERCENT = 85;
const TENANT_GROWTH_ORDER: ImportTenantId[] = ["gpb", "reso", "alpha", "sovcombank"];

const TENANT_LABELS: Record<ImportTenantId, string> = {
  gpb: "ГПБ Лизинг",
  reso: "РЕСО-Лизинг",
  alpha: "Альфа-Лизинг",
  sovcombank: "Совкомбанк Лизинг",
};

const TENANT_SHORT_LABELS: Record<ImportTenantId, string> = {
  gpb: "ГПБ",
  reso: "РЕСО",
  alpha: "АЛЬФА",
  sovcombank: "СОВКОМ",
};

const WEEKLY_HIGHLIGHTS: WeeklyHighlightItem[] = [
  {
    period: "19-22 февраля 2026",
    title: "Старт платформы",
    points: [
      "Запущен production-контур ReActiv с автодеплоем и стабильным релизным циклом.",
      "Собран базовый каталог: витрина, карточка лота, фильтры и пагинация.",
      "Сформирован фундамент доменной модели: офферы, импортные партии, история изменений.",
      "Подготовлен multi-source foundation для подключения новых лизингодателей.",
    ],
  },
  {
    period: "23 февраля - 1 марта 2026",
    title: "Admin и аналитика",
    points: [
      "Реализован ролевой контур доступа и управление пользователями в админ-панели.",
      "Запущен трекинг активности пользователей и ключевых действий в витрине.",
      "Собран первый управленческий дашборд по событиям и поведению пользователей.",
      "Усилен UX в мобильных сценариях каталога и административных таблиц.",
    ],
  },
  {
    period: "2-8 марта 2026",
    title: "Надежный импорт и бизнес-метрики",
    points: [
      "Импортный пайплайн усилен валидацией, предупреждениями и аудитом загрузок по батчам.",
      "Введены дельты между партиями и контроль недельного прироста стока.",
      "Зафиксирован импортный контракт и архитектурные guardrails для масштабирования.",
      "Стабилизированы процессы ручной загрузки и контроль качества входящих данных.",
    ],
  },
  {
    period: "9-15 марта 2026",
    title: "Multi-source и медиа-пайплайн",
    points: [
      "Запущен tenant-scoped импорт: единая витрина для нескольких источников стока.",
      "Добавлена нормализация категорий техники и брендов между разными форматами файлов.",
      "Реализован VIN-based media pipeline для RESO с массовым пост-импортным обновлением.",
      "Поднят защищенный API синхронизации медиа и диагностика ошибок источников.",
    ],
  },
  {
    period: "16-20 марта 2026",
    title: "Масштабирование, performance и highlights",
    points: [
      "Подключены Альфа-Лизинг и Совкомбанк Лизинг, расширен сток и география предложения.",
      "Запущен media pipeline для Альфы и расширены правила классификации новых файлов.",
      "Реализован пакет performance-оптимизаций витрины: API, фильтры, превью и загрузка карточек.",
      "Собраны user/admin-улучшения: избранное и раздел Highlights с управленческой сводкой.",
    ],
  },
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

function formatCompactK(value: number): string {
  if (value >= 1000) {
    const compactValue = Math.round((value / 1000) * 10) / 10;
    return `${compactValue.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}k`;
  }

  return value.toLocaleString("ru-RU");
}

function formatCurrencyRub(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  const billions = value / 1_000_000_000;
  const formatted = billions.toLocaleString("ru-RU", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${formatted} млрд ₽`;
}

function getNiceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) {
    return 1;
  }

  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  if (normalized <= 1) {
    return magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }
  return 10 * magnitude;
}

function buildYAxisTicks(maxValue: number, targetTickCount = 5): {
  axisMax: number;
  ticks: number[];
} {
  const safeMax = Math.max(1, Math.ceil(maxValue));
  const step = getNiceStep(safeMax / targetTickCount);
  const axisMax = Math.ceil(safeMax / step) * step;
  const tickCount = Math.max(2, Math.round(axisMax / step));
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => index * step);
  return { axisMax, ticks };
}

function formatAxisValue(value: number): string {
  if (value >= 1000) {
    const compact = value / 1000;
    const precision = compact >= 10 ? 0 : 1;
    return `${compact.toLocaleString("ru-RU", {
      minimumFractionDigits: 0,
      maximumFractionDigits: precision,
    })}k`;
  }
  return value.toLocaleString("ru-RU");
}

function getDeltaPercent(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
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
      label: "Режим масштабирования",
      description: "Платформа в фазе активного расширения стока и ускорения витрины.",
    };
  }

  if (snapshot.tenantCount >= 3) {
    return {
      label: "Режим роста",
      description: "Платформа расширяет покрытие источников и качество карточек.",
    };
  }

  return {
    label: "Базовый режим",
    description: "Базовый контур собран, фокус на масштабирование стока и контента.",
  };
}

interface GrowthChartPoint {
  stepLabel: string;
  value: number;
  detail: string;
}

interface InvestorGrowthChartProps {
  title: string;
  subtitle: string;
  points: GrowthChartPoint[];
}

function InvestorGrowthChart({
  title,
  subtitle,
  points,
}: InvestorGrowthChartProps) {
  const left = 52;
  const right = 18;
  const top = 24;
  const bottom = 58;
  const categoriesCount = points.length + 1;
  const minCategorySpacing = 112;
  const width = Math.max(
    700,
    left + right + Math.max(1, categoriesCount - 1) * minCategorySpacing,
  );
  const height = 300;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const denseXLabels = categoriesCount >= 8;
  const barWidth = Math.max(44, Math.min(86, plotWidth / Math.max(3, categoriesCount * 1.45)));

  const contributions = useMemo(
    () =>
      points.map((point, index) => {
        const previousValue = index === 0 ? 0 : Math.max(0, points[index - 1].value);
        const currentValue = Math.max(0, point.value);
        const contribution = Math.max(0, currentValue - previousValue);
        return {
          ...point,
          previousValue,
          currentValue,
          contribution,
        };
      }),
    [points],
  );

  const totalValue = contributions[contributions.length - 1]?.currentValue ?? 0;
  const { axisMax: yAxisMax, ticks: yTickValues } = useMemo(
    () => buildYAxisTicks(Math.max(1, totalValue), 5),
    [totalValue],
  );

  const valueToY = (value: number): number =>
    top + plotHeight - (Math.min(Math.max(0, value), yAxisMax) / yAxisMax) * plotHeight;

  const xCenters = useMemo(
    () =>
      Array.from({ length: categoriesCount }, (_, index) =>
        categoriesCount > 1
          ? left + barWidth / 2 + 8 + (index / (categoriesCount - 1)) * (plotWidth - barWidth - 16)
          : left + plotWidth / 2,
      ),
    [barWidth, categoriesCount, left, plotWidth],
  );

  const waterfallBars = useMemo(
    () =>
      contributions.map((item, index) => {
        const yStart = valueToY(item.previousValue);
        const yEnd = valueToY(item.currentValue);
        const topY = Math.min(yStart, yEnd);
        const barHeight = Math.max(2, Math.abs(yEnd - yStart));
        return {
          ...item,
          index,
          centerX: xCenters[index],
          x: xCenters[index] - barWidth / 2,
          topY,
          barHeight,
          opacity: Math.max(0.5, 0.94 - index * 0.09),
        };
      }),
    [barWidth, contributions, xCenters],
  );

  const connectorLines = useMemo(
    () =>
      waterfallBars.slice(0, -1).map((bar, index) => ({
        x1: bar.x + barWidth,
        x2: xCenters[index + 1] - barWidth / 2,
        y: valueToY(bar.currentValue),
      })),
    [barWidth, waterfallBars, xCenters],
  );

  const totalCenterX = xCenters[categoriesCount - 1] ?? left + plotWidth;
  const totalTopY = valueToY(totalValue);
  const totalBarHeight = Math.max(2, top + plotHeight - totalTopY);
  const legendItems = useMemo(
    () =>
      waterfallBars.map((bar) => ({
        stepLabel: bar.stepLabel,
        contribution: bar.contribution,
        sharePercent: totalValue > 0 ? (bar.contribution / totalValue) * 100 : 0,
      })),
    [totalValue, waterfallBars],
  );

  return (
    <article className="highlights-chart-card">
      <header className="highlights-chart-card__header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>

      <div className="highlights-chart-card__svg-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
          style={{ minWidth: "100%", width, height: "auto" }}
        >
          {yTickValues.map((value) => {
            const y = valueToY(value);
            return (
              <g key={`waterfall-grid-${value}`}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  className="highlights-chart-card__grid-line"
                />
                <text
                  x={left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className="highlights-chart-card__axis-label"
                >
                  {formatAxisValue(value)}
                </text>
              </g>
            );
          })}

          {connectorLines.map((line, index) => (
            <line
              key={`waterfall-connector-${index}`}
              x1={line.x1}
              y1={line.y}
              x2={line.x2}
              y2={line.y}
              className="highlights-waterfall__connector"
            />
          ))}

          {waterfallBars.map((bar, index) => (
            <g key={`waterfall-bar-${bar.stepLabel}`}>
              <rect
                x={bar.x}
                y={bar.topY}
                width={barWidth}
                height={bar.barHeight}
                rx={5}
                ry={5}
                className="highlights-waterfall__bar"
                style={{ opacity: bar.opacity }}
              />
              <text
                x={index === 0 ? bar.centerX + 12 : bar.centerX}
                y={Math.max(top + 12, bar.topY - (index === 0 ? 14 : 9))}
                textAnchor="middle"
                className="highlights-waterfall__delta-label"
              >
                {`${index === 0 ? "" : "+"}${formatCompactK(bar.contribution)}`}
              </text>
              <text
                x={bar.centerX}
                y={height - 16}
                textAnchor="middle"
                className={`highlights-chart-card__x-label${
                  denseXLabels ? " is-dense" : ""
                }`}
              >
                {bar.stepLabel}
              </text>
            </g>
          ))}

          <g>
            <rect
              x={totalCenterX - barWidth / 2}
              y={totalTopY}
              width={barWidth}
              height={totalBarHeight}
              rx={6}
              ry={6}
              className="highlights-waterfall__bar is-total"
            />
            <text
              x={totalCenterX}
              y={totalTopY - 10}
              textAnchor="middle"
              className="highlights-waterfall__total-label"
            >
              {formatCompactK(totalValue)}
            </text>
            <text
              x={totalCenterX}
              y={height - 16}
              textAnchor="middle"
              className={`highlights-chart-card__x-label${
                denseXLabels ? " is-dense" : ""
              }`}
            >
              ИТОГО
            </text>
          </g>
        </svg>
      </div>

      <div className="highlights-waterfall__legend" aria-label="Вклад лизингодателей">
        {legendItems.map((item) => (
          <div key={`contribution-${item.stepLabel}`} className="highlights-waterfall__legend-item">
            <span>{item.stepLabel}</span>
            <strong>{`+${formatCompactK(item.contribution)}`}</strong>
            <small>{`${item.sharePercent.toFixed(1)}%`}</small>
          </div>
        ))}
        <div className="highlights-waterfall__legend-item is-total">
          <span>ИТОГО</span>
          <strong>{totalValue.toLocaleString("ru-RU")}</strong>
          <small>100%</small>
        </div>
      </div>
    </article>
  );
}

export function AdminHighlightsPage() {
  const [snapshot, setSnapshot] = useState<HighlightsKpiSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSnapshot(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const [
          totalResult,
          withPreviewResult,
          summaryResult,
          filtersResult,
          importResult,
          ...tenantTotalsResults
        ] =
          await Promise.all([
            getCatalogItems({ page: 1, pageSize: 1 }),
            getCatalogItems({ page: 1, pageSize: 1, onlyWithPreview: "true" }),
            getCatalogSummary(),
            getCatalogFilters(),
            getImportBatches(200),
            ...TENANT_GROWTH_ORDER.map((tenantId) =>
              getCatalogItems({ page: 1, pageSize: 1, tenantId }),
            ),
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

        const tenantRawPoints = TENANT_GROWTH_ORDER.map((tenantId, index) => ({
          tenantId,
          label: TENANT_LABELS[tenantId],
          shortLabel: TENANT_SHORT_LABELS[tenantId],
          stockCount: tenantTotalsResults[index]?.pagination.total ?? 0,
        })).filter((point) => point.stockCount > 0);

        let runningStock = 0;
        let runningTenantCount = 0;
        const tenantGrowthPoints: TenantGrowthPoint[] = tenantRawPoints.map((point) => {
          runningStock += point.stockCount;
          runningTenantCount += 1;
          return {
            ...point,
            cumulativeStock: runningStock,
            cumulativeTenantCount: runningTenantCount,
          };
        });

        setSnapshot({
          totalOffers,
          offersWithPreview,
          noPreviewOffers,
          photoCoveragePercent,
          stockValueRub:
            typeof summaryResult.stockValueRub === "number" &&
            Number.isFinite(summaryResult.stockValueRub)
              ? summaryResult.stockValueRub
              : null,
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
          tenantGrowthPoints,
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

  const heroSummary = useMemo(() => {
    if (!snapshot) {
      return [];
    }

    return [
      `В каталоге ${snapshot.totalOffers.toLocaleString("ru-RU")} позиций, чистый прирост за неделю: +${snapshot.newThisWeekCount.toLocaleString("ru-RU")}.`,
      `Активных лизингодателей: ${snapshot.tenantCount.toLocaleString("ru-RU")}. Покрытие превью: ${snapshot.photoCoveragePercent.toFixed(1)}% (${snapshot.offersWithPreview.toLocaleString("ru-RU")} из ${snapshot.totalOffers.toLocaleString("ru-RU")}).`,
    ];
  }, [snapshot]);

  const metricGroups = useMemo<HighlightMetricGroup[]>(() => {
    if (!snapshot) {
      return [];
    }

    return [
      {
        id: "supply",
        title: "Экономика предложения",
        subtitle: "Ключевые бизнес-показатели",
        metrics: [
          {
            label: "Новые за неделю",
            value: `+${snapshot.newThisWeekCount.toLocaleString("ru-RU")}`,
            help: "Добавлено за последние 7 дней.",
          },
          {
            label: "Объем стока, ₽",
            value: formatCurrencyRub(snapshot.stockValueRub),
            help: "Суммарная стоимость каталога.",
            caption:
              snapshot.stockValueRub === null
                ? "Временная заглушка до backend-агрегации"
                : undefined,
          },
        ],
      },
      {
        id: "quality",
        title: "Покрытие контента",
        subtitle: "Текущее состояние витрины",
        metrics: [
          {
            label: "Карточки с превью",
            value: snapshot.offersWithPreview.toLocaleString("ru-RU"),
            help: "С фото превью.",
          },
          {
            label: "Карточки без превью",
            value: snapshot.noPreviewOffers.toLocaleString("ru-RU"),
            help: "Без фото превью.",
          },
        ],
      },
    ];
  }, [snapshot]);

  const stockGrowthChartPoints = useMemo<GrowthChartPoint[]>(() => {
    if (!snapshot) {
      return [];
    }

    return snapshot.tenantGrowthPoints.map((point) => ({
      stepLabel: point.shortLabel,
      value: point.cumulativeStock,
      detail: `${point.label}: +${point.stockCount.toLocaleString("ru-RU")} позиций`,
    }));
  }, [snapshot]);

  return (
    <section className="highlights-page">
      <h1>Сводка</h1>

      <div className="panel highlights-hero">
        <div className="highlights-hero__topline">
          <span className="highlights-status">{productStatus.label}</span>
          <span className="highlights-hero__updated">Последнее обновление: {formatDate(snapshot?.latestImportAt ?? null)}</span>
        </div>

        <div className="highlights-hero__grid">
          <div className="highlights-hero__main">
            <h2>Недельная сводка</h2>

            {isLoading ? (
              <p>Собираем краткую сводку...</p>
            ) : error ? (
              <p className="error">{error}</p>
            ) : (
              <div className="highlights-hero__summary-card">
                {heroSummary.map((line) => (
                  <p key={line} className="highlights-hero__summary-line">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </div>

          <aside className="highlights-hero__aside">
            <article className="highlights-snapshot-card">
              <span>Сток</span>
              <strong>{snapshot ? snapshot.totalOffers.toLocaleString("ru-RU") : "-"}</strong>
              <p>всего позиций</p>
            </article>
            <article className="highlights-snapshot-card">
              <span>Новые за неделю</span>
              <strong>{snapshot ? `+${snapshot.newThisWeekCount.toLocaleString("ru-RU")}` : "-"}</strong>
              <p>за последние 7 дней</p>
            </article>
            <article className="highlights-snapshot-card">
              <span>Лизингодатели</span>
              <strong>{snapshot ? snapshot.tenantCount.toLocaleString("ru-RU") : "-"}</strong>
              <p>активных источника</p>
            </article>
            <article className="highlights-snapshot-card">
              <span>Объем стока, ₽</span>
              <strong>{snapshot ? formatCurrencyRub(snapshot.stockValueRub) : "-"}</strong>
              <p>суммарная стоимость каталога</p>
            </article>
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
                      className="highlights-metric-card"
                    >
                      <div className="highlights-metric-card__topline">
                        <span>{metric.label}</span>
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
        {isLoading ? (
          <p>Строим графики...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : stockGrowthChartPoints.length < 2 ? (
          <p className="empty">Недостаточно этапов для построения графика.</p>
        ) : (
          <div className="highlights-charts-stack">
            <InvestorGrowthChart
              title="Вклад лизингодателей в текущий сток"
              subtitle={
                snapshot
                  ? `Как сформирован текущий объем каталога (${snapshot.totalOffers.toLocaleString("ru-RU")} позиций)`
                  : "Как сформирован текущий объем каталога"
              }
              points={stockGrowthChartPoints}
            />
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Понедельные итоги</h2>
        <div className="highlights-timeline">
          {WEEKLY_HIGHLIGHTS.map((week, index) => {
            const secondaryPoints = week.points.slice(1);

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
                </div>
              </article>
            );
          })}
        </div>
      </div>

    </section>
  );
}

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
      "Поднят production-контур ReActiv с автодеплоем из GitHub и стабильным релизным циклом.",
      "Собран базовый домен данных: офферы, импортные партии и история изменений по загрузкам.",
      "Собран базовый backend-контракт каталога: список, карточка лота, фильтры, пагинация.",
      "Запущен первый импорт лизингового стока и базовая нормализация полей под витрину.",
      "Подготовлен фундамент multi-tenant архитектуры для подключения новых лизингодателей.",
    ],
  },
  {
    period: "23 февраля - 1 марта 2026",
    title: "Admin и аналитика",
    points: [
      "Реализован ролевой контур доступа и управление пользователями через админ-панель.",
      "Введен журнал активности: просмотры, переходы, heartbeat-события, действия в витрине.",
      "Собран первый admin-dashboard по операционным событиям и пользовательской активности.",
      "Существенно усилен UX на мобильных сценариях каталога и административных таблиц.",
    ],
  },
  {
    period: "2-8 марта 2026",
    title: "Стабильный импорт и бизнес-метрики",
    points: [
      "Импортный пайплайн усилен валидацией, предупреждениями и историей загрузок по батчам.",
      "Добавлены дельты между партиями и показатель новых позиций за цикл/неделю.",
      "Зафиксирован import contract и архитектурные guardrails для безопасного масштабирования.",
      "Стабилизированы сценарии ручной загрузки файлов и контроль качества входящих данных.",
    ],
  },
  {
    period: "9-15 марта 2026",
    title: "Мультилизинг и медиа-пайплайн",
    points: [
      "Запущен tenant-scoped импорт: единая витрина для нескольких лизингодателей.",
      "Добавлена нормализация типов техники и брендов между разными форматами источников.",
      "Реализован VIN-based media enrichment для RESO с пост-импортным массовым обновлением.",
      "Собран защищенный bulk media sync API с токеном и контролем размера батчей.",
      "Введены fallback-механики и диагностика ошибок медиа-источников для ускоренного восстановления.",
    ],
  },
  {
    period: "16-20 марта 2026",
    title: "Масштабирование supply и скорости",
    points: [
      "Подключены новые источники supply: Альфа-Лизинг и Совкомбанк Лизинг.",
      "Запущен media sync pipeline для Альфы и расширены правила классификации/soft-мэппинга новых файлов.",
      "Внедрены performance-улучшения витрины: API, фильтры, превью и загрузка карточек.",
      "Реализован функционал избранного для авторизованных пользователей (витрина + карточка).",
      "Собран Investor/Highlights-раздел с ключевыми метриками, графиками роста и weekly snapshot.",
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

function formatCompactK(value: number): string {
  if (value >= 1000) {
    const compactValue = Math.round((value / 1000) * 10) / 10;
    return `${compactValue.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}k`;
  }

  return value.toLocaleString("ru-RU");
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

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
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

interface InvestorSimpleLessorGrowthProps {
  title: string;
  subtitle: string;
  points: GrowthChartPoint[];
}

function buildSvgPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) {
    return "";
  }

  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");
}

function InvestorGrowthChart({
  title,
  subtitle,
  points,
}: InvestorGrowthChartProps) {
  const left = 44;
  const right = 14;
  const top = 24;
  const bottom = 52;
  const minStepSpacing = 96;
  const width = Math.max(
    660,
    left + right + Math.max(1, points.length - 1) * minStepSpacing,
  );
  const height = 270;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const denseLabels = points.length >= 7;
  const maxPointValue = useMemo(
    () => Math.max(1, ...points.map((point) => point.value)),
    [points],
  );
  const { axisMax: yAxisMax, ticks: yTickValues } = useMemo(
    () => buildYAxisTicks(maxPointValue, 5),
    [maxPointValue],
  );
  const chartPoints = useMemo(
    () =>
      points.map((item, index) => {
        const ratioX = points.length > 1 ? index / (points.length - 1) : 0;
        const x = left + ratioX * plotWidth;
        const y =
          top + plotHeight - (Math.min(item.value, yAxisMax) / yAxisMax) * plotHeight;
        return { ...item, x, y };
      }),
    [left, plotHeight, plotWidth, points, top, yAxisMax],
  );
  const valueLabelLayouts = useMemo(() => {
    type ValueLabelAnchor = "start" | "middle" | "end";
    interface ValueLabelLayout {
      x: number;
      y: number;
      anchor: ValueLabelAnchor;
      width: number;
      height: number;
    }

    const labelHeight = 12;
    const axisSafeLeft = left + 12;
    const safeRight = width - right - 12;
    const minGridGap = 12;
    const minPointGap = 14;
    const topBound = top + labelHeight + 2;
    const bottomBound = top + plotHeight - 8;
    const gridYs = yTickValues.map(
      (value) => top + plotHeight - (value / yAxisMax) * plotHeight,
    );

    const getLabelEdges = (
      centerX: number,
      anchor: ValueLabelAnchor,
      textWidth: number,
    ): { leftEdge: number; rightEdge: number } => {
      if (anchor === "start") {
        return { leftEdge: centerX, rightEdge: centerX + textWidth };
      }
      if (anchor === "end") {
        return { leftEdge: centerX - textWidth, rightEdge: centerX };
      }
      return {
        leftEdge: centerX - textWidth / 2,
        rightEdge: centerX + textWidth / 2,
      };
    };

    const clampXToPlot = (
      valueX: number,
      anchor: ValueLabelAnchor,
      textWidth: number,
    ): number => {
      let x = valueX;
      if (anchor === "start") {
        x = Math.max(axisSafeLeft, Math.min(x, safeRight - textWidth));
        return x;
      }

      if (anchor === "end") {
        x = Math.min(safeRight, Math.max(x, axisSafeLeft + textWidth));
        return x;
      }

      const minCenter = axisSafeLeft + textWidth / 2;
      const maxCenter = safeRight - textWidth / 2;
      x = Math.max(minCenter, Math.min(x, maxCenter));
      return x;
    };

    const nudgeAwayFromGrid = (sourceY: number): number => {
      let y = sourceY;
      gridYs.forEach((gridY) => {
        const distance = Math.abs(y - gridY);
        if (distance < minGridGap) {
          const moveUp = y <= gridY;
          y = gridY + (moveUp ? -1 : 1) * (minGridGap + 2);
        }
      });
      return y;
    };

    const clampYToSafeZone = (
      sourceY: number,
      pointY: number,
      pointRadius: number,
      preferAbovePoint: boolean,
    ): number => {
      const maxAbovePointY = pointY - (pointRadius + minPointGap);
      let y = Math.min(sourceY, maxAbovePointY);
      y = Math.min(bottomBound, Math.max(topBound, y));

      if (preferAbovePoint && maxAbovePointY < topBound) {
        y = Math.min(
          bottomBound,
          Math.max(topBound, pointY + pointRadius + labelHeight + 4),
        );
      }

      return y;
    };

    const layouts: ValueLabelLayout[] = chartPoints.map((point, index) => {
      const isFirst = index === 0;
      const isLast = index === chartPoints.length - 1;
      const pointRadius = isLast ? 8.2 : 6.3;
      const labelText = formatCompactK(point.value);
      const textWidth = Math.max(34, labelText.length * 7);
      let anchor: ValueLabelAnchor = "middle";
      let x = point.x;

      if (isFirst) {
        anchor = "start";
        x += 14;
      } else if (isLast) {
        anchor = "end";
        x -= 6;
      }

      x = clampXToPlot(x, anchor, textWidth);

      let y = point.y - (pointRadius + 16);
      y = nudgeAwayFromGrid(y);
      y = clampYToSafeZone(y, point.y, pointRadius, true);
      y = nudgeAwayFromGrid(y);
      y = clampYToSafeZone(y, point.y, pointRadius, true);

      return {
        x,
        y,
        anchor,
        width: textWidth,
        height: labelHeight,
      };
    });

    for (let index = 1; index < layouts.length; index += 1) {
      const current = layouts[index];
      const previous = layouts[index - 1];
      const currentPoint = chartPoints[index];
      const isCurrentLast = index === chartPoints.length - 1;
      const currentPointRadius = isCurrentLast ? 8.2 : 6.3;

      const previousEdges = getLabelEdges(previous.x, previous.anchor, previous.width);
      const currentEdges = getLabelEdges(current.x, current.anchor, current.width);
      const horizontalOverlap =
        currentEdges.leftEdge <= previousEdges.rightEdge + 6 &&
        previousEdges.leftEdge <= currentEdges.rightEdge + 6;
      const verticalConflict = Math.abs(current.y - previous.y) < current.height + 3;

      if (horizontalOverlap && verticalConflict) {
        let movedY = previous.y - (current.height + 8);
        movedY = nudgeAwayFromGrid(movedY);
        movedY = clampYToSafeZone(movedY, currentPoint.y, currentPointRadius, true);

        if (movedY <= topBound + 1) {
          movedY = Math.min(
            bottomBound,
            Math.max(
              topBound,
              previous.y + current.height + currentPointRadius + minPointGap,
            ),
          );
          movedY = nudgeAwayFromGrid(movedY);
          movedY = clampYToSafeZone(movedY, currentPoint.y, currentPointRadius, false);
        }

        current.y = movedY;
      }
    }

    return layouts;
  }, [chartPoints, left, plotHeight, right, top, width, yAxisMax, yTickValues]);

  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);

  useEffect(() => {
    setActivePointIndex(null);
  }, [chartPoints.length]);

  const activePoint =
    activePointIndex === null ? null : (chartPoints[activePointIndex] ?? null);
  const linePath = buildSvgPath(chartPoints);
  const tooltipWidth = 244;
  const tooltipHeight = 62;
  const tooltipSafePadding = 12;
  const tooltipGap = 14;
  const tooltipLayout = useMemo(() => {
    if (!activePoint || activePointIndex === null) {
      return null;
    }

    const isFirst = activePointIndex === 0;
    const isLast = activePointIndex === chartPoints.length - 1;
    let x = activePoint.x - tooltipWidth / 2;
    if (isLast) {
      x = activePoint.x - tooltipWidth - tooltipGap;
    } else if (isFirst) {
      x = activePoint.x + tooltipGap;
    }

    x = Math.max(
      tooltipSafePadding,
      Math.min(x, width - tooltipSafePadding - tooltipWidth),
    );

    const maxTooltipY = top + plotHeight - tooltipHeight - 4;
    let y = activePoint.y - (tooltipHeight + tooltipGap);
    if (y < tooltipSafePadding) {
      y = Math.min(maxTooltipY, activePoint.y + tooltipGap);
    }
    y = Math.max(tooltipSafePadding, Math.min(y, maxTooltipY));

    return { x, y };
  }, [
    activePoint,
    activePointIndex,
    chartPoints.length,
    plotHeight,
    right,
    top,
    tooltipGap,
    tooltipHeight,
    tooltipSafePadding,
    tooltipWidth,
    width,
  ]);
  const tooltipDetail = activePoint ? truncateText(activePoint.detail, 44) : "";

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
          onMouseLeave={() => setActivePointIndex(null)}
        >
          {yTickValues.map((value) => {
            const y = top + plotHeight - (value / yAxisMax) * plotHeight;
            return (
              <g key={`y-grid-${value}`}>
                <line
                  x1={left}
                  y1={y}
                  x2={width - right}
                  y2={y}
                  className="highlights-chart-card__grid-line"
                />
                <text
                  x={left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="highlights-chart-card__axis-label"
                >
                  {formatAxisValue(value)}
                </text>
              </g>
            );
          })}

          {linePath ? (
            <path d={linePath} className="highlights-chart-card__line" />
          ) : null}

          {activePoint ? (
            <line
              x1={activePoint.x}
              y1={top}
              x2={activePoint.x}
              y2={top + plotHeight}
              className="highlights-chart-card__guide-line"
            />
          ) : null}

          {chartPoints.map((point, index) => {
            const isLast = index === chartPoints.length - 1;
            const isActive = index === activePointIndex;
            const valueLabelLayout = valueLabelLayouts[index];
            return (
            <g
              key={`point-${point.stepLabel}`}
              className={`highlights-chart-card__point-group${
                isLast ? " is-last" : ""
              }${isActive ? " is-active" : ""}`}
              onMouseEnter={() => setActivePointIndex(index)}
              onFocus={() => setActivePointIndex(index)}
            >
              <title>{point.detail}</title>
              <circle
                cx={point.x}
                cy={point.y}
                r={isLast ? 8.2 : 6.3}
                className="highlights-chart-card__point"
              />
              <text
                x={valueLabelLayout?.x ?? point.x}
                y={valueLabelLayout?.y ?? point.y - 14}
                textAnchor={valueLabelLayout?.anchor ?? "middle"}
                className="highlights-chart-card__value-label"
              >
                {formatCompactK(point.value)}
              </text>
              <text
                x={point.x}
                y={height - (denseLabels && index % 2 === 1 ? 14 : 24)}
                textAnchor="middle"
                className={`highlights-chart-card__x-label${
                  denseLabels ? " is-dense" : ""
                }`}
              >
                {point.stepLabel}
              </text>
            </g>
          );
          })}

          {activePoint && tooltipLayout ? (
            <g className="highlights-chart-card__tooltip">
              <rect
                x={tooltipLayout.x}
                y={tooltipLayout.y}
                width={tooltipWidth}
                height={tooltipHeight}
                rx={10}
                ry={10}
                className="highlights-chart-card__tooltip-bg"
              />
              <text
                x={tooltipLayout.x + 10}
                y={tooltipLayout.y + 18}
                className="highlights-chart-card__tooltip-title"
              >
                {activePoint.stepLabel}
              </text>
              <text
                x={tooltipLayout.x + 10}
                y={tooltipLayout.y + 38}
                className="highlights-chart-card__tooltip-value"
              >
                {activePoint.value.toLocaleString("ru-RU")} позиций
              </text>
              <text
                x={tooltipLayout.x + 10}
                y={tooltipLayout.y + 53}
                className="highlights-chart-card__tooltip-detail"
              >
                {tooltipDetail}
              </text>
            </g>
          ) : null}
        </svg>
      </div>

      <div className="highlights-chart-card__legend" aria-label="Этапы роста">
        {points.map((point, index) => (
          <button
            type="button"
            key={`legend-${point.stepLabel}`}
            className={`highlights-chart-card__legend-item${
              index === activePointIndex ? " is-active" : ""
            }`}
            title={point.detail}
            onMouseEnter={() => setActivePointIndex(index)}
            onMouseLeave={() => setActivePointIndex(null)}
            onFocus={() => setActivePointIndex(index)}
            onBlur={() => setActivePointIndex(null)}
          >
            <span className="highlights-chart-card__legend-dot" aria-hidden="true" />
            <em>{point.stepLabel}</em>
          </button>
        ))}
      </div>
    </article>
  );
}

function InvestorSimpleLessorGrowth({
  title,
  subtitle,
  points,
}: InvestorSimpleLessorGrowthProps) {
  return (
    <article className="highlights-lessor-growth">
      <header className="highlights-lessor-growth__header">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>

      <div className="highlights-lessor-growth__rail" aria-label={title}>
        {points.map((point, index) => (
          <div key={`lessor-step-${point.stepLabel}`} className="highlights-lessor-growth__step">
            <div className="highlights-lessor-growth__dot-wrap">
              <span className="highlights-lessor-growth__dot">{point.value}</span>
              {index < points.length - 1 ? (
                <span className="highlights-lessor-growth__line" aria-hidden />
              ) : null}
            </div>
            <strong>{point.stepLabel}</strong>
            <p>{point.detail}</p>
          </div>
        ))}
      </div>
    </article>
  );
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

  const heroTldr = useMemo(() => {
    if (!snapshot) {
      return [];
    }

    return [
      `Supply: ${snapshot.totalOffers.toLocaleString("ru-RU")} позиций от ${snapshot.tenantCount} лизингодателей.`,
      `New arrivals: +${snapshot.newThisWeekCount.toLocaleString("ru-RU")} за неделю.`,
      `Coverage: ${snapshot.photoCoveragePercent.toFixed(1)}% карточек с превью (${snapshot.offersWithPreview.toLocaleString("ru-RU")} из ${snapshot.totalOffers.toLocaleString("ru-RU")}).`,
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

  const lessorGrowthChartPoints = useMemo<GrowthChartPoint[]>(() => {
    if (!snapshot) {
      return [];
    }

    return snapshot.tenantGrowthPoints.map((point) => ({
      stepLabel: point.shortLabel,
      value: point.cumulativeTenantCount,
      detail: `${point.label}: этап ${point.cumulativeTenantCount}`,
    }));
  }, [snapshot]);

  const summaryText = useMemo(() => {
    const lines: string[] = [];
    lines.push("ReActiv — Highlights");
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
    }

    lines.push("Понедельные итоги:");
    WEEKLY_HIGHLIGHTS.forEach((week) => {
      lines.push(`${week.period} — ${week.title}`);
      week.points.forEach((point) => {
        lines.push(`- ${point}`);
      });
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
      <h1>Highlights</h1>

      <div className="panel highlights-hero">
        <div className="highlights-hero__topline">
          <span className="highlights-status">{productStatus.label}</span>
          <span className="highlights-hero__updated">Последнее обновление: {formatDate(snapshot?.latestImportAt ?? null)}</span>
        </div>

        <div className="highlights-hero__grid">
          <div className="highlights-hero__main">
            <h2>Weekly snapshot</h2>
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
              <span>Lessors</span>
              <strong>{snapshot ? snapshot.tenantCount.toLocaleString("ru-RU") : "-"}</strong>
              <p>активных лизингодателей</p>
            </article>
            <button type="button" className="secondary-button highlights-copy-button" onClick={() => void handleCopySummary()}>
              {copyStatus === "success" ? "Скопировано" : copyStatus === "error" ? "Ошибка копирования" : "Скопировать summary"}
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
        <h2>График роста по этапам подключения</h2>
        {isLoading ? (
          <p>Строим графики...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : stockGrowthChartPoints.length < 2 ? (
          <p className="empty">Недостаточно этапов для построения графика.</p>
        ) : (
          <div className="highlights-charts-stack">
            <InvestorGrowthChart
              title="Кумулятивный рост стока"
              subtitle="Этапы: ГПБ -> РЕСО -> АЛЬФА -> СОВКОМ (по доступным данным)"
              points={stockGrowthChartPoints}
            />
            <InvestorSimpleLessorGrowth
              title="Кумулятивный рост лизингодателей"
              subtitle="Рост числа активных источников в supply-цепочке"
              points={lessorGrowthChartPoints}
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

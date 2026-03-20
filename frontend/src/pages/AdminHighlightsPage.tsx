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
  photoCoveragePercent: number;
  newThisWeekCount: number;
  tenantCount: number;
  tenantLabels: string[];
  latestImportAt: string | null;
  importsLast30Days: number;
}

interface WeeklyHighlightItem {
  period: string;
  title: string;
  points: string[];
}

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
        const photoCoveragePercent =
          totalOffers > 0 ? Math.round((offersWithPreview / totalOffers) * 1000) / 10 : 0;

        const tenantIds = (filtersResult.tenantId ?? []).filter((item) => item.trim().length > 0);
        const tenantLabels = tenantIds.map(
          (tenantId) => TENANT_LABELS[tenantId as ImportTenantId] ?? tenantId,
        );

        const successfulImports = importResult.items.filter(
          (item) => item.status === "completed" || item.status === "completed_with_errors",
        );
        const latestImportAt = successfulImports[0]?.created_at ?? importResult.items[0]?.created_at ?? null;

        const nowMs = Date.now();
        const windowStartMs = nowMs - 30 * 24 * 60 * 60 * 1000;
        const importsLast30Days = successfulImports.filter((item) => {
          const createdAtMs = parseDateMs(item.created_at);
          return createdAtMs !== null && createdAtMs >= windowStartMs;
        }).length;

        setSnapshot({
          totalOffers,
          offersWithPreview,
          photoCoveragePercent,
          newThisWeekCount: summaryResult.newThisWeekCount,
          tenantCount: tenantIds.length,
          tenantLabels,
          latestImportAt,
          importsLast30Days,
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

  const summaryText = useMemo(() => {
    const lines: string[] = [];
    lines.push("ReActiv — Investor Highlights");
    lines.push(`Дата: ${new Date().toLocaleDateString("ru-RU")}`);
    lines.push("");

    if (snapshot) {
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
  }, [snapshot]);

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
    <section>
      <h1>Investor Highlights</h1>

      <div className="panel highlights-panel">
        <div className="highlights-panel__head">
          <div>
            <h2>Сводка для стейкхолдеров</h2>
            <p className="empty">
              Автоматическая KPI-сводка + понедельные бизнес-итоги со старта проекта.
            </p>
          </div>
          <button type="button" className="secondary-button" onClick={() => void handleCopySummary()}>
            {copyStatus === "success" ? "Скопировано" : copyStatus === "error" ? "Ошибка" : "Скопировать текст"}
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Ключевые метрики</h2>
        {isLoading ? (
          <p>Загрузка метрик...</p>
        ) : error ? (
          <p className="error">{error}</p>
        ) : snapshot ? (
          <div className="highlights-kpi-grid">
            <article className="highlights-kpi-card">
              <span>Позиции в каталоге</span>
              <strong>{snapshot.totalOffers.toLocaleString("ru-RU")}</strong>
            </article>
            <article className="highlights-kpi-card">
              <span>Позиции с превью</span>
              <strong>{snapshot.offersWithPreview.toLocaleString("ru-RU")}</strong>
            </article>
            <article className="highlights-kpi-card">
              <span>Покрытие превью</span>
              <strong>{snapshot.photoCoveragePercent.toFixed(1)}%</strong>
            </article>
            <article className="highlights-kpi-card">
              <span>Новые за неделю</span>
              <strong>+{snapshot.newThisWeekCount.toLocaleString("ru-RU")}</strong>
            </article>
            <article className="highlights-kpi-card">
              <span>Лизингодатели</span>
              <strong>{snapshot.tenantCount}</strong>
              <small>{snapshot.tenantLabels.join(", ") || "-"}</small>
            </article>
            <article className="highlights-kpi-card">
              <span>Успешные импорты (30 дней)</span>
              <strong>{snapshot.importsLast30Days}</strong>
              <small>Последний: {formatDate(snapshot.latestImportAt)}</small>
            </article>
          </div>
        ) : (
          <p className="empty">Нет данных для отображения.</p>
        )}
      </div>

      <div className="panel">
        <h2>Понедельные итоги (со старта)</h2>
        <div className="highlights-week-grid">
          {WEEKLY_HIGHLIGHTS.map((week) => (
            <article key={week.period} className="highlights-week-card">
              <p className="highlights-week-card__period">{week.period}</p>
              <h3>{week.title}</h3>
              <ul>
                {week.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>Фокус на 30 дней</h2>
        <ul className="highlights-next-list">
          {NEXT_30_DAYS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

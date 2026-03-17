import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getCatalogFilters,
  getCatalogItems,
  getCatalogSummary,
  getMediaPreviewImageUrl,
  logActivityEvent,
} from "../api/client";
import type { CatalogItem } from "../types/api";
import "../styles/landing.css";

interface LandingMetrics {
  total: number;
  newThisWeekCount: number;
  brandsCount: number;
}

interface LandingCatalogState {
  featuredItems: CatalogItem[];
  brands: string[];
  metrics: LandingMetrics;
}

interface FaqItem {
  question: string;
  answer: string;
}

interface AudienceCard {
  title: string;
  text: string;
}

interface BenefitCard {
  title: string;
  text: string;
}

interface PopularBrand {
  name: string;
  query: string;
  logoSrc: string;
}

const DEFAULT_METRICS: LandingMetrics = {
  total: 0,
  newThisWeekCount: 0,
  brandsCount: 0,
};

const BENEFIT_CARDS: BenefitCard[] = [
  {
    title: "Понятное происхождение лота",
    text: "Автомобили поступают от лизинговых компаний после изъятия, возврата или завершения договора.",
  },
  {
    title: "Актуальный сток в одном месте",
    text: "ReActiv собирает предложения в единую витрину, чтобы не искать машины по разным источникам.",
  },
  {
    title: "Прозрачные параметры для отбора",
    text: "Марка, пробег, год выпуска, статус бронирования и цена уже доступны в карточке лота.",
  },
  {
    title: "Быстрый переход к конкретной сделке",
    text: "Можно сразу открыть карточку автомобиля, изучить фото, детали и перейти к дальнейшей коммуникации.",
  },
];

const PROCESS_STEPS = [
  "Лизинговые компании загружают актуальный сток в платформу.",
  "Каталог автоматически обновляется и показывает доступные автомобили.",
  "Покупатель фильтрует лоты по параметрам и открывает подходящие карточки.",
  "Дальше сделка и коммуникация идут по выбранному автомобилю без лишнего ручного поиска.",
];

const AUDIENCE_CARDS: AudienceCard[] = [
  {
    title: "Дилерам и автоплощадкам",
    text: "Когда нужен постоянный поток лотов и быстрый доступ к свежему стоку после лизинга.",
  },
  {
    title: "Юридическим лицам и закупщикам",
    text: "Когда важны прозрачные параметры автомобилей и понятный каталог без лишнего шума.",
  },
  {
    title: "Лизинговым компаниям",
    text: "Когда нужна единая витрина для размещения и ускоренной реализации возвратного стока.",
  },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Что такое автомобили после лизинга?",
    answer:
      "Это автомобили, которые были возвращены лизинговой компании, изъяты по договору или завершили цикл лизинга и выставлены на реализацию.",
  },
  {
    question: "Кому подходит платформа ReActiv?",
    answer:
      "Платформа рассчитана на дилеров, юридические лица, закупщиков автопарков и партнеров, которым нужен единый источник актуальных лотов.",
  },
  {
    question: "Можно ли сразу перейти к конкретным предложениям?",
    answer:
      "Да. Лендинг ведет в действующую витрину, где уже доступны фильтры, карточки лотов, фотографии и актуальные статусы автомобилей.",
  },
];

const HERO_IMAGE_URL = "https://www.figma.com/api/mcp/asset/12cb40f8-13ec-42fe-8230-d7ed062e7a4c";
const POPULAR_BRANDS: PopularBrand[] = [
  { name: "Mercedes", query: "Mercedes-Benz", logoSrc: "/brands/mersedes.png" },
  { name: "BMW", query: "BMW", logoSrc: "/brands/bmw.png" },
  { name: "SITRAK", query: "SITRAK", logoSrc: "/brands/sitrak.png" },
  { name: "Shacman", query: "Shacman", logoSrc: "/brands/shacman.png" },
  { name: "Lexus", query: "Lexus", logoSrc: "/brands/lexus.png" },
  { name: "Li", query: "Li", logoSrc: "/brands/li.png" },
  { name: "Haval", query: "Haval", logoSrc: "/brands/haval.png" },
];

function formatPrice(value: number | null): string {
  if (value === null) {
    return "Цена по запросу";
  }

  return `${value.toLocaleString("ru-RU")} ₽`;
}

function formatMileage(value: number | null): string {
  if (value === null) {
    return "Пробег уточняется";
  }

  return `${value.toLocaleString("ru-RU")} км`;
}

function formatYear(value: number | null): string {
  if (value === null) {
    return "Год не указан";
  }

  return String(value);
}

function extractMediaUrls(rawValue: string): string[] {
  if (!rawValue.trim()) {
    return [];
  }

  const matches = rawValue.match(/https?:\/\/\S+/gi) ?? [];
  return matches
    .map((item) => item.replace(/[),.;]+$/g, "").trim())
    .filter(Boolean);
}

function getItemPreviewUrl(item: CatalogItem): string | null {
  const sourceUrls = extractMediaUrls(item.yandexDiskUrl);
  if (sourceUrls.length === 0) {
    return null;
  }

  return getMediaPreviewImageUrl(sourceUrls[0]);
}

function getStatusTone(value: string): "neutral" | "positive" | "warning" {
  const normalized = value.trim().toLowerCase();

  if (normalized.includes("свобод")) {
    return "positive";
  }

  if (normalized.includes("соглас")) {
    return "warning";
  }

  return "neutral";
}

function MetricCard({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <article className="landing-metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}

function BrandLogo({ brand, src }: { brand: string; src: string }) {
  return (
    <img className="landing-brand-logo" src={src} alt={`${brand} logo`} />
  );
}

function ProductCard({ item }: { item: CatalogItem }) {
  const imageUrl = getItemPreviewUrl(item);

  return (
    <article className="landing-product-card">
      <Link className="landing-product-card__image-wrap" to={`/showcase/${item.id}`}>
        {imageUrl ? (
          <img className="landing-product-card__image" src={imageUrl} alt={item.title} />
        ) : (
          <div className="landing-product-card__image landing-product-card__image--placeholder">
            <span>{item.brand}</span>
          </div>
        )}
      </Link>

      <div className="landing-product-card__body">
        <span
          className={`landing-status-pill landing-status-pill--${getStatusTone(item.bookingStatus)}`}
        >
          {item.bookingStatus || "Статус уточняется"}
        </span>
        <h3>{item.title || `${item.brand} ${item.model}`}</h3>
        <p className="landing-product-card__meta">
          {formatYear(item.year)} · {formatMileage(item.mileageKm)}
        </p>
        <p className="landing-product-card__meta">
          {item.storageAddress || item.responsiblePerson || "Локация уточняется"}
        </p>
        <div className="landing-product-card__footer">
          <strong>{formatPrice(item.price)}</strong>
          <Link className="landing-inline-link" to={`/showcase/${item.id}`}>
            Открыть карточку
          </Link>
        </div>
      </div>
    </article>
  );
}

export function LandingPage() {
  const [catalogState, setCatalogState] = useState<LandingCatalogState>({
    featuredItems: [],
    brands: [],
    metrics: DEFAULT_METRICS,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadLandingData() {
      setIsLoading(true);
      setError(null);

      try {
        const [itemsResponse, summaryResponse, filtersResponse] = await Promise.all([
          getCatalogItems({
            page: 1,
            pageSize: 4,
            sortBy: "created_at",
            sortDir: "desc",
          }),
          getCatalogSummary(),
          getCatalogFilters(),
        ]);

        if (!isMounted) {
          return;
        }

        setCatalogState({
          featuredItems: itemsResponse.items.slice(0, 4),
          brands: filtersResponse.brand.slice(0, 7),
          metrics: {
            total: itemsResponse.pagination.total,
            newThisWeekCount: summaryResponse.newThisWeekCount,
            brandsCount: filtersResponse.brand.length,
          },
        });
      } catch (caughtError) {
        if (!isMounted) {
          return;
        }

        const nextError =
          caughtError instanceof Error ? caughtError.message : "Не удалось загрузить данные лендинга";
        setError(nextError);

        void logActivityEvent({
          eventType: "api_error",
          page: "/",
          payload: {
            source: "landing_page",
            message: nextError,
          },
        });
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadLandingData();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <section className="landing-page">
      <div className="landing-page__shell">
        <header className="landing-header">
          <Link className="landing-header__brand" to="/landing">
            <span className="landing-header__logo">РеАктив</span>
            <span className="landing-header__subtitle">единый агрегатор лизинговой техники</span>
          </Link>

          <nav className="landing-header__nav" aria-label="Навигация лендинга">
            <Link to="/">Каталог техники</Link>
            <a href="#about">О платформе</a>
            <Link to="/login" state={{ activitySource: "landing_header" }}>
              Личный кабинет для ЮЛ
            </Link>
          </nav>
        </header>

        <div className="landing-hero">
          <div className="landing-hero__copy">
            <div className="landing-hero__intro">
              <h1>Авто после лизинга — каталог изъятых и лизинговых автомобилей</h1>
              <p>
                Платформа Reactiv собирает автомобили после лизинга со всей России. В каталоге
                доступны изъятые автомобили, конфискат и машины после завершения лизинговых
                договоров от лизинговых компаний.
              </p>
            </div>

            <div className="landing-hero__actions">
              <Link className="landing-primary-button" to="/">
                Смотреть каталог автомобилей
              </Link>
            </div>
          </div>

          <div className="landing-hero__media">
            <img src={HERO_IMAGE_URL} alt="Автомобиль после лизинга" />
          </div>
        </div>

        <section className="landing-section">
          <div className="landing-section__heading">
            <h2>Популярные марки автомобилей после лизинга</h2>
          </div>
          <div className="landing-brand-grid">
            {POPULAR_BRANDS.map((brand) => (
              <Link
                key={brand.name}
                className="landing-brand-card"
                to={`/?brand=${encodeURIComponent(brand.query)}`}
              >
                <div className="landing-brand-card__top">
                  <div className="landing-brand-card__logo-wrap">
                    <BrandLogo brand={brand.name} src={brand.logoSrc} />
                  </div>
                  <span className="landing-brand-card__arrow" aria-hidden="true">
                    ↗
                  </span>
                </div>
                <strong>{brand.name}</strong>
              </Link>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-section__heading">
            <h2>Авто после лизинга в продаже</h2>
            <Link className="landing-inline-link" to="/">
              Смотреть всю витрину
            </Link>
          </div>

          {error ? (
            <div className="landing-api-fallback" role="status">
              <strong>Каталог временно недоступен</strong>
              <p>{error}</p>
              <Link className="landing-primary-button" to="/">
                Перейти в витрину
              </Link>
            </div>
          ) : (
            <div className="landing-product-grid">
              {(catalogState.featuredItems.length > 0 ? catalogState.featuredItems : []).map((item) => (
                <ProductCard key={item.id} item={item} />
              ))}
              {!isLoading && catalogState.featuredItems.length === 0 && (
                <div className="landing-api-fallback" role="status">
                  <strong>Лоты скоро появятся</strong>
                  <p>Как только каталог вернет данные, здесь отобразятся актуальные автомобили.</p>
                </div>
              )}
            </div>
          )}
        </section>

        <section id="about" className="landing-section">
          <div className="landing-explainer">
            <div className="landing-explainer__main">
              <span className="landing-section__eyebrow">Что такое автомобили после лизинга</span>
              <h2>Покупать такие автомобили удобнее, когда все предложения собраны в одной витрине</h2>
              <p>
                ReActiv соединяет маркетинговый вход в продукт и действующий каталог. Пользователь
                может сначала понять формат рынка, а потом сразу перейти к конкретным карточкам
                автомобилей без лишнего ручного поиска.
              </p>
              <ul className="landing-check-list">
                <li>Актуальные карточки лотов из действующего каталога</li>
                <li>Понятные параметры для фильтрации и отбора</li>
                <li>Прямой переход из лендинга в рабочую витрину</li>
              </ul>
            </div>

            <div className="landing-explainer__stats">
              <MetricCard
                value={catalogState.metrics.total > 0 ? String(catalogState.metrics.total) : "24/7"}
                label="доступ к витрине"
              />
              <MetricCard
                value={
                  catalogState.metrics.newThisWeekCount > 0
                    ? String(catalogState.metrics.newThisWeekCount)
                    : "новые"
                }
                label="обновления каталога"
              />
              <Link className="landing-primary-button" to="/">
                Смотреть каталог
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-section__heading">
            <h2>Почему покупают авто после лизинга</h2>
          </div>
          <div className="landing-benefits-grid">
            {BENEFIT_CARDS.map((item) => (
              <article key={item.title} className="landing-info-card">
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-section__heading">
            <h2>Как работает платформа Reactiv</h2>
          </div>
          <div className="landing-process-grid">
            {PROCESS_STEPS.map((item, index) => (
              <article key={item} className="landing-step-card">
                <span>0{index + 1}</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section">
          <div className="landing-audience">
            <div className="landing-audience__intro">
              <span className="landing-section__eyebrow">Кому подходит платформа</span>
              <h2>Лендинг объясняет ценность продукта, а витрина сразу ведет к выбору автомобиля</h2>
              <p>
                Такой сценарий работает и для SEO-трафика, и для рекламных переходов, и для прямых
                заходов партнеров в каталог.
              </p>
            </div>

            <div className="landing-audience__cards">
              {AUDIENCE_CARDS.map((item) => (
                <article key={item.title} className="landing-info-card">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="landing-section">
          <div className="landing-section__heading">
            <h2>Часто задаваемые вопросы</h2>
          </div>
          <div className="landing-faq-list">
            {FAQ_ITEMS.map((item) => (
              <article key={item.question} className="landing-faq-card">
                <h3>{item.question}</h3>
                <p>{item.answer}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-section--footer-cta">
          <div className="landing-footer-cta">
            <div>
              <h2>Смотреть автомобили после лизинга</h2>
              <p>
                Перейди в действующий каталог ReActiv и открой актуальные лоты, карточки и параметры
                автомобилей.
              </p>
            </div>
            <Link className="landing-primary-button" to="/">
              Перейти
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}

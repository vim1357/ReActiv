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

const PREPOSITION_NBSP_PATTERN =
  /(^|[\s([{'"«„-])(а|без|в|во|для|до|за|и|из|к|ко|на|над|не|ни|о|об|обо|от|по|под|при|про|с|со|у)\s+/giu;

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
  iconSrc: string;
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
    title: "Цена ниже вторичного рынка",
    text: "Автомобили после лизинга часто продаются дешевле аналогичных предложений на вторичном рынке.",
    iconSrc: "/brands/benefit-1.svg",
  },
  {
    title: "Понятная история эксплуатации",
    text: "Большинство автомобилей обслуживалось у официальных дилеров.",
    iconSrc: "/brands/benefit-2.svg",
  },
  {
    title: "Регулярный поток новых автомобилей",
    text: "Лизинговые компании регулярно реализуют автомобили после завершения договоров.",
    iconSrc: "/brands/benefit-3.svg",
  },
  {
    title: "Доступ к изъятым автомобилям",
    text: "На платформе можно найти изъятые автомобили и конфискат.",
    iconSrc: "/brands/benefit-4.svg",
  },
];

const PROCESS_STEPS = [
  "Лизинговые компании размещают автомобили после лизинга",
  "Reactiv собирает предложения в единый каталог",
  "Брокеры, агенты и дилеры находят автомобили",
  "После запроса открываются контакты владельца лота",
];

const AUDIENCE_CARDS: AudienceCard[] = [
  {
    title: "Автомобильные брокеры и агенты",
    text: "Поиск автомобилей после лизинга и изъятых авто для клиентов.",
  },
  {
    title: "Автодилеры",
    text: "Дополнительный источник автомобилей для автосалонов.",
  },
  {
    title: "Таксопарки",
    text: "Закупка автомобилей с пробегом для автопарков.",
  },
];

const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Что значит автомобиль после лизинга",
    answer:
      "Автомобиль после лизинга - это машина, которая использовалась по договору лизинга и после завершения договора продается лизинговой компанией.",
  },
  {
    question: "Где продаются изъятые автомобили",
    answer:
      "Изъятые автомобили обычно реализуются через площадки лизинговых компаний или через агрегаторы.",
  },
  {
    question: "Можно ли купить авто после лизинга дешевле рынка",
    answer:
      "Да, автомобили после лизинга иногда продаются дешевле аналогичных предложений на вторичном рынке.",
  },
];

const HERO_IMAGE_URL = "https://www.figma.com/api/mcp/asset/12cb40f8-13ec-42fe-8230-d7ed062e7a4c";
const BRANDS_ARROW_ICON_URL = "/brands/arrow-up-right.svg";
const ABOUT_CHECKMARK_ICON_URL = "/brands/checkmark-icon.svg";
const ABOUT_LEASING_TYPES = [
  "автомобили после завершения лизинга",
  "изъятые автомобили",
  "конфискат лизинговых компаний",
  "корпоративные автомобили с пробегом",
];
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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

  useEffect(() => {
    if (!isMobileMenuOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    const root = document.querySelector(".landing-page");
    if (!root) {
      return;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let currentNode = walker.nextNode();

    while (currentNode) {
      const textNode = currentNode as Text;
      const value = textNode.nodeValue;
      if (value && value.includes(" ")) {
        textNode.nodeValue = value.replace(
          PREPOSITION_NBSP_PATTERN,
          (_full, prefix: string, preposition: string) => {
            return `${prefix}${preposition}\u00A0`;
          },
        );
      }
      currentNode = walker.nextNode();
    }
  }, [catalogState, error, isLoading]);

  return (
    <section className="landing-page">
      <div className="landing-page__shell">
        <header className="landing-header">
          <Link className="landing-header__brand" to="/landing">
            <span className="landing-header__logo">РеАктив</span>
            <span className="landing-header__subtitle">единый агрегатор лизинговой техники</span>
          </Link>

          <button
            className={`landing-header__burger${isMobileMenuOpen ? " is-open" : ""}`}
            type="button"
            aria-expanded={isMobileMenuOpen}
            aria-controls="landing-nav"
            aria-label={isMobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
            onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          >
            <span />
            <span />
            <span />
          </button>

          <nav
            id="landing-nav"
            className={`landing-header__nav${isMobileMenuOpen ? " is-open" : ""}`}
            aria-label="Навигация лендинга"
          >
            <Link to="/" onClick={() => setIsMobileMenuOpen(false)}>
              Каталог техники
            </Link>
            <a href="#about" onClick={() => setIsMobileMenuOpen(false)}>
              О платформе
            </a>
            <Link
              to="/login"
              state={{ activitySource: "landing_header" }}
              onClick={() => setIsMobileMenuOpen(false)}
            >
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
                  <img
                    className="landing-brand-card__arrow"
                    src={BRANDS_ARROW_ICON_URL}
                    alt=""
                    aria-hidden="true"
                  />
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
            <div className="landing-explainer__headline">
              <h2>Что такое автомобили после лизинга</h2>
              <div className="landing-explainer__stats">
                <article className="landing-explainer-stat">
                  <strong>7000+</strong>
                  <span>единиц техники</span>
                </article>
                <article className="landing-explainer-stat">
                  <strong>500+</strong>
                  <span>заявок обработано</span>
                </article>
              </div>
            </div>

            <div className="landing-explainer__content">
              <p className="landing-explainer__text">
                Автомобили после лизинга - это машины, которые использовались компаниями по договору
                лизинга и после завершения договора или его прекращения выставляются на продажу. В
                продаже можно встретить несколько типов таких автомобилей:
              </p>
              <ul className="landing-check-list">
                {ABOUT_LEASING_TYPES.map((item) => (
                  <li key={item}>
                    <img className="landing-check-list__icon" src={ABOUT_CHECKMARK_ICON_URL} alt="" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <p className="landing-explainer__text">
                Такие машины часто реализуются через площадки продажи лизинговых автомобилей.
                Платформа Reactiv агрегирует предложения лизинговых компаний и формирует единый
                каталог автомобилей после лизинга.
              </p>
              <Link className="landing-primary-button landing-explainer__button" to="/">
                Смотреть каталог автомобилей
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-section landing-section--benefits">
          <div className="landing-section__heading">
            <h2>Почему покупают авто после лизинга</h2>
          </div>
          <div className="landing-benefits-grid">
            {BENEFIT_CARDS.map((item) => (
              <article key={item.title} className="landing-benefit-card">
                <div className="landing-benefit-card__body">
                  <h3>{item.title}</h3>
                  <div className="landing-benefit-card__divider" aria-hidden />
                  <p>{item.text}</p>
                </div>
                <span className="landing-benefit-card__icon-wrap" aria-hidden>
                  <img className="landing-benefit-card__icon" src={item.iconSrc} alt="" />
                </span>
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
              <article key={item} className="landing-process-card">
                <span className="landing-process-card__index">{index + 1}</span>
                <p>{item}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section landing-section--audience">
          <div className="landing-audience">
            <div className="landing-audience__title">
              <h2>Кому подходит платформа</h2>
            </div>

            <div className="landing-audience__cards">
              {AUDIENCE_CARDS.map((item) => (
                <article key={item.title} className="landing-audience-card">
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="landing-section landing-section--faq">
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
            <div className="landing-footer-cta__content">
              <h2>Смотреть автомобили после лизинга</h2>
              <p>Перейдите в каталог и найдите автомобиль</p>
            </div>
            <Link className="landing-footer-cta__button" to="/">
              Перейти
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}

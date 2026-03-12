import {
  useEffect,
  useMemo,
  useState,
  type ImgHTMLAttributes,
  type SyntheticEvent,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  buildTelegramShareUrl,
  getCatalogItemById,
  getMediaGalleryUrls,
  getMediaPreviewImageUrl,
  logActivityEvent,
} from "../api/client";
import type { CatalogItem } from "../types/api";

const RESO_TEST_VIN = "LGJ509EZPPR000290";

function formatPrice(price: number | null): string {
  if (price === null) {
    return "-";
  }
  return `${price.toLocaleString("ru-RU")} ₽`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function extractMediaUrls(rawValue: string): string[] {
  if (!rawValue.trim()) {
    return [];
  }

  const matches = rawValue.match(/https?:\/\/\S+/gi) ?? [];
  const cleaned = matches
    .map((item) => item.replace(/[),.;]+$/g, "").trim())
    .filter(Boolean);

  return [...new Set(cleaned)];
}

function getDisplayImageUrl(url: string): string {
  return getMediaPreviewImageUrl(url);
}

type ProxyAwareImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  sourceUrl: string;
};

function ProxyAwareImage({ sourceUrl, onError, ...restProps }: ProxyAwareImageProps) {
  const [useDirectUrl, setUseDirectUrl] = useState(false);

  useEffect(() => {
    setUseDirectUrl(false);
  }, [sourceUrl]);

  function handleError(event: SyntheticEvent<HTMLImageElement, Event>): void {
    if (!useDirectUrl) {
      setUseDirectUrl(true);
      return;
    }

    if (onError) {
      onError(event);
    }
  }

  return (
    <img
      {...restProps}
      src={useDirectUrl ? sourceUrl : getDisplayImageUrl(sourceUrl)}
      onError={handleError}
    />
  );
}

function formatBool(value: boolean | null): string {
  if (value === null) {
    return "-";
  }
  return value ? "Да" : "Нет";
}

function formatString(value: string): string {
  const normalized = value.trim();
  return normalized ? normalized : "-";
}

function formatInteger(value: number | null, suffix = ""): string {
  if (value === null) {
    return "-";
  }

  const formatted = value.toLocaleString("ru-RU");
  return suffix ? `${formatted} ${suffix}` : formatted;
}

interface DetailSpec {
  label: string;
  value: string;
}

export function ShowcaseItemPage() {
  const { itemId } = useParams<{ itemId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [item, setItem] = useState<CatalogItem | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState("");
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadItem() {
      const parsedId = Number(itemId);
      if (!Number.isInteger(parsedId) || parsedId <= 0) {
        setError("Некорректный идентификатор карточки");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await getCatalogItemById(parsedId);
        setItem(response);
      } catch (caughtError) {
        void logActivityEvent({
          eventType: "api_error",
          page: location.pathname,
          entityType: "catalog_item",
          entityId: String(parsedId),
          payload: {
            endpoint: `/catalog/items/${parsedId}`,
            message:
              caughtError instanceof Error ? caughtError.message : "unknown_error",
          },
        });

        if (caughtError instanceof Error) {
          setError(caughtError.message);
        } else {
          setError("Не удалось загрузить карточку");
        }
      } finally {
        setIsLoading(false);
      }
    }

    void loadItem();
  }, [itemId]);

  const sourceUrls = useMemo(() => {
    if (!item) {
      return [];
    }

    const urls = extractMediaUrls(item.yandexDiskUrl);
    if (urls.length > 0) {
      return urls;
    }

    if (item.offerCode === RESO_TEST_VIN) {
      return [`reso-vin:${item.offerCode}`];
    }

    return [];
  }, [item]);

  useEffect(() => {
    let isCancelled = false;

    async function resolveGallery() {
      if (!sourceUrls.length) {
        setMediaUrls([]);
        return;
      }

      if (sourceUrls.length > 1) {
        setMediaUrls(sourceUrls);
        return;
      }

      try {
        const galleryUrls = await getMediaGalleryUrls(sourceUrls[0]);
        if (isCancelled) {
          return;
        }

        if (galleryUrls.length > 0) {
          setMediaUrls(galleryUrls);
          return;
        }

        setMediaUrls(sourceUrls);
      } catch (caughtError) {
        void logActivityEvent({
          eventType: "api_error",
          page: location.pathname,
          payload: {
            endpoint: "/media/gallery",
            message:
              caughtError instanceof Error ? caughtError.message : "unknown_error",
          },
        });

        if (!isCancelled) {
          setMediaUrls(sourceUrls);
        }
      }
    }

    void resolveGallery();

    return () => {
      isCancelled = true;
    };
  }, [sourceUrls]);

  const selectedImageIndex = selectedImage ? mediaUrls.indexOf(selectedImage) : -1;
  const maxThumbnailCount = 8;
  const hasHiddenThumbnails = mediaUrls.length > maxThumbnailCount;
  const visibleThumbnails = hasHiddenThumbnails
    ? mediaUrls.slice(0, maxThumbnailCount - 1)
    : mediaUrls;
  const hiddenThumbnailCount = hasHiddenThumbnails
    ? mediaUrls.length - visibleThumbnails.length
    : 0;
  const firstHiddenThumbnailUrl = hasHiddenThumbnails
    ? mediaUrls[visibleThumbnails.length]
    : null;
  const contactMessage = item
    ? `Добрый день. Вопрос по лоту *${item.offerCode}`
    : "Добрый день. Вопрос по лоту";
  const encodedContactMessage = encodeURIComponent(contactMessage);
  const encodedMailSubject = encodeURIComponent(`Вопрос по лоту ${item?.offerCode ?? ""}`.trim());
  const telegramShareUrl = item ? buildTelegramShareUrl(item.id) : "#";
  const cameFromShowcase = Boolean(
    (location.state as { fromShowcase?: boolean } | null)?.fromShowcase,
  );

  useEffect(() => {
    if (!mediaUrls.length) {
      setSelectedImage("");
      setIsLightboxOpen(false);
      return;
    }

    if (!selectedImage || !mediaUrls.includes(selectedImage)) {
      setSelectedImage(mediaUrls[0]);
    }
  }, [mediaUrls, selectedImage]);

  function openLightbox(
    url: string,
    source: "main_image" | "thumbnail" | "hidden_thumbnails" | "unknown" = "unknown",
  ): void {
    if (!url) {
      return;
    }

    const imageIndex = mediaUrls.indexOf(url);
    if (item) {
      void logActivityEvent({
        eventType: "showcase_gallery_open",
        page: location.pathname,
        entityType: "catalog_item",
        entityId: String(item.id),
        payload: {
          source,
          imageIndex: imageIndex >= 0 ? imageIndex : 0,
          totalImages: mediaUrls.length,
        },
      });
    }

    setSelectedImage(url);
    setIsLightboxOpen(true);
  }

  function closeLightbox(reason: string = "manual"): void {
    if (!isLightboxOpen) {
      return;
    }

    if (item) {
      void logActivityEvent({
        eventType: "showcase_gallery_close",
        page: location.pathname,
        entityType: "catalog_item",
        entityId: String(item.id),
        payload: {
          reason,
          imageIndex: selectedImageIndex >= 0 ? selectedImageIndex : 0,
          totalImages: mediaUrls.length,
        },
      });
    }

    setIsLightboxOpen(false);
  }

  function showPreviousImage(): void {
    if (!mediaUrls.length) {
      return;
    }

    const currentIndex = selectedImageIndex >= 0 ? selectedImageIndex : 0;
    const previousIndex = currentIndex === 0 ? mediaUrls.length - 1 : currentIndex - 1;
    if (item) {
      void logActivityEvent({
        eventType: "showcase_gallery_navigate",
        page: location.pathname,
        entityType: "catalog_item",
        entityId: String(item.id),
        payload: {
          direction: "previous",
          fromIndex: currentIndex,
          toIndex: previousIndex,
          totalImages: mediaUrls.length,
        },
      });
    }
    setSelectedImage(mediaUrls[previousIndex]);
  }

  function showNextImage(): void {
    if (!mediaUrls.length) {
      return;
    }

    const currentIndex = selectedImageIndex >= 0 ? selectedImageIndex : 0;
    const nextIndex = currentIndex === mediaUrls.length - 1 ? 0 : currentIndex + 1;
    if (item) {
      void logActivityEvent({
        eventType: "showcase_gallery_navigate",
        page: location.pathname,
        entityType: "catalog_item",
        entityId: String(item.id),
        payload: {
          direction: "next",
          fromIndex: currentIndex,
          toIndex: nextIndex,
          totalImages: mediaUrls.length,
        },
      });
    }
    setSelectedImage(mediaUrls[nextIndex]);
  }

  useEffect(() => {
    if (!isLightboxOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        closeLightbox("escape_key");
        return;
      }

      if (mediaUrls.length <= 1) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPreviousImage();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        showNextImage();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLightboxOpen, mediaUrls.length, selectedImageIndex]);

  return (
    <section className="showcase-detail-page">
      <Link
        className="detail-back-link"
        to="/showcase"
        onClick={(event) => {
          if (!cameFromShowcase) {
            return;
          }

          event.preventDefault();
          navigate(-1);
        }}
      >
        Назад к витрине
      </Link>

      {error && <p className="error">{error}</p>}
      {isLoading && <p>Загрузка карточки...</p>}

      {!isLoading && !error && item && (
        <>
          <div className="detail-top-cards">
            <article className="detail-trust-card">
              <div className="detail-trust-content">
                <p className="detail-trust-title">{item.title || `${item.brand} ${item.model}`}</p>
                <p className="detail-trust-meta">
                  {formatDate(item.createdAt) || "Дата не указана"} · Код {formatString(item.offerCode)}
                </p>
              </div>
              <div className="detail-trust-price-wrap">
                <p className="detail-trust-price">{formatPrice(item.price)}</p>
              </div>
            </article>

            <aside className="detail-cta-card">
              <p className="detail-cta-caption">Нужна дополнительная информация по лоту?</p>
              <a
                className="detail-cta-button detail-cta-button--share"
                href={telegramShareUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  if (!item) {
                    return;
                  }

                  void logActivityEvent({
                    eventType: "showcase_contact_click",
                    page: location.pathname,
                    entityType: "catalog_item",
                    entityId: String(item.id),
                    payload: {
                      channel: "telegram_share",
                    },
                  });
                }}
              >
                <span className="detail-cta-button__icon" aria-hidden>
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M9.8 14.7l-.4 4.1c.6 0 .9-.3 1.2-.6l2.9-2.8 6-4.4c1-.7-.2-1.1-1.5-.6l-7.4 2.8-3.2-1c-1.3-.4-1.3-1.3.3-1.9l12.6-4.9c1.2-.4 2.2.3 1.8 1.9l-2.1 10.3c-.3 1.3-1.1 1.7-2.2 1.1l-6-4.4-2.9 2.8c-.3.3-.6.6-1.1.6z" />
                  </svg>
                </span>
                <span className="detail-cta-button__text">Поделиться в Telegram</span>
              </a>
              <a
                className="detail-cta-button"
                href={`mailto:romanodokienko@gmail.com?subject=${encodedMailSubject}&body=${encodedContactMessage}`}
                target="_blank"
                rel="noreferrer"
                title="romanodokienko@gmail.com"
                onClick={() => {
                  if (!item) {
                    return;
                  }

                  void logActivityEvent({
                    eventType: "showcase_contact_click",
                    page: location.pathname,
                    entityType: "catalog_item",
                    entityId: String(item.id),
                    payload: {
                      channel: "email",
                    },
                  });
                }}
              >
                Написать на почту
              </a>
              <a
                className="detail-cta-button detail-cta-button--telegram"
                href={`https://t.me/romanodokienko?text=${encodedContactMessage}`}
                target="_blank"
                rel="noreferrer"
                title="@romanodokienko"
                onClick={() => {
                  if (!item) {
                    return;
                  }

                  void logActivityEvent({
                    eventType: "showcase_contact_click",
                    page: location.pathname,
                    entityType: "catalog_item",
                    entityId: String(item.id),
                    payload: {
                      channel: "telegram",
                    },
                  });
                }}
              >
                <span className="detail-cta-button__icon" aria-hidden>
                  <svg viewBox="0 0 24 24" focusable="false">
                    <path d="M9.8 14.7l-.4 4.1c.6 0 .9-.3 1.2-.6l2.9-2.8 6-4.4c1-.7-.2-1.1-1.5-.6l-7.4 2.8-3.2-1c-1.3-.4-1.3-1.3.3-1.9l12.6-4.9c1.2-.4 2.2.3 1.8 1.9l-2.1 10.3c-.3 1.3-1.1 1.7-2.2 1.1l-6-4.4-2.9 2.8c-.3.3-.6.6-1.1.6z" />
                  </svg>
                </span>
                <span className="detail-cta-button__text">Написать в Telegram</span>
              </a>
            </aside>
          </div>

          <div className="detail-layout">
            <aside className="panel detail-side-panel">
              {(() => {
                const ownershipSpecs: DetailSpec[] = [
                  { label: "Год выпуска", value: formatInteger(item.year) },
                  { label: "Пробег", value: formatInteger(item.mileageKm, "км") },
                  {
                    label: "Статус брони",
                    value: formatString(item.bookingStatus || "Без статуса"),
                  },
                  ...(item.responsiblePerson.trim()
                    ? [
                        {
                          label: "Ответственный",
                          value: formatString(item.responsiblePerson),
                        },
                      ]
                    : []),
                  ...(item.daysOnSale !== null
                    ? [{ label: "Дней в продаже", value: formatInteger(item.daysOnSale) }]
                    : []),
                  { label: "Регион/адрес", value: formatString(item.storageAddress) },
                ];

                const technicalSpecs: DetailSpec[] = [
                  { label: "Марка", value: formatString(item.brand) },
                  { label: "Модель", value: formatString(item.model) },
                  { label: "Модификация", value: formatString(item.modification) },
                  { label: "Тип ТС", value: formatString(item.vehicleType) },
                  { label: "ПТС/ЭПТС", value: formatString(item.ptsType) },
                  { label: "Ключи", value: formatInteger(item.keyCount) },
                  { label: "Обременение", value: formatBool(item.hasEncumbrance) },
                  { label: "Снят с учета", value: formatBool(item.isDeregistered) },
                ];

                return (
                  <>
                    <section className="detail-section">
                      <h3>Общие данные</h3>
                      <dl className="detail-spec-list">
                        {ownershipSpecs.map((spec) => (
                          <div className="detail-spec-row" key={spec.label}>
                            <dt>{spec.label}</dt>
                            <dd>{spec.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    <section className="detail-section">
                      <h3>Характеристики</h3>
                      <dl className="detail-spec-list">
                        {technicalSpecs.map((spec) => (
                          <div className="detail-spec-row" key={spec.label}>
                            <dt>{spec.label}</dt>
                            <dd>{spec.value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  </>
                );
              })()}

              {item.websiteUrl && (
                <a
                  className="detail-external-link"
                  href={item.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    void logActivityEvent({
                      eventType: "showcase_source_open",
                      page: location.pathname,
                      entityType: "catalog_item",
                      entityId: String(item.id),
                    });
                  }}
                >
                  Открыть источник лота
                </a>
              )}
            </aside>

            <section className="panel detail-gallery-panel">
              <div className="detail-main-image">
                {selectedImage ? (
                  <>
                    <button
                      type="button"
                      className="detail-main-image__link"
                      onClick={() => {
                        if (isLightboxOpen) {
                          closeLightbox("main_image_toggle");
                        } else {
                          openLightbox(selectedImage, "main_image");
                        }
                      }}
                      title="Открыть полноэкранный просмотр"
                      aria-label="Открыть полноэкранный просмотр"
                    >
                      <ProxyAwareImage
                        sourceUrl={selectedImage}
                        alt={item.title || `${item.brand} ${item.model}`}
                      />
                    </button>
                    <div className="detail-main-image__overlay">
                      <span className="detail-main-chip detail-main-chip--hd">HD</span>
                      <span className="detail-main-chip">
                        Фото {selectedImageIndex >= 0 ? selectedImageIndex + 1 : 1}/{mediaUrls.length}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="detail-no-image">Фото отсутствует</div>
                )}
              </div>

              {mediaUrls.length > 1 && (
                <div className="detail-thumbnails">
                  {visibleThumbnails.map((url, index) => (
                    <button
                      type="button"
                      key={url}
                      className={url === selectedImage ? "detail-thumb active" : "detail-thumb"}
                      onClick={() => openLightbox(url, "thumbnail")}
                      aria-label={`Фото ${index + 1}`}
                      title="Открыть полноэкранный просмотр"
                    >
                      <ProxyAwareImage sourceUrl={url} alt="Миниатюра" />
                    </button>
                  ))}
                  {hasHiddenThumbnails && firstHiddenThumbnailUrl && (
                    <button
                      type="button"
                      className="detail-thumb detail-thumb--more-button"
                      onClick={() => openLightbox(firstHiddenThumbnailUrl, "hidden_thumbnails")}
                      aria-label={`Показать еще ${hiddenThumbnailCount} фото`}
                      title={`Показать еще ${hiddenThumbnailCount} фото`}
                    >
                      <span className="detail-thumb__more detail-thumb__more--static">
                        +{hiddenThumbnailCount} фото
                      </span>
                    </button>
                  )}
                </div>
              )}
            </section>
          </div>

          {isLightboxOpen && selectedImage && (
            <div
              className="detail-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label="Полноэкранный просмотр фото"
              onClick={() => closeLightbox("backdrop")}
            >
              <button
                type="button"
                className="detail-lightbox__close"
                onClick={(event) => {
                  event.stopPropagation();
                  closeLightbox("close_button");
                }}
                aria-label="Закрыть просмотр"
              >
                ×
              </button>

              {mediaUrls.length > 1 && (
                <button
                  type="button"
                  className="detail-lightbox__nav detail-lightbox__nav--prev"
                  onClick={(event) => {
                    event.stopPropagation();
                    showPreviousImage();
                  }}
                  aria-label="Предыдущее фото"
                >
                  ‹
                </button>
              )}

              <div className="detail-lightbox__body" onClick={(event) => event.stopPropagation()}>
                <button
                  type="button"
                  className="detail-lightbox__image-button"
                  onClick={() => closeLightbox("image_click")}
                  aria-label="Закрыть просмотр"
                >
                  <ProxyAwareImage
                    className="detail-lightbox__image"
                    sourceUrl={selectedImage}
                    alt={item.title || `${item.brand} ${item.model}`}
                  />
                </button>
                <p className="detail-lightbox__counter">
                  Фото {selectedImageIndex >= 0 ? selectedImageIndex + 1 : 1}/{mediaUrls.length}
                </p>
              </div>

              {mediaUrls.length > 1 && (
                <button
                  type="button"
                  className="detail-lightbox__nav detail-lightbox__nav--next"
                  onClick={(event) => {
                    event.stopPropagation();
                    showNextImage();
                  }}
                  aria-label="Следующее фото"
                >
                  ›
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}




import { useEffect, useRef, useState } from "react";

interface DockOffset {
  right: number;
  bottom: number;
}

function getBaseDockOffset(viewportWidth: number): DockOffset {
  if (viewportWidth <= 760) {
    return { right: 12, bottom: 92 };
  }
  return { right: 26, bottom: 112 };
}

function findJivoPanelRect(): DOMRect | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      'iframe[src*="jivo"], [class*="jivo"], [id*="jivo"]',
    ),
  );

  const fixedRects = candidates
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { element, rect };
    })
    .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    .filter(({ element, rect }) => {
      const style = window.getComputedStyle(element);
      if (style.position !== "fixed") {
        return false;
      }
      if (rect.right < viewportWidth - 24 || rect.bottom < viewportHeight - 24) {
        return false;
      }
      return rect.width >= 220 && rect.height >= 160;
    })
    .sort((left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height);

  return fixedRects[0]?.rect ?? null;
}

export function FeedbackWidget() {
  const [isTouchMode, setIsTouchMode] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [isOpenByClick, setIsOpenByClick] = useState(false);
  const [dockOffset, setDockOffset] = useState<DockOffset>({ right: 26, bottom: 112 });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const isOpen = isTouchMode ? isOpenByClick : isHovered;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateInteractionMode = () => {
      const nextIsTouchMode = !mediaQuery.matches;
      setIsTouchMode(nextIsTouchMode);

      if (nextIsTouchMode) {
        setIsHovered(false);
      } else {
        setIsOpenByClick(false);
      }
    };

    updateInteractionMode();
    mediaQuery.addEventListener("change", updateInteractionMode);

    return () => {
      mediaQuery.removeEventListener("change", updateInteractionMode);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const updateDockOffset = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const baseOffset = getBaseDockOffset(viewportWidth);
      const buttonSize = viewportWidth <= 760 ? 56 : 60;
      const gap = viewportWidth <= 760 ? 10 : 12;
      const jivoPanelRect = findJivoPanelRect();

      let nextRight = baseOffset.right;
      let nextBottom = baseOffset.bottom;

      if (jivoPanelRect) {
        const maxRight = Math.max(baseOffset.right, viewportWidth - buttonSize - 8);
        const preferredRight = baseOffset.right + jivoPanelRect.width + gap;

        if (preferredRight <= maxRight) {
          nextRight = preferredRight;
        } else {
          const maxBottom = Math.max(baseOffset.bottom, viewportHeight - buttonSize - 8);
          const preferredBottom = baseOffset.bottom + (viewportHeight - jivoPanelRect.top) + gap;
          nextBottom = Math.min(preferredBottom, maxBottom);
        }
      }

      setDockOffset((current) => {
        if (current.right === nextRight && current.bottom === nextBottom) {
          return current;
        }
        return { right: nextRight, bottom: nextBottom };
      });
    };

    updateDockOffset();
    const mutationObserver = new MutationObserver(updateDockOffset);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("resize", updateDockOffset);
    const intervalId = window.setInterval(updateDockOffset, 500);

    return () => {
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateDockOffset);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!isTouchMode || !isOpenByClick) {
      return;
    }

    function handleOutsideClick(event: PointerEvent): void {
      const target = event.target as Node | null;
      if (
        target &&
        !panelRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setIsOpenByClick(false);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsOpenByClick(false);
      }
    }

    document.addEventListener("pointerdown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpenByClick, isTouchMode]);

  return (
    <div
      className="feedback-widget"
      style={{ right: `${dockOffset.right}px`, bottom: `${dockOffset.bottom}px` }}
      onMouseEnter={() => {
        if (!isTouchMode) {
          setIsHovered(true);
        }
      }}
      onMouseLeave={() => {
        if (!isTouchMode) {
          setIsHovered(false);
        }
      }}
    >
      {isOpen && (
        <div
          id="feedback-widget-panel"
          ref={panelRef}
          className="feedback-widget__panel"
          role="dialog"
          aria-label="Обратная связь"
        >
          <p>
            Мы строим продукт для вас и внимательно читаем каждое сообщение. Если есть проблема или пожелание —
            просто напишите нам на почту <a href="mailto:romanodokienko@gmail.com">romanodokienko@gmail.com</a> или
            в{" "}
            <a href="https://t.me/romanodokienko" target="_blank" rel="noreferrer">
              Telegram
            </a>
            .
          </p>
        </div>
      )}

      <button
        ref={buttonRef}
        type="button"
        className={`feedback-widget__button ${isOpen ? "is-open" : ""}`}
        aria-label="Открыть обратную связь"
        aria-haspopup="dialog"
        aria-controls="feedback-widget-panel"
        aria-expanded={isOpen}
        onClick={() => {
          if (isTouchMode) {
            setIsOpenByClick((value) => !value);
          }
        }}
      >
        <img src="/message-square-question.svg" alt="" aria-hidden="true" />
      </button>
    </div>
  );
}

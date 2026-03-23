import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  getCurrentUser,
  getPlatformMode,
  logActivityEvent,
  logout,
} from "./api/client";
import { FeedbackWidget } from "./components/FeedbackWidget";
import { LegalLinks, PrivacyPolicyLink, TermsLink } from "./components/LegalLinks";
import { CatalogPage } from "./pages/CatalogPage";
import { AdminActivityPage } from "./pages/AdminActivityPage";
import { AdminHighlightsPage } from "./pages/AdminHighlightsPage";
import { AdminOperationsPage } from "./pages/AdminOperationsPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { FavoritesPage } from "./pages/FavoritesPage";
import { LandingPage } from "./pages/LandingPage";
import { LoginPage } from "./pages/LoginPage";
import { ShowcaseItemPage } from "./pages/ShowcaseItemPage";
import { ShowcasePage } from "./pages/ShowcasePage";
import { UploadPage } from "./pages/UploadPage";
import type { AuthUser, PlatformMode } from "./types/api";

type AuthState = "checking" | "authorized" | "unauthorized";
type PlatformModeState = "checking" | PlatformMode;

const HIDDEN_ADMIN_LOGIN_PATH = "/staff-login-reactiv";
const ACTIVITY_VIEWER_LOGINS = new Set(["alexey"]);
const PUBLIC_TITLE = "ReActiv — агрегатор изъятой лизинговой техники";

function upsertMetaByName(name: string, content: string): void {
  if (typeof document === "undefined") {
    return;
  }

  let element = document.head.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function upsertCanonicalLink(href: string): void {
  if (typeof document === "undefined") {
    return;
  }

  let element = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  element.setAttribute("href", href);
}

function PublicLegalFooter() {
  return (
    <footer className="public-legal-footer">
      <div className="public-legal-footer__inner">
        <LegalLinks className="legal-links" />
      </div>
    </footer>
  );
}

function isPublicCatalogPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/showcase" || pathname.startsWith("/showcase/");
}

function isPublicLayoutPath(pathname: string): boolean {
  return (
    isPublicCatalogPath(pathname) ||
    pathname === "/landing" ||
    pathname === "/login" ||
    pathname === HIDDEN_ADMIN_LOGIN_PATH
  );
}

function PublicSiteHeader({
  pathname,
  isMenuOpen,
  onToggleMenu,
  onCloseMenu,
  onBrandClick,
}: {
  pathname: string;
  isMenuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onBrandClick: () => void;
}) {
  const catalogActive = isPublicCatalogPath(pathname);
  const landingActive = pathname === "/landing";
  const loginActive = pathname === "/login";

  return (
    <header className="landing-header">
      <Link
        className="landing-header__brand"
        to="/"
        onClick={() => {
          onCloseMenu();
          onBrandClick();
        }}
      >
        <span className="landing-header__logo">
          Ре<span className="landing-header__logo-accent">А</span>ктив
        </span>
        <span className="landing-header__subtitle">единый агрегатор лизинговой техники</span>
      </Link>

      <button
        className={`landing-header__burger${isMenuOpen ? " is-open" : ""}`}
        type="button"
        aria-expanded={isMenuOpen}
        aria-controls="public-site-nav"
        aria-label={isMenuOpen ? "Закрыть меню" : "Открыть меню"}
        onClick={onToggleMenu}
      >
        <span />
        <span />
        <span />
      </button>

      <nav
        id="public-site-nav"
        className={`landing-header__nav${isMenuOpen ? " is-open" : ""}`}
        aria-label="Публичная навигация"
      >
        <Link
          to="/"
          className={catalogActive ? "is-active" : undefined}
          onClick={onCloseMenu}
        >
          Каталог техники
        </Link>
        <Link
          to="/landing"
          className={landingActive ? "is-active" : undefined}
          onClick={onCloseMenu}
        >
          О платформе
        </Link>
        <Link
          to="/login"
          state={{ activitySource: "public_site_header" }}
          className={loginActive ? "is-active" : undefined}
          onClick={onCloseMenu}
        >
          Личный кабинет для ЮЛ
        </Link>
      </nav>
    </header>
  );
}

function PublicSiteFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-footer__line" aria-hidden />
      <div className="landing-footer__content">
        <p className="landing-footer__meta">
          <span className="landing-footer__brand">
            Ре<span className="landing-footer__brand-accent">А</span>ктив
          </span>{" "}
          | 2026
        </p>
        <div className="landing-footer__links">
          <PrivacyPolicyLink />
          <TermsLink />
        </div>
      </div>
    </footer>
  );
}

export function App() {
  const location = useLocation();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [platformMode, setPlatformMode] = useState<PlatformModeState>("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [isPublicMenuOpen, setIsPublicMenuOpen] = useState(false);
  const hasLoggedSessionStartRef = useRef(false);
  const lastLoggedPageRef = useRef<string>("");

  const isAdmin = authUser?.role === "admin";
  const canViewActivity =
    isAdmin || (authUser?.login ? ACTIVITY_VIEWER_LOGINS.has(authUser.login.toLowerCase()) : false);
  const canAccessUpload =
    authUser?.role === "admin" || authUser?.role === "stock_owner";
  const canAccessCatalog = isAdmin;
  const canAccessFavorites = Boolean(authUser);
  const showMainNav = isAdmin || canAccessUpload || canViewActivity || canAccessFavorites;
  const defaultAuthorizedPath = canAccessUpload ? "/upload" : "/";

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const pathname = location.pathname;
    const isLandingPath = pathname === "/landing";
    const isShowcasePath = pathname === "/" || pathname === "/showcase";
    const isServicePath =
      pathname === "/login" ||
      pathname === HIDDEN_ADMIN_LOGIN_PATH ||
      pathname === "/upload" ||
      pathname === "/catalog" ||
      pathname.startsWith("/admin");
    const isItemPage = pathname.startsWith("/showcase/");

    const title = isServicePath
      ? "ReActiv"
      : isItemPage
        ? "Лот техники — ReActiv"
        : isLandingPath
          ? PUBLIC_TITLE
          : isShowcasePath
          ? "Каталог техники — ReActiv"
          : PUBLIC_TITLE;
    document.title = title;

    upsertMetaByName("robots", isServicePath ? "noindex, nofollow" : "index, follow");
    upsertMetaByName(
      "description",
      isLandingPath
        ? "ReActiv — единый агрегатор автомобилей после лизинга с каталогом актуальных лотов по всей России."
        : "Каталог автомобилей после лизинга, изъятых лотов и актуальных предложений ReActiv.",
    );

    upsertCanonicalLink(`https://reactiv.pro${pathname === "/showcase" ? "/" : pathname}`);
  }, [location.pathname]);

  useEffect(() => {
    let isMounted = true;

    async function bootstrapSession() {
      const [modeResult, authResult] = await Promise.allSettled([
        getPlatformMode(),
        getCurrentUser(),
      ]);

      if (!isMounted) {
        return;
      }

      if (modeResult.status === "fulfilled") {
        setPlatformMode(modeResult.value.mode);
      } else {
        setPlatformMode("closed");
      }

      if (authResult.status === "fulfilled") {
        setAuthUser(authResult.value.user);
        setAuthState("authorized");
      } else {
        setAuthUser(null);
        setAuthState("unauthorized");
      }
    }

    void bootstrapSession();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (authState !== "authorized" || hasLoggedSessionStartRef.current) {
      return;
    }

    hasLoggedSessionStartRef.current = true;
    void logActivityEvent({
      eventType: "session_start",
      page: typeof window !== "undefined" ? window.location.pathname : "/",
      payload: {
        role: authUser?.role ?? null,
      },
    });
  }, [authState, authUser?.role]);

  useEffect(() => {
    if (authState !== "authorized") {
      hasLoggedSessionStartRef.current = false;
      lastLoggedPageRef.current = "";
      return;
    }

    const intervalId = window.setInterval(() => {
      void logActivityEvent({
        eventType: "session_heartbeat",
        page: window.location.pathname,
      });
    }, 60_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [authState]);

  useEffect(() => {
    if (authState !== "authorized") {
      return;
    }

    const pageKey = `${location.pathname}${location.search}`;
    if (lastLoggedPageRef.current === pageKey) {
      return;
    }

    lastLoggedPageRef.current = pageKey;
    void logActivityEvent({
      eventType: "page_view",
      page: location.pathname,
      payload: {
        search: location.search || null,
      },
    });
  }, [authState, location.pathname, location.search]);

  useEffect(() => {
    setIsPublicMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isPublicMenuOpen) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isPublicMenuOpen]);

  async function handleLogout(): Promise<void> {
    try {
      void logActivityEvent({
        eventType: "logout",
        page: typeof window !== "undefined" ? window.location.pathname : "/",
      });
      await logout();
    } finally {
      setAuthUser(null);
      setAuthState("unauthorized");
    }
  }

  function handlePublicBrandClick(): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.sessionStorage.removeItem("showcase_ui_state_v1");
      window.sessionStorage.removeItem("showcase_return_pending_v1");
      window.sessionStorage.removeItem("showcase_scroll_y_v1");
    } catch {
      // ignore storage errors
    }

    window.dispatchEvent(new Event("reactiv:showcase-reset-filters"));
  }

  if (authState === "checking" || platformMode === "checking") {
    return (
      <div className="app-loading-screen" aria-live="polite" aria-label="Loading session">
        <div className="app-loading-screen__spinner" aria-hidden="true" />
      </div>
    );
  }

  if (authState === "unauthorized") {
    const loginElement = (
      <LoginPage
        onLoginSuccess={(user) => {
          setAuthUser(user);
          setAuthState("authorized");
        }}
      />
    );

    if (platformMode === "open") {
      const showPublicLayout = isPublicLayoutPath(location.pathname);

      return (
        <>
          <div className="app">
            {showPublicLayout && (
              <PublicSiteHeader
                pathname={location.pathname}
                isMenuOpen={isPublicMenuOpen}
                onToggleMenu={() => setIsPublicMenuOpen((prev) => !prev)}
                onCloseMenu={() => setIsPublicMenuOpen(false)}
                onBrandClick={handlePublicBrandClick}
              />
            )}

            <Routes>
              <Route path="/" element={<ShowcasePage publicMode />} />
              <Route path="/landing" element={<LandingPage />} />
              <Route path="/showcase" element={<Navigate to="/" replace />} />
              <Route path="/showcase/:itemId" element={<ShowcaseItemPage />} />
              <Route path={HIDDEN_ADMIN_LOGIN_PATH} element={loginElement} />
              <Route path="/login" element={loginElement} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            {showPublicLayout ? <PublicSiteFooter /> : <PublicLegalFooter />}
          </div>
          <FeedbackWidget />
        </>
      );
    }

    return (
      <>
        <div className="app">
          <PublicSiteHeader
            pathname={location.pathname}
            isMenuOpen={isPublicMenuOpen}
            onToggleMenu={() => setIsPublicMenuOpen((prev) => !prev)}
            onCloseMenu={() => setIsPublicMenuOpen(false)}
            onBrandClick={handlePublicBrandClick}
          />
          <Routes>
            <Route path="/login" element={loginElement} />
            <Route path={HIDDEN_ADMIN_LOGIN_PATH} element={loginElement} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          <PublicSiteFooter />
        </div>
        <FeedbackWidget />
      </>
    );
  }

  return (
    <>
      <div className="app">
        <div className={`nav-wrap${showMainNav ? "" : " nav-wrap--actions-only"}`}>
          {showMainNav && (
            <nav className="nav">
            {canAccessUpload && (
              <NavLink to="/upload" className={({ isActive }) => (isActive ? "active" : "")}>
                Загрузка
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/catalog" className={({ isActive }) => (isActive ? "active" : "")}>
                Каталог
              </NavLink>
            )}
            <NavLink to="/showcase" className={({ isActive }) => (isActive ? "active" : "")}>
              Витрина
            </NavLink>
            <NavLink to="/favorites" className={({ isActive }) => (isActive ? "active" : "")}>
              Избранное
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin/users" className={({ isActive }) => (isActive ? "active" : "")}>
                Пользователи
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin/highlights" className={({ isActive }) => (isActive ? "active" : "")}>
                Highlights
              </NavLink>
            )}
            {isAdmin && (
              <NavLink to="/admin/operations" className={({ isActive }) => (isActive ? "active" : "")}>
                Operations
              </NavLink>
            )}
              {canViewActivity && (
                <NavLink to="/admin/activity" className={({ isActive }) => (isActive ? "active" : "")}>
                  Активность
                </NavLink>
              )}
            </nav>
          )}
          <div className="nav-actions">
            <span className="nav-user">{authUser?.displayName ?? authUser?.login}</span>
            <button
              type="button"
              className="secondary-button nav-logout"
              onClick={() => void handleLogout()}
            >
              Выйти
            </button>
          </div>
        </div>
        <Routes>
          <Route
            path="/"
            element={canAccessUpload ? <Navigate to="/upload" replace /> : <ShowcasePage />}
          />
          <Route
            path="/showcase"
            element={<ShowcasePage canFilterByTenant={isAdmin} />}
          />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route
            path="/upload"
            element={
              canAccessUpload ? (
                <UploadPage canAccessCatalog={canAccessCatalog} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/catalog"
            element={isAdmin ? <CatalogPage /> : <Navigate to="/" replace />}
          />
          <Route path="/showcase/:itemId" element={<ShowcaseItemPage allowFavorites />} />
          <Route
            path="/admin/users"
            element={isAdmin ? <AdminUsersPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/admin/highlights"
            element={isAdmin ? <AdminHighlightsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/admin/operations"
            element={isAdmin ? <AdminOperationsPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/admin/activity"
            element={canViewActivity ? <AdminActivityPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/login"
            element={<Navigate to={defaultAuthorizedPath} replace />}
          />
          <Route
            path={HIDDEN_ADMIN_LOGIN_PATH}
            element={<Navigate to={defaultAuthorizedPath} replace />}
          />
          <Route path="*" element={<Navigate to={defaultAuthorizedPath} replace />} />
        </Routes>
      </div>
      <FeedbackWidget />
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  getCurrentUser,
  getPlatformMode,
  logActivityEvent,
  logout,
} from "./api/client";
import { FeedbackWidget } from "./components/FeedbackWidget";
import { LegalLinks } from "./components/LegalLinks";
import { CatalogPage } from "./pages/CatalogPage";
import { AdminActivityPage } from "./pages/AdminActivityPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
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

export function App() {
  const location = useLocation();
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [platformMode, setPlatformMode] = useState<PlatformModeState>("checking");
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const hasLoggedSessionStartRef = useRef(false);
  const lastLoggedPageRef = useRef<string>("");

  const isAdmin = authUser?.role === "admin";
  const canViewActivity =
    isAdmin || (authUser?.login ? ACTIVITY_VIEWER_LOGINS.has(authUser.login.toLowerCase()) : false);
  const canAccessUpload =
    authUser?.role === "admin" || authUser?.role === "stock_owner";
  const canAccessCatalog = isAdmin;
  const showMainNav = isAdmin || canAccessUpload || canViewActivity;
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

    if (location.pathname === "/landing") {
      return (
        <>
          <div className="app">
            <Routes>
              <Route path="/landing" element={<LandingPage />} />
              <Route path="*" element={<Navigate to="/landing" replace />} />
            </Routes>
          </div>
          <FeedbackWidget />
        </>
      );
    }

    if (platformMode === "open") {
      const shouldShowPublicHeader =
        location.pathname === "/" || location.pathname === "/showcase";

      return (
        <>
          <div className="app">
            {shouldShowPublicHeader && (
              <div className="public-showcase-topbar">
                <div className="public-showcase-topbar__left">
                  <Link to="/" className="public-showcase-brand">
                    <span>ре</span>Актив
                  </Link>
                  <div className="public-showcase-tagline">
                    единый агрегатор изъятой лизинговой техники
                  </div>
                </div>
                <nav className="public-showcase-nav" aria-label="Публичная навигация">
                  <NavLink
                    to="/"
                    className={({ isActive }) =>
                      isActive ? "public-showcase-nav__link is-active" : "public-showcase-nav__link"
                    }
                    end
                  >
                    Каталог техники
                  </NavLink>
                  <NavLink
                    to="/landing"
                    className={({ isActive }) =>
                      isActive ? "public-showcase-nav__link is-active" : "public-showcase-nav__link"
                    }
                  >
                    О платформе
                  </NavLink>
                  <NavLink
                    to="/login"
                    state={{ activitySource: "public_showcase_header" }}
                    className={({ isActive }) =>
                      isActive ? "public-showcase-nav__link is-active" : "public-showcase-nav__link"
                    }
                  >
                    Личный кабинет для ЮЛ
                  </NavLink>
                </nav>
              </div>
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
            {location.pathname !== "/landing" && <PublicLegalFooter />}
          </div>
          <FeedbackWidget />
        </>
      );
    }

    return (
      <>
        <div className="app">
          <Routes>
            <Route path="/login" element={loginElement} />
            <Route path={HIDDEN_ADMIN_LOGIN_PATH} element={loginElement} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
          <PublicLegalFooter />
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
            <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
              Витрина
            </NavLink>
            {isAdmin && (
              <NavLink to="/admin/users" className={({ isActive }) => (isActive ? "active" : "")}>
                Пользователи
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
          <Route path="/showcase" element={<Navigate to="/" replace />} />
          <Route path="/showcase/:itemId" element={<ShowcaseItemPage />} />
          <Route
            path="/admin/users"
            element={isAdmin ? <AdminUsersPage /> : <Navigate to="/" replace />}
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

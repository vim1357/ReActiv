import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { logActivityEvent, login } from "../api/client";
import { PrivacyPolicyLink, TermsLink } from "../components/LegalLinks";
import type { AuthUser } from "../types/api";

interface LoginPageProps {
  onLoginSuccess: (user: AuthUser) => void;
}

const SHOWCASE_UI_STATE_KEY = "showcase_ui_state_v1";
const SHOWCASE_RETURN_FLAG_KEY = "showcase_return_pending_v1";
const SHOWCASE_SCROLL_Y_KEY = "showcase_scroll_y_v1";
const HIDDEN_ADMIN_LOGIN_PATH = "/staff-login-reactiv";
const REGISTRATION_FORM_SCRIPT_SRC = "https://forms.yandex.ru/_static/embed.js";
const REGISTRATION_FORM_IFRAME_SRC =
  "https://forms.yandex.ru/u/69afbe1e84227c93c7f0d9e2?iframe=1";

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const location = useLocation();
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegistrationMode = useMemo(() => {
    if (location.pathname === HIDDEN_ADMIN_LOGIN_PATH) {
      return false;
    }

    const params = new URLSearchParams(location.search);
    return params.get("mode") === "registration";
  }, [location.pathname, location.search]);

  useEffect(() => {
    document.body.classList.add("auth-page");
    return () => {
      document.body.classList.remove("auth-page");
    };
  }, []);

  useEffect(() => {
    const stateSource =
      (location.state as { activitySource?: string } | null)?.activitySource ?? null;

    void logActivityEvent({
      eventType: "login_open",
      page: location.pathname,
      payload: {
        source: stateSource ?? "direct",
        mode: isRegistrationMode ? "registration" : "signin",
      },
    });
  }, [isRegistrationMode, location.pathname, location.state]);

  useEffect(() => {
    if (!isRegistrationMode || typeof document === "undefined") {
      return;
    }

    const existingScript = document.querySelector(
      `script[src="${REGISTRATION_FORM_SCRIPT_SRC}"]`,
    );
    if (existingScript) {
      return;
    }

    const script = document.createElement("script");
    script.src = REGISTRATION_FORM_SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);
  }, [isRegistrationMode]);

  function resetShowcaseState(): void {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.sessionStorage.removeItem(SHOWCASE_UI_STATE_KEY);
      window.sessionStorage.removeItem(SHOWCASE_RETURN_FLAG_KEY);
      window.sessionStorage.removeItem(SHOWCASE_SCROLL_Y_KEY);
    } catch {
      // ignore storage errors
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);

    if (!loginValue.trim() || !password) {
      setError("Введите логин и пароль");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await login(loginValue.trim(), password);
      onLoginSuccess(response.user);
      void logActivityEvent({
        eventType: "login_success",
        page: "/login",
        payload: {
          login: response.user.login,
          role: response.user.role,
        },
      });
    } catch (caughtError) {
      void logActivityEvent({
        eventType: "login_failed",
        page: location.pathname,
        payload: {
          loginAttempt: loginValue.trim() || null,
          message:
            caughtError instanceof Error ? caughtError.message.slice(0, 160) : "unknown_error",
        },
      });

      if (caughtError instanceof Error) {
        setError(caughtError.message);
      } else {
        setError("Ошибка входа");
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-layout auth-layout--landing">
      <div className={`auth-shell${isRegistrationMode ? " auth-shell--registration" : ""}`}>
        <Link to="/showcase" className="auth-top-logo" onClick={resetShowcaseState}>
          Ре<span>Актив</span>
        </Link>
        <nav className="auth-top-nav" aria-label="Навигация личного кабинета">
          <Link to="/showcase" className="auth-top-nav__link" onClick={resetShowcaseState}>
            Каталог техники
          </Link>
          <span className="auth-top-nav__link is-active">Личный кабинет для ЮЛ</span>
        </nav>

        {!isRegistrationMode ? (
          <div className="auth-landing-grid">
            <div className="panel auth-panel auth-panel--landing">
              <h1>Личный кабинет</h1>
              <form className="auth-form auth-form--landing" onSubmit={handleSubmit}>
                <label className="field">
                  <span>Логин</span>
                  <input
                    type="text"
                    autoComplete="username"
                    value={loginValue}
                    onChange={(event) => setLoginValue(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Пароль</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "Вход..." : "Войти"}
                </button>
                <div className="auth-access-callout auth-access-callout--landing">
                  <p>Доступ к личному кабинету есть только у зарегистрированных партнеров</p>
                  <Link className="auth-access-callout__link" to="/login?mode=registration">
                    Получить доступ к платформе →
                  </Link>
                </div>
                <p className="auth-legal-note">
                  Продолжая, вы соглашаетесь с <PrivacyPolicyLink /> и <TermsLink />.
                </p>
              </form>
              {error && <p className="error">{error}</p>}
            </div>

            <aside className="auth-promo-card" aria-label="Преимущества платформы">
              <div className="auth-promo-card__image" aria-hidden="true" />
              <h2>Единый агрегатор изъятой лизинговой техники</h2>
              <ul className="auth-promo-list">
                <li>
                  <strong>Лизинговым компаниям</strong>
                  <p>Витрина для размещения и реализации стока</p>
                </li>
                <li>
                  <strong>Дилерам, юрлицам и агентам</strong>
                  <p>
                    Прямой доступ к актуальной базе изъятой техники от крупнейших компаний РФ
                  </p>
                </li>
              </ul>
            </aside>
          </div>
        ) : (
          <div className="auth-registration-layout">
            <div className="panel auth-panel auth-panel--registration">
              <h1>Регистрация для владельцев лотов</h1>
              <p className="auth-registration-subtitle">
                Заполните форму, и мы отправим данные для доступа в личный кабинет.
              </p>
              <div className="auth-registration-form-frame">
                <iframe
                  src={REGISTRATION_FORM_IFRAME_SRC}
                  frameBorder="0"
                  name="ya-form-69afbe1e84227c93c7f0d9e2"
                  title="Форма регистрации владельца лотов"
                  className="auth-registration-iframe"
                />
              </div>
              <p className="auth-registration-switch">
                Уже зарегистрированы? <Link to="/login">Войти</Link>
              </p>
              <p className="auth-legal-note auth-legal-note--registration">
                Продолжая, вы соглашаетесь с <PrivacyPolicyLink /> и <TermsLink />.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

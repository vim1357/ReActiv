import { useEffect, useState } from "react";
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

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const location = useLocation();
  const [loginValue, setLoginValue] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      },
    });
  }, [location.pathname, location.state]);

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
      <div className="auth-shell">
        <Link to="/showcase" className="auth-top-logo" onClick={resetShowcaseState}>
          {"\u0420\u0435"}
          <span>{"\u0410\u043a\u0442\u0438\u0432"}</span>
        </Link>
        <Link to="/showcase" className="auth-back-link" onClick={resetShowcaseState}>
          {"\u041a\u0430\u0442\u0430\u043b\u043e\u0433 \u0442\u0435\u0445\u043d\u0438\u043a\u0438"}
        </Link>

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
                <a
                  className="auth-access-callout__link"
                  href="https://t.me/romanodokienko"
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => {
                    void logActivityEvent({
                      eventType: "showcase_contact_click",
                      page: location.pathname,
                      payload: {
                        source: "login_request_access",
                        channel: "telegram",
                      },
                    });
                  }}
                >
                  Получить доступ к платформе →
                </a>
              </div>
              <p className="auth-legal-note">
                {"\u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u044f, \u0432\u044b \u0441\u043e\u0433\u043b\u0430\u0448\u0430\u0435\u0442\u0435\u0441\u044c \u0441 "}
                <PrivacyPolicyLink />
                {" \u0438 "}
                <TermsLink />.
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
                <p>Прямой доступ к актуальной базе изъятой техники от крупных компаний РФ</p>
              </li>
            </ul>
          </aside>
        </div>
      </div>
    </section>
  );
}

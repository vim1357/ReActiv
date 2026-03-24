# Website Security Tasks (reactiv.pro)

Last updated: 2026-03-25
Owner: Codex + project owner

## Why this file exists
This is the single source of truth for security and technical resilience tasks for `reactiv.pro` and `api.reactiv.pro`.
When we refer to "website security tasks" in chat, this file is the reference.

## Goal for the current stage
- Address only real and exploitable risks.
- Keep a balance: security vs performance vs regression risk vs implementation speed.
- Deliver in small iterations with fast rollback paths.
- Avoid breaking current MVP flows (catalog, auth, import, admin operations, share/SEO).

## Audit context (current snapshot)
- Frontend `reactiv.pro` and API `api.reactiv.pro` were reviewed.
- Key risk areas:
  - overly broad CORS (origin reflection + credentials),
  - easy bulk catalog scraping via public API,
  - missing baseline security headers,
  - weak mobile performance,
  - both `www` and `non-www` running without strict host canonicalization.

## Mandatory guardrails
- Before non-trivial changes, check:
  - `docs/ARCHITECTURE_GUARDRAILS.md`
  - `docs/IMPORT_CONTRACT.md`
- Access model changes (`public/auth/admin`) require ADR confirmation per guardrails.
- Import identity invariants (`tenant_id + offer_code`) must remain unchanged.

## "Real risk" criteria (priority filter)
A task should be implemented now if at least one applies:
1. Risk is remotely exploitable without infrastructure access.
2. Risk can lead to data exposure, privilege misuse, or state-changing request abuse.
3. Risk can materially degrade core business behavior (API abuse, service instability).

A task can be moved to `deferred` if:
1. It is a best practice without clear current impact for our traffic profile.
2. Regression/operational cost is higher than expected risk reduction.

## Statuses
- `todo` - not started
- `in_progress` - currently in progress
- `blocked` - blocked by decision/dependency
- `done` - implemented and verified
- `deferred` - postponed by agreement

## Task register
| ID | Category | Priority | Status | Task | Depends on | Definition of done |
|---|---|---|---|---|---|---|
| SEC-00 | Security | P0 | in_progress | Approve access matrix `endpoint -> public/auth/admin` | DEC-05 | Approved matrix for all endpoints plus agreed exceptions (`docs/SECURITY_ENDPOINT_ACCESS_MATRIX.md`) |
| SEC-01 | Security | P0 | done | Restrict CORS to trusted origin allowlist | DEC-02, SEC-00 | Unknown origins do not receive ACAO, trusted origins keep working |
| SEC-02 | Security | P0 | done | Add CSRF protection for cookie-auth state-changing endpoints | SEC-00 | POST/PUT/PATCH/DELETE without valid CSRF token are rejected |
| SEC-03 | Security | P0 | done | Add baseline security headers on frontend/API | SEC-00 | HSTS/CSP/XFO/XCTO/Referrer-Policy/Permissions-Policy are stable |
| API-01 | API Protection | P1 | done | Limit bulk catalog scraping (rate limit, page-size limits, anti-abuse) | SEC-00 | Automated bulk extraction is reduced without breaking showcase UX |
| API-02 | Data Exposure | P1 | done | Minimize public catalog fields | DEC-03, SEC-00 | Public responses contain only approved field set |
| PERF-01 | Performance | P1 | done | Enable gzip/br and correct cache headers | infra-check | Responses include content-encoding and sane cache-control |
| PERF-02 | Performance | P1 | in_progress | Reduce impact of 3rd-party scripts (chat/analytics) | DEC-04 | LCP/TBT/CLS improve without losing critical analytics |
| SEO-01 | SEO | P2 | blocked | Enforce strict host canonicalization (`www` vs `non-www`) | DEC-01 | Single canonical host + 301/308 redirects |
| QA-01 | Verification | P1 | done | Re-audit after fixes | SEC-01..SEO-01 | "Before/after" report with residual risks |

## Decisions and dependencies (to approve)
| ID | Decision | Status | Blocks |
|---|---|---|---|
| DEC-01 | Canonical domain: `reactiv.pro` or `www.reactiv.pro` | done (`reactiv.pro`) | SEO-01, SEC-01 |
| DEC-02 | Trusted origin allowlist (prod/stage/local) | done (`https://reactiv.pro`,`https://www.reactiv.pro`,`http://localhost:5173`,`http://127.0.0.1:5173`) | SEC-01 |
| DEC-03 | Approved public catalog field set | done (`docs/PUBLIC_CATALOG_FIELDS.md`) | API-02 |
| DEC-04 | Target frontend SLO metrics (LCP/TBT/CLS) | pending | PERF-02 |
| DEC-05 | Confirm whether ADR is required for SEC-00 access model boundaries | done | SEC-00, SEC-02 |

## Current endpoint zone map (draft for SEC-00)
### Public (intentional)
- Landing/share/SEO and health routes.
- Public catalog read endpoints in open mode.
- Public guest activity endpoint.

### Public, non-cookie M2M (custom token)
- `/api/admin/reso-media/*`
- `/api/admin/alpha-media/*`

### Auth-required (cookie session)
- Admin users, imports, favorites, admin platform mode, admin analytics.

### State-changing endpoints (CSRF candidates)
- Auth: logout.
- Admin: create/update/delete users, reset password, platform mode, media run tasks.
- Imports: upload, clear.
- Favorites: add/remove.
- Authenticated activity endpoint.

## Safe rollout plan (staged, balanced)
### Wave 0 (documentation + gates, no regression risk)
- Complete SEC-00 (access matrix + explicit exceptions).
- Close DEC-01/02/03/05.
- Clarify public API contract boundaries.

### Wave 1 (low risk, high impact)
- SEC-01: CORS allowlist + deny by default.
- SEC-03 (part 1): safe baseline headers before strict CSP.
- API-01 (part 1): hard query/page-size caps + baseline public read rate limiting.

### Wave 2 (medium risk, careful rollout)
- SEC-02: CSRF for cookie-auth mutating endpoints.
- SEC-03 (part 2): CSP in `Report-Only`, then enforce after fixes.
- API-02: public field minimization with frontend contract validation.

### Wave 3 (performance + SEO closure)
- PERF-01: decide compression layer (edge/proxy vs app), avoid double compression.
- PERF-02: optimize 3rd-party script loading without analytics loss.
- SEO-01: finalize canonical host behavior with 301/308.

## Task cards (risk-oriented)
### SEC-01 (CORS allowlist)
- Real risk: credentialed CORS with broad origin acceptance.
- Regression risk: login/logout and admin flows can break for missing origins.
- Safe strategy:
  - manage allowlist via config/env,
  - explicit prod/stage/local list,
  - monitor blocked CORS and related 4xx trends.
- Rollback: revert to previous CORS config quickly.

### SEC-02 (CSRF)
- Real risk: cookie-auth state-changing endpoints without CSRF token checks.
- Regression risk: forms/fetch/background flows may break.
- Safe strategy:
  - scope only to cookie-auth mutating endpoints,
  - exclude M2M token endpoints (`x-reso-media-token`) and public guest endpoints,
  - start with short log-only monitoring period if needed.
- Rollback: feature flag to disable CSRF enforcement.

### SEC-03 (security headers)
- Real risk: missing baseline browser hardening headers.
- Regression risk: strict CSP can break analytics/chat/embedded scripts.
- Safe strategy:
  - start with HSTS/XFO/XCTO/Referrer-Policy/Permissions-Policy,
  - run CSP in `Report-Only`,
  - enforce after report-driven fixes.
- Rollback: disable problematic header/policy quickly.

### API-01 (anti-scraping)
- Real risk: easy large-scale extraction of public catalog data.
- Regression risk: false positives affecting normal users/bots.
- Safe strategy:
  - preserve normal browsing patterns,
  - set burst + sustained limits per IP/session,
  - stricter limits for heavier endpoints.
- Rollback: increase limits or disable strict profile.

### API-02 (public field minimization)
- Real risk: operational leakage through unnecessary public fields.
- Regression risk: card/filter/frontend behavior breaks.
- Safe strategy:
  - approve DEC-03 first,
  - staged release (read model first),
  - validate frontend contract before switching.
- Rollback: revert serializer/public DTO.

## What we do now (real-risk focus)
`Now`:
- SEC-00
- DEC-03
- SEC-03 baseline headers
- SEC-02

`Next`:
- API-01 baseline anti-abuse
- API-02 field minimization rollout (after DEC-03)

`Later / based on data`:
- API-02 full tighten
- PERF-02 advanced tuning
- enterprise-level anti-bot mechanisms (only if justified by abuse data)

## Minimal verification checklist per iteration
1. Auth smoke: login/me/logout, admin access, favorites add/remove.
2. Public smoke: catalog summary/items/filters, item page, share pages.
3. Import smoke: upload/list/details/clear for allowed roles.
4. Monitoring smoke: 401/403/429 trends stay in expected bounds.
5. SEO smoke: canonical/meta/redirect behavior stays index-safe.

## Work log
| Date | ID | Action | Result |
|---|---|---|---|
| 2026-03-24 | INIT | Created tracker file | Active website security backlog |
| 2026-03-24 | PLAN-REFINE | Refined plan to real-risk approach | Added dependencies, gates, phased rollout, rollback, and checklists |
| 2026-03-24 | LANG-EN | Rewrote tracker to English | Removed translit ambiguity for security decisions |
| 2026-03-24 | SEC-00-DRAFT | Published endpoint access matrix artifact | Added `docs/SECURITY_ENDPOINT_ACCESS_MATRIX.md` with role/token/mode access mapping |
| 2026-03-24 | DEC-05 | ADR boundary clarified | No ADR required for SEC-00 documentation; ADR required before changing access model boundaries |
| 2026-03-24 | DEC-01 | Canonical host approved | Selected `reactiv.pro` as canonical host |
| 2026-03-24 | DEC-02 | CORS allowlist approved | Trusted origins fixed for prod/local development |
| 2026-03-24 | SEC-01 | CORS restricted to allowlist | Implemented strict origin allowlist with config override (`CORS_ALLOWED_ORIGINS`) |
| 2026-03-24 | SEC-03-P1 | Added baseline response security headers | Implemented HSTS/XFO/XCTO/Referrer-Policy/Permissions-Policy + `CSP-Report-Only` on backend |
| 2026-03-24 | SEC-02-P1 | Implemented CSRF enforcement layer | Added `x-csrf-token` validation for cookie-auth mutating endpoints + frontend token propagation from auth endpoints |
| 2026-03-24 | SEC-02-P2 | Added CSRF rollback feature flag | Introduced `CSRF_PROTECTION_ENABLED` (default `true`) to allow emergency disable without code rollback |
| 2026-03-24 | API-01-P1 | Added baseline public catalog anti-abuse guard | Added per-IP rate limit for public catalog read endpoints with configurable thresholds |
| 2026-03-24 | API-01-P2 | Added public page-size cap on catalog items | Public `/api/catalog/items` now enforces `PUBLIC_CATALOG_MAX_PAGE_SIZE` (default `40`) |
| 2026-03-24 | DEC-03 | Approved public field policy | Added `docs/PUBLIC_CATALOG_FIELDS.md` as DEC-03 artifact |
| 2026-03-24 | API-02-P1 | Masked additional public catalog fields | Hid external/CRM identifiers and sensitive filter dimensions for public users |
| 2026-03-25 | API-02-P2 | Blocked sensitive public catalog filters | Public requests now ignore internal/contact filters to prevent inference probing |
| 2026-03-25 | SEC-03-P2 | Added CSP report telemetry endpoint | Added `POST /api/security/csp-report`, enabled CSP report-uri enrichment and normalized security logs |
| 2026-03-25 | SEC-03-P3 | Disabled caching for auth/session responses | Added `no-store` headers for `/api/auth/login`, `/api/auth/me`, `/api/auth/logout` |
| 2026-03-25 | SEC-03-P4 | Added CSP enforcement rollout flag | Added `CSP_ENFORCE_ENABLED`/`CSP_ENFORCE_POLICY` for controlled switch from report-only to enforced CSP |
| 2026-03-25 | SEC-02-P3 | Added origin/referrer check for mutating auth requests | Added allowlist validation for `Origin`/`Referer` on authenticated state-changing endpoints with rollback flag |
| 2026-03-25 | API-01-P3 | Hardened rate limiter state management | Added cleanup interval and max-buckets cap to keep in-memory limiter bounded under abuse |
| 2026-03-25 | API-01-P4 | Added public query complexity caps | Capped `page`, `search` length and filter-list sizes for public catalog requests to reduce abusive heavy queries |
| 2026-03-25 | API-01-P5 | Added public rate-limit response headers | Public catalog endpoints now return `X-RateLimit-Limit/Remaining/Reset` (+ `Retry-After` on 429) for better control and monitoring |
| 2026-03-25 | PERF-01-P1 | Scoped cache policy by audience | Public catalog responses now use `public` cache-control; authenticated responses remain `private` |
| 2026-03-25 | PERF-01-P2 | Added caching for catalog item details | Added ETag + scoped cache-control for `/api/catalog/items/:id` with 304 support |
| 2026-03-25 | PERF-01-P3 | Enabled app-level response compression | Added built-in gzip/br compression (configurable) for compressible payloads with size threshold and `Vary: Accept-Encoding` |
| 2026-03-25 | PERF-02-P1 | Deferred analytics/chat bootstrap | Switched Yandex Metrika to load on idle after page load and Jivo chat to interaction/timeout-based lazy load |
| 2026-03-25 | QA-01-P1 | Executed local smoke re-audit | Added `docs/SECURITY_QA_REPORT_2026-03-25.md` with outcomes and residual risks |
| 2026-03-25 | STATUS-CLOSE | Closed implemented tasks after verification | Set `SEC-02`, `SEC-03`, `API-01`, `API-02`, `PERF-01`, `QA-01` to `done` |

## Tracking rules
- Order is flexible, but respect `Depends on`.
- On task start, set status to `in_progress`.
- After verification, set status to `done` and append a work log row.
- If blocked by a decision/dependency, set `blocked` with reason.
- Every code iteration must be small and rollback-friendly.

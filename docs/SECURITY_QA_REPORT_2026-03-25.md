# Security QA Re-Audit Report (2026-03-25)

Owner: Codex + project owner  
Scope: local smoke verification for implemented security/perf controls

## Environment
- Host: local (`127.0.0.1`)
- API: `http://127.0.0.1:3001/api`
- Build checks:
  - `npm --prefix backend run typecheck`
  - `npm --prefix frontend run build`

## Verified checks
### Auth / CSRF / session
- `POST /api/auth/login` -> `200`, `Cache-Control: no-store, no-cache, must-revalidate`, CSRF token issued.
- `GET /api/auth/me` (auth cookie) -> `200`, `Cache-Control: no-store, no-cache, must-revalidate`.
- `POST /api/favorites/:id` without CSRF token -> `403`.
- `POST /api/favorites/:id` with valid CSRF + bad `Origin` -> `403`.
- `POST`/`DELETE /api/favorites/:id` with valid CSRF + allowed `Origin` -> `200`.
- `POST /api/auth/logout` with valid CSRF -> `200`, `Cache-Control: no-store, no-cache, must-revalidate`.
- `GET /api/auth/me` after logout -> `401`.

### Public catalog protection
- Platform mode switched to `open` for public checks, then restored to original value.
- `GET /api/catalog/summary` -> `200`, public cache policy present.
- `GET /api/catalog/items?page=1&pageSize=100` -> `200`, effective `pageSize` capped to `40`.
- Public rate-limit headers present:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`
- `GET /api/catalog/filters` -> sensitive fields masked for public:
  - `externalId=[]`
  - `crmRef=[]`
  - `daysOnSaleMin=null`
  - `daysOnSaleMax=null`
- `GET /api/catalog/items/:id`:
  - `ETag` returned
  - revalidation with `If-None-Match` -> `304`

### Security headers / CSP telemetry
- Baseline headers present on API responses:
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - `Content-Security-Policy-Report-Only` (or enforced CSP when enabled by flag)
- `POST /api/security/csp-report` with sample payload -> `204`.

### Performance controls
- Response compression detected for catalog responses (`Content-Encoding: br`) with `Vary: Accept-Encoding`.
- Public cache-control applied to public catalog responses; private cache-control retained for authenticated responses.

### Access checks
- `GET /api/imports?limit=1` (admin auth) -> `200`.

## Residual risks / limitations
- Rate limiter is in-memory and per-instance (not shared across multiple backend replicas).
- CSP is still in staged rollout mode; strict enforcement requires ongoing report review and policy tuning.
- Performance optimization of third-party scripts (`PERF-02`) is not in this report.
- SEO canonicalization infra step (`SEO-01`) remains blocked.

## Conclusion
- Implemented controls for `SEC-02`, `SEC-03`, `API-01`, `API-02`, and `PERF-01` passed local smoke checks.
- Re-audit artifact is complete for `QA-01`.

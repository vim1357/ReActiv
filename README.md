# Lease Platform MVP (ReActiv)

MVP platform for importing leasing lots from Excel and publishing them in a unified public showcase.

## What Is Implemented

### Core product
- Backend API: Fastify + TypeScript + SQLite.
- Frontend: React + Vite + TypeScript.
- Cookie session auth.
- Roles:
  - `admin`
  - `stock_owner`
  - `manager`
- Platform mode switch:
  - `closed` (login required)
  - `open` (public showcase for guests, hidden admin entry is still available).

### Import pipeline
- `.xlsx` import (multipart upload).
- Multi-tenant import profiles:
  - `gpb`
  - `reso`
  - `alpha`
- Tenant-specific header mapping.
- Delta stats per batch:
  - `added`
  - `removed`
  - `unchanged`
  - `updated` (kept for compatibility; MVP logic is offer-code driven).
- Import history + batch diagnostics.
- Snapshot strategy:
  - `vehicle_offers`: current active snapshot.
  - `vehicle_offer_snapshots`: historical snapshots by batch.

### Catalog / showcase
- Public showcase with filters, sorting, pagination, lot details, gallery.
- Catalog summary endpoint (includes "new this week" metric).
- Media preview/galleries for Yandex Disk links.

### Admin and analytics
- Admin user management:
  - create
  - delete
  - reset password
  - edit user metadata (`company`, `phone`, `notes`)
- Platform mode toggle from admin UI.
- Activity tracking:
  - user events
  - guest events
  - guest summary dashboard metrics

### Share / SEO / integrations
- Share endpoints with Open Graph metadata for messengers:
  - `/showcase/:id`
  - `/showcase/:id/preview-image`
- Static SEO/meta in frontend root page.
- Yandex verification meta tag.
- Yandex Metrika integration.
- Jivo chat script integration.
- Legal links in UI footer and login/registration flow.

## Repository Structure

```text
LeasePlatform/
  backend/
    src/
    data/
  frontend/
    src/
    public/
  docs/
    ARCHITECTURE_GUARDRAILS.md
    IMPORT_CONTRACT.md
  scripts/
  README.md
```

## Tech Stack

- Frontend: React, Vite, TypeScript, React Router
- Backend: Fastify, TypeScript
- DB: SQLite (`better-sqlite3`)
- Import/validation: `xlsx`, `zod`

## Local Setup

### Prerequisites
- Node.js 20+
- npm

### Install

```bash
npm install
npm --prefix backend install
npm --prefix frontend install
```

### Run (both apps)

```bash
npm run dev
```

Useful commands:

```bash
npm run dev:stop
npm run dev:restart
```

### Run separately (optional)

Backend:

```bash
npm --prefix backend run dev
```

Frontend:

```bash
npm --prefix frontend run dev
```

## Environment Variables

### Backend
- `PORT` (default: `3001`)
- `HOST` (default: `0.0.0.0`)
- `TRUST_PROXY_HOPS` (optional, non-negative integer; default: `1` in production, `0` locally; controls how many proxy hops are trusted for real client IP resolution)
- `DATABASE_PATH` (recommended in production: absolute path, e.g. `/data/lease-platform.db`)
- `PUBLIC_WEB_BASE_URL` (default: `https://reactiv.pro`)
- `PUBLIC_SHARE_BASE_URL` (default: `https://api.reactiv.pro`)
- `CORS_ALLOWED_ORIGINS` (optional, CSV allowlist; default: `https://reactiv.pro,https://www.reactiv.pro,http://localhost:5173,http://127.0.0.1:5173`)
- `CSP_REPORT_ONLY_POLICY` (optional, overrides default `Content-Security-Policy-Report-Only`)
- `CSP_REPORT_ENDPOINT_ENABLED` (optional, default: `true`; enables `POST /api/security/csp-report` intake for CSP telemetry)
- `CSP_ENFORCE_ENABLED` (optional, default: `false`; when `true`, sends `Content-Security-Policy` instead of report-only)
- `CSP_ENFORCE_POLICY` (optional, defaults to report-only policy value; used only when `CSP_ENFORCE_ENABLED=true`)
- `CSRF_SECRET` (optional, overrides server-generated CSRF signing secret)
- `CSRF_PROTECTION_ENABLED` (optional, default: `true`; set to `false` only for emergency rollback)
- `CSRF_ORIGIN_CHECK_ENABLED` (optional, default: `true`; checks `Origin`/`Referer` on authenticated mutating requests)
- `RESPONSE_COMPRESSION_ENABLED` (optional, default: `true`; enables gzip/br for compressible responses)
- `RESPONSE_COMPRESSION_MIN_SIZE_BYTES` (optional, default: `1024`; payload size threshold before compression)
- `PUBLIC_CATALOG_RATE_LIMIT_WINDOW_MS` (optional, default: `60000`)
- `PUBLIC_CATALOG_RATE_LIMIT_CLEANUP_INTERVAL_MS` (optional, default: `60000`)
- `PUBLIC_CATALOG_RATE_LIMIT_MAX_BUCKETS` (optional, default: `20000`)
- `PUBLIC_CATALOG_SUMMARY_MAX_REQUESTS` (optional, default: `120`)
- `PUBLIC_CATALOG_FILTERS_MAX_REQUESTS` (optional, default: `120`)
- `PUBLIC_CATALOG_ITEMS_MAX_REQUESTS` (optional, default: `180`)
- `PUBLIC_CATALOG_MAX_PAGE` (optional, default: `100` for public requests)
- `PUBLIC_CATALOG_MAX_PAGE_SIZE` (optional, default: `40` for public requests)
- `PUBLIC_CATALOG_MAX_SEARCH_LENGTH` (optional, default: `120` for public requests)
- `PUBLIC_CATALOG_MAX_FILTER_VALUES_PER_FIELD` (optional, default: `12` for public requests)
- `PUBLIC_CATALOG_ITEM_DETAILS_MAX_REQUESTS` (optional, default: `240`)
- `BOOTSTRAP_ADMIN_LOGIN` (optional)
- `BOOTSTRAP_ADMIN_PASSWORD` (optional)

### Frontend
- `VITE_API_BASE_URL` (default local dev: `http://127.0.0.1:3001/api`)

## Production (current)

- Public frontend: `https://reactiv.pro`
- Public frontend mirror: `https://www.reactiv.pro`
- Backend API: `https://api.reactiv.pro/api`
- Backend health: `https://api.reactiv.pro/health`

Hosting:
- Frontend: Timeweb Cloud App Platform
- Backend: Railway
- Database: SQLite on Railway persistent volume

## API Overview

Base URL: `/api`

### Auth
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`

### Platform mode
- `GET /platform/mode`
- `PATCH /admin/platform/mode` (admin)

### Import
- `GET /imports?limit=20&tenantId=gpb|reso|alpha`
- `POST /imports?tenantId=gpb|reso|alpha`
- `GET /imports/:id`
- `DELETE /imports?tenantId=gpb|reso|alpha`

### Catalog
- `GET /catalog/summary`
- `GET /catalog/items`
- `GET /catalog/items/:id`
- `GET /catalog/filters`

### Media
- `GET /media/preview?url=...`
- `GET /media/preview-image?url=...`
- `GET /media/gallery?url=...`

### Admin users
- `GET /admin/users`
- `POST /admin/users`
- `PATCH /admin/users/:id/meta`
- `POST /admin/users/:id/reset-password`
- `DELETE /admin/users/:id`

### Activity
- `POST /public/activity/events` (guest)
- `POST /activity/events` (authorized user)
- `GET /admin/activity`
- `GET /admin/activity/guests`
- `GET /admin/activity/guests/summary`

### Share (outside `/api`)
- `GET /showcase/:id`
- `GET /showcase/:id/preview-image`

## Import Contract (MVP behavior)

- Main matching key: normalized `offer_code`.
- For shorter numeric-style keys, zero-padding is used where profile requires it.
- Row is treated as blocking/critical and skipped if:
  - key is empty
  - brand is empty
  - duplicate key inside same file
- Non-blocking field issues are stored as warnings and row can still be imported.
- Deltas are calculated mostly by key presence between last successful batch and current batch.

See details in:
- `docs/IMPORT_CONTRACT.md`
- `docs/ARCHITECTURE_GUARDRAILS.md`
- `docs/TASKS_SITE_SECURITY.md` (risk-driven security backlog)
- `docs/TASKS_SEO_CONVERSION.md` (separate SEO/conversion backlog)

## Scripts

### Backend
- `npm --prefix backend run dev`
- `npm --prefix backend run build`
- `npm --prefix backend run start`
- `npm --prefix backend run typecheck`
- `npm --prefix backend run create-user -- --login <login> --password <password> [--name "Display Name"]`
- `npm --prefix backend run set-user-password -- --login <login> --password <password>`

### Frontend
- `npm --prefix frontend run dev`
- `npm --prefix frontend run build`
- `npm --prefix frontend run preview`

## Known Operational Notes

- `reactiv.pro/showcase/:id` is SPA runtime route; per-lot messenger preview is currently guaranteed via API share route (`api.reactiv.pro/showcase/:id`).
- For stable preview after OG changes, messenger cache invalidation may be needed.
- Keep `DATABASE_PATH` absolute in production to avoid ephemeral DB resets after redeploy.

## Smoke Checklist

1. Backend `/health` returns `200`.
2. Login works for admin and non-admin users.
3. Import for each tenant profile (`gpb`, `reso`, `alpha`) succeeds.
4. Import summary and warnings are visible in upload UI.
5. Showcase filters and lot detail pages work.
6. Activity events are visible in admin activity pages.
7. Share URL (`https://api.reactiv.pro/showcase/<id>`) returns OG meta and preview image.

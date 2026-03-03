# Lease Platform MVP

Local MVP for importing vehicle leasing offers from Excel (`.xlsx`) and browsing them in catalog and showcase views.

## Current Scope

Implemented:
- Backend API on Fastify + TypeScript + SQLite.
- Cookie-based auth (login/password, no public registration).
- Excel import flow with Russian header mapping and row validation.
- Import history, batch deltas, and row-level import diagnostics.
- Catalog API with filtering, search, sorting, and pagination.
- Media preview endpoints for Yandex Disk links.
- Frontend React app with pages:
  - `/upload`
  - `/catalog`
  - `/showcase`

Out of scope:
- Public registration flow.
- Advanced role model (RBAC).
- Cloud deployment.
- Background workers.
- External system sync.

## Repository Structure

```text
LeasePlatform/
  backend/
    src/
    data/                 # SQLite DB + sample xlsx files
  frontend/
    src/
  Architecture.md
  task.md
  tasks.md
```

## Tech Stack

- Frontend: React, Vite, TypeScript, React Router
- Backend: Fastify, TypeScript
- Data: SQLite (`better-sqlite3`)
- Import/validation: `xlsx`, `zod`

## Prerequisites

- Node.js 20+ recommended
- npm

## Local Setup

### 1) Install dependencies

Workspace (for unified dev commands):
```bash
npm install
```

Backend:
```bash
cd backend
npm install
```

Frontend:
```bash
cd frontend
npm install
```

### 2) Start both apps with one command (recommended)

```bash
npm run dev
```

Useful commands:
```bash
npm run dev:stop
npm run dev:restart
```

### 3) Start apps separately (optional)

Backend:

```bash
cd backend
npm run dev
```

Backend defaults:
- Host: `0.0.0.0`
- Port: `3001`

Health check:
```bash
curl http://127.0.0.1:3001/health
```

Frontend:

```bash
cd frontend
npm run dev
```

Frontend defaults:
- Host: `127.0.0.1`
- Port: `5173`

Open:
- `http://127.0.0.1:5173/login`
- Create a user first:
  `cd backend && npm run create-user -- --login admin --password <strong-password> --name "Admin"`

## Environment

Frontend:
- `VITE_API_BASE_URL` (optional)
  - Default: `http://127.0.0.1:3001/api`

Backend:
- `PORT` (optional, default `3001`)
- `HOST` (optional, default `0.0.0.0`)

## Production (2026-02-24)

- Frontend app: `https://reactiv.pro`
- Frontend mirror: `https://www.reactiv.pro`
- Backend API: `https://api.reactiv.pro/api`
- Backend health check: `https://api.reactiv.pro/health`

Hosting:
- Frontend: Timeweb Cloud App Platform
- Backend: Railway
- Data store: SQLite on Railway persistent volume (`/app/data/lease-platform.db`)

DNS (current target setup):
- `A @ -> 92.246.76.92` (frontend, Timeweb)
- `A www -> 92.246.76.92` (frontend, Timeweb)
- `CNAME api -> 7kjdju0m.up.railway.app` (backend, Railway)
- `TXT _railway-verify.api -> railway-verify=...` (Railway domain verification)

## NPM Scripts

Backend (`backend/package.json`):
- `npm run dev` - run dev server with `tsx`
- `npm run build` - compile TypeScript to `dist`
- `npm run start` - run compiled server from `dist/server.js`
- `npm run typecheck` - TypeScript checks without emit
- `npm run create-user -- --login <login> --password <password> [--name "Display Name"]` - create user credentials
- `npm run set-user-password -- --login <login> --password <password>` - update password for existing user

Frontend (`frontend/package.json`):
- `npm run dev` - start Vite dev server
- `npm run build` - TypeScript checks and production build
- `npm run preview` - preview built app

## API Overview

Base URL: `http://127.0.0.1:3001/api`

Auth:
- `POST /auth/login` - login and set session cookie
- `GET /auth/me` - current authorized user
- `POST /auth/logout` - clear session

Import:
- `POST /imports` - upload `.xlsx` file (multipart field: `file`, max 10 MB)
- `GET /imports?limit=20` - list recent imports
- `DELETE /imports` - clear all imported data (`vehicle_offers`, `import_errors`, `import_batches`)
- `GET /imports/:id` - get one import with errors

Catalog:
- `GET /catalog/items` - paged list with filters/query params
- `GET /catalog/filters` - distinct filter values + numeric ranges

Media:
- `GET /media/preview?url=...` - resolve preview URL
- `GET /media/preview-image?url=...` - proxy preview image bytes

## Catalog Query Params

Supported fields include:
- Multi-value string filters:
  - `offerCode`, `status`, `brand`, `model`, `modification`, `vehicleType`
  - `ptsType`, `responsiblePerson`, `storageAddress`, `bookingStatus`
  - `externalId`, `crmRef`, `websiteUrl`, `yandexDiskUrl`
- Boolean filters:
  - `hasEncumbrance`, `isDeregistered`
- Number range filters:
  - `priceMin`, `priceMax`
  - `yearMin`, `yearMax`
  - `mileageMin`, `mileageMax`
  - `keyCountMin`, `keyCountMax`
  - `daysOnSaleMin`, `daysOnSaleMax`
- Other:
  - `search`
  - `sortBy` in `created_at | price | year | mileage_km | days_on_sale`
  - `sortDir` in `asc | desc`
  - `page` (>= 1)
  - `pageSize` (1..100)

## Database

SQLite file:
- `backend/data/lease-platform.db`

Main tables:
- `import_batches`
- `import_errors`
- `vehicle_offers`
- `vehicle_offer_snapshots`
- `users`
- `auth_sessions`

Schema is initialized on backend startup.

## Import File Notes

- Only `.xlsx` files are accepted.
- Max size: 10 MB.
- First non-empty sheet is used.
- Headers are normalized and mapped from Russian aliases.
- Weekly import uses `Код предложения` (`offer_code`) as the only matching key between files.
- `offer_code` is normalized before matching:
  - spaces are removed;
  - numeric values shorter than 6 chars are left-padded with zeroes;
  - example: `22804` -> `022804`.
- A row is treated as **critical and skipped** if:
  - `offer_code` is empty;
  - `brand` is empty;
  - duplicate `offer_code` appears inside the same file.
- Rows with non-critical data issues are still imported into the current snapshot:
  - unsupported/empty values in soft fields (for example `price`, `mileage`, `year`) are nullified;
  - the issue is stored in `import_errors` and shown in the upload dashboard.
- `key_count` accepts these source forms without a warning:
  - `1 ключ`
  - `нет ключей`
  - `полный комплект`
  - empty value
- `is_deregistered` is currently treated as “date is filled / date is empty”:
  - any non-empty value is accepted;
  - empty value is stored as a warning (`Не заполнена дата "Снят с учета"`).
- New file upload does **not** destroy history:
  - `vehicle_offers` stores the latest active snapshot only;
  - `vehicle_offer_snapshots` stores valid rows for every import batch.
- Batch delta is currently calculated by `offer_code` only:
  - `added` = new offer codes in the current file;
  - `removed` = offer codes that existed in the previous successful batch but are absent now;
  - `unchanged` = offer codes present in both batches;
  - field-level changes inside the same `offer_code` do not count as `updated` in MVP.
- Sample files are available in:
  - `backend/data/sample-import.xlsx`
  - `backend/data/sample-import-unicode.xlsx`

## Smoke Check

1. Start backend on `http://127.0.0.1:3001`.
2. Start frontend on `http://127.0.0.1:5173`.
3. Create a user:
   `cd backend && npm run create-user -- --login manager --password <strong-password> --name "Менеджер"`
4. Open `http://127.0.0.1:5173/login` and sign in.
5. Upload a valid `.xlsx` file.
6. Confirm import summary shows:
   - new arrivals (`added`)
   - sold / removed (`removed`)
   - skipped rows
   - matched offer codes (`unchanged`)
7. Open `/catalog` and confirm data rows are visible.
8. Apply filters and verify results update.
9. Open `/showcase` and check card rendering and image previews.

## Known Notes

- Data quality depends on source spreadsheet normalization.
- Some source fields may contain mixed formats (text/numeric/date-like values), which can affect filter semantics until data normalization is tightened.

## Related Docs

- `Architecture.md` - architecture and domain model.
- `task.md` / `tasks.md` - granular execution plan (T001..T051).

## Session Status (2026-02-19)

This section is a checkpoint to continue work later without losing context.

Completed and verified:
- Auth screen styling updates (brand block, spacing, buttons, RU copy, `admin/admin` credentials).
- Upload page and showcase visual refinements (RU labels, spacing, filter layout updates, sort controls, pagination styling).
- Showcase cards redesign (4-column look, adjusted typography, market badges, no-buy button in preview cards).
- Detail page (`/showcase/:itemId`) implemented:
  - open from showcase card click;
  - left specs + right gallery layout;
  - full-screen image viewer with next/prev and close;
  - thumbnail strip with `+N photo` button;
  - contact block with email and Telegram CTA links (prefilled message includes lot code).
- Yandex media behavior improved:
  - main image loading kept stable;
  - thumbnail/lightbox flow works from available links.
- Filters logic improved in showcase:
  - dependent brand/model behavior;
  - type/status pills;
  - year quick presets;
  - number inputs formatting for price/mileage.
- Display order adjusted so lots with photos are listed before lots without photos.

Known open issue (not resolved yet):
- Returning from detail page to showcase restores filters/page, but exact scroll position is still not reliably restored in all cases.
- Attempted fixes already tested:
  - sessionStorage-based scroll restore loop in `frontend/src/pages/ShowcasePage.tsx`;
  - back navigation via browser history (`navigate(-1)`) from `frontend/src/pages/ShowcaseItemPage.tsx`.
- Current user-reported result: filters + page restore works, scroll restore does not.

Suggested next step when resuming:
- Rework showcase scroll restoration using a route-level scroll state strategy tied to history entry key (instead of timeout retries), then retest with real navigation flows.

# Frontend Security Headers Rollout (`reactiv.pro`)

Last updated: 2026-03-25
Owner: Codex + project owner
Scope: Timeweb frontend host (`reactiv.pro`, `www.reactiv.pro`)

## Goal
Enable baseline browser hardening headers on frontend HTML responses without breaking showcase conversion flow.

Target headers:
- `Strict-Transport-Security`
- `X-Frame-Options`
- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Content-Security-Policy-Report-Only` (phase 1), then `Content-Security-Policy` (phase 2)

## Why this is separated from backend
- API headers are already set in backend code.
- Frontend host is managed at hosting/edge layer (Timeweb/Caddy), outside this repository.
- Therefore rollout must be done via hosting config and verified externally.

## Safe rollout strategy

### Phase 0: Prepare
1. Confirm production domains:
   - canonical: `reactiv.pro`
   - mirror: `www.reactiv.pro`
2. Save a baseline header snapshot:
   - `curl -sI https://reactiv.pro`
   - `curl -sI https://www.reactiv.pro`

### Phase 1: Baseline headers + CSP report-only
Apply baseline headers and `CSP-Report-Only` first. Do not enforce CSP yet.

Suggested Caddy header block (adjust to your exact Timeweb/Caddy app config):

```caddyfile
header {
  Strict-Transport-Security "max-age=31536000; includeSubDomains"
  X-Frame-Options "DENY"
  X-Content-Type-Options "nosniff"
  Referrer-Policy "strict-origin-when-cross-origin"
  Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  Content-Security-Policy-Report-Only "default-src 'self' https: data: blob:; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https: wss:; frame-src 'self' https:; report-uri https://api.reactiv.pro/api/security/csp-report"
}
```

Notes:
- Keep policy intentionally broad at first to avoid production breakage.
- `report-uri` points to existing backend endpoint `POST /api/security/csp-report`.

### Phase 2: Verify and tighten
1. Verify headers are present:
   - `curl -sI https://reactiv.pro`
   - `curl -sI https://www.reactiv.pro`
2. Check no regression in key user flows:
   - landing load,
   - showcase list/details,
   - analytics/chat loading,
   - login/admin flows.
3. Collect CSP reports for at least 24-48 hours.
4. Replace report-only with enforced CSP only after policy cleanup:
   - switch from `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.

## Verification checklist
Run automated check from repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./scripts/check-frontend-security-headers.ps1
```

1. Header presence on both hosts:
   - `Strict-Transport-Security`
   - `X-Frame-Options`
   - `X-Content-Type-Options`
   - `Referrer-Policy`
   - `Permissions-Policy`
   - `Content-Security-Policy-Report-Only` (or enforced CSP later)
2. No spike in:
   - frontend JS errors,
   - 4xx/5xx on API,
   - conversion-critical flow failures.
3. CSP telemetry receives reports (`204` on report endpoint).

## Rollback
If user flow breaks:
1. Remove/relax CSP first (keep other baseline headers).
2. Re-deploy host config.
3. Re-test landing, catalog, item page, auth flow.

Avoid rolling back HSTS/XFO/XCTO unless there is a confirmed functional blocker.

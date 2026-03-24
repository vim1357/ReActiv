# Canonical Redirect Rollout (SEO-01)

Date: 2026-03-25  
Scope: backend runtime configuration for host canonicalization (`www` -> `non-www`)

## Goal
Enable strict canonical host behavior with low regression risk and quick rollback.

## Runtime flags
- `CANONICAL_REDIRECT_ENABLED`:
  - `true` -> redirect logic active
  - `false` -> redirect logic disabled
- `CANONICAL_WEB_HOST`:
  - canonical host target (for this project: `reactiv.pro`)
- `CANONICAL_REDIRECT_FROM_HOSTS`:
  - comma-separated source hosts to redirect from
  - recommended: `www.reactiv.pro`

## Recommended production config
```env
CANONICAL_REDIRECT_ENABLED=true
CANONICAL_WEB_HOST=reactiv.pro
CANONICAL_REDIRECT_FROM_HOSTS=www.reactiv.pro
```

## Rollout sequence (best practice)
1. Enable on stage with production-like host headers.
2. Verify:
   - `GET/HEAD` to `www.reactiv.pro/*` return `308` to `https://reactiv.pro/*`.
   - Query string is preserved.
   - API routes (`/api/*`) are not redirected by backend hook.
3. Enable on production.
4. Monitor:
   - redirect count trend,
   - 4xx/5xx around share/landing/showcase routes,
   - SEO crawl/index signals.

## Quick verification examples
```bash
curl -I -H "Host: www.reactiv.pro" "https://api.reactiv.pro/landing?utm=test"
curl -I -H "Host: reactiv.pro" "https://api.reactiv.pro/landing?utm=test"
```

Expected:
- first request: `308` with `Location: https://reactiv.pro/landing?utm=test`
- second request: non-redirect response

## Rollback
Set `CANONICAL_REDIRECT_ENABLED=false` and restart backend.


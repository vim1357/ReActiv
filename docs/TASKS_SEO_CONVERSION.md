# SEO & Conversion Tasks (separate from security backlog)

Last updated: 2026-03-25  
Owner: Product + Engineering

This file tracks non-security growth tasks that were intentionally split from `docs/TASKS_SITE_SECURITY.md`.

## Task register
| ID | Priority | Status | Task | Definition of done |
|---|---|---|---|---|
| SEO-01 | P1 | todo | Enable canonical redirects `www.reactiv.pro -> reactiv.pro` | Redirects are enabled in production, return `308`, keep path/query, no loops, and no API regressions |
| PERF-02 | P1 | todo | Improve mobile Core Web Vitals on public pages | `LCP <= 2.8s`, `CLS <= 0.10`, `TBT <= 0.25s` (mobile profile, median, agreed routes) with analytics/chat still operational |

## Recommended task-manager wording (short)
1. `SEO: Включить canonical redirect www -> reactiv.pro и подтвердить 308 без регрессий.`
2. `SEO/Conversion: Довести mobile Core Web Vitals (LCP/CLS/TBT) до целевых SLO на ключевых публичных страницах.`


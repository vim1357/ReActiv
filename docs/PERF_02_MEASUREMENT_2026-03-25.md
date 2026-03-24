# PERF-02 Measurement Report (2026-03-25)

Scope: validate `PERF-02` impact for public pages using mobile Lighthouse profile.  
Targets: [FRONTEND_PERFORMANCE_SLO.md](./FRONTEND_PERFORMANCE_SLO.md)

## Baseline source (`before`)
- Source: previously saved audit snapshot from project chat (agreed as valid baseline).
- Baseline values:
  - Lighthouse Performance: `23`
  - LCP: `~7.2s`
  - TBT: `~1.5s`
  - CLS: `~0.233`

## Measurement method (`after`)
- Tool: Lighthouse CLI (`v12.8.2`), mobile form factor, simulated throttling.
- Browser: local Chrome headless.
- Runs: 3 per route, median used.
- Routes:
  - `https://reactiv.pro/`
  - `https://reactiv.pro/showcase/29119` (representative public item)

## Raw run results
| Route | Run | Performance | LCP (s) | TBT (s) | CLS |
|---|---:|---:|---:|---:|---:|
| `/` | 1 | 33 | 7.33 | 0.64 | 0.233 |
| `/` | 2 | 26 | 6.93 | 1.17 | 0.233 |
| `/` | 3 | 49 | 6.61 | 0.19 | 0.233 |
| `/showcase/29119` | 1 | 57 | 7.00 | 0.10 | 0.160 |
| `/showcase/29119` | 2 | 52 | 6.87 | 0.23 | 0.160 |
| `/showcase/29119` | 3 | 60 | 5.90 | 0.09 | 0.160 |

## Median summary
| Route | Performance (median) | LCP (median) | TBT (median) | CLS (median) |
|---|---:|---:|---:|---:|
| `/` | 33 | 6.93s | 0.64s | 0.233 |
| `/showcase/29119` | 57 | 6.87s | 0.10s | 0.160 |

## Baseline delta (`/`, before vs after median)
| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Performance | 23 | 33 | +10 (+43%) |
| LCP | 7.2s | 6.93s | -0.27s (-3.8%) |
| TBT | 1.5s | 0.64s | -0.86s (-57.3%) |
| CLS | 0.233 | 0.233 | 0.000 (no change) |

## SLO check (DEC-04)
| Metric | SLO target | `/` median | `/showcase` median | Status |
|---|---:|---:|---:|---|
| LCP | <=2.8s | 6.93s | 6.87s | not met |
| TBT | <=0.25s | 0.64s | 0.10s | partial (only showcase meets) |
| CLS | <=0.10 | 0.233 | 0.160 | not met |

## Conclusion
- `PERF-02` shows material improvement in JavaScript blocking time.
- SLO is not yet met for LCP and CLS on key public routes.
- Task status should remain `in_progress` until additional performance work is implemented and re-measured.

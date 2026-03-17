# ADR-0001: Card Preview Storage On Railway Volume (MVP)

## Status

Accepted

## Context

Public showcase cards currently depend on external media sources at request time.
This makes first paint of card images slower and less stable because previews are
resolved from third-party sources on demand.

For MVP we need a low-friction way to improve showcase image speed without
re-architecting full gallery storage.

## Decision

We will store only card preview thumbnails locally on the backend volume.

- Storage location: backend-local data directory / Railway volume
- Scope: current `vehicle_offers` only
- Stored asset: one generated JPEG thumbnail per `tenant_id + offer_code`
- DB pointer: `card_preview_path`
- Fallback: if local preview is missing, existing external preview flow remains active

We are explicitly not storing full galleries in this step.

## Consequences

### Positive

- Faster and more stable showcase card image loading
- Minimal operational complexity for MVP
- No change to import semantics or offer identity
- Safe expand-switch-cleanup rollout because old preview path stays working

### Negative

- Railway volume is not the final long-term media backend
- Files can become orphaned after import churn until cleanup is added
- Full card gallery still depends on external media sources

## Follow-up

- If preview storage proves useful, next step is either:
  - store main image too, or
  - move preview storage to object storage / bucket backend

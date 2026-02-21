# TravelTales Engine Bundle (Vendor Snapshot)

This folder is an **integration-oriented snapshot** of the image-ranking pipeline code intended to be vendored into the TravelTales backend repo.

## What this is
- `bundle/src/irp/` contains a copy of the pipeline’s **non-destructive core** modules (M1 quality, M2 pHash dedupe, optional embed/diversity utilities).
- `bundle/labs/**` contains **select lab cores only** that are required for CLIP Stage-2 dedupe and M3 categories, but are still considered experimental in the main repo.

## What this is NOT
- This is **not** the canonical source of truth. The canonical code lives in:
  - `src/irp/` (production)
  - `labs/` (experiments)
- This bundle intentionally excludes:
  - any deletion/move logic (e.g. `src/irp/prune.py`)
  - manual workflows (`out_lab_manual/`)
  - HTML gallery generation scripts
  - lab runners and test fixtures

## Determinism expectations
- TravelTales integration should treat pipeline outputs as **artifacts** (JSONL/JSON).
- No destructive file operations should occur by default.
- Any logging should be controlled via flags.

## Keeping this bundle updated
Run:

- `python integrations/traveltales_engine/sync_bundle.py --check`
- `python integrations/traveltales_engine/sync_bundle.py --write`
- Add `--verbose` to see file-by-file details.



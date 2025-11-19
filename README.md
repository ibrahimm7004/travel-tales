## Image Ranking Pipeline (minimal scaffolding)

### Usage (no ranking/intent)

```powershell
py -m irp.cli --in .\images --out .\out --target 0 `
  --do-quality --do-dedupe --prune-nonreps --prune-mode delete `
  --do-diversity --do-embed
```

`--prune-nonreps` deletes non-representatives after dedupe (DANGEROUS).

Use `--prune-mode move --prune-move-dir .\out\pruned` for a reversible workflow.

Artifacts kept: manifest.jsonl, quality.jsonl, dedupe.jsonl, diversity.jsonl, embed/.

A tiny, typed, modular starter that scans images, extracts EXIF/basic metadata, and writes a `manifest.jsonl` for future ranking work.

### Quickstart

1. Create and activate a Python 3.9+ environment.

2. Install:

```bash
pip install -e .
```

3. Run CLI (example):

```bash
python -m irp.cli run --in ./samples --out ./out --target 120
```

This creates `./out/manifest.jsonl` with one JSON per image, e.g.:

```json
{
  "id": "...",
  "path": "samples/img.jpg",
  "ts": "2023-08-31T12:34:56",
  "gps": { "lat": 1.23, "lon": 4.56 },
  "orientation": 1,
  "camera": "ABC",
  "w": 1920,
  "h": 1080
}
```

- Supported formats: jpg/jpeg/png/heic (HEIC if `pillow-heif` available).
- Uses `tqdm` for deterministic progress.
- Pure functions; no global state.

### Tests

```bash
pytest
```

---

## Labs: Quality (Standalone Tuning)

We provide a disposable lab to tune blur/exposure thresholds without touching the main pipeline.

**Run:**

```bash
python labs/quality/runner.py --in ./images --out ./out_lab --print-summary
# tweak thresholds:
python labs/quality/runner.py --in ./images --out ./out_lab \
  --blur-th 120 --under-low 0.08 --over-high 0.03 --print-summary
```

Output: out_lab/quality.jsonl with fields:
path, sharp_vlap, exp_mean, exp_pct_low, exp_pct_high, blurry, underexposed, overexposed.

When satisfied, port the chosen thresholds back to the main CLI flags (--blur-th, --under-low, --over-high) and delete labs/quality/.

---

## 4) Runbook (for maintainers)

- Manual run:
  ```bash
  python labs/quality/runner.py --in ./images --out ./out_lab --print-summary
  ```

Expected: out_lab/quality.jsonl + summary line like:

[QUALITY_LAB] images=42 blurry=7 under=3 over=1

Pytest (includes the new lab test without altering existing ones):

pytest -q

Notes

This lab copies the core logic (constants + functions) from src/irp/quality.py to avoid imports/coupling.

Paths in records are POSIX (as_posix()), matching the main pipeline contract.

No side effects on src/irp/\*. Safe to delete labs/quality/ after tuning.

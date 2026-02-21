# TravelTales Image Ranking Pipeline

Standalone Python pipeline for curating large photo drops. The production code lives under `src/irp/` and exposes a CLI that wires stages together: manifest creation → quality scoring (M1) → dedupe clustering (M2) → prune/diversity/embeddings. Labs under `labs/` let us tune stages safely without touching the production modules.

## Workflows & Philosophy

- **Production CLI (`src/irp/cli.py`)** – Source of truth. Accepts folders of images, emits JSONL/NPY artifacts under `out/`.
- **Labs** – One folder per milestone. They copy the stage logic so we can experiment locally.
  - **M1 Quality (`labs/quality/`)** – Tunes variance-of-Laplacian + exposure heuristics.
  - **M2 Dedupe (`labs/dedupe/`)** – Tunes pHash grouping + representative selection, optionally using quality metadata.
- **Manual Workspaces**
  - `out_lab_manual/` – Drop test images into `images/`, run the M1 workflow, review `quality_gallery.html`.
  - `out_lab_dedupe/` – Consume M1 outputs to explore dedupe groupings and galleries.

## Repo Structure

- `src/irp/` – Production pipeline package (`cli.py`, `quality.py`, `dedupe.py`, `prune.py`, `diversity.py`, `embed.py`, helpers).
- `labs/quality/` – Quality lab core + CLI + canned fixtures (`images_test/`).
- `labs/dedupe/` – Dedupe lab core + CLI mirroring production behavior.
- `out_lab_manual/` – Canonical M1 manual workspace (`manual_quality_check.py`, gallery artifacts, `images/` drop folder).
- `out_lab_dedupe/` – Canonical M2 workspace (`dedupe_gallery.py`, generated HTML, JSONL artifacts).
- `out/`, `out_lab/` – Generated artifacts from production CLI or labs; ignored by git.
- `tests/` – Pytest suite covering both production pipeline (`test_quality.py`, `test_dedupe.py`, …) and labs (`test_quality_lab.py`, `test_dedupe_lab.py`).
- `images/`, `images-webp/` – Optional sample assets for local experimentation (webp variants are ignored by default).

## Quickstart Commands

> Ensure Python 3.9+ and `pip install -e .` before running commands.

**Production CLI example**

```bash
python -m irp.cli run \
  --in ./images \
  --out ./out \
  --do-quality --do-dedupe --do-diversity
```

Add `--prune-nonreps` / `--prune-mode move --prune-move-dir ./out/pruned` as needed.

**M1 manual workflow**

```bash
python out_lab_manual/manual_quality_check.py
```

Steps:
1. Place evaluation images inside `out_lab_manual/images/`.
2. The script runs `labs.quality.runner`, refreshes `quality.jsonl`, builds `quality_gallery.html`, and opens it in the browser.

**M2 dedupe workflow**

```bash
python -m labs.dedupe.runner \
  --in out_lab_manual/images \
  --quality out_lab_manual/quality.jsonl \
  --out out_lab_dedupe \
  --phash-th 6 \
  --print-summary

python out_lab_dedupe/dedupe_gallery.py
```

This regenerates `out_lab_dedupe/dedupe.jsonl`, reports grouping stats, and opens a gallery that highlights representatives using the M1 quality metadata.

**Tests**

```bash
python -m pytest
```

## What We Commit vs. Ignore

**Commit**
- Source: everything under `src/`, `labs/`, `tests/`.
- Tooling/docs: `pyproject.toml`, `README.md`, `PIPELINE_RECON_REPORT.md`, helper scripts.
- Lightweight fixtures: e.g., curated JPEGs in `images/` that document behavior.

**Do NOT commit (gitignored)**
- Generated artifacts: `out/`, `out_lab/`, `out_lab_dedupe/`, `out_lab_manual/quality*.{jsonl,html}`, summaries, logs.
- Manual workspace data: `out_lab_manual/images/*` (keep `.gitkeep` only).
- Large optional assets: `images-webp/`.
- Virtualenvs, caches (`__pycache__`, `.pytest_cache`, `.mypy_cache`, `.coverage`, etc.).
- IDE noise (`.vscode/`, `.idea/`, `.DS_Store`, etc.).

Git is configured (see `.gitignore`) to enforce this automatically, so `git status` stays clean when running labs or manual workflows.

## Notes

- The labs intentionally duplicate logic from `src/irp` so we can iterate without risking regressions in the production CLI.
- When lab thresholds/settings are ready, port them back into the production config/flags (`irp.cli` options) rather than copying files.
- Artifacts under `out*` are safe to delete locally; regenerate them via the commands above whenever needed.

# TravelTales Pipeline Repo Recon

## 1. Repo Overview

- **Python pipeline root(s):**
  - `src/irp/` - Main pipeline package (irp = image ranking pipeline)

- **Frontend root(s):**
  - **Not found in this repository.** This appears to be a standalone Python pipeline subdirectory. No React/TypeScript frontend code present.

- **Labs folders:**
  - `labs/quality/` - Standalone quality metrics tuning lab (M1)
  - No other labs directories found (no `labs/dedupe/`, `labs/prune/`, `labs/diversity/`, etc.)

## 2. Pipeline Modules (Current Behavior)

### Manifest (Tier-0)

- **Status:** Implemented
- **Files:**
  - `src/irp/io.py` - Core I/O functions
  - `src/irp/cli.py` (lines 80-86) - Manifest generation in CLI
- **Key functions & signatures:**
  - `scan_images(in_dir: Path) -> list[Path]` - Recursively scans for .jpg, .jpeg, .png, .heic files
  - `load_image_basic(path: Path) -> tuple[int, int]` - Returns (width, height)
  - `write_jsonl(records: Iterable[dict], path: Path) -> None` - Writes JSONL format
- **Data flow:**
  - **Input:** Directory path containing images
  - **Processing:** Scans recursively, loads basic dimensions (no EXIF extraction in current implementation)
  - **Output:** `out_dir/manifest.jsonl` - One JSON object per line with schema:
    ```json
    {"id": "hex_uuid", "path": "posix_path", "ts": null, "gps": null, "orientation": null, "camera": null, "w": int, "h": int}
    ```
- **Config/thresholds:**
  - No thresholds. EXIF extraction code exists in `io.py` (`read_exif()`, `_extract_gps()`, etc.) but is **not called** by the CLI manifest step (line 83 sets all EXIF fields to `None`).

### Quality Metrics

- **Status:** Implemented
- **Files:**
  - `src/irp/quality.py` - Core quality assessment
  - `src/irp/cli.py` (lines 88-99) - Quality stage orchestration
- **Key functions & signatures:**
  - `assess_quality(path: Path, qcfg: QualityConfig) -> Dict[str, float | bool]` - Main quality assessment
  - `variance_of_laplacian(gray_u8: np.ndarray) -> float` - Sharpness metric (VLAP)
  - `exposure_stats(gray_u8: np.ndarray) -> Dict[str, float]` - Returns mean, pct_low, pct_high
- **Data flow:**
  - **Input:** Image paths, `QualityConfig` with thresholds
  - **Processing:** 
    - Converts to grayscale uint8
    - Computes variance of Laplacian (sharpness)
    - Computes exposure stats: mean brightness, % pixels ≤10 (low), % pixels ≥245 (high)
    - Flags: `blurry` (VLAP < threshold), `underexposed` (pct_low > threshold), `overexposed` (pct_high > threshold)
  - **Output:** `out_dir/quality.jsonl` - One JSON per line:
    ```json
    {"path": "posix_path", "sharp_vlap": float, "exp_mean": float, "exp_pct_low": float, "exp_pct_high": float, "blurry": bool, "underexposed": bool, "overexposed": bool}
    ```
- **Config/thresholds:**
  - `DEFAULT_BLUR_VLAP_TH = 80.0` (in `quality.py` line 12) - Tunable via `--blur-th` CLI flag
  - `DEFAULT_UNDER_PCT_TH = 0.05` (line 13) - Tunable via `--under-low` CLI flag
  - `DEFAULT_OVER_PCT_TH = 0.02` (line 14) - Tunable via `--over-high` CLI flag
  - `LOW_CUTOFF = 10`, `HIGH_CUTOFF = 245` (lines 15-16) - Hardcoded exposure cutoffs

### Dedupe

- **Status:** Implemented
- **Files:**
  - `src/irp/dedupe.py` - pHash-based deduplication
  - `src/irp/cli.py` (lines 101-109) - Dedupe stage orchestration
- **Key functions & signatures:**
  - `compute_phash_hex(path: Path) -> str` - Returns 16-char hex perceptual hash
  - `hamming(a_hex: str, b_hex: str) -> int` - Hamming distance between hashes
  - `group_by_phash(paths: List[Path], hashes: List[str], th: int) -> List[List[int]]` - O(n²) clustering by Hamming distance
  - `pick_representative(group_idx: List[int], paths: List[Path], sharpness: Dict[str, float]) -> int` - Chooses sharpest image in group (falls back to first if no sharpness data)
  - `build_dedupe_records(paths: List[Path], phashes: List[str], q_sharpness: Dict[str, float], th: int) -> List[Dict]` - Builds final dedupe records
- **Data flow:**
  - **Input:** Image paths, optional sharpness dict (currently empty `{}` in CLI line 104)
  - **Processing:**
    - Computes pHash for each image
    - Groups images with Hamming distance ≤ threshold
    - Selects representative per group (sharpest, or first if no sharpness data)
  - **Output:** `out_dir/dedupe.jsonl` - One JSON per line:
    ```json
    {"path": "posix_path", "phash": "16_char_hex", "group_id": int, "representative": bool}
    ```
- **Config/thresholds:**
  - `--phash-th` CLI flag (default: 6) - Hamming distance threshold for grouping duplicates
  - Note: Sharpness dict is passed as empty `{}` in CLI (line 104), so representative selection falls back to first image in group

### Prune

- **Status:** Implemented
- **Files:**
  - `src/irp/prune.py` - Non-representative removal/movement
  - `src/irp/cli.py` (lines 111-119) - Prune stage orchestration
- **Key functions & signatures:**
  - `prune_nonreps(out_dir: Path, base_dir: Path | None = None, mode: str = "delete", move_dir: Path | None = None) -> tuple[int, int]` - Returns (num_nonreps, num_acted)
- **Data flow:**
  - **Input:** Reads `out_dir/dedupe.jsonl`, `base_dir` for resolving relative paths, `mode` ("delete" or "move"), optional `move_dir`
  - **Processing:**
    - Filters records where `representative == False`
    - If `mode == "move"`: Moves files to `move_dir` (with collision handling via stem suffixes)
    - If `mode == "delete"`: Deletes files (best-effort, continues on errors)
    - Writes log file: `out_dir/pruned_moved.txt` or `out_dir/pruned_deleted.txt` (one path per line)
  - **Output:** 
    - Files deleted/moved from filesystem
    - Log file: `out_dir/pruned_moved.txt` or `out_dir/pruned_deleted.txt`
- **Config/thresholds:**
  - `--prune-nonreps` flag (required to enable)
  - `--prune-mode` CLI flag: "delete" (default) or "move"
  - `--prune-move-dir` CLI flag: Required if `mode == "move"`

### Diversity

- **Status:** Implemented
- **Files:**
  - `src/irp/diversity.py` - Color and entropy metrics
  - `src/irp/cli.py` (lines 135-142) - Diversity stage orchestration
- **Key functions & signatures:**
  - `dominant_colors_hex(path: Path, k: int = 3) -> List[str]` - Returns top-k dominant colors as hex strings
  - `image_entropy(path: Path) -> float` - Returns Shannon entropy of grayscale image
  - `_im_rgb_small(path: Path, max_side: int = 256) -> np.ndarray` - Loads and downsamples image for efficiency
- **Data flow:**
  - **Input:** Image paths
  - **Processing:**
    - Loads RGB image, downsamples to max 256px per side
    - Quantizes to 12-bit (4 bits per channel), finds most common color bins
    - Converts to hex format (expands 4-bit to 8-bit by repeating nibbles)
    - Computes Shannon entropy on grayscale (using ITU-R BT.601 weights)
  - **Output:** `out_dir/diversity.jsonl` - One JSON per line:
    ```json
    {"path": "posix_path", "dominant_colors": ["#hex1", "#hex2", "#hex3"], "entropy": float}
    ```
- **Config/thresholds:**
  - `k=3` hardcoded in CLI (line 138) - Number of dominant colors to extract
  - `max_side=256` hardcoded in `_im_rgb_small()` - Downsampling size

### Embeddings

- **Status:** Implemented
- **Files:**
  - `src/irp/embed.py` - OpenCLIP embeddings
  - `src/irp/cli.py` (lines 121-133) - Embedding stage orchestration
- **Key functions & signatures:**
  - `compute_embeddings(paths: List[Path], cfg: EmbedConfig) -> Tuple[np.ndarray, list[str], dict]` - Returns (embeddings array, path IDs, metadata)
  - `write_embedding_artifacts(out_dir: Path, emb: np.ndarray, ids: list[str], meta: dict) -> None` - Writes artifacts to disk
  - `_load_model(cfg: EmbedConfig)` - Lazy-loads OpenCLIP model (imports torch/open_clip only when called)
- **Data flow:**
  - **Input:** Image paths, `EmbedConfig` (model name, pretrained tag, device, batch size)
  - **Processing:**
    - Loads OpenCLIP model (default: ViT-B-32/openai)
    - Processes images in batches (default: 16)
    - Normalizes embeddings (L2 norm)
    - Converts to float32 numpy array
  - **Output:** `out_dir/embed/` directory containing:
    - `embeddings.npy` - NumPy array of shape (N, 512) float32
    - `ids.json` - List of path strings (one per embedding)
    - `meta.json` - `{"model_name": str, "pretrained": str, "dim": int}`
- **Config/thresholds:**
  - `--embed-model` CLI flag (default: "ViT-B-32")
  - `--embed-pretrained` CLI flag (default: "openai")
  - `--embed-batch` CLI flag (default: 16)
  - `device="cpu"` hardcoded in CLI (line 129) - No GPU option exposed

## 3. Orchestration & Entry Points

- **CLI/runner scripts:**
  - `src/irp/cli.py` - Main CLI entry point using Click
    - Command: `python -m irp.cli run [options]`
    - All stages are optional flags (`--do-quality`, `--do-dedupe`, etc.)
    - Execution flow:
      1. **Manifest** (always runs) - Scans images, writes `manifest.jsonl`
      2. **Quality** (if `--do-quality`) - Writes `quality.jsonl`
      3. **Dedupe** (if `--do-dedupe`) - Writes `dedupe.jsonl`
      4. **Prune** (if `--prune-nonreps` after dedupe) - Deletes/moves files, writes log
      5. **Embeddings** (if `--do-embed`) - Writes `embed/` directory
      6. **Diversity** (if `--do-diversity`) - Writes `diversity.jsonl`
    - Parallelization: Uses `ThreadPoolExecutor` with `--max-workers` (default: 4) for CPU-bound stages
    - Output directory: All artifacts written to `--out` directory
  - `labs/quality/runner.py` - Standalone quality lab runner
    - Command: `python labs/quality/runner.py --in <dir> --out <dir> [options]`
    - Independent of main pipeline (copies logic from `src/irp/quality.py`)
    - Writes `out_dir/quality.jsonl` with same schema as main pipeline
    - Supports `--print-summary` flag for aggregate counts

- **Execution flow:**
  - Main pipeline: `manifest → quality → dedupe → prune → embeddings → diversity` (each stage optional)
  - Quality lab: Standalone, only runs quality assessment

- **Output paths and formats:**
  - `out_dir/manifest.jsonl` - JSONL (one JSON per line)
  - `out_dir/quality.jsonl` - JSONL
  - `out_dir/dedupe.jsonl` - JSONL
  - `out_dir/pruned_moved.txt` or `out_dir/pruned_deleted.txt` - Plain text (one path per line)
  - `out_dir/embed/embeddings.npy` - NumPy array
  - `out_dir/embed/ids.json` - JSON array
  - `out_dir/embed/meta.json` - JSON object
  - `out_dir/diversity.jsonl` - JSONL

- **Integrations with React app:**
  - **None found.** No FastAPI/Flask endpoints, no job queues, no HTTP service layer. This is a pure CLI tool. Artifacts are JSONL/JSON files that would need to be consumed by a separate service.

## 4. labs/quality/ Details (M1)

- **Files:**
  - `labs/quality/runner.py` - Main lab runner (argparse-based CLI)
  - `labs/quality/quality_core.py` - Core quality functions (duplicated from `src/irp/quality.py`)
  - `labs/quality/__init__.py` - Empty package marker
  - `labs/quality/README.md` - Usage instructions
  - `labs/quality/images_test/` - Test image directories (sharp_day, motion_blur, lowlight_dark, overexposed, mixed)
  - `labs/quality/manual_check/` - Manual review images

- **Runner:**
  - `labs/quality/runner.py::main()` - Entry point
  - Invoked: `python labs/quality/runner.py --in <dir> --out <dir> [--blur-th FLOAT] [--under-low FLOAT] [--over-high FLOAT] [--workers INT] [--print-summary]`
  - Uses `ThreadPoolExecutor` for parallel processing (default: half of CPU count)
  - Maintains deterministic order via enumerate/sort after parallel execution (line 73-79)

- **Metrics & thresholds:**
  - **Sharpness:** Variance of Laplacian (VLAP) - `cv2.Laplacian(gray, cv2.CV_64F).var()`
  - **Exposure:** 
    - Mean brightness: `gray.mean()`
    - `pct_low`: Fraction of pixels ≤ 10
    - `pct_high`: Fraction of pixels ≥ 245
  - **Thresholds:**
    - `blur_vlap_th` (default: 80.0) - Tunable via `--blur-th`
    - `under_pct_th` (default: 0.05) - Tunable via `--under-low`
    - `over_pct_th` (default: 0.02) - Tunable via `--over-high`
    - `LOW_CUTOFF = 10`, `HIGH_CUTOFF = 245` - Hardcoded in `quality_core.py`

- **Outputs (CSV, HTML gallery):**
  - **Primary output:** `out_dir/quality.jsonl` - Same schema as main pipeline
  - **Summary scripts (not part of lab runner):**
    - `out_lab/gen_summary.py` - Generates CSV summaries:
      - `out_lab/summary_by_bucket.csv` - Aggregated by test bucket (sharp_day, motion_blur, etc.)
      - `out_lab/summary_by_image.csv` - Per-image details
      - `out_lab/summary_by_bucket.md` - Markdown table version
    - `out_lab_manual/make_quality_gallery.py` - Generates HTML gallery:
      - `out_lab_manual/quality_gallery.html` - Visual gallery sorted by bucket and sharpness
  - Note: Summary scripts are separate utilities, not integrated into the lab runner

- **CPU-friendliness and determinism:**
  - Uses `ThreadPoolExecutor` (I/O-bound friendly)
  - Maintains deterministic output order (enumerate futures, preserve index order)
  - No explicit seed setting for randomness (none needed - no random operations)

- **Tests:**
  - `tests/test_quality_lab.py` - Unit test for quality lab
    - Tests blur/exposure flag detection with synthetic images
    - Uses `labs.quality.quality_core` imports
  - Run: `pytest tests/test_quality_lab.py`

## 5. Tests & Validation Coverage

- **Python tests:**
  - **Test framework:** pytest (configured in `pyproject.toml`)
  - **Test files:**
    - `tests/test_quality.py` - Tests main pipeline quality module (`irp.quality`)
    - `tests/test_quality_lab.py` - Tests quality lab (`labs.quality.quality_core`)
    - `tests/test_dedupe.py` - Tests dedupe module (pHash computation, grouping, representative selection)
    - `tests/test_diversity.py` - Tests diversity module (dominant colors, entropy)
    - `tests/test_io.py` - Tests I/O functions (scan_images, manifest generation, EXIF reading)
  - **Coverage:**
    - ✅ Quality metrics (main + lab)
    - ✅ Dedupe (pHash, grouping, representatives)
    - ✅ Diversity (colors, entropy)
    - ✅ I/O (scanning, manifest, EXIF parsing)
    - ❌ Prune module - **No tests found**
    - ❌ Embeddings module - **No tests found**
    - ❌ CLI orchestration - **No integration tests found**
  - **How invoked:**
    - `pytest` (or `pytest -q` for quiet mode)
    - Test paths configured in `pyproject.toml`: `testpaths = ["tests"]`

- **Frontend tests (if relevant to pipeline artifacts):**
  - **None found.** No frontend code in this repository.

- **Gaps:**
  - Prune module has no automated tests (file deletion/movement logic untested)
  - Embeddings module has no automated tests (OpenCLIP integration untested)
  - No end-to-end CLI integration tests (full pipeline run with multiple stages)
  - No tests for error handling (missing files, corrupted images, etc.)

## 6. Config, Determinism, Logging

- **Config files and how they're used:**
  - `pyproject.toml` - Package metadata, dependencies, pytest config, black/ruff config
  - **No pipeline-specific config files** (no `.env`, `.yaml`, `.json` configs)
  - All configuration via CLI flags (Click options in `cli.py`)
  - Defaults hardcoded in module constants (e.g., `DEFAULT_BLUR_VLAP_TH` in `quality.py`)

- **Determinism mechanisms (if any):**
  - **Path ordering:** `scan_images()` uses `sorted(in_dir.rglob("*"))` (line 26 in `io.py`) - Deterministic file discovery
  - **Progress bars:** Uses `tqdm` for "deterministic progress" (mentioned in README, but tqdm itself doesn't enforce determinism)
  - **Parallel execution:** `ThreadPoolExecutor` maintains order via enumerate/futures pattern in quality lab (line 73-79 in `runner.py`), but main CLI uses `tqdm(ex.map(...))` which may not preserve strict order
  - **No explicit seed setting:** No `random.seed()` or `numpy.random.seed()` calls found
  - **UUID generation:** Uses `uuid.uuid4().hex` for manifest IDs (line 83 in `cli.py`) - Non-deterministic IDs

- **Logging/debug flags:**
  - **No structured logging.** Uses `click.echo()` for CLI output (info messages)
  - **No debug flags.** No `--verbose` or `--debug` options
  - **No log files.** Only exception messages printed to stderr
  - **Prune logging:** Writes `pruned_moved.txt` or `pruned_deleted.txt` as simple manifest files (one path per line)

## 7. Roadmap-Relevant TODOs & Hooks

- **Categories:**
  - **No TODO/FIXME comments found** related to categories
  - **No `categories.py` file found** in codebase
  - **No category classification code** in any module

- **Variety:**
  - **No TODO/FIXME comments found** related to variety
  - **No `variety.py` file found** in codebase
  - **Diversity module exists** (`diversity.py`) but computes color/entropy metrics only, not variety selection algorithms

- **Scoring Lite:**
  - **No TODO/FIXME comments found** related to scoring
  - **No scoring module found** in `src/irp/`
  - **Artifact evidence:** `out/scores.jsonl` and `out/report.txt` exist with scoring data (scores, intent01 fields), but **no code generates these files** in current codebase
  - **CLI comment:** Line 33 in `cli.py`: `# kept for compatibility; not used by ranking anymore` - Suggests ranking/scoring code was removed
  - **`--target` flag:** Still required but unused (line 34: `# kept for compatibility; not used by ranking anymore`)

- **Service packaging (FastAPI/job runner):**
  - **No TODO/FIXME comments found** related to FastAPI or service packaging
  - **No FastAPI/Flask code found** - No HTTP endpoints, no web server
  - **No job queue integration** - No Celery, RQ, or similar
  - **No service layer** - Pure CLI tool with file-based artifacts
  - **Integration contract:** Would need to be built - Currently outputs JSONL/JSON files that external services would need to read

---

## Summary

This repository contains a **modular Python image processing pipeline** with 6 implemented stages (manifest, quality, dedupe, prune, diversity, embeddings). The pipeline is **CLI-only** with no web service layer. A **standalone quality lab** (`labs/quality/`) exists for threshold tuning. **No categories, variety, or scoring modules** are present, though scoring artifacts exist from a previous version. The codebase is **well-tested** for core modules but lacks tests for prune and embeddings. **No frontend code** exists in this repository.



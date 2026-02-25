from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, Iterable, List

from src.irp.dedupe import (
    build_dedupe_records,
    compute_dhash_hex,
    compute_phash_hex,
    compute_whash_hex,
)
from src.irp.prune import prune_nonreps

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _debug(enabled: bool, msg: str) -> None:
    if enabled:
        print(f"[DEDUPE_LAB][debug] {msg}")


def scan_images(in_dir: Path) -> List[Path]:
    paths: List[Path] = []
    for p in sorted(in_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            paths.append(p)
    return paths


def load_quality_map(path: Path) -> Dict[str, float]:
    sharpness: Dict[str, float] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            rec_path = rec.get("path")
            rec_sharp = rec.get("sharp_vlap")
            if not isinstance(rec_path, str):
                continue
            try:
                sharpness[Path(rec_path).as_posix()] = float(rec_sharp)
            except Exception:
                continue
    return sharpness


def compute_hashes(paths: List[Path], workers: int, hash_fn: Callable[[Path], str]) -> List[str]:
    if not paths:
        return []
    workers = max(1, workers)
    if workers == 1:
        return [hash_fn(p) for p in paths]
    with ThreadPoolExecutor(max_workers=workers) as ex:
        return list(ex.map(hash_fn, paths))


def write_jsonl(records: Iterable[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def summarize(records: List[dict]) -> None:
    total = len(records)
    if not total:
        print("[DEDUPE_LAB] no records")
        return
    group_sizes: Dict[int, int] = {}
    reps = 0
    for rec in records:
        gid = int(rec["group_id"])
        group_sizes[gid] = group_sizes.get(gid, 0) + 1
        if bool(rec.get("representative", False)):
            reps += 1
    print(f"[DEDUPE_LAB] images={total} groups={len(group_sizes)} representatives={reps}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Standalone M2 dedupe + prune lab runner.")
    ap.add_argument("--in", dest="in_dir", type=Path, required=True, help="Input images directory")
    ap.add_argument("--out", dest="out_dir", type=Path, required=True, help="Output directory")
    ap.add_argument("--phash-th", dest="phash_th", type=int, default=20, help="pHash hamming threshold")
    ap.add_argument("--dhash-th", dest="dhash_th", type=int, default=None, help="Optional dHash hamming threshold")
    ap.add_argument("--whash-th", dest="whash_th", type=int, default=None, help="Optional wHash hamming threshold")
    ap.add_argument("--ssim-th", dest="ssim_th", type=float, default=0.3, help="SSIM threshold for pair verification")
    ap.add_argument("--no-ssim", dest="no_ssim", action="store_true", help="Disable SSIM verification")
    ap.add_argument("--hist-enable", action="store_true", help="Enable HSV histogram verification")
    ap.add_argument("--hist-th", dest="hist_th", type=float, default=0.9, help="Histogram threshold (correlation metric)")
    ap.add_argument("--workers", type=int, default=max(1, min(4, os.cpu_count() or 1)), help="Parallel workers")
    ap.add_argument("--quality-jsonl", dest="quality_jsonl", type=Path, default=None, help="Optional quality JSONL")
    ap.add_argument("--print-summary", action="store_true", help="Print aggregate summary")
    ap.add_argument("--prune", action="store_true", help="Prune non-representatives using dedupe.jsonl")
    ap.add_argument(
        "--prune-mode",
        choices=["move", "delete"],
        default="move",
        help="Prune mode when --prune is enabled",
    )
    ap.add_argument("--move-dir", dest="move_dir", type=Path, default=None, help="Destination directory for move mode")
    ap.add_argument("--debug", action="store_true", help="Enable debug output")
    args = ap.parse_args()
    if args.no_ssim:
        args.ssim_th = None

    in_dir: Path = args.in_dir
    out_dir: Path = args.out_dir
    if not in_dir.exists() or not in_dir.is_dir():
        raise SystemExit(f"Input directory not found: {in_dir}")
    if args.prune and args.prune_mode == "move" and args.move_dir is None:
        ap.error("--move-dir is required when using --prune --prune-mode move")
    if args.hist_enable and args.ssim_th is None:
        ap.error("--hist-enable requires --ssim-th")

    _debug(args.debug, f"scan input dir: {in_dir.as_posix()}")
    paths = scan_images(in_dir)
    _debug(args.debug, f"images found: {len(paths)}")

    _debug(args.debug, f"compute pHash with workers={max(1, args.workers)}")
    phashes = compute_hashes(paths, args.workers, compute_phash_hex)

    dhashes: List[str] | None = None
    if args.dhash_th is not None:
        _debug(args.debug, f"compute dHash (th={args.dhash_th})")
        dhashes = compute_hashes(paths, args.workers, compute_dhash_hex)

    whashes: List[str] | None = None
    if args.whash_th is not None:
        _debug(args.debug, f"compute wHash (th={args.whash_th})")
        whashes = compute_hashes(paths, args.workers, compute_whash_hex)

    sharpness_map: Dict[str, float] = {}
    if args.quality_jsonl is not None:
        _debug(args.debug, f"load quality jsonl: {args.quality_jsonl.as_posix()}")
        sharpness_map = load_quality_map(args.quality_jsonl)

    records = build_dedupe_records(
        paths=paths,
        phashes=phashes,
        q_sharpness=sharpness_map,
        th=args.phash_th,
        dhashes=dhashes,
        whashes=whashes,
        dhash_th=args.dhash_th,
        whash_th=args.whash_th,
        ssim_th=args.ssim_th,
        hist_enable=args.hist_enable,
        hist_th=args.hist_th,
        debug=args.debug,
    )
    out_path = out_dir / "dedupe.jsonl"
    write_jsonl(records, out_path)
    _debug(args.debug, f"wrote dedupe jsonl: {out_path.as_posix()}")

    if args.prune:
        move_dir = args.move_dir.resolve() if (args.prune_mode == "move" and args.move_dir is not None) else None
        total, acted = prune_nonreps(
            out_dir=out_dir,
            base_dir=None,
            mode=args.prune_mode,
            move_dir=move_dir,
        )
        _debug(args.debug, f"prune result nonreps={total} acted={acted}")

    if args.print_summary:
        summarize(records)
        print(f"[DEDUPE_LAB] wrote={out_path.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

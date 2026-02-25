from __future__ import annotations
import argparse
import concurrent.futures as futures
import json
import os
from pathlib import Path
from typing import Iterable, List

from .quality_core import (
    QualityConfig,
    assess_quality,
    DEFAULT_BLUR_VLAP_TH,
    DEFAULT_UNDER_PCT_TH,
    DEFAULT_OVER_PCT_TH,
)

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def scan_images(in_dir: Path) -> List[Path]:
    paths: List[Path] = []
    for p in sorted(in_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            paths.append(p)
    return paths


def write_jsonl(records: Iterable[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Quality Lab: standalone sharpness/exposure assessment"
    )
    ap.add_argument("--in", dest="in_dir", type=Path, required=True,
                    help="Input folder containing images")
    ap.add_argument("--out", dest="out_dir", type=Path, default=Path("out_lab"),
                    help="Output folder (default: ./out_lab)")
    ap.add_argument("--blur-th", type=float, default=DEFAULT_BLUR_VLAP_TH,
                    help=f"Sharpness VLAP threshold (default: {DEFAULT_BLUR_VLAP_TH})")
    ap.add_argument("--under-low", type=float, default=DEFAULT_UNDER_PCT_TH,
                    help=f"Underexposed pct_low threshold (default: {DEFAULT_UNDER_PCT_TH})")
    ap.add_argument("--over-high", type=float, default=DEFAULT_OVER_PCT_TH,
                    help=f"Overexposed pct_high threshold (default: {DEFAULT_OVER_PCT_TH})")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2),
                    help="Parallel workers (default: half of CPUs)")
    ap.add_argument("--print-summary", action="store_true",
                    help="Print aggregate counts summary")

    args = ap.parse_args()
    in_dir: Path = args.in_dir
    out_dir: Path = args.out_dir
    out_path = out_dir / "quality.jsonl"

    paths = scan_images(in_dir)
    if not paths:
        out_dir.mkdir(parents=True, exist_ok=True)
        write_jsonl([], out_path)
        if args.print_summary:
            print("[QUALITY_LAB] No images found.")
        return 0

    qcfg = QualityConfig(
        blur_vlap_th=args.blur_th,
        under_pct_th=args.under_low,
        over_pct_th=args.over_high,
    )

    # Process in parallel; keep deterministic order via enumerate/sort after
    with futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = [(i, ex.submit(assess_quality, p, qcfg))
                for i, p in enumerate(paths)]
        results = [None] * len(futs)
        for i, fut in futs:
            results[i] = fut.result()

    write_jsonl(results, out_path)

    if args.print_summary:
        blurry = sum(1 for r in results if r.get("blurry"))
        under = sum(1 for r in results if r.get("underexposed"))
        over = sum(1 for r in results if r.get("overexposed"))
        print(
            f"[QUALITY_LAB] images={len(results)} blurry={blurry} under={under} over={over}")
        print(f"[QUALITY_LAB] wrote -> {out_path.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())














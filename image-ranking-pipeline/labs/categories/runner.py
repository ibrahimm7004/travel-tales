from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import List

from .categories_core import COARSE_LABELS, ClipCatConfig, classify_images, scan_images


def write_jsonl(records: List[dict], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def summarize(records: List[dict]) -> None:
    counts = {}
    for rec in records:
        counts[rec["primary"]] = counts.get(rec["primary"], 0) + 1
    total = len(records)
    print(f"[categories_runner] images={total}")
    for label in COARSE_LABELS:
        if label in counts:
            print(f"  {label}: {counts[label]}")


def load_paths_from_dedupe(p: Path) -> List[Path]:
    rows: List[dict] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    reps: List[Path] = []
    for r in rows:
        if not r.get("representative", False):
            continue
        if r.get("rejected", False):
            continue
        reps.append(Path(r["path"]).resolve())
    uniq = sorted(set(reps))
    return uniq


def main() -> int:
    ap = argparse.ArgumentParser(description="Categories Lab: coarse travel-story tags")
    ap.add_argument("--in", dest="in_dir", type=Path, help="Input images directory")
    ap.add_argument("--out", dest="out_dir", type=Path, required=True, help="Output directory")
    ap.add_argument(
        "--dedupe-jsonl",
        dest="dedupe_jsonl",
        type=Path,
        help="Optional dedupe JSONL to classify only surviving representatives",
    )
    ap.add_argument("--batch-size", type=int, default=16, help="CLIP batch size (default: 16)")
    ap.add_argument("--device", type=str, default="cpu", help="Torch device (default: cpu)")
    ap.add_argument("--min-conf", type=float, default=0.10, help="Min confidence for label")
    ap.add_argument("--face-boost", type=float, default=0.12, help="Score boost when faces detected")
    ap.add_argument("--print-summary", action="store_true", help="Print label counts")
    args = ap.parse_args()

    out_dir: Path = args.out_dir
    out_jsonl = out_dir / "categories.jsonl"
    source_desc = ""

    if args.dedupe_jsonl:
        dedupe_path = Path(args.dedupe_jsonl)
        if not dedupe_path.exists():
            raise SystemExit(f"[categories_runner] dedupe file not found: {dedupe_path.as_posix()}")
        paths = load_paths_from_dedupe(dedupe_path)
        source_desc = f"dedupe survivors: {dedupe_path.as_posix()}"
    else:
        if not args.in_dir:
            raise SystemExit("--in is required when --dedupe-jsonl is not provided")
        in_dir: Path = args.in_dir
        if not in_dir.exists():
            raise SystemExit(f"[categories_runner] Input dir not found: {in_dir.as_posix()}")
        paths = scan_images(in_dir)
        source_desc = f"scanned folder: {in_dir.as_posix()}"
    if not paths:
        write_jsonl([], out_jsonl)
        if args.print_summary:
            print("[categories_runner] no images found")
        return 0

    cfg = ClipCatConfig(
        batch_size=int(args.batch_size),
        device=args.device,
        min_conf=float(args.min_conf),
        face_boost=float(args.face_boost),
    )
    records = classify_images(paths, cfg)
    write_jsonl(records, out_jsonl)
    if args.print_summary:
        print(f"[categories_runner] source -> {source_desc}")
        summarize(records)
        print(f"[categories_runner] wrote -> {out_jsonl.as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())




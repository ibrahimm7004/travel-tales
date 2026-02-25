from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List

from labs.dedupe.clip_core import ClipConfig, build_clip_dedupe_records
from labs.dedupe.dedupe_core import QualityInfo, load_quality_map


def read_jsonl(p: Path) -> List[dict]:
    rows: List[dict] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def write_jsonl(rows: List[dict], p: Path) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def _augment_quality_map(qmap: Dict[str, QualityInfo]) -> Dict[str, QualityInfo]:
    augmented: Dict[str, QualityInfo] = {}
    from pathlib import Path as _Path

    for key, val in qmap.items():
        augmented[key] = val
        try:
            abs_key = str(_Path(key).resolve())
            augmented[abs_key] = val
        except Exception:
            pass
    return augmented


def main() -> int:
    ap = argparse.ArgumentParser(description="CLIP second-layer dedupe on pHash representatives")
    ap.add_argument("--phash-jsonl", required=True, help="Path to out_lab_dedupe/dedupe.jsonl")
    ap.add_argument("--quality", required=False, help="Path to out_lab_manual/quality.jsonl")
    ap.add_argument("--out", required=True, help="Output directory for clip_dedupe.jsonl")
    ap.add_argument("--clip-sim-th", type=float, default=0.88)
    ap.add_argument("--clip-topk", type=int, default=2)
    ap.add_argument("--clip-batch", type=int, default=16)

    args = ap.parse_args()
    phash_jsonl = Path(args.phash_jsonl)
    out_dir = Path(args.out)
    out_jsonl = out_dir / "clip_dedupe.jsonl"

    ph_rows = read_jsonl(phash_jsonl)
    reps = [r for r in ph_rows if r.get("representative") is True]
    rep_paths = [Path(r["path"]).resolve() for r in reps]

    qmap: Dict[str, QualityInfo] = {}
    if args.quality:
        qmap = _augment_quality_map(load_quality_map(Path(args.quality)))

    cfg = ClipConfig(
        sim_th=float(args.clip_sim_th),
        top_k_per_cluster=int(args.clip_topk),
        batch_size=int(args.clip_batch),
    )

    clip_rows = build_clip_dedupe_records(rep_paths, reps, qmap, cfg)
    write_jsonl(clip_rows, out_jsonl)
    print(f"[clip_runner] wrote {out_jsonl.as_posix()} (n={len(clip_rows)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


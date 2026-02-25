from __future__ import annotations

import argparse
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Tuple

from src.irp.dedupe import (
    build_dedupe_records,
    compute_dhash_hex,
    compute_phash_hex,
    compute_whash_hex,
)

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


def _debug(enabled: bool, msg: str) -> None:
    if enabled:
        print(f"[STEP_A][debug] {msg}")


def scan_images(in_dir: Path) -> List[Path]:
    paths: List[Path] = []
    for p in sorted(in_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            paths.append(p)
    return paths


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


def load_quality_map(path: Path | None) -> Dict[str, dict]:
    if path is None or not path.exists():
        return {}
    qmap: Dict[str, dict] = {}
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            raw_path = rec.get("path")
            if not isinstance(raw_path, str):
                continue
            p = Path(raw_path)
            key_rel = p.as_posix()
            qmap[key_rel] = rec
            try:
                qmap[p.resolve().as_posix()] = rec
            except Exception:
                pass
    return qmap


def _lookup_quality(path_str: str, qmap: Dict[str, dict]) -> dict | None:
    if not qmap:
        return None
    p = Path(path_str)
    rel = p.as_posix()
    if rel in qmap:
        return qmap[rel]
    try:
        abs_key = p.resolve().as_posix()
    except Exception:
        return None
    return qmap.get(abs_key)


def _prefer_false_value(v: object) -> int:
    if v is False:
        return 0
    if v is True:
        return 1
    return 2


def _sharp_sort_value(v: object) -> float:
    try:
        fv = float(v)
    except Exception:
        return float("inf")
    if not (fv == fv):
        return float("inf")
    return -fv


def _mean_closeness(v: object) -> float:
    try:
        m = float(v)
    except Exception:
        return float("inf")
    if m > 1.0:
        m = m / 255.0
    if m < 0.0:
        m = 0.0
    if m > 1.0:
        m = 1.0
    return abs(m - 0.5)


def rank_group_members(members: List[dict], qmap: Dict[str, dict], quality_used: bool) -> List[dict]:
    if not quality_used:
        return sorted(
            members,
            key=lambda r: (0 if bool(r.get("representative", False)) else 1, str(r["path"])),
        )

    def key_fn(rec: dict) -> Tuple[int, int, int, float, float, str]:
        q = _lookup_quality(str(rec["path"]), qmap) or {}
        return (
            _prefer_false_value(q.get("blurry")),
            _prefer_false_value(q.get("underexposed")),
            _prefer_false_value(q.get("overexposed")),
            _sharp_sort_value(q.get("sharp_vlap")),
            _mean_closeness(q.get("exp_mean")),
            str(rec["path"]),
        )

    return sorted(members, key=key_fn)


def _safe_export_name(dest_dir: Path, group_id: int, src_name: str, used: set[str]) -> str:
    src = Path(src_name)
    base = f"g{group_id:06d}__{src_name}"
    candidate = base
    idx = 1
    while candidate in used or (dest_dir / candidate).exists():
        candidate = f"g{group_id:06d}__{src.stem}__{idx}{src.suffix}"
        idx += 1
    used.add(candidate)
    return candidate


def _quality_subset(q: dict | None) -> dict:
    if not q:
        return {}
    out: dict = {}
    for k in ["blurry", "underexposed", "overexposed", "sharp_vlap", "exp_mean"]:
        if k in q:
            out[k] = q[k]
    return out


def _export_one(src: Path, dst: Path, export_mode: str) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if export_mode == "move":
        shutil.move(str(src), str(dst))
    else:
        shutil.copy2(src, dst)


def _reset_export_dirs(base_out: Path) -> Tuple[Path, Path, Path]:
    reduced = base_out / "reduced_pool"
    secondary = base_out / "alternates" / "secondary"
    tertiary = base_out / "alternates" / "tertiary"
    for d in [reduced, secondary, tertiary]:
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True, exist_ok=True)
    return reduced, secondary, tertiary


def main() -> int:
    ap = argparse.ArgumentParser(description="Step A runner: dedupe + ranking + reduced pool export")
    ap.add_argument("--in", dest="in_dir", type=Path, required=True, help="Input images directory")
    ap.add_argument("--out", dest="out_dir", type=Path, required=True, help="Output directory")
    ap.add_argument("--phash-th", dest="phash_th", type=int, default=20, help="pHash hamming threshold")
    ap.add_argument("--dhash-th", dest="dhash_th", type=int, default=None, help="Optional dHash threshold")
    ap.add_argument("--whash-th", dest="whash_th", type=int, default=None, help="Optional wHash threshold")
    ap.add_argument("--ssim-th", dest="ssim_th", type=float, default=0.3, help="SSIM threshold")
    ap.add_argument("--hist-enable", action="store_true", help="Enable histogram verifier")
    ap.add_argument("--hist-th", dest="hist_th", type=float, default=0.9, help="Histogram threshold")
    ap.add_argument("--quality-jsonl", dest="quality_jsonl", type=Path, default=None, help="Optional quality.jsonl")
    ap.add_argument("--export-mode", choices=["copy", "move"], default="copy", help="Export mode")
    ap.add_argument("--workers", type=int, default=max(1, min(4, os.cpu_count() or 1)), help="Parallel workers")
    ap.add_argument("--print-summary", action="store_true", help="Print summary")
    ap.add_argument("--debug", action="store_true", help="Enable debug logs")
    args = ap.parse_args()

    in_dir: Path = args.in_dir
    out_dir: Path = args.out_dir
    if not in_dir.exists() or not in_dir.is_dir():
        raise SystemExit(f"Input directory not found: {in_dir}")
    if args.hist_enable and args.ssim_th is None:
        ap.error("--hist-enable requires --ssim-th")

    _debug(args.debug, f"scanning input {in_dir.as_posix()}")
    paths = scan_images(in_dir)
    _debug(args.debug, f"images found: {len(paths)}")

    phashes = compute_hashes(paths, args.workers, compute_phash_hex)
    dhashes = compute_hashes(paths, args.workers, compute_dhash_hex) if args.dhash_th is not None else None
    whashes = compute_hashes(paths, args.workers, compute_whash_hex) if args.whash_th is not None else None

    qmap = load_quality_map(args.quality_jsonl)
    quality_used = bool(args.quality_jsonl is not None and qmap)
    _debug(args.debug, f"quality_jsonl_used={quality_used} entries={len(qmap)}")

    dedupe_records = build_dedupe_records(
        paths=paths,
        phashes=phashes,
        q_sharpness={},
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

    out_dir.mkdir(parents=True, exist_ok=True)
    dedupe_path = out_dir / "dedupe.jsonl"
    write_jsonl(dedupe_records, dedupe_path)

    by_group: Dict[int, List[dict]] = {}
    for rec in dedupe_records:
        gid = int(rec["group_id"])
        by_group.setdefault(gid, []).append(rec)

    reduced_dir, secondary_dir, tertiary_dir = _reset_export_dirs(out_dir)

    manifest_records: List[dict] = []
    used_reduced: set[str] = set()
    used_secondary: set[str] = set()
    used_tertiary: set[str] = set()

    groups_with_secondary = 0
    groups_with_tertiary = 0

    for gid in sorted(by_group):
        ranked = rank_group_members(by_group[gid], qmap, quality_used)

        primary = ranked[0] if ranked else None
        secondary = ranked[1] if len(ranked) >= 2 else None
        tertiary = ranked[2] if len(ranked) > 5 else None

        primary_out = None
        secondary_out = None
        tertiary_out = None

        if primary is not None:
            p_src = Path(str(primary["path"]))
            p_name = _safe_export_name(reduced_dir, gid, p_src.name, used_reduced)
            p_dst = reduced_dir / p_name
            _export_one(p_src, p_dst, args.export_mode)
            primary_out = {
                "src_path": p_src.as_posix(),
                "export_path": p_dst.relative_to(out_dir).as_posix(),
            }

        if secondary is not None:
            s_src = Path(str(secondary["path"]))
            s_name = _safe_export_name(secondary_dir, gid, s_src.name, used_secondary)
            s_dst = secondary_dir / s_name
            _export_one(s_src, s_dst, args.export_mode)
            secondary_out = {
                "src_path": s_src.as_posix(),
                "export_path": s_dst.relative_to(out_dir).as_posix(),
            }
            groups_with_secondary += 1

        if tertiary is not None:
            t_src = Path(str(tertiary["path"]))
            t_name = _safe_export_name(tertiary_dir, gid, t_src.name, used_tertiary)
            t_dst = tertiary_dir / t_name
            _export_one(t_src, t_dst, args.export_mode)
            tertiary_out = {
                "src_path": t_src.as_posix(),
                "export_path": t_dst.relative_to(out_dir).as_posix(),
            }
            groups_with_tertiary += 1

        members_ranked = []
        for rec in ranked:
            src_path = str(rec["path"])
            q = _lookup_quality(src_path, qmap)
            members_ranked.append({
                "src_path": src_path,
                "quality": _quality_subset(q),
            })

        manifest_records.append(
            {
                "group_id": gid,
                "primary": primary_out,
                "secondary": secondary_out,
                "tertiary": tertiary_out,
                "members_ranked": members_ranked,
                "notes": {"quality_jsonl_used": quality_used},
            }
        )

    manifest_path = out_dir / "step_a_manifest.jsonl"
    write_jsonl(manifest_records, manifest_path)

    if args.print_summary:
        print(f"[STEP_A] total_images={len(paths)}")
        print(f"[STEP_A] total_groups={len(by_group)}")
        print(f"[STEP_A] groups_with_secondary={groups_with_secondary}")
        print(f"[STEP_A] groups_with_tertiary={groups_with_tertiary}")
        print(f"[STEP_A] wrote_dedupe={dedupe_path.as_posix()}")
        print(f"[STEP_A] wrote_manifest={manifest_path.as_posix()}")
        print(f"[STEP_A] reduced_pool_dir={reduced_dir.as_posix()}")
        print(f"[STEP_A] secondary_dir={secondary_dir.as_posix()}")
        print(f"[STEP_A] tertiary_dir={tertiary_dir.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

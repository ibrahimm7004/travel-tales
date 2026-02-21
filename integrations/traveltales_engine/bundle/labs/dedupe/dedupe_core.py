from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Union

from PIL import Image
import imagehash

SUPPORTED_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".heic")


def _norm_key(p: Union[str, Path]) -> str:
    """
    Normalize paths for dictionary keys so quality ↔ dedupe lookups align
    across relative vs absolute paths and path separators.
    """
    return Path(p).resolve().as_posix()


def scan_images(in_dir: Path) -> List[Path]:
    paths: List[Path] = []
    for p in sorted(in_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
            paths.append(p)
    return paths


def compute_phash_hex(path: Path) -> str:
    with Image.open(path) as im:
        ph = imagehash.phash(im)
    return str(ph)


def hamming(a_hex: str, b_hex: str) -> int:
    return imagehash.hex_to_hash(a_hex) - imagehash.hex_to_hash(b_hex)


def group_by_phash(paths: List[Path], hashes: List[str], th: int) -> List[List[int]]:
    n = len(paths)
    if n != len(hashes):
        raise ValueError("paths and hashes length mismatch")
    groups: List[List[int]] = []
    used = [False] * n
    for i in range(n):
        if used[i]:
            continue
        used[i] = True
        group = [i]
        for j in range(i + 1, n):
            if used[j]:
                continue
            if hamming(hashes[i], hashes[j]) <= th:
                used[j] = True
                group.append(j)
        groups.append(group)
    return groups


@dataclass(frozen=True)
class QualityInfo:
    sharp_vlap: float
    rejected: bool


def load_quality_map(quality_jsonl: Path) -> Dict[str, QualityInfo]:
    if quality_jsonl is None or not quality_jsonl.exists():
        return {}
    qmap: Dict[str, QualityInfo] = {}
    text = quality_jsonl.read_text(encoding="utf-8")
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        data = json.loads(line)
        path_str = data.get("path")
        if not path_str:
            continue
        sharp_val = float(data.get("sharp_vlap", 0.0) or 0.0)
        rejected_val = bool(data.get("rejected", data.get("reject", False)))
        key = _norm_key(path_str)
        qmap[key] = QualityInfo(sharp_vlap=sharp_val, rejected=rejected_val)
    return qmap


def pick_representative(
    group_idx: List[int],
    paths: List[Path],
    qmap: Dict[str, QualityInfo],
) -> int:
    ranked = []
    for idx in group_idx:
        key = _norm_key(paths[idx])
        info = qmap.get(key)
        if info:
            ranked.append((idx, info))
    if ranked:
        non_rejected = [pair for pair in ranked if not pair[1].rejected]
        pool = non_rejected or ranked
        pool.sort(key=lambda pair: (pair[1].sharp_vlap, -pair[0]))
        return pool[-1][0]
    return min(group_idx)


def build_dedupe_records(
    paths: List[Path],
    phashes: List[str],
    qmap: Dict[str, QualityInfo],
    phash_th: int,
) -> List[dict]:
    groups = group_by_phash(paths, phashes, phash_th)
    records: List[dict] = []
    for gid, idxs in enumerate(groups):
        rep = pick_representative(idxs, paths, qmap)
        for idx in idxs:
            path_str = paths[idx].as_posix()
            key = _norm_key(paths[idx])
            info = qmap.get(key)
            records.append(
                {
                    "path": path_str,
                    "phash": phashes[idx],
                    "group_id": gid,
                    "representative": idx == rep,
                    "sharp_vlap": info.sharp_vlap if info else None,
                    "rejected": info.rejected if info else None,
                }
            )
    return records


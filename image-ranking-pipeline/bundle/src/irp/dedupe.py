from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image
import imagehash
import numpy as np


@dataclass(frozen=True)
class DedupeConfig:
    # Hamming distance threshold at/under which images are considered near-duplicates
    phash_hamming_th: int = 6


def compute_phash_hex(path: Path) -> str:
    with Image.open(path) as im:
        ph = imagehash.phash(im)
    return ph.__str__()  # 16-char hex


def hamming(a_hex: str, b_hex: str) -> int:
    return imagehash.hex_to_hash(a_hex) - imagehash.hex_to_hash(b_hex)


def group_by_phash(paths: List[Path], hashes: List[str], th: int) -> List[List[int]]:
    """Naive O(n^2) clustering by pHash Hamming distance; fine for batches <= few K.
       Returns list of groups where each group is a list of indices into paths/hashes."""
    n = len(paths)
    unassigned = set(range(n))
    groups: List[List[int]] = []
    while unassigned:
        i = unassigned.pop()
        g = [i]
        to_check = list(unassigned)
        for j in to_check:
            if hamming(hashes[i], hashes[j]) <= th:
                g.append(j)
                unassigned.remove(j)
        groups.append(g)
    return groups


def pick_representative(group_idx: List[int], paths: List[Path], sharpness: Dict[str, float]) -> int:
    """Choose the sharpest as representative; fallback to largest resolution (w*h in filename-independent way)."""
    # sharpness dict key by posix path string
    best = None
    best_val = -1.0
    for k in group_idx:
        p = str(paths[k].as_posix())
        val = sharpness.get(p, -1.0)
        if val > best_val:
            best_val = val
            best = k
    return best if best is not None else group_idx[0]


def build_dedupe_records(
    paths: List[Path],
    phashes: List[str],
    q_sharpness: Dict[str, float],
    th: int,
) -> List[Dict]:
    groups = group_by_phash(paths, phashes, th)
    records: List[Dict] = []
    for gid, idxs in enumerate(groups):
        rep = pick_representative(idxs, paths, q_sharpness)
        for i in idxs:
            records.append({
                "path": str(paths[i].as_posix()),
                "phash": phashes[i],
                "group_id": gid,
                "representative": (i == rep),
            })
    return records

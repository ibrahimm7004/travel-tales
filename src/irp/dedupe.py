from __future__ import annotations

from collections import deque
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
       Returns deterministic groups where each group is a list of indices into paths/hashes."""
    n = len(paths)
    unassigned = set(range(n))
    groups: List[List[int]] = []
    while unassigned:
        seed = min(unassigned)
        unassigned.remove(seed)
        g = {seed}
        q = deque([seed])
        while q:
            i = q.popleft()
            for j in sorted(unassigned):
                if hamming(hashes[i], hashes[j]) <= th:
                    unassigned.remove(j)
                    g.add(j)
                    q.append(j)
        groups.append(sorted(g))
    return groups


def pick_representative(group_idx: List[int], paths: List[Path], sharpness: Dict[str, float]) -> int:
    """Choose the sharpest as representative; fallback to largest resolution (w*h in filename-independent way)."""
    # sharpness dict key by posix path string
    sharp_candidates: List[Tuple[float, str, int]] = []
    for k in group_idx:
        p = str(paths[k].as_posix())
        val = sharpness.get(p)
        if val is None:
            continue
        try:
            sval = float(val)
        except Exception:
            continue
        if np.isfinite(sval):
            sharp_candidates.append((sval, p, k))

    if sharp_candidates:
        best_sharp = max(v for v, _, _ in sharp_candidates)
        return min(
            (row for row in sharp_candidates if row[0] == best_sharp),
            key=lambda row: row[1],
        )[2]

    best_idx = group_idx[0]
    best_path = str(paths[best_idx].as_posix())
    best_area = -1
    for k in group_idx:
        p = paths[k]
        p_str = str(p.as_posix())
        area = -1
        try:
            with Image.open(p) as im:
                w, h = im.size
            area = int(w) * int(h)
        except Exception:
            area = -1
        if area > best_area or (area == best_area and p_str < best_path):
            best_area = area
            best_path = p_str
            best_idx = k
    return best_idx


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
    records.sort(key=lambda r: (r["group_id"], 0 if r["representative"] else 1, r["path"]))
    return records

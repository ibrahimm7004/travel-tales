from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
from PIL import Image
import imagehash
import numpy as np
from skimage.metrics import structural_similarity


@dataclass(frozen=True)
class DedupeConfig:
    # Hamming distance threshold at/under which images are considered near-duplicates
    phash_hamming_th: int = 6
    dhash_hamming_th: int | None = None
    whash_hamming_th: int | None = None
    ssim_th: float | None = None
    hist_enable: bool = False
    hist_th: float = 0.9


def compute_phash_hex(path: Path) -> str:
    with Image.open(path) as im:
        ph = imagehash.phash(im)
    return ph.__str__()  # 16-char hex


def compute_dhash_hex(path: Path) -> str:
    with Image.open(path) as im:
        dh = imagehash.dhash(im)
    return dh.__str__()


def compute_whash_hex(path: Path) -> str:
    with Image.open(path) as im:
        wh = imagehash.whash(im)
    return wh.__str__()


def hamming(a_hex: str, b_hex: str) -> int:
    return imagehash.hex_to_hash(a_hex) - imagehash.hex_to_hash(b_hex)


def _build_candidate_pairs(
    phashes: List[str],
    phash_th: int,
    dhashes: List[str] | None = None,
    dhash_th: int | None = None,
    whashes: List[str] | None = None,
    whash_th: int | None = None,
) -> List[Tuple[int, int]]:
    pairs: List[Tuple[int, int]] = []
    n = len(phashes)
    for i in range(n):
        for j in range(i + 1, n):
            if hamming(phashes[i], phashes[j]) > phash_th:
                continue
            if dhash_th is None and whash_th is None:
                pairs.append((i, j))
                continue
            dpass = False
            wpass = False
            if dhash_th is not None and dhashes is not None:
                dpass = hamming(dhashes[i], dhashes[j]) <= dhash_th
            if whash_th is not None and whashes is not None:
                wpass = hamming(whashes[i], whashes[j]) <= whash_th
            if dpass or wpass:
                pairs.append((i, j))
    return pairs


def _load_gray_for_ssim(path: Path, long_side: int = 256) -> np.ndarray | None:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    h, w = img.shape[:2]
    m = max(h, w)
    if m > long_side and m > 0:
        scale = float(long_side) / float(m)
        new_w = max(1, int(round(w * scale)))
        new_h = max(1, int(round(h * scale)))
        img = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return img


def _ssim_score(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape:
        h = max(1, min(a.shape[0], b.shape[0]))
        w = max(1, min(a.shape[1], b.shape[1]))
        a = cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA)
        b = cv2.resize(b, (w, h), interpolation=cv2.INTER_AREA)
    if min(a.shape[0], a.shape[1]) < 7:
        return 0.0
    score = structural_similarity(a, b, data_range=255)
    return float(score)


def _load_hsv_hist(path: Path) -> np.ndarray | None:
    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        return None
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [8, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    return hist


def _hist_score(hist_a: np.ndarray, hist_b: np.ndarray) -> float:
    return float(cv2.compareHist(hist_a, hist_b, cv2.HISTCMP_CORREL))


def _build_verified_edges(
    paths: List[Path],
    candidate_pairs: List[Tuple[int, int]],
    ssim_th: float | None,
    hist_enable: bool,
    hist_th: float,
    debug: bool,
) -> List[Tuple[int, int]]:
    if ssim_th is None and not hist_enable:
        return candidate_pairs

    gray_cache: Dict[int, np.ndarray | None] = {}
    hist_cache: Dict[int, np.ndarray | None] = {}

    def load_gray(idx: int) -> np.ndarray | None:
        if idx not in gray_cache:
            gray_cache[idx] = _load_gray_for_ssim(paths[idx])
        return gray_cache[idx]

    def load_hist(idx: int) -> np.ndarray | None:
        if idx not in hist_cache:
            hist_cache[idx] = _load_hsv_hist(paths[idx])
        return hist_cache[idx]

    edges: List[Tuple[int, int]] = []
    for i, j in candidate_pairs:
        if ssim_th is None:
            ssim_pass = False
            ssim_score = -1.0
        else:
            ga = load_gray(i)
            gb = load_gray(j)
            if ga is None or gb is None:
                if debug:
                    print(f"[dedupe][debug] SSIM load failed: {paths[i]} vs {paths[j]}")
                continue
            try:
                ssim_score = _ssim_score(ga, gb)
            except Exception as exc:
                if debug:
                    print(f"[dedupe][debug] SSIM error: {paths[i]} vs {paths[j]} -> {exc}")
                continue
            ssim_pass = ssim_score >= ssim_th

        hist_pass = True
        if hist_enable:
            ha = load_hist(i)
            hb = load_hist(j)
            if ha is None or hb is None:
                if debug:
                    print(f"[dedupe][debug] Hist load failed: {paths[i]} vs {paths[j]}")
                continue
            hscore = _hist_score(ha, hb)
            hist_pass = hscore >= hist_th
            if debug:
                print(
                    f"[dedupe][debug] pair=({i},{j}) ssim={ssim_score:.4f} "
                    f"ssim_pass={ssim_pass} hist={hscore:.4f} hist_pass={hist_pass}"
                )

        if ssim_pass and hist_pass:
            edges.append((i, j))
        elif debug and not hist_enable:
            print(f"[dedupe][debug] pair=({i},{j}) ssim={ssim_score:.4f} pass={ssim_pass}")
    return edges


def _connected_components(n: int, edges: List[Tuple[int, int]]) -> List[List[int]]:
    adj: List[List[int]] = [[] for _ in range(n)]
    for i, j in edges:
        adj[i].append(j)
        adj[j].append(i)

    for neighbors in adj:
        neighbors.sort()

    seen = [False] * n
    groups: List[List[int]] = []
    for seed in range(n):
        if seen[seed]:
            continue
        q = deque([seed])
        seen[seed] = True
        comp: List[int] = []
        while q:
            cur = q.popleft()
            comp.append(cur)
            for nxt in adj[cur]:
                if not seen[nxt]:
                    seen[nxt] = True
                    q.append(nxt)
        groups.append(sorted(comp))
    return groups


def group_by_phash(paths: List[Path], hashes: List[str], th: int) -> List[List[int]]:
    """Deterministic connected components using pHash-only candidate edges."""
    candidate_pairs = _build_candidate_pairs(hashes, th)
    return _connected_components(len(paths), candidate_pairs)


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
    dhashes: List[str] | None = None,
    whashes: List[str] | None = None,
    dhash_th: int | None = None,
    whash_th: int | None = None,
    ssim_th: float | None = None,
    hist_enable: bool = False,
    hist_th: float = 0.9,
    debug: bool = False,
) -> List[Dict]:
    n = len(paths)
    if len(phashes) != n:
        raise ValueError("phashes length must equal paths length")
    if dhash_th is not None and (dhashes is None or len(dhashes) != n):
        raise ValueError("dhash_th provided but dhashes missing or length mismatch")
    if whash_th is not None and (whashes is None or len(whashes) != n):
        raise ValueError("whash_th provided but whashes missing or length mismatch")

    candidate_pairs = _build_candidate_pairs(
        phashes=phashes,
        phash_th=th,
        dhashes=dhashes,
        dhash_th=dhash_th,
        whashes=whashes,
        whash_th=whash_th,
    )
    if debug:
        print(f"[dedupe][debug] candidate_pairs={len(candidate_pairs)}")

    verified_edges = _build_verified_edges(
        paths=paths,
        candidate_pairs=candidate_pairs,
        ssim_th=ssim_th,
        hist_enable=hist_enable,
        hist_th=hist_th,
        debug=debug,
    )
    if debug:
        print(f"[dedupe][debug] verified_edges={len(verified_edges)}")

    groups = _connected_components(n, verified_edges)
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

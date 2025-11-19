from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict

import cv2
import numpy as np
from PIL import Image

# Defaults (tunable via CLI)
DEFAULT_BLUR_VLAP_TH = 80.0         # < => blurry
DEFAULT_UNDER_PCT_TH = 0.05         # > => underexposed (5% near black)
DEFAULT_OVER_PCT_TH = 0.02         # > => overexposed (2% near white)
LOW_CUTOFF = 10
HIGH_CUTOFF = 245


@dataclass(frozen=True)
class QualityConfig:
    blur_vlap_th: float = DEFAULT_BLUR_VLAP_TH
    under_pct_th: float = DEFAULT_UNDER_PCT_TH
    over_pct_th: float = DEFAULT_OVER_PCT_TH


def _im_gray_u8(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        im = im.convert("L")
        return np.array(im, dtype=np.uint8)


def variance_of_laplacian(gray_u8: np.ndarray) -> float:
    lap = cv2.Laplacian(gray_u8, cv2.CV_64F)
    return float(lap.var())


def exposure_stats(gray_u8: np.ndarray) -> Dict[str, float]:
    total = gray_u8.size
    mean = float(gray_u8.mean())
    pct_low = float((gray_u8 <= LOW_CUTOFF).sum()) / total
    pct_high = float((gray_u8 >= HIGH_CUTOFF).sum()) / total
    return {"mean": mean, "pct_low": pct_low, "pct_high": pct_high}


def assess_quality(path: Path, qcfg: QualityConfig) -> Dict[str, float | bool]:
    g = _im_gray_u8(path)
    sharp = variance_of_laplacian(g)
    exp = exposure_stats(g)
    return {
        "path": str(path.as_posix()),
        "sharp_vlap": sharp,
        "exp_mean": exp["mean"],
        "exp_pct_low": exp["pct_low"],
        "exp_pct_high": exp["pct_high"],
        "blurry": sharp < qcfg.blur_vlap_th,
        "underexposed": exp["pct_low"] > qcfg.under_pct_th,
        "overexposed": exp["pct_high"] > qcfg.over_pct_th,
    }

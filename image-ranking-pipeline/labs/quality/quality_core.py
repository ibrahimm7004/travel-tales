from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
from typing import Dict

import numpy as np
from PIL import Image
import cv2

# ---- Constants (copied from src/irp/quality.py to preserve semantics) ----
DEFAULT_BLUR_VLAP_TH = 80.0   # < => blurry
DEFAULT_UNDER_PCT_TH = 0.05   # > => underexposed (5% near black)
DEFAULT_OVER_PCT_TH = 0.02    # > => overexposed (2% near white)
LOW_CUTOFF = 10
HIGH_CUTOFF = 245

REJECT_SHARP_TH = 6.5
REJECT_EXP_MEAN_LOW = 29.0
REJECT_EXP_MEAN_HIGH = 210.0
REJECT_EXP_PCT_LOW = 0.5
REJECT_EXP_PCT_HIGH = 0.1
REJECT_EXEMPT_SHARP_MEAN = 400.0
REJECT_EXEMPT_SHARP_PCT = 200.0


@dataclass(frozen=True)
class QualityConfig:
    blur_vlap_th: float = DEFAULT_BLUR_VLAP_TH
    under_pct_th: float = DEFAULT_UNDER_PCT_TH
    over_pct_th: float = DEFAULT_OVER_PCT_TH

# ---- Core helpers (logic identical to src/irp/quality.py) ----


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


def should_reject_quality(
    sharp_vlap: float,
    exp_mean: float,
    exp_pct_low: float,
    exp_pct_high: float,
) -> tuple[bool, str | None]:
    """
    Decide if an image should be hard-rejected based on sharpness and exposure.

    Rules:
    - Reject if sharp_vlap < 6.5
    - Reject if (exp_mean < 29 or exp_mean > 210) unless sharp_vlap > 400
    - Reject if exp_pct_low > 0.5 unless sharp_vlap > 200
    - Reject if exp_pct_high > 0.1 unless sharp_vlap > 200
    """
    if sharp_vlap < REJECT_SHARP_TH:
        return True, "sharp_lt_6_5"

    if (
        (exp_mean < REJECT_EXP_MEAN_LOW or exp_mean > REJECT_EXP_MEAN_HIGH)
        and sharp_vlap <= REJECT_EXEMPT_SHARP_MEAN
    ):
        return True, "exp_mean_outside_29_210_unless_sharp_gt_400"

    if exp_pct_low > REJECT_EXP_PCT_LOW and sharp_vlap <= REJECT_EXEMPT_SHARP_PCT:
        return True, "exp_pct_low_gt_0_5_unless_sharp_gt_200"

    if exp_pct_high > REJECT_EXP_PCT_HIGH and sharp_vlap <= REJECT_EXEMPT_SHARP_PCT:
        return True, "exp_pct_high_gt_0_1_unless_sharp_gt_200"

    return False, None


def assess_quality(path: Path, qcfg: QualityConfig) -> Dict[str, float | bool]:
    g = _im_gray_u8(path)
    sharp = variance_of_laplacian(g)
    exp = exposure_stats(g)
    exp_mean = exp["mean"]
    exp_pct_low = exp["pct_low"]
    exp_pct_high = exp["pct_high"]
    reject, reason = should_reject_quality(
        sharp_vlap=sharp,
        exp_mean=exp_mean,
        exp_pct_low=exp_pct_low,
        exp_pct_high=exp_pct_high,
    )
    return {
        "path": str(path.as_posix()),
        "sharp_vlap": sharp,
        "exp_mean": exp_mean,
        "exp_pct_low": exp_pct_low,
        "exp_pct_high": exp_pct_high,
        "blurry": sharp < qcfg.blur_vlap_th,
        "underexposed": exp_pct_low > qcfg.under_pct_th,
        "overexposed": exp_pct_high > qcfg.over_pct_th,
        "reject": reject,
        "rejected": reject,
        "reject_reason": reason or "",
    }






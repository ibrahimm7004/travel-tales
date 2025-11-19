from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
from PIL import Image
from skimage.measure import shannon_entropy


def _im_rgb_small(path: Path, max_side: int = 256) -> np.ndarray:
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        scale = max(1, max(w, h) // max_side)
        im = im.resize((w // scale, h // scale), Image.BILINEAR)
        return np.array(im, dtype=np.uint8)


def dominant_colors_hex(path: Path, k: int = 3) -> List[str]:
    arr = _im_rgb_small(path)
    # simple 12-bit color quantization (4 bits per channel) + mode
    quant = (arr >> 4).astype(np.uint8)
    flat = quant.reshape(-1, 3)
    # find most common bins
    bins = Counter(map(tuple, flat)).most_common(k)

    def to_hex(rgb4):
        r, g, b = rgb4
        # expand 4-bit to 8-bit by repeating nibbles
        return f"#{r*17:02x}{g*17:02x}{b*17:02x}"

    return [to_hex(rgb4) for (rgb4, _) in bins]


def image_entropy(path: Path) -> float:
    arr = _im_rgb_small(path)
    # entropy over grayscale for stability
    gray = (0.299 * arr[..., 0] + 0.587 * arr[..., 1] +
            0.114 * arr[..., 2]).astype(np.uint8)
    return float(shannon_entropy(gray))

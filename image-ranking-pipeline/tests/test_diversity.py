from __future__ import annotations
from pathlib import Path
import numpy as np
from PIL import Image
from irp.diversity import dominant_colors_hex, image_entropy


def test_diversity(tmp_path: Path) -> None:
    # Red/green split
    arr = np.zeros((64, 64, 3), dtype=np.uint8)
    arr[:, :32, 0] = 255
    arr[:, 32:, 1] = 255
    p = tmp_path/"rg.png"
    Image.fromarray(arr).save(p)
    cols = dominant_colors_hex(p, k=2)
    assert len(cols) == 2
    ent = image_entropy(p)
    assert ent > 0.0

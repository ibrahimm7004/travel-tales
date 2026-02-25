from __future__ import annotations
from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
import pytest
from irp.quality import assess_quality, QualityConfig


def _save_img(path: Path, arr: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(arr).save(path)


def test_quality_flags(tmp_path: Path) -> None:
    a = np.zeros((128, 128), dtype=np.uint8)
    a[::2, ::2] = 255
    a[1::2, 1::2] = 255
    sharp_p = tmp_path/"sharp.png"
    _save_img(sharp_p, a)
    blur_p = tmp_path/"blur.png"
    Image.fromarray(a).filter(ImageFilter.GaussianBlur(3)).save(blur_p)
    dark_p = tmp_path/"dark.png"
    _save_img(dark_p, np.zeros((128, 128), dtype=np.uint8))
    bright_p = tmp_path/"bright.png"
    _save_img(bright_p, np.full((128, 128), 255, dtype=np.uint8))
    cfg = QualityConfig(blur_vlap_th=150.0, under_pct_th=0.2, over_pct_th=0.2)
    assert assess_quality(sharp_p, cfg)["blurry"] is False
    assert assess_quality(blur_p, cfg)["blurry"] is True
    assert assess_quality(dark_p, cfg)["underexposed"] is True
    assert assess_quality(bright_p, cfg)["overexposed"] is True
    webp_p = tmp_path / "sharp.webp"
    try:
        Image.fromarray(a).save(webp_p, format="WEBP")
    except OSError as exc:
        pytest.skip(f"Pillow WebP support missing: {exc}")
    assert assess_quality(webp_p, cfg)["path"].endswith("sharp.webp")

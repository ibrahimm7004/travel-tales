from pathlib import Path
import numpy as np
from PIL import Image, ImageFilter
import pytest

from labs.quality.quality_core import QualityConfig, assess_quality


def _save_img(p: Path, arr: np.ndarray) -> None:
    Image.fromarray(arr).save(p)


def test_quality_lab_flags(tmp_path: Path) -> None:
    # create synthetic fixtures
    a = np.zeros((128, 128), dtype=np.uint8)
    a[::2, ::2] = 255
    a[1::2, 1::2] = 255

    sharp_p = tmp_path / "sharp.png"
    _save_img(sharp_p, a)

    blur_p = tmp_path / "blur.png"
    Image.fromarray(a).filter(ImageFilter.GaussianBlur(3)).save(blur_p)

    dark_p = tmp_path / "dark.png"
    _save_img(dark_p, np.zeros((128, 128), dtype=np.uint8))

    bright_p = tmp_path / "bright.png"
    _save_img(bright_p, np.full((128, 128), 255, dtype=np.uint8))

    cfg = QualityConfig(blur_vlap_th=150.0, under_pct_th=0.2, over_pct_th=0.2)

    sharp_rec = assess_quality(sharp_p, cfg)
    assert sharp_rec["blurry"] is False
    assert sharp_rec["reject"] is False
    assert sharp_rec["rejected"] is False
    assert sharp_rec["rejected"] == sharp_rec["reject"]
    assert sharp_rec["reject_reason"] == ""

    blur_rec = assess_quality(blur_p, cfg)
    assert blur_rec["blurry"] is True
    assert blur_rec["reject"] is False
    assert blur_rec["rejected"] is False
    assert blur_rec["rejected"] == blur_rec["reject"]
    assert blur_rec["reject_reason"] == ""

    dark_rec = assess_quality(dark_p, cfg)
    assert dark_rec["underexposed"] is True
    assert dark_rec["reject"] is True
    assert dark_rec["rejected"] is True
    assert dark_rec["rejected"] == dark_rec["reject"]
    assert dark_rec["reject_reason"] == "sharp_lt_6_5"

    bright_rec = assess_quality(bright_p, cfg)
    assert bright_rec["overexposed"] is True
    assert bright_rec["reject"] is True
    assert bright_rec["rejected"] is True
    assert bright_rec["rejected"] == bright_rec["reject"]
    assert bright_rec["reject_reason"] == "sharp_lt_6_5"

    webp_p = tmp_path / "web_sample.webp"
    try:
        Image.fromarray(a).save(webp_p, format="WEBP")
    except OSError as exc:
        pytest.skip(f"Pillow WebP support missing: {exc}")
    webp_rec = assess_quality(webp_p, cfg)
    assert webp_rec["path"].endswith("web_sample.webp")






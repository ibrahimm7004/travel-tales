from __future__ import annotations

from pathlib import Path
import json

from PIL import Image
import pytest

from irp.io import scan_images, load_image_basic, read_exif, write_jsonl


def _make_img(path: Path, size=(8, 6), color=(128, 128, 128)) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", size, color)
    if path.suffix.lower() == ".webp":
        im.save(path, format="WEBP")
    else:
        im.save(path)


def test_scan_and_manifest_keys(tmp_path: Path) -> None:
    # Create tiny images
    img1 = tmp_path / "a.jpg"
    img2 = tmp_path / "b.png"
    _make_img(img1)
    _make_img(img2)
    img3 = tmp_path / "c.webp"
    try:
        _make_img(img3)
    except OSError as exc:
        pytest.skip(f"Pillow WebP support missing: {exc}")

    paths = scan_images(tmp_path)
    assert set(p.name for p in paths) == {"a.jpg", "b.png", "c.webp"}

    # Build minimal records and write jsonl
    records = []
    for p in paths:
        w, h = load_image_basic(p)
        exif = read_exif(p)
        rec = {
            "id": "x",  # dummy for test
            "path": str(p),
            "ts": exif.get("ts"),
            "gps": exif.get("gps"),
            "orientation": exif.get("orientation"),
            "camera": exif.get("camera"),
            "w": w,
            "h": h,
        }
        records.append(rec)

    out = tmp_path / "out" / "manifest.jsonl"
    write_jsonl(records, out)
    assert out.exists()

    # Validate keys exist per line
    with out.open("r", encoding="utf-8") as f:
        lines = [json.loads(line) for line in f]
    for obj in lines:
        for key in ["id", "path", "ts", "gps", "orientation", "camera", "w", "h"]:
            assert key in obj














from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
from pathlib import Path
from typing import Iterable, Iterator, Optional

from PIL import Image, ExifTags

# Optional HEIF support
try:
    import pillow_heif  # type: ignore

    pillow_heif.register_heif_opener()  # type: ignore[attr-defined]
except Exception:
    # Gracefully continue without HEIF support
    pass


VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".heic"}


def scan_images(in_dir: Path) -> list[Path]:
    paths: list[Path] = []
    for p in sorted(in_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in VALID_EXTS:
            paths.append(p)
    return paths


def load_image_basic(path: Path) -> tuple[int, int]:
    with Image.open(path) as im:
        width, height = im.size
    return int(width), int(height)


def _get_exif_dict(path: Path) -> dict[int, object] | None:
    try:
        with Image.open(path) as im:
            exif = im.getexif()
            return dict(exif) if exif else None
    except Exception:
        return None


def _exif_value(exif: dict[int, object] | None, tag_name: str) -> Optional[object]:
    if not exif:
        return None
    tag_to_id = {v: k for k, v in ExifTags.TAGS.items()}
    tag_id = tag_to_id.get(tag_name)
    if tag_id is None:
        return None
    return exif.get(tag_id)


def _parse_timestamp(value: object) -> Optional[str]:
    # EXIF DateTimeOriginal like '2023:08:31 12:34:56'
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", errors="ignore")
        except Exception:
            return None
    if isinstance(value, str):
        value = value.strip().replace("\x00", "")
        for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.strptime(value, fmt)
                return dt.isoformat()
            except Exception:
                continue
    return None


def _parse_orientation(value: object) -> Optional[int]:
    try:
        return int(value) if value is not None else None
    except Exception:
        return None


def _rational_to_float(x: object) -> Optional[float]:
    try:
        if isinstance(x, (int, float)):
            return float(x)
        # PIL may return fractions as tuples (num, den)
        if isinstance(x, tuple) and len(x) == 2:
            num, den = x
            return float(num) / float(den) if den else None
        # Some PIL returners define a class with numerator/denominator attributes
        num = getattr(x, "numerator", None)
        den = getattr(x, "denominator", None)
        if num is not None and den:
            return float(num) / float(den)
    except Exception:
        return None
    return None


def _gps_to_degrees(values: object, ref: Optional[str]) -> Optional[float]:
    # values like ((deg_num,deg_den), (min_num,min_den), (sec_num,sec_den))
    try:
        if not isinstance(values, (list, tuple)) or len(values) != 3:
            return None
        d = _rational_to_float(values[0])
        m = _rational_to_float(values[1])
        s = _rational_to_float(values[2])
        if d is None or m is None or s is None:
            return None
        sign = -1.0 if ref in {"S", "W"} else 1.0
        return sign * (d + (m / 60.0) + (s / 3600.0))
    except Exception:
        return None


def _extract_gps(exif: dict[int, object] | None) -> Optional[dict[str, float]]:
    if not exif:
        return None
    # Find GPS IFD
    gps_tag_id = None
    for k, v in ExifTags.TAGS.items():
        if v == "GPSInfo":
            gps_tag_id = k
            break
    if gps_tag_id is None:
        return None
    gps_ifd = exif.get(gps_tag_id)
    if not isinstance(gps_ifd, dict):
        return None
    inv = ExifTags.GPSTAGS
    lat = _gps_to_degrees(gps_ifd.get(inv.get("GPSLatitude")),
                          gps_ifd.get(inv.get("GPSLatitudeRef")))
    lon = _gps_to_degrees(gps_ifd.get(inv.get("GPSLongitude")),
                          gps_ifd.get(inv.get("GPSLongitudeRef")))
    if lat is None or lon is None:
        return None
    return {"lat": lat, "lon": lon}


def read_exif(path: Path) -> dict[str, object | None]:
    exif = _get_exif_dict(path)
    ts = _parse_timestamp(
        _exif_value(exif, "DateTimeOriginal") or _exif_value(exif, "DateTime")
    )
    orientation = _parse_orientation(_exif_value(exif, "Orientation"))
    camera = _exif_value(exif, "Model")
    if isinstance(camera, bytes):
        try:
            camera = camera.decode("utf-8", errors="ignore")
        except Exception:
            camera = None
    gps = _extract_gps(exif)
    return {
        "ts": ts,
        "gps": gps,
        "orientation": orientation,
        "camera": camera if isinstance(camera, str) else None,
    }


def write_jsonl(records: Iterable[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")














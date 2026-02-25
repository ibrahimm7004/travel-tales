"""
Dedupe lab package (M2). Mirrors the standalone quality lab structure.
"""

from .dedupe_core import (
    SUPPORTED_EXTS,
    QualityInfo,
    scan_images,
    compute_phash_hex,
    hamming,
    group_by_phash,
    load_quality_map,
    pick_representative,
    build_dedupe_records,
)

__all__ = [
    "SUPPORTED_EXTS",
    "QualityInfo",
    "scan_images",
    "compute_phash_hex",
    "hamming",
    "group_by_phash",
    "load_quality_map",
    "pick_representative",
    "build_dedupe_records",
]







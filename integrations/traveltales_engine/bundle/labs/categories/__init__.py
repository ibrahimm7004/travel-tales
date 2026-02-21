"""
Categories lab package (M3) for coarse travel-story labeling.
"""

from .categories_core import (
    ClipCatConfig,
    COARSE_LABELS,
    CLIP_PROMPTS,
    scan_images,
    classify_images,
    score_with_embeddings,
    select_primary_label,
)

__all__ = [
    "ClipCatConfig",
    "COARSE_LABELS",
    "CLIP_PROMPTS",
    "scan_images",
    "classify_images",
    "score_with_embeddings",
    "select_primary_label",
]






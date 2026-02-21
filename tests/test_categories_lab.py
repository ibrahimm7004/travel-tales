from pathlib import Path
import json

import numpy as np

from labs.categories.categories_core import (
    ClipCatConfig,
    SUPPORTED_EXTS,
    adjust_people_animals_margin,
    score_with_embeddings,
    select_primary_label,
    scan_images,
)
from labs.categories.runner import load_paths_from_dedupe


def test_scan_images_deterministic(tmp_path: Path):
    files = ["b.jpg", "a.png", "c.txt", "d.JPEG", "f.webp"]
    for name in files:
        (tmp_path / name).write_text("x")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "e.JPG".lower()).write_text("x")
    paths = scan_images(tmp_path)
    assert [p.name for p in paths] == [
        "a.png", "b.jpg", "d.JPEG", "f.webp", "e.jpg"]
    for p in paths:
        assert p.suffix.lower() in SUPPORTED_EXTS


def test_score_with_embeddings_simple():
    img = np.array([1.0, 0.0, 0.0], dtype="float32")
    text = {
        "people": np.array([[1.0, 0.0, 0.0]], dtype="float32"),
        "nature": np.array([[0.0, 1.0, 0.0]], dtype="float32"),
    }
    scores = score_with_embeddings(img, text)
    assert scores["people"] == 1.0
    assert scores["nature"] == 0.0


def test_select_primary_label_threshold():
    scores = {"people": 0.2, "nature": 0.1}
    assert select_primary_label(scores, min_conf=0.10) == "people"
    assert select_primary_label(scores, min_conf=0.105) == "people"
    assert select_primary_label({"people": 0.10}, min_conf=0.10) == "unknown"


def test_animals_margin_without_faces():
    scores = {"people": 0.31, "animals_wildlife": 0.30}
    adjust_people_animals_margin(scores)
    assert select_primary_label(scores, min_conf=0.28) == "animals_wildlife"
    scores_faces = {"people": 0.31, "animals_wildlife": 0.30}
    # simulate face boost (margin not applied in actual pipeline when faces>0)
    scores_faces["people"] += 0.05
    assert select_primary_label(scores_faces, min_conf=0.28) == "people"


def test_default_min_conf_rule():
    cfg = ClipCatConfig()
    assert cfg.min_conf == 0.10
    assert select_primary_label({"people": 0.11}, cfg.min_conf) == "people"
    assert select_primary_label({"people": 0.10}, cfg.min_conf) == "unknown"


def test_load_paths_from_dedupe(tmp_path: Path):
    dedupe_path = tmp_path / "clip_dedupe.jsonl"
    lines = [
        {"path": str(tmp_path / "a.jpg"),
         "representative": True, "rejected": False},
        {"path": str(tmp_path / "b.jpg"),
         "representative": True, "rejected": True},
        {"path": str(tmp_path / "c.jpg"),
         "representative": False, "rejected": False},
        {"path": str(tmp_path / "a.jpg"),
         "representative": True, "rejected": False},
    ]
    with dedupe_path.open("w", encoding="utf-8") as f:
        for row in lines:
            f.write(json.dumps(row) + "\n")
    survivors = load_paths_from_dedupe(dedupe_path)
    assert len(survivors) == 1
    assert survivors[0] == (tmp_path / "a.jpg").resolve()

from __future__ import annotations
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter
import imagehash
from irp.dedupe import compute_phash_hex, build_dedupe_records


def test_compute_phash_hex_len(tmp_path: Path) -> None:
    p = tmp_path/"x.png"
    Image.new("RGB", (32, 32), "red").save(p)
    hx = compute_phash_hex(p)
    assert isinstance(hx, str) and len(hx) == 16


def test_grouping_with_controlled_hashes(tmp_path: Path) -> None:
    # Use controlled hashes to avoid backend-dependent phash collisions
    paths = [tmp_path/"a.png", tmp_path/"b.png", tmp_path/"c.png"]
    for p in paths:
        Image.new("RGB", (8, 8), "white").save(p)
    ph = ["0"*16, "0"*16, "f"*16]
    dd = build_dedupe_records(paths, ph, q_sharpness={}, th=2)
    groups = {r["group_id"] for r in dd}
    assert len(groups) == 2
    reps = [r for r in dd if r["representative"]]
    assert len(reps) == 2  # one per group

from pathlib import Path

from labs.dedupe.dedupe_core import (
    QualityInfo,
    build_dedupe_records,
    group_by_phash,
    pick_representative,
)


def _abs_key(rel: str) -> str:
    return Path(rel).resolve().as_posix()


def test_group_by_phash_thresholding():
    paths = [Path(f"img_{i}.jpg") for i in range(3)]
    hashes = [
        "0000000000000000",
        "000000000000000f",
        "ffffffffffffffff",
    ]
    groups = group_by_phash(paths, hashes, th=4)
    # First two within threshold, last is far away.
    assert len(groups) == 2
    assert groups[0] == [0, 1]
    assert groups[1] == [2]


def test_pick_representative_prefers_non_rejected_and_sharp():
    paths = [Path("a.jpg"), Path("b.jpg"), Path("c.jpg")]
    qmap = {
        _abs_key("a.jpg"): QualityInfo(sharp_vlap=50.0, rejected=True),
        _abs_key("b.jpg"): QualityInfo(sharp_vlap=40.0, rejected=False),
        _abs_key("c.jpg"): QualityInfo(sharp_vlap=60.0, rejected=False),
    }
    rep = pick_representative([0, 1, 2], paths, qmap)
    assert rep == 2  # highest sharp_vlap among non-rejected


def test_pick_representative_fallback_lowest_index_without_quality():
    paths = [Path("x.jpg"), Path("y.jpg")]
    qmap = {}
    rep = pick_representative([0, 1], paths, qmap)
    assert rep == 0


def test_build_dedupe_records_enriches_quality_fields():
    paths = [Path("dup1.jpg"), Path("dup2.jpg")]
    hashes = ["1111111111111111", "1111111111111110"]
    qmap = {
        _abs_key("dup1.jpg"): QualityInfo(sharp_vlap=10.0, rejected=True),
        _abs_key("dup2.jpg"): QualityInfo(sharp_vlap=20.0, rejected=False),
    }
    records = build_dedupe_records(paths, hashes, qmap, phash_th=6)
    assert len(records) == 2
    reps = [r for r in records if r["representative"]]
    assert len(reps) == 1
    assert reps[0]["path"] == "dup2.jpg"
    for rec in records:
        assert rec["sharp_vlap"] in (10.0, 20.0)
        assert rec["rejected"] in (True, False)


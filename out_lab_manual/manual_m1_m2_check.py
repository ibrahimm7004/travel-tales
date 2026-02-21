from __future__ import annotations

import subprocess
import sys
from pathlib import Path


PHASH_TH = 15
CLIP_SIM_TH = 0.88


def run_cmd(cmd: list[str], cwd: Path) -> None:
    print(f"[manual_m1_m2_check] Running:\n  {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=cwd)


def main() -> int:
    here = Path(__file__).resolve().parent          # out_lab_manual/
    repo_root = here.parent                         # repo root

    images_dir = here / "images"
    quality_jsonl = here / "quality.jsonl"
    out_dedupe = repo_root / "out_lab_dedupe"
    out_categories = repo_root / "out_lab_categories"

    if not images_dir.exists():
        raise SystemExit(
            f"[manual_m1_m2_check] Expected images under: {images_dir.as_posix()}"
        )

    # 1) M1: run quality + open quality gallery
    run_cmd([sys.executable, str(here / "manual_quality_check.py")], cwd=repo_root)

    # 2) M2: run dedupe lab using M1 artifacts
    run_cmd(
        [
            sys.executable,
            "-m",
            "labs.dedupe.runner",
            "--in",
            str(images_dir),
            "--quality",
            str(quality_jsonl),
            "--out",
            str(out_dedupe),
            "--phash-th",
            str(PHASH_TH),
            "--print-summary",
        ],
        cwd=repo_root,
    )

    # 3) M2 Stage-2: CLIP dedupe over pHash representatives
    run_cmd(
        [
            sys.executable,
            "-m",
            "labs.dedupe.clip_runner",
            "--phash-jsonl",
            str(out_dedupe / "dedupe.jsonl"),
            "--quality",
            str(quality_jsonl),
            "--out",
            str(out_dedupe),
            "--clip-sim-th",
            str(CLIP_SIM_TH),
            "--clip-topk",
            "2",
        ],
        cwd=repo_root,
    )

    # 4) M2 Stage-2: open CLIP gallery
    run_cmd([sys.executable, str(out_dedupe / "clip_gallery.py")], cwd=repo_root)

    # 5) M3: categories on M1+M2 survivors
    run_cmd(
        [
            sys.executable,
            "-m",
            "labs.categories.runner",
            "--dedupe-jsonl",
            str(out_dedupe / "clip_dedupe.jsonl"),
            "--out",
            str(out_categories),
            "--print-summary",
        ],
        cwd=repo_root,
    )

    # 6) M3: open categories gallery
    run_cmd([sys.executable, str(out_categories /
            "categories_gallery.py")], cwd=repo_root)

    print("[manual_m1_m2_check] Done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

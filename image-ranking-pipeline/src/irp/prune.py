from __future__ import annotations
from pathlib import Path
import json
import shutil


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def prune_nonreps(out_dir: Path, base_dir: Path | None = None, mode: str = "delete", move_dir: Path | None = None) -> tuple[int, int]:
    """
    Remove or move non-representative duplicates based on dedupe.jsonl.

    Returns (num_nonreps, num_removed_or_moved).
    mode: "delete" (default) | "move"
    base_dir: Optional base to resolve relative paths. If None, paths are resolved as-is.
    move_dir: If mode == "move", required destination folder (created if missing).
    """
    dd_path = out_dir / "dedupe.jsonl"
    rows = _read_jsonl(dd_path)
    if not rows:
        return (0, 0)

    nonreps: list[Path] = []
    for r in rows:
        if not r.get("representative", False):
            p = Path(r["path"])
            if not p.is_absolute() and base_dir is not None:
                # Resolve under provided base if relative
                p = (base_dir / p).resolve()
            nonreps.append(p)

    acted = 0
    if mode == "move":
        if move_dir is None:
            raise ValueError("move_dir is required when mode='move'")
        move_dir.mkdir(parents=True, exist_ok=True)
        for p in nonreps:
            if p.exists() and p.is_file():
                dst = move_dir / p.name
                # Avoid overwrite
                i = 1
                tmp = dst
                while tmp.exists():
                    tmp = dst.with_stem(f"{dst.stem}_{i}")
                    i += 1
                shutil.move(str(p), str(tmp))
                acted += 1
    else:
        # delete
        for p in nonreps:
            if p.exists() and p.is_file():
                try:
                    p.unlink()
                    acted += 1
                except Exception:
                    # continue best-effort
                    pass

    # Log a simple manifest of what changed
    log_path = out_dir / ("pruned_moved.txt" if mode ==
                          "move" else "pruned_deleted.txt")
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("w", encoding="utf-8") as f:
        for p in nonreps:
            f.write(str(p) + "\n")
    return (len(nonreps), acted)














from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RunConfig:
    in_dir: Path
    out_dir: Path
    target: int
    max_workers: int


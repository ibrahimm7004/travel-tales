from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Dict, List, Tuple


REPO_ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
BUNDLE_ROOT = HERE / "bundle"


# Canonical source -> bundle destination (relative paths)
MAPPINGS: List[Tuple[str, str]] = [
    # ---- production core (non-destructive) ----
    ("src/irp/__init__.py", "bundle/src/irp/__init__.py"),
    ("src/irp/cli.py", "bundle/src/irp/cli.py"),
    ("src/irp/config.py", "bundle/src/irp/config.py"),
    ("src/irp/io.py", "bundle/src/irp/io.py"),
    ("src/irp/quality.py", "bundle/src/irp/quality.py"),
    ("src/irp/dedupe.py", "bundle/src/irp/dedupe.py"),
    ("src/irp/diversity.py", "bundle/src/irp/diversity.py"),
    ("src/irp/embed.py", "bundle/src/irp/embed.py"),

    # ---- selected lab cores (experimental, but needed later) ----
    ("labs/dedupe/__init__.py", "bundle/labs/dedupe/__init__.py"),
    ("labs/dedupe/dedupe_core.py", "bundle/labs/dedupe/dedupe_core.py"),
    ("labs/dedupe/clip_core.py", "bundle/labs/dedupe/clip_core.py"),

    ("labs/categories/__init__.py", "bundle/labs/categories/__init__.py"),
    ("labs/categories/categories_core.py", "bundle/labs/categories/categories_core.py"),
]


def _sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _ensure_parent(dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)


def _copy_if_needed(src: Path, dst: Path, *, verbose: bool) -> bool:
    if not src.exists():
        raise FileNotFoundError(f"Missing source file: {src}")

    if dst.exists() and _sha256(src) == _sha256(dst):
        if verbose:
            print(f"[OK] {dst.relative_to(REPO_ROOT)}", flush=True)
        return False

    _ensure_parent(dst)
    shutil.copy2(src, dst)
    if verbose:
        print(f"[WRITE] {dst.relative_to(REPO_ROOT)} <= {src.relative_to(REPO_ROOT)}", flush=True)
    return True


def _materialize_labs_init_if_missing(*, verbose: bool) -> bool:
    """
    Ensure bundle/labs/__init__.py exists so bundled lab modules are importable.
    Only create it if the canonical repo does not have labs/__init__.py.
    """
    canonical = REPO_ROOT / "labs" / "__init__.py"
    bundle = BUNDLE_ROOT / "labs" / "__init__.py"
    if canonical.exists():
        # If repo has it, include it in mapping instead of creating a synthetic file.
        return False

    if bundle.exists():
        return False

    _ensure_parent(bundle)
    bundle.write_text("", encoding="utf-8")
    if verbose:
        print(f"[WRITE] {bundle.relative_to(REPO_ROOT)} (synthetic)", flush=True)
    return True


def _write_manifest(manifest_path: Path, entries: List[Dict[str, str]]) -> None:
    manifest_path.write_text(
        json.dumps(
            {
                "repo_root": str(REPO_ROOT),
                "bundle_root": str(BUNDLE_ROOT),
                "files": entries,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser(description="Sync integrations/traveltales_engine/bundle from canonical sources.")
    ap.add_argument("--check", action="store_true", help="Exit non-zero if bundle differs from sources.")
    ap.add_argument("--write", action="store_true", help="Write/update bundle files from sources.")
    ap.add_argument("--verbose", action="store_true", help="Print file-by-file actions.")
    args = ap.parse_args()

    if args.check == args.write:
        ap.error("Choose exactly one: --check or --write")

    changed = False
    entries: List[Dict[str, str]] = []

    # Ensure base folder exists
    BUNDLE_ROOT.mkdir(parents=True, exist_ok=True)

    for src_rel, dst_rel in MAPPINGS:
        src = REPO_ROOT / src_rel
        dst = REPO_ROOT / dst_rel

        if args.write:
            did_write = _copy_if_needed(src, dst, verbose=args.verbose)
            changed = changed or did_write
        else:
            if not dst.exists() or _sha256(src) != _sha256(dst):
                changed = True
                if args.verbose:
                    print(f"[DIFF] {dst.relative_to(REPO_ROOT)}", flush=True)

        entries.append(
            {
                "src": src_rel,
                "dst": dst_rel,
                "src_sha256": _sha256(src),
                "dst_sha256": _sha256(dst) if dst.exists() else "",
            }
        )

    # synthetic labs __init__ (only if canonical missing)
    if args.write:
        did = _materialize_labs_init_if_missing(verbose=args.verbose)
        changed = changed or did
    else:
        canonical = REPO_ROOT / "labs" / "__init__.py"
        bundle = BUNDLE_ROOT / "labs" / "__init__.py"
        if not canonical.exists() and not bundle.exists():
            changed = True
            if args.verbose:
                print(f"[DIFF] {bundle.relative_to(REPO_ROOT)} (missing)", flush=True)

    manifest_path = HERE / "bundle_manifest.json"
    if args.write:
        _write_manifest(manifest_path, entries)
        if args.verbose:
            print(f"[WRITE] {manifest_path.relative_to(REPO_ROOT)}", flush=True)
    else:
        if not manifest_path.exists():
            changed = True
            if args.verbose:
                print(f"[DIFF] {manifest_path.relative_to(REPO_ROOT)} (missing)", flush=True)

    if args.check and changed:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())



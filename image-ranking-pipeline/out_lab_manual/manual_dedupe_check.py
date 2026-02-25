from __future__ import annotations

import argparse
import json
import os
import sys
import webbrowser
from collections import defaultdict
from html import escape
from pathlib import Path
from typing import Dict, List


def _debug(enabled: bool, msg: str) -> None:
    if enabled:
        print(f"[manual_dedupe_check][debug] {msg}")


def _load_jsonl(path: Path) -> List[dict]:
    if not path.exists():
        raise SystemExit(f"[manual_dedupe_check] Missing file: {path.as_posix()}")
    rows: List[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def _resolve_image_path(raw_path: str, dedupe_jsonl: Path) -> Path:
    p = Path(raw_path)
    if p.is_absolute():
        return p
    cwd_candidate = (Path.cwd() / p).resolve()
    if cwd_candidate.exists():
        return cwd_candidate
    dedupe_candidate = (dedupe_jsonl.parent / p).resolve()
    if dedupe_candidate.exists():
        return dedupe_candidate
    return cwd_candidate


def _load_quality_map(path: Path) -> Dict[str, float]:
    rows = _load_jsonl(path)
    out: Dict[str, float] = {}
    for rec in rows:
        rec_path = rec.get("path")
        rec_sharp = rec.get("sharp_vlap")
        if not isinstance(rec_path, str):
            continue
        try:
            sharp = float(rec_sharp)
        except Exception:
            continue
        p = Path(rec_path)
        out[p.as_posix()] = sharp
        out[p.resolve().as_posix()] = sharp
    return out


def _sharp_for_path(path_str: str, dedupe_jsonl: Path, sharp_map: Dict[str, float]) -> float | None:
    p = Path(path_str)
    k1 = p.as_posix()
    if k1 in sharp_map:
        return sharp_map[k1]
    abs_p = _resolve_image_path(path_str, dedupe_jsonl).as_posix()
    return sharp_map.get(abs_p)


def _build_html(rows: List[dict], dedupe_jsonl: Path, out_html: Path, sharp_map: Dict[str, float]) -> None:
    groups: Dict[int, List[dict]] = defaultdict(list)
    for r in rows:
        gid = int(r["group_id"])
        groups[gid].append(r)

    sections: List[str] = []
    for gid in sorted(groups):
        ordered = sorted(
            groups[gid],
            key=lambda r: (0 if bool(r.get("representative", False)) else 1, str(r.get("path", ""))),
        )
        cards: List[str] = []
        for rec in ordered:
            raw_path = str(rec["path"])
            resolved = _resolve_image_path(raw_path, dedupe_jsonl)
            img_src = resolved.resolve().as_uri()
            file_name = Path(raw_path).name
            is_rep = bool(rec.get("representative", False))
            sharp = _sharp_for_path(raw_path, dedupe_jsonl, sharp_map)
            sharp_html = (
                f'<div class="meta"><b>sharp_vlap:</b> {sharp:.3f}</div>'
                if sharp is not None
                else ""
            )
            rep_label = (
                '<span class="tag rep">representative</span>'
                if is_rep
                else '<span class="tag nonrep">non-representative</span>'
            )
            cards.append(
                f"""
<div class="card{' card-rep' if is_rep else ''}">
  <img src="{escape(img_src)}" alt="{escape(file_name)}"/>
  <div class="meta"><b>file:</b> {escape(file_name)}</div>
  <div class="meta"><b>path:</b> {escape(raw_path)}</div>
  <div class="meta"><b>phash:</b> {escape(str(rec.get("phash", "")))}</div>
  <div class="meta"><b>flag:</b> {rep_label}</div>
  {sharp_html}
</div>
"""
            )

        sections.append(
            f"""
<section class="group">
  <h2>Group {gid} <small>(size {len(ordered)})</small></h2>
  <div class="grid">
    {''.join(cards)}
  </div>
</section>
"""
        )

    html = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Manual Dedupe Gallery</title>
  <style>
    body {{
      margin: 16px;
      font-family: system-ui, Segoe UI, Arial, sans-serif;
      background: #0f1115;
      color: #eceff4;
    }}
    h1 {{
      margin: 0 0 12px;
      font-size: 24px;
    }}
    .group {{
      margin: 20px 0 28px;
      border-top: 1px solid #2b313b;
      padding-top: 10px;
    }}
    .group h2 {{
      margin: 8px 0 10px;
      font-size: 18px;
    }}
    .group small {{
      color: #aab2bf;
      font-size: 14px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 12px;
    }}
    .card {{
      background: #171b22;
      border: 1px solid #2b313b;
      border-radius: 10px;
      padding: 10px;
    }}
    .card-rep {{
      border: 2px solid #35d07f;
      box-shadow: 0 0 0 2px rgba(53, 208, 127, 0.2) inset;
    }}
    img {{
      width: 100%;
      height: auto;
      border-radius: 8px;
      display: block;
      margin-bottom: 8px;
      background: #0b0d11;
    }}
    .meta {{
      font-family: ui-monospace, Consolas, monospace;
      font-size: 12px;
      line-height: 1.45;
      word-break: break-word;
    }}
    .tag {{
      display: inline-block;
      padding: 1px 6px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
    }}
    .tag.rep {{
      background: #1f5f3e;
      color: #c6ffe1;
    }}
    .tag.nonrep {{
      background: #54323a;
      color: #ffd7e0;
    }}
  </style>
</head>
<body>
  <h1>Manual Dedupe Gallery</h1>
  <p>Groups sorted by <b>group_id</b>. Within each group: representative first, then path lexicographic.</p>
  {''.join(sections)}
</body>
</html>
"""
    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_html.write_text(html, encoding="utf-8")


def _open_in_browser(path: Path, debug: bool) -> None:
    abs_path = path.resolve()
    if sys.platform.startswith("win"):
        try:
            os.startfile(str(abs_path))  # type: ignore[attr-defined]
            _debug(debug, f"opened with os.startfile: {abs_path.as_posix()}")
            return
        except Exception as exc:
            _debug(debug, f"os.startfile failed: {exc}; falling back to webbrowser")
    opened = webbrowser.open(abs_path.as_uri())
    _debug(debug, f"webbrowser.open returned {opened}")


def main() -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser(description="Build manual HTML gallery for dedupe.jsonl.")
    ap.add_argument("--dedupe-jsonl", type=Path, required=True, help="Path to dedupe.jsonl")
    ap.add_argument("--quality-jsonl", type=Path, default=None, help="Optional quality.jsonl for sharp_vlap display")
    ap.add_argument(
        "--out-html",
        type=Path,
        default=here / "dedupe_gallery.html",
        help="Output gallery HTML path",
    )
    ap.add_argument("--open", action="store_true", help="Open generated HTML in default browser")
    ap.add_argument("--debug", action="store_true", help="Enable debug logs")
    args = ap.parse_args()

    dedupe_jsonl: Path = args.dedupe_jsonl
    out_html: Path = args.out_html

    rows = _load_jsonl(dedupe_jsonl)
    sharp_map: Dict[str, float] = {}
    if args.quality_jsonl is not None:
        sharp_map = _load_quality_map(args.quality_jsonl)
        _debug(args.debug, f"loaded sharp_vlap entries: {len(sharp_map)}")

    _build_html(rows, dedupe_jsonl, out_html, sharp_map)
    print(f"[manual_dedupe_check] Wrote {out_html.as_posix()}")

    if args.open:
        _open_in_browser(out_html, args.debug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

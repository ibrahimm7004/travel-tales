from __future__ import annotations

import json
import os
import subprocess
import sys
import webbrowser
from collections import defaultdict
from pathlib import Path
from typing import Dict, List

BLUR_TH = 70.0
UNDER_LOW = 0.08
OVER_HIGH = 0.02


def run_quality() -> None:
    """
    Run the quality lab on images under out_lab_manual/images and write
    quality.jsonl into out_lab_manual.
    """
    here = Path(__file__).resolve().parent
    repo_root = here.parent
    images_dir = here / "images"
    out_dir = here

    if not images_dir.exists():
        raise SystemExit(
            f"[manual_quality_check] Expected images under: {images_dir.as_posix()}"
        )

    cmd = [
        sys.executable,
        "-m",
        "labs.quality.runner",
        "--in",
        str(images_dir),
        "--out",
        str(out_dir),
        "--blur-th",
        str(BLUR_TH),
        "--under-low",
        str(UNDER_LOW),
        "--over-high",
        str(OVER_HIGH),
        "--print-summary",
    ]

    print(f"[manual_quality_check] Running quality lab:\n  {' '.join(cmd)}")
    subprocess.run(cmd, check=True, cwd=repo_root)


def load_quality_records(artifact: Path) -> List[Dict]:
    if not artifact.exists():
        raise SystemExit(
            f"[manual_quality_check] Missing artifact: {artifact.as_posix()}"
        )
    rows: List[Dict] = []
    for line in artifact.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        rows.append(json.loads(line))
    return rows


def build_gallery(rows: List[Dict], out_html: Path) -> None:
    """
    Build a simple HTML gallery from quality.jsonl.
    Images are grouped by their parent folder name and sorted by sharp_vlap asc.
    """
    from html import escape

    by: Dict[str, List[Dict]] = defaultdict(list)
    for r in rows:
        p = Path(r["path"])
        bucket = p.parent.name or "images"
        by[bucket].append(r)

    for b in by:
        by[b].sort(key=lambda r: r.get("sharp_vlap", 0.0))

    def img_src_for(rec: Dict) -> str:
        repo_root = Path.cwd()
        img_abs = (repo_root / rec["path"]).resolve()
        rel = os.path.relpath(img_abs, out_html.parent.resolve())
        return rel.replace("\\", "/")

    sections: List[str] = []
    for bucket in sorted(by.keys()):
        rows_html: List[str] = []
        for r in by[bucket]:
            src = img_src_for(r)
            rejected = bool(r.get("rejected", r.get("reject", False)))
            reason = (r.get("reject_reason") or "").strip()
            reason_suffix = (
                f" (reason: {escape(reason)})" if rejected and reason else ""
            )
            rows_html.append(
                f"""
<tr>
  <td style="vertical-align:top;">
    <img src="{escape(src)}" style="max-width:320px; height:auto; border-radius:8px;"/>
  </td>
  <td style="vertical-align:top; font-family:ui-monospace,Consolas,monospace; font-size:13px;">
    <div><b>path:</b> {escape(r["path"])}</div>
    <div><b>sharp_vlap:</b> {r["sharp_vlap"]:.1f}</div>
    <div><b>exp_mean:</b> {r["exp_mean"]:.1f}</div>
    <div><b>exp_pct_low:</b> {r["exp_pct_low"]:.3f} &nbsp; <b>underexposed:</b> {r["underexposed"]}</div>
    <div><b>exp_pct_high:</b> {r["exp_pct_high"]:.3f} &nbsp; <b>overexposed:</b> {r["overexposed"]}</div>
    <div><b>blurry:</b> {r["blurry"]}</div>
    <div><b>rejected:</b> {rejected}{reason_suffix}</div>
  </td>
</tr>
"""
            )

        sections.append(
            f"""
<h2 style="font-family:system-ui; margin-top:32px;">
  Folder: {escape(bucket)} (n={len(by[bucket])})
</h2>
<table cellspacing="12">
  {''.join(rows_html)}
</table>
"""
        )

    html_doc = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Manual Quality Gallery</title>
  <style>
    body {{
      background:#0b0d10;
      color:#e9eef5;
      font-family:system-ui,Segoe UI,Arial;
    }}
    a, b {{ color:#e9eef5; }}
    h1 {{ margin: 12px 0 0; }}
    h2 {{ border-bottom: 1px solid #23303f; padding-bottom: 4px; }}
    table td {{ padding: 8px; }}
  </style>
</head>
<body>
  <h1>Manual Quality Gallery</h1>
  <p>Sorted by <i>sharp_vlap</i> ascending within each folder. Lower = blurrier.</p>
  {''.join(sections)}
</body>
</html>"""

    out_html.parent.mkdir(parents=True, exist_ok=True)
    out_html.write_text(html_doc, encoding="utf-8")
    print(f"[manual_quality_check] Wrote {out_html.as_posix()}")


def open_in_browser(path: Path) -> None:
    uri = path.resolve().as_uri()
    print(f"[manual_quality_check] Opening {uri}")
    webbrowser.open(uri)


def main() -> int:
    here = Path(__file__).resolve().parent
    artifact = here / "quality.jsonl"

    run_quality()
    rows = load_quality_records(artifact)
    out_html = here / "quality_gallery.html"
    build_gallery(rows, out_html)
    open_in_browser(out_html)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

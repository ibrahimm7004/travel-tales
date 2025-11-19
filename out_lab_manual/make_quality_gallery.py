import json
import pathlib
import html
import os
from collections import defaultdict

ART = pathlib.Path("out_lab_manual/quality.jsonl")
OUT = pathlib.Path("out_lab_manual/quality_gallery.html")

rows = [json.loads(x) for x in ART.read_text(
    encoding="utf-8").splitlines() if x.strip()]

BUCKETS = {"sharp_day", "motion_blur", "lowlight_dark",
           "overexposed", "mixed", "manual_check", "tiny_thumbs"}


def bucket(p: str) -> str:
    parts = pathlib.Path(p).parts
    for part in reversed(parts):
        if part in BUCKETS:
            return part
    return "unknown"


by = defaultdict(list)
for r in rows:
    by[bucket(r["path"])].append(r)

# Sort within each bucket by sharpness (ascending)
for b in by:
    by[b].sort(key=lambda r: r["sharp_vlap"])


def img_src_for(r: dict) -> str:
    # r["path"] is something like "labs/quality/manual_check/xxx.jpg"
    repo_root = pathlib.Path.cwd()
    img_abs = (repo_root / r["path"]).resolve()
    rel = os.path.relpath(img_abs, OUT.parent.resolve())
    return rel.replace("\\", "/")  # browser-friendly


def row_html(r: dict) -> str:
    src = img_src_for(r)
    rejected = r.get("rejected", r.get("reject", False))
    reason = r.get("reject_reason", "")
    reason_suffix = f" (reason: {html.escape(reason)})" if rejected and reason else ""
    return f"""
    <tr>
      <td style="vertical-align:top;">
        <img src="{html.escape(src)}" style="max-width:320px; height:auto; border-radius:8px;"/>
      </td>
      <td style="vertical-align:top; font-family:ui-monospace,Consolas,monospace; font-size:13px;">
        <div><b>path:</b> {html.escape(r["path"])}</div>
        <div><b>sharp_vlap:</b> {r["sharp_vlap"]:.1f}</div>
        <div><b>exp_mean:</b> {r["exp_mean"]:.1f}</div>
        <div><b>exp_pct_low:</b> {r["exp_pct_low"]:.3f} &nbsp; <b>underexposed:</b> {r["underexposed"]}</div>
        <div><b>exp_pct_high:</b> {r["exp_pct_high"]:.3f} &nbsp; <b>overexposed:</b> {r["overexposed"]}</div>
        <div><b>blurry:</b> {r["blurry"]}</div>
        <div><b>rejected:</b> {rejected}{reason_suffix}</div>
      </td>
    </tr>
    """


sections = []
for b in sorted(by.keys()):
    rows_html = "\n".join(row_html(r) for r in by[b])
    sections.append(f"""
    <h2 style="font-family:system-ui; margin-top:32px;">Bucket: {html.escape(b)} (n={len(by[b])})</h2>
    <table cellspacing="12">{rows_html}</table>
    """)

html_doc = f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Quality Gallery</title>
  <style>
    body {{ background:#0b0d10; color:#e9eef5; font-family:system-ui,Segoe UI,Arial; }}
    a, b {{ color:#e9eef5; }}
    h1 {{ margin: 12px 0 0; }}
    h2 {{ border-bottom: 1px solid #23303f; padding-bottom: 4px; }}
    table td {{ padding: 8px; }}
  </style>
</head>
<body>
  <h1>Quality Gallery</h1>
  <p>Sorted by <i>sharp_vlap</i> (ascending) within each bucket. Lower = blurrier.</p>
  {''.join(sections)}
</body>
</html>"""

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(html_doc, encoding="utf-8")
print(f"Wrote {OUT.as_posix()}")

from collections import defaultdict
import json
import pathlib
import html
ART = pathlib.Path("out_lab_manual/quality.jsonl")
OUT = pathlib.Path("out_lab_manual/quality_gallery.html")
rows = [json.loads(x) for x in ART.read_text(
    encoding="utf-8").splitlines() if x.strip()]


def b(p):
    import pathlib
    for part in pathlib.Path(p).parts[::-1]:
        if part in {"sharp_day", "motion_blur", "lowlight_dark", "overexposed", "mixed", "manual_check"}:
            return part
    return "unknown"


by = defaultdict(list)
for r in rows:
    by[b(r["path"])].append(r)
for k in by:
    by[k].sort(key=lambda r: r["sharp_vlap"])
sections = []
for b in sorted(by):
    items = "".join(
        f"<tr><td><img src='{r['path']}' style='max-width:320px'></td><td><pre>{r}</pre></td></tr>" for r in by[b])
    sections.append(f"<h2>{b} (n={len(by[b])})</h2><table>{items}</table>")
html_doc = "<!doctype html><html><body>" + "".join(sections)+"</body></html>"
OUT.write_text(html_doc, encoding="utf-8")
print("WROTE", OUT.as_posix())

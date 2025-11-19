import argparse, csv, json, pathlib, statistics as st
from collections import defaultdict

def load_rows(path):
    p = pathlib.Path(path)
    if not p.exists():
        raise SystemExit(f"Missing artifact: {p.as_posix()}")
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]

BUCKETS = {"sharp_day","motion_blur","lowlight_dark","overexposed","mixed","tiny_thumbs"}
def bucket_of(p):
    parts = pathlib.Path(p).parts
    for part in reversed(parts):
        if part in BUCKETS:
            return part
    return "unknown"

def is_rejected(rec):
    return bool(rec.get("rejected", rec.get("reject", False)))

def q(arr, p):
    if not arr: return 0.0
    s = sorted(arr)
    i = max(0, min(int(p*(len(s)-1)), len(s)-1))
    return float(s[i])

def summarize(rows):
    by = defaultdict(list)
    for r in rows:
        by[bucket_of(r["path"])].append(r)
    table = []
    for b, rs in sorted(by.items()):
        n=len(rs)
        def pct(flag_getter):
            return 100.0 * flag_getter / max(1, n)
        blurry_pct = pct(sum(1 for x in rs if x.get("blurry", False)))
        under_pct = pct(sum(1 for x in rs if x.get("underexposed", False)))
        over_pct = pct(sum(1 for x in rs if x.get("overexposed", False)))
        rejected_pct = pct(sum(1 for x in rs if is_rejected(x)))
        sv=[x["sharp_vlap"] for x in rs]
        med = st.median(sv) if sv else 0.0
        table.append([
            b, n, round(blurry_pct,1), round(under_pct,1), round(over_pct,1), round(rejected_pct,1),
            round(med,1), round(q(sv,0.10),1), round(q(sv,0.90),1)
        ])
    return table

def print_full(table):
    print("bucket,n,blurry%,under%,over%,rejected%,sharp_vlap_med,sharp_vlap_p10,sharp_vlap_p90")
    for r in table:
        print(*r, sep=",")

def print_compact(table):
    for b,n,bl,un,ov,rj,med,p10,p90 in table:
        print(f"{b}: n={n}, blurry%={bl:.1f}, rejected%={rj:.1f}, med_vlap={med:.1f} [p10={p10:.1f}, p90={p90:.1f}]")

def save_files(table, out_dir="out_lab"):
    od = pathlib.Path(out_dir); od.mkdir(parents=True, exist_ok=True)
    (od/"summary_by_bucket.md").write_text(
        "\n".join([
            "| bucket | n | blurry% | under% | over% | rejected% | sharp_vlap_med | p10 | p90 |",
            "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
            *[f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {r[6]} | {r[7]} | {r[8]} |" for r in table]
        ]), encoding="utf-8"
    )
    with (od/"summary_by_bucket.csv").open("w", newline="", encoding="utf-8") as f:
        import csv as _csv
        w=_csv.writer(f); w.writerow(["bucket","n","blurry%","under%","over%","rejected%","sharp_vlap_med","p10","p90"]); w.writerows(table)
    rows = load_rows(pathlib.Path(out_dir)/"quality.jsonl")
    with (od/"summary_by_image.csv").open("w", newline="", encoding="utf-8") as f:
        w=_csv.writer(f); 
        w.writerow(["bucket","path","sharp_vlap","exp_mean","exp_pct_low","exp_pct_high","blurry","underexposed","overexposed","reject","rejected"])
        for r in rows:
            b = bucket_of(r["path"])
            rejected = is_rejected(r)
            w.writerow(
                [
                    b,
                    r["path"],
                    r["sharp_vlap"],
                    r.get("exp_mean"),
                    r["exp_pct_low"],
                    r["exp_pct_high"],
                    r["blurry"],
                    r["underexposed"],
                    r["overexposed"],
                    r.get("reject", rejected),
                    rejected,
                ]
            )

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["full","compact"], default="full")
    ap.add_argument("--artifact", default="out_lab/quality.jsonl")
    args = ap.parse_args()
    rows = load_rows(args.artifact)
    table = summarize(rows)
    if args.mode == "full":
        print_full(table)
    else:
        print_compact(table)
    save_files(table)
    print("\nWrote: out_lab/summary_by_bucket.csv, out_lab/summary_by_image.csv, out_lab/summary_by_bucket.md")

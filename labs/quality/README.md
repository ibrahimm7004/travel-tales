# Quality Lab (Standalone)

This disposable lab isolates the quality step (sharpness via variance-of-laplacian, exposure low/high%) for quick manual tuning.

## How to run

```bash
python labs/quality/runner.py --in ./images --out ./out_lab --print-summary
# with knobs:
python labs/quality/runner.py --in ./images --out ./out_lab \
  --blur-th 120 --under-low 0.08 --over-high 0.03 --print-summary
```

Output: ./out_lab/quality.jsonl (one JSON object per image):

path, sharp_vlap, exp_mean, exp_pct_low, exp_pct_high,
blurry, underexposed, overexposed.

Notes

Logic mirrors src/irp/quality.py so results are comparable.

No changes to the main pipeline; this lab is safe to delete after tuning.














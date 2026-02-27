# Step C Notes

## Toggles / disabled heuristics

- `DISABLED: size prior in ratio; re-enable if needed`
- Previous ratio weighting inside Step C used:
  - `elo_weight = exp((elo - mean_elo) / S)`
  - `prior = sqrt(size)`
  - `weight = elo_weight * prior`
- Current behavior keeps only Elo preference weight in ratio:
  - `weight = elo_weight`
- Reason it is disabled:
  - Early allocations should be preference-first and less dominated by cluster volume.
  - Size still influences cold-start mildly via initial Elo prior (`log1p(size)` boost), but not ongoing ratio weighting.


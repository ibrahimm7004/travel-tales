## Categories Lab (M3)

This lab assigns coarse travel-story categories to images using OpenCLIP zero-shot classification with an optional face-detection boost for the `people` label. It mirrors the existing quality and dedupe labs but runs fully offline and isolates experimentation from the production pipeline.

### Coarse Labels

```
people
animals_wildlife
nature_outdoors
urban_built
culture_indoors_art
food_dining
transit_journey
unknown
```

### Install extras

The lab needs OpenCLIP + Torch (CPU). Install once:

```bash
poetry install -E clip
# or: pip install open-clip-torch torch torchvision scikit-learn pillow
```

### Run the lab

```bash
python -m labs.categories.runner \
  --in out_lab_manual/images \
  --out out_lab_categories \
  --print-summary
```

Artifacts:

- `out_lab_categories/categories.jsonl` — per-image records `{path, primary, scores, signals}`.

### Manual gallery

After running the lab:

```bash
python out_lab_categories/categories_gallery.py
```

This writes `out_lab_categories/categories_gallery.html` and opens it in your browser grouped by category, showing the top-3 scores and face-detection signal per image.

### Notes

- Deterministic model (`ViT-B/32 laion2b`) for consistent scoring.
- `face_boost` improves recall on people-centric shots using OpenCV Haar cascades; a gentle no-face margin nudges near-ties toward `animals_wildlife` when faces are absent.
- Primary falls back to `unknown` only if the top non-unknown CLIP score is ≤ 0.10.
- No EXIF/GPS/timestamps needed; pure visual cues.




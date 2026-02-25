from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import numpy as np

SUPPORTED_EXTS = (".jpg", ".jpeg", ".png", ".webp", ".heic")


def scan_images(in_dir: Path) -> List[Path]:
    paths: List[Path] = []
    for p in sorted(in_dir.rglob("*")):
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTS:
            paths.append(p)
    return paths


COARSE_LABELS = [
    "people",
    "animals_wildlife",
    "nature_outdoors",
    "urban_built",
    "culture_indoors_art",
    "food_dining",
    "transit_journey",
    "unknown",
]


CLIP_PROMPTS: Dict[str, List[str]] = {
    "people": [
        "a photo of people",
        "a group of friends or family",
        "a portrait of a person",
        "a selfie",
    ],
    "animals_wildlife": [
        "a photo of an animal",
        "wildlife or a pet",
        "a dog or cat or bird",
        "an animal in nature",
    ],
    "nature_outdoors": [
        "a landscape photo of nature",
        "mountains beach forest or ocean",
        "outdoor scenery",
    ],
    "urban_built": [
        "a city street or architecture",
        "buildings and urban environment",
        "cityscape",
    ],
    "culture_indoors_art": [
        "a museum or art gallery",
        "cultural heritage or festival",
        "artwork or exhibit",
        "indoor cultural place",
    ],
    "food_dining": [
        "a photo of food",
        "a meal at a restaurant",
        "food and drinks on a table",
    ],
    "transit_journey": [
        "travel or transit photo",
        "a train plane bus car or road trip",
        "airport or travel journey",
    ],
}


@dataclass(frozen=True)
class ClipCatConfig:
    model_name: str = "ViT-B-32"
    pretrained: str = "laion2b_s34b_b79k"
    batch_size: int = 16
    device: str = "cpu"
    min_conf: float = 0.10
    face_boost: float = 0.12


NO_FACE_PEOPLE_MARGIN = 0.04
NO_FACE_PEOPLE_PENALTY = 0.03


def _l2norm(x: np.ndarray) -> np.ndarray:
    if x.size == 0:
        return x
    n = np.linalg.norm(x, axis=1, keepdims=True) + 1e-12
    return x / n


def _load_openclip(cfg: ClipCatConfig):
    try:
        import open_clip
        import torch  # noqa: F401
    except Exception as e:  # pragma: no cover - import guard
        raise ImportError(
            "Categories lab requires CLIP extras. Install with: "
            "poetry install -E clip  (or pip install open-clip-torch torch torchvision scikit-learn pillow)"
        ) from e

    model, _, preprocess = open_clip.create_model_and_transforms(
        cfg.model_name, pretrained=cfg.pretrained, device=cfg.device
    )
    tokenizer = open_clip.get_tokenizer(cfg.model_name)
    model.eval()
    return model, preprocess, tokenizer


def compute_image_embeddings(
    paths: Sequence[Path], cfg: ClipCatConfig, model_bundle=None
) -> np.ndarray:
    import torch
    from PIL import Image

    if model_bundle is None:
        model, preprocess, _ = _load_openclip(cfg)
    else:
        model, preprocess, _ = model_bundle

    embs: List[np.ndarray] = []
    bs = max(1, int(cfg.batch_size))

    with torch.no_grad():
        for i in range(0, len(paths), bs):
            batch = paths[i : i + bs]
            imgs = [preprocess(Image.open(p).convert("RGB")) for p in batch]
            t = torch.stack(imgs).to(cfg.device)
            feats = model.encode_image(t)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            embs.append(feats.cpu().numpy().astype("float32"))

    out = np.concatenate(embs, axis=0) if embs else np.zeros((0, 512), dtype="float32")
    return out


def compute_text_embeddings(
    prompts: Dict[str, List[str]], cfg: ClipCatConfig, model_bundle=None
) -> Dict[str, np.ndarray]:
    import torch

    if model_bundle is None:
        model, _, tokenizer = _load_openclip(cfg)
    else:
        model, _, tokenizer = model_bundle

    text_embs: Dict[str, np.ndarray] = {}
    with torch.no_grad():
        for label, ps in prompts.items():
            tokens = tokenizer(ps).to(cfg.device)
            feats = model.encode_text(tokens)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            feats = feats.mean(dim=0, keepdim=True)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            text_embs[label] = feats.cpu().numpy().astype("float32")
    return text_embs


def score_with_embeddings(img_emb: np.ndarray, text_embs: Dict[str, np.ndarray]) -> Dict[str, float]:
    scores: Dict[str, float] = {}
    for label, t in text_embs.items():
        scores[label] = float(np.dot(img_emb, t.reshape(-1)))
    return scores


def _imread_bgr(path: Path, cv2_module):
    img = cv2_module.imread(str(path))
    if img is not None:
        return img
    try:
        from PIL import Image
    except Exception:
        return None
    try:
        rgb = Image.open(path).convert("RGB")
    except Exception:
        return None
    arr = np.array(rgb)
    return cv2_module.cvtColor(arr, cv2_module.COLOR_RGB2BGR)


def count_faces_haar(path: Path) -> int:
    try:
        import cv2
    except Exception:  # pragma: no cover - optional dependency is already present in main deps
        return 0

    img = _imread_bgr(path, cv2)
    if img is None:
        return 0
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cascade = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    faces = cascade.detectMultiScale(
        gray, scaleFactor=1.1, minNeighbors=5, minSize=(24, 24)
    )
    return int(len(faces))


def adjust_people_animals_margin(scores: Dict[str, float]) -> None:
    ppl = scores.get("people", -1.0)
    ani = scores.get("animals_wildlife", -1.0)
    if ani > -0.5 and ppl - ani < NO_FACE_PEOPLE_MARGIN:
        scores["people"] = ppl - NO_FACE_PEOPLE_PENALTY


def select_primary_label(scores: Dict[str, float], min_conf: float) -> str:
    non_unknown = [k for k in scores.keys() if k != "unknown"]
    if not non_unknown:
        return "unknown"
    best_label = max(non_unknown, key=lambda k: scores[k])
    return best_label if scores[best_label] > min_conf else "unknown"


def classify_images(
    paths: Sequence[Path],
    cfg: ClipCatConfig,
) -> List[dict]:
    if not paths:
        return []

    model_bundle = _load_openclip(cfg)
    img_embs = _l2norm(compute_image_embeddings(paths, cfg, model_bundle))
    text_embs = compute_text_embeddings(CLIP_PROMPTS, cfg, model_bundle)

    out: List[dict] = []
    for p, emb in zip(paths, img_embs):
        scores = score_with_embeddings(emb, text_embs)
        faces = count_faces_haar(p)
        if faces > 0:
            scores["people"] = scores.get("people", 0.0) + cfg.face_boost
        else:
            adjust_people_animals_margin(scores)

        primary = select_primary_label(scores, cfg.min_conf)
        out.append(
            {
                "path": str(p.as_posix()),
                "primary": primary,
                "scores": {k: float(scores[k]) for k in sorted(scores.keys())},
                "signals": {"faces": faces},
            }
        )

    return out




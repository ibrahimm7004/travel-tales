from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

# NOTE: open_clip/torch imports are inside functions so the lab still works
# without clip extras installed.


@dataclass(frozen=True)
class ClipConfig:
    model_name: str = "ViT-B-32"
    pretrained: str = "laion2b_s34b_b79k"
    batch_size: int = 16
    device: str = "cpu"
    sim_th: float = 0.88   # cosine similarity threshold for clustering
    top_k_per_cluster: int = 2


def _l2norm(x: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(x, axis=1, keepdims=True) + 1e-12
    return x / n


def compute_clip_embeddings(paths: Sequence[Path], cfg: ClipConfig) -> np.ndarray:
    """
    Compute L2-normalized CLIP image embeddings for given paths.
    Deterministic order: embeddings align with `paths` order.
    """
    try:
        import torch
        import open_clip
        from PIL import Image
    except Exception as e:
        raise ImportError(
            "CLIP extras not installed. Install with: "
            "poetry install -E clip  (or pip install open-clip-torch torch torchvision scikit-learn)"
        ) from e

    model, _, preprocess = open_clip.create_model_and_transforms(
        cfg.model_name, pretrained=cfg.pretrained, device=cfg.device
    )
    model.eval()

    embs: List[np.ndarray] = []
    bs = max(1, int(cfg.batch_size))

    with torch.no_grad():
        for i in range(0, len(paths), bs):
            batch_paths = paths[i : i + bs]
            imgs = []
            for p in batch_paths:
                im = Image.open(p).convert("RGB")
                imgs.append(preprocess(im))
            t = torch.stack(imgs).to(cfg.device)
            feats = model.encode_image(t)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            embs.append(feats.cpu().numpy().astype("float32"))

    out = np.concatenate(embs, axis=0) if embs else np.zeros((0, 512), dtype="float32")
    return out


def cluster_by_cosine(
    emb: np.ndarray, sim_th: float
) -> List[List[int]]:
    """
    Agglomerative clustering using cosine distance (1 - cosine_sim).
    Returns clusters as lists of indices into emb.
    Deterministic given fixed emb order.
    """
    if len(emb) == 0:
        return []

    from sklearn.cluster import AgglomerativeClustering

    # cosine distance in [0, 2], but for normalized vectors it's [0, 2] with most in [0,1]
    dist_th = 1.0 - float(sim_th)

    clustering = AgglomerativeClustering(
        n_clusters=None,
        metric="cosine",
        linkage="average",
        distance_threshold=dist_th,
        compute_full_tree=True,
    )
    labels = clustering.fit_predict(emb)

    clusters: Dict[int, List[int]] = {}
    for idx, lab in enumerate(labels):
        clusters.setdefault(int(lab), []).append(idx)

    # stable ordering by label then index
    return [clusters[k] for k in sorted(clusters.keys())]


def build_clip_dedupe_records(
    rep_paths: Sequence[Path],
    rep_phash_records: Sequence[dict],
    qmap: Dict[str, object],
    cfg: ClipConfig,
) -> List[dict]:
    """
    Run CLIP clustering over representative paths from pHash stage.
    Output schema mirrors dedupe.jsonl plus clip fields.

    We keep only top_k_per_cluster reps per CLIP cluster, others become nonreps.
    """
    # 1) embeddings + clusters
    emb = compute_clip_embeddings(rep_paths, cfg)
    emb = _l2norm(emb)
    clusters = cluster_by_cosine(emb, cfg.sim_th)

    # 2) helper to read quality info safely
    def qinfo(p: Path):
        qi = qmap.get(str(p.resolve()))
        if qi is None:
            return (0.0, False)
        sharp = float(getattr(qi, "sharp_vlap", 0.0))
        rej = bool(getattr(qi, "rejected", False))
        return (sharp, rej)

    out: List[dict] = []
    clip_group_id = 0

    for cl in clusters:
        # sort members by (not rejected, sharpness desc, path)
        members = [rep_paths[i] for i in cl]
        members_sorted = sorted(
            members,
            key=lambda p: (
                qinfo(p)[1],          # rejected True last
                -qinfo(p)[0],         # sharpness high first
                str(p),
            ),
        )

        keep = set(members_sorted[: cfg.top_k_per_cluster])

        # emit records for all members in this CLIP cluster
        for p in members:
            sharp, rej = qinfo(p)
            # find original phash record for extra metadata stability
            # rep_phash_records aligns with rep_paths order
            ph_rec = rep_phash_records[rep_paths.index(p)]
            out.append(
                {
                    "path": ph_rec["path"],
                    "phash": ph_rec["phash"],
                    "group_id": ph_rec["group_id"],  # pHash group id (usually singleton)
                    "clip_group_id": clip_group_id,
                    "representative": bool(p in keep),
                    "sharp_vlap": sharp if sharp else None,
                    "rejected": rej,
                    "stage": "phash+clip",
                }
            )

        clip_group_id += 1

    return out


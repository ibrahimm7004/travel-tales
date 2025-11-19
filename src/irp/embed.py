from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

import json
import numpy as np
from PIL import Image


@dataclass(frozen=True)
class EmbedConfig:
    model_name: str = "ViT-B-32"          # OpenCLIP model name
    pretrained: str = "openai"            # weights tag
    device: str = "cpu"                   # "cuda" if available/desired
    batch_size: int = 16


def _load_model(cfg: EmbedConfig):
    # Heavy imports moved here to avoid import-time failures when NumPy/Torch mismatch exists.
    import torch
    import open_clip

    dev = torch.device(cfg.device)
    model, _, preprocess = open_clip.create_model_and_transforms(
        cfg.model_name, pretrained=cfg.pretrained, device=dev)
    model.eval()
    return model, preprocess, dev


def compute_embeddings(
    paths: List[Path],
    cfg: EmbedConfig,
) -> Tuple[np.ndarray, list[str], dict]:
    import torch

    model, preprocess, dev = _load_model(cfg)
    embs: List[np.ndarray] = []
    ids: List[str] = []
    with torch.no_grad():
        for i in range(0, len(paths), cfg.batch_size):
            batch = paths[i:i+cfg.batch_size]
            ims = []
            for p in batch:
                with Image.open(p) as im:
                    ims.append(preprocess(im.convert("RGB")))
            x = torch.stack(ims).to(dev)
            feats = model.encode_image(x)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            embs.append(feats.cpu().numpy())
            ids.extend([str(p.as_posix()) for p in batch])
    emb = np.concatenate(embs, axis=0) if embs else np.zeros(
        (0, 512), dtype=np.float32)
    meta = {"model_name": cfg.model_name, "pretrained": cfg.pretrained,
            "dim": int(emb.shape[1] if emb.size else 512)}
    return emb.astype(np.float32), ids, meta


def write_embedding_artifacts(out_dir: Path, emb: np.ndarray, ids: list[str], meta: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    np.save(out_dir / "embeddings.npy", emb)
    with (out_dir / "ids.json").open("w", encoding="utf-8") as f:
        json.dump(ids, f, ensure_ascii=False, indent=2)
    with (out_dir / "meta.json").open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

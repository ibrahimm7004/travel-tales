from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

FIXED_TAGS: List[str] = [
    "Classic & Timeless",
    "Lively & Spontaneous",
    "Artistic Eye",
    "Elegant Portrait",
]

TEXT_TEMPLATES: Tuple[str, str] = (
    "a travel photo with a {tag} vibe",
    "{tag} travel photography aesthetic",
)

STYLE_SHORT: Dict[str, str] = {
    "Classic & Timeless": "Classic",
    "Lively & Spontaneous": "Lively",
    "Artistic Eye": "Artistic",
    "Elegant Portrait": "Elegant",
}

MOOD_CORE_NOUN: Dict[str, str] = {
    "Elegant Portrait": "portraits",
    "Artistic Eye": "artistic shots",
    "Lively & Spontaneous": "candid moments",
    "Classic & Timeless": "classic scenes",
}

DESCRIPTOR_BANK: List[dict] = [
    {"label": "indoor", "prompt": "a photo taken indoors", "group": "environment"},
    {"label": "outdoor", "prompt": "a photo taken outdoors", "group": "environment"},
    {"label": "close-up", "prompt": "a close-up portrait photo", "group": "framing"},
    {"label": "half-body", "prompt": "a half-body portrait photo", "group": "framing"},
    {"label": "full-body", "prompt": "a full-body portrait photo", "group": "framing"},
    {"label": "solo person", "prompt": "a photo of one person", "group": "people"},
    {"label": "group", "prompt": "a group of people in a photo", "group": "people"},
    {"label": "nature", "prompt": "a photo in nature", "group": "scene_type"},
    {"label": "city street", "prompt": "a city street photo", "group": "scene_type"},
    {"label": "architecture", "prompt": "a photo of architecture", "group": "scene_type"},
    {"label": "food", "prompt": "a food photo", "group": "scene_type"},
    {"label": "animals", "prompt": "an animal photo", "group": "scene_type"},
    {"label": "daytime", "prompt": "a daytime photo", "group": "time"},
    {"label": "night", "prompt": "a night photo", "group": "time"},
    {"label": "warm lighting", "prompt": "a photo with warm lighting", "group": "lighting"},
    {"label": "cool lighting", "prompt": "a photo with cool lighting", "group": "lighting"},
    {"label": "candid", "prompt": "a candid photo", "group": "pose"},
    {"label": "posed", "prompt": "a posed photo", "group": "pose"},
]


def _debug(enabled: bool, msg: str) -> None:
    if enabled:
        print(f"[STEP_B][debug] {msg}")


def _l2norm(x: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(x, axis=1, keepdims=True) + 1e-12
    return (x / n).astype(np.float32)


def _load_images_from_reduced_pool(step_a_out: Path) -> List[Path]:
    reduced = step_a_out / "reduced_pool"
    if not reduced.exists() or not reduced.is_dir():
        raise SystemExit(f"[STEP_B] Missing reduced pool: {reduced.as_posix()}")
    exts = {".jpg", ".jpeg", ".png", ".webp", ".heic"}
    return sorted([p for p in reduced.rglob("*") if p.is_file() and p.suffix.lower() in exts])


def _parse_styles(styles_arg: str) -> List[str]:
    styles = [s.strip() for s in styles_arg.split("|") if s.strip()]
    if not styles:
        raise SystemExit("[STEP_B] --styles must include 1 or 2 tags separated by '|'")
    if len(styles) > 2:
        raise SystemExit("[STEP_B] You can select at most 2 styles")
    invalid = [s for s in styles if s not in FIXED_TAGS]
    if invalid:
        raise SystemExit(f"[STEP_B] Invalid styles: {invalid}. Allowed: {FIXED_TAGS}")
    return styles


def _parse_clip_model(value: str) -> Tuple[str, str]:
    if ":" in value:
        model_name, pretrained = value.split(":", 1)
        model_name = model_name.strip()
        pretrained = pretrained.strip()
        if model_name and pretrained:
            return model_name, pretrained
    return value.strip(), "openai"


def _paths_index_to_relative(step_a_out: Path, image_paths: Sequence[Path]) -> List[str]:
    return [p.relative_to(step_a_out).as_posix() for p in image_paths]


def _save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)


def _load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_jsonl(rows: Iterable[dict], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def _compute_dino_embeddings(
    image_paths: Sequence[Path],
    model_name: str,
    batch_size: int,
    device: str,
) -> np.ndarray:
    try:
        import torch
        from transformers import AutoImageProcessor, AutoModel
    except Exception as e:
        raise ImportError(
            "DINO dependencies missing. Install with: pip install transformers torch torchvision"
        ) from e

    torch.manual_seed(0)
    np.random.seed(0)

    try:
        processor = AutoImageProcessor.from_pretrained(model_name)
        model = AutoModel.from_pretrained(model_name)
    except Exception as e:
        raise ImportError(
            "Unable to load DINO model. Ensure internet access or a local HF cache is available, "
            "and install compatible versions: pip install transformers torch torchvision"
        ) from e
    model.to(device)
    model.eval()

    embs: List[np.ndarray] = []
    bs = max(1, int(batch_size))

    with torch.no_grad():
        for i in range(0, len(image_paths), bs):
            batch = image_paths[i : i + bs]
            imgs = [Image.open(p).convert("RGB") for p in batch]
            inputs = processor(images=imgs, return_tensors="pt")
            inputs = {k: v.to(device) for k, v in inputs.items()}
            out = model(**inputs)
            if not hasattr(out, "last_hidden_state"):
                raise RuntimeError("DINO model output missing last_hidden_state")
            cls = out.last_hidden_state[:, 0, :]
            embs.append(cls.cpu().numpy().astype(np.float32))
            for im in imgs:
                im.close()

    return _l2norm(np.concatenate(embs, axis=0) if embs else np.zeros((0, 1), dtype=np.float32))


def _compute_clip_image_embeddings(
    image_paths: Sequence[Path],
    model_name: str,
    pretrained: str,
    batch_size: int,
    device: str,
) -> np.ndarray:
    try:
        import torch
        import open_clip
    except Exception as e:
        raise ImportError(
            "CLIP dependencies missing. Install with: pip install open-clip-torch torch torchvision"
        ) from e

    torch.manual_seed(0)
    np.random.seed(0)

    try:
        model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=pretrained, device=device)
    except Exception as e:
        raise ImportError(
            "Unable to load CLIP model weights. Ensure internet access or local cache is available, "
            "and install: pip install open-clip-torch torch torchvision"
        ) from e
    model.eval()

    bs = max(1, int(batch_size))
    embs: List[np.ndarray] = []

    with torch.no_grad():
        for i in range(0, len(image_paths), bs):
            batch = image_paths[i : i + bs]
            imgs = []
            for p in batch:
                with Image.open(p) as im:
                    imgs.append(preprocess(im.convert("RGB")))
            t = torch.stack(imgs).to(device)
            feats = model.encode_image(t)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            embs.append(feats.cpu().numpy().astype(np.float32))

    return np.concatenate(embs, axis=0) if embs else np.zeros((0, 512), dtype=np.float32)


def _compute_clip_text_embeddings(
    tags: Sequence[str],
    model,
    tokenizer,
    device: str,
) -> np.ndarray:
    try:
        import torch
    except Exception as e:
        raise ImportError(
            "CLIP dependencies missing. Install with: pip install open-clip-torch torch torchvision"
        ) from e

    out_rows: List[np.ndarray] = []
    with torch.no_grad():
        for tag in tags:
            prompts = [tmpl.format(tag=tag) for tmpl in TEXT_TEMPLATES]
            toks = tokenizer(prompts).to(device)
            txt = model.encode_text(toks)
            txt = txt / txt.norm(dim=-1, keepdim=True)
            avg = txt.mean(dim=0, keepdim=True)
            avg = avg / avg.norm(dim=-1, keepdim=True)
            out_rows.append(avg.cpu().numpy().astype(np.float32)[0])

    return np.stack(out_rows, axis=0).astype(np.float32)


def _compute_clip_prompt_embeddings(
    prompts: Sequence[str],
    model,
    tokenizer,
    device: str,
) -> np.ndarray:
    try:
        import torch
    except Exception as e:
        raise ImportError(
            "CLIP dependencies missing. Install with: pip install open-clip-torch torch torchvision"
        ) from e

    with torch.no_grad():
        toks = tokenizer(list(prompts)).to(device)
        txt = model.encode_text(toks)
        txt = txt / txt.norm(dim=-1, keepdim=True)
        return txt.cpu().numpy().astype(np.float32)


def _load_clip_model(model_name: str, pretrained: str, device: str):
    try:
        import torch
        import open_clip
    except Exception as e:
        raise ImportError(
            "CLIP dependencies missing. Install with: pip install open-clip-torch torch torchvision"
        ) from e

    torch.manual_seed(0)
    np.random.seed(0)

    try:
        model, _, _ = open_clip.create_model_and_transforms(model_name, pretrained=pretrained, device=device)
    except Exception as e:
        raise ImportError(
            "Unable to load CLIP model weights. Ensure internet access or local cache is available, "
            "and install: pip install open-clip-torch torch torchvision"
        ) from e
    tokenizer = open_clip.get_tokenizer(model_name)
    model.eval()
    return model, tokenizer


def _selected_pref_prefix(selected_styles: Sequence[str]) -> str:
    if not selected_styles:
        return ""
    if len(selected_styles) == 1:
        return STYLE_SHORT.get(selected_styles[0], selected_styles[0])
    left = STYLE_SHORT.get(selected_styles[0], selected_styles[0])
    right = STYLE_SHORT.get(selected_styles[1], selected_styles[1])
    return f"{left}/{right}"


def _select_cluster_descriptors(
    desc_mean_scores: np.ndarray,
    descriptor_bank: Sequence[dict],
    top_k: int,
) -> List[dict]:
    ranked = [(i, float(desc_mean_scores[i])) for i in range(len(descriptor_bank))]
    ranked.sort(key=lambda x: (-x[1], str(descriptor_bank[x[0]]["label"])))

    selected: List[dict] = []
    used_groups: set[str] = set()
    for idx, score in ranked:
        d = descriptor_bank[idx]
        group = str(d.get("group") or "")
        if group and group in used_groups:
            continue
        selected.append({"label": str(d["label"]), "score": score, "group": group})
        if group:
            used_groups.add(group)
        if len(selected) >= top_k:
            break
    return selected


def _compose_cluster_name(prefix: str, descriptors: Sequence[str], mood_label: str) -> str:
    core = MOOD_CORE_NOUN.get(mood_label, "photos")
    parts: List[str] = []
    if prefix:
        parts.append(prefix)
    parts.extend([d for d in descriptors if d])
    parts.append(core)
    return " ".join(parts).strip()


def _load_quality_map(step_a_out: Path) -> Dict[str, dict]:
    qmap: Dict[str, dict] = {}

    qpath = step_a_out / "quality.jsonl"
    if qpath.exists():
        for line in qpath.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            raw = rec.get("path")
            if isinstance(raw, str):
                qmap[Path(raw).as_posix()] = rec
                try:
                    qmap[Path(raw).resolve().as_posix()] = rec
                except Exception:
                    pass

    mpath = step_a_out / "step_a_manifest.jsonl"
    if mpath.exists():
        for line in mpath.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except Exception:
                continue
            primary = rec.get("primary") or {}
            members = rec.get("members_ranked") or []
            if not primary:
                continue
            exp = primary.get("export_path")
            if not isinstance(exp, str):
                continue
            q = None
            if members and isinstance(members, list):
                m0 = members[0]
                if isinstance(m0, dict):
                    q = m0.get("quality")
            if isinstance(q, dict):
                qmap[Path(exp).as_posix()] = q
                qmap[(step_a_out / exp).resolve().as_posix()] = q

    return qmap


def _quality_subset(q: dict | None) -> dict | None:
    if not q:
        return None
    out: dict = {}
    for k in ["sharp_vlap", "blurry", "underexposed", "overexposed", "exp_mean"]:
        if k in q:
            out[k] = q[k]
    return out if out else None


def _get_quality_for_path(rel_path: str, abs_path: Path, qmap: Dict[str, dict]) -> dict | None:
    if not qmap:
        return None
    if rel_path in qmap:
        return qmap[rel_path]
    ap = abs_path.as_posix()
    if ap in qmap:
        return qmap[ap]
    return None


def _style_scores_topk(scores_row: np.ndarray, tags: Sequence[str], k: int = 4) -> List[dict]:
    items = [(tags[i], float(scores_row[i])) for i in range(len(tags))]
    items.sort(key=lambda x: (-x[1], x[0]))
    return [{"tag": t, "score": s} for t, s in items[:k]]


def _default_k(n_images: int) -> int:
    return min(24, max(6, int(round(math.sqrt(n_images)))))


def main() -> int:
    ap = argparse.ArgumentParser(description="Step B runner: DINO clusters + CLIP naming/ranking")
    ap.add_argument("--step-a-out", type=Path, required=True, help="Step A output dir containing reduced_pool")
    ap.add_argument("--out", type=Path, required=True, help="Step B output directory")
    ap.add_argument("--k", type=int, default=None, help="Number of k-means clusters")
    ap.add_argument("--styles", type=str, required=True, help="1-2 tags separated by |")
    ap.add_argument("--phase", choices=["dino_only", "full"], default="full", help="Phase mode")
    ap.add_argument("--clip-model", type=str, default="ViT-B-32:openai", help="OpenCLIP model[:pretrained]")
    ap.add_argument("--dino-model", type=str, default="facebook/dinov2-small", help="HF DINOv2 model")
    ap.add_argument("--batch-size", type=int, default=8, help="Batch size")
    ap.add_argument("--recompute", action="store_true", help="Recompute embeddings and ignore cache")
    ap.add_argument("--print-summary", action="store_true", help="Print summary")
    ap.add_argument("--debug", action="store_true", help="Debug logs")
    args = ap.parse_args()

    step_a_out = args.step_a_out
    out_dir = args.out
    cache_dir = out_dir / "cache"
    cache_dir.mkdir(parents=True, exist_ok=True)

    selected_styles = _parse_styles(args.styles)
    image_paths = _load_images_from_reduced_pool(step_a_out)
    if not image_paths:
        raise SystemExit("[STEP_B] reduced_pool has no images")

    rel_paths = _paths_index_to_relative(step_a_out, image_paths)
    n = len(rel_paths)

    k = args.k if args.k is not None else _default_k(n)
    k = max(1, min(int(k), n))

    clip_model_name, clip_pretrained = _parse_clip_model(args.clip_model)
    device = "cpu"

    idx_path = cache_dir / "paths_index.json"
    meta_path = cache_dir / "meta.json"
    dino_cache = cache_dir / "dino_embeddings.npy"
    clip_img_cache = cache_dir / "clip_image_embeddings.npy"
    clip_txt_cache = cache_dir / "clip_text_embeddings.npy"
    clip_txt_meta = cache_dir / "clip_text_meta.json"
    clip_desc_txt_cache = cache_dir / "clip_desc_text_embeddings.npy"
    clip_desc_meta = cache_dir / "clip_desc_meta.json"
    descriptor_prompts = [str(d["prompt"]) for d in DESCRIPTOR_BANK]

    base_cache_ok = False
    if not args.recompute and idx_path.exists() and meta_path.exists():
        try:
            idx_payload = _load_json(idx_path)
            meta = _load_json(meta_path)
            base_cache_ok = (
                idx_payload.get("paths") == rel_paths
                and meta.get("dino_model") == args.dino_model
                and meta.get("clip_model") == clip_model_name
                and meta.get("clip_pretrained") == clip_pretrained
            )
        except Exception:
            base_cache_ok = False

    dino_cache_ok = base_cache_ok and dino_cache.exists()
    if dino_cache_ok:
        _debug(args.debug, "using cached DINO embeddings")
        dino_emb = np.load(dino_cache)
    else:
        try:
            _debug(args.debug, "computing DINO embeddings")
            dino_emb = _compute_dino_embeddings(image_paths, args.dino_model, args.batch_size, device)
        except ImportError as e:
            raise SystemExit(f"[STEP_B] {e}") from e
        np.save(dino_cache, dino_emb.astype(np.float32))
        _save_json(idx_path, {"paths": rel_paths})
        _save_json(
            meta_path,
            {
                "dino_model": args.dino_model,
                "clip_model": clip_model_name,
                "clip_pretrained": clip_pretrained,
            },
        )

    if len(dino_emb) != n:
        raise RuntimeError("Cached DINO embeddings shape mismatch with current reduced_pool paths")

    # KMeans clustering on DINO embeddings.
    kmeans = KMeans(n_clusters=k, random_state=0, n_init=10, init="k-means++")
    labels = kmeans.fit_predict(dino_emb)
    kmeans_dists = np.linalg.norm(dino_emb - kmeans.cluster_centers_[labels], axis=1).astype(np.float32)
    if args.debug:
        np.save(out_dir / "debug_kmeans_centroids.npy", kmeans.cluster_centers_.astype(np.float32))

    if args.phase == "dino_only":
        cluster_to_indices_dino: Dict[int, List[int]] = {}
        for i, cid in enumerate(labels.tolist()):
            cluster_to_indices_dino.setdefault(int(cid), []).append(i)
        for cid in cluster_to_indices_dino:
            cluster_to_indices_dino[cid].sort(key=lambda i: rel_paths[i])

        kmeans_rows: List[dict] = []
        kmeans_cluster_rows: List[dict] = []
        for cid in sorted(cluster_to_indices_dino):
            idxs = cluster_to_indices_dino[cid]
            for i in idxs:
                kmeans_rows.append(
                    {
                        "path": rel_paths[i],
                        "cluster_id": int(cid),
                        "kmeans_dist": float(kmeans_dists[i]),
                    }
                )
            kmeans_cluster_rows.append(
                {
                    "cluster_id": int(cid),
                    "size": int(len(idxs)),
                    "representatives": [rel_paths[i] for i in idxs[:6]],
                }
            )
        kmeans_rows.sort(key=lambda r: (r["cluster_id"], r["path"]))
        kmeans_cluster_rows.sort(key=lambda r: r["cluster_id"])
        kmeans_out = out_dir / "step_b_kmeans.jsonl"
        kmeans_clusters_out = out_dir / "step_b_kmeans_clusters.jsonl"
        _write_jsonl(kmeans_rows, kmeans_out)
        _write_jsonl(kmeans_cluster_rows, kmeans_clusters_out)
        if args.print_summary:
            sizes = [(r["cluster_id"], r["size"]) for r in kmeans_cluster_rows]
            print(f"[STEP_B] phase=dino_only images={n} clusters={k}")
            print(f"[STEP_B] cluster_sizes={sizes}")
            print(f"[STEP_B] wrote_kmeans={kmeans_out.as_posix()}")
            print(f"[STEP_B] wrote_kmeans_clusters={kmeans_clusters_out.as_posix()}")
            print(f"[STEP_B] cache_dir={cache_dir.as_posix()}")
        return 0

    clip_img_cache_ok = base_cache_ok and clip_img_cache.exists()
    if clip_img_cache_ok:
        _debug(args.debug, "using cached CLIP image embeddings")
        clip_img_emb = np.load(clip_img_cache)
    else:
        try:
            _debug(args.debug, "computing CLIP image embeddings")
            clip_img_emb = _compute_clip_image_embeddings(
                image_paths, clip_model_name, clip_pretrained, args.batch_size, device
            )
        except ImportError as e:
            raise SystemExit(f"[STEP_B] {e}") from e
        np.save(clip_img_cache, clip_img_emb.astype(np.float32))

    if len(clip_img_emb) != n:
        raise RuntimeError("Cached CLIP image embeddings shape mismatch with current reduced_pool paths")

    clip_text_cache_ok = (
        base_cache_ok
        and clip_txt_cache.exists()
        and clip_txt_meta.exists()
    )
    if clip_text_cache_ok:
        try:
            txt_meta = _load_json(clip_txt_meta)
            clip_text_cache_ok = (
                txt_meta.get("tags") == FIXED_TAGS
                and txt_meta.get("templates") == list(TEXT_TEMPLATES)
            )
        except Exception:
            clip_text_cache_ok = False

    clip_desc_cache_ok = (
        base_cache_ok
        and clip_desc_txt_cache.exists()
        and clip_desc_meta.exists()
    )
    if clip_desc_cache_ok:
        try:
            desc_meta = _load_json(clip_desc_meta)
            clip_desc_cache_ok = desc_meta.get("descriptors") == DESCRIPTOR_BANK
        except Exception:
            clip_desc_cache_ok = False

    clip_text_model = None
    clip_tokenizer = None
    if clip_text_cache_ok:
        _debug(args.debug, "using cached CLIP text embeddings")
        clip_text_emb = np.load(clip_txt_cache)
    else:
        if clip_text_model is None or clip_tokenizer is None:
            _debug(args.debug, "loading CLIP model/tokenizer for text encoders")
            clip_text_model, clip_tokenizer = _load_clip_model(clip_model_name, clip_pretrained, device)
        _debug(args.debug, "computing CLIP text embeddings")
        clip_text_emb = _compute_clip_text_embeddings(FIXED_TAGS, clip_text_model, clip_tokenizer, device)
        np.save(clip_txt_cache, clip_text_emb.astype(np.float32))
        _save_json(clip_txt_meta, {"tags": FIXED_TAGS, "templates": list(TEXT_TEMPLATES)})

    if clip_desc_cache_ok:
        _debug(args.debug, "using cached CLIP descriptor text embeddings")
        clip_desc_text_emb = np.load(clip_desc_txt_cache)
    else:
        if clip_text_model is None or clip_tokenizer is None:
            _debug(args.debug, "loading CLIP model/tokenizer for descriptor encoders")
            clip_text_model, clip_tokenizer = _load_clip_model(clip_model_name, clip_pretrained, device)
        _debug(args.debug, "computing CLIP descriptor text embeddings")
        clip_desc_text_emb = _compute_clip_prompt_embeddings(
            descriptor_prompts, clip_text_model, clip_tokenizer, device
        )
        np.save(clip_desc_txt_cache, clip_desc_text_emb.astype(np.float32))
        _save_json(clip_desc_meta, {"descriptors": DESCRIPTOR_BANK})

    scores_all = (clip_img_emb @ clip_text_emb.T).astype(np.float32)
    scores_desc_all = (clip_img_emb @ clip_desc_text_emb.T).astype(np.float32)

    selected_tags = list(selected_styles)
    pref_prefix = _selected_pref_prefix(selected_tags)
    pref_scores = np.empty((n,), dtype=np.float32)
    for i in range(n):
        row_scores = scores_all[i]
        score_map = {FIXED_TAGS[j]: float(row_scores[j]) for j in range(len(FIXED_TAGS))}
        selected_scores = [score_map[tag] for tag in selected_tags]
        pref_scores[i] = float(max(selected_scores))
        if args.debug and i == 0:
            print(
                f"[STEP_B][debug] selected_tags={selected_tags} "
                f"first_selected_scores={selected_scores} first_pref_score={float(pref_scores[i])}"
            )

    qmap = _load_quality_map(step_a_out)

    cluster_to_indices: Dict[int, List[int]] = {}
    for i, cid in enumerate(labels.tolist()):
        cluster_to_indices.setdefault(int(cid), []).append(i)

    for cid in cluster_to_indices:
        cluster_to_indices[cid].sort(key=lambda i: rel_paths[i])

    image_rows: List[dict] = []
    cluster_rows: List[dict] = []
    used_cluster_names: set[str] = set()

    for cid in sorted(cluster_to_indices):
        idxs = cluster_to_indices[cid]

        style_means = scores_all[idxs].mean(axis=0)
        style_items = [(FIXED_TAGS[i], float(style_means[i])) for i in range(len(FIXED_TAGS))]
        style_items.sort(key=lambda x: (-x[1], x[0]))
        mood_label = style_items[0][0]

        desc_means = scores_desc_all[idxs].mean(axis=0)
        desc_topk = _select_cluster_descriptors(desc_means, DESCRIPTOR_BANK, top_k=3)
        desc_labels = [str(d["label"]) for d in desc_topk]
        cluster_name = _compose_cluster_name(pref_prefix, desc_labels[:2], mood_label)
        if cluster_name in used_cluster_names and len(desc_labels) >= 3:
            cluster_name = _compose_cluster_name(pref_prefix, desc_labels[:3], mood_label)
        if cluster_name in used_cluster_names:
            cluster_name = f"{cluster_name} #{cid}"
        used_cluster_names.add(cluster_name)

        cluster_pref_vals = sorted([float(pref_scores[i]) for i in idxs], reverse=True)
        topn = cluster_pref_vals[:5] if len(cluster_pref_vals) >= 5 else cluster_pref_vals
        cluster_pref_score = float(np.mean(topn)) if topn else float("-inf")

        def rank_key(i: int) -> tuple:
            rel = rel_paths[i]
            abs_p = step_a_out / rel
            q = _get_quality_for_path(rel, abs_p, qmap)
            try:
                sharp = float((q or {}).get("sharp_vlap"))
            except Exception:
                sharp = float("-inf")
            if not np.isfinite(sharp):
                sharp = float("-inf")
            return (-float(pref_scores[i]), -sharp, rel)

        ranked = sorted(idxs, key=rank_key)

        for rnk, i in enumerate(ranked, start=1):
            rel = rel_paths[i]
            abs_p = step_a_out / rel
            q = _quality_subset(_get_quality_for_path(rel, abs_p, qmap))
            image_rows.append(
                {
                    "path": rel,
                    "cluster_id": int(cid),
                    "styles_topk": _style_scores_topk(scores_all[i], FIXED_TAGS, k=4),
                    "pref_score": float(pref_scores[i]),
                    "kmeans_dist": float(kmeans_dists[i]),
                    "rank_in_cluster": int(rnk),
                    "quality": q,
                }
            )

        reps = [rel_paths[i] for i in ranked[:6]]
        cluster_rows.append(
            {
                "cluster_id": int(cid),
                "size": int(len(idxs)),
                "cluster_name": cluster_name,
                "mood_label": mood_label,
                "cluster_style_scores": [{"tag": t, "score": s} for t, s in style_items],
                "cluster_desc_topk": [{"label": d["label"], "score": d["score"]} for d in desc_topk],
                "cluster_pref_score": cluster_pref_score,
                "representatives": reps,
            }
        )

    image_rows.sort(key=lambda r: (r["cluster_id"], r["rank_in_cluster"], r["path"]))
    cluster_rows.sort(key=lambda r: r["cluster_id"])

    images_out = out_dir / "step_b_images.jsonl"
    clusters_out = out_dir / "step_b_clusters.jsonl"
    _write_jsonl(image_rows, images_out)
    _write_jsonl(cluster_rows, clusters_out)

    if args.print_summary:
        sizes = [(r["cluster_id"], r["size"]) for r in cluster_rows]
        print(f"[STEP_B] images={n} clusters={k} styles={selected_styles}")
        print(f"[STEP_B] cluster_sizes={sizes}")
        for r in cluster_rows:
            print(f"[STEP_B] cluster={r['cluster_id']} top3={r['representatives'][:3]}")
        print(f"[STEP_B] wrote_images={images_out.as_posix()}")
        print(f"[STEP_B] wrote_clusters={clusters_out.as_posix()}")
        print(f"[STEP_B] cache_dir={cache_dir.as_posix()}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

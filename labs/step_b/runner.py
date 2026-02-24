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
    model_name: str,
    pretrained: str,
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
        model, _, _ = open_clip.create_model_and_transforms(model_name, pretrained=pretrained, device=device)
    except Exception as e:
        raise ImportError(
            "Unable to load CLIP model weights. Ensure internet access or local cache is available, "
            "and install: pip install open-clip-torch torch torchvision"
        ) from e
    tokenizer = open_clip.get_tokenizer(model_name)
    model.eval()

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

    cache_ok = False
    if (
        not args.recompute
        and idx_path.exists()
        and meta_path.exists()
        and dino_cache.exists()
        and clip_img_cache.exists()
        and clip_txt_cache.exists()
        and clip_txt_meta.exists()
    ):
        try:
            idx_payload = _load_json(idx_path)
            meta = _load_json(meta_path)
            txt_meta = _load_json(clip_txt_meta)
            cache_ok = (
                idx_payload.get("paths") == rel_paths
                and meta.get("dino_model") == args.dino_model
                and meta.get("clip_model") == clip_model_name
                and meta.get("clip_pretrained") == clip_pretrained
                and txt_meta.get("tags") == FIXED_TAGS
                and txt_meta.get("templates") == list(TEXT_TEMPLATES)
            )
        except Exception:
            cache_ok = False

    if cache_ok:
        _debug(args.debug, "using cached embeddings")
        dino_emb = np.load(dino_cache)
        clip_img_emb = np.load(clip_img_cache)
        clip_text_emb = np.load(clip_txt_cache)
    else:
        try:
            _debug(args.debug, "computing DINO embeddings")
            dino_emb = _compute_dino_embeddings(image_paths, args.dino_model, args.batch_size, device)
            _debug(args.debug, "computing CLIP image embeddings")
            clip_img_emb = _compute_clip_image_embeddings(
                image_paths, clip_model_name, clip_pretrained, args.batch_size, device
            )
            _debug(args.debug, "computing CLIP text embeddings")
            clip_text_emb = _compute_clip_text_embeddings(FIXED_TAGS, clip_model_name, clip_pretrained, device)
        except ImportError as e:
            raise SystemExit(f"[STEP_B] {e}") from e

        np.save(dino_cache, dino_emb.astype(np.float32))
        np.save(clip_img_cache, clip_img_emb.astype(np.float32))
        np.save(clip_txt_cache, clip_text_emb.astype(np.float32))
        _save_json(idx_path, {"paths": rel_paths})
        _save_json(
            meta_path,
            {
                "dino_model": args.dino_model,
                "clip_model": clip_model_name,
                "clip_pretrained": clip_pretrained,
            },
        )
        _save_json(clip_txt_meta, {"tags": FIXED_TAGS, "templates": list(TEXT_TEMPLATES)})

    if len(dino_emb) != n or len(clip_img_emb) != n:
        raise RuntimeError("Cached embeddings shape mismatch with current reduced_pool paths")

    # KMeans clustering on DINO embeddings.
    kmeans = KMeans(n_clusters=k, random_state=0, n_init=10, init="k-means++")
    labels = kmeans.fit_predict(dino_emb)
    if args.debug:
        np.save(out_dir / "debug_kmeans_centroids.npy", kmeans.cluster_centers_.astype(np.float32))

    scores_all = (clip_img_emb @ clip_text_emb.T).astype(np.float32)

    selected_tags = list(selected_styles)
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

    for cid in sorted(cluster_to_indices):
        idxs = cluster_to_indices[cid]

        style_means = scores_all[idxs].mean(axis=0)
        style_items = [(FIXED_TAGS[i], float(style_means[i])) for i in range(len(FIXED_TAGS))]
        style_items.sort(key=lambda x: (-x[1], x[0]))
        cluster_name = style_items[0][0]

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
                "cluster_style_scores": [{"tag": t, "score": s} for t, s in style_items],
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

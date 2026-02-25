from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import click
from tqdm import tqdm

from .config import RunConfig
from .io import scan_images, load_image_basic, write_jsonl
from .quality import (
    QualityConfig,
    assess_quality,
    DEFAULT_BLUR_VLAP_TH,
    DEFAULT_UNDER_PCT_TH,
    DEFAULT_OVER_PCT_TH,
)
from .dedupe import compute_phash_hex, build_dedupe_records
from .diversity import dominant_colors_hex, image_entropy

try:
    from .prune import prune_nonreps as prune_nonreps_fn
    from .prune import prune_rejects as prune_rejects_fn
except ModuleNotFoundError:
    prune_nonreps_fn = None  # type: ignore[assignment]
    prune_rejects_fn = None  # type: ignore[assignment]


def _process_paths(paths, max_workers, fn):
    if max_workers <= 1:
        return [fn(p) for p in tqdm(paths, desc="processing", unit="img")]
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        return list(tqdm(ex.map(fn, paths), total=len(paths), desc="processing", unit="img"))


@click.command(name="run")
@click.option("--in",  "in_dir",  type=click.Path(path_type=Path, exists=True, file_okay=False), required=True)
@click.option("--out", "out_dir", type=click.Path(path_type=Path, file_okay=False), required=True)
# kept for compatibility; not used by ranking anymore
@click.option("--target", type=int, required=True)
@click.option("--max-workers", type=int, default=4, show_default=True)
# Quality
@click.option("--do-quality", is_flag=True, help="Compute blur/exposure metrics -> out/quality.jsonl")
@click.option("--blur-th",   type=float, default=DEFAULT_BLUR_VLAP_TH, show_default=True)
@click.option("--under-low", type=float, default=DEFAULT_UNDER_PCT_TH, show_default=True)
@click.option("--over-high", type=float, default=DEFAULT_OVER_PCT_TH, show_default=True)
# Dedupe
@click.option("--do-dedupe", is_flag=True, help="Group near-duplicates -> out/dedupe.jsonl")
@click.option("--phash-th", type=int, default=6, show_default=True)
# Prune (new)
@click.option("--prune-nonreps", is_flag=True, help="After dedupe, remove non-representatives (DANGEROUS).")
@click.option("--prune-mode", type=click.Choice(["delete", "move"]), default="delete", show_default=True)
@click.option("--prune-move-dir", type=click.Path(path_type=Path, file_okay=False), default=None, help="If --prune-mode=move, destination folder.")
# Embeddings (kept; independent of ranking)
@click.option("--do-embed", is_flag=True, help="Compute OpenCLIP embeddings -> out/embed/")
@click.option("--embed-model", default="ViT-B-32", show_default=True)
@click.option("--embed-pretrained", default="openai", show_default=True)
@click.option("--embed-batch", type=int, default=16, show_default=True)
# Diversity (kept)
@click.option("--do-diversity", is_flag=True, help="Compute dominant colors + entropy -> out/diversity.jsonl")
def run(
    in_dir: Path, out_dir: Path, target: int, max_workers: int,
    do_quality: bool, blur_th: float, under_low: float, over_high: float,
    do_dedupe: bool, phash_th: int,
    prune_nonreps: bool, prune_mode: str, prune_move_dir: Path | None,
    do_embed: bool, embed_model: str, embed_pretrained: str, embed_batch: int,
    do_diversity: bool,
) -> None:
    """
    Simplified pipeline:
      1) manifest
      2) (optional) quality
      3) (optional) dedupe
      4) (optional) prune non-representatives [delete/move]
      5) (optional) embeddings
      6) (optional) diversity
    """
    cfg = RunConfig(in_dir=in_dir, out_dir=out_dir,
                    target=target, max_workers=max_workers)

    paths = scan_images(cfg.in_dir)
    if not paths:
        click.echo("No images found.")
        return

    # 1) Manifest (Tier 0; EXIF skipped)
    def _rec(p: Path) -> dict:
        w, h = load_image_basic(p)
        return {"id": uuid.uuid4().hex, "path": str(p.as_posix()), "ts": None, "gps": None, "orientation": None, "camera": None, "w": w, "h": h}
    write_jsonl([_rec(p) for p in paths], cfg.out_dir / "manifest.jsonl")
    click.echo(
        f"Manifest written for {len(paths)} images (Tier 0 only; EXIF skipped).")

    # 2) Quality
    if do_quality:
        qcfg = QualityConfig(blur_vlap_th=blur_th,
                             under_pct_th=under_low, over_pct_th=over_high)
        qrecs = _process_paths(paths, cfg.max_workers,
                               lambda p: assess_quality(p, qcfg))
        write_jsonl(qrecs, cfg.out_dir / "quality.jsonl")
        blurry = sum(1 for r in qrecs if r.get("blurry"))
        under = sum(1 for r in qrecs if r.get("underexposed"))
        over = sum(1 for r in qrecs if r.get("overexposed"))
        click.echo(
            f"Quality written. Blurry: {blurry}, Underexposed: {under}, Overexposed: {over}.")

    # 3) Dedupe
    if do_dedupe:
        phashes = _process_paths(paths, cfg.max_workers, compute_phash_hex)
        dd = build_dedupe_records(paths, phashes, {}, th=phash_th)
        write_jsonl(dd, cfg.out_dir / "dedupe.jsonl")
        groups = len({r["group_id"] for r in dd})
        reps = sum(1 for r in dd if r["representative"])
        click.echo(
            f"Dedupe written. Groups: {groups}, Representatives kept: {reps}.")

        # 4) Prune (optional)
        if prune_nonreps:
            if prune_nonreps_fn is None:
                raise RuntimeError("Prune module not available in this build; this vendored snapshot excludes destructive pruning.")
            base = in_dir.resolve()
            movedir = prune_move_dir.resolve() if (
                prune_mode == "move" and prune_move_dir is not None) else None
            total, acted = prune_nonreps_fn(
                out_dir=cfg.out_dir, base_dir=base, mode=prune_mode, move_dir=movedir)
            click.echo(
                f"Prune completed. Non-reps found: {total}, {'moved' if prune_mode=='move' else 'deleted'}: {acted}.")

    # 5) Embeddings (still available)
    if do_embed:
        try:
            from .embed import EmbedConfig, compute_embeddings, write_embedding_artifacts
        except Exception as e:
            click.echo("Embeddings unavailable: " + str(e))
            raise
        emb_cfg = EmbedConfig(
            model_name=embed_model, pretrained=embed_pretrained, device="cpu", batch_size=embed_batch)
        emb, ids, meta = compute_embeddings(paths, emb_cfg)
        write_embedding_artifacts(cfg.out_dir / "embed", emb, ids, meta)
        click.echo(
            f"Embeddings written: {emb.shape[0]} vectors, dim={emb.shape[1]}.")

    # 6) Diversity
    if do_diversity:
        def _div(p: Path):
            return {"path": str(p.as_posix()), "dominant_colors": dominant_colors_hex(p, k=3), "entropy": image_entropy(p)}
        div = _process_paths(paths, cfg.max_workers, _div)
        write_jsonl(div, cfg.out_dir / "diversity.jsonl")
        click.echo(
            f"Diversity written for {len(div)} images (top-3 colors + entropy).")


if __name__ == "__main__":
    run()

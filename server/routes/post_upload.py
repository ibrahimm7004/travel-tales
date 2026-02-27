from __future__ import annotations

import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from botocore.exceptions import ClientError
from pydantic import BaseModel, Field

from pipeline_labs.shared.quality import QualityConfig, assess_quality
from server.s3_client import get_bucket, get_s3, is_mock_mode

router = APIRouter(prefix="/processing/post-upload", tags=["post-upload"])

JobState = Literal[
    "queued",
    "staging_inputs",
    "running_a",
    "done_a",
    "running_b_dino",
    "waiting_user_moods",
    "running_b_clip",
    "done_b",
    "error",
]

SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
APP_ROOT = Path(__file__).resolve().parents[2]
WORKSPACES_ROOT = (APP_ROOT / "server" / "workspaces").resolve()
VENDORED_PIPELINE_ROOT = (APP_ROOT / "pipeline_labs").resolve()
STATUS_FILE = "post_upload_status.json"
INPUTS_MANIFEST_FILE = "inputs_manifest.json"
STAGED_INPUTS_DIRNAME = "inputs"
LOGS_DIRNAME = "logs"
STEP_A_DIRNAME = "step_a"
STEP_B_DIRNAME = "step_b"
STEP_C_DIRNAME = "step_c"
STEP_C_STATE_FILE = "state.json"
STEP_C_RATIO_TEMPERATURE = 200.0
STEP_C_RATIO_BLEND_MATCHES = 4.0
SELECTED_MOODS_FILE = "selected_moods.json"
DEMO_ASSET_CACHE_DIRNAME = "_demo_asset_cache"
FIXED_MOODS = [
    "Classic & Timeless",
    "Lively & Spontaneous",
    "Artistic Eye",
    "Elegant Portrait",
]
STEP_B_DINO_PLACEHOLDER_STYLES = "Classic & Timeless|Lively & Spontaneous"

ACTIVE_JOBS: Dict[str, threading.Thread] = {}
ACTIVE_LOCK = threading.Lock()


class UploadedFile(BaseModel):
    key: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)


class StartPostUploadIn(BaseModel):
    albumId: str = Field(..., min_length=1)
    files: List[UploadedFile]
    force: bool = False


class SubmitMoodsIn(BaseModel):
    albumId: str = Field(..., min_length=1)
    moods: List[str]
    force: bool = False


class StepCChooseIn(BaseModel):
    albumId: str = Field(..., min_length=1)
    left_cluster_id: int
    right_cluster_id: int
    winner_cluster_id: int


class PostUploadStatusOut(BaseModel):
    albumId: str
    status: JobState
    progress: float = 0.0
    error: str | None = None
    error_log_excerpt: str | None = None
    workspace: str
    updatedAt: str
    counts: Dict[str, int] = Field(default_factory=dict)
    workspace_rel_paths: Dict[str, str] = Field(default_factory=dict)


def _debug_enabled() -> bool:
    return os.getenv("PIPELINE_DEBUG", "0") == "1"


def _debug(msg: str, **ctx: Any) -> None:
    if not _debug_enabled():
        return
    payload = f"[POST_UPLOAD] {msg}"
    if ctx:
        payload += f" {ctx}"
    print(payload, flush=True)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _workspace(album_id: str) -> Path:
    return WORKSPACES_ROOT / album_id


def _status_path(album_id: str) -> Path:
    return _workspace(album_id) / STATUS_FILE


def _workspace_rel(path: Path) -> str:
    return path.resolve().relative_to(APP_ROOT).as_posix()


def _workspace_paths(album_id: str) -> Dict[str, str]:
    workspace = _workspace(album_id)
    step_a_dir = workspace / STEP_A_DIRNAME
    step_b_dir = workspace / STEP_B_DIRNAME
    step_c_dir = workspace / STEP_C_DIRNAME
    return {
        "workspace": _workspace_rel(workspace),
        "inputs_dir": _workspace_rel(workspace / STAGED_INPUTS_DIRNAME),
        "inputs_manifest": _workspace_rel(workspace / INPUTS_MANIFEST_FILE),
        "logs_dir": _workspace_rel(workspace / LOGS_DIRNAME),
        "step_a_dir": _workspace_rel(step_a_dir),
        "step_a_log": _workspace_rel(workspace / LOGS_DIRNAME / "step_a.log"),
        "step_a_dedupe": _workspace_rel(step_a_dir / "dedupe.jsonl"),
        "step_a_manifest": _workspace_rel(step_a_dir / "step_a_manifest.jsonl"),
        "step_a_reduced_pool": _workspace_rel(step_a_dir / "reduced_pool"),
        "step_b_dir": _workspace_rel(step_b_dir),
        "step_b_log": _workspace_rel(workspace / LOGS_DIRNAME / "step_b.log"),
        "step_b_images_jsonl": _workspace_rel(step_b_dir / "step_b_images.jsonl"),
        "step_b_clusters_jsonl": _workspace_rel(step_b_dir / "step_b_clusters.jsonl"),
        "step_b_kmeans_jsonl": _workspace_rel(step_b_dir / "step_b_kmeans.jsonl"),
        "step_b_cache_dir": _workspace_rel(step_b_dir / "cache"),
        "step_c_dir": _workspace_rel(step_c_dir),
        "step_c_state": _workspace_rel(step_c_dir / STEP_C_STATE_FILE),
        "selected_moods": _workspace_rel(workspace / SELECTED_MOODS_FILE),
    }


def _sanitize_stem(name: str) -> str:
    return SAFE_FILENAME_RE.sub("_", name).strip("_") or "file"


def _sanitize_ext(ext: str) -> str:
    cleaned = SAFE_FILENAME_RE.sub("", ext.lower()).strip(".")
    return f".{cleaned}" if cleaned else ""


def _safe_filename(name: str, key: str) -> str:
    candidate = (name or "").strip()
    if not candidate:
        candidate = Path(key).name
    if not candidate:
        candidate = "file"

    if "." in candidate:
        stem, ext = candidate.rsplit(".", 1)
        safe_ext = _sanitize_ext(ext)
    else:
        stem = candidate
        key_ext = Path(key).suffix
        safe_ext = _sanitize_ext(key_ext)
    if not safe_ext:
        safe_ext = ".jpg"
    safe_stem = _sanitize_stem(stem)
    return f"{safe_stem}{safe_ext}"[:180]


def _write_status(album_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    workspace = _workspace(album_id)
    workspace.mkdir(parents=True, exist_ok=True)
    existing = _read_status(album_id) or {}
    status_payload = dict(existing)
    status_payload.update(payload)
    status_payload["albumId"] = album_id
    status_payload["workspace"] = workspace.as_posix()
    status_payload["workspace_rel_paths"] = payload.get("workspace_rel_paths") or status_payload.get("workspace_rel_paths") or _workspace_paths(album_id)
    status_payload["counts"] = payload.get("counts") or status_payload.get("counts") or {}
    status_payload["updatedAt"] = _iso_now()
    _status_path(album_id).write_text(
        json.dumps(status_payload, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )
    return status_payload


def _set_status(
    album_id: str,
    status: JobState,
    progress: float,
    error: str | None = None,
    error_log_excerpt: str | None = None,
    counts: Dict[str, int] | None = None,
    workspace_rel_paths: Dict[str, str] | None = None,
) -> Dict[str, Any]:
    current = _read_status(album_id) or {}
    merged_counts = dict(current.get("counts") or {})
    if counts:
        merged_counts.update({k: int(v) for k, v in counts.items()})
    merged_paths = dict(current.get("workspace_rel_paths") or {})
    if workspace_rel_paths:
        merged_paths.update(workspace_rel_paths)
    return _write_status(
        album_id,
        {
            "status": status,
            "progress": float(progress),
            "error": error,
            "error_log_excerpt": error_log_excerpt,
            "counts": merged_counts,
            "workspace_rel_paths": merged_paths or _workspace_paths(album_id),
        },
    )


def _read_status(album_id: str) -> Dict[str, Any] | None:
    path = _status_path(album_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _status_out(album_id: str, status_payload: Dict[str, Any]) -> PostUploadStatusOut:
    return PostUploadStatusOut(
        albumId=album_id,
        status=status_payload.get("status", "queued"),
        progress=float(status_payload.get("progress", 0.0)),
        error=status_payload.get("error"),
        error_log_excerpt=status_payload.get("error_log_excerpt"),
        workspace=status_payload.get("workspace", _workspace(album_id).as_posix()),
        updatedAt=status_payload.get("updatedAt", _iso_now()),
        counts=status_payload.get("counts") or {},
        workspace_rel_paths=status_payload.get("workspace_rel_paths") or _workspace_paths(album_id),
    )


def _ordered_files(files: List[UploadedFile]) -> List[UploadedFile]:
    return sorted(files, key=lambda f: (f.key, f.name))


def _resolve_local_source(key: str) -> Path | None:
    source = key
    if source.startswith("file://"):
        source = source[7:]
    path = Path(source)
    if path.is_absolute() and path.exists() and path.is_file():
        return path
    candidate = (APP_ROOT / source).resolve()
    if candidate.exists() and candidate.is_file():
        return candidate
    return None


def _inputs_manifest_path(album_id: str) -> Path:
    return _workspace(album_id) / INPUTS_MANIFEST_FILE


def _inputs_dir(album_id: str) -> Path:
    return _workspace(album_id) / STAGED_INPUTS_DIRNAME


def _step_a_dir(album_id: str) -> Path:
    return _workspace(album_id) / STEP_A_DIRNAME


def _step_a_log_path(album_id: str) -> Path:
    return _workspace(album_id) / LOGS_DIRNAME / "step_a.log"


def _quality_jsonl_path(album_id: str) -> Path:
    return _workspace(album_id) / "quality.jsonl"


def _step_b_dir(album_id: str) -> Path:
    return _workspace(album_id) / STEP_B_DIRNAME


def _step_c_dir(album_id: str) -> Path:
    return _workspace(album_id) / STEP_C_DIRNAME


def _step_c_state_path(album_id: str) -> Path:
    return _step_c_dir(album_id) / STEP_C_STATE_FILE


def _step_b_log_path(album_id: str) -> Path:
    return _workspace(album_id) / LOGS_DIRNAME / "step_b.log"


def _selected_moods_path(album_id: str) -> Path:
    return _workspace(album_id) / SELECTED_MOODS_FILE


def _read_inputs_manifest(album_id: str) -> List[Dict[str, Any]] | None:
    path = _inputs_manifest_path(album_id)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, list) else None


def _staged_inputs_ready(album_id: str) -> tuple[bool, List[Dict[str, Any]]]:
    rows = _read_inputs_manifest(album_id)
    if not rows:
        return False, []
    workspace = _workspace(album_id)
    for row in rows:
        rel = row.get("local_path_rel")
        if not isinstance(rel, str):
            return False, []
        if not (workspace / rel).exists():
            return False, []
    return True, rows


def _write_inputs_manifest(album_id: str, rows: List[Dict[str, Any]]) -> None:
    _inputs_manifest_path(album_id).write_text(
        json.dumps(rows, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )


def _download_s3_with_retry(
    s3_client: Any,
    bucket: str,
    key: str,
    dest: Path,
    *,
    max_attempts: int = 8,
    base_sleep_sec: float = 0.5,
) -> None:
    last_err: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            s3_client.download_file(bucket, key, str(dest))
            return
        except ClientError as err:
            last_err = err
            code = str((err.response or {}).get("Error", {}).get("Code", ""))
            if code in {"404", "NoSuchKey", "NotFound"} and attempt < max_attempts:
                _debug(
                    "staging retry for missing object",
                    key=key,
                    attempt=attempt,
                    max_attempts=max_attempts,
                )
                time.sleep(base_sleep_sec * attempt)
                continue
            raise
        except Exception as err:
            last_err = err
            if attempt < max_attempts:
                time.sleep(base_sleep_sec * attempt)
                continue
            raise
    if last_err:
        raise last_err


def _stage_inputs(album_id: str, files: List[UploadedFile], force: bool) -> List[Dict[str, Any]]:
    if not force:
        ready, rows = _staged_inputs_ready(album_id)
        if ready:
            return rows

    workspace = _workspace(album_id)
    input_dir = _inputs_dir(album_id)
    if input_dir.exists():
        shutil.rmtree(input_dir)
    input_dir.mkdir(parents=True, exist_ok=True)

    ordered = _ordered_files(files)
    staged_rows: List[Dict[str, Any]] = []
    bucket = get_bucket()

    s3 = None if is_mock_mode() or not bucket else get_s3()
    for i, item in enumerate(ordered, start=1):
        filename = _safe_filename(item.name, item.key)
        local_name = f"{i:06d}__{filename}"
        dest = input_dir / local_name
        if s3 is not None and bucket:
            try:
                _download_s3_with_retry(s3, bucket, item.key, dest)
            except Exception as err:
                raise RuntimeError(
                    f"Failed staging key '{item.key}' to '{dest.name}': {err}"
                ) from err
        else:
            src = _resolve_local_source(item.key)
            if src is None:
                raise RuntimeError(
                    "Cannot stage inputs in mock mode unless file keys are local file paths."
                )
            shutil.copy2(src, dest)
        staged_rows.append(
            {
                "order": i,
                "original_name": item.name,
                "s3_key": item.key,
                "local_path_rel": dest.relative_to(workspace).as_posix(),
            }
        )

    _write_inputs_manifest(album_id, staged_rows)
    return staged_rows


def _step_a_outputs_exist(album_id: str) -> bool:
    out_dir = _step_a_dir(album_id)
    return (
        (out_dir / "dedupe.jsonl").exists()
        and (out_dir / "step_a_manifest.jsonl").exists()
        and (out_dir / "reduced_pool").exists()
        and (out_dir / "quality.jsonl").exists()
    )


def _count_jsonl_rows(path: Path) -> int:
    if not path.exists():
        return 0
    count = 0
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                count += 1
    return count


def _read_jsonl(path: Path) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            rows.append(json.loads(line))
    return rows


def _append_log(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(text)


def _atomic_write_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.tmp")
    tmp_path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )
    os.replace(tmp_path, path)


def _step_c_asset_rel(path_like: str) -> str:
    norm = str(path_like or "").replace("\\", "/").strip()
    if norm.startswith("step_a/"):
        return norm
    if norm.startswith("reduced_pool/"):
        return f"step_a/{norm}"
    return f"step_a/reduced_pool/{Path(norm).name}"


def _step_c_prior_boost(size: int, cluster_pref_score: float | None) -> float:
    base_boost = math.log1p(max(0, int(size))) * 20.0
    pref_val = float(cluster_pref_score) if cluster_pref_score is not None else 0.0
    if not math.isfinite(pref_val):
        pref_val = 0.0
    pref_scaled = max(-1.0, min(1.0, pref_val * 4.0)) * 20.0
    boost = base_boost + pref_scaled
    return max(0.0, min(120.0, boost))


def _step_c_top3_ids(state: Dict[str, Any]) -> List[int]:
    clusters = state.get("clusters") or []
    ordered = sorted(
        clusters,
        key=lambda c: (-float(c.get("elo") or 0.0), int(c.get("cluster_id") or 0)),
    )
    return [int(c.get("cluster_id") or 0) for c in ordered[:3]]


def _step_c_recompute_derived(state: Dict[str, Any]) -> None:
    clusters = list(state.get("clusters") or [])
    matches = list(state.get("matches") or [])
    total_images = int(state.get("total_images") or 0)
    total_matches = int(len(matches))

    if total_images <= 0:
        total_images = sum(max(0, int(c.get("size") or 0)) for c in clusters)
        state["total_images"] = int(total_images)

    # Per-cluster rollups and momentum from the latest 3 relevant matches.
    for c in clusters:
        cid = int(c.get("cluster_id") or 0)
        wins = max(0, int(c.get("wins") or 0))
        losses = max(0, int(c.get("losses") or 0))
        games = max(0, int(c.get("games") or 0))
        if games != wins + losses:
            games = wins + losses
        c["wins"] = int(wins)
        c["losses"] = int(losses)
        c["games"] = int(games)
        c["win_rate"] = float(wins / games) if games > 0 else 0.0
        recent: List[str] = []
        for m in reversed(matches):
            left = int(m.get("left_cluster_id") or -1)
            right = int(m.get("right_cluster_id") or -1)
            if cid not in {left, right}:
                continue
            winner = int(m.get("winner_cluster_id") or -1)
            recent.append("W" if winner == cid else "L")
            if len(recent) >= 3:
                break
        recent.reverse()
        c["momentum"] = "".join(recent)

    # Ratios from Elo preferences.
    if not clusters:
        state["total_matches"] = total_matches
        state["total_keep_requested"] = int(total_images)
        state["total_keep_actual"] = 0
        state["ratio_temperature"] = float(STEP_C_RATIO_TEMPERATURE)
        state["ratio_beta"] = 0.0
        state["clusters"] = clusters
        return

    mean_elo = sum(float(c.get("elo") or 0.0) for c in clusters) / float(len(clusters))
    pref_weights: List[float] = []
    for c in clusters:
        elo = float(c.get("elo") or 0.0)
        elo_weight = math.exp((elo - mean_elo) / float(STEP_C_RATIO_TEMPERATURE))
        # DISABLED: size prior in ratio; re-enable if needed.
        # size = max(1, int(c.get("size") or 0))
        # prior = math.sqrt(float(size))
        # elo_weight = elo_weight * prior
        pref_weights.append(elo_weight)
    total_pref_weight = sum(pref_weights)
    if not math.isfinite(total_pref_weight) or total_pref_weight <= 0:
        pref_weights = [1.0 for _ in clusters]
        total_pref_weight = float(len(clusters))

    n_clusters = float(len(clusters))
    ratio_uniform = 1.0 / n_clusters
    beta = max(0.0, min(1.0, float(total_matches) / float(STEP_C_RATIO_BLEND_MATCHES)))
    blended_ratios: List[float] = []
    for i in range(len(clusters)):
        ratio_pref = float(pref_weights[i] / total_pref_weight)
        blended = beta * ratio_pref + (1.0 - beta) * ratio_uniform
        blended_ratios.append(blended)

    ratio_sum = sum(blended_ratios)
    if not math.isfinite(ratio_sum) or ratio_sum <= 0:
        blended_ratios = [ratio_uniform for _ in clusters]
        ratio_sum = 1.0

    raw_keep: List[float] = []
    base_keep: List[int] = []
    for i, c in enumerate(clusters):
        ratio = float(blended_ratios[i] / ratio_sum)
        c["ratio"] = ratio
        val = ratio * float(max(0, total_images))
        raw_keep.append(val)
        base_keep.append(int(math.floor(val)))

    keep_sum = sum(base_keep)
    remain = max(0, total_images - keep_sum)
    frac_order = sorted(
        range(len(clusters)),
        key=lambda idx: (-(raw_keep[idx] - float(base_keep[idx])), int(clusters[idx].get("cluster_id") or 0)),
    )
    for idx in frac_order:
        if remain <= 0:
            break
        base_keep[idx] += 1
        remain -= 1

    total_keep_actual = 0
    for i, c in enumerate(clusters):
        requested = int(max(0, base_keep[i]))
        size_cap = max(0, int(c.get("size") or 0))
        actual = int(min(requested, size_cap))
        c["keep_count_requested"] = requested
        c["keep_count"] = actual
        c["keep_count_capped"] = bool(actual < requested)
        total_keep_actual += actual

    state["total_matches"] = total_matches
    state["total_keep_requested"] = int(total_images)
    state["total_keep_actual"] = int(total_keep_actual)
    state["ratio_temperature"] = float(STEP_C_RATIO_TEMPERATURE)
    state["ratio_beta"] = float(beta)
    state["clusters"] = sorted(clusters, key=lambda c: int(c.get("cluster_id") or 0))


def _read_step_c_state(album_id: str) -> Dict[str, Any] | None:
    path = _step_c_state_path(album_id)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return payload


def _init_step_c_state(album_id: str) -> Dict[str, Any]:
    clusters_rows = _read_jsonl(_step_b_dir(album_id) / "step_b_clusters.jsonl")
    images_rows = _read_jsonl(_step_b_dir(album_id) / "step_b_images.jsonl")
    if not clusters_rows or not images_rows:
        raise HTTPException(status_code=404, detail="Step B outputs not found. Run Step B first.")

    images_by_cluster: Dict[int, List[Dict[str, Any]]] = {}
    for row in images_rows:
        cid = int(row.get("cluster_id") or 0)
        images_by_cluster.setdefault(cid, []).append(row)
    for cid in list(images_by_cluster.keys()):
        images_by_cluster[cid].sort(
            key=lambda r: (
                int(r.get("rank_in_cluster") or 10**9),
                str(r.get("path") or ""),
            )
        )

    cluster_meta = {int(r.get("cluster_id") or 0): r for r in clusters_rows}
    all_ids = sorted(set(cluster_meta.keys()) | set(images_by_cluster.keys()))
    clusters: List[Dict[str, Any]] = []
    total_images = len(images_rows)

    for cid in all_ids:
        meta = cluster_meta.get(cid, {})
        imgs = images_by_cluster.get(cid, [])
        size = int(meta.get("size") or len(imgs) or 0)
        pref = meta.get("cluster_pref_score")
        pref_val = float(pref) if isinstance(pref, (int, float)) else None
        elo = 1000.0 + _step_c_prior_boost(size, pref_val)
        reps: List[str] = []
        for img_row in imgs[:4]:
            img_path = str(img_row.get("path") or "").strip()
            if not img_path:
                continue
            reps.append(_step_c_asset_rel(img_path))
        clusters.append(
            {
                "cluster_id": int(cid),
                "cluster_name": str(meta.get("cluster_name") or f"Cluster {cid}"),
                "size": int(size),
                "representatives": reps,
                "elo": float(elo),
                "games": 0,
                "wins": 0,
                "losses": 0,
                "win_rate": 0.0,
                "momentum": "",
                "ratio": 0.0,
                "keep_count": 0,
            }
        )

    state: Dict[str, Any] = {
        "albumId": album_id,
        "created_at": _iso_now(),
        "updated_at": _iso_now(),
        "max_matches": 12,
        "max_warmup_matches": 6,
        "total_images": int(total_images),
        "total_matches": 0,
        "matches": [],
        "clusters": clusters,
        "done": False,
        "stop_reason": None,
        "last_top3": [],
        "top3_streak": 0,
    }
    _step_c_recompute_derived(state)
    state["last_top3"] = _step_c_top3_ids(state)
    state["top3_streak"] = 0
    _atomic_write_json(_step_c_state_path(album_id), state)
    return state


def _get_or_init_step_c_state(album_id: str) -> Dict[str, Any]:
    existing = _read_step_c_state(album_id)
    if not existing:
        return _init_step_c_state(album_id)
    existing.setdefault("albumId", album_id)
    existing.setdefault("matches", [])
    existing.setdefault("clusters", [])
    existing.setdefault("max_matches", 12)
    existing.setdefault("max_warmup_matches", 6)
    existing.setdefault("done", False)
    existing.setdefault("stop_reason", None)
    existing.setdefault("last_top3", [])
    existing.setdefault("top3_streak", 0)
    _step_c_recompute_derived(existing)
    return existing


def _step_c_apply_choice(state: Dict[str, Any], left_id: int, right_id: int, winner_id: int) -> Dict[str, Any]:
    clusters = list(state.get("clusters") or [])
    by_id = {int(c.get("cluster_id") or 0): c for c in clusters}
    if left_id == right_id:
        raise HTTPException(status_code=400, detail="left_cluster_id and right_cluster_id must differ.")
    if left_id not in by_id or right_id not in by_id:
        raise HTTPException(status_code=400, detail="Unknown cluster id in choice.")
    if winner_id not in {left_id, right_id}:
        raise HTTPException(status_code=400, detail="winner_cluster_id must match left or right cluster.")

    if bool(state.get("done")):
        return state

    left = by_id[left_id]
    right = by_id[right_id]
    ra = float(left.get("elo") or 1000.0)
    rb = float(right.get("elo") or 1000.0)
    ea = 1.0 / (1.0 + (10.0 ** ((rb - ra) / 400.0)))
    eb = 1.0 - ea
    sa = 1.0 if winner_id == left_id else 0.0
    sb = 1.0 if winner_id == right_id else 0.0
    k = 24.0
    left["elo"] = float(ra + k * (sa - ea))
    right["elo"] = float(rb + k * (sb - eb))

    left["games"] = int(left.get("games") or 0) + 1
    right["games"] = int(right.get("games") or 0) + 1
    if winner_id == left_id:
        left["wins"] = int(left.get("wins") or 0) + 1
        right["losses"] = int(right.get("losses") or 0) + 1
    else:
        right["wins"] = int(right.get("wins") or 0) + 1
        left["losses"] = int(left.get("losses") or 0) + 1

    matches = list(state.get("matches") or [])
    matches.append(
        {
            "ts": _iso_now(),
            "left_cluster_id": int(left_id),
            "right_cluster_id": int(right_id),
            "winner_cluster_id": int(winner_id),
        }
    )
    state["matches"] = matches
    state["clusters"] = list(by_id.values())
    _step_c_recompute_derived(state)

    prev_top3 = [int(x) for x in list(state.get("last_top3") or [])]
    curr_top3 = _step_c_top3_ids(state)
    if curr_top3 and curr_top3 == prev_top3:
        state["top3_streak"] = int(state.get("top3_streak") or 0) + 1
    else:
        state["top3_streak"] = 1 if curr_top3 else 0
    state["last_top3"] = curr_top3

    max_matches = int(state.get("max_matches") or 12)
    all_two_plus = all(int(c.get("games") or 0) >= 2 for c in (state.get("clusters") or []))
    if int(state.get("total_matches") or 0) >= max_matches:
        state["done"] = True
        state["stop_reason"] = f"Reached max matches ({max_matches})."
    elif all_two_plus and int(state.get("top3_streak") or 0) >= 3:
        state["done"] = True
        state["stop_reason"] = "Top-3 ordering stabilized for 3 consecutive matches."
    else:
        state["done"] = False
        state["stop_reason"] = None

    state["updated_at"] = _iso_now()
    return state


def _canon_moods(moods: List[str]) -> List[str]:
    deduped: List[str] = []
    for mood in moods:
        if mood in FIXED_MOODS and mood not in deduped:
            deduped.append(mood)
    deduped.sort(key=lambda m: FIXED_MOODS.index(m))
    return deduped


def _read_selected_moods(album_id: str) -> List[str] | None:
    path = _selected_moods_path(album_id)
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    moods = payload.get("moods")
    if not isinstance(moods, list):
        return None
    canon = _canon_moods([str(m) for m in moods])
    return canon or None


def _write_selected_moods(album_id: str, moods: List[str]) -> List[str]:
    canon = _canon_moods(moods)
    path = _selected_moods_path(album_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"albumId": album_id, "moods": canon}, ensure_ascii=False, sort_keys=True, indent=2),
        encoding="utf-8",
    )
    return canon


def _step_a_counts(album_id: str, uploaded_count: int, staged_count: int) -> Dict[str, int]:
    out_dir = _step_a_dir(album_id)
    reduced_pool = out_dir / "reduced_pool"
    reduced_count = 0
    if reduced_pool.exists():
        reduced_count = len([p for p in reduced_pool.rglob("*") if p.is_file()])
    groups_count = _count_jsonl_rows(out_dir / "step_a_manifest.jsonl")
    return {
        "uploaded_count": int(uploaded_count),
        "staged_count": int(staged_count),
        "step_a_reduced_pool_count": int(reduced_count),
        "step_a_groups_count": int(groups_count),
    }


def _compute_quality_jsonl(album_id: str, force: bool) -> Path:
    out_path = _quality_jsonl_path(album_id)
    if out_path.exists() and not force:
        return out_path

    ready, rows = _staged_inputs_ready(album_id)
    if not ready:
        raise RuntimeError("Cannot compute quality metrics before staging inputs.")

    qcfg = QualityConfig()
    payloads: List[Dict[str, Any]] = []
    for row in rows:
        rel = row.get("local_path_rel")
        if not isinstance(rel, str):
            continue
        src = (_workspace(album_id) / rel).resolve()
        if not src.exists():
            continue
        payloads.append(assess_quality(src, qcfg))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        for rec in payloads:
            handle.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")
    return out_path


def _step_b_dino_ready(album_id: str) -> bool:
    return (_step_b_dir(album_id) / "step_b_kmeans.jsonl").exists()


def _step_b_outputs_exist(album_id: str) -> bool:
    out = _step_b_dir(album_id)
    return (out / "step_b_images.jsonl").exists() and (out / "step_b_clusters.jsonl").exists()


def _step_b_counts(album_id: str) -> Dict[str, int]:
    out = _step_b_dir(album_id)
    return {
        "step_b_cluster_count": _count_jsonl_rows(out / "step_b_clusters.jsonl"),
        "step_b_image_count": _count_jsonl_rows(out / "step_b_images.jsonl"),
    }


def _run_step_a(album_id: str, force: bool) -> None:
    if not VENDORED_PIPELINE_ROOT.exists():
        raise RuntimeError(f"Vendored pipeline folder not found: {VENDORED_PIPELINE_ROOT.as_posix()}")
    in_dir = _inputs_dir(album_id)
    out_dir = _step_a_dir(album_id)
    if force and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    quality_jsonl = _compute_quality_jsonl(album_id, force=force)

    cmd = [
        sys.executable,
        "-m",
        "pipeline_labs.step_a.runner",
        "--in",
        str(in_dir),
        "--out",
        str(out_dir),
        "--quality-jsonl",
        str(quality_jsonl),
        "--export-mode",
        "copy",
        "--workers",
        "4",
        "--print-summary",
    ]
    result = subprocess.run(
        cmd,
        cwd=str(APP_ROOT),
        capture_output=True,
        text=True,
    )
    logs_dir = _workspace(album_id) / LOGS_DIRNAME
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_text = "\n".join(
        [
            f"$ {' '.join(cmd)}",
            "",
            "=== STDOUT ===",
            result.stdout or "",
            "",
            "=== STDERR ===",
            result.stderr or "",
            "",
            f"[exit_code] {result.returncode}",
        ]
    )
    _step_a_log_path(album_id).write_text(log_text, encoding="utf-8")
    if result.returncode != 0:
        excerpt = log_text[-2000:]
        raise RuntimeError(f"Step A failed with exit code {result.returncode}. Log tail: {excerpt}")
    # Keep a copy under step_a/ for demo artifact pages.
    try:
        shutil.copy2(quality_jsonl, out_dir / "quality.jsonl")
    except Exception:
        pass


def _run_step_b_dino_phase(album_id: str, force: bool) -> None:
    if not VENDORED_PIPELINE_ROOT.exists():
        raise RuntimeError(f"Vendored pipeline folder not found: {VENDORED_PIPELINE_ROOT.as_posix()}")
    step_a_out = _step_a_dir(album_id)
    step_b_out = _step_b_dir(album_id)
    step_b_out.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "pipeline_labs.step_b.runner",
        "--phase",
        "dino_only",
        "--step-a-out",
        str(step_a_out),
        "--out",
        str(step_b_out),
        "--styles",
        STEP_B_DINO_PLACEHOLDER_STYLES,
        "--batch-size",
        "8",
        "--print-summary",
    ]
    if force:
        cmd.append("--recompute")
    result = subprocess.run(
        cmd,
        cwd=str(APP_ROOT),
        capture_output=True,
        text=True,
    )
    log_text = "\n".join(
        [
            f"$ {' '.join(cmd)}",
            "",
            "=== STDOUT ===",
            result.stdout or "",
            "",
            "=== STDERR ===",
            result.stderr or "",
            "",
            f"[exit_code] {result.returncode}",
            "",
        ]
    )
    _append_log(_step_b_log_path(album_id), log_text)
    if result.returncode != 0:
        excerpt = log_text[-2000:]
        raise RuntimeError(f"Step B dino phase failed with exit code {result.returncode}. Log tail: {excerpt}")


def _run_step_b_clip_phase(album_id: str, moods: List[str], force: bool) -> None:
    if not VENDORED_PIPELINE_ROOT.exists():
        raise RuntimeError(f"Vendored pipeline folder not found: {VENDORED_PIPELINE_ROOT.as_posix()}")
    if not moods:
        raise RuntimeError("Cannot run Step B clip phase without selected moods.")
    step_a_out = _step_a_dir(album_id)
    step_b_out = _step_b_dir(album_id)
    step_b_out.mkdir(parents=True, exist_ok=True)
    styles_value = "|".join(moods)

    cmd = [
        sys.executable,
        "-m",
        "pipeline_labs.step_b.runner",
        "--phase",
        "full",
        "--step-a-out",
        str(step_a_out),
        "--out",
        str(step_b_out),
        "--styles",
        styles_value,
        "--batch-size",
        "8",
        "--print-summary",
    ]
    if force:
        cmd.append("--recompute")
    result = subprocess.run(
        cmd,
        cwd=str(APP_ROOT),
        capture_output=True,
        text=True,
    )
    log_text = "\n".join(
        [
            f"$ {' '.join(cmd)}",
            "",
            "=== STDOUT ===",
            result.stdout or "",
            "",
            "=== STDERR ===",
            result.stderr or "",
            "",
            f"[exit_code] {result.returncode}",
            "",
        ]
    )
    _append_log(_step_b_log_path(album_id), log_text)
    if result.returncode != 0:
        excerpt = log_text[-2000:]
        raise RuntimeError(f"Step B clip phase failed with exit code {result.returncode}. Log tail: {excerpt}")


def _tail_text(path: Path, max_chars: int = 2000) -> str | None:
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8", errors="replace")
    return text[-max_chars:] if text else None


def _resolve_workspace_file(album_id: str, rel: str) -> Path:
    workspace = _workspace(album_id).resolve()
    rel_path = Path(rel)
    if rel_path.is_absolute():
        raise HTTPException(status_code=400, detail="Asset path must be relative.")
    candidate = (workspace / rel_path).resolve()
    try:
        candidate.relative_to(workspace)
    except ValueError as err:
        raise HTTPException(status_code=400, detail="Invalid asset path.") from err
    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return candidate


def _is_image_asset(path: Path) -> bool:
    return path.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".heic", ".heif", ".avif"}


def _build_demo_asset_variant(album_id: str, src: Path, width: int, quality: int, fmt: str) -> Path:
    try:
        from PIL import Image, ImageOps
    except Exception as err:
        raise RuntimeError("Pillow is required for demo asset resizing.") from err

    workspace = _workspace(album_id)
    cache_dir = workspace / DEMO_ASSET_CACHE_DIRNAME
    stat = src.stat()
    sig = hashlib.sha1(
        f"v2_exif|{src.as_posix()}|{int(stat.st_mtime_ns)}|{int(stat.st_size)}|{width}|{quality}|{fmt}".encode("utf-8")
    ).hexdigest()
    ext = "webp" if fmt == "webp" else "jpg"
    out = cache_dir / f"{sig}.{ext}"
    if out.exists():
        return out

    out.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as im:
        # Keep browser previews in the same visual orientation as the original capture.
        im = ImageOps.exif_transpose(im)
        im = im.convert("RGB")
        if width > 0 and im.width > width:
            ratio = float(width) / float(im.width)
            new_h = max(1, int(round(float(im.height) * ratio)))
            resampling = getattr(Image, "Resampling", Image)
            im = im.resize((int(width), int(new_h)), resampling.LANCZOS)
        if fmt == "webp":
            im.save(out, format="WEBP", quality=int(quality), method=6)
        else:
            im.save(out, format="JPEG", quality=int(quality), optimize=True)
    return out


def _run_job(album_id: str, files: List[UploadedFile], force: bool) -> None:
    ordered = _ordered_files(files)
    uploaded_count = len(ordered)
    try:
        _set_status(
            album_id,
            "staging_inputs",
            0.2,
            counts={"uploaded_count": uploaded_count},
        )
        staged_rows = _stage_inputs(album_id, ordered, force=force)
        staged_count = len(staged_rows)

        _set_status(
            album_id,
            "running_a",
            0.6,
            counts={"uploaded_count": uploaded_count, "staged_count": staged_count},
        )
        if force or not _step_a_outputs_exist(album_id):
            _run_step_a(album_id, force=force)

        counts = _step_a_counts(album_id, uploaded_count=uploaded_count, staged_count=staged_count)
        _set_status(
            album_id,
            "done_a",
            0.65,
            error=None,
            error_log_excerpt=None,
            counts=counts,
        )

        _set_status(
            album_id,
            "running_b_dino",
            0.75,
            counts=counts,
        )
        if force or not _step_b_dino_ready(album_id):
            _run_step_b_dino_phase(album_id, force=force)

        moods = _read_selected_moods(album_id)
        if moods:
            _set_status(
                album_id,
                "running_b_clip",
                0.9,
                counts=counts,
            )
            if force or not _step_b_outputs_exist(album_id):
                _run_step_b_clip_phase(album_id, moods, force=force)
            counts.update(_step_b_counts(album_id))
            _set_status(
                album_id,
                "done_b",
                1.0,
                error=None,
                error_log_excerpt=None,
                counts=counts,
            )
        else:
            _set_status(
                album_id,
                "waiting_user_moods",
                0.85,
                counts=counts,
            )
    except Exception as err:
        _debug("post-upload job failed", albumId=album_id, error=str(err))
        _set_status(
            album_id,
            "error",
            1.0,
            error=str(err),
            error_log_excerpt=_tail_text(_step_b_log_path(album_id), 2000) or _tail_text(_step_a_log_path(album_id), 2000),
        )
    finally:
        with ACTIVE_LOCK:
            ACTIVE_JOBS.pop(album_id, None)


def _run_clip_finalize(album_id: str, moods: List[str], force: bool) -> None:
    try:
        current = _read_status(album_id) or {}
        counts = dict(current.get("counts") or {})
        _set_status(
            album_id,
            "running_b_clip",
            0.9,
            counts=counts,
            error=None,
            error_log_excerpt=None,
        )
        if force or not _step_b_outputs_exist(album_id):
            _run_step_b_clip_phase(album_id, moods, force=force)
        counts.update(_step_b_counts(album_id))
        _set_status(
            album_id,
            "done_b",
            1.0,
            counts=counts,
            error=None,
            error_log_excerpt=None,
        )
    except Exception as err:
        _debug("step b finalize failed", albumId=album_id, error=str(err))
        _set_status(
            album_id,
            "error",
            1.0,
            error=str(err),
            error_log_excerpt=_tail_text(_step_b_log_path(album_id), 2000) or _tail_text(_step_a_log_path(album_id), 2000),
        )
    finally:
        with ACTIVE_LOCK:
            ACTIVE_JOBS.pop(album_id, None)


@router.post("/start", response_model=PostUploadStatusOut)
def start_post_upload_job(body: StartPostUploadIn) -> PostUploadStatusOut:
    if not body.files:
        raise HTTPException(status_code=400, detail="At least one uploaded file is required.")

    with ACTIVE_LOCK:
        existing_thread = ACTIVE_JOBS.get(body.albumId)
    if existing_thread and existing_thread.is_alive():
        existing = _read_status(body.albumId)
        if existing:
            return _status_out(body.albumId, existing)

    existing = _read_status(body.albumId)
    if existing and existing.get("status") in {
        "queued",
        "staging_inputs",
        "running_a",
        "running_b_dino",
        "waiting_user_moods",
        "running_b_clip",
    } and not body.force:
        return _status_out(body.albumId, existing)
    if existing and existing.get("status") == "done_a" and not body.force:
        if _step_a_outputs_exist(body.albumId):
            return _status_out(body.albumId, existing)
    if existing and existing.get("status") == "done_b" and not body.force:
        if _step_a_outputs_exist(body.albumId) and _step_b_outputs_exist(body.albumId):
            return _status_out(body.albumId, existing)

    queued = _set_status(
        body.albumId,
        "queued",
        0.0,
        error=None,
        error_log_excerpt=None,
        counts={"uploaded_count": len(_ordered_files(body.files))},
    )
    worker = threading.Thread(target=_run_job, args=(body.albumId, body.files, body.force), daemon=True)
    with ACTIVE_LOCK:
        ACTIVE_JOBS[body.albumId] = worker
    worker.start()
    return _status_out(body.albumId, queued)


@router.post("/moods", response_model=PostUploadStatusOut)
def submit_moods(body: SubmitMoodsIn) -> PostUploadStatusOut:
    invalid = [m for m in body.moods if m not in FIXED_MOODS]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid moods: {invalid}. Allowed: {FIXED_MOODS}")
    prev = _read_selected_moods(body.albumId)
    canon = _write_selected_moods(body.albumId, body.moods)
    if len(canon) == 0 or len(canon) > 2:
        raise HTTPException(status_code=400, detail=f"Select 1-2 moods from: {FIXED_MOODS}")

    current = _read_status(body.albumId)
    if not current:
        raise HTTPException(status_code=404, detail="Post-upload job not found for album.")

    with ACTIVE_LOCK:
        existing_thread = ACTIVE_JOBS.get(body.albumId)
    if existing_thread and existing_thread.is_alive():
        return _status_out(body.albumId, _read_status(body.albumId) or current)

    unchanged = prev == canon
    if unchanged and _step_b_outputs_exist(body.albumId) and not body.force:
        done_payload = _set_status(
            body.albumId,
            "done_b",
            1.0,
            counts={**(current.get("counts") or {}), **_step_b_counts(body.albumId)},
            error=None,
            error_log_excerpt=None,
        )
        return _status_out(body.albumId, done_payload)

    status = str((current.get("status") or "")).strip()
    if status in {"waiting_user_moods", "done_a", "running_b_dino", "done_b"}:
        rerun_force = body.force or (not unchanged)
        worker = threading.Thread(
            target=_run_clip_finalize,
            args=(body.albumId, canon, rerun_force),
            daemon=True,
        )
        with ACTIVE_LOCK:
            ACTIVE_JOBS[body.albumId] = worker
        worker.start()
        refreshed = _read_status(body.albumId) or current
        return _status_out(body.albumId, refreshed)

    return _status_out(body.albumId, current)


@router.get("/status", response_model=PostUploadStatusOut)
def get_post_upload_status(albumId: str = Query(..., min_length=1)) -> PostUploadStatusOut:
    status_payload = _read_status(albumId)
    if not status_payload:
        raise HTTPException(status_code=404, detail="Post-upload job not found for album.")
    return _status_out(albumId, status_payload)


@router.get("/step-a/list")
def list_step_a_reduced_pool(albumId: str = Query(..., min_length=1)) -> Dict[str, Any]:
    reduced_pool = _step_a_dir(albumId) / "reduced_pool"
    if not reduced_pool.exists() or not reduced_pool.is_dir():
        raise HTTPException(status_code=404, detail="Step A reduced_pool not found for album.")
    files = sorted(
        [p for p in reduced_pool.rglob("*") if p.is_file()],
        key=lambda p: p.relative_to(reduced_pool).as_posix(),
    )
    items = [(Path("step_a") / "reduced_pool" / p.relative_to(reduced_pool)).as_posix() for p in files]
    return {"albumId": albumId, "items": items}


@router.get("/step-b/clusters")
def get_step_b_clusters(albumId: str = Query(..., min_length=1)) -> Dict[str, Any]:
    path = _step_b_dir(albumId) / "step_b_clusters.jsonl"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Step B clusters not found for album.")
    return {"albumId": albumId, "items": _read_jsonl(path)}


@router.get("/step-b/images")
def get_step_b_images(albumId: str = Query(..., min_length=1)) -> Dict[str, Any]:
    path = _step_b_dir(albumId) / "step_b_images.jsonl"
    if not path.exists():
        raise HTTPException(status_code=404, detail="Step B images not found for album.")
    return {"albumId": albumId, "items": _read_jsonl(path)}


@router.get("/step-c/state")
def get_step_c_state(albumId: str = Query(..., min_length=1)) -> Dict[str, Any]:
    return _get_or_init_step_c_state(albumId)


@router.post("/step-c/choose")
def post_step_c_choose(body: StepCChooseIn) -> Dict[str, Any]:
    state = _get_or_init_step_c_state(body.albumId)
    updated = _step_c_apply_choice(
        state,
        int(body.left_cluster_id),
        int(body.right_cluster_id),
        int(body.winner_cluster_id),
    )
    _atomic_write_json(_step_c_state_path(body.albumId), updated)
    return updated


@router.get("/asset")
def get_post_upload_asset(
    albumId: str = Query(..., min_length=1),
    rel: str = Query(..., min_length=1),
    demo: int = Query(0, ge=0, le=1),
    w: int = Query(640, ge=64, le=2048),
    q: int = Query(68, ge=25, le=95),
    fmt: str = Query("webp", pattern="^(webp|jpeg)$"),
) -> FileResponse:
    path = _resolve_workspace_file(albumId, rel)
    if int(demo) == 1 and _is_image_asset(path):
        try:
            variant = _build_demo_asset_variant(albumId, path, int(w), int(q), fmt)
            media_type = "image/webp" if fmt == "webp" else "image/jpeg"
            return FileResponse(variant, media_type=media_type)
        except Exception:
            # Fallback to original asset when thumbnail generation is unavailable.
            pass
    return FileResponse(path)

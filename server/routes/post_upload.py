from __future__ import annotations

import json
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
    "done",
    "error",
]

SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
APP_ROOT = Path(__file__).resolve().parents[2]
WORKSPACES_ROOT = (APP_ROOT / "server" / "workspaces").resolve()
PIPELINE_ROOT = (APP_ROOT / "image-ranking-pipeline").resolve()
STATUS_FILE = "post_upload_status.json"
INPUTS_MANIFEST_FILE = "inputs_manifest.json"
STAGED_INPUTS_DIRNAME = "inputs"
LOGS_DIRNAME = "logs"
STEP_A_DIRNAME = "step_a"

ACTIVE_JOBS: Dict[str, threading.Thread] = {}
ACTIVE_LOCK = threading.Lock()


class UploadedFile(BaseModel):
    key: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)


class StartPostUploadIn(BaseModel):
    albumId: str = Field(..., min_length=1)
    files: List[UploadedFile]
    force: bool = False


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


def _run_step_a(album_id: str, force: bool) -> None:
    if not PIPELINE_ROOT.exists():
        raise RuntimeError(f"Pipeline folder not found: {PIPELINE_ROOT.as_posix()}")
    in_dir = _inputs_dir(album_id)
    out_dir = _step_a_dir(album_id)
    if force and out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        "-m",
        "labs.step_a.runner",
        "--in",
        str(in_dir),
        "--out",
        str(out_dir),
        "--export-mode",
        "copy",
        "--workers",
        "4",
        "--print-summary",
    ]
    result = subprocess.run(
        cmd,
        cwd=str(PIPELINE_ROOT),
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
            1.0,
            error=None,
            error_log_excerpt=None,
            counts=counts,
        )
    except Exception as err:
        _debug("post-upload job failed", albumId=album_id, error=str(err))
        _set_status(
            album_id,
            "error",
            1.0,
            error=str(err),
            error_log_excerpt=_tail_text(_step_a_log_path(album_id), 2000),
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


@router.get("/asset")
def get_post_upload_asset(
    albumId: str = Query(..., min_length=1),
    rel: str = Query(..., min_length=1),
) -> FileResponse:
    path = _resolve_workspace_file(albumId, rel)
    return FileResponse(path)

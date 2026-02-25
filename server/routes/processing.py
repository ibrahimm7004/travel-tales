from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from server.s3_client import get_bucket, get_s3

router = APIRouter(prefix="/processing", tags=["processing"])

JobStatus = Literal["pending", "processing", "complete", "error"]

SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
JOB_STORE: Dict[str, Dict[str, Any]] = {}
JOB_LOCK = threading.Lock()
SERVER_ROOT = Path(__file__).resolve().parents[1]
VENDOR_PATH = (SERVER_ROOT / "vendor" / "irp").resolve()


class ProcessingFile(BaseModel):
    key: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)


class StartIn(BaseModel):
    albumId: str = Field(..., min_length=1)
    files: List[ProcessingFile]


class StartOut(BaseModel):
    runId: str


class StatusOut(BaseModel):
    status: JobStatus
    runId: str
    albumId: str
    progress: float | None = None
    s3Prefix: str | None = None
    survivors: List[str] | None = None
    error: str | None = None


def sanitize_filename(name: str) -> str:
    candidate = name.strip() or "file"
    if "." in candidate:
        stem, ext = candidate.rsplit(".", 1)
    else:
        stem, ext = candidate, ""
    safe_stem = SAFE_FILENAME_RE.sub("_", stem).strip("_") or "file"
    safe_ext = SAFE_FILENAME_RE.sub("_", ext).strip("_") if ext else ""
    safe = f"{safe_stem}.{safe_ext}" if safe_ext else safe_stem
    if "." not in safe:
        safe = f"{safe}.jpg"
    return safe[:128]


def _pipeline_enabled() -> bool:
    return os.getenv("PIPELINE_ENABLED", "0") == "1"


def _pipeline_debug_enabled() -> bool:
    return os.getenv("PIPELINE_DEBUG", "0") == "1"


def _debug(msg: str, **ctx: Any) -> None:
    if _pipeline_debug_enabled():
        payload = f"[PIPELINE_DEBUG] {msg}"
        if ctx:
            payload += f" {ctx}"
        print(payload, flush=True)


def _update_job(run_id: str, **updates: Any) -> None:
    with JOB_LOCK:
        job = JOB_STORE.get(run_id)
        if job:
            job.update(updates)


def _get_job(run_id: str) -> Dict[str, Any] | None:
    with JOB_LOCK:
        job = JOB_STORE.get(run_id)
        return dict(job) if job else None


def _record_job(run_id: str, album_id: str) -> None:
    with JOB_LOCK:
        JOB_STORE[run_id] = {
            "status": "pending",
            "runId": run_id,
            "albumId": album_id,
            "progress": 0.0,
            "survivors": [],
            "s3Prefix": None,
            "error": None,
        }


def _vendor_python_path(env: Dict[str, str]) -> Dict[str, str]:
    env_copy = env.copy()
    vendor_str = str(VENDOR_PATH)
    existing = env_copy.get("PYTHONPATH", "")
    env_copy["PYTHONPATH"] = vendor_str if not existing else f"{vendor_str}{os.pathsep}{existing}"
    return env_copy


def _write_inputs_map(path: Path, inputs: List[Dict[str, str]]) -> None:
    path.write_text(json.dumps({"files": inputs},
                    ensure_ascii=False, indent=2), encoding="utf-8")


def _parse_survivors(dedupe_path: Path, mapping: Dict[str, Dict[str, str]]) -> tuple[List[Dict[str, Any]], List[str]]:
    survivors_records: List[Dict[str, Any]] = []
    survivor_keys: List[str] = []
    if not dedupe_path.exists():
        return survivors_records, survivor_keys
    with dedupe_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            rep = bool(data.get("representative"))
            rejected = bool(data.get("rejected", False))
            if rep and not rejected:
                survivors_records.append(data)
                mapped = mapping.get(data.get("path", ""))
                if mapped:
                    survivor_keys.append(mapped["key"])
    return survivors_records, survivor_keys


def _upload_artifacts(s3_client, bucket: str, prefix: str, files: List[Path]) -> None:
    for artifact in files:
        if artifact.exists():
            key = f"{prefix}{artifact.name}"
            _debug("Uploading artifact", key=key)
            s3_client.upload_file(str(artifact), bucket, key)


def _run_job(run_id: str, album_id: str, files_payload: List[Dict[str, str]]) -> None:
    files = [ProcessingFile(**fp) for fp in files_payload]
    bucket = get_bucket()
    if not bucket:
        _update_job(run_id, status="error",
                    error="AWS_S3_BUCKET is not configured.")
        return
    s3 = get_s3()
    _update_job(run_id, status="processing", progress=0.05)
    tmp_root = Path(tempfile.mkdtemp(prefix=f"pipeline_{run_id}_"))
    input_dir = tmp_root / "in"
    output_dir = tmp_root / "out"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    local_map: Dict[str, Dict[str, str]] = {}
    inputs_summary: List[Dict[str, str]] = []
    try:
        for item in files:
            safe_name = sanitize_filename(item.name)
            stem, ext = os.path.splitext(safe_name)
            final_name = safe_name
            suffix = 1
            while (input_dir / final_name).exists():
                final_name = f"{stem}_{suffix}{ext}"
                suffix += 1
            dest = input_dir / final_name
            _debug("Downloading input", key=item.key, dest=str(dest))
            s3.download_file(bucket, item.key, str(dest))
            resolved_posix = dest.resolve().as_posix()
            local_map[resolved_posix] = {"key": item.key, "name": item.name}
            inputs_summary.append(
                {"key": item.key, "name": item.name, "local": final_name})
        _update_job(run_id, progress=0.25)
        inputs_map_path = output_dir / "inputs_map.json"
        _write_inputs_map(inputs_map_path, inputs_summary)

        cmd = [
            sys.executable,
            "-m",
            "irp.cli",
            "--in",
            str(input_dir),
            "--out",
            str(output_dir),
            "--target",
            str(max(len(files), 1)),
            "--max-workers",
            "4",
            "--do-quality",
            "--do-dedupe",
        ]
        env = _vendor_python_path(os.environ)
        _debug("Starting pipeline", cmd=" ".join(cmd))
        subprocess.run(cmd, check=True, env=env)
        _update_job(run_id, progress=0.7)

        dedupe_path = output_dir / "dedupe.jsonl"
        survivors_path = output_dir / "survivors.json"
        survivors_records, survivor_keys = _parse_survivors(
            dedupe_path, local_map)
        survivors_path.write_text(json.dumps(
            survivors_records, ensure_ascii=False, indent=2), encoding="utf-8")

        artifacts = [
            output_dir / "manifest.jsonl",
            output_dir / "quality.jsonl",
            dedupe_path,
            survivors_path,
            inputs_map_path,
        ]
        prefix = f"processing/{album_id}/{run_id}/"
        _upload_artifacts(s3, bucket, prefix, artifacts)
        _update_job(
            run_id,
            status="complete",
            progress=1.0,
            s3Prefix=prefix,
            survivors=survivor_keys,
        )
    except Exception as err:
        _update_job(run_id, status="error", error=str(err))
        _debug("Pipeline job failed", error=str(err))
    finally:
        try:
            shutil.rmtree(tmp_root)
        except Exception:
            pass


@router.post("/start", response_model=StartOut)
def start_processing(body: StartIn) -> StartOut:
    if not _pipeline_enabled():
        raise HTTPException(
            status_code=501, detail="Image pipeline is disabled. Set PIPELINE_ENABLED=1 to enable.")
    if not body.files:
        raise HTTPException(
            status_code=400, detail="At least one file is required.")
    bucket = get_bucket()
    if not bucket:
        raise HTTPException(
            status_code=500, detail="AWS_S3_BUCKET is not configured.")
    run_id = uuid.uuid4().hex
    _record_job(run_id, body.albumId)
    files_payload = [f.model_dump() for f in body.files]
    thread = threading.Thread(target=_run_job, args=(
        run_id, body.albumId, files_payload), daemon=True)
    thread.start()
    _debug("Started processing job", run_id=run_id,
           album_id=body.albumId, files=len(files_payload))
    return StartOut(runId=run_id)


@router.get("/status", response_model=StatusOut)
def get_status(albumId: str = Query(..., min_length=1), runId: str = Query(..., min_length=1)) -> StatusOut:
    job = _get_job(runId)
    if not job or job.get("albumId") != albumId:
        raise HTTPException(
            status_code=404, detail="Processing job not found.")
    return StatusOut(
        status=job.get("status", "pending"),
        runId=job["runId"],
        albumId=job["albumId"],
        progress=job.get("progress"),
        s3Prefix=job.get("s3Prefix"),
        survivors=job.get("survivors"),
        error=job.get("error"),
    )

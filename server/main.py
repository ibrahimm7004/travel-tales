from fastapi import Request
import os
from typing import List, Dict, Any
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import boto3
from botocore.client import Config
from dotenv import load_dotenv
import logging

load_dotenv()

AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
AWS_BUCKET = os.getenv("AWS_S3_BUCKET")
AWS_ENDPOINT = os.getenv("AWS_S3_ENDPOINT")  # optional (for LocalStack/MinIO)

session = boto3.session.Session(
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
    region_name=AWS_REGION,
)

s3 = session.client(
    "s3",
    endpoint_url=AWS_ENDPOINT if AWS_ENDPOINT else None,
    config=Config(s3={"addressing_style": "virtual"})
)

app = FastAPI()

# TEMP: maximally permissive CORS to debug preflight issues. Ensure this is
# added before routers and route definitions so preflight is handled.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],  # includes OPTIONS
    allow_headers=["*"],
    allow_credentials=False,  # simplify during debugging
    max_age=600,
)


# Minimal request logging to observe preflight headers


@app.middleware("http")
async def log_requests(request: Request, call_next):
    m = request.method
    p = request.url.path
    h = request.headers
    print(f"[REQ] {m} {p} origin={h.get('origin')} acr-method={h.get('access-control-request-method')} acr-headers={h.get('access-control-request-headers')}", flush=True)
    resp = await call_next(request)
    print(f"[RESP] {m} {p} -> {resp.status_code}", flush=True)
    return resp

try:
    # Wire debug S3 router; safe to expose since access requires valid AWS keys
    from server.routes.debug_s3 import router as debug_s3_router
    app.include_router(debug_s3_router)
except Exception as _e:
    # Avoid startup failure if optional debug router cannot be imported
    pass


# In-memory manifest index to aid logging at completion time
_MANIFEST_INDEX: Dict[str, Dict[str, Any]] = {}


class FileManifest(BaseModel):
    client_id: str
    name: str
    bytes: int
    mime: str
    sha1: str
    taken_at: str | None = None
    gps: Dict[str, float] | None = None


class SubmitManifestIn(BaseModel):
    album_id: str
    files: List[FileManifest]


@app.post("/albums")
def create_album() -> Dict[str, Any]:
    import uuid
    return {"album_id": str(uuid.uuid4())}


@app.get("/")
def root() -> Dict[str, Any]:
    return {"ok": True, "service": "traveltales-api"}


@app.get("/debug/ping")
def ping() -> Dict[str, Any]:
    return {"ok": True}


@app.post("/upload/manifest")
def submit_manifest(body: SubmitManifestIn):
    import uuid
    server_files = []
    for f in body.files:
        file_id = str(uuid.uuid4())
        server_files.append({"client_id": f.client_id, "file_id": file_id})
        # record for later logging
        _MANIFEST_INDEX[file_id] = {
            "bytes": f.bytes,
            "sha1": f.sha1,
            "name": f.name,
        }
    return {"serverFiles": server_files}


class InitIn(BaseModel):
    file_id: str
    size: int


@app.post("/upload/multipart/init")
def multipart_init(body: InitIn):
    key = f"tmp/{body.file_id}"
    resp = s3.create_multipart_upload(Bucket=AWS_BUCKET, Key=key)
    return {"uploadId": resp["UploadId"], "key": key}


@app.get("/upload/multipart/part-url")
def multipart_part_url(upload_id: str, part_number: int, key: str):
    try:
        url = s3.generate_presigned_url(
            ClientMethod="upload_part",
            Params={"Bucket": AWS_BUCKET, "Key": key,
                    "UploadId": upload_id, "PartNumber": int(part_number)},
            ExpiresIn=3600,
            HttpMethod="PUT",
        )
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class CompleteIn(BaseModel):
    upload_id: str
    key: str
    parts: List[Dict[str, Any]]


@app.post("/upload/multipart/complete")
def multipart_complete(body: CompleteIn):
    try:
        parts = [{"ETag": p["etag"], "PartNumber": int(
            p["partNumber"])} for p in body.parts]
        s3.complete_multipart_upload(
            Bucket=AWS_BUCKET,
            Key=body.key,
            UploadId=body.upload_id,
            MultipartUpload={"Parts": parts},
        )
        # helpful upload log
        file_id = body.key.split("/")[-1] if body.key else ""
        meta = _MANIFEST_INDEX.pop(file_id, None)
        size = meta.get("bytes") if isinstance(meta, dict) else None
        sha1 = meta.get("sha1") if isinstance(meta, dict) else None
        print(
            f"[S3_DEBUG] uploaded key=\"{body.key}\" size={size if size is not None else 'unknown'} sha1=\"{sha1 or ''}\"", flush=True)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/upload/signed-get-url")
def signed_get_url(key: str = Query(...)):
    try:
        url = s3.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": AWS_BUCKET, "Key": key},
            ExpiresIn=600,
            HttpMethod="GET",
        )
        return {"url": url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/upload/head")
def head_object(key: str = Query(...)):
    try:
        resp = s3.head_object(Bucket=AWS_BUCKET, Key=key)
        return {
            "exists": True,
            "content_length": resp.get("ContentLength"),
            "content_type": resp.get("ContentType"),
            "etag": resp.get("ETag"),
        }
    except Exception as e:
        return {"exists": False, "error": str(e)}


@app.post("/debug/log")
async def debug_log(req: Request):
    try:
        body = await req.json()
    except Exception:
        body = {"_parse_error": True}
    # print as single-line JSON (timestamped)
    import json
    import datetime
    ts = datetime.datetime.utcnow().isoformat() + "Z"
    line = json.dumps({"ts": ts, "source": "client", **
                      (body if isinstance(body, dict) else {"data": body})})
    print(line, flush=True)
    return {"ok": True}

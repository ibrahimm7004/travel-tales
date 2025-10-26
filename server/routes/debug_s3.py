import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query

from server.s3_client import get_s3, get_bucket, is_mock_mode


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/debug/s3", tags=["debug-s3"])


def _log(event: str, **kwargs: Any) -> None:
    payload = {"event": event, **kwargs}
    logger.info("[S3_DEBUG] %s", payload)


@router.get("/ping")
def ping() -> Dict[str, Any]:
    if is_mock_mode():
        _log("ping", mock=True)
        return {"ok": True, "mock": True}
    s3 = get_s3()
    bucket = get_bucket()
    try:
        if bucket:
            s3.head_bucket(Bucket=bucket)
        else:
            s3.list_buckets()
        region = s3.meta.config.region_name if hasattr(s3, "meta") else None
        _log("ping", ok=True, bucket=bucket, region=region)
        return {"ok": True, "bucket": bucket, "region": region}
    except Exception as e:
        _log("ping", ok=False, error=str(e))
        return {"ok": False, "error": str(e)}


@router.get("/list")
def list_objects(prefix: str = Query(None), max: int = Query(100)) -> Dict[str, Any]:
    if prefix is None or prefix == "":
        raise HTTPException(
            status_code=400, detail="prefix is required: /debug/s3/list?prefix=<path/>")
    if is_mock_mode():
        _log("list", mock=True, prefix=prefix, max=max)
        return {"mock": True, "items": []}
    if max < 1 or max > 1000:
        max = 100
    s3 = get_s3()
    bucket = get_bucket()
    try:
        resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=max)
        contents = resp.get("Contents", []) or []
        items = []
        for obj in contents:
            lm = obj.get("LastModified")
            if isinstance(lm, datetime):
                lm_str = lm.astimezone(timezone.utc).isoformat()
            else:
                lm_str = str(lm) if lm else None
            items.append({
                "key": obj.get("Key"),
                "size": int(obj.get("Size")) if obj.get("Size") is not None else 0,
                "lastModified": lm_str,
            })
        _log("list", prefix=prefix, count=len(items))
        return {"items": items}
    except Exception as e:
        _log("list", ok=False, error=str(e))
        return {"error": str(e)}


@router.get("/head")
def head_object(key: str = Query(...)) -> Dict[str, Any]:
    if is_mock_mode():
        _log("head", mock=True, key=key)
        return {"exists": False, "mock": True}
    s3 = get_s3()
    bucket = get_bucket()
    try:
        resp = s3.head_object(Bucket=bucket, Key=key)
        out = {
            "exists": True,
            "contentType": resp.get("ContentType"),
            "size": resp.get("ContentLength"),
            "etag": resp.get("ETag"),
            "lastModified": resp.get("LastModified").astimezone(timezone.utc).isoformat() if resp.get("LastModified") else None,
        }
        _log("head", key=key, exists=True)
        return out
    except Exception as e:
        # detect 404-ish
        msg = str(e)
        if "Not Found" in msg or "404" in msg or "NoSuchKey" in msg:
            _log("head", key=key, exists=False)
            return {"exists": False}
        _log("head", key=key, ok=False, error=msg)
        return {"exists": False, "error": msg}


@router.get("/signed-get")
def signed_get(key: str = Query(...), expires: int = Query(300)) -> Dict[str, Any]:
    if is_mock_mode():
        _log("signed-get", mock=True, key=key)
        return {"mock": True, "url": "mock://signed-get"}
    if expires < 30 or expires > 3600:
        raise HTTPException(
            status_code=400, detail="expires must be between 30 and 3600 seconds")
    s3 = get_s3()
    bucket = get_bucket()
    try:
        url = s3.generate_presigned_url(
            ClientMethod="get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires,
            HttpMethod="GET",
        )
        _log("signed-get", key=key, expires=expires)
        return {"url": url}
    except Exception as e:
        _log("signed-get", key=key, ok=False, error=str(e))
        return {"error": str(e)}





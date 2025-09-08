import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, UploadFile, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from sqlalchemy.orm import Session

from backend.models.photo import Photo
from backend.models.user import User
from backend.utils.config import settings
from backend.utils.security import get_db


router = APIRouter(prefix="/photos", tags=["photos"])


ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
MAX_SIZE = 15 * 1024 * 1024  # 15MB


bearer_optional = HTTPBearer(auto_error=False)


@router.post("/upload")
def upload_photos(
    files: List[UploadFile] = File(..., description="Multiple image files"),
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_optional),
):
    if not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="No files provided")

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not authenticated")

    try:
        payload = jwt.decode(credentials.credentials,
                             settings.JWT_SECRET, algorithms=["HS256"])
        user_id = int(payload.get("sub"))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    saved = []
    base_dir = os.path.join(os.path.dirname(__file__),
                            "..", "storage", str(user_id))
    base_dir = os.path.abspath(base_dir)
    os.makedirs(base_dir, exist_ok=True)

    for f in files:
        if f.content_type not in ALLOWED_MIME:
            raise HTTPException(
                status_code=415, detail=f"Unsupported content type: {f.content_type}")
        contents = f.file.read()
        if len(contents) > MAX_SIZE:
            raise HTTPException(
                status_code=413, detail="File too large (15MB max)")

        ext = {
            "image/jpeg": "jpg",
            "image/png": "png",
            "image/webp": "webp",
        }[f.content_type]
        filename = f"{uuid.uuid4().hex}.{ext}"
        path = os.path.join(base_dir, filename)
        with open(path, "wb") as out:
            out.write(contents)

        photo = Photo(user_id=user_id, path=path)
        db.add(photo)
        db.commit()
        db.refresh(photo)
        saved.append({"id": photo.id, "path": photo.path})

    return {"files": saved}

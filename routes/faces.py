"""
routes/faces.py
---------------
Generic image routes — not provider-specific.

POST /api/uploadImage   — save a PNG/JPG to public/uploads/, return its URL

AKOOL face detection (POST /api/detectFaces) lives in providers/akool/routes.py.
"""
import io
import uuid
from pathlib import Path
from PIL import Image
from fastapi import APIRouter, File, HTTPException, Request, UploadFile

from config import UPLOAD_DIR, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS, PUBLIC_BASE_URL
from routes.schemas import UploadImageResponse

router = APIRouter()


@router.post("/api/uploadImage", response_model=UploadImageResponse)
async def upload_image(request: Request, file: UploadFile = File(...)):
    """Upload a JPG or PNG image (max 1024×1024). Returns a public URL and whether the provider can reach it."""
    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS or file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Only JPG, JPEG, and PNG image files are accepted.",
        )

    filename  = f"{uuid.uuid4().hex}.jpg"
    save_path = UPLOAD_DIR / filename

    try:
        raw = await file.read()
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        img.thumbnail((1024, 1024), Image.LANCZOS)
        img.save(save_path, "JPEG", quality=100)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to process image: {exc}")
    finally:
        await file.close()

    base_url   = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    is_local   = "localhost" in base_url or "127.0.0.1" in base_url
    public_url = f"{base_url}/uploads/{filename}"

    return {
        "url":               public_url,
        "filename":          filename,
        "reachable_by_provider": not is_local,
    }



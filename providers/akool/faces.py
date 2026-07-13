"""
providers/akool/faces.py
-------------------------
AKOOL face detection logic — response parsing helpers and the detect_faces
route handler. Registered via the AKOOL provider router.
"""
import httpx
from fastapi import HTTPException

from providers.akool.client import AKOOL_BASE, require_fields
from providers.akool.auth_state import get_auth_headers


def _extract_face_opts(data: dict) -> str | None:
    """Parse face landmarks from AKOOL detect-faces response (4 known shapes)."""
    if "faces_obj" in data:
        face = data["faces_obj"].get("0", {})
        ls = face.get("landmarks_str", [])
        if ls:
            return ls[0]

    faces = (
        (data.get("data") or {}).get("faces")
        or (data.get("data") or {}).get("result", {}).get("faces")
        or []
    )
    if not faces:
        return None
    face = faces[0]

    lms = face.get("landmarks", [])
    if isinstance(lms, list) and len(lms) >= 4:
        return ":".join(f"{round(p['x'])},{round(p['y'])}" for p in lms[:4])

    lm = face.get("landmark")
    if lm:
        pts = [
            lm.get("left_eye_center"),
            lm.get("right_eye_center"),
            lm.get("mouth_left_corner") or lm.get("nose_tip"),
            lm.get("mouth_right_corner"),
        ]
        pts = [p for p in pts if p]
        if len(pts) >= 4:
            return ":".join(f"{round(p['x'])},{round(p['y'])}" for p in pts[:4])

    bbox = face.get("face_rectangle") or face.get("bbox")
    if bbox:
        if isinstance(bbox, list):
            x, y, w, h = bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]
        else:
            x, y = bbox.get("left", 0), bbox.get("top", 0)
            w, h = bbox.get("width", 100), bbox.get("height", 100)
        return f"{x},{y}:{x+w},{y}:{x+w},{y+h}:{x},{y+h}"

    return None


def _extract_face_preview_url(data: dict) -> str | None:
    """Extract cropped face preview URL from AKOOL detect-faces response."""
    if "faces_obj" in data:
        face = data["faces_obj"].get("0", {})
        urls = face.get("face_urls", [])
        if urls:
            return urls[0]
    faces = (
        (data.get("data") or {}).get("faces")
        or (data.get("data") or {}).get("result", {}).get("faces")
        or []
    )
    if not faces:
        return None
    return faces[0].get("face_url") or faces[0].get("cropped_face_url")


async def detect_faces(body: dict) -> dict:
    """Call AKOOL face detection API and return parsed face opts + preview URL."""
    require_fields(body, "url")

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                f"{AKOOL_BASE}/interface/detect-api/detect_faces",
                json={
                    "url":             body["url"],
                    "single_face":     False,
                    "return_face_url": True,
                    "num_frames":      1,
                },
                headers=get_auth_headers(),
                timeout=15,
            )
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Request to AKOOL timed out.")
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"Network error: {exc}")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="AKOOL returned a non-JSON response.")

    if resp.status_code != 200 or data.get("error_code", -1) != 0:
        msg = data.get("error_msg") or "Face detection failed."
        raise HTTPException(
            status_code=400,
            detail={"code": data.get("error_code"), "message": msg},
        )

    opts     = _extract_face_opts(data)
    face_url = _extract_face_preview_url(data)

    if not opts:
        raise HTTPException(status_code=400, detail="No face detected in the image.")

    return {"opts": opts, "face_url": face_url}

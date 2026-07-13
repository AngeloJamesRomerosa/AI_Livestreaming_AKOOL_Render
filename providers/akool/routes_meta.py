from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from providers.akool.faces import detect_faces as _detect_faces
from providers.akool.stream_profiles import get_profiles
from routes.schemas import (
    AgoraLogEntry, DetectFacesResponse, CreditResponse,
)

router = APIRouter()


# ── Agora log drain (stub — no server-side publisher in this build) ────────────

@router.get("/api/agora-log", response_model=list[AgoraLogEntry])
async def get_agora_log():
    """Returns buffered log messages from Agora publisher (empty — client-side mode)."""
    return JSONResponse([])


# ── Stream profiles ────────────────────────────────────────────────────────────

@router.get("/api/stream-profiles")
def get_stream_profiles():
    """Resolution + fps + bitrate quality table."""
    return get_profiles()


# ── Face detection ─────────────────────────────────────────────────────────────

@router.post("/api/detectFaces", response_model=DetectFacesResponse)
async def detect_faces_route(body: dict = Body(...)):
    """Calls AKOOL face detection and returns face landmarks (opts) and a preview image URL."""
    return await _detect_faces(body)


# ── Credit balance ──────────────────────────────────────────────────────────────

@router.get("/api/credit", response_model=CreditResponse)
async def get_credit():
    """Returns the current AKOOL account credit balance."""
    import httpx
    from providers.akool.client import AKOOL_BASE
    from providers.akool.auth_state import get_auth_headers
    headers = get_auth_headers()
    if not headers:
        return JSONResponse({'error': 'Not authenticated'}, status_code=401)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f'{AKOOL_BASE}/api/open/v3/faceswap/quota/info',
                headers=headers,
                timeout=10,
            )
        data = resp.json()
        if data.get('code') != 1000:
            return JSONResponse({'error': data.get('msg', 'AKOOL error')}, status_code=502)
        return JSONResponse({'credit': data['data']['credit']})
    except Exception as e:
        return JSONResponse({'error': str(e)}, status_code=502)

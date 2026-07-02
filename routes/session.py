"""
routes/session.py
-----------------
Session management routes — thin wrappers that delegate to the active provider.

POST /api/session/create  — start a new faceswap session
POST /api/session/close   — terminate session and free resources
"""
from fastapi import APIRouter, Body, HTTPException, Request, Query

from providers.registry import get_provider
from routes import state
from routes.schemas import SessionCreateResponse, ViewerUrlResponse, AkoolApiResponse

router = APIRouter()


@router.post("/api/session/create", response_model=SessionCreateResponse)
async def create_session(body: dict = Body(...)):
    """Start a new faceswap session. Returns session ID, status, and stream path.
    Rate-limited to 3 requests per IP per 60 seconds."""
    provider = get_provider()
    result   = await provider.create_session(body)

    session     = result["session"]
    stream_path = result["stream_path"]

    return {"code": 1000, "data": {
        "_id":           session.get("_id"),
        "status":        result["status"],
        "stream_path":   stream_path,
        "app_id":        session.get("app_id"),
        "channel_id":    session.get("channel_id"),
        "front_user_id": session.get("front_user_id"),
        "front_rtc_token": session.get("front_rtc_token"),
    }}


@router.get("/api/session/viewer-url", response_model=ViewerUrlResponse)
async def get_viewer_url(request: Request, sid: str = Query(...)):
    """Get the viewer URL and MJPEG stream URL for an active session."""
    secret = await state.get_stream_secret(sid)
    if not secret:
        raise HTTPException(status_code=404, detail="Session not found")
    base = str(request.base_url).rstrip('/')
    return {
        "viewer_url": f"{base}/viewer.html?key={secret}",
        "mjpeg_url":  f"{base}/stream.mjpeg?key={secret}&sid={sid}",
    }


@router.post("/api/session/close", response_model=AkoolApiResponse)
async def close_session(body: dict = Body(default={})):
    """Terminate a faceswap session and free all server-side resources."""
    sid = body.get("_id")
    return await get_provider().close_session(sid or "", body)

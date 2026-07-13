"""
routes/rtmp.py
--------------
Server-side RTMP live streaming routes.

POST /api/rtmp/start   — spawn ffmpeg, begin streaming to RTMP endpoint
POST /api/rtmp/stop    — terminate ffmpeg, clean up
GET  /api/rtmp/status  — current state + last ffmpeg error line
WS   /ws/audio-out     — receives PCM Int16 audio chunks from the browser mic

ffmpeg process management and audio TCP server live in routes/rtmp_ffmpeg.py.
"""
import asyncio
import shutil
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from routes.rtmp_ffmpeg import (
    start_audio_server, start_ffmpeg, stop_ffmpeg,
    get_ffmpeg_proc, get_status, enqueue_audio,
)
from routes.schemas import RtmpStatusResponse, RtmpStartResponse, OkResponse

router = APIRouter()


class RtmpConfig(BaseModel):
    rtmp_url: str
    stream_key: str


@router.get("/api/rtmp/status", response_model=RtmpStatusResponse)
async def rtmp_status():
    """Get the current RTMP streaming state and last ffmpeg stderr line."""
    return get_status()


@router.post("/api/rtmp/start", response_model=RtmpStartResponse)
async def rtmp_start(cfg: RtmpConfig):
    """Start streaming to an RTMP endpoint via ffmpeg. Waits 2 seconds to catch immediate connection failures."""
    if get_ffmpeg_proc() and get_ffmpeg_proc().poll() is None:
        return {"ok": False, "error": "Stream already running"}

    if not shutil.which("ffmpeg"):
        return {"ok": False, "error": "ffmpeg not found — install ffmpeg and ensure it is on PATH"}

    rtmp_endpoint = f"{cfg.rtmp_url.rstrip('/')}/{cfg.stream_key}"
    audio_server  = await start_audio_server()

    result = await start_ffmpeg(rtmp_endpoint, audio_server)
    if isinstance(result, str):
        audio_server.close()
        try:
            await asyncio.wait_for(audio_server.wait_closed(), timeout=3.0)
        except asyncio.TimeoutError:
            pass
        return {"ok": False, "error": f"Failed to launch ffmpeg: {result}"}

    # Wait briefly to catch immediate connection failures
    await asyncio.sleep(2.0)
    status = get_status()
    if not status["running"]:
        err = status["error"] or "ffmpeg exited — check RTMP URL and stream key"
        return {"ok": False, "error": err}

    return {"ok": True}


@router.post("/api/rtmp/stop", response_model=OkResponse)
async def rtmp_stop():
    """Stop the active RTMP stream and terminate the ffmpeg process."""
    await stop_ffmpeg()
    return {"ok": True}


@router.websocket("/ws/audio-out")
async def audio_out(ws: WebSocket):
    """Receives PCM Int16 mono 48000 Hz audio chunks from the browser."""
    await ws.accept()
    try:
        while True:
            chunk = await ws.receive_bytes()
            enqueue_audio(chunk)
    except WebSocketDisconnect:
        pass


# Re-export for routes/stream.py which imports get_ffmpeg_proc from here
__all__ = ["router", "get_ffmpeg_proc"]

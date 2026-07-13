"""
routes/stream_metrics.py
------------------------
Per-session stream metrics and relay activity log.

FPS and latency are keyed by session_id so concurrent users on the same
node never overwrite each other's stats. nginx routes all ?sid= requests
to the same node, so these in-process dicts are always consistent.

The relay log uses Redis when available so entries written on any node
(e.g. during session creation) are visible on all nodes.
"""
import json
import time
from collections import deque
from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse

from redis_client import get_redis
from routes.schemas import (
    TimeSyncResponse, StreamMetricsResponse, OkResponse, RelayLogEntry,
)

router = APIRouter()

# Per-session in-process metrics (nginx sticky routing keeps them accurate)
_stream_fps:          dict[str, int]   = {}
_stream_frame_count:  dict[str, int]   = {}
_stream_fps_window:   dict[str, float] = {}
_stream_latency:      dict[str, int]   = {}
_stream_transport_ms: dict[str, int]   = {}
_stream_jitter_ms:    dict[str, int]   = {}
_stream_decode_ms:    dict[str, int]   = {}
_stream_agora_fps:        dict[str, int]   = {}
_stream_agora_frames_ms:  dict[str, int]   = {}
_stream_stream_in_ms:     dict[str, int]   = {}
_stream_ws_upload_ms:     dict[str, int]   = {}
_stream_display_lag_ms:   dict[str, int]   = {}
_stream_display_fps:      dict[str, int]   = {}

# Freeze detection — accumulated between pipeline polls (read+reset in pipeline_metrics.py)
_stream_freeze_count:     dict[str, int]   = {}
_stream_max_frame_gap_ms: dict[str, int]   = {}
_stream_content_fps:      dict[str, int]   = {}

# In-memory relay log fallback (used when Redis is unavailable)
_relay_log_mem: deque = deque(maxlen=50)


@router.get("/api/time-sync", response_model=TimeSyncResponse)
async def time_sync():
    """NTP-style clock sync: client sends t1, we return t2/t3 so client can compute offset."""
    t2 = time.time() * 1000
    t3 = time.time() * 1000
    return JSONResponse({"t2": t2, "t3": t3})


@router.get("/api/metrics/stream", response_model=StreamMetricsResponse)
async def stream_metrics(sid: str = Query(default='')):
    """Get current FPS and end-to-end latency for a session's output stream."""
    return JSONResponse({
        "fps":     _stream_fps.get(sid, 0),
        "latency": _stream_latency.get(sid, 0),
    })


@router.post("/api/metrics/latency", response_model=OkResponse)
async def update_latency(request: Request, sid: str = Query(default='')):
    """Update client-measured latency components (transport, jitter, decode, display, freeze counts)."""
    data = await request.json()
    if "latency_ms"   in data: _stream_latency[sid]      = int(data.get("latency_ms",   0))
    if "transport_ms" in data: _stream_transport_ms[sid] = int(data.get("transport_ms", 0))
    if "jitter_ms" in data: _stream_jitter_ms[sid] = int(data.get("jitter_ms", 0))
    if "decode_ms"    in data: _stream_decode_ms[sid]    = int(data.get("decode_ms",    0))
    if "agora_fps"    in data: _stream_agora_fps[sid]    = int(data.get("agora_fps",    0))
    if "agora_frames_ms" in data:
        _stream_agora_frames_ms[sid]  = int(data.get("agora_frames_ms",  0))
    if "stream_in_ms" in data:
        _stream_stream_in_ms[sid]     = int(data.get("stream_in_ms",     0))
    if "ws_upload_ms" in data:
        _stream_ws_upload_ms[sid]     = int(data.get("ws_upload_ms",     0))
    if "display_lag_ms" in data:
        _stream_display_lag_ms[sid]   = int(data.get("display_lag_ms",   0))
    if "display_fps" in data:
        _stream_display_fps[sid]      = int(data.get("display_fps",      0))
    if "freeze_count" in data:
        _stream_freeze_count[sid]     = _stream_freeze_count.get(sid, 0) + int(data.get("freeze_count", 0))
    if "max_frame_gap_ms" in data:
        _stream_max_frame_gap_ms[sid] = max(_stream_max_frame_gap_ms.get(sid, 0), int(data.get("max_frame_gap_ms", 0)))
    if "content_fps" in data:
        _stream_content_fps[sid]      = int(data.get("content_fps", 0))
    return JSONResponse({"ok": True})


@router.post("/api/relay-log", response_model=OkResponse)
async def post_relay_log(request: Request):
    """Append a message to the relay activity log (stored in Redis when available)."""
    data  = await request.json()
    entry = json.dumps({"msg": data.get("msg", ""), "level": data.get("level", "info")})
    r = await get_redis()
    if r:
        await r.lpush("relay_log", entry)
        await r.ltrim("relay_log", 0, 49)
    else:
        _relay_log_mem.append(json.loads(entry))
    return JSONResponse({"ok": True})


@router.get("/api/relay-log", response_model=list[RelayLogEntry])
async def get_relay_log():
    """Drain and return all buffered relay log entries. Clears the log on each read."""
    r = await get_redis()
    if r:
        raw = await r.lrange("relay_log", 0, -1)
        await r.delete("relay_log")
        return JSONResponse([json.loads(m) for m in reversed(raw)])
    messages = list(_relay_log_mem)
    _relay_log_mem.clear()
    return JSONResponse(messages)


def clear_session_metrics(sid: str) -> None:
    """Remove all in-process metrics for a session. Call when a publisher disconnects."""
    _stream_fps.pop(sid, None)
    _stream_frame_count.pop(sid, None)
    _stream_fps_window.pop(sid, None)
    _stream_latency.pop(sid, None)
    _stream_transport_ms.pop(sid, None)
    _stream_jitter_ms.pop(sid, None)
    _stream_decode_ms.pop(sid, None)
    _stream_agora_fps.pop(sid, None)
    _stream_agora_frames_ms.pop(sid, None)
    _stream_stream_in_ms.pop(sid, None)
    _stream_ws_upload_ms.pop(sid, None)
    _stream_display_lag_ms.pop(sid, None)
    _stream_display_fps.pop(sid, None)
    _stream_freeze_count.pop(sid, None)
    _stream_max_frame_gap_ms.pop(sid, None)
    _stream_content_fps.pop(sid, None)


async def append_relay_log(msg: str, level: str = "info") -> None:
    """Write an entry to the relay log — used by session_helpers.py."""
    r = await get_redis()
    if r:
        await r.lpush("relay_log", json.dumps({"msg": msg, "level": level}))
        await r.ltrim("relay_log", 0, 49)
    else:
        _relay_log_mem.append({"msg": msg, "level": level})

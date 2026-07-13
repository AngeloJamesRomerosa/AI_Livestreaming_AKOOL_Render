"""
routes/stream.py
----------------
Generic frame viewer relay — provider-agnostic.

WS /ws/stream-in?sid=SESSION_ID — viewer (browser, OBS) receives frames here

_viewer_queues and _session_viewers are shared with providers/akool/routes.py
which owns /ws/stream-out (Agora publisher → server).

MJPEG endpoints live in routes/stream_mjpeg.py.
"""
import asyncio
import struct
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

router = APIRouter()

# session_id → {viewer_id → asyncio.Queue}
# Shared: providers/akool/routes.py writes frames here via stream-out.
_viewer_queues: dict[str, dict[int, asyncio.Queue]] = {}


def _session_viewers(session_id: str) -> dict[int, asyncio.Queue]:
    if session_id not in _viewer_queues:
        _viewer_queues[session_id] = {}
    return _viewer_queues[session_id]


@router.websocket("/ws/stream-in")
async def stream_in(ws: WebSocket, sid: str = Query(...)):
    """Pushes frames to a viewer (OBS Browser Source or any connected client)."""
    await ws.accept()
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)
    qid = id(ws)
    _session_viewers(sid)[qid] = queue
    try:
        while True:
            try:
                frame = await asyncio.wait_for(queue.get(), timeout=20)
                hdr = struct.pack('>d', time.time() * 1000)
                await ws.send_bytes(hdr + frame)
            except asyncio.TimeoutError:
                await ws.send_bytes(b'')
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception:
        pass
    finally:
        _viewer_queues.get(sid, {}).pop(qid, None)


def clear_session_viewers(session_id: str) -> None:
    """Remove the viewer queue dict for a session. Call on session teardown."""
    _viewer_queues.pop(session_id, None)

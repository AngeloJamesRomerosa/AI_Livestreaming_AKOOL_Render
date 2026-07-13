"""
providers/akool/routes_stream.py
---------------------------------
/ws/stream-out — receives JPEG frames from the browser OBS relay (obs.js)
and distributes them to connected viewers (/ws/stream-in) and optional RTMP.
"""
import asyncio
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

import routes.stream_metrics as _sm
from routes.stream_metrics import append_relay_log

router = APIRouter()

_ffmpeg_queue: asyncio.Queue = asyncio.Queue(maxsize=1)
_ffmpeg_task = None


async def _ffmpeg_writer():
    from routes.rtmp import get_ffmpeg_proc
    while True:
        frame = await _ffmpeg_queue.get()
        proc = get_ffmpeg_proc()
        if proc and proc.stdin and proc.poll() is None:
            try:
                await asyncio.to_thread(proc.stdin.write, frame)
            except Exception:
                pass


@router.websocket("/ws/stream-out")
async def stream_out(ws: WebSocket, sid: str = Query(...)):
    """Receives JPEG frames from the browser OBS relay and distributes to viewers."""
    global _ffmpeg_task

    from routes.stream import _session_viewers

    await ws.accept()

    if _ffmpeg_task is None or _ffmpeg_task.done():
        _ffmpeg_task = asyncio.create_task(_ffmpeg_writer())

    try:
        while True:
            frame = await ws.receive_bytes()
            if not frame:
                continue

            _sm._stream_frame_count[sid] = _sm._stream_frame_count.get(sid, 0) + 1
            now = time.monotonic()
            win = _sm._stream_fps_window.get(sid, 0.0)
            if win == 0.0:
                _sm._stream_fps_window[sid] = now
            elif (elapsed := now - win) >= 1.0:
                _sm._stream_fps[sid]         = round(_sm._stream_frame_count[sid] / elapsed)
                _sm._stream_frame_count[sid] = 0
                _sm._stream_fps_window[sid]  = now

            for queue in list(_session_viewers(sid).values()):
                try:
                    queue.put_nowait(frame)
                except asyncio.QueueFull:
                    pass
            try:
                _ffmpeg_queue.put_nowait(frame)
            except asyncio.QueueFull:
                pass
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    except Exception as e:
        await append_relay_log(
            f'[stream-out] Error — {type(e).__name__}: {e} (sid={sid[:8]})', 'error')
    finally:
        _sm.clear_session_metrics(sid)

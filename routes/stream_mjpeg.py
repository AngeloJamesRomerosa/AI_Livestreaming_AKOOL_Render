"""
routes/stream_mjpeg.py
----------------------
MJPEG streaming endpoint.

GET /stream.mjpeg?key=SECRET  — session-scoped MJPEG stream (OBS / pop-out window)
"""
import asyncio
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, StreamingResponse
from routes import state
from routes.stream import _session_viewers

router = APIRouter()


@router.get("/stream.mjpeg")
async def mjpeg_stream(key: str = Query(default="")):
    """MJPEG stream — OBS Media Source or pop-out window connects here.
    Requires ?key= matching the session stream secret (generated server-side).
    """
    session_id = await state.get_session_id_by_secret(key)
    if not session_id:
        return JSONResponse({"error": "Unauthorized"}, status_code=403)

    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    qid = id(queue)
    _session_viewers(session_id)[qid] = queue

    async def generate():
        try:
            while True:
                try:
                    frame = await asyncio.wait_for(queue.get(), timeout=20)
                    if frame:
                        yield (
                            b'--frame\r\n'
                            b'Content-Type: image/jpeg\r\n\r\n' +
                            frame +
                            b'\r\n'
                        )
                except asyncio.TimeoutError:
                    yield b'--frame\r\n\r\n'
        except asyncio.CancelledError:
            pass
        finally:
            _session_viewers(session_id).pop(qid, None)

    return StreamingResponse(
        generate(),
        media_type='multipart/x-mixed-replace; boundary=frame',
        headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'},
    )

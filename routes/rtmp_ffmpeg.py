"""
routes/rtmp_ffmpeg.py
---------------------
ffmpeg process management and audio TCP server for RTMP streaming.

Owned globals:
  _ffmpeg_proc   — the running ffmpeg subprocess
  _audio_server  — asyncio TCP server feeding PCM audio to ffmpeg
  _audio_queue   — browser mic chunks land here; _serve_audio drains it
  _running       — True while stream is active
  _last_error    — last line from ffmpeg stderr

Public API used by rtmp.py:
  start_audio_server()  — bind TCP server, return asyncio.Server
  start_ffmpeg()        — spawn ffmpeg subprocess
  stop_ffmpeg()         — terminate ffmpeg + close audio server
  get_ffmpeg_proc()     — read-only accessor (used by stream.py)
  get_status()          — {running, error} dict
"""
import asyncio
import subprocess

_ffmpeg_proc: subprocess.Popen | None = None
_audio_server: asyncio.Server | None  = None
_audio_queue: asyncio.Queue           = asyncio.Queue(maxsize=300)
_running      = False
_last_error   = ""
_AUDIO_PORT   = 5006


# ── Audio TCP server ──────────────────────────────────────────────────────────

async def _serve_audio(reader, writer):
    try:
        writer.write(bytes(19200))   # 0.2 s silence primer at 48000 Hz
        await writer.drain()
        while _running:
            try:
                chunk = await asyncio.wait_for(_audio_queue.get(), timeout=0.05)
                writer.write(chunk)
            except asyncio.TimeoutError:
                writer.write(bytes(4096))  # ~46 ms silence
            await writer.drain()
    except Exception:
        pass
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:
            pass


async def start_audio_server() -> asyncio.Server:
    return await asyncio.start_server(_serve_audio, "127.0.0.1", _AUDIO_PORT)


# ── ffmpeg stderr watcher (runs in a thread) ──────────────────────────────────

def _read_stderr_sync(proc: subprocess.Popen):
    global _last_error
    try:
        for line_bytes in proc.stderr:
            line = line_bytes.decode(errors="replace").strip()
            if line:
                _last_error = line
    except Exception:
        pass


async def _watch_ffmpeg(proc: subprocess.Popen):
    global _ffmpeg_proc, _audio_server, _running

    await asyncio.to_thread(_read_stderr_sync, proc)

    if _ffmpeg_proc is proc:
        _running     = False
        _ffmpeg_proc = None
        if _audio_server:
            _audio_server.close()
            try:
                await asyncio.wait_for(_audio_server.wait_closed(), timeout=3.0)
            except (asyncio.TimeoutError, Exception):
                pass
            _audio_server = None


# ── Public API ────────────────────────────────────────────────────────────────

async def start_ffmpeg(rtmp_endpoint: str, audio_server: asyncio.Server) -> 'subprocess.Popen | str':
    """Spawn ffmpeg. Returns the Popen object on success, or an error string."""
    global _ffmpeg_proc, _audio_server, _running, _last_error

    _audio_server = audio_server
    _last_error   = ""
    _running      = True

    cmd = [
        "ffmpeg", "-loglevel", "warning",
        "-thread_queue_size", "512",
        "-f", "mjpeg", "-framerate", "30", "-i", "pipe:0",
        "-thread_queue_size", "512",
        "-f", "s16le", "-ar", "48000", "-ac", "1",
        "-i", f"tcp://127.0.0.1:{_AUDIO_PORT}",
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-profile:v", "main",
        "-b:v", "2500k", "-maxrate", "2500k", "-bufsize", "5000k",
        "-pix_fmt", "yuv420p", "-g", "60",
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-f", "flv", rtmp_endpoint,
    ]

    try:
        proc = await asyncio.to_thread(
            lambda: subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
            )
        )
        _ffmpeg_proc = proc
        asyncio.create_task(_watch_ffmpeg(proc))
        return proc
    except Exception as exc:
        _running = False
        return str(exc)


async def stop_ffmpeg() -> None:
    global _ffmpeg_proc, _audio_server, _running

    _running = False

    if _ffmpeg_proc:
        try:
            _ffmpeg_proc.stdin.close()
        except Exception:
            pass
        try:
            _ffmpeg_proc.terminate()
        except Exception:
            pass
        try:
            await asyncio.wait_for(
                asyncio.to_thread(lambda: _ffmpeg_proc.wait(timeout=3)),
                timeout=4.0,
            )
        except Exception:
            try:
                _ffmpeg_proc.kill()
            except Exception:
                pass
        _ffmpeg_proc = None

    if _audio_server:
        _audio_server.close()
        try:
            await asyncio.wait_for(_audio_server.wait_closed(), timeout=3.0)
        except asyncio.TimeoutError:
            pass
        _audio_server = None


def get_ffmpeg_proc() -> 'subprocess.Popen | None':
    return _ffmpeg_proc


def get_status() -> dict:
    running = _ffmpeg_proc is not None and _ffmpeg_proc.poll() is None
    return {"running": running, "error": _last_error}


def enqueue_audio(chunk: bytes) -> None:
    try:
        _audio_queue.put_nowait(chunk)
    except asyncio.QueueFull:
        pass

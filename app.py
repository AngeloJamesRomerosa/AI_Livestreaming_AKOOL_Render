"""
app.py
------
Main entry point for the AKOOL Live Faceswap demo server.

Responsibilities:
  - Create the FastAPI application instance
  - Register the three API route groups (auth, faces, session)
  - Mount public/ as static files (serves index.html, viewer.html, CSS, JS)
  - Watch for 'q' + Enter in the terminal as an alternative quit method to Ctrl+C
  - Start uvicorn with hot-reload enabled for development
"""
import os
os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")
import sys
import asyncio
import signal
import logging
import threading
import time
from collections import defaultdict
from fastapi import FastAPI, Body, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

# asyncio.create_subprocess_exec requires ProactorEventLoop on Windows.
# SelectorEventLoop (the default in some uvicorn configs) raises NotImplementedError.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

from routes.auth           import router as auth_router
from routes.faces          import router as faces_router
from routes.session        import router as session_router
from routes.stream         import router as stream_router
from routes.stream_mjpeg   import router as stream_mjpeg_router
from routes.stream_metrics import router as stream_metrics_router
from routes.rtmp           import router as rtmp_router

from providers.registry import register_provider, get_provider, list_providers, set_default
from providers.akool.provider import AkoolProvider
from routes.schemas import (
    AuthStatusResponse, ProviderInfo, ProviderSelectResponse,
    ProviderConfigResponse, OkResponse,
)

# Register providers — add new providers here as they are implemented
register_provider("akool", AkoolProvider, default=True)

# ── Suppress noisy polling routes from uvicorn access log ─────────────────────
# /api/relay-log is polled every 3s — filter it out so it doesn't spam the terminal

_provider_polling = [r for p in list_providers() for r in get_provider(p["id"]).get_polling_routes()]

class _MutePollingRoutes(logging.Filter):
    _MUTED = ('/api/relay-log', '/api/metrics/face', '/api/metrics/stream', '/api/metrics/latency', '/api/metrics/pipeline',
              *_provider_polling)
    # Static asset paths — every page load fires 20+ of these; suppress all
    _STATIC = ('GET /js/', 'GET /css/', 'GET /uploads/', 'GET /favicon', 'GET /images/')
    def filter(self, record):
        msg = record.getMessage()
        if any(p in msg for p in self._MUTED):
            return False
        if any(s in msg for s in self._STATIC):
            return False
        return True

class _MuteShutdownNoise(logging.Filter):
    def filter(self, record):
        # Suppress CancelledError tracebacks from force-cancelled MJPEG streams on shutdown
        if record.exc_info and record.exc_info[1] is not None:
            if 'timeout graceful shutdown' in str(record.exc_info[1]):
                return False
        return 'timeout graceful shutdown' not in record.getMessage()

logging.getLogger('uvicorn.access').addFilter(_MutePollingRoutes())
logging.getLogger('uvicorn.error').addFilter(_MuteShutdownNoise())

# ── Rate limiting — /api/session/create: max 3 requests per IP per 60s ───────

_rl_lock    = threading.Lock()
_rl_buckets: dict[str, list[float]] = defaultdict(list)
_RL_LIMIT   = 3
_RL_WINDOW  = 60.0

class _RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/api/session/create":
            ip  = request.client.host if request.client else "unknown"
            now = time.monotonic()
            with _rl_lock:
                hits = [t for t in _rl_buckets[ip] if now - t < _RL_WINDOW]
                if hits:
                    _rl_buckets[ip] = hits
                else:
                    _rl_buckets.pop(ip, None)  # purge empty entries so dict never grows unbounded
                if len(_rl_buckets.get(ip, [])) >= _RL_LIMIT:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Too many session requests — please wait before trying again."},
                    )
                _rl_buckets[ip].append(now)
        return await call_next(request)


# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(title="AKOOL Live Faceswap Demo")
app.add_middleware(_RateLimitMiddleware)

templates = Jinja2Templates(directory="templates")

@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

# Register route groups — each module owns a distinct set of API paths
app.include_router(auth_router,             tags=["Authentication"])   # POST /api/getToken
app.include_router(faces_router,            tags=["Faces"])            # POST /api/uploadImage
app.include_router(session_router,          tags=["Session"])          # POST /api/session/create, update, close
app.include_router(stream_router,           tags=["Stream"])           # WS   /ws/stream-in (viewer relay)
app.include_router(stream_mjpeg_router,     tags=["Stream"])           # GET  /stream.mjpeg
app.include_router(stream_metrics_router,   tags=["Metrics"])          # GET/POST /api/metrics/stream + /api/relay-log
app.include_router(rtmp_router,             tags=["RTMP"])             # POST /api/rtmp/start, /api/rtmp/stop

# Register each provider's own router (Agora WS, internal pages, log drain, etc.)
for _p in list_providers():
    _provider_router = get_provider(_p["id"]).get_router()
    if _provider_router:
        app.include_router(_provider_router, tags=["Agora"])


# ── Auth status probe ─────────────────────────────────────────────────────────

@app.get("/api/authStatus", tags=["Authentication"], response_model=AuthStatusResponse)
async def auth_status():
    """Which credentials are configured — delegated to the active provider."""
    return get_provider().get_auth_status()


@app.get("/api/provider/list", tags=["Provider"], response_model=list[ProviderInfo])
async def provider_list():
    """Return all registered provider ids and display names."""
    return list_providers()


@app.post("/api/provider/select", tags=["Provider"], response_model=ProviderSelectResponse)
async def provider_select(body: dict = Body(default={})):
    """Set the global default provider (applies to all subsequent requests)."""
    name = body.get("provider")
    if not name:
        raise HTTPException(status_code=400, detail="Missing 'provider' field.")
    set_default(name)
    return {"ok": True, "provider": name}

@app.get("/api/provider/config", tags=["Provider"], response_model=ProviderConfigResponse)
async def provider_config(provider: str | None = None):
    """Return provider-specific client config (error codes, labels, log poll endpoint)."""
    return get_provider(provider).get_client_config()

@app.post("/api/metrics/report", tags=["Metrics"], response_model=OkResponse)
async def metrics_report(body: dict = Body(default={})):
    """No-op stub for client-side metric reporting."""
    return {"ok": True}


# Serve everything in public/ as static files.
# MUST be mounted last so the API routes above take priority over file lookups.
app.mount("/", StaticFiles(directory="public", html=True), name="static")


# ── Terminal quit watcher ─────────────────────────────────────────────────────

def _watch_for_quit() -> None:
    """
    Background daemon thread that monitors stdin.
    Typing 'q' + Enter stops both the uvicorn reloader and its worker process.
    On Windows we broadcast CTRL_C_EVENT to the whole console process group so
    the worker does not become an orphan holding the port after the reloader exits.
    """
    for line in sys.stdin:
        if line.strip().lower() == "q":
            print("\n  Shutting down…")
            if sys.platform == "win32":
                os.kill(0, signal.CTRL_C_EVENT)
            else:
                os.kill(os.getpid(), signal.SIGINT)
            return


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    from config import PORT

    # Daemon thread exits automatically when the main process does
    threading.Thread(target=_watch_for_quit, daemon=True).start()

    print("\n  AKOOL Live Faceswap Demo")
    print(f"  http://localhost:{PORT}")
    print("  Press Ctrl+C  — or —  type q + Enter  to stop\n")

    try:
        uvicorn.run("app:app", host="0.0.0.0", port=PORT, reload=True, lifespan="off", timeout_graceful_shutdown=3)
    except KeyboardInterrupt:
        print("\n  Server stopped. Goodbye!\n")

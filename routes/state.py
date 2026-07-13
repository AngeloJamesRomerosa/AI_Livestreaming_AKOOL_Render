"""
routes/state.py
---------------
Generic server-side session state — provider-agnostic.

Session data and stream secrets are stored in Redis when available, falling
back to in-process dicts for single-node local development.

Auth header management (AKOOL-specific) lives in providers/akool/auth_state.py.
"""
import json
import threading
import secrets as _secrets

from redis_client import get_redis

_sessions:       dict[str, dict] = {}
_stream_secrets: dict[str, str]  = {}
_secret_to_id:   dict[str, str]  = {}
_lock = threading.Lock()


async def set_session(session_data: dict) -> str:
    """Store session and return a fresh MJPEG stream secret."""
    sid    = session_data["_id"]
    secret = _secrets.token_urlsafe(16)
    r = await get_redis()
    if r:
        pipe = r.pipeline()
        pipe.set(f"session:{sid}", json.dumps(session_data))
        pipe.set(f"stream_secret:{sid}", secret)
        pipe.set(f"secret_sid:{secret}", sid)
        await pipe.execute()
    else:
        with _lock:
            _sessions[sid]        = session_data
            _stream_secrets[sid]  = secret
            _secret_to_id[secret] = sid
    return secret


async def get_session(session_id: str) -> dict | None:
    r = await get_redis()
    if r:
        data = await r.get(f"session:{session_id}")
        return json.loads(data) if data else None
    return _sessions.get(session_id)


async def get_session_id_by_secret(secret: str) -> str | None:
    r = await get_redis()
    if r:
        return await r.get(f"secret_sid:{secret}")
    return _secret_to_id.get(secret)


async def get_stream_secret(session_id: str) -> str | None:
    r = await get_redis()
    if r:
        return await r.get(f"stream_secret:{session_id}")
    return _stream_secrets.get(session_id)


async def clear_session(session_id: str) -> None:
    r = await get_redis()
    if r:
        secret = await r.get(f"stream_secret:{session_id}")
        pipe = r.pipeline()
        pipe.delete(f"session:{session_id}")
        pipe.delete(f"stream_secret:{session_id}")
        if secret:
            pipe.delete(f"secret_sid:{secret}")
        await pipe.execute()
    else:
        with _lock:
            secret = _stream_secrets.pop(session_id, None)
            if secret:
                _secret_to_id.pop(secret, None)
            _sessions.pop(session_id, None)


async def get_all_session_ids() -> list[str]:
    r = await get_redis()
    if r:
        keys = await r.keys("session:*")
        return [k.removeprefix("session:") for k in keys]
    return list(_sessions.keys())

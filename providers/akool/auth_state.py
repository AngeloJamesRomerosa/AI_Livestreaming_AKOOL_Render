"""
providers/akool/auth_state.py
------------------------------
AKOOL-specific server-side auth header state.

Stores either an API key (x-api-key) or a bearer token (Authorization) in
memory and returns the appropriate header dict for every AKOOL API call.
Credentials come from .env or from the browser via POST /api/auth/apikey or
POST /api/getToken.
"""
import os
import threading

_auth_header: dict = {}
_lock = threading.Lock()


def set_auth_apikey(key: str | None = None) -> None:
    global _auth_header
    resolved = os.getenv("AKOOL_API_KEY") or key
    if resolved:
        with _lock:
            _auth_header = {"x-api-key": resolved}


def set_auth_token(token: str) -> None:
    global _auth_header
    with _lock:
        _auth_header = {"Authorization": f"Bearer {token}"}


def get_auth_headers() -> dict:
    env_key = os.getenv("AKOOL_API_KEY")
    if env_key:
        return {"x-api-key": env_key}
    with _lock:
        return dict(_auth_header)

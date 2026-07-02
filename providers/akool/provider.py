"""
providers/akool/provider.py
----------------------------
AkoolProvider — FaceswapProvider implementation for AKOOL + Agora.

All AKOOL-specific API calls, session lifecycle management, and Agora
publisher control live here. The routes layer imports this via the registry
and stays provider-agnostic.
"""
import asyncio
import logging
import os
import httpx
from fastapi import HTTPException

from providers.base import FaceswapProvider
from providers.akool.client import AKOOL_BASE, parse_akool_response, require_fields
from providers.akool.auth_state import (
    set_auth_apikey, set_auth_token, get_auth_headers,
)
from providers.akool.session_helpers import _poll_until_ready
from routes import state

log = logging.getLogger(__name__)


class AkoolProvider(FaceswapProvider):
    """FaceswapProvider backed by AKOOL OpenAPI + Agora RTC."""

    name = "AKOOL / Agora"

    # ── Authentication ─────────────────────────────────────────────────────────

    async def authenticate(self, credentials: dict) -> dict:
        """
        Handle two auth flows:
          {"type": "apikey", "apiKey": "..."} — store API key
          {"type": "token", "clientId": "...", "clientSecret": "..."} — exchange for bearer token
        """
        auth_type = credentials.get("type", "apikey")

        if auth_type == "apikey":
            key = credentials.get("apiKey") or os.getenv("AKOOL_API_KEY")
            if not key:
                raise HTTPException(
                    status_code=400,
                    detail="No API key available — add AKOOL_API_KEY to .env or provide one.",
                )
            set_auth_apikey(key)
            return {"ok": True}

        # token flow
        client_id     = credentials.get("clientId")     or os.getenv("AKOOL_CLIENT_ID")
        client_secret = credentials.get("clientSecret") or os.getenv("AKOOL_CLIENT_SECRET")

        if not client_id or not client_secret:
            raise HTTPException(
                status_code=400,
                detail=(
                    "clientId and clientSecret are required. "
                    "Enter them in the UI or set AKOOL_CLIENT_ID / AKOOL_CLIENT_SECRET in .env."
                ),
            )

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{AKOOL_BASE}/api/open/v3/getToken",
                    json={"clientId": client_id, "clientSecret": client_secret},
                    timeout=10,
                )
                data = parse_akool_response(resp)
                set_auth_token(data["data"]["token"])
                return {"ok": True, "expire": data["data"].get("expire")}
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Request to AKOOL timed out.")
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Network error: {exc}")

    # ── Session lifecycle ──────────────────────────────────────────────────────

    async def create_session(self, body: dict) -> dict:
        require_fields(body, "sourceImage")

        async with httpx.AsyncClient() as client:
            try:
                payload = {"sourceImage": body["sourceImage"], "face_enhance": 1}
                if body.get("faceswapQuality"):
                    payload["faceswap_quality"] = int(body["faceswapQuality"])
                resp = await client.post(
                    f"{AKOOL_BASE}/api/open/v3/faceswap/live/create",
                    json=payload,
                    headers=get_auth_headers(),
                    timeout=15,
                )
                log.debug(f"[akool/create] status={resp.status_code} body={resp.text}")
                data = parse_akool_response(resp)
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Request to AKOOL timed out.")
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Network error: {exc}")

        session = data.get("data", {})
        status  = _session_status(session)
        if status != 2:
            updated = await _poll_until_ready(session["_id"])
            if updated:
                session = {**session, **updated}

        stream_secret = await state.set_session(session)
        stream_path   = f"/stream.mjpeg?key={stream_secret}&sid={session.get('_id', '')}"

        return {
            "session":    session,
            "stream_path": stream_path,
            "status":     _session_status(session),
        }

    async def update_session(self, body: dict) -> dict:
        require_fields(body, "sourceImage", "_id")
        sid     = body["_id"]
        session = await state.get_session(sid)
        if not session:
            raise HTTPException(status_code=400, detail="No active session — start one first.")

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{AKOOL_BASE}/api/open/v3/faceswap/live/update",
                    json={"_id": sid, "sourceImage": body["sourceImage"]},
                    headers=get_auth_headers(),
                    timeout=15,
                )
                return parse_akool_response(resp)
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Request to AKOOL timed out.")
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Network error: {exc}")

    async def close_session(self, session_id: str, body: dict | None = None) -> dict:
        if not session_id:
            return {"code": 1000, "msg": "No active session"}

        await state.clear_session(session_id)

        async with httpx.AsyncClient() as client:
            try:
                resp = await client.post(
                    f"{AKOOL_BASE}/api/open/v3/faceswap/live/close",
                    json={"_id": session_id},
                    headers=get_auth_headers(),
                    timeout=10,
                )
                return parse_akool_response(resp)
            except httpx.TimeoutException:
                raise HTTPException(status_code=504, detail="Request to AKOOL timed out.")
            except httpx.RequestError as exc:
                raise HTTPException(status_code=502, detail=f"Network error: {exc}")

    # ── Auth status ────────────────────────────────────────────────────────────

    def get_auth_status(self) -> dict:
        return {
            "hasApiKey":       bool(os.getenv("AKOOL_API_KEY")),
            "hasClientId":     bool(os.getenv("AKOOL_CLIENT_ID")),
            "hasClientSecret": bool(os.getenv("AKOOL_CLIENT_SECRET")),
        }

    # ── Provider-specific router ───────────────────────────────────────────────

    def get_router(self):
        from providers.akool.routes import router
        return router

    def get_polling_routes(self) -> list[str]:
        return ['/api/agora-log']

    def get_client_config(self) -> dict:
        return {
            "error_codes": {
                1003: "Parameter error — check that all required fields are filled in.",
                1101: "Token expired or invalid — please re-authenticate.",
                1102: "Authorization missing — authenticate before making requests.",
                1104: "Insufficient quota — check your AKOOL plan limits.",
            },
            "log_poll_endpoint": "/api/agora-log",
            "labels": {
                "session_starting": "Creating live faceswap session — waiting for AKOOL to be ready…",
                "session_closed":   "AKOOL session closed",
                "authenticated":    "Authenticated",
                "session_active":   "Session active",
            },
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _session_status(s: dict) -> int | None:
    """Return the highest status value from a session dict."""
    fs = s.get("faceswap_status")
    st = s.get("status")
    values = [v for v in (fs, st) if v is not None]
    return max(values) if values else None

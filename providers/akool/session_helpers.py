"""
providers/akool/session_helpers.py
-----------------------------------
Internal async helpers for the AKOOL session lifecycle.

  _poll_until_ready() — poll AKOOL until session status=2 or timeout
"""
import asyncio
import logging
import httpx
from fastapi import HTTPException

from providers.akool.client import AKOOL_BASE
from providers.akool.auth_state import get_auth_headers

log = logging.getLogger(__name__)


async def _fetch_session_status(session_id: str) -> tuple:
    """Single AKOOL poll. Returns (status, session_data) or (None, {}) on transient error."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{AKOOL_BASE}/api/open/v3/faceswap/live/info",
            json={"_id": session_id},
            headers=get_auth_headers(),
            timeout=10,
        )
    try:
        data = resp.json()
    except Exception:
        return None, {}

    if data.get("code") != 1000:
        log.debug(f"[poll_until_ready] not ready yet — code={data.get('code')} msg={data.get('msg')}")
        return None, {}

    session_data = data.get("data", {})
    status = session_data.get("faceswap_status") or session_data.get("status")
    log.debug(f"[poll_until_ready] status={status}")
    return status, session_data


async def _poll_until_ready(session_id: str, max_wait: float = 45.0, interval: float = 2.5) -> dict:
    """Poll AKOOL until session status=2 (ready) or timeout. Returns updated session data."""
    import time
    start = time.monotonic()
    consecutive_errors = 0

    while time.monotonic() - start <= max_wait:
        await asyncio.sleep(interval)
        try:
            status, session_data = await _fetch_session_status(session_id)
        except HTTPException:
            raise
        except Exception:
            consecutive_errors += 1
            if consecutive_errors >= 3:
                return {}
            continue

        if status is None:
            consecutive_errors += 1
            if consecutive_errors >= 3:
                return {}
            continue

        consecutive_errors = 0
        if status == 4:
            raise HTTPException(status_code=502, detail="Session failed on AKOOL server.")
        if status == 2:
            return session_data

    raise HTTPException(status_code=504, detail="Timed out waiting for AKOOL session to become ready.")

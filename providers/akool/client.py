"""
providers/akool/client.py
-------------------------
Shared helpers for every AKOOL API call.

  AKOOL_BASE             — base URL for all AKOOL OpenAPI requests
  parse_akool_response() — validates HTTP status + AKOOL response code
  require_fields()       — fast-fails with HTTP 400 on missing fields
"""
import httpx
from fastapi import HTTPException

AKOOL_BASE = "https://openapi.akool.com"

AKOOL_ERROR_MAP: dict[int, tuple[int, str]] = {
    1003: (400, "Parameter error — check that all required fields are provided."),
    1101: (401, "Token expired or invalid — please re-authenticate."),
    1102: (401, "Authorization missing — provide a valid token or API key."),
    1104: (429, "Insufficient quota — check your AKOOL plan limits."),
}


def parse_akool_response(resp: httpx.Response) -> dict:
    """Validate an httpx response from AKOOL and return the parsed JSON body."""
    try:
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=f"AKOOL returned HTTP {exc.response.status_code}: {exc.response.text[:200]}",
        )

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(status_code=502, detail="AKOOL returned a non-JSON response.")

    code = data.get("code")
    if code != 1000:
        http_status, default_msg = AKOOL_ERROR_MAP.get(code, (502, "AKOOL request failed."))
        msg = data.get("msg") or default_msg
        raise HTTPException(
            status_code=http_status,
            detail={"code": code, "message": msg},
        )

    return data


def require_fields(body: dict, *fields: str) -> None:
    """Raise HTTP 400 if any listed field is absent or empty in the request body."""
    missing = [f for f in fields if not body.get(f)]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required field(s): {', '.join(missing)}",
        )

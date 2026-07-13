"""
routes/auth.py
--------------
Authentication routes — thin wrappers that delegate to the active provider.

POST /api/auth/apikey  — store an API key server-side
POST /api/getToken     — exchange clientId/clientSecret for a bearer token
"""
from fastapi import APIRouter, Body

from providers.registry import get_provider
from routes.schemas import OkResponse, TokenResponse

router = APIRouter()


@router.post("/api/auth/apikey", response_model=OkResponse)
async def auth_apikey(body: dict = Body(default={})):
    """Accept an optional API key from the browser and store it server-side."""
    return await get_provider().authenticate({"type": "apikey", **body})


@router.post("/api/getToken", response_model=TokenResponse)
async def get_token(body: dict = Body(...)):
    """Exchange a clientId and clientSecret for a bearer token used in subsequent requests."""
    return await get_provider().authenticate({
        "type":         "token",
        "clientId":     body.get("clientId"),
        "clientSecret": body.get("clientSecret"),
    })

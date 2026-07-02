"""
providers/akool/routes.py
-------------------------
FastAPI router for the AKOOL + Agora provider.
Sub-modules handle distinct concerns; this file assembles them into one router.
"""
from fastapi import APIRouter
from providers.akool.routes_stream import router as _stream_router
from providers.akool.routes_meta   import router as _meta_router

router = APIRouter()
router.include_router(_stream_router)
router.include_router(_meta_router)

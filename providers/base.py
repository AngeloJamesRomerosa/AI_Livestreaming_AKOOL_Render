"""
providers/base.py
-----------------
Abstract base class for faceswap providers.

A provider encapsulates a specific faceswap API (e.g. AKOOL + Agora, a GCP
model, a self-hosted REST API). The routes layer calls these methods and stays
provider-agnostic.
"""
from abc import ABC, abstractmethod


class FaceswapProvider(ABC):
    """Abstract interface every faceswap provider must implement."""

    #: Short identifier used in /api/provider/list and provider selection.
    name: str = ""

    @abstractmethod
    async def authenticate(self, credentials: dict) -> dict:
        """Store credentials server-side. Returns {"ok": True, ...}."""
        ...

    @abstractmethod
    async def create_session(self, body: dict) -> dict:
        """Create a new faceswap session. Returns session data dict."""
        ...

    @abstractmethod
    async def update_session(self, body: dict) -> dict:
        """Swap source face on an active session."""
        ...

    @abstractmethod
    async def close_session(self, session_id: str, body: dict | None = None) -> dict:
        """Terminate a session and release provider resources."""
        ...

    def get_auth_status(self) -> dict:
        """Return which credentials are configured — used by /api/authStatus."""
        return {}

    def get_router(self):
        """Return a FastAPI APIRouter with provider-specific endpoints, or None."""
        return None

    def get_polling_routes(self) -> list[str]:
        """Return provider-specific routes that should be muted from access logs."""
        return []

    def get_client_config(self) -> dict:
        """Return provider-specific config served to the JS frontend via /api/provider/config."""
        return {
            "pipeline":         "ws_relay",
            "error_codes":      {},
            "log_poll_endpoint": None,
            "labels": {
                "session_starting": "Creating live session…",
                "session_closed":   "Session closed",
                "authenticated":    "Authenticated",
                "session_active":   "Session active",
            },
        }

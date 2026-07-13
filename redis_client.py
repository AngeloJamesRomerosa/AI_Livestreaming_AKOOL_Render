"""
redis_client.py
---------------
Async Redis connection singleton.

Falls back gracefully to None when Redis is unavailable so single-node
local development still works without running Redis. All callers check
the return value and fall back to their in-memory structures when None.
"""
import logging
import redis.asyncio as aioredis
from config import REDIS_URL

_redis: aioredis.Redis | None = None
_redis_available: bool | None = None  # None = untested, True/False = result cached
log = logging.getLogger(__name__)


async def get_redis() -> aioredis.Redis | None:
    global _redis, _redis_available
    if _redis_available is False:
        return None
    if _redis is None:
        try:
            _redis = aioredis.from_url(
                REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=2,
            )
            await _redis.ping()
            _redis_available = True
            print(f"[redis] Connected: {REDIS_URL}", flush=True)
        except Exception as exc:
            _redis_available = False
            _redis = None
            print(f"[redis] Unavailable ({exc}) — single-node mode", flush=True)
    return _redis

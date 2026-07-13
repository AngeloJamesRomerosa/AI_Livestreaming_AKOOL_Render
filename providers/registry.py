"""
providers/registry.py
---------------------
Provider registry and factory.

Usage:
    from providers.registry import register_provider, get_provider, list_providers

    register_provider("akool", AkoolProvider, default=True)
    provider = get_provider()            # returns default
    provider = get_provider("akool")     # explicit selection
    providers = list_providers()         # [{"id": "akool", "name": "AKOOL / Agora"}]
"""
from providers.base import FaceswapProvider

_registry:  dict[str, type[FaceswapProvider]] = {}
_instances: dict[str, FaceswapProvider] = {}
_default:   str | None = None


def register_provider(id: str, cls: type[FaceswapProvider], default: bool = False) -> None:
    """Register a provider class. Pass default=True to make it the active default."""
    global _default
    _registry[id] = cls
    if default or _default is None:
        _default = id


def get_provider(name: str | None = None) -> FaceswapProvider:
    """Return the provider instance for the given id (default: first registered)."""
    key = name or _default
    if not key or key not in _registry:
        raise ValueError(f"Unknown provider '{key}'. Available: {list(_registry)}")
    if key not in _instances:
        _instances[key] = _registry[key]()
    return _instances[key]


def list_providers() -> list[dict]:
    """Return metadata for all registered providers."""
    return [{"id": k, "name": cls.name} for k, cls in _registry.items()]


def set_default(name: str) -> None:
    """Change the global default provider (used when no name is specified)."""
    if name not in _registry:
        raise ValueError(f"Unknown provider '{name}'. Available: {list(_registry)}")
    global _default
    _default = name

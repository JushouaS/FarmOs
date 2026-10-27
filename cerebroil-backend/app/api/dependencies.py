"""
app/api/dependencies.py
────────────────────────
Shared FastAPI dependencies used across multiple routers.
"""
from __future__ import annotations

from fastapi import Header, HTTPException, Security, status
from fastapi.security import APIKeyHeader

from app.config import get_settings

settings = get_settings()

# ── API-Key scheme ────────────────────────────────────────────────────────────
_api_key_scheme = APIKeyHeader(name="X-API-Key", auto_error=False)


async def require_api_key(x_api_key: str | None = Security(_api_key_scheme)) -> str:
    """
    Dependency that enforces X-API-Key authentication.

    Usage:
        @router.post("/endpoint", dependencies=[Depends(require_api_key)])

    Raises HTTP 403 if the key is missing or not in the configured set.
    """
    if not x_api_key or x_api_key not in settings.api_key_set:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid or missing X-API-Key header.",
        )
    return x_api_key

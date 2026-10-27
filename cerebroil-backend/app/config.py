"""
app/config.py
─────────────
Application settings loaded from environment variables (or a .env file).
Uses Pydantic v2 BaseSettings so every value is type-checked at startup.
"""
from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic import AnyUrl, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Application ──────────────────────────────────────────
    APP_NAME: str = "Cerebroil API"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False

    # ── PostgreSQL (asyncpg DSN) ──────────────────────────────
    # Example: postgresql+asyncpg://user:password@localhost:5432/cerebroil
    DATABASE_URL: str

    # ── Security ─────────────────────────────────────────────
    # Comma-separated list of valid API keys for the telemetry endpoint
    API_KEYS: str = ""

    @property
    def api_key_set(self) -> set[str]:
        """Return the API keys as a set for O(1) lookup."""
        return {k.strip() for k in self.API_KEYS.split(",") if k.strip()}

    # ── CORS ─────────────────────────────────────────────────
    # Comma-separated list of allowed origins
    CORS_ORIGINS: str = "http://localhost:3000,http://localhost:8080"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    # ── Alert thresholds ─────────────────────────────────────
    # Fraction of frame area considered a clustering event
    CLUSTER_DENSITY_THRESHOLD: float = 0.75
    # Seconds of inactivity before raising a low_activity alert
    INACTIVITY_SECONDS_THRESHOLD: int = 300


@lru_cache
def get_settings() -> Settings:
    """Singleton – import and call this everywhere settings are needed."""
    return Settings()  # type: ignore[call-arg]

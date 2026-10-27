"""
app/main.py
───────────
FastAPI application factory.

Registers:
  • CORS middleware
  • API v1 routers  (telemetry, analytics, alerts)
  • WebSocket router
  • Startup / shutdown lifespan hooks
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.api.v1 import telemetry, analytics, alerts
from app.api import websockets as ws_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Startup: nothing special – engine is created lazily on first use.
    Shutdown: dispose the connection pool cleanly.
    """
    yield  # application runs here
    from app.database import engine
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    # ── CORS ─────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── HTTP routers ──────────────────────────────────────────────────────────
    from app.api.v1 import farms, batches
    app.include_router(farms.router,    prefix="/api/v1", tags=["Farms & Houses"])
    app.include_router(batches.router,  prefix="/api/v1", tags=["Batches & Growth"])
    app.include_router(telemetry.router, prefix="/api/v1", tags=["Telemetry"])
    app.include_router(analytics.router, prefix="/api/v1", tags=["Analytics"])
    app.include_router(alerts.router,    prefix="/api/v1", tags=["Alerts"])

    # ── WebSocket router ──────────────────────────────────────────────────────
    app.include_router(ws_router.router, tags=["WebSockets"])

    # ── Health check ──────────────────────────────────────────────────────────
    @app.get("/health", tags=["Health"])
    async def health() -> dict[str, str]:
        return {"status": "ok", "version": settings.APP_VERSION}

    return app


app = create_app()

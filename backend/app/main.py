"""FastAPI application factory.

Run locally::

    uvicorn app.main:create_app --factory --reload --port 8000

OpenAPI docs are served at /api/docs (Swagger UI) and /api/redoc.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routers import api_router
from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.rate_limit import RateLimiter
from app.core.signing import UrlSigner
from app.db.session import create_engine, create_sessionmaker
from app.services.model_service import ModelService
from app.storage import create_storage

log = logging.getLogger("app")

DESCRIPTION = """
Interpretable deep learning for dermoscopic skin-lesion analysis.

A convolutional neural network classifies an uploaded dermoscopic image into the
classes defined by the loaded model card, reports calibrated class probabilities and
an uncertainty assessment, and explains the prediction with a Grad-CAM heatmap.

**This API provides assistive model outputs for research and clinical decision support.
It is not a medical diagnosis and must not replace evaluation by a qualified healthcare
professional.**

Authenticate with `POST /api/auth/login`, then send `Authorization: Bearer <access_token>`.
"""


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_engine(settings)
        app.state.engine = engine
        app.state.sessionmaker = create_sessionmaker(engine)
        app.state.storage = create_storage(settings)
        app.state.signer = UrlSigner(
            settings.jwt_secret.get_secret_value(), default_ttl=settings.signed_url_ttl_seconds
        )
        app.state.rate_limiter = RateLimiter()
        models = ModelService(settings)
        app.state.models = models
        await anyio.to_thread.run_sync(models.load)
        try:
            async with app.state.sessionmaker() as session:
                await models.register(session)
        except Exception:
            log.exception("could not register the model version; will retry on first use")
        log.info(
            "application started",
            extra={
                "environment": settings.environment,
                "model_status": models.status,
                "storage": app.state.storage.name,
            },
        )
        try:
            yield
        finally:
            await engine.dispose()
            log.info("application stopped")

    docs = settings.docs_enabled
    app = FastAPI(
        title=f"{settings.app_name} API",
        version=settings.app_version,
        description=DESCRIPTION,
        lifespan=lifespan,
        docs_url="/api/docs" if docs else None,
        redoc_url="/api/redoc" if docs else None,
        openapi_url="/api/openapi.json" if docs else None,
        swagger_ui_parameters={"persistAuthorization": False, "displayRequestDuration": True},
    )
    app.state.settings = settings
    register_exception_handlers(app)

    # Middleware added last runs first (outermost).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Content-Disposition", "Retry-After"],
        max_age=600,
    )
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_upload_bytes + 256 * 1024)
    app.add_middleware(SecurityHeadersMiddleware, hsts=settings.is_production)
    app.add_middleware(RequestContextMiddleware)

    app.include_router(api_router, prefix="/api")
    return app

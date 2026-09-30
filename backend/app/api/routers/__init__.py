"""API router assembly."""

from fastapi import APIRouter

from app.api.routers import analyses, auth, files, health, inference, model, stats, users

api_router = APIRouter()
for module in (health, auth, users, analyses, inference, model, stats, files):
    api_router.include_router(module.router)

__all__ = ["api_router"]

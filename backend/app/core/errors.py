"""Application errors and their HTTP mapping.

Every error response has the same envelope::

    {"error": {"code": "model_unavailable", "message": "...", "request_id": "..."}}

``code`` is stable and machine-readable; ``message`` is safe to show to users.
Internal details (stack traces, SQL, file paths) are logged, never returned.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DBAPIError, OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_var

log = logging.getLogger("app.errors")


class AppError(Exception):
    status_code = 500
    code = "internal_error"
    message = "An unexpected error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message or self.message)
        self.message = message or self.message
        self.code = code or self.code
        self.details = details
        self.headers = headers


class BadRequestError(AppError):
    status_code = 400
    code = "bad_request"
    message = "The request is invalid."


class AuthenticationError(AppError):
    status_code = 401
    code = "not_authenticated"
    message = "Authentication is required."

    def __init__(self, message: str | None = None, **kwargs: Any) -> None:
        kwargs.setdefault("headers", {"WWW-Authenticate": "Bearer"})
        super().__init__(message, **kwargs)


class PermissionDeniedError(AppError):
    status_code = 403
    code = "permission_denied"
    message = "You do not have permission to perform this action."


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"
    message = "The requested resource was not found."


class ConflictError(AppError):
    status_code = 409
    code = "conflict"
    message = "The request conflicts with the current state of the resource."


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "payload_too_large"
    message = "The uploaded file is too large."


class UnsupportedMediaTypeError(AppError):
    status_code = 415
    code = "unsupported_media_type"
    message = "Unsupported file type."


class UnprocessableError(AppError):
    status_code = 422
    code = "unprocessable"
    message = "The request could not be processed."


class RateLimitedError(AppError):
    status_code = 429
    code = "rate_limited"
    message = "Too many requests. Please wait and try again."


class ModelUnavailableError(AppError):
    status_code = 503
    code = "model_unavailable"
    message = "The analysis model is not available."


class InferenceError(AppError):
    status_code = 500
    code = "inference_failed"
    message = "The model failed to analyse this image. The error has been logged."


class DatabaseUnavailableError(AppError):
    status_code = 503
    code = "database_unavailable"
    message = "The database is temporarily unavailable. Please try again shortly."


def _envelope(code: str, message: str, details: Any = None) -> dict[str, Any]:
    body: dict[str, Any] = {"code": code, "message": message, "request_id": request_id_var.get()}
    if details:
        body["details"] = details
    return {"error": body}


def _clean_validation_errors(errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop ``input``/``ctx`` so submitted values (e.g. passwords) are never echoed."""
    return [
        {"loc": [str(p) for p in err.get("loc", ())], "msg": err.get("msg", ""), "type": err.get("type", "")}
        for err in errors
    ]


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError) -> JSONResponse:
        if exc.status_code >= 500:
            log.error("application error", extra={"code": exc.code}, exc_info=exc)
        return JSONResponse(
            _envelope(exc.code, exc.message, exc.details),
            status_code=exc.status_code,
            headers=exc.headers,
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            _envelope(
                "validation_error",
                "Some fields are missing or invalid.",
                {"fields": _clean_validation_errors(list(exc.errors()))},
            ),
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(_envelope(code, message), status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(OperationalError)
    @app.exception_handler(DBAPIError)
    async def _database(_: Request, exc: Exception) -> JSONResponse:
        log.error("database error", exc_info=exc)
        err = DatabaseUnavailableError()
        return JSONResponse(_envelope(err.code, err.message), status_code=err.status_code)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled error", exc_info=exc)
        err = AppError()
        return JSONResponse(_envelope(err.code, err.message), status_code=500)

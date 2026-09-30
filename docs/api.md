# API reference

Interactive documentation is served by the running API:

* Swagger UI: `/api/docs`
* ReDoc: `/api/redoc`
* OpenAPI schema: `/api/openapi.json` (a snapshot is committed at `docs/openapi.json`)

Set `DOCS_ENABLED=false` to hide them in production.

## Conventions

* Base path `/api`. Resource collections are plural (`/api/analyses`).
* JSON everywhere except uploads (`multipart/form-data`), the PDF report and image files.
* Timestamps are ISO 8601 in UTC. IDs are UUIDs.
* Every response carries `X-Request-ID` (send your own to correlate client and server logs).
* Errors use one envelope; `code` is stable and machine-readable, `message` is safe to show:

```json
{ "error": { "code": "model_unavailable", "message": "Model weights are not available: ...", "request_id": "3f2a..." } }
```

Validation errors add `details.fields` (`loc`, `msg`, `type`). Submitted values are never
echoed back, so a rejected password never appears in a response.

## Authentication

1. `POST /api/auth/register` or `POST /api/auth/login` returns an access token and sets an
   httpOnly refresh cookie (`lesionlens_refresh`, path `/api/auth`, SameSite=Strict).
2. Send `Authorization: Bearer <access_token>` on every other request. Tokens last 15 minutes.
3. `POST /api/auth/refresh` (cookie only) returns a new access token and **rotates** the
   cookie. Presenting an already-rotated token revokes the whole session family, except
   within a 20-second grace window that covers parallel refreshes from several tabs.
4. `POST /api/auth/logout` revokes the current refresh token and clears the cookie.

```bash
curl -s -c jar -H 'Content-Type: application/json' \
  -d '{"email":"me@example.org","password":"a-long-password-1"}' \
  http://localhost:8000/api/auth/login | jq -r .access_token > token
```

## Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health/live` | - | Liveness probe |
| GET | `/api/health` | - | Database, storage and model status; 503 if DB or storage is down |
| POST | `/api/auth/register` | - | Create account, start session (201) |
| POST | `/api/auth/login` | - | Start session |
| POST | `/api/auth/refresh` | cookie | Rotate refresh cookie, new access token |
| POST | `/api/auth/logout` | cookie | End session (204) |
| GET | `/api/auth/me` | Bearer | Current user |
| PATCH | `/api/users/me` | Bearer | Update full name |
| POST | `/api/users/me/password` | Bearer | Change password; revokes other sessions (204) |
| DELETE | `/api/users/me` | Bearer | Delete the account, all analyses and stored files; body `{"password": ...}` (204) |
| POST | `/api/analyses` | Bearer | Upload image; predict, explain, store; returns full result (201) |
| GET | `/api/analyses` | Bearer | History with search, filters, sorting, pagination |
| GET | `/api/analyses/{id}` | Bearer | Full result |
| DELETE | `/api/analyses/{id}` | Bearer | Delete analysis, predictions and files (204) |
| POST | `/api/analyses/{id}/predictions` | Bearer | Re-run with the currently loaded model (201; 409 if already current) |
| GET | `/api/analyses/{id}/explanations/{class}` | Bearer | Grad-CAM for any class (cached; 409 if the loaded model differs) |
| GET | `/api/analyses/{id}/report?tz=` | Bearer | PDF report |
| POST | `/api/predict` | Bearer | Stateless classification (nothing stored) |
| POST | `/api/explain` | Bearer | Stateless classification + Grad-CAM as base64 images |
| GET | `/api/model/info` | Bearer | Loaded model card summary, classes, thresholds, status |
| GET | `/api/model/metrics` | Bearer | Held-out evaluation (only if it matches the loaded weights) + training history |
| GET | `/api/model/inference-stats?scope=` | Bearer | Aggregates of real predictions by the loaded model (`all` needs admin) |
| POST | `/api/model/reload` | Admin | Reload the artifact at `MODEL_PATH` |
| GET | `/api/stats/overview?tz=` | Bearer | Dashboard statistics from stored analyses |
| GET | `/api/files/{token}` | signed URL | Stored images for `<img>`/canvas use |

### History query parameters

`q` (file name, analysis ID or class code), `predicted_class`, `min_confidence`,
`max_confidence` (0-1), `uncertain` (bool), `date_from`, `date_to` (ISO 8601),
`model_version_id`, `sort` (`created_at` | `confidence` | `predicted_class`), `order`
(`asc` | `desc`), `page` (1+), `page_size` (1-100).

## Example: analyse an image

```bash
curl -s -H "Authorization: Bearer $(cat token)" \
  -F "file=@lesion.jpg;type=image/jpeg" http://localhost:8000/api/analyses | jq '.prediction | {predicted_class, confidence, uncertainty}'
```

Abridged response:

```json
{
  "id": "5b8e...",
  "created_at": "2026-09-30T10:12:03Z",
  "original_filename": "lesion.jpg",
  "image": { "url": "/api/files/eyJu...", "width": 600, "height": 450, "sha256": "..." },
  "quality": { "warnings": [] },
  "prediction": {
    "model": { "display_name": "EfficientNet-B0", "version": "1.0.0", "trained": true, "weights_sha256": "..." },
    "predicted_class": { "code": "nv", "name": "Melanocytic nevus", "group": "benign" },
    "confidence": 0.81,
    "probabilities": [ { "code": "nv", "probability": 0.81 }, { "code": "mel", "probability": 0.11 } ],
    "uncertainty": { "uncertain": false, "reasons": [], "margin": 0.70, "normalized_entropy": 0.31 },
    "concern": { "probability": 0.14, "classes": ["akiec", "bcc", "mel"] },
    "temperature": 1.19,
    "timing": { "inference_ms": 41.7, "explain_ms": 96.2 },
    "explanation": { "status": "completed", "heatmap_url": "/api/files/...", "cam_url": "/api/files/..." }
  }
}
```

The values above illustrate the shape only. Real values come from the loaded model.

## Status codes you should handle

| Status | Codes | When |
|---|---|---|
| 400 | `invalid_current_password`, `password_unchanged` | Wrong password for a password change or account deletion |
| 401 | `not_authenticated`, `invalid_token`, `token_expired`, `invalid_credentials`, `session_revoked` | Auth problems |
| 403 | `permission_denied`, `registration_disabled` | Admin-only endpoint; sign-up turned off (`REGISTRATION_ENABLED=false`) |
| 404 | `not_found`, `unknown_class`, `file_not_found` | Missing, not yours, or expired link |
| 409 | `email_taken`, `already_current`, `model_version_mismatch` | Conflicting state |
| 413 | `file_too_large`, `payload_too_large` | Upload over `MAX_UPLOAD_BYTES` |
| 415 | `unsupported_format`, `animated_image` | Not a JPEG/PNG/WebP image |
| 422 | `validation_error`, `corrupted_image`, `image_too_small`, `image_dimensions_too_large`, `empty_file`, `invalid_timezone` | Invalid input |
| 429 | `rate_limited` (with `Retry-After`) | Too many requests |
| 500 | `inference_failed`, `internal_error` | Logged with the request ID |
| 503 | `model_unavailable`, `database_unavailable` | Dependency not ready |

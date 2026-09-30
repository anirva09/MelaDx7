# Deployment

## Option A: Docker Compose (recommended)

Requirements: Docker Engine 24+ with the Compose plugin.

```bash
cp .env.example .env
# Edit .env:
#   JWT_SECRET=<output of: openssl rand -hex 32>
#   POSTGRES_PASSWORD=<a strong password>
#   MODEL_DIR=efficientnet_b0-v1.0.0      # a folder inside ./models
docker compose up --build -d
docker compose ps                          # all three services should become healthy
```

Open http://localhost:8080. The API is reached through nginx at `/api` (Swagger UI at
http://localhost:8080/api/docs).

| Service | Image | Notes |
|---|---|---|
| `db` | postgres:16-alpine | Data in the `db-data` volume; not published to the host |
| `backend` | built from `backend/Dockerfile` (repo root context) | Runs `alembic upgrade head` on start, then uvicorn; CPU PyTorch; non-root user; `./models` mounted read-only |
| `frontend` | built from `frontend/Dockerfile` | nginx serving the SPA with CSP and caching, proxying `/api` |

Containers run with `ENVIRONMENT=production` unless `COMPOSE_ENVIRONMENT=development`
is set. Production mode enforces secure cookies, explicit CORS origins, and refuses
untrained models.

### No trained model yet?

The stack still starts; the UI shows "Model weights are not available" with setup steps,
and inference endpoints return `503`. To click through the full workflow with an
**untrained** pipeline-verification model (outputs are meaningless and labelled as such):

```bash
docker compose run --rm -v "$PWD/models:/app/models" backend \
  python -m ml.scripts.create_untrained_artifact --output /app/models/dev-untrained
# .env: MODEL_DIR=dev-untrained, ALLOW_UNTRAINED_MODEL=true, COMPOSE_ENVIRONMENT=development
docker compose up -d
```

### Create an administrator

```bash
docker compose exec backend python -m app.cli create-user --email admin@example.org --name "Admin" --admin
# or promote an existing account
docker compose exec backend python -m app.cli promote-admin someone@example.org
```

Admins can reload the model (`POST /api/model/reload`) and see inference statistics for
all users. Set `REGISTRATION_ENABLED=false` to allow only accounts created this way.

### Housekeeping

Refresh-token rows accumulate as sessions rotate. Prune them daily (cron or a scheduled job):

```bash
docker compose exec backend python -m app.cli prune-sessions --days 7
```

### Updating the model

1. Train a new artifact (bump `model.version`) and copy it into `./models`.
2. Set `MODEL_DIR` to the new folder and `docker compose up -d backend`, or keep the
   folder name stable and call `POST /api/model/reload`.
3. Old analyses keep their model version; users can re-run them with the new model.

## Option B: local development without Docker

Requirements: Python 3.11+, Node 20+, PostgreSQL 14+.

```bash
python -m venv .venv && source .venv/bin/activate
make install                                  # CPU torch, backend deps, `pip install -e .`, npm ci
cp .env.example .env                          # set JWT_SECRET and DATABASE_URL
createdb lesionlens                           # or use any PostgreSQL instance
make migrate
make dev-model                                # optional: untrained model for UI work
#   .env: MODEL_PATH=models/dev-untrained, ALLOW_UNTRAINED_MODEL=true
make api                                      # http://localhost:8000/api/docs
make web                                      # http://localhost:5173 (proxies /api)
```

## Production checklist

* [ ] `ENVIRONMENT=production`, strong unique `JWT_SECRET` and database password.
* [ ] Serve over **HTTPS** (put Caddy, Traefik or a cloud load balancer in front of the
  `frontend` service). Secure cookies require it outside `localhost`.
* [ ] `CORS_ORIGINS` / `PUBLIC_URL` set to the real origin.
* [ ] A trained model with `metrics.json`; `ALLOW_UNTRAINED_MODEL=false`.
* [ ] `DOCS_ENABLED=false` if the API should not be self-documenting publicly.
* [ ] Backups: `pg_dump` of the database and a copy of the uploads volume or bucket.
* [ ] Log shipping: the API writes one JSON object per line to stdout (request ID, user
  ID, method, path, status, duration, inference timings; never passwords or tokens).
* [ ] Monitor `GET /api/health` (503 when the database or storage is unavailable; the
  `model` check reports `ready`, `untrained` or `unavailable`).
* [ ] Review data-protection obligations before storing any real clinical images.

## Scaling notes

* **Inference** runs in-process in a thread pool bounded by `MAX_CONCURRENT_INFERENCES`;
  set `MODEL_NUM_THREADS` to the CPU cores available per container.
* **Multiple API replicas** work with S3 storage and a shared PostgreSQL. Replace the
  in-memory rate limiter (`app/core/rate_limit.py`) with a Redis-backed one so limits are
  global.
* **Object storage:** set `STORAGE_BACKEND=s3` and the `S3_*` variables (works with AWS
  S3, MinIO, Cloudflare R2). Buckets stay private; images are served via signed API URLs.
* **GPU inference:** set `MODEL_DEVICE=cuda` and build the backend image with a CUDA
  PyTorch index (`--build-arg TORCH_INDEX_URL=https://download.pytorch.org/whl/cu124`).
* A separate inference service (e.g. TorchServe or a queue worker) is the next step if
  inference load grows; the `InferenceEngine` interface already isolates it.

## Continuous integration

`.github/workflows/ci.yml` runs lint, type checks, ML tests, backend tests against SQLite
and PostgreSQL, frontend lint/typecheck/tests/build, and builds both Docker images.

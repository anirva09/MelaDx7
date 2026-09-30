# Deployment

## Option A: Docker Compose (recommended)

Requirements: Docker Engine 24+ with the Compose plugin.

```bash
cp .env.example .env
# Edit .env:
#   JWT_SECRET=<output of: openssl rand -hex 32>
#   POSTGRES_PASSWORD=<a strong password>
#   MODEL_DIR=vit_base_patch16_224-v1.0.0 # a folder inside ./models (see "Model weights" below)
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

### Model weights

The trained artifact (`model.pt` ~330 MB + `model_card.json` + `metrics.json`) is **not in git**.
Train it (see [training.md](training.md)) or obtain a copy from the project's release, and unzip it
so that `./models/vit_base_patch16_224-v1.0.0/model.pt` exists. The weights derive from
CC BY-NC data: non-commercial use only.

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

## Option B: Render (all services)

`render.yaml` is a Render Blueprint: PostgreSQL + the API (Docker) + the web app (Docker,
nginx). The browser only talks to the web service, which proxies `/api` to the API over
Render's private network, so the httpOnly SameSite=Strict refresh cookie stays first-party.

1. **Publish the model zip somewhere with a stable HTTPS URL** (for example a GitHub Release
   asset) and compute its hash:
   ```bash
   cd models && zip -qr vit_base_patch16_224-v1.0.0.zip vit_base_patch16_224-v1.0.0 -x "*/checkpoints/*"
   sha256sum vit_base_patch16_224-v1.0.0.zip
   ```
2. In Render: **New -> Blueprint**, pick the repository. Render reads `render.yaml`.
3. When prompted, set `MODEL_URL` (the zip URL) and `MODEL_SHA256` (the hash). They are used
   as Docker build args: the build refuses the download if the hash differs, and the app then
   checks `model.pt` against the model card again.
4. Deploy. The first build installs PyTorch (CPU) and downloads the model; expect 10-15 minutes.
   `GET /api/health` should report `"model": "ready"`.

**Costs and limits.** The ViT needs roughly 1.5-2 GB of RAM to serve, so the API uses Render's
2 GB `standard` plan (paid). The 512 MB plans are killed on start-up; free tiers will not run
this model. Inference runs on CPU (about a second per image). Uploads are stored on a 1 GB
persistent disk; use the S3 storage backend for anything larger. The in-memory rate limiter is
per process.

**Why not Vercel?** Vercel's serverless functions cannot hold PyTorch plus a 330 MB model, so
the API cannot run there. Vercel could serve only the static frontend, but then the browser
would call another origin and the `SameSite=Strict` session cookie would be blocked unless
`/api` were proxied through Vercel `rewrites`. Keeping both on Render avoids that.

## Option C: local development without Docker

Requirements: Python 3.11+, Node 20+, PostgreSQL 14+.

```bash
python -m venv .venv && source .venv/bin/activate
make install                                  # CPU torch, backend deps, `pip install -e .`, npm ci
cp .env.example .env                          # set JWT_SECRET and DATABASE_URL
createdb lesionlens                           # or use any PostgreSQL instance
make migrate
make dev-model                                # optional: random-weights model for UI work only
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

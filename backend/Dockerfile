# syntax=docker/dockerfile:1.7
# MelaDx7 API (FastAPI + PyTorch CPU inference). Build context: repository root.
#   docker build -f backend/Dockerfile -t meladx7-api .

ARG PYTHON_VERSION=3.11

FROM python:${PYTHON_VERSION}-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ---------------------------------------------------------------- dependencies
FROM base AS deps
WORKDIR /build
# CPU-only PyTorch wheels keep the image ~1 GB smaller than the default CUDA build.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
COPY ml/requirements.txt ml/requirements.txt
COPY backend/requirements.txt backend/requirements.txt
RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --extra-index-url "${TORCH_INDEX_URL}" -r backend/requirements.txt

# ---------------------------------------------------------- model (optional)
# Hosts without a model volume (e.g. Render) can bake the trained artifact into the image:
#   --build-arg MODEL_URL=https://.../vit_base_patch16_224-v1.0.0.zip --build-arg MODEL_SHA256=<sha256 of the zip>
# The zip must contain one folder <model_id>/ with model.pt + model_card.json. The download is
# refused unless its SHA-256 matches. The app then verifies model.pt against the model card again.
# Without MODEL_URL nothing is downloaded and models come from a mounted ./models volume.
FROM base AS model
ARG MODEL_URL=""
ARG MODEL_SHA256=""
RUN mkdir -p /models
RUN python - <<'PY'
import hashlib, os, sys, urllib.request, zipfile

url, want = os.environ.get("MODEL_URL", ""), os.environ.get("MODEL_SHA256", "").lower()
if not url:
    sys.exit(0)
if len(want) != 64:
    sys.exit("MODEL_SHA256 (64 hex chars) is required with MODEL_URL")
urllib.request.urlretrieve(url, "/tmp/model.zip")
digest = hashlib.sha256(open("/tmp/model.zip", "rb").read()).hexdigest()
if digest != want:
    sys.exit(f"model download hash mismatch: got {digest}")
with zipfile.ZipFile("/tmp/model.zip") as z:
    for name in z.namelist():
        if name.startswith(("/", "\\")) or ".." in name.split("/"):
            sys.exit(f"unsafe path in model zip: {name}")
    z.extractall("/models")
print("model extracted:", os.listdir("/models"))
PY

# --------------------------------------------------------------------- runtime
FROM base AS runtime
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home-dir /app --shell /usr/sbin/nologin app
COPY --from=deps /opt/venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/app:/app/backend \
    ENVIRONMENT=production \
    LOG_JSON=true
WORKDIR /app/backend
COPY --chown=app:app ml /app/ml
COPY --chown=app:app backend /app/backend
COPY --from=model --chown=app:app /models /app/models
RUN mkdir -p /app/data/uploads /app/models \
 && chown -R app:app /app/data \
 && chmod +x /app/backend/docker-entrypoint.sh
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health/live', timeout=4).status == 200 else 1)"
ENTRYPOINT ["/app/backend/docker-entrypoint.sh"]
# The API is only reachable through the nginx container, so forwarded headers from it are trusted.
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*", "--no-server-header"]

# Convenience targets. Run from the repository root.
PY ?= python
NPM ?= npm

.PHONY: help install dev-model api web test test-ml test-api test-web e2e lint typecheck migrate docker

help:
	@grep -E '^[a-z-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

install: ## Install Python (CPU torch) and frontend dependencies
	$(PY) -m pip install --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements-dev.txt
	$(PY) -m pip install -e .
	cd frontend && $(NPM) ci

dev-model: ## Create an UNTRAINED pipeline-verification model (development only)
	$(PY) -m ml.scripts.create_untrained_artifact --output models/dev-untrained

migrate: ## Apply database migrations
	cd backend && alembic upgrade head

api: ## Run the API with auto-reload on :8000
	cd backend && uvicorn app.main:create_app --factory --reload --port 8000

web: ## Run the frontend dev server on :5173 (proxies /api to :8000)
	cd frontend && $(NPM) run dev

test: test-ml test-api test-web ## Run all unit and integration tests

test-ml: ## ML package tests
	$(PY) -m pytest ml/tests -q

test-api: ## Backend tests (SQLite by default; set TEST_DATABASE_URL for PostgreSQL)
	$(PY) -m pytest backend/tests -q

test-web: ## Frontend component and workflow tests
	cd frontend && $(NPM) test

e2e: ## Browser end-to-end tests against a running stack
	cd tests/e2e && npx playwright test

lint: ## Lint Python and TypeScript
	ruff check ml backend && ruff format --check ml backend
	cd frontend && $(NPM) run lint

typecheck: ## Static type checks
	cd backend && mypy app ../ml
	cd frontend && $(NPM) run typecheck

docker: ## Build and start the full stack on http://localhost:8080
	docker compose up --build

#!/bin/sh
# Apply database migrations (waiting for the database to accept connections), then start.
set -eu

attempt=1
until alembic upgrade head; do
  if [ "$attempt" -ge 20 ]; then
    echo "database migrations failed after $attempt attempts" >&2
    exit 1
  fi
  echo "database not ready (attempt $attempt); retrying in 3s" >&2
  attempt=$((attempt + 1))
  sleep 3
done

exec "$@"

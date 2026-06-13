#!/bin/bash
# entrypoint.sh
# Runs on every container start.
# Step 1: Apply any pending Alembic migrations
# Step 2: Start the FastAPI server
# set -e ensures the script exits immediately if any command fails
# This prevents uvicorn from starting if migrations fail

set -e

echo "[GlaucomaAI] Running database migrations..."
alembic upgrade head

echo "[GlaucomaAI] Migrations complete. Starting FastAPI server..."

# exec replaces the shell process with uvicorn
# This ensures Docker signals (SIGTERM, SIGINT) go directly to uvicorn
# Without exec, signals go to bash and uvicorn does not shut down cleanly
exec "$@"
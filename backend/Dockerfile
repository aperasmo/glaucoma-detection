FROM python:3.11.9-slim

# Prevent Python from writing .pyc files to disk
# Prevent Python from buffering stdout and stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install system-level dependencies
# libglib2.0-0, libsm6, libxext6, libxrender-dev  -> required by opencv-python-headless
# libgomp1                                          -> required by TensorFlow parallel ops
# curl                                              -> required by HEALTHCHECK
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
# This layer is cached until requirements.docker.txt changes
# Comes before app code so a code change does not re-trigger pip install
COPY requirements.docker.txt .
RUN pip install --no-cache-dir -r requirements.docker.txt

# Copy application code
# This layer changes most often - always comes last among COPY steps
COPY app/ ./app/

# Copy Alembic migration files
COPY alembic.ini .
COPY alembic/ ./alembic/

# Copy entrypoint script and make it executable
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Health check
# start-period=120s allows time for TensorFlow to load all three models on startup
# interval=30s checks every 30 seconds after start-period
# timeout=10s  each check must respond within 10 seconds
# retries=3    container marked unhealthy after 3 consecutive failures
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

EXPOSE 8000

# entrypoint.sh runs alembic migrations then starts uvicorn
ENTRYPOINT ["./entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
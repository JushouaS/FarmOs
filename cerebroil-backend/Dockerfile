# ─────────────────────────────────────────────────────────────────────────────
# Cerebroil Backend — multi-stage Docker build
#
# Stage 1 (builder): install Python dependencies into /opt/venv
# Stage 2 (runtime): copy /opt/venv + app code, run as non-root
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: dependency builder ───────────────────────────────────────────────
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /build

# Build deps needed to compile asyncpg C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Create venv at a well-known path that the runtime stage can copy cleanly
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt


# ── Stage 2: lean runtime image ───────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Put the venv on PATH so every command (alembic, uvicorn, python) resolves
    PATH="/opt/venv/bin:$PATH"

# Only the libpq runtime shared library is needed (no gcc, no headers)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
    && rm -rf /var/lib/apt/lists/*

# Copy venv from builder into the same /opt/venv path
COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

# Copy application source
COPY . .

# Create a non-root user and fix ownership
RUN addgroup --system appgroup && \
    adduser  --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app

USER appuser

EXPOSE 8000

# Shell form so $PATH is evaluated — uvicorn is the default entry point
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--log-level", "info"]

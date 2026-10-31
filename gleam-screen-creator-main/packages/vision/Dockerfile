# ─────────────────────────────────────────────────────────────────────────────
# CereBroiler Vision Service — Flask + OpenCV (packages/vision)
#
# Build context: ./gleam-screen-creator-main/packages/vision
# ─────────────────────────────────────────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# libpq5      — psycopg2 runtime
# libglib2.0  — required by cv2 even in the headless build
# libgomp1    — OpenCV's OpenMP runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq5 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Single worker, many threads: the CV pipeline holds per-process camera state,
# so workers must not be duplicated.
EXPOSE 5000

CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "1", "--threads", "8", "--timeout", "120", "--access-logfile", "-", "app:app"]

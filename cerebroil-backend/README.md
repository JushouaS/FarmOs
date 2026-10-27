# Cerebroil Backend

> Production-ready async FastAPI backend for the **Cerebroil** broiler-flock monitoring system.  
> Receives telemetry from a Raspberry Pi 4 (YOLOv8 + ByteTrack + ROS 2), stores it in PostgreSQL, and serves a React dashboard via REST + WebSockets.

---

## Stack

| Layer | Technology |
|---|---|
| Framework | FastAPI 0.115 (async) |
| Database | PostgreSQL 16 |
| ORM | SQLAlchemy 2.0 (async) + asyncpg |
| Migrations | Alembic (async env) |
| Validation | Pydantic v2 |
| Real-time | WebSockets (built-in FastAPI) |
| Deployment | Docker + Docker Compose |

---

## Quick Start (Docker)

```bash
# 1. Clone / enter the directory
cd cerebroil-backend

# 2. Configure environment
cp .env.example .env
# Edit .env — set API_KEYS to a secure value

# 3. Build and start all services
docker compose up --build

# 4. Open interactive API docs
open http://localhost:8000/docs
```

The first run:
- Starts PostgreSQL
- Runs Alembic migrations (`alembic upgrade head`)
- Starts the API on port **8000**

---

## Running Locally (without Docker)

```bash
# Prerequisites: Python 3.12+, a running PostgreSQL instance

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit DATABASE_URL to point to your local Postgres

# Run migrations
alembic upgrade head

# Start the server (hot-reload for development)
uvicorn app.main:app --reload --port 8000
```

---

## API Reference

### Authentication

The telemetry ingestion endpoint and WebSocket connection require an **API key**.

| Transport | How to supply the key |
|---|---|
| HTTP | `X-API-Key: <your-key>` header |
| WebSocket | Send `{"api_key": "<your-key>"}` as the first message after connecting |

---

### Endpoints

#### Telemetry ingestion (Raspberry Pi → Backend)

```
POST /api/v1/telemetry/events
X-API-Key: <key>
Content-Type: application/json

{
  "batch_id": "<uuid>",
  "frames": [
    {
      "timestamp": "2024-05-24T21:10:00Z",
      "flock_density_pct": 0.42,
      "detections": [
        {
          "track_id": 7,
          "bbox": {"x": 120, "y": 200, "w": 48, "h": 48, "conf": 0.96},
          "depth_z": 1.32,
          "centroid": {"x": 0.45, "y": 0.62}
        }
      ]
    }
  ]
}
```

Response `202 Accepted`:
```json
{"events_stored": 1, "alerts_raised": 0}
```

---

#### Dashboard analytics

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/batches/{batch_id}/summary` | KPI snapshot (age, weight, active alerts) |
| `GET` | `/api/v1/batches/{batch_id}/growth-trend` | Daily weight time-series for chart |
| `GET` | `/api/v1/batches/{batch_id}/alerts` | List unresolved alerts |
| `PATCH` | `/api/v1/alerts/{alert_id}/resolve` | Mark an alert as resolved |

---

#### WebSocket live feed

```
ws://localhost:8000/ws/batches/{batch_id}/live
```

1. Connect and immediately send:
   ```json
   {"api_key": "<your-key>"}
   ```
2. Server replies with:
   ```json
   {"type": "connection_ack", "batch_id": "...", "message": "Connected to live feed"}
   ```
3. Subsequent server pushes:

| Message type | Trigger |
|---|---|
| `live_frame` | Every successful telemetry POST for this batch |
| `alert` | Every new alert raised by the rule engine |

---

## Alert Rules

| Rule | Condition | Severity |
|---|---|---|
| Flock clustering | `flock_density_pct >= 0.75` (configurable) | `warning` / `critical` |
| Zero detections | All frames in a POST have 0 detections | `warning` |
| Mortality spike | `daily_mortality_count` increased by ≥ 3 vs previous log | `critical` |

Alert deduplication: a new alert is only created if no identical unresolved alert already exists for the batch.

---

## Database Schema

```
farms  ──<  houses  ──<  batches  ──<  tracking_events
                                   ──<  growth_logs
                                   ──<  alerts
```

---

## Migration Workflow

```bash
# Generate a new migration after model changes
alembic revision --autogenerate -m "describe the change"

# Apply migrations
alembic upgrade head

# Roll back one step
alembic downgrade -1
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | asyncpg DSN (required) |
| `API_KEYS` | `""` | Comma-separated API keys |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:8080` | Allowed CORS origins |
| `DEBUG` | `false` | Enable SQLAlchemy echo |
| `CLUSTER_DENSITY_THRESHOLD` | `0.75` | Clustering alert trigger |
| `INACTIVITY_SECONDS_THRESHOLD` | `300` | Inactivity alert trigger (seconds) |

---

## Connecting to the Frontend

The Cerebroil web dashboard (TanStack Start, in `../gleam-screen-creator-main`) is pre-configured to hit `http://localhost:4000` (see `src/lib/api-client.ts`).  
Change `VITE_API_URL` in the frontend `.env` to `http://localhost:8000` to point it at this backend, or update the port mapping in `docker-compose.yml`.

---

## Plugging in the Real Models

When YOLOv8 and 2D CNN training is complete:

1. **Replace the weight estimation formula** in `app/services/weight_service.py` → `estimate_avg_weight()` with your trained CNN's inference call.
2. **Swap the still image** in the frontend `visuals.tsx` for the RTSP stream URL (set it in Settings → RTSP Camera Stream URL).
3. **Update `camera_ip`** on the House record to match your Pi's IP.
4. The Pi's ROS 2 bridge should POST to `POST /api/v1/telemetry/events` with a valid `X-API-Key` header.

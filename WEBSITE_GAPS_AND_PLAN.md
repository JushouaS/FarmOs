# CereBroiler — Gap Analysis & Completion Plan

Scanned 2026-10-27/28, from the actual state of the repo in your connected folder (`gleam-screen-creator-main/gleam-screen-creator-main`, plus the sibling `cerebroil-stream` and `cerebroil-backend` services and the `packages/vision` service inside the frontend workspace). This consolidates everything found across this session and the prior phase docs (`phase1-db-audit-findings.md`, `phase2-remediation-log.md`, `phase3-frontend-wiring-log.md` in the project) into one list of what's still missing, grouped by area, roughly in the order it'll bite you.

## 1. Environment is not actually running yet

This is the thing blocking everything else below from being verifiable.

- **Dependencies were never successfully installed in the real project folder.** `node_modules` there still has 249 entries left over from a broken `npm install` attempt, and `node_modules/.bin/vite` doesn't exist — `bun run dev` has not completed a clean install here. `packages/api/node_modules` has only 14 entries (also incomplete).
- **`packages/api/.env` exists now** (created 2026-10-27, not by me in this conversation — likely from an earlier session) and points at `postgres://cerebroil:***@localhost:5433/cerebroil`. Whether that Postgres is actually reachable, whether migrations have been run against it, and whether the password is current have not been verified — nothing in this session has successfully connected to it.
- **Migrations have never been confirmed to run against your real database.** They were verified to apply cleanly against a *throwaway* Postgres instance in a sandbox (proving the SQL itself is correct), but that is not the same as having run against `localhost:5433/cerebroil`.
- **The dev server has not been confirmed reachable in your own browser.** Every attempt so far either ran in an isolated sandbox with no network path to your machine, or wasn't actually started (no terminal was open on your screen when last checked).

**Next step:** open PowerShell yourself, `cd` into the project, run `bun install`, `bun add srvx`, `bun run dev`, and keep that window open. Until that banner prints `Local: http://localhost:8080/` and stays running, nothing past this point can be verified end-to-end.

## 2. Backend / database

- `cycle.day` is computed as `(CURRENT_DATE - start_date)::int` against a seed `start_date` of `2024-04-12`. Against today's real date this produces a nonsensical value (reproduced live as "Day 928/42" during testing). Needs either a refreshed seed date or a redesign so "day" is stored/advanced explicitly rather than computed from a frozen calendar date.
- The dashboard's **Activity index showed 0% / all birds reported "inactive"** when run against a real (if temporary) database. Not root-caused — may be the same frozen-seed-date problem surfacing a second time (no `activity_samples` rows land on "today" because "today" relative to the seed is absurd), or a separate bug. Needs investigation once your own DB is confirmed live.
- **FCR target is a hardcoded constant** (`FCR_TARGET = 1.70` in `operations.ts`), not computed per day-of-cycle against the Ross 308 standard curve. Flagged, not fixed — same simplification the original mock made.
- **Mortality is manual-entry only** (`POST /growth/mortality`), not inferred from camera detections. Deliberate: the lightweight vision analysis only sees a handful of blobs per frame, nowhere near a ~4,200-bird house population, so wiring it up would mean presenting a fabricated flock-wide number as real data. Automatic mortality would require the full YOLOv8 + ByteTrack unique-ID tracking that only `cerebroil-backend` has (see §4) — not ported over.
- **No automated tests anywhere in the repo** — zero `.test.ts`/`.spec.ts` files, no test script in any `package.json`. For a system this data-sensitive (weight estimates, mortality alerts, non-negative constraints), there's no regression safety net at all.

## 3. Frontend — still reading the mock dataset directly

Only `index.tsx` (the main Dashboard) was converted to live data in Phase 3. Everything else still imports `dataset.ts` directly and will show the same static demo numbers regardless of what's in the database:

- `visuals.tsx` (Live Camera) — the biggest remaining lift. It renders a **per-bird weight-distribution breakdown that has no equivalent anywhere in the live schema** (the schema models house-level population and flock-wide samples, not individually tracked demo birds). This needs new backend aggregation designed from scratch, not just a fetch swap.
- `telemetry.tsx` (Analytics)
- `flock-monitoring.tsx`
- `intelligence.tsx`
- `settings.tsx`
- `login.tsx` — partially live: it does POST to the real `/auth/login` first, with a client-side `admin`/`admin` fallback session if the API is unreachable (see §5 for why that fallback is worth revisiting before this is ever shown to anyone outside your own testing).

A real bug was found and fixed in the already-converted parts: every TanStack server function in `repository.ts` runs server-side even when called from the client, so `fetch(..., { credentials: "include" })` had no browser cookie jar to draw from and silently sent unauthenticated requests. Fixed by forwarding the inbound request's `Cookie` header explicitly (`forwardedCookieHeader()` in `repository.ts`) — worth remembering as the pattern for every future page conversion, or the same bug will recur on each one.

## 4. Vision / camera pipeline

- **Two independent vision services exist and only one should be authoritative** — this is still an open decision, not resolved:
  - `cerebroil-stream/` — patched this phase to match the `vision-proxy.ts` contract exactly. Honest, if lightweight, CV (frame-diff/contour detection for Dahua, ROI-intensity estimate for Kinect), no known bugs, now loads `.env` via `python-dotenv`.
  - `packages/vision/` — inside the frontend's own npm workspace, and the one the root `package.json`'s `dev:vision` script actually launches, despite not being the one I patched. Has genuinely better camera-capture code (`camera.py` is real OpenCV RTSP handling), but `detector.py` is **self-documented as a random-data stub** ("returns realistic-looking placeholder data"), and `db.py`'s `write_volumetric_sample` INSERT targets columns that don't exist on the real `volumetric_samples` table — it would crash on every weight-estimate write.
  - `cerebroil-backend/` — confirmed orphaned (FastAPI + YOLOv8 + ByteTrack + ROS2 telemetry service). Nothing calls it. Either resurrect it for real detection/mortality tracking, or remove it so it stops looking like a live part of the system.
- **The real Dahua IR camera RTSP URL is now configured** (`rtsp://admin:***@192.168.0.101:554/cam/realmonitor?channel=1&subtype=0`) in both `cerebroil-stream/.env` and `packages/vision/.env`, since the authoritative-service question above is still open. **Not yet tested against the physical camera** — nothing in this session has actually connected to it.
- **The Kinect depth camera has no real source configured** — both services still default to `KINECT_SOURCE=simulated` / no `KINECT-01` entry. Weight estimation from the depth station is entirely synthetic until this is set.
- `VISION_SERVICE_TOKEN` is a placeholder (`change-me-to-match-packages-api`) in both `.env` files — needs to be the same real random value in whichever vision service you keep, and in `packages/api/.env`.

## 5. Security / hardening (fine for a thesis demo, not fine beyond that)

- `auth-context.tsx` has a hardcoded `admin`/`admin` local-session fallback that activates whenever the real API is unreachable, bypassing authentication client-side with a trivial password. Useful for development resilience, but should be removed or gated behind a build flag before this is shown to anyone who isn't you.
- `JWT_SECRET`, `VISION_SERVICE_TOKEN`, and the database password currently in `packages/api/.env` are all development-grade placeholders or values set during this debugging process — none are production secrets.
- `cerebroil-backend` being orphaned but still present is itself a minor surface-area issue: it's a second FastAPI service with its own dependencies that nothing exercises or tests, sitting in the repo.

## 6. What's actually solid

Worth stating plainly so this doesn't read as all-bad: the database schema (14 migrations) applies cleanly against real Postgres with zero errors, including the non-negative CHECK constraints added this phase; `packages/api`'s route layer type-checks clean; the dashboard, alerts, and flock-tracking pages were verified end-to-end against a real (if temporary) database and rendered correctly; and the vision-proxy ↔ `cerebroil-stream` contract mismatch that would have been a guaranteed hardware-integration failure is fixed and verified by static analysis.

## Suggested order of attack

1. Get `bun install` / `bun run dev` actually completing on your machine, confirm the dev server is reachable in your own browser (§1).
2. Confirm `packages/api` boots and successfully connects to `localhost:5433/cerebroil`, run `db:migrate` against it for real, and verify the dashboard renders live data in your own browser, not just in a sandbox.
3. Decide the vision-service question (§4) — this blocks doing anything further with the camera, and blocks knowing which `detector.py`/`db.py` bugs are even worth fixing.
4. Root-cause the `cycle.day` / Activity-0% pair (§2) — likely one fix, not two.
5. Pick off the remaining mock-backed pages (§3), `visuals.tsx` last since it needs new backend design work first.
6. Before any defense/demo in front of others: remove or gate the `admin`/`admin` fallback, rotate the dev secrets (§5).

# Cerebroil / FarmOS — Development Plan

Assessed 2026-11-04 on branch `responsive-login-local-db` (last commit `1e22610`, pushed). This file replaces
`WEBSITE_GAPS_AND_PLAN.md` (written 2026-10-28; much of it is now out of date, see §2.4).

**How to read this file.** Every statement below is either *Verified* (checked in code, by running a command, or on
the live system during this assessment) or marked **Requires investigation**. Paths are relative to the git root
(`gleam-screen-creator-main/`) unless they start with `app/`, which means the web app folder
`gleam-screen-creator-main/gleam-screen-creator-main/` (call it `app/` below).

**Objectives.** The request left the objectives list empty. These are taken from the deployment-readiness goals agreed
in the working session (the user's five-step list). Edit this list if they are wrong; the roadmap is organised by them.

| ID | Objective |
|----|-----------|
| O1 | Every number a farmer acts on comes from a real source (camera, Kinect, sensor, scale entry). No sample number is shown as if it were real. |
| O2 | A pilot at the farm works day to day: Raspberry Pi, Dahua camera, Kinect and sensor run unattended on the farm network. |
| O3 | The database and API run somewhere that restarts itself and is backed up. |
| O4 | Access is secure: no shared or default credentials, secrets rotated, HTTPS, role checks. |
| O5 | The weight, bird-count and behavior figures are measured against manual ground truth, and their error is known and shown. |
| O6 | The project can be handed over: tests, current documentation, reproducible setup. |

---

## 1. Project Overview

Cerebroil (UI name "CereBroiler") monitors a broiler pen: live camera, Kinect depth and weights, bird counts,
behavior alerts, pen temperature/humidity, weight growth against the Ross 308 standard, alerts and notifications.

| Part | Where | Tech | Verified state |
|------|-------|------|----------------|
| Web app | `app/src/` | TanStack Start/Router, React 19, Vite 8, Tailwind 4, Radix, react-query, zod 4; Nitro `node-server` for production | Builds and typechecks (`tsc --noEmit` exit 0) |
| API | `app/packages/api/` | Fastify 5, postgres.js raw SQL, jose JWT, bcrypt, helmet/cors/rate-limit, web-push, nodemailer | Typechecks (exit 0); 12 route modules, 24 migrations |
| Database | local PostgreSQL 18 on port 5434 (`app/packages/api/.pgdata`) | `bun run db:local:start` | Runs, but see §5 G-01 (unreliable on this laptop) |
| Camera service | `cerebroil-stream/` (runs on the Raspberry Pi) | Flask, onnxruntime detector, OpenCV, systemd units `cerebroil-stream`, `dht22` | Works against the Pi when reachable; trained model files are git-ignored |
| Kinect bridge | `app/kinect-bridge/` | C# (Kinect SDK 2.0), WebSocket `:8181` | Worked on 2026-11-03 ("Kinect is sending data", ~15 fps) |
| Kinect chicken finder | `cerebroil-stream/kinect_seg.py` | YOLO11n-seg `kinect_chicken_seg.pt`, XGBoost weight model | Runs on the laptop, port `8182` |
| Public link | `app/scripts/public-gateway.mjs`, `app/scripts/start-public.ps1` | Node gateway + cloudflared quick tunnel | Built and tested locally; tunnel blocked on the school network (port 7844) |
| Orphans | `cerebroil-backend/`, `app/packages/vision/` | FastAPI/YOLOv8/ROS2; Flask stub | Not used by the site (see G-12) |

Roles in the API: `ADMIN`, `FARM_MANAGER`, `OPERATOR` and read-only signed-in users (`requireRole` in `app/packages/api/src/auth/middleware.ts`).

---

## 2. Current Project Status

### 2.1 Verified health checks (2026-11-04)

| Check | Result |
|-------|--------|
| `tsc --noEmit` (web) | passes |
| `tsc --noEmit` (`app/packages/api`) | passes |
| `eslint src packages/api/src` | **3,045 findings**: 2,966 `prettier/prettier` (formatting), 55 `no-explicit-any`, 16 `react-refresh/only-export-components`, 3 `exhaustive-deps`, 5 others |
| Automated tests | **none**: no `*.test.*`/`*.spec.*` file in the repo, no `test` script in either `package.json` |
| Local services at assessment | web `8080`, API `4000`, Postgres `5434` up; Kinect bridge `8181`, chicken finder `8182`, Pi `5000` down |
| Postgres log (`app/packages/api/.pgdata/server.log`) | repeated `could not reserve shared memory region ... error code 487`; new connections were refused (`server closed the connection unexpectedly`) while free RAM was 0.4 GB |
| Pi reachability | `behavior.local` did not resolve from the laptop (different network at the time) |
| DHT22 on the Pi (2026-11-03) | `/sensors` answered "the sensor did not answer (check the wires and the 3.3 V)"; last stored reading 08:16 UTC, ~2 h earlier |

### 2.2 Data sources: what is real and what is not

Verified by reading every `INSERT`/`UPDATE` in `app/packages/api/src` and `app/packages/api/migrations/0009_seed_from_dataset.sql`.

| Data on screen | Table / source | Written by live code? | Status |
|----------------|----------------|-----------------------|--------|
| Pen temperature, humidity | `sensor_readings` (DHT22) | Yes: `sensor-monitor.ts` every 60 s | **Real** (when the sensor answers) |
| Bird count from "Analyze data", huddle clusters | `detections`, `behavior_snapshots` | Yes: `routes/vision-proxy.ts` | **Real** (trained detector); accuracy unvalidated |
| Kinect outlines + per-bird weight | Kinect bridge → `kinect_seg.py` | Not stored; shown live | **Real**, about 18% error per bird |
| Test video weights | `app/src/lib/farm/video-weight.ts` | Not stored | **Derived**: standard weight spread over birds by box size, not measured |
| Behavior (inactive, huddling) | `cerebroil-stream/live_behavior.py` | Off: `LIVE_BEHAVIOR` is not set on the Pi (`/behavior/status` answered `disabled`) | **Real code, switched off** |
| Typed-in scale weights | `actual_weights` | Yes: `PUT /growth/actual-weights` | **Real** (manual) |
| Mortality | `mortality_logs` | Yes: `POST /growth/mortality` | **Real** (manual only) |
| Dashboard weight curve, sample size | `cycle_weights` | Yes since 2026-11-04: mean of typed-in `actual_weights` per day (`measured-weights.ts`). Before that, no writer; only the `0009` seed | **Seed data, confirmed**: 7 rows, newest dated 2024-05-25 (days 7 to 42); the Dashboard reads its "actual" weight off this curve |
| Dashboard FCR, daily gain, feed eaten, water, activity % | `feed_samples`, `water_samples`, `activity_samples` | **No writer anywhere** | **Empty, confirmed**: 0 rows in each table, so the cards show "—"; no physical source exists |
| FCR target | `FCR_TARGET = 1.70` in `routes/operations.ts` | n/a | Constant, not per day |
| Analytics → Weight Growth tab, Flock Monitoring per-bird table, Dashboard analysis report | `app/src/lib/farm/dataset.ts` via `sampleForDay()` (`app/src/lib/farm/sample.ts`) | n/a | **Sample**, each marked with `SampleNotice` |
| Insights → AI briefing and alert analysis | `app/src/lib/intelligence.ts` line 31: `buildFarmSnapshot(sampleForDay(...).farm)` | n/a | **Built from the sample flock**, and `GROQ_API_KEY` is not in the root `.env` (only `TINYFISH_API_KEY`, `VITE_VISION_ORIGIN`), so it cannot run now |
| Alerts, incidents, archived reports, anomaly events | seeded rows from `0009` | Alerts: yes, from monitors (`behavior-monitor.ts`, `notify.ts`); incidents/reports: seed | **Seed, confirmed for alerts**: 4 rows, newest 2024-05-25. Incidents and reports not counted: **Requires investigation** |

### 2.3 Sample data already removed (commit `1e22610` and earlier)

Live Camera: Weight Classification (Kinect weights), Behavior Breakdown (`GET /visual/behavior`), ammonia row removed,
temperature/humidity show "No reading". Analytics → Flock Conditions: DHT22 history (`GET /operations/sensor-history`), feed and
ammonia charts and the sample conditions report removed. Insights: Key Observations from the weight status and the live monitor.
Built-in `admin`/`admin` login removed from the API and the browser (`app/src/lib/auth-context.tsx`).

### 2.4 Stale documentation (verified)

- `app/HOW_TO_RUN.md` §11 "What is real and what is a stand-in" says there is no trained detector and no weight model and that the Kinect is simulated. All three are now untrue. §9 and the security notes are current.
- `app/CEREBROILER.md` describes 28 birds on Day 14 and Cloudflare Workers hosting; the app now uses a configurable Day 16 to 45 window and `node-server`.
- `app/README.md` is the Lovable template text.
- `WEBSITE_GAPS_AND_PLAN.md` lists problems since fixed (admin fallback, mock-backed pages, no vision contract) and is superseded by this file.

### 2.5 Database contents (checked 2026-11-04 after restarting the database)

The database refused connections until it was stopped and started again (G-01). The counts were then read with `psql`:
`cycle_weights` 7 rows (newest 2024-05-25, seed), `feed_samples` 0, `water_samples` 0, `activity_samples` 0, `alerts` 4 (newest
2024-05-25, seed), `actual_weights` 0, `detections` 0, `users` 1, `sensor_readings` 655 (DHT22). Also counted: `incidents` 1, `monitoring_reports` 1,
`archived_reports` 3 and `anomaly_events` 5 (all dated May 2024, seed), `cohorts` 4 (seed), `incident_peaks` 1, `notifications` 8 (test sends on
2026-11-02). `houses` holds three seed houses (H01 4,210 birds, H03 4,260, H04 4,190) beside the real "Pen 1" (H02, 20 birds); `cameras`
holds two seed cameras (UNIT_04_NORTH, UNIT_02_NORTH) beside the real CAM-01. The facility is named POULTRY_AI. The restart cleared the connection failures, but they will come
back under memory pressure.

---

## 3. Completed Features (verified in code and exercised during the project)

- Authentication: login, refresh-token rotation, lockout after 5 failures (`login_failures`), MFA, one-time privacy agreement (`privacy_consents`), admin-created accounts with emailed temporary password (`routes/auth.ts`, migrations 0010, 0021–0023). First admin made with `app/packages/api/scripts/seed-admin.ts`.
- Roles and permission checks on mutating routes (`requireRole`).
- Settings: grow-out day window, lighting hours, flock size (`routes/settings.ts`, `migrations/0016`, `0017`).
- Alerts list, acknowledge, dismiss; notifications with in-app, web push (VAPID keys set) and email (SMTP keys set) (`notify.ts`, `routes/alerts.ts`, `routes/notifications.ts`). Delivery to real inboxes/phones: **Requires investigation**.
- Dashboard Growth card from the API (`app/src/lib/farm/growth.ts`, `components/farm/GrowthCard.tsx`) — see §2.2 for what feeds it.
- Typed-in actual weights per bird per day (`actual_weights`, Flock Tracking page).
- Live Camera: Dahua stream and Kinect through the API proxy with auto-reconnect; Kinect Picture/Depth 3D views, chicken outlines, weights (`KinectDepthView.tsx`).
- Analyze data scan with the trained detector and persisted huddle clusters (`cerebroil-stream/app.py`, `routes/vision-proxy.ts`).
- Test video: upload, detection, boxes, automatic weights, full screen (`VideoDetectDialog.tsx`); one job at a time (429 otherwise).
- DHT22 reading and storage; DHT22 history chart.
- Live behavior engine code (`live_behavior.py`, `behavior.py`) and alert raising (`behavior-monitor.ts`).
- Three languages (English, Filipino, Cebuano) with a translation check script (kept outside the repo).
- Public-link tooling (`app/scripts/public-gateway.mjs`, `start-public.ps1`).

## 4. Partially Implemented Features

| Feature | What exists | What is missing |
|---------|-------------|-----------------|
| Weight growth on the Dashboard | Card, curve, standard curve, variance | A real writer for `cycle_weights`; today the "actual" curve is seed data (G-02) |
| Live behavior monitoring | Engine, alert raising, Live Camera card, Analytics donut, Insights lines | Switched off on the Pi; thresholds (`LIVE_INACTIVE_SECONDS`, `LIVE_HUDDLE_SECONDS`, `FDI_WARN`) never checked against a real flock |
| Kinect weights | Model, per-bird and average, error shown | Trained on one flock, days 26–40; ~18% per bird; not validated on this farm's birds; outlines can pick up non-chickens (confidence 0.25) |
| Pen sensor | DHT22 → DB → charts | Hardware fault on 2026-11-03; no gap handling or "sensor offline" alert; no ammonia, feed, water sensors |
| Public access | Gateway, script, production-mode API | Never run end to end with a tunnel; needs a network that allows outbound 7844 or a different tunnel |
| AI briefing | Groq call, prompt builder | Uses sample flock data, no key configured, no real-data guard (G-03) |
| Notifications | Web push + SMTP code | Real-world delivery untested; Gmail app password handling is manual |
| Mortality | Manual entry endpoint and table | No UI/validation review done; no estimate from vision (deliberate) |
| Documentation | `app/HOW_TO_RUN.md` is thorough | Stale §11 (see §2.4) |

## 5. Missing Features and Identified Gaps

| ID | Gap | Evidence | Severity |
|----|-----|----------|----------|
| G-01 | Local PostgreSQL on Windows is unreliable under memory pressure (backend processes fail to start, error 487) | `server.log`; psql refused connections at 0.4 GB free | Critical |
| G-02 | Dashboard weight curve, sample size, confidence are seed data; no code writes `cycle_weights` | grep of `INSERT INTO`/`UPDATE` in `app/packages/api/src`; `0009` seed | Critical |
| G-03 | Insights AI briefing is generated from the sample flock; `GROQ_API_KEY` missing | `app/src/lib/intelligence.ts:31`; root `.env` keys | Critical |
| G-04 | Dashboard FCR, feed, water, activity cards have no data source and no writer | `routes/operations.ts` lines ~142–185; no `INSERT` | High |
| G-05 | No database backup; trained models (`detector.onnx`, `kinect_chicken_seg.pt`, `weight_model_size_v1.json`) are git-ignored, so only exist on two machines | `.gitignore`, `cerebroil-stream/models/`, no `pg_dump` anywhere | Critical |
| G-06 | No automated tests | repo-wide search | High |
| G-07 | Kinect panel shows a **simulated picture with fake weights** (K-001… 799 g) when the bridge is down | Screenshot 2026-11-03; HOW_TO_RUN §7 | High |
| G-08 | Admin password was shared in chat and kept; SMTP app password and Wi-Fi/Pi credentials live in `.env`/shell history | Session record | High |
| G-09 | Kinect bridge and chicken finder start by hand on the laptop; nothing restarts them; both were down at assessment | Port check | High |
| G-10 | DHT22 fault; no "sensor offline" detection or alert | `/sensors` reply | Medium |
| G-11 | Behavior monitor off; thresholds uncalibrated | `/behavior/status` → `disabled` | High |
| G-12 | Dead/alternative code: `cerebroil-backend/` (orphan), `app/packages/vision/` (stub, port clash with the real camera service), `app/scripts` has no tests | HOW_TO_RUN §9 | Medium |
| G-13 | Seeded demo rows (facility "Data Cruz Poultry Farm", alerts, incidents, reports, `0011_seed_default_admin.sql`) ship with every fresh database | Migrations 0009, 0011 | High |
| G-14 | Lint: 3,045 findings, mostly formatting; CRLF/LF warnings on every commit | eslint run; git warnings | Low |
| G-15 | No production hosting config (no Dockerfile for API/web, no process manager, no CI, no monitoring) | repo search; only `cerebroil-stream/Dockerfile` exists | Critical |
| G-16 | API ↔ Pi traffic is plain http on a LAN; a cloud API cannot reach a Pi on a private network | HOW_TO_RUN security notes | High |
| G-17 | Test-video weights are the standard weight redistributed, not measured; shown to the user with a 20% error | `video-weight.ts` | Medium |
| G-18 | Documentation stale (§2.4) | — | Medium |
| G-19 | `demoJobRunning` stays set if the browser disconnects mid-upload (user sees "Another video is being checked") | `routes/vision-proxy.ts` | Low |
| G-20 | Pages still on sample data: Analytics Weight Growth tab, Flock Monitoring per-bird table, Dashboard analysis report | §2.2 | High |

---

## 6. Objectives and Requirements Mapping

| Objective | Needs | Tasks |
|-----------|-------|-------|
| O1 Real data only | Writer for weights; remove/replace feed/water/activity; real AI input; honest Kinect fallback; clean seed | T1.0–T1.9 |
| O2 Pilot runs unattended | Pi/sensor repair, Kinect services autostart, fixed addresses, behavior on | T0.4, T2.1–T2.6 |
| O3 Hosted, self-restarting, backed up | Stable DB host, backups, process manager, tunnel to the farm | T0.1, T0.3, T3.1–T3.7 |
| O4 Secure | Rotate credentials, HTTPS, minimal exposure, dependency check | T0.2, T3.5, T4.6 |
| O5 Validated accuracy | Ground-truth protocol for weight, count, behavior | T2.7–T2.9 |
| O6 Handover | Tests, docs, lint | T4.1–T4.5 |

---

## 7. Development Roadmap and Milestones

Milestones: **M0** stable base (Phase 0) → **M1** honest data (Phase 1) → **M2** field pilot ready (Phase 2) → **M3** hosted (Phase 3) → **M4** handover quality (Phase 4). Phases 1 and 2 can overlap after T0.1.

### Phase 0 — Stable base (Critical, do first)

**T0.1 Move the database off the unreliable Windows install** — *Critical*
- Description: choose one stable host (the farm computer, a small Linux machine, or Docker Postgres) and point `DATABASE_URL` there. Keep migrations as they are (`app/packages/api/migrations`, `bun run db:migrate`).
- Files: `app/packages/api/.env`, `app/packages/api/scripts/local-db.ts` (keep for dev), new `docker-compose.yml` or install notes in `app/HOW_TO_RUN.md`.
- Depends on: decision in T3.1.
- Acceptance: the database survives a 24 h run with the web app, API and monitors on; no `error code 487` lines in its log; `db:migrate` applies all 24 migrations on a blank instance.

**T0.2 Rotate credentials** — *Critical*
- Description: set a new admin password (`seed-admin.ts` or Settings → Accounts), new `JWT_SECRET`, `VISION_SERVICE_TOKEN`, `KINECT_BRIDGE_KEY`; revoke and recreate the SMTP app password; confirm nothing secret is committed (`git log -p -S` search).
- Files: `app/packages/api/.env`, `cerebroil-stream/.env`, root `.env` (all git-ignored).
- Acceptance: old admin password no longer works; every secret in the three `.env` files is new; `git grep` for the old values returns nothing; MFA accounts re-enrolled if `JWT_SECRET` changed (HOW_TO_RUN notes this).

**T0.3 Backups** — *Critical* — **mostly done 2026-11-04** (a Windows task "Cerebroil nightly backup" runs the script daily at 8 pm and catches up if the laptop was off; remaining: a copy on another computer or drive): `app/scripts/backup-db.ps1` written and run; the first dump (165 KB) and a models zip (14 MB) are in `C:\Users\Jush\cerebroil-backups`. The dump was restored into a throwaway database (49 tables, 1 user, 7 cycle_weights, 655 sensor_readings) and that database was deleted. **Still to do:** a nightly Task Scheduler job, and a copy on a different computer or drive.
- Description: scheduled `pg_dump` (daily, keep 14), copied off the machine; copy `cerebroil-stream/models/*` and the training CSVs to a second location and record checksums; document restore.
- Files: new `app/scripts/backup-db.*`, `app/HOW_TO_RUN.md`.
- Depends on: T0.1.
- Acceptance: a restore of last night's dump into a blank database gives the same row counts; models exist in two places.

**T0.4 Repair the DHT22 and make faults visible** — *High* — **software done 2026-11-04**: a "Sensor Offline" alert after `SENSOR_OFFLINE_MINUTES` (default 10) without a reading, once per outage (`sensor-monitor.ts`), and Live Camera shows "Sensor offline · last reading 2 h ago" instead of a bare "No reading". **Still to do on site:** reseat the wires and restart `dht22`
- Description: reseat wires/3.3 V on the Pi, restart `dht22`; add a "sensor offline" notice when the newest reading is older than a threshold (API alert and a line on Live Camera instead of silent "No reading").
- Files: Pi (`sudo systemctl restart dht22`), `app/packages/api/src/sensor-monitor.ts`, `app/src/routes/visuals.tsx`.
- Acceptance: new `sensor_readings` rows every minute for 1 h; unplugging the sensor raises an alert within 10 min and clears it when plugged in.

### Phase 1 — Honest data (O1)

**T1.0 Confirm what the database really holds** — *Critical* — **done 2026-11-04** (see §2.5): the demo alerts, incident, reports, anomaly events, cohorts, three houses and two cameras are all seed rows; T1.6 removes them
- Description: after T0.1, count rows and newest `recorded_at` of `cycle_weights`, `feed_samples`, `water_samples`, `activity_samples`, `alerts`, `incidents`, `monitoring_reports`, `archived_reports`; record the result in this file.
- Acceptance: §2.2 table updated from the actual counts.

**T1.1 Give `cycle_weights` a real writer** — *Critical* — **done 2026-11-04 for typed-in weights** (not committed when written): migration `0025_measured_weights.sql` clears the 2024 sample measurements and keeps the standards; `packages/api/src/measured-weights.ts` saves the day's mean and bird count whenever a weight is typed in or removed (`routes/growth.ts`) and once at start-up; `routes/operations.ts` reads only measured days (`latestMeasured`, `curveToDate` in `cycle-day.ts`); the Growth card says which day was weighed. `bun test` in `packages/api` (`test/measured-weights.test.ts`, 7 tests) passes. **Kinect weights are deliberately not written here** until T2.7 has validated them.
- Description: decide the source of the Dashboard's daily weight: the day's mean of Kinect weights, the mean of typed-in `actual_weights`, or both (scale entry wins). Add an API job/route that upserts one `cycle_weights` row per day with `actual_g`, `sample_size`, `estimation_confidence`; stop reading seeded rows for days with no measurement.
- Files: `app/packages/api/src/routes/growth.ts`, `routes/operations.ts` (weight block), new migration if a `source` column is needed, `app/src/lib/farm/growth.ts`.
- Depends on: T1.0.
- Acceptance: with only typed-in weights for a day, the Dashboard shows exactly their mean and count; a day with no data shows no point; no seeded value appears for any day.

**T1.2 Decide and implement feed, water, activity, FCR** — *High*
- Description: no sensor exists. Either hide the cards and `FCR_TARGET` usage, or add manual entry (feed delivered per day) and compute FCR from it and the measured weight; activity % can come from the live monitor once T2.1 is done.
- Files: `app/packages/api/src/routes/operations.ts`, `app/src/lib/farm/growth.ts`, `app/src/components/farm/GrowthCard.tsx`.
- Acceptance: no card shows a number that has no writer; chosen manual-entry fields validate (≥ 0) and survive a restart.

**T1.3 Feed the AI briefing real data only** — *Critical*
- Description: replace `sampleForDay(...).farm` in `app/src/lib/intelligence.ts` with a snapshot from the live overview, live monitor, Kinect average and DHT22; when a field is unknown say so in the prompt and in the answer; set `GROQ_API_KEY`.
- Files: `app/src/lib/intelligence.ts`, `app/src/routes/intelligence.tsx`, `app/src/lib/analysis-insights.ts`.
- Acceptance: with the sample dataset deleted from the build, the briefing still works; with no data it says "not enough data" rather than inventing numbers; key missing gives a clear message.

**T1.4 Replace the remaining sample pages** — *High* (G-20)
- Description: Analytics Weight Growth tab from real weights (T1.1) and Kinect distribution; Flock Monitoring per-bird table: either remove it or drive it from Kinect tracking (needs an ID tracker, out of scope: recommend removal and keep the flock summary); Dashboard analysis report from real numbers.
- Files: `app/src/routes/telemetry.tsx`, `app/src/routes/flock-monitoring.tsx`, `app/src/routes/index.tsx`, `app/src/components/farm/GrowthDiagnostics.tsx`.
- Depends on: T1.1.
- Acceptance: `grep -r "sampleForDay" app/src` returns nothing outside tests; no `SampleNotice` rendered anywhere.

**T1.5 Honest Kinect fallback** — *High* (G-07) — **done 2026-11-04**: the Kinect panel shows "Kinect is not connected" (and keeps retrying) instead of the camera service's simulated picture and the sample K-001 weights; `src/routes/visuals.tsx`
- Description: when the bridge is not connected, show "Kinect is not connected" instead of the simulated picture with K-00x weights.
- Files: `app/src/components/farm/KinectDepthView.tsx`, `app/src/routes/visuals.tsx`, `app/src/lib/i18n/messages/`.
- Acceptance: stopping `KinectBridge.exe` shows the message within 10 s and no fake weights.

**T1.6 Clean production seed** — *High* (G-13)
- Description: split `0009`/`0011` into reference data (roles, sensor types, bounds, breed standard) and demo data; provide a `seed-farm` command that sets the real farm name, house, population, start date, and removes demo alerts/incidents/reports.
- Files: `app/packages/api/migrations/`, `app/packages/api/scripts/`.
- Acceptance: a fresh database plus the seed command shows no demo alert, incident or report and no "Data Cruz" name unless that is the real farm.

**T1.7 Remove dead code** — *Medium* (G-12) — **partly done 2026-11-04**: `app/packages/vision/` and the `dev:vision` script are removed; still to do: `cerebroil-backend/`, the `dataset.ts` helpers and `sample.ts` (after T1.4)
- Description: delete or archive `app/packages/vision/` and `cerebroil-backend/`; move `DEFAULT_LIGHTING`, `clock12`, `isNightCycle` out of `app/src/lib/farm/dataset.ts` into a small `lighting` module (used by `settings.tsx`, `LightingSection.tsx`, `CameraAnalysis.tsx`, `VideoDetectDialog.tsx`); delete `dataset.ts`/`sample.ts` after T1.4.
- Acceptance: build passes with those files gone; `npm run dev:vision` script removed.

### Phase 2 — Field integration and accuracy (O2, O5)

**T2.1 Turn on live behavior** — *High*. Set `LIVE_BEHAVIOR=1` in `cerebroil-stream/.env` on the Pi, restart `cerebroil-stream`. Acceptance: `/behavior/status` returns `running: true` with `age_seconds` < 60; Live Camera card shows numbers; thresholds (`LIVE_INACTIVE_SECONDS`, `LIVE_HUDDLE_SECONDS`) tuned after T2.9.

**T2.2 Autostart the Kinect services** — *High* (G-09). Windows Task Scheduler or a service for `kinect-bridge/bin/KinectBridge.exe` (with `KINECT_BRIDGE_KEY`) and `cerebroil-stream/kinect_seg.py` (`OMP_NUM_THREADS=2`), restart on failure. Acceptance: after a reboot both ports (8181, 8182) answer without anyone logging in.

**T2.3 Fixed addresses and network plan** — *High*. DHCP reservation for the Pi (or keep `behavior.local`), camera credentials (`DAHUA_RTSP_URL`) set on the farm network, firewall rules. Acceptance: the Pi, Dahua and laptop/host reach each other after a router restart.

**T2.4 Dahua camera at the farm** — *High*. Confirm RTSP path, substream, and frame rate at the farm. **Requires investigation** (tested on the school network only).

**T2.5 Kinect mounting and calibration** — *High*. Fix the camera height above the weighing area, re-check the depth-to-weight mapping at that height (the model assumes the training setup; `FX_REF=356.5`, "unregistered" mapping in `cerebroil-stream/kinect_weight.py`). Acceptance: a known object measured at three positions is within 5% of its true area.

**T2.6 Detector quality on site** — *Medium*. Run the detector on 100 farm frames (all lighting incl. night/IR) and keep misses for retraining. Acceptance: recall/precision recorded in `docs/validation.md`.

**T2.7 Weight validation protocol** — *High* (O5). Weigh at least 30 birds on a scale per session, on 3 different days, photograph/Kinect them in the weighing zone, store scale value and estimate (the `actual_weights` table already keeps the estimate shown at that moment). Compare per-bird and mean error; retrain with `cerebroil-stream/train_weight_model.py` on farm data if the mean error is above 5%. Acceptance: report with mean error, per-bird error spread and the days covered; error figure shown in the UI updated to the measured value.

**T2.8 Count validation** — *High*. Count birds by hand in 20 frames and compare with "Analyze data". Acceptance: mean absolute error recorded; shown on the Live Camera page as a caveat if above 10%.

**T2.9 Behavior validation** — *Medium*. Watch 2 hours of video, note true inactive/huddle episodes, compare with alerts from `behavior-monitor.ts`. Acceptance: false alarm rate and miss rate recorded; thresholds set from them.

### Phase 3 — Hosting (O3, O4)

**T3.1 Decide the topology** — *Critical*. Options: (a) always-on farm computer runs DB + API + web, Pi and Kinect on the same LAN, remote access by tunnel (Cloudflare/Tailscale); (b) cloud API + DB with a tunnel/VPN to the farm so the API can reach the Pi (G-16). Recommendation: (a) for the pilot, (b) after. Needs the user's provider and budget.
**T3.2 Process manager** — *Critical* (G-15). Run DB, API (`NODE_ENV=production`), web (`.output/server/index.mjs`) as services with restart on failure and boot start; add `Dockerfile`s or systemd/NSSM units. Acceptance: kill each process, it returns within 30 s; reboot, everything returns without login.
**T3.3 Production config** — *High*. `NODE_ENV=production`, `TRUST_PROXY`, `COOKIE_SECURE`, monitors on (`BEHAVIOR_MONITOR`, `SENSOR_MONITOR`); `app/packages/api/src/config.ts` already validates.
**T3.4 Link to the farm** — *High*. Tunnel or VPN so the API can reach `behavior.local:5000` and the Kinect bridge; token (`X-Vision-Token`) kept. Acceptance: Live Camera works from a phone on mobile data.
**T3.5 HTTPS and public access** — *High*. Use `app/scripts/start-public.ps1` on an allowed network or a named tunnel; confirm cookies are Secure and the gateway tests pass.
**T3.6 Monitoring** — *Medium*. External uptime check on `/health`, an alert when the API, DB, Pi or sensor is silent (reuse `notify.ts`).
**T3.7 CI** — *Medium*. GitHub Action: install, `tsc --noEmit` (web and API), tests, `vite build`. The repo is connected to Lovable: never force-push or rewrite pushed history (`app/AGENTS.md`).

### Phase 4 — Quality and handover (O6)

**T4.1 Tests** — *High* (G-06). Add Vitest. Priority: `app/src/lib/farm/video-weight.ts`, `app/src/lib/farm/growth.ts`, `app/packages/api/src/cycle-day.ts`, `lighting.ts`, `behavior-monitor.ts` raise logic, auth lockout, role checks, `scripts/public-gateway.mjs` (cookie prefixing, ticket check, forwarded-for replacement); Python: `cerebroil-stream/behavior.py` (huddle grouping) and `kinect_weight.py`. Acceptance: `npm test` runs in CI; coverage on the listed modules ≥ 70%.
**T4.2 Lint and formatting** — *Low* (G-14). Run Prettier once with a committed config and `.gitattributes` for line endings; fix the 55 `any` and 3 `exhaustive-deps`. Acceptance: `eslint .` has 0 errors.
**T4.3 Documentation** — *Medium* (G-18) — **partly done 2026-11-04**: `HOW_TO_RUN.md` §9 and §11, `README.md` and a status note at the top of `CEREBROILER.md` are current; still to do: rewrite the old sections of `CEREBROILER.md`, add `docs/validation.md`, remove `WEBSITE_GAPS_AND_PLAN.md`. Rewrite `app/HOW_TO_RUN.md` §11, `app/CEREBROILER.md`, `app/README.md`; delete `WEBSITE_GAPS_AND_PLAN.md`; add `docs/validation.md` and a backup/restore page.
**T4.4 Mobile and accessibility pass** — *Low*. Check each page at 375 px and with keyboard only (the project's `antislop.md` rules apply; ask the owner which antislop mode to use before UI work, per `app/AGENTS.md`).
**T4.5 Small fixes** — *Low* (G-19) — **done 2026-11-04**: the Test video requests stop when the browser's connection closes (`untilTimeoutOrDisconnect` in `routes/vision-proxy.ts`), so the lock is released; checked by `bun run test:node` (`test/demo-lock.node-test.ts`, fails on the old code, passes now; it runs on Node because Bun does not report the closed connection). Release `demoJobRunning` when the client disconnects (`routes/vision-proxy.ts`); abort the upstream job.
**T4.6 Security review** — *High*. `bun audit`/`npm audit`; re-check rate limits, CORS origins for the real domain, `helmet` CSP with the tunnel hostname, role checks on every new route (`/visual/behavior`, `/operations/sensor-history` require sign-in only: confirm that is intended).

### Optional enhancements (not needed for the objectives)
Per-bird tracking with persistent IDs (would justify the Flock Monitoring table); ammonia/feed/water sensors; automatic mortality; Telegram/SMS; multi-house support; offline mode.

---

## 8. Task Prioritization

| Priority | Tasks |
|----------|-------|
| Critical | T0.1, T0.2, T0.3, T1.0, T1.1, T1.3, T3.1, T3.2 |
| High | T0.4, T1.2, T1.4, T1.5, T1.6, T2.1–T2.5, T2.7, T2.8, T3.3–T3.5, T4.1, T4.6 |
| Medium | T1.7, T2.6, T2.9, T3.6, T3.7, T4.3 |
| Low | T4.2, T4.4, T4.5 |

Order: T0.2 (no dependencies, do today) → T0.4 → T0.1 → T0.3 → T1.0 → T1.1 → T1.3 → T1.5 → T1.2 → T1.4 → T1.6 → T1.7; T2.1–T2.6 in parallel on site; T2.7–T2.9 need field days; T3.x after T3.1 is decided.

## 9. Dependencies and Potential Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Kinect weights ≈ 18% per bird, model trained on one flock | Wrong decisions on individual birds | T2.7 validation; show the error; use flock mean for decisions |
| Laptop low on memory (0.3–2.6 GB free), Postgres child failures | Random outages during demos | T0.1; stop running the dev servers and Edge/Opera together |
| School network blocks tunnel port 7844 | No public link there | Use a home/hotspot network, or a named Cloudflare tunnel / Tailscale |
| Trained models exist only locally and are git-ignored | Loss of detector/weights | T0.3 backups; consider Git LFS or a private release asset |
| Lovable sync | History rewrites lose work | No force-push; keep the branch working |
| Cloud API cannot reach the Pi on a private LAN | Live camera breaks if hosted remotely | T3.1 (a) first, or VPN/tunnel (T3.4) |
| Seeded demo rows look real | Farmer acts on fake alert/report | T1.0, T1.6 |
| Secrets in chat or `.env` | Account takeover | T0.2; never paste secrets in chat |
| Windows leaves orphan processes (Python, tunnels) | Port clashes | Services (T3.2, T2.2) instead of hand-started windows |
| Dependency advisories (`minimatch`, `brace-expansion` via lint tools) | Low (dev only) | T4.6 |

## 10. Testing and Validation Strategy

1. **Static**: `tsc --noEmit` for web and API, ESLint, translation check (all new UI text present in Filipino and Cebuano) on every change.
2. **Unit tests** (T4.1): pure logic first (weights, growth, cycle-day, behavior thresholds, gateway).
3. **API integration**: Vitest against a throwaway Postgres (migrate, seed-farm, hit routes as ADMIN, OPERATOR, viewer, anonymous; expect 200/403/401).
4. **Hardware smoke test** (run on the farm, record in `docs/validation.md`): Pi `/health`, `/sensors`, `/behavior/status`; bridge `:8181` "Kinect is sending data"; `:8182 /latest` returns `ok:true` with a bird in view; Dahua stream visible on Live Camera.
5. **Ground-truth validation** (T2.7–T2.9): weight (scale), count (hand count), behavior (video review). Targets: weight mean error ≤ 5%, count error ≤ 10%, behavior alarms reviewed.
6. **Failure drills**: stop DB, API, Pi, bridge, unplug sensor, drop network; each shows an honest message and recovers by itself.
7. **Security**: login lockout, role matrix, anonymous access to `/visual/*`, cookie flags over HTTPS, token required for Kinect websocket.
8. **Soak**: 72 h unattended run with monitors on; no growth in memory, no gaps in `sensor_readings` beyond planned ones.

## 11. Final Completion Checklist

- [ ] O1: `grep -r "sampleForDay\|SampleNotice" app/src` returns nothing; every Dashboard/Analytics/Insights number traces to a writer in §2.2.
- [ ] O1: with the Kinect, Pi or sensor off, each affected card says so and shows no number.
- [ ] O2: after a full power cycle, the Pi, Dahua, Kinect services and sensor are back without human action; Live Camera works.
- [ ] O3: database and API restart on failure; nightly backup restored successfully at least once; models backed up twice.
- [ ] O4: no default or shared credential exists; all secrets rotated; site served over HTTPS; role matrix test passes.
- [ ] O5: `docs/validation.md` holds the weight, count and behavior measurements with dates and sample sizes, and the app shows the measured error.
- [ ] O6: `npm test` and CI green; `eslint .` clean; `HOW_TO_RUN.md`, `CEREBROILER.md`, `README.md` current; `WEBSITE_GAPS_AND_PLAN.md` removed.
- [ ] A farmer completes the pilot week (daily weigh-in, alerts handled) without the developer touching the system.

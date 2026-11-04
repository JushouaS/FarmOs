# Cerebroil / FarmOS — Development Plan

Updated 2026-11-04 on branch `responsive-login-local-db`; the newest code commit is `28cbcaf`, pushed. It was first written the same
day from an assessment at commit `1e22610` and is brought up to date after each piece of work. It replaces
`WEBSITE_GAPS_AND_PLAN.md` (deleted).

**How to read this file.** Every statement is either *Verified* (checked in code, by running a command, or on the live system) or marked
**Requires investigation**. Paths are relative to the git root (`gleam-screen-creator-main/`) unless they start with `app/`, which means
the web app folder `gleam-screen-creator-main/gleam-screen-creator-main/`.

## What is left, in order

This list comes first so the next person sees it first. Items marked **you** need the owner, the farm or a decision; **me** can be done by
the assistant without any of those.

| # | What | Who | Plan task |
|---|------|-----|-----------|
| 1 | Rotate the admin password (it was pasted in a chat) and the Gmail app password; turn on MFA for administrators | you | T0.2, S-2 in `docs/security-review.md` |
| 2 | Run `npx tsx scripts/seed-farm.ts --name "<farm>" --birds <n>` (dry run first, then `--yes`) to remove the 2024 demo rows and set the real farm | you (needs the farm's name) | T1.6 |
| 3 | Put `GROQ_API_KEY` in the root `.env` so the Insights AI can run | you | T1.3 |
| 4 | Copy `C:\Users\Jush\cerebroil-backups` to another computer, drive or cloud storage | you | T0.3 |
| 5 | Pi on the network; reseat the DHT22 wires and restart `dht22`; set `LIVE_BEHAVIOR=1` in the Pi's `.env` | you, at the farm | T0.4, T2.1 |
| 6 | Choose where the database and API run (and a budget); then process manager, tunnel, HTTPS | you decide, then me | T3.1–T3.6 |
| 7 | Pilot week: someone weighs birds on a scale and types them in; run the three validation measurements in `docs/validation.md` | you, at the farm | T2.7–T2.9 |
| 8 | Read the first GitHub Actions run of `.github/workflows/ci.yml` and fix what fails | me, after a push | T3.7 |
| 9 | Kinect programs start at sign-in: needs your OK to register two scheduled tasks (the start scripts exist) | you allow, me write | T2.2 |
| 10 | A screen-reader pass (NVDA or VoiceOver) and a colour-contrast measurement | a person | T4.4 |
| 11 | Format the whole code base once with Prettier, in its own commit, when nobody is editing in Lovable | me, when you say | T4.2 |
| 12 | Auth lockout and role-matrix tests; tests for `kinect_weight.py`; rewrite the old sections of `CEREBROILER.md` | me | T4.1, T4.3 |

**Objectives.** The request that started this file left the objectives blank. They come from the deployment-readiness goals agreed in
the working session. Edit them if they are wrong.

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

Cerebroil (UI name "CereBroiler") monitors a broiler pen: live camera, Kinect depth and weights, bird counts, behavior alerts, pen
temperature and humidity, weight growth against the Ross 308 standard, alerts and notifications.

| Part | Where | Tech | State |
|------|-------|------|-------|
| Web app | `app/src/` | TanStack Start/Router, React 19, Vite 8, Tailwind 4, Radix, react-query, zod 4; Nitro `node-server` for production | Typechecks and builds |
| API | `app/packages/api/` | Fastify 5, postgres.js raw SQL, jose JWT, bcrypt, helmet/cors/rate-limit, web-push, nodemailer | Typechecks; 12 route modules, 25 migrations |
| Database | local PostgreSQL 18, port 5434 (`app/packages/api/.pgdata`) | `bun run db:local:start` | Runs, but unreliable under memory pressure (G-01) |
| Camera service | `cerebroil-stream/` (on the Raspberry Pi) | Flask, onnxruntime detector, OpenCV, systemd units `cerebroil-stream` and `dht22` | Not answering from the laptop at the time of writing; model files are git-ignored |
| Kinect bridge | `app/kinect-bridge/` | C# (Kinect SDK 2.0), WebSocket `:8181` | Worked on 2026-11-03; not running now |
| Kinect chicken finder | `cerebroil-stream/kinect_seg.py` | YOLO11n-seg model, XGBoost weight model | Runs on the laptop, port `8182`; not running now |
| Public link | `app/scripts/public-gateway.mjs`, `start-public.ps1` | Node gateway + cloudflared quick tunnel | Built and tested locally (5 gateway tests); never run through a tunnel (port 7844 blocked on the school network) |
| Documentation | `app/HOW_TO_RUN.md`, `app/README.md`, `docs/` | | Current (see §2.4) |

API roles: `ADMIN`, `FARM_MANAGER`, `OPERATOR`, and read-only signed-in users (`requireRole` in `app/packages/api/src/auth/middleware.ts`).

---

## 2. Current Project Status

### 2.1 Health checks (verified 2026-11-04, after the last commit)

| Check | Result |
|-------|--------|
| `tsc --noEmit`, website and API | both pass |
| Production build (`vite build`, `NITRO_PRESET=node-server`) | builds |
| API tests (`bun test` in `app/packages/api`) | 17 pass: weights and Dashboard through the real routes, sensor monitor, validation maths |
| API test on Node (`bun run test:node`) | 1 passes (the video lock); it fails on the code before the fix |
| Website tests (`bun run test` in `app/`) | 6 pass: weight logic, AI snapshot |
| Gateway tests (`npm run test:gateway` in `app/`) | 5 pass |
| Behavior-engine tests (`python -m unittest test_behavior` in `cerebroil-stream`) | 7 pass |
| ESLint (`src`, `packages/api/src`) | **3,040 findings**: 2,954 `prettier/prettier` (formatting), 62 `no-explicit-any`, 15 `react-refresh/only-export-components`, 3 `exhaustive-deps`, 6 others |
| Browser check (built-in browser, 1280 px and 375 px, signed in as the administrator) | Dashboard, Live Camera, Analytics (both tabs), Flock Tracking, Insights, Alerts, Settings and the Test video box render correctly with the real-data and empty states; no page scrolls sideways at 375 px; console shows only the expected errors (Kinect socket and camera service off) |
| Keyboard and accessibility-tree check | eight pages pass: every control named, one H1 a page, no unlabeled inputs or charts; four problems found and fixed (see T4.4) |
| CI (`.github/workflows/ci.yml`) | written, **not yet run on GitHub** |
| Local services now | database, API (`4000`) and website (`8080`) up; Kinect bridge, chicken finder and Pi not answering |
| DHT22 on the Pi | offline since 2026-11-03 16:16; the API raised two "Sensor Offline" alerts (both are now marked read) |

### 2.2 Data sources: what is real

Verified by reading every `INSERT`/`UPDATE` in `app/packages/api/src` and by looking at the screens.

| Data on screen | Source | Status |
|----------------|--------|--------|
| Pen temperature, humidity (Live Camera, Dashboard, Analytics) | DHT22 → `sensor_readings` every 60 s; the Dashboard and Live Camera show only a reading from the last 5 minutes, or "Sensor offline, last reading 2 h ago" | **Real** when the sensor answers |
| Bird count on "Analyze data", huddle clusters | trained detector via `routes/vision-proxy.ts` | **Real**; accuracy unvalidated (T2.8) |
| Kinect outlines and per-bird weights; Weight Classification card | Kinect bridge → `kinect_seg.py`, shown live, not stored | **Real**, about 18% error per bird (T2.7); "Kinect is not connected" when the bridge is off |
| Behavior Breakdown, Analytics donut, Insights lines | live monitor on the Pi (`GET /visual/behavior`) | **Real code, switched off** (`LIVE_BEHAVIOR` not set on the Pi): shows "Behavior monitoring is off" |
| Dashboard Growth card, chart, growth report; Analytics weight tab; Flock Tracking | weights typed in (`actual_weights`) → `cycle_weights` per day (`measured-weights.ts`), `GET /growth/weight-spread`, `app/src/lib/farm/weights.ts` | **Real**; with none typed in every one of them says so |
| AI briefing and alert analysis (Insights) | `app/src/lib/farm/snapshot.ts` from the overview, typed-in weights, fresh readings, live monitor, alerts of the last 7 days; lists what is NOT MEASURED | **Real**; cannot run until `GROQ_API_KEY` is set |
| Mortality | `POST /growth/mortality` | **Real** (manual only) |
| Test video weights | `app/src/lib/farm/video-weight.ts` | **Derived**: the standard weight spread over birds by box size, shown with a 20% error |
| Feed, FCR, water, activity, ammonia | no sensor and no writer; tables empty | **Not shown** anywhere |
| Alerts raised by monitors | `behavior-monitor.ts`, `sensor-monitor.ts`, `notify.ts` | **Real** |
| Demo houses, cameras, sensors, alerts, incident, reports, cohorts (dated May 2024) | migration `0009` seed, still in the local database | **Demo rows**: removed by `seed-farm.ts` (T1.6), not yet run |
| `FCR_TARGET = 1.70` in `routes/operations.ts` | constant | Not displayed; harmless |

### 2.3 Database contents (verified 2026-11-04, local development database)

`cycle_weights` 7 rows, all standards only (the 2024 sample measurements were cleared by migration `0025`); `actual_weights` 0; `feed_samples`,
`water_samples`, `activity_samples`, `detections` 0; `users` 1; `sensor_readings` about 650 (DHT22). Demo rows still present: `alerts` 4 of 6
(the other two are real "Sensor Offline" alerts), `incidents` 1, `monitoring_reports` 1, `archived_reports` 3, `anomaly_events` 5, `cohorts` 4,
`houses` 3 extra (H01 4,210 birds, H03 4,260, H04 4,190) beside the real "Pen 1" (H02, 20 birds), `cameras` 2 extra beside the real `CAM-01`. The
facility is named `POULTRY_AI`.

### 2.4 Documentation (verified)

`app/HOW_TO_RUN.md` (run guide; §11 "what is real", "Setting up your own farm", backup note), `app/README.md` (current), `docs/security-review.md`,
`docs/validation.md` with `docs/templates/*.csv`. `app/CEREBROILER.md` carries a note at its top saying its older sections describe the first
design (28-bird sample pen, SQLite/Cloudflare); rewriting those sections is still open (T4.3).

---

## 3. Completed Features

Verified in code and exercised during the project.

- **Sign-in and accounts:** login, refresh-token rotation, lockout after 5 failures, MFA, one-time privacy agreement, admin-created accounts with an emailed temporary password (`routes/auth.ts`). The built-in `admin`/`admin` login is gone. First administrator made with `scripts/seed-admin.ts`. Role checks on every route that changes something.
- **Settings:** grow-out day window, lighting hours, flock size.
- **Alerts and notifications:** list, acknowledge, dismiss; in-app, web push and email (delivery to real inboxes and phones: **Requires investigation**). A "Sensor Offline" alert after 10 minutes of silence, once per outage.
- **Weights end to end:** type a bird's weight on Flock Tracking → the day's mean and bird count are saved → Dashboard card and chart, growth report, Analytics weight tab, spread and uniformity (shown from 5 birds) and the AI briefing all follow (`app/packages/api/src/measured-weights.ts`, migration `0025`).
- **Live Camera:** Dahua stream and Kinect through the API proxy with auto-reconnect; Kinect Picture and Depth 3D views, chicken outlines and weights; honest "not connected" and "sensor offline" states; sidebar status follows the camera-service check.
- **Analyze data** scan with the trained detector and saved huddle clusters.
- **Test video:** upload, boxes, automatic weights, a file checklist (format, size, length) with one "not ideal, use it anyway?" popup, the video's own full-screen button with the readings kept, and one-video-at-a-time that releases when the browser disconnects.
- **Pen sensor:** DHT22 reading, storage, daily history chart.
- **Live behavior engine** (`behavior.py`, `live_behavior.py`) and alert raising.
- **Three languages** (English, Filipino, Cebuano), with a translation check script kept outside the repo.
- **Public-link tooling** (gateway, start script), **database and model backup** (`scripts/backup-db.ps1`, nightly Windows task, restore tested), **clean-farm seed tool** (`scripts/seed-farm.ts`), **validation report tool** (`scripts/validation-report.ts`).
- **Accessibility:** keyboard-safe phone menu (inert until opened, focus in and back), heading order, target sizes.

## 4. Partially Implemented Features

| Feature | What exists | What is missing |
|---------|-------------|-----------------|
| Live behavior monitoring | Engine, alert raising, cards on three pages, 7 scenario tests | Switched off on the Pi; thresholds (`LIVE_INACTIVE_SECONDS`, `LIVE_HUDDLE_SECONDS`, `FDI_WARN`) never checked on a real flock (T2.1, T2.9) |
| Kinect weights | Model, per-bird and average, error shown | Trained on one flock (days 26–40); about 18% per bird; not validated on this farm; outlines can pick up non-chickens (confidence 0.25) (T2.7). Not used for the Dashboard curve on purpose |
| Pen sensor | DHT22 → DB → charts, offline alert and notice | Hardware fault on site; no ammonia, feed or water sensor |
| Public access | Gateway, script, production-mode API, tests | Never run with a tunnel; needs a network that allows outbound 7844, or another tunnel (T3.5) |
| AI briefing | Real-data snapshot, prompts, tests | `GROQ_API_KEY` not set, so never run end to end |
| Notifications | Web push + SMTP code | Real-world delivery untested |
| Backups | Dump and model zip, nightly task, restore tested | No copy off this laptop |
| Hosting | CI workflow (not yet run) | No Dockerfile, process manager, tunnel or monitoring; no host chosen (T3.x) |
| Kinect autostart | Start scripts | Scheduled-task installer not added (needs your OK) |
| Tests | 36 across API, website, gateway and behavior engine | Auth lockout, role matrix, `kinect_weight.py` |
| Accessibility | Keyboard and tree checks on eight pages | Screen reader, colour contrast, Test video box by keyboard |

## 5. Missing Features and Identified Gaps

| ID | Gap | Status |
|----|-----|--------|
| G-01 | Local PostgreSQL on Windows is unreliable under memory pressure (`could not reserve shared memory region`, error 487); a stop and start clears it | **Open** (T0.1) |
| G-02 | Dashboard weight curve was seed data | **Fixed** (T1.1) |
| G-03 | AI briefing was built from the sample flock | **Fixed** (T1.3); needs `GROQ_API_KEY` |
| G-04 | Dashboard feed, water and activity cards had no source | **Hidden** (T1.2); manual feed entry is optional |
| G-05 | No backup; trained models are git-ignored | **Mostly fixed** (T0.3): nightly dump and models zip, restore tested; copy off the laptop still to do |
| G-06 | No automated tests | **Mostly fixed** (T4.1): 36 tests; CI written, not yet run |
| G-07 | Kinect panel showed a simulated picture with fake weights | **Fixed** (T1.5) |
| G-08 | Admin password shared in chat; SMTP app password in `.env` | **Open** (T0.2) |
| G-09 | Kinect programs start by hand | **Partly** (T2.2): start scripts only |
| G-10 | DHT22 fault, no offline detection | **Software fixed** (T0.4); wires still to reseat |
| G-11 | Behavior monitor off, thresholds uncalibrated | **Open** (T2.1, T2.9) |
| G-12 | Dead code (`cerebroil-backend/`, `app/packages/vision/`, sample dataset) | **Fixed** (T1.7); an empty `cerebroil-backend/` folder with a git-ignored `.env` remains for you to delete |
| G-13 | Demo rows ship with every fresh database | **Tool written and tested** (T1.6); not yet run on the real database |
| G-14 | Lint: 3,040 findings, almost all formatting | **Open**, low (T4.2) |
| G-15 | No production hosting config | **Open** (T3.x); CI written |
| G-16 | API ↔ Pi traffic is plain http; a cloud API cannot reach a Pi on a private network | **Open** (T3.1, T3.4) |
| G-17 | Test-video weights are the standard weight redistributed | **Accepted**: shown with a 20% error and an explanation |
| G-18 | Documentation stale | **Mostly fixed** (T4.3); old sections of `CEREBROILER.md` remain |
| G-19 | Test video lock stayed set after a disconnect | **Fixed** (T4.5) |
| G-20 | Pages still on sample data | **Fixed** (T1.4) |
| G-21 | Website server sets no security headers of its own | **Requires investigation** (S-5 in `docs/security-review.md`) |
| G-22 | Administrators can sign in without MFA | **Open** (S-2) |

---

## 6. Objectives and Requirements Mapping

| Objective | Needs | Tasks | State |
|-----------|-------|-------|-------|
| O1 Real data only | Writer for weights; remove feed/water/activity; real AI input; honest Kinect fallback; clean seed | T1.0–T1.7 | Done in code; the seed tool still has to be run |
| O2 Pilot runs unattended | Pi/sensor repair, Kinect autostart, fixed addresses, behavior on | T0.4, T2.1–T2.6 | Not started on site |
| O3 Hosted, self-restarting, backed up | Stable DB host, backups, process manager, tunnel to the farm | T0.1, T0.3, T3.1–T3.7 | Backups mostly done; hosting not chosen |
| O4 Secure | Rotate credentials, HTTPS, minimal exposure, dependency check | T0.2, T3.5, T4.6 | Review done; rotation open |
| O5 Validated accuracy | Ground-truth protocol for weight, count, behavior | T2.7–T2.9 | Tools done; measuring open |
| O6 Handover | Tests, docs, lint | T4.1–T4.6 | Tests, docs, review mostly done; lint open |

---

## 7. Development Roadmap and Milestones

M0 stable base → M1 honest data (**done in code**) → M2 field pilot ready → M3 hosted → M4 handover quality (mostly done).

### Phase 0 — Stable base

**T0.1 Move the database off the unreliable Windows install** — *Critical*, open. Pick a stable host (the farm computer, a small Linux machine, or Postgres in Docker) and point `DATABASE_URL` there; migrations stay as they are. Depends on T3.1. Acceptance: a 24 h run with the web app, API and monitors on and no `error code 487` lines; `db:migrate` applies all 25 migrations on a blank instance.

**T0.2 Rotate credentials** — *Critical*, open. New admin password (`scripts/seed-admin.ts` or Settings → Accounts), new `JWT_SECRET` (MFA accounts must re-enroll), `VISION_SERVICE_TOKEN`, `KINECT_BRIDGE_KEY`; a new Gmail app password. Acceptance: the old admin password no longer works; `git grep` for the old values finds nothing.

**T0.3 Backups** — *Critical*, **mostly done**. `app/scripts/backup-db.ps1` writes a dump and (daily) a zip of the models into `C:\Users\Jush\cerebroil-backups`, keeps the newest 14 dumps; a Windows task "Cerebroil nightly backup" runs it at 8 pm and catches up if the laptop was off; a dump was restored into a scratch database and checked (49 tables, 1 user, 655 readings). Still to do: a copy on another computer, drive or cloud storage. Acceptance: a restore of last night's dump elsewhere matches; models exist in two places.

**T0.4 Repair the DHT22 and make faults visible** — *High*, **software done**. `sensor-monitor.ts` raises one "Sensor Offline" alert after `SENSOR_OFFLINE_MINUTES` (10) of silence (not again within 12 hours, even after a restart); Live Camera shows "Sensor offline · last reading 2 h ago". Still to do on site: reseat the wires and restart `dht22`. Acceptance: a new reading every minute for 1 h; unplugging the sensor raises the alert within 10 minutes.

### Phase 1 — Honest data (O1), **done**

**T1.0 Confirm what the database holds** — done (§2.3).

**T1.1 A real writer for `cycle_weights`** — done. Migration `0025_measured_weights.sql` makes `actual_g` nullable, adds `source`, clears the 2024 sample measurements and keeps the standards. `measured-weights.ts` saves the day's mean and bird count on every save or removal on Flock Tracking and once at start-up. The overview reads only measured days (never filled in from the curve) and gives the newest measurement with the standard for the day it was measured. Kinect weights are deliberately not used here until T2.7 validates them. Tests: `test/measured-weights.test.ts`.

**T1.2 Feed, water, activity, FCR** — done by hiding: no sensor exists, nothing displays them. A manual feed-entry form is optional.

**T1.3 AI briefing from real data only** — done (`snapshot.ts`, `intelligence.ts`; prompts say to use only snapshot figures). Still to do: set `GROQ_API_KEY`.

**T1.4 Replace the sample pages** — done: Analytics weight tab, Dashboard report and Flock Tracking use the typed-in weights (`weights.ts`, `GET /growth/weight-spread`); Flock Tracking lists B-001 to the pen's flock size.

**T1.5 Honest Kinect fallback** — done: "Kinect is not connected", retrying; no simulated picture.

**T1.6 Clean production seed** — tool done: `npx tsx scripts/seed-farm.ts --name "<farm>" [--house --birds --breed] [--yes]` (dry run unless `--yes`; one transaction). Tried on a restored copy: removed the demo incident, alerts, reports, anomaly events, cohorts, 2 cameras, 7 sensors and 3 houses; kept the real house, camera, readings and accounts; all API tests passed on the cleaned copy. **Not run on the real database: it needs the farm's name.**

**T1.7 Remove dead code** — done: `cerebroil-backend/`, `app/packages/vision/`, `dataset.ts`, `sample.ts`, `SampleBadge.tsx` and `WEBSITE_GAPS_AND_PLAN.md` deleted (in git history); lighting helpers in `lighting.ts`, weight helpers in `weights.ts`.

### Phase 2 — Field integration and accuracy (O2, O5)

**T2.1 Turn on live behavior** — *High*, open. `LIVE_BEHAVIOR=1` in the Pi's `cerebroil-stream/.env`, restart. Acceptance: `/behavior/status` returns `running: true` with `age_seconds` under 60; the cards show numbers.

**T2.2 Autostart the Kinect services** — *High*, **partly done**. `app/scripts/run-kinect-bridge.ps1` and `run-kinect-finder.ps1` start each program with its settings. Registering them as scheduled tasks was refused as unauthorized persistence; the owner decides (two `schtasks` lines were given in the session). Acceptance: after a reboot both ports (8181, 8182) answer.

**T2.3 Fixed addresses and network plan** — *High*, open. DHCP reservation for the Pi (or keep `behavior.local`), camera credentials on the farm network, firewall rules.

**T2.4 Dahua camera at the farm** — *High*, open (**Requires investigation**: tested on the school network only).

**T2.5 Kinect mounting and calibration** — *High*, open. Fix the height; re-check the depth-to-weight mapping (`FX_REF=356.5`, `kinect_weight.py`). Acceptance: a known object measured at three positions is within 5% of its area.

**T2.6 Detector quality on site** — *Medium*, open. 100 farm frames (including night and infrared), misses kept for retraining.

**T2.7 Weight validation** — *High*, tools done, measuring open. 30 or more birds on a scale on 3 different days. `docs/validation.md`, `docs/templates/weight.csv`, `npx tsx scripts/validation-report.ts weight <file>` (bias, typical error, share within 5 to 20%, each day's flock-average error against the 5% target). Then put the measured figure where the app says "about 18%" (`kinect_weight.py` `typical_error_percent`) and the Test video's 20% (`video-weight.ts`).

**T2.8 Count validation** — *High*, tools done, measuring open (20 pictures; error 10% or less).

**T2.9 Behavior validation** — *Medium*, tools done, measuring open (2 hours of video; hits, false alarms, misses, which threshold to change).

### Phase 3 — Hosting (O3, O4), open

**T3.1 Decide the topology** — *Critical*. (a) an always-on farm computer runs DB, API and web, the Pi and Kinect on the same LAN, remote access by tunnel (Cloudflare or Tailscale); (b) cloud API and DB with a tunnel or VPN so the API can reach the Pi (G-16). Recommendation: (a) for the pilot. Needs the owner's provider and budget.
**T3.2 Process manager** — *Critical*. DB, API (`NODE_ENV=production`) and web (`.output/server/index.mjs`) restart on failure and at boot. Not built: Docker was not used because the laptop lacked memory to test an image.
**T3.3 Production config** — *High*. `NODE_ENV=production`, `TRUST_PROXY`, `COOKIE_SECURE`, monitors on.
**T3.4 Link to the farm** — *High*. Tunnel or VPN so the API reaches `behavior.local:5000` and the Kinect bridge. Acceptance: Live Camera works from a phone on mobile data.
**T3.5 HTTPS and public access** — *High*. `scripts/start-public.ps1` on an allowed network, or a named tunnel.
**T3.6 Monitoring** — *Medium*. External uptime check on `/health`; alert when the API, DB, Pi or sensor is silent.
**T3.7 CI** — *Medium*, **written, not yet run on GitHub**: `.github/workflows/ci.yml` runs the website typecheck, tests and build, the API typecheck and tests against a PostgreSQL service, the gateway tests and the behavior-engine tests. The repo is connected to Lovable: never force-push or rewrite pushed history.

### Phase 4 — Quality and handover (O6)

**T4.1 Tests** — *High*, **mostly done** (36 tests, §2.1). Not yet: auth lockout and role matrix, `kinect_weight.py`.
**T4.2 Lint and formatting** — *Low*, open. One Prettier pass with a committed config and line-ending rules, then the 62 `any` and 3 `exhaustive-deps`. Do it in its own commit when nobody edits in Lovable.
**T4.3 Documentation** — *Medium*, mostly done. Open: rewrite the old sections of `app/CEREBROILER.md`.
**T4.4 Mobile and accessibility** — *Low*, mostly done. Done: browser check at 1280 px and 375 px; the pages' empty states; fixes for an unrounded "7.312…% below standard", a "Grade A, 100%" uniformity from three birds (now needs 5), a hard-coded green "System Online" in the sidebar (now follows the camera check); keyboard and tree checks on eight pages with four fixes (menu drawer inert until opened, takes and returns focus; two skipped heading levels; two controls under 24 px). Open: screen reader, colour contrast, the Test video box by keyboard, and the full-screen button in a normal browser (the built-in browser never completes a full-screen request, so only the enabled button was checked).
**T4.5 Small fixes** — *Low*, done (video lock).
**T4.6 Security review** — *High*, done: `docs/security-review.md`. Open items there: S-2 (MFA for administrators), S-5 (the website's own headers), S-8 (rotate shared passwords).

### Optional enhancements
Per-bird tracking with persistent IDs; manual feed entry and FCR; ammonia, feed and water sensors; automatic mortality; Telegram or SMS; multi-house support; offline mode.

---

## 8. Task Prioritization

| Priority | Open tasks |
|----------|-----------|
| Critical | T0.1, T0.2, T3.1, T3.2 |
| High | T1.6 (run it), T2.1–T2.5, T2.7, T2.8 (measuring), T3.3–T3.5, T0.3 (off-site copy), T0.4 (wires), S-2 |
| Medium | T2.6, T2.9, T3.6, T3.7 (first run), T4.3 |
| Low | T4.2, T4.4 (screen reader, contrast) |

## 9. Dependencies and Potential Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Kinect weights about 18% per bird, model trained on one flock | Wrong decisions on single birds | T2.7; show the error; use the typed-in flock mean for decisions |
| Laptop low on memory, Postgres child failures, test runs out of memory | Random outages | T0.1; do not run Docker, browsers and the dev servers together |
| School network blocks tunnel port 7844 | No public link there | Home or hotspot network, or a named tunnel / Tailscale |
| Trained models exist only locally and are git-ignored | Loss of detector and weights | T0.3 off-site copy; consider Git LFS or a private release |
| Lovable sync | History rewrites lose work; a half-committed branch looks broken (it happened once, fixed within minutes) | No force-push; commit related files together |
| Cloud API cannot reach the Pi on a private LAN | Live camera breaks if hosted remotely | T3.1 (a) first, or a tunnel (T3.4) |
| Demo rows look real | A farmer acts on a fake alert or report | Run `seed-farm.ts` (T1.6) |
| Secrets in chat or `.env` | Account takeover | T0.2; never paste secrets into chat |
| Windows leaves orphan processes | Port clashes | Services (T3.2, T2.2) instead of hand-started windows |
| Dependency advisories (`minimatch`, `brace-expansion` through ESLint) | Low: dev tools only | `bun audit` before each release (S-1) |
| Full-screen not verifiable in the built-in browser | The new full-screen behavior is unproven | Try it in a normal Chrome |

## 10. Testing and Validation Strategy

1. **Static:** `tsc --noEmit` for the website and API; ESLint; the translation check (every new UI string translated).
2. **Unit and integration:** `bun test` in `app/packages/api` (real routes, real database, signs in with a temporary session and cleans up; run only on a development database); `bun run test` in `app/`; `npm run test:gateway`; `bun run test:node` in `packages/api`; `python -m unittest test_behavior` in `cerebroil-stream`. CI runs them all.
3. **Browser check** after UI changes: each page at 1280 px and 375 px, empty and filled states, console errors, keyboard.
4. **Hardware smoke test** (on the farm): Pi `/health`, `/sensors`, `/behavior/status`; bridge `:8181` "Kinect is sending data"; `:8182 /latest` returns `ok:true` with a bird in view; Dahua stream on Live Camera.
5. **Ground truth** (T2.7–T2.9): `docs/validation.md`. Targets: flock-average weight within 5% on each day, count error 10% or less, behavior alerts reviewed.
6. **Failure drills:** stop the database, API, Pi, bridge; unplug the sensor; drop the network. Each shows an honest message and recovers by itself.
7. **Security:** `docs/security-review.md`, plus `bun audit` and the secrets scan before each release.
8. **Soak:** 72 h unattended with the monitors on; no memory growth, no unplanned gaps in `sensor_readings`.

## 11. Final Completion Checklist

- [x] O1: no `sampleForDay`, `SampleNotice` or sample dataset in `app/src`; each Dashboard, Analytics and Insights number traces to a writer (§2.2).
- [x] O1: with the Kinect, Pi or sensor off, each affected card says so and shows no number (seen in the browser).
- [ ] O1: the 2024 demo rows are gone from the real database (`seed-farm.ts` run).
- [ ] O2: after a full power cycle the Pi, Dahua, Kinect services and sensor come back without human action.
- [ ] O3: database and API restart on failure; a backup restored on another machine; models stored twice.
- [ ] O4: no default or shared credential; secrets rotated; HTTPS; MFA on administrator accounts.
- [ ] O5: `docs/validation.md` "Results" holds the weight, count and behavior measurements with dates and sample sizes, and the app shows the measured error.
- [ ] O6: CI green on GitHub; `eslint .` clean; `CEREBROILER.md` rewritten.
- [x] O6: `docs/security-review.md`, `docs/validation.md`, `README.md` and `HOW_TO_RUN.md` current; `WEBSITE_GAPS_AND_PLAN.md` removed.
- [ ] A farmer completes the pilot week (daily weigh-in, alerts handled) without the developer touching the system.

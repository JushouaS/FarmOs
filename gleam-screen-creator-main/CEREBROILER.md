# CereBroiler — Complete Project Documentation

> AI-powered broiler chicken farm monitoring system. Tracks flock health, environment, weight, and behavior in real time using computer vision and large language models.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Project Structure](#project-structure)
4. [Running the App](#running-the-app)
5. [Pages & Routes](#pages--routes)
6. [Data Model](#data-model)
7. [Environment Variables](#environment-variables)
8. [Key Components](#key-components)
9. [Intelligence / AI Layer](#intelligence--ai-layer)
10. [Dev Server Network Access](#dev-server-network-access)

---

## Project Overview

CereBroiler is a full-stack SSR web application for small-scale broiler chicken farmers. It gives a single-screen view of everything happening in the pen:

- Live camera feed with AI detections overlaid
- Real-time environment sensors (temperature, humidity, ammonia)
- Flock activity monitoring (active vs inactive birds)
- AI-generated health insights and alert triage (via Groq LLM)
- Weight growth tracking against Ross 308 breed standard
- Alerts system with severity levels and acknowledgement
- Analytics with tabbed views for weight, environment, and activity

The demo dataset is seeded from `src/lib/farm/dataset.ts` — a single pen of **28 Ross 308 broiler chickens** on **Day 14** of a 42-day grow-out cycle at **Data Cruz Poultry Farm**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [TanStack Start](https://tanstack.com/start) (SSR React) |
| Router | TanStack Router (file-based) |
| Data fetching | TanStack Query |
| Styling | Tailwind CSS v4 |
| UI components | Radix UI + shadcn/ui |
| Charts | Custom SVG (no external chart library) |
| AI / LLM | Groq API (`llama-3.3-70b-versatile`) |
| Build tool | Vite 8 |
| Runtime | Node.js (dev) / Cloudflare Workers (production via Nitro) |
| Package manager | Bun (lockfile) / npm (scripts) |

---

## Project Structure

```
gleam-screen-creator-main/
├── src/
│   ├── routes/                  # All pages (file-based routing)
│   │   ├── __root.tsx           # Root layout — HTML shell, AuthProvider, QueryClient
│   │   ├── index.tsx            # Dashboard (/)
│   │   ├── alerts.tsx           # Alerts (/alerts)
│   │   ├── flock-monitoring.tsx # Flock Monitoring (/flock-monitoring)
│   │   ├── intelligence.tsx     # Insights / AI (/intelligence)
│   │   ├── telemetry.tsx        # Analytics (/telemetry)
│   │   ├── visuals.tsx          # Live Camera (/visuals)
│   │   ├── settings.tsx         # Settings (/settings)
│   │   ├── contact.tsx          # Contact (/contact)
│   │   ├── notifications.tsx    # Notifications (/notifications)
│   │   └── login.tsx            # Login (/login)
│   │
│   ├── components/
│   │   ├── farm/
│   │   │   ├── AppShell.tsx     # Page wrapper with sidebar + topbar
│   │   │   ├── SideNav.tsx      # Collapsible sidebar navigation
│   │   │   ├── StatusFooter.tsx # System status bar at bottom of sidebar
│   │   │   ├── ThemeToggle.tsx  # Light/dark toggle
│   │   │   ├── TopNav.tsx       # Top navigation bar
│   │   │   └── Icon.tsx         # Icon helper
│   │   └── ui/                  # shadcn/ui component library
│   │
│   ├── lib/
│   │   ├── farm/
│   │   │   ├── dataset.ts       # Seed data — full FarmDataset object
│   │   │   ├── repository.ts    # Server functions (data access layer)
│   │   │   └── types.ts         # TypeScript types for all farm data
│   │   ├── intelligence.ts      # Groq API calls (briefing + alert triage)
│   │   ├── api-client.ts        # Vision stream URL helpers
│   │   ├── auth-context.tsx     # Auth state (useAuth hook)
│   │   └── error-page.tsx       # SSR error page HTML
│   │
│   ├── router.tsx               # TanStack Router factory (getRouter)
│   ├── start.ts                 # TanStack Start instance (CSRF + error middleware)
│   ├── server.ts                # SSR fetch handler (wraps @tanstack/react-start/server-entry)
│   └── styles.css               # Global Tailwind styles + custom .cb-card class
│
├── packages/
│   └── api/                     # Backend API package (Hono)
│       ├── src/
│       │   ├── app.ts           # Hono app entry
│       │   ├── auth/            # Auth routes + JWT middleware
│       │   ├── db/              # Database client (SQLite/Cloudflare D1)
│       │   └── routes/          # API route handlers
│       └── migrations/          # SQL migration files (0001–0012)
│
├── vite.config.ts               # Vite config (network access + SSR fix)
├── package.json                 # Root package.json
├── .env                         # Local env vars (gitignored)
└── .env.example                 # Template for env vars
```

---

## Running the App

### Prerequisites

- Node.js 20+
- npm or Bun

### Install dependencies

```bash
npm install
```

### Start the dev server

```bash
npm run dev
```

The server starts on port **8080** and is accessible on all network interfaces.

```
Local:   http://localhost:8080/
Network: http://192.168.x.x:8080/   ← other devices on the same Wi-Fi
```

### Start the API server (optional)

```bash
npm run dev:api
```

### Start the vision server (optional, Python)

```bash
npm run dev:vision
```

---

## Pages & Routes

### `/` — Dashboard

The main overview screen. Shows at a glance:

- **Top metrics row** — Total chickens, Average weight, Temperature, Humidity, Ammonia
- **Flock Overview** — Donut chart of active vs inactive birds with alert if any birds are inactive
- **Weight Trend** — Mini SVG line chart (actual vs Ross 308 target, last 5 data points)
- **Today's Status** — Quick health badges for Environment, Flock Activity, Camera
- **Recent Alerts** — Up to 3 unacknowledged alerts with severity badges

---

### `/alerts` — Alerts

Full alerts management page.

- Filter tabs: All / Critical / Warning / Info
- Each alert shows: severity badge, message, timestamp, expandable "What should I do?" section
- **Mark read** button per alert, **Mark all as read** button in header
- Alerts are loaded from the repository server function and managed in local state
- Severity styles: Critical (red), Warning (amber), Info (blue)

**Alert types in seed data:**

| ID | Kind | Severity |
|---|---|---|
| ALT-001 | Inactive Bird | critical |
| ALT-002 | High Temperature | warning |
| ALT-003 | System Update | nominal (info) |

---

### `/flock-monitoring` — Flock Monitoring

Four-tab view for detailed flock status:

| Tab | Contents |
|---|---|
| Overview | KPI cards (total, active, inactive, activity rate) + donut chart summary |
| Activity | Active/inactive split with progress bars and link to live camera |
| Bird Status | Visual grid of all 28 birds — green dot = active, red = inactive |
| Growth | Weight progress bar, Day 14 stats, projected harvest date |

Inactive birds are defined as: any open incident whose title contains "inactive".

---

### `/intelligence` — Insights

AI-powered analysis page, three sections:

1. **AI Insight** — Calls Groq API (`fetchSituationBriefing`) to generate a plain-language summary of the current flock state. Has a Refresh button. Falls back to a hardcoded default if the API key is missing.

2. **AI Alert Analysis** — Calls Groq API (`fetchFeedbackAlerts`) to triage the current alerts into structured objects (title, detail, action, severity). Only shown once data or an error is returned.

3. **Recommendations** — Static list of 4 best-practice tips with healthy/attention badges.

**Sidebar** shows:
- Key Observations (checkmarks and warnings)
- Next Focus (day of grow-out, harvest status)
- Quick Actions (links to Live Camera and Alerts)

---

### `/telemetry` — Analytics

Four-tab analytics view:

| Tab | Contents |
|---|---|
| Overview | 4 stat cards (weight, daily gain, FCR, mortality) + weight history chart + summary |
| Weight | Weight history chart, flock distribution (min/max/median/std dev) |
| Environment | Separate charts for Temperature, Humidity, Ammonia with range bars |
| Activity | 4 stat cards (active, inactive, activity rate, huddling) + 7-day activity index chart |

All charts are custom SVG — no recharts or other chart library used on this page.

---

### `/visuals` — Live Camera

Full-screen capable camera view.

- Loads `camera.stillUrl` (a Google-hosted image) as a placeholder for the live feed
- Overlays: LIVE badge top-left, temperature + humidity HUD bottom-left, fullscreen button top-right
- Info sidebar: Camera Details table, Environment readings, tip card
- Error state with retry button if the image fails to load
- `AppShell` is used in `bare` mode — no sidebar padding

---

### `/settings` — Settings

Two-column settings layout:

**Left column:**
- Farm Information (name, pen, location, manager)
- Pen & House (active status badge)
- Notifications (email / push / SMS toggles with local state)

**Right column:**
- Unit Preferences (°C, kg — read-only display)
- System Status (animated online dots for Camera, 3 sensors, last sync)
- Backup & Data (last backup time, backup status)

Save button shows a "Changes saved" confirmation for 2.5 seconds.

---

### `/login` — Login

Authentication page. Uses `useAuth` context.

---

### `/contact` — Contact

Contact/support form page.

---

### `/notifications` — Notifications

Notification history page.

---

## Data Model

All types are in `src/lib/farm/types.ts`. The main object is `FarmDataset` exported from `src/lib/farm/dataset.ts`.

### Core structure

```typescript
FarmDataset {
  facility:     Facility        // Farm name, houses, breed
  cycle:        FlockCycle      // Current grow-out cycle (day, dates)
  platform:     PlatformStatus  // App version, ML model, system health
  summary:      FarmSummary     // Overall status + confidence
  activity:     ActivityData    // Movement index, trend, time series
  weight:       WeightData      // Avg weight, standard, growth curve
  cohorts:      FlockCohort[]   // Per-pen weight distribution stats
  feed:         FeedData        // FCR, ADG, consumed kg
  water:        WaterData       // Intake L/hr, series
  volumetric:   VolumetricData  // 3D camera measurements (depth sensor)
  environment:  SensorReading[] // Temperature, humidity, ammonia
  cameras:      Camera[]        // Camera list with stillUrl
  detections:   Detection[]     // AI bounding boxes + behavior labels
  clusterWarning: ClusterWarning
  behavior:     BehaviorData    // Movement index, huddling risk, aggression
  incidents:    Incident[]      // Open/closed health incidents
  alerts:       Alert[]         // Notification alerts with severity
  timeline:     Timeline        // Event timeline with cursor
  references:   Reference[]     // Scientific references used by AI
  report:       ReportMeta
  archive:      ArchiveEntry[]  // Past reports (PDF/CSV)
}
```

### Seed values (Day 14 snapshot)

| Parameter | Value |
|---|---|
| Farm | Data Cruz Poultry Farm |
| Breed | Ross 308 |
| Population | 28 birds |
| Grow-out day | 14 of 42 |
| Avg weight | 1,320g (target: 1,300g, +1.5%) |
| Temperature | 29.1°C (range: 26–32°C) ✓ |
| Humidity | 63% (range: 50–70%) ✓ |
| Ammonia | 9 ppm (max: 25 ppm) ✓ |
| Active birds | 26 |
| Inactive birds | 2 |
| FCR | 1.64 (target: 1.70) ✓ |
| Activity rate | 91.4% |

### Selector helpers (exported from `dataset.ts`)

```typescript
activeBirds()              // 26 — total minus inactive incident count
inactiveBirds()            // 2
flockPopulation()          // 28
unacknowledgedAlerts()     // number of unread alerts
environmentStatus()        // worst sensor status level
minutesSinceLastAnomaly()  // minutes since last timeline event
lastAnomaly()              // most recent timeline event
houseLabel(id)             // "Pen 1"
houseReadings(id)          // SensorReading[] for a house
liveCamera()               // first camera
activeIncident()           // first open incident
```

---

## Environment Variables

Copy `.env.example` to `.env` and fill in your values.

```bash
# .env

# Required for AI Insights page (/intelligence)
# Get a free key at https://console.groq.com/keys
GROQ_API_KEY=gsk_...

# Optional: override the LLM model (default: llama-3.3-70b-versatile)
# GROQ_MODEL=llama-3.3-70b-versatile

# Tinyfish API key (optional, for additional AI services)
TINYFISH_API_KEY=sk-tinyfish-...
```

> ⚠️ Never commit `.env` — it is already listed in `.gitignore`.

If `GROQ_API_KEY` is missing, the AI Insight and AI Alert Analysis sections on `/intelligence` will show an error box with a retry button. All other pages work without it.

---

## Key Components

### `AppShell`

Wraps every page. Accepts an optional `bare` prop for the camera page (no padding).

```tsx
<AppShell>          // standard page with sidebar + scrollable content
<AppShell bare>     // full-height, no padding — used by /visuals
```

### `SideNav`

Collapsible sidebar. Collapses to icon-only mode on small screens. Navigation items:

- Dashboard (`/`)
- Analytics (`/telemetry`)
- Live Camera (`/visuals`)
- Flock Monitoring (`/flock-monitoring`)
- Insights (`/intelligence`)
- Alerts (`/alerts`) — shows unread badge count
- Settings (`/settings`)
- Contact (`/contact`)

### `cb-card` CSS class

Global card style defined in `styles.css`:

```css
.cb-card {
  background: white;
  border: 1px solid #D0DDD0;
  border-radius: 16px;
}
```

Used on every card across the app for consistent styling.

---

## Intelligence / AI Layer

File: `src/lib/intelligence.ts`

### `fetchSituationBriefing()`

Calls the Groq Chat Completions API with a system prompt and a JSON summary of the current farm state. Returns a plain-language briefing paragraph.

```typescript
{
  briefing: string   // 2–4 sentence health summary
  model: string      // model name used
  latencyMs: number  // response time
}
```

### `fetchFeedbackAlerts()`

Sends the current alerts array to Groq and asks it to triage them into structured objects.

```typescript
{
  alerts: Array<{
    title: string
    detail: string
    action: string
    severity: "critical" | "warning" | "info"
  }>
}
```

Both functions throw if `GROQ_API_KEY` is not set, which React Query catches and displays as an error state.

---

## Dev Server Network Access

The Vite dev server is configured to:

1. Bind to all network interfaces (`host: true`) — accessible on local Wi-Fi
2. Use a custom `createEnvironment` factory to force `RunnableDevEnvironment` for the `ssr` environment (required for TanStack Start's SSR middleware to install correctly)
3. Install a fallback SSR catch-all middleware so all routes (`/`, `/intelligence`, `/alerts`, etc.) are handled by the SSR runner instead of returning `Cannot GET /`

```
Local:   http://localhost:8080/
Network: http://192.168.1.x:8080/    ← share this with other devices
```

Other devices on the same Wi-Fi network can open any route directly (e.g. `http://192.168.1.13:8080/intelligence`).

---

*Generated: September 10, 2026*

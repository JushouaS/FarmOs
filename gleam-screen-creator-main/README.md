# Cerebroil (CereBroiler)

Monitors a broiler pen: live Dahua camera, Kinect depth with chicken outlines and weights, bird counts, behavior alerts,
pen temperature and humidity, weight growth against the Ross 308 standard, alerts and notifications.

| Part | Folder | What it is |
|------|--------|------------|
| Website | `src/` | TanStack Start, React 19, Vite 8, Tailwind 4 |
| API | `packages/api/` | Fastify 5, PostgreSQL (raw SQL, numbered migrations), JWT sessions |
| Camera service | `../cerebroil-stream/` | Python on a Raspberry Pi: stream, trained detector, behavior, DHT22 |
| Kinect bridge | `kinect-bridge/` | C# program that streams the Kinect to the website |
| Public link | `scripts/` | A gateway and a script that put the site behind one tunnel |

## Start here

- **Run it:** `HOW_TO_RUN.md` (one-time setup, daily start, checks, troubleshooting, security notes).
- **What is real and what is sample data, and what is left to do:** `../plan.md`.
- **Original design notes:** `CEREBROILER.md` (partly out of date, it says so at the top).

Quick start once set up (see `HOW_TO_RUN.md` for the first time):

```sh
cd packages/api && bun run db:local:start && bun run dev     # database, then API on :4000
bun run dev                                                  # website on :8080 (project root)
cd packages/api && bun run test                               # API tests (need the database; use a development one)
```

Other tests: `bun run test` (website logic), `npm run test:gateway` (public link), `npm run test:node` in `packages/api` (video
lock) and `python -m unittest test_behavior` in `../cerebroil-stream` (behavior engine). `../docs/` holds the security review and
the steps for checking the weights, counts and alerts against the real flock (`validation.md`).

Back up the database and the trained models with `powershell -ExecutionPolicy Bypass -File scripts/backup-db.ps1`.

## Lovable

This project is connected to [Lovable](https://lovable.dev). Commits pushed to the connected branch appear in the Lovable
editor, so do not force-push or rewrite pushed history, and keep the branch working (`AGENTS.md`).

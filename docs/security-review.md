# Security review, 2026-11-04

Scope: the API (`gleam-screen-creator-main/packages/api`), the website's use of it, the public-link gateway
(`scripts/public-gateway.mjs`) and the repository. Checked by reading the code and running the commands below.
This is a review by the developer's assistant, not an independent penetration test.

## What was checked and held up

| Check | How | Result |
|-------|-----|--------|
| Every route needs a sign-in, and every route that changes something needs a role | Read all 12 route modules in `src/routes/` (every `app.get/post/put/patch/delete` and its `preHandler`) | Only `POST /auth/login`, `/auth/refresh`, `/auth/mfa/login-verify` and `/auth/mfa/backup-code` are open, as they must be. Changes need `OPERATOR`, `FARM_MANAGER` or `ADMIN`; accounts and settings need `ADMIN` (settings also `FARM_MANAGER`). The new routes (`/visual/behavior`, `/operations/sensor-history`, `/growth/weight-spread`) only read and need a sign-in |
| Sign-in is protected against guessing | `routes/auth.ts`, `login_failures` table | Rate limit on the sign-in routes and a lock after 5 failures in 30 minutes per email and address; the same answer whether or not the email exists |
| Cookies | `routes/auth.ts` | `httpOnly`, `SameSite=Strict`, `Secure` over HTTPS. With `SameSite=Strict` and a fixed CORS list another site cannot make a signed-in browser send a request |
| CORS, headers | `src/app.ts` | Production allows only `API_CORS_ORIGINS`; helmet with a CSP, HSTS and `frame-ancestors 'none'` |
| Secrets in the repository | `git ls-files | grep .env`, `git grep` for key shapes (`gsk_`, `AIza`, private keys, `SMTP_PASS=` and similar values), and `git log -S"SMTP_PASS="` over all history | Only `.env.example` files are tracked and they hold placeholders. No real key, token or password was found in the files or in the history |
| Camera service | `cerebroil-stream/app.py` | Every route needs `X-Vision-Token`; a request from the same computer is the only exemption |
| Public link | `scripts/public-gateway.mjs` and its tests | The visitor's own `X-Forwarded-For` is replaced with Cloudflare's, the Kinect socket needs a signed ticket, cookie paths are prefixed |
| Uploads | `routes/vision-proxy.ts` | A size limit, one video at a time, rate limits, and the camera roles |

## Findings

| # | Finding | Risk | What to do |
|---|---------|------|------------|
| S-1 | `bun audit` reports 10 advisories (7 high, 3 moderate), all in `minimatch` and `brace-expansion`, reached only through ESLint and typescript-eslint. They are build tools: they are not in the website's production bundle or the API's runtime | Low | Do not use `overrides` to force new versions: ESLint's config loader uses the old `minimatch` interface and would break. Upgrade ESLint when its own release moves off them, and re-run `bun audit` before each release |
| S-2 | Administrator accounts can sign in without a second step: MFA exists (`/auth/mfa/*`) but is optional | Medium | Turn MFA on for every `ADMIN` account. A later change could refuse an `ADMIN` session until MFA is set up |
| S-3 | The API's overall rate limit (100 a minute) is keyed on the client address, because the person is not known yet at that stage. Everyone behind one farm router shares it | Low | Fine for one farm. If several people use the Live Camera together and see "rate_limit_exceeded", raise `max` in `src/app.ts` |
| S-4 | The API and the Raspberry Pi talk over plain http on the farm network (a known, documented choice). The token protects who may ask, but the traffic is readable on that network | Medium if the network is shared | Keep the Pi on a network you control. If the API moves to a cloud server, join it to the farm with a private tunnel (Tailscale or Cloudflare), not an open port |
| S-5 | The website server (TanStack Start / Nitro) sets no security headers of its own in this repository; only the API does | Medium | Put it behind the public gateway or a proxy that adds HSTS and a CSP, or add them in the Nitro config. **Requires investigation** of what the website actually sends |
| S-6 | The CSP on the API allows inline scripts. The API only answers JSON, so no page there runs scripts | Low | None needed; keep it in mind if the API ever serves HTML |
| S-7 | Optional feedback reports (`/feedback/report`, `/feedback/sus`) are written to files and, when `SUS_GOOGLE_SCRIPT_URL` and its token are set, sent to a Google Apps Script. The text people type goes to Google | Low | Leave the two settings empty unless that is wanted, and say so in the privacy policy if it is used |
| S-8 | The admin password was shared in a chat earlier and the Gmail app password lives in `packages/api/.env` | High until rotated | Rotate both (plan.md task T0.2). The `.env` files are git-ignored; keep them out of backups that leave the computer unencrypted |

## Re-running the checks

```bash
bun audit                                         # advisories
git ls-files | grep -i "\.env"                    # only *.env.example should appear
git grep -n -I -E "gsk_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY"   # no hits
cd gleam-screen-creator-main/packages/api && bun test                    # includes the role and session paths used above
```

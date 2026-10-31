# How to turn on the whole Cerebroil system

A step by step guide for Windows, written so you can study how the pieces fit together.
Every command below is typed into **Command Prompt (cmd)**. If you use PowerShell instead,
the commands are the same, except write `cd "path"` instead of `cd /d "path"`.

---

## 1. The big picture

Cerebroil is four programs that run at the same time and talk to each other.
You open **one window for each**. Nothing works properly until all four are running.

```
                    your browser  (http://localhost:8080)
                     |           \
                     |            \  live video + camera analysis
                     v             v
        +--------------------+   +---------------------------+
        |  WEB APP  :8080    |   |  CAMERA SERVICE  :5000    |
        |  (React / Vite)    |   |  (Python, cerebroil-      |
        |  the pages you see |   |   stream)                 |
        +--------------------+   |  reads the Dahua camera   |
                     |           |  and the Kinect (simulated)|
                     v           +---------------------------+
        +--------------------+                ^
        |  API  :4000        |----------------+  asks it to analyze a frame
        |  (Node / Fastify)  |                   (with a shared secret token)
        |  login, settings,  |
        |  alerts, reports   |
        +--------------------+
                     |
                     v
        +--------------------+
        |  DATABASE  :5434   |
        |  (PostgreSQL)      |
        |  farm data, users, |
        |  settings          |
        +--------------------+
```

| # | Program | Port | Folder | What it does |
|---|---------|------|--------|--------------|
| 1 | Database (PostgreSQL) | 5434 | `gleam-screen-creator-main\packages\api` (data in `.pgdata`) | Stores users, flock, settings, alerts |
| 2 | API server | 4000 | `gleam-screen-creator-main\packages\api` | Logins, all the data the pages show, saves your settings |
| 3 | Camera service | 5000 | `cerebroil-stream` | Connects to the camera, streams video, analyzes frames |
| 4 | Web app | 8080 | `gleam-screen-creator-main` | The website itself |

**Start them in this order:** database, API, camera, web app.
The API needs the database. The web app needs the API. The camera is only needed for Live Camera.

---

## 2. Folder layout

Everything lives under one parent folder:

```
drive-download-20260831T212213Z-1-001\
  gleam-screen-creator-main\                <-- PARENT folder
    cerebroil-stream\                        <-- camera service (Python)   [used]
    cerebroil-backend\                       <-- older Python/FastAPI backend [NOT used by the website]
    gleam-screen-creator-main\               <-- the project (git repo, web app)
      src\                                   <-- website code (React)
      packages\api\                          <-- API server + database scripts
      packages\vision\                       <-- alternative camera stub [NOT used, see section 9]
      HOW_TO_RUN.md                          <-- this file
```

Full paths used in this guide (copy them exactly, they are long):

```
PARENT   = C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main
PROJECT  = C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main
API      = C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main\packages\api
CAMERA   = C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\cerebroil-stream
```

---

## 3. One-time setup (do this once on a new computer)

You only need this section the first time, or after a fresh download.

### 3.1 Install the tools

| Tool | Version used here | Check it works |
|------|-------------------|----------------|
| Node.js | 22 | `node -v` |
| Bun (installs the website packages) | 1.3 | `bun --version` |
| Python | 3.13 | `python --version` |
| PostgreSQL | any recent, installed in `C:\Program Files\PostgreSQL\<version>` | look for that folder |

The local database script finds PostgreSQL there by itself. You do **not** need Docker and you do
**not** need to know the PostgreSQL superuser password.

### 3.2 Install the packages

Website and API (one command installs both, they are a workspace):

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main"
bun install
```

Camera service:

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\cerebroil-stream"
pip install -r requirements.txt
```

### 3.3 Create the settings files (`.env`)

Each program reads secrets and addresses from a file called `.env`.
These files are **never committed to git**. Each folder has a `.env.example` showing the names.
Copy it to `.env` and fill in the values:

```
copy "...\packages\api\.env.example"      "...\packages\api\.env"
copy "...\cerebroil-stream\.env.example"  "...\cerebroil-stream\.env"
copy "...\gleam-screen-creator-main\.env.example"  "...\gleam-screen-creator-main\.env"
```

What goes in each one (names only, keep the values private):

**`packages\api\.env`**

| Name | Meaning |
|------|---------|
| `DATABASE_URL` | Where the database is, for example `postgres://user:password@127.0.0.1:5434/dbname`. The local database script reads the port, user, password and name from here. |
| `JWT_SECRET` | A long random secret used to sign logins. At least 32 characters. |
| `API_HOST`, `API_PORT` | Use `0.0.0.0` and `4000` if you want phones on the same Wi-Fi to reach it. |
| `API_CORS_ORIGINS` | Websites allowed to call the API, for example `http://localhost:8080`. |
| `VISION_SERVICE_TOKEN` | A shared secret between the API and the camera service. **Must be identical in both `.env` files.** |
| `NODE_ENV` | `development` for everyday use. |

Make a random token with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**`cerebroil-stream\.env`**

| Name | Meaning |
|------|---------|
| `VISION_SERVICE_TOKEN` | Same value as in the API's `.env`. If it is missing, every camera request fails. |
| `DAHUA_RTSP_URL` | The camera's address: `rtsp://USER:PASSWORD@CAMERA-IP:554/...`. If the password has symbols such as `@` or `#`, they must be URL-encoded (`@` becomes `%40`). |
| `KINECT_SOURCE` | `simulated` (default, a fake depth picture), a device number like `0`, or a URL. |

**Project root `.env`**

| Name | Meaning |
|------|---------|
| `GROQ_API_KEY` | Needed only for the **Insights** page (the AI briefing). Get a free key at console.groq.com. Without it the Insights AI cards show a "key not configured" message and everything else still works. |

### 3.4 Create the database (once)

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main\packages\api"
npm run db:local:init
```

This creates the private database server in `packages\api\.pgdata`, then starts it.
Leave that window open (see section 4), then in a **second** window build the tables and demo data:

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main\packages\api"
npm run db:migrate
```

You should see lines like `✓ 0016_cycle_day_setting.sql` and `Migrations applied: N.`

---

## 4. Everyday start: turn everything on

Open **four** Command Prompt windows. Keep all four open while you use the system.

### Window 1: the database

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main\packages\api"
npm run db:local:start
```

It prints `waiting for server to start......` and can take 10 to 30 seconds.
The window stays busy: that is normal, it is the database running. Do not close it.
A message like `pg_ctl: another server might be running` right after a crash is usually harmless.

### Window 2: the API

Wait for the database to be ready first, then:

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main\packages\api"
npm run db:migrate
npm run dev
```

`db:migrate` only does something after you pull new code that added database changes.
It is safe to run every time. If it fails right after you started the database,
the database was still starting: wait a few seconds and run it again.

You should see:

```
API listening at http://127.0.0.1:4000
```

(and a second line with your computer's network address if the API is exposed to your Wi-Fi).

### Window 3: the camera service

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\cerebroil-stream"
python app.py
```

You should see:

```
[dahua] Connected (1920x1080).
 * Running on http://127.0.0.1:5000
```

If the camera cannot be reached you will see this instead, repeating every 3 seconds:

```
[dahua] Failed to open stream. Retrying in 3.0s ...
```

The service stays running and keeps retrying, so you can switch the camera on afterwards and
it connects by itself. Until then the Live Camera page shows no video. If you see
`[dahua] DAHUA_RTSP_URL is not set in .env; Dahua stream disabled.`, the camera address is
missing from `cerebroil-stream\.env`. See section 7.

### Window 4: the website

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main"
npm run dev
```

You should see:

```
➜  Local:   http://localhost:8080/
➜  Network: http://192.168.x.x:8080/
```

### Open it

Go to **http://localhost:8080** in your browser.

Development sign in (only works on your own computer in development mode):

```
Username: admin
Password: admin
```

---

## 5. Check that each part is alive

In any window:

```
netstat -ano | findstr ":5434 :4000 :5000 :8080"
```

Each of the four ports should appear with `LISTENING`. In PowerShell you can also use:

```
foreach ($p in 5434,4000,5000,8080) { "$p : " + (Test-NetConnection 127.0.0.1 -Port $p -WarningAction SilentlyContinue).TcpTestSucceeded }
```

Database status:

```
cd /d "...\packages\api"
npm run db:local:status
```

Camera video, straight from the camera service (no login needed):
open **http://localhost:5000/video_feed/dahua** in the browser. You should see live video.

---

## 6. Using it from your phone

1. Phone and computer must be on the **same Wi-Fi**.
2. Find the computer's address: run `ipconfig` and look for **IPv4 Address** (for example `192.168.1.38`).
3. On the phone open `http://192.168.1.38:8080`.
4. The website finds the API on the same address, port 4000, by itself.
5. If it does not load, Windows Firewall is probably blocking ports 8080, 4000 and 5000.
   Allow them (Windows Security, Firewall, Allow an app) or ask for help.

The API must be listening on all addresses (`API_HOST=0.0.0.0` in `packages\api\.env`).

---

## 7. Turning on and testing the camera

The camera is a Dahua IP camera reached over the network with **RTSP**.

1. The camera and the computer must be on the same network.
2. Put its address in `cerebroil-stream\.env` as `DAHUA_RTSP_URL`.
3. Test the network path first:

   ```
   ping CAMERA-IP
   ```

4. Start the camera service (Window 3). Look for `[dahua] Connected`.
5. Open http://localhost:5000/video_feed/dahua to see the raw video.
6. In the website open **Live Camera**, then press **Analyze data**.

What the pieces do:

- The website shows the video straight from port 5000.
- **Analyze data** goes browser, API (4000), camera service (5000). The API sends the shared token
  (`VISION_SERVICE_TOKEN`) so the camera service accepts the request.
- The Kinect weighing station shows a **simulated** picture unless the Kinect bridge below is running.

The message **"Vision service not reachable. Nothing is answering at localhost:5000"** simply means
Window 3 is not running, or it crashed. Start it again with `python app.py`.

### Camera plugged into a Raspberry Pi instead of the laptop (optional)

The camera service (`cerebroil-stream`) can run on a Raspberry Pi that has the Dahua camera on its
Ethernet cable. The laptop then only needs to reach the Pi over Wi-Fi. The Pi is **not** a router, so
no IP forwarding is needed.

Check first: the laptop and the Pi must be able to see each other. School or campus Wi-Fi often
blocks that. A phone hotspot or a small router works.

**On the Pi** (over SSH):

1. Give the Ethernet port an address on the camera's network, so it survives a reboot (current Pi OS).
   Do this only if your SSH session is over Wi-Fi, not over this cable:

   ```
   sudo nmcli con add type ethernet ifname eth0 con-name camera ipv4.method manual ipv4.addresses 192.168.0.51/24 ipv6.method ignore
   sudo nmcli con up camera
   ping -c 3 192.168.0.101
   ```

2. Copy the `cerebroil-stream` folder to the Pi, including its `.env`. Run this **on the laptop**,
   with your Pi's user name and Wi-Fi address filled in:

   ```
   scp -r cerebroil-stream YOUR-PI-USER@PI-WIFI-ADDRESS:~/
   ```

3. On the Pi, run the setup script. It installs the packages and a service that starts at boot:

   ```
   cd ~/cerebroil-stream
   bash setup-pi.sh
   ```

   It ends by printing the Pi's address. Open `http://PI-WIFI-ADDRESS:5000/video_feed/dahua` in the
   laptop browser to check the video.

**On the laptop**, point the website and the API at the Pi, then restart both (Windows 2 and 4):

- Project root `.env`: `VITE_VISION_ORIGIN=http://PI-WIFI-ADDRESS:5000`
- `packages\api\.env`: `VISION_SERVICE_URL=http://PI-WIFI-ADDRESS:5000`
- `VISION_SERVICE_TOKEN` must be the same in `packages\api\.env` and in the Pi's `cerebroil-stream/.env`.

Remove those two lines to go back to the camera service on the laptop.

### Live 3D depth from the Kinect (optional, Window 5)

A browser cannot talk to the Kinect, so a small Windows program streams its depth picture to the
website. With it running, **Live Camera** shows the Kinect as a 3D point cloud you can drag to
turn. Without it, the page falls back to the simulated picture and keeps retrying, so nothing breaks.

This is for the **Kinect v2** (Xbox One sensor with the USB 3.0 adapter). One-time: install the
[Kinect for Windows SDK 2.0](https://www.microsoft.com/en-us/download/details.aspx?id=44561) and
plug the sensor into a USB 3.0 port.

Build it once (and again after changing `kinect-bridge\Program.cs`):

```
cd /d "C:\Users\Jush\Downloads\drive-download-20260831T212213Z-1-001\gleam-screen-creator-main\gleam-screen-creator-main\kinect-bridge"
build.cmd
```

Then each time you want the 3D view:

```
kinect-bridge\bin\KinectBridge.exe
```

You should see `Kinect is sending data.` and `Kinect bridge ready on ws://localhost:8181`. Open
**Live Camera**, choose **Kinect**. A green `Live 3D depth` badge appears. Drag to turn the view,
double-click (or **Reset view**) to go back. Press Ctrl+C in that window to stop it.

It only accepts pages from this computer or your local network. To let a phone see the 3D view,
start it with `KinectBridge.exe --lan` from an administrator window.

---

## 8. Turning everything off

- In each of the four windows press **Ctrl + C**.
- For the database you can also stop it politely from the API folder:

  ```
  cd /d "...\packages\api"
  npm run db:local:stop
  ```

If you close a window without Ctrl + C, the program may keep holding its port. Find and stop it:

```
netstat -ano | findstr ":4000"
taskkill /PID <the number in the last column> /F
```

---

## 9. Things that exist but are not part of the normal start

- `gleam-screen-creator-main\packages\vision` is an alternative camera service that returns
  **placeholder** data. It also uses port 5000, so **never run it at the same time** as
  `cerebroil-stream`. The root script `npm run dev:vision` starts it; ignore that script.
- `cerebroil-backend` is an older FastAPI backend written for a Raspberry Pi (YOLOv8, ByteTrack, ROS 2).
  The website does **not** use it.

---

## 10. Troubleshooting

| What you see | Likely cause | Fix |
|--------------|--------------|-----|
| "Vision service not reachable" | Camera service not running | Window 3: `python app.py` |
| Browser says it cannot connect to localhost:8080 | Web app not running | Window 4: `npm run dev` |
| Pages load but are empty, or you are sent to the sign in page again and again | API or database not running | Check Windows 1 and 2, then sign in again |
| `db:migrate` fails right after starting the database | Database still starting | Wait 10 seconds and run it again |
| Sign in returns an error that says `rate_limit_exceeded` | Too many sign in attempts in a short time | Wait about 30 seconds |
| Signing in twice within one second gives an error | Known bug: two logins in the same second create the same token | Wait a second and try once |
| "Address already in use" or a port error | An old copy is still running | Use `netstat` and `taskkill` (section 8) |
| Camera video is blank but the service says Connected | Wrong camera path or password in `DAHUA_RTSP_URL` | Check the URL, URL-encode symbols in the password |
| Every camera request fails with `vision_token_not_configured` | `VISION_SERVICE_TOKEN` missing in `cerebroil-stream\.env` | Make it identical to the API's value |
| Insights page says the Groq key is not configured | `GROQ_API_KEY` not set | Add it to the project root `.env`, restart the web app |
| Phone cannot open the site | Different Wi-Fi, or Firewall | See section 6 |
| `bun install` or the site breaks after copying the folder | Stale installed packages | Delete `node_modules` and run `bun install` again |

Quick order to try when "nothing works": run `netstat -ano | findstr ":5434 :4000 :5000 :8080"`.
Whichever port is missing tells you which window to start.

---

## 11. Where to look in the code (for studying)

| You want to understand | Open this |
|------------------------|-----------|
| How the website is built and routed | `src\routes\` (one file per page), `src\routes\__root.tsx` |
| The Settings page | `src\routes\settings.tsx` and `src\components\farm\*Section.tsx` |
| How the website asks the API for data | `src\lib\farm\repository.ts` (server side), `src\lib\api-client.ts` (browser side) |
| Sign in and sessions | `src\lib\auth-context.tsx`, `packages\api\src\routes\auth.ts` |
| The grow-out day (Day 16 to 45) | `packages\api\src\cycle-day.ts`, `src\lib\farm\sample.ts` |
| All the API endpoints | `packages\api\src\routes\*.ts`, wired together in `packages\api\src\app.ts` |
| The database tables | `packages\api\migrations\*.sql` (numbered, applied in order) |
| How the camera is analyzed | `cerebroil-stream\app.py` (function `_analyze_dahua`), `src\lib\analysis-insights.ts` |
| The AI briefing (Insights page) | `src\lib\intelligence.ts` (Groq, Llama 3.3 70B) |
| The built-in sample data | `src\lib\farm\dataset.ts` |

What is real and what is a stand-in (important when you write about it):

- **Real:** the camera video, the frame-by-frame movement analysis (OpenCV), the logins, settings,
  database, and the Insights AI (when a Groq key is set).
- **Stand-in:** there is no trained detector (YOLO) and no weight model. The Kinect is simulated,
  and the per-bird weights on Analytics and Flock Tracking are sample data scaled to the chosen day.

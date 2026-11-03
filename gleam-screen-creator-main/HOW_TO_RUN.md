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

Go to **http://localhost:8080** in your browser and sign in with the administrator account. There is no built-in
login: `admin` / `admin` was removed and does not work anywhere. The administrator is made once, with a random
password that is shown only once, so save it in a password manager straight away:

```
cd packages\api
.\node_modules\.bin\tsx.exe scripts\seed-admin.ts
```

The user name is `admin@cerebroiler.dev`. Run the same command again any time to replace a lost password (the old one
stops working). Accounts are not open to the public: an administrator adds people in **Settings, Accounts**.

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

Camera video, straight from the camera service, on the computer that runs it:
open **http://localhost:5000/video_feed/dahua** in the browser. You should see live video. Any other
computer gets `unauthorized` from that address on purpose: everyone else watches through the website's
**Live Camera** page, which signs you in first.

---

## 6. Using it from your phone

1. Phone and computer must be on the **same Wi-Fi**.
2. Find the computer's address: run `ipconfig` and look for **IPv4 Address** (for example `192.168.1.38`).
3. On the phone open `http://192.168.1.38:8080`.
4. The website finds the API on the same address, port 4000, by itself.
5. If it does not load, Windows Firewall is probably blocking ports 8080, 4000 and 5000.
   Allow them (Windows Security, Firewall, Allow an app) or ask for help.

The API must be listening on all addresses (`API_HOST=0.0.0.0` in `packages\api\.env`).

### Sharing the site on a public link (optional)

For a demo to people outside your network (a panel, a visitor), one command makes the whole site reachable at a
temporary `https://...trycloudflare.com` address. Anyone who has the link can reach the sign-in page, so read the
points below first.

1. Make the administrator password, once: see "Open it" above (`scripts\seed-admin.ts`). Never share it.
2. Start the database (`bun run db:local:start` in `packages\api`). Build the Kinect bridge once (`kinect-bridge\build.cmd`)
   if you want the Kinect picture. Download `cloudflared.exe` (Cloudflare's free tunnel program, from
   github.com/cloudflare/cloudflared/releases, the `windows-amd64.exe` file) into `C:\Users\YOU\cloudflared\`.
3. Run:

```
powershell -ExecutionPolicy Bypass -File scripts\start-public.ps1
```

   It starts the API in **production mode** (port 4100), the production website (8180), the Kinect bridge with an access key,
   and `scripts\public-gateway.mjs` (port 9000), the one door that puts the website, the API (under `/api`) and the Kinect
   picture behind a single address. It then prints `PUBLIC LINK: https://...`. Use `-NoTunnel` to try everything on this
   computer first (`http://localhost:9000`), `-Rebuild` after changing the website, and `-Stop` to stop it all.

What is different from your own `localhost:8080` site:

- Nothing opens without an account. The API is in production mode, secure cookies are on, there is no built-in login,
  and the Kinect picture needs a ticket that only signed-in people get.
- The link changes every time, and works only while this computer and the script's programs are running. The
  Raspberry Pi must be on the same network as this computer for the camera, the scan, the Test video and the sensor.
- The tunnel needs this computer to reach Cloudflare on port 7844. School, office and public Wi-Fi often blocks it (the
  link then shows the error "530"). Use home Wi-Fi or a phone hotspot.
- Give people their own accounts (**Settings, Accounts**), not the administrator's.


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

   It ends by printing the Pi's address. The Pi answers only to the API (which sends the token) and to
   the Pi itself, so check the video from the laptop with the website's **Live Camera** page.

   **If the camera does not appear**, run the check script. It looks at the cable, the camera's address, the
   service and one real picture from the camera, and it never prints the camera's password. From the laptop,
   copy it to the Pi (your user name and the Pi's address filled in), then run it on the Pi and read what it says
   under "Summary":

   ```
   scp cerebroil-stream/check-pi.sh YOUR-PI-USER@PI-WIFI-ADDRESS:~/cerebroil-stream/
   ```

   ```
   bash ~/cerebroil-stream/check-pi.sh
   ```

**On the laptop**, point the website and the API at the Pi, then restart both (Windows 2 and 4):

- Project root `.env`: `VITE_VISION_ORIGIN=http://PI-WIFI-ADDRESS:5000` (only used for the "not answering" message now; the video itself comes through the API)
- `packages\api\.env`: `VISION_SERVICE_URL=http://PI-WIFI-ADDRESS:5000`
- `VISION_SERVICE_TOKEN` must be the same in `packages\api\.env` and in the Pi's `cerebroil-stream/.env`.

Remove those two lines to go back to the camera service on the laptop.

### Temperature and humidity: the DHT22 sensor on the Raspberry Pi (optional)

The pen's temperature and humidity come from a DHT22 sensor wired to the Pi. Switch the Pi **off** while you wire it.
This is for a Raspberry Pi 4 and the 3-pin module (a small board with three pins marked `+`, `OUT` and `-`):

| Sensor module | Raspberry Pi | Pin |
|---|---|---|
| `+` | 3.3 V power | **1** |
| `OUT` (data) | GPIO 4 | **7** |
| `-` | Ground | **6** |

Use 3.3 V, not 5 V (the Pi's pins must not see 5 V). A bare 4-pin DHT22 (no board) also needs a 10 kΩ resistor
between `+` and `OUT`; its pins, left to right with the grid facing you, are `+`, data, (not used), `-`.

Switch the Pi on, and on the Pi run (in the folder with the camera service; it installs one package, tests the
sensor once and starts a service that reads it all the time and at every boot):

```
cd ~/cerebroil-stream
bash setup-dht22.sh
```

An occasional failed try in the test is normal for this sensor. If **every** try fails, check the three wires and that
`OUT` is on pin 7 (counting from the corner pin 1, odd pins are the inner row). Another data pin: `DHT22_GPIO=17 bash
setup-dht22.sh` (the number after "GPIO"). Then restart the camera service so it can hand the reading on:
`sudo systemctl restart cerebroil-stream`.

What happens next: the reading is kept in `~/cerebroil-stream/dht22.json`, the camera service shows it at `/sensors`, and
the API asks for it every minute (`SENSOR_POLL_SECONDS`) and stores it as the two sensors `SN-DHT22-T` and `SN-DHT22-H`
of Pen 1 (migration `0024`, run `bun run db:migrate` in `packages\api` once). The **Pen Sensor Telemetry** card on
Live Camera and the dashboard then show real numbers, marked Warning or Critical outside the limits (temperature 20 to
32 °C, humidity 50 to 70 %; they are rows in `sensor_bounds`). A reading older than 5 minutes is not shown as real: the
card goes back to the sample values, marked as such. Ammonia is still a sample until that sensor is connected.

### Test video: the trained model on an uploaded clip (optional)

The small film button in the **Live Camera** header opens "Test video". You pick a clip from the
device, the camera service runs the trained detector over it, and the clip plays back with the boxes
drawn over it. Nothing is saved and the live camera is not touched.

The model file is not in the repository. On the machine that runs `cerebroil-stream` (the laptop, or
the Pi) put the YOLO ONNX export at `cerebroil-stream/models/detector.onnx`, or set
`DETECTOR_MODEL_PATH` in `cerebroil-stream/.env`. Install the new packages (`onnxruntime` and
`imageio-ffmpeg`) once there:

```
pip install -r requirements.txt            (laptop)
.venv/bin/pip install -r requirements.txt  (Raspberry Pi)
```

Limits: the first 30 seconds are checked, about 4 frames per second (`DEMO_MAX_SECONDS` and
`DEMO_SAMPLE_FPS` change that). A Raspberry Pi needs roughly a second per checked frame, so a 30
second clip can take a minute or two. Without the model file the dialog says the detector is not
installed.

The **Analyze data** button on Live Camera uses the same model. It takes about 3 seconds: four pictures a
second apart go through the detector, and the page shows how many birds were seen, the movement, and any group of
birds packed closely together (a huddle in one picture; how long it lasts is the live monitor's job). When the model
is not installed, or the detector is busy with an uploaded clip, it falls back to motion only and the page says
"Moving areas" instead of "Birds seen". `SCAN_DETECTOR=0` in `cerebroil-stream/.env` turns the detector off for the
scan. A bird's state (resting, inactive) needs minutes of watching, so the scan does not guess it.

Every check also gives a weight on each bird, with nothing to tick or type. A video has no depth, so this is not the
Kinect weight model: it spreads the standard weight for the grow-out day (Settings) over the birds in proportion to how
big each bird's box is. With the right average one bird is typically about 17 % off, and rougher in a video, because a
bird nearer the camera looks bigger and a box around a diagonal bird is bigger than the bird. If the clip shows birds of
a different age than the day in Settings, all the weights shift together. It needs at least 5 birds followed in at least
3 frames, and leaves out boxes cut off by the edge of the picture. The code is `src/lib/farm/video-weight.ts`.

What the result shows (code: `cerebroil-stream/behavior.py`): each detected bird is followed from
frame to frame and its box is colored by what it is doing.

The dialog has a **Recorded during: Day / Night** choice (it is guessed from the time in a file name
like `..._0600_to_0700.mkv` and the lighting hours in Settings, and you can change it). What a still
bird means depends on it:

- **Moving** (green): the bird is walking about.
- **Resting** (violet): still **at night**. This is normal sleep and is never flagged.
- **Inactive** (amber): by day, a bird that stayed within about a third of its own body size for the
  test time while at least a fifth of the flock was moving. This is the bird to go and look at.
- **Inactivity** (red): by day, when most of the flock is still too. No single bird stands out, so
  check the house (heat, cold, lighting, illness).
- **Huddling** (blue): a group of 5 or more touching birds, much denser than the flock as a whole,
  that stays together for the test time. A uniformly crowded house is not a huddle. The summary gives
  the share of birds in huddles (FDI) and warns above 35%.

The times are short on purpose so a short clip can show them: 10 seconds for inactive, 6 seconds
for a huddle (`BEHAVIOR_INACTIVE_SECONDS`, `BEHAVIOR_HUDDLE_SECONDS`, `BEHAVIOR_HUDDLE_MIN_BIRDS` in
`cerebroil-stream/.env`). For a real house they should be minutes to an hour. It does not know
about feeder and drinker areas, lights-off hours or temperature yet, so treat a flag as "go and look",
not as a diagnosis. It was tested on simulated flocks; check it on your own footage before trusting
the numbers.

Big and odd files:

- **MKV, AVI and similar** are converted automatically to a small MP4 first (browsers cannot play
  them, and the converted clip is also quicker to check). This uses `imageio-ffmpeg`, which brings its
  own ffmpeg, so there is nothing else to install: `pip install -r requirements.txt` on the machine
  that runs `cerebroil-stream`.
- **A file over 60 MB** can still be chosen. The page cuts it to exactly the first 60 MB in the
  browser and only sends that part. This works for MKV, WebM and MP4s that keep their index at the
  start. An MP4 with the index at the end (many camera and phone recordings) cannot be cut this way,
  and the dialog says so. Use an MKV or a smaller clip for those.

### Alerts and notifications

Every alert (a mortality spike, a bird the camera finds inactive, a huddle) is sent to each person the
way **Settings > Notifications** says: always on the Notifications page, and by **email** and
**browser push** when they are switched on, at or above the level chosen, and outside quiet hours
(critical alerts ignore quiet hours). The card shows which channels this server can actually send
on, and **Send a test** sends the signed-in person a test notice.

- **Email** needs mail settings in `packages\api\.env` (`SMTP_HOST`, `SMTP_FROM`, and `SMTP_USER` /
  `SMTP_PASS` if the mail server asks for a login; see `.env.example`). Without them the card says
  email is not set up and nothing is sent. A failed send is written to the `notifications` table with
  its reason.
- **Push** needs a key pair: run `npm run vapid` in `packages\api` and paste the two keys into `.env`.
  Each person then turns Push on in Settings and allows notifications in the browser when it asks.
  It works on `localhost` and on https, and the browser must not have blocked notifications for the site.
- Restart the API after changing `.env`. Run `npm run db:migrate` once (it adds the table for push).

**Alerts from the camera.** With the trained model installed on the camera computer (see "Test video"),
set `LIVE_BEHAVIOR=1` in `cerebroil-stream\.env` and restart it. It then follows the birds on the live
camera and the API (checking every 30 seconds) raises:

- **Inactive Bird**: birds that have not moved for 30 minutes while the rest of the flock moves (by day).
- **Flock Inactivity**: most of the flock still for 30 minutes during the day.
- **Huddling Detected**: 35% or more of the birds huddled together for 10 minutes.

At night (the lights-off hours in Settings) still birds are sleeping, so no inactivity alert is raised.
The same kind of alert is not raised again for an hour. The times are `LIVE_INACTIVE_SECONDS` and
`LIVE_HUDDLE_SECONDS`. Like the Test video check, these are flags to go and look, not a diagnosis, and
the numbers should be checked on your own flock.

### Actual weights in Flock Tracking

On **Flock Tracking**, type a bird's real weight in kilograms, with up to 3 decimals (like `0.946`),
into its **Actual Weight** box and press Enter. It is saved (per bird, per grow-out day, with the estimate
shown at that moment) and the page shows the
difference from the estimate: green within 5%, amber within 10%, red beyond. The summary shows how many
birds were weighed today and the average difference, so you can see how good the weight estimate is.
There is no submit button: the weight saves when you press Enter or click away, and a "Saved" note appears.
Once a bird has a weight, the "vs Standard" figure uses it instead of the estimate. Clear the box to remove a weight. Run `npm run db:migrate` once (it adds the table).

**Every day is new data.** The boxes belong to the grow-out day (it counts up at midnight), so a new day
starts with empty boxes and the earlier days stay saved. **Gain** on each bird shows how much it gained
since the last day it was weighed. The Dashboard's Growth card draws the pen's average weight by day against the standard, and that
average is the mean of the weights typed in here for the day (and how many birds were weighed). A day nobody
weighed has no point: the chart does not guess it. Run `npm run db:migrate` once (migration 0025 clears the
2024 sample weights the card used to show).

A weight is kept per bird and per grow-out day, so if someone changes the day in Settings to a day that
already has weights, those weights show again. Typing a new value for the same bird and day replaces the
old one, so the table never holds more than one row per bird per day.

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

The panel has two views, chosen with the **Picture** and **Depth 3D** buttons at its top right (the choice is
remembered in that browser). **Picture** is the normal colour camera. **Depth 3D** is the depth as a 3D view: yellow
is near, green farther, blue farthest, and black means the sensor got no reading there (closer than 0.5 m, farther
than 4.5 m, or a dark, shiny or see-through surface). The bridge only makes the pictures while somebody is watching
them. The picture is shown live and is not saved. After a change to `Program.cs`, run `build.cmd` again.

### Chicken outlines on the Kinect picture (optional)

On the **Picture** view the page can outline each chicken and count them. A small program does this on the
computer the Kinect is plugged into: `cerebroil-stream\kinect_seg.py`. It reads the colour picture from the bridge,
runs the trained segmentation model, and keeps the newest answer. Put the model at
`cerebroil-stream\models\kinect_chicken_seg.pt` (it is not in the repository, like `detector.onnx`), then:

```
cd cerebroil-stream
pip install -r requirements.txt
pip install -r requirements-kinect.txt     (once; it brings PyTorch, so it is big)
python kinect_seg.py
```

It only listens on this computer (`127.0.0.1:8182`). The API asks it (`GET /visual/kinect-chickens`, which needs a
sign-in), so nobody reaches it from outside. It works only while somebody has the Picture view open, and rests
otherwise. If it is not running, the Picture view says "Chicken finder is not running" and everything else works.
`KINECT_SEG_URL` in `packages\api\.env` changes where the API looks for it. In a room with no chickens it may still
find one now and then (a person or an object): the model counts anything above 25% confidence
(`KINECT_SEG_CONFIDENCE`).

**Weights.** Each outlined bird also gets an estimated weight. The Picture view shows it on the bird, and the
flock's average under the picture. The weight comes from the size of the bird's outline on the depth picture
(`cerebroil-stream\kinect_weight.py`): its footprint, length and width go into a small model
(`models\weight_model_size_v1.json`, not in the repository like the other models). The program asks the bridge for
the depth picture as well as the colour one. `pip install -r requirements-kinect.txt` brings `xgboost`, which it needs.

How far to trust it: one bird is typically about 18 % (about 175 g) off, because a footprint says only so much; the
flock's average from one picture is typically within about 5 % (tested on 40 labelled frames with the real outline
model). The model was trained on one flock, days 26 to 40, so check it with a few birds on a scale before relying on
it, and especially for birds much younger or older. To train it again on your own data (a CSV with the columns
`projected_area_mm2`, `length_mm`, `width_mm`, `elongation`, `pixel_count`, `weight_g`, `session` and `band_id`):
`python train_weight_model.py your.csv`. Without the model file, `xgboost` or the depth picture, the weights are left
out and everything else works.

It only accepts pages from this computer or your local network. To let a phone see the 3D view, first
make a key (at least 16 characters), put it in `packages\api\.env` as `KINECT_BRIDGE_KEY=...`, restart the
API, set the same value in the window that starts the bridge (`set KINECT_BRIDGE_KEY=...`), and start it with
`KinectBridge.exe --lan` from an administrator window. With a key, the website gives each signed-in viewer a
short-lived ticket and the bridge refuses anyone without one; `--lan` will not start without a key.

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


## Privacy Policy

The policy is at `/privacy` (anyone can read it, signed in or not) and is linked from the sign-in page and the account menu. After signing in, a person has to read a short summary and tick "I have read and understood" before the app opens; declining signs them out. The agreement is saved per person and per version in the `privacy_consents` table (with the time and IP address) and noted in `auth_audit`. Run `npm run db:migrate` once to add the table.

When the policy changes in a way that matters, edit the text in `src/lib/privacy-policy.ts`, set `POLICY_UPDATED` in `src/lib/privacy-version.ts`, and set `PRIVACY_VERSION` in `packages/api/src/routes/auth.ts` to a new value. Everyone is then asked to agree again at their next sign-in. The offline admin account (no API running) keeps its agreement in the browser instead.


## Security notes

What was found and closed in the security review, and what you still decide:

- **Accounts.** Only a signed-in administrator can create accounts (`POST /auth/register`). There is no built-in
  `admin` / `admin` login any more: the administrator is made by `scripts/seed-admin.ts` with a random password.
- **Wrong passwords.** Five wrong tries in 30 minutes lock that email from that network address for the rest of the
  30 minutes. The answers are the same whether or not the email has an account. The second-step code is limited
  per account. Run `npm run db:migrate` once (it adds the `login_failures` table).
- **Stored secrets.** Sessions keep a hash of the token, not the token. Two-step (MFA) secrets are encrypted with a
  key made from `JWT_SECRET`, so changing `JWT_SECRET` also means turning two-step sign-in off and on again for
  those accounts. Backup codes are stored as keyed hashes.
- **Camera service.** Every route needs the token (the API sends it). Only the computer the service runs on may
  open its own control page. The live picture reaches the website through the API. The API and the camera service
  talk over plain http, so keep them on a network you trust, or put a TLS proxy in front.
- **Camera actions.** Watching needs a sign-in; a scan, a capture or a test video needs the Operator, Farm Manager
  or Administrator role. One test video runs at a time.
- **Behind a proxy?** Set `TRUST_PROXY` to the proxy's address. Use HTTPS in production (`COOKIE_SECURE` stays on
  `auto` and the cookies become Secure there).
- **Older backend (`cerebroil-backend`).** Every route now needs an `X-API-Key` from `API_KEYS` (none set = closed),
  its ports are open to this computer only, and it needs `POSTGRES_PASSWORD` in `.env`. The website does not use it.
- **Accounts.** An administrator opens **Settings, Accounts** (only administrators see it) to add a person with an
  email, a role and a temporary password, to switch an account off or on, and to set a new temporary password. The
  person gets an email with the password; it works for `TEMP_PASSWORD_HOURS` (48 by default), and the first
  sign-in makes them choose their own. If nobody signs in in time, the sign-in says the password expired and the
  administrator sets a new one. Switching an account off or changing its password signs it out of every session at
  once, and an administrator cannot change their own account from this list. A person's roles are read from the
  database on every request, so a change applies on the next click. The same things are available on the API
  (`GET /auth/users`, `POST /auth/register`, `PATCH /auth/users/:id`, `POST /auth/users/:id/password`).
- **Email for new accounts.** It uses the same SMTP settings as the alert emails (`SMTP_*` in `packages\api\.env`).
  For Gmail: turn on 2-Step Verification, make an app password at https://myaccount.google.com/apppasswords, and put
  it (16 characters, no spaces) in `SMTP_PASS`. Restart the API afterwards. If the email cannot be sent, the account is
  still made and the screen says so, so the password can be given in person.
- **Known and accepted.** `minimatch` and `brace-expansion` have open advisories; they come in through the linting
  tools only, never in the running app. The API and the camera service talk over plain http (see above).

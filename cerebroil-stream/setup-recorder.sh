#!/usr/bin/env bash
# Sets up the daily one-hour recordings (recorder.py) on the Raspberry Pi, and only switches them on after checking
# that a real .mkv can be recorded, that the clock is right and that the SD card has room.
#
#   bash setup-recorder.sh                 day 1 is tomorrow, 07:00 to 08:00, then an hour later each day, 8 days
#   bash setup-recorder.sh 2026-11-08      day 1 on that date
#
# Run it in the cerebroil-stream folder (the one with recorder.py), after setup-pi.sh.
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"

START="${1:-$(date -d tomorrow +%F)}"
if ! date -d "$START" +%F >/dev/null 2>&1; then
  echo "The start date must look like 2026-11-08, not '$START'."
  exit 1
fi
START="$(date -d "$START" +%F)"

if [ ! -x .venv/bin/python ]; then
  echo "The camera service's Python environment (.venv) is missing: run setup-pi.sh first."
  exit 1
fi
.venv/bin/python -c "import imageio_ffmpeg, dotenv" 2>/dev/null || .venv/bin/pip install -q imageio-ffmpeg python-dotenv

# The schedule goes into .env (an older RECORD_* setting is replaced, everything else is left as it is).
touch .env
for line in "RECORD_START_DATE=$START" "RECORD_FIRST_HOUR=7" "RECORD_DAYS=8" "RECORD_STEP_HOURS=1" "RECORD_MINUTES=60"; do
  key="${line%%=*}"
  grep -v "^$key=" .env > .env.tmp || true
  echo "$line" >> .env.tmp
  cat .env.tmp > .env && rm -f .env.tmp
done
echo "Schedule saved in .env: day 1 is $START at 07:00."
echo

# Verify before starting. Nothing is switched on unless every check passes.
if ! .venv/bin/python recorder.py check; then
  echo
  echo "The recordings were NOT switched on. Fix what failed above, then run this again."
  exit 1
fi

sudo tee /etc/systemd/system/cerebroil-recorder.service >/dev/null <<EOF
[Unit]
Description=Cerebroil daily one-hour recordings (recorder.py)
After=network-online.target time-sync.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/python recorder.py run
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable cerebroil-recorder
sudo systemctl restart cerebroil-recorder
sleep 3
echo
echo "The recorder is on: $(systemctl is-active cerebroil-recorder). It waits for each slot and starts by itself,"
echo "also after a restart of the Pi. Files go to $DIR/recordings/."
echo "See what it has done:   .venv/bin/python recorder.py status"
echo "Its messages:           journalctl -u cerebroil-recorder -f"

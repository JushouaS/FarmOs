#!/usr/bin/env bash
# Sets up the camera service on a Raspberry Pi: the camera settings, a Python
# environment, the packages, a fixed address for the camera cable, and a service
# that starts by itself at boot.
#
# Run it on the Pi, in the folder that holds app.py and requirements.txt:
#   bash setup-pi.sh
# It asks for the camera login and the token the first time (when there is no .env yet).
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"

if [ ! -f .env ]; then
  echo "First time: the camera settings."
  read -r -p "Camera address [192.168.0.101]: " CAM_IP
  CAM_IP="${CAM_IP:-192.168.0.101}"
  read -r -p "Camera user name [admin]: " CAM_USER
  CAM_USER="${CAM_USER:-admin}"
  read -r -s -p "Camera password: " CAM_PASS; echo
  read -r -s -p "Token (the VISION_SERVICE_TOKEN from packages/api/.env on the laptop): " TOKEN; echo
  if [ -z "$CAM_PASS" ] || [ -z "$TOKEN" ]; then
    echo "The camera password and the token are both needed."
    exit 1
  fi
  # Characters like @ or : in a password must be escaped inside the camera address.
  ENC_USER="$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$CAM_USER")"
  ENC_PASS="$(python3 -c 'import sys,urllib.parse as u; print(u.quote(sys.argv[1], safe=""))' "$CAM_PASS")"
  umask 077
  cat > .env <<EOF
DAHUA_RTSP_URL=rtsp://$ENC_USER:$ENC_PASS@$CAM_IP:554/cam/realmonitor?channel=1&subtype=0
KINECT_SOURCE=simulated
VISION_SERVICE_TOKEN=$TOKEN
EOF
  umask 022
  echo "Saved .env (only you can read it)."
fi

sudo apt-get update
sudo apt-get install -y python3-venv python3-pip
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt

# The camera cable: a fixed address on the camera's network. No gateway, so the
# Pi keeps using Wi-Fi for everything else. Skip with SKIP_ETH=1.
if [ "${SKIP_ETH:-0}" != "1" ] && command -v nmcli >/dev/null 2>&1 && ! nmcli -t -f NAME con show | grep -qx camera; then
  sudo nmcli con add type ethernet ifname eth0 con-name camera \
    ipv4.method manual ipv4.addresses 192.168.0.51/24 ipv6.method ignore \
    connection.autoconnect-priority 100 || echo "Could not add the camera cable address; do it by hand."
  sudo nmcli con up camera || echo "(It comes up once the camera cable is plugged in.)"
fi

sudo tee /etc/systemd/system/cerebroil-stream.service >/dev/null <<EOF
[Unit]
Description=Cerebroil camera service
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR
ExecStart=$DIR/.venv/bin/python app.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now cerebroil-stream
sleep 4
systemctl --no-pager --lines=8 status cerebroil-stream || true

echo
echo "Camera service is running on port 5000. Open one of these from the laptop:"
hostname -I | tr ' ' '\n' | grep -v '^$' | sed 's#^#  http://#; s#$#:5000/video_feed/dahua#'
echo "Logs: journalctl -u cerebroil-stream -f"

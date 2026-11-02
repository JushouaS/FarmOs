#!/usr/bin/env bash
# Sets up the DHT22 temperature and humidity sensor on a Raspberry Pi: the GPIO library, one test read,
# and a service (dht22) that reads the sensor all the time and starts by itself at boot.
#
# Wire it first (Pi switched off): + to pin 1 (3.3 V), OUT to pin 7 (GPIO 4), - to pin 6 (GND).
# Then, on the Pi, in the folder that holds dht22_reader.py:
#   bash setup-dht22.sh
# A different data pin: DHT22_GPIO=17 bash setup-dht22.sh   (the number after "GPIO", not the pin number)
set -euo pipefail
cd "$(dirname "$0")"
DIR="$(pwd)"
GPIO="${DHT22_GPIO:-4}"

sudo apt-get update
sudo apt-get install -y python3-libgpiod

if ! /usr/bin/python3 -c "from gpiod.line import Direction" 2>/dev/null; then
  echo "The installed python3-libgpiod is too old (it needs version 2). Raspberry Pi OS 'Trixie' has it."
  exit 1
fi

echo
echo "== One test read (GPIO $GPIO). It can take up to 15 seconds; an occasional failed try is normal."
DHT22_GPIO="$GPIO" /usr/bin/python3 dht22_reader.py --once || echo "(The test read did not work. The service is still installed and keeps trying; see the hints in HOW_TO_RUN.md.)"

sudo tee /etc/systemd/system/dht22.service >/dev/null <<EOF
[Unit]
Description=Cerebroil DHT22 temperature and humidity sensor
After=multi-user.target

[Service]
User=$USER
WorkingDirectory=$DIR
Environment=DHT22_GPIO=$GPIO
ExecStart=/usr/bin/python3 $DIR/dht22_reader.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now dht22
sleep 3
systemctl --no-pager --lines=6 status dht22 || true

echo
echo "The newest reading is in $DIR/dht22.json, and the camera service shows it at /sensors."
echo "Logs: journalctl -u dht22 -f"

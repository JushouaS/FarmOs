#!/usr/bin/env bash
# check-pi.sh: run this ON THE RASPBERRY PI to find out why the Dahua camera does not show in Cerebroil.
#
#     bash ~/cerebroil-stream/check-pi.sh
#
# It only looks; it changes nothing. It never prints the camera's user name or password: the address
# in DAHUA_RTSP_URL is shown with the login hidden, and the token is only reported as set or not.
# Paste the whole output back when you ask for help.

DIR="$(cd "$(dirname "$0")" && pwd)"
ENVF="$DIR/.env"
FIXES=()

say() { printf '\n== %s\n' "$1"; }
ok()  { printf '  OK    %s\n' "$1"; }
bad() { printf '  FIX   %s\n' "$1"; FIXES+=("$1"); }
info(){ printf '        %s\n' "$1"; }
hide_login() { sed -E 's#(://)[^/@]*@#\1***:***@#'; }
env_value() { grep -E "^$1=" "$ENVF" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r"'"'"; }
port_open() { timeout 3 bash -c "echo > /dev/tcp/$1/$2" 2>/dev/null; }

say "1. The Pi's own network"
info "addresses: $(hostname -I 2>/dev/null)"
if ip link show eth0 >/dev/null 2>&1; then
  CARRIER="$(cat /sys/class/net/eth0/carrier 2>/dev/null || echo 0)"
  ETH_CIDR="$(ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | head -1)"
  if [ "$CARRIER" = "1" ]; then ok "eth0: a cable is plugged in and the other end is on"; else bad "eth0 shows no link: check the cable and that the camera has power (PoE or its adapter)"; fi
  if [ -n "$ETH_CIDR" ]; then ok "eth0 address: $ETH_CIDR"; else bad "eth0 has no address. Give it one on the camera's network (see HOW_TO_RUN.md, 'Camera plugged into a Raspberry Pi')"; fi
  WLAN_NET="$(ip -4 -o addr show dev wlan0 2>/dev/null | awk '{print $4}' | head -1 | sed -E 's#\.[0-9]+/.*##')"
  if [ -n "$WLAN_NET" ] && ip -4 -o addr show dev eth0 2>/dev/null | awk '{print $4}' | grep -q "^$WLAN_NET\."; then
    bad "eth0 also has an address on the Wi-Fi network ($WLAN_NET.x). The Pi then sends Wi-Fi traffic out of the cable and the laptop cannot reach it. Remove it: sudo ip addr del <that address> dev eth0, and from the saved connection (nmcli connection modify <name> -ipv4.addresses <that address>)"
  fi
else
  bad "this Pi has no eth0 port by that name (ip link)"
fi

say "2. What the service is told to use (.env)"
if [ ! -f "$ENVF" ]; then
  bad "no $ENVF: copy the cerebroil-stream folder with its .env (see HOW_TO_RUN.md)"
else
  URL="$(env_value DAHUA_RTSP_URL)"
  TOKEN="$(env_value VISION_SERVICE_TOKEN)"
  if [ -z "$URL" ]; then bad "DAHUA_RTSP_URL is not set in .env"; else
    ok "DAHUA_RTSP_URL = $(printf '%s' "$URL" | hide_login)"
    case "$URL" in *"@"*) ok "it has a user name and password in it" ;; *) bad "the address has no user:password@ part; most Dahua cameras need one" ;; esac
  fi
  if [ -n "$TOKEN" ]; then ok "VISION_SERVICE_TOKEN is set (${#TOKEN} characters; it must be the same in the laptop's packages/api/.env)"; else bad "VISION_SERVICE_TOKEN is empty in .env"; fi
fi

say "3. Can the Pi reach the camera?"
CAM=""
[ -n "$URL" ] && CAM="$(printf '%s' "$URL" | sed -E 's#^[A-Za-z]+://([^@/]*@)?([^:/]+).*#\2#')"
CAMPORT="$(printf '%s' "$URL" | sed -nE 's#^[A-Za-z]+://([^@/]*@)?[^:/]+:([0-9]+).*#\2#p')"; CAMPORT="${CAMPORT:-554}"
REACHABLE=0
if [ -n "$CAM" ]; then
  if ping -c 2 -W 1 "$CAM" >/dev/null 2>&1; then ok "$CAM answers a ping"; else info "$CAM does not answer a ping (some cameras ignore pings; the port test below matters more)"; fi
  if port_open "$CAM" "$CAMPORT"; then ok "$CAM port $CAMPORT (video) is open"; REACHABLE=1; else bad "nothing at $CAM:$CAMPORT. Either the camera is not at that address or it is off"; fi
fi

if [ "$REACHABLE" = "0" ] && [ -n "${ETH_CIDR:-}" ]; then
  NET="$(printf '%s' "$ETH_CIDR" | sed -E 's#\.[0-9]+/.*##')"
  say "4. Looking for the camera on the cable's network ($NET.0/24)"
  FOUND="$(seq 1 254 | xargs -P 60 -I{} sh -c "ping -c1 -W1 $NET.{} >/dev/null 2>&1 && echo $NET.{}" | sort -V)"
  if [ -z "$FOUND" ]; then
    bad "nothing on $NET.x answers. Dahua cameras are usually 192.168.1.108 from the factory. Try: sudo ip addr add 192.168.1.51/24 dev eth0   then   ping -c 3 192.168.1.108"
  else
    for ip in $FOUND; do
      line="$ip:"
      port_open "$ip" 554 && line="$line video(554)"
      port_open "$ip" 80 && line="$line web(80)"
      port_open "$ip" 37777 && line="$line dahua(37777)"
      info "$line"
    done
    bad "put the camera's address (the one marked video(554) or dahua(37777)) into DAHUA_RTSP_URL in .env, then: sudo systemctl restart cerebroil-stream"
  fi
fi

say "5. The camera service on this Pi"
if systemctl is-active --quiet cerebroil-stream 2>/dev/null; then ok "cerebroil-stream is running"; else bad "cerebroil-stream is not running. Start it: sudo systemctl enable --now cerebroil-stream   (if it does not exist, run: bash setup-pi.sh)"; fi
if ss -ltn 2>/dev/null | grep -q ':5000 '; then ok "port 5000 is listening"; else bad "nothing is listening on port 5000"; fi
info "last log lines:"
journalctl -u cerebroil-stream -n 12 --no-pager 2>/dev/null | hide_login | sed 's/^/          /' || info "(run with sudo to read the log)"

if [ "$REACHABLE" = "1" ] && [ -x "$DIR/.venv/bin/python" ]; then
  say "6. Opening one picture from the camera"
  RESULT="$(DAHUA_RTSP_URL="$URL" OPENCV_FFMPEG_CAPTURE_OPTIONS='rtsp_transport;tcp|timeout;6000000' "$DIR/.venv/bin/python" - <<'PY' 2>&1
import os, cv2
cap = cv2.VideoCapture(os.environ["DAHUA_RTSP_URL"], cv2.CAP_FFMPEG)
ok, frame = (cap.read() if cap.isOpened() else (False, None))
print(f"PICTURE {frame.shape[1]}x{frame.shape[0]}" if ok and frame is not None else "NO_PICTURE")
PY
)"
  case "$RESULT" in
    PICTURE*) ok "got a picture from the camera (${RESULT#PICTURE })" ;;
    *) bad "the camera answers but no picture came. Usually a wrong user name or password, or a wrong path in DAHUA_RTSP_URL (a typical path is /cam/realmonitor?channel=1&subtype=0); a password with @ or # must be written %40 or %23" ;;
  esac
fi

say "Summary"
if [ ${#FIXES[@]} -eq 0 ]; then
  WIFI_IP="$(ip -4 -o addr show dev wlan0 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  printf '  Everything looks right. If the website still shows no camera, the laptop must point at this Pi:\n  VISION_SERVICE_URL=http://%s:5000 in packages/api/.env\n' "${WIFI_IP:-$(hostname -I | awk '{print $1}')}"
else
  printf '  %d thing(s) to fix, in this order:\n' "${#FIXES[@]}"
  n=1; for f in "${FIXES[@]}"; do printf '  %d. %s\n' "$n" "$f"; n=$((n+1)); done
fi

#!/bin/bash
# Starts a temporary Cloudflare tunnel to the Studio and prints the one-click link for testers.
# Runs over TCP (http2): the default QUIC protocol collapsed on a line with packet loss.
# The address changes every time this is restarted, so send the new link each session.
#
#   scripts/tunnel.sh        # start (leave it running)
#   Ctrl+C                   # stop
set -e
cd "$(dirname "$0")/.."
CODE=$(grep -E '^ACCESS_CODE=' .env.local | head -1 | cut -d= -f2-)
LOG=$(mktemp)
~/.local/bin/cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:3000 > "$LOG" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; rm -f "$LOG"' EXIT
for _ in $(seq 1 40); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1 || true)
  [ -n "$URL" ] && break
  sleep 1
done
[ -z "$URL" ] && { echo "Tunnel did not start. Last lines:"; tail -5 "$LOG"; exit 1; }
echo
echo "Tunnel is up. Send this link to testers (it logs them in by itself):"
echo
echo "  $URL/api/access?code=$CODE&next=/studio"
echo
echo "Leave this window open. Ctrl+C stops the tunnel."
wait $PID

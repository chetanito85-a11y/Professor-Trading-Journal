#!/bin/bash
# Mac / Linux: double-click (Mac) ya terminal mein ./Start-Professor-OI.command
cd "$(dirname "$0")"
PORT=8765
URL="http://localhost:$PORT/index.html"
open_url() { open "$1" 2>/dev/null || xdg-open "$1" 2>/dev/null; }
if command -v python3 >/dev/null 2>&1; then
  (sleep 1.5; open_url "$URL") &
  echo ""
  echo "  Professor OI chal raha hai:  http://localhost:$PORT"
  echo "  Band karne ke liye Ctrl+C dabao ya window band karo."
  echo ""
  python3 -m http.server "$PORT" --bind 127.0.0.1
else
  open_url "index.html"
fi

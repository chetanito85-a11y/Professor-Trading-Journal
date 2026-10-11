#!/bin/bash
# Professor OI - Live Broker Connector (Mac / Linux)
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "Python nahi mila. https://www.python.org/downloads/ se Python 3.12 install karo."
  read -r -p "Enter dabao..." _; exit 1
fi
echo "Professor OI browser mein khul raha hai: http://127.0.0.1:8765"
echo "Broker page par apne broker ke Connect par click karo aur details bharo."
"$PY" connector/server.py
read -r -p "Connector ruk gaya. Enter dabao..." _

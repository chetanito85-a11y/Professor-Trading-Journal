#!/bin/bash
# Professor OI - Live Broker Connector (Mac / Linux)
cd "$(dirname "$0")"
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "Python nahi mila. https://www.python.org/downloads/ se Python 3.12 install karo."
  read -r -p "Enter dabao..." _; exit 1
fi
if [ ! -f connector/config.json ]; then
  cp connector/config.example.json connector/config.json
  echo "Pehli baar: connector/config.json ban gaya hai. \"broker\" set karo aur keys bharo."
  open -e connector/config.json 2>/dev/null || ${EDITOR:-nano} connector/config.json
  read -r -p "config.json save karke Enter dabao..." _
fi
"$PY" connector/server.py
read -r -p "Connector ruk gaya. Enter dabao..." _

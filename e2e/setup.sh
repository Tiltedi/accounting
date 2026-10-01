#!/bin/bash
# One-time setup per container: browser driver + Python libs for file checks.
set -e
cd "$(dirname "$0")"
npm install --silent
if [ ! -x /tmp/e2e-venv/bin/python ]; then
  python3 -m venv /tmp/e2e-venv
  /tmp/e2e-venv/bin/pip install --quiet openpyxl pypdf pillow
fi
echo "ready: export E2E_PYTHON=/tmp/e2e-venv/bin/python"

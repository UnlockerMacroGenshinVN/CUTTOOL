#!/usr/bin/env bash
set -euo pipefail

echo "==================================="
echo "  Building CUTTOOL (Cryss) for Linux"
echo "==================================="

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

mkdir -p build/dist build/temp

echo
echo "[*] Building Linux standalone binary via PyInstaller..."
if command -v nix &>/dev/null && [ -f "flake.nix" ]; then
    nix develop --command pyinstaller \
        --clean \
        --noupx \
        --onefile \
        --name "Cryss" \
        --distpath "build/dist" \
        --workpath "build/temp" \
        --specpath "build/temp" \
        src-linux/main.py
else
    pyinstaller \
        --clean \
        --noupx \
        --onefile \
        --name "Cryss" \
        --distpath "build/dist" \
        --workpath "build/temp" \
        --specpath "build/temp" \
        src-linux/main.py
fi

echo
echo "==================================="
echo "  BUILD SUCCESSFUL!"
echo "  Binary location: build/dist/Cryss"
echo "==================================="

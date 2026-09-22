#!/usr/bin/env bash
# ── CUTTOOL Linux Launcher ──────────────────────────────────────────────────
# Khởi chạy main.py với evdev / uinput cấp nhân (Kernel-level).
# Dùng: ./run.sh
# ─────────────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VENV_PYTHON="$PROJECT_DIR/.venv/bin/python"
MAIN_PY="$SCRIPT_DIR/main.py"

# Kiểm tra file chính
if [[ ! -f "$MAIN_PY" ]]; then
    echo "❌ Không tìm thấy $MAIN_PY"
    exit 1
fi

# Kiểm tra venv
if [[ ! -x "$VENV_PYTHON" ]]; then
    echo "❌ Không tìm thấy Python venv tại $VENV_PYTHON"
    echo "   Hãy tạo venv: python3 -m venv $PROJECT_DIR/.venv"
    exit 1
fi

# Đảm bảo kernel module uinput đã nạp
if ! lsmod | grep -q "^uinput"; then
    sudo modprobe uinput >/dev/null 2>&1 || true
fi

# Kiểm tra xem user hiện tại có đọc được file /dev/input/event* nào không
CAN_READ_EVENTS=0
for ev in /dev/input/event*; do
    if [[ -r "$ev" ]]; then
        CAN_READ_EVENTS=1
        break
    fi
done

# Chỉ chạy trực tiếp không sudo nếu THỰC SỰ đọc được event* VÀ ghi được uinput
if [[ "$CAN_READ_EVENTS" -eq 1 ]] && [[ -w /dev/uinput ]]; then
    exec "$VENV_PYTHON" "$MAIN_PY" "$@"
else
    echo "🚀 Cần quyền root để bắt phím và chuột (/dev/input/event*)..."
    exec sudo "$VENV_PYTHON" "$MAIN_PY" "$@"
fi

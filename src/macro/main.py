"""
main.py – Entry point của Cryss backend.

Luồng khởi động:
  1. Kiểm tra / yêu cầu quyền Administrator
  2. Load config đã lưu
  3. Khởi động keyboard + mouse listener
  4. Khởi động HTTP server (thread daemon)
  5. Chờ mãi mãi (blocking)

Tái cấu trúc (2026-08): tách thành core/ modules,
sửa bug fps2t, skk3as, log rotation, heartbeat timeout.
"""

import ctypes
import os
import sys
import threading

# ── Admin elevation (chỉ Win32) ───────────────────────────────────────────────
def _is_admin():
    try:
        return ctypes.windll.shell32.IsUserAnAdmin()
    except Exception:
        return False

if sys.platform == "win32" and not _is_admin():
    if getattr(sys, "frozen", False):
        # Packaged: re-launch chính exe với quyền admin
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", sys.executable, None, None, 0   # 0 = SW_HIDE: ẩn cửa sổ console
        )
    else:
        # Dev mode: re-launch pyw với file .py
        import shutil
        _pyw = shutil.which("pyw") or shutil.which("pythonw") or sys.executable
        ctypes.windll.shell32.ShellExecuteW(
            None, "runas", _pyw,
            os.path.abspath(__file__), None, 0              # 0 = SW_HIDE
        )
    sys.exit(0)   # exit 0 → Electron không báo lỗi "non-zero exit code"

if sys.platform == "win32":
    print(ctypes.windll.shell32.IsUserAnAdmin())

# ── Import core modules ───────────────────────────────────────────────────────
# Thêm thư mục cha vào sys.path để import `core.*` hoạt động dù chạy trực tiếp
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from core.config_io import load_config, log_debug
import core.runtime as rt
from core.server import start_http_server

from pynput import keyboard as kb
from pynput import mouse    as ms

# ── Load config & khởi tạo bindings ──────────────────────────────────────────
_cfg = load_config()
rt.FPSinput = int(_cfg.get("FPS", 120))
rt.apply_all_bindings(
    _cfg.get("comboSignKeys", {}),
    _cfg.get("customCombos", []),
)
log_debug(f"Backend khởi động: FPS={rt.FPSinput}, bindings={len(rt.active_bindings)}")

# ── Khởi động listeners ───────────────────────────────────────────────────────
kb.Listener(on_press=rt.on_press, on_release=rt.on_release).start()
ms.Listener(on_click=rt.on_click).start()

# ── Khởi động HTTP server (thread daemon) ─────────────────────────────────────
threading.Thread(target=start_http_server, daemon=True).start()

# ── Chờ mãi mãi ──────────────────────────────────────────────────────────────
threading.Event().wait()
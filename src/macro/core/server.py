"""
server.py – HTTP server cho giao tiếp frontend ↔ backend.

Bao gồm:
  - Heartbeat watchdog (timeout 15s, tăng từ 6s để không crash trên máy chậm)
  - ConfigHandler (BaseHTTPRequestHandler)
  - launch_game(), select_file_via_dialog()
  - start_http_server()
"""

import json
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from .config_io import (
    log_debug,
    load_config, save_config,
    load_unlocker_config, save_unlocker_config,
    get_unlocker_dir, get_unlocker_config_path,
)
import core.runtime as rt


# ── Heartbeat watchdog ────────────────────────────────────────────────────────
_last_heartbeat = time.time()


def update_heartbeat():
    global _last_heartbeat
    _last_heartbeat = time.time()


def start_heartbeat_watchdog(timeout_seconds=15):
    """
    Tự tắt backend nếu frontend không ping trong `timeout_seconds` giây.
    FIX: tăng từ 6 s → 15 s để tránh crash trên Win10 máy chậm.
    Grace period 12 s khi khởi động.
    """
    def _watchdog():
        time.sleep(12)   # chờ app khởi động hoàn toàn
        log_debug("Heartbeat watchdog đã bắt đầu theo dõi kết nối frontend…")
        while True:
            time.sleep(3)
            elapsed = time.time() - _last_heartbeat
            if elapsed > timeout_seconds:
                log_debug(
                    f"Mất kết nối frontend ({elapsed:.1f}s > {timeout_seconds}s). "
                    "Tự tắt backend…"
                )
                os._exit(0)

    threading.Thread(target=_watchdog, daemon=True).start()


# ── Game launch helpers ───────────────────────────────────────────────────────

def launch_game(game_path=None):
    if not game_path:
        cfg = load_unlocker_config()
        game_path = cfg.get(
            "GamePath",
            r"C:\Program Files\HoYoPlay\games\Genshin Impact game\GenshinImpact.exe",
        )

    if not game_path or not os.path.exists(game_path):
        return False, (
            f"Không tìm thấy file game tại:\n{game_path}\n"
            "Vui lòng chọn lại file GenshinImpact.exe trong phần Tùy chỉnh."
        )

    unlocker_dir = get_unlocker_dir()
    launcher_exe = os.path.join(unlocker_dir, "Launcher_2.exe")
    if not os.path.exists(launcher_exe):
        return False, f"Không tìm thấy Launcher_2.exe tại:\n{launcher_exe}"

    plugins_dir = os.path.join(unlocker_dir, "Plugins", "UnlockerIsland")
    os.makedirs(plugins_dir, exist_ok=True)

    # Copy DLL nếu chưa có
    dll_src = os.path.join(unlocker_dir, "CUTTOOL.UnlockerIsland.dll")
    dll_dst = os.path.join(plugins_dir, "CUTTOOL.UnlockerIsland.dll")
    if os.path.exists(dll_src) and not os.path.exists(dll_dst):
        try:
            shutil.copy2(dll_src, dll_dst)
        except Exception as e:
            log_debug(f"Failed to copy DLL: {e}")

    # Tạo config.ini nếu chưa có
    if not os.path.exists(os.path.join(plugins_dir, "config.ini")):
        save_unlocker_config({})

    log_debug(f"Executing Launcher_2.exe: '{launcher_exe}' '{game_path}'")
    try:
        subprocess.Popen([launcher_exe, game_path], cwd=unlocker_dir)
        return True, "Đã khởi động Launcher_2.exe và Game thành công!"
    except Exception as e:
        log_debug(f"Error executing Launcher_2.exe: {e}")
        return False, f"Lỗi khi khởi chạy Launcher_2.exe: {e}"


def select_file_via_dialog():
    """Mở hộp thoại chọn file qua PowerShell (Windows)."""
    cmd = (
        "[System.Reflection.Assembly]::LoadWithPartialName('System.windows.forms') | Out-Null; "
        "$dialog = New-Object System.Windows.Forms.OpenFileDialog; "
        "$dialog.Filter = 'Executable (*.exe)|*.exe|All files (*.*)|*.*'; "
        "$dialog.Title = 'Chọn file GenshinImpact.exe'; "
        "$res = $dialog.ShowDialog(); "
        "if ($res -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.FileName }"
    )
    try:
        res = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cmd],
            capture_output=True, text=True, timeout=60,
        )
        path = res.stdout.strip()
        return path if path else None
    except Exception as e:
        log_debug(f"File dialog error: {e}")
        return None


# ── HTTP Handler ──────────────────────────────────────────────────────────────

class ConfigHandler(BaseHTTPRequestHandler):

    def do_POST(self):
        log_debug(f"POST {self.path}")
        _ALLOWED = {
            "/save", "/run", "/shutdown", "/heartbeat",
            "/unlocker-config", "/launch-game", "/browse-game-path",
        }
        if self.path not in _ALLOWED:
            self.send_response(404); self.end_headers(); return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body   = json.loads(self.rfile.read(length)) if length > 0 else {}
            log_debug(f"POST body keys: {list(body.keys())}")

            # ── /heartbeat ──────────────────────────────────────────────────
            if self.path == "/heartbeat":
                update_heartbeat()
                self._json_ok()
                return

            # ── /shutdown ───────────────────────────────────────────────────
            if self.path == "/shutdown":
                log_debug("Nhận /shutdown. Tắt backend…")
                self._json_ok()
                threading.Thread(
                    target=lambda: (time.sleep(0.2), os._exit(0)),
                    daemon=True,
                ).start()
                return

            # ── /save ───────────────────────────────────────────────────────
            if self.path == "/save":
                save_config(body)
                rt.apply_all_bindings(
                    body.get("comboSignKeys", {}),
                    body.get("customCombos", []),
                )
                _fps = body.get("FPS")
                if _fps is not None:
                    try:
                        rt.FPSinput = int(_fps)
                        log_debug(f"FPS set to: {rt.FPSinput}")
                    except Exception:
                        pass

            # ── /run ────────────────────────────────────────────────────────
            elif self.path == "/run":
                rt.run_enabled = bool(body.get("enabled", False))
                log_debug(f"run_enabled → {rt.run_enabled}")
                if not rt.run_enabled:
                    for key in list(rt.running_states):
                        rt.running_states[key] = False

            # ── /unlocker-config ────────────────────────────────────────────
            elif self.path == "/unlocker-config":
                save_unlocker_config(body)

            # ── /browse-game-path ────────────────────────────────────────────
            elif self.path == "/browse-game-path":
                selected = select_file_via_dialog()
                resp = json.dumps(
                    {"ok": True, "path": selected} if selected else {"ok": False},
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(200, resp)
                return

            # ── /launch-game ─────────────────────────────────────────────────
            elif self.path == "/launch-game":
                ok, msg = launch_game(body.get("gamePath"))
                resp = json.dumps(
                    {"ok": ok, ("message" if ok else "error"): msg},
                    ensure_ascii=False,
                ).encode("utf-8")
                self._send(200 if ok else 400, resp)
                return

            self._json_ok()

        except Exception as e:
            log_debug(f"Error handling POST {self.path}: {e}")
            self.send_response(500); self.end_headers()

    def do_GET(self):
        if self.path == "/config":
            try:
                payload = json.dumps(load_config(), ensure_ascii=False).encode("utf-8")
                self._send(200, payload)
            except Exception:
                self.send_response(500); self.end_headers()

        elif self.path == "/unlocker-config":
            try:
                payload = json.dumps(load_unlocker_config(), ensure_ascii=False).encode("utf-8")
                self._send(200, payload)
            except Exception as e:
                log_debug(f"Error GET /unlocker-config: {e}")
                self.send_response(500); self.end_headers()
        else:
            self.send_response(404); self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin",  "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def log_message(self, *args):
        pass  # tắt log mặc định của HTTPServer

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _json_ok(self):
        self._send(200, b'{"ok": true}')

    def _send(self, status, body: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)


# ── Start ─────────────────────────────────────────────────────────────────────

def start_http_server():
    # start_heartbeat_watchdog()
    server = HTTPServer(("localhost", 5000), ConfigHandler)
    log_debug("HTTP server đang lắng nghe tại localhost:5000")
    server.serve_forever()

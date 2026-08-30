"""
config_io.py – Đọc/ghi config.json và config.ini unlocker.

Bao gồm:
  - Logger với RotatingFileHandler (giới hạn 1 MB, 2 backup)
  - load_config / save_config
  - load_unlocker_config / save_unlocker_config
  - Helpers đường dẫn
"""

import json
import os
import sys
import logging
import time
from logging.handlers import RotatingFileHandler

# ── Paths ────────────────────────────────────────────────────────────────────
if getattr(sys, 'frozen', False):
    _BASE_DIR  = os.path.dirname(sys.executable)
else:
    _BASE_DIR  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONFIG_PATH    = os.path.join(_BASE_DIR, "macro", "config.json") \
    if not getattr(sys, 'frozen', False) \
    else os.path.join(_BASE_DIR, "config.json")

# Nếu chạy frozen thì config ở cạnh exe; dev mode thì trong src/macro/
if getattr(sys, 'frozen', False):
    CONFIG_PATH = os.path.join(os.path.dirname(sys.executable), "config.json")
else:
    CONFIG_PATH = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "config.json"
    )

DEBUG_LOG_PATH = os.path.join(os.path.dirname(CONFIG_PATH), "debug.log")
DEBUG_LOGGING  = os.environ.get("CRYSS_DEBUG_LOG") == "1"

# ── Logger với rotation ──────────────────────────────────────────────────────
_logger = None

def _get_logger():
    global _logger
    if _logger is not None:
        return _logger
    _logger = logging.getLogger("cryss_debug")
    _logger.setLevel(logging.DEBUG)
    _logger.propagate = False
    try:
        handler = RotatingFileHandler(
            DEBUG_LOG_PATH,
            maxBytes=1_000_000,   # 1 MB
            backupCount=2,
            encoding="utf-8"
        )
        handler.setFormatter(
            logging.Formatter("[%(asctime)s] %(message)s",
                              datefmt="%Y-%m-%d %H:%M:%S")
        )
        _logger.addHandler(handler)
    except Exception:
        pass
    return _logger


def log_debug(msg):
    """Ghi debug log. Chỉ hoạt động khi env CRYSS_DEBUG_LOG=1."""
    if not DEBUG_LOGGING:
        return
    try:
        _get_logger().debug(msg)
    except Exception:
        pass


# ── Config JSON ───────────────────────────────────────────────────────────────
DEFAULT_CONFIG = {"comboSignKeys": {}}


def load_config():
    """Đọc config.json, trả về dict. Trả về DEFAULT_CONFIG nếu lỗi."""
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            log_debug(f"load_config error: {e}")
    return DEFAULT_CONFIG.copy()


def save_config(data):
    """Ghi dict ra config.json."""
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        log_debug(f"save_config error: {e}")


# ── Unlocker config helpers ───────────────────────────────────────────────────
def get_unlocker_dir():
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    candidates = [
        os.path.join(base, "unlocker"),
        os.path.join(os.path.dirname(base), "src", "unlocker"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]


def get_unlocker_config_path():
    if getattr(sys, 'frozen', False):
        base = os.path.dirname(sys.executable)
    else:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    candidates = [
        os.path.join(base, "unlocker", "Plugins", "UnlockerIsland", "config.ini"),
        os.path.join(base, "Plugins", "UnlockerIsland", "config.ini"),
        os.path.join(os.path.dirname(base), "src", "unlocker",
                     "Plugins", "UnlockerIsland", "config.ini"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return candidates[0]


_UNLOCKER_DEFAULTS = {
    "File": "CUTTOOL.UnlockerIsland.dll",
    "GamePath": r"C:\Program Files\HoYoPlay\games\Genshin Impact game\GenshinImpact.exe",
    "Vsync": 0, "FpsUnlock": 1, "TargetFps": 240,
    "FovUnlock": 1, "FovValue": 60, "HideUID": 0,
    "DisableCameraMove": 1, "DisableFog": 1,
    "RemoveTeamAnim": 1, "DisableBurstBlackscreen": 1, "ShowFPS": 0,
    "BlockNetwork": 0, "EnableNetworkToggle": 0,
    "NetworkToggleKey": 122, "ToggleKey": 36,
}


def load_unlocker_config():
    """Đọc config.ini unlocker, trả về dict với giá trị mặc định."""
    result = dict(_UNLOCKER_DEFAULTS)
    path   = get_unlocker_config_path()

    if not os.path.exists(path):
        return result

    try:
        current_section = None
        with open(path, "r", encoding="utf-8") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith(";") or line.startswith("#"):
                    continue
                if line.startswith("[") and line.endswith("]"):
                    current_section = line[1:-1].strip()
                elif "=" in line:
                    k, v = line.split("=", 1)
                    k, v = k.strip(), v.strip()
                    if current_section and k.lower() == "value":
                        try:
                            result[current_section] = int(v)
                        except ValueError:
                            result[current_section] = v
                    elif not current_section:
                        result[k] = v
    except Exception as e:
        log_debug(f"load_unlocker_config error: {e}")

    return result


_UNLOCKER_SECTIONS = [
    "GamePath", "Vsync", "FpsUnlock", "TargetFps", "FovUnlock", "FovValue",
    "HideUID", "DisableCameraMove", "DisableFog", "RemoveTeamAnim",
    "DisableBurstBlackscreen", "ShowFPS",
    "BlockNetwork", "EnableNetworkToggle", "NetworkToggleKey", "ToggleKey",
]


def save_unlocker_config(data):
    """Ghi dict ra config.ini unlocker."""
    path = get_unlocker_config_path()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    except Exception:
        pass

    # Alias fix
    if "DisableBurstBackscreen" in data and "DisableBurstBlackscreen" not in data:
        data["DisableBurstBlackscreen"] = data["DisableBurstBackscreen"]

    file_val = data.get("File", "CUTTOOL.UnlockerIsland.dll")
    lines    = [f"File={file_val}\n\n"]

    ordered = list(_UNLOCKER_SECTIONS)
    for k in data:
        if k not in ordered and k not in ("File", "DisableBurstBackscreen"):
            ordered.append(k)

    for sec in ordered:
        if sec in data:
            val = data[sec]
            if isinstance(val, bool):
                val = 1 if val else 0
            lines.append(f"[{sec}]\nValue={val}\n\n")

    try:
        with open(path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        log_debug(f"Saved unlocker config to: {path}")
    except Exception as e:
        log_debug(f"save_unlocker_config error: {e}")

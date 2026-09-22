"""
config_io.py – Đọc/ghi config.json cho Linux CLI.

Phiên bản đơn giản: không có unlocker config, không có server.
"""

import json
import os
import sys
import logging
from logging.handlers import RotatingFileHandler

# ── Paths ────────────────────────────────────────────────────────────────────
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CONFIG_PATH    = os.path.join(_BASE_DIR, "config.json")
DEBUG_LOG_PATH = os.path.join(_BASE_DIR, "debug.log")
DEBUG_LOGGING  = True

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
DEFAULT_CONFIG = {
    "FPS": 120,
    "comboSignKeys": {},
    "customCombos": [],
}


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

"""
runtime.py – Global state, combo sequences, key bindings, worker thread, listeners.

Bao gồm:
  - Global state (pressed, running_states, active_bindings, …)
  - is_no_key_pressed() helper
  - Combo sequences C0
  - COMBO_MAP, STEP_MAP
  - build_custom_combo_fn()
  - apply_all_bindings()
  - parse_input()
  - worker() – thread thực thi macro với crash recovery
  - on_press / on_release / on_click
"""

import threading
import time
from pynput.keyboard import Key, KeyCode
from pynput.mouse    import Button

from .macros     import (
    skk3aw, skk3as, skk2as, skk2a,
    skk2az, skk2azs, skk2azs_slow,
    skk5as, skk5a, skk2aq, skke,
)
from .config_io import log_debug

# ── Global state ──────────────────────────────────────────────────────────────
run_enabled     = False       # bật/tắt bởi nút RUN trong UI
active_bindings = {}          # { pynput_key: combo_fn }
running_states  = {}          # { pynput_key: bool }
pressed         = set()       # tập phím/nút đang giữ
_thread_local   = threading.local()
FPSinput        = 120         # FPS hiện tại, cập nhật từ config


def is_no_key_pressed():
    """Trả về True nếu phím bind của worker hiện tại đã được thả."""
    key = getattr(_thread_local, "bind_key", None)
    if key is None:
        return True
    return key not in pressed


# ── Named combo sequences ─────────────────────────────────────────────────────

def skk223_loop(fps):
    """Lặp vô hạn 2-2-3 cho đến khi nhả phím."""
    start = time.perf_counter()
    while time.perf_counter() - start < 20:
        skk2as(fps)
        skk2as(fps)
        skk3aw(fps)
        if is_no_key_pressed():
            break


def skkC0_EQA_120f(fps):
    """C0: 222q 223 223 22cd23 223  –  tối ưu cho ~120 fps."""
    skke(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2aq(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2azs_slow(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)


def skkC0_QEA_120f(fps):
    """C0: 222c 223 223 22cd23 223  –  biến thể QEA ~120 fps."""
    skke(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2az(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2azs_slow(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)


def skkC0_EQA_60f(fps):
    """C0: 222q 223 223 22c 224  –  tối ưu cho ~60 fps."""
    skke(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2aq(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk3aw(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2az(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk2as(fps)
    if is_no_key_pressed(): return
    skk5as(fps)


# ── Combo map & step map ──────────────────────────────────────────────────────

COMBO_MAP = {
    "C0:  Combo Skirk C0 EQA 120fps": skkC0_EQA_120f,
    "C0:  Combo Skirk C0 EA 120fps":  skkC0_QEA_120f,
    "C0:  Combo Skirk C0 EQA 60fps":  skkC0_EQA_60f,
}

# BUG FIX: thêm skk2a và skk5a (thiếu trong phiên bản cũ, custom combo cần)
STEP_MAP = {
    "skk3aw":       skk3aw,
    "skk2as":       skk2as,
    "skk2a":        skk2a,          # n2  – đã thêm
    "skk3as":       skk3as,
    "skk2az":       skk2az,
    "skk2azs":      skk2azs,
    "skk2azs_slow": skk2azs_slow,
    "skk2aq":       skk2aq,
    "skke":         skke,
    "skk5as":       skk5as,
    "skk5a":        skk5a,          # n5  – đã thêm
}


def build_custom_combo_fn(name, python_sequence):
    """Tạo hàm combo động từ danh sách pythonSequence."""
    steps = []
    for step_name in python_sequence:
        if step_name == "is_no_key_pressed":
            steps.append(("check", None))
        else:
            fn = STEP_MAP.get(step_name)
            if fn is not None:
                steps.append(("call", fn))
    steps = tuple(steps)  # freeze

    def custom_combo(fps):
        for kind, fn in steps:
            if kind == "check":
                if is_no_key_pressed():
                    return
            else:
                fn(fps)

    custom_combo.__name__ = name or f"custom_combo_{id(custom_combo)}"
    return custom_combo


# ── Key/button parsing ────────────────────────────────────────────────────────

def parse_input(name):
    """Chuyển chuỗi tên phím → pynput key/button object."""
    log_debug(f"parse_input: {name}")
    if name == "mouse_4":
        return Button.x2
    if name == "mouse_3":
        return Button.x1

    if hasattr(Button, name):
        return getattr(Button, name)
    if hasattr(Key, name):
        return getattr(Key, name)
    if len(name) == 1:
        return KeyCode.from_char(name.lower())

    raise ValueError(f"Unknown key: {name}")


# ── apply_all_bindings ────────────────────────────────────────────────────────

def apply_all_bindings(sign_keys_map, custom_combos=None):
    """Xây dựng active_bindings từ comboSignKeys và customCombos."""
    global active_bindings, running_states
    log_debug(f"apply_all_bindings called with: {sign_keys_map}")

    # Dừng tất cả worker đang chạy
    for key in list(running_states):
        running_states[key] = False

    active_bindings = {}
    running_states  = {}

    # 1. Built-in combos
    for combo_str, key_name in sign_keys_map.items():
        fn = COMBO_MAP.get(combo_str)
        if fn is None:
            log_debug(f"Combo not found in COMBO_MAP: {combo_str}")
            continue
        try:
            parsed = parse_input(key_name)
            active_bindings[parsed] = fn
            log_debug(f"Bound: {parsed} -> {fn.__name__}")
        except Exception as e:
            log_debug(f"Error binding {key_name}: {e}")

    # 2. Custom combos
    if custom_combos:
        for combo in custom_combos:
            hotkey = combo.get("hotkey")
            seq    = combo.get("pythonSequence", [])
            if not hotkey or not seq:
                continue
            try:
                parsed = parse_input(hotkey)
                fn     = build_custom_combo_fn(combo.get("name", "custom"), seq)
                active_bindings[parsed] = fn
                log_debug(f"Bound custom: {parsed} -> {fn.__name__}")
            except Exception as e:
                log_debug(f"Error binding custom combo {combo.get('name')}: {e}")


# ── Worker thread ─────────────────────────────────────────────────────────────

def worker(key):
    """Thread thực thi macro. Crash recovery: reset running_states khi có lỗi."""
    _thread_local.bind_key = key
    log_debug(f"Worker thread started for key: {key}")

    while running_states.get(key, False):
        fn = active_bindings.get(key)
        if fn is None:
            log_debug(f"Worker: no function bound to {key}")
            break
        try:
            log_debug(f"Worker: executing {fn.__name__}")
            fn(FPSinput)
            log_debug(f"Worker: finished {fn.__name__}")
        except Exception as e:
            import traceback
            log_debug(f"Worker Exception running {fn.__name__}: {e}")
            log_debug(traceback.format_exc())
            # BUG FIX: reset state để lần nhấn phím tiếp theo có thể khởi động lại
            running_states[key] = False
            break

    log_debug(f"Worker thread stopped for key: {key}")


# ── Keyboard / Mouse listeners ────────────────────────────────────────────────

def on_press(key):
    pressed.add(key)
    if not run_enabled:
        return
    for tgt in list(active_bindings):
        if tgt in pressed and not running_states.get(tgt, False):
            running_states[tgt] = True
            log_debug(f"Trigger worker for target key: {tgt}")
            threading.Thread(target=worker, args=(tgt,), daemon=True).start()


def on_release(key):
    pressed.discard(key)
    for tgt in list(active_bindings):
        if tgt not in pressed:
            running_states[tgt] = False


def on_click(x, y, button, is_pressed):
    if is_pressed:
        pressed.add(button)
        if not run_enabled:
            return
        for tgt in list(active_bindings):
            if tgt in pressed and not running_states.get(tgt, False):
                running_states[tgt] = True
                log_debug(f"Trigger worker for target button: {tgt}")
                threading.Thread(target=worker, args=(tgt,), daemon=True).start()
    else:
        pressed.discard(button)
        for tgt in list(active_bindings):
            if tgt not in pressed:
                running_states[tgt] = False

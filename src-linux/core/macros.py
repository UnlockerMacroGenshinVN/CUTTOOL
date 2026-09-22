"""
macros.py – Các hàm macro thao tác chuột/bàn phím theo FPS sử dụng evdev / uinput.

Cập nhật cho Linux:
  - Thay thế pynput bằng VirtualInput (Kernel-level UInput) tương thích mọi game trên Wayland và Wine/Proton.
  - Tự động điều chỉnh thời gian giữ phím/click tối thiểu (12ms - 15ms) để Wine/Proton và Game Engine luôn nhận diện đầy đủ.
  - Pre-compute inv_fps = 1/fps một lần, giảm phép chia lặp trong hot loop.
"""

import bisect
import time
from evdev import ecodes

from .fps_utils import (
    fps2t, wait_exact,
    T_FPS_3AW, T_FPS_2AS_FIRST, T_FPS_2AS_SECOND,
    T_FPS_2AZ_FIRST, T_FPS_2AZ_END, T_FPS_2AZS_END,
    T_FPS_2AQ_FIRST, T_FPS_2AQ_END,
    T_FPS_5A, T_FPS_5AS_END, T_FRAME_3AS,
)
from .evdev_io import VirtualInput

# ── Kernel Virtual Controller ─────────────────────────────────────────────────
v_input = VirtualInput.get_instance()

left  = ecodes.BTN_LEFT
right = ecodes.BTN_RIGHT

KEY_W = ecodes.KEY_W
KEY_Q = ecodes.KEY_Q
KEY_E = ecodes.KEY_E


def mouse_press(btn):
    v_input.press(btn)


def mouse_release(btn):
    v_input.release(btn)


def key_press(key):
    v_input.press(key)


def key_release(key):
    v_input.release(key)


# Thời gian giữ phím/nút tối thiểu để game engine luôn đọc được trạng thái
MIN_HOLD = 0.012


# ────────────────────────────────────────────────────────────────────────────
# Primitive macro functions
# ────────────────────────────────────────────────────────────────────────────

def skk3aw(fps):
    """n3w – Spam click trái rồi nhấn W đúng frame."""
    start   = time.perf_counter()
    t       = fps2t(T_FPS_3AW, fps)
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)

    for _ in range(int(0.6 * fps)):
        if time.perf_counter() - start > 0.6:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    wait_exact(t, start)
    key_press(KEY_W)
    wait_exact(max(inv_fps, 0.015))
    key_release(KEY_W)


def skk3as(fps):
    """n3d_quick – Spam click trái rồi click phải đúng frame."""
    fps_values   = T_FRAME_3AS[0]
    frame_values = T_FRAME_3AS[1]
    inv_fps      = 1.0 / fps
    hold_t       = max(inv_fps, MIN_HOLD)

    if fps >= fps_values[-1]:
        frame = frame_values[-1]
    elif fps <= fps_values[0]:
        frame = frame_values[0]
    else:
        i = bisect.bisect_right(fps_values, fps) - 1
        i = max(0, min(i, len(fps_values) - 2))
        w = (fps - fps_values[i]) / (fps_values[i + 1] - fps_values[i])
        frame = frame_values[i] + (frame_values[i + 1] - frame_values[i]) * w

    start = time.perf_counter()

    for _ in range(int(0.6 * fps)):
        if time.perf_counter() - start > 0.6:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    wait_exact(frame * inv_fps)
    mouse_press(right)
    wait_exact(max(inv_fps, 0.015))
    mouse_release(right)


def skk2as(fps):
    """n2d – Click trái spam → right+W."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)

    for _ in range(int(0.26 * fps)):
        if time.perf_counter() - start > 0.32:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    t = fps2t(T_FPS_2AS_FIRST, fps)
    wait_exact(t, start)

    mouse_press(right)
    wait_exact(max(inv_fps, 0.015))
    mouse_release(right)
    wait_exact(inv_fps)
    key_press(KEY_W)
    wait_exact(max(inv_fps, 0.015))
    key_release(KEY_W)

    t2 = fps2t(T_FPS_2AS_SECOND, fps)
    wait_exact(t2, start)


def skk2a(fps):
    """n2 – Click trái spam, kết thúc tại mốc đầu (không có right+W)."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)

    for _ in range(int(0.26 * fps)):
        if time.perf_counter() - start > 0.32:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    t = fps2t(T_FPS_2AS_FIRST, fps)
    wait_exact(t, start)


def skk2az(fps):
    """n2c – Click trái spam → hold left → kết thúc."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)
    t       = fps2t(T_FPS_2AZ_FIRST, fps)

    for _ in range(int(0.2 * fps)):
        if time.perf_counter() - start > t:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    wait_exact(t + 2 * inv_fps, start)
    mouse_press(left)
    wait_exact(0.44)
    mouse_release(left)

    t_end = fps2t(T_FPS_2AZ_END, fps)
    wait_exact(t_end, start)


def skk2azs(fps):
    """n2cd – Click trái spam → hold left → right+W → kết thúc."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)
    t       = fps2t(T_FPS_2AZ_FIRST, fps)

    for _ in range(int(0.2 * fps)):
        if time.perf_counter() - start > t:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    wait_exact(t + 2 * inv_fps, start)
    mouse_press(left)
    wait_exact(0.44)
    mouse_release(left)

    wait_exact(inv_fps)
    mouse_press(right)
    wait_exact(max(inv_fps, 0.015))
    mouse_release(right)
    wait_exact(inv_fps)
    key_press(KEY_W)
    wait_exact(max(inv_fps, 0.015))
    key_release(KEY_W)
    wait_exact(inv_fps)

    t_end = fps2t(T_FPS_2AZS_END, fps)
    wait_exact(t_end, start)


def skk2azs_slow(fps):
    """n2cd_slow – Phiên bản chậm hơn cho FPS >= 105."""
    if fps < 105:
        skk2azs(fps)
        return

    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)

    for _ in range(int(0.2 * fps)):
        if time.perf_counter() - start > 0.26:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    wait_exact(0.28, start)
    mouse_press(left)
    wait_exact(0.44)
    mouse_release(left)

    wait_exact(inv_fps)
    wait_exact(0.725, start)

    mouse_press(right)
    wait_exact(max(inv_fps, 0.015))
    mouse_release(right)
    wait_exact(inv_fps)
    key_press(KEY_W)
    wait_exact(max(inv_fps, 0.015))
    key_release(KEY_W)
    wait_exact(inv_fps)

    wait_exact(0.87, start)


def skk5as(fps):
    """n5d – Spam 2s → right sau frame target."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)

    for _ in range(int(2 * fps)):
        if time.perf_counter() - start > 2.1:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    t = fps2t(T_FPS_5A, fps)
    wait_exact(t + 2 * inv_fps, start)

    t_end = fps2t(T_FPS_5AS_END, fps)
    mouse_press(right)
    wait_exact(max(inv_fps, 0.015))
    mouse_release(right)
    wait_exact(inv_fps)
    wait_exact(t_end + 2 * inv_fps, start)


def skk5a(fps):
    """n5 – Spam 2s, không có right."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)

    for _ in range(int(2 * fps)):
        if time.perf_counter() - start > 2.1:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    t = fps2t(T_FPS_5A, fps)
    wait_exact(t + 2 * inv_fps, start)


def skk2aq(fps):
    """n2q – Click trái spam → Q → kết thúc."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    hold_t  = max(inv_fps, MIN_HOLD)

    for _ in range(int(0.26 * fps)):
        if time.perf_counter() - start > 0.32:
            break
        mouse_press(left)
        wait_exact(hold_t)
        mouse_release(left)
        wait_exact(inv_fps)

    t = fps2t(T_FPS_2AQ_FIRST, fps)
    wait_exact(t, start)

    key_press(KEY_Q)
    wait_exact(max(inv_fps, 0.015))
    key_release(KEY_Q)
    wait_exact(inv_fps)

    t_end = fps2t(T_FPS_2AQ_END, fps)
    wait_exact(t_end, start)


def skke(fps):
    """E – Nhấn E liên tục trong 0.1s, sau đó chờ."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps

    for _ in range(int(0.1 * fps)):
        if time.perf_counter() - start > 0.1:
            break
        key_press(KEY_E)
        wait_exact(max(inv_fps, 0.015))
        key_release(KEY_E)
        wait_exact(inv_fps)

    wait_exact(0.19)

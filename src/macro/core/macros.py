"""
macros.py – Các hàm macro thao tác chuột/bàn phím theo FPS.

BUG FIX (2026-08):
  - skk3as: xóa dòng `frame = frame_values[0]` hardcode làm vô hiệu nội suy.
  - Thêm skk2a, skk5a vào STEP_MAP (thiếu trong phiên bản cũ, custom combo dùng).
  - Pre-compute inv_fps = 1/fps một lần, giảm phép chia lặp trong hot loop.
"""

import bisect
import time
import pynput

from .fps_utils import (
    fps2t, wait_exact,
    T_FPS_3AW, T_FPS_2AS_FIRST, T_FPS_2AS_SECOND,
    T_FPS_2AZ_FIRST, T_FPS_2AZ_END, T_FPS_2AZS_END,
    T_FPS_2AQ_FIRST, T_FPS_2AQ_END,
    T_FPS_5A, T_FPS_5AS_END, T_FRAME_3AS,
)

# ── pynput controllers (singleton, tạo một lần) ──────────────────────────────
mouse    = pynput.mouse.Controller()
keyboard = pynput.keyboard.Controller()
left     = pynput.mouse.Button.left
right    = pynput.mouse.Button.right


# ────────────────────────────────────────────────────────────────────────────
# Primitive macro functions
# ────────────────────────────────────────────────────────────────────────────

def skk3aw(fps):
    """n3w – Spam click trái rồi nhấn W đúng frame."""
    start   = time.perf_counter()
    t       = fps2t(T_FPS_3AW, fps)
    inv_fps = 1.0 / fps

    for _ in range(int(0.6 * fps)):
        if time.perf_counter() - start > 0.6:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    wait_exact(t, start)
    keyboard.press("w")
    wait_exact(inv_fps)
    keyboard.release("w")


def skk3as(fps):
    """n3d_quick – Spam click trái rồi click phải đúng frame."""
    fps_values   = T_FRAME_3AS[0]
    frame_values = T_FRAME_3AS[1]
    inv_fps      = 1.0 / fps

    # BUG FIX: nội suy frame thực sự thay vì hardcode frame_values[0]
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
        mouse.press(left)
        wait_exact(inv_fps)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    wait_exact(frame * inv_fps)
    mouse.press(right)
    mouse.release(right)


def skk2as(fps):
    """n2d – Click trái spam → right+W."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps

    for _ in range(int(0.26 * fps)):
        if time.perf_counter() - start > 0.32:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    t = fps2t(T_FPS_2AS_FIRST, fps)
    wait_exact(t, start)

    mouse.press(right)
    wait_exact(inv_fps)
    mouse.release(right)
    wait_exact(inv_fps)
    keyboard.press('w')
    wait_exact(inv_fps)
    keyboard.release('w')

    t2 = fps2t(T_FPS_2AS_SECOND, fps)
    wait_exact(t2, start)


def skk2a(fps):
    """n2 – Click trái spam, kết thúc tại mốc đầu (không có right+W)."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps

    for _ in range(int(0.26 * fps)):
        if time.perf_counter() - start > 0.32:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    t = fps2t(T_FPS_2AS_FIRST, fps)
    wait_exact(t, start)


def skk2az(fps):
    """n2c – Click trái spam → hold left → kết thúc."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    t       = fps2t(T_FPS_2AZ_FIRST, fps)

    for _ in range(int(0.2 * fps)):
        if time.perf_counter() - start > t:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    wait_exact(t + 2 * inv_fps, start)
    mouse.press(left)
    wait_exact(0.44)
    mouse.release(left)

    t_end = fps2t(T_FPS_2AZ_END, fps)
    wait_exact(t_end, start)


def skk2azs(fps):
    """n2cd – Click trái spam → hold left → right+W → kết thúc."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps
    t       = fps2t(T_FPS_2AZ_FIRST, fps)

    for _ in range(int(0.2 * fps)):
        if time.perf_counter() - start > t:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    wait_exact(t + 2 * inv_fps, start)
    mouse.press(left)
    wait_exact(0.44)
    mouse.release(left)

    wait_exact(inv_fps)
    mouse.press(right)
    wait_exact(inv_fps)
    mouse.release(right)
    wait_exact(inv_fps)
    keyboard.press('w')
    wait_exact(inv_fps)
    keyboard.release('w')
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

    for _ in range(int(0.2 * fps)):
        if time.perf_counter() - start > 0.26:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    wait_exact(0.28, start)
    mouse.press(left)
    wait_exact(0.44)
    mouse.release(left)

    wait_exact(inv_fps)
    wait_exact(0.725, start)

    mouse.press(right)
    wait_exact(inv_fps)
    mouse.release(right)
    wait_exact(inv_fps)
    keyboard.press('w')
    wait_exact(inv_fps)
    keyboard.release('w')
    wait_exact(inv_fps)

    wait_exact(0.87, start)


def skk5as(fps):
    """n5d – Spam 2s → right sau frame target."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps

    for _ in range(int(2 * fps)):
        if time.perf_counter() - start > 2.1:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    t = fps2t(T_FPS_5A, fps)
    wait_exact(t + 2 * inv_fps, start)

    t_end = fps2t(T_FPS_5AS_END, fps)
    mouse.press(right)
    wait_exact(inv_fps)
    mouse.release(right)
    wait_exact(inv_fps)
    wait_exact(t_end + 2 * inv_fps, start)


def skk5a(fps):
    """n5 – Spam 2s, không có right."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps

    for _ in range(int(2 * fps)):
        if time.perf_counter() - start > 2.1:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    t = fps2t(T_FPS_5A, fps)
    wait_exact(t + 2 * inv_fps, start)


def skk2aq(fps):
    """n2q – Click trái spam → Q → kết thúc."""
    start   = time.perf_counter()
    inv_fps = 1.0 / fps

    for _ in range(int(0.26 * fps)):
        if time.perf_counter() - start > 0.32:
            break
        mouse.press(left)
        mouse.release(left)
        wait_exact(2 * inv_fps)

    t = fps2t(T_FPS_2AQ_FIRST, fps)
    wait_exact(t, start)

    keyboard.press("q")
    wait_exact(inv_fps)
    keyboard.release("q")
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
        keyboard.press('e')
        wait_exact(inv_fps)
        keyboard.release('e')
        wait_exact(inv_fps)

    wait_exact(0.19)

"""
fps_utils.py – FPS calibration tables + timing helpers.

BUG FIX (2026-08): hàm fps2t bị cấu trúc sai trong monolith cũ.
Code nội suy FPS nằm lạc bên trong wait_exact thay vì fps2t,
dẫn đến NameError mỗi khi FPS ở khoảng trung gian.
Phiên bản này đã sửa hoàn toàn và dùng bisect (O(log n)) thay vì vòng for tuyến tính.
"""

import bisect
import time

# ── Calibration tables (immutable tuples, allocated ONCE at module load) ────────
# Format: ((fps_breakpoints...), (delay_values...))
# Giá trị giữa các điểm sẽ được nội suy tuyến tính bởi fps2t().

T_FPS_3AW        = ((30,  60,  100,  120,  220),
                    (1.5, 1.366, 1.34, 1.32, 1.285))

T_FPS_2AS_FIRST  = ((60,   120,  220),
                    (0.44,  0.40, 0.37))

T_FPS_2AS_SECOND = ((60,   120,  220),
                    (0.63,  0.57, 0.56))

T_FPS_2AZ_FIRST  = ((60,   120,  220),
                    (0.24,  0.22, 0.20))

T_FPS_2AZ_END    = ((60,   120,  220),
                    (1.16,  1.12, 1.09))

T_FPS_2AZS_END   = ((60,   120,  220),
                    (0.90,  0.86, 0.82))

T_FPS_2AQ_FIRST  = ((60,   120,  220),
                    (0.44,  0.39, 0.37))

T_FPS_2AQ_END    = ((60,   120,  220),
                    (1.17,  1.09, 1.07))

T_FPS_5A         = ((60,   120,  220),
                    (2.22,  2.14, 2.12))

T_FPS_5AS_END    = ((60,   120,  220),
                    (2.41,  2.28, 2.24))

T_FRAME_3AS      = ((60,  120,  144,  240),
                    (18,   20,   22,   24))


def fps2t(T_FPS, fps):
    """
    Nội suy tuyến tính: tra bảng FPS → delay tương ứng.

    Parameters
    ----------
    T_FPS : tuple[tuple, tuple]
        ((fps1, fps2, ...), (t1, t2, ...))  – các giá trị tăng dần
    fps : float

    Returns
    -------
    float – delay (giây)
    """
    fps_values = T_FPS[0]
    t_values   = T_FPS[1]

    # Kẹp hai đầu
    if fps >= fps_values[-1]:
        return t_values[-1]
    if fps <= fps_values[0]:
        return t_values[0]

    # Binary search O(log n) để tìm bracket [fps_values[i], fps_values[i+1])
    i = bisect.bisect_right(fps_values, fps) - 1
    i = max(0, min(i, len(fps_values) - 2))

    weight = (fps - fps_values[i]) / (fps_values[i + 1] - fps_values[i])
    return t_values[i] + (t_values[i + 1] - t_values[i]) * weight


def wait_exact(duration, start_time=None):
    """
    Chờ chính xác theo perf_counter.
    Yield CPU khi còn > 2 ms (time.sleep 1 ms) để pynput không bị starved.

    Parameters
    ----------
    duration   : float – thời gian chờ (giây)
    start_time : float | None – nếu None, tự lấy perf_counter() hiện tại
    """
    if start_time is None:
        start_time = time.perf_counter()
    while True:
        remaining = duration - (time.perf_counter() - start_time)
        if remaining <= 0:
            break
        if remaining > 0.002:
            time.sleep(0.001)

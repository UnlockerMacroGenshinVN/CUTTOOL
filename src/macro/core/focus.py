"""
focus.py – Focus guard: macro chỉ có tác dụng khi Genshin Impact
           đang là cửa sổ foreground (cửa sổ đang được Windows active).

Mục đích: tab sang app khác (kể cả UI của chính tool này) thì macro
im lặng hoàn toàn, không bắn chuột/phím vào nhầm chỗ.

Cách Windows quản lý: mỗi thời điểm chỉ có đúng một cửa sổ "foreground"
(GetForegroundWindow). Từ HWND đó lấy PID, rồi lấy tên file exe của PID.
"""

import ctypes
import os
import sys
import time
from ctypes import wintypes

# Tên tiến trình game: bản quốc tế + bản Trung
GAME_EXES = frozenset({"genshinimpact.exe", "yuanshen.exe"})

_IS_WIN = sys.platform == "win32"

# Cache ngắn: foreground được hỏi rất nhiều lần trong hot loop,
# 50ms là đủ nhanh để phản ứng khi alt-tab mà không tốn syscall.
_CACHE_TTL = 0.05
_cache_t = 0.0
_cache_v = ""

if _IS_WIN:
    _user32 = ctypes.windll.user32
    _kernel32 = ctypes.windll.kernel32

    _user32.GetForegroundWindow.restype = wintypes.HWND
    _user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND,
                                                 ctypes.POINTER(wintypes.DWORD)]
    _kernel32.OpenProcess.restype = wintypes.HANDLE
    _kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE, wintypes.DWORD,
        wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)
    ]

    _PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def _query_foreground_exe():
    """Tên file exe (lowercase) của cửa sổ foreground. '' nếu không xác định."""
    hwnd = _user32.GetForegroundWindow()
    if not hwnd:
        return ""

    pid = wintypes.DWORD()
    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        return ""

    handle = _kernel32.OpenProcess(
        _PROCESS_QUERY_LIMITED_INFORMATION, False, pid.value
    )
    if not handle:
        # Tiến trình quyền cao hơn / đã thoát -> coi như không phải game
        return ""
    try:
        buf = ctypes.create_unicode_buffer(32768)
        size = wintypes.DWORD(len(buf))
        if not _kernel32.QueryFullProcessImageNameW(handle, 0, buf,
                                                    ctypes.byref(size)):
            return ""
        return os.path.basename(buf.value).lower()
    finally:
        _kernel32.CloseHandle(handle)


def foreground_exe():
    """Như _query_foreground_exe nhưng có cache 50ms."""
    global _cache_t, _cache_v
    if not _IS_WIN:
        return ""
    now = time.perf_counter()
    if now - _cache_t < _CACHE_TTL:
        return _cache_v
    try:
        _cache_v = _query_foreground_exe()
    except Exception:
        _cache_v = ""
    _cache_t = now
    return _cache_v


def is_game_foreground():
    """True nếu Genshin đang là cửa sổ active.

    Ngoài Windows thì luôn True (không chặn) vì không có API tương đương.
    """
    if not _IS_WIN:
        return True
    return foreground_exe() in GAME_EXES

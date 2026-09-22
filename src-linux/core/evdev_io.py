"""
evdev_io.py – Kernel-level input capture and simulation for Linux.
Sử dụng evdev đọc trực tiếp từ /dev/input/event* và uinput để tạo Virtual Input Devices.
Tách biệt bàn phím ảo (Virtual Keyboard) và chuột ảo (Virtual Mouse) để đảm bảo
libinput, Wayland Compositor và Proton/Wine nhận diện đầy đủ cả phím và chuột.
"""

import os
import glob
import time
import select
import threading
from typing import Callable, Optional, Dict, Set

import evdev
from evdev import ecodes, UInput, InputDevice

from .config_io import log_debug

# ── Key / Button Mapping ──────────────────────────────────────────────────────

NAME_TO_CODE = {
    # Mouse buttons
    "mouse_1": ecodes.BTN_LEFT,
    "mouse1": ecodes.BTN_LEFT,
    "left": ecodes.BTN_LEFT,
    "mouse_2": ecodes.BTN_RIGHT,
    "mouse2": ecodes.BTN_RIGHT,
    "right": ecodes.BTN_RIGHT,
    "mouse_3": ecodes.BTN_MIDDLE,
    "mouse3": ecodes.BTN_MIDDLE,
    "middle": ecodes.BTN_MIDDLE,
    
    # Side buttons (nút hông chuột)
    "mouse_4": ecodes.BTN_SIDE,
    "mouse4": ecodes.BTN_SIDE,
    "side": ecodes.BTN_SIDE,
    "mouse_back": ecodes.BTN_SIDE,
    
    "mouse_5": ecodes.BTN_EXTRA,
    "mouse5": ecodes.BTN_EXTRA,
    "extra": ecodes.BTN_EXTRA,
    "mouse_forward": ecodes.BTN_EXTRA,
    
    # Common keyboard special keys
    "space": ecodes.KEY_SPACE,
    "tab": ecodes.KEY_TAB,
    "enter": ecodes.KEY_ENTER,
    "return": ecodes.KEY_ENTER,
    "esc": ecodes.KEY_ESC,
    "escape": ecodes.KEY_ESC,
    "backspace": ecodes.KEY_BACKSPACE,
    "shift": ecodes.KEY_LEFTSHIFT,
    "shift_l": ecodes.KEY_LEFTSHIFT,
    "shift_r": ecodes.KEY_RIGHTSHIFT,
    "ctrl": ecodes.KEY_LEFTCTRL,
    "ctrl_l": ecodes.KEY_LEFTCTRL,
    "ctrl_r": ecodes.KEY_RIGHTCTRL,
    "alt": ecodes.KEY_LEFTALT,
    "alt_l": ecodes.KEY_LEFTALT,
    "alt_r": ecodes.KEY_RIGHTALT,
    "capslock": ecodes.KEY_CAPSLOCK,
    "caps": ecodes.KEY_CAPSLOCK,
}

# Reverse mapping for display
CODE_TO_NAME = {
    ecodes.BTN_LEFT: "mouse_1 (left)",
    ecodes.BTN_RIGHT: "mouse_2 (right)",
    ecodes.BTN_MIDDLE: "mouse_3 (middle)",
    ecodes.BTN_SIDE: "mouse_4 (side)",
    ecodes.BTN_EXTRA: "mouse_5 (extra)",
}
if hasattr(ecodes, "BTN_BACK"):
    CODE_TO_NAME[ecodes.BTN_BACK] = "mouse_back"
if hasattr(ecodes, "BTN_FORWARD"):
    CODE_TO_NAME[ecodes.BTN_FORWARD] = "mouse_forward"


def parse_key_str(name: str) -> int:
    """Chuyển chuỗi tên phím/chuột thành mã ecodes int."""
    cleaned = str(name).strip().lower()
    if cleaned in NAME_TO_CODE:
        return NAME_TO_CODE[cleaned]

    # Ký tự chữ cái (a-z) hoặc số (0-9)
    if len(cleaned) == 1:
        if cleaned.isalnum():
            key_name = f"KEY_{cleaned.upper()}"
            if hasattr(ecodes, key_name):
                return getattr(ecodes, key_name)

    # Phím chức năng F1 - F24
    if cleaned.startswith("f") and cleaned[1:].isdigit():
        key_name = f"KEY_{cleaned.upper()}"
        if hasattr(ecodes, key_name):
            return getattr(ecodes, key_name)

    # Thử tìm trực tiếp theo tên ecodes
    upper = cleaned.upper()
    if hasattr(ecodes, upper):
        return getattr(ecodes, upper)
    if hasattr(ecodes, f"KEY_{upper}"):
        return getattr(ecodes, f"KEY_{upper}")
    if hasattr(ecodes, f"BTN_{upper}"):
        return getattr(ecodes, f"BTN_{upper}")

    raise ValueError(f"Không nhận diện được phím: '{name}'")


def format_key_code(code: int) -> str:
    """Chuyển mã ecodes int thành chuỗi hiển thị thân thiện."""
    if code in CODE_TO_NAME:
        return CODE_TO_NAME[code]
    name = ecodes.KEY.get(code) or ecodes.BTN.get(code)
    if name:
        if isinstance(name, (list, tuple)):
            name = name[0]
        name = str(name)
        if name.startswith("KEY_"):
            return name[4:].lower()
        if name.startswith("BTN_"):
            return name[4:].lower()
        return name.lower()
    return f"key_{code}"


# ── Virtual Output Devices (uinput) ───────────────────────────────────────────

MOUSE_DEVICE_NAME = "CUTTOOL-Virtual-Mouse"
KBD_DEVICE_NAME   = "CUTTOOL-Virtual-Keyboard"


class VirtualInput:
    """
    Quản lý 2 thiết bị ảo riêng biệt (Chuột & Bàn phím).
    Việc tách biệt đảm bảo libinput và Wayland compositor nhận dạng đúng pointer và keyboard.
    """
    _instance: Optional["VirtualInput"] = None

    def __init__(self):
        self._mouse_dev: Optional[UInput] = None
        self._kbd_dev: Optional[UInput] = None
        self._lock = threading.Lock()

    @classmethod
    def get_instance(cls) -> "VirtualInput":
        if cls._instance is None:
            cls._instance = VirtualInput()
        return cls._instance

    def initialize(self):
        with self._lock:
            if self._mouse_dev is not None and self._kbd_dev is not None:
                return

            # 1. Khởi tạo Chuột ảo (Mouse)
            mouse_buttons = [
                ecodes.BTN_LEFT, ecodes.BTN_RIGHT, ecodes.BTN_MIDDLE,
                ecodes.BTN_SIDE, ecodes.BTN_EXTRA,
            ]
            if hasattr(ecodes, "BTN_BACK"):
                mouse_buttons.append(ecodes.BTN_BACK)
            if hasattr(ecodes, "BTN_FORWARD"):
                mouse_buttons.append(ecodes.BTN_FORWARD)

            mouse_cap = {
                ecodes.EV_KEY: mouse_buttons,
                ecodes.EV_REL: [ecodes.REL_X, ecodes.REL_Y, ecodes.REL_WHEEL],
            }
            try:
                self._mouse_dev = UInput(mouse_cap, name=MOUSE_DEVICE_NAME)
                log_debug(f"Virtual Mouse created: {MOUSE_DEVICE_NAME}")
            except Exception as e:
                log_debug(f"Failed to create Virtual Mouse: {e}")
                raise

            # 2. Khởi tạo Bàn phím ảo (Keyboard)
            # Lọc các phím từ 1 đến 255 và các phím multimedia (tránh dải BTN_ chuột)
            kbd_keys = [
                k for k in ecodes.keys.keys()
                if 0 < k < 767 and not (0x110 <= k <= 0x117)
            ]
            kbd_cap = {
                ecodes.EV_KEY: kbd_keys,
            }
            try:
                self._kbd_dev = UInput(kbd_cap, name=KBD_DEVICE_NAME)
                log_debug(f"Virtual Keyboard created: {KBD_DEVICE_NAME}")
            except Exception as e:
                log_debug(f"Failed to create Virtual Keyboard: {e}")
                raise

    def press(self, code: int):
        if self._mouse_dev is None or self._kbd_dev is None:
            self.initialize()

        # Phân loại chuột vs bàn phím
        # Mã chuột: 0x110 (BTN_MOUSE = 272) tới 0x117 (BTN_TASK = 279)
        if 0x110 <= code <= 0x11f:
            self._mouse_dev.write(ecodes.EV_KEY, code, 1)
            self._mouse_dev.syn()
        else:
            self._kbd_dev.write(ecodes.EV_KEY, code, 1)
            self._kbd_dev.syn()

    def release(self, code: int):
        if self._mouse_dev is None or self._kbd_dev is None:
            self.initialize()

        if 0x110 <= code <= 0x11f:
            self._mouse_dev.write(ecodes.EV_KEY, code, 0)
            self._mouse_dev.syn()
        else:
            self._kbd_dev.write(ecodes.EV_KEY, code, 0)
            self._kbd_dev.syn()

    def close(self):
        with self._lock:
            if self._mouse_dev is not None:
                try:
                    self._mouse_dev.close()
                except Exception:
                    pass
                self._mouse_dev = None
            if self._kbd_dev is not None:
                try:
                    self._kbd_dev.close()
                except Exception:
                    pass
                self._kbd_dev = None


# ── Evdev Input Listener ──────────────────────────────────────────────────────

class EvdevListener:
    """
    Lắng nghe sự kiện phím và chuột vật lý từ tất cả các file /dev/input/event*.
    Chạy trong background thread bằng select() để tối ưu CPU.
    """

    def __init__(self, on_press: Callable[[int], None], on_release: Callable[[int], None]):
        self.on_press = on_press
        self.on_release = on_release
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._devices: Dict[int, InputDevice] = {} # fd -> InputDevice

    def _open_devices(self) -> Dict[int, InputDevice]:
        """Mở tất cả thiết bị có phím bấm, loại trừ virtual devices của chính CUTTOOL."""
        opened = {}
        for path in evdev.list_devices():
            try:
                dev = InputDevice(path)
                if "CUTTOOL" in dev.name:
                    dev.close()
                    continue
                caps = dev.capabilities()
                if ecodes.EV_KEY in caps:
                    opened[dev.fd] = dev
                    log_debug(f"EvdevListener: listening to {dev.name} ({path})")
                else:
                    dev.close()
            except Exception as e:
                log_debug(f"EvdevListener: cannot open {path}: {e}")
        return opened

    def _listen_loop(self):
        self._devices = self._open_devices()
        log_debug(f"EvdevListener: total {len(self._devices)} devices attached")

        last_scan_time = time.perf_counter()

        while self._running:
            # Định kỳ kiểm tra thiết bị mới cắm vào mỗi 5 giây
            now = time.perf_counter()
            if now - last_scan_time > 5.0:
                last_scan_time = now
                current_paths = {d.path for d in self._devices.values()}
                for path in evdev.list_devices():
                    if path not in current_paths:
                        try:
                            dev = InputDevice(path)
                            if "CUTTOOL" in dev.name:
                                dev.close()
                                continue
                            if ecodes.EV_KEY in dev.capabilities():
                                self._devices[dev.fd] = dev
                                log_debug(f"EvdevListener: attached hotplug device {dev.name}")
                            else:
                                dev.close()
                        except Exception:
                            pass

            if not self._devices:
                time.sleep(0.3)
                self._devices = self._open_devices()
                continue

            try:
                r, _, _ = select.select(list(self._devices.keys()), [], [], 0.3)
            except (ValueError, OSError):
                self._clean_dead_devices()
                continue

            for fd in r:
                dev = self._devices.get(fd)
                if not dev:
                    continue
                try:
                    for event in dev.read():
                        if event.type == ecodes.EV_KEY:
                            try:
                                if event.value == 1:
                                    self.on_press(event.code)
                                elif event.value == 0:
                                    self.on_release(event.code)
                            except Exception as cb_err:
                                log_debug(f"EvdevListener callback error: {cb_err}")
                except BlockingIOError:
                    # Đã đọc hết buffer non-blocking: hoàn toàn bình thường, tiếp tục lắng nghe!
                    pass
                except (OSError, IOError) as e:
                    # Chỉ đóng thiết bị nếu thật sự ngắt kết nối (ENODEV=19, EBADF=9)
                    errno_code = getattr(e, "errno", None)
                    if errno_code in (19, 9):
                        log_debug(f"EvdevListener: device unplugged: {dev.name}")
                        try:
                            dev.close()
                        except Exception:
                            pass
                        self._devices.pop(fd, None)

    def _clean_dead_devices(self):
        """Dọn dẹp các fd không còn hợp lệ."""
        to_remove = []
        for fd, dev in self._devices.items():
            try:
                os.fstat(fd)
            except OSError:
                to_remove.append(fd)
        for fd in to_remove:
            dev = self._devices.pop(fd, None)
            if dev:
                try:
                    dev.close()
                except Exception:
                    pass

    def start(self):
        if self._running:
            return
        self._running = True
        self._thread = threading.Thread(target=self._listen_loop, daemon=True, name="EvdevListenerThread")
        self._thread.start()
        log_debug("EvdevListener started")

    def stop(self):
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=1.0)
            self._thread = None
        for dev in list(self._devices.values()):
            try:
                dev.close()
            except Exception:
                pass
        self._devices.clear()
        log_debug("EvdevListener stopped")

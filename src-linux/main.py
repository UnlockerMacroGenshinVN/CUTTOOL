#!/usr/bin/env python3
"""
main.py – CUTTOOL Linux CLI Edition.

Giao diện dòng lệnh trực quan cho Linux.
Không dùng GUI, không dùng HTTP server.
Chạy trực tiếp bằng Python 3, cần quyền root hoặc nhóm 'input'.
"""

import os
import sys
import glob
import threading
import signal

# ── Setup path ────────────────────────────────────────────────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from core.config_io import load_config, save_config, log_debug
import core.runtime as rt

from core.evdev_io import EvdevListener, VirtualInput

# ── Global ────────────────────────────────────────────────────────────────────
_evdev_listener = None


# ══════════════════════════════════════════════════════════════════════════════
#  ANSI Color Helpers
# ══════════════════════════════════════════════════════════════════════════════

def _c(text, code):
    return f"\033[{code}m{text}\033[0m"

def bold(t):     return _c(t, "1")
def dim(t):      return _c(t, "2")
def red(t):      return _c(t, "91")
def green(t):    return _c(t, "92")
def yellow(t):   return _c(t, "93")
def blue(t):     return _c(t, "94")
def cyan(t):     return _c(t, "96")
def magenta(t):  return _c(t, "95")
def bg_green(t): return _c(t, "42;97")
def bg_red(t):   return _c(t, "41;97")


# ══════════════════════════════════════════════════════════════════════════════
#  Permission Check
# ══════════════════════════════════════════════════════════════════════════════

def check_permissions():
    """Kiểm tra quyền truy cập /dev/input/event* và /dev/uinput."""
    if os.geteuid() == 0:
        return  # root → OK

    can_read_event = any(os.access(p, os.R_OK) for p in glob.glob("/dev/input/event*"))
    can_write_uinput = os.access("/dev/uinput", os.W_OK)

    if can_read_event and can_write_uinput:
        return

    print()
    print(red("  ❌ Lỗi: Bạn chưa chạy CUTTOOL với quyền root!"))
    print(yellow("     Linux yêu cầu quyền root để lắng nghe bàn phím và chuột (/dev/input/event*)."))
    print()
    print(bold("     👉 Vui lòng khởi chạy lại bằng lệnh:"))
    print(green("        sudo ./run.sh   (hoặc: sudo .venv/bin/python main.py)"))
    print()
    input(dim("  Nhấn Enter để thoát..."))
    sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
#  Listeners
# ══════════════════════════════════════════════════════════════════════════════

def start_listeners():
    global _evdev_listener
    try:
        VirtualInput.get_instance().initialize()
    except Exception as e:
        print(red(f"\n  ❌ Không thể khởi tạo thiết bị ảo Virtual UInput: {e}"))
        print(dim("     Vui lòng chạy lại bằng: ./run.sh (hoặc sudo python3 main.py)\n"))
        sys.exit(1)

    try:
        _evdev_listener = EvdevListener(on_press=rt.on_press, on_release=rt.on_release)
        _evdev_listener.start()
        log_debug("Evdev listeners started")
    except Exception as e:
        print(red(f"\n  ❌ Không thể lắng nghe /dev/input: {e}"))
        print(dim("     Vui lòng chạy lại bằng: ./run.sh (hoặc sudo python3 main.py)\n"))
        sys.exit(1)


def stop_listeners():
    global _evdev_listener
    if _evdev_listener:
        _evdev_listener.stop()
        _evdev_listener = None
    VirtualInput.get_instance().close()
    log_debug("Evdev listeners stopped")


# ══════════════════════════════════════════════════════════════════════════════
#  Combo List Helpers
# ══════════════════════════════════════════════════════════════════════════════

def get_combo_list(cfg):
    """
    Trả về danh sách hợp nhất:
    [(name, hotkey, is_builtin, sequence), ...]
    """
    combos = []
    for combo_name, hotkey in cfg.get("comboSignKeys", {}).items():
        seq = rt.BUILTIN_SEQUENCES.get(combo_name, [])
        combos.append((combo_name, hotkey, True, seq))
    for cc in cfg.get("customCombos", []):
        combos.append((
            cc.get("name", "?"),
            cc.get("hotkey", "?"),
            False,
            cc.get("pythonSequence", []),
        ))
    return combos


# ══════════════════════════════════════════════════════════════════════════════
#  Display Functions
# ══════════════════════════════════════════════════════════════════════════════

def clear():
    os.system("clear")


def print_header():
    print()
    print(bold(cyan("  ╔══════════════════════════════════════════════════════════╗")))
    print(bold(cyan("  ║           CUTTOOL  –  Linux CLI Edition                  ║")))
    print(bold(cyan("  ╚══════════════════════════════════════════════════════════╝")))
    print()


def print_status():
    if rt.run_enabled:
        status = bg_green(" ▶ ĐANG CHẠY ")
    else:
        status = bg_red(" ⏹ DỪNG ")
    bindings_count = len(rt.active_bindings)
    devs_count = len(_evdev_listener._devices) if _evdev_listener else 0
    devs_str = green(f"{devs_count} thiết bị") if devs_count > 0 else red("0 thiết bị (Chưa có quyền root!)")
    last_key = getattr(rt, "last_detected_key", "Chưa có")

    print(f"  Trạng thái: {status}   FPS: {bold(str(rt.FPSinput))}   Bindings: {bindings_count}   Lắng nghe: {devs_str}")
    print(f"  Phím vừa nhận: {cyan(last_key)}")
    if rt.run_enabled:
        print(dim("  💡 Lưu ý: Đè giữ phím/chuột trong khi combo chạy (nhả phím để dừng combo)."))
    else:
        print(yellow("  ⚠  Nhấn [r] để BẬT macro trước khi vào game!"))
    print()


def print_combo_table(combos):
    """Hiển thị danh sách combo dạng bảng."""
    w_num  = 4
    w_name = 42
    w_key  = 12
    w_type = 8
    total  = w_num + w_name + w_key + w_type + 7  # separators

    header = (f"  │{bold('#'):>{w_num+9}} "
              f"│ {bold('Tên Combo'):<{w_name+9}} "
              f"│ {bold('Phím'):<{w_key+9}} "
              f"│ {bold('Loại'):<{w_type+9}} │")
    sep    = f"  ├{'─' * (w_num+1)}┼{'─' * (w_name+2)}┼{'─' * (w_key+2)}┼{'─' * (w_type+1)}┤"
    top    = f"  ┌{'─' * (w_num+1)}┬{'─' * (w_name+2)}┬{'─' * (w_key+2)}┬{'─' * (w_type+1)}┐"
    bottom = f"  └{'─' * (w_num+1)}┴{'─' * (w_name+2)}┴{'─' * (w_key+2)}┴{'─' * (w_type+1)}┘"

    print(dim("  Danh sách Combo:"))
    print(top)
    print(header)
    print(sep)

    if not combos:
        empty = dim("(chưa có combo nào)")
        print(f"  │ {empty:^{total - 4}} │")
    else:
        for i, (name, hotkey, is_builtin, _seq) in enumerate(combos, 1):
            tag = cyan("built-in") if is_builtin else yellow("custom")
            # Truncate name if too long
            display_name = name[:w_name] if len(name) > w_name else name
            print(f"  │ {yellow(str(i)):>{w_num+9}} "
                  f"│ {display_name:<{w_name}} "
                  f"│ {green(hotkey):<{w_key+9}} "
                  f"│ {tag:>{w_type+9}} │")

    print(bottom)
    print()


def print_actions():
    print(dim("  ─── Lệnh ────────────────────────────────────────────────"))
    print(f"   {bold('[a]')} Thêm combo         {bold('[s]')} Sửa combo (nhập số)")
    print(f"   {bold('[d]')} Xóa combo          {bold('[f]')} Đổi FPS")
    print(f"   {bold('[r]')} RUN / STOP         {bold('[t]')} Test phím/chuột")
    print(f"   {bold('[q]')} Thoát")
    print(dim("  ─────────────────────────────────────────────────────────"))
    print()


def action_test_keys():
    """Chế độ test phím/chuột tương tác trực tiếp."""
    clear()
    print_header()
    print(bold("  ═══ Kiểm tra Nhận diện Phím & Chuột (Test Mode) ═══"))
    print(dim("  Bấm các phím bàn phím hoặc nút chuột (kể cả nút hông mouse_4/mouse_5)."))
    print(dim("  Nhấn Enter để quay lại menu chính."))
    print()

    # Dùng threading để đọc input() thoát mà không bị kẹt
    stop_flag = [False]

    def _wait_enter():
        try:
            input()
        except Exception:
            pass
        stop_flag[0] = True

    t = threading.Thread(target=_wait_enter, daemon=True)
    t.start()

    last = None
    import time
    while not stop_flag[0]:
        cur = getattr(rt, "last_detected_key", None)
        if cur and cur != last and cur != "Chưa có phím nào":
            last = cur
            print(f"    ✓ Nhận diện: {green(bold(cur))}")
        time.sleep(0.04)


def print_sequence_vertical(sequence, title="Chuỗi combo"):
    """Hiển thị chuỗi combo thành cột dọc."""
    print(f"  {bold(title)}:")
    if not sequence:
        print(dim("    (trống)"))
        return

    w = max(len(s) for s in sequence)
    top    = f"    ┌{'─' * 6}┬{'─' * (w + 2)}┐"
    header = f"    │ {bold('#'):>10} │ {bold('Step'):<{w + 9}} │"
    sep    = f"    ├{'─' * 6}┼{'─' * (w + 2)}┤"
    bottom = f"    └{'─' * 6}┴{'─' * (w + 2)}┘"

    print(top)
    print(header)
    print(sep)
    for i, step in enumerate(sequence, 1):
        if step == "is_no_key_pressed":
            display = dim(step)
            print(f"    │ {dim(str(i)):>{10}} │ {display:<{w + 9}} │")
        else:
            display = green(step)
            print(f"    │ {yellow(str(i)):>{10}} │ {display:<{w + 9}} │")
    print(bottom)
    print()


def print_available_steps():
    """Hiển thị danh sách steps có sẵn cho custom combo."""
    print(dim("    Steps có sẵn:"))
    steps = list(rt.STEP_MAP.keys()) + ["is_no_key_pressed"]
    for i, s in enumerate(steps, 1):
        if s == "is_no_key_pressed":
            print(f"      {yellow(str(i)):>10}. {dim(s)}")
        else:
            print(f"      {yellow(str(i)):>10}. {green(s)}")
    print()
    return steps


# ══════════════════════════════════════════════════════════════════════════════
#  Action Handlers
# ══════════════════════════════════════════════════════════════════════════════

def _reload_bindings(cfg):
    """Reload bindings từ config."""
    rt.FPSinput = int(cfg.get("FPS", 120))
    rt.apply_all_bindings(
        cfg.get("comboSignKeys", {}),
        cfg.get("customCombos", []),
    )


def action_toggle_run():
    """Bật/tắt macro."""
    rt.run_enabled = not rt.run_enabled
    if not rt.run_enabled:
        for key in list(rt.running_states):
            rt.running_states[key] = False
    state = green("BẬT") if rt.run_enabled else red("TẮT")
    print(f"\n  Macro đã {state}!")
    input(dim("  Nhấn Enter..."))


def action_change_fps(cfg):
    """Đổi FPS."""
    clear()
    print_header()
    print(f"  FPS hiện tại: {bold(str(rt.FPSinput))}")
    print(dim("  Gợi ý: 30, 60, 120, 144, 240"))
    print()
    val = input(f"  Nhập FPS mới (Enter = giữ nguyên): ").strip()
    if not val:
        return
    try:
        fps = int(val)
        if fps < 20 or fps > 500:
            print(red("  FPS phải từ 20 đến 500!"))
            input(dim("  Nhấn Enter..."))
            return
        cfg["FPS"] = fps
        rt.FPSinput = fps
        save_config(cfg)
        print(green(f"  ✓ Đã đổi FPS thành {fps}"))
    except ValueError:
        print(red("  Giá trị không hợp lệ!"))
    input(dim("  Nhấn Enter..."))


def action_add_combo(cfg):
    """Thêm combo mới."""
    clear()
    print_header()
    print(bold("  ═══ Thêm Combo ═══"))
    print()
    print(f"  {bold('[1]')} Thêm combo built-in (có sẵn)")
    print(f"  {bold('[2]')} Tạo combo custom (tùy chỉnh)")
    print(f"  {bold('[b]')} Quay lại")
    print()
    choice = input("  > ").strip().lower()

    if choice == "1":
        _add_builtin(cfg)
    elif choice == "2":
        _add_custom(cfg)


def _add_builtin(cfg):
    """Thêm một combo built-in."""
    clear()
    print_header()
    print(bold("  ═══ Chọn Combo Built-in ═══"))
    print()

    existing = set(cfg.get("comboSignKeys", {}).keys())
    available = [(k, v) for k, v in rt.COMBO_MAP.items() if k not in existing]

    if not available:
        print(yellow("  Tất cả combo built-in đã được thêm!"))
        input(dim("  Nhấn Enter..."))
        return

    for i, (name, _fn) in enumerate(available, 1):
        print(f"    {yellow(str(i)):>10}. {name}")
    print()

    idx = input("  Chọn số (Enter = hủy): ").strip()
    if not idx:
        return
    try:
        idx = int(idx) - 1
        if idx < 0 or idx >= len(available):
            raise ValueError
    except ValueError:
        print(red("  Số không hợp lệ!"))
        input(dim("  Nhấn Enter..."))
        return

    combo_name = available[idx][0]

    # Hiển thị sequence
    seq = rt.BUILTIN_SEQUENCES.get(combo_name, [])
    print()
    print_sequence_vertical(seq)

    # Gán hotkey
    hotkey = input("  Nhập phím gán (vd: q, e, mouse_3, mouse_4): ").strip()
    if not hotkey:
        print(red("  Hủy!"))
        input(dim("  Nhấn Enter..."))
        return

    # Validate key
    try:
        rt.parse_input(hotkey)
    except ValueError:
        print(red(f"  Phím '{hotkey}' không hợp lệ!"))
        input(dim("  Nhấn Enter..."))
        return

    sign_keys = cfg.get("comboSignKeys", {})
    sign_keys[combo_name] = hotkey
    cfg["comboSignKeys"] = sign_keys
    save_config(cfg)
    _reload_bindings(cfg)

    print(green(f"  ✓ Đã thêm: {combo_name} → [{hotkey}]"))
    input(dim("  Nhấn Enter..."))


def _add_custom(cfg):
    """Tạo combo custom mới."""
    clear()
    print_header()
    print(bold("  ═══ Tạo Combo Custom ═══"))
    print()

    name = input("  Tên combo: ").strip()
    if not name:
        print(red("  Hủy!"))
        input(dim("  Nhấn Enter..."))
        return

    hotkey = input("  Phím gán (vd: q, e, mouse_3, mouse_4): ").strip()
    if not hotkey:
        print(red("  Hủy!"))
        input(dim("  Nhấn Enter..."))
        return

    try:
        rt.parse_input(hotkey)
    except ValueError:
        print(red(f"  Phím '{hotkey}' không hợp lệ!"))
        input(dim("  Nhấn Enter..."))
        return

    # Chọn steps
    print()
    print(bold("  Xây dựng chuỗi combo:"))
    print(dim("  Nhập số step theo thứ tự. Gõ 'done' khi xong, 'cancel' để hủy."))
    print()

    all_steps = print_available_steps()
    sequence = []

    while True:
        prompt = f"    Step #{len(sequence)+1} (số/done/cancel): "
        inp = input(prompt).strip().lower()

        if inp == "done":
            break
        if inp == "cancel":
            print(red("  Hủy!"))
            input(dim("  Nhấn Enter..."))
            return

        try:
            si = int(inp) - 1
            if si < 0 or si >= len(all_steps):
                raise ValueError
            step_name = all_steps[si]
            sequence.append(step_name)
            print(dim(f"      → Đã thêm: {step_name}"))
        except ValueError:
            print(red("      Số không hợp lệ!"))

    if not sequence:
        print(red("  Chuỗi trống, hủy!"))
        input(dim("  Nhấn Enter..."))
        return

    print()
    print_sequence_vertical(sequence, f"Combo: {name}")

    confirm = input("  Xác nhận lưu? (y/n): ").strip().lower()
    if confirm != "y":
        print(red("  Hủy!"))
        input(dim("  Nhấn Enter..."))
        return

    custom_combos = cfg.get("customCombos", [])
    custom_combos.append({
        "name": name,
        "hotkey": hotkey,
        "pythonSequence": sequence,
    })
    cfg["customCombos"] = custom_combos
    save_config(cfg)
    _reload_bindings(cfg)

    print(green(f"  ✓ Đã tạo combo custom: {name} → [{hotkey}]"))
    input(dim("  Nhấn Enter..."))


def action_edit_combo(cfg, combos):
    """Sửa combo (hiển thị chuỗi thành cột dọc)."""
    if not combos:
        print(yellow("\n  Chưa có combo nào để sửa!"))
        input(dim("  Nhấn Enter..."))
        return

    idx = input("  Nhập số combo cần sửa: ").strip()
    try:
        idx = int(idx) - 1
        if idx < 0 or idx >= len(combos):
            raise ValueError
    except ValueError:
        print(red("  Số không hợp lệ!"))
        input(dim("  Nhấn Enter..."))
        return

    name, hotkey, is_builtin, sequence = combos[idx]

    while True:
        clear()
        print_header()
        print(bold(f"  ═══ Sửa Combo #{idx+1} ═══"))
        print()
        print(f"  Tên:   {bold(name)}")
        print(f"  Phím:  {green(f'[{hotkey}]')}")
        tag = cyan("Built-in") if is_builtin else yellow("Custom")
        print(f"  Loại:  {tag}")
        print()

        # Hiển thị chuỗi combo dạng cột dọc
        print_sequence_vertical(sequence)

        # Hiển thị lệnh tùy theo loại
        if is_builtin:
            print(f"   {bold('[h]')} Đổi hotkey   {bold('[b]')} Quay lại")
            print(dim("   (Combo built-in không thể sửa chuỗi hoặc tên)"))
        else:
            print(f"   {bold('[n]')} Đổi tên     {bold('[h]')} Đổi hotkey")
            print(f"   {bold('[e]')} Sửa chuỗi   {bold('[b]')} Quay lại")
        print()

        cmd = input("  > ").strip().lower()

        if cmd == "b":
            break

        elif cmd == "h":
            new_key = input("  Nhập phím mới: ").strip()
            if new_key:
                try:
                    rt.parse_input(new_key)
                except ValueError:
                    print(red(f"  Phím '{new_key}' không hợp lệ!"))
                    input(dim("  Nhấn Enter..."))
                    continue

                if is_builtin:
                    sign_keys = cfg.get("comboSignKeys", {})
                    sign_keys[name] = new_key
                    cfg["comboSignKeys"] = sign_keys
                else:
                    custom_combos = cfg.get("customCombos", [])
                    # Tìm combo custom tương ứng
                    ci = _find_custom_index(cfg, name, hotkey)
                    if ci is not None:
                        custom_combos[ci]["hotkey"] = new_key
                    cfg["customCombos"] = custom_combos

                hotkey = new_key
                save_config(cfg)
                _reload_bindings(cfg)
                print(green(f"  ✓ Đã đổi phím thành [{new_key}]"))
                input(dim("  Nhấn Enter..."))

        elif cmd == "n" and not is_builtin:
            new_name = input("  Nhập tên mới: ").strip()
            if new_name:
                ci = _find_custom_index(cfg, name, hotkey)
                if ci is not None:
                    cfg["customCombos"][ci]["name"] = new_name
                    name = new_name
                    save_config(cfg)
                    _reload_bindings(cfg)
                    print(green(f"  ✓ Đã đổi tên thành: {new_name}"))
                input(dim("  Nhấn Enter..."))

        elif cmd == "e" and not is_builtin:
            sequence = _edit_sequence(sequence)
            ci = _find_custom_index(cfg, name, hotkey)
            if ci is not None:
                cfg["customCombos"][ci]["pythonSequence"] = sequence
                save_config(cfg)
                _reload_bindings(cfg)
                print(green("  ✓ Đã cập nhật chuỗi combo!"))
            input(dim("  Nhấn Enter..."))


def _find_custom_index(cfg, name, hotkey):
    """Tìm index của custom combo trong config."""
    for i, cc in enumerate(cfg.get("customCombos", [])):
        if cc.get("name") == name and cc.get("hotkey") == hotkey:
            return i
        # Fallback: match by name only
        if cc.get("name") == name:
            return i
    return None


def _edit_sequence(current_seq):
    """Sửa chuỗi combo - xây dựng lại từ đầu."""
    clear()
    print_header()
    print(bold("  ═══ Sửa Chuỗi Combo ═══"))
    print()
    print(dim("  Chuỗi hiện tại:"))
    print_sequence_vertical(current_seq)

    print(bold("  Xây dựng chuỗi mới:"))
    print(dim("  Nhập số step theo thứ tự. 'done' = xong, 'cancel' = giữ cũ."))
    print()

    all_steps = print_available_steps()
    new_seq = []

    while True:
        prompt = f"    Step #{len(new_seq)+1} (số/done/cancel): "
        inp = input(prompt).strip().lower()

        if inp == "done":
            break
        if inp == "cancel":
            print(yellow("  Giữ chuỗi cũ."))
            return current_seq

        try:
            si = int(inp) - 1
            if si < 0 or si >= len(all_steps):
                raise ValueError
            step_name = all_steps[si]
            new_seq.append(step_name)
            print(dim(f"      → Đã thêm: {step_name}"))
        except ValueError:
            print(red("      Số không hợp lệ!"))

    if not new_seq:
        print(yellow("  Chuỗi trống, giữ chuỗi cũ."))
        return current_seq

    print()
    print_sequence_vertical(new_seq, "Chuỗi mới")
    return new_seq


def action_delete_combo(cfg, combos):
    """Xóa combo."""
    if not combos:
        print(yellow("\n  Chưa có combo nào để xóa!"))
        input(dim("  Nhấn Enter..."))
        return

    idx = input("  Nhập số combo cần xóa: ").strip()
    try:
        idx = int(idx) - 1
        if idx < 0 or idx >= len(combos):
            raise ValueError
    except ValueError:
        print(red("  Số không hợp lệ!"))
        input(dim("  Nhấn Enter..."))
        return

    name, hotkey, is_builtin, _ = combos[idx]

    print(f"\n  Xóa: {bold(name)} [{green(hotkey)}]?")
    confirm = input("  Xác nhận (y/n): ").strip().lower()
    if confirm != "y":
        print(yellow("  Hủy!"))
        input(dim("  Nhấn Enter..."))
        return

    if is_builtin:
        sign_keys = cfg.get("comboSignKeys", {})
        sign_keys.pop(name, None)
        cfg["comboSignKeys"] = sign_keys
    else:
        ci = _find_custom_index(cfg, name, hotkey)
        if ci is not None:
            cfg["customCombos"].pop(ci)

    save_config(cfg)
    _reload_bindings(cfg)
    print(green(f"  ✓ Đã xóa: {name}"))
    input(dim("  Nhấn Enter..."))


# ══════════════════════════════════════════════════════════════════════════════
#  Main Menu Loop
# ══════════════════════════════════════════════════════════════════════════════

def show_main_menu(cfg):
    """Hiển thị menu chính, trả về danh sách combos."""
    clear()
    combos = get_combo_list(cfg)
    print_header()
    print_status()
    print_combo_table(combos)
    print_actions()
    return combos


def main():
    # Chỉ chạy trên Linux
    if sys.platform != "linux":
        print("❌ Phiên bản này chỉ hỗ trợ Linux!")
        print(f"   Platform hiện tại: {sys.platform}")
        sys.exit(1)

    check_permissions()

    # Load config & khởi tạo bindings
    cfg = load_config()
    rt.FPSinput = int(cfg.get("FPS", 120))
    rt.apply_all_bindings(
        cfg.get("comboSignKeys", {}),
        cfg.get("customCombos", []),
    )

    # Khởi động listeners
    start_listeners()

    # Xử lý Ctrl+C
    def signal_handler(_sig, _frame):
        stop_listeners()
        print(f"\n\n  {dim('Tạm biệt!')} 👋\n")
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)

    log_debug(f"CLI started: FPS={rt.FPSinput}, "
              f"bindings={len(rt.active_bindings)}")

    # ── Main loop ─────────────────────────────────────────────────────────────
    try:
        while True:
            # Reload config mỗi vòng lặp (có thể đã thay đổi)
            cfg = load_config()
            rt.FPSinput = int(cfg.get("FPS", 120))
            combos = show_main_menu(cfg)

            choice = input("  > ").strip().lower()

            if choice == "q":
                break
            elif choice == "r":
                action_toggle_run()
            elif choice == "f":
                action_change_fps(cfg)
            elif choice == "a":
                action_add_combo(cfg)
            elif choice == "s":
                action_edit_combo(cfg, combos)
            elif choice == "d":
                action_delete_combo(cfg, combos)
            elif choice == "t":
                action_test_keys()
            else:
                # Thử parse số trực tiếp → sửa combo
                try:
                    num = int(choice)
                    if 1 <= num <= len(combos):
                        action_edit_combo(cfg, combos)
                except ValueError:
                    pass

    except (EOFError, KeyboardInterrupt):
        pass
    finally:
        rt.run_enabled = False
        for key in list(rt.running_states):
            rt.running_states[key] = False
        stop_listeners()
        print(f"\n  {dim('Tạm biệt!')} 👋\n")


if __name__ == "__main__":
    main()

// ── cus.js: Xử lý cấu hình Unlocker Island & Đường dẫn Game ─────────────────────
const API_UNLOCKER = 'http://localhost:5000/unlocker-config';

// Danh sách tham số cấu hình
const configKeys = {
    boolean: [
        'Vsync',
        'FpsUnlock',
        'FovUnlock',
        'RemoveTeamAnim',
        'DisableCameraMove',
        'DisableFog',
        'ShowFPS',
        'HideUID',
        'EnableNetworkToggle'
    ],
    int: [
        'TargetFps',
        'FovValue',
        'NetworkToggleKey'
    ]
};

// ── Bảng ánh xạ mã phím thập phân (Decimal VK Codes) theo KEYMAP.md ────────────
const VK_MAP = {
    // 1. Phím Chức Năng (112 - 123)
    112: "F1", 113: "F2", 114: "F3", 115: "F4", 116: "F5", 117: "F6",
    118: "F7", 119: "F8", 120: "F9", 121: "F10", 122: "F11", 123: "F12",

    // 2. Phím Điều Hướng & Điều Khiển
    192: "Tilde (~)",
    9: "Tab",
    20: "Caps Lock",
    32: "Space",
    13: "Enter",
    27: "Escape (Esc)",
    8: "Backspace",
    36: "Home",
    35: "End",
    33: "Page Up",
    34: "Page Down",
    45: "Insert",
    46: "Delete",
    37: "Mũi tên Trái",
    38: "Mũi tên Lên",
    39: "Mũi tên Phải",
    40: "Mũi tên Xuống",

    // 3. Phím Chuột
    1: "Chuột Trái",
    2: "Chuột Phải",
    4: "Chuột Giữa",
    5: "Chuột Phụ 1 (XButton 1)",
    6: "Chuột Phụ 2 (XButton 2)",

    // 4. Phím Chữ Cái (65 - 90)
    65: "A", 66: "B", 67: "C", 68: "D", 69: "E", 70: "F", 71: "G", 72: "H",
    73: "I", 74: "J", 75: "K", 76: "L", 77: "M", 78: "N", 79: "O", 80: "P",
    81: "Q", 82: "R", 83: "S", 84: "T", 85: "U", 86: "V", 87: "W", 88: "X",
    89: "Y", 90: "Z",

    // 5. Phím Số Hàng Chính (48 - 57)
    48: "0", 49: "1", 50: "2", 51: "3", 52: "4",
    53: "5", 54: "6", 55: "7", 56: "8", 57: "9",

    // 6. Phím Numpad
    96: "Numpad 0", 97: "Numpad 1", 98: "Numpad 2", 99: "Numpad 3", 100: "Numpad 4",
    101: "Numpad 5", 102: "Numpad 6", 103: "Numpad 7", 104: "Numpad 8", 105: "Numpad 9",
    106: "Numpad *", 107: "Numpad +", 109: "Numpad -", 110: "Numpad .", 111: "Numpad /",

    // 7. Ký Tự Đặc Biệt & Dấu Câu (OEM)
    189: "Dấu trừ (-)",
    187: "Dấu bằng (=)",
    219: "Ngoặc vuông mở ([)",
    221: "Ngoặc vuông đóng (])",
    220: "Gạch chéo ngược (\\)",
    186: "Chấm phẩy (;)",
    222: "Nháy đơn (')",
    188: "Dấu phẩy (,)",
    190: "Dấu chấm (.)",
    191: "Gạch chéo (/)"
};

// Phân nhóm cho dropdown chọn nhanh
const KEYMAP_GROUPS = [
    {
        group: "1. Phím Chức Năng (Function Keys)",
        keys: [
            { code: 112, name: "F1" }, { code: 113, name: "F2" }, { code: 114, name: "F3" },
            { code: 115, name: "F4" }, { code: 116, name: "F5" }, { code: 117, name: "F6" },
            { code: 118, name: "F7" }, { code: 119, name: "F8" }, { code: 120, name: "F9" },
            { code: 121, name: "F10" }, { code: 122, name: "F11 (Khuyên dùng/Mặc định)" }, { code: 123, name: "F12" },
        ]
    },
    {
        group: "2. Phím Điều Hướng & Điều Khiển",
        keys: [
            { code: 192, name: "Tilde (~)" }, { code: 9, name: "Tab" }, { code: 20, name: "Caps Lock" },
            { code: 32, name: "Space (Phím Cách)" }, { code: 13, name: "Enter" }, { code: 27, name: "Escape (Esc)" },
            { code: 8, name: "Backspace" }, { code: 36, name: "Home" }, { code: 35, name: "End" },
            { code: 33, name: "Page Up" }, { code: 34, name: "Page Down" }, { code: 45, name: "Insert" },
            { code: 46, name: "Delete" }, { code: 37, name: "Mũi tên Trái" }, { code: 38, name: "Mũi tên Lên" },
            { code: 39, name: "Mũi tên Phải" }, { code: 40, name: "Mũi tên Xuống" }
        ]
    },
    {
        group: "3. Phím Chuột (Mouse Buttons)",
        keys: [
            { code: 1, name: "Chuột Trái (Left Click)" },
            { code: 2, name: "Chuột Phải (Right Click)" },
            { code: 4, name: "Chuột Giữa (Middle Click)" },
            { code: 5, name: "Chuột Phụ 1 (XButton 1 - Back)" },
            { code: 6, name: "Chuột Phụ 2 (XButton 2 - Forward)" }
        ]
    },
    {
        group: "4. Phím Chữ Cái (A - Z)",
        keys: Array.from({ length: 26 }, (_, i) => ({
            code: 65 + i,
            name: `Phím ${String.fromCharCode(65 + i)}`
        }))
    },
    {
        group: "5. Phím Số Hàng Chính (0 - 9)",
        keys: Array.from({ length: 10 }, (_, i) => ({
            code: 48 + i,
            name: `Số ${i}`
        }))
    },
    {
        group: "6. Phím Bàn Phím Số (Numpad)",
        keys: [
            ...Array.from({ length: 10 }, (_, i) => ({ code: 96 + i, name: `Numpad ${i}` })),
            { code: 106, name: "Numpad *" }, { code: 107, name: "Numpad +" },
            { code: 109, name: "Numpad -" }, { code: 110, name: "Numpad ." },
            { code: 111, name: "Numpad /" }
        ]
    },
    {
        group: "7. Ký Tự Đặc Biệt & Dấu Câu",
        keys: [
            { code: 189, name: "Dấu trừ (-)" }, { code: 187, name: "Dấu bằng (=)" },
            { code: 219, name: "Ngoặc vuông mở ([)" }, { code: 221, name: "Ngoặc vuông đóng (])" },
            { code: 220, name: "Gạch chéo ngược (\\)" }, { code: 186, name: "Chấm phẩy (;)" },
            { code: 222, name: "Nháy đơn (')" }, { code: 188, name: "Dấu phẩy (,)" },
            { code: 190, name: "Dấu chấm (.)" }, { code: 191, name: "Gạch chéo (/)" }
        ]
    }
];

let currentConfig = {};

function formatVKCode(code) {
    const num = parseInt(code, 10);
    if (isNaN(num)) return "F11 (122)";
    const name = VK_MAP[num];
    if (name) {
        return `${name} (${num})`;
    }
    return `Mã ${num}`;
}

function resolveVKCodeFromEvent(e) {
    if (e.type === "mousedown") {
        const mouseMap = {
            0: 1, // VK_LBUTTON
            1: 4, // VK_MBUTTON
            2: 2, // VK_RBUTTON
            3: 5, // VK_XBUTTON1
            4: 6  // VK_XBUTTON2
        };
        return mouseMap[e.button] !== undefined ? mouseMap[e.button] : null;
    }

    // Keyboard event
    const codeMap = {
        "F1": 112, "F2": 113, "F3": 114, "F4": 115, "F5": 116, "F6": 117,
        "F7": 118, "F8": 119, "F9": 120, "F10": 121, "F11": 122, "F12": 123,
        "Backquote": 192, "Tab": 9, "CapsLock": 20, "Space": 32, "Enter": 13,
        "Escape": 27, "Backspace": 8, "Home": 36, "End": 35, "PageUp": 33,
        "PageDown": 34, "Insert": 45, "Delete": 46,
        "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40,
        "Digit0": 48, "Digit1": 49, "Digit2": 50, "Digit3": 51, "Digit4": 52,
        "Digit5": 53, "Digit6": 54, "Digit7": 55, "Digit8": 56, "Digit9": 57,
        "Numpad0": 96, "Numpad1": 97, "Numpad2": 98, "Numpad3": 99, "Numpad4": 100,
        "Numpad5": 101, "Numpad6": 102, "Numpad7": 103, "Numpad8": 104, "Numpad9": 105,
        "NumpadMultiply": 106, "NumpadAdd": 107, "NumpadSubtract": 109,
        "NumpadDecimal": 110, "NumpadDivide": 111,
        "Minus": 189, "Equal": 187, "BracketLeft": 219, "BracketRight": 221,
        "Backslash": 220, "Semicolon": 186, "Quote": 222, "Comma": 188,
        "Period": 190, "Slash": 191
    };

    if (codeMap[e.code]) return codeMap[e.code];

    if (/^Key[A-Z]$/.test(e.code)) {
        return e.code.charCodeAt(3); // A-Z: 65 - 90
    }

    if (e.keyCode && VK_MAP[e.keyCode]) {
        return e.keyCode;
    }

    return null;
}

// ── Quản lý Key Binding Modal cho NetworkToggleKey ───────────────────────────
let networkKeyHandler = null;
let networkMouseHandler = null;

function initQuickKeySelect() {
    const select = document.getElementById('quickKeySelect');
    if (!select) return;
    select.innerHTML = '';

    KEYMAP_GROUPS.forEach(g => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = g.group;
        g.keys.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k.code;
            opt.textContent = `${k.name} — [Mã: ${k.code}]`;
            optgroup.appendChild(opt);
        });
        select.appendChild(optgroup);
    });

    select.addEventListener('change', (e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val)) {
            setNetworkToggleKey(val);
            closeNetworkKeyBindModal();
        }
    });
}

function setNetworkToggleKey(vkCode) {
    currentConfig.NetworkToggleKey = vkCode;
    const label = document.getElementById('label_NetworkToggleKey');
    if (label) {
        label.textContent = formatVKCode(vkCode);
    }
    const select = document.getElementById('quickKeySelect');
    if (select) {
        select.value = vkCode;
    }
    showToast(`Đã gán phím tắt ToggleNetwork: ${formatVKCode(vkCode)}`);
}

function openNetworkKeyBindModal() {
    const modal = document.getElementById('networkKeyBindModal');
    if (!modal) return;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    const currentKey = currentConfig.NetworkToggleKey !== undefined ? currentConfig.NetworkToggleKey : 122;
    const select = document.getElementById('quickKeySelect');
    if (select) select.value = currentKey;

    startNetworkKeyCapture();
}

function closeNetworkKeyBindModal() {
    stopNetworkKeyCapture();
    const modal = document.getElementById('networkKeyBindModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

function startNetworkKeyCapture() {
    stopNetworkKeyCapture();

    const statusBadge = document.getElementById('networkBindStatusBadge');
    const statusText = document.getElementById('networkBindStatusText');
    if (statusText) statusText.textContent = 'Đang chờ bấm phím hoặc click chuột...';
    if (statusBadge) statusBadge.classList.add('animate-pulse');

    networkKeyHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.code === 'Escape') {
            closeNetworkKeyBindModal();
            return;
        }

        const vk = resolveVKCodeFromEvent(e);
        if (vk) {
            setNetworkToggleKey(vk);
            closeNetworkKeyBindModal();
        }
    };

    networkMouseHandler = (e) => {
        // Cho phép bấm các nút tương tác bên trong modal
        if (e.target.closest('#closeNetworkKeyBindBtn, #resetDefaultNetworkKeyBtn, #quickKeySelect')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const vk = resolveVKCodeFromEvent(e);
        if (vk) {
            setNetworkToggleKey(vk);
            closeNetworkKeyBindModal();
        }
    };

    window.addEventListener('keydown', networkKeyHandler, true);
    window.addEventListener('mousedown', networkMouseHandler, true);
}

function stopNetworkKeyCapture() {
    if (networkKeyHandler) {
        window.removeEventListener('keydown', networkKeyHandler, true);
        networkKeyHandler = null;
    }
    if (networkMouseHandler) {
        window.removeEventListener('mousedown', networkMouseHandler, true);
        networkMouseHandler = null;
    }
}

// ── Tải và hiển thị cấu hình Unlocker ───────────────────────────────────────
async function fetchUnlockerConfig() {
    try {
        if (window.unlockerNative && typeof window.unlockerNative.getConfig === 'function') {
            currentConfig = await window.unlockerNative.getConfig();
            updateUIFromConfig();
            return;
        }
        const res = await fetch(API_UNLOCKER);
        if (res.ok) {
            currentConfig = await res.json();
            updateUIFromConfig();
        } else {
            showToast('Không thể kết nối tới file config.ini!', true);
        }
    } catch (err) {
        console.error('Không thể tải cấu hình unlocker:', err);
        showToast('Lỗi khi kết nối tới backend Unlocker!', true);
    }
}

function updateUIFromConfig() {
    // Booleans
    configKeys.boolean.forEach(key => {
        const el = document.getElementById(`cfg_${key}`);
        if (el) {
            const rawVal = currentConfig[key] !== undefined ? currentConfig[key] : (currentConfig[aliasMap(key)] !== undefined ? currentConfig[aliasMap(key)] : 0);
            const val = rawVal === 1 || rawVal === true || rawVal === '1';
            el.checked = val;
        }
    });

    // Ints
    configKeys.int.forEach(key => {
        if (key === 'NetworkToggleKey') {
            const netKey = currentConfig.NetworkToggleKey !== undefined ? parseInt(currentConfig.NetworkToggleKey, 10) : 122;
            const label = document.getElementById('label_NetworkToggleKey');
            if (label) {
                label.textContent = formatVKCode(netKey);
            }
            const select = document.getElementById('quickKeySelect');
            if (select) {
                select.value = netKey;
            }
            return;
        }

        const inputNum = document.getElementById(`cfg_${key}`);
        const inputRange = document.getElementById(`range_${key}`);
        const defaultVal = (key === 'TargetFps' ? 240 : 60);
        const val = currentConfig[key] !== undefined ? parseInt(currentConfig[key], 10) : defaultVal;
        if (inputNum) inputNum.value = val;
        if (inputRange) inputRange.value = val;
    });

    // GamePath
    const gamePathInput = document.getElementById('cfg_GamePath');
    if (gamePathInput) {
        gamePathInput.value = currentConfig.GamePath || '';
        updateGamePathBadge(gamePathInput.value);
    }
}

function aliasMap(key) {
    if (key === 'DisableBurstBlackscreen') return 'DisableBurstBackscreen';
    return key;
}

function getUIConfig() {
    const data = { ...currentConfig };

    // Booleans
    configKeys.boolean.forEach(key => {
        const el = document.getElementById(`cfg_${key}`);
        if (el) {
            const val = el.checked ? 1 : 0;
            data[key] = val;
            const alias = aliasMap(key);
            if (alias !== key) {
                data[alias] = val;
            }
        }
    });

    // Ints
    configKeys.int.forEach(key => {
        if (key === 'NetworkToggleKey') {
            data.NetworkToggleKey = parseInt(currentConfig.NetworkToggleKey, 10) || 122;
            return;
        }

        const el = document.getElementById(`cfg_${key}`);
        if (el) {
            data[key] = parseInt(el.value, 10) || (key === 'TargetFps' ? 240 : 60);
        }
    });

    // GamePath
    const gamePathInput = document.getElementById('cfg_GamePath');
    if (gamePathInput) {
        data.GamePath = gamePathInput.value.trim();
    }

    return data;
}

async function saveUnlockerConfig() {
    const btn = document.getElementById('saveUnlockerBtn');
    const label = document.getElementById('saveBtnLabel');
    if (btn) {
        btn.disabled = true;
        btn.classList.add('opacity-75', 'cursor-wait');
        if (label) label.textContent = 'Đang lưu...';
    }

    const payload = getUIConfig();
    try {
        if (window.unlockerNative && typeof window.unlockerNative.saveConfig === 'function') {
            await window.unlockerNative.saveConfig(payload);
            currentConfig = payload;
            showToast('Đã lưu cấu hình config.ini thành công!');
        } else {
            const res = await fetch(API_UNLOCKER, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                currentConfig = payload;
                showToast('Đã lưu cấu hình config.ini thành công!');
            } else {
                showToast('Lỗi khi lưu cấu hình config.ini!', true);
            }
        }
    } catch (err) {
        console.error('Lỗi lưu config:', err);
        showToast('Lỗi kết nối tới backend!', true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('opacity-75', 'cursor-wait');
            if (label) label.textContent = 'Lưu cấu hình';
        }
    }
}

function updateGamePathBadge(path) {
    const badge = document.getElementById('gamePathStatusBadge');
    if (!badge) return;
    if (path && (path.toLowerCase().endsWith('genshinimpact.exe') || path.toLowerCase().endsWith('.exe'))) {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0';
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>File sẵn sàng';
    } else if (path) {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20 shrink-0';
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span>Đường dẫn đã nhập';
    } else {
        badge.className = 'hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20 shrink-0';
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-rose-400"></span>Chưa chọn file';
    }
}

function setupBrowseGamePath() {
    const browseBtn = document.getElementById('browseGamePathBtn');
    const gamePathInput = document.getElementById('cfg_GamePath');
    const fileInput = document.getElementById('gamePathFileInput');

    if (gamePathInput) {
        gamePathInput.addEventListener('input', () => {
            updateGamePathBadge(gamePathInput.value.trim());
        });
    }

    if (browseBtn) {
        browseBtn.addEventListener('click', async () => {
            let selectedPath = null;

            // 1. Dùng IPC Native của Electron để bật file explorer dialog
            if (window.unlockerNative && typeof window.unlockerNative.selectGamePath === 'function') {
                selectedPath = await window.unlockerNative.selectGamePath();
            } 
            // 2. Tùy chọn gọi backend Python qua HTTP
            else {
                try {
                    const res = await fetch('http://localhost:5000/browse-game-path', { method: 'POST' });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.ok && data.path) {
                            selectedPath = data.path;
                        }
                    }
                } catch (e) {
                    console.error('Lỗi mở duyệt file backend:', e);
                }
            }

            // 3. Fallback dùng html input file nếu không chọn qua 1 & 2
            if (!selectedPath && fileInput) {
                fileInput.click();
                return;
            }

            if (selectedPath) {
                if (gamePathInput) gamePathInput.value = selectedPath;
                currentConfig.GamePath = selectedPath;
                updateGamePathBadge(selectedPath);
                saveUnlockerConfig();
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                const selectedPath = file.path || file.name;
                if (selectedPath) {
                    if (gamePathInput) gamePathInput.value = selectedPath;
                    currentConfig.GamePath = selectedPath;
                    updateGamePathBadge(selectedPath);
                    saveUnlockerConfig();
                }
            }
        });
    }
}

function showToast(message, isError = false) {
    let toast = document.getElementById('toastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.className = 'fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl transition-all duration-300 transform translate-y-10 opacity-0 flex items-center gap-3 backdrop-blur-md border';
        document.body.appendChild(toast);
    }
    if (isError) {
        toast.className = 'fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl transition-all duration-300 transform translate-y-0 opacity-100 flex items-center gap-3 backdrop-blur-md border border-rose-500/50 bg-rose-950/90 text-rose-200';
        toast.innerHTML = `<span class="material-symbols-outlined text-rose-400">error</span><span class="font-medium text-sm">${message}</span>`;
    } else {
        toast.className = 'fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl shadow-2xl transition-all duration-300 transform translate-y-0 opacity-100 flex items-center gap-3 backdrop-blur-md border border-teal/50 bg-teal-deep/90 text-teal-100';
        toast.innerHTML = `<span class="material-symbols-outlined text-teal-300">check_circle</span><span class="font-medium text-sm">${message}</span>`;
    }
    setTimeout(() => {
        toast.className = toast.className.replace('translate-y-0 opacity-100', 'translate-y-10 opacity-0');
    }, 3000);
}

// Sync range and number inputs
function setupSyncInputs() {
    configKeys.int.forEach(key => {
        const inputNum = document.getElementById(`cfg_${key}`);
        const inputRange = document.getElementById(`range_${key}`);
        if (inputNum && inputRange) {
            inputNum.addEventListener('input', () => {
                inputRange.value = inputNum.value;
            });
            inputRange.addEventListener('input', () => {
                inputNum.value = inputRange.value;
            });
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initQuickKeySelect();
    setupSyncInputs();
    setupBrowseGamePath();
    fetchUnlockerConfig();

    const saveBtn = document.getElementById('saveUnlockerBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', saveUnlockerConfig);
    }

    const resetBtn = document.getElementById('resetUnlockerBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            updateUIFromConfig();
            showToast('Đã khôi phục cài đặt mặc định/hiện tại!');
        });
    }

    const netKeyBtn = document.getElementById('btn_NetworkToggleKey');
    if (netKeyBtn) {
        netKeyBtn.addEventListener('click', openNetworkKeyBindModal);
    }

    const closeNetKeyBtn = document.getElementById('closeNetworkKeyBindBtn');
    if (closeNetKeyBtn) {
        closeNetKeyBtn.addEventListener('click', closeNetworkKeyBindModal);
    }

    const resetNetKeyBtn = document.getElementById('resetDefaultNetworkKeyBtn');
    if (resetNetKeyBtn) {
        resetNetKeyBtn.addEventListener('click', () => {
            setNetworkToggleKey(122);
            closeNetworkKeyBindModal();
        });
    }
});

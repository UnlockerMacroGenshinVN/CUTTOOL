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
        'DisableBurstBlackscreen',
        'ShowFPS'
    ],
    int: [
        'TargetFps',
        'FovValue'
    ]
};

let currentConfig = {};

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
});

const BUILTIN_COMBOS = [
    "C0:  Combo Skirk C0 EQA 120fps",
    "C0:  Combo Skirk C0 EA 120fps",
    "C0:  Combo Skirk C0 EQA 60fps"
];


function formatKey(key) {
    if (!key) return "";
    const map = {
        shift: "Shift", ctrl: "Ctrl", alt: "Alt", caps_lock: "CapsLock",
        space: "Space", enter: "Enter", esc: "Esc", delete: "Delete",
        middle: "Mouse Middle"
    };
    if (map[key]) return map[key];
    if (/^f\d+$/i.test(key)) return key.toUpperCase();
    if (/^mouse_\d+$/.test(key)) return `mouse_${key.slice(6)}`;
    return key.length === 1 ? key.toUpperCase() : key;
}

async function loadAndRenderBoundCombos() {
    let config = { comboSignKeys: {}, customCombos: [] };
    try {
        const res = await fetch("http://localhost:5000/config");
        if (res.ok) {
            config = await res.json();
        } else {
            throw new Error();
        }
    } catch {
        try {
            config.comboSignKeys = JSON.parse(localStorage.getItem("comboSignKeys") || "{}");
            config.customCombos = JSON.parse(localStorage.getItem("customCombos") || "[]");
        } catch {}
    }

    const boundCombos = [];

    // Built-in combos with bound keys
    BUILTIN_COMBOS.forEach((comboStr, idx) => {
        const key = config.comboSignKeys && config.comboSignKeys[comboStr];
        if (key) {
            boundCombos.push({
                name: `Combo ${idx + 1}: ${comboStr}`,
                key: formatKey(key)
            });
        }
    });

    // Custom combos with bound keys
    const customCombos = Array.isArray(config.customCombos) ? config.customCombos : [];
    customCombos.forEach((c) => {
        if (c.hotkey) {
            boundCombos.push({
                name: c.name || "Custom Combo",
                key: formatKey(c.hotkey)
            });
        }
    });

    const container = document.getElementById("boundCombosList");
    if (!container) return;

    if (boundCombos.length === 0) {
        container.innerHTML = `<div class="text-on-surface-variant/60 text-sm py-4 text-center">Chưa có combo nào được bind phím.</div>`;
        return;
    }

    // Slice max 4 items ("nhiều combo quá thì cũng bỏ qua")
    const displayCombos = boundCombos.slice(0, 4);

    container.innerHTML = displayCombos.map(item => `
        <div class="flex items-center justify-between p-3 rounded-lg bg-surface-container-high border border-outline/30 hover:border-teal/50 transition-colors">
            <span class="font-medium text-sm text-on-surface truncate max-w-[220px]" title="${item.name}">${item.name}</span>
            <span class="px-2.5 py-1 text-xs font-mono bg-teal/15 text-teal border border-teal/40 rounded flex items-center gap-1 font-semibold">
                <span>⌨</span> ${item.key}
            </span>
        </div>
    `).join("");

    // Update FPS input if loaded
    const fpsInput = document.getElementById("macroFpsInput");
    if (fpsInput && config.FPS) {
        fpsInput.value = config.FPS;
    }
}

// ── Status & FPS Manager ──────────────────────────────────────────────────────
async function saveMacroFps() {
    const fpsInput = document.getElementById("macroFpsInput");
    const msgEl = document.getElementById("fpsSaveMsg");
    if (!fpsInput) return;

    const val = Number(fpsInput.value) || 120;
    localStorage.setItem("FPS", val);

    let currentConfig = {};
    try {
        const res = await fetch("http://localhost:5000/config");
        if (res.ok) currentConfig = await res.json();
    } catch {}

    currentConfig.FPS = val;
    currentConfig.comboSignKeys = currentConfig.comboSignKeys || JSON.parse(localStorage.getItem("comboSignKeys") || "{}");
    currentConfig.customCombos = currentConfig.customCombos || JSON.parse(localStorage.getItem("customCombos") || "[]");

    try {
        await fetch("http://localhost:5000/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentConfig)
        });
        if (msgEl) {
            msgEl.textContent = `✓ Đã lưu FPS: ${val}`;
            setTimeout(() => { msgEl.textContent = ""; }, 2500);
        }
    } catch {
        if (msgEl) {
            msgEl.textContent = `! Đã lưu cục bộ FPS: ${val}`;
            setTimeout(() => { msgEl.textContent = ""; }, 2500);
        }
    }
}

async function checkMacroStatus() {
    const badge = document.getElementById("backendStatusBadge");
    const dot = document.getElementById("backendStatusDot");
    const text = document.getElementById("backendStatusText");
    if (!badge || !dot || !text) return;

    try {
        const res = await fetch("http://localhost:5000/config", { method: "GET", signal: AbortSignal.timeout(1500) });
        if (res.ok) {
            const isRunning = getRunActive();
            if (isRunning) {
                // Trạng thái 1: Đang hoạt động
                badge.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all bg-teal/15 text-teal border-teal/40";
                dot.className = "w-2 h-2 rounded-full bg-teal animate-pulse";
                text.textContent = "Đang hoạt động";
            } else {
                // Trạng thái 2: Đang nghỉ
                badge.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all bg-amber-500/15 text-amber-300 border-amber-500/40";
                dot.className = "w-2 h-2 rounded-full bg-amber-400";
                text.textContent = "Đang nghỉ";
            }
        } else {
            throw new Error();
        }
    } catch {
        // Trạng thái 3: Lỗi dừng hoạt động
        badge.className = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all bg-red-500/15 text-red-400 border-red-500/40";
        dot.className = "w-2 h-2 rounded-full bg-red-400 animate-ping";
        text.textContent = "Lỗi dừng hoạt động";
    }
}

// ── Update Checker ────────────────────────────────────────────────────────────
let _updateInfo = null; // Lưu trữ thông tin update để dùng khi click bell

/**
 * Khởi tạo hệ thống kiểm tra cập nhật
 * - Đọc version từ main process (version.json) để hiển thị trên banner
 * - Auto-check update 1 lần sau khi trang load (delay 3s)
 * - Click bell: hiện modal nếu có update, hiện toast nếu không
 */
async function initUpdateChecker() {
    const bellIcon = document.getElementById('updateBellIcon');
    const badgeDot = document.getElementById('updateBadgeDot');
    const checkUpdateBtn = document.getElementById('checkUpdateBtn');
    const updateModal = document.getElementById('updateModal');
    const updateVersionInfo = document.getElementById('updateVersionInfo');
    const updateReleaseNotes = document.getElementById('updateReleaseNotes');
    const updateDownloadBtn = document.getElementById('updateDownloadBtn');
    const updateCloseBtn = document.getElementById('updateCloseBtn');
    const bannerAppVersion = document.getElementById('bannerAppVersion');

    // 1. Đọc phiên bản hiện tại từ version.json và cập nhật hiển thị trên banner
    if (window.unlockerNative && typeof window.unlockerNative.getAppVersion === 'function') {
        try {
            const version = await window.unlockerNative.getAppVersion();
            if (bannerAppVersion && version && version !== '0.0.0') {
                bannerAppVersion.textContent = `v${version}`;
            }
        } catch (e) {
            console.warn('Không thể đọc phiên bản ứng dụng:', e);
        }
    }

    // 2. Hàm thực hiện kiểm tra update
    async function performUpdateCheck() {
        if (!window.unlockerNative || typeof window.unlockerNative.checkForUpdate !== 'function') {
            console.warn('Update checker API không khả dụng');
            return;
        }

        try {
            const result = await window.unlockerNative.checkForUpdate();
            _updateInfo = result;

            if (result.hasUpdate) {
                // Đổi icon chuông sang chuông có dấu chấm than
                if (bellIcon) bellIcon.textContent = 'notification_important';
                if (badgeDot) badgeDot.classList.remove('hidden');
                if (checkUpdateBtn) {
                    checkUpdateBtn.title = `Có bản cập nhật mới: v${result.latestVersion}`;
                    checkUpdateBtn.classList.add('text-amber-400');
                    checkUpdateBtn.classList.remove('text-on-surface-variant');
                }
                console.log(`[Update] Có phiên bản mới: v${result.latestVersion} (hiện tại: v${result.currentVersion})`);
            } else {
                // Giữ nguyên icon chuông bình thường
                if (bellIcon) bellIcon.textContent = 'notifications';
                if (badgeDot) badgeDot.classList.add('hidden');
                if (checkUpdateBtn) {
                    checkUpdateBtn.title = 'Bạn đang sử dụng phiên bản mới nhất';
                    checkUpdateBtn.classList.remove('text-amber-400');
                }
                if (result.error) {
                    console.warn(`[Update] Lỗi kiểm tra: ${result.error}`);
                } else {
                    console.log(`[Update] Đang sử dụng phiên bản mới nhất: v${result.currentVersion}`);
                }
            }
        } catch (e) {
            console.error('[Update] Lỗi kiểm tra cập nhật:', e);
        }
    }

    // 3. Click bell button
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', () => {
            if (_updateInfo && _updateInfo.hasUpdate) {
                // Hiện modal thông tin update
                if (updateVersionInfo) {
                    updateVersionInfo.textContent = `Phiên bản hiện tại: v${_updateInfo.currentVersion} → Phiên bản mới: v${_updateInfo.latestVersion}`;
                }
                if (updateReleaseNotes) {
                    updateReleaseNotes.textContent = _updateInfo.releaseNotes || 'Không có ghi chú phát hành.';
                }
                if (updateModal) updateModal.classList.remove('hidden');
            } else {
                // Hiện toast thông báo đã mới nhất
                _notify('✓ Bạn đang sử dụng phiên bản mới nhất!');
                // Gọi lại check để cập nhật (manual refresh)
                performUpdateCheck();
            }
        });
    }

    // 4. Nút "Tải về" trong modal → mở link GitHub release
    if (updateDownloadBtn) {
        updateDownloadBtn.addEventListener('click', async () => {
            if (_updateInfo) {
                // Ưu tiên mở trang release HTML, fallback sang download trực tiếp
                const url = _updateInfo.htmlUrl || _updateInfo.downloadUrl;
                if (url && window.unlockerNative && typeof window.unlockerNative.openExternalUrl === 'function') {
                    await window.unlockerNative.openExternalUrl(url);
                }
            }
            if (updateModal) updateModal.classList.add('hidden');
        });
    }

    // 5. Nút "Để sau" trong modal → đóng modal
    if (updateCloseBtn) {
        updateCloseBtn.addEventListener('click', () => {
            if (updateModal) updateModal.classList.add('hidden');
        });
    }

    // 6. Click ngoài modal content → đóng modal
    if (updateModal) {
        updateModal.addEventListener('click', (e) => {
            if (e.target === updateModal) {
                updateModal.classList.add('hidden');
            }
        });
    }

    // 7. Auto-check update sau 3 giây (để UI load xong trước)
    setTimeout(performUpdateCheck, 3000);
}

// ── Banner Image Manager ──────────────────────────────────────────────────────
const BANNER_STORAGE_KEY = "custom_hero_banner";
const DEFAULT_BANNER_SRC = "assets/defbanner.png";

function initBannerManager() {
    const heroImage = document.getElementById("hero-image");
    const heroContainer = document.getElementById("hero-container");
    const changeBannerBtn = document.getElementById("changeBannerBtn");
    const resetBannerBtn = document.getElementById("resetBannerBtn");
    const bannerFileInput = document.getElementById("bannerFileInput");

    if (!heroImage) return;

    // Load saved custom banner if exists
    const savedBanner = localStorage.getItem(BANNER_STORAGE_KEY);
    if (savedBanner) {
        heroImage.style.backgroundImage = `url("${savedBanner}")`;
        if (resetBannerBtn) resetBannerBtn.classList.remove("hidden");
    } else {
        heroImage.style.backgroundImage = `url("${DEFAULT_BANNER_SRC}")`;
        if (resetBannerBtn) resetBannerBtn.classList.add("hidden");
    }

    const applyAndSaveBanner = (imageDataUrl) => {
        heroImage.style.backgroundImage = `url("${imageDataUrl}")`;
        try {
            localStorage.setItem(BANNER_STORAGE_KEY, imageDataUrl);
        } catch (err) {
            console.warn("Không thể lưu banner vào localStorage:", err);
        }
        if (resetBannerBtn) resetBannerBtn.classList.remove("hidden");
        _notify("Đã cập nhật ảnh bìa trang chính!");
    };

    // Change banner button click handler
    if (changeBannerBtn) {
        changeBannerBtn.addEventListener("click", async () => {
            if (window.unlockerNative && typeof window.unlockerNative.selectBannerImage === "function") {
                try {
                    const imgData = await window.unlockerNative.selectBannerImage();
                    if (imgData) {
                        applyAndSaveBanner(imgData);
                    }
                    return;
                } catch (err) {
                    console.error("Lỗi dialog chọn ảnh native:", err);
                }
            }
            if (bannerFileInput) {
                bannerFileInput.click();
            }
        });
    }

    // File input change event handler
    if (bannerFileInput) {
        bannerFileInput.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith("image/")) {
                _notify("Vui lòng chọn tệp hình ảnh hợp lệ!", true);
                return;
            }

            const reader = new FileReader();
            reader.onload = (evt) => {
                const dataUrl = evt.target?.result;
                if (dataUrl) {
                    applyAndSaveBanner(dataUrl);
                }
            };
            reader.readAsDataURL(file);
            bannerFileInput.value = "";
        });
    }

    // Reset button handler
    if (resetBannerBtn) {
        resetBannerBtn.addEventListener("click", () => {
            localStorage.removeItem(BANNER_STORAGE_KEY);
            heroImage.style.backgroundImage = `url("${DEFAULT_BANNER_SRC}")`;
            resetBannerBtn.classList.add("hidden");
            _notify("Đã khôi phục ảnh bìa mặc định!");
        });
    }

    // Drag and Drop support on hero container
    if (heroContainer) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            heroContainer.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        heroContainer.addEventListener('dragover', () => {
            heroContainer.classList.add('outline', 'outline-2', 'outline-teal', '-outline-offset-4');
        });

        ['dragleave', 'drop'].forEach(eventName => {
            heroContainer.addEventListener(eventName, () => {
                heroContainer.classList.remove('outline', 'outline-2', 'outline-teal', '-outline-offset-4');
            });
        });

        heroContainer.addEventListener('drop', (e) => {
            const files = e.dataTransfer && e.dataTransfer.files;
            if (files && files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (evt) => {
                        if (evt.target?.result) {
                            applyAndSaveBanner(evt.target.result);
                        }
                    };
                    reader.readAsDataURL(file);
                } else {
                    _notify("Vui lòng thả tệp hình ảnh hợp lệ!", true);
                }
            }
        });
    }
}

// ── Db Unlocker & Game Path Config ───────────────────────────────────────────
let currentUnlockerConfig = {};

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

async function loadDbUnlockerConfig() {
    try {
        if (window.unlockerNative && typeof window.unlockerNative.getConfig === 'function') {
            currentUnlockerConfig = await window.unlockerNative.getConfig();
        } else {
            const res = await fetch("http://localhost:5000/unlocker-config");
            if (res.ok) {
                currentUnlockerConfig = await res.json();
            }
        }
        
        const fpsUnlockCheckbox = document.getElementById("db_FpsUnlock");
        const targetFpsInput = document.getElementById("db_TargetFps");
        const gamePathInput = document.getElementById("db_GamePath");
        
        if (fpsUnlockCheckbox) fpsUnlockCheckbox.checked = (currentUnlockerConfig.FpsUnlock === 1 || currentUnlockerConfig.FpsUnlock === true || currentUnlockerConfig.FpsUnlock === '1');
        if (targetFpsInput) targetFpsInput.value = currentUnlockerConfig.TargetFps || 240;
        if (gamePathInput) {
            gamePathInput.value = currentUnlockerConfig.GamePath || "";
            updateGamePathBadge(gamePathInput.value);
        }
    } catch (err) {
        console.warn("Không thể tải cấu hình Unlocker trên trang chính:", err);
    }
}

async function saveDbUnlockerConfig() {
    const fpsUnlockCheckbox = document.getElementById("db_FpsUnlock");
    const targetFpsInput = document.getElementById("db_TargetFps");
    
    currentUnlockerConfig.FpsUnlock = fpsUnlockCheckbox ? (fpsUnlockCheckbox.checked ? 1 : 0) : 0;
    currentUnlockerConfig.TargetFps = targetFpsInput ? parseInt(targetFpsInput.value) || 240 : 240;
    
    const msg = document.getElementById("db_unlockerSaveMsg");
    if (msg) {
        msg.textContent = "Đang lưu...";
        msg.style.color = "#8fa0ba";
    }

    try {
        let saved = false;
        if (window.unlockerNative && typeof window.unlockerNative.saveConfig === "function") {
            await window.unlockerNative.saveConfig(currentUnlockerConfig);
            saved = true;
        }
        try {
            const res = await fetch("http://localhost:5000/unlocker-config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(currentUnlockerConfig)
            });
            if (res.ok) saved = true;
        } catch {}

        if (saved) {
            if (msg) {
                msg.textContent = "Đã lưu thành công!";
                msg.style.color = "#2dd4bf";
            }
        } else {
            throw new Error();
        }
    } catch (err) {
        if (msg) {
            msg.textContent = "Lỗi khi lưu cấu hình!";
            msg.style.color = "#f87171";
        }
    }
    
    setTimeout(() => {
        if (msg) msg.textContent = "";
    }, 2000);
}

async function saveDbGamePath(silent = false) {
    const gamePathInput = document.getElementById("db_GamePath");
    if (!gamePathInput) return;
    
    const newPath = gamePathInput.value.trim();
    currentUnlockerConfig.GamePath = newPath;
    updateGamePathBadge(newPath);

    const msg = document.getElementById("db_gamePathSaveMsg");
    if (msg && !silent) {
        msg.textContent = "Đang lưu...";
        msg.style.color = "#8fa0ba";
    }
    
    try {
        let saved = false;
        if (window.unlockerNative && typeof window.unlockerNative.saveConfig === "function") {
            await window.unlockerNative.saveConfig(currentUnlockerConfig);
            saved = true;
        }
        try {
            const res = await fetch("http://localhost:5000/unlocker-config", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(currentUnlockerConfig)
            });
            if (res.ok) saved = true;
        } catch {}

        if (saved) {
            if (msg) {
                msg.textContent = "Đã lưu đường dẫn Game!";
                msg.style.color = "#2dd4bf";
            }
            if (!silent) _notify("Đã lưu đường dẫn Game!");
        } else {
            throw new Error();
        }
    } catch (err) {
        if (msg) {
            msg.textContent = "Lỗi khi lưu đường dẫn!";
            msg.style.color = "#f87171";
        }
        if (!silent) _notify("Lỗi khi lưu đường dẫn Game!", true);
    }

    if (msg) {
        setTimeout(() => {
            msg.textContent = "";
        }, 2000);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initBannerManager();
    initUpdateChecker();

    const heroImage = document.getElementById('hero-image');
    const heroContainer = document.getElementById('hero-container');
    const bannerTitleContainer = document.getElementById('bannerTitleContainer');
    const bannerAppName = document.getElementById('bannerAppName');
    
    if (heroImage && heroContainer) {
        window.addEventListener('scroll', () => {
            const scrollY = window.scrollY;
            const containerHeight = heroContainer.offsetHeight;
            let opacity = 1 - (scrollY / (containerHeight * 0.8));
            opacity = Math.max(0, Math.min(1, opacity));
            let scale = 1.05 + (scrollY * 0.0002);
            scale = Math.min(1.15, scale);
            heroImage.style.opacity = opacity;
            heroImage.style.transform = `scale(${scale})`;

            // Title animation on scroll
            if (bannerTitleContainer && bannerAppName) {
                if (scrollY > 50) {
                    bannerTitleContainer.classList.remove('flex-col', 'top-1/2', '-translate-y-1/2', 'items-start', 'gap-3');
                    bannerTitleContainer.classList.add('flex-row', 'items-center', 'top-6', 'gap-2');
                    bannerAppName.classList.remove('text-5xl', 'md:text-6xl');
                    bannerAppName.classList.add('text-3xl', 'md:text-4xl');
                    bannerAppName.textContent = "CutTool";
                } else {
                    bannerTitleContainer.classList.add('flex-col', 'top-1/2', '-translate-y-1/2', 'items-start', 'gap-3');
                    bannerTitleContainer.classList.remove('flex-row', 'items-center', 'top-6', 'gap-2');
                    bannerAppName.classList.add('text-5xl', 'md:text-6xl');
                    bannerAppName.classList.remove('text-3xl', 'md:text-4xl');
                    bannerAppName.textContent = "CutTool";
                }
            }
        });
    }
    // Bind FPS Save button & Enter key
    const saveFpsBtn = document.getElementById("saveFpsBtn");
    const macroFpsInput = document.getElementById("macroFpsInput");
    if (saveFpsBtn) saveFpsBtn.addEventListener("click", saveMacroFps);
    if (macroFpsInput) {
        macroFpsInput.value = localStorage.getItem("FPS") || "120";
        macroFpsInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") saveMacroFps();
        });
    }

    // Bind Db Unlocker Buttons
    const dbSaveUnlockerBtn = document.getElementById("db_saveUnlockerBtn");
    if (dbSaveUnlockerBtn) dbSaveUnlockerBtn.addEventListener("click", saveDbUnlockerConfig);

    const dbSaveGamePathBtn = document.getElementById("db_saveGamePathBtn");
    if (dbSaveGamePathBtn) dbSaveGamePathBtn.addEventListener("click", () => saveDbGamePath(false));

    const dbBrowseGameBtn = document.getElementById("db_browseGameBtn");
    const dbGamePathInputFile = document.getElementById("db_GamePathInput");
    const dbGamePathText = document.getElementById("db_GamePath");

    if (dbGamePathText) {
        dbGamePathText.addEventListener("input", () => {
            updateGamePathBadge(dbGamePathText.value.trim());
        });
        dbGamePathText.addEventListener("keypress", (e) => {
            if (e.key === "Enter") saveDbGamePath(false);
        });
    }

    if (dbBrowseGameBtn) {
        dbBrowseGameBtn.addEventListener("click", async () => {
            let selectedPath = null;

            // 1. Electron Native IPC dialog
            if (window.unlockerNative && typeof window.unlockerNative.selectGamePath === "function") {
                try {
                    selectedPath = await window.unlockerNative.selectGamePath();
                } catch (e) {
                    console.error("Lỗi chọn file native:", e);
                }
            } 
            // 2. Python backend HTTP browse
            else {
                try {
                    const res = await fetch("http://localhost:5000/browse-game-path", { method: "POST" });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.ok && data.path) {
                            selectedPath = data.path;
                        }
                    }
                } catch (e) {
                    console.error("Lỗi mở duyệt file backend:", e);
                }

                // 3. Fallback html file input (trình duyệt không kết nối backend)
                if (!selectedPath && dbGamePathInputFile) {
                    dbGamePathInputFile.click();
                    return;
                }
            }

            if (selectedPath) {
                if (dbGamePathText) dbGamePathText.value = selectedPath;
                currentUnlockerConfig.GamePath = selectedPath;
                updateGamePathBadge(selectedPath);
                saveDbGamePath(true);
            }
        });
    }

    if (dbGamePathInputFile) {
        dbGamePathInputFile.addEventListener("change", (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                const selectedPath = file.path || file.name;
                if (selectedPath && dbGamePathText) {
                    dbGamePathText.value = selectedPath;
                    currentUnlockerConfig.GamePath = selectedPath;
                    updateGamePathBadge(selectedPath);
                    saveDbGamePath(true);
                }
            }
        });
    }

    loadDbUnlockerConfig();
    loadAndRenderBoundCombos();
    checkMacroStatus();
    setInterval(checkMacroStatus, 3000); // Tăng từ 1500ms để giảm tải máy Win10 chậm
});

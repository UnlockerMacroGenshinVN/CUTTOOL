// ── shared.js ─────────────────────────────────────────────────────────────────
// Dùng chung cho tất cả tab: SPA tab router + quản lý trạng thái RUN MACRO + START GAME
// ─────────────────────────────────────────────────────────────────────────────

// Xóa toàn bộ cài đặt cũ lưu trong localStorage từ chế độ dev khi lên bản 1.1.3
try {
    if (!localStorage.getItem("clean_state_v1_1_3")) {
        localStorage.clear();
        localStorage.setItem("clean_state_v1_1_3", "1");
    }
} catch {}

const BUILTIN_COMBOS = [
    "C0:  Combo Skirk C0 EQA 120fps",
    "C0:  Combo Skirk C0 EA 120fps",
    "C0:  Combo Skirk C0 EQA 60fps",
    "C0:  Combo Mavuika CDCDCF (Full Combo)",
    // Lay tu GI-Macro-Manager (github.com/3azf55/GI-Macro-Manager, MIT)
    "C0:  Combo Arlecchino Overload N2W (GI)"
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

// ── Global Browser Navigation Blocker (mouse 3/4) ────────────────────────────
;['mousedown', 'mouseup', 'click', 'auxclick'].forEach(eventType => {
    window.addEventListener(eventType, (e) => {
        if (e.button === 3 || e.button === 4) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);
});
window.addEventListener('keydown', (e) => {
    if (e.key === 'BrowserBack' || e.key === 'BrowserForward') {
        e.preventDefault();
    }
}, true);

// ── Instant SPA Tab Router (0ms tab switch, zero page reload) ────────────────
window.activeTab = 'home';

const NAV_ACTIVE_CLASS = 'flex items-center gap-3 px-4 py-3 bg-surface-container-high text-teal border-l-4 border-teal font-label-sm rounded-r-DEFAULT cursor-pointer active:scale-[0.98]';
const NAV_INACTIVE_CLASS = 'flex items-center gap-3 px-4 py-3 text-on-surface-variant hover:bg-surface-container-low transition-colors duration-200 font-label-sm border-l-4 border-transparent rounded-r-DEFAULT cursor-pointer active:scale-[0.98]';

function switchTab(tabName, updateHash = true) {
    if (!['home', 'macros', 'settings'].includes(tabName)) {
        tabName = 'home';
    }
    if (window.activeTab === tabName && document.getElementById(`view-${tabName}`) && !document.getElementById(`view-${tabName}`).classList.contains('hidden')) {
        return;
    }

    // Đóng các modal bắt phím nếu đang mở khi chuyển sang tab khác
    if (tabName !== 'macros' && typeof closeKeyBindModal === 'function') {
        closeKeyBindModal();
    }
    if (tabName !== 'settings' && typeof closeNetworkKeyBindModal === 'function') {
        closeNetworkKeyBindModal();
    }

    window.activeTab = tabName;

    const views = {
        home: document.getElementById('view-home'),
        macros: document.getElementById('view-macros'),
        settings: document.getElementById('view-settings')
    };

    const navs = {
        home: document.getElementById('nav-home'),
        macros: document.getElementById('nav-macros'),
        settings: document.getElementById('nav-settings')
    };

    const titles = {
        home: 'Trang chính - Cứt tool',
        macros: 'Macros - Cứt tool',
        settings: 'Tùy chỉnh - Cứt tool'
    };

    Object.keys(views).forEach((key) => {
        if (views[key]) {
            views[key].classList.toggle('hidden', key !== tabName);
        }
        if (navs[key]) {
            navs[key].className = (key === tabName) ? NAV_ACTIVE_CLASS : NAV_INACTIVE_CLASS;
        }
    });

    document.title = titles[tabName] || 'Cứt tool';
    if (updateHash && window.location.hash !== `#${tabName}`) {
        history.replaceState(null, '', `#${tabName}`);
    }
    window.scrollTo(0, 0);

    // Đồng bộ giao diện ngay lập tức từ bộ nhớ mà không cần reload
    if (tabName === 'home') {
        if (typeof renderBoundCombosFromMemory === 'function') renderBoundCombosFromMemory();
        if (typeof syncDbUnlockerInputsFromMemory === 'function') syncDbUnlockerInputsFromMemory();
    } else if (tabName === 'macros') {
        if (typeof renderCombosFromConfig === 'function') renderCombosFromConfig();
    } else if (tabName === 'settings') {
        if (typeof updateUIFromConfig === 'function') updateUIFromConfig();
    }
}

window.switchTab = switchTab;

// ── State keys ───────────────────────────────────────────────────────────────
const STATE_RUN = 'macro_run_active';

function getRunActive() { return localStorage.getItem(STATE_RUN) === '1'; }
function setRunActive(v) { localStorage.setItem(STATE_RUN, v ? '1' : '0'); }

// ── Apply visual state to buttons ────────────────────────────────────────────
function applyRunState(active) {
    const btn   = document.getElementById('runBtn');
    const label = document.getElementById('runBtnLabel');
    if (!btn) return;
    btn.classList.toggle('run-active', active);
    if (label) label.textContent = active ? 'STOP Macro' : 'RUN Macro';
}

function applyStartState() {
    const btn   = document.getElementById('startBtn');
    const label = document.getElementById('startBtnLabel');
    if (!btn) return;
    btn.classList.remove('start-active');
    if (label) label.textContent = 'START Game';
}

// ── Toast notification helper (dùng chung nếu không có trang cung cấp) ───────
function _showToastFallback(message, isError = false) {
    let toast = document.getElementById('_sharedToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = '_sharedToast';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:14px 20px;border-radius:12px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:500;transition:all 0.25s;transform:translateY(40px);opacity:0;border:1px solid;max-width:420px;line-height:1.4;';
        document.body.appendChild(toast);
    }
    if (isError) {
        toast.style.background = 'rgba(69,10,10,0.95)';
        toast.style.color = '#fca5a5';
        toast.style.borderColor = 'rgba(239,68,68,0.5)';
        toast.innerHTML = `<span style="font-size:18px">⚠️</span><span style="white-space:pre-wrap">${message}</span>`;
    } else {
        toast.style.background = 'rgba(15,118,110,0.95)';
        toast.style.color = '#99f6e4';
        toast.style.borderColor = 'rgba(45,212,191,0.5)';
        toast.innerHTML = `<span style="font-size:18px">✅</span><span>${message}</span>`;
    }
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
        toast.style.transform = 'translateY(40px)';
        toast.style.opacity = '0';
    }, isError ? 5000 : 3000);
}

function _notify(message, isError = false) {
    if (typeof showToast === 'function') {
        showToast(message, isError);
    } else {
        _showToastFallback(message, isError);
    }
}

// ── Toggle handlers ───────────────────────────────────────────────────────────
async function toggleRun() {
    const next = !getRunActive();
    setRunActive(next);
    applyRunState(next);
    try {
        await fetch('http://localhost:5000/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: next })
        });
    } catch {}

    if (typeof checkMacroStatus === 'function') {
        checkMacroStatus();
    }
}

async function handleLaunchGame() {
    let result = null;
    try {
        if (window.unlockerNative && typeof window.unlockerNative.launchGame === 'function') {
            result = await window.unlockerNative.launchGame();
        } else {
            const res = await fetch('http://localhost:5000/launch-game', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            result = await res.json();
        }
    } catch (err) {
        console.error('handleLaunchGame error:', err);
        _notify('Lỗi khi kết nối tới backend để khởi động game!', true);
        return;
    }

    if (!result || !result.ok) {
        const errMsg = (result && (result.error || result.message)) || 'Lỗi không xác định khi khởi chạy game!';
        _notify(errMsg, true);
        return;
    }

    _notify(result.message || 'Khởi động game thành công!');
}

// ── Đồng bộ trạng thái RUN xuống backend ─────────────────────────────────────
async function syncRunStateToBackend(active, retries = 20, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch('http://localhost:5000/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: active })
            });
            if (res.ok) {
                if (typeof checkMacroStatus === 'function') checkMacroStatus();
                return true;
            }
        } catch {}
        await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
}

// ── Frontend Heartbeat ─────────────────────────────────────────────────
let _heartbeatInFlight = false;
function startFrontendHeartbeat() {
    const sendPing = () => {
        if (_heartbeatInFlight) return;
        _heartbeatInFlight = true;
        fetch('http://localhost:5000/heartbeat', { method: 'POST' })
            .catch(() => {})
            .finally(() => { _heartbeatInFlight = false; });
    };
    sendPing();
    setInterval(sendPing, 5000);
}

// ── Init on DOM ready ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const runBtn   = document.getElementById('runBtn');
    const startBtn = document.getElementById('startBtn');

    const runActive = getRunActive();
    applyRunState(runActive);
    applyStartState();
    syncRunStateToBackend(runActive);

    if (runBtn)   runBtn.addEventListener('click', toggleRun);
    if (startBtn) startBtn.addEventListener('click', handleLaunchGame);

    // Gắn sự kiện chuyển tab tức thì cho sidebar
    document.querySelectorAll('[data-tab]').forEach((link) => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = link.getAttribute('data-tab');
            switchTab(targetTab);
        });
    });

    // Khôi phục tab từ URL hash nếu có (#macros, #settings)
    const initialHash = (window.location.hash || '').replace('#', '');
    if (['home', 'macros', 'settings'].includes(initialHash)) {
        switchTab(initialHash, false);
    }

    window.addEventListener('hashchange', () => {
        const h = (window.location.hash || '').replace('#', '');
        if (['home', 'macros', 'settings'].includes(h)) {
            switchTab(h, false);
        }
    });

    startFrontendHeartbeat();
});

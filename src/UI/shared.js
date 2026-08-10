// ── shared.js ─────────────────────────────────────────────────────────────────
// Dùng chung cho tất cả trang: quản lý trạng thái RUN MACRO + START GAME
// ─────────────────────────────────────────────────────────────────────────────

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
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:14px 20px;border-radius:12px;display:flex;align-items:center;gap:10px;font-size:13px;font-weight:500;backdrop-filter:blur(12px);transition:all 0.3s;transform:translateY(40px);opacity:0;border:1px solid;max-width:420px;line-height:1.4;';
        document.body.appendChild(toast);
    }
    if (isError) {
        toast.style.background = 'rgba(69,10,10,0.92)';
        toast.style.color = '#fca5a5';
        toast.style.borderColor = 'rgba(239,68,68,0.5)';
        toast.innerHTML = `<span style="font-size:18px">⚠️</span><span style="white-space:pre-wrap">${message}</span>`;
    } else {
        toast.style.background = 'rgba(15,118,110,0.92)';
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

// ── Frontend Heartbeat ─────────────────────────────────────────────────
function startFrontendHeartbeat() {
    const sendPing = () => {
        fetch('http://localhost:5000/heartbeat', { method: 'POST' }).catch(() => {});
    };
    sendPing();
    // Tăng từ 1500ms → 3000ms: giảm tải CPU trên máy Win10 chậm
    // Backend timeout cũng được tăng 6s → 15s nên vẫn an toàn
    setInterval(sendPing, 3000);
}

// ── Init on DOM ready ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const runBtn   = document.getElementById('runBtn');
    const startBtn = document.getElementById('startBtn');

    applyRunState(getRunActive());
    applyStartState();

    if (runBtn)   runBtn.addEventListener('click', toggleRun);
    if (startBtn) startBtn.addEventListener('click', handleLaunchGame);

    startFrontendHeartbeat();
});

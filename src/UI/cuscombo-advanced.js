/*
 * Timeline nhiều track kiểu Premiere.
 *
 * Mỗi clip là một lần giữ phím / nút chuột: bắt đầu ở `start` ms, giữ trong
 * `dur` ms, nằm trên track `track`. Clip chồng nhau theo chiều dọc = bấm cùng
 * lúc, nên giữ chuột 500 ms rồi chen phím vào giữa chỉ là đặt clip phím lên
 * track khác trong khoảng đó.
 *   { id, kind: "key",   key: "q",        track, start, dur }
 *   { id, kind: "mouse", button: "left",  track, start, dur }
 *   { id, kind: "block", fn: "skke",      track, start, dur }   khối Skirk, dur cố định theo FPS
 * Vùng lặp `loop = {start, end}`: đoạn đó chạy lại mãi tới khi nhả hotkey.
 *
 * Khi lưu, clip được biên dịch ra danh sách bước phẳng (key_down / key_up /
 * mouse_down / mouse_up / wait / loop_start / loop_end) mà backend
 * (runtime.build_custom_combo_fn) vẫn hiểu, nên backend không phải đổi.
 * Combo cũ chỉ có danh sách bước thì được dựng ngược lại thành clip khi mở.
 */
const STEP_TYPES = Object.freeze({
    key_down:    { kind: "key",   press: true },
    key_up:      { kind: "key",   press: false },
    key_tap:     { kind: "key",   tap: true },
    mouse_down:  { kind: "mouse", press: true },
    mouse_up:    { kind: "mouse", press: false },
    mouse_click: { kind: "mouse", tap: true },
    wait:        { kind: "wait" },
    loop_start:  { kind: "marker", start: true },
    loop_end:    { kind: "marker", start: false }
});

const MOUSE_BUTTONS = Object.freeze([
    { value: "left",    label: "Chuột trái",           short: "LC" },
    { value: "right",   label: "Chuột phải",           short: "RC" },
    { value: "middle",  label: "Chuột giữa",           short: "MC" },
    { value: "mouse_3", label: "Chuột phụ 1 (mouse_3)", short: "M3" },
    { value: "mouse_4", label: "Chuột phụ 2 (mouse_4)", short: "M4" }
]);

/* Khối dựng sẵn của Skirk: chỉ chèn khi người dùng chủ động mở "Khối Skirk". */
const SKIRK_ACTIONS = Object.freeze([
    { label: "E", pythonFunction: "skke" },
    { label: "n2", pythonFunction: "skk2a" },
    { label: "n2d", pythonFunction: "skk2as" },
    { label: "n2c", pythonFunction: "skk2az" },
    { label: "n2cd", pythonFunction: "skk2azs" },
    { label: "n2cd_slow", pythonFunction: "skk2azs_slow" },
    { label: "n2q", pythonFunction: "skk2aq" },
    { label: "n3d", pythonFunction: "skk3as" },
    { label: "n3w", pythonFunction: "skk3aw" },
    { label: "n5d", pythonFunction: "skk5as" },
    { label: "n5", pythonFunction: "skk5a" }
]);

/* Đã bỏ khỏi bảng chèn nhưng giữ để combo cũ đã lưu không mất khối khi mở lại. */
const LEGACY_ACTIONS = Object.freeze([
    { label: "mav_cdcdcf", pythonFunction: "mav_cdcdcf" },
    { label: "D (nhịp)", pythonFunction: "mav_b_d" },
    { label: "C giữ", pythonFunction: "mav_c_hold" },
    { label: "C nhả", pythonFunction: "mav_c_rel" },
    { label: "D", pythonFunction: "mav_d" },
    { label: "Q", pythonFunction: "mav_q" },
    { label: "Click", pythonFunction: "mav_b_click" },
    { label: "Click x2", pythonFunction: "mav_b_click2" },
    { label: "C tap", pythonFunction: "mav_b_c" },
    { label: "CD", pythonFunction: "mav_b_cd" },
    { label: "CDF", pythonFunction: "mav_b_cdf" },
    { label: "Q + chờ", pythonFunction: "mav_b_q" },
    { label: "50ms", pythonFunction: "wait_50" },
    { label: "100ms", pythonFunction: "wait_100" },
    { label: "150ms", pythonFunction: "wait_150" },
    { label: "200ms", pythonFunction: "wait_200" },
    { label: "300ms", pythonFunction: "wait_300" },
    { label: "500ms", pythonFunction: "wait_500" },
    { label: "1000ms", pythonFunction: "wait_1000" }
]);

const ACTION_BY_FUNCTION = new Map(
    SKIRK_ACTIONS.concat(LEGACY_ACTIONS).map((action) => [action.pythonFunction, action])
);

const CUSTOM_COMBOS_STORAGE = "customCombos";
const SIGN_KEYS_STORAGE = "comboSignKeys";
const FPS_STORAGE = "FPS";
const CLIPBOARD_STORAGE = "comboClipboard";
const ZOOM_STORAGE = "comboTimelineZoom";

const HISTORY_LIMIT = 100;
const DEFAULT_CLIP_MS = 100;
const DEFAULT_BLOCK_MS = 300;   // chỉ cho khối cũ không có bảng thời lượng (mav_* đã bỏ)

/* Thời lượng khối Skirk: chép từ macros.py + fps_utils.py (bảng FPS nội suy tuyến tính).
 * Khối chạy chặn đúng chừng này rồi mới sang bước sau, nên trên timeline không cho chỉnh. */
const FPS_TABLES = Object.freeze({
    T_3AW:        [[30, 60, 100, 120, 220], [1.5, 1.366, 1.34, 1.32, 1.285]],
    T_2AS_FIRST:  [[60, 120, 220], [0.44, 0.40, 0.37]],
    T_2AS_SECOND: [[60, 120, 220], [0.63, 0.57, 0.56]],
    T_2AZ_FIRST:  [[60, 120, 220], [0.24, 0.22, 0.20]],
    T_2AZ_END:    [[60, 120, 220], [1.16, 1.12, 1.09]],
    T_2AZS_END:   [[60, 120, 220], [0.90, 0.86, 0.82]],
    T_2AQ_END:    [[60, 120, 220], [1.17, 1.09, 1.07]],
    T_5A:         [[60, 120, 220], [2.22, 2.14, 2.12]],
    T_5AS_END:    [[60, 120, 220], [2.41, 2.28, 2.24]],
    F_3AS:        [[60, 120, 144, 240], [18, 20, 22, 24]]
});

function fps2t([fpsValues, values], fps) {
    if (fps >= fpsValues[fpsValues.length - 1]) return values[values.length - 1];
    if (fps <= fpsValues[0]) return values[0];
    let i = 0;
    while (i < fpsValues.length - 2 && fps >= fpsValues[i + 1]) i += 1;
    const w = (fps - fpsValues[i]) / (fpsValues[i + 1] - fpsValues[i]);
    return values[i] + (values[i + 1] - values[i]) * w;
}

// Vòng spam click: `count` lượt, mỗi lượt `step` giây, thoát sớm khi đã quá `limit` giây.
// Chạm đúng mốc cũng tính là quá: wait_exact luôn lố vài µs nên Python thoát ngay tại đó.
function spamTime(count, step, limit) {
    for (let k = 1; k <= count; k += 1) {
        if (k * step >= limit - 1e-9) return k * step;
    }
    return count * step;
}

// Thời lượng (giây) mỗi khối ở `fps`, bám theo đúng các mốc wait_exact trong macros.py.
const BLOCK_SECONDS = Object.freeze({
    skke: (fps) => spamTime(Math.floor(0.1 * fps), 2 / fps, 0.1) + 0.19,
    skk2a: (fps) => Math.max(spamTime(Math.floor(0.26 * fps), 2 / fps, 0.32), fps2t(FPS_TABLES.T_2AS_FIRST, fps)),
    skk2as: (fps) => Math.max(fps2t(FPS_TABLES.T_2AS_FIRST, fps) + 3 / fps, fps2t(FPS_TABLES.T_2AS_SECOND, fps)),
    skk2az: (fps) => Math.max(fps2t(FPS_TABLES.T_2AZ_FIRST, fps) + 2 / fps + 0.44, fps2t(FPS_TABLES.T_2AZ_END, fps)),
    skk2azs: (fps) => Math.max(fps2t(FPS_TABLES.T_2AZ_FIRST, fps) + 2 / fps + 0.44 + 5 / fps, fps2t(FPS_TABLES.T_2AZS_END, fps)),
    skk2azs_slow: (fps) => (fps < 105 ? BLOCK_SECONDS.skk2azs(fps) : 0.87),
    skk2aq: (fps) => fps2t(FPS_TABLES.T_2AQ_END, fps),
    skk3as: (fps) => spamTime(Math.floor(0.6 * fps), 3 / fps, 0.6) + fps2t(FPS_TABLES.F_3AS, fps) / fps,
    skk3aw: (fps) => fps2t(FPS_TABLES.T_3AW, fps) + 1 / fps,
    skk5as: (fps) => fps2t(FPS_TABLES.T_5AS_END, fps) + 2 / fps,
    skk5a: (fps) => fps2t(FPS_TABLES.T_5A, fps) + 2 / fps
});

function currentFps() {
    const fps = Number(localStorage.getItem("FPS"));
    return fps > 0 ? fps : 120;
}

// ms cố định của khối, hoặc null nếu khối không có bảng (giữ nguyên dur đã lưu).
function blockDurationMs(fn, fps = currentFps()) {
    if (/^wait_\d+$/.test(fn)) return Number(fn.slice(5));
    const seconds = BLOCK_SECONDS[fn];
    return seconds ? Math.max(1, Math.round(seconds(fps) * 1000)) : null;
}

// FPS có thể đã đổi ở trang khác: đồng bộ lại độ dài mọi khối trước khi vẽ.
function syncBlockDurations() {
    state.clips.forEach((clip) => {
        if (clip.kind !== "block") return;
        const ms = blockDurationMs(clip.fn);
        if (ms !== null) clip.dur = ms;
    });
}
const MAX_MS = 600000;
const MIN_TRACKS = 4;
// Kích thước hình học của timeline, khớp với cuscombo.css.
const HEAD_W = 58;
const RULER_H = 28;
const TRACK_H = 38;
const EDGE_PX = 6;       // vùng nắm mép clip để co giãn
const SNAP_PX = 8;       // khoảng cách hít vào mép clip / đầu phát
const ZOOM_MIN = 0.02;   // px mỗi ms
const ZOOM_MAX = 6;
const DEFAULT_ZOOM = 0.5;
const DRAG_THRESHOLD = 3;

// Icon đơn sắc (stroke), chỉ là hằng nội bộ nên dùng innerHTML an toàn.
const ICONS = Object.freeze({
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    paste: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2M9 12h6M9 16h6"/>',
    dup: '<rect x="3" y="7" width="11" height="11" rx="2"/><rect x="10" y="4" width="11" height="11" rx="2"/>',
    razor: '<path d="M12 2v20"/><path d="M5 8h4M15 8h4M5 16h4M15 16h4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
    clear: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="m10 11 4 6m0-6-4 6"/>',
    record: '<circle cx="12" cy="12" r="6"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
    play: '<path d="M7 4v16l13-8z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/>',
    key: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M8 12h5M13 9l3 3-3 3"/>',
    mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 3v7M6 10h12"/>',
    block: '<path d="M12 3 4 8v8l8 5 8-5V8z"/><path d="M4 8l8 5 8-5M12 13v8"/>',
    loopIn: '<path d="M6 4v16M6 4h5M6 20h5"/><path d="M14 12h7"/>',
    loopOut: '<path d="M18 4v16M18 4h-5M18 20h-5"/><path d="M3 12h7"/>',
    loopOff: '<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M4 20 20 4"/>',
    magnet: '<path d="M6 3v8a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/>',
    zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6M11 8v6"/>',
    zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M8 11h6"/>',
    fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    gap: '<path d="M4 4v16M20 4v16"/><path d="M8 12h8M8 12l3-3M8 12l3 3M16 12l-3-3M16 12l-3 3"/>',
    track: '<path d="M4 6h16M4 12h16M4 18h9"/><path d="M18 15v6M15 18h6"/>',
    io: '<path d="M7 3v14M3 7l4-4 4 4"/><path d="M17 21V7M13 17l4 4 4-4"/>'
});

const state = {
    comboId: createId(),
    clips: [],
    tracks: MIN_TRACKS,
    loop: null,
    playhead: 0,
    zoom: DEFAULT_ZOOM,
    snap: true,
    activeTrack: 0,
    hotkey: null,
    selected: new Set(),
    clipboard: null,
    undo: [],
    redo: [],
    pointer: null,
    recording: null,
    playing: null,
    capturing: null,     // bắt phím cho clip: { clip, chord, finish }
    capturingHotkey: false,
    inspected: null,
    inspectorInputs: null
};

const elements = {};
const toolButtons = {};

// ── Tiện ích chung ──────────────────────────────────────────────────────────
function clampMs(value) {
    return Math.min(Math.max(Math.round(Number(value) || 0), 0), MAX_MS);
}

function clipEnd(clip) {
    return clip.start + clip.dur;
}

function clipById(id) {
    return state.clips.find((clip) => clip.id === id) ?? null;
}

function mouseLabel(button, short) {
    const entry = MOUSE_BUTTONS.find((b) => b.value === button);
    if (!entry) return String(button);
    return short ? entry.short : entry.label;
}

// Hai clip cùng một phím / nút thật (để phát hiện giữ chồng lên nhau).
function clipTarget(clip) {
    if (clip.kind === "key") return clip.key ? `key:${clip.key}` : null;
    if (clip.kind === "mouse") return `mouse:${clip.button}`;
    return null;
}

function clipName(clip) {
    if (clip.kind === "key") return clip.key ? hotkeyLabel(clip.key) : "?";
    if (clip.kind === "mouse") return mouseLabel(clip.button);
    return `Khối ${ACTION_BY_FUNCTION.get(clip.fn)?.label ?? clip.fn}`;
}

// Nhãn ngắn dùng trong ô clip trên timeline, tránh bị cắt chữ khi ô hẹp.
function clipShortName(clip) {
    if (clip.kind === "mouse") return mouseLabel(clip.button, true);
    return clipName(clip);
}

function formatMs(ms) {
    return `${Math.round(ms)} ms`;
}

function contentEnd() {
    let end = 0;
    state.clips.forEach((clip) => { end = Math.max(end, clipEnd(clip)); });
    if (state.loop) end = Math.max(end, state.loop.end);
    return end;
}

function trackCount() {
    const used = state.clips.reduce((max, clip) => Math.max(max, clip.track + 1), 0);
    return Math.max(state.tracks, used, MIN_TRACKS);
}

function overlaps(a, b) {
    return a.start < clipEnd(b) && b.start < clipEnd(a);
}

// Track trống đầu tiên (từ `from` trở xuống) chứa được [start, start+dur).
function freeTrack(start, dur, from = 0, ignore = new Set()) {
    const probe = { start, dur };
    for (let track = Math.max(from, 0); ; track += 1) {
        const busy = state.clips.some((clip) => clip.track === track && !ignore.has(clip.id) && overlaps(clip, probe));
        if (!busy) return track;
    }
}

// ── Global Browser Navigation Blocker (mouse 3/4) ─────────────────────────────
['mousedown', 'mouseup', 'click', 'auxclick'].forEach(eventType => {
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

document.addEventListener("DOMContentLoaded", () => {
    Object.assign(elements, {
        toolbar: document.getElementById("toolbar"),
        addBar: document.getElementById("addBar"),
        blockPanel: document.getElementById("blockPanel"),
        nle: document.getElementById("nle"),
        scroll: document.getElementById("nleScroll"),
        inner: document.getElementById("nleInner"),
        statusBar: document.getElementById("statusBar"),
        timelineCount: document.getElementById("timelineCount"),
        inspector: document.getElementById("inspector"),
        comboName: document.getElementById("comboName"),
        hotkeyCapture: document.getElementById("hotkeyCapture"),
        clearHotkey: document.getElementById("clearHotkey"),
        pythonPreview: document.getElementById("pythonPreview"),
        saveButton: document.getElementById("saveCombo"),
        ioModalButton: document.getElementById("ioModalButton"),
        newComboButton: document.getElementById("newComboButton"),
        basicModeButton: document.getElementById("basicModeButton"),
        savedCount: document.getElementById("savedCount"),
        saveStatus: document.getElementById("saveStatus"),
        ioModal: document.getElementById("ioModal"),
        ioCloseButton: document.getElementById("ioCloseButton"),
        ioCancelButton: document.getElementById("ioCancelButton"),
        ioImportMode: document.getElementById("ioImportMode"),
        ioDefaultTapMs: document.getElementById("ioDefaultTapMs"),
        ioFileInput: document.getElementById("ioFileInput"),
        ioLoadFileButton: document.getElementById("ioLoadFileButton"),
        ioDownloadButton: document.getElementById("ioDownloadButton"),
        ioRefreshExportButton: document.getElementById("ioRefreshExportButton"),
        ioCopyButton: document.getElementById("ioCopyButton"),
        ioTextarea: document.getElementById("ioTextarea"),
        ioValidationBox: document.getElementById("ioValidationBox"),
        ioImportButton: document.getElementById("ioImportButton")
    });

    const savedZoom = Number(loadJsonStorage(ZOOM_STORAGE, DEFAULT_ZOOM));
    if (savedZoom >= ZOOM_MIN && savedZoom <= ZOOM_MAX) state.zoom = savedZoom;

    buildToolbar();
    buildAddBar();
    buildBlockPanel();
    render();
    updateHotkeyUI();
    updateSavedCount();
    bindEvents();

    // ── Restore draft when switching from Basic mode or load combo from config if URL has ?edit=<id> ──
    let restoredDraft = false;
    let shouldOpenIo = false;
    try {
        const rawDraft = sessionStorage.getItem("cuscombo_draft");
        if (rawDraft) {
            sessionStorage.removeItem("cuscombo_draft");
            const draft = JSON.parse(rawDraft);
            if (draft && typeof draft === "object") {
                state.comboId = draft.comboId || state.comboId;
                state.hotkey = draft.hotkey || null;
                if (Array.isArray(draft.clips) && draft.clips.length > 0) {
                    state.clips = draft.clips
                        .filter((clip) => ["key", "mouse", "block"].includes(clip?.kind))
                        .map((clip) => ({ ...makeClip(clip), id: clip.id || createId() }));
                    state.loop = draft.loop && draft.loop.end > draft.loop.start ? { start: draft.loop.start, end: draft.loop.end } : null;
                } else if (Array.isArray(draft.timeline) && draft.timeline.length > 0) {
                    const built = stepsToClips(draft.timeline);
                    state.clips = built.clips;
                    state.loop = built.loop;
                }
                shouldOpenIo = Boolean(draft.openIoModal);
                resetHistory();
                clearSelection();
                elements.comboName.value = draft.name || "";
                updateHotkeyUI();
                render();
                if (state.clips.length > 0) zoomToFit();
                restoredDraft = true;
            }
        }
    } catch {}

    const params = new URLSearchParams(window.location.search);
    const editId = params.get("edit");
    if (!restoredDraft && editId) {
        loadComboForEdit(editId);
    }
    if (shouldOpenIo || params.get("io") === "1") {
        openIoModal();
    }
});

function bindEvents() {
    elements.inner.addEventListener("pointerdown", onPointerDown);
    elements.inner.addEventListener("pointermove", onPointerMove);
    elements.inner.addEventListener("pointerup", onPointerUp);
    elements.inner.addEventListener("pointercancel", onPointerUp);
    elements.inner.addEventListener("dblclick", onDoubleClick);
    elements.inner.addEventListener("contextmenu", (event) => event.preventDefault());
    elements.scroll.addEventListener("wheel", onWheel, { passive: false });
    // Cột tên track dính mép trái, thước dính mép trên khi cuộn.
    elements.scroll.addEventListener("scroll", syncStickyOffsets, { passive: true });

    elements.hotkeyCapture.addEventListener("click", startHotkeyCapture);
    elements.clearHotkey.addEventListener("click", clearHotkey);
    if (elements.ioModalButton) {
        elements.ioModalButton.addEventListener("click", openIoModal);
    }
    if (elements.newComboButton) {
        elements.newComboButton.addEventListener("click", createNewCombo);
    }
    if (elements.basicModeButton) {
        elements.basicModeButton.addEventListener("click", openBasicMode);
    }
    elements.saveButton.addEventListener("click", saveCombo);
    bindIoModalEvents();

    // Ctrl+V: ưu tiên clipboard hệ thống (dán JSON hoặc chuỗi lệnh import.md), không có thì dùng bản copy trong trình tạo.
    window.addEventListener("paste", (event) => {
        if (isBusy() || isTextField(event)) return;
        event.preventDefault();
        pasteClipboard(event.clipboardData?.getData("text/plain") ?? "");
    });

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", () => renderTimeline());
}

function isIoModalOpen() {
    return Boolean(elements.ioModal && !elements.ioModal.hidden);
}

function isBusy() {
    return Boolean(state.capturingHotkey || state.capturing || state.recording || isIoModalOpen());
}

function onKeyDown(event) {
    if (isIoModalOpen()) {
        if (event.key === "Escape") {
            event.preventDefault();
            closeIoModal();
        }
        return;
    }
    if (isBusy()) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && !event.altKey && !isTextField(event)) {
        const actions = {
            c: () => copySelection(),
            x: () => copySelection(true),
            a: selectAll,
            z: undo,
            y: redo,
            d: duplicateSelection,
            s: saveCombo
        };
        if (actions[key]) {
            event.preventDefault();
            actions[key]();
        }
        return;
    }
    if (mod || event.altKey || isTypingInControl(event)) return;

    if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        removeSelected();
    } else if (event.key === " ") {
        event.preventDefault();
        togglePlay();
    } else if (key === "c") {
        splitAtPlayhead();
    } else if (key === "i") {
        setLoopEdge("start");
    } else if (key === "o") {
        setLoopEdge("end");
    } else if (event.key === "Home") {
        setPlayhead(0, true);
    } else if (event.key === "End") {
        setPlayhead(contentEnd(), true);
    } else if (event.key === "+" || event.key === "=") {
        zoomBy(1.25);
    } else if (event.key === "-") {
        zoomBy(0.8);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 10 : 1);
        if (state.selected.size) nudgeSelection(delta);
        else setPlayhead(state.playhead + delta, true);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (!state.selected.size) return;
        event.preventDefault();
        moveSelectionTrack(event.key === "ArrowUp" ? -1 : 1);
    } else if (event.key === "Escape") {
        clearSelection();
        render();
    }
}

// ── Thanh công cụ ───────────────────────────────────────────────────────────
function svgIcon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function buildToolbar() {
    const items = [
        { id: "undo", icon: "undo", title: "Hoàn tác (Ctrl+Z)", run: undo },
        { id: "redo", icon: "redo", title: "Làm lại (Ctrl+Y)", run: redo },
        "sep",
        { id: "save", icon: "save", title: "Lưu combo (Ctrl+S)", run: saveCombo },
        { id: "io", icon: "io", title: "Import / Export chuỗi lệnh Macro (import.md)", run: openIoModal },
        "sep",
        { id: "cut", icon: "cut", title: "Cắt (Ctrl+X)", run: () => copySelection(true) },
        { id: "copy", icon: "copy", title: "Copy (Ctrl+C)", run: () => copySelection() },
        { id: "paste", icon: "paste", title: "Dán tại đầu phát (Ctrl+V)", run: () => pasteClipboard() },
        { id: "dup", icon: "dup", title: "Nhân đôi, đặt ngay sau (Ctrl+D)", run: duplicateSelection },
        "sep",
        { id: "razor", icon: "razor", title: "Cắt đôi clip tại đầu phát (C)", run: splitAtPlayhead },
        { id: "delete", icon: "trash", title: "Xóa clip đã chọn (Delete)", run: removeSelected },
        { id: "clear", icon: "clear", title: "Xóa hết timeline", run: clearAll },
        "sep",
        { id: "loopIn", icon: "loopIn", title: "Đặt đầu vùng lặp tại đầu phát (I)", run: () => setLoopEdge("start") },
        { id: "loopOut", icon: "loopOut", title: "Đặt cuối vùng lặp tại đầu phát (O)", run: () => setLoopEdge("end") },
        { id: "loopOff", icon: "loopOff", title: "Bỏ vùng lặp", run: clearLoop },
        "sep",
        { id: "play", icon: "play", title: "Xem thử đầu phát chạy (Space)", run: togglePlay },
        { id: "record", icon: "record", title: "Ghi: bấm rồi thao tác bàn phím / chuột trong cửa sổ này, clip được đặt từ đầu phát", run: toggleRecording },
        "sep",
        { id: "snap", icon: "magnet", title: "Hít vào mép clip / đầu phát khi kéo (giữ Alt để tạm tắt)", run: toggleSnap },
        { id: "zoomOut", icon: "zoomOut", title: "Thu nhỏ (-)", run: () => zoomBy(0.8) },
        { id: "zoomIn", icon: "zoomIn", title: "Phóng to (+)", run: () => zoomBy(1.25) },
        { id: "fit", icon: "fit", title: "Vừa khung", run: zoomToFit }
    ];

    items.forEach((entry) => {
        if (entry === "sep") {
            const sep = document.createElement("span");
            sep.className = "tool-sep";
            elements.toolbar.appendChild(sep);
            return;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.id = `${entry.id}Btn`;
        button.className = `tool-btn ${entry.id}`;
        button.title = entry.title;
        button.setAttribute("aria-label", entry.title);
        button.innerHTML = svgIcon(entry.icon);
        button.addEventListener("click", entry.run);
        elements.toolbar.appendChild(button);
        toolButtons[entry.id] = button;
    });

    const zoomLabel = document.createElement("span");
    zoomLabel.id = "zoomLabel";
    zoomLabel.className = "zoom-label";
    elements.toolbar.appendChild(zoomLabel);
    elements.zoomLabel = zoomLabel;
}

function buildAddBar() {
    const items = [
        { icon: "key", label: "Phím", title: "Thêm clip phím tại đầu phát, rồi nhấn phím cần dùng (nhấn nhiều phím cùng lúc = nhiều clip song song)", run: () => addKeyClip() },
        { icon: "mouse", label: "LC", title: "Thêm clip giữ chuột trái tại đầu phát", run: () => addMouseClip("left") },
        { icon: "mouse", label: "RC", title: "Thêm clip giữ chuột phải tại đầu phát", run: () => addMouseClip("right") },
        { icon: "gap", label: "K.trống", title: "Chèn khoảng trống — đẩy mọi clip từ đầu phát trở đi sang phải một đoạn (clip đang vắt qua đầu phát thì giữ lâu thêm)", run: insertGap, withInput: true },
        { icon: "track", label: "+Track", title: "Thêm một track trống", run: addTrack },
        { icon: "block", label: "Skirk", title: "Chèn khối dựng sẵn của Skirk (không bắt buộc)", run: toggleBlockPanel, id: "blockBtn" }
    ];
    items.forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "add-btn";
        if (entry.id) button.id = entry.id;
        button.title = entry.title;
        button.innerHTML = `${svgIcon(entry.icon)}<span>${entry.label}</span>`;
        button.addEventListener("click", entry.run);

        if (!entry.withInput) {
            elements.addBar.appendChild(button);
            return;
        }
        const group = document.createElement("span");
        group.className = "add-group";
        const input = document.createElement("input");
        input.id = "gapInput";
        input.className = "ms-input";
        input.type = "number";
        input.min = "1";
        input.max = String(MAX_MS);
        input.value = "100";
        input.title = "Độ dài khoảng chèn (ms)";
        input.setAttribute("aria-label", "Độ dài khoảng chèn (ms)");
        const unit = document.createElement("span");
        unit.className = "ms-unit";
        unit.textContent = "ms";
        group.append(button, input, unit);
        elements.addBar.appendChild(group);
        elements.gapInput = input;
    });
}

function buildBlockPanel() {
    const hint = document.createElement("span");
    hint.className = "field-hint";
    hint.textContent = `Khối dựng sẵn của Skirk: độ dài cố định theo FPS (${currentFps()} FPS), không chỉnh được; chạy chặn nên không đặt clip khác chồng lên. Bấm để chèn tại đầu phát.`;
    elements.blockPanel.appendChild(hint);
    SKIRK_ACTIONS.forEach((action) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "block-chip";
        chip.textContent = action.label;
        chip.title = `Chèn khối ${action.label} (${blockDurationMs(action.pythonFunction)} ms ở ${currentFps()} FPS)`;
        chip.addEventListener("click", () => addClips([{ kind: "block", fn: action.pythonFunction, start: state.playhead, track: state.activeTrack }]));
        elements.blockPanel.appendChild(chip);
    });
}

function toggleBlockPanel() {
    const open = elements.blockPanel.hidden;
    elements.blockPanel.hidden = !open;
    document.getElementById("blockBtn").classList.toggle("is-active", open);
}

function updateToolbar() {
    const hasSel = state.selected.size > 0;
    const busy = Boolean(state.recording);
    const set = (id, enabled) => { toolButtons[id].disabled = busy ? id !== "record" : !enabled; };
    set("undo", state.undo.length > 0);
    set("redo", state.redo.length > 0);
    set("save", true);
    set("io", true);
    set("cut", hasSel);
    set("copy", hasSel);
    set("paste", true);
    set("dup", hasSel);
    set("razor", state.clips.some((clip) => clip.start < state.playhead && clipEnd(clip) > state.playhead));
    set("delete", hasSel);
    set("clear", state.clips.length > 0 || Boolean(state.loop));
    set("loopIn", true);
    set("loopOut", true);
    set("loopOff", Boolean(state.loop));
    set("play", state.clips.length > 0);
    set("record", true);
    set("snap", true);
    set("zoomOut", state.zoom > ZOOM_MIN);
    set("zoomIn", state.zoom < ZOOM_MAX);
    set("fit", true);
    toolButtons.snap.classList.toggle("is-on", state.snap);
    toolButtons.play.innerHTML = svgIcon(state.playing ? "pause" : "play");
    elements.zoomLabel.textContent = `${Math.round(100 / state.zoom)} ms / 100 px`;
}

// ── Lịch sử hoàn tác ────────────────────────────────────────────────────────
function serialise() {
    return JSON.stringify({ clips: state.clips, tracks: state.tracks, loop: state.loop });
}

function snapshot() {
    state.undo.push(serialise());
    if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
    state.redo = [];
}

function restore(json) {
    const data = JSON.parse(json);
    state.clips = data.clips;
    state.tracks = data.tracks;
    state.loop = data.loop;
    state.selected = new Set([...state.selected].filter((id) => clipById(id)));
    render();
}

function undo() {
    if (!state.undo.length || isBusy()) return;
    state.redo.push(serialise());
    restore(state.undo.pop());
}

function redo() {
    if (!state.redo.length || isBusy()) return;
    state.undo.push(serialise());
    restore(state.redo.pop());
}

function resetHistory() {
    state.undo = [];
    state.redo = [];
}

// ── Thêm / sửa clip ─────────────────────────────────────────────────────────
function makeClip(data) {
    const clip = {
        id: createId(),
        kind: data.kind,
        track: Math.max(0, Math.round(data.track ?? 0)),
        start: clampMs(data.start),
        dur: Math.max(1, clampMs(data.dur ?? DEFAULT_CLIP_MS))
    };
    if (clip.kind === "key") clip.key = data.key ?? "";
    if (clip.kind === "mouse") clip.button = data.button ?? "left";
    if (clip.kind === "block") {
        clip.fn = data.fn;
        clip.dur = blockDurationMs(clip.fn) ?? clip.dur;
    }
    return clip;
}

// Thêm các clip; clip nào đè lên clip khác cùng track thì đẩy xuống track trống.
function addClips(list, { snap = true, select = true } = {}) {
    if (!list.length) return [];
    if (snap) snapshot();
    const added = [];
    list.forEach((data) => {
        const clip = makeClip(data);
        clip.track = freeTrack(clip.start, clip.dur, clip.track);
        state.clips.push(clip);
        added.push(clip);
    });
    if (select) state.selected = new Set(added.map((clip) => clip.id));
    render();
    scrollTimeTo(added[0].start);
    return added;
}

function addKeyClip(at = state.playhead, track = state.activeTrack) {
    if (isBusy()) return;
    const [clip] = addClips([{ kind: "key", key: "", start: at, dur: DEFAULT_CLIP_MS, track }]);
    // Chưa biết phím nào: bắt phím ngay. Nhấn nhiều phím cùng lúc thì mỗi phím một clip song song.
    startClipKeyCapture(clip, true);
}

function addMouseClip(button) {
    if (isBusy()) return;
    addClips([{ kind: "mouse", button, start: state.playhead, dur: DEFAULT_CLIP_MS, track: state.activeTrack }]);
}

function addTrack() {
    snapshot();
    state.tracks = trackCount() + 1;
    render();
    elements.scroll.scrollTop = elements.scroll.scrollHeight;
}

function removeTrack(track) {
    if (state.clips.some((clip) => clip.track === track)) {
        showStatus(`Track ${track + 1} còn clip, dời hoặc xóa clip trước.`, "error");
        return;
    }
    snapshot();
    state.clips.forEach((clip) => { if (clip.track > track) clip.track -= 1; });
    state.tracks = Math.max(MIN_TRACKS, trackCount() - 1);
    if (state.activeTrack >= trackCount()) state.activeTrack = trackCount() - 1;
    render();
}

function insertGap() {
    if (isBusy()) return;
    const gap = clampMs(elements.gapInput.value);
    if (gap < 1) {
        showStatus("Nhập độ dài khoảng chèn (ms) lớn hơn 0.", "error");
        return;
    }
    const at = state.playhead;
    snapshot();
    state.clips.forEach((clip) => {
        if (clip.start >= at) clip.start += gap;
        else if (clipEnd(clip) > at && clip.kind !== "block") clip.dur += gap;
    });
    if (state.loop) {
        if (state.loop.start >= at) state.loop.start += gap;
        if (state.loop.end >= at) state.loop.end += gap;
    }
    render();
    showStatus(`Đã chèn khoảng ${gap} ms tại ${formatMs(at)}.`);
}

function splitAtPlayhead() {
    if (isBusy()) return;
    const at = state.playhead;
    const pool = state.selected.size ? state.clips.filter((clip) => state.selected.has(clip.id)) : state.clips;
    const targets = pool.filter((clip) => clip.kind !== "block" && clip.start < at && clipEnd(clip) > at);
    if (!targets.length) {
        showStatus("Đầu phát không nằm giữa clip nào để cắt.", "error");
        return;
    }
    snapshot();
    const created = targets.map((clip) => {
        const right = { ...clip, id: createId(), start: at, dur: clipEnd(clip) - at };
        clip.dur = at - clip.start;
        return right;
    });
    state.clips.push(...created);
    state.selected = new Set(created.map((clip) => clip.id));
    render();
    showStatus(`Đã cắt ${targets.length} clip tại ${formatMs(at)}: nhả rồi nhấn lại ngay tại điểm cắt.`);
}

function nudgeSelection(delta) {
    const clips = selectedClips();
    if (!clips.length) return;
    const minStart = Math.min(...clips.map((clip) => clip.start));
    const shift = Math.max(delta, -minStart);
    if (!shift) return;
    snapshot();
    clips.forEach((clip) => { clip.start += shift; });
    resolveOverlaps(clips);
    render();
}

function moveSelectionTrack(delta) {
    const clips = selectedClips();
    if (!clips.length) return;
    const minTrack = Math.min(...clips.map((clip) => clip.track));
    const shift = Math.max(delta, -minTrack);
    if (!shift) return;
    snapshot();
    clips.forEach((clip) => { clip.track += shift; });
    resolveOverlaps(clips, shift);
    render();
}

// Clip vừa dời mà đè lên clip khác cùng track thì tìm track trống theo hướng dời.
function resolveOverlaps(moved, direction = 1) {
    moved.forEach((clip) => {
        const clash = (track) => state.clips.some((other) => other !== clip && other.track === track && overlaps(other, clip));
        if (!clash(clip.track)) return;
        if (direction < 0) {
            for (let t = clip.track - 1; t >= 0; t -= 1) {
                if (!clash(t)) { clip.track = t; return; }
            }
        }
        let t = clip.track + 1;
        while (clash(t)) t += 1;
        clip.track = t;
    });
}

// ── Chọn clip ───────────────────────────────────────────────────────────────
function selectedClips() {
    return state.clips.filter((clip) => state.selected.has(clip.id));
}

function clearSelection() {
    state.selected = new Set();
}

function selectAll() {
    state.selected = new Set(state.clips.map((clip) => clip.id));
    render();
}

// ── Copy / cắt / dán / nhân đôi / xóa ───────────────────────────────────────
// Bản copy lưu clip với thời gian tương đối so với clip đầu, track tương đối so với track trên cùng.
function packClips(clips) {
    const t0 = Math.min(...clips.map((clip) => clip.start));
    const k0 = Math.min(...clips.map((clip) => clip.track));
    return clips.map(({ id, ...rest }) => ({ ...rest, start: rest.start - t0, track: rest.track - k0 }));
}

function copySelection(cut = false) {
    const clips = selectedClips();
    if (!clips.length || isBusy()) return;
    const packed = packClips(clips);
    const payload = { skirkClips: packed };
    try { localStorage.setItem(CLIPBOARD_STORAGE, JSON.stringify(payload)); } catch { /* dán trong phiên vẫn dùng bản trong bộ nhớ */ }
    state.clipboard = packed;
    try { navigator.clipboard?.writeText(JSON.stringify(payload)).catch(() => {}); } catch { /* bỏ qua */ }

    if (cut) {
        removeSelected();
        showStatus(`Đã cắt ${packed.length} clip.`);
    } else {
        showStatus(`Đã copy ${packed.length} clip. Đặt đầu phát rồi Ctrl+V để dán.`);
    }
}

// Chuỗi JSON -> clip tương đối: nhận bản copy của trình tạo lẫn danh sách bước phẳng (combo cũ).
function clipsFromData(data) {
    if (data && Array.isArray(data.skirkClips)) {
        return data.skirkClips.filter((clip) => ["key", "mouse", "block"].includes(clip?.kind));
    }
    if (Array.isArray(data)) {
        const { clips } = stepsToClips(data);
        return clips.length ? packClips(clips) : [];
    }
    return [];
}

function clipsFromText(text) {
    try {
        const clips = clipsFromData(JSON.parse(text));
        if (clips.length) return clips;
    } catch {
        // Không phải JSON: thử phân tích theo cú pháp import.md nếu có dấu '{'
    }
    if (typeof text === "string" && text.includes("{")) {
        const parsed = parseMacroSequence(text, { defaultTapMs: getDefaultTapMs() });
        if (!parsed.error && parsed.clips.length) {
            return packClips(parsed.clips);
        }
    }
    return null;
}

// systemText: nội dung clipboard hệ thống (từ sự kiện paste); bỏ trống thì tự đọc (nút Dán).
async function pasteClipboard(systemText) {
    if (isBusy()) return;
    let clips = null;
    if (typeof systemText === "string") {
        clips = clipsFromText(systemText);
    } else {
        try { clips = clipsFromText(await navigator.clipboard.readText()); } catch { /* không đọc được */ }
    }
    if (!clips) clips = state.clipboard ?? clipsFromData(loadJsonStorage(CLIPBOARD_STORAGE, null));
    if (!clips || !clips.length) {
        showStatus("Chưa copy clip nào.", "error");
        return;
    }
    placeClips(clips, state.playhead, state.activeTrack);
    showStatus(`Đã dán ${clips.length} clip tại ${formatMs(state.playhead)}.`);
}

// Đặt nhóm clip tương đối vào timeline tại thời điểm `at`, track trên cùng là `track`.
// Cả nhóm dời xuống cùng một số track cho tới khi không đè clip nào, để giữ nguyên
// bố cục (vd mỗi phím một track) thay vì đẩy lẻ từng clip.
function placeClips(relative, at, track) {
    const placed = relative.map((clip) => ({ ...clip, start: clampMs(at + clip.start) }));
    const fits = (offset) => placed.every((clip) => {
        const probe = { start: clip.start, dur: Math.max(1, clip.dur) };
        return !state.clips.some((other) => other.track === track + offset + clip.track && overlaps(other, probe));
    });
    let offset = 0;
    while (!fits(offset)) offset += 1;
    return addClips(placed.map((clip) => ({ ...clip, track: track + offset + clip.track })));
}

function duplicateSelection() {
    const clips = selectedClips();
    if (!clips.length || isBusy()) return;
    const end = Math.max(...clips.map(clipEnd));
    const k0 = Math.min(...clips.map((clip) => clip.track));
    placeClips(packClips(clips), end, k0);
    showStatus(`Đã nhân đôi ${clips.length} clip, đặt ngay sau.`);
}

function removeSelected() {
    if (!state.selected.size || isBusy()) return;
    snapshot();
    state.clips = state.clips.filter((clip) => !state.selected.has(clip.id));
    clearSelection();
    render();
}

function clearAll() {
    if ((!state.clips.length && !state.loop) || isBusy()) return;
    if (!window.confirm("Xóa toàn bộ clip và vùng lặp?")) return;
    snapshot();
    state.clips = [];
    state.loop = null;
    clearSelection();
    render();
}

// ── Đầu phát / vùng lặp / phóng to ──────────────────────────────────────────
function setPlayhead(ms, reveal = false) {
    state.playhead = clampMs(ms);
    renderPlayhead();
    renderStatusBar();
    updateToolbar();
    if (reveal) scrollTimeTo(state.playhead);
}

function setLoopEdge(edge) {
    if (isBusy()) return;
    const at = state.playhead;
    const loop = state.loop ? { ...state.loop } : { start: 0, end: Math.max(contentEnd(), at + 1) };
    if (edge === "start") {
        loop.start = at;
        if (loop.end <= at) loop.end = Math.max(contentEnd(), at + DEFAULT_CLIP_MS);
    } else {
        loop.end = at;
        if (loop.start >= at) loop.start = 0;
    }
    if (loop.end <= loop.start) {
        showStatus("Cuối vùng lặp phải sau đầu vùng lặp.", "error");
        return;
    }
    snapshot();
    state.loop = loop;
    render();
}

function clearLoop() {
    if (!state.loop) return;
    snapshot();
    state.loop = null;
    render();
}

function toggleSnap() {
    state.snap = !state.snap;
    updateToolbar();
}

function setZoom(zoom, anchorClientX = null) {
    const next = Math.min(Math.max(zoom, ZOOM_MIN), ZOOM_MAX);
    if (next === state.zoom) return;
    // Giữ thời điểm dưới con trỏ (hoặc đầu phát) đứng yên khi phóng to.
    const rect = elements.scroll.getBoundingClientRect();
    const viewX = anchorClientX === null
        ? Math.min(Math.max(HEAD_W + state.playhead * state.zoom - elements.scroll.scrollLeft, HEAD_W), rect.width)
        : anchorClientX - rect.left;
    const anchorMs = (viewX + elements.scroll.scrollLeft - HEAD_W) / state.zoom;
    state.zoom = next;
    try { localStorage.setItem(ZOOM_STORAGE, JSON.stringify(next)); } catch { /* bỏ qua */ }
    renderTimeline();
    elements.scroll.scrollLeft = Math.max(0, HEAD_W + anchorMs * next - viewX);
    updateToolbar();
}

function zoomBy(factor, anchorClientX = null) {
    setZoom(state.zoom * factor, anchorClientX);
}

function zoomToFit() {
    const span = Math.max(contentEnd(), 500);
    const width = elements.scroll.clientWidth - HEAD_W - 40;
    setZoom(width / span);
    elements.scroll.scrollLeft = 0;
}

function onWheel(event) {
    if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX);
    } else if (!event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX) &&
               elements.scroll.scrollHeight <= elements.scroll.clientHeight) {
        // Không có gì để cuộn dọc thì cuộn ngang theo thời gian, như Premiere.
        event.preventDefault();
        elements.scroll.scrollLeft += event.deltaY;
    }
}

function syncStickyOffsets() {
    elements.inner.style.setProperty("--sx", `${elements.scroll.scrollLeft}px`);
    elements.inner.style.setProperty("--sy", `${elements.scroll.scrollTop}px`);
}

function scrollTimeTo(ms) {
    const x = HEAD_W + ms * state.zoom;
    const { scrollLeft, clientWidth } = elements.scroll;
    if (x < scrollLeft + HEAD_W + 20 || x > scrollLeft + clientWidth - 40) {
        elements.scroll.scrollLeft = Math.max(0, x - HEAD_W - clientWidth * 0.3);
    }
}

// ── Vẽ ──────────────────────────────────────────────────────────────────────
function render() {
    syncBlockDurations();
    renderTimeline();
    renderStatusBar();
    updateToolbar();
    renderInspector();
    elements.timelineCount.textContent = `${state.clips.length} clip`;
    elements.pythonPreview.textContent = buildPreview();
}

// Bước vạch thước: vạch lớn cách nhau ít nhất ~90 px.
function rulerStep() {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
    return steps.find((step) => step * state.zoom >= 90) ?? 60000;
}

function renderTimeline() {
    const inner = elements.inner;
    const tracks = trackCount();
    const visibleMs = (elements.scroll.clientWidth - HEAD_W) / state.zoom;
    const span = Math.max(contentEnd() + 1000, state.playhead + 500, visibleMs);
    const width = HEAD_W + span * state.zoom;
    inner.style.width = `${width}px`;
    inner.style.height = `${RULER_H + tracks * TRACK_H}px`;
    inner.replaceChildren();

    // Thước thời gian
    const ruler = document.createElement("div");
    ruler.className = "nle-ruler";
    ruler.dataset.zone = "ruler";
    const major = rulerStep();
    const minor = major / 5;
    for (let t = 0; t <= span; t += minor) {
        const isMajor = Math.round(t / minor) % 5 === 0;
        const tick = document.createElement("span");
        tick.className = isMajor ? "tick is-major" : "tick";
        tick.style.left = `${HEAD_W + t * state.zoom}px`;
        if (isMajor) tick.dataset.label = major >= 1000 ? `${+(t / 1000).toFixed(2)}s` : `${Math.round(t)}`;
        ruler.appendChild(tick);
    }
    const corner = document.createElement("span");
    corner.className = "nle-corner";
    corner.textContent = "ms";
    ruler.appendChild(corner);

    // Vùng lặp trên thước + phủ mờ xuống các track
    if (state.loop) {
        const left = HEAD_W + state.loop.start * state.zoom;
        const w = (state.loop.end - state.loop.start) * state.zoom;
        const bar = document.createElement("div");
        bar.className = "loop-bar";
        bar.style.left = `${left}px`;
        bar.style.width = `${w}px`;
        bar.title = `Vùng lặp ${formatMs(state.loop.start)} → ${formatMs(state.loop.end)}: kéo mép để chỉnh`;
        bar.dataset.zone = "loop";
        ["start", "end"].forEach((edge) => {
            const handle = document.createElement("span");
            handle.className = `loop-handle is-${edge}`;
            handle.dataset.zone = "loop";
            handle.dataset.edge = edge;
            bar.appendChild(handle);
        });
        ruler.appendChild(bar);

        const shade = document.createElement("div");
        shade.className = "loop-shade";
        shade.style.left = `${left}px`;
        shade.style.width = `${w}px`;
        shade.style.top = `${RULER_H}px`;
        shade.style.height = `${tracks * TRACK_H}px`;
        inner.appendChild(shade);
    }
    inner.appendChild(ruler);

    // Track
    const clashes = clashingIds();
    for (let track = 0; track < tracks; track += 1) {
        const lane = document.createElement("div");
        lane.className = "nle-lane";
        if (track === state.activeTrack) lane.classList.add("is-active");
        lane.style.top = `${RULER_H + track * TRACK_H}px`;
        lane.dataset.zone = "lane";
        lane.dataset.track = String(track);
        inner.appendChild(lane);

        const head = document.createElement("div");
        head.className = "nle-head";
        head.style.top = `${RULER_H + track * TRACK_H}px`;
        head.dataset.zone = "head";
        head.dataset.track = String(track);
        head.textContent = `T${track + 1}`;
        head.title = "Bấm để chọn track này làm nơi thêm clip mới";
        if (track >= MIN_TRACKS && !state.clips.some((clip) => clip.track === track)) {
            const del = document.createElement("button");
            del.type = "button";
            del.className = "head-del";
            del.textContent = "×";
            del.title = "Xóa track trống";
            del.dataset.zone = "head-del";
            del.dataset.track = String(track);
            head.appendChild(del);
        }
        inner.appendChild(head);
    }

    // Clip
    const live = state.playing ? state.playing.now : null;
    state.clips.forEach((clip) => {
        const el = document.createElement("div");
        el.className = `clip is-${clip.kind}`;
        if (clip.kind === "mouse") el.classList.add(`btn-${clip.button}`);
        if (state.selected.has(clip.id)) el.classList.add("is-selected");
        if (clashes.has(clip.id)) el.classList.add("is-clash");
        if (clip.kind === "key" && !clip.key) el.classList.add("is-incomplete");
        if (live !== null && clip.start <= live && clipEnd(clip) > live) el.classList.add("is-live");
        const w = Math.max(clip.dur * state.zoom, 3);
        el.style.left = `${HEAD_W + clip.start * state.zoom}px`;
        el.style.width = `${w}px`;
        el.style.top = `${RULER_H + clip.track * TRACK_H + 3}px`;
        el.style.height = `${TRACK_H - 6}px`;
        el.dataset.zone = "clip";
        el.dataset.id = clip.id;
        el.title = `${clipName(clip)} · ${formatMs(clip.start)} → ${formatMs(clipEnd(clip))} (giữ ${formatMs(clip.dur)})`;
        if (w >= 18) {
            const label = document.createElement("span");
            label.className = "clip-label";
            label.textContent = clipShortName(clip);
            el.appendChild(label);
        }
        if (w >= 70) {
            const dur = document.createElement("span");
            dur.className = "clip-dur";
            dur.textContent = formatMs(clip.dur);
            el.appendChild(dur);
        }
        inner.appendChild(el);
    });

    // Khung khoanh chọn
    const p = state.pointer;
    if (p && p.mode === "marquee" && p.moved) {
        const box = document.createElement("div");
        box.className = "marquee";
        box.style.left = `${Math.min(p.x0, p.x1)}px`;
        box.style.top = `${Math.min(p.y0, p.y1)}px`;
        box.style.width = `${Math.abs(p.x1 - p.x0)}px`;
        box.style.height = `${Math.abs(p.y1 - p.y0)}px`;
        inner.appendChild(box);
    }
    if (p && p.snapAt !== null && p.snapAt !== undefined) {
        const guide = document.createElement("div");
        guide.className = "snap-guide";
        guide.style.left = `${HEAD_W + p.snapAt * state.zoom}px`;
        inner.appendChild(guide);
    }

    const playhead = document.createElement("div");
    playhead.className = "nle-playhead";
    inner.appendChild(playhead);
    elements.playhead = playhead;
    renderPlayhead();

    if (!state.clips.length) {
        const empty = document.createElement("div");
        empty.className = "nle-empty";
        empty.style.left = `${HEAD_W}px`;
        empty.style.top = `${RULER_H}px`;
        empty.textContent = "Timeline trống: bấm Phím / Chuột ở trên, nhấp đúp vào track, hoặc bấm Ghi.";
        inner.appendChild(empty);
    }
}

function renderPlayhead() {
    if (!elements.playhead) return;
    const t = state.playing ? state.playing.now : state.playhead;
    elements.playhead.style.left = `${HEAD_W + t * state.zoom}px`;
    elements.playhead.style.height = `${RULER_H + trackCount() * TRACK_H}px`;
}

function renderStatusBar() {
    const bar = elements.statusBar;
    bar.replaceChildren();
    const item = (text) => {
        const span = document.createElement("span");
        span.textContent = text;
        bar.appendChild(span);
        return span;
    };

    const ph = document.createElement("label");
    ph.className = "status-field";
    ph.append("Đầu phát ", msInput(state.playhead, (v) => setPlayhead(v, true)), " ms");
    bar.appendChild(ph);

    item(`Tổng: ${formatMs(contentEnd())}`);
    item(`Track chèn: T${state.activeTrack + 1}`);

    if (state.loop) {
        const loop = document.createElement("label");
        loop.className = "status-field is-loop";
        loop.append(
            "Lặp ",
            msInput(state.loop.start, (v) => updateLoop({ start: v })),
            " → ",
            msInput(state.loop.end, (v) => updateLoop({ end: v })),
            ` ms (${formatMs(state.loop.end - state.loop.start)} / vòng)`
        );
        bar.appendChild(loop);
    } else {
        item("Không lặp (I / O để đặt vùng lặp)").className = "status-muted";
    }
}

function updateLoop(patch) {
    const next = { ...state.loop, ...patch };
    if (next.end <= next.start) {
        showStatus("Cuối vùng lặp phải sau đầu vùng lặp.", "error");
        renderStatusBar();
        return;
    }
    snapshot();
    state.loop = next;
    render();
}

// Ô số ms: đổi khi Enter / rời ô, không vẽ lại lúc đang gõ để khỏi mất con trỏ.
function msInput(value, onCommit) {
    const input = document.createElement("input");
    input.className = "ms-input";
    input.type = "number";
    input.min = "0";
    input.max = String(MAX_MS);
    input.step = "1";
    input.value = String(Math.round(value));
    const commit = () => {
        if (input.value === "" || Number(input.value) === Math.round(value)) return;
        onCommit(clampMs(input.value));
    };
    input.addEventListener("change", commit);
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") input.blur();
        event.stopPropagation();
    });
    return input;
}

// Clip giữ cùng một phím / nút chồng thời gian lên nhau (khác track) thì không chạy đúng.
function clashingIds() {
    const ids = new Set();
    const byTarget = new Map();
    state.clips.forEach((clip) => {
        const target = clipTarget(clip);
        if (!target) return;
        if (!byTarget.has(target)) byTarget.set(target, []);
        byTarget.get(target).push(clip);
    });
    byTarget.forEach((list) => {
        for (let i = 0; i < list.length; i += 1) {
            for (let j = i + 1; j < list.length; j += 1) {
                if (overlaps(list[i], list[j])) { ids.add(list[i].id); ids.add(list[j].id); }
            }
        }
    });
    // Khối Skirk chạy chặn: nhấn / nhả nào rơi vào trong khối sẽ bị trễ tới hết khối.
    const blocks = state.clips.filter((clip) => clip.kind === "block");
    blocks.forEach((block) => {
        const inside = (t) => t >= block.start && t < clipEnd(block);
        state.clips.forEach((clip) => {
            if (clip !== block && (inside(clip.start) || (clipEnd(clip) > block.start && inside(clipEnd(clip))))) {
                ids.add(block.id);
                ids.add(clip.id);
            }
        });
    });
    return ids;
}

// ── Chuột trên timeline ─────────────────────────────────────────────────────
function pointerPos(event) {
    const rect = elements.inner.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, ms: (x - HEAD_W) / state.zoom, track: Math.floor((y - RULER_H) / TRACK_H) };
}

function onPointerDown(event) {
    if (isBusy() || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target.closest("[data-zone]") : null;
    const zone = target?.dataset.zone;
    const pos = pointerPos(event);
    elements.nle.focus({ preventScroll: true });

    if (zone === "head-del") {
        removeTrack(Number(target.dataset.track));
        return;
    }
    if (zone === "head") {
        state.activeTrack = Number(target.dataset.track);
        render();
        return;
    }
    if (state.playing) stopPlay();

    if (zone === "ruler" || zone === "loop") {
        const edge = target.dataset.edge;
        if (zone === "loop" && edge) {
            state.pointer = { mode: "loop", edge, before: serialise(), moved: false, snapAt: null };
        } else {
            state.pointer = { mode: "scrub", moved: false, snapAt: null };
            setPlayhead(snapPlayhead(pos.ms, event.altKey));
        }
        elements.inner.setPointerCapture(event.pointerId);
        return;
    }

    if (zone === "clip") {
        const clip = clipById(target.dataset.id);
        if (!clip) return;
        if (event.ctrlKey || event.metaKey) {
            if (!state.selected.delete(clip.id)) state.selected.add(clip.id);
            render();
            return;
        }
        if (event.shiftKey) state.selected.add(clip.id);
        else if (!state.selected.has(clip.id)) state.selected = new Set([clip.id]);
        state.activeTrack = clip.track;

        const rect = target.getBoundingClientRect();
        const fromLeft = event.clientX - rect.left;
        const fromRight = rect.right - event.clientX;
        let mode = "move";
        if (clip.kind !== "block" && rect.width > EDGE_PX * 3) {
            if (fromLeft <= EDGE_PX) mode = "trim-start";
            else if (fromRight <= EDGE_PX) mode = "trim-end";
        }
        const moving = mode === "move" ? selectedClips() : [clip];
        state.pointer = {
            mode,
            clipId: clip.id,
            x0: pos.x,
            y0: pos.y,
            ms0: pos.ms,
            track0: pos.track,
            before: serialise(),
            orig: new Map(moving.map((c) => [c.id, { start: c.start, dur: c.dur, track: c.track }])),
            moved: false,
            snapAt: null
        };
        elements.inner.setPointerCapture(event.pointerId);
        render();
        return;
    }

    // Vùng trống trên track: đặt đầu phát + chọn track, kéo thì khoanh chọn.
    if (pos.track >= 0) state.activeTrack = Math.min(pos.track, trackCount() - 1);
    state.pointer = {
        mode: "marquee",
        x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y,
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
        base: new Set(state.selected),
        moved: false,
        ms: pos.ms,
        snapAt: null
    };
    elements.inner.setPointerCapture(event.pointerId);
}

let dragRafId = 0;
let pendingDragInspector = false;
let pendingDragStatusBar = false;

function scheduleDragRender(withInspector = false, withStatusBar = false) {
    if (withInspector) pendingDragInspector = true;
    if (withStatusBar) pendingDragStatusBar = true;
    if (dragRafId) return;
    dragRafId = requestAnimationFrame(() => {
        dragRafId = 0;
        const doInspector = pendingDragInspector;
        const doStatusBar = pendingDragStatusBar;
        pendingDragInspector = false;
        pendingDragStatusBar = false;
        renderTimeline();
        if (doStatusBar) renderStatusBar();
        if (doInspector) renderInspector(true);
    });
}

function cancelDragRender() {
    if (dragRafId) {
        cancelAnimationFrame(dragRafId);
        dragRafId = 0;
    }
    pendingDragInspector = false;
    pendingDragStatusBar = false;
}

function onPointerMove(event) {
    const p = state.pointer;
    if (!p) {
        updateHoverCursor(event);
        return;
    }
    const pos = pointerPos(event);
    const noSnap = event.altKey || !state.snap;

    if (p.mode === "scrub") {
        p.moved = true;
        setPlayhead(snapPlayhead(pos.ms, event.altKey));
        return;
    }

    if (p.mode === "loop") {
        p.moved = true;
        const t = snapTime(Math.max(0, pos.ms), noSnap, new Set());
        const loop = { ...state.loop };
        if (p.edge === "start") loop.start = Math.min(clampMs(t.value), loop.end - 1);
        else loop.end = Math.max(clampMs(t.value), loop.start + 1);
        state.loop = loop;
        p.snapAt = t.at;
        scheduleDragRender(false, true);
        return;
    }

    if (p.mode === "marquee") {
        p.x1 = pos.x;
        p.y1 = pos.y;
        if (!p.moved && Math.hypot(p.x1 - p.x0, p.y1 - p.y0) < DRAG_THRESHOLD) return;
        p.moved = true;
        const t0 = (Math.min(p.x0, p.x1) - HEAD_W) / state.zoom;
        const t1 = (Math.max(p.x0, p.x1) - HEAD_W) / state.zoom;
        const k0 = Math.floor((Math.min(p.y0, p.y1) - RULER_H) / TRACK_H);
        const k1 = Math.floor((Math.max(p.y0, p.y1) - RULER_H) / TRACK_H);
        const hit = state.clips.filter((clip) => clip.track >= k0 && clip.track <= k1 &&
            clip.start < t1 && clipEnd(clip) > t0).map((clip) => clip.id);
        state.selected = new Set(p.additive ? [...p.base, ...hit] : hit);
        scheduleDragRender(false, false);
        return;
    }

    // Kéo / co giãn clip
    if (!p.moved && Math.hypot(pos.x - p.x0, pos.y - p.y0) < DRAG_THRESHOLD) return;
    p.moved = true;
    const dMs = pos.ms - p.ms0;
    const ignore = new Set(p.orig.keys());

    if (p.mode === "move") {
        const origs = [...p.orig.values()];
        const minStart = Math.min(...origs.map((o) => o.start));
        const minTrack = Math.min(...origs.map((o) => o.track));
        let shift = Math.max(dMs, -minStart);
        // Hít: mép trái / phải của từng clip đang kéo vào mép clip khác / đầu phát.
        const snap = snapShift(origs, shift, noSnap, ignore);
        shift = Math.max(Math.round(snap.value), -minStart);
        p.snapAt = snap.at;
        const dTrack = Math.max(pos.track - p.track0, -minTrack);
        p.orig.forEach((o, id) => {
            const clip = clipById(id);
            clip.start = o.start + shift;
            clip.track = o.track + dTrack;
        });
    } else {
        const clip = clipById(p.clipId);
        const o = p.orig.get(p.clipId);
        // Không cho kéo mép lấn sang clip bên cạnh cùng track.
        const neighbours = state.clips.filter((c) => c !== clip && c.track === clip.track);
        if (p.mode === "trim-start") {
            const end = o.start + o.dur;
            const limit = Math.max(0, ...neighbours.filter((c) => clipEnd(c) <= o.start).map(clipEnd));
            const snap = snapTime(o.start + dMs, noSnap, ignore);
            const start = Math.min(Math.max(Math.round(snap.value), limit), end - 1);
            clip.start = start;
            clip.dur = end - start;
            p.snapAt = snap.at;
        } else {
            const limit = Math.min(MAX_MS, ...neighbours.filter((c) => c.start >= o.start + o.dur).map((c) => c.start));
            const snap = snapTime(o.start + o.dur + dMs, noSnap, ignore);
            const end = Math.max(Math.min(Math.round(snap.value), limit), o.start + 1);
            clip.dur = end - o.start;
            p.snapAt = snap.at;
        }
    }
    scheduleDragRender(true, false);
}

function onPointerUp(event) {
    const p = state.pointer;
    if (!p) return;
    cancelDragRender();
    state.pointer = null;
    try { elements.inner.releasePointerCapture(event.pointerId); } catch { /* đã nhả */ }

    if (p.mode === "marquee") {
        if (!p.moved) {
            if (!p.additive) clearSelection();
            setPlayhead(snapPlayhead(p.ms, event.altKey));
        }
        render();
        return;
    }
    if (p.mode === "scrub") {
        render();
        return;
    }
    if (!p.moved) {
        // Bấm (không kéo) vào clip đã nằm trong nhóm chọn: chỉ chọn riêng clip đó.
        if (p.mode === "move" && !event.shiftKey && state.selected.size > 1) state.selected = new Set([p.clipId]);
        render();
        return;
    }
    if (p.mode === "move") resolveOverlaps(selectedClips());
    if (serialise() !== p.before) {
        state.undo.push(p.before);
        if (state.undo.length > HISTORY_LIMIT) state.undo.shift();
        state.redo = [];
    }
    render();
}

function updateHoverCursor(event) {
    const target = event.target instanceof Element ? event.target.closest(".clip") : null;
    elements.inner.classList.remove("cursor-trim");
    if (!target || target.classList.contains("is-block")) return;
    const rect = target.getBoundingClientRect();
    if (rect.width <= EDGE_PX * 3) return;
    if (event.clientX - rect.left <= EDGE_PX || rect.right - event.clientX <= EDGE_PX) {
        elements.inner.classList.add("cursor-trim");
    }
}

function onDoubleClick(event) {
    if (isBusy()) return;
    const target = event.target instanceof Element ? event.target.closest("[data-zone]") : null;
    const zone = target?.dataset.zone;
    if (zone === "clip") {
        const clip = clipById(target.dataset.id);
        if (clip?.kind === "key") startClipKeyCapture(clip);
        return;
    }
    if (zone !== "lane") return;
    const pos = pointerPos(event);
    const at = snapPlayhead(pos.ms, event.altKey);
    setPlayhead(at);
    addKeyClip(at, Number(target.dataset.track));
}

// Điểm hít: mép mọi clip (trừ clip đang kéo), đầu phát, 0, mép vùng lặp.
function snapPoints(ignore) {
    const points = [0, state.playhead];
    state.clips.forEach((clip) => {
        if (ignore.has(clip.id)) return;
        points.push(clip.start, clipEnd(clip));
    });
    if (state.loop) points.push(state.loop.start, state.loop.end);
    return points;
}

// Hít một mốc thời gian đơn: trả { value, at } (at = điểm đã hít, hoặc null).
function snapTime(value, disabled, ignore) {
    if (disabled) return { value, at: null };
    const threshold = SNAP_PX / state.zoom;
    let best = null;
    snapPoints(ignore).forEach((point) => {
        const d = Math.abs(point - value);
        if (d <= threshold && (best === null || d < Math.abs(best - value))) best = point;
    });
    return best === null ? { value, at: null } : { value: best, at: best };
}

// Hít cả nhóm clip đang kéo: thử mép trái / phải của từng clip.
function snapShift(origs, shift, disabled, ignore) {
    if (disabled) return { value: shift, at: null };
    const threshold = SNAP_PX / state.zoom;
    const points = snapPoints(ignore);
    let best = null;
    origs.forEach((o) => {
        [o.start, o.start + o.dur].forEach((edge) => {
            points.forEach((point) => {
                const delta = point - (edge + shift);
                if (Math.abs(delta) <= threshold && (best === null || Math.abs(delta) < Math.abs(best.delta))) {
                    best = { delta, at: point };
                }
            });
        });
    });
    return best ? { value: shift + best.delta, at: best.at } : { value: shift, at: null };
}

// Đặt đầu phát: hít vào mép clip gần nhất (trừ khi giữ Alt).
function snapPlayhead(ms, alt) {
    const value = Math.max(0, ms);
    if (alt || !state.snap) return clampMs(value);
    const threshold = SNAP_PX / state.zoom;
    let best = null;
    state.clips.forEach((clip) => {
        [clip.start, clipEnd(clip)].forEach((point) => {
            if (Math.abs(point - value) <= threshold && (best === null || Math.abs(point - value) < Math.abs(best - value))) best = point;
        });
    });
    return clampMs(best ?? value);
}

// ── Xem thử: đầu phát chạy theo thời gian thật ──────────────────────────────
function togglePlay() {
    if (state.playing) stopPlay();
    else startPlay();
}

function startPlay() {
    if (!state.clips.length || isBusy()) return;
    const end = contentEnd();
    const from = state.playhead >= end ? 0 : state.playhead;
    state.playing = { from, t0: performance.now(), now: from, raf: 0 };
    const tick = () => {
        const play = state.playing;
        if (!play) return;
        let now = play.from + (performance.now() - play.t0);
        if (state.loop && now >= state.loop.end && play.from < state.loop.end) {
            // Giống lúc chạy thật: tới cuối vùng lặp thì quay về đầu vùng lặp.
            const period = state.loop.end - state.loop.start;
            now = state.loop.start + ((now - state.loop.start) % period);
        } else if (now >= end) {
            stopPlay(end);
            return;
        }
        play.now = now;
        renderTimeline();
        play.raf = requestAnimationFrame(tick);
    };
    updateToolbar();
    state.playing.raf = requestAnimationFrame(tick);
}

function stopPlay(at = null) {
    const play = state.playing;
    if (!play) return;
    cancelAnimationFrame(play.raf);
    state.playing = null;
    state.playhead = clampMs(at ?? play.now);
    render();
}

// ── Ghi: thu phím / chuột thao tác trong cửa sổ thành clip ──────────────────
const RECORD_MOUSE = Object.freeze({ 0: "left", 1: "middle", 2: "right", 3: "mouse_3", 4: "mouse_4" });

function toggleRecording() {
    if (state.recording) stopRecording();
    else startRecording();
}

function startRecording() {
    if (state.capturingHotkey || state.capturing) return;
    if (state.playing) stopPlay();
    snapshot();
    state.recording = { origin: state.playhead, t0: null, open: new Map(), raf: 0 };
    window.addEventListener("keydown", onRecordKeyDown, true);
    window.addEventListener("keyup", onRecordKeyUp, true);
    window.addEventListener("mousedown", onRecordMouseDown, true);
    window.addEventListener("mouseup", onRecordMouseUp, true);
    window.addEventListener("contextmenu", onRecordContextMenu, true);
    elements.nle.classList.add("is-recording");
    toolButtons.record.classList.add("is-recording");
    toolButtons.record.innerHTML = svgIcon("stop");
    toolButtons.record.title = "Dừng ghi";
    clearSelection();
    render();
    showStatus(`Đang ghi từ ${formatMs(state.playhead)}: thời gian tính từ thao tác đầu tiên, giữ bao lâu thì clip dài bấy nhiêu.`);
}

function stopRecording() {
    const rec = state.recording;
    if (!rec) return;
    window.removeEventListener("keydown", onRecordKeyDown, true);
    window.removeEventListener("keyup", onRecordKeyUp, true);
    window.removeEventListener("mousedown", onRecordMouseDown, true);
    window.removeEventListener("mouseup", onRecordMouseUp, true);
    window.removeEventListener("contextmenu", onRecordContextMenu, true);
    cancelAnimationFrame(rec.raf);
    const now = recordNow();
    rec.open.forEach((clip) => { clip.dur = Math.max(1, now - clip.start); });
    state.recording = null;
    elements.nle.classList.remove("is-recording");
    toolButtons.record.classList.remove("is-recording");
    toolButtons.record.innerHTML = svgIcon("record");
    toolButtons.record.title = "Ghi: bấm rồi thao tác bàn phím / chuột trong cửa sổ này, clip được đặt từ đầu phát";
    if (now !== null) state.playhead = clampMs(now);
    render();
    showStatus("Đã dừng ghi. Kéo chỉnh lại clip nếu cần rồi Lưu.");
}

function recordNow() {
    const rec = state.recording;
    if (!rec || rec.t0 === null) return null;
    return clampMs(rec.origin + performance.now() - rec.t0);
}

function recordDown(kind, value) {
    const rec = state.recording;
    if (rec.t0 === null) {
        rec.t0 = performance.now();
        // Clip đang giữ dài ra theo thời gian thật cho dễ nhìn.
        const grow = () => {
            if (!state.recording) return;
            const now = recordNow();
            rec.open.forEach((clip) => { clip.dur = Math.max(1, now - clip.start); });
            state.playhead = now;
            renderTimeline();
            scrollTimeTo(now);
            rec.raf = requestAnimationFrame(grow);
        };
        rec.raf = requestAnimationFrame(grow);
    }
    const id = `${kind}:${value}`;
    if (rec.open.has(id)) return;
    const start = recordNow();
    const clip = makeClip({ kind, [kind === "key" ? "key" : "button"]: value, start, dur: 1, track: 0 });
    // Track đầu tiên còn trống từ đây về sau (clip đang giữ chiếm track tới khi nhả).
    let track = 0;
    const holding = new Set(rec.open.values());
    const busy = (t) => state.clips.some((c) => c.track === t && (holding.has(c) || clipEnd(c) > start));
    while (busy(track)) track += 1;
    clip.track = track;
    state.clips.push(clip);
    rec.open.set(id, clip);
    renderTimeline();
}

function recordUp(kind, value) {
    const rec = state.recording;
    const id = `${kind}:${value}`;
    const clip = rec.open.get(id);
    if (!clip) return;
    clip.dur = Math.max(1, recordNow() - clip.start);
    rec.open.delete(id);
    renderTimeline();
}

function onRecordKeyDown(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    recordDown("key", normaliseKeyboardHotkey(event));
}

function onRecordKeyUp(event) {
    event.preventDefault();
    event.stopPropagation();
    recordUp("key", normaliseKeyboardHotkey(event));
}

function onRecordMouseDown(event) {
    // Bấm vào nút Ghi/Dừng thì không tính là một thao tác cần ghi.
    if (event.target instanceof Element && event.target.closest("#recordBtn")) return;
    const button = RECORD_MOUSE[event.button];
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    recordDown("mouse", button);
}

function onRecordMouseUp(event) {
    if (event.target instanceof Element && event.target.closest("#recordBtn") && !state.recording.open.size) return;
    const button = RECORD_MOUSE[event.button];
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    recordUp("mouse", button);
}

function onRecordContextMenu(event) {
    event.preventDefault();
}

// ── Inspector: sửa chính xác clip đang chọn ─────────────────────────────────
function renderInspector(force = false) {
    const clips = selectedClips();
    const key = clips.length === 1 ? clips[0] : (clips.length > 1 ? "multi" : null);
    // Cùng một clip thì chỉ cập nhật số, giữ nguyên DOM để không mất con trỏ.
    if (!force && key === state.inspected) return;
    if (force && key === state.inspected && key && key !== "multi" && state.inspectorInputs) {
        const { start, dur, end, track } = state.inspectorInputs;
        if (document.activeElement !== start) start.value = String(key.start);
        if (document.activeElement !== dur) dur.value = String(key.dur);
        if (document.activeElement !== end) end.value = String(clipEnd(key));
        if (document.activeElement !== track) track.value = String(key.track + 1);
        return;
    }

    state.inspected = key;
    state.inspectorInputs = null;
    const box = elements.inspector;
    box.replaceChildren();
    box.hidden = !key;
    if (!key) return;

    const title = document.createElement("p");
    title.className = "inspector-title";
    box.appendChild(title);
    const fields = document.createElement("div");
    fields.className = "inspector-fields";
    box.appendChild(fields);

    if (key === "multi") {
        const start = Math.min(...clips.map((c) => c.start));
        const end = Math.max(...clips.map(clipEnd));
        title.textContent = `${clips.length} clip đã chọn · ${formatMs(start)} → ${formatMs(end)}`;
        fields.appendChild(numberField("Dời nhóm tới (ms)", start, (v) => {
            snapshot();
            clips.forEach((c) => { c.start += v - start; });
            resolveOverlaps(clips);
            render();
        }));
        fields.appendChild(numberField("Đặt thời gian giữ cho tất cả (ms)", "", (v) => {
            snapshot();
            clips.forEach((c) => { if (c.kind !== "block") c.dur = Math.max(1, v); });
            render();
        }));
        return;
    }

    const clip = key;
    title.textContent = `Clip: ${clipName(clip)}`;
    if (clip.kind === "key") fields.appendChild(keyField(clip));
    if (clip.kind === "mouse") fields.appendChild(mouseField(clip));

    const edit = (apply) => (v) => {
        snapshot();
        apply(v);
        if (clip.dur < 1) clip.dur = 1;
        resolveOverlaps([clip]);
        render();
    };
    const start = numberField("Bắt đầu (ms)", clip.start, edit((v) => { clip.start = v; }));
    const fixed = clip.kind === "block";
    const dur = numberField(fixed ? `Thời lượng cố định (${currentFps()} FPS)` : "Giữ trong (ms)", clip.dur, edit((v) => { clip.dur = v; }), fixed);
    const end = numberField(fixed ? "Kết thúc lúc (ms)" : "Nhả lúc (ms)", clipEnd(clip), edit((v) => { clip.dur = v - clip.start; }), fixed);
    const track = numberField("Track", clip.track + 1, edit((v) => { clip.track = Math.max(0, v - 1); }));
    fields.append(start, dur, end, track);
    state.inspectorInputs = {
        start: start.querySelector("input"),
        dur: dur.querySelector("input"),
        end: end.querySelector("input"),
        track: track.querySelector("input")
    };
}

function fieldWrap(labelText) {
    const wrap = document.createElement("label");
    wrap.className = "inspector-field";
    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = labelText;
    wrap.appendChild(label);
    return wrap;
}

function numberField(labelText, value, onCommit, readOnly = false) {
    const wrap = fieldWrap(labelText);
    const input = document.createElement("input");
    input.className = "text-input";
    input.disabled = readOnly;
    input.type = "number";
    input.min = "0";
    input.max = String(MAX_MS);
    input.step = "1";
    input.value = value === "" ? "" : String(value);
    input.addEventListener("change", () => {
        if (input.value === "") return;
        onCommit(clampMs(input.value));
    });
    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") input.blur();
        event.stopPropagation();
    });
    wrap.appendChild(input);
    return wrap;
}

function keyField(clip) {
    const wrap = fieldWrap("Phím");
    const button = document.createElement("button");
    button.type = "button";
    button.id = "stepKeyButton";
    button.className = "hotkey-capture";
    const capturing = state.capturing?.clip === clip;
    button.classList.toggle("is-set", Boolean(clip.key));
    button.classList.toggle("is-listening", capturing);
    button.textContent = capturing
        ? (state.capturing.chord ? "Nhấn 1 hoặc nhiều phím cùng lúc rồi thả… Esc để hủy" : "Nhấn phím… Esc để hủy")
        : (clip.key ? hotkeyLabel(clip.key) : "Nhấn để chọn phím");
    button.addEventListener("click", () => startClipKeyCapture(clip));
    wrap.appendChild(button);
    return wrap;
}

function mouseField(clip) {
    const wrap = fieldWrap("Nút chuột");
    const select = document.createElement("select");
    select.className = "text-input";
    MOUSE_BUTTONS.forEach(({ value, label }) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
    });
    select.value = clip.button || "left";
    select.addEventListener("change", () => {
        snapshot();
        clip.button = select.value;
        render();
        renderInspector(true);
    });
    wrap.appendChild(select);
    return wrap;
}

// fresh = clip vừa thêm (đã có snapshot) và cho bấm nhiều phím cùng lúc:
// nhấn giữ các phím rồi thả một phím bất kỳ để chốt; mỗi phím thêm là một clip song song.
function startClipKeyCapture(clip, fresh = false) {
    if (state.capturing || state.capturingHotkey || state.recording) return;
    state.selected = new Set([clip.id]);
    const chord = [];
    const finish = (keys) => {
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("keyup", onKeyUp, true);
        window.removeEventListener("mousedown", onMouse, true);
        state.capturing = null;
        if (keys && keys.length) {
            if (!fresh) snapshot();
            clip.key = keys[0];
            const extra = keys.slice(1).map((key) => {
                const copy = makeClip({ kind: "key", key, start: clip.start, dur: clip.dur, track: clip.track });
                copy.track = freeTrack(copy.start, copy.dur, clip.track);
                state.clips.push(copy);
                return copy;
            });
            state.selected = new Set([clip.id, ...extra.map((c) => c.id)]);
        } else if (fresh) {
            // Hủy khi vừa thêm: bỏ luôn clip trống, không để lại clip "?".
            state.clips = state.clips.filter((c) => c !== clip);
            state.undo.pop();
            clearSelection();
        }
        state.inspected = null;
        render();
    };
    const onKey = (event) => {
        if (event.repeat) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === "Escape") { finish(null); return; }
        const key = normaliseKeyboardHotkey(event);
        if (!fresh) { finish([key]); return; }
        if (!chord.includes(key)) chord.push(key);
    };
    const onKeyUp = (event) => {
        if (!chord.length) return;
        event.preventDefault();
        event.stopPropagation();
        finish(chord);
    };
    // Bấm ra ngoài nút thì hủy bắt phím.
    const onMouse = (event) => {
        if (!(event.target instanceof Element && event.target.closest("#stepKeyButton"))) finish(null);
    };
    state.capturing = { clip, chord: fresh, finish };
    state.inspected = null;
    render();
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("mousedown", onMouse, true);
}

function cancelClipKeyCapture() {
    state.capturing?.finish(null);
}

// ── Biên dịch clip → bước phẳng cho backend ─────────────────────────────────
function clipSteps(clip) {
    if (clip.kind === "key") return [{ type: "key_down", key: clip.key }, { type: "key_up", key: clip.key }];
    return [{ type: "mouse_down", button: clip.button }, { type: "mouse_up", button: clip.button }];
}

// Cùng thời điểm: nhả trước, rồi tới mốc lặp, rồi mới nhấn — clip kết thúc đúng lúc clip
// khác cùng phím bắt đầu vẫn ra "nhả rồi nhấn lại", và clip nằm sát mép vùng lặp thuộc đúng phía.
function compileClips(clips = state.clips, loop = state.loop) {
    const events = [];
    clips.forEach((clip) => {
        if (clip.kind === "block") {
            events.push({ t: clip.start, order: 3, track: clip.track, step: clip.fn, blockDur: clip.dur });
            return;
        }
        const [down, up] = clipSteps(clip);
        events.push({ t: clip.start, order: 3, track: clip.track, step: down });
        events.push({ t: clipEnd(clip), order: 0, track: clip.track, step: up });
    });
    if (loop) {
        events.push({ t: loop.start, order: 2, track: -1, step: { type: "loop_start" } });
        events.push({ t: loop.end, order: 1, track: -1, step: { type: "loop_end" } });
    }
    events.sort((a, b) => a.t - b.t || a.order - b.order || a.track - b.track);

    const steps = [];
    let cursor = 0;
    events.forEach((event) => {
        const gap = Math.round(event.t - cursor);
        if (gap > 0) steps.push({ type: "wait", ms: gap });
        steps.push(event.step);
        cursor = Math.max(cursor, event.t) + (event.blockDur ?? 0);
    });
    return steps;
}

// Bước phẳng (combo cũ) → clip. Chờ cộng dồn thời gian; Nhấn mở clip, Nhả đóng clip.
function stepsToClips(steps) {
    const clips = [];
    const open = new Map();
    let t = 0;
    let loopStart = null;
    let loop = null;
    const close = (id, at) => {
        const clip = open.get(id);
        if (!clip) return;
        clip.dur = Math.max(1, at - clip.start);
        open.delete(id);
    };
    (Array.isArray(steps) ? steps : []).forEach((item) => {
        if (typeof item === "string") {
            if (!ACTION_BY_FUNCTION.has(item)) return;
            if (/^wait_\d+$/.test(item)) { t += Number(item.slice(5)); return; }
            const dur = blockDurationMs(item) ?? DEFAULT_BLOCK_MS;
            clips.push({ id: createId(), kind: "block", fn: item, start: t, dur, track: 0 });
            t += dur;
            return;
        }
        const type = STEP_TYPES[item?.type];
        if (!type) return;
        if (type.kind === "wait") { t += Math.max(0, Number(item.ms) || 0); return; }
        if (type.kind === "marker") {
            if (type.start) loopStart = t;
            else if (loopStart !== null) loop = { start: loopStart, end: Math.max(t, loopStart + 1) };
            return;
        }
        const target = type.kind === "key" ? item.key : (item.button || "left");
        const id = `${type.kind}:${target}`;
        const base = type.kind === "key" ? { kind: "key", key: target || "" } : { kind: "mouse", button: target };
        if (type.tap) {
            const hold = Math.max(1, Number(item.hold) || 50);
            close(id, t);
            clips.push({ id: createId(), ...base, start: t, dur: hold, track: 0 });
            t += hold;   // bấm kiểu cũ chạy chặn: giữ xong mới sang bước sau
            return;
        }
        if (type.press) {
            close(id, t);
            const clip = { id: createId(), ...base, start: t, dur: 1, track: 0 };
            clips.push(clip);
            open.set(id, clip);
        } else {
            close(id, t);
        }
    });
    // Nhấn mà không nhả: combo cũ tự nhả khi kết thúc.
    open.forEach((_, id) => close(id, Math.max(t, open.get(id).start + 1)));

    // Xếp track: mỗi clip vào track thấp nhất còn trống.
    const ends = [];
    clips.slice().sort((a, b) => a.start - b.start).forEach((clip) => {
        let track = ends.findIndex((end) => end <= clip.start);
        if (track === -1) { track = ends.length; ends.push(0); }
        clip.track = track;
        ends[track] = clipEnd(clip);
    });
    return { clips, loop };
}

// ── Kiểm tra trước khi lưu ──────────────────────────────────────────────────
function validateClips() {
    const name = (clip) => `Clip ${clipName(clip)} ở ${formatMs(clip.start)} (T${clip.track + 1})`;
    for (const clip of state.clips) {
        if (clip.kind === "key" && !clip.key) return `${name(clip)} chưa chọn phím. Nhấp đúp vào clip để chọn.`;
        if (!(clip.dur >= 1)) return `${name(clip)}: thời gian giữ phải từ 1 ms.`;
        if (clip.kind === "block" && !ACTION_BY_FUNCTION.has(clip.fn)) return `${name(clip)} không nhận ra được, hãy xóa.`;
    }

    const clashes = clashingIds();
    if (clashes.size) {
        const clip = state.clips.find((c) => clashes.has(c.id) && c.kind !== "block");
        return state.clips.some((b) => b.kind === "block" && clashes.has(b.id))
            ? "Khối Skirk chạy chặn: không đặt clip khác nhấn / nhả bên trong khối (các clip viền đỏ)."
            : `${clipName(clip)} bị giữ chồng lên chính nó ở hai track (viền đỏ). Dời để hai clip không trùng thời gian.`;
    }

    if (state.loop) {
        const { start, end } = state.loop;
        const crossing = state.clips.find((clip) => (clip.start < start && clipEnd(clip) > start) ||
            (clip.start < end && clipEnd(clip) > end));
        if (crossing) return `${name(crossing)} vắt qua mép vùng lặp. Cắt clip (C) tại mép hoặc dời cho nằm hẳn trong / ngoài vùng lặp.`;
        const after = state.clips.find((clip) => clip.start >= end);
        if (after) return `${name(after)} nằm sau vùng lặp nên không bao giờ chạy (vùng lặp chạy mãi tới khi nhả hotkey).`;
        if (!state.clips.some((clip) => clip.start >= start && clipEnd(clip) <= end)) return "Vùng lặp đang trống, hãy đặt clip vào trong.";
    }

    // Combo tự bấm đúng phím kích hoạt nó thì sẽ tự chạy lại mãi.
    if (state.hotkey) {
        const clash = state.clips.find((clip) => (clip.kind === "key" && clip.key === state.hotkey) ||
            (clip.kind === "mouse" && clip.button === state.hotkey));
        if (clash) return `${name(clash)} bấm chính hotkey ${hotkeyLabel(state.hotkey)} của combo, sẽ tự kích hoạt lại. Đổi hotkey hoặc clip đó.`;
    }
    return null;
}

// ── Hotkey của combo ────────────────────────────────────────────────────────
function startHotkeyCapture() {
    if (state.capturingHotkey || state.capturing || state.recording) return;
    state.capturingHotkey = true;
    updateHotkeyUI();
    window.addEventListener("keydown", captureKeyboardHotkey, true);
    window.addEventListener("mousedown", captureMouseHotkey, true);
}

function captureKeyboardHotkey(event) {
    if (event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
        stopHotkeyCapture();
        return;
    }

    state.hotkey = normaliseKeyboardHotkey(event);
    stopHotkeyCapture();
}

function captureMouseHotkey(event) {
    if (event.button === 0) {
        if (event.target.closest("button")) {
            stopHotkeyCapture();
            return;
        }
        return; // Không gán chuột trái làm bind key
    }

    if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
        return; // Không gán chuột phải làm bind key
    }

    event.preventDefault();
    event.stopPropagation();
    const mouseMap = { 1: "middle" };
    state.hotkey = mouseMap[event.button] ?? `mouse_${event.button}`;

    const preventNextMouseUp = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    window.addEventListener("mouseup", preventNextMouseUp, { capture: true, once: true });
    window.addEventListener("click", preventNextMouseUp, { capture: true, once: true });

    stopHotkeyCapture();
}

function stopHotkeyCapture() {
    state.capturingHotkey = false;
    window.removeEventListener("keydown", captureKeyboardHotkey, true);
    window.removeEventListener("mousedown", captureMouseHotkey, true);
    updateHotkeyUI();
}

function clearHotkey() {
    state.hotkey = null;
    stopHotkeyCapture();
}

function normaliseKeyboardHotkey(event) {
    const codeMap = {
        ShiftLeft: "shift",
        ShiftRight: "shift_r",
        ControlLeft: "ctrl",
        ControlRight: "ctrl_r",
        AltLeft: "alt",
        AltRight: "alt_gr",
        MetaLeft: "cmd",
        MetaRight: "cmd_r",
        CapsLock: "caps_lock",
        NumLock: "num_lock",
        ScrollLock: "scroll_lock",
        Space: "space",
        Enter: "enter",
        Backspace: "backspace",
        Tab: "tab",
        Delete: "delete",
        Insert: "insert",
        Escape: "esc",
        Home: "home",
        End: "end",
        PageUp: "page_up",
        PageDown: "page_down",
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        PrintScreen: "print_screen",
        Pause: "pause"
    };

    if (codeMap[event.code]) return codeMap[event.code];
    if (/^F\d{1,2}$/.test(event.code)) return event.code.toLowerCase();
    if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(event.code)) return event.code.slice(5);
    if (/^Numpad\d$/.test(event.code)) return event.code.slice(6);
    return event.key.length === 1 ? event.key.toLowerCase() : event.code.toLowerCase();
}

function updateHotkeyUI() {
    const { hotkeyCapture } = elements;
    hotkeyCapture.classList.toggle("is-listening", state.capturingHotkey);
    hotkeyCapture.classList.toggle("is-set", Boolean(state.hotkey));

    if (state.capturingHotkey) {
        hotkeyCapture.textContent = "Nhấn phím hoặc nút chuột… Esc để hủy";
    } else if (state.hotkey) {
        hotkeyCapture.textContent = hotkeyLabel(state.hotkey);
    } else {
        hotkeyCapture.textContent = "Nhấn để gán phím hoặc nút chuột";
    }
}

function hotkeyLabel(hotkey) {
    const labels = {
        shift: "Shift",
        shift_r: "Right Shift",
        ctrl: "Ctrl",
        ctrl_r: "Right Ctrl",
        alt: "Alt",
        alt_gr: "Right Alt",
        cmd: "LWin",
        cmd_r: "RWin",
        menu: "Apps",
        caps_lock: "CapsLock",
        num_lock: "NumLock",
        scroll_lock: "ScrollLock",
        num_lock_on: "NumLock ON",
        num_lock_off: "NumLock OFF",
        caps_lock_on: "CapsLock ON",
        caps_lock_off: "CapsLock OFF",
        scroll_lock_on: "ScrollLock ON",
        scroll_lock_off: "ScrollLock OFF",
        space: "Space",
        enter: "Enter",
        esc: "Esc",
        delete: "Delete",
        insert: "Insert",
        home: "Home",
        end: "End",
        page_up: "PgUp",
        page_down: "PgDn",
        backspace: "Backspace",
        tab: "Tab",
        print_screen: "PrtScn",
        pause: "Pause",
        break: "Break",
        ctrl_break: "Ctrl+Break",
        up: "↑",
        down: "↓",
        left: "←",
        right: "→",
        media_volume_up: "Vol+",
        media_volume_down: "Vol-",
        media_volume_mute: "Mute",
        media_play_pause: "MediaPlay",
        media_stop: "MediaStop",
        media_next: "MediaNext",
        media_previous: "MediaPrev",
        num_add: "Num+",
        num_sub: "Num-",
        num_dec: "Num.",
        num_div: "Num/",
        num_mul: "Num*",
        num_enter: "NumEnter",
        browser_back: "Back",
        browser_forward: "Forward",
        browser_stop: "Stop",
        browser_refresh: "Refresh",
        browser_home: "WebHome",
        browser_search: "Search",
        browser_favorites: "Favorites"
    };
    if (labels[hotkey]) return labels[hotkey];
    if (/^num_\d$/.test(hotkey)) return `Num${hotkey.slice(4)}`;
    if (/^f\d+$/.test(hotkey)) return hotkey.toUpperCase();
    if (/^(vkc|ext|sc|sce):/i.test(hotkey)) return hotkey.toUpperCase();
    if (/^mouse_\d+$/.test(hotkey)) return `mouse_${hotkey.slice(6)}`;
    if (/^mouse\d+$/.test(hotkey)) return `mouse_${hotkey.slice(5)}`;
    return hotkey.length === 1 ? hotkey.toUpperCase() : hotkey;
}

// ── Lưu combo ───────────────────────────────────────────────────────────────
function buildPythonSequence(steps) {
    return steps.flatMap((step, index) => (index === steps.length - 1 ? [step] : [step, "is_no_key_pressed"]));
}

function previewStep(step) {
    if (typeof step === "string") return `${ACTION_BY_FUNCTION.get(step)?.label ?? step}()   ← khối Skirk`;
    const type = STEP_TYPES[step.type];
    if (type.kind === "wait") return `  chờ ${step.ms} ms`;
    if (type.kind === "marker") return type.start ? "── bắt đầu lặp ──" : "── hết vòng, quay lại đầu vùng lặp ──";
    const target = type.kind === "key" ? hotkeyLabel(step.key || "?") : mouseLabel(step.button);
    return `${type.press ? "Nhấn" : "Nhả"} ${target}`;
}

function buildPreview() {
    if (!state.clips.length) return "Chưa có clip.";
    return compileClips().map(previewStep).join("\n");
}

function storedClips() {
    return state.clips.map(({ id, kind, key, button, fn, track, start, dur }) => {
        const out = { id, kind, track, start, dur };
        if (kind === "key") out.key = key;
        if (kind === "mouse") out.button = button;
        if (kind === "block") out.fn = fn;
        return out;
    });
}

async function saveCombo() {
    if (state.recording) stopRecording();
    if (state.playing) stopPlay();
    const name = elements.comboName.value.trim();
    if (!name) {
        showStatus("Nhập Tên Combo trước khi lưu.", "error");
        elements.comboName.focus();
        return;
    }
    if (!state.clips.length) {
        showStatus("Timeline cần ít nhất một clip.", "error");
        return;
    }
    const problem = validateClips();
    if (problem) {
        showStatus(problem, "error");
        return;
    }

    const steps = compileClips();
    const combo = {
        id: state.comboId,
        name,
        hotkey: state.hotkey,
        // clips + loop là bản gốc để mở lại trình tạo; timeline / pythonSequence là
        // bản biên dịch cho backend và các trang khác (đếm bước...).
        clips: storedClips(),
        loop: state.loop ? { ...state.loop } : null,
        timeline: steps,
        pythonSequence: buildPythonSequence(steps)
    };
    const customCombos = loadCustomCombos();
    const existingIndex = customCombos.findIndex((savedCombo) => savedCombo.id === combo.id);
    if (existingIndex === -1) customCombos.push(combo);
    else customCombos[existingIndex] = combo;

    localStorage.setItem(CUSTOM_COMBOS_STORAGE, JSON.stringify(customCombos));
    updateSavedCount();

    try {
        // Keep existing /save JSON transport. Python persists unknown fields in config.json.
        const response = await fetch("http://localhost:5000/save", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                comboSignKeys: loadJsonStorage(SIGN_KEYS_STORAGE, {}),
                FPS: Number(localStorage.getItem(FPS_STORAGE)) || 120,
                customCombos
            })
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        showStatus("Đã lưu Combo vào JSON.", "success");
    } catch {
        // Renderer still preserves data locally when backend has not started yet.
        showStatus("Đã lưu cục bộ. Backend chưa phản hồi.", "error");
    }
}

function loadCustomCombos() {
    const stored = loadJsonStorage(CUSTOM_COMBOS_STORAGE, []);
    return Array.isArray(stored) ? stored : [];
}

function loadJsonStorage(key, fallback) {
    try {
        return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
        return fallback;
    }
}

function updateSavedCount() {
    const count = loadCustomCombos().length;
    elements.savedCount.textContent = `${count} combo đã lưu`;
}

function showStatus(message, type = "") {
    elements.saveStatus.textContent = message;
    elements.saveStatus.className = `save-status${type ? ` is-${type}` : ""}`;
}

// Ô nhập chữ: Ctrl+C/V/A/Z ở đây phải giữ nguyên hành vi của trình duyệt.
function isTextField(event) {
    return event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement;
}

function isTypingInControl(event) {
    return event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLButtonElement;
}

function createId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function loadComboForEdit(id) {
    let combos = [];
    try {
        const res = await fetch("http://localhost:5000/config");
        if (res.ok) {
            const config = await res.json();
            combos = Array.isArray(config.customCombos) ? config.customCombos : [];
        }
    } catch {
        // Fallback to localStorage
        combos = loadCustomCombos();
    }

    const combo = combos.find(c => c.id === id);
    if (!combo) {
        showStatus("Không tìm thấy combo để chỉnh sửa.", "error");
        return;
    }

    state.comboId = combo.id;
    state.hotkey = combo.hotkey || null;
    let note = "";
    if (Array.isArray(combo.clips)) {
        state.clips = combo.clips
            .filter((clip) => ["key", "mouse", "block"].includes(clip?.kind))
            .map((clip) => ({ ...makeClip(clip), id: clip.id || createId() }));
        state.loop = combo.loop && combo.loop.end > combo.loop.start ? { start: combo.loop.start, end: combo.loop.end } : null;
    } else {
        // Combo cũ dạng danh sách bước: dựng lại thành clip.
        const built = stepsToClips(combo.timeline || []);
        state.clips = built.clips;
        state.loop = built.loop;
        note = " (chuyển từ dạng danh sách cũ)";
    }
    state.tracks = MIN_TRACKS;
    state.playhead = 0;
    state.activeTrack = 0;
    resetHistory();
    clearSelection();
    elements.comboName.value = combo.name || "";
    updateHotkeyUI();
    render();
    zoomToFit();
    showStatus(`Đang chỉnh sửa: ${combo.name}${note}`);
}

function createNewCombo() {
    if (state.recording) stopRecording();
    if (state.playing) stopPlay();
    state.comboId = createId();
    state.clips = [];
    state.loop = null;
    state.tracks = MIN_TRACKS;
    state.playhead = 0;
    state.activeTrack = 0;
    state.hotkey = null;
    resetHistory();
    clearSelection();
    elements.comboName.value = "";
    updateHotkeyUI();
    render();
    try {
        window.history.replaceState({}, "", window.location.pathname);
    } catch {}
    showStatus("Sẵn sàng tạo Combo mới.");
    elements.comboName.focus();
}

function openBasicMode() {
    if (state.recording) stopRecording();
    if (state.playing) stopPlay();
    const name = elements.comboName ? elements.comboName.value.trim() : "";
    const sortedBlocks = state.clips
        .filter((clip) => clip.kind === "block" && ACTION_BY_FUNCTION.has(clip.fn))
        .sort((a, b) => a.start - b.start || a.track - b.track)
        .map((clip) => clip.fn);
    if (name || state.hotkey || sortedBlocks.length > 0) {
        try {
            sessionStorage.setItem("cuscombo_draft", JSON.stringify({
                comboId: state.comboId,
                name,
                hotkey: state.hotkey,
                timeline: sortedBlocks
            }));
        } catch {}
    } else {
        try { sessionStorage.removeItem("cuscombo_draft"); } catch {}
    }
    window.location.href = "cuscombo.html";
}

// ── Import / Export theo định dạng ràng buộc trong import.md ─────────────────

// 3. Modifier tags (chỉ áp dụng cho phím kế tiếp trừ khi đi cùng {PRESS}/{RELEASE})
const MODIFIER_TAG_TO_KEY = Object.freeze({
    CTRL: "ctrl",
    RCTRL: "ctrl_r",
    ALT: "alt",
    RALT: "alt_gr",
    SHIFT: "shift",
    RSHIFT: "shift_r",
    LWIN: "cmd",
    RWIN: "cmd_r",
    APPS: "menu"
});

const KEY_TO_MODIFIER_TAG = Object.freeze(
    Object.fromEntries(Object.entries(MODIFIER_TAG_TO_KEY).map(([tag, key]) => [key, tag]))
);

// 4–8, 11–13. Extended, Direction, Function, Volume, Media, Numpad, Browser, Toggle key tags
const SPECIAL_TAG_TO_KEY = (() => {
    const map = {
        // 4. Extended keys
        DEL: "delete",
        DELETE: "delete",
        INS: "insert",
        PGUP: "page_up",
        PGDN: "page_down",
        HOME: "home",
        END: "end",
        RETURN: "enter",
        ENTER: "enter",
        ESCAPE: "esc",
        ESC: "esc",
        BACKSPACE: "backspace",
        TAB: "tab",
        PRTSCN: "print_screen",
        PAUSE: "pause",
        SPACE: "space",
        CAPSLOCK: "caps_lock",
        NUMLOCK: "num_lock",
        SCROLLLOCK: "scroll_lock",
        BREAK: "break",
        CTRLBREAK: "ctrl_break",
        // 5. Direction keys
        UP: "up",
        DOWN: "down",
        LEFT: "left",
        RIGHT: "right",
        // 7. Volume keys
        "VOL+": "media_volume_up",
        "VOL-": "media_volume_down",
        MUTE: "media_volume_mute",
        // 8. Media keys
        MEDIAPLAY: "media_play_pause",
        MEDIASTOP: "media_stop",
        MEDIANEXT: "media_next",
        MEDIAPREV: "media_previous",
        // 11. Numeric keypad tags
        "NUM+": "num_add",
        "NUM-": "num_sub",
        "NUM.": "num_dec",
        "NUM/": "num_div",
        "NUM*": "num_mul",
        NUMENTER: "num_enter",
        // 12. Web / Browser keys
        BACK: "browser_back",
        FORWARD: "browser_forward",
        STOP: "browser_stop",
        REFRESH: "browser_refresh",
        WEBHOME: "browser_home",
        SEARCH: "browser_search",
        FAVORITES: "browser_favorites",
        // 13. Toggle key tags
        NUMLOCKON: "num_lock_on",
        NUMLOCKOFF: "num_lock_off",
        CAPSLOCKON: "caps_lock_on",
        CAPSLOCKOFF: "caps_lock_off",
        SCROLLLOCKON: "scroll_lock_on",
        SCROLLLOCKOFF: "scroll_lock_off"
    };
    for (let i = 1; i <= 24; i += 1) map[`F${i}`] = `f${i}`;
    for (let d = 0; d <= 9; d += 1) map[`NUM${d}`] = `num_${d}`;
    return Object.freeze(map);
})();

// Tên tag chuẩn khi Export (ưu tiên đúng tên trong import.md)
const KEY_TO_CANONICAL_TAG = (() => {
    const map = {
        ...KEY_TO_MODIFIER_TAG,
        delete: "DEL",
        insert: "INS",
        page_up: "PGUP",
        page_down: "PGDN",
        home: "HOME",
        end: "END",
        enter: "RETURN",
        esc: "ESCAPE",
        backspace: "BACKSPACE",
        tab: "TAB",
        print_screen: "PRTSCN",
        pause: "PAUSE",
        space: "SPACE",
        caps_lock: "CAPSLOCK",
        num_lock: "NUMLOCK",
        scroll_lock: "SCROLLLOCK",
        break: "BREAK",
        ctrl_break: "CTRLBREAK",
        up: "UP",
        down: "DOWN",
        left: "LEFT",
        right: "RIGHT",
        media_volume_up: "VOL+",
        media_volume_down: "VOL-",
        media_volume_mute: "MUTE",
        media_play_pause: "MEDIAPLAY",
        media_stop: "MEDIASTOP",
        media_next: "MEDIANEXT",
        media_previous: "MEDIAPREV",
        num_add: "NUM+",
        num_sub: "NUM-",
        num_dec: "NUM.",
        num_div: "NUM/",
        num_mul: "NUM*",
        num_enter: "NUMENTER",
        browser_back: "BACK",
        browser_forward: "FORWARD",
        browser_stop: "STOP",
        browser_refresh: "REFRESH",
        browser_home: "WEBHOME",
        browser_search: "SEARCH",
        browser_favorites: "FAVORITES",
        num_lock_on: "NUMLOCKON",
        num_lock_off: "NUMLOCKOFF",
        caps_lock_on: "CAPSLOCKON",
        caps_lock_off: "CAPSLOCKOFF",
        scroll_lock_on: "SCROLLLOCKON",
        scroll_lock_off: "SCROLLLOCKOFF"
    };
    for (let i = 1; i <= 24; i += 1) map[`f${i}`] = `F${i}`;
    for (let d = 0; d <= 9; d += 1) map[`num_${d}`] = `NUM${d}`;
    return Object.freeze(map);
})();

// 9. Mouse button tags
const MOUSE_TAG_TO_SPEC = Object.freeze({
    LMB:        { button: "left",    action: "tap",  downTag: "LMBD", upTag: "LMBU" },
    LMBD:       { button: "left",    action: "down", downTag: "LMBD", upTag: "LMBU" },
    LMBU:       { button: "left",    action: "up",   downTag: "LMBD", upTag: "LMBU" },
    RMB:        { button: "right",   action: "tap",  downTag: "RMBD", upTag: "RMBU" },
    RMBD:       { button: "right",   action: "down", downTag: "RMBD", upTag: "RMBU" },
    RMBU:       { button: "right",   action: "up",   downTag: "RMBD", upTag: "RMBU" },
    MMB:        { button: "middle",  action: "tap",  downTag: "MMBD", upTag: "MMBU" },
    MMBD:       { button: "middle",  action: "down", downTag: "MMBD", upTag: "MMBU" },
    MMBU:       { button: "middle",  action: "up",   downTag: "MMBD", upTag: "MMBU" },
    MB4:        { button: "mouse_3", action: "tap",  downTag: "MB4D", upTag: "MB4U" },
    XMB1:       { button: "mouse_3", action: "tap",  downTag: "MB4D", upTag: "MB4U" },
    "MB4/XMB1": { button: "mouse_3", action: "tap",  downTag: "MB4D", upTag: "MB4U" },
    MB4D:       { button: "mouse_3", action: "down", downTag: "MB4D", upTag: "MB4U" },
    XMB1D:      { button: "mouse_3", action: "down", downTag: "MB4D", upTag: "MB4U" },
    MB4U:       { button: "mouse_3", action: "up",   downTag: "MB4D", upTag: "MB4U" },
    XMB1U:      { button: "mouse_3", action: "up",   downTag: "MB4D", upTag: "MB4U" },
    MB5:        { button: "mouse_4", action: "tap",  downTag: "MB5D", upTag: "MB5U" },
    XMB2:       { button: "mouse_4", action: "tap",  downTag: "MB5D", upTag: "MB5U" },
    "MB5/XMB2": { button: "mouse_4", action: "tap",  downTag: "MB5D", upTag: "MB5U" },
    MB5D:       { button: "mouse_4", action: "down", downTag: "MB5D", upTag: "MB5U" },
    XMB2D:      { button: "mouse_4", action: "down", downTag: "MB5D", upTag: "MB5U" },
    MB5U:       { button: "mouse_4", action: "up",   downTag: "MB5D", upTag: "MB5U" },
    XMB2U:      { button: "mouse_4", action: "up",   downTag: "MB5D", upTag: "MB5U" }
});

const MOUSE_BUTTON_TO_TAGS = Object.freeze({
    left:    { tap: "{LMB}", down: "{LMBD}", up: "{LMBU}" },
    right:   { tap: "{RMB}", down: "{RMBD}", up: "{RMBU}" },
    middle:  { tap: "{MMB}", down: "{MMBD}", up: "{MMBU}" },
    mouse_3: { tap: "{MB4}", down: "{MB4D}", up: "{MB4U}" },
    mouse_4: { tap: "{MB5}", down: "{MB5D}", up: "{MB5U}" }
});

// 10, 17, 21. Các tag hợp lệ không tham số của hệ thống / chuột cuộn / điều kiện nút
const VALID_SYSTEM_NOARG_TAGS = new Set([
    "MWUP", "MWDN", "TILTL", "TILTR",
    "ACTIVATE", "ACTIVATEPARENT", "ACTIVATETOP",
    "CURSORBUSY", "CURSORDEFAULT",
    "INVERTXY", "INVERTX", "INVERTY",
    "LOCKXY", "LOCKX", "LOCKY", "LOCKC",
    "UNLOCKXY", "UNLOCKX", "UNLOCKY",
    "OD", "OU", "OR"
]);

function getDefaultTapMs() {
    const val = Number(elements.ioDefaultTapMs?.value);
    return val >= 1 && val <= 10000 ? Math.round(val) : 50;
}

function formatKeyAsMacroToken(key) {
    if (!key) return "";
    const tag = KEY_TO_CANONICAL_TAG[key];
    if (tag) return `{${tag}}`;
    if (/^(vkc|ext|sc|sce):/i.test(key)) {
        return `{${key.toUpperCase()}}`;
    }
    return key.length === 1 ? key.toLowerCase() : `{${key.toUpperCase()}}`;
}

function isModifierKey(key) {
    return Boolean(KEY_TO_MODIFIER_TAG[key]);
}

// Mở rộng khối Skirk (kind === "block") thành các clip phím / chuột tương đương theo FPS hiện tại
function expandBlockClipForExport(blockClip, fps = currentFps()) {
    const s0 = blockClip.start;
    const invMs = 1000 / fps;
    const tapMs = Math.max(1, Math.round(invMs));
    const step2Ms = Math.max(2, Math.round(2 * invMs));
    const step3Ms = Math.max(3, Math.round(3 * invMs));
    const fn = blockClip.fn;
    const out = [];
    const pushMouse = (button, relStartMs, durMs) => {
        out.push({ kind: "mouse", button, start: Math.round(s0 + relStartMs), dur: Math.max(1, Math.round(durMs)) });
    };
    const pushKey = (key, relStartMs, durMs) => {
        out.push({ kind: "key", key, start: Math.round(s0 + relStartMs), dur: Math.max(1, Math.round(durMs)) });
    };
    const spamLeft = (countFactor, limitSec, holdFrames = 1, cycleFrames = 2) => {
        const count = Math.floor(countFactor * fps);
        const limitMs = limitSec * 1000;
        const holdDur = Math.max(1, Math.round(holdFrames * invMs));
        const cycleDur = Math.max(holdDur + 1, Math.round(cycleFrames * invMs));
        let elapsed = 0;
        for (let k = 0; k < count; k += 1) {
            if (elapsed > limitMs - 1e-6) break;
            pushMouse("left", elapsed, holdDur);
            elapsed += cycleDur;
        }
        return elapsed;
    };

    if (/^wait_\d+$/.test(fn)) return out;

    if (fn === "skke") {
        const count = Math.floor(0.1 * fps);
        const cycle = Math.max(2, step2Ms);
        let elapsed = 0;
        for (let k = 0; k < count; k += 1) {
            if (elapsed > 100 - 1e-6) break;
            pushKey("e", elapsed, tapMs);
            elapsed += cycle;
        }
        return out;
    }
    if (fn === "skk2a") {
        spamLeft(0.26, 0.32);
        return out;
    }
    if (fn === "skk2as") {
        spamLeft(0.26, 0.32);
        const t1 = fps2t(FPS_TABLES.T_2AS_FIRST, fps) * 1000;
        pushMouse("right", t1, tapMs);
        pushKey("w", t1 + 2 * invMs, tapMs);
        return out;
    }
    if (fn === "skk2az") {
        const t1 = fps2t(FPS_TABLES.T_2AZ_FIRST, fps);
        spamLeft(0.2, t1);
        pushMouse("left", (t1 + 2 / fps) * 1000, 440);
        return out;
    }
    if (fn === "skk2azs" || (fn === "skk2azs_slow" && fps < 105)) {
        const t1 = fps2t(FPS_TABLES.T_2AZ_FIRST, fps);
        spamLeft(0.2, t1);
        const holdStart = (t1 + 2 / fps) * 1000;
        pushMouse("left", holdStart, 440);
        const rStart = holdStart + 440 + invMs;
        pushMouse("right", rStart, tapMs);
        pushKey("w", rStart + 2 * invMs, tapMs);
        return out;
    }
    if (fn === "skk2azs_slow") {
        spamLeft(0.2, 0.26);
        pushMouse("left", 280, 440);
        pushMouse("right", 725, tapMs);
        pushKey("w", 725 + 2 * invMs, tapMs);
        return out;
    }
    if (fn === "skk2aq") {
        const elapsed = spamLeft(0.26, 0.32);
        const qStart = Math.max(elapsed, 400);
        pushKey("q", qStart, tapMs);
        return out;
    }
    if (fn === "skk3as") {
        const elapsed = spamLeft(0.6, 0.6, 1, 3);
        const frame = fps2t(FPS_TABLES.F_3AS, fps);
        pushMouse("right", elapsed + frame * invMs, tapMs);
        return out;
    }
    if (fn === "skk3aw") {
        spamLeft(0.6, 0.6);
        const t = fps2t(FPS_TABLES.T_3AW, fps) * 1000;
        pushKey("w", t, tapMs);
        return out;
    }
    if (fn === "skk5a") {
        spamLeft(2.0, 2.1);
        return out;
    }
    if (fn === "skk5as") {
        spamLeft(2.0, 2.1);
        const t = (fps2t(FPS_TABLES.T_5A, fps) + 2 / fps) * 1000;
        pushMouse("right", t, tapMs);
        return out;
    }
    // Dự phòng cho khối legacy: chuyển thành nhấn chuột trái
    pushMouse("left", 0, Math.max(1, blockClip.dur || DEFAULT_BLOCK_MS));
    return out;
}

// ── Export: Timeline nhiều track → chuỗi lệnh chuẩn import.md ───────────────
function exportClipsToMacroText(clips = state.clips) {
    if (!Array.isArray(clips) || !clips.length) return "";

    // 1. Chuẩn hóa danh sách clip (bung các khối Skirk nếu có)
    const flatClips = [];
    let minTotalEnd = 0;
    clips.forEach((clip) => {
        minTotalEnd = Math.max(minTotalEnd, clipEnd(clip));
        if (clip.kind === "block") {
            const expanded = expandBlockClipForExport(clip);
            expanded.forEach((sub, idx) => {
                flatClips.push({
                    id: `${clip.id}_${idx}`,
                    kind: sub.kind,
                    key: sub.key,
                    button: sub.button,
                    start: clampMs(sub.start),
                    dur: Math.max(1, clampMs(sub.dur)),
                    track: clip.track
                });
            });
        } else if (clip.kind === "key" && clip.key) {
            flatClips.push({
                id: clip.id,
                kind: "key",
                key: clip.key,
                start: clampMs(clip.start),
                dur: Math.max(1, clampMs(clip.dur)),
                track: clip.track ?? 0
            });
        } else if (clip.kind === "mouse" && clip.button) {
            flatClips.push({
                id: clip.id,
                kind: "mouse",
                button: clip.button,
                start: clampMs(clip.start),
                dur: Math.max(1, clampMs(clip.dur)),
                track: clip.track ?? 0
            });
        }
    });

    if (!flatClips.length) return "";

    // 2. Gom các nhóm tại cùng [start, end] có thể rút gọn thành {HOLDMS:dur}{MOD...}<key>
    // Điều kiện rút gọn:
    // - Mọi clip trong nhóm đều là phím (kind === "key"), có đúng 1 phím thường + >=0 phím modifier khác nhau
    // - Không có bất kỳ clip nào khác ngoài nhóm bắt đầu tại s, kết thúc tại e, hoặc có mốc bắt đầu/kết thúc nằm trong (s, e)
    const bySpan = new Map();
    flatClips.forEach((clip) => {
        const e = clip.start + clip.dur;
        const k = `${clip.start}:${e}`;
        if (!bySpan.has(k)) bySpan.set(k, []);
        bySpan.get(k).push(clip);
    });

    const holdGroups = new Map(); // spanKey -> { start, end, dur, modifiers, mainClip }
    const inHoldGroup = new Set();

    bySpan.forEach((group, spanKey) => {
        const s = group[0].start;
        const e = s + group[0].dur;
        if (!group.every((c) => c.kind === "key")) return;
        const modifiers = group.filter((c) => isModifierKey(c.key));
        const nonModifiers = group.filter((c) => !isModifierKey(c.key));
        if (nonModifiers.length !== 1) return;
        const modKeys = new Set(modifiers.map((m) => m.key));
        if (modKeys.size !== modifiers.length) return;

        const hasInterference = flatClips.some((other) => {
            if (group.includes(other)) return false;
            const oe = other.start + other.dur;
            if (other.start === s || oe === e) return true;
            if (other.start > s && other.start < e) return true;
            if (oe > s && oe < e) return true;
            return false;
        });
        if (hasInterference) return;

        modifiers.sort((a, b) => a.track - b.track);
        holdGroups.set(spanKey, {
            start: s,
            end: e,
            dur: e - s,
            modifiers,
            mainClip: nonModifiers[0]
        });
        group.forEach((c) => inHoldGroup.add(c.id));
    });

    // 3. Tạo danh sách sự kiện theo trục thời gian
    // Thứ tự tại cùng thời điểm t:
    //   order 0: nhả phím/chuột ({RELEASE} / {LMBU}) theo thứ tự LIFO (track lớn nhả trước)
    //   order 1: nhóm {HOLDMS:dur} độc lập
    //   order 2: nhấn giữ phím/chuột ({PRESS} / {LMBD}) theo thứ tự track tăng dần
    const events = [];
    holdGroups.forEach((hg) => {
        const modTokens = hg.modifiers.map((m) => `{${KEY_TO_MODIFIER_TAG[m.key]}}`).join("");
        const mainToken = formatKeyAsMacroToken(hg.mainClip.key);
        events.push({
            t: hg.start,
            order: 1,
            track: hg.mainClip.track,
            token: `{HOLDMS:${hg.dur}}${modTokens}${mainToken}`,
            advanceMs: hg.dur
        });
    });

    flatClips.forEach((clip) => {
        if (inHoldGroup.has(clip.id)) return;
        const s = clip.start;
        const e = clip.start + clip.dur;
        if (clip.kind === "mouse") {
            const tags = MOUSE_BUTTON_TO_TAGS[clip.button] || MOUSE_BUTTON_TO_TAGS.left;
            events.push({ t: s, order: 2, track: clip.track, token: tags.down, advanceMs: 0 });
            events.push({ t: e, order: 0, track: -clip.track, token: tags.up, advanceMs: 0 });
        } else {
            const keyToken = formatKeyAsMacroToken(clip.key);
            events.push({ t: s, order: 2, track: clip.track, token: `{PRESS}${keyToken}`, advanceMs: 0 });
            events.push({ t: e, order: 0, track: -clip.track, token: `{RELEASE}${keyToken}`, advanceMs: 0 });
        }
    });

    events.sort((a, b) => a.t - b.t || a.order - b.order || a.track - b.track);

    const out = [];
    let cursor = 0;
    events.forEach((ev) => {
        const gap = Math.round(ev.t - cursor);
        if (gap > 0) {
            out.push(`{WAITMS:${gap}}`);
            cursor += gap;
        }
        out.push(ev.token);
        if (ev.advanceMs > 0) {
            cursor += ev.advanceMs;
        }
    });

    // Nếu có khối Skirk có thời gian chờ cuối khối (như skke chờ 190ms sau khi bấm E), giữ nguyên khoảng chờ cuối
    if (minTotalEnd > cursor) {
        out.push(`{WAITMS:${Math.round(minTotalEnd - cursor)}}`);
    }

    return out.join("");
}

// ── Import: Phân tích chuỗi lệnh theo quy tắc import.md → Clip đa track ─────
function tokenizeMacroSequence(rawText) {
    const tokens = [];
    let i = 0;
    const len = rawText.length;

    while (i < len) {
        const ch = rawText[i];
        // Bỏ qua ký tự xuống dòng định dạng ngoài tag
        if (ch === "\r" || ch === "\n") {
            i += 1;
            continue;
        }
        if (ch === "}") {
            return { error: `Lỗi cú pháp tại vị trí ${i + 1}: gặp dấu '}' thừa không có '{' mở tương ứng.` };
        }
        if (ch === "{") {
            const closeIdx = rawText.indexOf("}", i + 1);
            if (closeIdx === -1) {
                return { error: `Lỗi cú pháp tại vị trí ${i + 1}: thẻ '{' chưa được đóng bằng dấu '}'.` };
            }
            const inside = rawText.slice(i + 1, closeIdx);
            if (!inside.trim()) {
                return { error: `Lỗi cú pháp tại vị trí ${i + 1}: thẻ rỗng '{}'.` };
            }
            tokens.push({ type: "tag", raw: inside, full: `{${inside}}`, pos: i });
            i = closeIdx + 1;
            continue;
        }

        // Hỗ trợ mẫu "{CTRL}{ALT}DELETE" ở mục 3 trong import.md (DELETE viết liền sau modifier)
        const prev = tokens[tokens.length - 1];
        const prevIsModOrPress = prev && prev.type === "tag" && (
            MODIFIER_TAG_TO_KEY[prev.raw.toUpperCase()] ||
            prev.raw.toUpperCase() === "PRESS" ||
            prev.raw.toUpperCase() === "RELEASE"
        );
        if (prevIsModOrPress && rawText.slice(i, i + 6).toUpperCase() === "DELETE") {
            const nextCh = rawText[i + 6];
            if (!nextCh || nextCh === "{" || nextCh === "\r" || nextCh === "\n" || nextCh === " ") {
                tokens.push({ type: "tag", raw: "DEL", full: "DELETE", pos: i });
                i += 6;
                continue;
            }
        }

        tokens.push({ type: "char", char: ch, pos: i });
        i += 1;
    }

    return { tokens };
}

function parseDecOrHexInt(str) {
    const trimmed = String(str).trim();
    if (!/^[+-]?(0x[0-9a-fA-F]+|\d+)$/.test(trimmed)) return null;
    const val = Number(trimmed);
    return Number.isInteger(val) ? val : null;
}

function classifyMacroTag(raw, full) {
    const upper = raw.trim().toUpperCase();

    // 20. PRESS / RELEASE
    if (upper === "PRESS") return { category: "press_mode", mode: "press", full };
    if (upper === "RELEASE") return { category: "press_mode", mode: "release", full };

    // 14.4. CLEAR
    if (upper === "CLEAR") return { category: "clear", full };

    // 3. Modifier tags
    if (MODIFIER_TAG_TO_KEY[upper]) {
        return { category: "modifier", key: MODIFIER_TAG_TO_KEY[upper], tag: upper, full };
    }

    // 4–8, 11–13. Extended / Direction / Function / Volume / Media / Numpad / Browser / Toggle keys
    if (SPECIAL_TAG_TO_KEY[upper]) {
        return { category: "key", key: SPECIAL_TAG_TO_KEY[upper], full };
    }

    // 9. Mouse button tags
    if (MOUSE_TAG_TO_SPEC[upper]) {
        return { category: "mouse", ...MOUSE_TAG_TO_SPEC[upper], tag: upper, full };
    }

    // 10, 17, 21. Các tag hệ thống không tham số
    if (VALID_SYSTEM_NOARG_TAGS.has(upper)) {
        return { category: "system", full };
    }

    // 20. Biến thể {WAITMS100} không có dấu ':' được đề cập ở mục 20 & 24 của import.md
    const waitMsNoColon = /^WAITMS(\d+(?:\.\d+)?)$/.exec(upper);
    if (waitMsNoColon) {
        const ms = Math.round(Number(waitMsNoColon[1]));
        return { category: "wait", ms, full, note: `${full} → chờ ${ms} ms` };
    }

    // Các tag có tham số phân tách bởi ':'
    const colonIdx = raw.indexOf(":");
    if (colonIdx !== -1) {
        const prefix = raw.slice(0, colonIdx).trim().toUpperCase();
        const param = raw.slice(colonIdx + 1);
        const paramTrim = param.trim();

        // 14.1. Delay: {WAIT:n}, {WAITMS:n}, {WAITMS:x-y}
        if (prefix === "WAIT") {
            const sec = Number(paramTrim);
            if (!paramTrim || !Number.isFinite(sec) || sec < 0) {
                return { error: `Tham số thời gian không hợp lệ trong ${full} (cần số giây >= 0).` };
            }
            return { category: "wait", ms: Math.round(sec * 1000), full };
        }
        if (prefix === "WAITMS") {
            const rangeMatch = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/.exec(paramTrim);
            if (rangeMatch) {
                const x = Number(rangeMatch[1]);
                const y = Number(rangeMatch[2]);
                if (x > y) {
                    return { error: `Khoảng thời gian ngẫu nhiên không hợp lệ trong ${full} (${x} > ${y}).` };
                }
                const mid = Math.round((x + y) / 2);
                return {
                    category: "wait",
                    ms: mid,
                    full,
                    note: `${full} (ngẫu nhiên ${x}–${y} ms) được đặt trung bình ${mid} ms trên timeline.`
                };
            }
            const ms = Number(paramTrim);
            if (!paramTrim || !Number.isFinite(ms) || ms < 0) {
                return { error: `Tham số thời gian không hợp lệ trong ${full} (cần số ms >= 0 hoặc x-y).` };
            }
            return { category: "wait", ms: Math.round(ms), full };
        }

        // 14.2. Giữ phím: {HOLD:n}, {HOLDMS:n}
        if (prefix === "HOLD") {
            const sec = Number(paramTrim);
            if (!paramTrim || !Number.isFinite(sec) || sec <= 0) {
                return { error: `Tham số giữ phím không hợp lệ trong ${full} (cần số giây > 0).` };
            }
            return { category: "hold", ms: Math.max(1, Math.round(sec * 1000)), full };
        }
        if (prefix === "HOLDMS") {
            const ms = Number(paramTrim);
            if (!paramTrim || !Number.isFinite(ms) || ms <= 0) {
                return { error: `Tham số giữ phím không hợp lệ trong ${full} (cần số ms > 0).` };
            }
            return { category: "hold", ms: Math.max(1, Math.round(ms)), full };
        }

        // 14.3. Mã phím cấp thấp: {VKC:n}, {EXT:n}, {SC:n}, {SCE:n}
        if (prefix === "VKC" || prefix === "EXT" || prefix === "SC" || prefix === "SCE") {
            const code = parseDecOrHexInt(paramTrim);
            if (code === null || code < 0) {
                return { error: `Mã phím cấp thấp trong ${full} phải là số nguyên hợp lệ.` };
            }
            return { category: "key", key: `${prefix.toLowerCase()}:${paramTrim}`, full };
        }

        // 14.4. Clipboard: {CB:<text>}
        if (prefix === "CB") {
            return { category: "system", full };
        }

        // 15. Movement tags: {MADD:x,y}, {MSET:x,y}, {PSET:x,y}, {ASET:x,y}, {MSAVE:n}, {MREST:n}
        if (prefix === "MADD" || prefix === "MSET" || prefix === "PSET" || prefix === "ASET") {
            const parts = paramTrim.split(",");
            if (parts.length !== 2 || parseDecOrHexInt(parts[0]) === null || parseDecOrHexInt(parts[1]) === null) {
                return { error: `Tọa độ trong ${full} phải có dạng x,y (hai số nguyên).` };
            }
            return { category: "system", full };
        }
        if (prefix === "MSAVE" || prefix === "MREST") {
            const slot = parseDecOrHexInt(paramTrim);
            if (slot === null || slot < 1 || slot > 10) {
                return { error: `Ô nhớ vị trí con trỏ trong ${full} phải từ 1 đến 10 (theo mục 15 import.md).` };
            }
            return { category: "system", full };
        }

        // 16. Application tags: {RUN:...}, {RUNHID:...}, {RUNMAX:...}, {RUNMIN:...}, {RUNADM:...}, {KILL:...}
        if (["RUN", "RUNHID", "RUNMAX", "RUNMIN", "RUNADM"].includes(prefix)) {
            if (!paramTrim || !/\.exe(\s.*)?$/i.test(paramTrim)) {
                return { error: `Quy tắc mục 16 import.md: ${full} phải cung cấp đường dẫn bao gồm phần mở rộng .EXE.` };
            }
            return { category: "system", full };
        }
        if (prefix === "KILL") {
            if (!paramTrim) {
                return { error: `Thiếu tên executable trong ${full}.` };
            }
            return { category: "system", full };
        }

        // 18. Windows Message tags: {POSTWM:<M>,<L>,<W>}, {SENDWM:<M>,<L>,<W>}
        if (prefix === "POSTWM" || prefix === "SENDWM") {
            const parts = paramTrim.split(",");
            if (parts.length !== 3 || parts.some((p) => parseDecOrHexInt(p) === null)) {
                return { error: `Tham số trong ${full} phải gồm 3 giá trị số <M>,<L>,<W> (thập phân hoặc 0x hex).` };
            }
            return { category: "system", full };
        }

        // 19. Layer modifier tags: {LAYER:x}, {LAYER:next}, {LAYER:back}, {LAYER:last}
        if (prefix === "LAYER") {
            const lower = paramTrim.toLowerCase();
            if (!["next", "back", "last"].includes(lower) && parseDecOrHexInt(paramTrim) === null) {
                return { error: `Tham số layer trong ${full} phải là số hoặc next/back/last.` };
            }
            return { category: "system", full };
        }
    }

    // 8. Đối với tag không rõ hoặc sai định dạng, không đoán tác dụng — báo lại tag cần xác minh
    return { error: `Tag không xác định hoặc sai định dạng theo import.md: ${full}` };
}

// Phân bổ danh sách clip lên nhiều track khi các sự kiện xảy ra đồng thời:
// Các clip trùng hoặc giao khoảng thời gian [start, start + dur) sẽ được xếp lên các track song song (T1, T2, T3...).
function allocateMultiTrackClips(rawClips) {
    const sorted = rawClips.slice().sort((a, b) => (
        a.start - b.start ||
        a.order - b.order ||
        b.dur - a.dur
    ));
    const trackEnds = [];
    let maxConcurrentTracks = 0;

    const clips = sorted.map((item) => {
        let track = trackEnds.findIndex((endMs) => endMs <= item.start);
        if (track === -1) {
            track = trackEnds.length;
            trackEnds.push(0);
        }
        trackEnds[track] = item.start + item.dur;
        maxConcurrentTracks = Math.max(maxConcurrentTracks, track + 1);

        const clip = makeClip({
            kind: item.kind,
            key: item.key,
            button: item.button,
            start: item.start,
            dur: item.dur,
            track
        });
        return clip;
    });

    return { clips, maxConcurrentTracks };
}

function parseMacroSequence(rawText, { defaultTapMs = 50 } = {}) {
    const trimmed = String(rawText ?? "").trim();
    if (!trimmed) {
        return { clips: [], maxConcurrentTracks: 0, totalMs: 0, notes: [], systemTags: [] };
    }

    const tokenized = tokenizeMacroSequence(trimmed);
    if (tokenized.error) return { error: tokenized.error };

    const rawClips = [];
    const notes = [];
    const systemTags = [];
    let orderCounter = 0;
    let t = 0;

    let pendingModifiers = [];   // [{ key, full }]
    let pendingHold = null;      // { ms, full }
    let pressReleaseMode = null; // { mode: "press" | "release", full, consumed: number }

    // Quản lý các phím/chuột đang được giữ bởi {PRESS} hoặc {LMBD}/{RMBD}...
    // targetId -> { kind, key, button, start, order, source: "press" | "mousedown", openTag, expectedCloseTag, label }
    const openHolds = new Map();

    const addRawClip = (spec) => {
        rawClips.push({
            ...spec,
            start: clampMs(spec.start),
            dur: Math.max(1, clampMs(spec.dur)),
            order: spec.order ?? (orderCounter += 1)
        });
    };

    const handleTargetInput = (target, tokenDesc) => {
        const targetId = target.kind === "key" ? `key:${target.key}` : `mouse:${target.button}`;
        const label = target.kind === "key" ? hotkeyLabel(target.key) : mouseLabel(target.button);

        // Trường hợp đang trong chế độ {PRESS} hoặc {RELEASE}
        if (pressReleaseMode) {
            if (pendingHold) {
                return `Không thể kết hợp ${pendingHold.full} bên trong ${pressReleaseMode.full} (tại ${tokenDesc}).`;
            }
            if (pendingModifiers.length > 0) {
                return `Modifier ${pendingModifiers.map((m) => m.full).join("")} không thể đứng trước ${pressReleaseMode.full}. Hãy dùng {PRESS}${pendingModifiers[0].full}...{RELEASE}${pendingModifiers[0].full}.`;
            }

            if (pressReleaseMode.mode === "press") {
                if (openHolds.has(targetId)) {
                    const existing = openHolds.get(targetId);
                    return `Phím/nút "${label}" (${tokenDesc}) đã được nhấn giữ tại ${existing.start} ms bằng ${existing.openTag} nhưng chưa được thả trước khi nhấn lại.`;
                }
                openHolds.set(targetId, {
                    kind: target.kind,
                    key: target.key,
                    button: target.button,
                    start: t,
                    order: (orderCounter += 1),
                    source: "press",
                    openTag: `{PRESS}${tokenDesc}`,
                    expectedCloseTag: `{RELEASE}${tokenDesc}`,
                    label
                });
                pressReleaseMode.consumed += 1;
                return null;
            }

            // mode === "release"
            const existing = openHolds.get(targetId);
            if (!existing || existing.source !== "press") {
                return `Gặp {RELEASE}${tokenDesc} tại ${t} ms nhưng "${label}" chưa được nhấn bằng {PRESS} trước đó (vi phạm quy tắc mục 20 import.md).`;
            }
            const dur = Math.max(1, t - existing.start);
            addRawClip({
                kind: existing.kind,
                key: existing.key,
                button: existing.button,
                start: existing.start,
                dur,
                order: existing.order
            });
            openHolds.delete(targetId);
            pressReleaseMode.consumed += 1;
            return null;
        }

        // Trường hợp gõ phím / click chuột thông thường hoặc có {HOLD:n} / {HOLDMS:n} và/hoặc Modifier {CTRL}...
        if (openHolds.has(targetId)) {
            const existing = openHolds.get(targetId);
            return `Phím/nút "${label}" đang được giữ từ ${existing.start} ms (${existing.openTag}), không thể gõ đè tại ${t} ms trước khi thả (${existing.expectedCloseTag}).`;
        }

        const dur = pendingHold ? pendingHold.ms : defaultTapMs;
        pendingHold = null;

        // Nếu có modifier đi kèm (vd {CTRL}{SHIFT}a), tạo các clip modifier chạy đồng thời trên các track song song!
        if (pendingModifiers.length > 0) {
            const seenMods = new Set();
            for (const mod of pendingModifiers) {
                if (seenMods.has(mod.key)) continue;
                seenMods.add(mod.key);
                const modId = `key:${mod.key}`;
                if (openHolds.has(modId)) continue;
                addRawClip({
                    kind: "key",
                    key: mod.key,
                    start: t,
                    dur
                });
            }
            pendingModifiers = [];
        }

        addRawClip({
            kind: target.kind,
            key: target.key,
            button: target.button,
            start: t,
            dur
        });
        t += dur;
        return null;
    };

    for (let idx = 0; idx < tokenized.tokens.length; idx += 1) {
        const tok = tokenized.tokens[idx];

        if (tok.type === "char") {
            const ch = tok.char;
            const key = ch === " " ? "space" : ch.toLowerCase();
            const err = handleTargetInput({ kind: "key", key }, ch === " " ? "{SPACE}" : ch);
            if (err) return { error: err };
            continue;
        }

        const info = classifyMacroTag(tok.raw, tok.full);
        if (info.error) return { error: info.error };
        if (info.note) notes.push(info.note);

        if (info.category === "press_mode") {
            if (pressReleaseMode && pressReleaseMode.consumed === 0) {
                return { error: `Thẻ ${pressReleaseMode.full} đứng trước ${info.full} nhưng chưa có phím nào đi kèm.` };
            }
            if (pendingHold) {
                return { error: `Thẻ ${pendingHold.full} phải đứng trước một phím, không thể đứng trước ${info.full}.` };
            }
            if (pendingModifiers.length > 0) {
                return { error: `Modifier ${pendingModifiers.map((m) => m.full).join("")} chỉ áp dụng cho phím kế tiếp, không thể đứng trước ${info.full}.` };
            }
            pressReleaseMode = { mode: info.mode, full: info.full, consumed: 0 };
            continue;
        }

        if (info.category === "clear") {
            pressReleaseMode = null;
            pendingModifiers = [];
            continue;
        }

        if (info.category === "wait") {
            if (pressReleaseMode && pressReleaseMode.consumed === 0) {
                return { error: `Thẻ ${pressReleaseMode.full} chưa có phím đi kèm trước khi gặp ${info.full}.` };
            }
            pressReleaseMode = null;
            if (pendingHold) {
                return { error: `Thẻ ${pendingHold.full} phải áp dụng cho phím kế tiếp, không thể đứng ngay trước ${info.full}.` };
            }
            if (pendingModifiers.length > 0) {
                const modStr = pendingModifiers.map((m) => m.full).join("");
                return { error: `Modifier ${modStr} chỉ áp dụng cho phím kế tiếp, không thể đứng ngay trước ${info.full}. Nếu muốn giữ modifier trong lúc chờ, hãy dùng {PRESS}${modStr}${info.full}...{RELEASE}${modStr}.` };
            }
            t += info.ms;
            continue;
        }

        if (info.category === "hold") {
            if (pressReleaseMode && pressReleaseMode.consumed === 0) {
                return { error: `Thẻ ${pressReleaseMode.full} không thể kết hợp trực tiếp với ${info.full}.` };
            }
            pressReleaseMode = null;
            pendingHold = { ms: info.ms, full: info.full };
            continue;
        }

        if (info.category === "modifier") {
            // Nếu đang ở sau {PRESS} hoặc {RELEASE}, modifier được nhấn/thả như một phím độc lập trên track riêng
            if (pressReleaseMode) {
                const err = handleTargetInput({ kind: "key", key: info.key }, info.full);
                if (err) return { error: err };
            } else {
                pendingModifiers.push({ key: info.key, full: info.full });
            }
            continue;
        }

        if (info.category === "key") {
            const err = handleTargetInput({ kind: "key", key: info.key }, info.full);
            if (err) return { error: err };
            continue;
        }

        if (info.category === "mouse") {
            if (info.action === "tap") {
                const err = handleTargetInput({ kind: "mouse", button: info.button }, info.full);
                if (err) return { error: err };
                continue;
            }

            // Tag nhấn / thả chuột trực tiếp: {LMBD}/{LMBU}, {RMBD}/{RMBU}, ...
            if (pressReleaseMode && pressReleaseMode.consumed === 0) {
                return { error: `Thẻ ${pressReleaseMode.full} không cần thiết trước ${info.full} (vì ${info.full} đã là tag nhấn/thả chuột).` };
            }
            pressReleaseMode = null;
            if (pendingHold) {
                return { error: `Không dùng ${pendingHold.full} trước ${info.full}. Hãy dùng {WAITMS:n} giữa {${info.downTag}} và {${info.upTag}}.` };
            }
            if (pendingModifiers.length > 0) {
                return { error: `Modifier ${pendingModifiers.map((m) => m.full).join("")} đang chờ phím kế tiếp, không thể áp dụng trực tiếp vào ${info.full}.` };
            }

            const targetId = `mouse:${info.button}`;
            const label = mouseLabel(info.button);
            if (info.action === "down") {
                if (openHolds.has(targetId)) {
                    const existing = openHolds.get(targetId);
                    return { error: `Nút "${label}" đã được nhấn tại ${existing.start} ms (${existing.openTag}) nhưng chưa được thả trước khi gặp ${info.full}.` };
                }
                openHolds.set(targetId, {
                    kind: "mouse",
                    button: info.button,
                    start: t,
                    order: (orderCounter += 1),
                    source: "mousedown",
                    openTag: info.full,
                    expectedCloseTag: `{${info.upTag}}`,
                    label
                });
            } else {
                const existing = openHolds.get(targetId);
                if (!existing || existing.source !== "mousedown") {
                    return { error: `Gặp ${info.full} tại ${t} ms nhưng chưa có {${info.downTag}} tương ứng trước đó.` };
                }
                const dur = Math.max(1, t - existing.start);
                addRawClip({
                    kind: "mouse",
                    button: info.button,
                    start: existing.start,
                    dur,
                    order: existing.order
                });
                openHolds.delete(targetId);
            }
            continue;
        }

        if (info.category === "system") {
            pressReleaseMode = null;
            systemTags.push(info.full);
            continue;
        }
    }

    // Kiểm tra các ràng buộc cuối chuỗi (Mục 2 Quy tắc 4, 6 & Mục 20 import.md)
    if (pressReleaseMode && pressReleaseMode.consumed === 0) {
        return { error: `Thẻ ${pressReleaseMode.full} ở cuối chuỗi không có phím nào đi kèm.` };
    }
    if (pendingHold) {
        return { error: `Thẻ ${pendingHold.full} ở cuối chuỗi không có phím nào đi kèm.` };
    }
    if (pendingModifiers.length > 0) {
        return {
            error: `Modifier ${pendingModifiers.map((m) => m.full).join("")} ở cuối chuỗi không có phím kế tiếp để áp dụng (hoặc thiếu {CLEAR}).`
        };
    }
    if (openHolds.size > 0) {
        const unclosed = [...openHolds.values()]
            .map((h) => `${h.openTag} (tại ${h.start} ms → thiếu ${h.expectedCloseTag})`)
            .join(", ");
        return {
            error: `Vi phạm quy tắc cặp nhấn/thả trong import.md: ${unclosed}.`
        };
    }

    const { clips, maxConcurrentTracks } = allocateMultiTrackClips(rawClips);
    const maxClipEnd = clips.reduce((max, c) => Math.max(max, clipEnd(c)), 0);
    const totalMs = Math.max(t, maxClipEnd);

    return {
        clips,
        maxConcurrentTracks,
        totalMs,
        notes,
        systemTags
    };
}

// ── Điều khiển Modal Import / Export ────────────────────────────────────────
function bindIoModalEvents() {
    if (!elements.ioModal) return;

    elements.ioCloseButton?.addEventListener("click", closeIoModal);
    elements.ioCancelButton?.addEventListener("click", closeIoModal);
    elements.ioModal.addEventListener("mousedown", (event) => {
        if (event.target === elements.ioModal) closeIoModal();
    });

    elements.ioTextarea?.addEventListener("input", updateIoValidationPreview);
    elements.ioDefaultTapMs?.addEventListener("input", updateIoValidationPreview);

    elements.ioRefreshExportButton?.addEventListener("click", () => {
        const exported = exportClipsToMacroText(state.clips);
        elements.ioTextarea.value = exported;
        updateIoValidationPreview();
        if (exported) {
            showStatus("Đã tạo lại chuỗi lệnh Export từ timeline hiện tại.", "success");
        }
    });

    elements.ioCopyButton?.addEventListener("click", async () => {
        const text = elements.ioTextarea.value.trim();
        if (!text) {
            updateIoValidationPreview();
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            const prevText = elements.ioCopyButton.textContent;
            elements.ioCopyButton.textContent = "Đã copy!";
            setTimeout(() => { elements.ioCopyButton.textContent = prevText; }, 1400);
        } catch {
            elements.ioTextarea.select();
            document.execCommand("copy");
        }
    });

    elements.ioLoadFileButton?.addEventListener("click", () => {
        elements.ioFileInput?.click();
    });

    elements.ioFileInput?.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            elements.ioTextarea.value = text.trim();
            updateIoValidationPreview();
        } catch {
            showStatus("Không đọc được file văn bản.", "error");
        } finally {
            elements.ioFileInput.value = "";
        }
    });

    elements.ioDownloadButton?.addEventListener("click", () => {
        const text = elements.ioTextarea.value.trim() || exportClipsToMacroText(state.clips);
        if (!text) {
            updateIoValidationPreview();
            return;
        }
        const rawName = (elements.comboName?.value || "skirk-macro").trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${rawName || "macro"}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });

    elements.ioImportButton?.addEventListener("click", applyMacroImport);
}

function openIoModal() {
    if (state.recording) stopRecording();
    if (state.playing) stopPlay();
    if (!elements.ioModal) return;

    const exported = exportClipsToMacroText(state.clips);
    elements.ioTextarea.value = exported;
    elements.ioModal.hidden = false;
    updateIoValidationPreview();
    setTimeout(() => {
        elements.ioTextarea?.focus();
        elements.ioTextarea?.select();
    }, 20);
}

function closeIoModal() {
    if (!elements.ioModal) return;
    elements.ioModal.hidden = true;
}

function updateIoValidationPreview() {
    const box = elements.ioValidationBox;
    if (!box) return;
    const raw = elements.ioTextarea?.value ?? "";
    if (!raw.trim()) {
        box.className = "io-validation is-empty";
        box.textContent = "Nhập hoặc dán chuỗi lệnh theo định dạng import.md để kiểm tra và import lên nhiều track.";
        if (elements.ioImportButton) elements.ioImportButton.disabled = true;
        return;
    }

    const parsed = parseMacroSequence(raw, { defaultTapMs: getDefaultTapMs() });
    if (parsed.error) {
        box.className = "io-validation is-error";
        box.textContent = `❌ ${parsed.error}`;
        if (elements.ioImportButton) elements.ioImportButton.disabled = true;
        return;
    }

    if (!parsed.clips.length) {
        box.className = "io-validation is-empty";
        box.textContent = parsed.systemTags.length
            ? `Chuỗi hợp lệ (${parsed.systemTags.join(", ")}) nhưng không chứa sự kiện phím / chuột nào để đặt lên timeline.`
            : "Chuỗi hợp lệ nhưng chưa có sự kiện phím / chuột nào.";
        if (elements.ioImportButton) elements.ioImportButton.disabled = true;
        return;
    }

    box.className = "io-validation is-valid";
    box.replaceChildren();

    const summary = document.createElement("div");
    summary.textContent = `✓ Cú pháp hợp lệ theo import.md — Sẵn sàng tạo ${parsed.clips.length} clip trên ${parsed.maxConcurrentTracks} track song song.`;
    box.appendChild(summary);

    const badges = document.createElement("div");
    badges.className = "io-validation-badges";
    const addBadge = (text, warn = false) => {
        const span = document.createElement("span");
        span.className = `io-badge${warn ? " is-warn" : ""}`;
        span.textContent = text;
        badges.appendChild(span);
    };
    addBadge(`${parsed.clips.length} clip`);
    addBadge(`${parsed.maxConcurrentTracks} track đồng thời`);
    addBadge(`Tổng thời lượng: ${formatMs(parsed.totalMs)}`);
    if (parsed.systemTags.length) {
        addBadge(`Bỏ qua ${parsed.systemTags.length} tag hệ thống (${parsed.systemTags.slice(0, 3).join(", ")})`, true);
    }
    parsed.notes.slice(0, 2).forEach((note) => addBadge(note, true));
    box.appendChild(badges);

    if (elements.ioImportButton) elements.ioImportButton.disabled = false;
}

function applyMacroImport() {
    const raw = elements.ioTextarea?.value ?? "";
    const parsed = parseMacroSequence(raw, { defaultTapMs: getDefaultTapMs() });
    if (parsed.error) {
        updateIoValidationPreview();
        return;
    }
    if (!parsed.clips.length) {
        updateIoValidationPreview();
        return;
    }

    const mode = elements.ioImportMode?.value || "replace";
    if (mode === "insert") {
        const packed = packClips(parsed.clips);
        const added = placeClips(packed, state.playhead, state.activeTrack);
        closeIoModal();
        if (added.length) zoomToFit();
        showStatus(
            `Đã chèn ${added.length} clip (${parsed.maxConcurrentTracks} track đồng thời) tại ${formatMs(state.playhead)}.`,
            "success"
        );
        return;
    }

    snapshot();
    state.clips = parsed.clips;
    state.loop = null;
    state.tracks = Math.max(MIN_TRACKS, parsed.maxConcurrentTracks);
    state.playhead = 0;
    state.activeTrack = 0;
    state.selected = new Set(parsed.clips.map((c) => c.id));
    closeIoModal();
    render();
    zoomToFit();
    showStatus(
        `Đã import ${parsed.clips.length} clip phân bổ trên ${parsed.maxConcurrentTracks} track (${formatMs(parsed.totalMs)}).`,
        "success"
    );
}


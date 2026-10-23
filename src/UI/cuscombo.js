/*
 * Single source of truth for palette label and real Python function name.
 * Timeline stores only pythonFunction values, so saved JSON is backend-ready.
 */
const COMBO_ACTIONS = Object.freeze([
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

const ACTION_BY_FUNCTION = new Map(
    COMBO_ACTIONS.map((action) => [action.pythonFunction, action])
);

const CUSTOM_COMBOS_STORAGE = "customCombos";
const SIGN_KEYS_STORAGE = "comboSignKeys";
const FPS_STORAGE = "FPS";

const state = {
    comboId: createId(),
    timeline: [],
    hotkey: null,
    selectedTimelineIndex: null,
    drag: null,
    capturingHotkey: false
};

const elements = {};

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
        palette: document.getElementById("comboPalette"),
        paletteCount: document.getElementById("paletteCount"),
        timeline: document.getElementById("timeline"),
        timelineEmpty: document.getElementById("timelineEmpty"),
        timelineCount: document.getElementById("timelineCount"),
        comboName: document.getElementById("comboName"),
        hotkeyCapture: document.getElementById("hotkeyCapture"),
        clearHotkey: document.getElementById("clearHotkey"),
        pythonPreview: document.getElementById("pythonPreview"),
        saveButton: document.getElementById("saveCombo"),
        ioModalButton: document.getElementById("ioModalButton"),
        newComboButton: document.getElementById("newComboButton"),
        advancedModeButton: document.getElementById("advancedModeButton"),
        savedCount: document.getElementById("savedCount"),
        saveStatus: document.getElementById("saveStatus")
    });

    renderPalette();
    renderTimeline();
    updateHotkeyUI();
    updateSavedCount();
    bindEvents();

    // ── Restore draft when switching modes or load combo from config if URL has ?edit=<id> ──
    let restoredDraft = false;
    try {
        const rawDraft = sessionStorage.getItem("cuscombo_draft");
        if (rawDraft) {
            sessionStorage.removeItem("cuscombo_draft");
            const draft = JSON.parse(rawDraft);
            if (draft && typeof draft === "object") {
                state.comboId = draft.comboId || state.comboId;
                state.hotkey = draft.hotkey || null;
                state.timeline = Array.isArray(draft.timeline)
                    ? draft.timeline.filter((fn) => typeof fn === "string" && ACTION_BY_FUNCTION.has(fn))
                    : [];
                elements.comboName.value = draft.name || "";
                updateHotkeyUI();
                renderTimeline();
                restoredDraft = true;
            }
        }
    } catch {}

    const editId = new URLSearchParams(window.location.search).get("edit");
    if (!restoredDraft && editId) {
        loadComboForEdit(editId);
    }
});

function bindEvents() {
    elements.timeline.addEventListener("dragover", onTimelineDragOver);
    elements.timeline.addEventListener("drop", onTimelineDrop);
    elements.timeline.addEventListener("dragend", clearDragState);
    elements.timeline.addEventListener("click", onTimelineClick);

    elements.hotkeyCapture.addEventListener("click", startHotkeyCapture);
    elements.clearHotkey.addEventListener("click", clearHotkey);
    elements.newComboButton.addEventListener("click", createNewCombo);
    if (elements.ioModalButton) {
        elements.ioModalButton.addEventListener("click", () => openAdvancedMode(true));
    }
    if (elements.advancedModeButton) {
        elements.advancedModeButton.addEventListener("click", () => openAdvancedMode(false));
    }
    elements.saveButton.addEventListener("click", saveCombo);

    window.addEventListener("keydown", (event) => {
        if (state.capturingHotkey) return;
        if (event.key !== "Delete" || isTypingInControl(event)) return;
        removeSelectedTimelineItem();
    });
}

function renderPalette() {
    elements.palette.replaceChildren();
    elements.paletteCount.textContent = `${COMBO_ACTIONS.length} action`;

    COMBO_ACTIONS.forEach((action) => {
        const item = document.createElement("div");
        item.className = "palette-item";
        item.draggable = true;
        item.dataset.pythonFunction = action.pythonFunction;
        item.innerHTML = `<span class="palette-grip" aria-hidden="true">••</span><span>${action.label}</span>`;
        item.title = `Kéo ${action.label} vào timeline`;
        item.addEventListener("dragstart", (event) => startPaletteDrag(event, action.pythonFunction));
        item.addEventListener("dragend", clearDragState);
        elements.palette.appendChild(item);
    });
}

function renderTimeline() {
    elements.timeline.replaceChildren();

    state.timeline.forEach((pythonFunction, index) => {
        const action = ACTION_BY_FUNCTION.get(pythonFunction);
        if (!action) return;

        const item = document.createElement("div");
        item.className = "timeline-item";
        item.draggable = true;
        item.dataset.timelineIndex = String(index);
        item.dataset.pythonFunction = pythonFunction;
        item.setAttribute("role", "listitem");
        item.setAttribute("aria-label", `${action.label}, action ${index + 1}`);
        if (state.selectedTimelineIndex === index) item.classList.add("is-selected");
        item.innerHTML = `
            <span class="timeline-grip" aria-hidden="true">••</span>
            <span>${action.label}</span>
            <button class="remove-action" type="button" aria-label="Xóa ${action.label}" title="Xóa ${action.label}">×</button>
        `;
        item.addEventListener("dragstart", (event) => startTimelineDrag(event, index));
        elements.timeline.appendChild(item);
    });

    const empty = document.createElement("div");
    empty.id = "timelineEmpty";
    empty.className = "timeline-empty";
    empty.hidden = state.timeline.length > 0;
    empty.innerHTML = `
        <span class="empty-icon">+</span>
        <span>Timeline đang trống</span>
        <small>Kéo action vào đây để bắt đầu.</small>
    `;
    elements.timeline.appendChild(empty);
    elements.timelineEmpty = empty;

    elements.timelineCount.textContent = `${state.timeline.length} action`;
    elements.pythonPreview.textContent = buildPythonPreview(state.timeline);
}

function startPaletteDrag(event, pythonFunction) {
    state.drag = { source: "palette", pythonFunction };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", pythonFunction);
    event.currentTarget.classList.add("is-dragging");
    createDragPlaceholder();
}

function startTimelineDrag(event, sourceIndex) {
    state.drag = {
        source: "timeline",
        sourceIndex,
        pythonFunction: state.timeline[sourceIndex]
    };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", state.timeline[sourceIndex]);
    event.currentTarget.classList.add("is-dragging");
    createDragPlaceholder(event.currentTarget.nextElementSibling);
}

function createDragPlaceholder(beforeElement = null) {
    const placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    state.drag.placeholder = placeholder;
    elements.timelineEmpty.hidden = true;
    elements.timeline.classList.add("is-dragging-over");

    if (beforeElement && beforeElement !== elements.timelineEmpty) {
        elements.timeline.insertBefore(placeholder, beforeElement);
    } else {
        elements.timeline.appendChild(placeholder);
    }
}

function onTimelineDragOver(event) {
    if (!state.drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = state.drag.source === "palette" ? "copy" : "move";
    movePlaceholder(event.clientX, event.clientY);
}

function movePlaceholder(pointerX, pointerY) {
    const placeholder = state.drag?.placeholder;
    if (!placeholder) return;

    const target = getInsertionTarget(pointerX, pointerY);
    if (target === placeholder || target?.previousElementSibling === placeholder) return;

    // FLIP keeps neighbours moving smoothly while placeholder changes position.
    const before = rememberItemPositions();
    if (target) {
        elements.timeline.insertBefore(placeholder, target);
    } else {
        elements.timeline.appendChild(placeholder);
    }
    animateItemPositions(before);
}

function getInsertionTarget(pointerX, pointerY) {
    const items = [...elements.timeline.querySelectorAll(".timeline-item:not(.is-dragging)")];
    const currentRow = items.filter((item) => {
        const rect = item.getBoundingClientRect();
        return pointerY >= rect.top - rect.height / 2 && pointerY <= rect.bottom + rect.height / 2;
    });
    const candidates = currentRow.length ? currentRow : items;

    return candidates.find((item) => {
        const rect = item.getBoundingClientRect();
        return pointerX < rect.left + rect.width / 2;
    }) || null;
}

function rememberItemPositions() {
    return new Map(
        [...elements.timeline.querySelectorAll(".timeline-item:not(.is-dragging)")]
            .map((item) => [item, item.getBoundingClientRect()])
    );
}

function animateItemPositions(before) {
    before.forEach((previousRect, item) => {
        const nextRect = item.getBoundingClientRect();
        const deltaX = previousRect.left - nextRect.left;
        const deltaY = previousRect.top - nextRect.top;
        if (!deltaX && !deltaY) return;

        item.style.transition = "none";
        item.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        requestAnimationFrame(() => {
            item.style.transition = "";
            item.style.transform = "";
        });
    });
}

function onTimelineDrop(event) {
    if (!state.drag) return;
    event.preventDefault();

    const destinationIndex = getPlaceholderIndex();
    if (state.drag.source === "palette") {
        state.timeline.splice(destinationIndex, 0, state.drag.pythonFunction);
        state.selectedTimelineIndex = destinationIndex;
    } else {
        state.timeline.splice(state.drag.sourceIndex, 1);
        state.timeline.splice(destinationIndex, 0, state.drag.pythonFunction);
        state.selectedTimelineIndex = destinationIndex;
    }

    clearDragState();
}

function getPlaceholderIndex() {
    const placeholder = state.drag?.placeholder;
    if (!placeholder) return state.timeline.length;

    let index = 0;
    for (const child of elements.timeline.children) {
        if (child === placeholder) return index;
        if (child.classList.contains("timeline-item") && !child.classList.contains("is-dragging")) {
            index += 1;
        }
    }
    return index;
}

function clearDragState() {
    document.querySelectorAll(".is-dragging").forEach((item) => item.classList.remove("is-dragging"));
    state.drag?.placeholder?.remove();
    state.drag = null;
    elements.timeline?.classList.remove("is-dragging-over");
    renderTimeline();
}

function onTimelineClick(event) {
    const removeButton = event.target.closest(".remove-action");
    const item = event.target.closest(".timeline-item");
    if (!item) return;

    const index = Number(item.dataset.timelineIndex);
    if (removeButton) {
        removeTimelineItem(index);
        return;
    }

    state.selectedTimelineIndex = state.selectedTimelineIndex === index ? null : index;
    renderTimeline();
}

function removeSelectedTimelineItem() {
    if (state.selectedTimelineIndex === null) return;
    removeTimelineItem(state.selectedTimelineIndex);
}

function removeTimelineItem(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.timeline.length) return;
    state.timeline.splice(index, 1);
    state.selectedTimelineIndex = null;
    renderTimeline();
}

function startHotkeyCapture() {
    if (state.capturingHotkey) return;
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
        caps_lock: "CapsLock",
        num_lock: "NumLock",
        scroll_lock: "ScrollLock",
        space: "Space",
        enter: "Enter",
        esc: "Esc",
        delete: "Delete"
    };
    if (labels[hotkey]) return labels[hotkey];
    if (/^f\d+$/.test(hotkey)) return hotkey.toUpperCase();
    if (/^mouse_\d+$/.test(hotkey)) return `mouse_${hotkey.slice(6)}`;
    if (/^mouse\d+$/.test(hotkey)) return `mouse_${hotkey.slice(5)}`;
    return hotkey.length === 1 ? hotkey.toUpperCase() : hotkey;
}

function buildPythonSequence(timeline) {
    return timeline.flatMap((pythonFunction, index) => (
        index === timeline.length - 1
            ? [pythonFunction]
            : [pythonFunction, "is_no_key_pressed"]
    ));
}

function buildPythonPreview(timeline) {
    if (!timeline.length) return "Chưa có action.";
    return buildPythonSequence(timeline)
        .map((pythonFunction) => `${pythonFunction}()`)
        .join("\n");
}

async function saveCombo() {
    const name = elements.comboName.value.trim();
    if (!name) {
        showStatus("Nhập Tên Combo trước khi lưu.", "error");
        elements.comboName.focus();
        return;
    }
    if (!state.timeline.length) {
        showStatus("Timeline cần ít nhất một action.", "error");
        elements.timeline.focus();
        return;
    }

    const combo = {
        id: state.comboId,
        name,
        hotkey: state.hotkey,
        timeline: [...state.timeline],
        pythonSequence: buildPythonSequence(state.timeline)
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

function createNewCombo() {
    state.comboId = createId();
    state.timeline = [];
    state.hotkey = null;
    state.selectedTimelineIndex = null;
    elements.comboName.value = "";
    updateHotkeyUI();
    renderTimeline();
    showStatus("Sẵn sàng tạo Combo mới.");
    elements.comboName.focus();
}

function openAdvancedMode(openIoModal = false) {
    const name = elements.comboName ? elements.comboName.value.trim() : "";
    if (name || state.hotkey || state.timeline.length > 0 || openIoModal) {
        try {
            sessionStorage.setItem("cuscombo_draft", JSON.stringify({
                comboId: state.comboId,
                name,
                hotkey: state.hotkey,
                timeline: [...state.timeline],
                openIoModal: Boolean(openIoModal)
            }));
        } catch {}
    } else {
        try { sessionStorage.removeItem("cuscombo_draft"); } catch {}
    }
    window.location.href = `cuscombo-advanced.html${window.location.search}`;
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

function isTypingInControl(event) {
    return event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        event.target instanceof HTMLButtonElement;
}

function createId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    return `combo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
        try {
            combos = JSON.parse(localStorage.getItem("customCombos")) || [];
        } catch { combos = []; }
    }

    const combo = combos.find(c => c.id === id);
    if (!combo) {
        showStatus("Không tìm thấy combo để chỉnh sửa.", "error");
        return;
    }

    if (Array.isArray(combo.clips) || (Array.isArray(combo.timeline) && combo.timeline.some(s => s && typeof s === "object"))) {
        window.location.replace(`cuscombo-advanced.html?edit=${encodeURIComponent(id)}`);
        return;
    }

    state.comboId = combo.id;
    state.timeline = [...(combo.timeline || [])];
    state.hotkey = combo.hotkey || null;
    state.selectedTimelineIndex = null;
    elements.comboName.value = combo.name || "";
    updateHotkeyUI();
    renderTimeline();
    showStatus(`Đang chỉnh sửa: ${combo.name}`);
}

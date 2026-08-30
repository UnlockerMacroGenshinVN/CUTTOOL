const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// ── Tìm thư mục unlocker ──────────────────────────────────────────────────────
function getUnlockerDir(app) {
    const isPackaged = app ? app.isPackaged : false;

    if (isPackaged && process.resourcesPath) {
        // Packaged: unlocker được bundle vào resources/unlocker
        const p = path.join(process.resourcesPath, "unlocker");
        if (fs.existsSync(p)) return p;
    }

    // Dev mode: tìm theo cấu trúc thư mục src/unlocker
    const candidates = [
        path.join(__dirname, "..", "unlocker"), // src/UI/../unlocker = src/unlocker
        path.join(__dirname, "..", "..", "src", "unlocker"), // fallback
    ];

    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }

    return path.join(__dirname, "..", "unlocker");
}

// ── Đường dẫn config.ini của Unlocker DLL ────────────────────────────────────
function getUnlockerConfigPath(app) {
    return path.join(
        getUnlockerDir(app),
        "Plugins",
        "UnlockerIsland",
        "config.ini",
    );
}

// ── Đường dẫn lưu GamePath riêng (không lẫn vào config.ini) ─────────────────
function getGamePathFile(app) {
    const isPackaged = app ? app.isPackaged : false;
    if (isPackaged && process.resourcesPath) {
        return path.join(process.resourcesPath, "unlocker", "gamepath.json");
    }
    return path.join(getUnlockerDir(app), "gamepath.json");
}

function loadGamePath(app) {
    const f = getGamePathFile(app);
    const defaultPath =
        "C:\\Program Files\\HoYoPlay\\games\\Genshin Impact game\\GenshinImpact.exe";
    if (!fs.existsSync(f)) return defaultPath;
    try {
        const data = JSON.parse(fs.readFileSync(f, "utf8"));
        return data.GamePath || defaultPath;
    } catch {
        return defaultPath;
    }
}

function saveGamePath(gamePath, app) {
    const f = getGamePathFile(app);
    try {
        fs.writeFileSync(
            f,
            JSON.stringify({ GamePath: gamePath }, null, 2),
            "utf8",
        );
    } catch (e) {
        console.error("Lỗi lưu gamepath.json:", e);
    }
}

// ── Đọc config.ini (chỉ các key của Unlocker DLL) ───────────────────────────
function loadUnlockerConfig(app) {
    const iniPath = getUnlockerConfigPath(app);
    const result = {
        File: "CUTTOOL.UnlockerIsland.dll",
        GamePath: loadGamePath(app), // GamePath lưu riêng
        Vsync: 0,
        FpsUnlock: 1,
        TargetFps: 240,
        FovUnlock: 1,
        FovValue: 60,
        HideUID: 0,
        DisableCameraMove: 1,
        DisableFog: 1,
        RemoveTeamAnim: 1,
        DisableBurstBlackscreen: 1,
        ShowFPS: 0,
        BlockNetwork: 0,
        EnableNetworkToggle: 0,
        NetworkToggleKey: 122,
        ToggleKey: 36,
    };

    if (!fs.existsSync(iniPath)) return result;

    try {
        const content = fs.readFileSync(iniPath, "utf8");
        const lines = content.split(/\r?\n/);
        let currentSection = null;

        lines.forEach((line) => {
            const str = line.trim();
            if (!str || str.startsWith(";") || str.startsWith("#")) return;

            if (str.startsWith("[") && str.endsWith("]")) {
                currentSection = str.slice(1, -1).trim();
            } else if (str.includes("=")) {
                const eqIdx = str.indexOf("=");
                const k = str.slice(0, eqIdx).trim();
                const v = str.slice(eqIdx + 1).trim();

                if (currentSection && k.toLowerCase() === "value") {
                    // Bỏ qua [GamePath] trong config.ini (đã tách riêng)
                    if (currentSection === "GamePath") return;
                    const num = parseInt(v, 10);
                    result[currentSection] = isNaN(num) ? v : num;
                } else if (!currentSection) {
                    result[k] = v;
                }
            }
        });
    } catch (err) {
        console.error("Lỗi khi đọc config.ini:", err);
    }

    return result;
}

// ── Ghi config.ini (chỉ ghi các key Unlocker DLL đọc được) ──────────────────
function saveUnlockerConfig(data, app) {
    const iniPath = getUnlockerConfigPath(app);
    const dir = path.dirname(iniPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    // Lưu GamePath riêng vào gamepath.json
    if (data.GamePath !== undefined) {
        saveGamePath(data.GamePath, app);
    }

    // Map key aliases nếu cần
    if (
        data.DisableBurstBackscreen !== undefined &&
        data.DisableBurstBlackscreen === undefined
    ) {
        data.DisableBurstBlackscreen = data.DisableBurstBackscreen;
    }

    const fileVal = data.File || "CUTTOOL.UnlockerIsland.dll";
    const lines = [`File=${fileVal}\r\n\r\n`];

    // Chỉ ghi các section mà Unlocker DLL đọc được — KHÔNG bao gồm GamePath
    const sections = [
        "Vsync",
        "FpsUnlock",
        "TargetFps",
        "FovUnlock",
        "FovValue",
        "HideUID",
        "DisableCameraMove",
        "DisableFog",
        "RemoveTeamAnim",
        "DisableBurstBlackscreen",
        "ShowFPS",
        "BlockNetwork",
        "EnableNetworkToggle",
        "NetworkToggleKey",
        "ToggleKey",
        "DumpOffsets",
        "DebugConsole",
    ];

    const writtenSections = new Set();

    sections.forEach((sec) => {
        if (data[sec] !== undefined) {
            let val = data[sec];
            if (typeof val === "boolean") val = val ? 1 : 0;
            lines.push(`[${sec}]\r\nValue=${val}\r\n\r\n`);
            writtenSections.add(sec);
        }
    });

    // Ghi thêm các section bổ sung nếu có trong data
    Object.keys(data).forEach((k) => {
        if (
            !writtenSections.has(k) &&
            k !== "File" &&
            k !== "GamePath" &&
            k !== "DisableBurstBackscreen"
        ) {
            let val = data[k];
            if (typeof val === "boolean") val = val ? 1 : 0;
            lines.push(`[${k}]\r\nValue=${val}\r\n\r\n`);
        }
    });

    fs.writeFileSync(iniPath, lines.join(""), "utf8");
}

// ── Khởi chạy game qua Launcher_2.exe ────────────────────────────────────────
function launchGame(gamePath, app) {
    const unlockerDir = getUnlockerDir(app);
    const targetPath = gamePath || loadGamePath(app);

    // Kiểm tra file game
    if (!targetPath || !fs.existsSync(targetPath)) {
        return {
            ok: false,
            error: `Không tìm thấy file game tại:\n"${targetPath}"\n\nVui lòng vào trang Tùy chỉnh và chọn lại đường dẫn GenshinImpact.exe.`,
        };
    }

    // Kiểm tra Launcher_2.exe
    const launcherExe = path.join(unlockerDir, "Launcher_2.exe");
    if (!fs.existsSync(launcherExe)) {
        return {
            ok: false,
            error: `Không tìm thấy Launcher_2.exe tại:\n"${launcherExe}"\n\nVui lòng kiểm tra thư mục unlocker.`,
        };
    }

    // Đảm bảo thư mục Plugins/UnlockerIsland tồn tại
    const pluginsDir = path.join(unlockerDir, "Plugins", "UnlockerIsland");
    if (!fs.existsSync(pluginsDir)) {
        fs.mkdirSync(pluginsDir, { recursive: true });
    }

    // Copy DLL nếu chưa có
    const dllSrc = path.join(unlockerDir, "CUTTOOL.UnlockerIsland.dll");
    const dllDst = path.join(pluginsDir, "CUTTOOL.UnlockerIsland.dll");
    if (fs.existsSync(dllSrc) && !fs.existsSync(dllDst)) {
        try {
            fs.copyFileSync(dllSrc, dllDst);
        } catch (e) {
            console.error("Lỗi copy DLL:", e);
        }
    }

    // Đảm bảo config.ini tồn tại
    const iniPath = path.join(pluginsDir, "config.ini");
    if (!fs.existsSync(iniPath)) {
        saveUnlockerConfig({ File: "CUTTOOL.UnlockerIsland.dll" }, app);
    }

    // Chạy Launcher_2.exe với đường dẫn game
    const { spawn } = require("child_process");

    const psCommand =
        `Start-Process -FilePath "${launcherExe}" ` +
        `-ArgumentList '"${targetPath}"' ` +
        `-WorkingDirectory "${unlockerDir}" ` +
        `-Verb RunAs`;

    spawn("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-Command",
        psCommand
    ]);

    return {
        ok: true,
        message: "Launcher started."
    };
}

module.exports = {
    loadUnlockerConfig,
    saveUnlockerConfig,
    loadGamePath,
    saveGamePath,
    launchGame,
    getUnlockerDir,
    getUnlockerConfigPath,
};
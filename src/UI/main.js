const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');

// ── Win10 / older GPU compatibility flags ─────────────────────────────────────
// Ngăn crash renderer trên Win10 máy cũ với GPU driver không tương thích
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder');
// Tắt hardware acceleration nếu gặp crash (fallback an toàn)
// Bỏ comment dòng dưới nếu máy vẫn crash:
// app.disableHardwareAcceleration();

let pyProc = null;
let mainWin = null;

// ── Debug log file ────────────────────────────────────────────────────────────
const LOG_DIR  = app.getPath('userData');
const LOG_FILE = path.join(LOG_DIR, 'electron-debug.log');

function ensureLogDir() {
    try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function logE(msg) {
    const ts  = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    console.log(line.trim());
    try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch {}
}

// ── Kiểm tra backend sẵn sàng (poll /config) ─────────────────────────────────
// Tăng timeout 30s → 45s cho máy Win10 chậm khởi động lâu hơn
function waitForBackend(maxMs = 45000, intervalMs = 400) {
    return new Promise((resolve, reject) => {
        const deadline = Date.now() + maxMs;
        function probe() {
            if (pyProc && pyProc.exitCode !== null && pyProc.exitCode !== 0) {
                reject(new Error(`Backend đã thoát sớm với exit code ${pyProc.exitCode}`));
                return;
            }
            const req = http.request(
                { hostname: 'localhost', port: 5000, path: '/config', method: 'GET', timeout: 1000 },
                (res) => { logE(`Backend sẵn sàng (status ${res.statusCode})`); resolve(); }
            );
            req.on('error', () => {
                if (Date.now() >= deadline) {
                    reject(new Error(`Backend không phản hồi sau ${maxMs}ms`));
                } else {
                    setTimeout(probe, intervalMs);
                }
            });
            req.on('timeout', () => { req.destroy(); });
            req.end();
        }
        probe();
    });
}

function startPython() {
    const isPackaged = app.isPackaged;
    let pyPath;
    let args = [];

    logE(`=== Khởi động ứng dụng ===`);
    logE(`isPackaged: ${isPackaged}`);
    logE(`process.resourcesPath: ${process.resourcesPath}`);
    logE(`__dirname: ${__dirname}`);
    logE(`platform: ${process.platform}`);

    if (!isPackaged) {
        // Dev Mode: Dùng pyw (Python windowed) - KHÔNG hiện cửa sổ console đen
        // pyw.exe đi kèm với mọi bản cài Python 3.x trên Windows
        pyPath = 'pyw';
        args = [path.join(__dirname, '..', 'macro', 'main.py')];
        logE(`[Dev Mode] Đang chạy file Python trực tiếp: ${args[0]}`);
    } else {
        // Packaged Mode (đã đóng gói): Chạy Cryss.exe từ thư mục resources
        const backendName = 'Cryss.exe';
        pyPath = path.join(process.resourcesPath, backendName);
        logE(`[Packaged Mode] Đang chạy backend từ resources: ${pyPath}`);
    }

    logE(`pyPath: ${pyPath}`);
    logE(`args: ${JSON.stringify(args)}`);

    // Kiểm tra file tồn tại (chỉ cho packaged exe)
    if (isPackaged && !fs.existsSync(pyPath)) {
        const msg = `CRITICAL: Không tìm thấy backend tại:\n${pyPath}\n\nNội dung resources:\n${listDir(process.resourcesPath)}`;
        logE(msg);
        dialog.showErrorBox('Lỗi Backend', msg);
        return;
    }

    // Đặt CRYSS_DEBUG_LOG=1 để backend ghi debug.log
    const env = Object.assign({}, process.env, { CRYSS_DEBUG_LOG: '1' });

    pyProc = spawn(pyPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],   // capture stdout/stderr để log
        windowsHide: true,
        env
    });

    logE(`Backend spawned, PID: ${pyProc.pid}`);

    pyProc.stdout.on('data', (d) => logE(`[backend stdout] ${d.toString().trim()}`));
    pyProc.stderr.on('data', (d) => logE(`[backend stderr] ${d.toString().trim()}`));

    pyProc.on('error', (err) => {
        logE(`Lỗi spawn backend: ${err.message}`);
        dialog.showErrorBox('Lỗi Backend', `Không thể khởi động backend:\n${err.message}\n\nXem log: ${LOG_FILE}`);
    });

    pyProc.on('close', (code, signal) => {
        logE(`Backend đã thoát: code=${code}, signal=${signal}`);
    });
}

function stopPython() {
    // 1. Gửi POST /shutdown để Python tự thoát (xử lý cả trường hợp admin re-launch)
    return new Promise((resolve) => {
        const req = http.request({
            hostname: 'localhost',
            port: 5000,
            path: '/shutdown',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            timeout: 2000
        }, (res) => {
            logE('Gửi /shutdown thành công');
            resolve();
        });

        req.on('error', () => { logE('Lỗi gửi /shutdown (backend đã tắt?)'); resolve(); });
        req.on('timeout', () => { req.destroy(); resolve(); });
        req.end();
    }).then(() => {
        // 2. Backup: kill child process trực tiếp nếu còn sống
        if (pyProc) {
            try {
                // Kill cả process tree (cho trường hợp admin re-launch tạo child)
                const { execSync } = require('child_process');
                try { execSync(`taskkill /F /T /PID ${pyProc.pid}`, { stdio: 'ignore' }); } catch {}
                pyProc.kill();
            } catch {}
            pyProc = null;
        }
    });
}

function listDir(dirPath) {
    try {
        return fs.readdirSync(dirPath).join(', ');
    } catch (e) {
        return `(lỗi đọc thư mục: ${e.message})`;
    }
}

const { ipcMain } = require('electron');
const unlocker = require('./unlocker');

// ── IPC Handlers cho Unlocker & Launch Game ──────────────────────────────────
ipcMain.handle('get-unlocker-config', async () => {
    return unlocker.loadUnlockerConfig(app);
});

ipcMain.handle('save-unlocker-config', async (event, data) => {
    unlocker.saveUnlockerConfig(data, app);
    return { ok: true };
});

ipcMain.handle('launch-game', async (event, gamePath) => {
    return unlocker.launchGame(gamePath, app);
});

ipcMain.handle('select-game-path', async () => {
    const result = await dialog.showOpenDialog(mainWin, {
        title: 'Chọn tập tin GenshinImpact.exe',
        properties: ['openFile'],
        filters: [
            { name: 'Executable (*.exe)', extensions: ['exe'] },
            { name: 'Tất cả tập tin (*.*)', extensions: ['*'] }
        ]
    });
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});

ipcMain.handle('select-banner-image', async () => {
    const result = await dialog.showOpenDialog(mainWin, {
        title: 'Chọn ảnh bìa trang chính',
        properties: ['openFile'],
        filters: [
            { name: 'Hình ảnh (*.png; *.jpg; *.jpeg; *.webp; *.bmp; *.gif)', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] },
            { name: 'Tất cả tập tin (*.*)', extensions: ['*'] }
        ]
    });
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        try {
            const data = fs.readFileSync(filePath);
            const ext = path.extname(filePath).replace('.', '').toLowerCase();
            const mimeType = ext === 'svg' ? 'image/svg+xml' : (ext === 'jpg' ? 'image/jpeg' : `image/${ext}`);
            return `data:${mimeType};base64,${data.toString('base64')}`;
        } catch (e) {
            logE(`Lỗi đọc tệp ảnh banner: ${e.message}`);
            return null;
        }
    }
    return null;
});

// ── Version & Update Checker ─────────────────────────────────────────────────

/**
 * Đọc version từ version.json (Single Source of Truth)
 * Hỗ trợ cả dev mode (đọc từ __dirname) và packaged mode (đọc từ resources)
 */
function getAppVersion() {
    try {
        // Thử đọc từ thư mục hiện tại trước (dev mode)
        let versionPath = path.join(__dirname, 'version.json');
        if (!fs.existsSync(versionPath)) {
            // Packaged mode: version.json nằm trong resources
            versionPath = path.join(process.resourcesPath, 'version.json');
        }
        const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
        return data.version || '0.0.0';
    } catch (e) {
        logE(`Lỗi đọc version.json: ${e.message}`);
        return '0.0.0';
    }
}

/**
 * So sánh semver đơn giản: parse "v1.2.3" hoặc "1.2.3" thành mảng [1,2,3]
 * Trả về: 1 nếu a > b, -1 nếu a < b, 0 nếu bằng nhau
 */
function compareSemver(a, b) {
    const parse = (v) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na > nb) return 1;
        if (na < nb) return -1;
    }
    return 0;
}

/**
 * Gọi GitHub Releases API để lấy thông tin phiên bản mới nhất
 * Sử dụng Node.js built-in https module (không cần dependency ngoài)
 */
function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/UnlockerMacroGenshinVN/CUTTOOL/releases/latest',
            method: 'GET',
            headers: {
                'User-Agent': 'CutTool-Updater',
                'Accept': 'application/vnd.github.v3+json'
            },
            timeout: 10000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`GitHub API trả về status ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(new Error(`Lỗi parse JSON từ GitHub: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => reject(new Error(`Lỗi kết nối GitHub: ${e.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API timeout')); });
        req.end();
    });
}

// ── IPC: Lấy phiên bản hiện tại ──────────────────────────────────────────────
ipcMain.handle('get-app-version', async () => {
    return getAppVersion();
});

// ── IPC: Kiểm tra cập nhật từ GitHub ──────────────────────────────────────────
ipcMain.handle('check-for-update', async () => {
    try {
        const currentVersion = getAppVersion();
        const release = await fetchLatestRelease();
        const latestVersion = (release.tag_name || '').replace(/^v/i, '');
        const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

        // Lấy URL download từ assets (file .rar hoặc .zip)
        let downloadUrl = '';
        if (release.assets && release.assets.length > 0) {
            downloadUrl = release.assets[0].browser_download_url || '';
        }

        logE(`[Update Check] current=${currentVersion}, latest=${latestVersion}, hasUpdate=${hasUpdate}`);

        return {
            hasUpdate,
            currentVersion,
            latestVersion,
            releaseNotes: release.body || '',
            downloadUrl,
            htmlUrl: release.html_url || ''
        };
    } catch (e) {
        logE(`[Update Check] Lỗi: ${e.message}`);
        return {
            hasUpdate: false,
            currentVersion: getAppVersion(),
            latestVersion: '',
            releaseNotes: '',
            downloadUrl: '',
            htmlUrl: '',
            error: e.message
        };
    }
});

// ── IPC: Mở URL ngoài trình duyệt (có validation bảo mật) ───────────────────
ipcMain.handle('open-external-url', async (_, url) => {
    // Chỉ cho phép mở URL từ github.com để tránh lỗ hổng bảo mật
    try {
        const parsed = new URL(url);
        if (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.com')) {
            await shell.openExternal(url);
            return { ok: true };
        } else {
            logE(`[Security] Chặn mở URL không phải GitHub: ${url}`);
            return { ok: false, error: 'Chỉ cho phép mở link GitHub' };
        }
    } catch (e) {
        logE(`[open-external-url] Lỗi: ${e.message}`);
        return { ok: false, error: e.message };
    }
});

async function createWindow() {
    mainWin = new BrowserWindow({
        width: 1280,
        height: 768,
        show: false,   // ẩn cho đến khi backend sẵn sàng
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWin.loadFile('db.html');
    mainWin.removeMenu();

    // Chỉ chặn điều hướng sang trang web bên ngoài (http/https), cho phép chuyển giữa các trang html nội bộ
    mainWin.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
            event.preventDefault();
        }
    });

    // Bắt lỗi renderer crash – tự động reload thay vì chỉ hiện dialog
    mainWin.webContents.on('render-process-gone', (event, details) => {
        logE(`Renderer crashed: reason=${details.reason}, exitCode=${details.exitCode}`);
        // Với lý do 'killed' hoặc 'oom' thử reload tự động trước
        if (details.reason === 'killed' || details.reason === 'oom') {
            logE('Thử reload renderer sau crash…');
            setTimeout(() => { try { mainWin.reload(); } catch {} }, 1000);
        } else {
            dialog.showErrorBox(
                'Renderer Crash',
                `Giao diện bị crash:\nReason: ${details.reason}\nExitCode: ${details.exitCode}\n\nMẹo Win10: Nếu hay bị crash, thêm flag --disable-gpu khi chạy.\nXem log: ${LOG_FILE}`
            );
        }
    });

    mainWin.webContents.on('did-fail-load', (event, errorCode, errorDesc, url) => {
        logE(`did-fail-load: errorCode=${errorCode}, desc=${errorDesc}, url=${url}`);
    });

    // Chờ backend sẵn sàng trước khi hiện cửa sổ
    logE('Đang đợi backend sẵn sàng...');
    try {
        await waitForBackend(30000, 300);
        logE('Backend sẵn sàng → hiện cửa sổ');
        mainWin.show();
    } catch (err) {
        logE(`Backend timeout: ${err.message}`);
        const appdata = process.env.APPDATA || '';
        const backendStartupLog = path.join(appdata, 'Cryss', 'backend-startup.log');
        const backendDebugLog   = path.join(appdata, 'Cryss', 'debug.log');
        const msg = `Backend không khởi động được trong 30 giây.\n\n${err.message}\n\nXem Electron log:\n${LOG_FILE}\n\nXem Backend startup log:\n${backendStartupLog}\n\nXem Backend debug log:\n${backendDebugLog}`;
        dialog.showErrorBox('Backend Timeout', msg);
        mainWin.show();   // vẫn show để user thấy UI (dù lỗi)
    }
}

app.whenReady().then(async () => {
    ensureLogDir();
    logE(`Log file: ${LOG_FILE}`);
    startPython();
    await createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', async () => {
    logE('window-all-closed → dọn dẹp...');
    await stopPython();
    app.quit();
});

// Đảm bảo kill Python khi Electron bị force quit
app.on('before-quit', () => {
    logE('before-quit → dọn dẹp...');
    stopPython();
});

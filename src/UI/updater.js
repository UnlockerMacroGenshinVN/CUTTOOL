/**
 * updater.js - Hệ thống Auto-Update hoàn chỉnh cho Cryss (Skirk Macro)
 * 
 * Quản lý toàn bộ vòng đời cập nhật:
 * - Kiểm tra phiên bản mới từ GitHub Releases API
 * - Tải file bản cập nhật với stream và báo tiến trình thời gian thực
 * - Hỗ trợ tự động chuyển hướng HTTP (redirects từ GitHub sang S3/CDN)
 * - Xác thực file và giải nén tự động qua Windows tar.exe (hỗ trợ .rar, .zip)
 * - Staging kiểm tra cấu trúc thư mục và bảo toàn cấu hình người dùng
 * - Kích hoạt updater.bat độc lập để thay thế file khi app thoát, tự động rollback nếu lỗi
 */

const electron = require('electron');
const app = electron && typeof electron === 'object' ? electron.app : null;
const dialog = electron && typeof electron === 'object' ? electron.dialog : null;
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn, execFile } = require('child_process');

// ── Trạng thái nội bộ của Updater ──────────────────────────────────────────
const UpdateState = {
    IDLE: 'IDLE',
    CHECKING: 'CHECKING',
    AVAILABLE: 'AVAILABLE',
    DOWNLOADING: 'DOWNLOADING',
    VERIFYING: 'VERIFYING',
    STAGING: 'STAGING',
    READY_TO_RESTART: 'READY_TO_RESTART',
    ERROR: 'ERROR'
};

let _currentState = UpdateState.IDLE;
let _updateInfo = null;       // Thông tin release lấy từ GitHub
let _activeDownload = null; // { req, res, fileStream, destPath, isCancelled }
let _downloadStats = {
    percent: 0,
    transferredBytes: 0,
    totalBytes: 0,
    transferredFormatted: '0 MB',
    totalFormatted: '0 MB',
    speedFormatted: '0 MB/s',
    error: null
};

function getUserDataDir() {
    if (app && typeof app.getPath === 'function') {
        return app.getPath('userData');
    }
    const appdata = process.env.APPDATA || path.join(process.env.USERPROFILE || 'C:\\', 'AppData', 'Roaming');
    return path.join(appdata, 'Cryss');
}

// ── Thư mục làm việc của Updater ───────────────────────────────────────────
function getUpdateDir() {
    const baseDir = getUserDataDir();
    const updateDir = path.join(baseDir, 'updates');
    if (!fs.existsSync(updateDir)) {
        fs.mkdirSync(updateDir, { recursive: true });
    }
    return updateDir;
}

function getDownloadDir() {
    const dir = path.join(getUpdateDir(), 'download');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function getStagedDir() {
    const dir = path.join(getUpdateDir(), 'staged');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function getBackupDir() {
    const dir = path.join(getUpdateDir(), 'backup');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function getUpdaterLogPath() {
    return path.join(getUserDataDir(), 'updater.log');
}

function logUpdater(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] [Updater] ${msg}\n`;
    console.log(line.trim());
    try {
        fs.appendFileSync(getUpdaterLogPath(), line, 'utf8');
    } catch {}
}

// ── Định dạng dung lượng & tốc độ ──────────────────────────────────────────
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// ── Version helpers ────────────────────────────────────────────────────────
function getAppVersion() {
    try {
        let versionPath = path.join(__dirname, 'version.json');
        if (!fs.existsSync(versionPath)) {
            versionPath = path.join(process.resourcesPath, 'version.json');
        }
        if (fs.existsSync(versionPath)) {
            const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
            return data.version || '0.0.0';
        }
    } catch (e) {
        logUpdater(`Lỗi đọc version.json: ${e.message}`);
    }
    return '0.0.0';
}

function compareSemver(a, b) {
    const parse = (v) => (v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
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

// ── GitHub Releases API ───────────────────────────────────────────────────
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
            timeout: 15000
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`GitHub API trả về HTTP ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(new Error(`Lỗi phân tích JSON từ GitHub: ${e.message}`));
                }
            });
        });

        req.on('error', (e) => reject(new Error(`Lỗi kết nối GitHub: ${e.message}`)));
        req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API timeout sau 15 giây')); });
        req.end();
    });
}

async function checkForUpdate() {
    _currentState = UpdateState.CHECKING;
    try {
        const currentVersion = getAppVersion();
        const release = await fetchLatestRelease();
        const latestVersion = (release.tag_name || '').replace(/^v/i, '');
        const hasUpdate = compareSemver(latestVersion, currentVersion) > 0;

        let downloadUrl = '';
        let assetName = '';
        let assetSize = 0;

        if (release.assets && release.assets.length > 0) {
            // Tìm asset phù hợp: ưu tiên .rar hoặc .zip
            const foundAsset = release.assets.find(a => 
                a.name.toLowerCase().endsWith('.rar') || 
                a.name.toLowerCase().endsWith('.zip')
            ) || release.assets[0];

            downloadUrl = foundAsset.browser_download_url || '';
            assetName = foundAsset.name || 'update.rar';
            assetSize = foundAsset.size || 0;
        }

        _updateInfo = {
            hasUpdate,
            currentVersion,
            latestVersion,
            releaseNotes: release.body || '',
            downloadUrl,
            assetName,
            assetSize,
            assetSizeFormatted: formatBytes(assetSize),
            htmlUrl: release.html_url || ''
        };

        _currentState = hasUpdate ? UpdateState.AVAILABLE : UpdateState.IDLE;
        logUpdater(`Kiểm tra cập nhật: current=${currentVersion}, latest=${latestVersion}, hasUpdate=${hasUpdate}`);
        return _updateInfo;
    } catch (e) {
        logUpdater(`Lỗi kiểm tra cập nhật: ${e.message}`);
        _currentState = UpdateState.ERROR;
        _updateInfo = {
            hasUpdate: false,
            currentVersion: getAppVersion(),
            latestVersion: '',
            releaseNotes: '',
            downloadUrl: '',
            assetName: '',
            assetSize: 0,
            htmlUrl: '',
            error: e.message
        };
        return _updateInfo;
    }
}

// ── Download File có xử lý HTTP Redirects & Báo tiến trình ─────────────────
function downloadWithRedirect(url, destPath, onProgress, maxRedirects = 10) {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            return reject(new Error('Quá nhiều chuyển hướng HTTP (redirect loop)'));
        }

        const client = url.startsWith('https:') ? https : http;
        const options = {
            headers: {
                'User-Agent': 'CutTool-Updater',
                'Accept': '*/*'
            },
            timeout: 30000
        };

        let isCancelled = false;

        const req = client.get(url, options, (res) => {
            // Xử lý HTTP Redirect (301, 302, 303, 307, 308)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (!redirectUrl.startsWith('http://') && !redirectUrl.startsWith('https://')) {
                    const parsedUrl = new URL(url);
                    redirectUrl = new URL(redirectUrl, parsedUrl.origin).href;
                }
                logUpdater(`Redirect sang: ${redirectUrl}`);
                try { res.resume(); } catch {}
                _activeDownload = null;
                return downloadWithRedirect(redirectUrl, destPath, onProgress, maxRedirects - 1)
                    .then(resolve)
                    .catch(reject);
            }

            if (res.statusCode !== 200) {
                _activeDownload = null;
                return reject(new Error(`Máy chủ tải về trả về HTTP ${res.statusCode}`));
            }

            const totalBytes = parseInt(res.headers['content-length'], 10) || (_updateInfo ? _updateInfo.assetSize : 0);
            let transferredBytes = 0;
            let lastTime = Date.now();
            let lastTransferred = 0;
            let currentSpeed = 0;
            let lastEmitTime = 0;

            const fileStream = fs.createWriteStream(destPath);
            _activeDownload = {
                cancel: () => {
                    isCancelled = true;
                    try { res.destroy(); } catch {}
                    try { req.destroy(); } catch {}
                    try { fileStream.destroy(); } catch {}
                    try { fs.unlinkSync(destPath); } catch {}
                }
            };

            res.on('data', (chunk) => {
                if (isCancelled) return;

                transferredBytes += chunk.length;
                const now = Date.now();

                // Tính tốc độ tải mỗi 500ms
                if (now - lastTime >= 500) {
                    const elapsedSec = (now - lastTime) / 1000;
                    currentSpeed = (transferredBytes - lastTransferred) / elapsedSec;
                    lastTime = now;
                    lastTransferred = transferredBytes;
                }

                // Phát sự kiện tiến trình tối đa 10 lần/giây (mỗi 100ms) để UI mượt mà
                if (now - lastEmitTime >= 100 || transferredBytes === totalBytes) {
                    lastEmitTime = now;
                    const percent = totalBytes > 0 ? Math.min(100, Math.round((transferredBytes / totalBytes) * 100)) : 0;
                    if (onProgress) {
                        onProgress({
                            percent,
                            transferredBytes,
                            totalBytes,
                            transferredFormatted: formatBytes(transferredBytes),
                            totalFormatted: formatBytes(totalBytes),
                            speedFormatted: `${formatBytes(currentSpeed)}/s`
                        });
                    }
                }
            });

            res.pipe(fileStream);

            fileStream.on('close', () => {
                _activeDownload = null;
                if (isCancelled) {
                    try { fs.unlinkSync(destPath); } catch {}
                    return reject(new Error('Quá trình tải đã bị hủy bởi người dùng'));
                }
                resolve({ destPath, totalBytes: transferredBytes });
            });

            fileStream.on('error', (err) => {
                _activeDownload = null;
                try { fs.unlinkSync(destPath); } catch {}
                reject(new Error(`Lỗi ghi file: ${err.message}`));
            });
        });

        _activeDownload = {
            cancel: () => {
                isCancelled = true;
                try { req.destroy(); } catch {}
                try { fs.unlinkSync(destPath); } catch {}
            }
        };

        req.on('error', (err) => {
            _activeDownload = null;
            if (isCancelled) {
                return reject(new Error('Quá trình tải đã bị hủy bởi người dùng'));
            }
            try { fs.unlinkSync(destPath); } catch {}
            reject(new Error(`Lỗi kết nối tải về: ${err.message}`));
        });

        req.on('timeout', () => {
            req.destroy();
            _activeDownload = null;
            try { fs.unlinkSync(destPath); } catch {}
            reject(new Error('Tải về bị timeout do mạng quá chậm hoặc mất kết nối'));
        });
    });
}

function cancelDownload() {
    if (_activeDownload && typeof _activeDownload.cancel === 'function') {
        _activeDownload.cancel();
        _activeDownload = null;
    }
    _currentState = UpdateState.AVAILABLE;
    logUpdater('Người dùng đã hủy quá trình tải bản cập nhật');
}

// ── Giải nén & Xác thực bằng Windows tar.exe (libarchive) ───────────────────
function extractArchive(archivePath, targetDir) {
    return new Promise((resolve, reject) => {
        // Tìm tar.exe của Windows
        const systemTar = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'tar.exe');
        const tarExe = fs.existsSync(systemTar) ? systemTar : 'tar.exe';

        logUpdater(`Bắt đầu giải nén: ${archivePath} -> ${targetDir} bằng ${tarExe}`);

        // Xóa sạch thư mục target trước khi giải nén
        try {
            if (fs.existsSync(targetDir)) {
                fs.rmSync(targetDir, { recursive: true, force: true });
            }
            fs.mkdirSync(targetDir, { recursive: true });
        } catch (e) {
            return reject(new Error(`Không thể khởi tạo thư mục staging: ${e.message}`));
        }

        execFile(tarExe, ['-xf', archivePath, '-C', targetDir], { windowsHide: true }, (err, stdout, stderr) => {
            if (err) {
                logUpdater(`Lỗi tar.exe: ${err.message}, stderr: ${stderr}`);
                return reject(new Error(`Giải nén thất bại: ${stderr || err.message}`));
            }
            logUpdater('Giải nén hoàn tất thành công');
            resolve();
        });
    });
}

/**
 * Tìm thư mục chứa binary thực thi sau khi giải nén.
 * Xử lý linh hoạt cả trường hợp file nén chứa thư mục con (ví dụ: CUTTOOL/Cryss.exe)
 * hoặc giải nén ra trực tiếp (Cryss.exe nằm ngay tại gốc).
 */
function findPayloadRoot(stagedDir) {
    // Trường hợp 1: Cryss.exe nằm trực tiếp trong stagedDir
    if (fs.existsSync(path.join(stagedDir, 'Cryss.exe'))) {
        return stagedDir;
    }

    // Trường hợp 2: Cryss.exe nằm trong một thư mục con (ví dụ: CUTTOOL, win-unpacked, ...)
    try {
        const entries = fs.readdirSync(stagedDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const subPath = path.join(stagedDir, entry.name);
                if (fs.existsSync(path.join(subPath, 'Cryss.exe'))) {
                    return subPath;
                }
            }
        }
    } catch (e) {
        logUpdater(`Lỗi khi duyệt thư mục staged: ${e.message}`);
    }

    return null;
}

// ── Toàn bộ luồng Tải & Chuẩn bị Update (Download + Verify + Stage) ────────
async function startDownloadAndStage(webContents) {
    if (!_updateInfo || !_updateInfo.downloadUrl) {
        throw new Error('Chưa có thông tin cập nhật hợp lệ hoặc không có link tải');
    }

    const emitStatus = (status, extra = {}) => {
        _currentState = status;
        if (webContents && !webContents.isDestroyed()) {
            webContents.send('update-status', { status, ...extra });
        }
    };

    const emitProgress = (stats) => {
        _downloadStats = stats;
        if (webContents && !webContents.isDestroyed()) {
            webContents.send('update-progress', stats);
        }
    };

    try {
        emitStatus(UpdateState.DOWNLOADING);
        logUpdater(`Bắt đầu tải bản cập nhật: ${_updateInfo.downloadUrl}`);

        const ext = path.extname(_updateInfo.assetName) || '.rar';
        const downloadFilePath = path.join(getDownloadDir(), `update_latest${ext}`);

        // Xóa file cũ nếu có
        try {
            if (fs.existsSync(downloadFilePath)) fs.unlinkSync(downloadFilePath);
        } catch {}

        // 1. Tải file về
        await downloadWithRedirect(_updateInfo.downloadUrl, downloadFilePath, (p) => {
            emitProgress(p);
        });

        // 2. Xác thực file đã tải
        emitStatus(UpdateState.VERIFYING);
        logUpdater('Đang xác thực tính toàn vẹn của file tải về...');

        if (!fs.existsSync(downloadFilePath)) {
            throw new Error('File tải về không tồn tại');
        }

        const stat = fs.statSync(downloadFilePath);
        if (stat.size <= 1024 * 1024) { // Dưới 1MB là file lỗi/hỏng
            throw new Error(`File tải về quá nhỏ (${formatBytes(stat.size)}), có thể bị gián đoạn.`);
        }

        // 3. Giải nén vào Staging
        emitStatus(UpdateState.STAGING);
        const stagedDir = getStagedDir();
        await extractArchive(downloadFilePath, stagedDir);

        // 4. Kiểm tra cấu trúc payload
        const payloadRoot = findPayloadRoot(stagedDir);
        if (!payloadRoot) {
            throw new Error('Không tìm thấy file Cryss.exe trong gói cập nhật vừa giải nén.');
        }

        // Kiểm tra thư mục resources/app.asar hoặc resources
        const hasResources = fs.existsSync(path.join(payloadRoot, 'resources'));
        if (!hasResources) {
            logUpdater('Cảnh báo: Không tìm thấy thư mục resources trong payload.');
        }

        logUpdater(`Staging hoàn tất hợp lệ. Payload root: ${payloadRoot}`);
        _currentState = UpdateState.READY_TO_RESTART;
        emitStatus(UpdateState.READY_TO_RESTART, { payloadRoot });

        return { ok: true, payloadRoot };
    } catch (e) {
        logUpdater(`Lỗi trong quá trình tải / chuẩn bị update: ${e.message}`);
        _currentState = UpdateState.ERROR;
        emitStatus(UpdateState.ERROR, { error: e.message });
        throw e;
    }
}

// ── Tạo Updater Script và Kích hoạt Khởi động lại ─────────────────────────
function createUpdaterScript(oldPid, targetDir, payloadRoot, backupDir, exeName, logFile) {
    const scriptPath = path.join(getUpdateDir(), 'updater.bat');
    const content = `@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul

set "OLD_PID=${oldPid}"
set "TARGET_DIR=${targetDir}"
set "PAYLOAD_ROOT=${payloadRoot}"
set "BACKUP_DIR=${backupDir}"
set "EXE_NAME=${exeName}"
set "LOG_FILE=${logFile}"

echo =================================================== >> "!LOG_FILE!"
echo [%date% %time%] [Updater] Script bat duoc khoi dong >> "!LOG_FILE!"
echo [%date% %time%] OLD_PID: !OLD_PID! >> "!LOG_FILE!"
echo [%date% %time%] TARGET_DIR: !TARGET_DIR! >> "!LOG_FILE!"
echo [%date% %time%] PAYLOAD_ROOT: !PAYLOAD_ROOT! >> "!LOG_FILE!"

:: 1. Cho tien trinh app cu thoat han (toi da 25 giay)
set "WAIT_COUNT=0"
:WAIT_LOOP
tasklist /fi "PID eq !OLD_PID!" 2>nul | find "!OLD_PID!" >nul
if %ERRORLEVEL% equ 0 (
    set /a WAIT_COUNT+=1
    if !WAIT_COUNT! geq 25 (
        echo [%date% %time%] Tien trinh chua thoat sau 25s, buoc dung PID !OLD_PID!... >> "!LOG_FILE!"
        taskkill /F /PID !OLD_PID! >nul 2>&1
        goto WAIT_DONE
    )
    timeout /t 1 /nobreak >nul
    goto WAIT_LOOP
)
:WAIT_DONE
echo [%date% %time%] Tien trinh !OLD_PID! da ket thuc hoan toan. >> "!LOG_FILE!"

:: Cho them 2 giay de he dieu hanh giai phong file handles
timeout /t 2 /nobreak >nul

:: 2. Sao luu ban cu (Backup truoc khi ghi de de rollback neu co loi)
echo [%date% %time%] Dang tao ban sao luu vao !BACKUP_DIR!... >> "!LOG_FILE!"
if exist "!BACKUP_DIR!" rmdir /s /q "!BACKUP_DIR!" >nul 2>&1
mkdir "!BACKUP_DIR!" >nul 2>&1

:: Sao chep cac file hien tai sang backup (loai tru cac folder update de tranh lap vo tan)
robocopy "!TARGET_DIR!" "!BACKUP_DIR!" /E /R:2 /W:1 /NP /XD "!BACKUP_DIR!" "!PAYLOAD_ROOT!" >nul 2>&1

:: 3. Ghi de file moi tu PAYLOAD_ROOT sang TARGET_DIR
:: QUAN TRONG: Loai tru config.json, gamepath.json, config.ini de bao toan 100% cau hinh nguoi dung!
echo [%date% %time%] Dang chep file cap nhat moi vao !TARGET_DIR!... >> "!LOG_FILE!"
robocopy "!PAYLOAD_ROOT!" "!TARGET_DIR!" /E /R:3 /W:1 /NP /XF config.json gamepath.json config.ini >> "!LOG_FILE!"
set "ROBO_EXIT=%ERRORLEVEL%"
echo [%date% %time%] Robocopy ma ket thuc: !ROBO_EXIT! >> "!LOG_FILE!"

:: Voi Robocopy, ma tu 0 den 7 la thanh cong (ma >= 8 la loi nghiem trong)
if !ROBO_EXIT! geq 8 (
    echo [%date% %time%] [ERROR] Robocopy bi loi (!ROBO_EXIT!), tien hanh ROLLBACK khoi phuc ban cu... >> "!LOG_FILE!"
    robocopy "!BACKUP_DIR!" "!TARGET_DIR!" /E /R:3 /W:1 /NP >> "!LOG_FILE!"
    echo [%date% %time%] Da rollback xong. Khoi dong lai ban cu... >> "!LOG_FILE!"
    start "" "!TARGET_DIR!\\!EXE_NAME!"
    exit /b 1
)

:: Neu file config chua tung ton tai o may user thi copy ban default sang
if not exist "!TARGET_DIR!\\resources\\config.json" (
    if exist "!PAYLOAD_ROOT!\\resources\\config.json" copy /y "!PAYLOAD_ROOT!\\resources\\config.json" "!TARGET_DIR!\\resources\\config.json" >nul
)
if not exist "!TARGET_DIR!\\resources\\unlocker\\gamepath.json" (
    if exist "!PAYLOAD_ROOT!\\resources\\unlocker\\gamepath.json" copy /y "!PAYLOAD_ROOT!\\resources\\unlocker\\gamepath.json" "!TARGET_DIR!\\resources\\unlocker\\gamepath.json" >nul
)
if not exist "!TARGET_DIR!\\resources\\unlocker\\Plugins\\UnlockerIsland\\config.ini" (
    if exist "!PAYLOAD_ROOT!\\resources\\unlocker\\Plugins\\UnlockerIsland\\config.ini" copy /y "!PAYLOAD_ROOT!\\resources\\unlocker\\Plugins\\UnlockerIsland\\config.ini" "!TARGET_DIR!\\resources\\unlocker\\Plugins\\UnlockerIsland\\config.ini" >nul
)

:: 4. Kiem tra file thuc thi sau cap nhat
if not exist "!TARGET_DIR!\\!EXE_NAME!" (
    echo [%date% %time%] [ERROR] Khong tim thay !EXE_NAME! sau khi copy, tien hanh ROLLBACK... >> "!LOG_FILE!"
    robocopy "!BACKUP_DIR!" "!TARGET_DIR!" /E /R:3 /W:1 /NP >> "!LOG_FILE!"
    start "" "!TARGET_DIR!\\!EXE_NAME!"
    exit /b 1
)

:: 5. Cap nhat thanh cong! Xoa backup va chay phien ban moi
echo [%date% %time%] Cap nhat thanh cong 100%! Dang khoi chay phien ban moi... >> "!LOG_FILE!"
rmdir /s /q "!BACKUP_DIR!" >nul 2>&1
start "" "!TARGET_DIR!\\!EXE_NAME!"
echo [%date% %time%] Updater hoan tat xuat sac. >> "!LOG_FILE!"
exit /b 0
`;

    fs.writeFileSync(scriptPath, content, 'utf8');
    return scriptPath;
}

/**
 * Thực hiện khởi động lại để cập nhật:
 * - Đóng Python backend (stopPython)
 * - Kiểm tra môi trường (Packaged vs Dev Mode)
 * - Tạo script updater.bat
 * - Spawn script detached và thoát Electron
 */
async function applyUpdateAndRestart({ pyProc, stopPython }) {
    logUpdater('=== Bắt đầu quy trình Khởi động lại để Cập nhật ===');

    const stagedDir = getStagedDir();
    const payloadRoot = findPayloadRoot(stagedDir);

    if (!payloadRoot) {
        throw new Error('Chưa có bản cập nhật nào sẵn sàng trong thư mục staging.');
    }

    // Kiểm tra môi trường Dev Mode
    if (!app.isPackaged) {
        logUpdater('[Dev Mode] Không thể tự động ghi đè mã nguồn dev.');
        dialog.showMessageBoxSync({
            type: 'info',
            title: 'Chế độ Development',
            message: 'Bản cập nhật đã được tải và chuẩn bị thành công tại:\n' + payloadRoot +
                     '\n\nTrong môi trường Development (mã nguồn), tính năng ghi đè file nhị phân được bỏ qua để bảo vệ mã nguồn. Tính năng tự động thay thế binary sẽ hoạt động 100% trên bản đóng gói (packaged app).'
        });
        return { devMode: true, payloadRoot };
    }

    // Packaged Mode: Đường dẫn cài đặt là thư mục chứa Cryss.exe
    const targetDir = path.dirname(process.execPath);
    const exeName = path.basename(process.execPath);
    const backupDir = getBackupDir();
    const logFile = getUpdaterLogPath();
    const oldPid = process.pid;

    logUpdater(`targetDir: ${targetDir}`);
    logUpdater(`exeName: ${exeName}`);
    logUpdater(`payloadRoot: ${payloadRoot}`);

    // Tạo script updater.bat
    const scriptPath = createUpdaterScript(oldPid, targetDir, payloadRoot, backupDir, exeName, logFile);
    logUpdater(`Script updater đã tạo: ${scriptPath}`);

    // Dừng backend Python trước
    if (typeof stopPython === 'function') {
        try {
            logUpdater('Đang dừng Python backend...');
            await stopPython();
        } catch (e) {
            logUpdater(`Lỗi khi dừng Python backend: ${e.message}`);
        }
    }

    // Spawn updater.bat chạy độc lập hoàn toàn (detached)
    logUpdater('Đang kích hoạt updater.bat chạy nền...');
    const child = spawn('cmd.exe', ['/c', scriptPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
    });
    child.unref();

    logUpdater('Đã kích hoạt updater.bat. Thoát ứng dụng Electron ngay bây giờ...');
    app.exit(0);
}

function getUpdateState() {
    return {
        state: _currentState,
        updateInfo: _updateInfo,
        stats: _downloadStats
    };
}

module.exports = {
    UpdateState,
    getAppVersion,
    compareSemver,
    checkForUpdate,
    startDownloadAndStage,
    cancelDownload,
    applyUpdateAndRestart,
    getUpdateState,
    createUpdaterScript,
    findPayloadRoot,
    extractArchive
};

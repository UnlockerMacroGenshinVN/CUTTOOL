# Hệ thống Auto-Update Toàn Diện - Tài liệu Kỹ Thuật

## Tổng quan

Hệ thống cập nhật của Cryss (Skirk Macro) là cơ chế **Auto-Update trọn vẹn một chạm**:
1. Tự động kiểm tra bản cập nhật mới từ GitHub Releases API.
2. Tải bản cập nhật trực tiếp trong ứng dụng với thanh tiến trình thời gian thực (%, dung lượng, tốc độ tải).
3. Hỗ trợ tự động chuyển hướng HTTP (redirects từ GitHub sang CDN/S3).
4. Xác thực và giải nén bằng công cụ tích hợp sẵn của Windows (`tar.exe` / `libarchive` hỗ trợ `.rar`, `.zip`, `.tar.gz`).
5. Chuẩn bị bản cập nhật tại thư mục Staging an toàn.
6. Khi người dùng bấm **"Khởi động lại để cập nhật"**, ứng dụng đóng sạch sẽ, script `updater.bat` độc lập tiến hành:
   - Chờ app cũ thoát hẳn.
   - Sao lưu (backup) bản cũ để rollback nếu có sự cố.
   - Ghi đè phiên bản mới nhưng **bảo toàn 100% dữ liệu và cấu hình người dùng** (`config.json`, `gamepath.json`, `config.ini`).
   - Tự động Rollback nếu quá trình ghi đè gặp lỗi.
   - Khởi động lại phiên bản mới tự động.

---

## 1. Version Management - Single Source of Truth

### File: `src/UI/version.json`
```json
{
  "version": "1.1.1",
  "channel": "stable"
}
```

**Nguyên tắc**: Tất cả mọi nơi cần đọc phiên bản đều đọc từ file này duy nhất:
- `updater.js` → hàm `getAppVersion()` đọc `version.json`
- `main.js` → IPC `get-app-version` gọi `updater.getAppVersion()`
- `db.js` → gọi `window.unlockerNative.getAppVersion()` để hiển thị trên banner Dashboard

---

## 2. Các IPC Channels & Preload Bridge

### Bảng kênh IPC:

| Channel | Direction | Mục đích |
|---|---|---|
| `get-app-version` | Renderer → Main | Lấy phiên bản hiện tại từ `version.json` |
| `check-for-update` | Renderer → Main → GitHub | Kiểm tra phiên bản mới từ GitHub Release |
| `start-update-download` | Renderer → Main | Bắt đầu tải và chuẩn bị bản cập nhật |
| `cancel-update-download` | Renderer → Main | Hủy tải và dọn dẹp file tạm |
| `apply-update-and-restart` | Renderer → Main | Kích hoạt script updater và thoát app |
| `get-update-state` | Renderer → Main | Lấy trạng thái hiện tại (khi mở lại modal) |
| `open-external-url` | Renderer → Main → Browser | Mở liên kết ngoài (chỉ cho phép GitHub) |
| `update-progress` | Main → Renderer (Event) | Báo tiến trình: %, dung lượng, tốc độ |
| `update-status` | Main → Renderer (Event) | Báo trạng thái: DOWNLOADING, VERIFYING, STAGING, READY_TO_RESTART, ERROR |

### Preload Bridge (`src/UI/preload.js`):
```javascript
checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
getAppVersion: () => ipcRenderer.invoke('get-app-version'),
openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url),
startUpdateDownload: () => ipcRenderer.invoke('start-update-download'),
cancelUpdateDownload: () => ipcRenderer.invoke('cancel-update-download'),
applyUpdateAndRestart: () => ipcRenderer.invoke('apply-update-and-restart'),
getUpdateState: () => ipcRenderer.invoke('get-update-state'),
onUpdateProgress: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('update-progress', handler);
    return () => ipcRenderer.removeListener('update-progress', handler);
},
onUpdateStatus: (cb) => {
    const handler = (_event, data) => cb(data);
    ipcRenderer.on('update-status', handler);
    return () => ipcRenderer.removeListener('update-status', handler);
}
```

---

## 3. UI State Machine (Giao diện Modal & Chuông)

```
                 ┌─────────────────┐
    App load     │      IDLE       │
   ─────────────>│ icon: bell      │
                 │ badge: hidden   │
                 └────────┬────────┘
                          │ auto-check sau 3s
                          │
             ┌────────────┴────────────┐
             │                         │
    hasUpdate = true          hasUpdate = false
             │                         │
             v                         v
   ┌──────────────────┐      ┌─────────────────┐
   │    AVAILABLE     │      │   UP_TO_DATE    │
   │ icon: important  │      │ icon: bell      │
   │ badge: red pulse │      │ title: mới nhất │
   │ btn: Tải & Update│      └─────────────────┘
   └─────────┬────────┘
             │ click "Tải và Cập nhật"
             v
   ┌──────────────────┐
   │   DOWNLOADING    │
   │ Bar: 0% → 100%   │
   │ Speed & MB info  │
   │ btn: Đang tải... │
   └─────────┬────────┘
             │ Tải xong
             v
   ┌──────────────────┐
   │ VERIFY & STAGING │
   │ icon: sync-spin  │
   │ status: Giải nén │
   └─────────┬────────┘
             │ Thành công
             v
   ┌────────────────────────┐
   │    READY_TO_RESTART    │
   │ icon: published_changes│
   │ bell: emerald pulse    │
   │ btn: Restart to Update │
   └─────────┬──────────────┘
             │ click "Khởi động lại"
             v
   ┌────────────────────────┐
   │      APPLY & EXIT      │
   │ Dừng Python backend    │
   │ Chạy updater.bat       │
   │ app.exit(0)            │
   └────────────────────────┘
```

---

## 4. Quá trình Thay thế file & An toàn Dữ liệu (updater.bat)

### 4.1. Nguyên tắc hoạt động
Trên Windows, file thực thi `.exe` và các `.dll` đang mở sẽ bị hệ điều hành khóa. Do đó:
1. `updater.bat` được chạy độc lập thông qua `child_process.spawn('cmd.exe', ..., { detached: true })`.
2. Electron gọi `stopPython()` để tắt backend Python, sau đó gọi `app.exit(0)` để giải phóng file locks.
3. `updater.bat` thăm dò PID cũ (lặp kiểm tra `tasklist`). Khi app cũ thoát hẳn, script đợi thêm 2 giây để Windows giải phóng file handles.

### 4.2. Bảo toàn cấu hình người dùng (Data Preservation)
Lệnh copy dùng `robocopy` với tham số `/XF` (Exclude Files):
```bat
robocopy "%PAYLOAD_ROOT%" "%TARGET_DIR%" /E /R:3 /W:1 /NP /XF config.json gamepath.json config.ini
```
- Không bao giờ ghi đè lên file phím tắt `resources\config.json`.
- Không bao giờ ghi đè lên đường dẫn game `resources\unlocker\gamepath.json`.
- Không bao giờ ghi đè lên cài đặt Unlocker `resources\unlocker\Plugins\UnlockerIsland\config.ini`.
- Nếu máy người dùng chưa từng có file cấu hình (lần đầu cài đặt), script sẽ sao chép file mẫu mặc định từ gói cập nhật.

### 4.3. Cơ chế Tự động Rollback (Fail-Safe)
1. Trước khi thực hiện ghi đè, toàn bộ thư mục ứng dụng hiện tại được sao lưu vào thư mục `backup`.
2. Kiểm tra mã thoát của `robocopy`: các mã `< 8` là thành công; mã `>= 8` là lỗi nghiêm trọng.
3. Nếu copy bị lỗi hoặc file `Cryss.exe` không tồn tại sau khi copy:
   - Script tự động khôi phục toàn bộ bản cũ từ thư mục `backup`.
   - Khởi động lại bản cũ để người dùng vẫn sử dụng bình thường.
   - Ghi lại log chi tiết vào file `%APPDATA%\Cryss\updater.log`.
4. Nếu thành công:
   - Xóa thư mục `backup`.
   - Khởi chạy phiên bản mới `Cryss.exe`.

---

## 5. Thư mục Lưu trữ Dữ liệu Cập nhật

Các thư mục được tạo tự động trong `%APPDATA%\Cryss\updates\`:
- `download/`: Chứa file nén tải về từ GitHub (`update_latest.rar` hoặc `.zip`).
- `staged/`: Chứa các file đã được giải nén sẵn sàng để copy.
- `backup/`: Bản sao lưu tạm thời trước khi ghi đè để rollback nếu có lỗi.
- `updater.bat`: Script batch chịu trách nhiệm thay thế file.
- `updater.log`: Nhật ký ghi lại toàn bộ hoạt động của updater.

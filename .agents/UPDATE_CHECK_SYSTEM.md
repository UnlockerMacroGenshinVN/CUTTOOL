# Hệ thống Check for Update - Tài liệu Code Handling

## Tổng quan

Hệ thống kiểm tra cập nhật sử dụng GitHub Releases API để so sánh phiên bản hiện tại với phiên bản mới nhất trên repo `UnlockerMacroGenshinVN/CUTTOOL`.

## 1. Version Management - Single Source of Truth

### File: `src/UI/version.json`
```json
{
  "version": "1.1.0",
  "channel": "stable"
}
```

**Nguyên tắc**: Tất cả mọi nơi cần đọc phiên bản đều đọc từ file này duy nhất:
- `main.js` → hàm `getAppVersion()` đọc version.json
- `db.js` → gọi IPC `get-app-version` để lấy version từ main process
- `db.html` → `#bannerAppVersion` được cập nhật động bởi JavaScript (không còn hardcode)

**Lý do chọn pattern này**: Tránh mâu thuẫn phiên bản giữa nhiều file (trước đây `package.json` là `1.0.0`, `db.html` hardcode `v1.1`). Khi release mới, chỉ cần sửa 1 file duy nhất.

### Đọc version trong hai môi trường:
```
Dev mode:     __dirname/version.json    (src/UI/version.json)
Packaged:     process.resourcesPath/version.json
```

## 2. Semver Comparison - Hàm so sánh phiên bản

### File: `src/UI/main.js` → `compareSemver(a, b)`

```javascript
function compareSemver(a, b) {
    const parse = (v) => v.replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    // So sánh từng segment: major → minor → patch
    ...
}
```

**Xử lý đặc biệt**:
- Tự loại bỏ prefix `v` hoặc `V` (GitHub tag thường có `v1.0`)
- Hỗ trợ số segment không đều: `1.0` vs `1.0.0` (padding bằng 0)
- Trả về: `1` (a > b), `-1` (a < b), `0` (bằng nhau)
- Không dùng thư viện ngoài (zero dependencies)

## 3. IPC Communication Flow

### Luồng kiểm tra cập nhật:

```
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│  Renderer    │  IPC    │  Main        │  HTTPS  │  GitHub API  │
│  (db.js)     │────────>│  (main.js)   │────────>│              │
│              │         │              │         │  /releases/  │
│              │<────────│              │<────────│  latest      │
│  Cập nhật UI │  Result │  So sánh ver │  JSON   │              │
└──────────────┘         └──────────────┘         └──────────────┘
```

### Các IPC channels mới:

| Channel | Direction | Mô tả |
|---------|-----------|-------|
| `get-app-version` | Renderer → Main → Renderer | Đọc version từ version.json |
| `check-for-update` | Renderer → Main → GitHub → Main → Renderer | Kiểm tra và so sánh phiên bản |
| `open-external-url` | Renderer → Main → OS Browser | Mở link download trong trình duyệt |

### Preload Bridge (`preload.js`):
```javascript
// API mới expose qua contextBridge
checkForUpdate: () => ipcRenderer.invoke('check-for-update')
getAppVersion:  () => ipcRenderer.invoke('get-app-version')
openExternalUrl: (url) => ipcRenderer.invoke('open-external-url', url)
```

## 4. UI State Machine - Trạng thái icon chuông

```
                  ┌─────────────────┐
     App load     │    NORMAL        │
    ─────────────>│ icon: notifications │
                  │ badge: hidden    │
                  └────────┬────────┘
                           │ auto-check sau 3s
                           │
              ┌────────────┴────────────┐
              │                         │
     hasUpdate = true          hasUpdate = false
              │                         │
              v                         v
    ┌─────────────────┐      ┌─────────────────┐
    │  HAS_UPDATE      │      │  UP_TO_DATE      │
    │ icon: notification│      │ icon: notifications│
    │   _important     │      │ badge: hidden    │
    │ badge: visible   │      │ title: "mới nhất"│
    │ color: amber-400 │      └──────────────────┘
    └────────┬────────┘
             │ click bell
             v
    ┌─────────────────┐
    │  MODAL_OPEN      │
    │ Hiện thông tin   │
    │ version + notes  │
    │ + nút tải về     │
    └──────────────────┘
```

## 5. Error Handling

### Các trường hợp lỗi được xử lý:

1. **Không có mạng**: `fetchLatestRelease()` reject → trả về `{ hasUpdate: false, error: "Lỗi kết nối..." }` → bell giữ nguyên trạng thái bình thường
2. **GitHub API rate limit** (60 req/hour cho unauthenticated): Status 403 → reject → xử lý như trường hợp 1
3. **Timeout 10 giây**: Request bị destroy sau 10s → reject
4. **version.json không tồn tại**: Trả về `'0.0.0'` → so sánh sẽ luôn tìm thấy update (fail-safe)
5. **JSON parse lỗi**: Catch và reject với message rõ ràng
6. **IPC API không có** (chạy ngoài Electron): Check `typeof window.unlockerNative.checkForUpdate === 'function'` trước khi gọi

### Nguyên tắc: Fail gracefully, never crash
Tất cả lỗi đều được catch, log ra console, và UI giữ trạng thái bình thường. User không bao giờ thấy crash hay dialog lỗi từ update checker.

## 6. Security - Bảo mật

### Validate URL trước khi `shell.openExternal()`:

```javascript
ipcMain.handle('open-external-url', async (_, url) => {
    const parsed = new URL(url);
    // Chỉ cho phép domain github.com và subdomain
    if (parsed.hostname === 'github.com' || parsed.hostname.endsWith('.github.com')) {
        await shell.openExternal(url);
    }
});
```

**Lý do**: `shell.openExternal()` có thể bị lợi dụng để mở URL độc hại nếu không validate. Chỉ whitelist domain `github.com` để đảm bảo an toàn.

## 7. Cấu trúc dữ liệu trả về

### Object trả về từ `check-for-update`:
```typescript
{
    hasUpdate: boolean,        // true nếu có phiên bản mới hơn
    currentVersion: string,    // "1.1.0"
    latestVersion: string,     // "1.2.0"
    releaseNotes: string,      // Nội dung release body từ GitHub
    downloadUrl: string,       // URL download trực tiếp (asset)
    htmlUrl: string,           // URL trang release trên GitHub
    error?: string             // Message lỗi nếu có
}
```

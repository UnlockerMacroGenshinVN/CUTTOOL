# Hướng dẫn Release - Quy trình tạo phiên bản mới

## Tổng quan

Khi chuẩn bị release mới, AI agent (hoặc developer) **PHẢI**:
1. Tự động cập nhật phiên bản hiện tại lên
2. Hỏi người dùng: đây là **patch nhỏ** hay **version lớn**

## Quy tắc Semantic Versioning

Format: `MAJOR.MINOR.PATCH` (ví dụ: `1.1.0`)

| Loại | Khi nào | Ví dụ |
|------|---------|-------|
| **Patch** (+0.0.1) | Sửa bug, tweaks nhỏ, cập nhật UI minor | `1.1.0` → `1.1.1` |
| **Minor** (+0.1.0) | Thêm tính năng mới, cải tiến đáng kể | `1.1.0` → `1.2.0` |
| **Major** (+1.0.0) | Breaking changes, tái cấu trúc lớn | `1.1.0` → `2.0.0` |

## Checklist trước khi Release

### Bước 1: Xác định loại release
> **AI Agent phải hỏi người dùng:**
> "Bản release này là patch nhỏ (bug fix) hay version lớn (tính năng mới / breaking changes)?"

### Bước 2: Cập nhật phiên bản

Chỉ cần sửa **MỘT file duy nhất**: `src/UI/version.json`

```json
{
  "version": "X.Y.Z",
  "channel": "stable"
}
```

Hệ thống sẽ tự động:
- Hiển thị version mới trên banner Dashboard (`#bannerAppVersion`)
- Dùng version mới để so sánh với GitHub releases

### Bước 3: Đồng bộ `package.json` (tùy chọn)
Cập nhật `"version"` trong `src/UI/package.json` để đồng bộ (không bắt buộc nhưng khuyến khích):
```json
{
  "version": "X.Y.Z"
}
```

### Bước 4: Build
```bat
.\build.bat
```

### Bước 5: Tạo Git Tag và Push
```bash
git add -A
git commit -m "release: vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

### Bước 6: Tạo GitHub Release
1. Truy cập: https://github.com/UnlockerMacroGenshinVN/CUTTOOL/releases/new
2. Chọn tag `vX.Y.Z`
3. Điền release notes
4. Upload file `.zip` hoặc `.rar` đã build
5. Publish release

## Lưu ý quan trọng

> ⚠️ **KHÔNG hardcode version** ở bất kỳ đâu ngoài `version.json`. File `db.html` có hardcode `v1.1` trong HTML nhưng JavaScript sẽ ghi đè bằng giá trị thực từ `version.json` khi trang load.

> ⚠️ **GitHub tag format**: Tag phải bắt đầu bằng `v` (ví dụ: `v1.1.0`, `v2.0.0`). Hàm `compareSemver()` tự strip prefix `v` khi so sánh.

> ⚠️ **GitHub API Rate Limit**: API không xác thực chỉ được 60 request/giờ. Đủ cho app desktop (check 1 lần khi mở app), nhưng không nên poll liên tục.

## Template cho AI Agent

Khi được yêu cầu chuẩn bị release, AI agent nên:

1. Đọc version hiện tại từ `src/UI/version.json`
2. Hỏi user: "Phiên bản hiện tại là vX.Y.Z. Bản release mới này là:"
   - Patch (vX.Y.Z+1) - sửa bug, tweaks nhỏ
   - Minor (vX.Y+1.0) - tính năng mới
   - Major (vX+1.0.0) - breaking changes / tái cấu trúc lớn
3. Cập nhật `version.json` với version mới
4. Cập nhật `package.json` (đồng bộ)
5. Thực hiện build nếu cần

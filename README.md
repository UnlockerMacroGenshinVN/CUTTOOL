# **Skirk Macro**

## Tính năng

- Giao diện người dùng dễ tiếp cận
- Lựa chọn các combo mì ăn liền hoặc tự custom combo dựa trên các khối sẵn có
- Hỗ trợ tạo nhiều combo custom và mỗi combo 1 phím tắt
- Combo tự chỉnh độ trễ phù hợp đối với FPS người dùng nhập vào
- Người dùng có thể tự do bật tắt Macro để không ảnh hưởng tới công việc khác mà không cần đóng app
- Không yêu cầu về chuột xịn
- Tích hợp unlock Fps và 1 số unlocker (injection) khác

## CÁCH TẢI

- Truy cập vào Link [DOWNLOAD](https://github.com/hoanfgzang-blip/Skirk-macro/releases)
- Chọn phiên bản mới nhất
- Đối với WINDOWS: tải file .zip và giải nén, đối với Linux thì theo dõi cách build ở dưới
- Mở folder được giải nén và chạy file Cryss.exe ngay đầu

# **DEV**

## Yêu cầu

- Linux
- Windows
- Python 3
- Node.js và pnpm

## Cài đặt

Tại thư mục dự án, cài các thư viện Python:

```powershell
python -m pip install -r requirements.txt
```

Cài phụ thuộc cho giao diện:

```powershell
cd src\UI
pnpm install
```

## Chạy ở môi trường phát triển

```powershell
cd src\UI
pnpm start
```

Electron sẽ tự khởi động backend Python từ `src/macro/main.py`. Khi Windows hỏi nâng quyền, hãy chấp nhận để macro hoạt động.

## Đóng gói ứng dụng

Sau khi đã cài Python dependencies và `pnpm install`, chạy:

```powershell
.\build.bat
```

Script sẽ đóng gói backend thành `Cryss.exe`, sau đó đóng gói Electron. Bản chạy được nằm tại:

```text
build\app\win-unpacked\Cryss.exe
```

### Linux

Trên Linux, phiên bản CLI chuyên dụng (sử dụng kernel-level `evdev` & `uinput`) nằm tại thư mục `src-linux/`.

1. Cài đặt thư viện:
   - Ubuntu/Debian: `sudo apt install python3-evdev`
   - Arch Linux: `sudo pacman -S python-evdev`
   - Hoặc qua pip: `pip install -r requirements-linux.txt`

2. Khởi chạy:

   ```bash
   chmod +x src-linux/run.sh
   ./src-linux/run.sh
   ```

3. Đóng gói binary độc lập:

   ```bash
   chmod +x build-linux.sh
   ./build-linux.sh
   ```

   File chạy độc lập sẽ nằm tại: `build/dist/Cryss`

## Các nguồn tham khảo

- Fufu.UnlockerIsland
- Các setup Macro app Xmouse trên bilibili Trung

## Liên hệ

- Discord: `rururu_11`
- Facebook: [HoanfGZang.UwU](https://www.facebook.com/HoanfGZang.UwU)

Đây là repo do người Việt tạo ra, kết hợp với AI coding để xây dựng giao diện, mọi thứ trên ứng dụng đều là open source và học hỏi từ các open source free khác, vui lòng không sử dụng cho mục đích thương mại. Có thể hỗ trợ, đóng góp ý kiến hoặc donate thông qua thông tin liên hệ đã để lại


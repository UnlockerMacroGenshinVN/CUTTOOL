# Hướng dẫn cú pháp Macro / Input Sequence cho AI Agent

## 1. Mục đích

Tài liệu này mô tả cú pháp chuỗi lệnh dùng để mô phỏng bàn phím, chuột và một số thao tác Windows. AI agent cần đọc chuỗi này như **một ngôn ngữ lệnh có các tag nằm trong dấu ngoặc nhọn `{...}`**, không phải văn bản thuần túy.

Ví dụ:

```text
{ALT}{F4}
{CTRL}A
{WAITMS:100}{LMB}
{RUN:C:\Windows\System32\notepad.exe}
```

> **Quan trọng:** Chỉ tạo chuỗi lệnh để thực hiện đúng mục tiêu được yêu cầu. Các lệnh như chạy ứng dụng, chạy quyền quản trị, kết thúc tiến trình, gửi Windows message hoặc thao tác chuột có thể gây tác động thực tế. Hãy kiểm tra mục tiêu và yêu cầu xác nhận trước hành động có rủi ro cao hoặc khó hoàn tác.

## 2. Quy tắc phân tích cú pháp

1. **Tag được đặt trong `{` và `}`.** Phần bên trong tag xác định lệnh hoặc tham số.
2. **Phân biệt tag với ký tự thường.** Ví dụ `A`, `my text` là nội dung gõ; `{CTRL}` là tag modifier.
3. **Thứ tự là quan trọng.** Chuỗi được thực hiện theo thứ tự từ trái sang phải, trừ khi ứng dụng chủ đích quy định khác.
4. **Modifier chỉ áp dụng cho phím kế tiếp.** Có thể ghép modifier, ví dụ `{CTRL}{ALT}A`. Muốn gửi thêm một tổ hợp phím khác, cần ghi modifier lại.
5. **Không tự sửa cú pháp theo phỏng đoán.** Giữ đúng tên tag và dấu phân cách như tài liệu này. Các tag có tham số dùng cú pháp cụ thể được ghi ở từng nhóm.
6. **Kiểm tra tính nhất quán của cặp nhấn/thả.** Nếu dùng `{PRESS}`, phải có `{RELEASE}` tương ứng trong cùng chuỗi.
7. **Thời gian có đơn vị rõ ràng.** `{WAIT:n}` và `{HOLD:n}` dùng giây; `{WAITMS:n}` và `{HOLDMS:n}` dùng mili giây.
8. **Đối với tag không rõ hoặc sai định dạng**, không đoán tác dụng. Báo lại tag cần xác minh.

## 3. Modifier tags

Các modifier sau đây có thể kết hợp với nhau và chỉ áp dụng cho **phím kế tiếp**:

```text
{CTRL} {RCTRL} {ALT} {RALT} {SHIFT} {RSHIFT}
{LWIN} {RWIN} {APPS}
```

Ví dụ:

```text
{CTRL}A
{ALT}{F4}
{CTRL}{ALT}DELETE
{CTRL}A{CTRL}S
```

Lưu ý: ví dụ cuối tương ứng với `Ctrl+A`, sau đó `Ctrl+S`; modifier không tự duy trì cho toàn bộ chuỗi.

## 4. Extended key tags

```text
{DEL} {INS} {PGUP} {PGDN} {HOME} {END}
{RETURN} {ESCAPE} {BACKSPACE} {TAB} {PRTSCN}
{PAUSE} {SPACE} {CAPSLOCK} {NUMLOCK} {SCROLLLOCK}
{BREAK} {CTRLBREAK}
```

Các tag này đại diện cho phím đặc biệt, không phải chuỗi ký tự cần gõ.

## 5. Direction key tags

```text
{UP} {DOWN} {LEFT} {RIGHT}
```

Dùng để gửi các phím điều hướng.

## 6. Function key tags

```text
{F1} {F2} {F3} ... {F24}
```

Mỗi phím chức năng phải được viết thành tag riêng, ví dụ `{F5}`.

## 7. Volume key tags

```text
{VOL+} {VOL-} {MUTE}
```

## 8. Media key tags

```text
{MEDIAPLAY} {MEDIASTOP} {MEDIANEXT} {MEDIAPREV}
```

## 9. Mouse button tags

Nút chuột:

```text
{LMB} {RMB} {MMB} {MB4/XMB1} {MB5/XMB2}
```

Tag nhấn xuống hoặc thả nút dùng hậu tố:

- `D`: nhấn xuống (down/pressed)
- `U`: thả ra (up/released)

Ví dụ:

```text
{LMBD} {LMBU}
{RMBD} {RMBU}
{MB4D} {MB5U}
```

Dùng đúng biến thể được hỗ trợ bởi ứng dụng; không tự suy ra rằng mọi alias đều hợp lệ ở mọi phiên bản.

## 10. Mouse wheel tags

```text
{MWUP} {MWDN} {TILTL} {TILTR}
```

## 11. Numeric keypad tags

```text
{NUM0} {NUM1} ... {NUM9}
{NUM+} {NUM-} {NUM.} {NUM/} {NUM*} {NUMENTER}
```

Các phím keypad được phân biệt với chữ số thường khi tag được chỉ định.

## 12. Web / Browser keys

```text
{BACK} {FORWARD} {STOP} {REFRESH}
{WEBHOME} {SEARCH} {FAVORITES}
```

## 13. Toggle key tags

```text
{NUMLOCKON} {NUMLOCKOFF}
{CAPSLOCKON} {CAPSLOCKOFF}
{SCROLLLOCKON} {SCROLLLOCKOFF}
```

Dùng các tag `ON` hoặc `OFF` khi muốn đặt trạng thái cụ thể thay vì chỉ gửi một lần nhấn phím toggle.

## 14. Special function tags

### 14.1. Delay

```text
{WAIT:n}
{WAITMS:n}
{WAITMS:x-y}
```

- `{WAIT:n}`: chờ `n` giây.
- `{WAITMS:n}`: chờ `n` mili giây.
- `{WAITMS:x-y}`: chờ ngẫu nhiên trong khoảng từ `x` đến `y` mili giây.

Ví dụ:

```text
{WAIT:1}
{WAITMS:100}
{WAITMS:50-150}
```

### 14.2. Giữ phím

```text
{HOLD:n}
{HOLDMS:n}
```

- `{HOLD:n}`: giữ phím kế tiếp trong `n` giây.
- `{HOLDMS:n}`: giữ phím kế tiếp trong `n` mili giây.

Ví dụ: `{HOLDMS:50}r`.

### 14.3. Mã phím cấp thấp

```text
{VKC:n}
{EXT:n}
{SC:n}
{SCE:n}
```

- `{VKC:n}`: gửi virtual-key code được chỉ định.
- `{EXT:n}`: gửi extended virtual-key code được chỉ định.
- `{SC:n}`: gửi keyboard scan code được chỉ định.
- `{SCE:n}`: gửi extended keyboard scan code được chỉ định.

`n` là tham số số. Không tự gán ý nghĩa cho mã số nếu chưa có bảng mã phù hợp.

### 14.4. Xóa modifier và clipboard

```text
{CLEAR}
{CB:<text>}
```

- `{CLEAR}`: xóa trạng thái modifier tags như `CTRL`, `ALT`, v.v.
- `{CB:<text>}`: sao chép phần `<text>` được chỉ định vào clipboard.

Ví dụ:

```text
{CLEAR}
{CB:Text to copy}
```

Với `{CB:...}`, cần tuân theo cách parser của ứng dụng xử lý dấu ngoặc nhọn hoặc ký tự đặc biệt trong nội dung; tài liệu hiện có không định nghĩa cơ chế escape.

## 15. Movement tags (di chuyển con trỏ)

```text
{MADD:x,y}
{MSET:x,y}
{PSET:x,y}
{ASET:x,y}
{MSAVE:n}
{MREST:n}
```

- `{MADD:x,y}`: dịch chuyển con trỏ tương đối `x,y` pixel.
- `{MSET:x,y}`: đặt vị trí con trỏ theo hệ tọa độ tương đối với màn hình chính.
- `{PSET:x,y}`: đặt vị trí theo hệ tọa độ của cửa sổ profile.
- `{ASET:x,y}`: đặt vị trí theo hệ tọa độ của cửa sổ đang hoạt động.
- `{MSAVE:n}`: lưu vị trí con trỏ hiện tại vào ô nhớ `n`, từ `1` đến `10`.
- `{MREST:n}`: khôi phục vị trí đã lưu từ ô nhớ `n`, từ `1` đến `10`.

Ví dụ:

```text
{MSAVE:1}{MADD:100,0}{MREST:1}
```

## 16. Application tags

```text
{RUN:<application>}
{RUNHID:<application>}
{RUNMAX:<application>}
{RUNMIN:<application>}
{RUNADM:<application>}
{KILL:<executable>}
```

- `{RUN:...}`: chạy ứng dụng.
- `{RUNHID:...}`: chạy ứng dụng ở chế độ ẩn.
- `{RUNMAX:...}`: chạy ứng dụng ở trạng thái phóng to.
- `{RUNMIN:...}`: chạy ứng dụng ở trạng thái thu nhỏ.
- `{RUNADM:...}`: chạy ứng dụng với quyền quản trị.
- `{KILL:...}`: kết thúc các tiến trình thuộc executable được chỉ định.

**Quy tắc:** Với các tag chạy ứng dụng, cung cấp đường dẫn đầy đủ đến file thực thi, bao gồm phần mở rộng `.EXE`.

Ví dụ:

```text
{RUN:C:\Windows\System32\notepad.exe}
```

Các tag `RUNADM` và `KILL` có thể gây tác động đáng kể. Agent nên xác minh executable và mục tiêu trước khi tạo hoặc thực thi chúng.

## 17. Action tags

```text
{ACTIVATE} {ACTIVATEPARENT} {ACTIVATETOP}
{CURSORBUSY} {CURSORDEFAULT}
{INVERTXY} {INVERTX} {INVERTY}
{LOCKXY} {LOCKX} {LOCKY} {LOCKC}
{UNLOCKXY} {UNLOCKX} {UNLOCKY}
```

- `{ACTIVATE}`: kích hoạt cửa sổ nằm dưới con trỏ.
- `{ACTIVATEPARENT}`: kích hoạt cửa sổ cha của cửa sổ dưới con trỏ.
- `{ACTIVATETOP}`: kích hoạt cửa sổ cấp cao nhất/root owner.
- `{CURSORBUSY}` / `{CURSORDEFAULT}`: đổi kiểu con trỏ giữa busy và default.
- `INVERT...`: đảo trục X, Y hoặc cả hai.
- `LOCK...`: khóa trục X, Y hoặc cả hai; `{LOCKC}` chuyển vòng giữa khóa X, khóa Y và mở khóa.
- `UNLOCK...`: mở khóa trục tương ứng.

## 18. Windows Message tags

```text
{POSTWM:<M>,<L>,<W>}
{SENDWM:<M>,<L>,<W>}
```

- `{POSTWM:...}`: post một Windows message tới cửa sổ nằm dưới con trỏ.
- `{SENDWM:...}`: send một Windows message tới cửa sổ nằm dưới con trỏ.
- `M`: message.
- `L`: giá trị `LPARAM`.
- `W`: giá trị `WPARAM`.

Các giá trị có thể viết ở dạng thập phân hoặc thập lục phân, ví dụ `16` hoặc `0x10`.

Ví dụ về định dạng:

```text
{POSTWM:16,0,0}
{SENDWM:0x10,0,0}
```

Đây chỉ là ví dụ cú pháp; ý nghĩa và độ an toàn của message phụ thuộc vào giá trị được gửi và cửa sổ đích.

## 19. Layer modifier tags

```text
{LAYER:x}
{LAYER:next}
{LAYER:back}
{LAYER:last}
```

- `{LAYER:x}`: chuyển sang layer `x`.
- `{LAYER:next}`: chuyển sang layer tiếp theo.
- `{LAYER:back}`: quay về layer trước đó.
- `{LAYER:last}`: quay lại layer hoạt động gần nhất.

## 20. PRESS / RELEASE

Áp dụng cho send methods `1, 2, 4, 5, 6, 7, 9` theo mô tả của hệ thống:

```text
{PRESS}
{RELEASE}
```

- `{PRESS}`: nhấn giữ phím tiếp theo.
- `{RELEASE}`: thả phím tiếp theo.

**Bắt buộc:** Mỗi phím được nhấn bằng `{PRESS}` phải được thả bằng `{RELEASE}` trong cùng chuỗi.

Ví dụ theo định dạng được cung cấp:

```text
{PRESS}abc{WAITMS100}{RELEASE}cba
```

Ví dụ này cho biết thứ tự nhấn `a`, `b`, `c`, chờ rồi thả `c`, `b`, `a`. Lưu ý rằng ví dụ gốc viết `{WAITMS100}` không có dấu `:` trong khi cú pháp được mô tả ở phần delay là `{WAITMS:n}`. Agent nên kiểm tra parser thực tế để xác định biến thể nào được hỗ trợ; không tự coi hai cách viết là tương đương.

## 21. On Button Pressed / Released / Repeated tags

```text
{OD} {OU} {OR}
```

- `{OD}`: chỉ gửi khi nút được nhấn.
- `{OU}`: chỉ gửi khi nút được thả.
- `{OR}`: chỉ gửi khi nút đang lặp lại.

Đây là các điều kiện gắn với sự kiện nút; chúng không phải phím bấm thông thường.

## 22. Ví dụ tổng hợp

| Mục tiêu | Chuỗi |
|---|---|
| Đóng cửa sổ hiện tại | `{ALT}{F4}` |
| Chọn tất cả | `{CTRL}A` |
| Lưu | `{CTRL}S` |
| Chờ 1 giây | `{WAIT:1}` |
| Chờ 100 ms | `{WAITMS:100}` |
| Gõ `r` với thời gian giữ 50 ms | `{HOLDMS:50}r` |
| Tắt Num Lock | `{NUMLOCKOFF}` |
| Di chuyển con trỏ sang phải 100 px rồi trở lại vị trí đã lưu | `{MSAVE:1}{MADD:100,0}{MREST:1}` |
| Chạy Notepad | `{RUN:C:\Windows\System32\notepad.exe}` |

Ví dụ gõ chữ in đậm `my text` trong Microsoft Word theo quy tắc modifier đã nêu:

```text
{CTRL}bmy text{CTRL}b
```

## 23. Quy trình đề xuất cho AI agent

Khi nhận yêu cầu tạo macro:

1. Xác định mục tiêu người dùng muốn đạt được.
2. Chia thao tác thành các bước theo thứ tự.
3. Chọn tag chính xác cho từng phím, nút chuột, thời gian hoặc hành động.
4. Kiểm tra modifier có được đặt lại trước mỗi phím tắt hay không.
5. Kiểm tra cú pháp tham số: dấu `:`, dấu phẩy, dấu `-`, tên tag và dấu ngoặc nhọn.
6. Kiểm tra mọi cặp `{PRESS}` / `{RELEASE}`.
7. Với đường dẫn ứng dụng, dùng đường dẫn đầy đủ và bao gồm `.EXE`.
8. Với lệnh có tác động lớn như chạy quyền quản trị, kết thúc tiến trình hoặc gửi Windows message, xác minh mục tiêu và xin xác nhận khi cần.
9. Trả về macro trong code block để người dùng có thể sao chép; nêu ngắn gọn các giả định hoặc điểm cú pháp chưa chắc chắn.
10. Không tự khẳng định macro đã chạy thành công nếu agent chỉ mới tạo ra chuỗi lệnh.

## 24. Các điểm cần xác minh với parser thực tế

Tài liệu đầu vào không định nghĩa đầy đủ các trường hợp sau; hãy kiểm tra phần mềm/parser cụ thể trước khi dựa vào chúng:

- Cách escape dấu `}` hoặc ký tự đặc biệt trong `{CB:<text>}`.
- Cách xử lý dấu cách và dấu phẩy trong đường dẫn hoặc tham số ứng dụng.
- Cách phân tích chính xác tag chuột dạng alias như `{MB4/XMB1}` và `{MB5/XMB2}`.
- Biến thể `{WAITMS100}` xuất hiện trong ví dụ PRESS/RELEASE, trong khi phần định nghĩa ghi `{WAITMS:n}`.
- Hành vi khi tag không hợp lệ, thiếu tham số hoặc có modifier chưa được xóa.

Nếu chưa xác minh được, agent cần giữ nguyên cú pháp đã biết và nêu rõ điểm chưa chắc chắn thay vì bịa ra quy tắc mới.
# Hướng dẫn dùng Marble Factory

Làm từng bước theo thứ tự. Mỗi bước có lệnh để chạy và việc cần làm trên màn hình.

Tài liệu tra cứu đầy đủ (mọi thông số trong file map) nằm ở [README.md](README.md).

---

## Bước 1. Cài đặt (chỉ làm một lần)

Máy cần có 3 thứ:

1. **Node.js 24** trở lên: tải ở https://nodejs.org (chọn bản LTS mới nhất).
2. **ffmpeg**: dùng để ghép khung hình thành video MP4.
   - Windows: chạy `winget install Gyan.FFmpeg`, rồi mở lại cửa sổ dòng lệnh.
   - Kiểm tra: gõ `ffmpeg -version`, thấy chữ "ffmpeg version" là được.
3. **Chrome hoặc Edge**: máy Windows nào cũng có Edge sẵn. Dùng để vẽ video ở chế độ chạy ẩn.

Tải code về và cài thư viện:

```bash
git clone https://github.com/billtruong003/ContentEngine.git
cd ContentEngine
npm install
```

---

## Bước 2. Mở editor

```bash
npm run dev
```

Để cửa sổ dòng lệnh này chạy suốt lúc làm việc. Tắt nó là editor ngừng.

Mở trình duyệt vào: **http://localhost:5173/editor.html**

Màn hình chia 3 phần:

- **Thanh trái:** các hình hang và các máy. Kéo thả vào giữa để thêm.
- **Giữa:** bản đồ. Kéo hang để dời, lăn chuột để phóng to thu nhỏ.
- **Bảng phải:** thông số của món đang chọn. Bấm vào chỗ trống để xem thông số của cả video (màu nền, kiểu bi, hiệu ứng).

---

## Bước 3. Mở một map mẫu

Cách nhanh nhất là sửa từ map có sẵn rồi lưu thành tên mới.

1. Bấm **Mở ▾** trên thanh trên cùng.
2. Chọn `ref-c01-spider-signal`. Đây là kiểu video 2 hang tròn: hang trái đầy bi xếp thành hình A, bi chảy qua băng chuyền sang hang phải và xếp thành hình B.
3. Bấm **Chạy thử** (hoặc Ctrl+Enter) để xem bi chảy. Bấm **Sửa tiếp** (hoặc Esc) để quay lại sửa.

Map có ghép hình phải tính xong cả video rồi mới phát được, vì máy cần biết trước mỗi viên bi sẽ nằm ở đâu. Với map `ref-` (5300 bi, 106 giây) mất khoảng 3 phút. Góc trên có ghi "còn khoảng N giây", cứ để đó chờ, app không bị treo.

Các map kiểu này có tên bắt đầu bằng `ref-`:

| Map | Hình đầu → Hình cuối |
|---|---|
| `ref-c01-spider-signal` | Nhện đỏ → Nhện Venom |
| `ref-c02` tới `ref-c04` | Các nhân vật brainrot |
| `ref-c05-among-us` | Crewmate đỏ → Crewmate đen |
| `ref-c06` tới `ref-c10` | Các kiểu màu: lửa, biển, cầu vồng, ô cờ, sọc |

---

## Bước 4. Đổi hình

### Thêm ảnh của m

Bỏ file ảnh (PNG, JPG hoặc WEBP) vào thư mục `public/targets/`. Ảnh vuông, nền trong suốt cho kết quả đẹp nhất. Tải lại trang editor để thấy ảnh mới trong danh sách.

### Đổi hình lúc đầu (hang trái)

1. Bấm vào hang trái (hang **A**).
2. Ở bảng phải, phần **Bi**, ô **Hình lúc đầu**: chọn ảnh.
3. **Vừa khung**: "Hiện đủ ảnh" để thấy trọn ảnh, "Lấp kín" để ảnh phủ kín hang (có thể bị cắt mép).
4. **Màu nền**: màu của bi nằm ở chỗ ảnh trong suốt.

### Đổi hình lúc cuối (hang phải)

1. Bấm vào hang phải (hang **B**).
2. Ở bảng phải, phần **Ghép hình**, ô **Kiểu**: chọn "Theo ảnh" rồi chọn file ở ô **Ảnh**.
3. Muốn dùng màu thay ảnh thì chọn kiểu khác: cầu vồng, chuyển màu, sọc, ô cờ.

Hang phải chỉ hiện được hình khi trên đường nối có **máy sơn** (vạch cầu vồng). Map mẫu đã có sẵn máy này. Bi đi qua máy sẽ đổi sang màu đúng với chỗ nó sẽ nằm cuối cùng.

---

## Bước 5. Lưu

Bấm **Lưu** (Ctrl+S), gõ tên mới, ví dụ `video-meo-cho`. Chỉ dùng chữ thường không dấu, số và dấu gạch ngang.

File lưu vào `maps/video-meo-cho.json`. Mỗi file là một video.

---

## Bước 6. Xuất video

### Cách 1: trong editor

Bấm **Xuất video**. Video ra ở `output/<tên map>.mp4`.

### Cách 2: bằng lệnh (khuyên dùng cho video 2K)

Mở một cửa sổ dòng lệnh **mới** (cửa sổ kia vẫn để editor chạy), vào thư mục ContentEngine rồi gõ:

```bash
npm run render -- video-meo-cho --out output/2k --scale 1.33334
```

- `--scale 1.33334`: xuất 2K (2560x1440). Bỏ đi thì ra Full HD (1920x1080). Ghi `--scale 2` thì ra 4K.
- `--out output/2k`: thư mục chứa video.

Xuất nhiều video một lần:

```bash
npm run render -- "maps/ref-c*" --out output/2k --scale 1.33334
```

Mỗi video 106 giây ở 2K mất khoảng 7 phút. Mỗi map ra 3 file:

- `.mp4`: video có tiếng, đăng được ngay.
- `.jpg`: khung cuối, dùng làm thumbnail.
- `.json`: báo cáo. Có bi kẹt thì xem ở đây.

**Lưu ý:** trong lúc đang xuất video, đừng sửa file trong `src/` hay `public/`. Trang sẽ tự tải lại và làm hỏng video đang xuất.

---

## Bước 7. Kiểm tra trước khi xuất

Khi chạy thử, bi tô **đỏ** là bi kẹt. Góc trên có báo cáo sau mỗi lần chạy.

Kiểm tra cả loạt bằng lệnh:

```bash
npm run check
```

Lệnh này chạy hết các map, báo số bi kẹt, bi rơi khỏi map và số bi trong từng hang. Vài chục viên còn nằm trên máng ở cuối video là bình thường, video gốc cũng vậy.

---

## Khi gặp lỗi

| Thấy gì | Làm gì |
|---|---|
| `ffmpeg` không tìm thấy | Cài lại ffmpeg ở Bước 1, mở lại cửa sổ dòng lệnh |
| Không tìm thấy Chrome | Đặt biến `MARBLE_CHROME` là đường dẫn tới file chrome.exe hoặc msedge.exe |
| Cổng 5173 đang bận | Có một editor khác đang chạy. Tắt nó, hoặc dùng luôn cái đang chạy |
| Hang có viền đỏ trong editor | Map đặt sai, ví dụ băng chuyền cắt qua hang. Đọc dòng lỗi ở góc dưới, nó nói cách sửa |
| Hình ở hang phải bị lủng | Hang chưa đủ bi. Tăng **Số bi** ở hang trái, hoặc thu nhỏ hang phải |
| Bi chảy chậm, nhìn dính | Bấm chỗ trống trên bản đồ, ở bảng phải giảm **Ma sát** (map `ref-` đang để 0.1). Thấp quá thì bi dễ tràn ra gờ và kẹt |
| Hộp xác nhận "Bỏ các thay đổi?" hiện ra khi mở map khác | Map đang sửa chưa lưu. Bấm Hủy rồi Lưu trước, hoặc OK để bỏ |
| Hình lúc đầu bị lệch, trống một góc | Hang trái nhiều bi quá so với cỡ hang. Giảm **Số bi** hoặc phóng to hang |

---

## Bản quyền ảnh

- Ảnh brainrot trong `public/targets/` lấy từ Wikimedia Commons, dùng tự do.
- Ảnh Among Us và biểu tượng nhện (Spider-Man, Venom) thuộc bản quyền của chủ sở hữu. Đăng video kiếm tiền có thể bị kháng nghị bản quyền. Nên thay bằng ảnh m tự vẽ hoặc có quyền dùng.

# Marble Factory

Engine làm video "nhà máy bi": hang, đường ống, van, bi chảy và ghép thành hình. Mỗi video là một file map JSON trong `maps/`.

Hướng dẫn dùng từng bước: [HUONG-DAN.md](HUONG-DAN.md). File này là tài liệu tra cứu đầy đủ.

## Chạy

```bash
npm install
npm run dev        # mở http://localhost:5173
npm test           # chạy mỗi map và template 2 lần, kiểm tra ra y hệt nhau
npm run check      # chạy hết từng map và template, báo bi kẹt / thất lạc / số bi trong từng hang
npm run typecheck
npm run fmt -- maps/ten-map.json   # viết lại file map cho dễ đọc
```

Chọn map bằng `?map=<tên file không có .json>`, ví dụ `?map=one-to-three` hoặc `?map=conveyor`. Mở template bằng `?template=05-vong-tron`.
Phóng to một vùng bằng `?view=x,y,w,h` (toạ độ khung hình), ví dụ `?map=one-to-one&view=200,700,400,300`.

Phím: Space chạy/dừng · ← → tua 1 giây · `,` `.` từng khung · F tua x4 · R xem lại · Shift+R tính lại · H ẩn bảng thông tin.

Bi kẹt được tô đỏ: nằm yên 3 giây ở ngoài hang, hoặc trong một hang đã mở van (hang mở van thì phải xả hết). Cuối mỗi lần tính có báo cáo ở góc trên.

Hang đang mở van có máy rung: viên nào nằm im 2 giây (thường là viên đứng thăng bằng trên gờ giữa hai van) bị đẩy nhẹ cho lăn tiếp. Hướng đẩy lấy theo seed, nên chạy lại vẫn ra y hệt.

## 12 kiểu xếp hang

Mỗi kiểu có sẵn một template trong `templates/`. Mở trong editor (menu "Mới") để làm video mới từ đó.

| Template | Kiểu | Có gì đáng xem |
|---|---|---|
| `01-mot-chay-mot` | A → B | Lục giác thành ngôi sao, sơn sọc neon |
| `02-nhieu-ve-mot` | A, B, C → TO | Ba màu đổ về một bát, sơn ô cờ |
| `03-mot-chia-nhieu` | TO → A, B, C | Mỗi hang con một kiểu chuyển màu |
| `04-day-chuyen` | A → B → C → D | Tam giác, vuông, ngũ giác, tròn, mở van lần lượt |
| `05-vong-tron` | A → B → C → A | Bi chạy vòng mãi qua cổng dịch chuyển |
| `06-thac-nhieu-tang` | 1 → 2 → 4 | Một cầu vồng trải chung qua 4 hang dưới cùng |
| `07-dua-song-song` | 3 đội, 3 đường | Đường thẳng, đường ngoằn ngoèo, đường vòng |
| `08-doi-cho` | A ⇄ B | Đỏ xuống hang chờ, xanh qua cổng sang A, đỏ qua cổng sang B |
| `09-bong-hoa` | 5 cánh → nhụy → 2 lá | Năm màu đổ vào giữa rồi tỏa xuống |
| `10-ghep-tranh` | lưới 3×2 | Sáu mảnh vuông, mỗi mảnh hiện một phần của cùng một ảnh |
| `11-me-cung` | A → 3 ngả | Chỉ một ngả về đích, hai ngả vào ngõ cụt |
| `12-hanh-trinh-dai` | A → B → C → D | Map cao gấp đôi màn hình, camera đi theo bi, cuối video phóng to |

Video mẫu: `npm run render -- "templates/*.json" --out output/templates`.

## Editor

Mở http://localhost:5173/editor.html (hoặc `editor.html?map=one-to-three` để mở thẳng một map).

- **Thêm hang:** kéo hình từ thanh bên trái vào map, hoặc bấm vào hình để thêm vào giữa màn hình.
- **Nối hai hang:** kéo nút `+` dưới hang này sang hang kia. Van, sự kiện mở van và kiểu đường đều tự có. Hang đích cao hơn thì ra băng chuyền, nằm ngay dưới thì ra thác, còn lại ra ống cong.
- **Chỉnh:**
  - Kéo hang để dời, kéo chấm tròn bên phải để đổi cỡ, kéo ô vuông ở đáy để dời van.
  - Ống cong: nháy đúp lên ống để thêm điểm uốn, chuột phải lên điểm uốn để bỏ.
  - Mọi thông số khác nằm ở bảng bên phải.
- **Máy sơn, máy đổi nhân vật:** thả lên đường nối, rồi kéo nút tròn của máy dọc đường để dời chỗ.
- **Lưới** bắt dính khi kéo. Bấm nút để đổi bước 10, 20, 40, 5 hoặc tắt.
- **Gương:** đặt, kéo hoặc nối hang một bên thì hang đối xứng bên kia làm theo. Nút "Lật gương" ở bảng phải tạo bản đối xứng của hang đang chọn.
- **Báo lỗi:** lỗi và cảnh báo hiện ở góc dưới. Hang có lỗi bị viền đỏ.
- **Chạy thử** (Ctrl+Enter) chạy bi ngay trong editor. Bấm Esc hoặc "Sửa tiếp" để quay lại sửa.
- **Lưu** (Ctrl+S) ghi vào `maps/<tên>.json`.
- **Lưu thành template** ghi vào `templates/`. Lần sau chọn nó ở menu "Mới".
- **Hiệu ứng** (bảng phải, khi không chọn gì): bật tắt đuôi sáng, vệt sơn, tia lửa, rung.
- **Kiểu dáng** (bảng phải, khi không chọn gì): chọn theme, kiểu bi, bóng dưới bi, vân trên đất, tiếng bi, tiêu đề.
- **Hình hang** thêm tim, giọt nước, bán nguyệt, chữ nhật bo góc (thanh trái) và hình SVG (chọn ở bảng phải rồi dán `d`). Bảng phải có ô Vách ngăn.
- **Máy** thêm đổi hình, trộn màu, nhân đôi (thanh trái hoặc bảng phải của đường nối). Cổng dịch chuyển có ô "Chỉ nhận màu" để làm máy phân loại.
- **Đường nối** có thêm kiểu Zigzag, Lưới chốt và Bánh xe múc. Máy đổi cỡ thả từ thanh trái như máy sơn.
- Đổi trọng lực, lật màu, kết thúc (`ending`) và map xoay (`spin`), lắc (`rock`) hiện chỉ sửa được trong file JSON hoặc qua `__editor.run`.
- **Camera** (bảng phải, khi không chọn gì): chiều cao map, chiều cao video, đi theo bi, cảnh cuối phóng to vào hang nào.
- **Xuất video** lưu map rồi chạy đúng lệnh `npm run render`, ra `output/<tên>.mp4`.

Phím tắt:

| Phím | Việc |
|---|---|
| Ctrl+Z | Hoàn tác |
| Ctrl+Shift+Z, Ctrl+Y | Làm lại |
| Delete | Xoá món đang chọn |
| Ctrl+D | Nhân đôi hang |
| Phím mũi tên | Dời hang theo bước lưới (giữ Shift để dời x5) |
| Lăn chuột | Phóng to, thu nhỏ |
| Kéo chỗ trống | Kéo khung nhìn |

**Điều khiển bằng script:**
- **Sửa file trên đĩa.** Nếu file đó đang mở trong editor, editor tự nạp lại bản mới, coi đó là một bước sửa (nhãn `file`) và Ctrl+Z để quay về được. Trang không tải lại, nên phần đang sửa dở không mất.
- **Gọi `window.__editor` trong trình duyệt.** Mỗi lần gọi `run` là một bước hoàn tác, ghi nhãn `script`. Gọi sai lệnh thì nhận lại lỗi kèm danh sách lệnh hợp lệ:
  ```js
  __editor.run([
    { op: 'cave.add', id: 'B', x: 540, y: 1500, shape: { kind: 'circle', radius: 160 } },
    { op: 'flow.add', from: 'A', to: 'B' },
    { op: 'machine.set', flow: 0, kind: 'paint', at: 0.6 },
  ])  // → { ok, results, errors, warnings }
  ```
  Lệnh có sẵn: `map.update`, `cave.add|update|remove|rename`, `valve.update|remove|openAt`, `flow.add|update|remove`, `machine.set|remove`. Ngoài ra có `check()`, `undo()`, `redo()`, `history()`, `open(tên)`, `save(tên)`, `saveTemplate(tên)`, `play()`, `exportVideo()`.

## Map hoạt động thế nào

Cả khung hình là một tấm đất đặc. Hang (`caves`) và đường nối (`flows`) là những vùng khoét ra khỏi tấm đất đó, nên không có khe hở ở chỗ nối.

- `caves[].shape.kind`: `circle`, `polygon` (`sides`), `star` (`points`, `inner`), `heart`, `drop` (giọt nước), `moon` (bán nguyệt, như cái bát), `rounded` (chữ nhật bo góc: `aspect` cao ÷ rộng, `corner` độ bo), `path` (hình vẽ sẵn: dán thuộc tính `d` của một path SVG, chỉ lấy hình khép kín đầu tiên). Hình nào cũng có `radius` và `rotation`.
- `caves[].dividers`: `{ "count": 9, "height": 0.75 }` chia hang thành 9 ngăn bằng vách đứng, cao 75% hang. Lưới chốt đổ vào hang chia ngăn thành bảng Galton (`maps/galton.json`).
- `caves[].valves`: cửa ở đáy hang, đóng sẵn, mở bằng sự kiện `valve.open`.
- `flows[].kind`:
  - `pipe`: ống cong từ van xuống hang đích, uốn qua các điểm `via`.
  - `waterfall`: giếng loe rộng dần, bi rơi tự do hoặc trượt theo thành.
  - `conveyor`: băng chuyền gạt đưa bi lên hang cao hơn. Thanh gạt nhô lên từ sàn ống nghiêng, đẩy bi lên, rồi chìm vào đất quay về. Chỉnh được `speed` (px/s), `paddle` (độ cao thanh gạt), `spacing` (khoảng cách giữa các thanh).
  - `zigzag`: ống lắc qua lắc lại trên đường xuống. `turns` số lần lắc (mặc định 4), `swing` lắc ngang bao xa (px). Map thấp quá thì engine tự giảm độ lắc cho khúc nào cũng đủ dốc.
  - `pegs`: lưới chốt. Một máng rộng có các chốt tròn xếp so le, bi va vào chốt rồi tản ra hai bên. `spread` là nửa bề rộng đáy máng (px), bị giới hạn để đáy máng luôn nằm trên hang đích.
  - `wheel`: bánh xe múc. Bi rơi vào gầu ở phía gần, bánh quay đưa qua đỉnh rồi đổ ra cửa ở phía bên kia. Chỉnh `radius`, `arms` (số cánh), `speed` (độ/giây). Cửa ra nằm hơi thấp hơn tâm bánh, nên bánh xe không đưa bi lên cao hơn hang nguồn được. Muốn đưa bi lên cao thì dùng băng chuyền.
  - `portal`: cổng dịch chuyển. Bi rơi vào vòng tím dưới van thì hiện ra ở vòng tím ngay trên hang đích, đi được cả lên cao. Dùng cho vòng tròn và đổi chỗ: băng chuyền luôn chắn ngang giữa hang nguồn và hang đích, nên một vòng khép kín chỉ dùng ống và băng chuyền thì kiểu gì cũng có hai đường cắt nhau.
- `physics`: `gravity` (trọng lực, mặc định 3000), `marbleRadius`, `friction` (ma sát, mặc định 0.2; các map `ref-` dùng 0.1 cho bi trơn hơn), `restitution`, `drag` (lực cản không khí, mặc định 0). Muốn bi rơi chậm thì giảm `gravity` (vd 1500) hoặc tăng `drag` (vd 2 tới 4): bi rơi tới một tốc độ nhất định rồi không nhanh thêm.
- `caves[].funnel`: góc đáy phễu (mặc định 40°) dẫn bi về van, `false` để giữ đáy phẳng.
- Map đặt sai (băng chuyền cắt qua hang, dốc quá, tụt khỏi khung...) sẽ báo lỗi kèm cách sửa, không chạy.
- `ground`: màu đất và màu viền.
- `effects` (không bắt buộc, chỉ đổi hình, không đổi mô phỏng): `{ "tails": true, "stains": true, "sparks": true, "shake": true }`.
  - `tails`: đuôi sáng sau bi chạy nhanh.
  - `stains`: bi lăn tới đâu để lại vệt màu mờ trên nền tới đó, cuối video nền thành một bức tranh.
  - `sparks`: bi qua máy sơn bắn vài tia lửa màu mới.
  - `shake`: màn hình rung khi một đợt lớn bi đổ xuống. Ghi số thay cho `true` để rung mạnh hơn hoặc nhẹ hơn (1 là bình thường).
- `theme` (chỉ đổi hình và tiếng): `paper` giấy kẻ ô, `wood` bàn gỗ, `chalk` bảng đen, `neon` đèn neon, `space` vũ trụ, `factory` nhà máy thép, `candy` kẹo ngọt. Theme đặt luôn màu nền, màu đất, vân đất, kiểu bi và tiếng bi. Có theme thì `frame.background` không dùng nữa.
- `look`: chỉnh riêng, thắng theme. `{ "marble": "glass", "shadow": true, "pattern": "wood", "backdrop": ["#3a2414", "#1e1209"] }`.
  - `marble`: `flat` (như cũ), `glass` thủy tinh, `metal` kim loại, `gem` ngọc có mặt cắt, `glow` phát sáng. Nhân vật giữ nguyên hình.
  - `shadow`: bóng mờ dưới mỗi viên bi.
  - `pattern`: vân trên đất: `plain`, `paper`, `wood`, `chalk`, `dots`, `plates`.
  - `backdrop`: nền sau hang chuyển từ màu trên xuống màu dưới.
- `sound`: tiếng bi va chạm trong video xuất ra: `tick`, `glass`, `wood`, `metal`, `coin`, `pop`.
- `captions`: chữ trên video. Mỗi dòng một `kind`:
  - `{ "kind": "title", "text": "Hình gì sẽ hiện ra?" }`: chữ to, mặc định hiện từ giây 0 tới 3.5 rồi mờ đi.
  - `{ "kind": "countdown", "text": "Còn {n} giây" }`: đếm ngược tới lúc kết video (hoặc tới `until`).
  - `{ "kind": "counter", "cave": "BIG", "text": "{n} bi" }`: số bi đang nằm trong hang, hiện dưới hang.
  - `{ "kind": "label", "cave": "A", "text": "ĐỎ" }`: chữ trên đầu hang, dùng làm tên đội.
  - `{ "kind": "score", "caves": ["A2", "B2", "C2"], "names": ["Đỏ", "Vàng", "Xanh"] }`: bảng điểm đua, hang nhiều bi nhất đứng đầu.
  - Chung: `t`, `until` (giây bắt đầu, kết thúc), `at` (`top`, `middle`, `bottom`), `size` (cỡ chữ, px của video rộng 1080), `color`.
- `ending`: cách kết video.
  - `{ "kind": "break", "t": 14 }`: tới giây 14 đất vỡ, bi bung ra rồi rơi khỏi khung. Bi rơi ra sau lúc vỡ không tính là thất lạc. Ảnh ghép lấy theo đống bi ngay trước lúc vỡ.
  - `{ "kind": "freeze", "t": 13 }`: tới giây 13 cả đống bi đông lại, ngả màu băng, đứng yên 1,5 giây rồi nghiêng và rơi, đất mờ dần.
- `spin`: `{ "t": 1.5, "speed": 30, "until": 13.5 }` cả map quay 30°/giây (số dương là theo chiều kim đồng hồ). Trọng lực bên trong map quay theo, nên bi lăn như trong một cái thùng đang quay.
- `rock`: `{ "t": 12, "angle": 40, "swings": 4, "period": 3 }` từ giây 12 cả map nghiêng qua lại 4 lần, lần đầu 40°, mỗi lần nhỏ dần rồi về thẳng; mỗi lần 3 giây (đây cũng là số mặc định). Lắc nhẹ hơn 30° thì đống bi thường đứng im không chảy. Bi rót vào một chỗ thường dồn đống ở đó và bỏ trống góc xa, lắc thì bi tràn vào cho kín hình. Khác `spin`, lần chạy thử vẫn tính cả `rock` vì nó là một phần của việc đổ bi.
- `events` có thêm `{ "t": 5, "do": "gravity", "angle": 35 }`: tới giây 5 trọng lực nghiêng 35° sang phải (0 là hướng xuống, âm là sang trái, 180 là lộn ngược). `strength` nhân độ mạnh trọng lực, 1 là bình thường.
- `camera` (không bắt buộc): `{ "height": 1920, "follow": true, "zoom": { "cave": "D", "t": 28, "scale": 1.6 } }`.
  - `height`, `width`: cỡ video. Map (`frame`) được cao hơn video, tối đa 4000 px.
  - `follow`: camera đi theo dòng bi đang chạy.
  - `zoom`: từ giây `t`, camera phóng to dần vào hang đó trong 2 giây. Dùng làm cảnh kết.

## Xuất video

```bash
npm run render -- paint-three-to-one                 # ra output/paint-three-to-one.mp4
npm run render -- one-to-one conveyor --out output   # nhiều map một lần
npm run render -- "maps/*.json"                      # tất cả map
npm run render -- one-to-one --scale 2               # 4K dọc (2160x3840)
```

Cần ffmpeg trong PATH và Chrome hoặc Edge (tự tìm; đặt `MARBLE_CHROME` nếu để chỗ khác).

Lệnh này bật dev server, mở map trong một Chrome chạy ẩn, tính mô phỏng, rồi vẽ từng khung (không quay màn hình, nên máy chậm vẫn ra 60fps mượt) và đẩy thẳng vào ffmpeg. Mỗi map ra 3 file:

- `<map>.mp4`: H.264 + AAC, sẵn sàng đăng.
- `<map>.jpg`: khung cuối, dùng làm thumbnail.
- `<map>.json`: báo cáo (kẹt, thất lạc, số bi được sơn, số tiếng va chạm, thời gian xuất).

Âm thanh: mỗi cú va chạm mạnh được ghi theo đúng số khung lúc mô phỏng, rồi tổng hợp thành tiếng "tách" ngắn (tối đa 8 tiếng mỗi khung, có lọc chống vỡ tiếng), nên không thể lệch hình. Nhạc nền tuỳ chọn: thêm `"music": { "file": "ten-bai.mp3", "volume": 0.6 }` vào map, file đặt trong `public/music/`, tự lặp cho đủ độ dài video.

## Tạo hàng loạt

```bash
npm run batch -- --count 10 --seed 1                  # 10 map mới, lọc map kẹt, xuất 10 video vào output/gen-s1/
npm run batch -- --count 5 --lock layout=merge,ending=freeze,effects=tails+sparks
npm run batch -- --count 6 --remix templates/02-nhieu-ve-mot --keep shapes,roads
npm run batch -- --count 30 --no-render --name dem-nay   # chỉ tạo map, xuất sau
npm run batch -- --render "generated/dem-nay-*" --out output/dem-nay   # xuất cả loạt, chạy qua đêm
npm run batch -- --list                               # mọi món và giá trị khóa được
npm run batch -- --count 10 --lock pace=normal        # bi rơi nhanh như cũ
npm run fill -- templates/02-nhieu-ve-mot --write     # làm đầy hang đích của một map có sẵn
```

Mỗi map mới ghép từ các "món": kiểu xếp hang (`layout`), hình hang đích (`target`), đường đi (`road`), kiểu sơn (`paint`), bảng màu sơn (`palette`), màu bi (`marbles`), kết thúc (`ending`), hình bi (`look`), hiệu ứng (`effects`), màu nền (`background`), theme (`theme`), kiểu bi (`skin`), chữ trên video (`text`: tiêu đề, đếm bi, đếm ngược, bảng điểm cho kiểu đua), tiếng bi (`sound`), tốc độ rơi (`pace`: `normal`, `slow`, `slower`; mặc định chọn giữa `slow` và `slower`). Món nào không khóa thì lấy theo seed. Cùng seed, cùng khóa luôn ra cùng map.

Remix giữ nguyên chỗ đặt hang của một map có sẵn, đổi lại những phần không nằm trong `--keep`: `colors`, `paint`, `shapes` (chỉ hang đích không có van), `roads` (chỉ ống, zigzag, thác, lưới chốt không có điểm đi qua), `effects`, `ending`, `style` (theme, kiểu bi, tiếng bi).

Mỗi map ứng viên được chạy thử không cần trình duyệt (vài giây một map). Map bị loại nếu có bi kẹt, bi rơi khỏi map, bi lọt máy sơn, dưới 97% bi vào hang đích, hoặc đống bi chưa nằm yên. Map chạy ổn rồi thì được làm cho đầy: engine đo đống bi phủ bao nhiêu phần hang đích, đổi số bi ở hang nguồn rồi chạy lại, tới khi hang đích đầy khoảng 98% (thường 3 tới 5 lần chạy). Map còn được thêm `rock`: lúc bi vừa vào hết thì lắc vài lần, để bi tràn vào các góc xa chỗ rót (`--no-rock` để tắt, khi đó chỉ nhắm đầy 92%). Hang nguồn không chứa đủ thì được phóng to nếu còn chỗ trong khung, hết chỗ thì hang đích thu nhỏ lại. `--no-fill` bỏ bước này cho nhanh. Với map có sẵn thì dùng `npm run fill` (không có `--write` thì chỉ in ra sẽ đổi gì).

Map đạt thì kết thúc (zoom, lật màu, vỡ, đóng băng) được dời tới ngay sau lúc đống bi nằm yên và video được cắt cho vừa. Hai map trùng hết các món chỉ giữ một.

Map đạt nằm trong `generated/` (mở trong editor: Mở ▾, hoặc `?generated=<tên>`), kèm `output/<đợt>/batch.json` ghi seed và món của từng map. Khi xuất, video nào đã có trong thư mục ra thì bỏ qua, nên lỡ tắt máy giữa đêm thì chạy lại lệnh là làm tiếp.

Trong editor: Mới ▾ → "Map ngẫu nhiên" hoặc "Remix map đang mở". Từ code: `__editor.generate(seed, "layout=race")`, `__editor.remix(seed, ["shapes"])`.

## Nhân vật

Ví dụ: `maps/actors-swap.json` (blob đỏ qua máy hoá blob xanh), `maps/actors-crewmates.json` (crewmate đứng thẳng hoá blob vàng).

Mỗi pack là một thư mục trong `public/packs/<pack>/`. Đặt tên file theo quy ước, không cần khai báo gì thêm:

| File | Nghĩa |
|---|---|
| `red.png` | Nhân vật `red`, ảnh mặc định (png, webp, svg, jpg đều được) |
| `red@scared.png` | Biểu cảm: `scared` (rơi nhanh), `hit` (bị va), `sleep` (nằm yên lâu), `blink` (chớp mắt) |
| `red.hit.wav` | Tiếng kêu khi bị va (WAV 16-bit) |

`npm run packs` quét các thư mục và sinh `pack.json`; `npm run dev` và `npm run render` tự chạy bước này. File đặt sai tên nằm trong mục `unsorted` của `pack.json`.

Dùng trong map:
- `caves[].marbles.actors`: `{ "pack": "blobs", "characters": ["red"], "upright": false, "scale": 1.2 }`. Bỏ `characters` thì lấy đủ các nhân vật trong pack, chia đều theo seed. `upright: true` cho nhân vật đứng thẳng thay vì lăn theo bi.
- `flows[].swap`: `{ "character": "blue", "at": 0.5 }` là máy đổi nhân vật.
- `flows[].shape`: `{ "shape": "star" }` máy đổi hình: bi đi qua được vẽ thành `square`, `triangle`, `star`, `heart` hoặc `diamond`. Va chạm vẫn là hình tròn.
- `flows[].mix`: `{}` máy trộn màu: bi đi qua đổi sang màu pha của tất cả bi qua máy. Ghi `"color"` để chọn màu cố định.
- `flows[].double`: `{}` máy nhân đôi: mỗi viên đi qua sinh thêm một viên y hệt ngay sau nó. Bi sinh ra mang màu của viên gốc, nhưng chưa mang được nhân vật.
- Máy phân loại: nhiều đường `portal` cùng một van, mỗi đường có `"only": ["#ff4d5e"]`. Mỗi cổng chỉ nhận bi có màu ban đầu nằm trong danh sách của nó. Xem `maps/machines.json`.
- `flows[].size`: `{ "scale": 1.6, "at": 0.3 }` là máy đổi cỡ. Viên nào đi qua thì to lên (hoặc nhỏ đi nếu `scale` < 1), cả lúc va chạm lẫn lúc vẽ. Vạch xanh lá là máy phóng to, vạch cam là máy thu nhỏ. Bi to lên có thể kẹt ở van hoặc ống hẹp. Viên nào đi qua thì hoá nhân vật đó. Muốn lấy từ pack khác thì ghi `"pack/id"`.

Biểu cảm tự đổi theo chuyển động. Pack thiếu ảnh biểu cảm nào thì engine giả bằng hiệu ứng: bị va thì bẹp, rơi nhanh thì lắc, ngủ thì tối màu và thở nhẹ. Tiếng va chạm khi xuất video dùng tiếng của đúng nhân vật tại khung đó (đổi nhân vật thì đổi giọng).

Pack có sẵn: `blobs` (tự vẽ bằng `node scripts/make-blobs.ts`, đủ biểu cảm và tiếng, dùng được thoải mái) và `crewmates` (ảnh Among Us, chỉ là ảnh tạm, không có biểu cảm).

## Ghép hình

Ví dụ đầy đủ: `maps/paint-three-to-one.json`.

1. Gắn ảnh đích cho hang nhận bi: `"paint": { "mode": "image", "image": "ten-anh.png", "fit": "contain", "background": "#e9edf5" }`. Ảnh đặt trong `public/targets/`. Không dùng ảnh thì chọn một kiểu sơn có sẵn (bảng dưới).
2. Đặt máy sơn trên đường nối: `"paint": {}` trong `flows[]` (thêm `"at": 0.7` để đặt máy ở 70% quãng đường). Máy là một vạch cầu vồng chắn ngang đường đi.
3. Engine tính hết cả video, lấy chỗ nằm cuối của từng viên, lấy màu ảnh tại đó. Lúc phát lại, viên nào cắt qua máy sơn thì đổi sang màu đó, nên cuối video đống bi hiện thành hình.

Các kiểu sơn (`paint.mode`):

| Kiểu | Ra gì | Chỉnh thêm |
|---|---|---|
| `image` | Ảnh | `fit`: `contain` hiện đủ ảnh, `cover` lấp kín |
| `rainbow` | Cầu vồng | `direction`: `x` trái sang phải, `y` trên xuống dưới |
| `gradient` | Chuyển dần qua các màu | `colors` hoặc `palette`, `direction` |
| `stripes` | Sọc đều | `bands` (số sọc, mặc định 6), `direction` (mặc định `y` là sọc ngang) |
| `checker` | Ô cờ | `cell` (cỡ ô px, mặc định 40), lấy 2 màu đầu |
| `depth` | Đáy đậm, đỉnh nhạt | `colors`: màu đáy rồi màu đỉnh |

- `colors`: danh sách màu `#rrggbb`. Không ghi thì lấy theo `palette`: `pastel`, `neon`, `earth`, `ocean`, `candy`, `fire`.
- `flip`: kết thúc lật màu. `"flip": { "t": 20, "mode": "checker", "colors": ["#ffd23f", "#10131a"] }` đặt trong `paint` của hang: tới giây 20, cả đống bi trong hang đổi sang kiểu sơn thứ hai, gợn từ trên xuống trong khoảng 2/3 giây. Dùng mọi kiểu sơn ở bảng trên, kể cả ảnh thứ hai.
- `"fit": "shared"`: nhiều hang có cùng một `paint` thì dùng chung một tấm, mỗi hang hiện đúng mảnh của nó. Dùng cho ghép tranh nhiều mảnh (`10-ghep-tranh`) hoặc một dải cầu vồng chạy qua cả hàng hang (`06-thac-nhieu-tang`).

`npm run check` báo số bi qua máy sơn và số bi "lọt": nằm trong hang có ảnh đích mà chưa qua máy nào. Lọt > 0 thì tính là lỗi, vì hình sẽ bị lủng.

Ảnh hiện thành hình rõ nhất khi đống bi lấp gần kín hang đích. Bi bán kính 3 px với khoảng 4.500 viên cho hình đủ nét. Ảnh `public/targets/placeholder-crewmate-red.webp` chỉ là ảnh tạm (Among Us), không dùng cho video đăng thật.

## Cấu trúc

| Thư mục | Việc |
|---|---|
| `src/core` | RNG theo seed (không dùng `Math.random` ở đâu cả), bước thời gian |
| `src/map` | Kiểu dữ liệu map, kiểm tra map, khoét đất (`terrain.ts`), dựng hang và đường nối (`layout.ts`), theme có sẵn (`theme.ts`) |
| `src/physics` | Mô phỏng Rapier2D bản deterministic chạy trong Web Worker, ghi lại từng khung |
| `src/render` | Vẽ bằng Three.js: đất bằng shader, bi bằng InstancedMesh. `camera.ts` tính đường đi của camera, `effects.ts` vẽ đuôi sáng, vệt sơn, tia lửa, rung. `captions.ts` vẽ chữ trên video |
| `src/editor` | Map Editor: bộ lệnh sửa map (`commands.ts`), lịch sử hoàn tác, vùng vẽ, bảng thông số |
| `src/generator` | Tạo map theo seed và remix (`generate.ts`), chạy thử để loại map hỏng (`trial.ts`) |
| `templates/` | 12 template cho 12 kiểu xếp hang, cộng template lưu từ editor |
| `maps/` | Map mẫu |
| `generated/` | Map do `npm run batch` tạo |
| `scripts/` | Test tính xác định, kiểm tra kẹt, xuất video, chạy hàng loạt, định dạng file map |


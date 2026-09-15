# Kế hoạch giao diện người dùng Android — Cổng bệnh nhân

> Ngày lập: 15/09/2026
> Nguồn đối chiếu: `quan_ly_phong_kham.sql`, OpenAPI hiện tại và mã nguồn `fe/mobile`
> Nền tảng: React Native + Expo SDK 57, TypeScript, React Navigation, TanStack Query
> Phạm vi: ứng dụng Android dành cho bệnh nhân/người giám hộ có vai trò `PATIENT`

## 1. Mục tiêu

Xây giao diện Android giúp người dùng:

- Xem thông tin chi nhánh, chuyên khoa, bác sĩ, dịch vụ và bảng giá mà không cần đăng nhập.
- Đăng ký, xác minh OTP, đăng nhập và quản lý an toàn phiên tài khoản.
- Quản lý các hồ sơ bệnh nhân đã được ủy quyền, gồm bản thân và người thân.
- Tìm chi nhánh, dịch vụ, bác sĩ và khung giờ còn trống; đặt, đổi, hủy và theo dõi lịch khám.
- Theo dõi số thứ tự khi đã check-in.
- Xem lịch sử khám, kết quả, đơn thuốc và hóa đơn chỉ sau khi dữ liệu đủ điều kiện công bố.
- Nhận thông báo nhắc lịch và thay đổi quan trọng.

Ứng dụng không dành cho bác sĩ, lễ tân, dược sĩ, thu ngân hoặc quản trị viên. Các vai trò này tiếp tục dùng Admin Web. Mobile không gọi SQL trực tiếp; mọi dữ liệu đi qua Gateway và API có kiểm tra quyền.

## 2. Hiện trạng và giới hạn

### 2.1 Chức năng đã có trên Mobile

| Khu vực | Mức hiện tại | Tệp liên quan |
|---|---|---|
| Khôi phục phiên, đăng nhập, đăng xuất | Đã có | `App.tsx`, `patient-auth.tsx` |
| Đăng ký bệnh nhân và xác minh OTP | Đã có | `patient-auth.tsx` |
| Xem hồ sơ được ủy quyền, gửi/hủy yêu cầu liên kết, thu hồi link | Đã có | `patient-access-screen.tsx` |
| Xem, đặt, đổi, hủy lịch | Đã có | `appointment-screen.tsx` |
| Điều hướng | Stack đơn giản | `App.tsx` |
| Lịch sử khám, kết quả, đơn thuốc, hóa đơn, thông báo | Chưa có giao diện bệnh nhân | — |

Các màn hiện tại đã hoàn thành luồng nghiệp vụ lõi nhưng còn dồn nhiều nội dung vào màn cuộn dài, nhập ngày bằng chuỗi và chưa có hệ thống điều hướng phù hợp khi mở rộng.

### 2.2 Mức sẵn sàng của dữ liệu

| Nhóm | Bảng/view/procedure SQL liên quan | Mức sẵn sàng cho UI |
|---|---|---|
| Tài khoản và phiên | `users`, `user_sessions`, `patient_registration_challenges`, các `sp_auth_*` | Đã có nền tảng; cần bổ sung màn quên/đổi mật khẩu và quản lý phiên |
| Hồ sơ được ủy quyền | `user_patient_access`, `patient_access_requests`, `sp_auth_get_patient_access`, `sp_auth_request_patient_link` | Đã có API và Mobile |
| Danh mục công khai | `branches`, `specialties`, `services`, `service_branch_prices`, `v_public_*_v1` | Đã có API công khai |
| Danh bạ bác sĩ | `employees`, `doctors`, `doctor_branch_assignments`, `doctor_specialties`, `doctor_services`, `v_public_doctors_v1` | Đã có API công khai; hiện chỉ trả bác sĩ đang nhận đặt lịch online |
| Lịch khám | `appointment_slots`, `appointments`, history và các `sp_clinic_*appointment*` | Đã có API và Mobile |
| Hàng đợi | `queue_sessions`, `queue_tickets`, `v_current_queue` | SQL đã có; thiếu API chỉ trả đúng ticket của hồ sơ được ủy quyền |
| Hồ sơ khám | `encounters`, sinh hiệu, chẩn đoán, dịch vụ, kết quả, tệp đính kèm | SQL có dữ liệu nội bộ; chưa có cờ/quy trình công bố đầy đủ cho bệnh nhân |
| Đơn thuốc | `prescriptions`, `prescription_items`, `dispensations` | SQL có; API hiện thiên về nhân viên nhà thuốc, chưa có read model bệnh nhân |
| Hóa đơn | `invoices`, `invoice_items`, `payments`, allocations/refunds | SQL có; API hiện thiên về thu ngân, chưa có read model bệnh nhân |
| Thông báo | `notifications`, outbox và worker | Có gửi email/SMS/PUSH/IN_APP; thiếu inbox, trạng thái đã đọc và đăng ký thiết bị cho Mobile |

## 3. Nguyên tắc sản phẩm và UI

1. **Hồ sơ đang chọn là ngữ cảnh toàn ứng dụng.** Tất cả lịch khám, lịch sử, đơn thuốc và hóa đơn phải hiển thị rõ đang xem cho ai.
2. **Không suy diễn quyền từ giao diện.** Backend phải kiểm tra `user_patient_access.status = ACTIVE`; với đặt lịch còn yêu cầu `is_booking_allowed = 1`.
3. **Chỉ dùng `public_id` trong route/API.** Không đưa các khóa `bigint` nội bộ lên URL, log UI hoặc deep link.
4. **Dữ liệu lâm sàng chỉ đọc.** Người dùng không sửa chẩn đoán, kết quả, đơn thuốc hoặc hóa đơn từ Mobile.
5. **Không hiển thị dữ liệu nháp/nội bộ.** Không trả `internal_note`, hash, audit ID, người thao tác nội bộ, kết quả chưa công bố hoặc đơn thuốc `DRAFT`.
6. **Thời gian theo chi nhánh.** Lịch hiển thị theo `branches.timezone_name`; thời điểm tuyệt đối từ backend vẫn dùng UTC.
7. **Hành động nguy hiểm phải xác nhận.** Hủy lịch và thu hồi quyền truy cập cần hộp thoại nêu hậu quả rõ ràng.
8. **Tối ưu cho Android tiếng Việt.** Dùng date picker/time picker, bàn phím đúng loại dữ liệu, định dạng `dd/MM/yyyy`, giờ 24 giờ và tiền `vi-VN`.
9. **Mọi màn đều có đủ trạng thái.** Loading/skeleton, rỗng, lỗi có thể thử lại, mất mạng, hết phiên và dữ liệu vừa thay đổi.
10. **Không lưu bền dữ liệu sức khỏe nếu chưa cần.** Token refresh dùng SecureStore; cache lâm sàng mặc định chỉ ở bộ nhớ và xóa khi đăng xuất.
11. **Danh mục là nội dung công khai.** Người dùng được xem chi nhánh, chuyên khoa, dịch vụ/bảng giá và bác sĩ trước khi đăng nhập; chỉ yêu cầu đăng nhập khi đặt lịch hoặc mở dữ liệu cá nhân.

## 4. Kiến trúc điều hướng đề xuất

```text
Public/Auth stack
├── Chào mừng/Khám phá
├── Chi nhánh
├── Chuyên khoa
├── Dịch vụ và bảng giá
├── Bác sĩ
├── Đăng nhập
├── Quên mật khẩu
├── Đặt lại mật khẩu/OTP
└── Đăng ký
    ├── Thông tin cá nhân
    ├── Xác minh OTP
    └── Hoàn tất

App tabs
├── Trang chủ
│   ├── Chuyển hồ sơ
│   ├── Lịch gần nhất
│   ├── Theo dõi hàng đợi
│   └── Trung tâm thông báo
├── Khám phá
│   ├── Chi nhánh
│   ├── Chuyên khoa
│   ├── Dịch vụ và bảng giá
│   └── Danh sách/chi tiết bác sĩ
├── Lịch khám
│   ├── Danh sách lịch
│   ├── Chi tiết lịch
│   └── Luồng đặt/đổi lịch
├── Hồ sơ
│   ├── Thông tin hành chính
│   ├── Dị ứng/bệnh nền/bảo hiểm/liên hệ khẩn cấp
│   ├── Lịch sử khám
│   ├── Kết quả
│   ├── Đơn thuốc
│   ├── Hóa đơn
│   └── Quản lý quyền truy cập
└── Tài khoản
    ├── Thông tin tài khoản
    ├── Đổi mật khẩu
    ├── Phiên đăng nhập
    ├── Cài đặt thông báo
    └── Đăng xuất
```

Bottom navigation có 5 mục: **Trang chủ**, **Khám phá**, **Lịch khám**, **Hồ sơ**, **Tài khoản**. Thông báo mở từ biểu tượng chuông ở header Trang chủ. Các màn chi tiết dùng native stack. Khi chưa đăng nhập, người dùng vẫn vào được Khám phá; CTA đặt lịch sẽ chuyển sang Đăng nhập rồi quay lại đúng bác sĩ/dịch vụ đã chọn.

## 5. Danh mục màn hình

### 5.1 Trước đăng nhập

#### A01 — Khởi động và khôi phục phiên

- Hiển thị splash thương hiệu trong lúc đọc refresh token từ SecureStore.
- Refresh thành công và có role `PATIENT`: vào Trang chủ.
- Refresh thất bại/hết hạn/không đúng role: xóa token và về Chào mừng.
- Không hiển thị thoáng qua dữ liệu của phiên cũ.

#### A02 — Chào mừng

- Thông điệp ngắn, ba CTA: **Khám phá dịch vụ**, **Đăng nhập** và **Tạo tài khoản**.
- Có thông tin hỗ trợ/phòng khám, điều khoản và chính sách riêng tư ở cuối.

#### A03 — Đăng nhập

- Email hoặc số điện thoại; mật khẩu; bật/tắt hiện mật khẩu.
- Liên kết **Quên mật khẩu** và **Đăng ký**.
- Thông báo lỗi thân thiện nhưng không tiết lộ tài khoản có tồn tại hay không.
- Khóa nút khi gửi request; không gửi trùng.

#### A04 — Đăng ký và OTP

- Bước 1: họ tên, ngày sinh bằng date picker, giới tính, email/SMS, mật khẩu.
- Bước 2: OTP 6 số, tự chuyển ô, đếm ngược gửi lại, số lần thử còn lại nếu API cho phép.
- Bước 3: thành công, hiển thị `patient_code` và CTA đăng nhập.
- Giữ nguyên `Idempotency-Key` khi retry cùng payload; tạo key mới khi người dùng đổi dữ liệu.

#### A05 — Quên/đặt lại mật khẩu

- Nhập email/số điện thoại, nhận phản hồi chung chống dò tài khoản.
- Nhập OTP/token và mật khẩu mới.
- Thành công thì đưa về đăng nhập; tùy chính sách có thể thu hồi toàn bộ phiên cũ.

### 5.2 Khám phá thông tin phòng khám

Đây là khu vực công khai, không yêu cầu tài khoản. Dữ liệu lấy từ các view `v_public_branches_v1`, `v_public_specialties_v1`, `v_public_services_v1`, `v_public_doctors_v1` qua Gateway/API.

#### C01 — Trang Khám phá

- Ô tìm kiếm chung theo tên bác sĩ, chuyên khoa hoặc dịch vụ.
- Bốn nhóm truy cập nhanh: **Chi nhánh**, **Chuyên khoa**, **Bảng giá dịch vụ**, **Đội ngũ bác sĩ**.
- Chuyên khoa nổi bật, bác sĩ nhận lịch online và dịch vụ phổ biến.
- Banner đặt lịch dẫn vào luồng chọn dịch vụ; nếu chưa đăng nhập thì giữ lựa chọn và yêu cầu đăng nhập ở bước xác nhận.

#### C02 — Danh sách và chi tiết chi nhánh

- Danh sách card: tên, địa chỉ rút gọn, số điện thoại và trạng thái đang nhận lịch online.
- Tìm theo tên/quận/tỉnh; sắp xếp theo tên. Tính “gần tôi” chỉ triển khai sau khi có quyền vị trí và tọa độ chi nhánh.
- Chi tiết: tên, địa chỉ đầy đủ, điện thoại, email, thời gian giữ chỗ, thời hạn hủy lịch và số ngày cho phép đặt trước.
- CTA: **Gọi phòng khám**, **Xem bảng giá tại đây**, **Xem bác sĩ**, **Đặt lịch**.
- SQL hiện chưa có giờ mở cửa hoặc tọa độ; không hiển thị hai nội dung này cho đến khi bổ sung dữ liệu.

#### C03 — Danh sách và chi tiết chuyên khoa

- Card chuyên khoa gồm tên và mô tả ngắn từ `specialties`.
- Chi tiết gồm mô tả, các dịch vụ thuộc chuyên khoa và bác sĩ phù hợp.
- CTA **Xem lịch trống** giữ sẵn filter chuyên khoa.
- Chỉ hiển thị chuyên khoa `is_active = 1`.

#### C04 — Dịch vụ và bảng giá

- Bắt buộc chọn chi nhánh trước vì giá nằm trong `service_branch_prices` và có thể khác nhau giữa các cơ sở.
- Tìm theo tên/mã; lọc theo nhóm dịch vụ, chuyên khoa và loại `CONSULTATION`, `LAB`, `IMAGING`, `PROCEDURE`, `VACCINATION`, `OTHER`.
- Mỗi dòng/card hiển thị tên dịch vụ, nhóm, chuyên khoa, thời lượng dự kiến, giá VND hiện hành và có cần bác sĩ hay không.
- Chi tiết dịch vụ hiển thị giá, ngày hiệu lực, các bác sĩ thực hiện và các slot phù hợp.
- Chỉ lấy khoảng giá có `is_available = 1`, `effective_from <= ngày hiện tại <= effective_to` theo múi giờ chi nhánh.
- Ghi chú rõ: “Giá tham khảo tại thời điểm tra cứu; tổng chi phí thực tế phụ thuộc dịch vụ phát sinh và bảo hiểm”.
- Không dùng `services.current_price` để hiển thị bảng giá theo chi nhánh; dùng giá hiệu lực từ `v_public_services_v1`.

#### C05 — Danh sách bác sĩ

- Tìm theo họ tên; lọc theo chi nhánh, chuyên khoa và dịch vụ.
- Card hiển thị học hàm/học vị (`academic_title`), họ tên, chuyên khoa chính/phụ, chi nhánh làm việc và CTA **Xem chi tiết**/**Đặt lịch**.
- Chỉ hiển thị bác sĩ active, nhân viên active, tài khoản active, phân công chi nhánh còn hiệu lực và `accepts_online_booking = 1`, đúng như `v_public_doctors_v1`.
- Không hiển thị số điện thoại/email cá nhân, ngày sinh, địa chỉ, mã nhân viên hoặc user ID.

#### C06 — Chi tiết bác sĩ

- Header: ảnh đại diện mặc định hoặc ảnh hồ sơ sau khi có trường media công khai; học hàm/học vị và họ tên.
- Nội dung: tiểu sử (`biography`), chuyên khoa, chi nhánh đang làm việc, dịch vụ có thể đặt và thời lượng slot mặc định.
- Khu **Lịch gần nhất** lấy từ `/api/v1/public/availability` sau khi chọn chi nhánh/dịch vụ.
- CTA **Đặt lịch với bác sĩ này** mở wizard với doctor/branch/service được điền sẵn.
- `medical_license_no` không nằm trong view công khai hiện tại. Chỉ công khai số chứng chỉ nếu có quyết định sản phẩm/pháp lý và cập nhật API rõ ràng.

### 5.3 Trang chủ

#### H01 — Dashboard bệnh nhân

- Header: lời chào, avatar chữ cái, chuông thông báo.
- Bộ chuyển hồ sơ luôn hiển thị tên, mã bệnh nhân và quan hệ (`SELF`, con, vợ/chồng...).
- Thẻ lịch gần nhất: thời gian, dịch vụ, bác sĩ, chi nhánh, trạng thái, thời hạn giữ chỗ.
- Nếu đã check-in: thẻ số thứ tự, phòng, trạng thái hàng đợi và thời điểm cập nhật.
- Lối tắt: Đặt lịch, Lịch sử khám, Đơn thuốc, Hóa đơn.
- Banner chỉ xuất hiện khi có hành động: xác nhận/hết giữ chỗ, hóa đơn còn thiếu, kết quả mới được công bố.

### 5.4 Lịch khám

#### B01 — Danh sách lịch

- Hai phân đoạn: **Sắp tới** và **Lịch sử**.
- Bộ lọc hồ sơ và trạng thái; nhóm theo tháng.
- Card gồm dịch vụ, ngày giờ địa phương, bác sĩ, chi nhánh và status chip.
- Kéo để làm mới; phân trang khi dữ liệu lớn.

#### B02 — Chi tiết lịch

- Hiển thị `appointment_code`, hồ sơ đi khám, dịch vụ, bác sĩ, phòng, chi nhánh, địa chỉ, thời gian và ghi chú của bệnh nhân.
- `PENDING`: hiển thị đếm ngược từ `hold_expires_at_utc` và cảnh báo có thể hết chỗ.
- `PENDING`/`CONFIRMED`: cho đổi hoặc hủy khi backend xác nhận còn trong deadline.
- `CHECKED_IN`: CTA theo dõi hàng đợi.
- `IN_PROGRESS`/`COMPLETED`: chỉ đọc; sau công bố có CTA xem hồ sơ khám.
- `CANCELLED`/`NO_SHOW`/`EXPIRED`: hiển thị lý do phù hợp và CTA đặt lại.

#### B03 — Luồng đặt lịch

Thiết kế thành 5 bước thay vì một màn cuộn dài:

1. Chọn hồ sơ có `bookingAllowed = true`.
2. Chọn chi nhánh, chuyên khoa/dịch vụ.
3. Chọn bác sĩ tùy chọn; nếu không chọn thì xem mọi bác sĩ nhận lịch online.
4. Chọn ngày và slot; hiển thị giờ, bác sĩ, phòng và giá hiệu lực.
5. Kiểm tra lại, nhập lý do khám, xác nhận giữ chỗ.

Sau khi đặt thành công, chuyển đến Chi tiết lịch và làm mới danh sách. Nếu nhận `SLOT_CONFLICT` hoặc `AVAILABILITY_CHANGED`, giữ nguyên bộ lọc và yêu cầu chọn slot khác.

#### B04 — Đổi lịch

- Tái sử dụng bước chọn slot nhưng khóa hồ sơ hiện tại.
- Hiển thị lịch cũ và lịch mới cạnh nhau ở bước xác nhận.
- Bắt buộc lý do; ghi rõ lịch cũ chỉ được nhả sau khi đổi thành công.

#### B05 — Hủy lịch

- Bottom sheet xác nhận, lý do chọn nhanh hoặc nhập tự do.
- Hiển thị deadline hủy theo chính sách chi nhánh.
- Chỉ cập nhật UI sau response thành công; lỗi concurrency thì tải lại lịch.

### 5.5 Hồ sơ và quyền truy cập

#### P01 — Danh sách hồ sơ được ủy quyền

- Mỗi card hiển thị tên, mã, ngày sinh, quan hệ, trạng thái và quyền đặt lịch.
- Hồ sơ `ACTIVE` có thể chọn làm hồ sơ hiện tại.
- Chỉ cho tự thu hồi liên kết người thân; liên kết `SELF` cần chính sách hỗ trợ rõ trước khi mở nút.

#### P02 — Yêu cầu liên kết hồ sơ

- Chọn chi nhánh, nhập mã bệnh nhân, ngày sinh, quan hệ và ghi chú.
- Danh sách request `PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`; hiển thị hạn xử lý/hết hạn.
- Request không khớp vẫn dùng thông báo chung để chống dò dữ liệu bệnh nhân.

#### P03 — Thông tin hành chính

- Họ tên, ngày sinh, giới tính, mã bệnh nhân, liên hệ, địa chỉ, nhóm máu, nghề nghiệp.
- Phiên đầu chỉ đọc. Chỉ bật chỉnh sửa sau khi có endpoint patient self-service, validation và `If-Match`/row version.

#### P04 — Thông tin sức khỏe cơ bản

- Bốn nhóm: dị ứng, bệnh nền, bảo hiểm, liên hệ khẩn cấp.
- Hiển thị dị ứng mức `SEVERE` nổi bật; không dùng màu là tín hiệu duy nhất.
- Phiên đầu chỉ đọc vì SQL hiện có bảng nhưng chưa có command tự cập nhật dành cho bệnh nhân.

### 5.6 Khám bệnh và hàng đợi

#### Q01 — Theo dõi hàng đợi

- Chỉ hiển thị ticket thuộc hồ sơ đang chọn và lượt khám hiện tại.
- Dữ liệu: `display_number`, phòng, bác sĩ, trạng thái, thời điểm được gọi.
- Trạng thái: Chờ gọi, Đã gọi, Đang phục vụ, Hoàn tất, Bỏ qua, Đã hủy.
- Poll khi app foreground; dừng khi background. Có nút tải lại và ghi “Cập nhật lúc…”.
- Không dùng trực tiếp `v_current_queue` vì view chứa danh sách nhiều bệnh nhân; backend phải lọc theo quyền trước khi trả.

#### M01 — Lịch sử khám

- Danh sách theo hồ sơ và thời gian, gồm chi nhánh, bác sĩ, nguồn lịch hẹn/walk-in và trạng thái.
- Chỉ hiển thị lượt đã đủ điều kiện công bố. Không dùng riêng `SIGNED` làm điều kiện nếu chưa có chính sách release.

#### M02 — Chi tiết lần khám

- Tổng quan: lý do khám, chẩn đoán, đánh giá, hướng điều trị, hướng dẫn tái khám.
- Sinh hiệu: nhiệt độ, mạch, huyết áp, SpO2, chiều cao, cân nặng, BMI, điểm đau.
- Dịch vụ/kết quả: trạng thái, kết luận và các chỉ số có đơn vị, khoảng tham chiếu, cờ bất thường.
- Tệp đính kèm: ảnh/PDF đã được phép công bố; xem trước an toàn, không lộ `storage_key`.
- Sửa đổi sau ký phải thể hiện phiên bản mới và ghi chú sửa đổi, không ghi đè lịch sử trong UI.

#### M03 — Kết quả xét nghiệm/chẩn đoán hình ảnh

- Chỉ trả phiên bản mới nhất có trạng thái `FINAL` hoặc `AMENDED` **và** đã được công bố cho bệnh nhân.
- Cờ `L/H/LL/HH/A/N` có nhãn chữ tiếng Việt và biểu tượng; không tự diễn giải thành chẩn đoán.
- Luôn có cảnh báo “Trao đổi với bác sĩ để được giải thích kết quả”.

### 5.7 Đơn thuốc và thanh toán

#### R01 — Danh sách/chi tiết đơn thuốc

- Chỉ hiển thị đơn `ISSUED`, `PARTIALLY_DISPENSED`, `DISPENSED`, `CANCELLED` hoặc `EXPIRED`; không hiện `DRAFT`.
- Chi tiết từng thuốc: tên, hàm lượng, dạng bào chế, đường dùng, liều, tần suất, số ngày, thời điểm và hướng dẫn.
- Hiển thị số lượng kê/đã cấp/còn lại cùng hạn dùng của đơn.
- Không cung cấp chức năng tự sửa hoặc xin cấp thuốc nếu backend chưa có workflow.

#### I01 — Danh sách/chi tiết hóa đơn

- Chỉ hiển thị hóa đơn đã phát hành hoặc lịch sử thanh toán phù hợp; không hiện `DRAFT` nội bộ.
- Tổng tiền dịch vụ/thuốc, giảm giá, thuế, bảo hiểm, bệnh nhân phải trả, đã trả và còn nợ.
- Chi tiết dòng tiền từ `invoice_items`; lịch sử thanh toán và hoàn tiền.
- Trạng thái: Đã phát hành, Thanh toán một phần, Đã thanh toán, Đã hủy.
- Thanh toán online để P2; không dựng CTA thanh toán trước khi có payment gateway và callback idempotent.

### 5.8 Thông báo và tài khoản

#### N01 — Trung tâm thông báo

- Nhóm theo Hôm nay/Trước đó; loại: nhắc lịch, thay đổi lịch, kết quả mới, đơn thuốc, hóa đơn.
- Chạm thông báo mở đúng màn bằng deep link nội bộ chứa `public_id`.
- Cần bổ sung trạng thái đã đọc và thời điểm đã đọc; `notifications.status` hiện chỉ phản ánh trạng thái gửi.

#### S01 — Tài khoản và bảo mật

- Thông tin hiển thị từ `users`: tên hiển thị, email/điện thoại đã che bớt.
- Đổi mật khẩu; đăng xuất thiết bị này; đăng xuất mọi thiết bị.
- Danh sách phiên chỉ hiển thị loại thiết bị, thời điểm hoạt động và vị trí gần đúng nếu chính sách cho phép; không trả token hash.
- Cài đặt kênh thông báo sau khi có bảng preference/device token.

## 6. Ánh xạ trạng thái SQL sang UI

### 6.1 Lịch hẹn

| SQL | Nhãn UI | Màu/ngữ nghĩa | Hành động bệnh nhân |
|---|---|---|---|
| `PENDING` | Chờ xác nhận | Vàng | Đổi, hủy; hiển thị hết hạn giữ chỗ |
| `CONFIRMED` | Đã xác nhận | Xanh dương | Đổi/hủy nếu còn hạn |
| `CHECKED_IN` | Đã check-in | Tím | Theo dõi hàng đợi |
| `IN_PROGRESS` | Đang khám | Tím đậm | Chỉ đọc |
| `COMPLETED` | Hoàn tất | Xanh lá | Xem hồ sơ khi được công bố |
| `CANCELLED` | Đã hủy | Xám/đỏ | Xem lý do, đặt lại |
| `NO_SHOW` | Không đến | Đỏ | Đặt lại |
| `EXPIRED` | Hết giữ chỗ | Xám | Chọn slot khác |

### 6.2 Quyền hồ sơ

| SQL | Nhãn UI | Quy tắc |
|---|---|---|
| Link `PENDING` | Chờ xác minh | Không cho đọc dữ liệu/đặt lịch |
| Link `ACTIVE` | Đã xác minh | Cho đọc theo policy; đặt lịch khi `is_booking_allowed = 1` |
| Link `REVOKED` | Đã thu hồi | Loại khỏi bộ chuyển hồ sơ và xóa cache liên quan |
| Request `PENDING` | Đang chờ duyệt | Cho hủy |
| Request `APPROVED` | Đã duyệt | Làm mới danh sách link |
| Request `REJECTED` | Không được duyệt | Hiển thị phản hồi an toàn nếu có |
| Request `CANCELLED` | Đã hủy | Chỉ đọc |

### 6.3 Dữ liệu lâm sàng

| Đối tượng | Trạng thái được phép hiện | Không được hiện |
|---|---|---|
| Encounter | Theo cờ công bố patient-facing | Lượt nháp/nội bộ chưa công bố |
| Service result | `FINAL`/`AMENDED` và `released_to_patient = 1` | `DRAFT`, `PRELIMINARY`, `CANCELLED`, kết quả chưa release |
| Prescription | Từ `ISSUED` trở đi theo policy | `DRAFT` |
| Invoice | `ISSUED`, `PARTIALLY_PAID`, `PAID`, lịch sử `VOID` phù hợp | `DRAFT` |

## 7. Contract API cần có

### 7.1 API hiện có, có thể tiếp tục dùng

- `POST /api/v1/auth/login`, `/refresh`, `/logout`, `/logout-all`.
- `POST /api/v1/auth/password/change`, `/forgot`, `/reset`.
- `POST /api/v1/auth/patient-registration/request`, `/verify`.
- `GET /api/v1/patient-access`, `POST /requests`, `DELETE /requests/{id}`, `DELETE /links/{id}`.
- `GET /api/v1/public/branches`, `/specialties`, `/services`, `/doctors`, `/availability`.
- `GET/POST /api/v1/appointments`, `POST /appointments/{id}/reschedule`, `POST /appointments/{id}/cancel`.

### 7.2 API patient-facing cần bổ sung

Tên route dưới đây là đề xuất; OpenAPI phải được chốt trước khi viết màn hình tương ứng.

| API đề xuất | Mục đích | Kiểm tra bắt buộc |
|---|---|---|
| `GET /api/v1/public/branches/{branchPublicId}` | Deep link/chi tiết chi nhánh | Chỉ chi nhánh active, trường công khai |
| `GET /api/v1/public/specialties/{specialtyPublicId}` | Deep link/chi tiết chuyên khoa | Chỉ chuyên khoa active |
| `GET /api/v1/public/services/{servicePublicId}?branchPublicId=...` | Chi tiết và giá hiệu lực của dịch vụ | Chi nhánh/dịch vụ active, đúng khoảng hiệu lực |
| `GET /api/v1/public/doctors/{doctorPublicId}` | Deep link/chi tiết bác sĩ | Cùng điều kiện lọc như `v_public_doctors_v1` |
| `GET /api/v1/me` | Hồ sơ tài khoản hiện tại | User đang active, không trả trường bí mật |
| `GET /api/v1/me/sessions` | Danh sách phiên | Chỉ phiên của chính user |
| `GET /api/v1/patients/{patientPublicId}` | Hồ sơ hành chính | Link `ACTIVE` |
| `GET /api/v1/patients/{patientPublicId}/health-profile` | Dị ứng, bệnh nền, bảo hiểm, liên hệ | Link `ACTIVE`, audit read |
| `GET /api/v1/patients/{patientPublicId}/encounters` | Lịch sử khám được công bố | Link `ACTIVE` + release policy |
| `GET /api/v1/encounters/{encounterPublicId}/patient-view` | Chi tiết lần khám | Đúng patient + release policy |
| `GET /api/v1/appointments/{appointmentPublicId}` | Chi tiết lịch | Link `ACTIVE` và đúng patient |
| `GET /api/v1/appointments/{appointmentPublicId}/queue` | Ticket hàng đợi của lịch | Đúng patient; không trả ticket khác |
| `GET /api/v1/patients/{patientPublicId}/prescriptions` | Đơn thuốc được phép xem | Link `ACTIVE`, chặn `DRAFT` |
| `GET /api/v1/patients/{patientPublicId}/invoices` | Hóa đơn và số dư | Link `ACTIVE`, chặn `DRAFT` |
| `GET /api/v1/me/notifications` | Inbox thông báo | Chỉ notification của user/patient được link |
| `PATCH /api/v1/me/notifications/{id}/read` | Đánh dấu đã đọc | Ownership check |
| `PUT /api/v1/me/devices/{installationId}` | Đăng ký push token | Token được mã hóa/bảo vệ, thu hồi khi logout |

Tất cả list API cần phân trang, sort ổn định, filter theo `patientPublicId` và response `Cache-Control: no-store` với dữ liệu nhạy cảm. Generated client phải sinh lại từ OpenAPI; Mobile không tự định nghĩa DTO lệch chuẩn.

## 8. Thay đổi SQL/backend cần chốt trước các màn P1/P2

1. Thêm metadata công bố cho encounter/kết quả/tệp, tối thiểu `released_to_patient`, `released_at_utc`, `released_by_user_id`; không đồng nhất `FINAL` hay `SIGNED` với đã công bố.
2. Tạo stored procedure/read model patient-facing cho lịch sử khám, queue, đơn thuốc và hóa đơn; mỗi procedure nhận actor, kiểm tra link `ACTIVE` và ghi audit cho dữ liệu lâm sàng.
3. Bổ sung `public_id` cho aggregate sẽ xuất hiện trên API/deep link nhưng hiện chưa có, đặc biệt prescription, invoice và các đối tượng chi tiết cần định tuyến công khai.
4. Không dùng `v_current_queue` trực tiếp cho Mobile; tạo query chỉ trả ticket của patient được ủy quyền và tối thiểu hóa dữ liệu.
5. Bổ sung `notification_user_state` hoặc các trường `read_at_utc`, `archived_at_utc`; trạng thái gửi trong `notifications.status` không thay cho trạng thái đã đọc.
6. Bổ sung bảng push installation/token và preference theo user, platform, trạng thái, lần hoạt động cuối; không ghi token push vào `payload_json`.
7. Nếu cho bệnh nhân sửa hồ sơ, tạo command riêng cho từng nhóm dữ liệu, validation, row version, lịch sử thay đổi và quy tắc trường nào cần nhân viên duyệt.
8. API đơn thuốc/hóa đơn phải dùng read model riêng, không tái sử dụng endpoint nghiệp vụ của dược sĩ/thu ngân chỉ vì cùng bảng dữ liệu.

## 9. Hệ thống thiết kế Android

### 9.1 Phong cách

- Giữ nhận diện xanh hiện tại nhưng chuẩn hóa thành design token: primary, surface, text, border, success, warning, danger và neutral.
- Nền sáng dịu; card trắng; typography có phân cấp rõ. Không dùng toàn chữ in hoa cho nội dung dài.
- Bo góc vừa phải, bóng rất nhẹ; ưu tiên border để giao diện rõ trên thiết bị cấu hình thấp.
- Status chip luôn có chữ + biểu tượng + màu để đáp ứng người mù màu.

### 9.2 Thành phần dùng lại

- `AppScreen`, `AppHeader`, `BottomTabs`, `ProfileSwitcher`.
- `PrimaryButton`, `SecondaryButton`, `DangerButton`, `IconButton`.
- `FormField`, `PasswordField`, `DateField`, `OtpInput`, `SearchField`.
- `StatusChip`, `AppointmentCard`, `MedicalRecordCard`, `MoneySummary`.
- `SearchBar`, `FilterChips`, `BranchCard`, `SpecialtyCard`, `ServicePriceCard`, `DoctorCard`.
- `LoadingSkeleton`, `EmptyState`, `ErrorState`, `OfflineBanner`.
- `ConfirmBottomSheet`, `Toast/Snackbar` và dialog hết phiên.

### 9.3 Khả năng tiếp cận

- Vùng chạm tối thiểu 48 × 48 dp.
- Tương phản đạt WCAG AA; hỗ trợ dark text trên nền sáng và không dùng màu làm tín hiệu duy nhất.
- Hỗ trợ font scaling ít nhất 200%, TalkBack, thứ tự focus hợp lý và label tiếng Việt có nghĩa.
- Không khóa orientation nếu không có yêu cầu nghiệp vụ; tablet dùng layout rộng hai cột ở màn danh sách/chi tiết.

## 10. Quản lý state và lỗi

- React Navigation: Auth stack + App tabs + detail stacks.
- TanStack Query: cache theo key gồm `userPublicId`/`patientPublicId`; invalidate khi đổi hồ sơ, đặt/đổi/hủy lịch, thu hồi link hoặc đăng xuất.
- Không optimistic update cho hủy lịch, đổi lịch, thu hồi link hay hành động tài chính.
- Idempotency key được giữ cho retry cùng payload ở đăng ký, đặt và đổi lịch.
- Refresh token chỉ ở SecureStore; access token theo cơ chế hiện tại và được xóa cùng cache khi logout.
- `401`: thử refresh đúng một lần; thất bại thì kết thúc phiên.
- `403`: giải thích quyền hồ sơ đã thay đổi, xóa cache hồ sơ đó và làm mới danh sách link.
- `409`/row-version conflict: thông báo dữ liệu vừa thay đổi và tải lại.
- Mất mạng: giữ form chưa gửi trong state tạm, không tự động gửi lại mutation nhạy cảm khi app foreground nếu không xác nhận payload.

## 11. Lộ trình triển khai

### Giai đoạn 0 — Chốt contract và UX nền

- Xác nhận scope patient/guardian và danh sách trường được công bố.
- Chốt wireframe, token, component states, navigation và taxonomy tiếng Việt.
- Tạo ma trận table → read model → API → screen.
- Chốt thay đổi schema release/public ID/notification trước khi triển khai màn phụ thuộc.

**Hoàn tất khi:** OpenAPI cho phần P0 ổn định, UX review xong và không còn màn nào dự kiến đọc bảng trực tiếp.

### Giai đoạn 1 — Nâng cấp nền tảng và luồng hiện có (P0)

- Chuyển từ stack trang chủ sang bottom tabs 5 mục.
- Tách component/design token, profile context và error/loading states.
- Xây khu Khám phá công khai: chi nhánh, chuyên khoa, dịch vụ/bảng giá và bác sĩ.
- Nâng cấp đăng nhập/đăng ký/OTP; thêm quên và đổi mật khẩu.
- Tách lịch thành danh sách, chi tiết, wizard đặt và đổi lịch.
- Thay input ngày chuỗi bằng date picker Android.
- Giữ đầy đủ luồng hồ sơ được ủy quyền.

**Hoàn tất khi:** khách chưa đăng nhập xem được danh mục/bảng giá/bác sĩ; toàn bộ chức năng hiện có chạy qua UI mới, không regression và thao tác tốt trên màn hình nhỏ.

### Giai đoạn 2 — Trang chủ và hàng đợi (P1)

- Dashboard theo hồ sơ, lịch sắp tới và lối tắt.
- API chi tiết lịch và ticket riêng của patient.
- Màn theo dõi queue có polling theo lifecycle.

**Hoàn tất khi:** người đã check-in chỉ xem được ticket của mình/người thân được ủy quyền và dữ liệu tự dừng cập nhật khi app background.

### Giai đoạn 3 — Hồ sơ sức khỏe và lịch sử khám (P1)

- Read model patient-facing và chính sách release.
- Thông tin hành chính/sức khỏe cơ bản dạng chỉ đọc.
- Lịch sử, chi tiết encounter, kết quả và attachment được công bố.

**Hoàn tất khi:** test âm chứng minh không thể xem hồ sơ chưa link hoặc kết quả chưa release.

### Giai đoạn 4 — Đơn thuốc, hóa đơn và thông báo (P1)

- Danh sách/chi tiết đơn thuốc và tiến độ cấp thuốc.
- Hóa đơn, khoản đã trả/còn nợ và hoàn tiền.
- Inbox, push installation, deep link và trạng thái đã đọc.

**Hoàn tất khi:** mọi deep link đều tái kiểm tra quyền, không mở nhầm hồ sơ đang chọn và không lộ bản nháp nội bộ.

### Giai đoạn 5 — Hoàn thiện phát hành (P0 release)

- Accessibility/TalkBack, font scaling, tablet và dark mode nếu được duyệt.
- Theo dõi crash/performance không chứa PHI.
- Kiểm thử release build trên Android Emulator và ít nhất một thiết bị thật.
- Rà quyền Android, chính sách riêng tư, xóa cache khi logout và quy trình hỗ trợ người dùng.

## 12. Kế hoạch kiểm thử

### 12.1 Luồng E2E bắt buộc

1. Đăng ký email/SMS → OTP đúng/sai/hết hạn/gửi lại → đăng nhập.
2. Chưa đăng nhập → xem chi nhánh → bảng giá → lọc bác sĩ → chọn slot → đăng nhập → quay lại đúng lựa chọn.
3. Đổi chi nhánh làm mới đúng bảng giá, bác sĩ và slot; giá hết hiệu lực không còn xuất hiện.
4. Khôi phục phiên → rotate token → logout thiết bị/logout tất cả.
5. Gửi yêu cầu link bản thân/người thân → chờ/duyệt/từ chối/hủy/thu hồi.
6. Chọn hồ sơ → tìm slot → đặt → xác nhận → đổi → hủy.
7. Hai người cùng đặt một slot: đúng một người thành công; người còn lại được chọn slot mới.
8. Hết thời gian hold/cancellation deadline trong lúc màn đang mở.
9. Check-in → xem đúng số thứ tự → CALLED/SERVING/COMPLETED.
10. Xem encounter/kết quả/đơn/hóa đơn được công bố.
11. Deep link sau khi token hết hạn hoặc link hồ sơ vừa bị thu hồi.
12. Mất mạng giữa mutation và retry không tạo bản ghi trùng.

### 12.2 Test bảo mật/quyền riêng tư

- User A không đọc được hồ sơ, lịch, queue, encounter, đơn hoặc hóa đơn của User B bằng cách thay `public_id`.
- API công khai chỉ trả bác sĩ/chi nhánh/chuyên khoa/dịch vụ active và không lộ dữ liệu nhân sự riêng tư.
- Link `PENDING`/`REVOKED` không có quyền đọc; `bookingAllowed = false` không được đặt lịch.
- Không trả kết quả `DRAFT`/`PRELIMINARY` hoặc chưa release; không trả đơn/hóa đơn `DRAFT`.
- `internal_note`, password/token/OTP hash, `storage_key`, ID nội bộ và audit payload không xuất hiện ở response Mobile.
- Logout/xóa tài khoản khỏi thiết bị phải xóa token, React Query cache và notification device token theo policy.
- Log/crash report không chứa họ tên, số điện thoại, mã bệnh nhân, nội dung khám hoặc token.

### 12.3 Test giao diện

- Màn hình nhỏ, font 100%/200%, bàn phím mở, xoay màn hình và tablet.
- TalkBack đọc đúng nhãn nút, status và lỗi form.
- Loading/rỗng/lỗi/mất mạng/hết phiên/concurrency cho từng màn.
- Định dạng múi giờ chi nhánh, ngày Việt Nam và tiền VND.
- Release build Android không phụ thuộc hành vi chỉ có trên Expo Go.

## 13. Tiêu chí nghiệm thu toàn bộ

- Người dùng chưa đăng nhập xem được chi nhánh, chuyên khoa, bảng giá hiện hành và thông tin bác sĩ công khai.
- Người dùng hoàn thành đăng ký, liên kết hồ sơ và đặt lịch mà không nhập ngày theo định dạng kỹ thuật.
- Hành trình chính có 5 tab và ngữ cảnh hồ sơ luôn rõ ràng.
- Toàn bộ trạng thái SQL có nhãn tiếng Việt nhất quán và chỉ hiển thị hành động hợp lệ.
- Mobile chỉ sử dụng generated API client, không gọi service nội bộ hoặc database trực tiếp.
- Không có đường nào xem dữ liệu của hồ sơ chưa được ủy quyền hoặc dữ liệu lâm sàng chưa công bố.
- Tất cả mutation quan trọng xử lý retry, idempotency và concurrency đúng.
- UI đạt accessibility cơ bản, chạy ổn trên Android release build và có test cho các luồng quan trọng.

## 14. Thứ tự ưu tiên đề xuất

| Ưu tiên | Phạm vi | Lý do |
|---|---|---|
| P0 | Khám phá công khai, điều hướng, design system, auth, hồ sơ được ủy quyền, đặt/đổi/hủy lịch | Tận dụng API đang có và tạo trải nghiệm dùng được ngay |
| P1 | Dashboard, chi tiết lịch, queue, lịch sử khám/kết quả đã release | Giá trị trực tiếp trước và sau buổi khám |
| P1 | Đơn thuốc, hóa đơn, inbox/push | Hoàn chỉnh hành trình bệnh nhân |
| P2 | Tự sửa hồ sơ, thanh toán online, tải/chia sẻ tài liệu | Cần workflow, audit và tích hợp bổ sung |

Điểm bắt đầu phù hợp nhất là Giai đoạn 0 và 1. Không nên xây màn lịch sử khám, kết quả, đơn thuốc hoặc hóa đơn trước khi hoàn thành read model patient-facing và chính sách công bố tại mục 8.

# Hệ thống quản lý phòng khám tư nhân

Monorepo cho hệ thống quản lý phòng khám gồm cổng quản trị, ứng dụng đặt lịch,
API gateway, các dịch vụ nghiệp vụ và SQL Server.

## Thành phần

- `fe/admin-web`: React 19 + Vite dành cho quản trị viên và nhân viên.
- `fe/mobile`: Expo/React Native dành cho bệnh nhân.
- `be/gateway`: ASP.NET Core + Ocelot, cổng vào duy nhất tại cổng `5000`.
- `be/services/auth-service`: xác thực và phân quyền, cổng `4001`.
- `be/services/clinic-service`: nghiệp vụ phòng khám, cổng `4002`.
- `be/workers/scheduler-worker`: tác vụ nền, cổng kiểm tra sức khỏe `4010`.
- `quan_ly_phong_kham.sql`: cơ sở dữ liệu SQL Server hiện tại.
- `PROJECT_PLAN.md`: kiến trúc, chức năng và lộ trình triển khai chi tiết.

## Yêu cầu môi trường

- Node.js 24 và npm 11.
- .NET SDK 10.
- SQL Server Developer/Express và `sqlcmd`.
- Android Studio hoặc thiết bị có Expo Go nếu chạy mobile Android.

## Khởi tạo lần đầu

```powershell
Copy-Item .env.example .env
npm install
dotnet restore be/gateway/ClinicGateway.csproj
```

Sửa `.env` bằng bí mật cục bộ; tuyệt đối không commit file này. Tạo cơ sở dữ liệu:

```powershell
sqlcmd -S localhost -E -C -i .\quan_ly_phong_kham.sql
```

Tạo quản trị viên đầu tiên (chỉ chạy được khi bảng tài khoản còn trống):

```powershell
$env:BOOTSTRAP_ADMIN_USERNAME = 'admin'
$env:BOOTSTRAP_ADMIN_DISPLAY_NAME = 'Quản trị viên'
$securePassword = Read-Host 'Mật khẩu admin (tối thiểu 12 ký tự)' -AsSecureString
$env:BOOTSTRAP_ADMIN_PASSWORD = [Net.NetworkCredential]::new('', $securePassword).Password
npm run bootstrap:admin -w @clinic/auth-service
Remove-Item Env:BOOTSTRAP_ADMIN_USERNAME, Env:BOOTSTRAP_ADMIN_DISPLAY_NAME, Env:BOOTSTRAP_ADMIN_PASSWORD
```

Script băm mật khẩu bằng Argon2id trước khi gọi stored procedure; dự án không có mật
khẩu admin mặc định. Có thể đặt thêm `BOOTSTRAP_ADMIN_EMAIL` trước khi chạy.

### Tài khoản mẫu cho môi trường development

Sau khi áp dụng schema, có thể tạo bộ tài khoản mẫu bằng lệnh:

```powershell
npm run seed:demo-accounts -w @clinic/auth-service
```

Script tạo `manager.demo`, `doctor.demo`, `nurse.demo`, `receptionist.demo`,
`pharmacist.demo`, `cashier.demo`, `lab.demo` và `patient.demo`. Nếu database
hoàn toàn trống, script tạo thêm `admin.demo`; nếu không, script dùng Admin toàn
cục đang hoạt động để cấp quyền. Mật khẩu chung mặc định là `ClinicDemo@2026!`;
có thể truyền mật khẩu khác qua biến `DEMO_ACCOUNT_PASSWORD`. Script chỉ chạy ở
development, có thể chạy lại mà không tạo trùng và không ghi đè tài khoản đã có.

## Chạy dự án

```powershell
# Gateway, API, worker và Admin Web
npm run dev

# Mobile chạy ở terminal riêng
npm run dev:mobile
```

Ở chế độ development qua LAN, mobile tự thay `localhost` trong địa chỉ API bằng
địa chỉ LAN của máy chạy Expo. Chỉ dùng gateway HTTP này với dữ liệu demo trên
mạng riêng đáng tin cậy; điện thoại và máy tính cần ở cùng mạng và Windows
Firewall chỉ nên cho phép cổng `5000` trên mạng Private/LocalSubnet. Có thể đặt
`EXPO_PUBLIC_API_BASE_URL` trong `fe/mobile/.env.local` để dùng API khác (ví dụ
`http://10.0.2.2:5000/api/v1` cho Android Emulator). Expo Tunnel không chuyển
tiếp cổng gateway; trường hợp đó cần một API HTTPS truy cập được từ Internet.
Bản preview/production bắt buộc cấu hình `EXPO_PUBLIC_API_BASE_URL` dùng HTTPS.

- Admin Web: `http://localhost:5173`
- Gateway: `http://localhost:5000`
- Kiểm tra gateway: `http://localhost:5000/health/live`
- Kiểm tra toàn bộ dependency: `http://localhost:5000/health/ready`
- JWKS xác minh access token: `http://localhost:5000/.well-known/jwks.json`

Sau khi đăng nhập bằng Admin hoặc Manager, mở mục **Nhân sự** để tạo/cập nhật
nhân viên, hồ sơ bác sĩ, khóa/mở tài khoản và quản lý role theo chi nhánh. Manager
chỉ thao tác trong chi nhánh được phân quyền; quản lý role yêu cầu Admin toàn cục.
Các cập nhật hồ sơ dùng `ETag`/`If-Match` để không ghi đè thay đổi đồng thời.

Ở môi trường development, liên kết quên mật khẩu được ghi ra terminal của Auth
Service với cờ `developmentOnly`. Khi chạy production phải cấu hình adapter gửi:

```dotenv
PASSWORD_RESET_DELIVERY_MODE=webhook
PASSWORD_RESET_URL=https://admin.example.com/reset-password
PASSWORD_RESET_WEBHOOK_URL=https://notification.example.com/password-reset
PASSWORD_RESET_WEBHOOK_BEARER_TOKEN=replace-with-a-long-random-secret
```

Webhook nhận JSON gồm `type`, `channel`, `recipient`, `displayName`, `resetUrl` và
`expiresAtUtc`. Auth Service từ chối khởi động production nếu URL không dùng HTTPS,
thiếu bearer secret hoặc vẫn dùng console delivery.

Mobile hiện có luồng đăng ký bệnh nhân bằng email hoặc SMS, xác minh OTP rồi đăng
nhập. Development ghi OTP ra terminal Auth Service với cờ `developmentOnly`.
Production phải dùng HMAC secret riêng và webhook HTTPS:

```dotenv
PATIENT_REGISTRATION_BRANCH_CODE=MAIN
AUTH_OTP_HASH_SECRET=replace-with-at-least-32-random-characters
AUTH_OTP_DELIVERY_MODE=webhook
AUTH_OTP_WEBHOOK_URL=https://notification.example.com/auth-otp
AUTH_OTP_WEBHOOK_BEARER_TOKEN=replace-with-a-long-random-secret
PATIENT_LINK_REQUEST_TTL_DAYS=7
PATIENT_LINK_MAX_REQUESTS_PER_DAY=5
```

Webhook OTP nhận `type=AUTH_OTP`, `channel`, `recipient`, `displayName`, `otp` và
`expiresAtUtc`. OTP mặc định hết hạn sau 10 phút, tối đa năm lần thử và ba yêu cầu
mỗi contact trong một giờ.

Sau khi đăng nhập, bệnh nhân mở **Hồ sơ được ủy quyền** để xem hồ sơ có thể đặt
lịch, gửi yêu cầu liên kết hồ sơ cũ/người thân bằng mã bệnh nhân + ngày sinh,
hủy yêu cầu đang chờ hoặc thu hồi quyền không còn dùng. API luôn tiếp nhận yêu
cầu theo cùng một cách dù thông tin có khớp hay không; chỉ yêu cầu khớp mới vào
hàng đợi nhân viên. Lễ tân/Manager có permission `PATIENT_PORTAL_LINK_MANAGE`
mở **Liên kết hồ sơ** trên Admin Web, đối chiếu giấy tờ rồi duyệt hoặc từ chối.
Yêu cầu mặc định hết hạn sau 7 ngày và tối đa 5 yêu cầu mỗi tài khoản trong 24 giờ.

Admin/Manager có permission `MASTER_DATA_MANAGE` mở **Danh mục** để quản lý phòng,
giá và khả dụng dịch vụ theo chi nhánh. Chỉ Admin toàn cục được tạo, sửa hoặc
ngừng định nghĩa dịch vụ dùng chung. Giá mới có ngày hiệu lực, lịch sử không chồng
nhau và giá giao dịch cũ không bị sửa ngược. Các directory công khai tại
`/api/v1/public/branches`, `/specialties`, `/services` và `/doctors` chỉ trả dữ
liệu đang hoạt động, bác sĩ nhận lịch online và giá VND đang có hiệu lực.

Admin/Manager/Lễ tân có permission `PATIENTS_MANAGE` mở **Bệnh nhân** trên Admin
Web để tra cứu theo chi nhánh, kiểm tra hồ sơ có thể trùng, tạo hồ sơ hành chính
và cập nhật với `ETag`. Hồ sơ có thể trùng cần lý do xác nhận trước khi cấp mã
mới; số định danh đã dùng ở chi nhánh khác sẽ bị từ chối mà không trả thông tin
chi nhánh đó. API lâm sàng `/api/v1/patients/{patientId}/clinical-summary` chỉ trả
dị ứng/bệnh nền cho bác sĩ hoặc điều dưỡng có lượt chăm sóc đang mở, và audit
mỗi lần đọc. Patient/guardian không dùng endpoint nội bộ này; họ chỉ đọc hồ sơ
đã ký và công bố qua tab **Kết quả** cùng liên kết hồ sơ còn hiệu lực.

Bệnh nhân mở **Đặt lịch khám** trên Mobile để chọn hồ sơ được ủy quyền, chi nhánh,
dịch vụ, ngày và slot còn trống; sau đó có thể xem, đổi hoặc hủy lịch. Admin/Manager/
Lễ tân có permission phù hợp mở **Lịch hẹn** để đặt lịch tại quầy, xác nhận, hủy và
ghi no-show. Admin/Manager mở **Ca & slot** để tạo ca có khoảng nghỉ và sinh slot.
Booking/reschedule yêu cầu idempotency key; hệ thống khóa slot trong SQL để chống
double-booking. Worker tự hết hạn hold, sinh trước slot và lập lịch reminder theo
chu kỳ cấu hình bởi `APPOINTMENT_HOLD_SWEEP_MS`, `SLOT_GENERATION_SWEEP_MS` và
`APPOINTMENT_REMINDER_SWEEP_MS`.

Worker publish outbox và gửi notification theo batch bằng lease trong SQL, vì vậy
nhiều instance không xử lý đồng thời cùng một bản ghi. Lỗi được retry exponential
rồi chuyển dead-letter sau `DELIVERY_MAX_ATTEMPTS`; delivery là at-least-once và
consumer outbox phải dedupe theo `eventId`. Chế độ `console` chỉ dùng development
và không ghi payload/người nhận vào log. Production bắt buộc cấu hình hai webhook
HTTPS có bearer token và login SQL riêng chỉ thuộc `clinic_job_executor`:

```dotenv
SQL_TRUSTED_CONNECTION=false
SQL_WORKER_USER=clinic_job_user
SQL_WORKER_PASSWORD=replace-with-a-secret
OUTBOX_PUBLISH_MODE=webhook
OUTBOX_WEBHOOK_URL=https://events.example.com/outbox
OUTBOX_WEBHOOK_BEARER_TOKEN=replace-with-a-long-random-secret
NOTIFICATION_DELIVERY_MODE=webhook
NOTIFICATION_WEBHOOK_URL=https://notification.example.com/deliver
NOTIFICATION_WEBHOOK_BEARER_TOKEN=replace-with-a-long-random-secret
```

Lễ tân/Điều dưỡng có permission phù hợp mở **Tiếp nhận** để check-in lịch
`CONFIRMED`, tìm bệnh nhân walk-in, chọn dịch vụ/bác sĩ/phòng, cấp số và gọi người
kế tiếp. Check-in/walk-in yêu cầu idempotency key và tạo Encounter + dịch vụ ban
đầu + QueueTicket trong một transaction. Cửa sổ check-in lấy từ cấu hình chi
nhánh; số tăng đơn điệu theo ngày, còn call-next xếp ưu tiên trước rồi FIFO và
khóa ticket để hai quầy không gọi cùng một bệnh nhân. Ngay trên bảng hàng đợi,
nhân viên có thể hủy lượt đang chờ/đang khám với lý do bắt buộc; hệ thống đóng
đồng bộ ticket, dịch vụ và chứng từ nháp nhưng chặn hủy khi còn thuốc đã cấp chưa
đảo hoặc đã phát sinh thanh toán.

Bác sĩ được phân công mở **Khám bệnh** sau khi số đã được gọi để bắt đầu lượt,
ghi sinh hiệu, bệnh sử, khám thực thể, chẩn đoán và chỉ định. Kết quả FINAL cần
có nội dung trước khi hoàn tất; hệ thống yêu cầu một chẩn đoán chính và không
còn dịch vụ bắt buộc đang mở. Sau khi ký, hồ sơ được khóa; nội dung bổ sung được
ghi bằng phụ lục nối hash. Bác sĩ phụ trách dùng **Công bố cho bệnh nhân** sau
khi ký; thao tác idempotent tạo trạng thái append-only, audit và outbox mà không
sửa cây hồ sơ đã khóa.

Bệnh nhân/người giám hộ mở tab **Kết quả** trên Mobile để chọn một hồ sơ đã được
xác minh và xem lịch sử khám, chẩn đoán, sinh hiệu, dặn dò, kết quả FINAL cùng
dấu vết SHA-256. Chỉ hồ sơ đã được bác sĩ công bố mới xuất hiện; kết quả nội bộ
chưa công bố không được trả về API và quyền đọc mất hiệu lực ngay khi liên kết
hồ sơ bị thu hồi. Dấu SHA-256 hiện là bằng chứng toàn vẹn nội bộ, không được mô
tả như chữ ký số đã xác minh chứng thư.

Bác sĩ chọn **Kê đơn thuốc** trong lượt đang khám để tạo đơn DRAFT, thêm thuốc,
liều và hướng dẫn rồi phát hành. Màn **Nhà thuốc** cho nhân viên có quyền tạo lô,
nhập kho, mở phiên cấp, chọn lô FEFO, đảo cấp vào cách ly và đối soát ledger.
Nhập và cấp thuốc dùng `Idempotency-Key`; dị ứng hoạt chất yêu cầu quyền override
riêng cùng lý do được audit. Sau phát hành không sửa nội dung đơn.

Nhân viên có quyền mở **Thu ngân** để tạo hóa đơn DRAFT từ lượt khám, đồng bộ
dịch vụ hoàn tất và thuốc đã cấp, thêm khoản thu thủ công, ghi phần bảo hiểm rồi
phát hành. Bước phát hành khóa lượt khám và tự đồng bộ charge trong cùng
transaction để không bỏ sót. Có thể thu nhiều lần, hoàn theo đúng phân bổ gốc,
VOID sau khi số thu ròng về 0 và tạo hóa đơn thay thế. Phát hành, thu và hoàn đều
dùng `Idempotency-Key`; khóa ứng dụng trên hóa đơn chặn hai quầy thu vượt dư nợ.

Admin/Manager và nhân viên được cấp `REPORTS_VIEW` mở **Báo cáo** để xem số lịch,
lượt đến, no-show, thời gian chờ, thu tiền ròng, dịch vụ/thuốc sử dụng, tồn thấp
và lô hết hạn trong 90 ngày. Khoảng ngày được tính theo múi giờ nghiệp vụ của
chi nhánh và giới hạn tối đa 366 ngày. Cashier chỉ có nhóm doanh thu, Pharmacist
chỉ có nhóm sử dụng/tồn kho; Manager/Admin xem đủ ba nhóm trong đúng branch scope.
Clinic Service dùng pool báo cáo riêng; production phải cấu hình
`SQL_REPORT_USER`/`SQL_REPORT_PASSWORD` cho login chỉ thuộc role
`clinic_report_reader`, không dùng tài khoản mutation.

Nếu SQL Server local chưa bật TCP/IP và bạn dùng Windows Authentication, đặt
`SQL_SERVER=np:\\.\pipe\sql\query` trong `.env`. Xem thêm [be/README.md](./be/README.md).

## Kiểm tra trước khi commit

```powershell
npm run typecheck
npm run lint
npm run openapi:check
npm run build
npm test
npm run doctor:mobile
```

Kiểm thử hồi quy SQL Server:

```powershell
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\auth-session.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\staff-rbac.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\staff-safety.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\password-lifecycle.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\patient-registration.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\patient-link.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\catalog-directory.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\patient-registry.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\scheduling-appointments.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\reception-queue.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\clinical-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\pharmacy-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\pharmacy-fefo.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\pharmacy-allergy.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\billing-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\reports-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\tests\notifications-outbox.test.sql
.\be\database\tests\reception-queue.concurrent.ps1
.\be\database\tests\billing-payment.concurrent.ps1
```

Chi tiết nghiệp vụ và thứ tự phát triển nằm trong [PROJECT_PLAN.md](./PROJECT_PLAN.md).

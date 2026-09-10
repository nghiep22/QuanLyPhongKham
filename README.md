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

Nếu SQL Server local chưa bật TCP/IP và bạn dùng Windows Authentication, đặt
`SQL_SERVER=np:\\.\pipe\sql\query` trong `.env`. Xem thêm [be/README.md](./be/README.md).

## Kiểm tra trước khi commit

```powershell
npm run typecheck
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
```

Chi tiết nghiệp vụ và thứ tự phát triển nằm trong [PROJECT_PLAN.md](./PROJECT_PLAN.md).

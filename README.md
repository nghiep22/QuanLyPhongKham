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
```

Chi tiết nghiệp vụ và thứ tự phát triển nằm trong [PROJECT_PLAN.md](./PROJECT_PLAN.md).

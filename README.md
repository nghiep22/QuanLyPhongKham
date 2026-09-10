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

## Kiểm tra trước khi commit

```powershell
npm run typecheck
npm run build
npm test
npm run doctor:mobile
```

Chi tiết nghiệp vụ và thứ tự phát triển nằm trong [PROJECT_PLAN.md](./PROJECT_PLAN.md).

# Trạng thái triển khai backend

> Cập nhật: 2026-09-10

## DONE — Slice 01: Platform Foundation

- Ocelot Gateway route Auth/Clinic, live health và aggregated readiness.
- Auth Service, Clinic Service, Scheduler Worker và launcher tại root.
- Pino JSON logging; request ID và success/error envelope thống nhất.
- SQL pool/command runner, OpenAPI codegen, generated client và CI Windows.

## DONE — Slice 02: Admin Login & Session Security

Phạm vi đã hoàn thành:

- Bootstrap admin đầu tiên qua biến môi trường; mật khẩu được băm Argon2id và
  không có tài khoản/mật khẩu mặc định trong source.
- Đăng nhập bằng username, email hoặc số điện thoại; phản hồi sai thông tin không
  tiết lộ tài khoản có tồn tại hay không.
- Access token RS256 ngắn hạn có issuer, audience, public ID, session ID, token
  version, role và permission; public key công bố bằng JWKS có kid.
- Refresh token ngẫu nhiên chỉ lưu SHA-256 hash; rotation mỗi lần dùng. Dùng lại
  token cũ sẽ thu hồi mọi session và tăng token version.
- Web dùng cookie HttpOnly/SameSite; access token chỉ giữ trong memory. Mobile
  nhận refresh token trong body để lưu SecureStore.
- Logout phiên hiện tại và logout mọi thiết bị; access token cũ bị vô hiệu hóa.
- Khóa tạm thời sau ngưỡng đăng nhập sai cấu hình; thao tác Admin mở khóa được
  hoàn thiện trong Slice 03.
- CORS dùng allow-list tại Gateway và Auth Service; browser origin lạ bị từ chối.
- Admin Web có form validation/loading/error, khôi phục phiên, protected route,
  silent refresh và logout.
- SQL Server có public ID, token version, session metadata, năm auth command
  procedure và role auth_core_executor theo least privilege.
- OpenAPI 3.1 mô tả đầy đủ login/refresh/logout/logout-all/JWKS; types và SDK đã
  được sinh lại.

## DONE — Slice 03: Workforce & Branch-scoped RBAC

Phạm vi đã hoàn thành:

- Admin/Manager xem, tìm kiếm, tạo và sửa tài khoản nhân viên trong đúng phạm vi
  chi nhánh; mật khẩu tạm được băm Argon2id trước khi vào SQL Server.
- Tạo nhân viên là một transaction nguyên tử gồm `users`, `employees`, hồ sơ
  `doctors`, chi nhánh/chuyên khoa chính và role mặc định.
- Quản lý đủ hồ sơ bác sĩ: chứng chỉ, ngày cấp/hết hạn, học hàm, tiểu sử, thời
  lượng slot và trạng thái nhận lịch online.
- Khóa/kích hoạt/mở khóa tài khoản, đình chỉ/nghỉ việc và mọi thay đổi role đều
  tăng token version, thu hồi session còn hiệu lực và ghi audit.
- Gán/thu hồi role bằng public UUID, theo scope toàn cục/chi nhánh và thời hạn;
  Manager mặc định không có `ROLES_MANAGE`.
- Chặn tự vô hiệu hóa/tự thu hồi quyền, actor không phải Admin sửa Admin, khôi
  phục hồ sơ đã nghỉ việc và làm mất Admin toàn cục cuối cùng. Khóa ứng dụng SQL
  tuần tự hóa các thay đổi Admin nhạy cảm.
- Optimistic concurrency dùng strong `ETag`/`If-Match` chứa `rowversion` Base64;
  bản ghi cũ trả HTTP 409, thiếu precondition trả HTTP 428.
- Admin Web có route Nhân sự, danh sách/bộ lọc, form nhân viên/bác sĩ, cập nhật,
  quản lý trạng thái và role, cùng loading/empty/error/403/409 state.
- Gateway định tuyến `/api/v1/admin/*` đến Auth Service; OpenAPI và generated
  client/types đã đồng bộ chín operation quản trị nhân sự/RBAC.

### Bằng chứng xác minh local

| Kiểm tra | Kết quả |
|---|---|
| Baseline SQL chạy lại idempotent | Đạt; 66 bảng, 12 view, 65 procedure, 29 trigger |
| SQL auth session/staff RBAC/staff safety regression | PASS/PASS/PASS; rollback sạch, 0 user test |
| npm run openapi:check | Đạt; contract và generated code đồng bộ |
| npm run lint | Đạt, không cảnh báo |
| npm run typecheck | Đạt |
| npm test | 21 test đạt (Auth 18, Clinic 3) |
| npm run build | Đạt; .NET 0 warning/0 error |
| npm run doctor:mobile | 21/21 |
| Gateway → Auth → SQL smoke test | JWKS 200; invalid login 401; blocked origin 403; `/api/v1/admin/staff` không token trả đúng Auth 401 và giữ request ID |

## Chưa hoàn thành

- Phase 0 baseline freeze tổng thể, checksum và các defect P0 ngoài phạm vi Auth.
- Lần chạy GitHub Actions và branch protection chỉ xác minh được sau khi push.
- Phần còn lại của Phase 2: đổi/quên mật khẩu, patient portal/link, đăng ký bệnh
  nhân + OTP delivery/replay và các mục P1 như MFA/lịch sử session.

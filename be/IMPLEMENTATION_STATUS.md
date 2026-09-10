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

## DONE — Slice 04: Password Lifecycle & Recovery

Phạm vi đã hoàn thành:

- Người dùng đã đăng nhập đổi mật khẩu bằng mật khẩu hiện tại; không cho dùng
  lại mật khẩu đang có và xử lý xung đột khi phiên khác vừa đổi mật khẩu.
- Quên mật khẩu luôn trả cùng HTTP 202 cho tài khoản tồn tại/không tồn tại;
  phản hồi có thời gian tối thiểu để giảm account enumeration qua timing.
- Reset token ngẫu nhiên 256-bit chỉ lưu SHA-256 hash, dùng đúng một lần, TTL 15
  phút, thay thế token cũ và giới hạn mặc định ba yêu cầu hợp lệ mỗi giờ.
- Đổi hoặc reset mật khẩu đều tăng token version, xóa trạng thái khóa, thu hồi
  toàn bộ session và challenge còn lại, đồng thời ghi audit trong transaction.
- Delivery tách qua adapter: console chỉ cho local development; production bắt
  buộc webhook HTTPS có bearer secret và reset URL HTTPS. Delivery lỗi sẽ hủy
  challenge mà vẫn giữ phản hồi chung cho người gọi.
- Admin Web có màn Quên mật khẩu, Đặt lại mật khẩu và Đổi mật khẩu. Token đi
  trong URL fragment, bị xóa khỏi lịch sử ngay khi nhận; Auth response dùng
  `Cache-Control: no-store`.
- OpenAPI/generated client đã đồng bộ ba operation password lifecycle.

## DONE — Slice 05: Patient Self-registration & OTP

Phạm vi đã hoàn thành:

- Guest đăng ký bằng email hoặc SMS với họ tên, ngày sinh, giới tính và mật khẩu
  mạnh; phản hồi 202 không tiết lộ contact đã có tài khoản hay chưa.
- `Idempotency-Key` UUID và request HMAC ngăn retry tạo challenge/user/patient
  trùng; dùng lại key với payload khác trả conflict rõ ràng.
- OTP ngẫu nhiên sáu số chỉ lưu HMAC-SHA256 có secret ngoài database, TTL mặc
  định 10 phút, tối đa năm lần thử và ba yêu cầu mỗi contact trong một giờ.
- OTP đúng tạo nguyên tử user ACTIVE có role PATIENT, patient có public UUID và
  liên kết SELF ACTIVE/verified/booking allowed; không tự claim hồ sơ cũ chỉ vì
  trùng contact. OTP sai, hết hạn, delivery lỗi và replay đều không tạo dữ liệu.
- OTP hash được cryptoshred khi challenge kết thúc; audit không chứa contact,
  password hoặc OTP. Production bắt buộc HMAC secret riêng và webhook HTTPS có
  bearer secret; console delivery chỉ dành cho development.
- Mobile có đăng ký hai bước, gửi lại OTP có cooldown, đăng nhập email/phone,
  logout, refresh phiên và lưu access/refresh token bằng Expo SecureStore.
- OpenAPI/generated client đã đồng bộ hai operation patient registration.

### Bằng chứng xác minh local toàn bộ

| Kiểm tra | Kết quả |
|---|---|
| Baseline SQL chạy lại idempotent | Đạt; 68 bảng, 12 view, 72 procedure, 29 trigger |
| SQL auth session/staff RBAC/staff safety/password lifecycle/patient registration regression | PASS/PASS/PASS/PASS/PASS; rollback sạch, 0 user/patient/challenge test |
| npm run openapi:check | Đạt; contract và generated code đồng bộ |
| npm run lint | Đạt, không cảnh báo |
| npm run typecheck | Đạt |
| npm test | 33 test đạt (Auth 27, Mobile 3, Clinic 3) |
| npm run build | Đạt; .NET 0 warning/0 error |
| npm run doctor:mobile | 21/21 |
| Gateway → Auth → SQL smoke test | Registration thiếu idempotency key trả 400; challenge lạ trả generic OTP 400; cả hai giữ request ID và `Cache-Control: no-store` |
| npm audit --omit=dev --audit-level=high | Đạt; 0 high/critical. Còn 17 moderate từ dependency bắc cầu Expo/React Navigation, chưa có bản sửa không breaking |

## Chưa hoàn thành

- Phase 0 baseline freeze tổng thể, checksum và các defect P0 ngoài phạm vi Auth.
- Lần chạy GitHub Actions và branch protection chỉ xác minh được sau khi push.
- Theo dõi bản vá upstream cho 17 cảnh báo moderate bắc cầu Expo/React Navigation;
  không dùng `npm audit fix --force` vì công cụ đề xuất hạ Expo xuống bản breaking.
- Phần còn lại của Phase 2: claim/duyệt/thu hồi liên kết hồ sơ cũ và người thân,
  cùng các mục P1 như MFA/lịch sử session.

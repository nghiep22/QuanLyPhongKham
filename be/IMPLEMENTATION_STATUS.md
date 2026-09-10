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

## DONE — Slice 06: Patient Portal Linking

Phạm vi đã hoàn thành:

- Bệnh nhân xem toàn bộ hồ sơ đã được ủy quyền và các tài khoản người thân đang
  được chia sẻ từ hồ sơ `SELF`; chỉ link `ACTIVE` mới xuất hiện để dùng đặt lịch.
- Bệnh nhân gửi yêu cầu claim hồ sơ có sẵn bằng mã bệnh nhân, ngày sinh, quan hệ
  và chi nhánh đối chiếu; liên kết người thân bắt buộc có ghi chú giấy tờ.
- `Idempotency-Key` + request HMAC chống retry trùng/thay payload; giới hạn mặc
  định 5 yêu cầu/tài khoản/24 giờ và thời hạn chờ 7 ngày.
- Yêu cầu không khớp vẫn trả 202 và lưu decoy không có `patient_id`; decoy không
  bao giờ xuất hiện trong hàng đợi nhân viên, tránh dò tồn tại hồ sơ.
- Permission `PATIENT_PORTAL_LINK_MANAGE` tách riêng cho Manager/Receptionist.
  Nhân viên chỉ thấy và xử lý yêu cầu tại chi nhánh có scope hiệu lực.
- Duyệt/từ chối dùng `rowversion` để chống hai nhân viên xử lý đồng thời. Duyệt
  kích hoạt hoặc phục hồi link nguyên tử; mọi quyết định và thu hồi đều có audit.
- Bệnh nhân có thể hủy request đang chờ, tự thu hồi link người thân của mình hoặc
  thu hồi người được chia sẻ từ hồ sơ `SELF`; không thể tự xóa link `SELF` chính.
- `sp_create_patient` không còn được ghi `user_patient_access`; portal command
  cũ và mới chỉ cấp cho `auth_core_executor`, Clinic bị thu hồi quyền thực thi.
- Mobile có màn quản lý hồ sơ/yêu cầu/thu hồi; Admin Web có hàng đợi lọc theo
  chi nhánh/trạng thái và form duyệt/từ chối; OpenAPI đồng bộ 9 operation.

## DONE — Slice 07: Organization Catalog & Public Directory

Phạm vi đã hoàn thành:

- Public directory cho chi nhánh, chuyên khoa, dịch vụ có giá/khả dụng đang hiệu
  lực và bác sĩ đang hoạt động, nhận lịch online; không lộ dữ liệu workforce riêng.
- Thêm public UUID cho phòng, nhóm dịch vụ và dịch vụ; API không dùng bigint nội bộ.
- Admin/Manager quản lý phòng theo đúng scope chi nhánh với `ETag`/`If-Match`;
  stale update trả conflict và mọi mutation được audit trong transaction.
- Định nghĩa dịch vụ là danh mục cấp tổ chức, chỉ assignment toàn cục được tạo/sửa;
  Branch Manager chỉ thiết lập giá và khả dụng tại chi nhánh của mình.
- Lịch sử giá VND có ngày hiệu lực, không cho hồi tố/chồng khoảng; khi lên lịch giá
  mới, khoảng trước được đóng tự động mà không sửa snapshot giao dịch cũ.
- Clinic Service xác minh JWT RS256 cục bộ bằng public key Auth và đối chiếu trạng
  thái/token version qua `v_clinic_principal_v1`, không gọi Auth cho từng request.
- Gateway ưu tiên route Admin Catalog sang Clinic Service; OpenAPI/generated client
  đồng bộ 12 operation; Admin Web có màn Danh mục responsive với trạng thái lỗi,
  rỗng, loading, forbidden, conflict và retry qua query invalidation.

### Bằng chứng xác minh local toàn bộ

| Kiểm tra | Kết quả |
|---|---|
| Baseline SQL chạy lại idempotent | Đạt; 70 bảng, 23 view, 81 procedure, 30 trigger |
| SQL auth session/staff RBAC/staff safety/password lifecycle/patient registration/patient link/catalog-directory regression | PASS/PASS/PASS/PASS/PASS/PASS/PASS; rollback sạch |
| npm run openapi:check | Đạt; contract và generated code đồng bộ |
| npm run lint | Đạt, không cảnh báo |
| npm run typecheck | Đạt |
| npm test | 60 test đạt (Auth 34, Mobile 14, Clinic 12) |
| npm run build | Đạt; .NET 0 warning/0 error |
| npm run doctor:mobile | 21/21 |
| Gateway → Auth → SQL smoke test | Registration thiếu idempotency key trả 400; challenge lạ trả generic OTP 400; ba route patient-access mới đi đúng Auth và trả 401 + request ID + `Cache-Control: no-store` khi thiếu token |
| Clinic Catalog → SQL smoke test | Public branch/service trả dữ liệu và giá hiệu lực từ SQL thật; Admin Catalog thiếu token trả 401; read repository trả đủ branch/service/doctor và lịch sử giá |
| npm audit --omit=dev --audit-level=high | Đạt; 0 high/critical. Còn 17 moderate từ dependency bắc cầu Expo/React Navigation, chưa có bản sửa không breaking |

## Chưa hoàn thành

- Phase 0 baseline freeze tổng thể, checksum và các defect P0 ngoài phạm vi Auth.
- Lần chạy GitHub Actions và branch protection chỉ xác minh được sau khi push.
- Theo dõi bản vá upstream cho 17 cảnh báo moderate bắc cầu Expo/React Navigation;
  không dùng `npm audit fix --force` vì công cụ đề xuất hạ Expo xuống bản breaking.
- Các mục Auth P1 như MFA, quản lý permission động và lịch sử session.
- Phase 3 còn quản trị hồ sơ bệnh nhân, dedupe/search và read policy theo care relationship.

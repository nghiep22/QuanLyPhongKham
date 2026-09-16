# Backend

Backend gồm Gateway Ocelot, hai service Node.js và Scheduler Worker:

| Thành phần | Cổng | Lệnh |
|---|---:|---|
| Gateway | 5000 | `npm run dev:gateway` |
| Auth Service | 4001 | `npm run dev:auth` |
| Clinic Service | 4002 | `npm run dev:clinic` |
| Scheduler Worker | 4010 | `npm run dev:worker` |

## Platform health

- `GET /health/live`: chỉ kiểm tra process, không phụ thuộc SQL Server.
- `GET /health/ready`: Gateway tổng hợp readiness của Auth và Clinic; mỗi service
  chạy `SELECT DB_NAME()` qua pool của chính nó.
- Request ID hợp lệ từ `x-request-id` được truyền xuyên Gateway; request ID không
  hợp lệ hoặc bị thiếu sẽ được thay bằng UUID và trả lại ở header/body.

Mọi response tuân theo envelope ở `PROJECT_PLAN.md` mục 11.1. Mutation sẽ dùng
`executeCommand()` trên một connection được giữ bằng transaction; helper đặt và
xóa `request_id`, `actor_user_id`, `branch_id` trong `SESSION_CONTEXT`.

## Catalog & public directory

- Public: `GET /api/v1/public/branches`, `/specialties`, `/services` và `/doctors`.
- Admin: `/api/v1/admin/catalog/reference-data`, `/rooms`, `/services` và
  `/services/{serviceId}/prices`.
- Clinic Service xác minh access token RS256 bằng public key của Auth, rồi đối
  chiếu trạng thái và `token_version` qua read contract `v_clinic_principal_v1`.
- Phòng và dịch vụ dùng `ETag`/`If-Match`; giá chi nhánh là lịch sử có hiệu lực,
  không cho hồi tố hoặc chồng khoảng.

## Scheduling & appointments

- Public availability: `GET /api/v1/public/availability`.
- Patient self-service: `GET/POST /api/v1/appointments`, cùng các action
  `/reschedule` và `/cancel` trên appointment public ID.
- Nhân viên vận hành lịch theo chi nhánh tại `/api/v1/admin/appointments`; quản
  lý ca và sinh slot tại `/api/v1/schedules`.
- Booking/reschedule dùng `Idempotency-Key`; SQL khóa slot và ghi status history,
  audit/outbox trong cùng transaction để chống double-booking và retry trùng.
- Scheduler Worker gọi system procedure riêng để hết hạn hold/đơn thuốc, sinh slot
  và lập lịch reminder; readiness kiểm tra SQL Server, còn liveness không phụ thuộc database.

## Outbox & appointment notifications

- Outbox có `eventId`, version, producer, correlation/causation và dedupe key.
  Publisher giao at-least-once; webhook consumer phải dedupe theo `eventId`.
- Claim outbox/notification dùng row lock + lease có hạn trong SQL. Mỗi lần claim
  tăng attempt; lỗi được retry exponential tối đa 60 phút rồi dead-letter.
- Reminder chỉ được tạo cho lịch `CONFIRMED`, mỗi lịch + thời điểm + lead time một
  lần. Reschedule/cancel/expire hủy reminder còn chờ; event reminder cũ không gửi
  nếu thời gian trong payload không còn khớp lịch hiện tại.
- `console` adapter chỉ dành cho development và chỉ log metadata không nhạy cảm.
  Production fail closed nếu webhook không phải HTTPS, thiếu bearer token hoặc
  dùng SQL authentication mà thiếu `SQL_WORKER_USER`/`SQL_WORKER_PASSWORD`.
- Login worker chỉ thuộc `clinic_job_executor`. Worker không dùng mutation login,
  không DML trực tiếp bảng domain và chỉ gọi các system procedure được cấp.

## Reception & queue

- `GET /api/v1/reception/branches`, `GET /api/v1/reception` và
  `GET /api/v1/reception/patients` cấp workspace theo scope chi nhánh.
- `POST /api/v1/check-ins/appointments/{appointmentId}` check-in lịch CONFIRMED;
  `POST /api/v1/check-ins/walk-ins` tạo lượt trực tiếp không có appointment giả.
- Hai command tiếp nhận bắt buộc `Idempotency-Key`; SQL tạo Encounter, snapshot
  giá dịch vụ và QueueTicket trong cùng transaction, đồng thời ghi audit/outbox.
- `POST /api/v1/queues/call-next` dùng `UPDLOCK + READPAST + ROWLOCK`, sắp theo
  mức ưu tiên giảm dần rồi thời điểm cấp số/FIFO. Chỉ ticket `CALLED` mới được
  chuyển sang `SERVING` khi bác sĩ bắt đầu lượt khám.

## Clinical core

- Bác sĩ vào **Khám bệnh** sau khi lễ tân gọi số; chỉ thấy lượt mình phụ trách tại
  chi nhánh được phân công. `GET /api/v1/encounters` và `/api/v1/encounters/{id}`
  trả public UUID, sinh hiệu, chẩn đoán, chỉ định, kết quả và phụ lục.
- `POST /api/v1/encounters/{id}/start` yêu cầu ticket `CALLED` và bác sĩ còn đủ
  điều kiện hành nghề. Sinh hiệu có thể ghi nhiều lần khi lượt còn mở; bác sĩ ghi
  nội dung khám, chẩn đoán chính, chỉ định dịch vụ theo giá chi nhánh và kết quả
  FINAL không rỗng.
- Hoàn tất đòi một chẩn đoán chính và không còn dịch vụ/đơn thuốc bắt buộc ở trạng
  thái mở. Ký tạo SHA-256 trên bản ghi chuẩn hóa; dữ liệu lõi sau ký là bất biến,
  phụ lục chỉ thêm mới và nối hash trước. Các command lâm sàng dùng public UUID;
  database role của Clinic API không có quyền gọi trực tiếp command bigint.

## Prescription & pharmacy

- Bác sĩ mở **Khám bệnh → Kê đơn thuốc** để tạo DRAFT cho lượt đang khám, thêm
  liều/hướng dẫn và phát hành. Dị ứng được đối chiếu qua mapping chuẩn hóa thay vì
  chuỗi gần đúng; kê xung đột cần `PRESCRIPTIONS_ALLERGY_OVERRIDE` và lý do tối
  thiểu 10 ký tự. Khi cấp, dược sĩ phải recheck và dùng quyền
  `PHARMACY_ALLERGY_OVERRIDE` cùng lý do riêng nếu vẫn tiếp tục.
- **Nhà thuốc** đọc dữ liệu theo chi nhánh. Admin tạo thuốc cấp tổ chức; quyền
  `INVENTORY_MANAGE` tạo lô/vị trí và nhập kho; quyền `PHARMACY_DISPENSE` mở phiên,
  cấp lô FEFO, hoàn tất hoặc đảo vào khu cách ly. Nhập và cấp cần
  `Idempotency-Key` UUID. `GET /api/v1/pharmacy/reconciliation` trả các balance
  khác tổng ledger (mảng rỗng là khớp).
- Đơn, lô, kho và movement dùng public UUID. Chỉ wrapper public được cấp cho
  Clinic API database role; các command bigint cũ không còn được cấp trực tiếp.
- Đơn quá `valid_until` theo business date chi nhánh được chuyển `EXPIRED` bằng
  transition idempotent dùng chung giữa command và worker. Trạng thái, audit và
  outbox được commit trước lỗi từ chối cấp; completion/reversal không hồi sinh đơn.

## Billing & payments

- `GET /api/v1/billing/branches` và `/billing/workspace` cấp dữ liệu Thu ngân theo
  branch scope; mọi invoice, item, payment allocation và refund dùng public UUID.
- Hóa đơn DRAFT đồng bộ dịch vụ `COMPLETED` và dòng thuốc chưa đảo. Phát hành tự
  đồng bộ lại trong transaction, chỉ chấp nhận encounter `COMPLETED/SIGNED`, mọi
  dịch vụ terminal và không còn đơn/phiên cấp nháp.
- `POST /api/v1/invoices/{id}/payments` khóa ứng dụng theo hóa đơn, cho thu từng
  phần nhưng không vượt dư nợ. Refund gắn đúng payment allocation và không vượt
  số còn hoàn được; payment/allocation/refund là ledger append-only.
- Issue/payment/refund bắt buộc `Idempotency-Key`. VOID chỉ được thực hiện khi
  số thu ròng bằng 0; hóa đơn mới có thể tham chiếu hóa đơn VOID mà nó thay thế.
- Clinic API role chỉ gọi các wrapper `sp_clinic_*`; audit và outbox tài chính
  ghi public ID trong cùng transaction nghiệp vụ.

## Operational reports

- `GET /api/v1/reports/branches` trả các chi nhánh cùng capability vận hành,
  doanh thu và tồn kho của principal hiện tại.
- `/api/v1/reports/operations`, `/revenue` và `/inventory` nhận
  `branchPublicId`, `from`, `to`; SQL đổi ngày địa phương thành mốc UTC và giới
  hạn khoảng tối đa 366 ngày.
- Cashier chỉ xem doanh thu, Pharmacist chỉ xem sử dụng/tồn kho; Manager/Admin
  xem đủ nhóm trong branch scope. Các procedure report chỉ được cấp cho
  `clinic_report_reader` và không được cấp cho `clinic_api_executor`.
- Clinic Service mở pool thứ hai bằng `SQL_REPORT_USER`/`SQL_REPORT_PASSWORD`
  khi không dùng trusted connection; thiếu credentials thì report fail closed,
  không fallback sang pool mutation.

## SQL Server local trên Windows

Khi TCP/IP bật, dùng `SQL_SERVER=localhost`. Nếu không có quyền Administrator để
bật TCP/IP, có thể dùng Named Pipes trong `.env`:

```dotenv
SQL_SERVER=np:\\.\pipe\sql\query
SQL_TRUSTED_CONNECTION=true
SQL_ODBC_DRIVER=ODBC Driver 18 for SQL Server
```

Production không dùng Windows Authentication hoặc Named Pipes mặc định; cung cấp
login riêng cho từng service và giới hạn quyền theo ownership manifest của Phase 0.

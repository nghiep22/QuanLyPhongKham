# Trạng thái triển khai backend

> Cập nhật: 2026-09-15

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

## DONE — Slice 08: Patient Registry & Scoped Clinical Summary

Phạm vi đã hoàn thành:

- Admin/Manager/Lễ tân có `PATIENTS_MANAGE` tra cứu tối đa 50 hồ sơ theo chi nhánh,
  mã, tên, điện thoại chuẩn hóa, ngày sinh hoặc định danh. Từ khóa nhạy cảm đi
  trong POST body, không đi trong URL; danh sách chỉ hiện bốn số cuối định danh.
- Tạo hồ sơ hành chính có mã và public GUID, chi nhánh đăng ký; kiểm tra khả năng
  trùng theo tên/ngày sinh, điện thoại hoặc định danh. Tạo trùng trong cùng chi
  nhánh cần xác nhận và lý do tối thiểu 10 ký tự, được audit. Định danh trùng
  toàn hệ thống bị unique constraint từ chối mà không tiết lộ hồ sơ chi nhánh khác.
- Sửa hồ sơ dùng strong `ETag`/`If-Match` từ SQL rowversion; stale update trả 409.
  Các read/write procedure kiểm tra actor và quyền theo chi nhánh trong SQL.
- Bác sĩ chỉ đọc dị ứng/bệnh nền khi được phân công lượt khám đang mở; điều dưỡng
  chỉ đọc khi trực tiếp tạo lượt khám đó. Lễ tân, bác sĩ không liên quan và
  patient/guardian bị chặn. Mỗi lần đọc được audit; chưa xuất kết quả khám nội bộ.
- Hồ sơ cũ chỉ được backfill chi nhánh khi có bằng chứng từ lịch hẹn, lượt khám,
  portal link đã xác minh hoặc nhân viên tạo; bản ghi không xác định phạm vi
  không xuất hiện ở API chi nhánh.
- Gateway chuyển `/api/v1/admin/patients/*` sang Clinic; OpenAPI/generated client
  đồng bộ 7 operation; Admin Web có màn Bệnh nhân với tìm kiếm, cảnh báo trùng,
  mở hồ sơ và chỉnh sửa. SQL Server GUID từ `NEWSEQUENTIALID()` được nhận đúng
  theo định dạng hex; log Auth/Clinic che Authorization, Cookie và Set-Cookie.

## DONE — Slice 09: Scheduling & Appointments Core

Phạm vi đã hoàn thành:

- Ca làm việc có public UUID, khoảng nghỉ, hiệu lực và thời lượng slot; command
  kiểm tra bác sĩ đang hoạt động, phân công chi nhánh, phòng đúng chi nhánh và
  chặn ca chồng bác sĩ/phòng trước khi ghi nguyên tử.
- Slot được sinh idempotent theo múi giờ chi nhánh và chặn cả xung đột bác sĩ lẫn
  phòng. Availability công khai chỉ trả slot còn trong booking window, bác sĩ
  nhận lịch online, dịch vụ được phân công và giá/khả dụng chi nhánh còn hiệu lực.
- Bệnh nhân đặt, xem, đổi và hủy lịch cho hồ sơ có quyền `bookingAllowed`;
  booking online giữ slot ở `PENDING`, còn PHONE/COUNTER của nhân viên được xác
  nhận ngay. Booking và reschedule dùng `Idempotency-Key` chống retry trùng.
- Nhân viên xem lịch theo chi nhánh/ngày/trạng thái, đặt tại quầy, xác nhận, đổi,
  hủy và ghi no-show. SQL kiểm tra permission cùng branch scope, trạng thái hợp
  lệ và thời hạn booking/reschedule/cancel trước khi thay đổi dữ liệu.
- Mọi transition ghi `appointment_status_history`; booking/reschedule/cancel,
  no-show và hold expiry ghi audit/outbox bằng public ID trong cùng transaction.
- Scheduler Worker dùng system procedure được cấp riêng để hết hạn hold mỗi phút
  và sinh trước slot khi khởi động/mỗi sáu giờ; không giả danh Admin và không DML
  trực tiếp bảng domain. Readiness phụ thuộc SQL, liveness vẫn độc lập.
- Gateway, OpenAPI/generated client, Mobile và Admin Web đã đồng bộ. Mobile có
  tìm slot/đặt/xem/đổi/hủy; Admin có quản lý ca, sinh slot và vận hành lịch tại quầy.

## DONE — Slice 10: Reception & Queue

Phạm vi đã hoàn thành:

- Check-in chỉ nhận lịch `CONFIRMED` trong cửa sổ cấu hình của chi nhánh; một
  transaction tạo Encounter nguồn appointment, snapshot dịch vụ theo giá chi
  nhánh hiệu lực, cấp QueueTicket và chuyển appointment sang `CHECKED_IN`.
- Walk-in tìm bệnh nhân trong scope chi nhánh rồi tạo trực tiếp Encounter + dịch
  vụ đầu + QueueTicket, không tạo appointment giả. Check-in và walk-in đều dùng
  `Idempotency-Key`, retry trả đúng public resource cũ.
- Điều kiện hành nghề được kiểm tra tại ngày nghiệp vụ: bác sĩ/nhân viên còn hoạt
  động, giấy phép còn hiệu lực, còn phân công chi nhánh và còn thực hiện dịch vụ;
  phòng, chi nhánh và bảng giá cũng phải đang hợp lệ.
- `encounters`, `queue_sessions`, `queue_tickets` có public UUID; API role chỉ
  được gọi wrapper public, không còn quyền ba command bigint nội bộ. Audit/outbox
  dùng public ID và nằm trong transaction nghiệp vụ.
- Bộ cấp số khóa theo chi nhánh/ngày/loại và tăng đơn điệu. Call-next dùng khóa
  dòng `UPDLOCK/READPAST/ROWLOCK`, ưu tiên giảm dần rồi FIFO; hai request đồng
  thời nhận hai ticket khác nhau. Lượt khám chỉ bắt đầu khi ticket đã `CALLED`,
  sau đó ticket/encounter/appointment chuyển `SERVING/IN_PROGRESS` nguyên tử.
- Admin Web có màn Tiếp nhận responsive: chọn chi nhánh, xem queue tự làm mới,
  check-in lịch trong ngày, tìm/tiếp nhận walk-in và gọi bệnh nhân kế tiếp.
- OpenAPI 3.1 v0.6 và generated types/fetch client đồng bộ sáu operation mới.

## DONE — Slice 11: Clinical Core

- Chỉ bác sĩ phụ trách đọc danh sách/hồ sơ khám theo chi nhánh; số đã `CALLED`
  mới được bắt đầu và điều kiện hành nghề được kiểm tra lại tại thời điểm bắt đầu.
- Ghi nhiều lần sinh hiệu với BMI, bệnh sử/khám thực thể/nhận định/kế hoạch,
  chẩn đoán sơ bộ/phân biệt/cuối cùng và duy nhất một chẩn đoán chính.
- Chỉ định dịch vụ dùng giá chi nhánh còn hiệu lực; bác sĩ phụ trách hoặc kỹ thuật
  viên chi nhánh đúng loại dịch vụ được chốt kết quả FINAL phiên bản 1, không rỗng.
- Hoàn tất khi có chẩn đoán chính và không còn dịch vụ/đơn thuốc mở; ký tạo hash
  SHA-256 của payload lâm sàng chuẩn hóa. Trigger chặn sửa lõi sau hoàn tất/ký;
  phụ lục sau ký là append-only, nối hash chữ ký trước.
- Mười hai SQL procedure lâm sàng dùng public UUID ở biên API. Quyền thực thi
  command bigint nội bộ được thu hồi khỏi Clinic API role, kể cả hủy lượt chưa có
  endpoint. OpenAPI v0.7/generated client và màn Khám bệnh trên Admin Web đã nối.

## DONE — Slice 12: Prescription & Pharmacy Core

- Bác sĩ phụ trách tạo đơn DRAFT trong lượt IN_PROGRESS, thêm thuốc/liều/tần suất/
  hướng dẫn, phát hành và hủy theo state machine. Nội dung kê sau phát hành được
  trigger bảo vệ; bệnh nhân có dị ứng hoạt chất cần quyền override riêng và lý do
  tối thiểu 10 ký tự, ghi audit bằng public ID.
- Admin tạo định nghĩa thuốc cấp tổ chức; nhân viên có `INVENTORY_MANAGE` tạo lô,
  vị trí kho/quầy/khu cách ly và nhập kho. Nhập tạo balance + ledger trong cùng
  transaction. Retry cùng `Idempotency-Key` trả movement cũ.
- Dược sĩ mở phiên tại quầy đúng chi nhánh, cấp từng phần theo lô FEFO còn hạn và
  không vượt lượng kê/tồn. Khóa ứng dụng theo vị trí và thuốc tuần tự hóa nhập/cấp;
  retry cùng key trả dòng cấp cũ. Hoàn tất/hủy phiên và đảo dòng có lý do; lô hết
  hạn/thu hồi không thể trả về kho bán.
- Đối soát so sánh balance với tổng ledger; các bảng thuốc/đơn/cấp phát/movement
  dùng public UUID ở biên API. Clinic API role không còn quyền gọi trực tiếp
  command bigint nội bộ. OpenAPI v0.8/generated client và màn Nhà thuốc được nối
  từ màn Khám bệnh của bác sĩ.

## DONE — Slice 13: Billing & Payments Core

- Thu ngân xem lượt khám và hóa đơn theo branch scope; tạo DRAFT idempotent theo
  active encounter, đồng bộ dịch vụ hoàn tất/thuốc đã cấp và thêm khoản thủ công,
  bảo hiểm trước khi phát hành.
- Phát hành khóa encounter + invoice, yêu cầu lượt `COMPLETED/SIGNED`, mọi dịch vụ
  terminal, không còn đơn hoặc phiên cấp nháp; charge được đồng bộ lại trong cùng
  transaction nên không có khoảng hở bỏ sót dịch vụ/thuốc.
- Thu nhiều lần khóa ứng dụng theo hóa đơn và không vượt dư nợ. Hoàn tiền gắn đúng
  payment allocation, không vượt số còn hoàn; payment/allocation/refund append-only.
  Issue/payment/refund dùng `Idempotency-Key` và retry trả resource cũ.
- VOID chỉ khi số thu ròng bằng 0; hóa đơn thay thế tham chiếu hóa đơn VOID. Audit
  và outbox cho issue/payment/refund/VOID dùng public UUID; Clinic API role chỉ có
  quyền các wrapper public, không còn gọi command bigint nội bộ.
- Admin Web có màn Thu ngân; OpenAPI 3.1 v0.9, generated types và fetch client đã
  đồng bộ. SQL regression bao phủ toàn hành trình và harness hai phiên thật chứng
  minh đúng một quầy thu toàn bộ thành công.

## DONE — Slice 14: Operational Reports Core

- Manager/Admin xem báo cáo lịch hẹn, lượt đến, hoàn tất, no-show, hủy và thời
  gian chờ trung bình trong đúng chi nhánh được cấp.
- Cashier xem số đã phát hành, thu, hoàn và thu ròng theo ngày/phương thức;
  Pharmacist xem dịch vụ/thuốc sử dụng, tồn dưới mức đặt hàng và lô hết hạn trong
  90 ngày. Manager/Admin có đủ ba capability.
- Mọi khoảng ngày được diễn giải theo timezone nghiệp vụ của chi nhánh rồi đổi
  sang UTC; đầu vào ngược hoặc dài hơn 366 ngày bị từ chối ở API và SQL.
- Clinic Service dùng pool báo cáo riêng. Với SQL login, thiếu
  `SQL_REPORT_USER`/`SQL_REPORT_PASSWORD` sẽ fail closed; bốn procedure chỉ được
  cấp cho `clinic_report_reader`, không cấp cho role mutation Clinic API.
- OpenAPI 3.1 v0.10/generated client và màn Báo cáo responsive trên Admin Web đã
  đồng bộ. SQL regression kiểm tra capability Manager/Cashier/Pharmacist,
  negative authorization và giới hạn khoảng ngày.

## DONE — Slice 15: Outbox Publisher & Appointment Reminders

- Outbox có event UUID ổn định, schema version, producer, correlation/causation,
  dedupe key, lịch retry, lease owner/expiry và dead-letter timestamp. Publisher
  giao at-least-once; consumer webhook dedupe theo event ID.
- Claim dùng `UPDLOCK + READPAST + ROWLOCK` và lease có hạn, nên nhiều worker
  không lấy cùng bản ghi; crash được phục hồi khi lease hết. Mỗi attempt lỗi dùng
  exponential backoff tối đa một giờ rồi chuyển dead-letter.
- Scheduler tạo `APPOINTMENT_REMINDER_DUE` một lần cho mỗi appointment + thời điểm
  + lead time. Materializer tạo notification idempotent theo source event, bỏ event
  stale sau reschedule và hủy reminder còn chờ khi lịch đổi/hủy/hết hạn.
- Vòng đời appointment created/confirmed/rescheduled/cancelled/expired/reminder
  được materialize sang EMAIL ưu tiên, fallback SMS. Outbox không chứa người nhận
  hoặc nội dung notification; log worker chỉ chứa metadata không nhạy cảm.
- Development có console adapter an toàn. Production chỉ khởi động với webhook
  HTTPS + bearer token và `SQL_WORKER_USER`/`SQL_WORKER_PASSWORD` riêng khi dùng
  SQL authentication; login chỉ thuộc `clinic_job_executor`.
- SQL regression kiểm tra ownership chain thật, scheduler/dedupe, loại trừ hai
  worker, materialize, retry/backoff/dead-letter và recovery. Unit test kiểm tra
  thứ tự publish/complete, failure path, chống overlap và không rò dữ liệu log.

## DONE — Slice 16: Safe Encounter Cancellation

- Lễ tân/Điều dưỡng/Manager/Admin có `ENCOUNTERS_CREATE` hủy lượt `WAITING` hoặc
  `IN_PROGRESS` bằng public UUID và lý do tối thiểu 10 ký tự ngay trên bảng hàng đợi.
- Một transaction đóng đồng bộ queue ticket, dịch vụ đang mở, đơn thuốc DRAFT,
  hóa đơn DRAFT, phân công nhân viên và appointment đã check-in; slot được giải phóng.
- Hủy bị chặn nếu còn thuốc đã cấp chưa đảo hoặc lượt khám đã có thanh toán thành
  công; lỗi API phân biệt rõ state conflict, thuốc và thanh toán để hướng dẫn xử lý.
- Retry lượt đã hủy là idempotent. Audit và outbox dùng public UUID; lượt có
  appointment phát thêm `APPOINTMENT_CANCELLED` để dừng reminder đang chờ.
- OpenAPI 3.1 v0.11, generated client/types, Clinic Service và Admin Web đã đồng bộ.
  Regression SQL rollback sạch, API test và smoke Gateway → Auth/Clinic → SQL đạt.

### Bằng chứng xác minh local toàn bộ

| Kiểm tra | Kết quả |
|---|---|
| Baseline SQL chạy lại idempotent | Đạt; 70 bảng, 23 view, 159 procedure, 30 trigger |
| SQL auth session/staff RBAC/staff safety/password lifecycle/patient registration/patient link/catalog-directory/patient registry/scheduling-appointments/reception-queue/clinical-core/pharmacy-core/pharmacy-FEFO/pharmacy-allergy/billing-core/reports-core/notifications-outbox regression | 17/17 PASS; rollback sạch. Hai harness SQL thật xác minh queue gọi hai ticket khác nhau và payment race chỉ một quầy thu được toàn bộ dư nợ |
| OpenAPI lint + code generation | Đạt; contract hợp lệ và generated code sinh lặp lại ổn định |
| npm run lint | Đạt, không cảnh báo |
| npm run typecheck | Đạt |
| npm test | 120 test đạt (Admin 5, Auth 34, Mobile 14, Clinic 55, Worker 12), gồm hủy lượt an toàn và outbox/delivery worker |
| npm run build | Đạt; .NET 0 warning/0 error |
| npm run doctor:mobile | 21/21; ba gói Expo SDK 57 đã được nâng đúng patch tương thích |
| Gateway → Auth → SQL smoke test | Registration thiếu idempotency key trả 400; challenge lạ trả generic OTP 400; ba route patient-access mới đi đúng Auth và trả 401 + request ID + `Cache-Control: no-store` khi thiếu token |
| Clinic Catalog → SQL smoke test | Public branch/service trả dữ liệu và giá hiệu lực từ SQL thật; Admin Catalog thiếu token trả 401; read repository trả đủ branch/service/doctor và lịch sử giá |
| Gateway → Auth/Clinic → SQL patient smoke test | Demo Admin đăng nhập; lấy chi nhánh, tra cứu, mở hồ sơ thật đạt; đọc lâm sàng không có care relationship trả 403 |
| Gateway → Clinic → SQL scheduling smoke test | Public availability trả 200 từ SQL thật; patient/admin appointments và schedules thiếu token trả 401; route Admin đi đúng Clinic; request ID xuyên suốt; Gateway readiness trả 200 |
| Gateway → Clinic → SQL reception smoke test | `receptionist.demo` đăng nhập qua Gateway; đọc branch/workspace từ SQL thật; queue rỗng trả `data: null` khi call-next; request ID xuyên suốt; logout đạt |
| Gateway → Clinic → SQL encounter cancellation smoke test | `receptionist.demo` gọi endpoint hủy bằng public UUID không tồn tại qua Gateway; Clinic trả đúng 404 `RECEPTION_RESOURCE_NOT_FOUND`, có request ID xuyên suốt và logout đạt. Transaction hủy thật được xác minh bằng SQL regression rollback sạch |
| Gateway → Auth/Clinic → SQL clinical smoke test | `doctor.demo` đăng nhập qua Gateway; danh sách chi nhánh lâm sàng và lượt khám đọc từ SQL thật trả 200, status sai trả 400, request ID xuyên suốt và logout đạt. Luồng ghi/hoàn tất/ký được xác minh bằng regression SQL rollback sạch |
| Gateway → Auth/Clinic → SQL pharmacy smoke test | `pharmacist.demo` và `doctor.demo` đăng nhập qua Gateway; scoped pharmacy branches, workspace và đối soát đọc SQL thật trả 200, request ID xuyên suốt. Luồng ghi nhập/cấp/đảo được kiểm tra trong SQL regression rollback sạch |
| Gateway → Auth/Clinic → SQL billing smoke test | `cashier.demo` đăng nhập qua Gateway; billing branches/workspace đọc SQL thật trả 200 với request ID xuyên suốt; thiếu token trả 401 và logout đạt. Luồng ghi/phát hành/thu/hoàn/VOID được xác minh bằng SQL regression rollback sạch |
| Gateway → Auth/Clinic → SQL reports smoke test | `manager.demo` nhận đủ ba capability và ba report trả 200; `cashier.demo` chỉ đọc revenue, `pharmacist.demo` chỉ đọc inventory, nhóm trái quyền trả 403; request ID xuyên suốt và logout đạt |
| Scheduler Worker smoke test | Worker khởi động đủ năm job hold/slot/reminder/outbox/notification; sinh slot hệ thống đạt và `/health/live`, `/health/ready` cùng trả 200 với SQL thật |
| npm audit --omit=dev --audit-level=high | Đạt; 0 high/critical. Còn 17 moderate từ dependency bắc cầu Expo/React Navigation, chưa có bản sửa không breaking |

## Chưa hoàn thành

- Phase 0 baseline freeze tổng thể, checksum và các defect P0 ngoài phạm vi Auth.
- Lần chạy GitHub Actions và branch protection chỉ xác minh được sau khi push.
- Theo dõi bản vá upstream cho 17 cảnh báo moderate bắc cầu Expo/React Navigation;
  không dùng `npm audit fix --force` vì công cụ đề xuất hạ Expo xuống bản breaking.
- Các mục Auth P1 như MFA, quản lý permission động và lịch sử session.
- Phase 3 còn quản lý liên hệ khẩn cấp, ghi dị ứng/bệnh nền và chính sách công bố
  kết quả cho patient/guardian khi có luồng khám hoàn chỉnh.
- Phase 4 còn time-off, ngày nghỉ/lịch đặc biệt và quy trình duyệt ca; core đặt
  lịch online/tại quầy và reminder đa kênh đã hoàn thành qua Slice 09/15.
- Phase 5 còn recall/skip/cancel/transfer ticket có lý do, đóng phiên, bảng hiển
  thị công khai và ước lượng thời gian chờ; lõi Reception & Queue của Slice 10 đã hoàn thành.
- Phase 6 còn lịch sử khám cho bệnh nhân theo chính sách công bố, kết quả nhiều
  phiên bản, đính kèm tệp và chữ ký số có kiểm chứng certificate; lõi bác sĩ
  hoàn tất/ký/bổ sung và hủy lượt an toàn đã hoàn thành qua Slice 11/16.
- Phase 7 còn quản lý nhà cung cấp, cập nhật/khóa danh mục thuốc, cảnh báo lô sắp
  hết hạn và harness hai quầy cấp đồng thời; lõi kê đơn–nhập kho–cấp–đảo–đối soát
  của Slice 12 đã hoàn thành.
- Phase 8 còn in/xuất hóa đơn, tích hợp payment gateway/webhook và hồ sơ claim bảo
  hiểm; lõi hóa đơn–thu–hoàn–VOID của Slice 13 đã hoàn thành.
- Phase 9 còn replay dead-letter thủ công và export CSV/XLSX; lõi báo cáo,
  outbox publisher, reminder, retry tự động và dead-letter đã hoàn thành.

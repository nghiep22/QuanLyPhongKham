# Kế hoạch xây dựng hệ thống quản lý phòng khám tư nhân

> Phiên bản tài liệu: 1.0
> Cập nhật lần cuối: 2026-09-10
> Trạng thái: Kiến trúc mục tiêu đã chốt; SQL là baseline candidate, còn các mục P0 trước khi freeze
> Phạm vi: Admin Web, ứng dụng bệnh nhân, Gateway, Auth Service, Clinic Service, Scheduler Worker và SQL Server

## 1. Mục tiêu của tài liệu

Tài liệu này là nguồn tham chiếu chính khi bắt đầu và tiếp tục phát triển dự án. Mục tiêu là:

- Chốt cấu trúc monorepo ngay từ đầu để không phải di chuyển hàng loạt file khi dự án lớn lên.
- Chốt ranh giới giữa Gateway, Auth Service, Clinic Service và Worker.
- Liệt kê đầy đủ chức năng theo module, vai trò và mức ưu tiên.
- Chốt các trạng thái và bất biến nghiệp vụ trước khi viết giao diện/API.
- Dùng OpenAPI và client sinh tự động để frontend không phụ thuộc vào chi tiết backend.
- Dùng migration forward-only để không sửa ngược baseline SQL đã triển khai.
- Xây theo lát cắt dọc, mỗi phase tạo ra một luồng dùng được từ giao diện đến database.

Tài liệu này không thay thế đặc tả chi tiết của từng màn hình/API. Khi một quyết định quan trọng thay đổi, phải tạo ADR trong `docs/adr/` và cập nhật mục liên quan tại đây.

## 2. Trạng thái hiện tại

| Hạng mục | Trạng thái |
|---|---|
| Thư mục `fe/` và `be/` | Đã tạo |
| SQL Server `quan_ly_phong_kham.sql` | Baseline candidate: đã có luồng lõi, còn gap/defect P0 tại mục 8.12 |
| Database objects | 66 bảng, 12 view, 57 stored procedure, 29 trigger |
| Kiểm thử database | Bộ kiểm thử hiện có đã đạt; chưa coi production-ready trước khi bổ sung ca P0 |
| Gateway | Chưa scaffold |
| Auth Service | Chưa scaffold |
| Clinic Service | Chưa scaffold |
| Scheduler Worker | Chưa scaffold |
| Admin Web | Chưa scaffold |
| Mobile | Chưa scaffold |
| OpenAPI contract | Chưa tạo |

Trong Phase 0, sửa các defect P0 ngay trên baseline candidate, chạy lại toàn bộ test rồi mới chuyển đúng một lần sang `be/database/baseline/001_initial.sql` và ghi checksum. Sau khi baseline đã dùng ở môi trường chung hoặc production, không sửa ngược; mọi thay đổi phải đi qua migration mới.

## 3. Các quyết định kiến trúc cố định

Các quyết định dưới đây nhằm giảm rework. Chỉ thay đổi khi có ADR và lý do đủ mạnh.

1. Frontend chỉ gọi Gateway, không gọi trực tiếp Auth Service hoặc Clinic Service.
2. Gateway chỉ xử lý routing, CORS, correlation/request ID, giới hạn request và chính sách hạ tầng; không chứa logic phòng khám.
3. Ban đầu chỉ có hai service nghiệp vụ: `auth-service` và `clinic-service`. `auth-service` là ranh giới **Identity & Workforce**, không chỉ là nơi phát token. Không tách thêm microservice sớm.
4. `clinic-service` là modular monolith, chia module rõ ràng để có thể tách riêng Pharmacy, Billing hoặc Notification sau này mà không đổi URL công khai.
5. Toàn bộ code mới của frontend và backend dùng TypeScript ở chế độ `strict`.
6. API dùng tiền tố `/api/v1`; thay đổi breaking phải tạo `/api/v2` hoặc có kế hoạch tương thích.
7. OpenAPI 3.1 là hợp đồng chính thức; frontend dùng client TypeScript sinh tự động.
8. SQL Server là nguồn dữ liệu chính. Không dùng SQLite thay thế trong integration test.
9. Mọi mutation runtime gọi public command stored procedure. SQL tham số hóa viết tay chỉ dùng cho `SELECT`/read model qua repository; không đưa SQL vào controller.
10. Thời điểm tuyệt đối lưu UTC; ngày/giờ vận hành theo múi giờ Windows của chi nhánh.
11. Mọi thao tác quan trọng phải có transaction, idempotency, audit và outbox khi cần phát sự kiện.
12. Refresh token web dùng cookie `HttpOnly`; mobile lưu trong Expo SecureStore. Access token không lưu LocalStorage.
13. Server state dùng TanStack Query; state UI cục bộ dùng React state/Context hoặc Zustand khi thực sự cần. Không đưa server state vào Redux.
14. Admin Web dùng React Router ngay từ đầu; Mobile dùng React Navigation ngay từ đầu.
15. Database baseline bất biến; migration là forward-only và có kiểm tra trước/sau khi chạy.
16. MVP phục vụ **một tổ chức phòng khám có nhiều chi nhánh**, chưa phải SaaS nhiều tenant. Không thêm `tenant_id` nửa chừng; nếu chuyển sang SaaS phải có ADR và migration riêng.
17. MVP dùng VND. Mọi số tiền dùng `decimal`/`DECIMAL`, không dùng số thực; mã tiền tệ vẫn có trong contract để mở rộng có kiểm soát.
18. Phiên bản công nghệ trong tài liệu chỉ là mục tiêu. Nguồn sự thật là `package.json`, lockfile, `.nvmrc` và `global.json`.
19. Metadata tệp nằm trong SQL Server; nội dung ảnh/PDF nằm trong object storage qua adapter, không lưu blob lớn trực tiếp trong bảng nghiệp vụ.
20. SMS/email/push, thanh toán, bảo hiểm và object storage đều đi qua port/adapter; domain không phụ thuộc trực tiếp một nhà cung cấp.
21. Chuyên khoa, định nghĩa dịch vụ, thuốc và nhà cung cấp là danh mục cấp tổ chức. Chi nhánh chỉ quản lý khả dụng, phòng/kho, giá có hiệu lực và override được cấp quyền; Branch Manager không được âm thầm sửa danh mục toàn tổ chức.

## 4. Tổng quan kiến trúc

```text
Admin Web (React + Vite) ───┐
                            ├── Ocelot Gateway :5000
Patient Mobile (Expo/RN) ───┘          │
                              ┌────────┴─────────┐
                              │                  │
                     Auth Service :4001  Clinic Service :4002
                              │                  │
                              └──── SQL Server ──┘
                                       ▲
                                       │
                              Scheduler Worker
                         (hold, slot, reminder, outbox)

Clinic Service ── storage port ──► Object Storage (ảnh/PDF)
Auth/Clinic ── transaction ──► SQL Outbox ──► Worker ──► SMS/email/push
Clinic Service ── provider ports ────────────► Payment/insurance
```

### 4.1 Trách nhiệm từng thành phần

| Thành phần | Trách nhiệm | Không được làm |
|---|---|---|
| Admin Web | Vận hành phòng khám, dashboard, quản trị và báo cáo | Không chứa quy tắc nghiệp vụ quyết định cuối cùng |
| Patient Mobile | Đăng ký, quản lý hồ sơ được ủy quyền, tìm lịch, đặt/hủy lịch, xem kết quả | Không gọi database/service nội bộ trực tiếp |
| Ocelot Gateway | Route, CORS, request ID, rate limit, timeout, health aggregation | Không truy vấn SQL và không quyết định trạng thái nghiệp vụ |
| Auth Service | Identity & Workforce: credential, login, refresh/logout, session, MFA, RBAC, hồ sơ nhân viên/bác sĩ và liên kết tài khoản bệnh nhân | Không quản lý hồ sơ lâm sàng, lịch khám, kho hoặc hóa đơn |
| Clinic Service | Danh mục, bệnh nhân, lịch, hàng đợi, khám, đơn thuốc, kho, hóa đơn, báo cáo | Không tự phát JWT hoặc lưu mật khẩu |
| Scheduler Worker | Hết hạn giữ chỗ, sinh slot, reminder, outbox, retry, cảnh báo và reconciliation | Không cung cấp API công khai cho người dùng cuối |
| SQL Server | Transaction, constraint, stored procedure, audit, outbox và nguồn dữ liệu chuẩn | Không gửi email/SMS hoặc xử lý UI |

### 4.2 Vì sao không tách nhiều service ngay

- Appointment booking, encounter, prescription, inventory và invoice có nhiều transaction liên quan; giữ trong một Clinic Service giúp giảm distributed transaction.
- Ranh giới module vẫn được duy trì ở code và API, nên có thể tách khi có nhu cầu tải, đội ngũ hoặc bảo mật thực tế.
- Gateway giữ nguyên URL công khai nếu sau này một module được chuyển thành service riêng.
- Outbox tạo sẵn điểm tách bất đồng bộ mà không buộc hệ thống dùng message broker từ ngày đầu.

### 4.3 Quyền sở hữu dữ liệu và procedure

Hai service dùng chung một SQL Server trong giai đoạn đầu, nhưng **không đồng nghĩa cùng được ghi mọi bảng**. Quyền ghi được khóa bằng database login và `GRANT EXECUTE`, không chỉ bằng quy ước trong code.

| Chủ sở hữu lệnh ghi | Phạm vi | Quy tắc |
|---|---|---|
| Auth Service | `users`, credential, session, MFA, role/permission, role assignment, employee, doctor identity/assignment và patient-account link | Sở hữu toàn bộ luồng tạo tài khoản nhân viên; `sp_create_staff_account` chỉ Auth được gọi |
| Clinic Service | Branch/room/catalog, patient clinical data, schedule/slot/appointment, queue/encounter, clinical result, prescription, inventory, invoice/payment/refund | Auth không được gọi repository hoặc procedure mutation của Clinic |
| Database Platform | Audit append-only, document sequence, idempotency record và helper bảo mật dùng chung | Chỉ public command procedure gọi helper; API không gọi trực tiếp |
| Scheduler Worker | Job lease/checkpoint, notification delivery và trạng thái publish của outbox; hết hạn hold/sinh slot/reconciliation qua system procedure riêng | Không DML trực tiếp vào bảng domain và không giả danh admin |
| Reporting/Audit reader | Clinic Service dùng pool read-only riêng để gọi read procedure đã kiểm tra permission/branch scope | Không dùng `clinic_core_executor`, không cấp broad table/view SELECT |

- Một command/procedure chỉ có một service làm chủ. Service khác cần dữ liệu phải dùng read view/procedure có version hoặc internal API; không import repository xuyên service.
- `user_patient_access` thuộc Auth. Migration P0 phải bỏ nhánh ghi bảng này khỏi `sp_create_patient`; `sp_create_patient_portal_account` và `sp_link_user_patient` thuộc Auth, còn Clinic chỉ đọc liên kết qua contract đã cấp quyền.
- Cross-service read contract phải đủ hai chiều: Clinic đọc principal/doctor/patient-access của Auth; Auth đọc reference tối thiểu về branch/specialty/service/patient của Clinic để validate staff assignment và portal link. Chỉ dùng versioned view/read procedure có caller `GRANT` rõ, không đọc bảng owner trực tiếp.
- Outbox là ngoại lệ có chủ sở hữu theo thao tác: Auth/Clinic chỉ **append** event trong transaction domain; Worker chỉ **claim/publish/mark retry/dead-letter**. Notification delivery thuộc Worker. Audit chỉ append qua `sp_write_audit` từ command owner.
- Tạo `be/database/ownership.yml` ánh xạ toàn bộ bảng/view và 57 procedure hiện có sang owner/caller; CI từ chối procedure chưa được khai báo hoặc `GRANT` vượt quyền.
- `clinic-service` có thể xác thực JWT cục bộ bằng public key/JWKS và kiểm tra token version theo cơ chế đã chốt; không gọi Auth cho từng request.
- Nếu một use case mới buộc ghi xuyên hai ownership, ưu tiên chuyển command trọn vẹn về một owner hoặc dùng orchestration có idempotency/outbox và bước bù; không giả định transaction phân tán.
- Mỗi service có database login riêng. CI kiểm tra Auth không `EXECUTE` được procedure Clinic và ngược lại.
- `/api/v1/reports/*` và `/api/v1/audit/*` vẫn do Clinic phục vụ nhưng dùng connection pool `clinic_report_reader`; principal/permission lấy từ token đã xác minh và `SESSION_CONTEXT`, dữ liệu trả về luôn scope tại read procedure.

### 4.4 Phân nhóm ownership cho 57 procedure hiện có

Bảng này là inventory khởi tạo cho `be/database/ownership.yml`. “Owner” là nơi được phép thay đổi logic; caller thực tế còn phải được giới hạn bằng `GRANT`.

| Nhóm/owner | Số lượng | Procedure |
|---|---:|---|
| Database Platform — internal helper | 5 | `sp_assert_actor`, `sp_assert_permission`, `sp_write_audit`, `sp_next_document_number`, `sp_get_branch_business_date` |
| Auth Service — public command | 7 | `sp_bootstrap_first_admin`, `sp_create_staff_account`, `sp_grant_user_role`, `sp_revoke_user_role`, `sp_create_patient_portal_account`, `sp_link_user_patient`, `sp_assign_doctor_service` |
| Clinic — internal helper | 2 | `sp_assert_appointment_access`, `sp_allocate_queue_ticket_internal` |
| Clinic — organization/catalog | 3 | `sp_create_room`, `sp_create_service`, `sp_create_medicine_batch` |
| Clinic — patient | 1 | `sp_create_patient` |
| Clinic — scheduling/appointment | 8 | `sp_create_doctor_working_schedule`, `sp_generate_doctor_slots`, `sp_book_appointment`, `sp_confirm_appointment`, `sp_cancel_appointment`, `sp_expire_appointment_holds`, `sp_reschedule_appointment`, `sp_mark_appointment_no_show` |
| Clinic — reception/queue | 3 | `sp_check_in_appointment`, `sp_create_walk_in_encounter`, `sp_call_next_queue_ticket` |
| Clinic — clinical | 10 | `sp_start_encounter`, `sp_update_encounter_clinical_notes`, `sp_add_vital_signs`, `sp_add_encounter_diagnosis`, `sp_order_encounter_service`, `sp_finalize_service_result`, `sp_complete_encounter`, `sp_sign_encounter`, `sp_add_encounter_amendment`, `sp_cancel_encounter` |
| Clinic — pharmacy/inventory | 10 | `sp_create_prescription`, `sp_add_prescription_item`, `sp_issue_prescription`, `sp_cancel_prescription`, `sp_receive_stock`, `sp_open_dispensation`, `sp_dispense_prescription_item`, `sp_complete_dispensation`, `sp_reverse_dispensation_item`, `sp_cancel_dispensation` |
| Clinic — billing/payment | 8 | `sp_create_invoice`, `sp_sync_invoice_items`, `sp_add_manual_invoice_item`, `sp_set_invoice_insurance_amount`, `sp_issue_invoice`, `sp_record_invoice_payment`, `sp_refund_payment_allocation`, `sp_void_invoice` |

Quy tắc caller đặc biệt:

- Năm Database Platform helper và hai Clinic internal helper không được `GRANT EXECUTE` trực tiếp cho API/Worker.
- `sp_bootstrap_first_admin` chỉ dành cho setup/DBA, bị khóa sau bootstrap.
- Worker là caller runtime của command hết hạn hold; sinh slot tự động phải qua system wrapper riêng sau khi sửa P0, không dùng actor Admin giả.
- Trước khi tách role database, sửa `sp_create_patient` để không còn ghi `user_patient_access`; nếu không, ownership ở bảng trên chưa có hiệu lực.

## 5. Công nghệ mục tiêu

| Thành phần | Công nghệ đề xuất | Ghi chú ổn định cấu trúc |
|---|---|---|
| Admin Web | React 19, Vite, TypeScript | Feature-first, React Router, TanStack Query |
| Mobile | React Native + Expo, TypeScript | React Navigation, SecureStore, cùng client API sinh từ OpenAPI |
| UI/form | React Hook Form + Zod | Schema form có thể chia sẻ quy ước với API contract |
| Gateway | .NET + Ocelot | Chỉ hạ tầng và routing |
| Auth Service | Node.js, TypeScript, Express | ESM, JWT ký bất đối xứng, Argon2id, cookie và session rotation |
| Clinic Service | Node.js, TypeScript, Express | Modular monolith, repository gọi SQL Server |
| Worker | Node.js, TypeScript | Chạy job có lease/idempotency, không chạy cùng job đồng thời |
| Database | Microsoft SQL Server 2019+, khuyến nghị 2022 | Stored procedure, filtered index, `rowversion`, UTC |
| SQL driver | `mssql` | Pool riêng theo service, query tham số hóa; `msnodesqlv8` chỉ là adapter Windows Auth cho local nếu cần |
| Logging | Pino JSON | Luôn có `requestId`, `actorUserId`, `branchId` khi có |
| Telemetry | OpenTelemetry | Truyền W3C trace context xuyên Gateway, service, Worker và SQL call |
| API contract | OpenAPI 3.1, Redocly | Lint, breaking-change check, sinh client |
| Unit/API test | Vitest, Supertest | Cùng config workspace cho các package Node |
| E2E Web | Playwright | Chạy theo critical journey |
| Mobile test | React Native Testing Library | Smoke trên thiết bị/emulator ở release candidate |

Phiên bản dependency phải được pin bằng lockfile. Không nâng framework trong cùng pull request với thay đổi nghiệp vụ lớn.

## 6. Cấu trúc toàn dự án mục tiêu

```text
QuanLyPhongKham/
├── be/
│   ├── database/
│   │   ├── baseline/
│   │   │   └── 001_initial.sql
│   │   ├── migrations/
│   │   │   ├── 002_<mo_ta>.sql
│   │   │   └── ...
│   │   ├── seeds/
│   │   │   ├── development.sql
│   │   │   └── test.sql
│   │   ├── tests/
│   │   │   ├── schema.test.sql
│   │   │   ├── business-rules.test.sql
│   │   │   └── concurrency/
│   │   ├── ownership.yml          # Owner/caller/GRANT của bảng, view và procedure
│   │   └── README.md
│   ├── gateway/
│   │   ├── Configuration/
│   │   ├── Middleware/
│   │   ├── appsettings.json
│   │   ├── Gateway.csproj
│   │   ├── ocelot.json
│   │   └── Program.cs
│   ├── services/
│   │   ├── auth-service/
│   │   │   ├── src/
│   │   │   │   ├── app/
│   │   │   │   ├── config/
│   │   │   │   ├── infrastructure/
│   │   │   │   ├── middleware/
│   │   │   │   ├── modules/
│   │   │   │   │   ├── auth/
│   │   │   │   │   ├── users/
│   │   │   │   │   ├── roles/
│   │   │   │   │   ├── workforce/       # Employee, doctor và phân công
│   │   │   │   │   └── patient-access/
│   │   │   │   └── shared/
│   │   │   ├── tests/
│   │   │   └── package.json
│   │   └── clinic-service/
│   │       ├── src/
│   │       │   ├── app/
│   │       │   ├── config/
│   │       │   ├── platform/
│   │       │   │   ├── database/
│   │       │   │   ├── identity/
│   │       │   │   ├── http/
│   │       │   │   ├── observability/
│   │       │   │   └── storage/
│   │       │   ├── modules/
│   │       │   │   ├── organization-catalog/
│   │       │   │   ├── patients/
│   │       │   │   ├── scheduling-appointments/
│   │       │   │   ├── reception-queue/
│   │       │   │   ├── clinical/
│   │       │   │   ├── pharmacy-inventory/
│   │       │   │   ├── billing-payments/
│   │       │   │   └── reporting-audit/
│   │       │   └── shared/
│   │       ├── tests/
│   │       └── package.json
│   ├── workers/
│   │   └── scheduler-worker/
│   │       ├── src/
│   │       │   ├── jobs/
│   │       │   ├── outbox/
│   │       │   ├── notification-providers/
│   │       │   └── health/
│   │       ├── tests/
│   │       └── package.json
│   ├── contracts/
│   │   ├── openapi/
│   │   │   ├── openapi.yaml
│   │   │   ├── paths/
│   │   │   ├── schemas/
│   │   │   └── examples/
│   │   └── events/
│   ├── README.md
│   ├── BACKEND_PLAN.md
│   └── IMPLEMENTATION_STATUS.md
├── fe/
│   ├── admin-web/
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── router/
│   │   │   │   ├── providers/
│   │   │   │   └── layouts/
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── dashboard/
│   │   │   │   ├── patients/
│   │   │   │   ├── appointments/
│   │   │   │   ├── queue/
│   │   │   │   ├── encounters/
│   │   │   │   ├── clinical/
│   │   │   │   ├── pharmacy/
│   │   │   │   ├── billing/
│   │   │   │   ├── staff/
│   │   │   │   ├── schedules/
│   │   │   │   ├── catalog/
│   │   │   │   ├── reports/
│   │   │   │   └── settings/
│   │   │   ├── shared/
│   │   │   │   ├── api/          # Adapter quanh package generated
│   │   │   │   ├── components/
│   │   │   │   ├── hooks/
│   │   │   │   ├── validation/
│   │   │   │   └── utils/
│   │   │   ├── main.tsx
│   │   │   └── styles/
│   │   ├── tests/
│   │   └── package.json
│   └── mobile/
│       ├── src/
│       │   ├── app/
│       │   │   ├── navigation/
│       │   │   └── providers/
│       │   ├── features/
│       │   │   ├── auth/
│       │   │   ├── patient-profiles/
│       │   │   ├── doctor-search/
│       │   │   ├── appointments/
│       │   │   ├── medical-history/
│       │   │   ├── prescriptions/
│       │   │   ├── invoices/
│       │   │   └── notifications/
│       │   ├── shared/
│       │   │   ├── api/          # Adapter quanh package generated
│       │   │   ├── components/
│       │   │   ├── config/
│       │   │   ├── storage/
│       │   │   ├── theme/
│       │   │   └── utils/
│       │   └── assets/
│       ├── tests/
│       ├── app.json
│       └── package.json
├── packages/
│   ├── generated-api-types/       # Kiểu/schema trung lập cho server và client
│   ├── generated-api-client/      # HTTP client cho Web/Mobile, không sửa tay
│   ├── shared-config/             # ESLint, TypeScript và test config
│   └── design-tokens/             # Màu, khoảng cách, typography dùng chung
├── infra/
│   ├── compose/                   # Local SQL Server và dependency giả lập
│   ├── deployment/                # Cấu hình theo môi trường
│   └── observability/             # Dashboard/alert cấu hình như code
├── docs/
│   ├── architecture/
│   ├── domain/
│   ├── security/
│   ├── testing/
│   ├── operations/
│   └── adr/
├── scripts/
│   ├── setup/
│   ├── database/
│   ├── dev/
│   └── test/
├── tests/
│   ├── e2e/
│   ├── contract/
│   └── performance/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── database.yml
├── .runtime/                 # Runtime local, không commit
├── .editorconfig
├── .env.example
├── .gitignore
├── .nvmrc
├── AGENTS.md
├── global.json               # Khóa .NET SDK cho Gateway
├── PROJECT_PLAN.md
├── README.md
├── package.json              # Orchestrator workspace, không chứa app logic
├── package-lock.json
└── tsconfig.base.json
```

`generated-api-types` không phụ thuộc browser/React và có thể dùng ở API boundary của backend. `generated-api-client` phụ thuộc types nhưng chỉ được Web/Mobile import; domain backend không import HTTP client sinh tự động.

### 6.1 Cấu trúc chuẩn của một backend module

```text
modules/reception-queue/
├── api/
│   ├── reception.routes.ts
│   ├── reception.controller.ts
│   └── reception.dto.ts
├── application/
│   ├── commands/
│   ├── queries/
│   └── ports/
├── domain/
│   ├── queue-ticket.model.ts
│   ├── check-in.policy.ts
│   └── reception.errors.ts
├── infrastructure/
│   └── reception.sql-repository.ts
├── __tests__/
└── index.ts                 # Public interface duy nhất của module
```

Quy tắc phụ thuộc:

```text
api → application → domain
          ▲
          └── infrastructure implements ports → SQL Server/outbox/provider
DTO/schema ← OpenAPI/generated contract
```

- `domain/` không phụ thuộc Express, SQL driver hoặc provider bên ngoài.
- `application/` điều phối use case và permission policy. Với baseline hiện tại, public stored procedure là transaction boundary; handler không mở outer transaction ở Node.
- `api/` chỉ chuyển đổi HTTP request/response và validation ở biên.
- `infrastructure/` hiện thực port truy cập SQL Server, outbox hoặc nhà cung cấp ngoài.
- Module không import file nội bộ của module khác. Giao tiếp qua public interface hoặc application service.
- Một stored procedure ghi nguyên tử qua nhiều bảng thuộc cùng workflow phải được đặt ở bounded context sở hữu workflow đó; ví dụ check-in/walk-in thuộc `reception-queue`, không bị xé thành module appointment/queue/encounter riêng.
- `shared/` chỉ chứa thành phần thật sự dùng chung; không biến thành nơi chứa code chưa biết đặt đâu.

### 6.2 Cấu trúc chuẩn của một frontend feature

```text
features/appointments/
├── api/                     # Wrapper quanh generated client
├── components/
├── hooks/
├── pages/ hoặc screens/
├── schemas/
├── types/
├── utils/
└── index.ts                 # Public exports duy nhất
```

Không import xuyên vào thư mục nội bộ của feature khác. Thành phần dùng chung từ ba feature trở lên mới chuyển vào `shared/`.

## 7. Vai trò và phạm vi sử dụng

| Vai trò | Phạm vi chính |
|---|---|
| Guest/Public | Xem chi nhánh, chuyên khoa, dịch vụ, bác sĩ, slot công khai; đăng ký/đăng nhập |
| System Admin | Tài khoản, role/permission, chi nhánh, cấu hình toàn hệ thống, audit |
| Clinic Manager | Nhân sự, danh mục, lịch làm việc, vận hành và báo cáo theo chi nhánh |
| Receptionist | Bệnh nhân, lịch hẹn, check-in, walk-in, hàng đợi |
| Doctor | Xem hồ sơ được phân công, khám, chẩn đoán, chỉ định, kê đơn, ký và bổ sung hồ sơ |
| Nurse | Tiếp nhận, sinh hiệu, hỗ trợ lâm sàng và hàng đợi |
| Lab/Imaging Technician | Nhận chỉ định, thực hiện dịch vụ, nhập/chốt kết quả |
| Pharmacist | Xem đơn hợp lệ, quản lý lô/tồn, cấp thuốc và đảo sai sót |
| Cashier | Đồng bộ/phát hành hóa đơn, thu tiền và hoàn tiền theo quyền |
| Patient/Guardian | Quản lý hồ sơ được xác minh, đặt/hủy lịch, xem lịch sử/kết quả được công bố |
| Auditor/Report Viewer | Chỉ đọc báo cáo, đối soát và audit theo permission/scope |
| Scheduler Worker | Tác vụ nền bằng service account, không đại diện người dùng cuối |

Role ứng dụng có thể gắn toàn cục hoặc theo chi nhánh. Một người có thể mang nhiều role nhưng mọi API vẫn kiểm tra permission và branch scope cụ thể.

Các role code đã có trong baseline gồm: `ADMIN`, `MANAGER`, `DOCTOR`, `NURSE`, `RECEPTIONIST`, `PHARMACIST`, `CASHIER`, `LAB_TECH`, `PATIENT`. `Guest/Public` không phải database role; `Auditor/Report Viewer` nên được cấu hình bằng permission đọc riêng, không sao chép quyền Admin.

## 8. Danh mục chức năng

Quy ước ưu tiên:

- **MVP**: bắt buộc để vận hành một phòng khám thực tế ở mức cơ bản.
- **P1**: triển khai ngay sau MVP, cấu trúc phải hỗ trợ sẵn.
- **P2**: mở rộng; không làm sớm nhưng không được thiết kế chặn đường.

### 8.1 Xác thực, tài khoản và phân quyền

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| SEC-01 | Bootstrap admin đầu tiên bằng password hash | DBA/System Admin | MVP |
| SEC-02 | Đăng nhập bằng username/email/phone | Tất cả | MVP |
| SEC-03 | Access token ngắn hạn, refresh token rotation, logout | Tất cả | MVP |
| SEC-04 | Đăng xuất mọi thiết bị và thu hồi session | Người dùng/Admin | MVP |
| SEC-05 | Khóa tài khoản sau nhiều lần sai và mở khóa | Hệ thống/Admin | MVP |
| SEC-06 | Đổi mật khẩu, quên/đặt lại mật khẩu | Tất cả | MVP |
| SEC-07 | Tạo/sửa/khóa tài khoản nhân viên | Admin/Manager | MVP |
| SEC-08 | Gán/thu hồi role theo chi nhánh và thời hạn | Admin | MVP |
| SEC-09 | Quản lý permission và ma trận role-permission | Admin | P1 |
| SEC-10 | Quản trị tài khoản portal; duyệt/thu hồi liên kết người thân/người giám hộ bằng permission riêng | Admin/Manager/Receptionist được ủy quyền | MVP |
| SEC-11 | MFA cho tài khoản đặc quyền | Admin/Doctor/Cashier | P1 |
| SEC-12 | Xem lịch sử đăng nhập, thiết bị và session | Người dùng/Admin | P1 |
| SEC-13 | Bệnh nhân tự đăng ký, xác minh OTP và yêu cầu liên kết hồ sơ an toàn | Guest/Patient/Receptionist | MVP |
| SEC-14 | Bảo vệ Admin toàn cục cuối cùng và kiểm soát tự thu hồi quyền | System Admin | MVP |

### 8.2 Chi nhánh, nhân sự và danh mục

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| ADM-01 | Quản lý chi nhánh, địa chỉ, múi giờ và chính sách đặt lịch | Admin | MVP |
| ADM-02 | Quản lý phòng khám/phòng thủ thuật/phòng xét nghiệm/nhà thuốc | Admin/Manager | MVP |
| ADM-03 | Quản lý chuyên khoa và loại dịch vụ cấp tổ chức | Admin/Global Catalog Manager | MVP |
| ADM-04 | Quản lý định nghĩa dịch vụ toàn tổ chức; khả dụng và giá hiệu lực theo chi nhánh | Admin/Manager theo scope | MVP |
| ADM-05 | Hồ sơ nhân viên, loại nhân viên, ngày vào/nghỉ việc | Admin/Manager | MVP |
| ADM-06 | Hồ sơ bác sĩ, chứng chỉ, học hàm và trạng thái nhận lịch online | Admin/Manager | MVP |
| ADM-07 | Phân công bác sĩ theo chi nhánh/chuyên khoa/dịch vụ | Admin/Manager | MVP |
| ADM-08 | Import/export danh mục có validation và preview | Admin/Manager | P1 |
| ADM-09 | Lịch sử thay đổi giá và danh mục | Admin/Audit | P1 |

### 8.3 Bệnh nhân

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| PAT-01 | Tạo và cập nhật hồ sơ hành chính bệnh nhân | Receptionist/Admin | MVP |
| PAT-02 | Tìm kiếm theo mã, tên, số điện thoại, ngày sinh, định danh | Nhân viên có quyền | MVP |
| PAT-03 | Cảnh báo hồ sơ có khả năng trùng trước khi tạo | Receptionist/Admin | MVP |
| PAT-04 | Quản lý liên hệ khẩn cấp | Receptionist/Patient | MVP |
| PAT-05 | Quản lý dị ứng và mức độ nghiêm trọng | Nurse/Doctor | MVP |
| PAT-06 | Quản lý bệnh nền/tiền sử quan trọng | Doctor/Nurse | MVP |
| PAT-07 | Quản lý bảo hiểm và thời hạn | Receptionist/Cashier | P1 |
| PAT-08 | Xác minh quyền đặt lịch cho bản thân/người thân | Receptionist/Admin | MVP |
| PAT-09 | Thu hồi quyền truy cập hồ sơ người thân | Patient/Admin | MVP |
| PAT-10 | Gộp hồ sơ bệnh nhân trùng có lịch sử audit | Admin chuyên trách | P1 |
| PAT-11 | Cờ hạn chế riêng tư và lý do truy cập khẩn cấp | Admin/Doctor | P2 |

### 8.4 Lịch bác sĩ và slot khám

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| SCH-01 | Tạo ca làm theo thứ, giờ, phòng và thời gian hiệu lực | Manager | MVP |
| SCH-02 | Thiết lập giờ nghỉ trong ca | Manager | MVP |
| SCH-03 | Bác sĩ yêu cầu hoặc hủy yêu cầu nghỉ của chính mình | Doctor | MVP |
| SCH-04 | Khai báo ngày nghỉ toàn phần hoặc một khoảng giờ | Manager | MVP |
| SCH-05 | Sinh slot theo ca, thời lượng và múi giờ chi nhánh | Manager/Worker | MVP |
| SCH-06 | Chặn ca/slot chồng bác sĩ hoặc phòng | Hệ thống | MVP |
| SCH-07 | Cảnh báo lịch hẹn xung đột trước khi duyệt nghỉ | Hệ thống/Manager | MVP |
| SCH-08 | Xem lịch ngày/tuần/tháng theo bác sĩ/phòng | Nhân viên | MVP |
| SCH-09 | Sao chép lịch theo tuần và tạo lịch theo mẫu | Manager | P1 |
| SCH-10 | Danh sách chờ khi hết slot | Receptionist/Patient | P2 |
| SCH-11 | Duyệt/từ chối nghỉ và xử lý lịch hẹn xung đột | Manager | MVP |

### 8.5 Đặt lịch online và tại quầy

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| APT-01 | Tìm bác sĩ/dịch vụ/chi nhánh và slot còn trống | Patient/Receptionist | MVP |
| APT-02 | Đặt online cho hồ sơ được ủy quyền | Patient/Guardian | MVP |
| APT-03 | Giữ chỗ `PENDING` có thời hạn | Hệ thống | MVP |
| APT-04 | Xác nhận lịch online | Receptionist/Manager | MVP |
| APT-05 | Đặt lịch qua điện thoại/tại quầy và xác nhận ngay | Receptionist | MVP |
| APT-06 | Đổi lịch nguyên tử sang slot khác | Patient/Receptionist | MVP |
| APT-07 | Hủy lịch theo hạn và lý do | Patient/Receptionist | MVP |
| APT-08 | Tự động hết hạn giữ chỗ và giải phóng slot | Worker | MVP |
| APT-09 | Đánh dấu không đến | Receptionist | MVP |
| APT-10 | Gửi xác nhận/nhắc lịch/thay đổi lịch | Worker | MVP |
| APT-11 | Retry an toàn bằng idempotency key | Hệ thống | MVP |
| APT-12 | Cấu hình phí đặt cọc/chính sách hủy | Manager | P2 |

### 8.6 Tiếp nhận, walk-in và hàng đợi

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| QUE-01 | Check-in lịch đã xác nhận | Receptionist/Nurse | MVP |
| QUE-02 | Tạo lượt khám trực tiếp không cần appointment giả | Receptionist | MVP |
| QUE-03 | Phát số hàng đợi tăng đơn điệu theo chi nhánh/ngày/loại | Hệ thống | MVP |
| QUE-04 | Hàng đợi ưu tiên rồi FIFO | Receptionist/Nurse | MVP |
| QUE-05 | Gọi số tiếp theo chống hai quầy gọi cùng một người | Nhân viên | MVP |
| QUE-06 | Chuyển WAITING → CALLED → SERVING → COMPLETED | Nhân viên/Hệ thống | MVP |
| QUE-07 | Bỏ qua/gọi lại/hủy ticket có lý do | Receptionist | P1 |
| QUE-08 | Màn hình hiển thị số và phòng khám | Bệnh nhân | P1 |
| QUE-09 | Ước lượng thời gian chờ | Hệ thống | P2 |

### 8.7 Khám bệnh và hồ sơ lâm sàng

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| CLI-01 | Bác sĩ bắt đầu đúng lượt đã `CALLED`; bypass phải có quyền/lý do | Doctor | MVP |
| CLI-02 | Ghi lý do khám, bệnh sử, khám thực thể, nhận định và kế hoạch | Doctor | MVP |
| CLI-03 | Điều dưỡng ghi nhiều lần đo sinh hiệu và BMI | Nurse/Doctor | MVP |
| CLI-04 | Ghi chẩn đoán sơ bộ/phân biệt/cuối cùng | Doctor | MVP |
| CLI-05 | Bắt buộc duy nhất một chẩn đoán chính trước khi hoàn tất | Hệ thống | MVP |
| CLI-06 | Chỉ định dịch vụ xét nghiệm/hình ảnh/thủ thuật | Doctor | MVP |
| CLI-07 | Theo dõi trạng thái chỉ định | Doctor/Technician | MVP |
| CLI-08 | Nhập và chốt kết quả `FINAL` phiên bản 1, không cho kết quả rỗng | Technician/Doctor | MVP |
| CLI-18 | Kết quả `DRAFT/PRELIMINARY`, version mới và amendment không ghi đè | Technician/Doctor | P1 |
| CLI-09 | Đính kèm file và kiểm tra SHA-256 | Nhân viên có quyền | P1 |
| CLI-10 | Hoàn tất lượt khám khi không còn tác vụ bắt buộc | Doctor | MVP |
| CLI-11 | Ký/khóa hồ sơ bằng payload chuẩn hóa SHA-256 | Doctor | MVP |
| CLI-12 | Chữ ký số được verify với payload hash, certificate chain và revocation | Doctor | P1 |
| CLI-13 | Bổ sung hồ sơ đã ký bằng amendment append-only nối hash | Doctor | MVP |
| CLI-14 | Hủy lượt khám có kiểm tra thuốc/hóa đơn liên quan | Nhân viên có quyền | MVP |
| CLI-15 | Xem lịch sử khám theo thời gian | Doctor/Patient theo phạm vi | MVP |
| CLI-16 | Mẫu phiếu khám/in hồ sơ | Doctor/Receptionist | P1 |
| CLI-17 | Referral/chuyển viện và giấy nghỉ | Doctor | P2 |

### 8.8 Đơn thuốc và nhà thuốc

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| RX-01 | Tạo đơn DRAFT gắn đúng encounter/patient/doctor | Doctor | MVP |
| RX-02 | Thêm thuốc, liều, tần suất, thời gian và hướng dẫn | Doctor | MVP |
| RX-03 | Cảnh báo dị ứng hoạt chất; override phải có quyền và lý do | Doctor/Pharmacist | MVP |
| RX-04 | Phát hành/hủy đơn và thời hạn dùng đơn | Doctor | MVP |
| RX-05 | Khóa nội dung kê sau phát hành | Hệ thống | MVP |
| RX-06 | Mở phiên cấp phát tại đúng quầy/chi nhánh | Pharmacist | MVP |
| RX-07 | Cấp một phần hoặc toàn bộ theo lô FEFO | Pharmacist | MVP |
| RX-08 | Không cấp vượt lượng kê hoặc tồn khả dụng | Hệ thống | MVP |
| RX-09 | Hoàn tất/hủy phiên cấp phát | Pharmacist | MVP |
| RX-10 | Đảo dòng cấp sai; chỉ trả kho bán khi lô/hàng còn đủ điều kiện, nếu không vào cách ly | Pharmacist | MVP |
| RX-11 | In đơn thuốc và nhãn hướng dẫn | Doctor/Pharmacist | P1 |
| RX-12 | Cảnh báo trùng hoạt chất và tương tác thuốc nâng cao | Doctor/Pharmacist | P1 |

### 8.9 Tồn kho thuốc

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| INV-01 | Danh mục thuốc cấp tổ chức: hoạt chất, hàm lượng, dạng, đường dùng | Admin/Dược sĩ được cấp quyền danh mục | MVP |
| INV-02 | Nhà cung cấp cấp tổ chức; lô/hạn dùng/giá nhập-bán theo chi nhánh/kho | Dược sĩ được cấp quyền | MVP |
| INV-03 | Quản lý kho, quầy cấp và khu cách ly | Admin/Pharmacist | MVP |
| INV-04 | Nhập kho tạo balance và movement nguyên tử | Pharmacist | MVP |
| INV-05 | Ledger tồn kho append-only và reversal | Hệ thống | MVP |
| INV-06 | Đối soát balance với tổng ledger | Pharmacist/Audit | MVP |
| INV-07 | Cảnh báo tồn thấp và lô sắp hết hạn | Worker/Pharmacist | MVP |
| INV-08 | Điều chỉnh tăng/giảm có phê duyệt và lý do | Pharmacist/Manager | P1 |
| INV-09 | Chuyển kho hai vế nguyên tử | Pharmacist | P1 |
| INV-10 | Thu hồi, cách ly và tiêu hủy có biên bản | Pharmacist/Manager | P1 |
| INV-11 | Kiểm kê và xử lý chênh lệch | Pharmacist/Manager | P1 |

### 8.10 Hóa đơn, thanh toán và hoàn tiền

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| BIL-01 | Tạo hóa đơn DRAFT theo lượt khám | Cashier | MVP |
| BIL-02 | Đồng bộ dòng từ dịch vụ hoàn tất và thuốc đã cấp | Cashier/Hệ thống | MVP |
| BIL-03 | Thêm dòng thủ công có quyền và audit | Cashier | MVP |
| BIL-04 | Giảm giá, thuế và phần bảo hiểm | Cashier/Manager | MVP |
| BIL-05 | Phát hành sau completeness gate và khóa nội dung hóa đơn | Cashier | MVP |
| BIL-06 | Thu tiền mặt/thẻ/chuyển khoản/ví | Cashier | MVP |
| BIL-07 | Chặn thu vượt dư nợ dưới concurrency | Hệ thống | MVP |
| BIL-08 | Thanh toán một phần và nhiều lần | Cashier | MVP |
| BIL-09 | Hoàn tiền không vượt phân bổ gốc | Cashier có quyền | MVP |
| BIL-10 | VOID chỉ khi thu ròng bằng 0 | Cashier/Manager | MVP |
| BIL-11 | Hóa đơn thay thế hóa đơn VOID | Cashier | MVP |
| BIL-12 | In/xuất hóa đơn và biên lai | Cashier/Patient | P1 |
| BIL-13 | Gateway thanh toán và webhook idempotent | Hệ thống | P1 |
| BIL-14 | Hồ sơ claim/quyết toán bảo hiểm | Cashier/Insurance staff | P2 |
| BIL-15 | Payment/refund ledger bất biến; sửa sai bằng bản ghi đảo/hoàn | Hệ thống/Cashier | MVP |

### 8.11 Thông báo, báo cáo, audit và vận hành

| Mã | Chức năng | Vai trò | Ưu tiên |
|---|---|---|---|
| SYS-01 | Outbox ghi cùng transaction nghiệp vụ | Hệ thống | MVP |
| SYS-02 | Gửi email/SMS/push/in-app có retry | Worker | MVP |
| SYS-03 | Reminder trước lịch và thông báo thay đổi/hủy | Worker | MVP |
| SYS-04 | Dead-letter và retry thủ công | Admin/Worker | P1 |
| SYS-05 | Audit actor, branch, request, dữ liệu cũ/mới và chuỗi hash | Hệ thống/Audit | MVP |
| SYS-06 | Audit hành vi đọc dữ liệu nhạy cảm ở tầng ứng dụng | Hệ thống/Audit | P1 |
| RPT-01 | Dashboard lịch, lượt đến, no-show và thời gian chờ | Manager | MVP |
| RPT-02 | Doanh thu thu tiền ròng theo ngày chi nhánh | Manager/Cashier | MVP |
| RPT-03 | Dịch vụ/thuốc sử dụng và tồn sắp hết | Manager/Pharmacist | MVP |
| RPT-04 | Hiệu suất bác sĩ/phòng/dịch vụ | Manager | P1 |
| RPT-05 | Export CSV/XLSX theo quyền | Manager | P1 |
| OPS-01 | Health/readiness/liveness cho mọi process | DevOps/Admin | MVP |
| OPS-02 | Structured log, correlation ID và metrics | DevOps | MVP |
| OPS-03 | Backup, restore drill và retention | DBA/DevOps | MVP |
| OPS-04 | Monitoring job/outbox/database pool | DevOps | P1 |

### 8.12 Khoảng trống giữa SQL hiện tại và sản phẩm hoàn chỉnh

Baseline SQL đã có các transaction cốt lõi, nhưng không nên hiểu “SQL hoàn chỉnh” là mọi màn hình CRUD đã có sẵn procedure. Quy ước:

- **Sẵn**: đã có procedure/view và bất biến nghiệp vụ chính.
- **Khung**: đã có bảng/trạng thái nhưng cần thêm command/query procedure, quyền `GRANT` hoặc read model.
- **Mới**: cần migration hoặc tích hợp mới.

Trong bảng này, **P0** nghĩa là phải chốt thiết kế trước và hoàn thành ở đầu phase sở hữu, trước API/UI phụ thuộc vào nó; không có nghĩa phải hoàn thành mọi màn hình trong cùng một lần. Trước khi freeze baseline ở Phase 0, tối thiểu phải xử lý ownership/database role, `publicId`, schema auth/OTP, scope catalog/price, policy columns, event envelope và các dòng “Có defect”; P0 read API cụ thể có thể được thêm bằng migration forward-only ở phase domain tương ứng.

| Ưu tiên | Hạng mục cần bổ sung | Hiện trạng | Điều kiện xong |
|---|---|---|---|
| P0 | Login, refresh rotation, logout, đổi/reset mật khẩu, khóa/mở tài khoản | Khung | API + procedure/query tối thiểu + negative/security test |
| P0 | `tokenVersion`/security stamp, reset token và OTP challenge dùng một lần | Mới | Đổi mật khẩu/khóa user thu hồi token; OTP hash có TTL và chống replay |
| P0 | Last-admin và self-revoke guard | Có defect | Không thu hồi/vô hiệu hóa Admin toàn cục hoạt động cuối cùng; thao tác tự hạ quyền nhạy cảm cần xác nhận/policy |
| P0 | Patient self-registration và xác minh OTP/liên kết hồ sơ | Mới | Chống takeover hồ sơ và có quy trình duyệt ngoại lệ |
| P0 | `publicId` UUID cho mọi aggregate xuất hiện trong URL/event công khai | Mới | Ít nhất branch, doctor, service, slot, patient, appointment, encounter, prescription, invoice hoàn tất trước OpenAPI v1 |
| P0 | Ownership manifest và tách command chạm chéo service | Có defect | `sp_create_patient` không còn ghi `user_patient_access`; đủ owner/caller/`GRANT` cho 57 procedure |
| P0 | Read model cho user, nhân viên, danh mục, bệnh nhân, lịch, encounter, đơn và hóa đơn | Khung | Mỗi màn hình có query phân trang, filter, branch scope và `GRANT` |
| P0 | Cross-service read contract hai chiều | Mới | Clinic đọc principal/doctor/patient-access; Auth đọc active branch/specialty/service/patient reference; cột tối thiểu, version và `GRANT` rõ |
| P0 | Chính sách đọc hồ sơ và công bố kết quả | Có defect | Staff theo care relationship; Patient theo link; Receptionist không đọc lâm sàng; result có `releasedToPatient` |
| P0 | Update/deactivate master data, nhân viên và bác sĩ | Khung | Không hard delete; có `rowversion`, audit và conflict test |
| P0 | Cập nhật patient, liên hệ, dị ứng, bệnh nền, bảo hiểm và portal link | Khung | Có permission/patient scope và lịch sử thay đổi |
| P0 | Permission chuyên biệt cho sinh hiệu, chốt kết quả và quản lý portal link | Khung | LAB_TECH không ghi sinh hiệu; NURSE không chốt result; Receptionist không cần `USERS_MANAGE` rộng |
| P0 | Một nguồn kiểm tra role assignment hiệu lực | Có defect | Mọi custom authz đều kiểm tra role active, assignment active, `validFrom/validTo` và branch; không né hạn hủy bằng role hết hiệu lực |
| P0 | Permission và command danh mục dược | Khung | Pharmacist quản lý batch/location/supplier cần thiết mà không có `MASTER_DATA_MANAGE` toàn cục |
| P0 | Phạm vi danh mục và giá theo chi nhánh | Có defect thiết kế | Global catalog có quyền riêng; availability/giá hiệu lực theo branch và invoice giữ snapshot |
| P0 | Request/cancel leave và approve/reject leave | Khung | Doctor không cần `SCHEDULES_MANAGE`; Manager xử lý xung đột có audit |
| P0 | Break, holiday, block/unblock slot | Khung | Không tạo xung đột với slot/lịch hẹn hiện hữu |
| P0 | Cửa sổ check-in/no-show theo chính sách chi nhánh | Có hard-code | Thay mốc `-120/+180` bằng cấu hình có default, validation và snapshot/audit khi dùng override |
| P0 | Điều kiện hành nghề của bác sĩ | Khung | Schedule/book/check-in/walk-in chặn bác sĩ inactive, hết hạn chứng chỉ hoặc không còn assignment tại service date |
| P0 | Public availability dành cho online booking | Có defect | Lọc `accepts_online_booking`, branch/service/specialty và booking window; command đặt lịch kiểm tra patient access riêng |
| P0 | Chính sách patient tự đổi lịch | Có defect | Slot mới nhận online; lịch cũ còn trong deadline; không đổi rồi hủy để né chính sách; staff override có lý do |
| P0 | Idempotency coverage cho command quan trọng | Khung | Đủ scope/key/request-hash/replay response cho danh sách ở mục 11.1, kể cả reschedule và webhook |
| P0 | Optimistic concurrency cho update | Có defect | Procedure nhận `@expected_row_ver`; stale `If-Match` trả conflict, không âm thầm ghi đè |
| P0 | Worker service account và claim/lease/retry cho outbox/notification | Khung | Chạy nhiều instance không xử lý trùng; có dead-letter |
| P0 | System procedure sinh slot dành cho Worker | Khung | Worker được cấp đúng `EXECUTE`, không cần actor Admin/`SCHEDULES_MANAGE` và vẫn có audit |
| P0 | Outbox event coverage và envelope version | Khung | Không chỉ `APPOINTMENT_CREATED`; event ghi cùng transaction và handler idempotent theo `eventId` |
| P0 | Audit search/enrichment/verify | Khung | `AUDIT_VIEW`, branch scope, pagination; IP/user-agent/request context được ghi và chain verification đạt |
| P0 | Canonical payload dùng khi ký hồ sơ | Có defect | Bỏ trạng thái cấp phát có thể đổi khỏi payload hoặc lưu snapshot bất biến; bump schema version, liệt kê field coverage và kiểm thử recompute sau cấp/reversal |
| P0 | Tự chuyển prescription hết hạn | Có defect | Không `UPDATE` rồi `THROW` trong transaction bị rollback; có command/worker idempotent lưu `EXPIRED` và audit |
| P0 | Đối chiếu dị ứng hoạt chất khi kê/cấp | Mới | Allergen được chuẩn hóa/mapping với medicine; cảnh báo rõ, override có permission/lý do/audit |
| P0 | Start encounter tuân thủ queue | Có defect | Ticket phải `CALLED` đúng lượt trước khi `SERVING`; bypass cần permission/lý do và không phá priority/FIFO |
| P0 | Validation kết quả FINAL | Có defect | Không chốt khi summary/conclusion/result/value đều rỗng; validate theo result schema của dịch vụ |
| P0 | Reversal về kho bán an toàn | Có defect | Lô còn ACTIVE, chưa hết hạn/thu hồi/cách ly và hàng trả đạt kiểm tra; nếu không bắt buộc vào quarantine |
| P0 | Completeness gate khi phát hành hóa đơn | Có defect | Khóa encounter/billable sources, đồng bộ trong transaction, không còn service/dispensation dở hoặc dòng chưa tính |
| P0 | Ledger thanh toán/refund append-only thật sự | Có defect | Chặn UPDATE/DELETE field tài chính đã chốt; thay đổi bằng reversal/refund record, trigger + least-privilege test |
| P0 | Read procedure cho báo cáo và ma trận quyền | Có defect | `REPORTS_VIEW` được kiểm tra; Manager/Cashier/Pharmacist chỉ xem đúng báo cáo và branch scope |
| P1 | Queue recall/skip/cancel/transfer và đóng phiên | Khung | Transition hợp lệ, lý do bắt buộc và chống gọi trùng |
| P1 | Service cancel/transition; result DRAFT/PRELIMINARY/version/amend | Khung | Không ghi đè kết quả FINAL; đầy đủ audit/version |
| P1 | Attachment upload/delete trước khi khóa hồ sơ | Khung | SQL chỉ giữ metadata; object storage, scan tệp và signed URL |
| P1 | Chuyển kho, điều chỉnh, kiểm kê, cách ly/thu hồi/hết hạn lô | Khung | Ledger hai vế/append-only và reconciliation đạt |
| P1 | Lịch sử giá dịch vụ/thuốc nâng cao, promotion và bảng giá đối tác | Mới | Không sửa snapshot giao dịch cũ; effective period không chồng nhau |
| P1 | Xác minh chữ ký số/certificate | Khung chưa an toàn | Verify chữ ký khớp payload hash, chain/trust/revocation/time; không chỉ kiểm tra tham số khác NULL |

Mỗi chức năng UI phải có traceability: `feature code → OpenAPI operationId → permission → procedure/read model → automated test`. Database role `clinic_api_executor` đang cấm DML trực tiếp, vì vậy không được dựng màn hình CRUD trước rồi mới phát hiện API thiếu quyền thực thi.

### 8.13 Ngoài phạm vi MVP

MVP chưa triển khai telemedicine, LIS/PACS/DICOM hoàn chỉnh, bảo hiểm điện tử, hóa đơn điện tử, mua hàng/công nợ nhà cung cấp, chấm công/lương, nội trú, SaaS multi-tenant, BI warehouse hoặc AI hỗ trợ chẩn đoán. Các nhu cầu này chỉ được đưa vào roadmap sau khi có owner, quy tắc nghiệp vụ, yêu cầu pháp lý và ADR; không thêm bảng/menu “để dành” khi chưa có use case.

## 9. State machine bắt buộc

Không tạo status mới tùy tiện trong UI. Status phải được khai báo trong OpenAPI, backend và migration/constraint tương ứng.

### 9.1 Appointment

```text
PENDING ──► CONFIRMED ──► CHECKED_IN ──► IN_PROGRESS ──► COMPLETED
   │            │              │               │
   ├─► EXPIRED  ├─► NO_SHOW    └───────────────┴─► CANCELLED
   └────────────┴───────────────────────────────► CANCELLED
```

`PENDING` là giữ chỗ chờ xác nhận trong một khoảng thời gian, không phải trạng thái thanh toán. Nếu sau này có đặt cọc, payment state phải là state machine riêng.

### 9.2 Encounter

```text
WAITING ──► IN_PROGRESS ──► COMPLETED ──► SIGNED
   │              │
   └──────────────┴────────► CANCELLED
```

Sau `COMPLETED`, dữ liệu lâm sàng không còn được sửa; từ `COMPLETED` chỉ được ký. Sau `SIGNED`, mọi sửa đổi phải qua amendment append-only.

### 9.3 Encounter service và result

```text
ORDERED ──► IN_PROGRESS ──► COMPLETED
   │              │
   └──────────────┴────────► CANCELLED

DRAFT ──► PRELIMINARY ──► FINAL
                         └─► AMENDED (phiên bản mới, không ghi đè)
```

Đây là state machine mục tiêu P1. Baseline MVP hiện chỉ hỗ trợ tạo trực tiếp kết quả `FINAL` phiên bản 1; chưa được quảng bá version/amend cho tới khi có migration, procedure và test bất biến.

### 9.4 Prescription và dispensation

```text
DRAFT ──► ISSUED ──► PARTIALLY_DISPENSED ──► DISPENSED
  │          │
  └──────────┴────────► CANCELLED
             └────────► EXPIRED

Dispensation: DRAFT ──► COMPLETED
                    └─► CANCELLED
```

### 9.5 Invoice

```text
DRAFT ──► ISSUED ──► PARTIALLY_PAID ──► PAID
  │          │              ▲              │
  └──────────┴─► VOID       └── refund ────┘
```

Refund không xóa payment/allocation cũ. Mọi khoản tiền là ledger append-only; điều chỉnh bằng bản ghi hoàn/đảo.

Invoice status được tính lại từ số thu ròng: refund có thể chuyển `PAID → PARTIALLY_PAID → ISSUED` hoặc `PARTIALLY_PAID → ISSUED`. Chỉ được `VOID` sau khi số thu ròng về 0; không tạo trạng thái `REFUNDED` song song trong MVP.

### 9.6 Bất biến liên kết Appointment–Encounter–Queue

- Trước check-in, chỉ command hủy appointment được phép chuyển `PENDING/CONFIRMED → CANCELLED` và giải phóng slot.
- Sau check-in, không hủy appointment riêng. Phải gọi command hủy encounter; command này khóa và cập nhật encounter, queue ticket, appointment, dịch vụ dở, đơn DRAFT và invoice DRAFT trong cùng transaction.
- Hủy encounter bị từ chối khi còn thuốc đã cấp chưa reversal hoặc đã có tiền thu chưa xử lý hoàn/void.
- Bắt đầu encounter phải chuyển queue ticket sang phục vụ và appointment sang `IN_PROGRESS` nguyên tử; hoàn tất encounter phải đóng queue ticket và chuyển appointment sang `COMPLETED` nguyên tử.
- Không expose endpoint “set status” chung cho từng bảng. Chỉ expose command nghiệp vụ `check-in`, `start`, `complete`, `cancel` và chạy reconciliation test để phát hiện trạng thái lệch.

## 10. Luồng nghiệp vụ xuyên suốt

### 10.1 Đăng ký và liên kết hồ sơ bệnh nhân

1. Guest gửi phone/email; Auth tạo registration challenge và chỉ lưu OTP hash có TTL, số lần thử và trạng thái chống replay.
2. Sau xác minh, Auth kích hoạt user có role `PATIENT`; không tự liên kết bệnh án chỉ dựa vào số điện thoại trùng.
3. Nếu đã có patient, user gửi yêu cầu claim/relationship; trường hợp `SELF` chắc chắn có thể auto-match theo policy, còn mơ hồ/người giám hộ phải được nhân viên duyệt.
4. Nếu chưa có patient, Clinic tạo hồ sơ hành chính qua command idempotent; Auth tạo link sau bằng orchestration có trạng thái. Retry không được tạo hai user/patient/link.
5. Chỉ link `ACTIVE`, đã verify và `isBookingAllowed=true` mới được dùng đặt lịch. Thu hồi link phải chặn ngay command mới và ghi audit.

### 10.2 Đặt lịch online

1. Patient Mobile lấy danh sách chi nhánh, dịch vụ, bác sĩ và slot qua Gateway; public read model chỉ trả bác sĩ nhận lịch online và slot đúng branch/service/specialty/booking window.
2. Auth xác định user; Clinic Service kiểm tra quyền với patient profile được liên kết.
3. Backend nhận `Idempotency-Key`, khóa slot và patient schedule trong transaction.
4. Nếu có hold cũ đã hết hạn, chuyển sang `EXPIRED` trước khi thử đặt.
5. Tạo appointment `PENDING`, thời hạn hold, status history, audit và outbox.
6. Receptionist xác nhận hoặc Worker tự hết hạn.
7. Retry cùng actor/operation/key/payload trả cùng resource; khác payload trả conflict.
8. Patient tự đổi lịch phải còn trong deadline của lịch cũ và slot mới vẫn đủ điều kiện online; không cho đổi sang tương lai rồi hủy để né chính sách. Staff override phải có permission và lý do audit.

### 10.3 Khách đến có lịch

1. Lễ tân tìm appointment `CONFIRMED` và check-in trong cửa sổ cho phép.
2. Một encounter và một queue ticket được tạo trong cùng transaction.
3. Appointment chuyển `CHECKED_IN`.
4. Bác sĩ gọi/bắt đầu lượt, appointment và encounter chuyển `IN_PROGRESS`.

### 10.4 Khách walk-in

1. Lễ tân tìm hoặc tạo patient.
2. Chọn chi nhánh, bác sĩ, phòng và dịch vụ phù hợp.
3. Tạo trực tiếp encounter nguồn `WALK_IN`; không tạo appointment giả.
4. Encounter service ban đầu và queue ticket được tạo nguyên tử.

### 10.5 Khám, kê đơn và ký

1. Điều dưỡng ghi sinh hiệu khi encounter `WAITING` hoặc `IN_PROGRESS`.
2. Chỉ bác sĩ phụ trách bắt đầu và ghi nội dung khám/chẩn đoán/chỉ định.
3. Kỹ thuật viên hoàn tất chỉ định và chốt result theo version.
4. Bác sĩ tạo/phát hành đơn thuốc khi encounter còn `IN_PROGRESS`.
5. Chỉ hoàn tất khi có chẩn đoán chính, không còn dịch vụ bắt buộc dở dang và không còn đơn DRAFT.
6. Khi ký, database tạo hash theo canonical schema đã công bố; trigger khóa cây dữ liệu lâm sàng. Trước production phải hoàn tất ma trận field coverage và test ở mục 8.12, không mô tả hash là bao phủ field chưa được kiểm chứng.
7. Thay đổi sau ký chỉ là amendment mới nối hash trước đó.

### 10.6 Cấp thuốc và tồn kho

1. Dược sĩ mở dispensation cho prescription còn hiệu lực tại đúng chi nhánh.
2. Khóa prescription item, batch và inventory balance.
3. Kiểm tra đúng thuốc, lô khả dụng, hạn dùng, FEFO và lượng còn kê.
4. Trừ balance, thêm dispensation item và inventory movement trong cùng transaction.
5. Đảo cấp phát tạo movement đảo; không sửa/xóa movement gốc.
6. Hàng bệnh nhân trả chỉ trở lại kho bán khi đạt quy trình xác nhận; nếu không vào quarantine.

### 10.7 Hóa đơn và thanh toán

1. Có thể tạo invoice DRAFT theo encounter để theo dõi tạm; DRAFT chưa phải số tiền chốt.
2. Trước khi phát hành, khóa encounter và nguồn billable; yêu cầu encounter đã `COMPLETED/SIGNED`, mọi dịch vụ đã terminal và không còn dispensation DRAFT.
3. Procedure phát hành tự đồng bộ lại dịch vụ `COMPLETED` và thuốc đã cấp/chưa reversal, kiểm tra không sót dòng, rồi mới khóa hóa đơn trong cùng transaction.
4. Cashier kiểm tra giảm giá/bảo hiểm và xác nhận quyết định cấp thuốc tại phòng khám. Sau phát hành không tạo thêm billable item cho encounter trong MVP; sai sót xử lý bằng refund/VOID/replacement.
5. Thanh toán khóa invoice theo application lock để không thu vượt khi hai quầy thao tác đồng thời.
6. Refund gắn đúng payment allocation và không vượt số còn có thể hoàn.
7. Chỉ VOID khi số thu ròng bằng 0; hóa đơn thay thế tham chiếu hóa đơn VOID.

## 11. Thiết kế API ổn định

### 11.1 Quy ước chung

- Base URL công khai: `/api/v1`.
- URL dùng danh từ số nhiều, `kebab-case`; JSON dùng `camelCase`.
- ID database `bigint` chỉ trả dưới dạng string khi thực sự cần cho API nội bộ để tránh mất chính xác ở JavaScript. Resource có khả năng xuất hiện trong URL/tích hợp ngoài dùng `publicId` UUID ổn định.
- Tiền `decimal(19,2)` luôn trả dưới dạng **decimal string** kèm `currency: "VND"`; không dùng JSON number hoặc minor unit trong API v1.
- Timestamp trả ISO 8601 UTC có hậu tố `Z`; ngày địa phương trả `YYYY-MM-DD` riêng.
- Danh mục/báo cáo hữu hạn dùng `page`, `pageSize`, `sort`; audit, queue history và feed tăng nhanh dùng `cursor`, `limit`. Một endpoint không đổi chiến lược sau khi phát hành v1.
- `Idempotency-Key` bắt buộc cho register/create/link, appointment book/reschedule, check-in/walk-in, dispense/reversal, issue invoice, payment/refund và webhook; scope theo actor + operation + key + request hash.
- Optimistic concurrency dùng HTTP `ETag` chứa `rowversion` Base64; mutation cập nhật bắt buộc gửi `If-Match`. Không tạo thêm cơ chế version song song trong body.
- Mọi response có `requestId`.
- Backend trả `error.code` ổn định và trung lập ngôn ngữ; frontend ánh xạ sang thông báo tiếng Việt. Không viết logic dựa vào chuỗi `message`.

Response thành công:

```json
{
  "data": {},
  "meta": {},
  "requestId": "uuid"
}
```

Response lỗi:

```json
{
  "error": {
    "code": "APPOINTMENT_SLOT_UNAVAILABLE",
    "message": "Slot không còn khả dụng.",
    "details": []
  },
  "requestId": "uuid"
}
```

### 11.2 Nhóm endpoint dự kiến

| Prefix | Sở hữu | Nội dung |
|---|---|---|
| `/.well-known/jwks.json` | Auth Service | public keys có `kid` để các service xác minh JWT |
| `/api/v1/auth/*` | Auth Service | register, login, refresh, logout, password, MFA |
| `/api/v1/me/*` | Auth Service | profile, sessions, patient links |
| `/api/v1/admin/users/*` | Auth Service | account và trạng thái |
| `/api/v1/admin/roles/*` | Auth Service | role, permission và assignment |
| `/api/v1/admin/staff/*` | Auth Service | hồ sơ nhân viên/bác sĩ, phân công và liên kết account |
| `/api/v1/public/branches` | Clinic Service | chi nhánh công khai |
| `/api/v1/public/specialties` | Clinic Service | chuyên khoa công khai |
| `/api/v1/public/services` | Clinic Service | dịch vụ công khai |
| `/api/v1/public/doctors` | Clinic Service | bác sĩ/chuyên khoa công khai |
| `/api/v1/public/availability` | Clinic Service | slot được phép đặt |
| `/api/v1/patients/*` | Clinic Service | hồ sơ bệnh nhân theo quyền |
| `/api/v1/appointments/*` | Clinic Service | self-service appointment |
| `/api/v1/admin/appointments/*` | Clinic Service | lịch vận hành |
| `/api/v1/schedules/*` | Clinic Service | ca, nghỉ, slot |
| `/api/v1/check-ins/*` | Clinic Service | check-in và walk-in |
| `/api/v1/queues/*` | Clinic Service | ticket và gọi số |
| `/api/v1/encounters/*` | Clinic Service | vòng đời lượt khám |
| `/api/v1/clinical/*` | Clinic Service | sinh hiệu, chẩn đoán, chỉ định, result, ký |
| `/api/v1/prescriptions/*` | Clinic Service | đơn và dòng thuốc |
| `/api/v1/pharmacy/*` | Clinic Service | lô, tồn, cấp phát, reversal |
| `/api/v1/invoices/*` | Clinic Service | hóa đơn và dòng |
| `/api/v1/payments/*` | Clinic Service | thu, allocation, refund |
| `/api/v1/reports/*` | Clinic Service | báo cáo có filter và permission |
| `/api/v1/audit/*` | Clinic Service | audit search dành cho admin |
| `/health/live`, `/health/ready` | Mỗi process | health probe |

### 11.3 Quy trình sửa API

1. Sửa OpenAPI và example trước.
2. Chạy lint và breaking-change check.
3. Sinh lại client TypeScript.
4. Implement backend và contract test.
5. Implement frontend bằng generated client.
6. Không viết tay lại type đã có trong OpenAPI.

## 12. Database và migration

### 12.1 Nguồn dữ liệu hiện có

`quan_ly_phong_kham.sql` đã bao phủ:

- Chi nhánh, phòng, chuyên khoa, dịch vụ.
- User, role, permission, employee, doctor.
- Patient, người thân, dị ứng, bệnh nền và bảo hiểm.
- Ca làm, nghỉ, ngày lễ, slot và appointment.
- Encounter, queue, sinh hiệu, chẩn đoán, dịch vụ và result.
- Prescription, dispensation, batch, balance và inventory ledger.
- Invoice, payment, allocation, refund.
- Notification, outbox, idempotency và audit append-only.
- Command procedure, filtered index, trigger set-based và database role tối thiểu.

### 12.2 Quy tắc migration

- Baseline: `be/database/baseline/001_initial.sql`, chỉ dùng cho database mới.
- Migration: `NNN_yyyyMMdd_<mo_ta>.sql`, số tăng liên tục, không tái sử dụng.
- Mỗi migration phải idempotent ở mức kiểm tra trạng thái trước khi thay đổi hoặc fail rõ ràng nếu sai baseline.
- Stored procedure/view/trigger dùng `CREATE OR ALTER` khi phù hợp.
- DDL rủi ro phải có pre-check, backfill theo batch và post-check.
- Không xóa/đổi tên cột trong cùng release thêm cột thay thế. Dùng chiến lược expand → migrate → contract qua ít nhất hai release.
- Không dùng `MERGE` cho luồng concurrency quan trọng; ưu tiên `UPDATE` có khóa rồi `INSERT`.
- Full chain `baseline + toàn bộ migrations` phải cài được trên database trống; từng migration `002+` phải chạy được từ đúng version liền trước.
- CI phải lưu checksum và từ chối sửa migration đã phát hành.
- Rollback production ưu tiên forward-fix; backup/restore là kế hoạch khẩn cấp, không viết down migration giả an toàn.

### 12.3 Kết nối từ backend

- Mỗi command handler gọi đúng **một public command stored procedure**. Procedure tự `BEGIN/COMMIT/ROLLBACK`; Node không bọc bằng outer business transaction.
- Với command, reserve một connection từ pool và thực hiện `set SESSION_CONTEXT → EXEC procedure → clear SESSION_CONTEXT` trên chính connection đó. Dùng `TRY/CATCH/FINALLY`; clear cả khi procedure lỗi rồi mới trả connection về pool.
- Có thể đóng gói set/exec/clear trong cùng batch an toàn. Không set context bằng một pool request rồi gọi procedure bằng request khác.
- Audit và outbox phải do procedure ghi trong transaction domain; application không enqueue lần hai sau khi `EXEC` thành công.
- Chỉ mở Unit of Work ở Node nếu một migration tương lai chuyển các procedure liên quan sang hỗ trợ ambient transaction và đã có test rollback toàn luồng; đây không phải mặc định.
- Không truyền actor do client tự khai. `actor_user_id` phải lấy từ principal đã xác thực và đối chiếu với session context.
- API login là ngoại lệ pre-auth; chỉ Auth Service được quyền gọi procedure/query xác thực tối thiểu.
- Baseline hiện có role chung `clinic_api_executor`. Migration Phase 0 phải tách thành `clinic_auth_executor` và `clinic_core_executor`, chỉ `GRANT EXECUTE/SELECT` đúng ownership ở mục 4.3.
- Clinic tạo pool thứ hai bằng `clinic_report_reader` cho `/reports` và `/audit`; pool này chỉ gọi scoped read procedure. Không fallback sang mutation pool khi report lỗi quyền.
- Integration test phải thử cả ca được phép và bị từ chối ở cấp database; không chỉ test middleware HTTP.

## 13. Security và dữ liệu nhạy cảm

- Backend runtime không dùng `db_owner` hoặc tài khoản migration.
- Auth, Clinic, Worker và Reporting dùng login riêng: `clinic_auth_executor`, `clinic_core_executor`, `clinic_job_executor`, `clinic_report_reader`.
- Direct `INSERT/UPDATE/DELETE` vào schema nghiệp vụ bị từ chối; mutation đi qua command procedure.
- JWT phải kiểm tra issuer, audience, signature, expiry, token version và trạng thái user.
- Auth công bố JWKS qua Gateway, dùng `kid` và giữ key cũ trong thời gian access token còn hiệu lực khi rotation.
- Access token có TTL ngắn. Clinic xác minh chữ ký cục bộ, rồi lấy principal/token version từ `v_active_principal` với in-memory cache tối đa 60 giây; command nhạy cảm vẫn được stored procedure kiểm tra quyền/trạng thái hiện thời.
- Refresh token chỉ lưu hash; rotation phải phát hiện reuse và thu hồi token family.
- OTP/reset secret lưu hash trong challenge; delivery payload cần retry phải được mã hóa, TTL ngắn và xóa/cryptoshred sau gửi hoặc hết hạn. Outbox/log không chứa secret dạng rõ.
- Web ưu tiên cookie `HttpOnly`, `Secure`, `SameSite`; mobile dùng SecureStore.
- Endpoint web dùng cookie phải kiểm tra `Origin` và có CSRF protection phù hợp; CORS chỉ allow-list origin cấu hình, không dùng wildcard với credential.
- Rate limit riêng cho login, reset password, appointment booking và payment.
- Secret chỉ đến từ environment/secret store; không commit `.env`, key hoặc connection string.
- Log không ghi password, token, national ID đầy đủ, nội dung khám hoặc payload y tế không cần thiết.
- File upload kiểm tra kích thước, MIME thực, extension, hash và malware scan; storage key không dùng tên file người dùng.
- Audit hành vi thay đổi bắt buộc; audit đọc hồ sơ nhạy cảm thực hiện ở application layer.
- `PATIENTS_VIEW` theo branch không đủ cho hồ sơ lâm sàng: Doctor/Nurse chỉ đọc khi có care relationship hoặc encounter được phân công; Receptionist chỉ thấy dữ liệu hành chính; Patient/Guardian chỉ thấy hồ sơ có `user_patient_access` hợp lệ.
- Kết quả/đơn/hồ sơ chỉ hiện trên Mobile sau trạng thái công bố rõ ràng (`releasedToPatient` và thời điểm/người công bố); không đồng nhất `FINAL` nội bộ với đã công bố cho bệnh nhân.
- Break-glass mặc định tắt. Khi bật phải bắt nhập lý do, giới hạn thời gian, cảnh báo người giám sát và audit cả lần đọc; không chỉ dựa vào role Doctor.
- Bật TLS, backup mã hóa và chính sách retention phù hợp sau khi được chủ dự án/pháp lý phê duyệt.
- Quy định pháp lý và thời hạn lưu hồ sơ phải được xác nhận riêng trước khi production; không suy đoán trong code.

## 14. Outbox, notification và worker

Danh sách event mục tiêu cho MVP/P1 dưới đây là contract cần triển khai. Baseline hiện mới ghi `APPOINTMENT_CREATED`; tất cả event còn lại cần migration/procedure và test bảo đảm được ghi cùng transaction nghiệp vụ.

Envelope bắt buộc, được version từ đầu:

```json
{
  "eventId": "uuid",
  "eventType": "APPOINTMENT_CREATED",
  "schemaVersion": 1,
  "producer": "clinic-service",
  "aggregateType": "appointment",
  "aggregateId": "public-uuid",
  "occurredAt": "2026-09-09T12:00:00Z",
  "correlationId": "uuid",
  "causationId": "uuid-or-null",
  "payload": {}
}
```

Worker idempotent theo `eventId`. Thêm field tương thích được giữ cùng version; đổi nghĩa/xóa field phải tăng `schemaVersion` và duy trì handler cũ trong thời gian chuyển tiếp.

Các event mục tiêu:

- `AUTH_OTP_DELIVERY_REQUESTED`
- `PASSWORD_RESET_DELIVERY_REQUESTED`
- `MFA_CHALLENGE_DELIVERY_REQUESTED`
- `APPOINTMENT_CREATED`
- `APPOINTMENT_CONFIRMED`
- `APPOINTMENT_RESCHEDULED`
- `APPOINTMENT_CANCELLED`
- `APPOINTMENT_REMINDER_DUE`
- `ENCOUNTER_COMPLETED`
- `ENCOUNTER_SIGNED`
- `PRESCRIPTION_ISSUED`
- `PRESCRIPTION_EXPIRED`
- `DISPENSATION_COMPLETED`
- `INVOICE_ISSUED`
- `PAYMENT_SUCCEEDED`
- `PAYMENT_REFUNDED`
- `LOW_STOCK_DETECTED`
- `BATCH_EXPIRING`

Worker jobs:

| Job | Chu kỳ gợi ý | Bất biến |
|---|---|---|
| Expire appointment holds | 1 phút | Idempotent, dùng permission hệ thống |
| Generate appointment slots | Hằng ngày/on demand | Không tạo slot trùng/chồng |
| Appointment reminders | 5 phút | Mỗi template/lịch/mốc chỉ gửi một lần |
| Publish outbox | Liên tục theo batch | Claim bằng lease, retry exponential, dead-letter |
| Deliver auth notification | Gần realtime | Không log OTP/token; kiểm tra TTL, dedupe và rate limit trước khi gửi |
| Low-stock scan | Hằng giờ/ngày | Không tạo cảnh báo trùng chưa xử lý |
| Medicine-batch expiry scan | Hằng ngày | Tính theo business date chi nhánh |
| Expire prescriptions | Hằng giờ/đầu ngày | Transition idempotent, lưu `EXPIRED` và audit trước khi từ chối cấp |
| Reconciliation | Hằng ngày | Báo lỗi, không tự sửa ledger |
| Cleanup sessions/idempotency | Hằng ngày | Không xóa dữ liệu còn hiệu lực/audit |

Mỗi worker instance phải có `workerId`, lease expiry và heartbeat. Không dùng `setInterval` đơn giản cho job quan trọng nếu có nhiều instance.

Riêng job sinh slot chưa được chạy bằng `clinic_job_executor` của baseline vì `sp_generate_doctor_slots` còn yêu cầu actor có `SCHEDULES_MANAGE`. Phase 0 phải tạo system command/audit phù hợp và chỉ cấp đúng quyền cần thiết trước khi bật job tự động.

## 15. Chiến lược kiểm thử

### 15.1 Test pyramid

| Lớp | Nội dung | Chạy khi nào |
|---|---|---|
| Unit | Validation, mapper, policy, state transition thuần | Mỗi commit |
| Repository integration | SQL thật, procedure, transaction và mapping | Mỗi pull request |
| API integration | Express + SQL Server + auth/permission | Mỗi pull request |
| Contract | OpenAPI response/request và breaking change | Mỗi pull request |
| Component | Form, table, permission visibility | Mỗi pull request |
| E2E | Critical journey Admin Web/Mobile | Pull request chính và release |
| Concurrency | Double appointment booking, queue, dispense, payment/refund | Nightly và release |
| Performance | Search slot, queue dashboard, patient history | Trước production/release lớn |
| Security | Dependency scan, secret scan, authz negative cases | CI và định kỳ |

### 15.2 Critical journeys bắt buộc

1. Admin bootstrap → tạo bác sĩ/lễ tân/dược sĩ/thu ngân → gán branch role.
2. Tạo patient → tạo portal account → liên kết SELF/người thân.
3. Sinh slot → đặt online → retry → xác nhận → đổi/hủy.
4. Check-in appointment → phát số → gọi → bắt đầu → hoàn tất.
5. Walk-in → queue → khám → chẩn đoán → `COMPLETED` → ký.
6. Kê đơn → nhập kho → cấp một phần/đủ → reversal → đối soát.
7. Đồng bộ hóa đơn → phát hành → thanh toán một phần/đủ → refund → VOID.
8. Sau ký, thử sửa từng bảng con và phải thất bại.
9. API user thử DML trực tiếp và phải bị từ chối nhưng vẫn chạy được procedure đã grant.
10. LAB_TECH không ghi được sinh hiệu; NURSE không chốt được kết quả; Receptionist không có quyền quản trị user rộng.
11. Mỗi field nằm trong canonical signing manifest khi thay đổi phải làm hash thay đổi; field ngoài manifest phải được giải thích rõ.
12. Worker login chỉ chạy được system procedure đã cấp và không chạy được command của Admin/API.
13. Ký hồ sơ → cấp/đảo thuốc → recompute vẫn xác minh đúng chữ ký đã lưu.
14. Mở cấp phát cho đơn quá hạn phải lưu `EXPIRED` và audit dù command từ chối cấp.
15. Không thể phát hành invoice khi còn dịch vụ/dispensation dở hoặc billable item chưa đồng bộ.
16. Patient không xem được hồ sơ chưa liên kết/kết quả chưa công bố; Receptionist không đọc nội dung lâm sàng.
17. Availability không lộ bác sĩ tắt online; patient không thể reschedule để né cancellation deadline.
18. Manager/Cashier/Pharmacist chỉ xem đúng report và branch được cấp.
19. Hủy sau check-in chỉ qua encounter command và cập nhật appointment/encounter/queue nguyên tử; complete cũng không để ba aggregate lệch trạng thái.
20. API report/audit dùng read-only pool; login mutation không thể dùng pool này và report login không thể chạy command mutation.
21. Thu hồi Admin toàn cục cuối cùng và tự thu hồi trái policy phải thất bại.
22. Role inactive/hết hạn không được coi là staff để bypass cancellation deadline hay branch scope.
23. Không thể start encounter có ticket còn `WAITING`; override hợp lệ phải có reason/audit.
24. Không thể finalize service result khi mọi nội dung/kết quả đều rỗng hoặc sai schema.
25. Reversal của lô hết hạn/thu hồi không thể vào vị trí `SELLABLE`.
26. Direct UPDATE/DELETE payment/refund đã chốt phải thất bại; reversal hợp lệ vẫn đối soát đúng.
27. Hai update dùng cùng ETag: request đầu thành công, request stale còn lại trả conflict.

### 15.3 Test concurrency bắt buộc

- Hai request đặt cùng slot: đúng một request thành công.
- Một patient đặt hai slot chồng giờ: đúng một request thành công.
- Hai request gọi queue next: không lấy cùng ticket.
- Hai request cấp cùng lượng tồn cuối: tồn không âm.
- Hai request cấp hai batch cho cùng prescription item: tổng không vượt lượng kê.
- Hai request thu toàn bộ cùng invoice: tổng thu không vượt dư nợ.
- Hai request refund cùng allocation: tổng hoàn không vượt allocation.
- Hoàn tất dịch vụ/cấp thuốc đồng thời với phát hành invoice: hoặc dòng được khóa và tính đủ, hoặc issuance bị conflict; không bỏ sót charge.
- Retry cùng idempotency key và payload trả cùng ID; khác payload trả conflict.

## 16. Quan sát hệ thống và vận hành

Mọi log HTTP cần có:

- `timestamp`
- `level`
- `service`
- `environment`
- `requestId`
- `traceId` nếu có
- `route`
- `method`
- `statusCode`
- `durationMs`
- `actorUserId` và `branchId` khi phù hợp
- `errorCode`, không log dữ liệu nhạy cảm

Metrics tối thiểu:

- Request rate/error/latency theo route.
- SQL pool active/wait/error và thời gian gọi procedure.
- Appointment booking success/conflict/expired hold.
- Queue length và thời gian chờ.
- Outbox pending/retry/dead-letter.
- Notification success/failure.
- Stock reconciliation mismatch.
- Payment/refund success/failure.

Health readiness phải kiểm tra dependency cần thiết nhưng có timeout ngắn; liveness không phụ thuộc SQL để tránh restart dây chuyền khi database tạm chậm.

## 17. Roadmap triển khai

Ước lượng theo sprint 1–2 tuần; điều chỉnh theo số người nhưng không đổi thứ tự dependency.

| Phase | Phạm vi | Kết quả đầu ra | Điều kiện hoàn thành |
|---|---|---|---|
| 0. Architecture & baseline freeze | Monorepo, ADR, ownership, P0 database defects, public IDs | Baseline có checksum, ownership manifest, cấu trúc và scripts | Clean install/upgrade, least-privilege, workflow và defect regression đều đạt |
| 1. Platform foundation | Gateway, service skeleton, config, logging, SQL pool, OpenAPI | Health endpoints và request ID xuyên suốt | CI lint/typecheck/unit/build xanh |
| 2. Auth, Workforce & RBAC | Login/refresh/logout, user, employee/doctor, role/permission, patient link, delivery OTP tối thiểu | Admin đăng nhập/quản lý nhân sự; patient đăng ký và nhận OTP | Token revocation, OTP delivery/replay và authz negative test đạt |
| 3. Catalog & Patient | Branch/room/service/doctor directory, branch pricing, patient và read policy | Admin vận hành danh mục/hồ sơ; Clinic đọc workforce qua contract | Search/dedupe/care-relationship access test đạt |
| 4. Scheduling & Appointments | Ca, nghỉ, slot, availability, online/counter appointment booking | Patient đặt được lịch end-to-end | Double-booking/idempotency test đạt |
| 5. Reception & Queue | Check-in, walk-in, ticket, call next | Quầy tiếp nhận dùng được | Concurrent call-next test đạt |
| 6. Clinical | Vitals, diagnosis, service order/result, complete/sign/amend | Bác sĩ hoàn tất hồ sơ | Immutability và signature test đạt |
| 7. Prescription & Pharmacy | Medicine, batch, receipt, dispense, reversal | Nhà thuốc vận hành được | FEFO/double-dispense/reconciliation đạt |
| 8. Billing | Invoice completeness gate, payment, refund, print | Thu ngân vận hành được, không bỏ sót charge | Issue-race, double-pay/refund/VOID test đạt |
| 9. Notification & Reports | Outbox worker, reminder, dashboard, export | Hệ thống chủ động và có báo cáo | Retry/dead-letter/report permission đạt |
| 10. Hardening & Release | Security, performance, backup, monitoring, UAT | Release candidate | UAT, restore drill và release checklist đạt |

### 17.1 Thứ tự ưu tiên trong mỗi phase

1. Domain rule và OpenAPI contract.
2. Database migration/procedure.
3. Repository và service.
4. API integration test.
5. Generated client.
6. Admin/Mobile UI.
7. E2E và tài liệu vận hành.

Không xây toàn bộ backend rồi mới làm frontend. Mỗi phase phải tạo một lát cắt dọc có thể demo và kiểm thử.

## 18. Definition of Done

Một chức năng chỉ được coi là hoàn thành khi:

- Acceptance criteria và state transition đã rõ.
- Permission và branch/patient scope đã kiểm tra ở backend.
- OpenAPI có request, response, error code và example.
- Database change dùng migration mới, có pre/post-check.
- Không có SQL nối chuỗi từ input; mọi tham số được bind.
- Có unit/integration test cho happy path và ít nhất một negative path.
- Có concurrency/idempotency test nếu chức năng giữ tài nguyên hoặc tiền/tồn.
- Audit và outbox được ghi trong cùng transaction nếu cần.
- UI có loading, empty, validation, forbidden, conflict và retry state.
- Không log dữ liệu nhạy cảm.
- Lint, typecheck, test, build và OpenAPI breaking check đều xanh.
- README/implementation status được cập nhật.
- Không có TODO chặn nghiệp vụ trong code production.

## 19. Tài liệu cần duy trì

| File | Mục đích |
|---|---|
| `README.md` | Cài đặt, chạy local, test và troubleshooting cơ bản |
| `PROJECT_PLAN.md` | Kiến trúc, chức năng, roadmap và nguyên tắc ổn định |
| `AGENTS.md` | Quy tắc cho coding agent khi sửa repo |
| `be/README.md` | Tổng quan backend, port, package và API hiện có |
| `be/BACKEND_PLAN.md` | Kế hoạch kỹ thuật chi tiết backend |
| `be/IMPLEMENTATION_STATUS.md` | Thực tế đã xong/chưa xong, test đã đạt và bước kế tiếp |
| `be/database/README.md` | Schema, migration, procedure, seed và cách kiểm thử SQL |
| `be/contracts/openapi/README.md` | Quy trình sửa contract, sinh client và breaking check |
| `docs/domain/state-machines.md` | State machine và transition table chi tiết |
| `docs/security/threat-model.md` | Threat model, trust boundary và kiểm soát |
| `docs/testing/test-matrix.md` | Traceability từ chức năng đến test |
| `docs/operations/runbook.md` | Backup/restore, incident, job và outbox runbook |
| `docs/adr/NNNN-*.md` | Quyết định kiến trúc không nên sửa âm thầm |

Thứ tự ưu tiên khi tài liệu lệch nhau:

```text
Database migration + source code + OpenAPI
    → automated tests
    → IMPLEMENTATION_STATUS.md
    → README.md
    → PROJECT_PLAN.md/BACKEND_PLAN.md
```

Mọi phát hiện lệch tài liệu phải được sửa trong cùng pull request.

## 20. Quy tắc tránh phải sửa lại cấu trúc

1. Tạo module theo domain ngay khi có use case đầu tiên; không chia theo kiểu `controllers/`, `services/`, `repositories/` toàn dự án.
2. Mỗi module có public `index.ts`; cấm import deep path giữa module.
3. Không tạo `utils.ts` khổng lồ; tên file phải thể hiện trách nhiệm.
4. Không dùng enum viết tay ở nhiều nơi; sinh từ OpenAPI hoặc export từ một contract package.
5. Không đưa business rule vào component, controller, Gateway hoặc Worker scheduler.
6. Không cho frontend phụ thuộc trực tiếp tên bảng/cột SQL.
7. Không trả raw database row; luôn map sang DTO.
8. Không đổi URL do tách service; Gateway giữ contract công khai.
9. Không sửa migration đã release; luôn thêm migration mới.
10. Không xóa field API ngay; đánh dấu deprecated, theo dõi usage rồi loại ở version kế tiếp.
11. Không tạo shared abstraction trước khi có ít nhất hai trường hợp thật sự giống nhau.
12. Không thêm message broker, cache phân tán hoặc search engine trước khi có số liệu chứng minh nhu cầu.
13. Không bỏ qua test concurrency cho slot, queue, inventory và payment.
14. Không dùng flag `isAdmin` rải rác; kiểm tra permission code và scope.
15. Không tin `actorUserId`, `branchId`, giá tiền hoặc status do client tự gửi nếu backend có thể suy ra.
16. Không lưu thời gian địa phương vào trường UTC; tách `serviceDateLocal` khi nghiệp vụ cần.
17. Không dùng hard delete cho hồ sơ y tế, ledger tài chính, tồn kho và audit.
18. Không tạo thêm service chỉ vì có thêm module; chỉ tách khi có ADR về tải, bảo mật hoặc ownership đội ngũ.

## 21. Checklist khởi động dự án

### Phase 0

- [ ] Khởi tạo Git và branch protection.
- [ ] Tạo npm workspace/orchestrator ở root.
- [ ] Tạo đúng cấu trúc thư mục mục 6.
- [ ] Tạo và kiểm tra `be/database/ownership.yml` cho mọi bảng/view/57 procedure và database role.
- [ ] Sửa nhóm P0 ảnh hưởng baseline/foundation được nêu dưới mục 8.12; tạo owner/milestone cho mọi P0 còn lại trước phase domain tương ứng.
- [ ] Chạy clean install, workflow, negative, concurrency, signature-recompute và `DBCC CHECKDB`; tất cả đạt mới freeze.
- [ ] Chuyển SQL đã sửa vào `be/database/baseline/001_initial.sql` và ghi checksum.
- [ ] Tạo `schema_migrations` và script apply migration.
- [ ] Tạo `.editorconfig`, ESLint, Prettier, TypeScript strict và naming rules.
- [ ] Tạo `.env.example`, secret policy và `.gitignore` cho `.runtime/`.
- [ ] Tạo CI: lint, typecheck, unit, build, OpenAPI lint, SQL clean install, upgrade chain và least-privilege test.
- [ ] Viết ADR-0001 cho kiến trúc Gateway + Auth + Clinic modular monolith.
- [ ] Viết ADR-0002 cho OpenAPI-first và generated client.
- [ ] Viết ADR-0003 cho database procedure/migration strategy.

### Phase 1

- [ ] Scaffold Ocelot Gateway với route `/api/v1/auth/*` và `/api/v1/*`.
- [ ] Scaffold Auth Service và Clinic Service bằng cùng TypeScript config.
- [ ] Scaffold Scheduler Worker.
- [ ] Cài structured logger và request ID end-to-end.
- [ ] Cài SQL pool, reserved-connection command runner và session-context set/exec/clear helper.
- [ ] Tạo standard error/result envelope.
- [ ] Tạo OpenAPI root, lint, `generated-api-types` và `generated-api-client`.
- [ ] Scaffold Admin Web với router, provider và generated client.
- [ ] Scaffold Mobile với React Navigation, SecureStore và generated client.
- [ ] Tạo health endpoints và local launcher scripts.

## 22. Tiêu chí MVP cuối cùng

MVP được xem là có thể bàn giao khi một phòng khám có thể thực hiện trọn vẹn các luồng sau mà không truy cập trực tiếp database:

1. Admin tạo nhân viên, bác sĩ và phân quyền theo chi nhánh.
2. Lễ tân tạo bệnh nhân, đặt lịch tại quầy hoặc tiếp nhận walk-in.
3. Bệnh nhân tự đăng ký/xác minh hoặc dùng tài khoản được nhân viên liên kết, rồi đặt/xem/đổi/hủy lịch cho hồ sơ được phép.
4. Lễ tân check-in, phát số; bác sĩ gọi, khám, chẩn đoán, kê đơn, hoàn tất và ký.
5. Dược sĩ nhập kho, cấp thuốc theo đơn và đối soát tồn.
6. Thu ngân phát hành hóa đơn, thu và hoàn tiền đúng quy tắc.
7. Worker hết hạn giữ chỗ, gửi reminder và xử lý outbox.
8. Manager xem dashboard vận hành, doanh thu thu ròng và cảnh báo tồn.
9. Audit truy được ai làm gì, lúc nào, tại chi nhánh nào và từ request nào.
10. Backup có thể restore; critical E2E và concurrency test đều đạt.

---

Khi bắt đầu code, ưu tiên triển khai Phase 0 và Phase 1 trước. Không tạo màn hình CRUD hàng loạt trước khi auth, OpenAPI, error contract, permission scope, stored-procedure command runner và cấu trúc feature/module đã ổn định.

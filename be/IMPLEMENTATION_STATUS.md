# Trạng thái triển khai backend

> Cập nhật: 2026-09-10

## DONE — Slice 01: Platform Foundation

Phạm vi đã hoàn thành và kiểm thử:

- Ocelot Gateway route Auth/Clinic, live health và aggregated readiness.
- Auth Service, Clinic Service, Scheduler Worker và launcher tại root.
- Pino JSON logging; `x-request-id` được validate, propagate và echo xuyên Gateway.
- Success/error envelope đúng `PROJECT_PLAN.md` mục 11.1.
- Pool SQL Server cho từng service; hỗ trợ SQL login và Windows Authentication.
- Reserved-connection command runner dùng transaction và set/clear `SESSION_CONTEXT`.
- OpenAPI 3.1 được Redocly lint; types và fetch SDK được sinh bằng Hey API.
- Admin Web và Mobile tham chiếu package API client; Mobile token dùng SecureStore.
- Integration test cho live/ready, request ID, SQL unavailable và 404.
- CI Windows chạy OpenAPI check, lint, typecheck, test, build và Expo Doctor.

### Bằng chứng xác minh local

| Kiểm tra | Kết quả |
|---|---|
| `npm run openapi:lint` | Đạt |
| `npm run lint` | Đạt |
| `npm run typecheck` | Đạt |
| `npm test` | 6 test đạt |
| `npm run build` | Đạt; .NET 0 warning/0 error |
| `npm run doctor:mobile` | 21/21 |
| Gateway `/health/live` | HTTP 200 |
| Gateway `/health/ready` | HTTP 200; Auth/Clinic up |
| Auth/Clinic `/health/ready` | HTTP 200; `PrivateClinicManagement` up |
| Request ID qua hai route proxy | Giữ nguyên UUID `74ed3a7b-d580-448a-8570-22cb2345c6be` |

## Chưa hoàn thành

- Phase 0 database baseline freeze, ownership/GRANT, public IDs và các defect P0.
- SQL integration test cho command mutation sẽ bổ sung cùng command nghiệp vụ đầu tiên.
- Branch protection và lần chạy GitHub Actions chỉ xác minh được sau khi push.
- Auth/RBAC nghiệp vụ bắt đầu ở Slice 02 sau khi dependency Phase 0 tương ứng hoàn tất.

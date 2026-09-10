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

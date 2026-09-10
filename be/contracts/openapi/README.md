# OpenAPI workflow

1. Sửa `openapi.yaml` trước khi sửa public API.
2. Chạy `npm run openapi:lint`.
3. Chạy `npm run openapi:generate` để cập nhật types và fetch SDK.
4. Chạy `npm run openapi:check` trước commit; lệnh thất bại nếu generated code lệch contract.

Không sửa trực tiếp file trong thư mục `src/generated` vì lần sinh kế tiếp sẽ ghi đè.

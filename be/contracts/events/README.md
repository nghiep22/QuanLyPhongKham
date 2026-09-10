# Event contracts

Mỗi sự kiện nghiệp vụ phải có tên phiên bản (`appointment.booked.v1`), schema JSON,
khóa idempotency và thông tin truy vết. Chưa phát sự kiện thật cho đến khi Outbox
và worker được cài đặt theo `PROJECT_PLAN.md`.

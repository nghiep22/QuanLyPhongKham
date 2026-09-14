# Database

File SQL hiện tại nằm ở thư mục gốc: `../../quan_ly_phong_kham.sql`.

Đây là baseline cần xử lý các mục P0 trong `PROJECT_PLAN.md` trước khi đóng băng
thành migration `V001`. Không sửa trực tiếp database production; mọi thay đổi sau
baseline phải là migration tăng dần và có script rollback phù hợp.

Chạy baseline và các regression test trên SQL Server:

```powershell
sqlcmd -S localhost -E -C -b -i ..\..\quan_ly_phong_kham.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\auth-session.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\staff-rbac.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\staff-safety.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\password-lifecycle.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\patient-registration.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\patient-link.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\catalog-directory.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\patient-registry.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\scheduling-appointments.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\reception-queue.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\clinical-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\pharmacy-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\pharmacy-fefo.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\pharmacy-allergy.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\billing-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\reports-core.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\tests\notifications-outbox.test.sql
.\tests\reception-queue.concurrent.ps1
.\tests\billing-payment.concurrent.ps1
```

Mọi test dùng transaction và rollback; không để lại tài khoản, session hoặc
password reset/patient registration challenge hoặc patient link thử nghiệm.
Các harness concurrency tạo rồi xóa đúng dữ liệu fixture của chúng; audit record
queue và billing được giữ lại vì audit log là append-only theo thiết kế.

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
```

Mọi test dùng transaction và rollback; không để lại tài khoản, session hoặc
password reset challenge thử nghiệm.

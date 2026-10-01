# Bảng dữ liệu và seed phát triển

Schema hiện có **74 bảng `dbo`**. Backend truy cập phần lớn bảng qua stored procedure và view trong `quan_ly_phong_kham.sql`; ứng dụng web/mobile gọi API tương ứng. Số lượng không cần bằng nhau: bảng danh mục ít, bệnh nhân và thuốc nhiều hơn; bảng lịch sử và hệ thống sinh theo thao tác, không chèn hàng loạt chỉ để đạt chỉ tiêu.

| Luồng | Bảng chính |
| --- | --- |
| Cơ sở và danh mục | `branches`, `rooms`, `specialties`, `service_categories`, `services`, `service_branch_prices` |
| Tài khoản và nhân sự | `roles`, `permissions`, `users`, `user_roles`, `role_permissions`, `user_sessions`, `password_reset_challenges`, `patient_registration_challenges`, `employees`, `doctors`, `doctor_branch_assignments`, `doctor_specialties`, `doctor_services` |
| Hồ sơ bệnh nhân | `patients`, `patient_merge_history`, `user_patient_access`, `patient_access_requests`, `patient_emergency_contacts`, `allergens`, `patient_allergies`, `patient_conditions`, `insurance_providers`, `patient_insurances` |
| Lịch bác sĩ và đặt khám | `doctor_working_schedules`, `doctor_schedule_breaks`, `doctor_time_off`, `clinic_holidays`, `appointment_slots`, `appointments`, `appointment_status_history`, `appointment_reschedule_history` |
| Tiếp nhận và khám bệnh | `queue_sessions`, `queue_tickets`, `encounters`, `encounter_staff_assignments`, `encounter_vital_signs`, `diagnosis_catalog`, `encounter_diagnoses`, `encounter_services`, `service_results`, `service_result_values`, `medical_attachments`, `encounter_signatures`, `clinical_record_releases`, `encounter_amendments` |
| Nhà thuốc | `suppliers`, `inventory_locations`, `medicines`, `medicine_allergens`, `medicine_batches`, `inventory_balances`, `prescriptions`, `prescription_items`, `dispensations`, `dispensation_items`, `inventory_movements`, `dispensation_item_reversals` |
| Thu ngân | `document_sequences`, `invoices`, `invoice_items`, `payments`, `payment_allocations`, `payment_refunds`, `refund_allocations` |
| Gửi thông báo và kiểm soát | `notifications`, `outbox_events`, `idempotency_requests`, `audit_logs` |

## Dữ liệu minh họa mới

`seeds/clinic-showcase-data.sql` thêm dữ liệu **giả lập** có tên dễ đọc trên chi nhánh `MAIN`:

| Nhóm | Số bản ghi |
| --- | ---: |
| Chuyên khoa | 5 |
| Phòng khám, bác sĩ, nhân viên bác sĩ | 10 mỗi bảng |
| Dịch vụ và giá theo chi nhánh | 20 mỗi bảng |
| Bệnh nhân | 30 |
| Thuốc gốc, lô, tồn tại quầy và phiếu nhập đầu kỳ | 40 mỗi bảng |
| Slot đặt khám | 30 cho ngày thứ Hai trong tương lai |
| Lịch hẹn đã xác nhận | 20 |

Các bảng liên kết như `doctor_specialties`, `doctor_services`, `medicine_allergens` và lịch sử trạng thái lịch hẹn được tạo cùng dữ liệu gốc. Tài khoản bác sĩ dùng tên hiển thị để thử giao diện nhưng không có mật khẩu được công bố. Bệnh nhân không có căn cước, số điện thoại hoặc email giả. Thuốc là tên hoạt chất thông dụng để thử danh mục; giá và tồn là số giả lập, không có số đăng ký hoặc nhà sản xuất giả.

Seed dùng mã `D26-` và chạy trong một transaction. Khi chạy lại, script kiểm tra khóa tự nhiên để không nhân đôi. Script `tests/clinic-showcase-seed.test.sql` chạy hai lần trong transaction rồi rollback để kiểm tra ràng buộc và tính idempotent. Bộ `S3-` cũ phục vụ kiểm thử toàn bộ 74 bảng vẫn là dữ liệu giả lập riêng, bao gồm đơn thuốc, cấp phát, đảo cấp phát và hóa đơn; không dùng chúng làm hồ sơ người bệnh thực.

```powershell
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -f 65001 -i .\be\database\tests\clinic-showcase-seed.test.sql
sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -f 65001 -i .\be\database\seeds\clinic-showcase-data.sql
```

Đối chiếu số dòng thực tế trên SQL Server:

```sql
SELECT t.name AS table_name, SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
WHERE SCHEMA_NAME(t.schema_id)='dbo'
GROUP BY t.name ORDER BY t.name;
```

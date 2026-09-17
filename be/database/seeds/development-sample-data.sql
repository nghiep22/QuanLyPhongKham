/*
  Development-only sample data.

  Purpose:
  - add three coherent examples to every dbo table in the baseline schema;
  - keep security/transient examples inert (disabled users, revoked sessions,
    expired challenges, published outbox events and sent notifications);
  - remain idempotent through the SAMPLE3/S3 natural-key prefix.

  Prerequisite: run quan_ly_phong_kham.sql first.
  Run: sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -i .\be\database\seeds\development-sample-data.sql
*/

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF DB_NAME() <> N'PrivateClinicManagement'
    THROW 54000, N'Script sample chỉ được chạy trong database PrivateClinicManagement.', 1;

IF OBJECT_ID(N'dbo.branches', N'U') IS NULL
    THROW 54001, N'Chưa có schema. Hãy chạy quan_ly_phong_kham.sql trước.', 1;

DECLARE @dry_run bit = 0;

IF EXISTS (SELECT 1 FROM dbo.branches WHERE branch_code = 'S3-BR-1')
BEGIN
    INSERT dbo.service_branch_prices
        (branch_id,service_id,price_amount,currency_code,effective_from,is_available)
    SELECT b.branch_id,s.service_id,s.current_price,'VND',CONVERT(date,'20200101'),1
    FROM dbo.branches b
    CROSS JOIN dbo.services s
    WHERE b.branch_code LIKE 'S3-BR-%' AND s.service_code LIKE 'S3-SERVICE-%'
      AND NOT EXISTS
      (
          SELECT 1 FROM dbo.service_branch_prices sbp
          WHERE sbp.branch_id=b.branch_id AND sbp.service_id=s.service_id
      );

    INSERT dbo.doctor_services(doctor_id,service_id,custom_duration_min,is_active)
    SELECT d.doctor_id,s.service_id,30,1
    FROM dbo.doctors d
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    CROSS JOIN dbo.services s
    WHERE e.employee_code LIKE 'S3-EMP-%' AND s.service_code LIKE 'S3-SERVICE-%'
      AND NOT EXISTS
      (
          SELECT 1 FROM dbo.doctor_services ds
          WHERE ds.doctor_id=d.doctor_id AND ds.service_id=s.service_id
      );

    PRINT N'Bộ dữ liệu SAMPLE3 đã tồn tại; đã đồng bộ lại dịch vụ cho chi nhánh và bác sĩ.';
    GOTO VerifySeed;
END;

DECLARE @today date = CONVERT(date, GETDATE());
DECLARE @next_monday date = DATEADD(day,
    ((7 - (DATEDIFF(day, CONVERT(date,'19000101'), @today) % 7)) % 7) + 14,
    @today);
DECLARE @clinical_monday date = DATEADD(day,
    -14 - (DATEDIFF(day, CONVERT(date,'19000101'), @today) % 7),
    @today);

DECLARE @cases TABLE
(
    case_no                  int PRIMARY KEY,
    branch_id                bigint NULL,
    room_id                  bigint NULL,
    specialty_id             bigint NULL,
    category_id              bigint NULL,
    service_id               bigint NULL,
    sample_role_id           bigint NULL,
    sample_permission_id     bigint NULL,
    doctor_user_id           bigint NULL,
    patient_user_id          bigint NULL,
    employee_id              bigint NULL,
    doctor_id                bigint NULL,
    patient_id               bigint NULL,
    allergen_id              bigint NULL,
    insurance_provider_id    bigint NULL,
    supplier_id              bigint NULL,
    inventory_location_id    bigint NULL,
    medicine_id              bigint NULL,
    medicine_batch_id        bigint NULL,
    working_schedule_id      bigint NULL,
    old_slot_id              bigint NULL,
    new_slot_id              bigint NULL,
    appointment_id           bigint NULL,
    queue_session_id         bigint NULL,
    encounter_id             bigint NULL,
    diagnosis_catalog_id     bigint NULL,
    encounter_service_id     bigint NULL,
    service_result_id        bigint NULL,
    prescription_id          bigint NULL,
    prescription_item_id     bigint NULL,
    dispensation_id          bigint NULL,
    dispensation_item_id     bigint NULL,
    dispense_movement_id     bigint NULL,
    reversal_movement_id     bigint NULL,
    invoice_id               bigint NULL,
    payment_id               bigint NULL,
    payment_allocation_id    bigint NULL,
    payment_refund_id        bigint NULL
);

INSERT @cases(case_no) VALUES (1),(2),(3);

BEGIN TRY
    BEGIN TRANSACTION;

    /* Catalog */
    INSERT dbo.branches
        (branch_code,branch_name,medical_license_no,phone,email,address_line,ward,district,province,
         timezone_name,booking_horizon_days,online_hold_minutes,cancellation_deadline_minutes,
         check_in_early_minutes,check_in_late_minutes,is_active)
    SELECT CONCAT('S3-BR-',case_no), CONCAT(N'Cơ sở mẫu ',case_no), CONCAT(N'GPM-S3-',case_no),
           CONCAT('02873000',RIGHT(CONCAT('00',case_no),2)), CONCAT('sample3.branch',case_no,'@example.test'),
           CONCAT(N'Địa chỉ cơ sở mẫu ',case_no),N'Phường mẫu',N'Quận mẫu',N'TP. Hồ Chí Minh',
           N'SE Asia Standard Time',60,15,120,120,180,1
    FROM @cases;

    UPDATE c SET branch_id=b.branch_id
    FROM @cases c JOIN dbo.branches b ON b.branch_code=CONCAT('S3-BR-',c.case_no);

    INSERT dbo.rooms(branch_id,room_code,room_name,room_type,floor_no,capacity,is_active)
    SELECT branch_id,CONCAT('S3-CONSULT-',case_no),CONCAT(N'Phòng khám mẫu ',case_no),
           'CONSULTATION',case_no,1,1
    FROM @cases;

    UPDATE c SET room_id=r.room_id
    FROM @cases c JOIN dbo.rooms r
      ON r.branch_id=c.branch_id AND r.room_code=CONCAT('S3-CONSULT-',c.case_no);

    INSERT dbo.specialties(specialty_code,specialty_name,description,is_active)
    SELECT CONCAT('S3-SPECIALTY-',case_no),CONCAT(N'Chuyên khoa mẫu ',case_no),
           CONCAT(N'Mô tả chuyên khoa mẫu ',case_no),1
    FROM @cases;

    UPDATE c SET specialty_id=s.specialty_id
    FROM @cases c JOIN dbo.specialties s ON s.specialty_code=CONCAT('S3-SPECIALTY-',c.case_no);

    INSERT dbo.service_categories(category_code,category_name,display_order,is_active)
    SELECT CONCAT('S3-CATEGORY-',case_no),CONCAT(N'Nhóm dịch vụ mẫu ',case_no),100+case_no,1
    FROM @cases;

    UPDATE c SET category_id=sc.service_category_id
    FROM @cases c JOIN dbo.service_categories sc ON sc.category_code=CONCAT('S3-CATEGORY-',c.case_no);

    INSERT dbo.services
        (service_category_id,specialty_id,service_code,service_name,service_type,
         default_duration_min,current_price,requires_doctor,result_schema_json,is_active)
    SELECT category_id,specialty_id,CONCAT('S3-SERVICE-',case_no),CONCAT(N'Dịch vụ khám mẫu ',case_no),
           'CONSULTATION',30,100000+(case_no*50000),1,
           N'{"type":"object","properties":{"note":{"type":"string"}}}',1
    FROM @cases;

    UPDATE c SET service_id=s.service_id
    FROM @cases c JOIN dbo.services s ON s.service_code=CONCAT('S3-SERVICE-',c.case_no);

    INSERT dbo.service_branch_prices
        (branch_id,service_id,price_amount,currency_code,effective_from,is_available)
    SELECT b.branch_id,s.service_id,s.current_price,'VND',CONVERT(date,'20200101'),1
    FROM @cases b CROSS JOIN @cases c
    JOIN dbo.services s ON s.service_id=c.service_id;

    /* Security reference rows plus inert identities. */
    INSERT dbo.roles(role_code,role_name,description,is_system,is_active)
    SELECT CONCAT('SAMPLE3_ROLE_',case_no),CONCAT(N'Vai trò mẫu ',case_no),N'Chỉ dùng cho development seed',0,1
    FROM @cases;

    UPDATE c SET sample_role_id=r.role_id
    FROM @cases c JOIN dbo.roles r ON r.role_code=CONCAT('SAMPLE3_ROLE_',c.case_no);

    INSERT dbo.permissions(permission_code,permission_name,module_code,description)
    SELECT CONCAT('SAMPLE3_PERMISSION_',case_no),CONCAT(N'Quyền mẫu ',case_no),'SAMPLE3',
           N'Chỉ dùng cho development seed'
    FROM @cases;

    UPDATE c SET sample_permission_id=p.permission_id
    FROM @cases c JOIN dbo.permissions p ON p.permission_code=CONCAT('SAMPLE3_PERMISSION_',c.case_no);

    INSERT dbo.role_permissions(role_id,permission_id)
    SELECT sample_role_id,sample_permission_id FROM @cases;

    INSERT dbo.users(username,email,phone,password_hash,display_name,status,token_version)
    SELECT CONCAT(N'sample3.doctor',case_no),CONCAT('sample3.doctor',case_no,'@example.test'),
           CONCAT('09088001',RIGHT(CONCAT('00',case_no),2)),
           CONCAT('DEVELOPMENT-SEED-NON-LOGIN-HASH-DOCTOR-',case_no),
           CONCAT(N'Bác sĩ mẫu ',case_no),'DISABLED',1
    FROM @cases
    UNION ALL
    SELECT CONCAT(N'sample3.patient',case_no),CONCAT('sample3.patient',case_no,'@example.test'),
           CONCAT('09088002',RIGHT(CONCAT('00',case_no),2)),
           CONCAT('DEVELOPMENT-SEED-NON-LOGIN-HASH-PATIENT-',case_no),
           CONCAT(N'Bệnh nhân mẫu ',case_no),'DISABLED',1
    FROM @cases;

    UPDATE c SET doctor_user_id=u.user_id
    FROM @cases c JOIN dbo.users u ON u.username_normalized=CONCAT(N'sample3.doctor',c.case_no);
    UPDATE c SET patient_user_id=u.user_id
    FROM @cases c JOIN dbo.users u ON u.username_normalized=CONCAT(N'sample3.patient',c.case_no);

    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id,is_active)
    SELECT c.doctor_user_id,r.role_id,c.branch_id,c.doctor_user_id,1
    FROM @cases c CROSS JOIN dbo.roles r WHERE r.role_code='DOCTOR'
    UNION ALL
    SELECT c.patient_user_id,r.role_id,NULL,c.doctor_user_id,1
    FROM @cases c CROSS JOIN dbo.roles r WHERE r.role_code='PATIENT';

    INSERT dbo.user_sessions
        (session_id,user_id,refresh_token_hash,device_info,ip_address,issued_at_utc,expires_at_utc,
         revoked_at_utc,revocation_reason,last_used_at_utc,token_version_snapshot)
    SELECT NEWID(),patient_user_id,HASHBYTES('SHA2_256',CONCAT('SAMPLE3-SESSION-',case_no)),
           CONCAT(N'Thiết bị mẫu ',case_no),'127.0.0.1',DATEADD(day,-3,SYSUTCDATETIME()),
           DATEADD(day,-2,SYSUTCDATETIME()),DATEADD(hour,-60,SYSUTCDATETIME()),'EXPIRED',
           DATEADD(hour,-61,SYSUTCDATETIME()),1
    FROM @cases;

    INSERT dbo.password_reset_challenges
        (password_reset_challenge_id,user_id,token_hash,requested_ip,expires_at_utc,
         revoked_at_utc,revocation_reason,created_at_utc)
    SELECT NEWID(),patient_user_id,HASHBYTES('SHA2_256',CONCAT('SAMPLE3-RESET-',case_no)),'127.0.0.1',
           DATEADD(day,-1,SYSUTCDATETIME()),DATEADD(day,-1,SYSUTCDATETIME()),'DELIVERY_FAILED',
           DATEADD(day,-2,SYSUTCDATETIME())
    FROM @cases;

    INSERT dbo.patient_registration_challenges
        (registration_challenge_id,idempotency_key,request_hash,branch_id,username,contact_channel,
         contact_value,contact_normalized,password_hash,full_name,date_of_birth,gender,otp_hash,
         attempt_count,max_attempts,requested_ip,expires_at_utc,revoked_at_utc,revocation_reason,created_at_utc)
    SELECT NEWID(),NEWID(),HASHBYTES('SHA2_256',CONCAT('SAMPLE3-REG-REQUEST-',case_no)),branch_id,
           CONCAT(N'sample3.pending',case_no),'EMAIL',CONCAT('sample3.pending',case_no,'@example.test'),
           CONCAT('sample3.pending',case_no,'@example.test'),CONCAT('DEVELOPMENT-SEED-HASH-',case_no),
           CONCAT(N'Đăng ký mẫu ',case_no),DATEFROMPARTS(1990+case_no,case_no,case_no),'OTHER',
           HASHBYTES('SHA2_256',CONCAT('SAMPLE3-OTP-',case_no)),0,5,'127.0.0.1',
           DATEADD(day,-1,SYSUTCDATETIME()),DATEADD(day,-1,SYSUTCDATETIME()),'EXPIRED',
           DATEADD(day,-2,SYSUTCDATETIME())
    FROM @cases;

    /* Staff and patients. */
    INSERT dbo.employees
        (user_id,primary_branch_id,employee_code,employee_type,full_name,date_of_birth,gender,
         phone,email,address_line,hire_date,employment_status,is_active)
    SELECT doctor_user_id,branch_id,CONCAT('S3-EMP-',case_no),'DOCTOR',CONCAT(N'Bác sĩ mẫu ',case_no),
           DATEFROMPARTS(1980+case_no,case_no,10),'OTHER',CONCAT('09088001',RIGHT(CONCAT('00',case_no),2)),
           CONCAT('sample3.doctor',case_no,'@example.test'),N'TP. Hồ Chí Minh',CONVERT(date,'20250101'),'ACTIVE',1
    FROM @cases;

    UPDATE c SET employee_id=e.employee_id
    FROM @cases c JOIN dbo.employees e ON e.employee_code=CONCAT('S3-EMP-',c.case_no);

    INSERT dbo.doctors
        (employee_id,medical_license_no,license_issued_date,license_expiry_date,academic_title,
         biography,default_slot_minutes,accepts_online_booking,is_active)
    SELECT employee_id,CONCAT(N'S3-LICENSE-',case_no),CONVERT(date,'20200101'),CONVERT(date,'20350101'),
           N'Bác sĩ',CONCAT(N'Hồ sơ bác sĩ mẫu ',case_no),30,1,1
    FROM @cases;

    UPDATE c SET doctor_id=d.doctor_id
    FROM @cases c JOIN dbo.doctors d ON d.medical_license_no=CONCAT(N'S3-LICENSE-',c.case_no);

    INSERT dbo.doctor_branch_assignments(doctor_id,branch_id,effective_from,is_primary,is_active)
    SELECT doctor_id,branch_id,CONVERT(date,'20200101'),1,1 FROM @cases;

    INSERT dbo.doctor_specialties(doctor_id,specialty_id,is_primary,certified_at)
    SELECT doctor_id,specialty_id,1,CONVERT(date,'20200101') FROM @cases;

    INSERT dbo.doctor_services(doctor_id,service_id,custom_duration_min,is_active)
    SELECT d.doctor_id,s.service_id,30,1
    FROM @cases d CROSS JOIN @cases s;

    INSERT dbo.patients
        (patient_code,registration_branch_id,full_name,date_of_birth,gender,national_id,
         health_insurance_no,phone,email,address_line,province,blood_type,occupation,status,created_by_user_id)
    SELECT CONCAT('S3-PAT-',case_no),branch_id,CONCAT(N'Bệnh nhân mẫu ',case_no),
           DATEFROMPARTS(1990+case_no,case_no,15),'OTHER',CONCAT('07999000000',case_no),
           CONCAT('S3-BHYT-',case_no),CONCAT('09088002',RIGHT(CONCAT('00',case_no),2)),
           CONCAT('sample3.patient',case_no,'@example.test'),N'TP. Hồ Chí Minh',N'TP. Hồ Chí Minh',
           CASE case_no WHEN 1 THEN 'A+' WHEN 2 THEN 'B+' ELSE 'O+' END,N'Nghề nghiệp mẫu','ACTIVE',doctor_user_id
    FROM @cases;

    UPDATE c SET patient_id=p.patient_id
    FROM @cases c JOIN dbo.patients p ON p.patient_code=CONCAT('S3-PAT-',c.case_no);

    INSERT dbo.user_patient_access
        (user_id,patient_id,relationship_type,status,is_booking_allowed,verified_by_user_id,
         verified_at_utc,verified_branch_id)
    SELECT patient_user_id,patient_id,'SELF','ACTIVE',1,doctor_user_id,SYSUTCDATETIME(),branch_id
    FROM @cases;

    INSERT dbo.patient_access_requests
        (requester_user_id,branch_id,patient_id,patient_reference_mask,relationship_type,request_note,
         status,decision_reason,decided_by_user_id,decided_at_utc,cancelled_at_utc,expires_at_utc,
         idempotency_key,request_hash)
    SELECT patient_user_id,branch_id,
           CASE WHEN case_no=2 THEN NULL ELSE patient_id END,
           CONCAT('***S3-',case_no),'SELF',CONCAT(N'Yêu cầu liên kết mẫu ',case_no),
           CASE case_no WHEN 1 THEN 'APPROVED' WHEN 2 THEN 'REJECTED' ELSE 'CANCELLED' END,
           CASE case_no WHEN 1 THEN N'Đã xác minh dữ liệu mẫu' WHEN 2 THEN N'Không khớp dữ liệu mẫu' ELSE NULL END,
           CASE WHEN case_no IN (1,2) THEN doctor_user_id ELSE NULL END,
           CASE WHEN case_no IN (1,2) THEN SYSUTCDATETIME() ELSE NULL END,
           CASE WHEN case_no=3 THEN SYSUTCDATETIME() ELSE NULL END,
           DATEADD(day,7,SYSUTCDATETIME()),NEWID(),HASHBYTES('SHA2_256',CONCAT('SAMPLE3-LINK-',case_no))
    FROM @cases;

    INSERT dbo.patient_emergency_contacts(patient_id,full_name,relationship_name,phone,is_primary)
    SELECT patient_id,CONCAT(N'Liên hệ khẩn cấp ',case_no),N'Người thân',
           CONCAT('09088003',RIGHT(CONCAT('00',case_no),2)),1
    FROM @cases;

    INSERT dbo.allergens(canonical_name,allergen_type,is_active)
    SELECT CONCAT(N'Dị nguyên mẫu ',case_no),CASE case_no WHEN 1 THEN 'DRUG' WHEN 2 THEN 'FOOD' ELSE 'ENVIRONMENT' END,1
    FROM @cases;

    UPDATE c SET allergen_id=a.allergen_id
    FROM @cases c JOIN dbo.allergens a ON a.canonical_name=CONCAT(N'Dị nguyên mẫu ',c.case_no);

    INSERT dbo.patient_allergies
        (patient_id,allergen_name,allergy_type,severity,reaction,noted_at,is_active,recorded_by_user_id,allergen_id)
    SELECT patient_id,CONCAT(N'Dị nguyên mẫu ',case_no),
           CASE case_no WHEN 1 THEN 'DRUG' WHEN 2 THEN 'FOOD' ELSE 'ENVIRONMENT' END,
           CASE case_no WHEN 1 THEN 'MILD' WHEN 2 THEN 'MODERATE' ELSE 'SEVERE' END,
           CONCAT(N'Phản ứng mẫu ',case_no),DATEADD(year,-1,@today),1,doctor_user_id,allergen_id
    FROM @cases;

    INSERT dbo.patient_conditions
        (patient_id,condition_code,condition_name,diagnosed_date,status,notes,recorded_by_user_id)
    SELECT patient_id,CONCAT('S3-COND-',case_no),CONCAT(N'Bệnh nền mẫu ',case_no),
           DATEADD(year,-2,@today),CASE case_no WHEN 1 THEN 'ACTIVE' WHEN 2 THEN 'CONTROLLED' ELSE 'RESOLVED' END,
           CONCAT(N'Ghi chú bệnh nền mẫu ',case_no),doctor_user_id
    FROM @cases;

    INSERT dbo.insurance_providers(provider_code,provider_name,phone,is_active)
    SELECT CONCAT('S3-INS-',case_no),CONCAT(N'Nhà bảo hiểm mẫu ',case_no),
           CONCAT('02874000',RIGHT(CONCAT('00',case_no),2)),1
    FROM @cases;

    UPDATE c SET insurance_provider_id=i.insurance_provider_id
    FROM @cases c JOIN dbo.insurance_providers i ON i.provider_code=CONCAT('S3-INS-',c.case_no);

    INSERT dbo.patient_insurances
        (patient_id,insurance_provider_id,policy_number,valid_from,valid_to,coverage_percent,is_primary,is_active)
    SELECT patient_id,insurance_provider_id,CONCAT('S3-POLICY-',case_no),DATEADD(year,-1,@today),
           DATEADD(year,1,@today),80,1,1
    FROM @cases;

    /* Pharmacy catalog and opening inventory. */
    INSERT dbo.suppliers(supplier_code,supplier_name,tax_code,phone,email,address_line,is_active)
    SELECT CONCAT('S3-SUP-',case_no),CONCAT(N'Nhà cung cấp mẫu ',case_no),CONCAT('S3-TAX-',case_no),
           CONCAT('02875000',RIGHT(CONCAT('00',case_no),2)),CONCAT('sample3.supplier',case_no,'@example.test'),
           N'TP. Hồ Chí Minh',1
    FROM @cases;

    UPDATE c SET supplier_id=s.supplier_id
    FROM @cases c JOIN dbo.suppliers s ON s.supplier_code=CONCAT('S3-SUP-',c.case_no);

    INSERT dbo.inventory_locations
        (branch_id,location_code,location_name,location_type,is_dispensing,is_active)
    SELECT branch_id,CONCAT('S3-PH-',case_no),CONCAT(N'Quầy thuốc mẫu ',case_no),'PHARMACY',1,1
    FROM @cases;

    UPDATE c SET inventory_location_id=l.inventory_location_id
    FROM @cases c JOIN dbo.inventory_locations l
      ON l.branch_id=c.branch_id AND l.location_code=CONCAT('S3-PH-',c.case_no);

    INSERT dbo.medicines
        (medicine_code,generic_name,brand_name,active_ingredient,strength,dosage_form,route,base_unit,
         registration_no,manufacturer,requires_prescription,controlled_level,reorder_level,current_sale_price,is_active)
    SELECT CONCAT('S3-MED-',case_no),CONCAT(N'Hoạt chất mẫu ',case_no),CONCAT(N'Thuốc mẫu ',case_no),
           CONCAT(N'Dị nguyên mẫu ',case_no),N'500 mg',N'Viên nén',N'Đường uống',N'Viên',
           CONCAT(N'S3-REG-',case_no),CONCAT(N'Nhà sản xuất mẫu ',case_no),1,'NONE',10,25000+(case_no*5000),1
    FROM @cases;

    UPDATE c SET medicine_id=m.medicine_id
    FROM @cases c JOIN dbo.medicines m ON m.medicine_code=CONCAT('S3-MED-',c.case_no);

    INSERT dbo.medicine_allergens(medicine_id,allergen_id,is_active,created_by_user_id)
    SELECT medicine_id,allergen_id,1,doctor_user_id FROM @cases;

    INSERT dbo.medicine_batches
        (medicine_id,supplier_id,batch_number,manufactured_date,expiry_date,purchase_price,sale_price,
         status,received_at_utc,origin_branch_id)
    SELECT medicine_id,supplier_id,CONCAT(N'S3-BATCH-',case_no),DATEADD(month,-6,@today),
           DATEADD(year,2,@today),15000,25000+(case_no*5000),'AVAILABLE',
           DATEADD(day,-30,SYSUTCDATETIME()),branch_id
    FROM @cases;

    UPDATE c SET medicine_batch_id=mb.medicine_batch_id
    FROM @cases c JOIN dbo.medicine_batches mb
      ON mb.medicine_id=c.medicine_id AND mb.batch_number=CONCAT(N'S3-BATCH-',c.case_no);

    INSERT dbo.inventory_balances
        (inventory_location_id,medicine_batch_id,quantity_on_hand,quantity_reserved,last_movement_at_utc)
    SELECT inventory_location_id,medicine_batch_id,20,0,DATEADD(day,-30,SYSUTCDATETIME())
    FROM @cases;

    INSERT dbo.inventory_movements
        (inventory_location_id,medicine_batch_id,movement_type,quantity_delta,balance_after,unit_cost,
         reference_type,reference_id,reason,performed_by_user_id,occurred_at_utc,request_id)
    SELECT inventory_location_id,medicine_batch_id,'RECEIPT',20,20,15000,
           'SAMPLE3_RECEIPT',case_no,N'Nhập kho dữ liệu mẫu',doctor_user_id,
           DATEADD(day,-30,SYSUTCDATETIME()),NEWID()
    FROM @cases;

    /* Scheduling examples. */
    INSERT dbo.doctor_working_schedules
        (doctor_id,branch_id,room_id,weekday_iso,local_start_time,local_end_time,slot_duration_min,
         booking_horizon_days,effective_from,is_active,created_by_user_id)
    SELECT doctor_id,branch_id,room_id,1,CONVERT(time,'08:00'),CONVERT(time,'10:00'),30,60,
           DATEADD(day,-7,@next_monday),1,doctor_user_id
    FROM @cases;

    UPDATE c SET working_schedule_id=w.working_schedule_id
    FROM @cases c JOIN dbo.doctor_working_schedules w
      ON w.doctor_id=c.doctor_id AND w.branch_id=c.branch_id AND w.effective_from=DATEADD(day,-7,@next_monday);

    INSERT dbo.doctor_schedule_breaks(working_schedule_id,local_start_time,local_end_time,break_name)
    SELECT working_schedule_id,CONVERT(time,'09:30'),CONVERT(time,'10:00'),N'Nghỉ giữa ca mẫu'
    FROM @cases;

    INSERT dbo.doctor_time_off
        (doctor_id,branch_id,starts_at_utc,ends_at_utc,reason,status,requested_by_user_id)
    SELECT doctor_id,branch_id,DATEADD(day,10,CAST(@next_monday AS datetime2)),
           DATEADD(hour,4,DATEADD(day,10,CAST(@next_monday AS datetime2))),
           CONCAT(N'Yêu cầu nghỉ mẫu ',case_no),'PENDING',doctor_user_id
    FROM @cases;

    INSERT dbo.clinic_holidays
        (branch_id,holiday_date,holiday_name,is_closed_all_day,created_by_user_id)
    SELECT branch_id,DATEADD(day,30+case_no,@next_monday),CONCAT(N'Ngày nghỉ mẫu ',case_no),1,doctor_user_id
    FROM @cases;

    INSERT dbo.appointment_slots
        (working_schedule_id,doctor_id,branch_id,room_id,service_date_local,start_time_local,end_time_local,
         starts_at_utc,ends_at_utc,booking_opens_at_utc,booking_closes_at_utc,status)
    SELECT c.working_schedule_id,c.doctor_id,c.branch_id,c.room_id,@next_monday,
           v.start_local,v.end_local,
           DATEADD(minute,v.start_utc_minute,CAST(@next_monday AS datetime2)),
           DATEADD(minute,v.end_utc_minute,CAST(@next_monday AS datetime2)),
           DATEADD(day,-30,DATEADD(minute,v.start_utc_minute,CAST(@next_monday AS datetime2))),
           DATEADD(minute,-120,DATEADD(minute,v.start_utc_minute,CAST(@next_monday AS datetime2))),'OPEN'
    FROM @cases c
    CROSS APPLY (VALUES
        (CONVERT(time,'08:00'),CONVERT(time,'08:30'),60,90),
        (CONVERT(time,'08:30'),CONVERT(time,'09:00'),90,120)
    ) v(start_local,end_local,start_utc_minute,end_utc_minute);

    UPDATE c SET old_slot_id=s.slot_id
    FROM @cases c JOIN dbo.appointment_slots s
      ON s.working_schedule_id=c.working_schedule_id AND s.service_date_local=@next_monday
     AND s.start_time_local=CONVERT(time,'08:00');
    UPDATE c SET new_slot_id=s.slot_id
    FROM @cases c JOIN dbo.appointment_slots s
      ON s.working_schedule_id=c.working_schedule_id AND s.service_date_local=@next_monday
     AND s.start_time_local=CONVERT(time,'08:30');

    EXEC sys.sp_set_session_context N'actor_user_id', NULL;
    EXEC sys.sp_set_session_context N'status_reason', N'Tạo lịch hẹn mẫu';

    INSERT dbo.appointments
        (appointment_code,branch_id,slot_id,patient_id,doctor_id,service_id,booking_channel,status,
         scheduled_start_utc,scheduled_end_utc,chief_complaint,booked_by_user_id,
         confirmed_by_user_id,confirmed_at_utc,occupies_slot)
    SELECT CONCAT('S3-APT-',c.case_no),c.branch_id,c.new_slot_id,c.patient_id,c.doctor_id,c.service_id,
           'ONLINE','CONFIRMED',s.starts_at_utc,s.ends_at_utc,
           CONCAT(N'Lý do khám mẫu ',c.case_no),c.patient_user_id,c.doctor_user_id,SYSUTCDATETIME(),1
    FROM @cases c JOIN dbo.appointment_slots s ON s.slot_id=c.new_slot_id;

    UPDATE c SET appointment_id=a.appointment_id
    FROM @cases c JOIN dbo.appointments a ON a.appointment_code=CONCAT('S3-APT-',c.case_no);

    INSERT dbo.appointment_reschedule_history
        (appointment_id,old_slot_id,new_slot_id,old_doctor_id,new_doctor_id,old_service_id,new_service_id,
         reason,changed_by_user_id,request_id)
    SELECT appointment_id,old_slot_id,new_slot_id,doctor_id,doctor_id,service_id,service_id,
           N'Ví dụ đổi lịch sang khung giờ phù hợp hơn',patient_user_id,NEWID()
    FROM @cases;

    /* Queue and clinical record examples. */
    INSERT dbo.queue_sessions
        (branch_id,queue_date_local,queue_type,prefix,last_number,status,opened_at_utc,closed_at_utc)
    SELECT branch_id,@clinical_monday,'GENERAL','A',1,'CLOSED',
           DATEADD(minute,30,CAST(@clinical_monday AS datetime2)),
           DATEADD(hour,8,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    UPDATE c SET queue_session_id=q.queue_session_id
    FROM @cases c JOIN dbo.queue_sessions q
      ON q.branch_id=c.branch_id AND q.queue_date_local=@clinical_monday AND q.queue_type='GENERAL';

    INSERT dbo.encounters
        (encounter_code,branch_id,patient_id,attending_doctor_id,room_id,encounter_source,status,
         arrived_at_utc,chief_complaint,history_of_present_illness,physical_examination,
         clinical_assessment,treatment_plan,follow_up_instructions,created_by_user_id)
    SELECT CONCAT('S3-ENC-',case_no),branch_id,patient_id,doctor_id,room_id,'WALK_IN','WAITING',
           DATEADD(minute,60+case_no,CAST(@clinical_monday AS datetime2)),
           CONCAT(N'Triệu chứng mẫu ',case_no),N'Bệnh sử mẫu',N'Khám lâm sàng mẫu',
           N'Đánh giá ban đầu mẫu',N'Kế hoạch điều trị mẫu',N'Tái khám khi có triệu chứng',doctor_user_id
    FROM @cases;

    UPDATE c SET encounter_id=e.encounter_id
    FROM @cases c JOIN dbo.encounters e ON e.encounter_code=CONCAT('S3-ENC-',c.case_no);

    INSERT dbo.queue_tickets
        (queue_session_id,encounter_id,queue_number,display_number,priority_level,status,
         issued_at_utc,called_at_utc,service_started_at_utc,completed_at_utc,called_by_user_id,notes)
    SELECT queue_session_id,encounter_id,1,CONCAT('A',RIGHT(CONCAT('000',case_no),3)),0,'COMPLETED',
           DATEADD(minute,60,CAST(@clinical_monday AS datetime2)),
           DATEADD(minute,70,CAST(@clinical_monday AS datetime2)),
           DATEADD(minute,75,CAST(@clinical_monday AS datetime2)),
           DATEADD(minute,120,CAST(@clinical_monday AS datetime2)),doctor_user_id,N'Phiếu hàng đợi mẫu'
    FROM @cases;

    INSERT dbo.encounter_staff_assignments(encounter_id,employee_id,assignment_role,assigned_at_utc,ended_at_utc)
    SELECT encounter_id,employee_id,'ATTENDING_DOCTOR',
           DATEADD(minute,75,CAST(@clinical_monday AS datetime2)),
           DATEADD(minute,120,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    INSERT dbo.encounter_vital_signs
        (encounter_id,measured_at_utc,temperature_c,pulse_bpm,respiratory_rate_bpm,
         systolic_bp_mmhg,diastolic_bp_mmhg,spo2_percent,height_cm,weight_kg,pain_score,notes,measured_by_user_id)
    SELECT encounter_id,DATEADD(minute,72,CAST(@clinical_monday AS datetime2)),36.5+(case_no*0.1),
           70+case_no,18,120+case_no,80,98,165+case_no,55+(case_no*3),case_no,
           CONCAT(N'Sinh hiệu mẫu ',case_no),doctor_user_id
    FROM @cases;

    INSERT dbo.diagnosis_catalog(coding_system,diagnosis_code,diagnosis_name,is_active)
    SELECT 'ICD10',CONCAT('S3.',case_no),CONCAT(N'Chẩn đoán mẫu ',case_no),1 FROM @cases;

    UPDATE c SET diagnosis_catalog_id=d.diagnosis_catalog_id
    FROM @cases c JOIN dbo.diagnosis_catalog d ON d.diagnosis_code=CONCAT('S3.',c.case_no);

    INSERT dbo.encounter_diagnoses
        (encounter_id,diagnosis_catalog_id,diagnosis_code_snapshot,diagnosis_name_snapshot,
         diagnosis_type,is_primary,notes,recorded_by_user_id)
    SELECT encounter_id,diagnosis_catalog_id,CONCAT('S3.',case_no),CONCAT(N'Chẩn đoán mẫu ',case_no),
           'FINAL',1,CONCAT(N'Ghi chú chẩn đoán mẫu ',case_no),doctor_user_id
    FROM @cases;

    INSERT dbo.encounter_services
        (encounter_id,service_id,service_code_snapshot,service_name_snapshot,service_type_snapshot,
         quantity,unit_price_snapshot,discount_amount,status,ordered_by_user_id,ordered_at_utc,
         performed_by_user_id,performed_at_utc,notes,result_schema_snapshot_json,result_schema_snapshot_captured)
    SELECT encounter_id,service_id,CONCAT('S3-SERVICE-',case_no),CONCAT(N'Dịch vụ khám mẫu ',case_no),
           'CONSULTATION',1,100000+(case_no*50000),0,'COMPLETED',doctor_user_id,
           DATEADD(minute,80,CAST(@clinical_monday AS datetime2)),doctor_user_id,
           DATEADD(minute,100,CAST(@clinical_monday AS datetime2)),N'Dịch vụ hoàn tất trong dữ liệu mẫu',
           N'{"type":"object","properties":{"note":{"type":"string"}}}',1
    FROM @cases;

    UPDATE c SET encounter_service_id=es.encounter_service_id
    FROM @cases c JOIN dbo.encounter_services es
      ON es.encounter_id=c.encounter_id AND es.service_id=c.service_id;

    INSERT dbo.service_results
        (encounter_service_id,result_version,status,summary,conclusion,result_json,entered_by_user_id,entered_at_utc)
    SELECT encounter_service_id,1,'DRAFT',CONCAT(N'Tóm tắt kết quả mẫu ',case_no),
           CONCAT(N'Kết luận mẫu ',case_no),CONCAT(N'{"note":"Kết quả mẫu ',case_no,N'"}'),
           doctor_user_id,DATEADD(minute,105,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    UPDATE c SET service_result_id=sr.service_result_id
    FROM @cases c JOIN dbo.service_results sr
      ON sr.encounter_service_id=c.encounter_service_id AND sr.result_version=1;

    INSERT dbo.service_result_values
        (service_result_id,item_code,item_name,value_numeric,unit,reference_range,abnormal_flag,display_order)
    SELECT service_result_id,CONCAT('S3-ITEM-',case_no),CONCAT(N'Chỉ số mẫu ',case_no),
           10+case_no,N'đơn vị',N'5-20','N',case_no
    FROM @cases;

    INSERT dbo.medical_attachments
        (encounter_id,encounter_service_id,file_name,storage_key,mime_type,byte_size,sha256_hash,
         category,description,uploaded_by_user_id,uploaded_at_utc)
    SELECT encounter_id,encounter_service_id,CONCAT(N'ket-qua-mau-',case_no,N'.pdf'),
           CONCAT(N'sample3/attachments/result-',case_no,N'.pdf'),'application/pdf',1024+case_no,
           HASHBYTES('SHA2_256',CONCAT('SAMPLE3-ATTACHMENT-',case_no)),'LAB',
           N'Tệp minh họa; không chứa dữ liệu y tế thật',doctor_user_id,
           DATEADD(minute,106,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    /* Prescriptions, dispensing and reversible inventory ledger. */
    INSERT dbo.prescriptions
        (prescription_code,encounter_id,patient_id,doctor_id,branch_id,status,
         clinical_notes,general_instructions,created_by_user_id,created_at_utc)
    SELECT CONCAT('S3-RX-',case_no),encounter_id,patient_id,doctor_id,branch_id,'DRAFT',
           N'Đơn thuốc minh họa',N'Dùng đúng hướng dẫn',doctor_user_id,
           DATEADD(minute,108,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    UPDATE c SET prescription_id=p.prescription_id
    FROM @cases c JOIN dbo.prescriptions p ON p.prescription_code=CONCAT('S3-RX-',c.case_no);

    INSERT dbo.prescription_items
        (prescription_id,medicine_id,medicine_name_snapshot,strength_snapshot,dosage_form_snapshot,
         route_snapshot,prescribed_quantity,dispensed_quantity,dose,frequency,duration_days,
         timing_instruction,usage_instruction,sort_order,allergy_override_reason,allergy_override_by_user_id)
    SELECT prescription_id,medicine_id,CONCAT(N'Thuốc mẫu ',case_no),N'500 mg',N'Viên nén',N'Đường uống',
           10,0,N'1 viên',N'2 lần/ngày',5,N'Sau ăn',N'Uống nhiều nước',1,
           N'Dữ liệu mẫu đã được đánh giá',doctor_user_id
    FROM @cases;

    UPDATE c SET prescription_item_id=pi.prescription_item_id
    FROM @cases c JOIN dbo.prescription_items pi
      ON pi.prescription_id=c.prescription_id AND pi.medicine_id=c.medicine_id;

    UPDATE p SET status='ISSUED',issued_at_utc=DATEADD(minute,110,CAST(@clinical_monday AS datetime2)),
                 valid_until=DATEADD(day,30,@today),updated_at_utc=SYSUTCDATETIME()
    FROM dbo.prescriptions p JOIN @cases c ON c.prescription_id=p.prescription_id;

    INSERT dbo.dispensations
        (dispensation_code,prescription_id,branch_id,inventory_location_id,status,dispensed_by_user_id,
         opened_at_utc,completed_at_utc,notes)
    SELECT CONCAT('S3-DSP-',case_no),prescription_id,branch_id,inventory_location_id,'COMPLETED',doctor_user_id,
           DATEADD(minute,115,CAST(@clinical_monday AS datetime2)),
           DATEADD(minute,118,CAST(@clinical_monday AS datetime2)),N'Phiên cấp thuốc mẫu'
    FROM @cases;

    UPDATE c SET dispensation_id=d.dispensation_id
    FROM @cases c JOIN dbo.dispensations d ON d.dispensation_code=CONCAT('S3-DSP-',c.case_no);

    INSERT dbo.dispensation_items
        (dispensation_id,prescription_item_id,medicine_batch_id,quantity,unit_price_snapshot,dispensed_at_utc,
         allergy_override_reason,allergy_override_by_user_id)
    SELECT dispensation_id,prescription_item_id,medicine_batch_id,2,25000+(case_no*5000),
           DATEADD(minute,117,CAST(@clinical_monday AS datetime2)),
           N'Dữ liệu mẫu đã được đánh giá',doctor_user_id
    FROM @cases;

    UPDATE c SET dispensation_item_id=di.dispensation_item_id
    FROM @cases c JOIN dbo.dispensation_items di
      ON di.dispensation_id=c.dispensation_id AND di.prescription_item_id=c.prescription_item_id;

    INSERT dbo.inventory_movements
        (inventory_location_id,medicine_batch_id,movement_type,quantity_delta,balance_after,unit_cost,
         reference_type,reference_id,dispensation_item_id,reason,performed_by_user_id,occurred_at_utc,request_id)
    SELECT inventory_location_id,medicine_batch_id,'DISPENSE',-2,18,15000,
           'DISPENSATION',dispensation_id,dispensation_item_id,N'Cấp thuốc mẫu',doctor_user_id,
           DATEADD(minute,117,CAST(@clinical_monday AS datetime2)),NEWID()
    FROM @cases;

    UPDATE c SET dispense_movement_id=im.inventory_movement_id
    FROM @cases c JOIN dbo.inventory_movements im
      ON im.dispensation_item_id=c.dispensation_item_id AND im.movement_type='DISPENSE';

    INSERT dbo.inventory_movements
        (inventory_location_id,medicine_batch_id,movement_type,quantity_delta,balance_after,unit_cost,
         reference_type,reference_id,reverses_movement_id,reason,performed_by_user_id,occurred_at_utc,request_id)
    SELECT inventory_location_id,medicine_batch_id,'REVERSAL',2,20,15000,
           'DISPENSATION_REVERSAL',dispensation_item_id,dispense_movement_id,N'Hoàn trả thuốc mẫu',doctor_user_id,
           DATEADD(minute,119,CAST(@clinical_monday AS datetime2)),NEWID()
    FROM @cases;

    UPDATE c SET reversal_movement_id=im.inventory_movement_id
    FROM @cases c JOIN dbo.inventory_movements im ON im.reverses_movement_id=c.dispense_movement_id;

    INSERT dbo.dispensation_item_reversals
        (dispensation_item_id,reversal_movement_id,return_location_id,disposition,reason,
         reversed_by_user_id,reversed_at_utc,sellable_inspection_confirmed)
    SELECT dispensation_item_id,reversal_movement_id,inventory_location_id,'SELLABLE',
           N'Đảo cấp thuốc minh họa',doctor_user_id,
           DATEADD(minute,119,CAST(@clinical_monday AS datetime2)),1
    FROM @cases;

    /* Finalize and release the three clinical records. */
    UPDATE sr SET status='FINAL',verified_by_user_id=c.doctor_user_id,
                  verified_at_utc=DATEADD(minute,120,CAST(@clinical_monday AS datetime2))
    FROM dbo.service_results sr JOIN @cases c ON c.service_result_id=sr.service_result_id;

    UPDATE e SET status='IN_PROGRESS',started_at_utc=DATEADD(minute,75,CAST(@clinical_monday AS datetime2)),
                 is_in_progress=1,updated_at_utc=SYSUTCDATETIME()
    FROM dbo.encounters e JOIN @cases c ON c.encounter_id=e.encounter_id;

    UPDATE e SET status='COMPLETED',completed_at_utc=DATEADD(minute,125,CAST(@clinical_monday AS datetime2)),
                 is_in_progress=0,updated_at_utc=SYSUTCDATETIME()
    FROM dbo.encounters e JOIN @cases c ON c.encounter_id=e.encounter_id;

    UPDATE e SET status='SIGNED',signed_at_utc=DATEADD(minute,130,CAST(@clinical_monday AS datetime2)),
                 signed_by_user_id=c.doctor_user_id,updated_at_utc=SYSUTCDATETIME()
    FROM dbo.encounters e JOIN @cases c ON c.encounter_id=e.encounter_id;

    INSERT dbo.encounter_signatures
        (encounter_id,canonical_schema_version,payload_sha256,signature_type,signed_by_user_id,signed_at_utc)
    SELECT encounter_id,'SAMPLE3-V1',HASHBYTES('SHA2_256',CONCAT('SAMPLE3-SIGNATURE-',case_no)),
           'HASH_ATTESTATION',doctor_user_id,DATEADD(minute,130,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    INSERT dbo.clinical_record_releases(encounter_id,released_by_user_id,released_at_utc)
    SELECT encounter_id,doctor_user_id,DATEADD(minute,135,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    INSERT dbo.encounter_amendments
        (encounter_id,amendment_no,reason,amendment_content,previous_chain_hash,amendment_hash,
         signature_algorithm,signature_value,amended_by_user_id,amended_at_utc)
    SELECT encounter_id,1,N'Bổ sung dữ liệu mẫu',CONCAT(N'Nội dung phụ lục mẫu ',case_no),
           HASHBYTES('SHA2_256',CONCAT('SAMPLE3-PREVIOUS-',case_no)),
           HASHBYTES('SHA2_256',CONCAT('SAMPLE3-AMENDMENT-',case_no)),
           NULL,NULL,doctor_user_id,DATEADD(minute,140,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    /* Billing, payments and refunds. */
    INSERT dbo.invoices
        (invoice_number,encounter_id,patient_id,branch_id,status,created_by_user_id,created_at_utc)
    SELECT CONCAT('S3-INV-',case_no),encounter_id,patient_id,branch_id,'DRAFT',doctor_user_id,
           DATEADD(minute,145,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    UPDATE c SET invoice_id=i.invoice_id
    FROM @cases c JOIN dbo.invoices i ON i.invoice_number=CONCAT('S3-INV-',c.case_no);

    INSERT dbo.invoice_items
        (invoice_id,item_type,item_code_snapshot,item_name_snapshot,quantity,unit_price,discount_amount,tax_rate_percent)
    SELECT invoice_id,'OTHER',CONCAT('S3-FEE-',case_no),CONCAT(N'Chi phí mẫu ',case_no),1,100000,0,0
    FROM @cases;

    UPDATE i SET status='ISSUED',issued_at_utc=DATEADD(minute,150,CAST(@clinical_monday AS datetime2)),
                 due_at_utc=DATEADD(day,7,@clinical_monday),updated_at_utc=SYSUTCDATETIME()
    FROM dbo.invoices i JOIN @cases c ON c.invoice_id=i.invoice_id;

    INSERT dbo.payments
        (payment_number,branch_id,patient_id,amount,payment_method,status,idempotency_key,
         paid_at_utc,received_by_user_id,notes)
    SELECT CONCAT('S3-PAY-',case_no),branch_id,patient_id,100000,'CASH','SUCCEEDED',NEWID(),
           DATEADD(minute,155,CAST(@clinical_monday AS datetime2)),doctor_user_id,N'Thanh toán mẫu'
    FROM @cases;

    UPDATE c SET payment_id=p.payment_id
    FROM @cases c JOIN dbo.payments p ON p.payment_number=CONCAT('S3-PAY-',c.case_no);

    INSERT dbo.payment_allocations(payment_id,invoice_id,allocated_amount,allocated_at_utc)
    SELECT payment_id,invoice_id,100000,DATEADD(minute,156,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    UPDATE c SET payment_allocation_id=pa.payment_allocation_id
    FROM @cases c JOIN dbo.payment_allocations pa
      ON pa.payment_id=c.payment_id AND pa.invoice_id=c.invoice_id;

    UPDATE i SET status='PAID',updated_at_utc=SYSUTCDATETIME()
    FROM dbo.invoices i JOIN @cases c ON c.invoice_id=i.invoice_id;

    INSERT dbo.payment_refunds
        (refund_number,payment_id,amount,refund_method,status,idempotency_key,reason,
         refunded_by_user_id,refunded_at_utc)
    SELECT CONCAT('S3-REF-',case_no),payment_id,50000,'CASH','SUCCEEDED',NEWID(),
           N'Hoàn tiền mẫu',doctor_user_id,DATEADD(minute,160,CAST(@clinical_monday AS datetime2))
    FROM @cases;

    UPDATE c SET payment_refund_id=pr.payment_refund_id
    FROM @cases c JOIN dbo.payment_refunds pr ON pr.refund_number=CONCAT('S3-REF-',c.case_no);

    INSERT dbo.refund_allocations(payment_refund_id,payment_allocation_id,refunded_amount)
    SELECT payment_refund_id,payment_allocation_id,50000 FROM @cases;

    UPDATE i SET status='PARTIALLY_PAID',updated_at_utc=SYSUTCDATETIME()
    FROM dbo.invoices i JOIN @cases c ON c.invoice_id=i.invoice_id;

    /* Infrastructure examples are terminal so background workers ignore them. */
    INSERT dbo.document_sequences(branch_id,document_type,sequence_date,current_value)
    SELECT branch_id,'PATIENT',@today,3 FROM @cases;

    INSERT dbo.idempotency_requests
        (actor_user_id,operation_code,idempotency_key,request_hash,status,resource_type,resource_id,
         response_json,created_at_utc,completed_at_utc,expires_at_utc)
    SELECT patient_user_id,CONCAT('SAMPLE3_OPERATION_',case_no),NEWID(),
           HASHBYTES('SHA2_256',CONCAT('SAMPLE3-IDEMPOTENCY-',case_no)),'COMPLETED','PATIENT',patient_id,
           CONCAT(N'{"sample":true,"case":',case_no,N'}'),DATEADD(day,-2,SYSUTCDATETIME()),
           DATEADD(day,-2,SYSUTCDATETIME()),DATEADD(day,-1,SYSUTCDATETIME())
    FROM @cases;

    INSERT dbo.outbox_events
        (event_id,aggregate_type,aggregate_id,event_type,payload_json,occurred_at_utc,published_at_utc,
         attempt_count,schema_version,producer,dedupe_key,next_attempt_at_utc)
    SELECT NEWID(),'SAMPLE3',CONCAT('S3-',case_no),'SAMPLE3_CREATED',
           CONCAT(N'{"sample":true,"case":',case_no,N'}'),DATEADD(day,-1,SYSUTCDATETIME()),
           DATEADD(day,-1,SYSUTCDATETIME()),1,1,'development-sample-seed',
           CONCAT('sample3-outbox-',case_no),DATEADD(day,-1,SYSUTCDATETIME())
    FROM @cases;

    INSERT dbo.notifications
        (user_id,patient_id,channel,template_code,recipient,subject,body,payload_json,status,
         scheduled_at_utc,sent_at_utc,retry_count,source_event_id,dedupe_key,next_attempt_at_utc)
    SELECT c.patient_user_id,c.patient_id,'IN_APP','SAMPLE3_NOTICE',
           CONCAT('sample3.patient',c.case_no,'@example.test'),CONCAT(N'Thông báo mẫu ',c.case_no),
           CONCAT(N'Nội dung thông báo mẫu ',c.case_no),CONCAT(N'{"sample":true,"case":',c.case_no,N'}'),
           'SENT',DATEADD(day,-1,SYSUTCDATETIME()),DATEADD(day,-1,SYSUTCDATETIME()),0,
           o.event_id,CONCAT('sample3-notification-',c.case_no),DATEADD(day,-1,SYSUTCDATETIME())
    FROM @cases c
    JOIN dbo.outbox_events o ON o.dedupe_key=CONCAT('sample3-outbox-',c.case_no);

    INSERT dbo.audit_logs
        (actor_user_id,branch_id,action_code,entity_type,entity_id,new_values_json,request_id,
         ip_address,user_agent,occurred_at_utc)
    SELECT doctor_user_id,branch_id,'SAMPLE3_SEED','SAMPLE3',CONCAT('S3-',case_no),
           CONCAT(N'{"sample":true,"case":',case_no,N'}'),NEWID(),'127.0.0.1',
           N'development-sample-data.sql',SYSUTCDATETIME()
    FROM @cases;

    IF EXISTS
    (
        SELECT 1
        FROM sys.tables t
        OUTER APPLY
        (
            SELECT SUM(p.rows) AS row_count
            FROM sys.partitions p
            WHERE p.object_id=t.object_id AND p.index_id IN (0,1)
        ) x
        WHERE SCHEMA_NAME(t.schema_id)='dbo' AND COALESCE(x.row_count,0)<3
    )
    BEGIN
        SELECT t.name AS deficient_table,COALESCE(x.row_count,0) AS row_count
        FROM sys.tables t
        OUTER APPLY
        (
            SELECT SUM(p.rows) AS row_count
            FROM sys.partitions p
            WHERE p.object_id=t.object_id AND p.index_id IN (0,1)
        ) x
        WHERE SCHEMA_NAME(t.schema_id)='dbo' AND COALESCE(x.row_count,0)<3
        ORDER BY t.name;

        THROW 54002, N'Seed chưa đạt tối thiểu 3 bản ghi cho mọi bảng dbo.', 1;
    END;

    IF @dry_run=1
    BEGIN
        ROLLBACK TRANSACTION;
        PRINT N'DRY-RUN thành công; toàn bộ thay đổi đã rollback.';
    END
    ELSE
    BEGIN
        COMMIT TRANSACTION;
        PRINT N'Đã chèn ba bộ dữ liệu SAMPLE3.';
    END;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

VerifySeed:
SELECT t.name AS table_name,SUM(p.rows) AS row_count
FROM sys.tables t
JOIN sys.partitions p ON p.object_id=t.object_id AND p.index_id IN (0,1)
WHERE SCHEMA_NAME(t.schema_id)='dbo'
GROUP BY t.name
ORDER BY t.name;

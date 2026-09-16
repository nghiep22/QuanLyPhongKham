SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRY
    IF EXISTS (SELECT 1 FROM (VALUES
        (N'sp_start_encounter'),(N'sp_update_encounter_clinical_notes'),(N'sp_add_vital_signs'),
        (N'sp_add_encounter_diagnosis'),(N'sp_order_encounter_service'),(N'sp_finalize_service_result'),
        (N'sp_complete_encounter'),(N'sp_sign_encounter'),(N'sp_add_encounter_amendment'),
        (N'sp_cancel_encounter'),(N'sp_compute_encounter_signature_hash')
    ) forbidden(name) JOIN sys.database_permissions dp ON dp.major_id=OBJECT_ID(N'dbo.'+forbidden.name)
      WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
      THROW 55900,N'Clinic API còn quyền procedure bigint nội bộ.',1;
    IF EXISTS (SELECT 1 FROM (VALUES
        (N'sp_clinic_clinical_branches'),(N'sp_clinic_list_encounters'),(N'sp_clinic_get_encounter'),
        (N'sp_clinic_start_encounter'),(N'sp_clinic_update_encounter_clinical_notes'),
        (N'sp_clinic_add_vital_signs'),(N'sp_clinic_add_encounter_diagnosis'),
        (N'sp_clinic_order_encounter_service'),(N'sp_clinic_finalize_service_result'),
        (N'sp_clinic_complete_encounter'),(N'sp_clinic_sign_encounter'),
        (N'sp_clinic_add_encounter_amendment')
    ) required(name) WHERE NOT EXISTS (SELECT 1 FROM sys.database_permissions dp
      WHERE dp.major_id=OBJECT_ID(N'dbo.'+required.name)
        AND dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND dp.permission_name='EXECUTE' AND dp.state IN('G','W')))
      THROW 55901,N'Clinic API thiếu quyền clinical public procedure.',1;

    BEGIN TRANSACTION;
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID()),@request_id uniqueidentifier=NEWID(),
            @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN'),
            @consult_category bigint=(SELECT service_category_id FROM dbo.service_categories WHERE category_code='CONSULTATION'),
            @lab_category bigint=(SELECT service_category_id FROM dbo.service_categories WHERE category_code='LAB'),
            @specialty_id bigint=(SELECT specialty_id FROM dbo.specialties WHERE specialty_code='GENERAL'),
            @business_date date;
    IF @branch_id IS NULL OR @consult_category IS NULL OR @lab_category IS NULL OR @specialty_id IS NULL
      THROW 55902,N'Thiếu seed chi nhánh hoặc danh mục.',1;
    EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
    DECLARE @branch_public_id uniqueidentifier=(SELECT public_id FROM dbo.branches WHERE branch_id=@branch_id);
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'clinical-admin-',@suffix),REPLICATE('x',60),N'Clinical Admin','ACTIVE');
    DECLARE @admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

    DECLARE @room_id bigint,@room_public_id uniqueidentifier,
            @room_code varchar(30)=CONCAT('CL',LEFT(@suffix,20)),
            @consult_code varchar(30)=CONCAT('CC',LEFT(@suffix,20)),
            @lab_code varchar(30)=CONCAT('LC',LEFT(@suffix,20)),
            @doctor_username nvarchar(80)=CONCAT(N'clinical-doctor-',@suffix),
            @doctor_code varchar(30)=CONCAT('CD',LEFT(@suffix,20)),
            @doctor_license nvarchar(100)=CONCAT(N'CL-',@suffix),
            @license_expiry date=DATEADD(YEAR,1,@business_date),
            @doctor_password varchar(255)=REPLICATE('x',60);
    EXEC dbo.sp_create_room @actor_user_id=@admin_id,@branch_id=@branch_id,
      @room_code=@room_code,@room_name=N'Phòng clinical test',@room_type='CONSULTATION',
      @floor_no=1,@capacity=1,@room_id=@room_id OUTPUT;
    SELECT @room_public_id=public_id FROM dbo.rooms WHERE room_id=@room_id;

    DECLARE @consult_id bigint,@lab_id bigint,@lab_public_id uniqueidentifier,@price_id bigint;
    EXEC dbo.sp_create_service @actor_user_id=@admin_id,@branch_id=NULL,
      @service_category_id=@consult_category,@specialty_id=@specialty_id,
      @service_code=@consult_code,@service_name=N'Khám clinical test',
      @service_type='CONSULTATION',@default_duration_min=30,@current_price=1000,
      @requires_doctor=1,@service_id=@consult_id OUTPUT;
    EXEC dbo.sp_create_service @actor_user_id=@admin_id,@branch_id=NULL,
      @service_category_id=@lab_category,@specialty_id=@specialty_id,
      @service_code=@lab_code,@service_name=N'Xét nghiệm clinical test',
      @service_type='LAB',@default_duration_min=30,@current_price=1000,
      @requires_doctor=0,@service_id=@lab_id OUTPUT;
    SELECT @lab_public_id=public_id FROM dbo.services WHERE service_id=@lab_id;
    EXEC dbo.sp_set_branch_service_price @actor_user_id=@admin_id,@branch_id=@branch_id,
      @service_id=@consult_id,@price_amount=200000,@effective_from=@business_date,
      @is_available=1,@service_branch_price_id=@price_id OUTPUT;
    EXEC dbo.sp_set_branch_service_price @actor_user_id=@admin_id,@branch_id=@branch_id,
      @service_id=@lab_id,@price_amount=321000,@effective_from=@business_date,
      @is_available=1,@service_branch_price_id=@price_id OUTPUT;

    DECLARE @doctor_user_id bigint,@employee_id bigint,@doctor_id bigint;
    EXEC dbo.sp_create_staff_account @actor_user_id=@admin_id,@branch_id=@branch_id,
      @username=@doctor_username,@password_hash=@doctor_password,
      @employee_code=@doctor_code,@employee_type='DOCTOR',
      @full_name=N'Bác sĩ clinical test',@hire_date=@business_date,
      @medical_license_no=@doctor_license,@license_issued_date=@business_date,
      @license_expiry_date=@license_expiry,@default_slot_minutes=30,
      @specialty_id=@specialty_id,@user_id=@doctor_user_id OUTPUT,
      @employee_id=@employee_id OUTPUT,@doctor_id=@doctor_id OUTPUT;
    EXEC dbo.sp_assign_doctor_service @actor_user_id=@admin_id,@branch_id=@branch_id,
      @doctor_id=@doctor_id,@service_id=@consult_id,@custom_duration_min=30;
    DECLARE @patient_id bigint,@patient_public_id uniqueidentifier;
    EXEC dbo.sp_create_patient @actor_user_id=@admin_id,@branch_id=@branch_id,
      @full_name=N'Bệnh nhân clinical test',@date_of_birth='1990-01-01',@gender='OTHER',
      @phone='0908888888',@duplicate_override=1,
      @duplicate_reason=N'Fixture regression clinical.',
      @patient_id=@patient_id OUTPUT,@patient_public_id=@patient_public_id OUTPUT;

    DECLARE @code varchar(40),@encounter_id bigint,@encounter_public_id uniqueidentifier,
            @ticket_id bigint,@display varchar(20);
    EXEC dbo.sp_next_document_number @branch_id,'ENCOUNTER',@business_date,'LK',@code OUTPUT;
    INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,room_id,
      encounter_source,status,arrived_at_utc,created_by_user_id)
    VALUES(@code,@branch_id,@patient_id,@doctor_id,@room_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@admin_id);
    SET @encounter_id=SCOPE_IDENTITY();
    SELECT @encounter_public_id=public_id FROM dbo.encounters WHERE encounter_id=@encounter_id;
    INSERT dbo.encounter_services(encounter_id,service_id,service_code_snapshot,service_name_snapshot,
      service_type_snapshot,quantity,unit_price_snapshot,status,ordered_by_user_id)
    SELECT @encounter_id,service_id,service_code,service_name,service_type,1,200000,'ORDERED',@admin_id
    FROM dbo.services WHERE service_id=@consult_id;
    EXEC dbo.sp_allocate_queue_ticket_internal @actor_user_id=@admin_id,@encounter_id=@encounter_id,
      @queue_type='GENERAL',@priority_level=0,@queue_ticket_id=@ticket_id OUTPUT,@display_number=@display OUTPUT;
    UPDATE dbo.queue_tickets SET status='CALLED',called_at_utc=SYSUTCDATETIME(),called_by_user_id=@admin_id
    WHERE queue_ticket_id=@ticket_id;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    EXEC dbo.sp_clinic_start_encounter @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@room_public_id=@room_public_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.encounters WHERE encounter_id=@encounter_id AND status='IN_PROGRESS')
      THROW 55903,N'Không bắt đầu được lượt đã CALLED.',1;

    IF EXISTS (SELECT 1 FROM (VALUES
      (N'sp_create_medicine_batch'),(N'sp_create_prescription'),(N'sp_add_prescription_item'),
      (N'sp_issue_prescription'),(N'sp_cancel_prescription'),(N'sp_receive_stock'),
      (N'sp_open_dispensation'),(N'sp_dispense_prescription_item'),
      (N'sp_complete_dispensation'),(N'sp_reverse_dispensation_item'),
      (N'sp_cancel_dispensation')
    ) forbidden(name) JOIN sys.database_permissions dp ON dp.major_id=OBJECT_ID(N'dbo.'+forbidden.name)
      WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
      THROW 55930,N'Clinic API còn quyền pharmacy bigint nội bộ.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    DECLARE @medicine_public_id uniqueidentifier,@older_batch_public_id uniqueidentifier,
      @newer_batch_public_id uniqueidentifier,@location_public_id uniqueidentifier,
      @quarantine_public_id uniqueidentifier,@movement_public_id uniqueidentifier,
      @prescription_public_id uniqueidentifier,@item_public_id uniqueidentifier,
      @dispensation_public_id uniqueidentifier,@dispensed_older uniqueidentifier,
      @dispensed_newer uniqueidentifier,@reversal_public_id uniqueidentifier,
      @med_code varchar(30)=CONCAT('PM',LEFT(@suffix,20)),
      @quarantine_code varchar(30)=CONCAT('PQ',LEFT(@suffix,20)),
      @old_batch_number nvarchar(80)=CONCAT(N'OLD-',@suffix),
      @new_batch_number nvarchar(80)=CONCAT(N'NEW-',@suffix),
      @old_expiry date=DATEADD(DAY,60,@business_date),
      @new_expiry date=DATEADD(DAY,120,@business_date),
      @receipt_key uniqueidentifier=NEWID(),@dispense_key uniqueidentifier=NEWID();
    SELECT @location_public_id=public_id FROM dbo.inventory_locations
      WHERE branch_id=@branch_id AND location_code='MAIN-PH';
    IF @location_public_id IS NULL THROW 55931,N'Thiếu quầy cấp seed.',1;
    EXEC dbo.sp_clinic_create_inventory_location @actor_user_id=@admin_id,
      @branch_public_id=@branch_public_id,@code=@quarantine_code,@name=N'Cách ly pharmacy test',
      @type='QUARANTINE',@is_dispensing=0,@location_public_id=@quarantine_public_id OUTPUT;
    EXEC dbo.sp_clinic_create_medicine @actor_user_id=@admin_id,@code=@med_code,
      @generic_name=N'Thuốc kiểm thử',@active_ingredient=N'testcycline',
      @strength=N'100 mg',@dosage_form=N'Viên',@route=N'Uống',@base_unit=N'viên',
      @sale_price=2000,@medicine_public_id=@medicine_public_id OUTPUT;
    EXEC dbo.sp_clinic_create_batch @actor_user_id=@admin_id,@branch_public_id=@branch_public_id,
      @medicine_public_id=@medicine_public_id,@batch_number=@old_batch_number,
      @expiry_date=@old_expiry,@purchase_price=1000,@sale_price=2000,
      @batch_public_id=@older_batch_public_id OUTPUT;
    EXEC dbo.sp_clinic_create_batch @actor_user_id=@admin_id,@branch_public_id=@branch_public_id,
      @medicine_public_id=@medicine_public_id,@batch_number=@new_batch_number,
      @expiry_date=@new_expiry,@purchase_price=1100,@sale_price=2100,
      @batch_public_id=@newer_batch_public_id OUTPUT;
    EXEC dbo.sp_clinic_receive_stock @actor_user_id=@admin_id,@location_public_id=@location_public_id,
      @batch_public_id=@older_batch_public_id,@quantity=2,@idempotency_key=@receipt_key,
      @movement_public_id=@movement_public_id OUTPUT;
    DECLARE @receipt_replay uniqueidentifier;
    EXEC dbo.sp_clinic_receive_stock @actor_user_id=@admin_id,@location_public_id=@location_public_id,
      @batch_public_id=@older_batch_public_id,@quantity=2,@idempotency_key=@receipt_key,
      @movement_public_id=@receipt_replay OUTPUT;
    IF @receipt_replay<>@movement_public_id THROW 55938,N'Retry nhập kho không trả movement cũ.',1;
    EXEC dbo.sp_clinic_receive_stock @actor_user_id=@admin_id,@location_public_id=@location_public_id,
      @batch_public_id=@newer_batch_public_id,@quantity=3,@idempotency_key=@request_id,
      @movement_public_id=@movement_public_id OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.inventory_movements WHERE public_id=@movement_public_id AND movement_type='RECEIPT')
      THROW 55932,N'Nhập kho không tạo ledger movement.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    EXEC dbo.sp_clinic_create_prescription @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@valid_days=7,
      @prescription_public_id=@prescription_public_id OUTPUT;
    EXEC dbo.sp_clinic_add_prescription_item @actor_user_id=@doctor_user_id,
      @prescription_public_id=@prescription_public_id,@medicine_public_id=@medicine_public_id,
      @prescribed_quantity=5,@dose=N'1 viên',@frequency=N'Ngày hai lần',
      @duration_days=3,@usage_instruction=N'Uống sau ăn',@item_public_id=@item_public_id OUTPUT;
    EXEC dbo.sp_clinic_issue_prescription @actor_user_id=@doctor_user_id,
      @prescription_public_id=@prescription_public_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.prescriptions WHERE public_id=@prescription_public_id AND status='ISSUED')
      THROW 55933,N'Đơn không được phát hành.',1;

    DECLARE @diagnosis_public_id uniqueidentifier,@signature_hash binary(32),@computed_signature_hash binary(32);
    EXEC dbo.sp_clinic_add_encounter_diagnosis @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@diagnosis_code='Z01',
      @diagnosis_name=N'Khám và cấp thuốc kiểm thử',@diagnosis_type='FINAL',@is_primary=1,
      @diagnosis_public_id=@diagnosis_public_id OUTPUT;
    UPDATE dbo.encounter_services SET status='COMPLETED',performed_by_user_id=@doctor_user_id,
      performed_at_utc=SYSUTCDATETIME() WHERE encounter_id=@encounter_id AND status='ORDERED';
    EXEC dbo.sp_clinic_complete_encounter @actor_user_id=@doctor_user_id,@encounter_public_id=@encounter_public_id;
    EXEC dbo.sp_clinic_sign_encounter @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@payload_sha256=@signature_hash OUTPUT;
    EXEC dbo.sp_compute_encounter_signature_hash @encounter_id=@encounter_id,
      @canonical_schema_version='CLINIC_RECORD_V3',@payload_sha256=@computed_signature_hash OUTPUT;
    IF @signature_hash IS NULL OR @computed_signature_hash<>@signature_hash OR NOT EXISTS (
      SELECT 1 FROM dbo.encounter_signatures WHERE encounter_id=@encounter_id
        AND canonical_schema_version='CLINIC_RECORD_V3')
      THROW 55940,N'Không tạo hoặc xác minh được chữ ký V3 trước khi cấp thuốc.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC dbo.sp_clinic_open_dispensation @actor_user_id=@admin_id,
      @prescription_public_id=@prescription_public_id,@location_public_id=@location_public_id,
      @dispensation_public_id=@dispensation_public_id OUTPUT;
    EXEC dbo.sp_clinic_dispense_item @actor_user_id=@admin_id,
      @dispensation_public_id=@dispensation_public_id,@prescription_item_public_id=@item_public_id,
      @batch_public_id=@older_batch_public_id,@quantity=2,@idempotency_key=@dispense_key,
      @dispensation_item_public_id=@dispensed_older OUTPUT;
    DECLARE @dispense_replay uniqueidentifier;
    EXEC dbo.sp_clinic_dispense_item @actor_user_id=@admin_id,
      @dispensation_public_id=@dispensation_public_id,@prescription_item_public_id=@item_public_id,
      @batch_public_id=@older_batch_public_id,@quantity=2,@idempotency_key=@dispense_key,
      @dispensation_item_public_id=@dispense_replay OUTPUT;
    IF @dispense_replay<>@dispensed_older THROW 55939,N'Retry cấp thuốc không trả dòng cũ.',1;
    EXEC dbo.sp_clinic_dispense_item @actor_user_id=@admin_id,
      @dispensation_public_id=@dispensation_public_id,@prescription_item_public_id=@item_public_id,
      @batch_public_id=@newer_batch_public_id,@quantity=3,@idempotency_key=@newer_batch_public_id,
      @dispensation_item_public_id=@dispensed_newer OUTPUT;
    EXEC dbo.sp_clinic_complete_dispensation @actor_user_id=@admin_id,
      @dispensation_public_id=@dispensation_public_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.prescriptions WHERE public_id=@prescription_public_id AND status='DISPENSED')
      THROW 55934,N'Đơn chưa chuyển DISPENSED.',1;
    SET @computed_signature_hash=NULL;
    EXEC dbo.sp_compute_encounter_signature_hash @encounter_id=@encounter_id,
      @canonical_schema_version='CLINIC_RECORD_V3',@payload_sha256=@computed_signature_hash OUTPUT;
    IF @computed_signature_hash<>@signature_hash
      THROW 55941,N'Cấp thuốc làm thay đổi hash hồ sơ đã ký.',1;
    EXEC dbo.sp_clinic_pharmacy_workspace @actor_user_id=@admin_id,@branch_public_id=@branch_public_id;
    EXEC dbo.sp_clinic_get_prescription @actor_user_id=@admin_id,@prescription_public_id=@prescription_public_id;
    EXEC dbo.sp_clinic_reverse_dispensation_item @actor_user_id=@admin_id,
      @dispensation_item_public_id=@dispensed_newer,@return_location_public_id=@quarantine_public_id,
      @disposition='QUARANTINE',@reason=N'Kiểm thử đảo cấp vào cách ly',
      @movement_public_id=@reversal_public_id OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.inventory_movements WHERE public_id=@reversal_public_id AND movement_type='REVERSAL')
      OR NOT EXISTS (SELECT 1 FROM dbo.prescriptions WHERE public_id=@prescription_public_id AND status='PARTIALLY_DISPENSED')
      THROW 55935,N'Đảo cấp không cập nhật ledger và đơn.',1;
    SET @computed_signature_hash=NULL;
    EXEC dbo.sp_compute_encounter_signature_hash @encounter_id=@encounter_id,
      @canonical_schema_version='CLINIC_RECORD_V3',@payload_sha256=@computed_signature_hash OUTPUT;
    IF @computed_signature_hash<>@signature_hash
      THROW 55942,N'Đảo cấp thuốc làm thay đổi hash hồ sơ đã ký.',1;
    DECLARE @differences TABLE(locationPublicId varchar(36),batchPublicId varchar(36),
      batchNumber nvarchar(80),balanceQuantity varchar(30),ledgerQuantity varchar(30));
    INSERT @differences EXEC dbo.sp_clinic_reconcile_stock @actor_user_id=@admin_id,
      @branch_public_id=@branch_public_id;
    IF EXISTS (SELECT 1 FROM @differences WHERE batchPublicId IN
      (CONVERT(varchar(36),@older_batch_public_id),CONVERT(varchar(36),@newer_batch_public_id)))
      THROW 55936,N'Balance lệch ledger sau cấp phát/đảo.',1;

    -- A rejected mutation can make the surrounding fixture transaction uncommittable.
    DECLARE @immutable_error int=NULL;
    BEGIN TRY
      UPDATE dbo.prescription_items SET dose=N'Ghi đè' WHERE public_id=@item_public_id;
      SET @immutable_error=0;
    END TRY BEGIN CATCH SET @immutable_error=ERROR_NUMBER(); END CATCH;
    IF @immutable_error<>52064 THROW 55937,N'Nội dung đơn đã phát hành vẫn sửa được.',1;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    SELECT 'PASS' AS pharmacy_core_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

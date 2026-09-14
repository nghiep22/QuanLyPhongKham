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
        (N'sp_cancel_encounter')
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
    DECLARE @medicine_public_id uniqueidentifier,@old_public_id uniqueidentifier,@new_public_id uniqueidentifier,
      @location_public_id uniqueidentifier,@movement_public_id uniqueidentifier,
      @prescription_public_id uniqueidentifier,@item_public_id uniqueidentifier,
      @dispensation_public_id uniqueidentifier,@dispensed_public_id uniqueidentifier,
      @old_number nvarchar(80)=CONCAT(N'FEFO-OLD-',@suffix),
      @new_number nvarchar(80)=CONCAT(N'FEFO-NEW-',@suffix),
      @medicine_code varchar(30)=CONCAT('PF',LEFT(@suffix,20)),
      @old_expiry date=DATEADD(DAY,30,@business_date),
      @new_expiry date=DATEADD(DAY,90,@business_date),
      @receipt_key_1 uniqueidentifier=NEWID(),@receipt_key_2 uniqueidentifier=NEWID();
    SELECT @location_public_id=public_id FROM dbo.inventory_locations
      WHERE branch_id=@branch_id AND location_code='MAIN-PH';
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC dbo.sp_clinic_create_medicine @actor_user_id=@admin_id,@code=@medicine_code,
      @generic_name=N'Thuốc FEFO',@active_ingredient=N'testcycline',@strength=N'100 mg',
      @dosage_form=N'Viên',@route=N'Uống',@base_unit=N'viên',@sale_price=2000,
      @medicine_public_id=@medicine_public_id OUTPUT;
    EXEC dbo.sp_clinic_create_batch @actor_user_id=@admin_id,@branch_public_id=@branch_public_id,
      @medicine_public_id=@medicine_public_id,@batch_number=@old_number,@expiry_date=@old_expiry,
      @purchase_price=1000,@sale_price=2000,@batch_public_id=@old_public_id OUTPUT;
    EXEC dbo.sp_clinic_create_batch @actor_user_id=@admin_id,@branch_public_id=@branch_public_id,
      @medicine_public_id=@medicine_public_id,@batch_number=@new_number,@expiry_date=@new_expiry,
      @purchase_price=1000,@sale_price=2000,@batch_public_id=@new_public_id OUTPUT;
    EXEC dbo.sp_clinic_receive_stock @actor_user_id=@admin_id,@location_public_id=@location_public_id,
      @batch_public_id=@old_public_id,@quantity=2,@idempotency_key=@receipt_key_1,
      @movement_public_id=@movement_public_id OUTPUT;
    EXEC dbo.sp_clinic_receive_stock @actor_user_id=@admin_id,@location_public_id=@location_public_id,
      @batch_public_id=@new_public_id,@quantity=2,@idempotency_key=@receipt_key_2,
      @movement_public_id=@movement_public_id OUTPUT;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    EXEC dbo.sp_clinic_create_prescription @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@valid_days=7,
      @prescription_public_id=@prescription_public_id OUTPUT;
    EXEC dbo.sp_clinic_add_prescription_item @actor_user_id=@doctor_user_id,
      @prescription_public_id=@prescription_public_id,@medicine_public_id=@medicine_public_id,
      @prescribed_quantity=1,@dose=N'1 viên',@frequency=N'Ngày một lần',
      @usage_instruction=N'Uống sau ăn',@item_public_id=@item_public_id OUTPUT;
    EXEC dbo.sp_clinic_issue_prescription @actor_user_id=@doctor_user_id,
      @prescription_public_id=@prescription_public_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC dbo.sp_clinic_open_dispensation @actor_user_id=@admin_id,
      @prescription_public_id=@prescription_public_id,@location_public_id=@location_public_id,
      @dispensation_public_id=@dispensation_public_id OUTPUT;
    DECLARE @fefo_error int=0,@dispense_key uniqueidentifier=NEWID();
    BEGIN TRY
      EXEC dbo.sp_clinic_dispense_item @actor_user_id=@admin_id,
        @dispensation_public_id=@dispensation_public_id,@prescription_item_public_id=@item_public_id,
        @batch_public_id=@new_public_id,@quantity=1,@idempotency_key=@dispense_key,
        @dispensation_item_public_id=@dispensed_public_id OUTPUT;
    END TRY BEGIN CATCH SET @fefo_error=ERROR_NUMBER(); END CATCH;
    IF @fefo_error<>53333 THROW 55940,N'Không chặn cấp lô mới khi lô cũ còn tồn.',1;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    SELECT 'PASS' AS pharmacy_fefo_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

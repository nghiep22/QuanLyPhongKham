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
        (N'sp_cancel_encounter'),(N'sp_compute_encounter_signature_hash'),
        (N'sp_assert_service_result_schema')
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
        (N'sp_clinic_add_encounter_amendment'),(N'sp_clinic_release_encounter_to_patient'),
        (N'sp_clinic_list_patient_clinical_records'),(N'sp_clinic_get_patient_clinical_record')
    ) required(name) WHERE NOT EXISTS (SELECT 1 FROM sys.database_permissions dp
      WHERE dp.major_id=OBJECT_ID(N'dbo.'+required.name)
        AND dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND dp.permission_name='EXECUTE' AND dp.state IN('G','W')))
      THROW 55901,N'Clinic API thiếu quyền clinical public procedure.',1;

    DECLARE @lab_result_schema nvarchar(max)=N'{"type":"object","additionalProperties":false,"required":["value","interpretation"],"properties":{"value":{"type":"number","title":"Giá trị","unit":"mg/dL","minimum":0,"maximum":500},"interpretation":{"type":"string","title":"Nhận định","minLength":1,"enum":["NORMAL","ABNORMAL"]}}}',
            @schema_error int=NULL;
    EXEC dbo.sp_assert_service_result_schema @schema_json=@lab_result_schema;
    BEGIN TRY
      EXEC dbo.sp_assert_service_result_schema @schema_json=@lab_result_schema,
        @result_json=N'{"value":"không phải số","interpretation":"NORMAL"}',@validate_result=1;
    END TRY BEGIN CATCH SET @schema_error=ERROR_NUMBER(); END CATCH;
    IF @schema_error<>53267 THROW 55921,N'Kết quả sai kiểu không bị schema SQL từ chối.',1;
    SET @schema_error=NULL;
    BEGIN TRY
      EXEC dbo.sp_assert_service_result_schema
        @schema_json=N'{"type":"object","additionalProperties":true,"required":[],"properties":{"value":{"type":"number","title":"Giá trị"}}}';
    END TRY BEGIN CATCH SET @schema_error=ERROR_NUMBER(); END CATCH;
    IF @schema_error<>53612 THROW 55922,N'Schema danh mục không an toàn vẫn được chấp nhận.',1;

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
      @requires_doctor=0,@service_id=@lab_id OUTPUT,@result_schema_json=@lab_result_schema;
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
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'clinical-patient-',@suffix),REPLICATE('x',60),N'Tài khoản bệnh nhân clinical','ACTIVE');
    DECLARE @portal_user_id bigint=SCOPE_IDENTITY(),@patient_role_id bigint=(SELECT role_id FROM dbo.roles WHERE role_code='PATIENT');
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@portal_user_id,@patient_role_id,NULL,@admin_id);
    INSERT dbo.user_patient_access(user_id,patient_id,relationship_type,status,is_booking_allowed,
      verified_by_user_id,verified_branch_id,verified_at_utc)
    VALUES(@portal_user_id,@patient_id,'SELF','ACTIVE',1,@admin_id,@branch_id,SYSUTCDATETIME());

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

    EXEC dbo.sp_clinic_update_encounter_clinical_notes @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@history_of_present_illness=N'Đau đầu hai ngày',
      @physical_examination=N'Tỉnh, tiếp xúc tốt',@clinical_assessment=N'Cần theo dõi',
      @treatment_plan=N'Xét nghiệm',@follow_up_instructions=N'Tái khám nếu nặng hơn';
    DECLARE @vital_public_id uniqueidentifier,@diagnosis_public_id uniqueidentifier,
            @ordered_public_id uniqueidentifier,@result_public_id uniqueidentifier;
    EXEC dbo.sp_clinic_add_vital_signs @actor_user_id=@doctor_user_id,@encounter_public_id=@encounter_public_id,
      @temperature_c=37.1,@pulse_bpm=82,@height_cm=170,@weight_kg=68,
      @vital_sign_public_id=@vital_public_id OUTPUT;
    EXEC dbo.sp_clinic_add_encounter_diagnosis @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@diagnosis_code='R51',
      @diagnosis_name=N'Đau đầu',@diagnosis_type='FINAL',@is_primary=1,
      @diagnosis_public_id=@diagnosis_public_id OUTPUT;
    EXEC dbo.sp_clinic_order_encounter_service @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@service_public_id=@lab_public_id,@quantity=1,
      @encounter_service_public_id=@ordered_public_id OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.encounter_services WHERE public_id=@ordered_public_id AND unit_price_snapshot=321000)
      THROW 55904,N'Chỉ định không chụp đúng giá chi nhánh.',1;
    DECLARE @lab_version binary(8)=(SELECT row_ver FROM dbo.services WHERE service_id=@lab_id),
            @changed_schema nvarchar(max)=N'{"type":"object","additionalProperties":false,"required":["value"],"properties":{"value":{"type":"string","title":"Giá trị mới","minLength":1}}}';
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC dbo.sp_update_service @actor_user_id=@admin_id,@service_id=@lab_id,
      @service_category_id=@lab_category,@specialty_id=@specialty_id,
      @service_name=N'Xét nghiệm clinical test',@service_type='LAB',@default_duration_min=30,
      @current_price=1000,@requires_doctor=0,@is_active=1,@expected_row_ver=@lab_version,
      @result_schema_json=@changed_schema;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    IF JSON_VALUE((SELECT result_schema_json FROM dbo.services WHERE service_id=@lab_id),'$.properties.value.type')<>'string'
      OR JSON_VALUE((SELECT result_schema_snapshot_json FROM dbo.encounter_services WHERE public_id=@ordered_public_id),'$.properties.value.type')<>'number'
      THROW 55924,N'Thay đổi catalog đã làm đổi schema snapshot của chỉ định cũ.',1;
    SET @schema_error=NULL;
    SET XACT_ABORT OFF;
    BEGIN TRY
      EXEC dbo.sp_clinic_finalize_service_result @actor_user_id=@doctor_user_id,
        @encounter_service_public_id=@ordered_public_id,
        @result_json=N'{"value":"không phải số","interpretation":"NORMAL"}',
        @service_result_public_id=@result_public_id OUTPUT;
    END TRY BEGIN CATCH SET @schema_error=ERROR_NUMBER(); END CATCH;
    SET XACT_ABORT ON;
    IF @schema_error<>53267 OR XACT_STATE()<>1
      THROW 55923,N'Public finalize không từ chối schema mismatch an toàn.',1;
    EXEC dbo.sp_clinic_finalize_service_result @actor_user_id=@doctor_user_id,
      @encounter_service_public_id=@ordered_public_id,@summary=N'Kết quả bình thường',
      @result_json=N'{"value":13.5,"interpretation":"NORMAL"}',
      @service_result_public_id=@result_public_id OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.service_results WHERE public_id=@result_public_id AND status='FINAL'
        AND TRY_CONVERT(decimal(10,2),JSON_VALUE(result_json,'$.value'))=13.5)
      OR NOT EXISTS (SELECT 1 FROM dbo.encounter_services WHERE public_id=@ordered_public_id
        AND JSON_VALUE(result_schema_snapshot_json,'$.properties.value.type')='number')
      THROW 55905,N'Kết quả FINAL không được lưu.',1;
    EXEC dbo.sp_clinic_list_encounters @actor_user_id=@doctor_user_id,
      @branch_public_id=@branch_public_id,@statuses='IN_PROGRESS';
    EXEC dbo.sp_clinic_get_encounter @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id;
    EXEC dbo.sp_clinic_complete_encounter @actor_user_id=@doctor_user_id,@encounter_public_id=@encounter_public_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.encounters WHERE encounter_id=@encounter_id AND status='COMPLETED')
      OR NOT EXISTS (SELECT 1 FROM dbo.queue_tickets WHERE queue_ticket_id=@ticket_id AND status='COMPLETED')
      THROW 55906,N'Hoàn tất không đóng đồng bộ lượt khám và ticket.',1;
    DECLARE @signature_hash binary(32),@retry_hash binary(32),@amendment_public_id uniqueidentifier,
            @amendment_hash binary(32);
    EXEC dbo.sp_clinic_sign_encounter @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@payload_sha256=@signature_hash OUTPUT;
    EXEC dbo.sp_clinic_sign_encounter @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@payload_sha256=@retry_hash OUTPUT;
    IF @signature_hash IS NULL OR @retry_hash<>@signature_hash OR NOT EXISTS (
      SELECT 1 FROM dbo.encounter_signatures WHERE encounter_id=@encounter_id
        AND canonical_schema_version='CLINIC_RECORD_V3' AND payload_sha256=@signature_hash)
      THROW 55907,N'Chữ ký hash không ổn định hoặc không lưu.',1;
    DECLARE @computed_signature_hash binary(32);
    EXEC dbo.sp_compute_encounter_signature_hash @encounter_id=@encounter_id,
      @canonical_schema_version='CLINIC_RECORD_V3',@payload_sha256=@computed_signature_hash OUTPUT;
    IF @computed_signature_hash<>@signature_hash
      THROW 55915,N'Manifest V3 không xác minh lại được ngay sau khi ký.',1;
    DECLARE @history TABLE
    (
      publicId varchar(36),code varchar(40),arrivedAtUtc datetime2(3),completedAtUtc datetime2(3),
      signedAtUtc datetime2(3),releasedAtUtc datetime2(3),chiefComplaint nvarchar(1000),
      patientPublicId varchar(36),patientCode varchar(30),patientName nvarchar(200),
      branchPublicId varchar(36),branchName nvarchar(200),timezoneName sysname,
      doctorPublicId varchar(36),doctorName nvarchar(200),primaryDiagnosisCode varchar(30),
      primaryDiagnosisName nvarchar(500)
    );
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@portal_user_id;
    INSERT @history EXEC dbo.sp_clinic_list_patient_clinical_records
      @actor_user_id=@portal_user_id,@patient_public_id=@patient_public_id;
    IF EXISTS (SELECT 1 FROM @history)
      THROW 55911,N'Bệnh nhân thấy hồ sơ trước khi bác sĩ công bố.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    EXEC dbo.sp_clinic_release_encounter_to_patient @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id;
    EXEC dbo.sp_clinic_release_encounter_to_patient @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.clinical_record_releases WHERE encounter_id=@encounter_id
        AND released_at_utc IS NOT NULL AND released_by_user_id=@doctor_user_id)
      OR (SELECT COUNT(*) FROM dbo.clinical_record_releases WHERE encounter_id=@encounter_id)<>1
      THROW 55912,N'Công bố không tạo đúng một trạng thái append-only cho hồ sơ đã ký.',1;
    DELETE @history;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@portal_user_id;
    INSERT @history EXEC dbo.sp_clinic_list_patient_clinical_records
      @actor_user_id=@portal_user_id,@patient_public_id=@patient_public_id;
    IF NOT EXISTS (SELECT 1 FROM @history WHERE publicId=CONVERT(varchar(36),@encounter_public_id)
        AND primaryDiagnosisCode='R51')
      THROW 55913,N'Lịch sử đã công bố không xuất hiện cho tài khoản được liên kết.',1;
    EXEC dbo.sp_clinic_get_patient_clinical_record @actor_user_id=@portal_user_id,
      @patient_public_id=@patient_public_id,@encounter_public_id=@encounter_public_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE action_code='CLINICAL_RECORD_RELEASED'
        AND entity_id=CONVERT(varchar(36),@encounter_public_id))
      OR NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE action_code='PATIENT_CLINICAL_RECORD_READ'
        AND entity_id=CONVERT(varchar(36),@encounter_public_id))
      OR NOT EXISTS (SELECT 1 FROM dbo.outbox_events WHERE event_type='CLINICAL_RECORD_RELEASED'
        AND aggregate_id=CONVERT(varchar(36),@encounter_public_id))
      THROW 55914,N'Công bố/đọc hồ sơ chưa có audit hoặc outbox bằng public ID.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    EXEC dbo.sp_clinic_add_encounter_amendment @actor_user_id=@doctor_user_id,
      @encounter_public_id=@encounter_public_id,@reason=N'Bổ sung thông tin sau ký',
      @amendment_content=N'Đã tư vấn bệnh nhân về dấu hiệu cần quay lại.',
      @amendment_public_id=@amendment_public_id OUTPUT,@amendment_hash=@amendment_hash OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.encounter_amendments
      WHERE public_id=@amendment_public_id AND previous_chain_hash=@signature_hash AND amendment_hash=@amendment_hash)
      THROW 55908,N'Phụ lục không nối đúng hash chữ ký.',1;
    IF NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE action_code='ENCOUNTER_SIGNED'
      AND entity_id=CONVERT(varchar(36),@encounter_public_id))
      OR NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE action_code='ENCOUNTER_AMENDMENT_ADDED'
        AND entity_id=CONVERT(varchar(36),@amendment_public_id)
        AND JSON_VALUE(new_values_json,'$.encounterPublicId')=CONVERT(varchar(36),@encounter_public_id))
      THROW 55910,N'Audit lâm sàng chưa dùng public ID.',1;

    -- Bypass chỉ bỏ qua bước CALLED cho đúng ticket đang đứng đầu theo priority/FIFO.
    DECLARE @lower_code varchar(40),@lower_encounter_id bigint,@lower_ticket_id bigint,@lower_display varchar(20),
            @bypass_code varchar(40),@bypass_encounter_id bigint,@bypass_encounter_public_id uniqueidentifier,
            @bypass_ticket_id bigint,@bypass_ticket_public_id uniqueidentifier,@bypass_display varchar(20),
            @bypass_reason nvarchar(500)=N'Bệnh nhân cần được đưa thẳng vào phòng khám';
    EXEC dbo.sp_next_document_number @branch_id,'ENCOUNTER',@business_date,'LK',@lower_code OUTPUT;
    INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,room_id,
      encounter_source,status,arrived_at_utc,created_by_user_id)
    VALUES(@lower_code,@branch_id,@patient_id,@doctor_id,@room_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@admin_id);
    SET @lower_encounter_id=SCOPE_IDENTITY();
    EXEC dbo.sp_allocate_queue_ticket_internal @actor_user_id=@admin_id,@encounter_id=@lower_encounter_id,
      @queue_type='LAB',@priority_level=0,@queue_ticket_id=@lower_ticket_id OUTPUT,@display_number=@lower_display OUTPUT;
    EXEC dbo.sp_next_document_number @branch_id,'ENCOUNTER',@business_date,'LK',@bypass_code OUTPUT;
    INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,room_id,
      encounter_source,status,arrived_at_utc,created_by_user_id)
    VALUES(@bypass_code,@branch_id,@patient_id,@doctor_id,@room_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@admin_id);
    SET @bypass_encounter_id=SCOPE_IDENTITY();
    SELECT @bypass_encounter_public_id=public_id FROM dbo.encounters WHERE encounter_id=@bypass_encounter_id;
    EXEC dbo.sp_allocate_queue_ticket_internal @actor_user_id=@admin_id,@encounter_id=@bypass_encounter_id,
      @queue_type='LAB',@priority_level=9,@queue_ticket_id=@bypass_ticket_id OUTPUT,@display_number=@bypass_display OUTPUT;
    SELECT @bypass_ticket_public_id=public_id FROM dbo.queue_tickets WHERE queue_ticket_id=@bypass_ticket_id;
    EXEC dbo.sp_clinic_start_encounter @actor_user_id=@doctor_user_id,
      @encounter_public_id=@bypass_encounter_public_id,@room_public_id=@room_public_id,
      @queue_bypass_reason=@bypass_reason;
    IF NOT EXISTS (SELECT 1 FROM dbo.encounters WHERE encounter_id=@bypass_encounter_id AND status='IN_PROGRESS')
      OR NOT EXISTS (SELECT 1 FROM dbo.queue_tickets WHERE queue_ticket_id=@bypass_ticket_id AND status='SERVING'
        AND called_at_utc IS NOT NULL AND called_by_user_id=@doctor_user_id AND service_started_at_utc IS NOT NULL)
      OR NOT EXISTS (SELECT 1 FROM dbo.queue_tickets WHERE queue_ticket_id=@lower_ticket_id AND status='WAITING')
      THROW 55916,N'Bypass không giữ đúng thứ tự priority/FIFO hoặc không chuyển trạng thái nguyên tử.',1;
    IF NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE action_code='QUEUE_TICKET_CALL_BYPASSED'
        AND entity_id=CONVERT(varchar(36),@bypass_ticket_public_id)
        AND JSON_VALUE(new_values_json,'$.reason')=@bypass_reason)
      OR NOT EXISTS (SELECT 1 FROM dbo.outbox_events WHERE event_type='QUEUE_TICKET_CALL_BYPASSED'
        AND aggregate_id=CONVERT(varchar(36),@bypass_ticket_public_id)
        AND JSON_VALUE(payload_json,'$.encounterPublicId')=CONVERT(varchar(36),@bypass_encounter_public_id)
        AND JSON_VALUE(payload_json,'$.reason') IS NULL)
      THROW 55917,N'Bypass chưa có audit lý do hoặc outbox metadata-only bằng public ID.',1;

    -- Negative case at end: the guard may make the fixture transaction uncommittable.
    DECLARE @immutable_error int=NULL;
    BEGIN TRY
      UPDATE dbo.encounter_diagnoses SET diagnosis_name_snapshot=N'Bị ghi đè'
      WHERE public_id=@diagnosis_public_id;
      SET @immutable_error=0;
    END TRY BEGIN CATCH SET @immutable_error=ERROR_NUMBER(); END CATCH;
    IF @immutable_error<>52032 THROW 55909,N'Hồ sơ đã ký vẫn sửa được chẩn đoán.',1;

    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    SELECT 'PASS' AS clinical_core_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

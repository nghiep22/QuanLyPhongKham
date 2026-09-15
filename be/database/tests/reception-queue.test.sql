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
    IF EXISTS(
        SELECT required.object_name FROM (VALUES
          (N'sp_clinic_reception_branches'),(N'sp_clinic_get_reception'),(N'sp_clinic_search_reception_patients'),
          (N'sp_clinic_check_in_appointment'),(N'sp_clinic_create_walk_in_encounter'),
          (N'sp_clinic_call_next_queue_ticket'),(N'sp_clinic_cancel_encounter')
        ) required(object_name)
        WHERE NOT EXISTS(SELECT 1 FROM sys.database_permissions dp
          WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
            AND dp.major_id=OBJECT_ID(N'dbo.'+required.object_name) AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
    ) THROW 55800,N'clinic_api_executor thiếu quyền reception/queue public procedures.',1;
    IF EXISTS(
        SELECT forbidden.object_name FROM (VALUES
          (N'sp_check_in_appointment'),(N'sp_create_walk_in_encounter'),(N'sp_call_next_queue_ticket'),
          (N'sp_cancel_encounter')
        ) forbidden(object_name)
        WHERE EXISTS(SELECT 1 FROM sys.database_permissions dp
          WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
            AND dp.major_id=OBJECT_ID(N'dbo.'+forbidden.object_name) AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
    ) THROW 55801,N'clinic_api_executor còn quyền gọi command bigint nội bộ.',1;

    BEGIN TRANSACTION;
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID()),@request_id uniqueidentifier=NEWID();
    DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN'),
            @category_id bigint=(SELECT service_category_id FROM dbo.service_categories WHERE category_code='CONSULTATION'),
            @specialty_id bigint=(SELECT specialty_id FROM dbo.specialties WHERE specialty_code='GENERAL');
    IF @branch_id IS NULL OR @category_id IS NULL OR @specialty_id IS NULL
        THROW 55802,N'Thiếu dữ liệu seed cho regression reception/queue.',1;
    UPDATE dbo.branches SET check_in_early_minutes=720,check_in_late_minutes=1440 WHERE branch_id=@branch_id;
    DECLARE @branch_public_id uniqueidentifier=(SELECT public_id FROM dbo.branches WHERE branch_id=@branch_id);

    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'reception-admin-',@suffix),REPLICATE('x',60),N'Reception Admin','ACTIVE');
    DECLARE @admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

    DECLARE @business_date date,@timezone sysname=(SELECT timezone_name FROM dbo.branches WHERE branch_id=@branch_id);
    EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
    DECLARE @weekday tinyint=((DATEDIFF(DAY,CONVERT(date,'19000101'),@business_date)%7)+1);

    DECLARE @room_id bigint,@room_public_id uniqueidentifier,@room_code varchar(30)=CONCAT('RQ',LEFT(@suffix,20));
    EXEC dbo.sp_create_room @actor_user_id=@admin_id,@branch_id=@branch_id,
      @room_code=@room_code,@room_name=N'Phòng reception test',@room_type='CONSULTATION',
      @floor_no=1,@capacity=1,@room_id=@room_id OUTPUT;
    SELECT @room_public_id=public_id FROM dbo.rooms WHERE room_id=@room_id;

    DECLARE @service_id bigint,@service_public_id uniqueidentifier,@price_id bigint,@branch_price decimal(19,2)=321000,
            @service_code varchar(30)=CONCAT('RQ',LEFT(@suffix,20));
    EXEC dbo.sp_create_service @actor_user_id=@admin_id,@branch_id=NULL,@service_category_id=@category_id,
      @specialty_id=@specialty_id,@service_code=@service_code,@service_name=N'Khám reception test',
      @service_type='CONSULTATION',@default_duration_min=30,@current_price=111000,@requires_doctor=1,
      @service_id=@service_id OUTPUT;
    SELECT @service_public_id=public_id FROM dbo.services WHERE service_id=@service_id;
    EXEC dbo.sp_set_branch_service_price @actor_user_id=@admin_id,@branch_id=@branch_id,@service_id=@service_id,
      @price_amount=@branch_price,@effective_from=@business_date,@is_available=1,@service_branch_price_id=@price_id OUTPUT;

    DECLARE @doctor_user_id bigint,@employee_id bigint,@doctor_id bigint,@doctor_public_id uniqueidentifier,
            @doctor_username nvarchar(80)=CONCAT(N'reception-doctor-',@suffix),
            @doctor_password varchar(255)=REPLICATE('x',60),@doctor_code varchar(30)=CONCAT('RD',LEFT(@suffix,20)),
            @doctor_license nvarchar(100)=CONCAT(N'RQ-',@suffix),@license_expiry date=DATEADD(YEAR,1,@business_date);
    EXEC dbo.sp_create_staff_account @actor_user_id=@admin_id,@branch_id=@branch_id,
      @username=@doctor_username,@password_hash=@doctor_password,@employee_code=@doctor_code,
      @employee_type='DOCTOR',@full_name=N'Bác sĩ Reception',@hire_date=@business_date,
      @medical_license_no=@doctor_license,@license_issued_date=@business_date,@license_expiry_date=@license_expiry,
      @default_slot_minutes=30,@accepts_online_booking=1,
      @specialty_id=@specialty_id,@user_id=@doctor_user_id OUTPUT,@employee_id=@employee_id OUTPUT,@doctor_id=@doctor_id OUTPUT;
    SELECT @doctor_public_id=public_id FROM dbo.doctors WHERE doctor_id=@doctor_id;
    EXEC dbo.sp_assign_doctor_service @actor_user_id=@admin_id,@branch_id=@branch_id,
      @doctor_id=@doctor_id,@service_id=@service_id,@custom_duration_min=30;
    DECLARE @schedule_id bigint,@schedule_public_id uniqueidentifier;
    EXEC dbo.sp_create_doctor_working_schedule @actor_user_id=@admin_id,@doctor_id=@doctor_id,
      @branch_id=@branch_id,@room_id=@room_id,@weekday_iso=@weekday,@local_start_time='00:00',
      @local_end_time='23:59',@slot_duration_min=30,@effective_from=@business_date,@effective_to=@business_date,
      @booking_horizon_days=1,@working_schedule_id=@schedule_id OUTPUT,@working_schedule_public_id=@schedule_public_id OUTPUT;

    DECLARE @local_start datetime2(3)=CONVERT(datetime2(3),CONCAT(CONVERT(char(10),@business_date,126),'T12:00:00')),
            @local_end datetime2(3)=CONVERT(datetime2(3),CONCAT(CONVERT(char(10),@business_date,126),'T12:30:00')),
            @starts_at_utc datetime2(3),@ends_at_utc datetime2(3);
    SELECT @starts_at_utc=CONVERT(datetime2(3),(@local_start AT TIME ZONE @timezone) AT TIME ZONE 'UTC'),
           @ends_at_utc=CONVERT(datetime2(3),(@local_end AT TIME ZONE @timezone) AT TIME ZONE 'UTC');
    INSERT dbo.appointment_slots(working_schedule_id,doctor_id,branch_id,room_id,service_date_local,
      start_time_local,end_time_local,starts_at_utc,ends_at_utc,booking_opens_at_utc,booking_closes_at_utc,status)
    VALUES(@schedule_id,@doctor_id,@branch_id,@room_id,@business_date,'12:00','12:30',@starts_at_utc,@ends_at_utc,
      DATEADD(DAY,-1,@starts_at_utc),DATEADD(MINUTE,-1,@starts_at_utc),'OPEN');
    DECLARE @slot_id bigint=SCOPE_IDENTITY();

    DECLARE @patient_id bigint,@patient_public_id uniqueidentifier;
    EXEC dbo.sp_create_patient @actor_user_id=@admin_id,@branch_id=@branch_id,@full_name=N'Bệnh nhân Reception',
      @date_of_birth='1990-01-01',@gender='OTHER',@phone='0908888888',@duplicate_override=1,
      @duplicate_reason=N'Tạo dữ liệu regression reception.',@patient_id=@patient_id OUTPUT,@patient_public_id=@patient_public_id OUTPUT;
    DECLARE @appointment_code varchar(40);
    EXEC dbo.sp_next_document_number @branch_id,'APPOINTMENT',@business_date,'LH',@appointment_code OUTPUT;
    INSERT dbo.appointments(appointment_code,branch_id,slot_id,patient_id,doctor_id,service_id,booking_channel,status,
      scheduled_start_utc,scheduled_end_utc,hold_expires_at_utc,booked_by_user_id,confirmed_by_user_id,confirmed_at_utc,occupies_slot)
    VALUES(@appointment_code,@branch_id,@slot_id,@patient_id,@doctor_id,@service_id,'COUNTER','CONFIRMED',
      @starts_at_utc,@ends_at_utc,NULL,@admin_id,@admin_id,SYSUTCDATETIME(),1);
    DECLARE @appointment_id bigint=SCOPE_IDENTITY(),@appointment_public_id uniqueidentifier;
    SELECT @appointment_public_id=public_id FROM dbo.appointments WHERE appointment_id=@appointment_id;

    DECLARE @check_key uniqueidentifier=NEWID(),@encounter_public_id uniqueidentifier,
            @ticket_public_id uniqueidentifier,@display varchar(20);
    EXEC dbo.sp_clinic_check_in_appointment @actor_user_id=@admin_id,@appointment_public_id=@appointment_public_id,
      @priority_level=2,@idempotency_key=@check_key,@encounter_public_id=@encounter_public_id OUTPUT,
      @queue_ticket_public_id=@ticket_public_id OUTPUT,@display_number=@display OUTPUT;
    DECLARE @check_encounter_id bigint=(SELECT encounter_id FROM dbo.encounters WHERE public_id=@encounter_public_id),
            @check_ticket_id bigint=(SELECT queue_ticket_id FROM dbo.queue_tickets WHERE public_id=@ticket_public_id);
    IF @check_encounter_id IS NULL OR @check_ticket_id IS NULL OR @display IS NULL
      THROW 55803,N'Check-in không trả đủ public resource.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.appointments WHERE appointment_id=@appointment_id AND status='CHECKED_IN')
      OR NOT EXISTS(SELECT 1 FROM dbo.encounters WHERE encounter_id=@check_encounter_id AND encounter_source='APPOINTMENT' AND status='WAITING')
      OR NOT EXISTS(SELECT 1 FROM dbo.queue_tickets WHERE queue_ticket_id=@check_ticket_id AND status='WAITING')
      THROW 55804,N'Check-in không chuyển ba aggregate đúng trạng thái.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.encounter_services WHERE encounter_id=@check_encounter_id AND unit_price_snapshot=@branch_price)
      THROW 55805,N'Check-in không chụp giá chi nhánh đang hiệu lực.',1;
    DECLARE @retry_encounter uniqueidentifier,@retry_ticket uniqueidentifier,@retry_display varchar(20);
    EXEC dbo.sp_clinic_check_in_appointment @actor_user_id=@admin_id,@appointment_public_id=@appointment_public_id,
      @priority_level=2,@idempotency_key=@check_key,@encounter_public_id=@retry_encounter OUTPUT,
      @queue_ticket_public_id=@retry_ticket OUTPUT,@display_number=@retry_display OUTPUT;
    IF @retry_encounter<>@encounter_public_id OR @retry_ticket<>@ticket_public_id OR @retry_display<>@display
      THROW 55806,N'Retry check-in không trả cùng lượt khám và số.',1;

    DECLARE @cancel_prescription_code varchar(40)=CONCAT('RXC',LEFT(@suffix,20)),
            @cancel_invoice_code varchar(40)=CONCAT('IVC',LEFT(@suffix,20));
    INSERT dbo.prescriptions(prescription_code,encounter_id,patient_id,doctor_id,branch_id,status,created_by_user_id)
    VALUES(@cancel_prescription_code,@check_encounter_id,@patient_id,@doctor_id,@branch_id,'DRAFT',@doctor_user_id);
    DECLARE @cancel_prescription_id bigint=SCOPE_IDENTITY();
    INSERT dbo.invoices(invoice_number,encounter_id,patient_id,branch_id,status,created_by_user_id)
    VALUES(@cancel_invoice_code,@check_encounter_id,@patient_id,@branch_id,'DRAFT',@admin_id);
    DECLARE @cancel_invoice_id bigint=SCOPE_IDENTITY();
    DECLARE @cancel_reason nvarchar(500)=N'Bệnh nhân xin dừng lượt khám tại quầy.';
    EXEC dbo.sp_clinic_cancel_encounter @actor_user_id=@admin_id,
      @encounter_public_id=@encounter_public_id,@reason=@cancel_reason;
    IF NOT EXISTS(SELECT 1 FROM dbo.encounters WHERE public_id=@encounter_public_id AND status='CANCELLED')
      OR NOT EXISTS(SELECT 1 FROM dbo.queue_tickets WHERE public_id=@ticket_public_id AND status='CANCELLED')
      OR NOT EXISTS(SELECT 1 FROM dbo.appointments WHERE public_id=@appointment_public_id AND status='CANCELLED' AND occupies_slot=0)
      OR EXISTS(SELECT 1 FROM dbo.encounter_services WHERE encounter_id=@check_encounter_id AND status<>'CANCELLED')
      OR NOT EXISTS(SELECT 1 FROM dbo.prescriptions WHERE prescription_id=@cancel_prescription_id AND status='CANCELLED')
      OR NOT EXISTS(SELECT 1 FROM dbo.invoices WHERE invoice_id=@cancel_invoice_id AND status='VOID' AND is_active_invoice=0)
      THROW 55814,N'Hủy lượt không đóng đồng bộ encounter, queue, appointment và dịch vụ mở.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.audit_logs WHERE action_code='ENCOUNTER_CANCELLED'
      AND entity_id=CONVERT(varchar(36),@encounter_public_id)
      AND JSON_VALUE(new_values_json,'$.reason')=@cancel_reason)
      THROW 55815,N'Audit hủy lượt không dùng public ID hoặc thiếu lý do.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@encounter_public_id)
      AND event_type='ENCOUNTER_CANCELLED')
      OR NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@appointment_public_id)
        AND event_type='APPOINTMENT_CANCELLED')
      THROW 55816,N'Hủy lượt thiếu outbox encounter/appointment bằng public ID.',1;
    DECLARE @encounter_cancel_event_count int=(SELECT COUNT(*) FROM dbo.outbox_events
      WHERE aggregate_id=CONVERT(varchar(36),@encounter_public_id) AND event_type='ENCOUNTER_CANCELLED');
    EXEC dbo.sp_clinic_cancel_encounter @actor_user_id=@admin_id,
      @encounter_public_id=@encounter_public_id,@reason=@cancel_reason;
    IF (SELECT COUNT(*) FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@encounter_public_id)
      AND event_type='ENCOUNTER_CANCELLED')<>@encounter_cancel_event_count
      THROW 55817,N'Retry hủy lượt đã tạo outbox trùng.',1;

    DECLARE @walk1_encounter uniqueidentifier,@walk1_ticket uniqueidentifier,@walk1_display varchar(20),
            @walk2_encounter uniqueidentifier,@walk2_ticket uniqueidentifier,@walk2_display varchar(20);
    DECLARE @walk1_key uniqueidentifier=NEWID(),@walk2_key uniqueidentifier=NEWID();
    EXEC dbo.sp_clinic_create_walk_in_encounter @actor_user_id=@admin_id,@branch_public_id=@branch_public_id,
      @patient_public_id=@patient_public_id,@doctor_public_id=@doctor_public_id,@room_public_id=@room_public_id,
      @service_public_id=@service_public_id,@priority_level=8,@idempotency_key=@walk1_key,
      @encounter_public_id=@walk1_encounter OUTPUT,@queue_ticket_public_id=@walk1_ticket OUTPUT,@display_number=@walk1_display OUTPUT;
    EXEC dbo.sp_clinic_create_walk_in_encounter @actor_user_id=@admin_id,@branch_public_id=@branch_public_id,
      @patient_public_id=@patient_public_id,@doctor_public_id=@doctor_public_id,@room_public_id=@room_public_id,
      @service_public_id=@service_public_id,@priority_level=0,@idempotency_key=@walk2_key,
      @encounter_public_id=@walk2_encounter OUTPUT,@queue_ticket_public_id=@walk2_ticket OUTPUT,@display_number=@walk2_display OUTPUT;
    IF EXISTS(SELECT 1 FROM dbo.encounters WHERE public_id IN(@walk1_encounter,@walk2_encounter) AND appointment_id IS NOT NULL)
      THROW 55807,N'Walk-in đã tạo lịch hẹn giả.',1;
    IF (SELECT MIN(queue_number) FROM dbo.queue_tickets WHERE public_id IN(@ticket_public_id,@walk1_ticket,@walk2_ticket))
       >=(SELECT MAX(queue_number) FROM dbo.queue_tickets WHERE public_id IN(@ticket_public_id,@walk1_ticket,@walk2_ticket))
      THROW 55808,N'Bộ cấp số không tăng đơn điệu.',1;

    DECLARE @called_ticket uniqueidentifier,@called_encounter uniqueidentifier,@called_display varchar(20);
    EXEC dbo.sp_clinic_call_next_queue_ticket @actor_user_id=@admin_id,
      @branch_public_id=@branch_public_id,@queue_type='GENERAL',
      @queue_ticket_public_id=@called_ticket OUTPUT,@encounter_public_id=@called_encounter OUTPUT,@display_number=@called_display OUTPUT;
    IF @called_ticket<>@walk1_ticket OR NOT EXISTS(SELECT 1 FROM dbo.queue_tickets WHERE public_id=@called_ticket AND status='CALLED')
      THROW 55809,N'Call-next không ưu tiên mức cao nhất rồi FIFO.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@called_ticket) AND event_type='QUEUE_TICKET_CALLED')
      THROW 55810,N'Call-next không ghi outbox bằng public ID.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    DECLARE @called_encounter_id bigint=(SELECT encounter_id FROM dbo.encounters WHERE public_id=@called_encounter);
    EXEC dbo.sp_start_encounter @actor_user_id=@doctor_user_id,
      @encounter_id=@called_encounter_id,@room_id=@room_id;
    IF NOT EXISTS(SELECT 1 FROM dbo.queue_tickets WHERE public_id=@called_ticket AND status='SERVING')
      OR NOT EXISTS(SELECT 1 FROM dbo.encounters WHERE public_id=@called_encounter AND status='IN_PROGRESS')
      THROW 55811,N'Bắt đầu lượt khám không chuyển ticket sang SERVING đồng bộ.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@encounter_public_id) AND event_type='APPOINTMENT_CHECKED_IN')
      OR NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@walk1_encounter) AND event_type='WALK_IN_ENCOUNTER_CREATED')
      THROW 55812,N'Check-in/walk-in thiếu outbox public ID.',1;

    -- Negative case chạy cuối: procedure rollback transaction test khi ticket chưa CALLED.
    DECLARE @start_error int=NULL,@uncalled_encounter_id bigint=(SELECT encounter_id FROM dbo.encounters WHERE public_id=@walk2_encounter);
    BEGIN TRY
      EXEC dbo.sp_start_encounter @actor_user_id=@doctor_user_id,
        @encounter_id=@uncalled_encounter_id,@room_id=@room_id;
      SET @start_error=0;
    END TRY BEGIN CATCH SET @start_error=ERROR_NUMBER(); END CATCH;
    IF @start_error<>53256 THROW 55813,N'Lượt khám chưa được gọi vẫn có thể bắt đầu.',1;

    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    SELECT 'PASS' AS reception_queue_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

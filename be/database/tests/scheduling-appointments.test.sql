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
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID()),@request_id uniqueidentifier=NEWID();
    DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
    DECLARE @category_id bigint=(SELECT service_category_id FROM dbo.service_categories WHERE category_code='CONSULTATION');
    DECLARE @specialty_id bigint=(SELECT specialty_id FROM dbo.specialties WHERE specialty_code='GENERAL');
    IF @branch_id IS NULL OR @category_id IS NULL OR @specialty_id IS NULL
        THROW 55700,N'Thiếu dữ liệu seed cho regression lịch hẹn.',1;
    IF EXISTS(
        SELECT required.object_name FROM (VALUES
          (N'sp_clinic_get_scheduling'),(N'sp_clinic_create_working_schedule'),(N'sp_clinic_generate_slots'),
          (N'sp_clinic_book_appointment'),(N'sp_clinic_reschedule_appointment'),
          (N'sp_clinic_confirm_appointment'),(N'sp_clinic_cancel_appointment'),
          (N'sp_clinic_mark_appointment_no_show'),(N'sp_clinic_list_my_appointments'),
          (N'sp_clinic_list_admin_appointments'),(N'sp_clinic_get_appointment')
        ) required(object_name)
        WHERE NOT EXISTS(SELECT 1 FROM sys.database_permissions dp
          WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
            AND dp.major_id=OBJECT_ID(N'dbo.'+required.object_name) AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
    ) THROW 55701,N'clinic_api_executor thiếu quyền scheduling/appointment.',1;
    IF EXISTS(
        SELECT forbidden.object_name FROM (VALUES
          (N'sp_create_doctor_working_schedule'),(N'sp_generate_doctor_slots'),(N'sp_book_appointment'),
          (N'sp_confirm_appointment'),(N'sp_cancel_appointment'),(N'sp_reschedule_appointment'),
          (N'sp_mark_appointment_no_show')
        ) forbidden(object_name)
        WHERE EXISTS(SELECT 1 FROM sys.database_permissions dp
          WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
            AND dp.major_id=OBJECT_ID(N'dbo.'+forbidden.object_name) AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
    ) THROW 55718,N'clinic_api_executor còn quyền gọi command bigint nội bộ.',1;
    IF NOT EXISTS(SELECT 1 FROM sys.database_permissions dp
      WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_job_executor')
        AND dp.major_id=OBJECT_ID(N'dbo.sp_generate_all_doctor_slots_system') AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
        THROW 55702,N'clinic_job_executor thiếu quyền sinh slot hệ thống.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'schedule-admin-',@suffix),REPLICATE('x',60),N'Schedule Admin','ACTIVE');
    DECLARE @admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

    DECLARE @business_date date;
    EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
    DECLARE @target_date date=DATEADD(DAY,7,@business_date),@second_date date=DATEADD(DAY,14,@business_date);
    DECLARE @weekday tinyint=((DATEDIFF(DAY,CONVERT(date,'19000101'),@target_date)%7)+1);

    DECLARE @room_id bigint,@room_public_id uniqueidentifier,@room_code varchar(30)=CONCAT('SR',LEFT(@suffix,20));
    EXEC dbo.sp_create_room @actor_user_id=@admin_id,@branch_id=@branch_id,
      @room_code=@room_code,@room_name=N'Phòng lịch test',@room_type='CONSULTATION',
      @floor_no=1,@capacity=1,@room_id=@room_id OUTPUT;
    SELECT @room_public_id=public_id FROM dbo.rooms WHERE room_id=@room_id;

    DECLARE @service_id bigint,@service_public_id uniqueidentifier,@price_id bigint,
      @service_code varchar(30)=CONCAT('SS',LEFT(@suffix,20));
    EXEC dbo.sp_create_service @actor_user_id=@admin_id,@branch_id=NULL,@service_category_id=@category_id,
      @specialty_id=@specialty_id,@service_code=@service_code,@service_name=N'Khám lịch test',
      @service_type='CONSULTATION',@default_duration_min=30,@current_price=200000,@requires_doctor=1,
      @service_id=@service_id OUTPUT;
    SELECT @service_public_id=public_id FROM dbo.services WHERE service_id=@service_id;
    EXEC dbo.sp_set_branch_service_price @actor_user_id=@admin_id,@branch_id=@branch_id,@service_id=@service_id,
      @price_amount=200000,@effective_from=@business_date,@is_available=1,@service_branch_price_id=@price_id OUTPUT;

    DECLARE @doctor_user_id bigint,@employee_id bigint,@doctor_id bigint,@doctor_public_id uniqueidentifier,
      @doctor_username nvarchar(80)=CONCAT(N'schedule-doctor-',@suffix),
      @doctor_code varchar(30)=CONCAT('SD',LEFT(@suffix,20)),
      @doctor_license nvarchar(100)=CONCAT(N'SCHEDULE-',@suffix),@doctor_password varchar(255)=REPLICATE('x',60);
    EXEC dbo.sp_create_staff_account @actor_user_id=@admin_id,@branch_id=@branch_id,
      @username=@doctor_username,@password_hash=@doctor_password,
      @employee_code=@doctor_code,@employee_type='DOCTOR',@full_name=N'Bác sĩ Lịch',
      @hire_date=@business_date,@medical_license_no=@doctor_license,@default_slot_minutes=30,
      @accepts_online_booking=1,@specialty_id=@specialty_id,@user_id=@doctor_user_id OUTPUT,
      @employee_id=@employee_id OUTPUT,@doctor_id=@doctor_id OUTPUT;
    SELECT @doctor_public_id=public_id FROM dbo.doctors WHERE doctor_id=@doctor_id;
    EXEC dbo.sp_assign_doctor_service @actor_user_id=@admin_id,@branch_id=@branch_id,
      @doctor_id=@doctor_id,@service_id=@service_id,@custom_duration_min=30;

    DECLARE @schedule_id bigint,@schedule_public_id uniqueidentifier;
    EXEC dbo.sp_create_doctor_working_schedule @actor_user_id=@admin_id,@doctor_id=@doctor_id,
      @branch_id=@branch_id,@room_id=@room_id,@weekday_iso=@weekday,@local_start_time='08:00',
      @local_end_time='10:00',@slot_duration_min=30,@effective_from=@target_date,@effective_to=@second_date,
      @booking_horizon_days=60,@working_schedule_id=@schedule_id OUTPUT,
      @breaks_json=N'[{"localStartTime":"09:00","localEndTime":"09:30","breakName":"Nghỉ"}]',
      @working_schedule_public_id=@schedule_public_id OUTPUT;
    IF @schedule_public_id IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.doctor_schedule_breaks WHERE working_schedule_id=@schedule_id)
      THROW 55703,N'Không tạo public schedule hoặc khoảng nghỉ.',1;

    DECLARE @created int;
    EXEC dbo.sp_generate_doctor_slots @actor_user_id=@admin_id,@working_schedule_id=@schedule_id,
      @from_date_local=@target_date,@to_date_local=@second_date,@created_count=@created OUTPUT;
    IF @created<>6 THROW 55705,N'Số slot sinh ra không đúng sau khi loại khoảng nghỉ.',1;
    EXEC dbo.sp_generate_doctor_slots @actor_user_id=@admin_id,@working_schedule_id=@schedule_id,
      @from_date_local=@target_date,@to_date_local=@second_date,@created_count=@created OUTPUT;
    IF @created<>0 THROW 55706,N'Sinh slot retry không idempotent.',1;

    DECLARE @patient_id bigint,@patient_public_id uniqueidentifier;
    EXEC dbo.sp_create_patient @actor_user_id=@admin_id,@branch_id=@branch_id,@full_name=N'Bệnh nhân Lịch',
      @date_of_birth='1990-01-01',@gender='OTHER',@phone='0909999999',@duplicate_override=1,
      @duplicate_reason=N'Tạo dữ liệu kiểm thử lịch hẹn độc lập.',@patient_id=@patient_id OUTPUT,
      @patient_public_id=@patient_public_id OUTPUT;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'schedule-patient-',@suffix),REPLICATE('x',60),N'Bệnh nhân Lịch','ACTIVE');
    DECLARE @patient_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @patient_user_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='PATIENT';
    INSERT dbo.user_patient_access(user_id,patient_id,relationship_type,status,is_booking_allowed,
      verified_by_user_id,verified_branch_id,verified_at_utc)
    VALUES(@patient_user_id,@patient_id,'SELF','ACTIVE',1,@admin_id,@branch_id,SYSUTCDATETIME());

    DECLARE @slot_id bigint=(SELECT TOP(1) slot_id FROM dbo.appointment_slots WHERE working_schedule_id=@schedule_id
      AND service_date_local=@target_date ORDER BY start_time_local),@slot_public_id uniqueidentifier;
    SELECT @slot_public_id=public_id FROM dbo.appointment_slots WHERE slot_id=@slot_id;
    IF NOT EXISTS(SELECT 1 FROM dbo.v_available_appointment_slots WHERE slot_public_id=@slot_public_id
      AND service_public_id=@service_public_id AND doctor_public_id=@doctor_public_id)
      THROW 55707,N'Public availability không lọc đúng doctor/service/booking window.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@patient_user_id;
    DECLARE @book_key uniqueidentifier=NEWID(),@appointment_public_id uniqueidentifier;
    EXEC dbo.sp_clinic_book_appointment @actor_user_id=@patient_user_id,@patient_public_id=@patient_public_id,
      @slot_public_id=@slot_public_id,@service_public_id=@service_public_id,@booking_channel='ONLINE',
      @chief_complaint=N'Đau đầu',@idempotency_key=@book_key,@appointment_public_id=@appointment_public_id OUTPUT;
    DECLARE @first_appointment_id bigint=(SELECT appointment_id FROM dbo.appointments WHERE public_id=@appointment_public_id);
    DECLARE @retry_public_id uniqueidentifier;
    EXEC dbo.sp_clinic_book_appointment @actor_user_id=@patient_user_id,@patient_public_id=@patient_public_id,
      @slot_public_id=@slot_public_id,@service_public_id=@service_public_id,@booking_channel='ONLINE',
      @chief_complaint=N'Đau đầu',@idempotency_key=@book_key,@appointment_public_id=@retry_public_id OUTPUT;
    IF @retry_public_id<>@appointment_public_id OR (SELECT COUNT(*) FROM dbo.appointments WHERE appointment_id=@first_appointment_id)<>1
      THROW 55708,N'Retry đặt lịch không trả cùng public resource.',1;
    IF EXISTS(SELECT 1 FROM dbo.appointments a JOIN dbo.appointment_slots s ON s.slot_id=a.slot_id
      WHERE a.appointment_id=@first_appointment_id AND a.hold_expires_at_utc>s.booking_closes_at_utc)
      THROW 55719,N'Giữ chỗ kéo dài quá thời điểm đóng booking.',1;
    IF (SELECT COUNT(*) FROM dbo.appointment_status_history WHERE appointment_id=@first_appointment_id)<>1
      THROW 55715,N'Tạo lịch ghi trùng hoặc thiếu status history.',1;

    DECLARE @new_slot_public_id uniqueidentifier=(SELECT TOP(1) public_id FROM dbo.appointment_slots
      WHERE working_schedule_id=@schedule_id AND service_date_local=@second_date ORDER BY start_time_local);
    DECLARE @reschedule_key uniqueidentifier=NEWID();
    EXEC dbo.sp_clinic_reschedule_appointment @actor_user_id=@patient_user_id,
      @appointment_public_id=@appointment_public_id,@new_slot_public_id=@new_slot_public_id,
      @new_service_public_id=@service_public_id,@reason=N'Đổi lịch kiểm thử',@idempotency_key=@reschedule_key;
    EXEC dbo.sp_clinic_reschedule_appointment @actor_user_id=@patient_user_id,
      @appointment_public_id=@appointment_public_id,@new_slot_public_id=@new_slot_public_id,
      @new_service_public_id=@service_public_id,@reason=N'Đổi lịch kiểm thử',@idempotency_key=@reschedule_key;
    IF NOT EXISTS(SELECT 1 FROM dbo.appointment_reschedule_history WHERE appointment_id=@first_appointment_id)
      THROW 55711,N'Đổi lịch không ghi history.',1;

    EXEC dbo.sp_clinic_cancel_appointment @actor_user_id=@patient_user_id,
      @appointment_public_id=@appointment_public_id,@reason=N'Bệnh nhân hủy lịch kiểm thử';
    IF NOT EXISTS(SELECT 1 FROM dbo.appointment_status_history WHERE appointment_id=@first_appointment_id
      AND new_status='CANCELLED') THROW 55712,N'Hủy lịch không ghi status history.',1;
    IF (SELECT COUNT(*) FROM dbo.appointment_status_history WHERE appointment_id=@first_appointment_id)<>2
      THROW 55716,N'Hủy lịch ghi trùng status history.',1;

    DECLARE @expiry_key uniqueidentifier=NEWID(),@expiry_public uniqueidentifier,@expired_count int;
    EXEC dbo.sp_clinic_book_appointment @actor_user_id=@patient_user_id,@patient_public_id=@patient_public_id,
      @slot_public_id=@new_slot_public_id,@service_public_id=@service_public_id,@booking_channel='ONLINE',
      @idempotency_key=@expiry_key,@appointment_public_id=@expiry_public OUTPUT;
    UPDATE dbo.appointments SET hold_expires_at_utc=DATEADD(MINUTE,-1,SYSUTCDATETIME()) WHERE public_id=@expiry_public;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC dbo.sp_expire_appointment_holds @actor_user_id=@admin_id,@expired_count=@expired_count OUTPUT;
    IF @expired_count<1 OR NOT EXISTS(SELECT 1 FROM dbo.appointments WHERE public_id=@expiry_public AND status='EXPIRED')
      THROW 55713,N'Worker command không giải phóng giữ chỗ hết hạn.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@expiry_public)
      AND event_type='APPOINTMENT_EXPIRED') THROW 55714,N'Hết hạn giữ chỗ không ghi outbox public ID.',1;
    IF (SELECT COUNT(*) FROM dbo.appointment_status_history h JOIN dbo.appointments a ON a.appointment_id=h.appointment_id
        WHERE a.public_id=@expiry_public)<>2 THROW 55717,N'Hết hạn giữ chỗ ghi trùng hoặc thiếu status history.',1;

    -- Đặt lại một slot đã giải phóng, sau đó xác minh request thứ hai bị chặn.
    -- Procedure conflict rollback toàn bộ transaction test, nên negative case này phải chạy cuối.
    DECLARE @occupied_key uniqueidentifier=NEWID(),@occupied_public uniqueidentifier;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@patient_user_id;
    EXEC dbo.sp_clinic_book_appointment @actor_user_id=@patient_user_id,@patient_public_id=@patient_public_id,
      @slot_public_id=@slot_public_id,@service_public_id=@service_public_id,@booking_channel='ONLINE',
      @idempotency_key=@occupied_key,@appointment_public_id=@occupied_public OUTPUT;
    DECLARE @double_error int=NULL,@double_public uniqueidentifier,@double_key uniqueidentifier=NEWID();
    BEGIN TRY
      EXEC dbo.sp_clinic_book_appointment @actor_user_id=@patient_user_id,@patient_public_id=@patient_public_id,
        @slot_public_id=@slot_public_id,@service_public_id=@service_public_id,@booking_channel='ONLINE',
        @idempotency_key=@double_key,@appointment_public_id=@double_public OUTPUT;
      SET @double_error=0;
    END TRY BEGIN CATCH SET @double_error=ERROR_NUMBER(); END CATCH;
    IF @double_error<>53112 THROW 55710,N'Hai yêu cầu đặt cùng slot không bị chặn.',1;

    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    SELECT 'PASS' AS scheduling_appointments_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

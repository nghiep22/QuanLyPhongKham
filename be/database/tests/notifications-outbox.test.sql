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
      (N'sp_schedule_appointment_reminders'),(N'sp_claim_outbox_events'),(N'sp_complete_outbox_event'),
      (N'sp_fail_outbox_event'),(N'sp_materialize_appointment_notification'),(N'sp_claim_notifications'),
      (N'sp_complete_notification'),(N'sp_fail_notification')) forbidden(name)
      JOIN sys.database_permissions dp ON dp.major_id=OBJECT_ID(N'dbo.'+forbidden.name)
      WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
      THROW 56000,N'Clinic API role không được gọi worker procedure.',1;
    IF EXISTS (SELECT 1 FROM (VALUES
      (N'sp_schedule_appointment_reminders'),(N'sp_claim_outbox_events'),(N'sp_complete_outbox_event'),
      (N'sp_fail_outbox_event'),(N'sp_materialize_appointment_notification'),(N'sp_claim_notifications'),
      (N'sp_complete_notification'),(N'sp_fail_notification')) required(name)
      WHERE NOT EXISTS (SELECT 1 FROM sys.database_permissions dp
        WHERE dp.major_id=OBJECT_ID(N'dbo.'+required.name)
          AND dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_job_executor')
          AND dp.permission_name='EXECUTE' AND dp.state IN('G','W')))
      THROW 56001,N'Worker role thiếu quyền procedure outbox/notification.',1;

    BEGIN TRANSACTION;
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID()),
      @worker1 uniqueidentifier=NEWID(),@worker2 uniqueidentifier=NEWID(),
      @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN'),
      @doctor_id bigint=(SELECT TOP(1) doctor_id FROM dbo.doctors ORDER BY doctor_id),
      @room_id bigint=(SELECT TOP(1) room_id FROM dbo.rooms WHERE branch_id=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN') ORDER BY room_id),
      @service_id bigint=(SELECT TOP(1) service_id FROM dbo.services WHERE is_active=1 ORDER BY service_id);
    IF @branch_id IS NULL OR @doctor_id IS NULL OR @room_id IS NULL OR @service_id IS NULL
      THROW 56002,N'Thiếu seed để kiểm thử outbox/notification.',1;

    -- Cô lập fixture khỏi backlog có thể tồn tại trong database phát triển.
    UPDATE dbo.outbox_events SET next_attempt_at_utc=DATEADD(DAY,1,SYSUTCDATETIME())
      WHERE published_at_utc IS NULL AND dead_lettered_at_utc IS NULL;
    UPDATE dbo.notifications SET next_attempt_at_utc=DATEADD(DAY,1,SYSUTCDATETIME())
      WHERE status IN ('PENDING','PROCESSING') AND dead_lettered_at_utc IS NULL;

    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'outbox-user-',@suffix),REPLICATE('x',60),N'Outbox Test User','ACTIVE');
    DECLARE @user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender,email,status,created_by_user_id)
    VALUES(CONCAT('OT',LEFT(@suffix,20)),@branch_id,N'Bệnh nhân nhận reminder','1990-01-01','OTHER',
      CONCAT('outbox-',@suffix,'@example.test'),'ACTIVE',@user_id);
    DECLARE @patient_id bigint=SCOPE_IDENTITY(),@appointment_public_id uniqueidentifier=NEWID(),
      @scheduled_start datetime2(3)=DATEADD(MINUTE,120,SYSUTCDATETIME()),
      @service_date_local date=DATEADD(DAY,1,CONVERT(date,SYSUTCDATETIME()));
    DECLARE @weekday_iso tinyint=((DATEDIFF(DAY,CONVERT(date,'19000101'),@service_date_local)%7)+1);
    INSERT dbo.doctor_working_schedules(doctor_id,branch_id,room_id,weekday_iso,local_start_time,
      local_end_time,slot_duration_min,booking_horizon_days,effective_from,effective_to,is_active,created_by_user_id)
    VALUES(@doctor_id,@branch_id,@room_id,@weekday_iso,'08:00','12:00',30,365,CONVERT(date,SYSUTCDATETIME()),
      DATEADD(DAY,365,CONVERT(date,SYSUTCDATETIME())),1,@user_id);
    DECLARE @schedule_id bigint=SCOPE_IDENTITY();
    INSERT dbo.appointment_slots(working_schedule_id,doctor_id,branch_id,room_id,service_date_local,
      start_time_local,end_time_local,starts_at_utc,ends_at_utc,booking_opens_at_utc,booking_closes_at_utc,status)
    VALUES(@schedule_id,@doctor_id,@branch_id,@room_id,@service_date_local,
      '08:00','08:30',@scheduled_start,DATEADD(MINUTE,30,@scheduled_start),
      DATEADD(DAY,-1,@scheduled_start),DATEADD(MINUTE,-1,@scheduled_start),'BOOKED');
    DECLARE @slot_id bigint=SCOPE_IDENTITY();
    INSERT dbo.appointments(public_id,appointment_code,branch_id,slot_id,patient_id,doctor_id,service_id,
      booking_channel,status,scheduled_start_utc,scheduled_end_utc,booked_by_user_id,confirmed_by_user_id,
      confirmed_at_utc,occupies_slot)
    VALUES(@appointment_public_id,CONCAT('OA',LEFT(@suffix,20)),@branch_id,@slot_id,@patient_id,@doctor_id,
      @service_id,'ONLINE','CONFIRMED',@scheduled_start,DATEADD(MINUTE,30,@scheduled_start),
      @user_id,@user_id,SYSUTCDATETIME(),1);

    CREATE USER [clinic_job_regression_user] WITHOUT LOGIN;
    ALTER ROLE clinic_job_executor ADD MEMBER [clinic_job_regression_user];
    DECLARE @scheduled int,@scheduled_again int;
    EXECUTE AS USER='clinic_job_regression_user';
    EXEC dbo.sp_schedule_appointment_reminders @request_id=@worker1,@lead_minutes=1440,@scheduled_count=@scheduled OUTPUT;
    EXEC dbo.sp_schedule_appointment_reminders @request_id=@worker1,@lead_minutes=1440,@scheduled_count=@scheduled_again OUTPUT;
    REVERT;
    IF @scheduled<>1 OR @scheduled_again<>0
      THROW 56003,N'Scheduler reminder không idempotent.',1;

    DECLARE @event_id uniqueidentifier=(SELECT event_id FROM dbo.outbox_events
      WHERE aggregate_id=CONVERT(varchar(36),@appointment_public_id) AND event_type='APPOINTMENT_REMINDER_DUE');
    IF @event_id IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE event_id=@event_id
      AND schema_version=1 AND producer='scheduler-worker' AND correlation_id=@worker1
      AND dedupe_key IS NOT NULL AND next_attempt_at_utc IS NOT NULL)
      THROW 56004,N'Outbox reminder thiếu envelope hoặc dedupe key.',1;

    DECLARE @claimed_outbox TABLE(eventId uniqueidentifier,eventType varchar(100),schemaVersion smallint,
      producer varchar(80),aggregateType varchar(50),aggregateId varchar(100),occurredAtUtc datetime2(3),
      correlationId uniqueidentifier NULL,causationId uniqueidentifier NULL,payloadJson nvarchar(max),attemptCount smallint);
    DECLARE @other_outbox TABLE(eventId uniqueidentifier,eventType varchar(100),schemaVersion smallint,
      producer varchar(80),aggregateType varchar(50),aggregateId varchar(100),occurredAtUtc datetime2(3),
      correlationId uniqueidentifier NULL,causationId uniqueidentifier NULL,payloadJson nvarchar(max),attemptCount smallint);
    DECLARE @notification_count int,@notification_again int;
    EXECUTE AS USER='clinic_job_regression_user';
    INSERT @claimed_outbox EXEC dbo.sp_claim_outbox_events @worker_id=@worker1,@batch_size=20,@lease_seconds=60;
    INSERT @other_outbox EXEC dbo.sp_claim_outbox_events @worker_id=@worker2,@batch_size=20,@lease_seconds=60;
    EXEC dbo.sp_materialize_appointment_notification @worker_id=@worker1,@event_id=@event_id,
      @notification_count=@notification_count OUTPUT;
    EXEC dbo.sp_materialize_appointment_notification @worker_id=@worker1,@event_id=@event_id,
      @notification_count=@notification_again OUTPUT;
    EXEC dbo.sp_complete_outbox_event @worker_id=@worker1,@event_id=@event_id;
    REVERT;
    IF (SELECT COUNT(*) FROM @claimed_outbox WHERE eventId=@event_id)<>1 OR EXISTS(SELECT 1 FROM @other_outbox)
      THROW 56005,N'Lease outbox không loại trừ worker thứ hai.',1;
    IF @notification_count<>1 OR @notification_again<>0
      THROW 56006,N'Materialize notification không idempotent.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE event_id=@event_id AND published_at_utc IS NOT NULL
      AND locked_by IS NULL) THROW 56007,N'Không hoàn tất outbox event.',1;

    DECLARE @notification_id uniqueidentifier=(SELECT public_id FROM dbo.notifications WHERE source_event_id=@event_id);
    IF @notification_id IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.notifications WHERE public_id=@notification_id
      AND dedupe_key=CONCAT('OUTBOX_EVENT:',CONVERT(varchar(36),@event_id)) AND status='PENDING')
      THROW 56008,N'Notification không liên kết đúng source event.',1;
    DECLARE @claimed_notifications TABLE(notificationId uniqueidentifier,channel varchar(20),templateCode varchar(50),
      recipient nvarchar(254),subject nvarchar(300),body nvarchar(max),payloadJson nvarchar(max),
      scheduledAtUtc datetime2(3),attemptCount smallint);
    DECLARE @other_notifications TABLE(notificationId uniqueidentifier,channel varchar(20),templateCode varchar(50),
      recipient nvarchar(254),subject nvarchar(300),body nvarchar(max),payloadJson nvarchar(max),
      scheduledAtUtc datetime2(3),attemptCount smallint);
    DECLARE @dead_lettered bit;
    EXECUTE AS USER='clinic_job_regression_user';
    INSERT @claimed_notifications EXEC dbo.sp_claim_notifications @worker_id=@worker1,@batch_size=20,@lease_seconds=60;
    INSERT @other_notifications EXEC dbo.sp_claim_notifications @worker_id=@worker2,@batch_size=20,@lease_seconds=60;
    EXEC dbo.sp_fail_notification @worker_id=@worker1,@notification_id=@notification_id,
      @error_message=N'provider unavailable',@max_attempts=2,@retry_base_seconds=1,@dead_lettered=@dead_lettered OUTPUT;
    REVERT;
    IF (SELECT COUNT(*) FROM @claimed_notifications WHERE notificationId=@notification_id)<>1
      OR EXISTS(SELECT 1 FROM @other_notifications) OR @dead_lettered<>0
      THROW 56009,N'Claim hoặc retry notification sai.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.notifications WHERE public_id=@notification_id AND status='PENDING'
      AND retry_count=1 AND next_attempt_at_utc>SYSUTCDATETIME() AND locked_by IS NULL)
      THROW 56010,N'Notification retry không có backoff.',1;

    UPDATE dbo.notifications SET next_attempt_at_utc=DATEADD(SECOND,-1,SYSUTCDATETIME())
      WHERE public_id=@notification_id;
    DELETE FROM @claimed_notifications;
    EXECUTE AS USER='clinic_job_regression_user';
    INSERT @claimed_notifications EXEC dbo.sp_claim_notifications @worker_id=@worker1,@batch_size=20,@lease_seconds=60;
    EXEC dbo.sp_fail_notification @worker_id=@worker1,@notification_id=@notification_id,
      @error_message=N'provider unavailable',@max_attempts=2,@retry_base_seconds=1,@dead_lettered=@dead_lettered OUTPUT;
    REVERT;
    IF @dead_lettered<>1 OR NOT EXISTS(SELECT 1 FROM dbo.notifications WHERE public_id=@notification_id
      AND status='FAILED' AND retry_count=2 AND dead_lettered_at_utc IS NOT NULL AND locked_by IS NULL)
      THROW 56011,N'Notification không vào dead-letter sau max attempts.',1;

    DECLARE @retry_event uniqueidentifier=NEWID();
    INSERT dbo.outbox_events(event_id,aggregate_type,aggregate_id,event_type,payload_json,schema_version,
      producer,correlation_id,dedupe_key,next_attempt_at_utc)
    VALUES(@retry_event,'TEST','retry-contract','TEST_DELIVERY',N'{"kind":"regression"}',1,
      'scheduler-worker',@worker1,CONCAT('TEST_DELIVERY:',@suffix),SYSUTCDATETIME());
    DELETE FROM @claimed_outbox;
    EXECUTE AS USER='clinic_job_regression_user';
    INSERT @claimed_outbox EXEC dbo.sp_claim_outbox_events @worker_id=@worker1,@batch_size=20,@lease_seconds=60;
    EXEC dbo.sp_fail_outbox_event @worker_id=@worker1,@event_id=@retry_event,@error_message=N'broker unavailable',
      @max_attempts=3,@retry_base_seconds=1,@dead_lettered=@dead_lettered OUTPUT;
    REVERT;
    IF @dead_lettered<>0 OR NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE event_id=@retry_event
      AND attempt_count=1 AND published_at_utc IS NULL AND next_attempt_at_utc>SYSUTCDATETIME() AND locked_by IS NULL)
      THROW 56012,N'Outbox retry không có backoff.',1;
    UPDATE dbo.outbox_events SET next_attempt_at_utc=DATEADD(SECOND,-1,SYSUTCDATETIME()) WHERE event_id=@retry_event;
    DELETE FROM @claimed_outbox;
    EXECUTE AS USER='clinic_job_regression_user';
    INSERT @claimed_outbox EXEC dbo.sp_claim_outbox_events @worker_id=@worker1,@batch_size=20,@lease_seconds=60;
    EXEC dbo.sp_complete_outbox_event @worker_id=@worker1,@event_id=@retry_event;
    REVERT;
    IF NOT EXISTS(SELECT 1 FROM dbo.outbox_events WHERE event_id=@retry_event AND attempt_count=2
      AND published_at_utc IS NOT NULL AND locked_by IS NULL)
      THROW 56013,N'Outbox không hoàn tất sau retry.',1;

    ROLLBACK TRANSACTION;
    SELECT 'PASS' AS notifications_outbox_test;
END TRY
BEGIN CATCH
    IF USER_NAME()=N'clinic_job_regression_user' REVERT;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

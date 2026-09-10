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
    BEGIN TRANSACTION;
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID());
    DECLARE @request_context_id uniqueidentifier=NEWID();
    DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
    DECLARE @patient_role_id bigint=(SELECT role_id FROM dbo.roles WHERE role_code='PATIENT');
    DECLARE @reception_role_id bigint=(SELECT role_id FROM dbo.roles WHERE role_code='RECEPTIONIST');
    IF @branch_id IS NULL OR @patient_role_id IS NULL OR @reception_role_id IS NULL
        THROW 55500,N'Thiếu seed phục vụ kiểm thử patient link.',1;

    INSERT dbo.users(username,email,password_hash,display_name,status)
    VALUES(CONCAT(N'portal-',@suffix),CONCAT('portal-',@suffix,'@example.test'),REPLICATE('x',60),N'Người yêu cầu','ACTIVE');
    DECLARE @portal_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@portal_user_id,@patient_role_id,NULL,@portal_user_id);

    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'reception-',@suffix),REPLICATE('x',60),N'Lễ tân duyệt','ACTIVE');
    DECLARE @staff_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@staff_user_id,@reception_role_id,@branch_id,@staff_user_id);

    DECLARE @target_code varchar(30)=CONCAT('LINK',LEFT(REPLACE(@suffix,'-',''),16));
    INSERT dbo.patients(patient_code,full_name,date_of_birth,gender,status)
    VALUES(@target_code,N'Bệnh nhân cần liên kết','2012-03-04','FEMALE','ACTIVE');
    DECLARE @target_patient_id bigint=SCOPE_IDENTITY();

    DECLARE @request_public_id uniqueidentifier,@created bit,@idempotency_key uniqueidentifier=NEWID();
    DECLARE @request_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('patient-link-',@suffix));
    DECLARE @request_expires_at_utc datetime2(3)=DATEADD(DAY,7,SYSUTCDATETIME());
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_context_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@portal_user_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;
    EXEC dbo.sp_auth_request_patient_link
        @actor_user_id=@portal_user_id,@branch_id=@branch_id,@patient_code=@target_code,
        @date_of_birth='2012-03-04',@relationship_type='GUARDIAN',
        @request_note=N'Đã chuẩn bị giấy tờ giám hộ',@idempotency_key=@idempotency_key,
        @request_hash=@request_hash,@expires_at_utc=@request_expires_at_utc,
        @request_public_id=@request_public_id OUTPUT,@created=@created OUTPUT;
    IF @created<>1 OR @request_public_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM dbo.patient_access_requests WHERE public_id=@request_public_id
        AND patient_id=@target_patient_id AND status='PENDING')
        THROW 55501,N'Không tạo được yêu cầu liên kết hợp lệ.',1;

    DECLARE @retry_public_id uniqueidentifier;
    SET @created=1;
    EXEC dbo.sp_auth_request_patient_link
        @actor_user_id=@portal_user_id,@branch_id=@branch_id,@patient_code=@target_code,
        @date_of_birth='2012-03-04',@relationship_type='GUARDIAN',
        @request_note=N'Đã chuẩn bị giấy tờ giám hộ',@idempotency_key=@idempotency_key,
        @request_hash=@request_hash,@expires_at_utc=@request_expires_at_utc,
        @request_public_id=@retry_public_id OUTPUT,@created=@created OUTPUT;
    IF @created<>0 OR @retry_public_id<>@request_public_id
        THROW 55502,N'Retry idempotent không trả lại yêu cầu ban đầu.',1;

    DECLARE @decoy_public_id uniqueidentifier,@decoy_key uniqueidentifier=NEWID();
    EXEC dbo.sp_auth_request_patient_link
        @actor_user_id=@portal_user_id,@branch_id=@branch_id,@patient_code='DOES-NOT-EXIST',
        @date_of_birth='2010-01-01',@relationship_type='SELF',@request_note=NULL,
        @idempotency_key=@decoy_key,@request_hash=0x0101010101010101010101010101010101010101010101010101010101010101,
        @expires_at_utc=@request_expires_at_utc,
        @request_public_id=@decoy_public_id OUTPUT,@created=@created OUTPUT;
    IF @created<>1 OR NOT EXISTS
       (SELECT 1 FROM dbo.patient_access_requests WHERE public_id=@decoy_public_id
        AND patient_id IS NULL AND status='PENDING')
        THROW 55503,N'Yêu cầu không khớp không được xử lý kín.',1;
    DECLARE @staff_queue TABLE
    (
        total_count bigint,public_id varchar(36),branch_public_id varchar(36),branch_code varchar(30),
        branch_name nvarchar(200),requester_public_id varchar(36),requester_display_name nvarchar(200),
        requester_email varchar(254),requester_phone varchar(20),patient_public_id varchar(36),
        patient_code varchar(30),patient_full_name nvarchar(200),date_of_birth date,
        patient_reference_mask varchar(30),relationship_type varchar(20),request_note nvarchar(500),
        status varchar(20),decision_reason nvarchar(500),created_at_utc datetime2(3),
        expires_at_utc datetime2(3),decided_at_utc datetime2(3),row_ver binary(8)
    );
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@staff_user_id;
    INSERT @staff_queue EXEC dbo.sp_auth_list_patient_link_requests
        @actor_user_id=@staff_user_id,@branch_id=@branch_id,@status='PENDING',@offset=0,@page_size=20;
    IF NOT EXISTS (SELECT 1 FROM @staff_queue WHERE public_id=CONVERT(varchar(36),@request_public_id))
       OR EXISTS (SELECT 1 FROM @staff_queue WHERE public_id=CONVERT(varchar(36),@decoy_public_id))
        THROW 55511,N'Decoy bị lộ hoặc yêu cầu hợp lệ không vào hàng đợi nhân viên.',1;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@portal_user_id;
    EXEC dbo.sp_auth_cancel_patient_link_request
        @actor_user_id=@portal_user_id,@request_public_id=@decoy_public_id;
    IF NOT EXISTS (SELECT 1 FROM dbo.patient_access_requests
                   WHERE public_id=@decoy_public_id AND status='CANCELLED')
        THROW 55504,N'Người dùng không hủy được yêu cầu đang chờ.',1;

    DECLARE @request_row_ver binary(8)=(SELECT row_ver FROM dbo.patient_access_requests WHERE public_id=@request_public_id);
    DECLARE @link_public_id uniqueidentifier;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@staff_user_id;
    EXEC dbo.sp_auth_decide_patient_link_request
        @actor_user_id=@staff_user_id,@request_public_id=@request_public_id,
        @decision='APPROVED',@reason=N'Đã đối chiếu giấy tờ bản gốc',
        @expected_row_ver=@request_row_ver,@link_public_id=@link_public_id OUTPUT;
    IF @link_public_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM dbo.user_patient_access WHERE public_id=@link_public_id
        AND user_id=@portal_user_id AND patient_id=@target_patient_id
        AND relationship_type='GUARDIAN' AND status='ACTIVE' AND is_booking_allowed=1
        AND verified_by_user_id=@staff_user_id AND verified_branch_id=@branch_id)
        THROW 55505,N'Duyệt yêu cầu không tạo liên kết đúng.',1;
    IF NOT EXISTS (SELECT 1 FROM dbo.patient_access_requests
                   WHERE public_id=@request_public_id AND status='APPROVED')
        THROW 55506,N'Yêu cầu không chuyển sang APPROVED.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@portal_user_id;
    EXEC dbo.sp_auth_revoke_patient_link
        @actor_user_id=@portal_user_id,@link_public_id=@link_public_id,
        @reason=N'Không còn nhu cầu quản lý hồ sơ này';
    IF NOT EXISTS (SELECT 1 FROM dbo.user_patient_access
                   WHERE public_id=@link_public_id AND status='REVOKED'
                     AND is_booking_allowed=0 AND revoked_by_user_id=@portal_user_id
                     AND revoked_at_utc IS NOT NULL)
        THROW 55507,N'Người dùng không tự thu hồi được liên kết người thân.',1;
    IF NOT EXISTS (SELECT 1 FROM dbo.audit_logs
                   WHERE action_code='PATIENT_LINK_REVOKED' AND entity_id=CONVERT(varchar(36),@link_public_id))
        THROW 55508,N'Thu hồi liên kết không được audit.',1;

    ROLLBACK TRANSACTION;

    -- Optimistic concurrency: rowversion cũ phải bị từ chối.
    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'concurrency-patient-',@suffix),REPLICATE('x',60),N'Patient concurrency','ACTIVE');
    DECLARE @concurrency_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@concurrency_user_id,@patient_role_id,NULL,@concurrency_user_id);
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'concurrency-staff-',@suffix),REPLICATE('x',60),N'Staff concurrency','ACTIVE');
    DECLARE @concurrency_staff_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@concurrency_staff_id,@reception_role_id,@branch_id,@concurrency_staff_id);
    DECLARE @concurrency_code varchar(30)=CONCAT('CC',LEFT(REPLACE(@suffix,'-',''),18));
    INSERT dbo.patients(patient_code,full_name,date_of_birth,gender,status)
    VALUES(@concurrency_code,N'Bệnh nhân concurrency','2001-01-01','OTHER','ACTIVE');
    DECLARE @concurrency_request uniqueidentifier,@concurrency_created bit,@concurrency_key uniqueidentifier=NEWID();
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@concurrency_user_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;
    EXEC dbo.sp_auth_request_patient_link
        @actor_user_id=@concurrency_user_id,@branch_id=@branch_id,@patient_code=@concurrency_code,
        @date_of_birth='2001-01-01',@relationship_type='SELF',@idempotency_key=@concurrency_key,
        @request_hash=0x0202020202020202020202020202020202020202020202020202020202020202,
        @expires_at_utc=@request_expires_at_utc,
        @request_public_id=@concurrency_request OUTPUT,@created=@concurrency_created OUTPUT;
    DECLARE @stale_row_ver binary(8)=(SELECT row_ver FROM dbo.patient_access_requests WHERE public_id=@concurrency_request);
    UPDATE dbo.patient_access_requests SET request_note=N'Cập nhật đồng thời' WHERE public_id=@concurrency_request;
    DECLARE @concurrency_error int=NULL,@unused_link uniqueidentifier;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@concurrency_staff_id;
    BEGIN TRY
        EXEC dbo.sp_auth_decide_patient_link_request
            @actor_user_id=@concurrency_staff_id,@request_public_id=@concurrency_request,
            @decision='REJECTED',@reason=N'Không đủ giấy tờ',@expected_row_ver=@stale_row_ver,
            @link_public_id=@unused_link OUTPUT;
        SET @concurrency_error=0;
    END TRY
    BEGIN CATCH
        SET @concurrency_error=ERROR_NUMBER();
    END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @concurrency_error<>53513
        THROW 55509,N'Không chặn quyết định bằng rowversion cũ.',1;

    -- Liên kết SELF duy nhất không thể bị chính bệnh nhân tự thu hồi.
    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'self-patient-',@suffix),REPLICATE('x',60),N'Patient self','ACTIVE');
    DECLARE @self_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@self_user_id,@patient_role_id,NULL,@self_user_id);
    DECLARE @self_code varchar(30)=CONCAT('SELF',LEFT(REPLACE(@suffix,'-',''),16));
    INSERT dbo.patients(patient_code,full_name,date_of_birth,gender,status)
    VALUES(@self_code,N'Hồ sơ chính','1990-01-01','MALE','ACTIVE');
    DECLARE @self_patient_id bigint=SCOPE_IDENTITY(),@self_link_public_id uniqueidentifier=NEWID();
    INSERT dbo.user_patient_access
        (public_id,user_id,patient_id,relationship_type,status,is_booking_allowed,
         verified_by_user_id,verified_branch_id,verified_at_utc)
    VALUES(@self_link_public_id,@self_user_id,@self_patient_id,'SELF','ACTIVE',1,
           @self_user_id,@branch_id,SYSUTCDATETIME());
    DECLARE @self_revoke_error int=NULL;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@self_user_id;
    BEGIN TRY
        EXEC dbo.sp_auth_revoke_patient_link @actor_user_id=@self_user_id,
            @link_public_id=@self_link_public_id,@reason=N'Thử tự xóa hồ sơ chính';
        SET @self_revoke_error=0;
    END TRY
    BEGIN CATCH
        SET @self_revoke_error=ERROR_NUMBER();
    END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @self_revoke_error<>51002
        THROW 55510,N'Liên kết SELF duy nhất không được bảo vệ.',1;

    -- Clinic command không được tạo liên kết xuyên ownership.
    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'ownership-patient-',@suffix),REPLICATE('x',60),N'Portal ownership','ACTIVE');
    DECLARE @ownership_portal_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@ownership_portal_user_id,@patient_role_id,NULL,@ownership_portal_user_id);
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'ownership-staff-',@suffix),REPLICATE('x',60),N'Staff ownership','ACTIVE');
    DECLARE @ownership_staff_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@ownership_staff_user_id,@reception_role_id,@branch_id,@ownership_staff_user_id);
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@ownership_staff_user_id;
    DECLARE @ownership_error int=NULL,@blocked_patient_id bigint;
    BEGIN TRY
        EXEC dbo.sp_create_patient @actor_user_id=@ownership_staff_user_id,@branch_id=@branch_id,
            @full_name=N'Không được liên kết chéo',@date_of_birth='1990-01-01',@gender='OTHER',
            @portal_user_id=@ownership_portal_user_id,@relationship_type='SELF',
            @patient_id=@blocked_patient_id OUTPUT;
        SET @ownership_error=0;
    END TRY
    BEGIN CATCH
        SET @ownership_error=ERROR_NUMBER();
    END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @ownership_error<>53139
        THROW 55514,N'Clinic command vẫn có thể tạo patient portal link xuyên ownership.',1;

    IF EXISTS
    (
        SELECT 1 FROM sys.database_permissions permission
        JOIN sys.database_principals principal ON principal.principal_id=permission.grantee_principal_id
        WHERE principal.name='clinic_api_executor' AND permission.permission_name='EXECUTE'
          AND OBJECT_NAME(permission.major_id) IN ('sp_create_patient_portal_account','sp_link_user_patient',
              'sp_auth_request_patient_link','sp_auth_decide_patient_link_request')
    ) THROW 55512,N'Clinic Service vẫn được cấp quyền ghi patient portal link.',1;
    IF (SELECT COUNT(*) FROM sys.database_permissions permission
        JOIN sys.database_principals principal ON principal.principal_id=permission.grantee_principal_id
        WHERE principal.name='auth_core_executor' AND permission.state_desc='GRANT'
          AND permission.permission_name='EXECUTE'
          AND OBJECT_NAME(permission.major_id) IN ('sp_create_patient_portal_account','sp_link_user_patient',
              'sp_auth_request_patient_link','sp_auth_decide_patient_link_request'))<>4
        THROW 55513,N'Auth Service chưa được cấp đủ quyền patient portal link.',1;

    SELECT 'PASS' AS patient_link_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

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
    DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
    DECLARE @challenge_id uniqueidentifier=NEWID(),@effective_id uniqueidentifier,@idempotency_key uniqueidentifier=NEWID();
    DECLARE @contact varchar(254)=CONCAT('register-',@suffix,'@example.test');
    DECLARE @username nvarchar(80)=CONCAT(N'patient_',REPLACE(CONVERT(nvarchar(36),@challenge_id),N'-',N''));
    DECLARE @password_hash varchar(255)=CONCAT('$argon2id$registration-',REPLICATE('x',45));
    DECLARE @request_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('request-',@suffix));
    DECLARE @otp_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('otp-',@suffix));
    DECLARE @wrong_otp_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('wrong-',@suffix));
    DECLARE @expires_at_utc datetime2(3)=DATEADD(minute,10,SYSUTCDATETIME());
    DECLARE @created bit;
    EXEC dbo.sp_auth_create_patient_registration
        @registration_challenge_id=@challenge_id,@idempotency_key=@idempotency_key,
        @request_hash=@request_hash,@branch_id=@branch_id,@username=@username,
        @contact_channel='EMAIL',@contact_value=@contact,@contact_normalized=@contact,
        @password_hash=@password_hash,@full_name=N'Bệnh nhân tự đăng ký',
        @date_of_birth='1990-01-02',@gender='FEMALE',@otp_hash=@otp_hash,
        @requested_ip='127.0.0.1',@expires_at_utc=@expires_at_utc,
        @max_attempts=5,@max_requests_per_hour=3,
        @effective_challenge_id=@effective_id OUTPUT,@created=@created OUTPUT;
    IF @created<>1 OR @effective_id<>@challenge_id
        THROW 55400,N'Không tạo được registration challenge.',1;
    IF COL_LENGTH(N'dbo.patient_registration_challenges',N'otp') IS NOT NULL
       OR COL_LENGTH(N'dbo.patient_registration_challenges',N'raw_otp') IS NOT NULL
        THROW 55401,N'OTP không được lưu dạng rõ.',1;

    SET @created=1;
    SET @effective_id=NULL;
    DECLARE @retry_challenge uniqueidentifier=NEWID();
    EXEC dbo.sp_auth_create_patient_registration
        @registration_challenge_id=@retry_challenge,@idempotency_key=@idempotency_key,
        @request_hash=@request_hash,@branch_id=@branch_id,@username=@username,
        @contact_channel='EMAIL',@contact_value=@contact,@contact_normalized=@contact,
        @password_hash=@password_hash,@full_name=N'Bệnh nhân tự đăng ký',
        @date_of_birth='1990-01-02',@gender='FEMALE',@otp_hash=@otp_hash,
        @expires_at_utc=@expires_at_utc,@effective_challenge_id=@effective_id OUTPUT,
        @created=@created OUTPUT;
    IF @created<>0 OR @effective_id<>@challenge_id
        THROW 55402,N'Retry cùng Idempotency-Key không trả challenge cũ.',1;

    DECLARE @succeeded bit,@user_id bigint,@patient_public_id uniqueidentifier,@patient_code varchar(30);
    EXEC dbo.sp_auth_verify_patient_registration @registration_challenge_id=@challenge_id,
        @otp_hash=@wrong_otp_hash,@succeeded=@succeeded OUTPUT,@user_id=@user_id OUTPUT,
        @patient_public_id=@patient_public_id OUTPUT,@patient_code=@patient_code OUTPUT;
    IF @succeeded<>0 OR NOT EXISTS
       (SELECT 1 FROM dbo.patient_registration_challenges
        WHERE registration_challenge_id=@challenge_id AND attempt_count=1 AND revoked_at_utc IS NULL)
        THROW 55403,N'OTP sai không được đếm đúng.',1;

    EXEC dbo.sp_auth_verify_patient_registration @registration_challenge_id=@challenge_id,
        @otp_hash=@otp_hash,@succeeded=@succeeded OUTPUT,@user_id=@user_id OUTPUT,
        @patient_public_id=@patient_public_id OUTPUT,@patient_code=@patient_code OUTPUT;
    IF @succeeded<>1 OR @user_id IS NULL OR @patient_public_id IS NULL OR @patient_code IS NULL
        THROW 55404,N'Không hoàn tất được đăng ký bằng OTP đúng.',1;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.users u JOIN dbo.user_roles ur ON ur.user_id=u.user_id
        JOIN dbo.roles r ON r.role_id=ur.role_id
        WHERE u.user_id=@user_id AND u.status='ACTIVE' AND u.email_normalized=@contact
          AND r.role_code='PATIENT' AND ur.branch_id IS NULL AND ur.is_active=1)
        THROW 55405,N'Tài khoản PATIENT không được tạo đúng.',1;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.patients p JOIN dbo.user_patient_access a ON a.patient_id=p.patient_id
        WHERE p.public_id=@patient_public_id AND p.patient_code=@patient_code
          AND a.user_id=@user_id AND a.relationship_type='SELF' AND a.status='ACTIVE'
          AND a.is_booking_allowed=1 AND a.verified_at_utc IS NOT NULL)
        THROW 55406,N'Hồ sơ và liên kết SELF không được tạo nguyên tử.',1;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.patient_registration_challenges
        WHERE registration_challenge_id=@challenge_id AND consumed_at_utc IS NOT NULL
          AND otp_hash=CONVERT(binary(32),0x00))
        THROW 55407,N'Challenge đã dùng chưa được đóng và xóa OTP hash.',1;

    SET @succeeded=1;
    SET @user_id=NULL;
    EXEC dbo.sp_auth_verify_patient_registration @registration_challenge_id=@challenge_id,
        @otp_hash=@otp_hash,@succeeded=@succeeded OUTPUT,@user_id=@user_id OUTPUT,
        @patient_public_id=@patient_public_id OUTPUT,@patient_code=@patient_code OUTPUT;
    IF @succeeded<>0 OR @user_id IS NOT NULL
        THROW 55408,N'OTP đã dùng có thể replay.',1;
    IF (SELECT COUNT(*) FROM dbo.users WHERE email_normalized=@contact)<>1
        THROW 55409,N'Replay đã tạo trùng tài khoản.',1;

    DECLARE @blocked_challenge uniqueidentifier=NEWID(),@blocked_idempotency uniqueidentifier=NEWID();
    DECLARE @blocked_hash binary(32)=HASHBYTES('SHA2_256','blocked');
    DECLARE @blocked_username nvarchar(80)=CONCAT(N'patient_',REPLACE(CONVERT(nvarchar(36),@blocked_challenge),N'-',N''));
    SET @created=1;
    EXEC dbo.sp_auth_create_patient_registration
        @registration_challenge_id=@blocked_challenge,@idempotency_key=@blocked_idempotency,
        @request_hash=@blocked_hash,@branch_id=@branch_id,@username=@blocked_username,
        @contact_channel='EMAIL',@contact_value=@contact,@contact_normalized=@contact,
        @password_hash=@password_hash,@full_name=N'Tài khoản trùng',@date_of_birth='1990-01-02',
        @gender='FEMALE',@otp_hash=@otp_hash,@expires_at_utc=@expires_at_utc,
        @effective_challenge_id=@effective_id OUTPUT,@created=@created OUTPUT;
    IF @created<>0 OR NOT EXISTS
       (SELECT 1 FROM dbo.patient_registration_challenges WHERE registration_challenge_id=@blocked_challenge
        AND revoked_at_utc IS NOT NULL AND revocation_reason='CONTACT_UNAVAILABLE'
        AND otp_hash=CONVERT(binary(32),0x00))
        THROW 55410,N'Đăng ký bằng contact đã có không bị từ chối kín.',1;
    SET @effective_id=NULL;
    EXEC dbo.sp_auth_create_patient_registration
        @registration_challenge_id=@retry_challenge,@idempotency_key=@blocked_idempotency,
        @request_hash=@blocked_hash,@branch_id=@branch_id,@username=@blocked_username,
        @contact_channel='EMAIL',@contact_value=@contact,@contact_normalized=@contact,
        @password_hash=@password_hash,@full_name=N'Tài khoản trùng',@date_of_birth='1990-01-02',
        @gender='FEMALE',@otp_hash=@otp_hash,@expires_at_utc=@expires_at_utc,
        @effective_challenge_id=@effective_id OUTPUT,@created=@created OUTPUT;
    IF @created<>0 OR @effective_id<>@blocked_challenge
        THROW 55414,N'Contact đã có làm lộ trạng thái qua retry idempotent.',1;

    DECLARE @cancel_challenge uniqueidentifier=NEWID(),@cancel_idempotency uniqueidentifier=NEWID();
    DECLARE @cancel_contact varchar(254)=CONCAT('cancel-',@suffix,'@example.test');
    DECLARE @cancel_hash binary(32)=HASHBYTES('SHA2_256','cancel');
    DECLARE @cancel_username nvarchar(80)=CONCAT(N'patient_',REPLACE(CONVERT(nvarchar(36),@cancel_challenge),N'-',N''));
    EXEC dbo.sp_auth_create_patient_registration
        @registration_challenge_id=@cancel_challenge,@idempotency_key=@cancel_idempotency,
        @request_hash=@cancel_hash,@branch_id=@branch_id,@username=@cancel_username,
        @contact_channel='EMAIL',@contact_value=@cancel_contact,@contact_normalized=@cancel_contact,
        @password_hash=@password_hash,@full_name=N'Kiểm thử delivery',@date_of_birth='1991-02-03',
        @gender='OTHER',@otp_hash=@otp_hash,@expires_at_utc=@expires_at_utc,
        @effective_challenge_id=@effective_id OUTPUT,@created=@created OUTPUT;
    EXEC dbo.sp_auth_cancel_patient_registration @registration_challenge_id=@cancel_challenge;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.patient_registration_challenges WHERE registration_challenge_id=@cancel_challenge
        AND revoked_at_utc IS NOT NULL AND revocation_reason='DELIVERY_FAILED'
        AND otp_hash=CONVERT(binary(32),0x00))
        THROW 55411,N'Delivery lỗi không hủy challenge.',1;

    DECLARE @locked_challenge uniqueidentifier=NEWID(),@locked_idempotency uniqueidentifier=NEWID();
    DECLARE @locked_contact varchar(254)=CONCAT('locked-',@suffix,'@example.test');
    DECLARE @locked_hash binary(32)=HASHBYTES('SHA2_256','locked');
    DECLARE @locked_username nvarchar(80)=CONCAT(N'patient_',REPLACE(CONVERT(nvarchar(36),@locked_challenge),N'-',N''));
    EXEC dbo.sp_auth_create_patient_registration
        @registration_challenge_id=@locked_challenge,@idempotency_key=@locked_idempotency,
        @request_hash=@locked_hash,@branch_id=@branch_id,@username=@locked_username,
        @contact_channel='EMAIL',@contact_value=@locked_contact,@contact_normalized=@locked_contact,
        @password_hash=@password_hash,@full_name=N'Kiểm thử giới hạn OTP',@date_of_birth='1992-03-04',
        @gender='MALE',@otp_hash=@otp_hash,@expires_at_utc=@expires_at_utc,
        @max_attempts=5,@effective_challenge_id=@effective_id OUTPUT,@created=@created OUTPUT;
    DECLARE @try int=0;
    WHILE @try<5
    BEGIN
        EXEC dbo.sp_auth_verify_patient_registration @registration_challenge_id=@locked_challenge,
            @otp_hash=@wrong_otp_hash,@succeeded=@succeeded OUTPUT,@user_id=@user_id OUTPUT,
            @patient_public_id=@patient_public_id OUTPUT,@patient_code=@patient_code OUTPUT;
        SET @try=@try+1;
    END;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.patient_registration_challenges WHERE registration_challenge_id=@locked_challenge
        AND attempt_count=5 AND revocation_reason='TOO_MANY_ATTEMPTS' AND revoked_at_utc IS NOT NULL)
        THROW 55412,N'Challenge không khóa sau số lần thử OTP tối đa.',1;

    DECLARE @rate_contact varchar(254)=CONCAT('rate-',@suffix,'@example.test'),@rate_try int=1;
    WHILE @rate_try<=4
    BEGIN
        DECLARE @rate_challenge uniqueidentifier=NEWID(),@rate_idempotency uniqueidentifier=NEWID();
        DECLARE @rate_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('rate-',@rate_try,'-',@suffix));
        DECLARE @rate_username nvarchar(80)=CONCAT(N'patient_',REPLACE(CONVERT(nvarchar(36),@rate_challenge),N'-',N''));
        EXEC dbo.sp_auth_create_patient_registration
            @registration_challenge_id=@rate_challenge,@idempotency_key=@rate_idempotency,
            @request_hash=@rate_hash,@branch_id=@branch_id,@username=@rate_username,
            @contact_channel='EMAIL',@contact_value=@rate_contact,@contact_normalized=@rate_contact,
            @password_hash=@password_hash,@full_name=N'Kiểm thử rate limit',
            @date_of_birth='1990-01-02',@gender='FEMALE',@otp_hash=@otp_hash,
            @expires_at_utc=@expires_at_utc,@max_requests_per_hour=3,
            @effective_challenge_id=@effective_id OUTPUT,@created=@created OUTPUT;
        IF (@rate_try<=3 AND @created<>1) OR (@rate_try=4 AND @created<>0)
            THROW 55415,N'Rate limit đăng ký không hoạt động đúng.',1;
        IF @rate_try=4 AND EXISTS
           (SELECT 1 FROM dbo.patient_registration_challenges WHERE registration_challenge_id=@rate_challenge)
            THROW 55416,N'Challenge vượt rate limit vẫn được lưu.',1;
        SET @rate_try=@rate_try+1;
    END;

    DECLARE @different_request_hash binary(32)=HASHBYTES('SHA2_256','different-payload');
    BEGIN TRY
        EXEC dbo.sp_auth_create_patient_registration
            @registration_challenge_id=@retry_challenge,@idempotency_key=@idempotency_key,
            @request_hash=@different_request_hash,@branch_id=@branch_id,@username=@username,
            @contact_channel='EMAIL',@contact_value=@contact,@contact_normalized=@contact,
            @password_hash=@password_hash,@full_name=N'Nội dung khác',
            @date_of_birth='1990-01-02',@gender='FEMALE',@otp_hash=@otp_hash,
            @expires_at_utc=@expires_at_utc,@effective_challenge_id=@effective_id OUTPUT,
            @created=@created OUTPUT;
        THROW 55413,N'Idempotency-Key được phép dùng lại với payload khác.',1;
    END TRY
    BEGIN CATCH
        IF ERROR_NUMBER()<>53073 THROW;
    END CATCH;

    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    SELECT 'PASS' AS patient_registration_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

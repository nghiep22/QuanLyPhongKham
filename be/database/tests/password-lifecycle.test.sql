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
    DECLARE @request_id uniqueidentifier=NEWID();
    DECLARE @old_hash varchar(255)=CONCAT('$argon2id$old-',REPLICATE('x',50));
    DECLARE @reset_hash varchar(255)=CONCAT('$argon2id$reset-',REPLICATE('y',48));
    DECLARE @changed_hash varchar(255)=CONCAT('$argon2id$changed-',REPLICATE('z',46));
    INSERT dbo.users(username,email,password_hash,display_name,status)
    VALUES(CONCAT(N'test-password-',@suffix),CONCAT('password-',@suffix,'@example.test'),
           @old_hash,N'Password lifecycle test','ACTIVE');
    DECLARE @user_id bigint=SCOPE_IDENTITY();
    DECLARE @token_version int=(SELECT token_version FROM dbo.users WHERE user_id=@user_id);
    DECLARE @session_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('session-',@suffix));
    INSERT dbo.user_sessions(session_id,user_id,refresh_token_hash,expires_at_utc,token_version_snapshot)
    VALUES(NEWID(),@user_id,@session_hash,DATEADD(day,1,SYSUTCDATETIME()),@token_version);
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;

    DECLARE @raw_token varchar(100)=CONCAT('raw-',@suffix);
    DECLARE @token_hash binary(32)=HASHBYTES('SHA2_256',@raw_token);
    DECLARE @created bit;
    DECLARE @expires_at_utc datetime2(3)=DATEADD(minute,15,SYSUTCDATETIME());
    EXEC dbo.sp_auth_create_password_reset @user_id=@user_id,@token_hash=@token_hash,
        @requested_ip='127.0.0.1',@expires_at_utc=@expires_at_utc,
        @max_requests_per_hour=3,@created=@created OUTPUT;
    IF @created<>1 OR NOT EXISTS
       (SELECT 1 FROM dbo.password_reset_challenges WHERE user_id=@user_id AND token_hash=@token_hash)
        THROW 55300,N'Không tạo được password reset challenge.',1;
    IF COL_LENGTH(N'dbo.password_reset_challenges',N'token') IS NOT NULL
       OR COL_LENGTH(N'dbo.password_reset_challenges',N'raw_token') IS NOT NULL
        THROW 55301,N'Password reset token không được lưu dạng rõ.',1;

    DECLARE @succeeded bit;
    EXEC dbo.sp_auth_consume_password_reset @token_hash=@token_hash,
        @new_password_hash=@reset_hash,@succeeded=@succeeded OUTPUT;
    IF @succeeded<>1 THROW 55302,N'Không đặt lại được mật khẩu.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.users WHERE user_id=@user_id
                  AND password_hash=@reset_hash AND token_version>@token_version
                  AND failed_login_count=0 AND locked_until_utc IS NULL)
        THROW 55303,N'User không được cập nhật an toàn sau reset.',1;
    IF EXISTS(SELECT 1 FROM dbo.user_sessions WHERE user_id=@user_id AND revoked_at_utc IS NULL)
        THROW 55304,N'Reset mật khẩu chưa thu hồi toàn bộ session.',1;
    SET @succeeded=1;
    EXEC dbo.sp_auth_consume_password_reset @token_hash=@token_hash,
        @new_password_hash=@changed_hash,@succeeded=@succeeded OUTPUT;
    IF @succeeded<>0 THROW 55305,N'Password reset token đã bị replay.',1;

    DECLARE @second_token_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('second-',@suffix));
    SET @expires_at_utc=DATEADD(minute,15,SYSUTCDATETIME());
    EXEC dbo.sp_auth_create_password_reset @user_id=@user_id,@token_hash=@second_token_hash,
        @requested_ip='127.0.0.1',@expires_at_utc=@expires_at_utc,
        @max_requests_per_hour=3,@created=@created OUTPUT;
    EXEC dbo.sp_auth_cancel_password_reset @token_hash=@second_token_hash;
    IF NOT EXISTS(SELECT 1 FROM dbo.password_reset_challenges WHERE token_hash=@second_token_hash
                  AND revoked_at_utc IS NOT NULL AND revocation_reason='DELIVERY_FAILED')
        THROW 55306,N'Không hủy challenge khi delivery thất bại.',1;

    DECLARE @third_token_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('third-',@suffix));
    DECLARE @fourth_token_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('fourth-',@suffix));
    DECLARE @fifth_token_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('fifth-',@suffix));
    SET @expires_at_utc=DATEADD(minute,15,SYSUTCDATETIME());
    EXEC dbo.sp_auth_create_password_reset @user_id=@user_id,@token_hash=@third_token_hash,
        @expires_at_utc=@expires_at_utc,@max_requests_per_hour=3,@created=@created OUTPUT;
    IF @created<>1 THROW 55309,N'Challenge hợp lệ thứ hai bị từ chối sai.',1;
    EXEC dbo.sp_auth_create_password_reset @user_id=@user_id,@token_hash=@fourth_token_hash,
        @expires_at_utc=@expires_at_utc,@max_requests_per_hour=3,@created=@created OUTPUT;
    IF @created<>1 THROW 55310,N'Challenge hợp lệ thứ ba bị từ chối sai.',1;
    EXEC dbo.sp_auth_create_password_reset @user_id=@user_id,@token_hash=@fifth_token_hash,
        @expires_at_utc=@expires_at_utc,@max_requests_per_hour=3,@created=@created OUTPUT;
    IF @created<>0 OR EXISTS(SELECT 1 FROM dbo.password_reset_challenges WHERE token_hash=@fifth_token_hash)
        THROW 55311,N'Không giới hạn số yêu cầu reset trong một giờ.',1;

    DECLARE @new_session_hash binary(32)=HASHBYTES('SHA2_256',CONCAT('new-session-',@suffix));
    SET @token_version=(SELECT token_version FROM dbo.users WHERE user_id=@user_id);
    INSERT dbo.user_sessions(session_id,user_id,refresh_token_hash,expires_at_utc,token_version_snapshot)
    VALUES(NEWID(),@user_id,@new_session_hash,DATEADD(day,1,SYSUTCDATETIME()),@token_version);
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@user_id;
    EXEC dbo.sp_auth_change_password @actor_user_id=@user_id,
        @expected_password_hash=@reset_hash,@new_password_hash=@changed_hash;
    IF NOT EXISTS(SELECT 1 FROM dbo.users WHERE user_id=@user_id AND password_hash=@changed_hash
                  AND token_version>@token_version)
        THROW 55307,N'Đổi mật khẩu xác thực thất bại.',1;
    IF EXISTS(SELECT 1 FROM dbo.user_sessions WHERE user_id=@user_id AND revoked_at_utc IS NULL)
        THROW 55308,N'Đổi mật khẩu chưa thu hồi toàn bộ session.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    ROLLBACK TRANSACTION;
    SELECT 'PASS' AS password_lifecycle_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    THROW;
END CATCH;

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
    DECLARE @username nvarchar(80)=CONCAT(N'test-auth-',@suffix);
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(@username,REPLICATE('x',60),N'Auth integration test','ACTIVE');
    DECLARE @user_id bigint=SCOPE_IDENTITY();
    DECLARE @version int=(SELECT token_version FROM dbo.users WHERE user_id=@user_id);

    DECLARE @hash1 binary(32)=HASHBYTES('SHA2_256',CONCAT('one-',@suffix));
    DECLARE @hash2 binary(32)=HASHBYTES('SHA2_256',CONCAT('two-',@suffix));
    DECLARE @hash3 binary(32)=HASHBYTES('SHA2_256',CONCAT('three-',@suffix));
    DECLARE @hash4 binary(32)=HASHBYTES('SHA2_256',CONCAT('four-',@suffix));
    DECLARE @session1 uniqueidentifier,@session2 uniqueidentifier,@session3 uniqueidentifier,@rotated_user bigint,
            @rotated_version int,@reuse bit;
    DECLARE @expires_at_utc datetime2(3)=DATEADD(day,7,SYSUTCDATETIME());

    EXEC dbo.sp_auth_create_session @user_id=@user_id,@expected_token_version=@version,
        @refresh_token_hash=@hash1,@expires_at_utc=@expires_at_utc,
        @session_id=@session1 OUTPUT;
    IF @session1 IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.user_sessions WHERE session_id=@session1)
        THROW 55001,N'Không tạo được auth session.',1;

    EXEC dbo.sp_auth_rotate_session @current_refresh_token_hash=@hash1,
        @new_refresh_token_hash=@hash2,@expires_at_utc=@expires_at_utc,
        @user_id=@rotated_user OUTPUT,@token_version=@rotated_version OUTPUT,
        @new_session_id=@session2 OUTPUT,@reuse_detected=@reuse OUTPUT;
    IF @reuse<>0 OR @session2 IS NULL OR @rotated_user<>@user_id
        THROW 55002,N'Refresh rotation không hợp lệ.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.user_sessions WHERE session_id=@session1 AND replaced_by_id=@session2 AND revocation_reason='ROTATED')
        THROW 55003,N'Session cũ chưa được đánh dấu ROTATED.',1;

    -- Dùng lại token đã rotate phải thu hồi toàn bộ family và tăng token_version.
    EXEC dbo.sp_auth_rotate_session @current_refresh_token_hash=@hash1,
        @new_refresh_token_hash=@hash3,@expires_at_utc=@expires_at_utc,
        @user_id=@rotated_user OUTPUT,@token_version=@rotated_version OUTPUT,
        @new_session_id=@session2 OUTPUT,@reuse_detected=@reuse OUTPUT;
    IF @reuse<>1 THROW 55004,N'Không phát hiện refresh token replay.',1;
    IF EXISTS(SELECT 1 FROM dbo.user_sessions WHERE user_id=@user_id AND revoked_at_utc IS NULL)
        THROW 55005,N'Replay chưa thu hồi toàn bộ session.',1;
    IF (SELECT token_version FROM dbo.users WHERE user_id=@user_id)<>@version+1
        THROW 55006,N'Replay chưa tăng token_version.',1;

    -- Tài khoản bị khóa không được rotate sang session mới.
    DECLARE @next_version int=@version+1;
    EXEC dbo.sp_auth_create_session @user_id=@user_id,@expected_token_version=@next_version,
        @refresh_token_hash=@hash3,@expires_at_utc=@expires_at_utc,
        @session_id=@session3 OUTPUT;
    UPDATE dbo.users SET locked_until_utc=DATEADD(minute,15,SYSUTCDATETIME()) WHERE user_id=@user_id;
    EXEC dbo.sp_auth_rotate_session @current_refresh_token_hash=@hash3,
        @new_refresh_token_hash=@hash4,@expires_at_utc=@expires_at_utc,
        @user_id=@rotated_user OUTPUT,@token_version=@rotated_version OUTPUT,
        @new_session_id=@session2 OUTPUT,@reuse_detected=@reuse OUTPUT;
    IF @reuse<>0 OR @session2 IS NOT NULL
        THROW 55007,N'Tài khoản bị khóa vẫn rotate được session.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.user_sessions WHERE session_id=@session3 AND revoked_at_utc IS NOT NULL)
        THROW 55008,N'Session của tài khoản bị khóa chưa được thu hồi.',1;

    ROLLBACK TRANSACTION;
    SELECT 'PASS' AS auth_session_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

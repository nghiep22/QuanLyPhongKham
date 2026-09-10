SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
DECLARE @admin_role_id bigint=(SELECT role_id FROM dbo.roles WHERE role_code='ADMIN');
DECLARE @manager_role_id bigint=(SELECT role_id FROM dbo.roles WHERE role_code='MANAGER');
DECLARE @roles_manage_permission_id bigint=
    (SELECT permission_id FROM dbo.permissions WHERE permission_code='ROLES_MANAGE');
IF @branch_id IS NULL OR @admin_role_id IS NULL OR @manager_role_id IS NULL
   OR @roles_manage_permission_id IS NULL
    THROW 55200,N'Thiếu dữ liệu seed để kiểm thử an toàn tài khoản.',1;

-- Không được tự vô hiệu hóa tài khoản đang dùng.
DECLARE @self_error int=NULL;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @self_suffix varchar(36)=CONVERT(varchar(36),NEWID());
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'test-self-',@self_suffix),REPLICATE('x',60),N'Self admin','ACTIVE');
    DECLARE @self_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.employees(user_id,primary_branch_id,employee_code,employee_type,full_name,hire_date)
    VALUES(@self_user_id,@branch_id,CONCAT('S',LEFT(@self_suffix,20)),'MANAGER',N'Self admin','2026-01-01');
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@self_user_id,@admin_role_id,NULL,@self_user_id);
    EXEC dbo.sp_set_staff_account_status @actor_user_id=@self_user_id,
        @target_user_id=@self_user_id,@status='DISABLED',@reason=N'Tự khóa thử';
    SET @self_error=0;
END TRY
BEGIN CATCH
    SET @self_error=ERROR_NUMBER();
END CATCH;
IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
IF @self_error<>53048 THROW 55201,N'Không chặn đúng thao tác tự vô hiệu hóa.',1;

-- USERS_MANAGE phạm vi toàn cục vẫn không được sửa Admin nếu actor không phải Admin.
DECLARE @admin_target_error int=NULL;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @scope_suffix varchar(36)=CONVERT(varchar(36),NEWID());
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'test-manager-',@scope_suffix),REPLICATE('x',60),N'Global manager','ACTIVE');
    DECLARE @manager_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@manager_user_id,@manager_role_id,NULL,@manager_user_id);
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'test-admin-',@scope_suffix),REPLICATE('x',60),N'Protected admin','ACTIVE');
    DECLARE @protected_admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.employees(user_id,primary_branch_id,employee_code,employee_type,full_name,hire_date)
    VALUES(@protected_admin_id,@branch_id,CONCAT('P',LEFT(@scope_suffix,20)),'MANAGER',N'Protected admin','2026-01-01');
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@protected_admin_id,@admin_role_id,NULL,@protected_admin_id);
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@manager_user_id;
    EXEC dbo.sp_set_staff_account_status @actor_user_id=@manager_user_id,
        @target_user_id=@protected_admin_id,@status='DISABLED',@reason=N'Thử vượt quyền';
    SET @admin_target_error=0;
END TRY
BEGIN CATCH
    SET @admin_target_error=ERROR_NUMBER();
END CATCH;
IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
IF @admin_target_error<>51002
BEGIN
    SELECT @admin_target_error AS unexpected_admin_target_error;
    THROW 55202,N'Không bảo vệ Admin khỏi actor không phải Admin.',1;
END;

-- Dù có ROLES_MANAGE, không được thu hồi vai trò của Admin toàn cục cuối cùng.
DECLARE @last_admin_error int=NULL;
BEGIN TRY
    BEGIN TRANSACTION;
    DECLARE @last_suffix varchar(36)=CONVERT(varchar(36),NEWID());
    IF NOT EXISTS(SELECT 1 FROM dbo.role_permissions
                  WHERE role_id=@manager_role_id AND permission_id=@roles_manage_permission_id)
        INSERT dbo.role_permissions(role_id,permission_id)
        VALUES(@manager_role_id,@roles_manage_permission_id);
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'test-role-manager-',@last_suffix),REPLICATE('x',60),N'Role manager','ACTIVE');
    DECLARE @role_manager_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@role_manager_id,@manager_role_id,NULL,@role_manager_id);
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'test-last-admin-',@last_suffix),REPLICATE('x',60),N'Last admin','ACTIVE');
    DECLARE @last_admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    VALUES(@last_admin_id,@admin_role_id,NULL,@last_admin_id);
    DECLARE @last_admin_assignment_id bigint=SCOPE_IDENTITY();
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@role_manager_id;
    EXEC dbo.sp_revoke_user_role @actor_user_id=@role_manager_id,
        @user_role_id=@last_admin_assignment_id,@reason=N'Thử thu hồi Admin cuối';
    SET @last_admin_error=0;
END TRY
BEGIN CATCH
    SET @last_admin_error=ERROR_NUMBER();
END CATCH;
IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
IF @last_admin_error<>53057 THROW 55203,N'Không bảo vệ Admin toàn cục cuối cùng.',1;

SELECT 'PASS' AS staff_safety_test;

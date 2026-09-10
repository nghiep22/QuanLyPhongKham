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
    DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
    DECLARE @specialty_id bigint=(SELECT specialty_id FROM dbo.specialties WHERE specialty_code='GENERAL');
    IF @branch_id IS NULL OR @specialty_id IS NULL
        THROW 55100,N'Thiếu dữ liệu seed MAIN/GENERAL.',1;

    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'test-admin-',@suffix),REPLICATE('x',60),N'Test global admin','ACTIVE');
    DECLARE @actor_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @actor_user_id,role_id,NULL,@actor_user_id FROM dbo.roles WHERE role_code='ADMIN';

    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@actor_user_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

    DECLARE @staff_user_id bigint,@employee_id bigint,@doctor_id bigint;
    DECLARE @doctor_username nvarchar(80)=CONCAT(N'test-doctor-',@suffix);
    DECLARE @doctor_employee_code varchar(30)=CONCAT('T',LEFT(@suffix,20));
    DECLARE @medical_license_no nvarchar(100)=CONCAT(N'LIC-',@suffix);
    EXEC dbo.sp_create_staff_account
        @actor_user_id=@actor_user_id,@branch_id=@branch_id,
        @username=@doctor_username,@email=NULL,@phone=NULL,
        @password_hash='argon2id-test-hash-that-is-never-used-xxxxxxxxxxxxxxxxxxxx',
        @employee_code=@doctor_employee_code,@employee_type='DOCTOR',
        @full_name=N'Bác sĩ kiểm thử',@date_of_birth='1990-01-01',@gender='OTHER',
        @address_line=N'Địa chỉ kiểm thử',@hire_date='2026-01-01',
        @medical_license_no=@medical_license_no,@license_issued_date='2020-01-01',
        @license_expiry_date='2030-01-01',@academic_title=N'BS',
        @biography=N'Hồ sơ kiểm thử',@default_slot_minutes=30,
        @accepts_online_booking=1,@specialty_id=@specialty_id,
        @user_id=@staff_user_id OUTPUT,@employee_id=@employee_id OUTPUT,@doctor_id=@doctor_id OUTPUT;
    IF @staff_user_id IS NULL OR @employee_id IS NULL OR @doctor_id IS NULL
        THROW 55101,N'Không tạo đủ account/employee/doctor.',1;
    IF NOT EXISTS
    (
        SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
        WHERE ur.user_id=@staff_user_id AND ur.branch_id=@branch_id
          AND r.role_code='DOCTOR' AND ur.is_active=1
    ) THROW 55102,N'Không gán role DOCTOR mặc định.',1;

    DECLARE @employee_row_ver binary(8)=(SELECT row_ver FROM dbo.employees WHERE employee_id=@employee_id);
    DECLARE @doctor_row_ver binary(8)=(SELECT row_ver FROM dbo.doctors WHERE doctor_id=@doctor_id);
    EXEC dbo.sp_update_staff_account
        @actor_user_id=@actor_user_id,@target_user_id=@staff_user_id,
        @email='doctor.test@example.com',@phone='0900000000',@full_name=N'Bác sĩ đã cập nhật',
        @date_of_birth='1990-01-01',@gender='OTHER',@address_line=N'Địa chỉ mới',
        @hire_date='2026-01-01',@employment_status='ACTIVE',@termination_date=NULL,
        @medical_license_no=@medical_license_no,@license_issued_date='2020-01-01',
        @license_expiry_date='2031-01-01',@academic_title=N'ThS.BS',
        @biography=N'Hồ sơ mới',@default_slot_minutes=20,@accepts_online_booking=0,
        @expected_employee_row_ver=@employee_row_ver,@expected_doctor_row_ver=@doctor_row_ver;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.employees WHERE employee_id=@employee_id AND full_name=N'Bác sĩ đã cập nhật')
        THROW 55103,N'Cập nhật hồ sơ nhân viên thất bại.',1;

    UPDATE dbo.users SET failed_login_count=5,locked_until_utc=DATEADD(minute,15,SYSUTCDATETIME())
    WHERE user_id=@staff_user_id;
    EXEC dbo.sp_unlock_staff_account @actor_user_id=@actor_user_id,
        @target_user_id=@staff_user_id,@reason=N'Đã xác minh danh tính';
    IF EXISTS(SELECT 1 FROM dbo.users WHERE user_id=@staff_user_id
              AND (failed_login_count<>0 OR locked_until_utc IS NOT NULL))
        THROW 55104,N'Mở khóa tài khoản thất bại.',1;

    EXEC dbo.sp_set_staff_account_status @actor_user_id=@actor_user_id,
        @target_user_id=@staff_user_id,@status='DISABLED',@reason=N'Tạm ngưng công tác';
    IF NOT EXISTS(SELECT 1 FROM dbo.users WHERE user_id=@staff_user_id AND status='DISABLED')
        THROW 55105,N'Vô hiệu hóa tài khoản thất bại.',1;
    EXEC dbo.sp_set_staff_account_status @actor_user_id=@actor_user_id,
        @target_user_id=@staff_user_id,@status='ACTIVE',@reason=N'Đi làm trở lại';

    DECLARE @version_before int=(SELECT token_version FROM dbo.users WHERE user_id=@staff_user_id);
    EXEC dbo.sp_grant_user_role @actor_user_id=@actor_user_id,@target_user_id=@staff_user_id,
        @role_code='NURSE',@branch_id=@branch_id,@valid_to_utc=NULL;
    DECLARE @nurse_assignment_id bigint=
    (
        SELECT ur.user_role_id FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
        WHERE ur.user_id=@staff_user_id AND ur.branch_id=@branch_id AND r.role_code='NURSE' AND ur.is_active=1
    );
    IF @nurse_assignment_id IS NULL OR
       (SELECT token_version FROM dbo.users WHERE user_id=@staff_user_id)<=@version_before
        THROW 55106,N'Gán role hoặc thu hồi token cũ thất bại.',1;
    EXEC dbo.sp_revoke_user_role @actor_user_id=@actor_user_id,
        @user_role_id=@nurse_assignment_id,@reason=N'Kết thúc phân công';
    IF EXISTS(SELECT 1 FROM dbo.user_roles WHERE user_role_id=@nurse_assignment_id AND is_active=1)
        THROW 55107,N'Thu hồi role thất bại.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    ROLLBACK TRANSACTION;

    -- Role không có USERS_MANAGE phải bị chặn ở cấp database. Lỗi permission
    -- làm transaction hiện tại thành uncommittable, nên đây là transaction riêng.
    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'test-reception-',@suffix),REPLICATE('x',60),N'Test receptionist','ACTIVE');
    DECLARE @unauthorized_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @unauthorized_user_id,role_id,@branch_id,@unauthorized_user_id
    FROM dbo.roles WHERE role_code='RECEPTIONIST';
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@unauthorized_user_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;
    DECLARE @permission_error int=NULL;
    BEGIN TRY
        DECLARE @blocked_user bigint,@blocked_employee bigint,@blocked_doctor bigint;
        DECLARE @blocked_username nvarchar(80)=CONCAT(N'blocked-',@suffix);
        DECLARE @blocked_employee_code varchar(30)=CONCAT('B',LEFT(@suffix,20));
        DECLARE @blocked_password_hash varchar(255)=REPLICATE('x',60);
        EXEC dbo.sp_create_staff_account
            @actor_user_id=@unauthorized_user_id,@branch_id=@branch_id,
            @username=@blocked_username,@password_hash=@blocked_password_hash,
            @employee_code=@blocked_employee_code,@employee_type='OTHER',
            @full_name=N'Không được tạo',@hire_date='2026-01-01',
            @user_id=@blocked_user OUTPUT,@employee_id=@blocked_employee OUTPUT,
            @doctor_id=@blocked_doctor OUTPUT;
        SET @permission_error=0;
    END TRY
    BEGIN CATCH
        SET @permission_error=ERROR_NUMBER();
    END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @permission_error<>51002
        THROW 55109,N'Role RECEPTIONIST không bị chặn đúng ở cấp database.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    SELECT 'PASS' AS staff_rbac_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

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
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID());
    DECLARE @request_id uniqueidentifier=NEWID();
    DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
    DECLARE @category_id bigint=(SELECT service_category_id FROM dbo.service_categories WHERE category_code='CONSULTATION');
    DECLARE @specialty_id bigint=(SELECT specialty_id FROM dbo.specialties WHERE specialty_code='GENERAL');
    IF @branch_id IS NULL OR @category_id IS NULL OR @specialty_id IS NULL
        THROW 55600,N'Thiếu dữ liệu seed cho regression danh mục.',1;
    IF EXISTS
    (
        SELECT required.object_name,required.permission_name
        FROM (VALUES
          (N'sp_create_room',N'EXECUTE'),(N'sp_update_room',N'EXECUTE'),
          (N'sp_create_service',N'EXECUTE'),(N'sp_update_service',N'EXECUTE'),
          (N'sp_set_branch_service_price',N'EXECUTE'),
          (N'v_clinic_principal_v1',N'SELECT'),(N'v_public_branches_v1',N'SELECT'),
          (N'v_public_specialties_v1',N'SELECT'),(N'v_public_services_v1',N'SELECT'),
          (N'v_public_doctors_v1',N'SELECT'),(N'v_catalog_rooms_v1',N'SELECT'),
          (N'v_catalog_services_v1',N'SELECT')
        ) required(object_name,permission_name)
        WHERE NOT EXISTS
        (
            SELECT 1 FROM sys.database_permissions dp
            WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
              AND dp.major_id=OBJECT_ID(N'dbo.'+required.object_name)
              AND dp.permission_name=required.permission_name AND dp.state IN ('G','W')
        )
    ) THROW 55609,N'clinic_api_executor thiếu quyền tối thiểu cho catalog contract.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'catalog-admin-',@suffix),REPLICATE('x',60),N'Catalog Admin','ACTIVE');
    DECLARE @admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

    DECLARE @room_id bigint;
    DECLARE @room_code varchar(30)=CONCAT('CR',LEFT(@suffix,20));
    EXEC dbo.sp_create_room @actor_user_id=@admin_id,@branch_id=@branch_id,
        @room_code=@room_code,@room_name=N'Phòng catalog test',@room_type='CONSULTATION',
        @floor_no=2,@capacity=1,@room_id=@room_id OUTPUT;
    IF @room_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM dbo.v_catalog_rooms_v1 WHERE room_id=@room_id AND public_id IS NOT NULL)
        THROW 55601,N'Không tạo hoặc không đọc được phòng qua contract view.',1;

    DECLARE @room_version binary(8)=(SELECT row_ver FROM dbo.rooms WHERE room_id=@room_id);
    EXEC dbo.sp_update_room @actor_user_id=@admin_id,@branch_id=@branch_id,@room_id=@room_id,
        @room_name=N'Phòng catalog đã sửa',@room_type='PROCEDURE',@floor_no=3,
        @capacity=2,@is_active=1,@expected_row_ver=@room_version;
    IF NOT EXISTS (SELECT 1 FROM dbo.rooms WHERE room_id=@room_id AND room_name=N'Phòng catalog đã sửa' AND capacity=2)
        THROW 55602,N'Cập nhật phòng thất bại.',1;

    DECLARE @service_id bigint;
    DECLARE @service_code varchar(30)=CONCAT('CS',LEFT(@suffix,20));
    EXEC dbo.sp_create_service @actor_user_id=@admin_id,@branch_id=NULL,
        @service_category_id=@category_id,@specialty_id=@specialty_id,
        @service_code=@service_code,@service_name=N'Dịch vụ catalog test',
        @service_type='CONSULTATION',@default_duration_min=30,@current_price=300000,
        @requires_doctor=1,@service_id=@service_id OUTPUT;
    IF @service_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM dbo.v_catalog_services_v1 WHERE service_id=@service_id AND public_id IS NOT NULL)
        THROW 55603,N'Không tạo hoặc không đọc được dịch vụ qua contract view.',1;

    DECLARE @business_date date;
    EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
    DECLARE @price_id bigint;
    EXEC dbo.sp_set_branch_service_price @actor_user_id=@admin_id,@branch_id=@branch_id,
        @service_id=@service_id,@price_amount=325000,@effective_from=@business_date,
        @is_available=1,@service_branch_price_id=@price_id OUTPUT;
    IF @price_id IS NULL OR NOT EXISTS
       (SELECT 1 FROM dbo.v_public_services_v1 WHERE service_public_id=
          (SELECT public_id FROM dbo.services WHERE service_id=@service_id) AND price_amount='325000.00')
        THROW 55604,N'Giá hiệu lực không xuất hiện trong public service view.',1;

    DECLARE @next_price_id bigint,@next_date date=DATEADD(day,7,@business_date);
    EXEC dbo.sp_set_branch_service_price @actor_user_id=@admin_id,@branch_id=@branch_id,
        @service_id=@service_id,@price_amount=350000,@effective_from=@next_date,
        @is_available=1,@service_branch_price_id=@next_price_id OUTPUT;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.service_branch_prices WHERE service_branch_price_id=@price_id
        AND effective_to=DATEADD(day,6,@business_date))
        THROW 55605,N'Khoảng giá trước không được đóng đúng khi lên lịch giá mới.',1;

    DECLARE @staff_user_id bigint,@employee_id bigint,@doctor_id bigint;
    DECLARE @doctor_username nvarchar(80)=CONCAT(N'catalog-doctor-',@suffix);
    DECLARE @doctor_code varchar(30)=CONCAT('CD',LEFT(@suffix,20));
    DECLARE @doctor_license nvarchar(100)=CONCAT(N'CAT-LIC-',@suffix);
    DECLARE @doctor_password varchar(255)=REPLICATE('x',60);
    EXEC dbo.sp_create_staff_account @actor_user_id=@admin_id,@branch_id=@branch_id,
        @username=@doctor_username,@password_hash=@doctor_password,
        @employee_code=@doctor_code,@employee_type='DOCTOR',
        @full_name=N'Bác sĩ Catalog',@hire_date=@business_date,
        @medical_license_no=@doctor_license,@default_slot_minutes=30,
        @accepts_online_booking=1,@specialty_id=@specialty_id,
        @user_id=@staff_user_id OUTPUT,@employee_id=@employee_id OUTPUT,@doctor_id=@doctor_id OUTPUT;
    EXEC dbo.sp_assign_doctor_service @actor_user_id=@admin_id,@branch_id=@branch_id,
        @doctor_id=@doctor_id,@service_id=@service_id,@custom_duration_min=30;
    IF NOT EXISTS
       (SELECT 1 FROM dbo.v_public_doctors_v1 WHERE doctor_public_id=
          (SELECT public_id FROM dbo.doctors WHERE doctor_id=@doctor_id)
          AND service_public_id=(SELECT public_id FROM dbo.services WHERE service_id=@service_id))
        THROW 55606,N'Bác sĩ nhận lịch không xuất hiện trong public directory.',1;

    IF NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE actor_user_id=@admin_id AND action_code='SERVICE_BRANCH_PRICE_SET')
        THROW 55607,N'Thay đổi giá chi nhánh không được audit.',1;
    ROLLBACK TRANSACTION;

    -- Manager có quyền danh mục tại chi nhánh nhưng không được tạo định nghĩa dịch vụ toàn tổ chức.
    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'catalog-manager-',@suffix),REPLICATE('x',60),N'Catalog Manager','ACTIVE');
    DECLARE @manager_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @manager_id,role_id,@branch_id,@manager_id FROM dbo.roles WHERE role_code='MANAGER';
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@manager_id;
    DECLARE @permission_error int=NULL,@blocked_service_id bigint;
    BEGIN TRY
        EXEC dbo.sp_create_service @actor_user_id=@manager_id,@branch_id=@branch_id,
            @service_category_id=@category_id,@specialty_id=@specialty_id,
            @service_code='BLOCKED_SERVICE',@service_name=N'Không được tạo',
            @service_type='CONSULTATION',@default_duration_min=30,@current_price=1,
            @requires_doctor=1,@service_id=@blocked_service_id OUTPUT;
        SET @permission_error=0;
    END TRY
    BEGIN CATCH
        SET @permission_error=ERROR_NUMBER();
    END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @permission_error<>51002
        THROW 55608,N'Manager chi nhánh không bị chặn khi tạo dịch vụ toàn tổ chức.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    SELECT 'PASS' AS catalog_directory_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

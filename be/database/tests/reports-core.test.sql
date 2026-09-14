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
    IF EXISTS (SELECT 1 FROM (VALUES (N'sp_clinic_report_branches'),(N'sp_clinic_operations_report'),
      (N'sp_clinic_revenue_report'),(N'sp_clinic_inventory_report')) forbidden(name)
      JOIN sys.database_permissions dp ON dp.major_id=OBJECT_ID(N'dbo.'+forbidden.name)
      WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
      THROW 55970,N'Clinic mutation role không được có quyền report procedure.',1;
    IF EXISTS (SELECT 1 FROM (VALUES (N'sp_clinic_report_branches'),(N'sp_clinic_operations_report'),
      (N'sp_clinic_revenue_report'),(N'sp_clinic_inventory_report')) required(name)
      WHERE NOT EXISTS (SELECT 1 FROM sys.database_permissions dp
        WHERE dp.major_id=OBJECT_ID(N'dbo.'+required.name)
          AND dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_report_reader')
          AND dp.permission_name='EXECUTE' AND dp.state IN('G','W')))
      THROW 55971,N'Report reader thiếu quyền procedure chỉ đọc.',1;

    BEGIN TRANSACTION;
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID()),
      @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN'),
      @branch_public_id uniqueidentifier=(SELECT public_id FROM dbo.branches WHERE branch_code='MAIN'),
      @from date=DATEADD(DAY,-30,CONVERT(date,SYSUTCDATETIME())),@to date=CONVERT(date,SYSUTCDATETIME());
    IF @branch_id IS NULL THROW 55972,N'Thiếu seed chi nhánh MAIN.',1;

    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'report-manager-',@suffix),REPLICATE('x',60),N'Report Manager','ACTIVE'),
          (CONCAT(N'report-cashier-',@suffix),REPLICATE('x',60),N'Report Cashier','ACTIVE'),
          (CONCAT(N'report-pharmacist-',@suffix),REPLICATE('x',60),N'Report Pharmacist','ACTIVE'),
          (CONCAT(N'report-patient-',@suffix),REPLICATE('x',60),N'Report Patient','ACTIVE');
    DECLARE @manager bigint=(SELECT user_id FROM dbo.users WHERE username=CONCAT(N'report-manager-',@suffix)),
      @cashier bigint=(SELECT user_id FROM dbo.users WHERE username=CONCAT(N'report-cashier-',@suffix)),
      @pharmacist bigint=(SELECT user_id FROM dbo.users WHERE username=CONCAT(N'report-pharmacist-',@suffix)),
      @patient bigint=(SELECT user_id FROM dbo.users WHERE username=CONCAT(N'report-patient-',@suffix));
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT v.user_id,r.role_id,@branch_id,@manager FROM (VALUES
      (@manager,'MANAGER'),(@cashier,'CASHIER'),(@pharmacist,'PHARMACIST'),(@patient,'PATIENT')
    ) v(user_id,role_code) JOIN dbo.roles r ON r.role_code=v.role_code;

    EXEC sys.sp_set_session_context @key=N'request_id',@value=@suffix;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@manager;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

    DECLARE @branches TABLE(publicId uniqueidentifier,code varchar(20),name nvarchar(200),timezoneName sysname,
      canViewOperations bit,canViewRevenue bit,canViewInventory bit);
    INSERT @branches EXEC dbo.sp_clinic_report_branches @actor_user_id=@manager;
    IF NOT EXISTS (SELECT 1 FROM @branches WHERE publicId=@branch_public_id AND canViewOperations=1
      AND canViewRevenue=1 AND canViewInventory=1)
      THROW 55973,N'Manager không nhận đủ capability tại chi nhánh được cấp.',1;

    CREATE USER [clinic_report_regression_user] WITHOUT LOGIN;
    ALTER ROLE clinic_report_reader ADD MEMBER [clinic_report_regression_user];
    DELETE FROM @branches;
    EXECUTE AS USER='clinic_report_regression_user';
    INSERT @branches EXEC dbo.sp_clinic_report_branches @actor_user_id=@manager;
    EXEC dbo.sp_clinic_operations_report @actor_user_id=@manager,@branch_public_id=@branch_public_id,@from_date=@from,@to_date=@to;
    REVERT;
    IF NOT EXISTS (SELECT 1 FROM @branches WHERE publicId=@branch_public_id)
      THROW 55980,N'Report reader không chạy được procedure báo cáo qua ownership chain.',1;

    DELETE FROM @branches;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@cashier;
    INSERT @branches EXEC dbo.sp_clinic_report_branches @actor_user_id=@cashier;
    IF NOT EXISTS (SELECT 1 FROM @branches WHERE publicId=@branch_public_id AND canViewOperations=0
      AND canViewRevenue=1 AND canViewInventory=0)
      THROW 55974,N'Cashier nhận sai capability báo cáo.',1;

    DELETE FROM @branches;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@pharmacist;
    INSERT @branches EXEC dbo.sp_clinic_report_branches @actor_user_id=@pharmacist;
    IF NOT EXISTS (SELECT 1 FROM @branches WHERE publicId=@branch_public_id AND canViewOperations=0
      AND canViewRevenue=0 AND canViewInventory=1)
      THROW 55975,N'Pharmacist nhận sai capability báo cáo.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@manager;
    EXEC dbo.sp_clinic_operations_report @actor_user_id=@manager,@branch_public_id=@branch_public_id,@from_date=@from,@to_date=@to;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@cashier;
    EXEC dbo.sp_clinic_revenue_report @actor_user_id=@cashier,@branch_public_id=@branch_public_id,@from_date=@from,@to_date=@to;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@pharmacist;
    EXEC dbo.sp_clinic_inventory_report @actor_user_id=@pharmacist,@branch_public_id=@branch_public_id,@from_date=@from,@to_date=@to;

    DECLARE @error int=0;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@cashier;
    BEGIN TRY
      EXEC dbo.sp_clinic_operations_report @actor_user_id=@cashier,@branch_public_id=@branch_public_id,@from_date=@from,@to_date=@to;
    END TRY BEGIN CATCH SET @error=ERROR_NUMBER(); END CATCH;
    IF @error<>54102 THROW 55976,N'Cashier xem được báo cáo vận hành.',1;
    SET @error=0;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@pharmacist;
    BEGIN TRY
      EXEC dbo.sp_clinic_revenue_report @actor_user_id=@pharmacist,@branch_public_id=@branch_public_id,@from_date=@from,@to_date=@to;
    END TRY BEGIN CATCH SET @error=ERROR_NUMBER(); END CATCH;
    IF @error<>54102 THROW 55977,N'Pharmacist xem được báo cáo doanh thu.',1;
    SET @error=0;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@patient;
    BEGIN TRY
      EXEC dbo.sp_clinic_inventory_report @actor_user_id=@patient,@branch_public_id=@branch_public_id,@from_date=@from,@to_date=@to;
    END TRY BEGIN CATCH SET @error=ERROR_NUMBER(); END CATCH;
    IF @error<>51002 THROW 55978,N'Patient không có REPORTS_VIEW vẫn xem được báo cáo.',1;
    SET @error=0;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@manager;
    BEGIN TRY
      EXEC dbo.sp_clinic_revenue_report @actor_user_id=@manager,@branch_public_id=@branch_public_id,
        @from_date='2025-01-01',@to_date='2026-09-14';
    END TRY BEGIN CATCH SET @error=ERROR_NUMBER(); END CATCH;
    IF @error<>54100 THROW 55979,N'Không chặn khoảng báo cáo quá 366 ngày.',1;

    ROLLBACK TRANSACTION;
    SELECT 'PASS' AS reports_core_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

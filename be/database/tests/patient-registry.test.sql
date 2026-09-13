SET NOCOUNT ON;
SET XACT_ABORT OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

BEGIN TRY
    IF EXISTS (
        SELECT 1 FROM (VALUES
          (N'sp_create_patient'),(N'sp_update_patient'),(N'sp_clinic_patient_branches'),
          (N'sp_clinic_search_patients'),(N'sp_clinic_find_patient_duplicates'),
          (N'sp_clinic_get_patient'),(N'sp_clinic_get_patient_clinical_summary')
        ) v(name)
        WHERE NOT EXISTS (
            SELECT 1 FROM sys.database_permissions dp
            WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
              AND dp.major_id=OBJECT_ID(N'dbo.'+v.name) AND dp.permission_name='EXECUTE' AND dp.state IN ('G','W'))
    ) THROW 55700,N'Clinic thiếu quyền execute trên patient command/read contract.',1;

    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID());
    DECLARE @main_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
    DECLARE @today date=CONVERT(date,SYSUTCDATETIME());
    IF @main_id IS NULL THROW 55701,N'Thiếu chi nhánh MAIN.',1;
    BEGIN TRANSACTION;
    INSERT dbo.branches(branch_code,branch_name,address_line)
    VALUES(CONCAT('PT',LEFT(@suffix,16)),N'Chi nhánh khác',N'Test');
    DECLARE @other_id bigint=SCOPE_IDENTITY();
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-registry-admin-',@suffix),REPLICATE('x',60),N'Admin test','ACTIVE');
    DECLARE @admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-registry-reception-',@suffix),REPLICATE('x',60),N'Reception test','ACTIVE');
    DECLARE @reception_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @reception_id,role_id,@main_id,@admin_id FROM dbo.roles WHERE role_code='RECEPTIONIST';
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-registry-doctor-',@suffix),REPLICATE('x',60),N'Doctor test','ACTIVE');
    DECLARE @doctor_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @doctor_user_id,role_id,@main_id,@admin_id FROM dbo.roles WHERE role_code='DOCTOR';
    INSERT dbo.employees(user_id,primary_branch_id,employee_code,employee_type,full_name,hire_date)
    VALUES(@doctor_user_id,@main_id,CONCAT('PD',LEFT(@suffix,17)),'DOCTOR',N'Bác sĩ test',@today);
    DECLARE @employee_id bigint=SCOPE_IDENTITY();
    INSERT dbo.doctors(employee_id,medical_license_no)
    VALUES(@employee_id,CONCAT(N'PAT-LIC-',@suffix));
    DECLARE @doctor_id bigint=SCOPE_IDENTITY();
    INSERT dbo.doctor_branch_assignments(doctor_id,branch_id,effective_from,is_primary)
    VALUES(@doctor_id,@main_id,DATEADD(day,-1,@today),1);
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@reception_id;

    DECLARE @patient_id bigint,@patient_public_id uniqueidentifier;
    EXEC dbo.sp_create_patient @actor_user_id=@reception_id,@branch_id=@main_id,
        @full_name=N'Bệnh Nhân Kiểm Thử',@date_of_birth='1990-05-14',@gender='FEMALE',
        @phone='090 123 4567',@patient_id=@patient_id OUTPUT,@patient_public_id=@patient_public_id OUTPUT;
    IF @patient_id IS NULL OR @patient_public_id IS NULL OR NOT EXISTS(
        SELECT 1 FROM dbo.patients WHERE patient_id=@patient_id AND registration_branch_id=@main_id)
        THROW 55702,N'Tạo bệnh nhân không gắn đúng chi nhánh/public ID.',1;

    DECLARE @found TABLE(publicId varchar(36),code varchar(30),fullName nvarchar(200),
        dateOfBirth date,gender varchar(10),phone varchar(20),status varchar(20),
        nationalIdLast4 varchar(4),rowVersion binary(8));
    INSERT @found EXEC dbo.sp_clinic_search_patients @actor_user_id=@reception_id,
        @branch_id=@main_id,@query=N'0901234567';
    IF NOT EXISTS(SELECT 1 FROM @found WHERE publicId=CONVERT(varchar(36),@patient_public_id))
        THROW 55703,N'Tra cứu theo điện thoại chuẩn hóa không thấy bệnh nhân.',1;
    DELETE FROM @found;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    INSERT @found EXEC dbo.sp_clinic_search_patients @actor_user_id=@admin_id,@branch_id=@other_id;
    IF EXISTS(SELECT 1 FROM @found WHERE publicId=CONVERT(varchar(36),@patient_public_id))
        THROW 55704,N'Hồ sơ chi nhánh MAIN bị lộ tại chi nhánh khác.',1;
    DELETE FROM @found;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@reception_id;
    INSERT @found EXEC dbo.sp_clinic_find_patient_duplicates @actor_user_id=@reception_id,
        @branch_id=@main_id,@full_name=N'Bệnh Nhân Kiểm Thử',@date_of_birth='1990-05-14',@phone='090-123-4567';
    IF NOT EXISTS(SELECT 1 FROM @found WHERE publicId=CONVERT(varchar(36),@patient_public_id))
        THROW 55705,N'Kiểm tra trùng không tìm ra điện thoại đã chuẩn hóa.',1;

    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;

    INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,
        encounter_source,status,arrived_at_utc,created_by_user_id)
    VALUES(CONCAT('PE',LEFT(@suffix,17)),@main_id,@patient_id,@doctor_id,
        'WALK_IN','WAITING',SYSUTCDATETIME(),@reception_id);
    INSERT dbo.patient_allergies(patient_id,allergen_name,allergy_type,severity)
    VALUES(@patient_id,N'Penicillin','DRUG','SEVERE');
    INSERT dbo.patient_conditions(patient_id,condition_name,status)
    VALUES(@patient_id,N'Tăng huyết áp','ACTIVE');
    EXEC dbo.sp_clinic_get_patient_clinical_summary @actor_user_id=@doctor_user_id,
        @branch_id=@main_id,@patient_public_id=@patient_public_id;
    IF NOT EXISTS(SELECT 1 FROM dbo.audit_logs WHERE action_code='PATIENT_CLINICAL_SUMMARY_READ'
        AND actor_user_id=@doctor_user_id AND entity_id=CONVERT(varchar(36),@patient_public_id))
        THROW 55709,N'Lần đọc lâm sàng không được audit.',1;

    DECLARE @version binary(8)=(SELECT row_ver FROM dbo.patients WHERE patient_id=@patient_id);
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@reception_id;
    EXEC dbo.sp_update_patient @actor_user_id=@reception_id,@branch_id=@main_id,
        @patient_public_id=@patient_public_id,@full_name=N'Bệnh Nhân Đã Sửa',
        @date_of_birth='1990-05-14',@gender='FEMALE',@phone='0901234567',@expected_row_ver=@version;
    IF NOT EXISTS(SELECT 1 FROM dbo.patients WHERE patient_id=@patient_id AND full_name=N'Bệnh Nhân Đã Sửa')
        THROW 55710,N'Cập nhật hành chính thất bại.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.audit_logs WHERE action_code='PATIENT_UPDATED' AND actor_user_id=@reception_id)
        THROW 55711,N'Cập nhật hành chính không được audit.',1;
    DECLARE @overridden_id bigint,@overridden_public_id uniqueidentifier;
    EXEC dbo.sp_create_patient @actor_user_id=@reception_id,@branch_id=@main_id,
        @full_name=N'Hồ Sơ Trùng Có Xác Nhận',@date_of_birth='1990-05-14',@gender='FEMALE',
        @phone='0901234567',@duplicate_override=1,@duplicate_reason=N'Đã đối chiếu giấy tờ và xác nhận người khác',
        @patient_id=@overridden_id OUTPUT,@patient_public_id=@overridden_public_id OUTPUT;
    IF @overridden_id IS NULL OR NOT EXISTS(SELECT 1 FROM dbo.audit_logs
        WHERE actor_user_id=@reception_id AND action_code='PATIENT_CREATED'
          AND new_values_json LIKE '%"duplicateOverride":true%')
        THROW 55713,N'Tạo hồ sơ trùng có lý do không thành công hoặc thiếu audit.',1;
    ROLLBACK TRANSACTION;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-duplicate-admin-',@suffix),REPLICATE('x',60),N'Admin duplicate','ACTIVE');
    SET @admin_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender,phone)
    VALUES(CONCAT('PB',LEFT(@suffix,17)),@main_id,N'Existing',@today,'OTHER','0909998888');
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    DECLARE @duplicate_error int=0;
    BEGIN TRY
        EXEC dbo.sp_create_patient @actor_user_id=@admin_id,@branch_id=@main_id,
            @full_name=N'New',@date_of_birth=@today,@gender='OTHER',@phone='0909998888',
            @patient_id=@patient_id OUTPUT;
    END TRY BEGIN CATCH SET @duplicate_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @duplicate_error<>53630 THROW 55714,N'Tạo trùng không bị chặn khi thiếu xác nhận.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-scope-reception-',@suffix),REPLICATE('x',60),N'Reception scope','ACTIVE');
    SET @reception_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @reception_id,role_id,@main_id,@reception_id FROM dbo.roles WHERE role_code='RECEPTIONIST';
    INSERT dbo.branches(branch_code,branch_name,address_line)
    VALUES(CONCAT('PX',LEFT(@suffix,16)),N'Chi nhánh ngoài phạm vi',N'Test');
    SET @other_id=SCOPE_IDENTITY();
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@reception_id;
    DECLARE @branch_error int=0;
    BEGIN TRY
        EXEC dbo.sp_clinic_search_patients @actor_user_id=@reception_id,@branch_id=@other_id;
    END TRY BEGIN CATCH SET @branch_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @branch_error<>51002 THROW 55706,N'Nhân viên đọc được chi nhánh khác.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-clinical-reception-',@suffix),REPLICATE('x',60),N'Reception clinical','ACTIVE');
    SET @reception_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @reception_id,role_id,@main_id,@reception_id FROM dbo.roles WHERE role_code='RECEPTIONIST';
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('PC',LEFT(@suffix,17)),@main_id,N'Clinical denied',@today,'OTHER');
    SET @patient_public_id=(SELECT public_id FROM dbo.patients WHERE patient_code=CONCAT('PC',LEFT(@suffix,17)));
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@reception_id;
    DECLARE @clinical_error int=0;
    BEGIN TRY
        EXEC dbo.sp_clinic_get_patient_clinical_summary @actor_user_id=@reception_id,
            @branch_id=@main_id,@patient_public_id=@patient_public_id;
    END TRY BEGIN CATCH SET @clinical_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @clinical_error<>51002 THROW 55707,N'Lễ tân đọc được lâm sàng.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-clinical-doctor-',@suffix),REPLICATE('x',60),N'Doctor no care','ACTIVE');
    SET @doctor_user_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @doctor_user_id,role_id,@main_id,@doctor_user_id FROM dbo.roles WHERE role_code='DOCTOR';
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('PN',LEFT(@suffix,17)),@main_id,N'No care',@today,'OTHER');
    SET @patient_public_id=(SELECT public_id FROM dbo.patients WHERE patient_code=CONCAT('PN',LEFT(@suffix,17)));
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    SET @clinical_error=0;
    BEGIN TRY
        EXEC dbo.sp_clinic_get_patient_clinical_summary @actor_user_id=@doctor_user_id,
            @branch_id=@main_id,@patient_public_id=@patient_public_id;
    END TRY BEGIN CATCH SET @clinical_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @clinical_error<>53650 THROW 55708,N'Bác sĩ chưa phụ trách đọc được lâm sàng.',1;

    -- Một lần cập nhật stale phải trả conflict và rollback toàn bộ transaction thử nghiệm.
    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'patient-stale-admin-',@suffix),REPLICATE('x',60),N'Admin stale','ACTIVE');
    SET @admin_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('PS',LEFT(@suffix,17)),@main_id,N'Stale',@today,'OTHER');
    SET @patient_public_id=(SELECT public_id FROM dbo.patients WHERE patient_code=CONCAT('PS',LEFT(@suffix,17)));
    DECLARE @stale_error int=0;
    BEGIN TRY
        EXEC dbo.sp_update_patient @actor_user_id=@admin_id,@branch_id=@main_id,
            @patient_public_id=@patient_public_id,@full_name=N'Stale update',
            @date_of_birth=@today,@gender='OTHER',@expected_row_ver=0x0000000000000000;
    END TRY BEGIN CATCH SET @stale_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @stale_error<>53636 THROW 55712,N'Stale update không trả conflict.',1;

    SELECT 'PASS' AS patient_registry_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

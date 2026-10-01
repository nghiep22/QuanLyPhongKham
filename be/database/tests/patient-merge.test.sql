SET NOCOUNT ON;
SET XACT_ABORT OFF;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;

BEGIN TRY
    IF NOT EXISTS(SELECT 1 FROM sys.database_permissions WHERE grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND major_id=OBJECT_ID(N'dbo.sp_clinic_merge_patients') AND permission_name='EXECUTE' AND state IN ('G','W'))
        THROW 55800,N'Clinic thiếu quyền execute lệnh gộp.',1;
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID());
    DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
    IF @branch_id IS NULL THROW 55801,N'Thiếu chi nhánh MAIN.',1;
    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-admin-',@suffix),REPLICATE('x',60),N'Admin merge','ACTIVE');
    DECLARE @admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-patient-',@suffix),REPLICATE('x',60),N'Patient merge','ACTIVE');
    DECLARE @patient_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @patient_user_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='PATIENT';
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender,national_id,phone)
    VALUES(CONCAT('MS',LEFT(@suffix,17)),@branch_id,N'Nguyễn An nguồn','1990-05-14','FEMALE','012345678901','0901234567');
    DECLARE @source_id bigint=SCOPE_IDENTITY(),@source_public_id uniqueidentifier;
    SELECT @source_public_id=public_id FROM dbo.patients WHERE patient_id=@source_id;
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MT',LEFT(@suffix,17)),@branch_id,N'Nguyễn An chuẩn','1990-05-14','FEMALE');
    DECLARE @target_id bigint=SCOPE_IDENTITY(),@target_public_id uniqueidentifier;
    SELECT @target_public_id=public_id FROM dbo.patients WHERE patient_id=@target_id;
    INSERT dbo.patient_allergies(patient_id,allergen_name,allergy_type,severity)
    VALUES(@source_id,N'Penicillin','DRUG','SEVERE');
    INSERT dbo.patient_conditions(patient_id,condition_name,status)
    VALUES(@source_id,N'Tăng huyết áp','ACTIVE');
    INSERT dbo.patient_emergency_contacts(patient_id,full_name,relationship_name,phone,is_primary)
    VALUES(@source_id,N'Người nhà',N'Cha','0907654321',1);
    INSERT dbo.user_patient_access(user_id,patient_id,relationship_type,status,
        verified_by_user_id,verified_branch_id,verified_at_utc)
    VALUES(@patient_user_id,@source_id,'SELF','ACTIVE',@admin_id,@branch_id,SYSUTCDATETIME());
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-doctor-',@suffix),REPLICATE('x',60),N'Doctor merge','ACTIVE');
    DECLARE @doctor_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @doctor_user_id,role_id,@branch_id,@admin_id FROM dbo.roles WHERE role_code='DOCTOR';
    INSERT dbo.employees(user_id,primary_branch_id,employee_code,employee_type,full_name,hire_date)
    VALUES(@doctor_user_id,@branch_id,CONCAT('ME',LEFT(@suffix,17)),'DOCTOR',N'Bác sĩ gộp',CONVERT(date,SYSUTCDATETIME()));
    DECLARE @employee_id bigint=SCOPE_IDENTITY();
    INSERT dbo.doctors(employee_id,medical_license_no)
    VALUES(@employee_id,CONCAT(N'MERGE-',@suffix));
    DECLARE @doctor_id bigint=SCOPE_IDENTITY();
    INSERT dbo.doctor_branch_assignments(doctor_id,branch_id,effective_from,is_primary)
    VALUES(@doctor_id,@branch_id,DATEADD(day,-1,CONVERT(date,SYSUTCDATETIME())),1);
    INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,
        encounter_source,status,arrived_at_utc,created_by_user_id,chief_complaint)
    VALUES(CONCAT('MX',LEFT(@suffix,17)),@branch_id,@source_id,@doctor_id,
        'WALK_IN','WAITING',SYSUTCDATETIME(),@admin_id,N'Kiểm tra lịch sử gộp');
    DECLARE @encounter_id bigint=SCOPE_IDENTITY(),@encounter_public_id uniqueidentifier;
    SELECT @encounter_public_id=public_id FROM dbo.encounters WHERE encounter_id=@encounter_id;
    UPDATE dbo.encounters SET status='IN_PROGRESS',started_at_utc=SYSUTCDATETIME(),is_in_progress=1
    WHERE encounter_id=@encounter_id;
    UPDATE dbo.encounters SET status='COMPLETED',completed_at_utc=SYSUTCDATETIME(),is_in_progress=0
    WHERE encounter_id=@encounter_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
    DECLARE @signed_hash binary(32),@hash_after binary(32);
    EXEC dbo.sp_sign_encounter @actor_user_id=@doctor_user_id,@encounter_id=@encounter_id,
        @payload_sha256=@signed_hash OUTPUT;
    EXEC dbo.sp_clinic_release_encounter_to_patient @actor_user_id=@doctor_user_id,
        @encounter_public_id=@encounter_public_id;
    DECLARE @source_ver binary(8),@target_ver binary(8);
    SELECT @source_ver=row_ver FROM dbo.patients WHERE patient_id=@source_id;
    SELECT @target_ver=row_ver FROM dbo.patients WHERE patient_id=@target_id;
    DECLARE @permission_error int=0;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@patient_user_id;
    BEGIN TRY
        EXEC dbo.sp_clinic_preview_patient_merge @actor_user_id=@patient_user_id,
            @source_public_id=@source_public_id,@target_public_id=@target_public_id;
    END TRY BEGIN CATCH SET @permission_error=ERROR_NUMBER(); END CATCH;
    IF @permission_error<>51002 THROW 55807,N'Bệnh nhân xem được bản xem trước gộp hồ sơ.',1;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC dbo.sp_clinic_preview_patient_merge @actor_user_id=@admin_id,
        @source_public_id=@source_public_id,@target_public_id=@target_public_id;
    EXEC dbo.sp_clinic_merge_patients @actor_user_id=@admin_id,
        @source_public_id=@source_public_id,@target_public_id=@target_public_id,
        @source_row_ver=@source_ver,@target_row_ver=@target_ver,
        @reason=N'Đã đối chiếu giấy tờ gốc, ngày sinh và xác nhận hai hồ sơ cùng một người.';
    IF NOT EXISTS(SELECT 1 FROM dbo.patients WHERE patient_id=@source_id
        AND status='MERGED' AND merged_into_patient_id=@target_id AND national_id IS NULL)
       OR NOT EXISTS(SELECT 1 FROM dbo.patients WHERE patient_id=@target_id
        AND status='ACTIVE' AND national_id='012345678901' AND phone='0901234567')
        THROW 55802,N'Không chuyển được định danh vào hồ sơ chuẩn.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.patient_merge_history WHERE source_patient_id=@source_id
        AND target_patient_id=@target_id AND performed_by_user_id=@admin_id
        AND JSON_VALUE(source_snapshot_json,'$.nationalId')='012345678901')
       OR NOT EXISTS(SELECT 1 FROM dbo.audit_logs WHERE action_code='PATIENT_MERGED'
        AND actor_user_id=@admin_id AND entity_id=CONVERT(varchar(36),@source_public_id))
        THROW 55803,N'Thiếu lịch sử gộp hoặc audit.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.user_patient_access WHERE user_id=@patient_user_id
        AND patient_id=@target_id AND relationship_type='SELF' AND status='ACTIVE')
       OR NOT EXISTS(SELECT 1 FROM dbo.user_patient_access WHERE user_id=@patient_user_id
        AND patient_id=@source_id AND status='REVOKED')
        THROW 55804,N'Liên kết tài khoản không được chuyển an toàn.',1;
    IF NOT EXISTS(SELECT 1 FROM dbo.patient_allergies pa
        JOIN dbo.v_patient_identity_members member ON member.patient_id=pa.patient_id
        WHERE member.canonical_patient_id=@target_id AND pa.allergen_name=N'Penicillin')
       OR NOT EXISTS(SELECT 1 FROM dbo.patient_conditions pc
        JOIN dbo.v_patient_identity_members member ON member.patient_id=pc.patient_id
        WHERE member.canonical_patient_id=@target_id AND pc.condition_name=N'Tăng huyết áp')
       OR NOT EXISTS(SELECT 1 FROM dbo.patient_emergency_contacts
        WHERE patient_id=@target_id AND full_name=N'Người nhà' AND is_active=1)
        THROW 55805,N'Dữ liệu chăm sóc không xuất hiện ở hồ sơ chuẩn.',1;
    EXEC dbo.sp_clinic_list_patient_merge_history @actor_user_id=@admin_id,
        @target_public_id=@target_public_id;
    DECLARE @search TABLE(publicId varchar(36),code varchar(30),fullName nvarchar(200),
        dateOfBirth date,gender varchar(10),phone varchar(20),status varchar(20),
        nationalIdLast4 varchar(4),rowVersion binary(8));
    DECLARE @source_code varchar(30)=(SELECT patient_code FROM dbo.patients WHERE patient_id=@source_id);
    INSERT @search EXEC dbo.sp_clinic_search_patients @actor_user_id=@admin_id,
        @branch_id=@branch_id,@query=@source_code;
    IF NOT EXISTS(SELECT 1 FROM @search WHERE publicId=CONVERT(varchar(36),@target_public_id))
        THROW 55808,N'Tra cứu mã hồ sơ nguồn không dẫn tới hồ sơ chuẩn.',1;
    EXEC dbo.sp_compute_encounter_signature_hash @encounter_id=@encounter_id,
        @canonical_schema_version='CLINIC_RECORD_V3',@payload_sha256=@hash_after OUTPUT;
    IF @hash_after<>@signed_hash OR NOT EXISTS(SELECT 1 FROM dbo.encounters
        WHERE encounter_id=@encounter_id AND patient_id=@source_id AND status='SIGNED')
        THROW 55806,N'Gộp hồ sơ làm đổi bản ghi hoặc dấu khám đã ký.',1;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@patient_user_id;
    EXEC dbo.sp_clinic_list_patient_clinical_records @actor_user_id=@patient_user_id,
        @patient_public_id=@target_public_id;
    EXEC dbo.sp_clinic_get_patient_clinical_record @actor_user_id=@patient_user_id,
        @patient_public_id=@target_public_id,@encounter_public_id=@encounter_public_id;
    ROLLBACK TRANSACTION;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-stale-admin-',@suffix),REPLICATE('x',60),N'Admin stale','ACTIVE');
    SET @admin_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MU',LEFT(@suffix,17)),@branch_id,N'Nguồn stale','1990-05-14','FEMALE');
    SET @source_id=SCOPE_IDENTITY();
    SELECT @source_public_id=public_id,@source_ver=row_ver FROM dbo.patients WHERE patient_id=@source_id;
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MV',LEFT(@suffix,17)),@branch_id,N'Chuẩn stale','1990-05-14','FEMALE');
    SET @target_id=SCOPE_IDENTITY();
    SELECT @target_public_id=public_id,@target_ver=row_ver FROM dbo.patients WHERE patient_id=@target_id;
    UPDATE dbo.patients SET phone='0901112222' WHERE patient_id=@target_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    DECLARE @stale_error int=0;
    BEGIN TRY
        EXEC dbo.sp_clinic_merge_patients @actor_user_id=@admin_id,
            @source_public_id=@source_public_id,@target_public_id=@target_public_id,
            @source_row_ver=@source_ver,@target_row_ver=@target_ver,
            @reason=N'Đã đối chiếu giấy tờ gốc và xác nhận hai hồ sơ cùng một người.';
    END TRY BEGIN CATCH SET @stale_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @stale_error<>53636 THROW 55809,N'Không chặn phiên bản hồ sơ chuẩn đã cũ.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-pending-admin-',@suffix),REPLICATE('x',60),N'Admin pending','ACTIVE');
    SET @admin_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MP',LEFT(@suffix,17)),@branch_id,N'Nguồn pending','1990-05-14','FEMALE');
    SET @source_id=SCOPE_IDENTITY();
    SELECT @source_public_id=public_id,@source_ver=row_ver FROM dbo.patients WHERE patient_id=@source_id;
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MQ',LEFT(@suffix,17)),@branch_id,N'Chuẩn pending','1990-05-14','FEMALE');
    SET @target_id=SCOPE_IDENTITY();
    SELECT @target_public_id=public_id,@target_ver=row_ver FROM dbo.patients WHERE patient_id=@target_id;
    INSERT dbo.user_patient_access(user_id,patient_id,relationship_type,status)
    VALUES(@admin_id,@source_id,'OTHER','PENDING');
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    DECLARE @pending_error int=0;
    BEGIN TRY
        EXEC dbo.sp_clinic_merge_patients @actor_user_id=@admin_id,
            @source_public_id=@source_public_id,@target_public_id=@target_public_id,
            @source_row_ver=@source_ver,@target_row_ver=@target_ver,
            @reason=N'Đã đối chiếu giấy tờ gốc và xác nhận hai hồ sơ cùng một người.';
    END TRY BEGIN CATCH SET @pending_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @pending_error<>53665 THROW 55810,N'Không chặn liên kết đang chờ duyệt.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-owner-admin-',@suffix),REPLICATE('x',60),N'Admin owner','ACTIVE');
    SET @admin_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-owner-other-',@suffix),REPLICATE('x',60),N'Other owner','ACTIVE');
    DECLARE @other_user_id bigint=SCOPE_IDENTITY();
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MR',LEFT(@suffix,17)),@branch_id,N'Nguồn owner','1990-05-14','FEMALE');
    SET @source_id=SCOPE_IDENTITY();
    SELECT @source_public_id=public_id,@source_ver=row_ver FROM dbo.patients WHERE patient_id=@source_id;
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MW',LEFT(@suffix,17)),@branch_id,N'Chuẩn owner','1990-05-14','FEMALE');
    SET @target_id=SCOPE_IDENTITY();
    SELECT @target_public_id=public_id,@target_ver=row_ver FROM dbo.patients WHERE patient_id=@target_id;
    INSERT dbo.user_patient_access(user_id,patient_id,relationship_type,status,verified_at_utc)
    VALUES(@admin_id,@source_id,'SELF','ACTIVE',SYSUTCDATETIME()),
          (@other_user_id,@target_id,'SELF','ACTIVE',SYSUTCDATETIME());
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    DECLARE @owner_error int=0;
    BEGIN TRY
        EXEC dbo.sp_clinic_merge_patients @actor_user_id=@admin_id,
            @source_public_id=@source_public_id,@target_public_id=@target_public_id,
            @source_row_ver=@source_ver,@target_row_ver=@target_ver,
            @reason=N'Đã đối chiếu giấy tờ gốc và xác nhận hai hồ sơ cùng một người.';
    END TRY BEGIN CATCH SET @owner_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @owner_error<>53666 THROW 55811,N'Không chặn hai chủ hồ sơ khác nhau.',1;

    BEGIN TRANSACTION;
    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'merge-contact-admin-',@suffix),REPLICATE('x',60),N'Admin contacts','ACTIVE');
    SET @admin_id=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MC',LEFT(@suffix,17)),@branch_id,N'Nguồn contacts','1990-05-14','FEMALE');
    SET @source_id=SCOPE_IDENTITY();
    SELECT @source_public_id=public_id,@source_ver=row_ver FROM dbo.patients WHERE patient_id=@source_id;
    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender)
    VALUES(CONCAT('MD',LEFT(@suffix,17)),@branch_id,N'Chuẩn contacts','1990-05-14','FEMALE');
    SET @target_id=SCOPE_IDENTITY();
    SELECT @target_public_id=public_id,@target_ver=row_ver FROM dbo.patients WHERE patient_id=@target_id;
    INSERT dbo.patient_emergency_contacts(patient_id,full_name,phone,is_primary)
    VALUES(@source_id,N'Liên hệ nguồn','0901234567',1),
          (@target_id,N'Liên hệ chuẩn','0907654321',1);
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    DECLARE @contact_error int=0;
    BEGIN TRY
        EXEC dbo.sp_clinic_merge_patients @actor_user_id=@admin_id,
            @source_public_id=@source_public_id,@target_public_id=@target_public_id,
            @source_row_ver=@source_ver,@target_row_ver=@target_ver,
            @reason=N'Đã đối chiếu giấy tờ gốc và xác nhận hai hồ sơ cùng một người.';
    END TRY BEGIN CATCH SET @contact_error=ERROR_NUMBER(); END CATCH;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    IF @contact_error<>53667 THROW 55812,N'Không chặn hai danh sách liên hệ khẩn cấp.',1;
    SELECT 'PASS' AS patient_merge_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

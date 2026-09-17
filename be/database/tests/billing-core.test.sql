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
    IF OBJECTPROPERTYEX(OBJECT_ID(N'dbo.trg_payments_no_delete'),N'ExecIsUpdateTrigger')<>1
       OR OBJECTPROPERTYEX(OBJECT_ID(N'dbo.trg_payments_no_delete'),N'ExecIsDeleteTrigger')<>1
       OR OBJECTPROPERTYEX(OBJECT_ID(N'dbo.trg_refunds_no_delete'),N'ExecIsUpdateTrigger')<>1
       OR OBJECTPROPERTYEX(OBJECT_ID(N'dbo.trg_refunds_no_delete'),N'ExecIsDeleteTrigger')<>1
      THROW 55948,N'Payment/refund ledger chưa được bảo vệ UPDATE và DELETE.',1;
    IF EXISTS
    (
      SELECT permission_name FROM (VALUES ('INSERT'),('UPDATE'),('DELETE')) expected(permission_name)
      WHERE NOT EXISTS
      (
        SELECT 1 FROM sys.database_permissions dp
        WHERE dp.class_desc='SCHEMA' AND dp.major_id=SCHEMA_ID(N'dbo')
          AND dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
          AND dp.permission_name=expected.permission_name AND dp.state='D'
      )
    )
      THROW 55949,N'Clinic API chưa bị DENY DML trực tiếp trên schema dbo.',1;
    IF EXISTS (SELECT 1 FROM (VALUES (N'sp_create_invoice'),(N'sp_sync_invoice_items'),
      (N'sp_add_manual_invoice_item'),(N'sp_set_invoice_insurance_amount'),(N'sp_issue_invoice'),
      (N'sp_record_invoice_payment'),(N'sp_refund_payment_allocation'),(N'sp_void_invoice')) forbidden(name)
      JOIN sys.database_permissions dp ON dp.major_id=OBJECT_ID(N'dbo.'+forbidden.name)
      WHERE dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
        AND dp.permission_name='EXECUTE' AND dp.state IN('G','W'))
      THROW 55950,N'Clinic API còn quyền billing bigint nội bộ.',1;
    IF EXISTS (SELECT 1 FROM (VALUES (N'sp_clinic_billing_branches'),(N'sp_clinic_billing_workspace'),
      (N'sp_clinic_get_invoice'),(N'sp_clinic_create_invoice'),(N'sp_clinic_sync_invoice'),
      (N'sp_clinic_add_manual_invoice_item'),(N'sp_clinic_set_invoice_insurance'),
      (N'sp_clinic_issue_invoice'),(N'sp_clinic_record_invoice_payment'),
      (N'sp_clinic_refund_payment'),(N'sp_clinic_void_invoice')) required(name)
      WHERE NOT EXISTS (SELECT 1 FROM sys.database_permissions dp
        WHERE dp.major_id=OBJECT_ID(N'dbo.'+required.name)
          AND dp.grantee_principal_id=DATABASE_PRINCIPAL_ID(N'clinic_api_executor')
          AND dp.permission_name='EXECUTE' AND dp.state IN('G','W')))
      THROW 55951,N'Clinic API thiếu quyền billing public procedure.',1;

    BEGIN TRANSACTION;
    DECLARE @suffix varchar(36)=CONVERT(varchar(36),NEWID()),@request_id uniqueidentifier=NEWID(),
      @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN'),@business_date date;
    EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
    DECLARE @branch_public_id uniqueidentifier=(SELECT public_id FROM dbo.branches WHERE branch_id=@branch_id),
      @doctor_id bigint=(SELECT TOP(1) d.doctor_id FROM dbo.doctors d
        JOIN dbo.doctor_branch_assignments a ON a.doctor_id=d.doctor_id AND a.branch_id=@branch_id AND a.is_active=1
        WHERE d.is_active=1 ORDER BY d.doctor_id),
      @service_id bigint=(SELECT TOP(1) service_id FROM dbo.services WHERE is_active=1 ORDER BY service_id);
    IF @branch_id IS NULL OR @doctor_id IS NULL OR @service_id IS NULL
      THROW 55952,N'Thiếu seed chi nhánh, bác sĩ hoặc dịch vụ.',1;

    INSERT dbo.users(username,password_hash,display_name,status)
    VALUES(CONCAT(N'billing-admin-',@suffix),REPLICATE('x',60),N'Billing Admin','ACTIVE');
    DECLARE @admin_id bigint=SCOPE_IDENTITY();
    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id)
    SELECT @admin_id,role_id,NULL,@admin_id FROM dbo.roles WHERE role_code='ADMIN';
    EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@admin_id;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

    DECLARE @patient_id bigint,@patient_public_id uniqueidentifier;
    EXEC dbo.sp_create_patient @actor_user_id=@admin_id,@branch_id=@branch_id,
      @full_name=N'Bệnh nhân billing test',@date_of_birth='1990-01-01',@gender='OTHER',
      @phone='0907777777',@duplicate_override=1,@duplicate_reason=N'Fixture regression billing.',
      @patient_id=@patient_id OUTPUT,@patient_public_id=@patient_public_id OUTPUT;
    DECLARE @encounter_code varchar(40),@encounter_id bigint,@encounter_public_id uniqueidentifier;
    EXEC dbo.sp_next_document_number @branch_id,'ENCOUNTER',@business_date,'LK',@encounter_code OUTPUT;
    INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,encounter_source,
      status,arrived_at_utc,created_by_user_id)
    VALUES(@encounter_code,@branch_id,@patient_id,@doctor_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@admin_id);
    SET @encounter_id=SCOPE_IDENTITY();
    SELECT @encounter_public_id=public_id FROM dbo.encounters WHERE encounter_id=@encounter_id;
    UPDATE dbo.encounters SET status='IN_PROGRESS',started_at_utc=SYSUTCDATETIME(),is_in_progress=1
      WHERE encounter_id=@encounter_id;
    INSERT dbo.encounter_services(encounter_id,service_id,service_code_snapshot,service_name_snapshot,
      service_type_snapshot,quantity,unit_price_snapshot,status,ordered_by_user_id)
    SELECT @encounter_id,service_id,service_code,service_name,service_type,1,200000,'ORDERED',@admin_id
      FROM dbo.services WHERE service_id=@service_id;
    UPDATE dbo.encounter_services SET status='COMPLETED',performed_by_user_id=@admin_id,
      performed_at_utc=SYSUTCDATETIME() WHERE encounter_id=@encounter_id;
    UPDATE dbo.encounters SET status='COMPLETED',completed_at_utc=SYSUTCDATETIME(),is_in_progress=0
      WHERE encounter_id=@encounter_id;

    DECLARE @invoice_public_id uniqueidentifier,@invoice_replay uniqueidentifier,@item_public_id uniqueidentifier;
    EXEC dbo.sp_clinic_create_invoice @actor_user_id=@admin_id,@encounter_public_id=@encounter_public_id,
      @invoice_public_id=@invoice_public_id OUTPUT;
    EXEC dbo.sp_clinic_create_invoice @actor_user_id=@admin_id,@encounter_public_id=@encounter_public_id,
      @invoice_public_id=@invoice_replay OUTPUT;
    IF @invoice_replay<>@invoice_public_id THROW 55953,N'Tạo lại không trả hóa đơn active cũ.',1;
    EXEC dbo.sp_clinic_sync_invoice @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id;
    EXEC dbo.sp_clinic_add_manual_invoice_item @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id,
      @item_code='ADMIN-FEE',@item_name=N'Phí hành chính kiểm thử',@quantity=1,@unit_price=100000,
      @invoice_item_public_id=@item_public_id OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.invoice_items WHERE public_id=@item_public_id AND item_type='OTHER')
      THROW 55954,N'Không tạo được dòng thủ công public.',1;

    DECLARE @issue_key uniqueidentifier=NEWID();
    EXEC dbo.sp_clinic_issue_invoice @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id,
      @idempotency_key=@issue_key;
    EXEC dbo.sp_clinic_issue_invoice @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id,
      @idempotency_key=@issue_key;
    DECLARE @invoice_id bigint=(SELECT invoice_id FROM dbo.invoices WHERE public_id=@invoice_public_id),
      @payable decimal(19,2)=(SELECT patient_payable_amount FROM dbo.invoices WHERE public_id=@invoice_public_id);
    IF NOT EXISTS (SELECT 1 FROM dbo.invoices WHERE invoice_id=@invoice_id AND status='ISSUED')
      OR (SELECT COUNT(*) FROM dbo.invoice_items WHERE invoice_id=@invoice_id)<>2
      THROW 55955,N'Phát hành không đồng bộ và khóa đúng charge.',1;
    IF NOT EXISTS (SELECT 1 FROM dbo.outbox_events WHERE aggregate_id=CONVERT(varchar(36),@invoice_public_id)
      AND event_type='INVOICE_ISSUED') THROW 55956,N'Phát hành thiếu outbox.',1;

    DECLARE @first_amount decimal(19,2)=ROUND(@payable/2,2),@second_amount decimal(19,2),
      @payment_one uniqueidentifier,@payment_one_replay uniqueidentifier,@payment_two uniqueidentifier,
      @payment_key_one uniqueidentifier=NEWID(),@payment_key_two uniqueidentifier=NEWID();
    SET @second_amount=@payable-@first_amount;
    EXEC dbo.sp_clinic_record_invoice_payment @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id,
      @amount=@first_amount,@payment_method='CASH',@idempotency_key=@payment_key_one,
      @payment_public_id=@payment_one OUTPUT;
    EXEC dbo.sp_clinic_record_invoice_payment @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id,
      @amount=@first_amount,@payment_method='CASH',@idempotency_key=@payment_key_one,
      @payment_public_id=@payment_one_replay OUTPUT;
    IF @payment_one<>@payment_one_replay THROW 55957,N'Retry thanh toán không trả resource cũ.',1;
    EXEC dbo.sp_clinic_record_invoice_payment @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id,
      @amount=@second_amount,@payment_method='CASH',@idempotency_key=@payment_key_two,
      @payment_public_id=@payment_two OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.invoices WHERE invoice_id=@invoice_id AND status='PAID')
      THROW 55958,N'Thanh toán nhiều lần không tất toán hóa đơn.',1;

    DECLARE @allocation_one uniqueidentifier=(SELECT pa.public_id FROM dbo.payment_allocations pa
      JOIN dbo.payments p ON p.payment_id=pa.payment_id WHERE p.public_id=@payment_one),
      @allocation_two uniqueidentifier=(SELECT pa.public_id FROM dbo.payment_allocations pa
      JOIN dbo.payments p ON p.payment_id=pa.payment_id WHERE p.public_id=@payment_two),
      @refund_one uniqueidentifier,@refund_one_replay uniqueidentifier,@refund_two uniqueidentifier,
      @refund_key_one uniqueidentifier=NEWID(),@refund_key_two uniqueidentifier=NEWID();
    EXEC dbo.sp_clinic_refund_payment @actor_user_id=@admin_id,@payment_allocation_public_id=@allocation_one,
      @amount=@first_amount,@refund_method='CASH',@idempotency_key=@refund_key_one,
      @reason=N'Hoàn tiền kiểm thử lần một',@refund_public_id=@refund_one OUTPUT;
    EXEC dbo.sp_clinic_refund_payment @actor_user_id=@admin_id,@payment_allocation_public_id=@allocation_one,
      @amount=@first_amount,@refund_method='CASH',@idempotency_key=@refund_key_one,
      @reason=N'Hoàn tiền kiểm thử lần một',@refund_public_id=@refund_one_replay OUTPUT;
    IF @refund_one<>@refund_one_replay THROW 55959,N'Retry hoàn tiền không trả resource cũ.',1;
    EXEC dbo.sp_clinic_refund_payment @actor_user_id=@admin_id,@payment_allocation_public_id=@allocation_two,
      @amount=@second_amount,@refund_method='CASH',@idempotency_key=@refund_key_two,
      @reason=N'Hoàn tiền kiểm thử lần hai',@refund_public_id=@refund_two OUTPUT;
    EXEC dbo.sp_clinic_void_invoice @actor_user_id=@admin_id,@invoice_public_id=@invoice_public_id,
      @reason=N'VOID sau khi đã hoàn đủ tiền';
    IF NOT EXISTS (SELECT 1 FROM dbo.invoices WHERE invoice_id=@invoice_id AND status='VOID' AND is_active_invoice=0)
      THROW 55960,N'Không VOID được hóa đơn đã hoàn đủ.',1;
    IF NOT EXISTS (SELECT 1 FROM dbo.audit_logs WHERE entity_id=CONVERT(varchar(36),@refund_one)
      AND action_code='PAYMENT_REFUNDED') THROW 55961,N'Audit hoàn tiền không dùng public ID.',1;

    DECLARE @replacement uniqueidentifier;
    EXEC dbo.sp_clinic_create_invoice @actor_user_id=@admin_id,@encounter_public_id=@encounter_public_id,
      @supersedes_invoice_public_id=@invoice_public_id,@invoice_public_id=@replacement OUTPUT;
    IF NOT EXISTS (SELECT 1 FROM dbo.invoices n JOIN dbo.invoices o ON o.invoice_id=n.supersedes_invoice_id
      WHERE n.public_id=@replacement AND o.public_id=@invoice_public_id)
      THROW 55962,N'Hóa đơn thay thế không liên kết hóa đơn VOID.',1;
    EXEC dbo.sp_clinic_issue_invoice @actor_user_id=@admin_id,@invoice_public_id=@replacement,
      @idempotency_key=@replacement;
    DECLARE @overpay_error int=0,@overpay_amount decimal(19,2)=@payable+1;
    BEGIN TRY
      EXEC dbo.sp_clinic_record_invoice_payment @actor_user_id=@admin_id,@invoice_public_id=@replacement,
        @amount=@overpay_amount,@payment_method='CASH',@idempotency_key=@request_id,
        @payment_public_id=@payment_one OUTPUT;
    END TRY BEGIN CATCH SET @overpay_error=ERROR_NUMBER(); END CATCH;
    IF @overpay_error<>53413 THROW 55963,N'Không chặn thu vượt dư nợ.',1;
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'branch_id',@value=NULL;
    EXEC sys.sp_set_session_context @key=N'request_id',@value=NULL;
    SELECT 'PASS' AS billing_core_test;
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

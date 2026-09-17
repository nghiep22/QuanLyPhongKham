param(
  [string]$Server = 'localhost',
  [string]$Database = 'PrivateClinicManagement'
)

$ErrorActionPreference = 'Stop'
$suffix = [guid]::NewGuid().ToString('N').Substring(0, 20)
function Invoke-SqlText([string]$sqlText) {
  $output = & sqlcmd -S $Server -d $Database -E -C -b -h -1 -W -Q $sqlText 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return (($output | Where-Object { $_.Trim() }) -join '').Trim()
}

$setupSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRY
BEGIN TRANSACTION;
DECLARE @actor_id bigint=(SELECT TOP(1) u.user_id FROM dbo.users u JOIN dbo.user_roles ur ON ur.user_id=u.user_id
  AND ur.is_active=1 JOIN dbo.roles r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
  WHERE u.status='ACTIVE' ORDER BY u.user_id),
  @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN' AND is_active=1),
  @patient_id bigint=(SELECT TOP(1) patient_id FROM dbo.patients WHERE status='ACTIVE' ORDER BY patient_id),
  @service_id bigint=(SELECT TOP(1) service_id FROM dbo.services WHERE is_active=1 ORDER BY service_id),
  @location_id bigint=(SELECT inventory_location_id FROM dbo.inventory_locations
    WHERE branch_id=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN') AND is_dispensing=1 AND is_active=1);
IF @actor_id IS NULL OR @branch_id IS NULL OR @patient_id IS NULL
   OR @service_id IS NULL OR @location_id IS NULL
  THROW 55840,N'Thiếu dữ liệu seed để chạy billing issuance concurrency test.',1;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@actor_id;

INSERT dbo.employees(primary_branch_id,employee_code,employee_type,full_name,hire_date)
VALUES(@branch_id,'BI-E-$suffix','DOCTOR',N'Bác sĩ billing race',CONVERT(date,GETDATE()));
DECLARE @employee_id bigint=SCOPE_IDENTITY();
INSERT dbo.doctors(employee_id,medical_license_no,license_issued_date,license_expiry_date)
VALUES(@employee_id,N'BI-L-$suffix',DATEADD(YEAR,-1,CONVERT(date,GETDATE())),DATEADD(YEAR,1,CONVERT(date,GETDATE())));
DECLARE @doctor_id bigint=SCOPE_IDENTITY();
INSERT dbo.doctor_branch_assignments(doctor_id,branch_id,effective_from,is_primary,is_active)
VALUES(@doctor_id,@branch_id,DATEADD(DAY,-1,CONVERT(date,GETDATE())),1,1);

INSERT dbo.medicines(medicine_code,generic_name,active_ingredient,strength,dosage_form,route,base_unit,current_sale_price)
VALUES('BI-$suffix',N'Thuốc billing race',N'Hoạt chất billing race',N'100 mg',N'Viên',N'Uống',N'viên',50000);
DECLARE @medicine_id bigint=SCOPE_IDENTITY();
INSERT dbo.medicine_batches(medicine_id,origin_branch_id,batch_number,expiry_date,purchase_price,sale_price,status)
VALUES(@medicine_id,@branch_id,N'LOT-$suffix',DATEADD(YEAR,1,CONVERT(date,GETDATE())),30000,50000,'AVAILABLE');
DECLARE @batch_id bigint=SCOPE_IDENTITY();

INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,encounter_source,status,
  arrived_at_utc,created_by_user_id)
VALUES('BI-$suffix',@branch_id,@patient_id,@doctor_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@actor_id);
DECLARE @encounter_id bigint=SCOPE_IDENTITY();
UPDATE dbo.encounters SET status='IN_PROGRESS',started_at_utc=SYSUTCDATETIME(),is_in_progress=1
WHERE encounter_id=@encounter_id;
INSERT dbo.encounter_services(encounter_id,service_id,service_code_snapshot,service_name_snapshot,
  service_type_snapshot,quantity,unit_price_snapshot,status,performed_by_user_id,performed_at_utc,ordered_by_user_id)
SELECT @encounter_id,service_id,service_code,service_name,service_type,1,200000,'COMPLETED',@actor_id,SYSUTCDATETIME(),@actor_id
FROM dbo.services WHERE service_id=@service_id;
DECLARE @encounter_service_id bigint=SCOPE_IDENTITY();

INSERT dbo.prescriptions(prescription_code,encounter_id,patient_id,doctor_id,branch_id,status,issued_at_utc,
  valid_until,created_by_user_id)
VALUES('BI-RX-$suffix',@encounter_id,@patient_id,@doctor_id,@branch_id,'DRAFT',NULL,
  DATEADD(DAY,7,CONVERT(date,GETDATE())),@actor_id);
DECLARE @prescription_id bigint=SCOPE_IDENTITY();
INSERT dbo.prescription_items(prescription_id,medicine_id,medicine_name_snapshot,strength_snapshot,
  dosage_form_snapshot,route_snapshot,prescribed_quantity,dispensed_quantity,dose,frequency,usage_instruction)
VALUES(@prescription_id,@medicine_id,N'Thuốc billing race',N'100 mg',N'Viên',N'Uống',1,1,N'1 viên',N'Ngày một lần',N'Uống sau ăn');
DECLARE @prescription_item_id bigint=SCOPE_IDENTITY();
UPDATE dbo.prescriptions SET status='ISSUED',issued_at_utc=SYSUTCDATETIME(),updated_at_utc=SYSUTCDATETIME()
WHERE prescription_id=@prescription_id;

UPDATE dbo.encounters SET status='COMPLETED',completed_at_utc=SYSUTCDATETIME(),is_in_progress=0
WHERE encounter_id=@encounter_id;
INSERT dbo.dispensations(dispensation_code,prescription_id,branch_id,inventory_location_id,status,dispensed_by_user_id)
VALUES('BI-DP-$suffix',@prescription_id,@branch_id,@location_id,'DRAFT',@actor_id);
DECLARE @dispensation_id bigint=SCOPE_IDENTITY();
INSERT dbo.dispensation_items(dispensation_id,prescription_item_id,medicine_batch_id,quantity,unit_price_snapshot)
VALUES(@dispensation_id,@prescription_item_id,@batch_id,1,50000);
DECLARE @dispensation_item_id bigint=SCOPE_IDENTITY(),@encounter_public_id uniqueidentifier,
  @invoice_public_id uniqueidentifier;
SELECT @encounter_public_id=public_id FROM dbo.encounters WHERE encounter_id=@encounter_id;
EXEC dbo.sp_clinic_create_invoice @actor_user_id=@actor_id,@encounter_public_id=@encounter_public_id,
  @invoice_public_id=@invoice_public_id OUTPUT;
DECLARE @invoice_id bigint=(SELECT invoice_id FROM dbo.invoices WHERE public_id=@invoice_public_id);
SELECT CONCAT(@actor_id,'|',@encounter_id,'|',@encounter_service_id,'|',@prescription_id,'|',
  @prescription_item_id,'|',@dispensation_id,'|',@dispensation_item_id,'|',@medicine_id,'|',@batch_id,'|',
  @location_id,'|',@invoice_id,'|',CONVERT(varchar(36),@invoice_public_id),'|',@doctor_id,'|',@employee_id);
COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
"@
$fixture = Invoke-SqlText $setupSql
$parts = $fixture.Split('|')
if ($parts.Count -ne 14) { throw "Không đọc được fixture billing issuance: $fixture" }
$actorId, $encounterId, $encounterServiceId, $prescriptionId, $prescriptionItemId, $dispensationId,
  $dispensationItemId, $medicineId, $batchId, $locationId, $invoiceId, $invoicePublicId, $doctorId,
  $employeeId = $parts

$completeSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
BEGIN TRY
  BEGIN TRANSACTION;
  EXEC dbo.sp_complete_dispensation @actor_user_id=$actorId,@dispensation_id=$dispensationId;
  WAITFOR DELAY '00:00:02';
  COMMIT TRANSACTION;
  SELECT 'OK|COMPLETED';
END TRY BEGIN CATCH IF XACT_STATE()<>0 ROLLBACK TRANSACTION; SELECT CONCAT('ERR|',ERROR_NUMBER()); END CATCH;
"@
$issueSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
DECLARE @issue_key uniqueidentifier=NEWID();
BEGIN TRY
  EXEC dbo.sp_clinic_issue_invoice @actor_user_id=$actorId,@invoice_public_id='$invoicePublicId',
    @idempotency_key=@issue_key;
  SELECT 'OK|ISSUED';
END TRY BEGIN CATCH SELECT CONCAT('ERR|',ERROR_NUMBER()); END CATCH;
"@
$cleanupSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DELETE dbo.outbox_events WHERE aggregate_id='$invoicePublicId';
DELETE dbo.idempotency_requests WHERE operation_code='ISSUE_INVOICE' AND resource_id=$invoiceId;
DISABLE TRIGGER dbo.trg_invoice_items_guard_and_totals ON dbo.invoice_items;
DELETE dbo.invoice_items WHERE invoice_id=$invoiceId;
ENABLE TRIGGER dbo.trg_invoice_items_guard_and_totals ON dbo.invoice_items;
DISABLE TRIGGER dbo.trg_invoices_guard ON dbo.invoices;
DELETE dbo.invoices WHERE invoice_id=$invoiceId;
ENABLE TRIGGER dbo.trg_invoices_guard ON dbo.invoices;
DISABLE TRIGGER dbo.trg_dispensation_items_append_only ON dbo.dispensation_items;
DELETE dbo.dispensation_items WHERE dispensation_item_id=$dispensationItemId;
ENABLE TRIGGER dbo.trg_dispensation_items_append_only ON dbo.dispensation_items;
DELETE dbo.dispensations WHERE dispensation_id=$dispensationId;
DISABLE TRIGGER dbo.trg_prescription_items_guard ON dbo.prescription_items;
DELETE dbo.prescription_items WHERE prescription_item_id=$prescriptionItemId;
ENABLE TRIGGER dbo.trg_prescription_items_guard ON dbo.prescription_items;
DELETE dbo.prescriptions WHERE prescription_id=$prescriptionId;
DISABLE TRIGGER dbo.trg_encounter_services_clinical_guard ON dbo.encounter_services;
DELETE dbo.encounter_services WHERE encounter_service_id=$encounterServiceId;
ENABLE TRIGGER dbo.trg_encounter_services_clinical_guard ON dbo.encounter_services;
DELETE dbo.encounters WHERE encounter_id=$encounterId;
DELETE dbo.medicine_batches WHERE medicine_batch_id=$batchId;
DELETE dbo.medicines WHERE medicine_id=$medicineId;
DELETE dbo.doctor_branch_assignments WHERE doctor_id=$doctorId;
DELETE dbo.doctors WHERE doctor_id=$doctorId;
DELETE dbo.employees WHERE employee_id=$employeeId;
COMMIT TRANSACTION;
"@

$completeJob = $null
try {
  $completeJob = Start-Job -ScriptBlock {
    param($serverName,$databaseName,$query)
    $result = & sqlcmd -S $serverName -d $databaseName -E -C -b -h -1 -W -Q $query 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join [Environment]::NewLine) }
    (($result | Where-Object { $_.Trim() }) -join '').Trim()
  } -ArgumentList $Server,$Database,$completeSql
  Start-Sleep -Milliseconds 350
  $issued = Invoke-SqlText $issueSql
  $completed = $completeJob | Wait-Job | Receive-Job
  if ($issued -ne 'OK|ISSUED' -or $completed -ne 'OK|COMPLETED') {
    throw "Race hoàn tất cấp thuốc/phát hành không được serialize: complete=$completed issue=$issued"
  }

  $state = Invoke-SqlText @"
SET NOCOUNT ON;
SELECT CONCAT(i.status,'|',d.status,'|',
  (SELECT COUNT(*) FROM dbo.invoice_items ii WHERE ii.invoice_id=i.invoice_id AND ii.item_type='SERVICE'),'|',
  (SELECT COUNT(*) FROM dbo.invoice_items ii WHERE ii.invoice_id=i.invoice_id AND ii.item_type='MEDICINE'),'|',
  CONVERT(varchar(40),i.patient_payable_amount))
FROM dbo.invoices i CROSS JOIN dbo.dispensations d
WHERE i.invoice_id=$invoiceId AND d.dispensation_id=$dispensationId;
"@
  if ($state -ne 'ISSUED|COMPLETED|1|1|250000.00') { throw "Hóa đơn bỏ sót nguồn tính tiền: $state" }

  $lateOpen = Invoke-SqlText @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
DECLARE @id bigint;
BEGIN TRY
  EXEC dbo.sp_open_dispensation @actor_user_id=$actorId,@prescription_id=$prescriptionId,
    @inventory_location_id=$locationId,@dispensation_id=@id OUTPUT;
  SELECT 'OK';
END TRY BEGIN CATCH SELECT CONCAT('ERR|',ERROR_NUMBER()); END CATCH;
"@
  if ($lateOpen -ne 'ERR|53354') { throw "Vẫn mở được phiên cấp thuốc sau phát hành: $lateOpen" }

  $lateItem = Invoke-SqlText @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRY
  INSERT dbo.dispensation_items(dispensation_id,prescription_item_id,medicine_batch_id,quantity,unit_price_snapshot)
  VALUES($dispensationId,$prescriptionItemId,$batchId,1,50000);
  SELECT 'OK';
END TRY BEGIN CATCH SELECT CONCAT('ERR|',ERROR_NUMBER()); END CATCH;
"@
  if ($lateItem -ne 'ERR|52066') { throw "Trigger cho phép thêm charge thuốc sau phát hành: $lateItem" }
  [pscustomobject]@{ result='PASS'; completion=$completed; issuance=$issued; invoiceState=$state;
    lateDispensation=$lateOpen; lateItem=$lateItem }
}
finally {
  if ($completeJob) { $completeJob | Remove-Job -Force -ErrorAction SilentlyContinue }
  Invoke-SqlText $cleanupSql | Out-Null
}

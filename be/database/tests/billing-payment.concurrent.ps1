param(
  [string]$Server = 'localhost',
  [string]$Database = 'PrivateClinicManagement'
)

$ErrorActionPreference = 'Stop'
$suffix = [guid]::NewGuid().ToString('N')
function Invoke-SqlText([string]$sqlText) {
  $output = & sqlcmd -S $Server -d $Database -E -C -b -h -1 -W -Q $sqlText 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return (($output | Where-Object { $_.Trim() }) -join '').Trim()
}

$setupSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
DECLARE @actor_id bigint=(SELECT TOP(1) u.user_id FROM dbo.users u JOIN dbo.user_roles ur ON ur.user_id=u.user_id
  AND ur.is_active=1 JOIN dbo.roles r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
  WHERE u.status='ACTIVE' ORDER BY u.user_id),
  @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN' AND is_active=1),@business_date date;
EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
DECLARE @doctor_id bigint=(SELECT TOP(1) d.doctor_id FROM dbo.doctors d JOIN dbo.doctor_branch_assignments a
  ON a.doctor_id=d.doctor_id AND a.branch_id=@branch_id AND a.is_active=1 WHERE d.is_active=1 ORDER BY d.doctor_id),
  @patient_id bigint=(SELECT TOP(1) patient_id FROM dbo.patients WHERE status='ACTIVE' ORDER BY patient_id),
  @service_id bigint=(SELECT TOP(1) service_id FROM dbo.services WHERE is_active=1 ORDER BY service_id);
IF @actor_id IS NULL OR @doctor_id IS NULL OR @patient_id IS NULL OR @service_id IS NULL
  THROW 55830,N'Cần Admin, bác sĩ, bệnh nhân và dịch vụ seed để chạy payment concurrency test.',1;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@actor_id;
INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,encounter_source,status,
  arrived_at_utc,created_by_user_id) VALUES('BP-$suffix',@branch_id,@patient_id,@doctor_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@actor_id);
DECLARE @encounter_id bigint=SCOPE_IDENTITY();
UPDATE dbo.encounters SET status='IN_PROGRESS',started_at_utc=SYSUTCDATETIME(),is_in_progress=1 WHERE encounter_id=@encounter_id;
INSERT dbo.encounter_services(encounter_id,service_id,service_code_snapshot,service_name_snapshot,
  service_type_snapshot,quantity,unit_price_snapshot,status,ordered_by_user_id)
SELECT @encounter_id,service_id,service_code,service_name,service_type,1,200000,'ORDERED',@actor_id FROM dbo.services WHERE service_id=@service_id;
DECLARE @encounter_service_id bigint=SCOPE_IDENTITY();
UPDATE dbo.encounter_services SET status='COMPLETED',performed_by_user_id=@actor_id,performed_at_utc=SYSUTCDATETIME()
  WHERE encounter_service_id=@encounter_service_id;
UPDATE dbo.encounters SET status='COMPLETED',completed_at_utc=SYSUTCDATETIME(),is_in_progress=0 WHERE encounter_id=@encounter_id;
DECLARE @encounter_public_id uniqueidentifier=(SELECT public_id FROM dbo.encounters WHERE encounter_id=@encounter_id),
  @invoice_public_id uniqueidentifier;
EXEC dbo.sp_clinic_create_invoice @actor_user_id=@actor_id,@encounter_public_id=@encounter_public_id,
  @invoice_public_id=@invoice_public_id OUTPUT;
EXEC dbo.sp_clinic_issue_invoice @actor_user_id=@actor_id,@invoice_public_id=@invoice_public_id,@idempotency_key=@invoice_public_id;
DECLARE @invoice_id bigint=(SELECT invoice_id FROM dbo.invoices WHERE public_id=@invoice_public_id),
  @payable decimal(19,2)=(SELECT patient_payable_amount FROM dbo.invoices WHERE public_id=@invoice_public_id);
SELECT CONCAT(@actor_id,'|',CONVERT(varchar(36),@invoice_public_id),'|',@invoice_id,'|',@payable,'|',
  @encounter_id,'|',@encounter_service_id);
"@
$fixture = Invoke-SqlText $setupSql
$parts = $fixture.Split('|')
if ($parts.Count -ne 6) { throw "Không đọc được fixture payment concurrency: $fixture" }
$actorId, $invoicePublicId, $invoiceId, $payable, $encounterId, $encounterServiceId = $parts

$paySql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
DECLARE @payment uniqueidentifier,@payment_key uniqueidentifier=NEWID();
BEGIN TRY
  EXEC dbo.sp_clinic_record_invoice_payment @actor_user_id=$actorId,@invoice_public_id='$invoicePublicId',
    @amount=$payable,@payment_method='CASH',@idempotency_key=@payment_key,@payment_public_id=@payment OUTPUT;
  SELECT CONCAT('OK|',CONVERT(varchar(36),@payment));
END TRY BEGIN CATCH SELECT CONCAT('ERR|',ERROR_NUMBER()); END CATCH;
"@
$cleanupSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DECLARE @payment_ids TABLE(payment_id bigint PRIMARY KEY);
INSERT @payment_ids SELECT payment_id FROM dbo.payment_allocations WHERE invoice_id=$invoiceId;
DELETE dbo.outbox_events WHERE aggregate_id='$invoicePublicId' OR aggregate_id IN
  (SELECT CONVERT(varchar(36),public_id) FROM dbo.payments WHERE payment_id IN (SELECT payment_id FROM @payment_ids));
DELETE dbo.idempotency_requests WHERE operation_code IN ('ISSUE_INVOICE','RECORD_PAYMENT')
  AND (resource_id=$invoiceId OR resource_id IN (SELECT payment_id FROM @payment_ids));
DISABLE TRIGGER dbo.trg_financial_allocations_append_only ON dbo.payment_allocations;
DELETE dbo.payment_allocations WHERE invoice_id=$invoiceId;
ENABLE TRIGGER dbo.trg_financial_allocations_append_only ON dbo.payment_allocations;
DISABLE TRIGGER dbo.trg_payments_no_delete ON dbo.payments;
DELETE dbo.payments WHERE payment_id IN (SELECT payment_id FROM @payment_ids);
ENABLE TRIGGER dbo.trg_payments_no_delete ON dbo.payments;
DISABLE TRIGGER dbo.trg_invoice_items_guard_and_totals ON dbo.invoice_items;
DELETE dbo.invoice_items WHERE invoice_id=$invoiceId;
ENABLE TRIGGER dbo.trg_invoice_items_guard_and_totals ON dbo.invoice_items;
DISABLE TRIGGER dbo.trg_invoices_guard ON dbo.invoices;
DELETE dbo.invoices WHERE invoice_id=$invoiceId;
ENABLE TRIGGER dbo.trg_invoices_guard ON dbo.invoices;
DISABLE TRIGGER dbo.trg_encounter_services_clinical_guard ON dbo.encounter_services;
DELETE dbo.encounter_services WHERE encounter_service_id=$encounterServiceId;
ENABLE TRIGGER dbo.trg_encounter_services_clinical_guard ON dbo.encounter_services;
DELETE dbo.encounters WHERE encounter_id=$encounterId;
COMMIT TRANSACTION;
"@

$jobs = @()
try {
  $jobs = 1..2 | ForEach-Object {
    Start-Job -ScriptBlock {
      param($serverName,$databaseName,$query)
      $result = & sqlcmd -S $serverName -d $databaseName -E -C -b -h -1 -W -Q $query 2>&1
      if ($LASTEXITCODE -ne 0) { throw ($result -join [Environment]::NewLine) }
      (($result | Where-Object { $_.Trim() }) -join '').Trim()
    } -ArgumentList $Server,$Database,$paySql
  }
  $results = @($jobs | Wait-Job | Receive-Job)
  $successes = @($results | Where-Object { $_ -like 'OK|*' })
  $conflicts = @($results | Where-Object { $_ -in @('ERR|53412','ERR|53413') })
  if ($successes.Count -ne 1 -or $conflicts.Count -ne 1) {
    throw "Hai quầy không cho đúng một giao dịch thắng: $($results -join ', ')"
  }
  $balance = Invoke-SqlText "SET NOCOUNT ON; SELECT CONCAT(status,'|',paid_amount,'|',balance_due) FROM dbo.v_invoice_balances WHERE invoice_id=$invoiceId;"
  if ($balance -ne "PAID|$payable|0.00") { throw "Số dư sau race không đúng: $balance" }
  [pscustomobject]@{ result='PASS'; winner=$successes[0]; rejected=$conflicts[0]; paid=$payable }
}
finally {
  if ($jobs) { $jobs | Remove-Job -Force -ErrorAction SilentlyContinue }
  Invoke-SqlText $cleanupSql | Out-Null
}

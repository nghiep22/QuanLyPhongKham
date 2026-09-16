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

function Start-SqlJob([string]$sqlText) {
  Start-Job -ScriptBlock {
    param($serverName, $databaseName, $query)
    $result = & sqlcmd -S $serverName -d $databaseName -E -C -b -h -1 -W -Q $query 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join [Environment]::NewLine) }
    (($result | Where-Object { $_.Trim() }) -join '').Trim()
  } -ArgumentList $Server, $Database, $sqlText
}

$setupRequestId = [guid]::NewGuid()
$receiptKeyOld = [guid]::NewGuid()
$receiptKeyNew = [guid]::NewGuid()
$sharedDispenseKey = [guid]::NewGuid()
$oldBatchRaceKey = [guid]::NewGuid()
$newBatchRaceKey = [guid]::NewGuid()

$setupSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
DECLARE @actor_id bigint=(SELECT TOP(1) u.user_id FROM dbo.users u
  JOIN dbo.user_roles ur ON ur.user_id=u.user_id AND ur.is_active=1
  JOIN dbo.roles r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
  WHERE u.status='ACTIVE' ORDER BY u.user_id),
  @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN' AND is_active=1),
  @business_date date;
EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
DECLARE @doctor_id bigint,@doctor_user_id bigint;
SELECT TOP(1) @doctor_id=d.doctor_id,@doctor_user_id=e.user_id
FROM dbo.doctors d
JOIN dbo.employees e ON e.employee_id=d.employee_id AND e.employment_status='ACTIVE'
JOIN dbo.users u ON u.user_id=e.user_id AND u.status='ACTIVE'
JOIN dbo.doctor_branch_assignments a ON a.doctor_id=d.doctor_id AND a.branch_id=@branch_id AND a.is_active=1
WHERE d.is_active=1 AND (d.license_expiry_date IS NULL OR d.license_expiry_date>=@business_date)
  AND NOT EXISTS (SELECT 1 FROM dbo.encounters active_encounter
                  WHERE active_encounter.attending_doctor_id=d.doctor_id AND active_encounter.is_in_progress=1)
  AND EXISTS
  (
    SELECT 1 FROM dbo.user_roles ur
    JOIN dbo.roles r ON r.role_id=ur.role_id AND r.is_active=1
    JOIN dbo.role_permissions rp ON rp.role_id=r.role_id
    JOIN dbo.permissions p ON p.permission_id=rp.permission_id AND p.permission_code='PRESCRIPTIONS_WRITE'
    WHERE ur.user_id=e.user_id AND ur.is_active=1
      AND (ur.branch_id IS NULL OR ur.branch_id=@branch_id)
      AND (ur.valid_from_utc IS NULL OR ur.valid_from_utc<=SYSUTCDATETIME())
      AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
  )
ORDER BY d.doctor_id;
DECLARE @patient_id bigint=(SELECT TOP(1) patient_id FROM dbo.patients WHERE status='ACTIVE' ORDER BY patient_id),
  @branch_public_id uniqueidentifier=(SELECT public_id FROM dbo.branches WHERE branch_id=@branch_id),
  @location_id bigint=(SELECT inventory_location_id FROM dbo.inventory_locations
                       WHERE branch_id=@branch_id AND location_code='MAIN-PH' AND is_active=1 AND is_dispensing=1),
  @location_public_id uniqueidentifier=(SELECT public_id FROM dbo.inventory_locations
                       WHERE branch_id=@branch_id AND location_code='MAIN-PH' AND is_active=1 AND is_dispensing=1);
IF @actor_id IS NULL OR @doctor_id IS NULL OR @doctor_user_id IS NULL OR @patient_id IS NULL
   OR @branch_id IS NULL OR @location_id IS NULL
  THROW 55840,N'Cần Admin, bác sĩ rảnh, bệnh nhân và quầy MAIN-PH để chạy pharmacy concurrency test.',1;
EXEC sys.sp_set_session_context @key=N'request_id',@value='$setupRequestId';
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@actor_id;
EXEC sys.sp_set_session_context @key=N'branch_id',@value=@branch_id;

INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,encounter_source,status,
  arrived_at_utc,created_by_user_id)
VALUES('PC-$suffix',@branch_id,@patient_id,@doctor_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@actor_id);
DECLARE @encounter_id bigint=SCOPE_IDENTITY(),@encounter_public_id uniqueidentifier;
UPDATE dbo.encounters SET status='IN_PROGRESS',started_at_utc=SYSUTCDATETIME(),is_in_progress=1
WHERE encounter_id=@encounter_id;
SELECT @encounter_public_id=public_id FROM dbo.encounters WHERE encounter_id=@encounter_id;

DECLARE @medicine_public_id uniqueidentifier,@old_batch_public_id uniqueidentifier,
  @new_batch_public_id uniqueidentifier,@movement_public_id uniqueidentifier,
  @prescription_public_id uniqueidentifier,@item_public_id uniqueidentifier,
  @medicine_code varchar(30)=CONCAT('PC',LEFT('$suffix',20)),
  @ingredient nvarchar(200)=CONCAT(N'concurrency-',N'$suffix'),
  @old_expiry date=DATEADD(DAY,60,@business_date),
  @new_expiry date=DATEADD(DAY,120,@business_date);
EXEC dbo.sp_clinic_create_medicine @actor_user_id=@actor_id,@code=@medicine_code,
  @generic_name=N'Thuốc concurrency test',@active_ingredient=@ingredient,@strength=N'100 mg',
  @dosage_form=N'Viên',@route=N'Uống',@base_unit=N'viên',@sale_price=2000,
  @medicine_public_id=@medicine_public_id OUTPUT;
EXEC dbo.sp_clinic_create_batch @actor_user_id=@actor_id,@branch_public_id=@branch_public_id,
  @medicine_public_id=@medicine_public_id,@batch_number=N'PC-OLD-$suffix',
  @expiry_date=@old_expiry,@purchase_price=1000,@sale_price=2000,
  @batch_public_id=@old_batch_public_id OUTPUT;
EXEC dbo.sp_clinic_create_batch @actor_user_id=@actor_id,@branch_public_id=@branch_public_id,
  @medicine_public_id=@medicine_public_id,@batch_number=N'PC-NEW-$suffix',
  @expiry_date=@new_expiry,@purchase_price=1000,@sale_price=2000,
  @batch_public_id=@new_batch_public_id OUTPUT;
EXEC dbo.sp_clinic_receive_stock @actor_user_id=@actor_id,@location_public_id=@location_public_id,
  @batch_public_id=@old_batch_public_id,@quantity=4,@idempotency_key='$receiptKeyOld',
  @movement_public_id=@movement_public_id OUTPUT;
EXEC dbo.sp_clinic_receive_stock @actor_user_id=@actor_id,@location_public_id=@location_public_id,
  @batch_public_id=@new_batch_public_id,@quantity=3,@idempotency_key='$receiptKeyNew',
  @movement_public_id=@movement_public_id OUTPUT;

EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=@doctor_user_id;
EXEC dbo.sp_clinic_create_prescription @actor_user_id=@doctor_user_id,
  @encounter_public_id=@encounter_public_id,@valid_days=7,
  @prescription_public_id=@prescription_public_id OUTPUT;
EXEC dbo.sp_clinic_add_prescription_item @actor_user_id=@doctor_user_id,
  @prescription_public_id=@prescription_public_id,@medicine_public_id=@medicine_public_id,
  @prescribed_quantity=4,@dose=N'1 viên',@frequency=N'Ngày một lần',
  @duration_days=4,@usage_instruction=N'Uống sau ăn',@item_public_id=@item_public_id OUTPUT;
EXEC dbo.sp_clinic_issue_prescription @actor_user_id=@doctor_user_id,
  @prescription_public_id=@prescription_public_id;

DECLARE @prescription_id bigint=(SELECT prescription_id FROM dbo.prescriptions WHERE public_id=@prescription_public_id),
  @item_id bigint=(SELECT prescription_item_id FROM dbo.prescription_items WHERE public_id=@item_public_id),
  @medicine_id bigint=(SELECT medicine_id FROM dbo.medicines WHERE public_id=@medicine_public_id),
  @old_batch_id bigint=(SELECT medicine_batch_id FROM dbo.medicine_batches WHERE public_id=@old_batch_public_id),
  @new_batch_id bigint=(SELECT medicine_batch_id FROM dbo.medicine_batches WHERE public_id=@new_batch_public_id);
SELECT CONCAT(@actor_id,'|',@prescription_public_id,'|',@prescription_id,'|',@item_public_id,'|',@item_id,'|',
  @location_public_id,'|',@location_id,'|',@old_batch_public_id,'|',@old_batch_id,'|',
  @new_batch_public_id,'|',@new_batch_id,'|',@encounter_id,'|',@medicine_id,'|',@ingredient);
"@

$fixture = Invoke-SqlText $setupSql
$fixtureParts = $fixture.Split('|')
if ($fixtureParts.Count -ne 14) { throw "Không đọc được fixture pharmacy concurrency: $fixture" }
$actorId, $prescriptionPublicId, $prescriptionId, $itemPublicId, $itemId,
  $locationPublicId, $locationId, $oldBatchPublicId, $oldBatchId,
  $newBatchPublicId, $newBatchId, $encounterId, $medicineId, $ingredient = $fixtureParts

$openSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
DECLARE @request_id uniqueidentifier=NEWID(),@dispensation_public_id uniqueidentifier;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
EXEC sys.sp_set_session_context @key=N'request_id',@value=@request_id;
BEGIN TRY
  EXEC dbo.sp_clinic_open_dispensation @actor_user_id=$actorId,
    @prescription_public_id='$prescriptionPublicId',@location_public_id='$locationPublicId',
    @dispensation_public_id=@dispensation_public_id OUTPUT;
  SELECT CONCAT('OK|',CONVERT(varchar(36),@dispensation_public_id),'|',CONVERT(varchar(36),@request_id));
END TRY BEGIN CATCH
  SELECT CONCAT('ERR|',ERROR_NUMBER(),'|',CONVERT(varchar(36),@request_id));
END CATCH;
"@

$jobs = @()
$openResults = @()
$sharedResults = @()
$raceResults = @()
try {
  $jobs = 1..2 | ForEach-Object { Start-SqlJob $openSql }
  $openResults = @($jobs | Wait-Job | Receive-Job)
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  $jobs = @()
  $openSuccesses = @($openResults | Where-Object { $_ -like 'OK|*' })
  $openConflicts = @($openResults | Where-Object { $_ -like 'ERR|53323|*' })
  if ($openSuccesses.Count -ne 1 -or $openConflicts.Count -ne 1) {
    throw "Hai quầy không khóa được một phiên cấp phát duy nhất: $($openResults -join ', ')"
  }
  $dispensationPublicId = $openSuccesses[0].Split('|')[1]
  $dispensationId = Invoke-SqlText "SET NOCOUNT ON; SELECT dispensation_id FROM dbo.dispensations WHERE public_id='$dispensationPublicId';"

  $sharedSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
EXEC sys.sp_set_session_context @key=N'request_id',@value='$sharedDispenseKey';
DECLARE @dispensed_public_id uniqueidentifier;
BEGIN TRY
  EXEC dbo.sp_clinic_dispense_item @actor_user_id=$actorId,
    @dispensation_public_id='$dispensationPublicId',@prescription_item_public_id='$itemPublicId',
    @batch_public_id='$oldBatchPublicId',@quantity=1,@idempotency_key='$sharedDispenseKey',
    @dispensation_item_public_id=@dispensed_public_id OUTPUT;
  SELECT CONCAT('OK|',CONVERT(varchar(36),@dispensed_public_id));
END TRY BEGIN CATCH SELECT CONCAT('ERR|',ERROR_NUMBER()); END CATCH;
"@
  $jobs = 1..2 | ForEach-Object { Start-SqlJob $sharedSql }
  $sharedResults = @($jobs | Wait-Job | Receive-Job)
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  $jobs = @()
  if ((@($sharedResults | Where-Object { $_ -like 'OK|*' }).Count -ne 2) -or
      ($sharedResults[0] -ne $sharedResults[1])) {
    throw "Retry đồng thời không trả cùng một dòng cấp phát: $($sharedResults -join ', ')"
  }

  $oldRaceSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
EXEC sys.sp_set_session_context @key=N'request_id',@value='$oldBatchRaceKey';
DECLARE @dispensed_public_id uniqueidentifier;
BEGIN TRY
  EXEC dbo.sp_clinic_dispense_item @actor_user_id=$actorId,
    @dispensation_public_id='$dispensationPublicId',@prescription_item_public_id='$itemPublicId',
    @batch_public_id='$oldBatchPublicId',@quantity=3,@idempotency_key='$oldBatchRaceKey',
    @dispensation_item_public_id=@dispensed_public_id OUTPUT;
  SELECT CONCAT('OLD_OK|',CONVERT(varchar(36),@dispensed_public_id));
END TRY BEGIN CATCH SELECT CONCAT('OLD_ERR|',ERROR_NUMBER()); END CATCH;
"@
  $newRaceSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
EXEC sys.sp_set_session_context @key=N'request_id',@value='$newBatchRaceKey';
DECLARE @dispensed_public_id uniqueidentifier;
BEGIN TRY
  EXEC dbo.sp_clinic_dispense_item @actor_user_id=$actorId,
    @dispensation_public_id='$dispensationPublicId',@prescription_item_public_id='$itemPublicId',
    @batch_public_id='$newBatchPublicId',@quantity=3,@idempotency_key='$newBatchRaceKey',
    @dispensation_item_public_id=@dispensed_public_id OUTPUT;
  SELECT CONCAT('NEW_OK|',CONVERT(varchar(36),@dispensed_public_id));
END TRY BEGIN CATCH SELECT CONCAT('NEW_ERR|',ERROR_NUMBER()); END CATCH;
"@
  $jobs = @((Start-SqlJob $oldRaceSql), (Start-SqlJob $newRaceSql))
  $raceResults = @($jobs | Wait-Job | Receive-Job)
  $jobs | Remove-Job -Force -ErrorAction SilentlyContinue
  $jobs = @()
  $oldSuccess = @($raceResults | Where-Object { $_ -like 'OLD_OK|*' })
  $newRejected = @($raceResults | Where-Object { $_ -in @('NEW_ERR|53328','NEW_ERR|53333') })
  if ($oldSuccess.Count -ne 1 -or $newRejected.Count -ne 1) {
    throw "Race FEFO/giới hạn đơn không an toàn: $($raceResults -join ', ')"
  }
  $oldDispensedPublicId = $oldSuccess[0].Split('|')[1]
  $replayedPublicId = Invoke-SqlText @"
SET NOCOUNT ON; SET XACT_ABORT ON;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
DECLARE @dispensed_public_id uniqueidentifier;
EXEC dbo.sp_clinic_dispense_item @actor_user_id=$actorId,
  @dispensation_public_id='$dispensationPublicId',@prescription_item_public_id='$itemPublicId',
  @batch_public_id='$oldBatchPublicId',@quantity=3,@idempotency_key='$oldBatchRaceKey',
  @dispensation_item_public_id=@dispensed_public_id OUTPUT;
SELECT CONVERT(varchar(36),@dispensed_public_id);
"@
  if ($replayedPublicId -ne $oldDispensedPublicId) {
    throw "Replay sau race không trả đúng resource cũ: $replayedPublicId"
  }

  $verification = Invoke-SqlText @"
SET NOCOUNT ON; SET XACT_ABORT ON;
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
DECLARE @differences TABLE(locationPublicId varchar(36),batchPublicId varchar(36),
  batchNumber nvarchar(80),balanceQuantity varchar(30),ledgerQuantity varchar(30));
DECLARE @branch_public_id uniqueidentifier=(SELECT public_id FROM dbo.branches WHERE branch_code='MAIN');
INSERT @differences EXEC dbo.sp_clinic_reconcile_stock @actor_user_id=$actorId,
  @branch_public_id=@branch_public_id;
DECLARE @dispensed decimal(18,3)=(SELECT dispensed_quantity FROM dbo.prescription_items WHERE prescription_item_id=$itemId),
  @old_balance decimal(18,3)=(SELECT quantity_on_hand FROM dbo.inventory_balances
    WHERE inventory_location_id=$locationId AND medicine_batch_id=$oldBatchId),
  @new_balance decimal(18,3)=(SELECT quantity_on_hand FROM dbo.inventory_balances
    WHERE inventory_location_id=$locationId AND medicine_batch_id=$newBatchId),
  @item_count int=(SELECT COUNT(*) FROM dbo.dispensation_items WHERE dispensation_id=$dispensationId),
  @movement_count int=(SELECT COUNT(*) FROM dbo.inventory_movements
    WHERE dispensation_item_id IN (SELECT dispensation_item_id FROM dbo.dispensation_items WHERE dispensation_id=$dispensationId)
      AND movement_type='DISPENSE'),
  @completed_keys int=(SELECT COUNT(*) FROM dbo.idempotency_requests
    WHERE actor_user_id=$actorId AND operation_code='DISPENSE_ITEM' AND status='COMPLETED'
      AND idempotency_key IN ('$sharedDispenseKey','$oldBatchRaceKey','$newBatchRaceKey')),
  @difference_count int=(SELECT COUNT(*) FROM @differences
    WHERE batchPublicId IN ('$oldBatchPublicId','$newBatchPublicId')),
  @draft_count int=(SELECT COUNT(*) FROM dbo.dispensations WHERE prescription_id=$prescriptionId AND status='DRAFT');
IF @dispensed<>4 OR @old_balance<>0 OR @new_balance<>3 OR @item_count<>2 OR @movement_count<>2
   OR @completed_keys<>2 OR @difference_count<>0 OR @draft_count<>1
  THROW 55841,N'Hậu kiểm race cấp phát không khớp prescription, balance, ledger hoặc idempotency.',1;
SELECT CONCAT('dispensed=',@dispensed,'; oldBalance=',@old_balance,'; newBalance=',@new_balance,
  '; items=',@item_count,'; movements=',@movement_count,'; completedKeys=',@completed_keys);
"@

  [pscustomobject]@{
    result = 'PASS'
    openRace = ($openResults -join ', ')
    retryRace = ($sharedResults -join ', ')
    fefoRace = ($raceResults -join ', ')
    verification = $verification
  }
}
finally {
  if ($jobs) { $jobs | Remove-Job -Force -ErrorAction SilentlyContinue }
  if ($fixtureParts.Count -eq 14) {
    $cleanupSql = @"
SET NOCOUNT ON; SET XACT_ABORT ON; SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON; SET ANSI_WARNINGS ON; SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON; SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DELETE dbo.idempotency_requests WHERE actor_user_id=$actorId
  AND idempotency_key IN ('$receiptKeyOld','$receiptKeyNew','$sharedDispenseKey','$oldBatchRaceKey','$newBatchRaceKey');
DISABLE TRIGGER dbo.trg_inventory_movements_append_only ON dbo.inventory_movements;
DELETE dbo.inventory_movements WHERE medicine_batch_id IN ($oldBatchId,$newBatchId);
ENABLE TRIGGER dbo.trg_inventory_movements_append_only ON dbo.inventory_movements;
DISABLE TRIGGER dbo.trg_dispensation_items_append_only ON dbo.dispensation_items;
DELETE dbo.dispensation_items WHERE dispensation_id IN
  (SELECT dispensation_id FROM dbo.dispensations WHERE prescription_id=$prescriptionId);
ENABLE TRIGGER dbo.trg_dispensation_items_append_only ON dbo.dispensation_items;
DELETE dbo.dispensations WHERE prescription_id=$prescriptionId;
DISABLE TRIGGER dbo.trg_prescription_items_guard ON dbo.prescription_items;
DELETE dbo.prescription_items WHERE prescription_id=$prescriptionId;
ENABLE TRIGGER dbo.trg_prescription_items_guard ON dbo.prescription_items;
DELETE dbo.prescriptions WHERE prescription_id=$prescriptionId;
DELETE dbo.inventory_balances WHERE inventory_location_id=$locationId
  AND medicine_batch_id IN ($oldBatchId,$newBatchId);
DELETE dbo.medicine_batches WHERE medicine_batch_id IN ($oldBatchId,$newBatchId);
DELETE dbo.medicine_allergens WHERE medicine_id=$medicineId;
DELETE dbo.allergens WHERE allergen_type='DRUG' AND canonical_name=N'$ingredient'
  AND NOT EXISTS (SELECT 1 FROM dbo.medicine_allergens ma WHERE ma.allergen_id=dbo.allergens.allergen_id)
  AND NOT EXISTS (SELECT 1 FROM dbo.patient_allergies pa WHERE pa.allergen_id=dbo.allergens.allergen_id);
DELETE dbo.medicines WHERE medicine_id=$medicineId;
DELETE dbo.encounters WHERE encounter_id=$encounterId;
COMMIT TRANSACTION;
"@
    Invoke-SqlText $cleanupSql | Out-Null
  }
}

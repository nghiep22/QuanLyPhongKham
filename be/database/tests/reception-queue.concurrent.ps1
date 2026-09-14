param(
  [string]$Server = 'localhost',
  [string]$Database = 'PrivateClinicManagement'
)

$ErrorActionPreference = 'Stop'
$suffix = ([guid]::NewGuid().ToString('N'))
$setupSql = @"
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DECLARE @actor_id bigint=(SELECT TOP(1) u.user_id FROM dbo.users u
  JOIN dbo.user_roles ur ON ur.user_id=u.user_id AND ur.is_active=1
  JOIN dbo.roles r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
  WHERE u.status='ACTIVE' ORDER BY u.user_id);
DECLARE @branch_id bigint=(SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN' AND is_active=1),@business_date date;
IF @actor_id IS NULL OR @branch_id IS NULL THROW 55820,N'Cần một Admin và chi nhánh MAIN để chạy concurrency test.',1;
EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
IF EXISTS(SELECT 1 FROM dbo.queue_sessions WHERE branch_id=@branch_id AND queue_date_local=@business_date AND queue_type='LAB')
  THROW 55821,N'Hàng đợi LAB hôm nay đã tồn tại; không thể cô lập concurrency test.',1;
DECLARE @doctor_id bigint=(SELECT TOP(1) d.doctor_id FROM dbo.doctors d JOIN dbo.employees e ON e.employee_id=d.employee_id
  WHERE d.is_active=1 AND e.is_active=1 AND e.employment_status='ACTIVE'
    AND EXISTS(SELECT 1 FROM dbo.doctor_branch_assignments a WHERE a.doctor_id=d.doctor_id AND a.branch_id=@branch_id
      AND a.is_active=1 AND a.effective_from<=@business_date AND (a.effective_to IS NULL OR a.effective_to>=@business_date))
  ORDER BY d.doctor_id);
DECLARE @patient_id bigint=(SELECT TOP(1) patient_id FROM dbo.patients WHERE status='ACTIVE' ORDER BY patient_id);
IF @doctor_id IS NULL OR @patient_id IS NULL THROW 55822,N'Cần một bác sĩ được phân công và bệnh nhân ACTIVE.',1;
INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,encounter_source,status,arrived_at_utc,
  created_by_user_id,occupies_appointment,is_in_progress)
VALUES('CQ-$suffix-1',@branch_id,@patient_id,@doctor_id,'WALK_IN','WAITING',DATEADD(MILLISECOND,-10,SYSUTCDATETIME()),@actor_id,1,0);
DECLARE @encounter1 bigint=SCOPE_IDENTITY();
INSERT dbo.encounters(encounter_code,branch_id,patient_id,attending_doctor_id,encounter_source,status,arrived_at_utc,
  created_by_user_id,occupies_appointment,is_in_progress)
VALUES('CQ-$suffix-2',@branch_id,@patient_id,@doctor_id,'WALK_IN','WAITING',SYSUTCDATETIME(),@actor_id,1,0);
DECLARE @encounter2 bigint=SCOPE_IDENTITY(),@ticket1 bigint,@ticket2 bigint,@display varchar(20);
EXEC dbo.sp_allocate_queue_ticket_internal @actor_id,@encounter1,'LAB',0,@ticket1 OUTPUT,@display OUTPUT;
EXEC dbo.sp_allocate_queue_ticket_internal @actor_id,@encounter2,'LAB',0,@ticket2 OUTPUT,@display OUTPUT;
DECLARE @session_id bigint=(SELECT queue_session_id FROM dbo.queue_tickets WHERE queue_ticket_id=@ticket1);
COMMIT TRANSACTION;
SELECT CONCAT(@actor_id,'|',CONVERT(varchar(36),(SELECT public_id FROM dbo.branches WHERE branch_id=@branch_id)),'|',
  CONVERT(varchar(36),(SELECT public_id FROM dbo.queue_tickets WHERE queue_ticket_id=@ticket1)),'|',
  CONVERT(varchar(36),(SELECT public_id FROM dbo.queue_tickets WHERE queue_ticket_id=@ticket2)),'|',
  @encounter1,'|',@encounter2,'|',@ticket1,'|',@ticket2,'|',@session_id);
"@

function Invoke-SqlText([string]$sqlText) {
  $output = & sqlcmd -S $Server -d $Database -E -C -b -h -1 -W -Q $sqlText 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($output -join [Environment]::NewLine) }
  return (($output | Where-Object { $_.Trim() }) -join '').Trim()
}

$fixture = Invoke-SqlText $setupSql
$parts = $fixture.Split('|')
if ($parts.Count -ne 9) { throw "Không đọc được fixture concurrency: $fixture" }
$actorId, $branchPublicId, $ticket1PublicId, $ticket2PublicId, $encounter1Id, $encounter2Id,
  $ticket1Id, $ticket2Id, $sessionId = $parts

$callSql = @"
SET NOCOUNT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
DECLARE @ticket uniqueidentifier,@encounter uniqueidentifier,@display varchar(20);
EXEC sys.sp_set_session_context @key=N'actor_user_id',@value=$actorId;
EXEC dbo.sp_clinic_call_next_queue_ticket @actor_user_id=$actorId,@branch_public_id='$branchPublicId',@queue_type='LAB',
  @queue_ticket_public_id=@ticket OUTPUT,@encounter_public_id=@encounter OUTPUT,@display_number=@display OUTPUT;
SELECT CONVERT(varchar(36),@ticket);
"@
$cleanupSql = @"
SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
BEGIN TRANSACTION;
DELETE dbo.outbox_events WHERE aggregate_type='QUEUE_TICKET' AND aggregate_id IN ('$ticket1PublicId','$ticket2PublicId');
DELETE dbo.queue_tickets WHERE queue_ticket_id IN ($ticket1Id,$ticket2Id);
DELETE dbo.queue_sessions WHERE queue_session_id=$sessionId AND NOT EXISTS(
  SELECT 1 FROM dbo.queue_tickets WHERE queue_session_id=$sessionId);
DELETE dbo.encounters WHERE encounter_id IN ($encounter1Id,$encounter2Id);
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
    } -ArgumentList $Server,$Database,$callSql
  }
  $called = @($jobs | Wait-Job | Receive-Job)
  if ($called.Count -ne 2 -or ($called | Select-Object -Unique).Count -ne 2) {
    throw "Hai phiên call-next không nhận hai ticket khác nhau: $($called -join ', ')"
  }
  $expected = @($ticket1PublicId.ToLowerInvariant(),$ticket2PublicId.ToLowerInvariant()) | Sort-Object
  $actual = @($called | ForEach-Object { $_.ToLowerInvariant() }) | Sort-Object
  if (($expected -join '|') -ne ($actual -join '|')) {
    throw "Call-next nhận ticket ngoài fixture: $($called -join ', ')"
  }
  [pscustomobject]@{ result='PASS'; firstTicket=$called[0]; secondTicket=$called[1] }
}
finally {
  if ($jobs) { $jobs | Remove-Job -Force -ErrorAction SilentlyContinue }
  Invoke-SqlText $cleanupSql | Out-Null
}

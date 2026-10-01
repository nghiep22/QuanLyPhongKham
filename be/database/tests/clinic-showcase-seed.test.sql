/* Run from repository root: sqlcmd -S localhost -d PrivateClinicManagement -E -C -b -f 65001 -i .\be\database\tests\clinic-showcase-seed.test.sql */
SET XACT_ABORT ON;
BEGIN TRANSACTION;
GO
:r .\be\database\seeds\clinic-showcase-data.sql
GO
:r .\be\database\seeds\clinic-showcase-data.sql
GO
IF (SELECT COUNT(*) FROM dbo.medicines WHERE medicine_code LIKE 'D26-MED-%')<>40
   OR (SELECT COUNT(*) FROM dbo.appointments WHERE appointment_code LIKE 'D26-APT-%')<>20
   OR EXISTS (SELECT 1 FROM dbo.inventory_balances b
       JOIN dbo.medicine_batches mb ON mb.medicine_batch_id=b.medicine_batch_id
       WHERE mb.batch_number LIKE 'D26-LOT-%' AND b.quantity_on_hand<0)
    THROW 54110, N'Seed không idempotent hoặc tồn kho không hợp lệ.', 1;
ROLLBACK TRANSACTION;
PRINT N'PASS: seed chạy hai lần trong transaction, kiểm tra khóa và rollback thành công.';

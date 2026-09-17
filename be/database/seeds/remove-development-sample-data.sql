/* Remove only rows created by development-sample-data.sql. Development only. */

SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;

IF DB_NAME() <> N'PrivateClinicManagement'
    THROW 54010, N'This cleanup is restricted to PrivateClinicManagement.', 1;

DECLARE @sample_allergens TABLE(allergen_id bigint PRIMARY KEY);
INSERT @sample_allergens(allergen_id)
SELECT DISTINCT ma.allergen_id
FROM dbo.medicine_allergens ma
JOIN dbo.medicines m ON m.medicine_id=ma.medicine_id
WHERE m.medicine_code LIKE 'S3-MED-%';

DECLARE @disable nvarchar(max);
DECLARE @enable nvarchar(max);

SELECT @disable=STRING_AGG(CONVERT(nvarchar(max),
    CONCAT(N'DISABLE TRIGGER ALL ON ',QUOTENAME(SCHEMA_NAME(t.schema_id)),N'.',QUOTENAME(t.name),N';')),NCHAR(10)),
       @enable=STRING_AGG(CONVERT(nvarchar(max),
    CONCAT(N'ENABLE TRIGGER ALL ON ',QUOTENAME(SCHEMA_NAME(t.schema_id)),N'.',QUOTENAME(t.name),N';')),NCHAR(10))
FROM sys.tables t
WHERE EXISTS (SELECT 1 FROM sys.triggers tr WHERE tr.parent_id=t.object_id);

EXEC sys.sp_executesql @disable;

BEGIN TRY
    BEGIN TRANSACTION;

    DELETE FROM dbo.notifications WHERE dedupe_key LIKE 'sample3-notification-%';
    DELETE FROM dbo.outbox_events WHERE dedupe_key LIKE 'sample3-outbox-%';
    DELETE FROM dbo.audit_logs WHERE action_code='SAMPLE3_SEED' AND entity_type='SAMPLE3';

    DELETE ra FROM dbo.refund_allocations ra
    JOIN dbo.payment_refunds pr ON pr.payment_refund_id=ra.payment_refund_id
    WHERE pr.refund_number LIKE 'S3-REF-%';
    DELETE FROM dbo.payment_refunds WHERE refund_number LIKE 'S3-REF-%';
    DELETE pa FROM dbo.payment_allocations pa
    JOIN dbo.payments p ON p.payment_id=pa.payment_id
    WHERE p.payment_number LIKE 'S3-PAY-%';
    DELETE FROM dbo.payments WHERE payment_number LIKE 'S3-PAY-%';
    DELETE ii FROM dbo.invoice_items ii
    JOIN dbo.invoices i ON i.invoice_id=ii.invoice_id
    WHERE i.invoice_number LIKE 'S3-INV-%';
    DELETE FROM dbo.invoices WHERE invoice_number LIKE 'S3-INV-%';

    DELETE dr FROM dbo.dispensation_item_reversals dr
    JOIN dbo.dispensation_items di ON di.dispensation_item_id=dr.dispensation_item_id
    JOIN dbo.dispensations d ON d.dispensation_id=di.dispensation_id
    WHERE d.dispensation_code LIKE 'S3-DSP-%';
    DELETE im FROM dbo.inventory_movements im
    JOIN dbo.medicine_batches mb ON mb.medicine_batch_id=im.medicine_batch_id
    JOIN dbo.medicines m ON m.medicine_id=mb.medicine_id
    WHERE m.medicine_code LIKE 'S3-MED-%';
    DELETE di FROM dbo.dispensation_items di
    JOIN dbo.dispensations d ON d.dispensation_id=di.dispensation_id
    WHERE d.dispensation_code LIKE 'S3-DSP-%';
    DELETE FROM dbo.dispensations WHERE dispensation_code LIKE 'S3-DSP-%';
    DELETE pi FROM dbo.prescription_items pi
    JOIN dbo.prescriptions p ON p.prescription_id=pi.prescription_id
    WHERE p.prescription_code LIKE 'S3-RX-%';
    DELETE FROM dbo.prescriptions WHERE prescription_code LIKE 'S3-RX-%';

    DELETE cr FROM dbo.clinical_record_releases cr
    JOIN dbo.encounters e ON e.encounter_id=cr.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE ea FROM dbo.encounter_amendments ea
    JOIN dbo.encounters e ON e.encounter_id=ea.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE esg FROM dbo.encounter_signatures esg
    JOIN dbo.encounters e ON e.encounter_id=esg.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE srv FROM dbo.service_result_values srv
    JOIN dbo.service_results sr ON sr.service_result_id=srv.service_result_id
    JOIN dbo.encounter_services es ON es.encounter_service_id=sr.encounter_service_id
    JOIN dbo.encounters e ON e.encounter_id=es.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE sr FROM dbo.service_results sr
    JOIN dbo.encounter_services es ON es.encounter_service_id=sr.encounter_service_id
    JOIN dbo.encounters e ON e.encounter_id=es.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE ma FROM dbo.medical_attachments ma
    JOIN dbo.encounters e ON e.encounter_id=ma.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE ed FROM dbo.encounter_diagnoses ed
    JOIN dbo.encounters e ON e.encounter_id=ed.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE es FROM dbo.encounter_services es
    JOIN dbo.encounters e ON e.encounter_id=es.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE ev FROM dbo.encounter_vital_signs ev
    JOIN dbo.encounters e ON e.encounter_id=ev.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE esa FROM dbo.encounter_staff_assignments esa
    JOIN dbo.encounters e ON e.encounter_id=esa.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE qt FROM dbo.queue_tickets qt
    JOIN dbo.encounters e ON e.encounter_id=qt.encounter_id
    WHERE e.encounter_code LIKE 'S3-ENC-%';
    DELETE FROM dbo.encounters WHERE encounter_code LIKE 'S3-ENC-%';
    DELETE qs FROM dbo.queue_sessions qs
    JOIN dbo.branches b ON b.branch_id=qs.branch_id
    WHERE b.branch_code LIKE 'S3-BR-%';
    DELETE FROM dbo.diagnosis_catalog WHERE diagnosis_code LIKE 'S3.%';

    DELETE arh FROM dbo.appointment_reschedule_history arh
    JOIN dbo.appointments a ON a.appointment_id=arh.appointment_id
    WHERE a.appointment_code LIKE 'S3-APT-%';
    DELETE ash FROM dbo.appointment_status_history ash
    JOIN dbo.appointments a ON a.appointment_id=ash.appointment_id
    WHERE a.appointment_code LIKE 'S3-APT-%';
    DELETE FROM dbo.appointments WHERE appointment_code LIKE 'S3-APT-%';
    DELETE aps FROM dbo.appointment_slots aps
    JOIN dbo.doctor_working_schedules dws ON dws.working_schedule_id=aps.working_schedule_id
    JOIN dbo.doctors d ON d.doctor_id=dws.doctor_id
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE dsb FROM dbo.doctor_schedule_breaks dsb
    JOIN dbo.doctor_working_schedules dws ON dws.working_schedule_id=dsb.working_schedule_id
    JOIN dbo.doctors d ON d.doctor_id=dws.doctor_id
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE dto FROM dbo.doctor_time_off dto
    JOIN dbo.doctors d ON d.doctor_id=dto.doctor_id
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE dws FROM dbo.doctor_working_schedules dws
    JOIN dbo.doctors d ON d.doctor_id=dws.doctor_id
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE ch FROM dbo.clinic_holidays ch
    JOIN dbo.branches b ON b.branch_id=ch.branch_id
    WHERE b.branch_code LIKE 'S3-BR-%';

    DELETE FROM dbo.idempotency_requests WHERE operation_code LIKE 'SAMPLE3_OPERATION_%';
    DELETE ib FROM dbo.inventory_balances ib
    JOIN dbo.medicine_batches mb ON mb.medicine_batch_id=ib.medicine_batch_id
    JOIN dbo.medicines m ON m.medicine_id=mb.medicine_id
    WHERE m.medicine_code LIKE 'S3-MED-%';
    DELETE ma FROM dbo.medicine_allergens ma
    JOIN dbo.medicines m ON m.medicine_id=ma.medicine_id
    WHERE m.medicine_code LIKE 'S3-MED-%';
    DELETE mb FROM dbo.medicine_batches mb
    JOIN dbo.medicines m ON m.medicine_id=mb.medicine_id
    WHERE m.medicine_code LIKE 'S3-MED-%';
    DELETE FROM dbo.medicines WHERE medicine_code LIKE 'S3-MED-%';
    DELETE FROM dbo.suppliers WHERE supplier_code LIKE 'S3-SUP-%';
    DELETE il FROM dbo.inventory_locations il
    JOIN dbo.branches b ON b.branch_id=il.branch_id
    WHERE b.branch_code LIKE 'S3-BR-%' AND il.location_code LIKE 'S3-PH-%';

    DELETE pi FROM dbo.patient_insurances pi
    JOIN dbo.patients p ON p.patient_id=pi.patient_id
    WHERE p.patient_code LIKE 'S3-PAT-%';
    DELETE pec FROM dbo.patient_emergency_contacts pec
    JOIN dbo.patients p ON p.patient_id=pec.patient_id
    WHERE p.patient_code LIKE 'S3-PAT-%';
    DELETE pa FROM dbo.patient_allergies pa
    JOIN dbo.patients p ON p.patient_id=pa.patient_id
    WHERE p.patient_code LIKE 'S3-PAT-%';
    DELETE pc FROM dbo.patient_conditions pc
    JOIN dbo.patients p ON p.patient_id=pc.patient_id
    WHERE p.patient_code LIKE 'S3-PAT-%';
    DELETE par FROM dbo.patient_access_requests par
    JOIN dbo.users u ON u.user_id=par.requester_user_id
    WHERE u.username_normalized LIKE N'sample3.patient%';
    DELETE upa FROM dbo.user_patient_access upa
    JOIN dbo.patients p ON p.patient_id=upa.patient_id
    WHERE p.patient_code LIKE 'S3-PAT-%';
    DELETE FROM dbo.patients WHERE patient_code LIKE 'S3-PAT-%';
    DELETE FROM dbo.insurance_providers WHERE provider_code LIKE 'S3-INS-%';
    DELETE a FROM dbo.allergens a JOIN @sample_allergens x ON x.allergen_id=a.allergen_id;

    DELETE ds FROM dbo.doctor_services ds
    JOIN dbo.doctors d ON d.doctor_id=ds.doctor_id
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE dsp FROM dbo.doctor_specialties dsp
    JOIN dbo.doctors d ON d.doctor_id=dsp.doctor_id
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE dba FROM dbo.doctor_branch_assignments dba
    JOIN dbo.doctors d ON d.doctor_id=dba.doctor_id
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE d FROM dbo.doctors d
    JOIN dbo.employees e ON e.employee_id=d.employee_id
    WHERE e.employee_code LIKE 'S3-EMP-%';
    DELETE FROM dbo.employees WHERE employee_code LIKE 'S3-EMP-%';

    DELETE us FROM dbo.user_sessions us
    JOIN dbo.users u ON u.user_id=us.user_id
    WHERE u.username_normalized LIKE N'sample3.%';
    DELETE prc FROM dbo.password_reset_challenges prc
    JOIN dbo.users u ON u.user_id=prc.user_id
    WHERE u.username_normalized LIKE N'sample3.%';
    DELETE FROM dbo.patient_registration_challenges WHERE username LIKE N'sample3.pending%';
    DELETE ur FROM dbo.user_roles ur
    JOIN dbo.users u ON u.user_id=ur.user_id
    WHERE u.username_normalized LIKE N'sample3.%';
    DELETE FROM dbo.users WHERE username_normalized LIKE N'sample3.%';

    DELETE rp FROM dbo.role_permissions rp
    JOIN dbo.roles r ON r.role_id=rp.role_id
    WHERE r.role_code LIKE 'SAMPLE3_ROLE_%';
    DELETE FROM dbo.roles WHERE role_code LIKE 'SAMPLE3_ROLE_%';
    DELETE FROM dbo.permissions WHERE permission_code LIKE 'SAMPLE3_PERMISSION_%';

    DELETE sbp FROM dbo.service_branch_prices sbp
    JOIN dbo.services s ON s.service_id=sbp.service_id
    WHERE s.service_code LIKE 'S3-SERVICE-%';
    DELETE FROM dbo.services WHERE service_code LIKE 'S3-SERVICE-%';
    DELETE FROM dbo.service_categories WHERE category_code LIKE 'S3-CATEGORY-%';
    DELETE FROM dbo.specialties WHERE specialty_code LIKE 'S3-SPECIALTY-%';
    DELETE ds FROM dbo.document_sequences ds
    JOIN dbo.branches b ON b.branch_id=ds.branch_id
    WHERE b.branch_code LIKE 'S3-BR-%';
    DELETE r FROM dbo.rooms r
    JOIN dbo.branches b ON b.branch_id=r.branch_id
    WHERE b.branch_code LIKE 'S3-BR-%';
    DELETE FROM dbo.branches WHERE branch_code LIKE 'S3-BR-%';

    COMMIT TRANSACTION;
    EXEC sys.sp_executesql @enable;
    PRINT N'SAMPLE3 rows removed.';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    EXEC sys.sp_executesql @enable;
    THROW;
END CATCH;

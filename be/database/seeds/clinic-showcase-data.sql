/*
  Synthetic clinic showcase data for local development only.
  10 doctors, 20 services, 30 patients, 40 medicines, 40 batches and balances,
  30 appointment slots and 20 confirmed appointments. Codes use the D26 prefix.
  No real patient identifiers, registration numbers, manufacturers or credentials.
  Run with sqlcmd -b -f 65001. Re-running checks natural keys and adds missing rows.
*/
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
    THROW 54100, N'Chỉ chạy seed trên PrivateClinicManagement ở môi trường development.', 1;
IF OBJECT_ID(N'dbo.medicines', N'U') IS NULL
    THROW 54101, N'Chưa có schema phòng khám.', 1;

DECLARE @today date = CONVERT(date, GETDATE());
DECLARE @slot_date date;
-- Keep the appointment date between 14 and 20 days ahead, on a Monday.
SET @slot_date = DATEADD(day, 14 + ((7 - DATEDIFF(day, CONVERT(date,'19000101'), @today) % 7) % 7), @today);
DECLARE @branch_id bigint = (SELECT branch_id FROM dbo.branches WHERE branch_code='MAIN');
DECLARE @actor_id bigint = (SELECT TOP (1) u.user_id FROM dbo.users u
    JOIN dbo.user_roles ur ON ur.user_id=u.user_id AND ur.is_active=1
    JOIN dbo.roles r ON r.role_id=ur.role_id AND r.role_code='ADMIN'
    WHERE u.status='ACTIVE' ORDER BY u.user_id);
DECLARE @doctor_role_id bigint = (SELECT role_id FROM dbo.roles WHERE role_code='DOCTOR');
DECLARE @pharmacy_id bigint = (SELECT inventory_location_id FROM dbo.inventory_locations
    WHERE branch_id=@branch_id AND location_code='MAIN-PH' AND is_active=1);

IF @branch_id IS NULL OR @actor_id IS NULL OR @doctor_role_id IS NULL OR @pharmacy_id IS NULL
    THROW 54102, N'Cần chi nhánh MAIN, tài khoản ADMIN, vai trò DOCTOR và quầy MAIN-PH.', 1;

DECLARE @specialties TABLE (n int PRIMARY KEY, code varchar(30), name nvarchar(150));
INSERT @specialties VALUES
    (1,'D26-INTERNAL',N'Nội tổng quát'),(2,'D26-PEDIATRIC',N'Nhi khoa'),
    (3,'D26-ENT',N'Tai mũi họng'),(4,'D26-DERM',N'Da liễu'),
    (5,'D26-CARDIO',N'Tim mạch');

DECLARE @services TABLE (n int PRIMARY KEY, name nvarchar(200), kind varchar(30),
    category_code varchar(30), specialty_no int NULL, minutes smallint, price decimal(19,2));
INSERT @services VALUES
    (1,N'Khám nội tổng quát','CONSULTATION','CONSULTATION',1,30,200000),
    (2,N'Khám nhi khoa','CONSULTATION','CONSULTATION',2,30,220000),
    (3,N'Khám tai mũi họng','CONSULTATION','CONSULTATION',3,30,220000),
    (4,N'Khám da liễu','CONSULTATION','CONSULTATION',4,30,220000),
    (5,N'Khám tim mạch','CONSULTATION','CONSULTATION',5,30,250000),
    (6,N'Tư vấn dinh dưỡng','CONSULTATION','CONSULTATION',1,30,180000),
    (7,N'Khám sức khỏe định kỳ','CONSULTATION','CONSULTATION',1,30,250000),
    (8,N'Tái khám nội khoa','CONSULTATION','CONSULTATION',1,30,150000),
    (9,N'Tái khám nhi khoa','CONSULTATION','CONSULTATION',2,30,150000),
    (10,N'Tái khám da liễu','CONSULTATION','CONSULTATION',4,30,150000),
    (11,N'Công thức máu toàn phần','LAB','LAB',NULL,30,120000),
    (12,N'Định lượng đường huyết lúc đói','LAB','LAB',NULL,30,65000),
    (13,N'Định lượng HbA1c','LAB','LAB',NULL,30,180000),
    (14,N'Bộ xét nghiệm mỡ máu','LAB','LAB',NULL,30,180000),
    (15,N'Đánh giá chức năng gan','LAB','LAB',NULL,30,160000),
    (16,N'Định lượng creatinin máu','LAB','LAB',NULL,30,70000),
    (17,N'Tổng phân tích nước tiểu','LAB','LAB',NULL,30,75000),
    (18,N'Điện tâm đồ 12 chuyển đạo','PROCEDURE','PROCEDURE',5,30,160000),
    (19,N'Siêu âm ổ bụng tổng quát','IMAGING','IMAGING',NULL,30,250000),
    (20,N'Chụp X-quang ngực thẳng','IMAGING','IMAGING',NULL,30,180000);

DECLARE @doctors TABLE (n int PRIMARY KEY, full_name nvarchar(200), specialty_no int);
INSERT @doctors VALUES
    (1,N'Nguyễn Minh Anh',1),(2,N'Trần Quốc Bảo',2),
    (3,N'Lê Thu Hà',3),(4,N'Phạm Đức Long',4),
    (5,N'Võ Thanh Tâm',5),(6,N'Đặng Ngọc Mai',1),
    (7,N'Bùi Gia Huy',1),(8,N'Hoàng Khánh Linh',1),
    (9,N'Đỗ Hữu Phước',2),(10,N'Ngô Phương Thảo',4);

DECLARE @patients TABLE (n int PRIMARY KEY, full_name nvarchar(200), gender varchar(10));
INSERT @patients VALUES
    (1,N'Nguyễn Thị Lan','FEMALE'),(2,N'Trần Văn Minh','MALE'),
    (3,N'Lê Thị Hương','FEMALE'),(4,N'Phạm Quốc Tuấn','MALE'),
    (5,N'Võ Ngọc Anh','FEMALE'),(6,N'Đặng Thành Nam','MALE'),
    (7,N'Bùi Thị Mai','FEMALE'),(8,N'Hoàng Đức Huy','MALE'),
    (9,N'Đỗ Thu Trang','FEMALE'),(10,N'Ngô Minh Quân','MALE'),
    (11,N'Nguyễn Thanh Vy','FEMALE'),(12,N'Trần Gia Phúc','MALE'),
    (13,N'Lê Ngọc Trâm','FEMALE'),(14,N'Phạm Anh Khoa','MALE'),
    (15,N'Võ Bảo Ngọc','FEMALE'),(16,N'Đặng Nhật Hào','MALE'),
    (17,N'Bùi Mỹ Duyên','FEMALE'),(18,N'Hoàng Quốc Việt','MALE'),
    (19,N'Đỗ Thị Kim Chi','FEMALE'),(20,N'Ngô Hoài Nam','MALE'),
    (21,N'Nguyễn Phương Uyên','FEMALE'),(22,N'Trần Hữu Nghĩa','MALE'),
    (23,N'Lê Khánh Ngân','FEMALE'),(24,N'Phạm Minh Trí','MALE'),
    (25,N'Võ Thảo Nhi','FEMALE'),(26,N'Đặng Quang Vinh','MALE'),
    (27,N'Bùi Hà My','FEMALE'),(28,N'Hoàng Tuấn Kiệt','MALE'),
    (29,N'Đỗ Ngọc Quyên','FEMALE'),(30,N'Ngô Đức Thành','MALE');

-- Generic medicines only. Prices and quantities are synthetic UI examples,
-- not treatment guidance or an assertion of market price/registration.
DECLARE @medicines TABLE (n int PRIMARY KEY, ingredient nvarchar(200), strength nvarchar(100),
    form nvarchar(100), route nvarchar(100), unit nvarchar(30), price decimal(19,2));
INSERT @medicines VALUES
    (1,N'Paracetamol',N'500 mg',N'Viên nén',N'Đường uống',N'Viên',2500),
    (2,N'Ibuprofen',N'200 mg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (3,N'Amoxicillin',N'500 mg',N'Viên nang',N'Đường uống',N'Viên',5000),
    (4,N'Azithromycin',N'250 mg',N'Viên nén',N'Đường uống',N'Viên',12000),
    (5,N'Cephalexin',N'500 mg',N'Viên nang',N'Đường uống',N'Viên',5500),
    (6,N'Metformin',N'500 mg',N'Viên nén',N'Đường uống',N'Viên',3000),
    (7,N'Amlodipine',N'5 mg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (8,N'Losartan',N'50 mg',N'Viên nén',N'Đường uống',N'Viên',5000),
    (9,N'Omeprazole',N'20 mg',N'Viên nang',N'Đường uống',N'Viên',4500),
    (10,N'Esomeprazole',N'20 mg',N'Viên nang',N'Đường uống',N'Viên',6500),
    (11,N'Cetirizine',N'10 mg',N'Viên nén',N'Đường uống',N'Viên',3000),
    (12,N'Loratadine',N'10 mg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (13,N'Salbutamol',N'100 mcg/liều',N'Bình xịt định liều',N'Đường hít',N'Bình',85000),
    (14,N'Budesonide',N'200 mcg/liều',N'Bình xịt định liều',N'Đường hít',N'Bình',120000),
    (15,N'Montelukast',N'10 mg',N'Viên nén',N'Đường uống',N'Viên',8000),
    (16,N'Ambroxol',N'30 mg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (17,N'Acetylcysteine',N'200 mg',N'Gói bột',N'Đường uống',N'Gói',4000),
    (18,N'Dextromethorphan',N'15 mg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (19,N'Loperamide',N'2 mg',N'Viên nang',N'Đường uống',N'Viên',3000),
    (20,N'Domperidone',N'10 mg',N'Viên nén',N'Đường uống',N'Viên',4500),
    (21,N'Ondansetron',N'4 mg',N'Viên nén',N'Đường uống',N'Viên',12000),
    (22,N'Fexofenadine',N'180 mg',N'Viên nén',N'Đường uống',N'Viên',8000),
    (23,N'Chlorpheniramine',N'4 mg',N'Viên nén',N'Đường uống',N'Viên',2000),
    (24,N'Doxycycline',N'100 mg',N'Viên nang',N'Đường uống',N'Viên',6500),
    (25,N'Ciprofloxacin',N'500 mg',N'Viên nén',N'Đường uống',N'Viên',7500),
    (26,N'Fluconazole',N'150 mg',N'Viên nang',N'Đường uống',N'Viên',18000),
    (27,N'Clotrimazole',N'1%',N'Kem bôi',N'Bôi ngoài da',N'Tuýp',28000),
    (28,N'Hydrocortisone',N'1%',N'Kem bôi',N'Bôi ngoài da',N'Tuýp',32000),
    (29,N'Diclofenac',N'50 mg',N'Viên nén',N'Đường uống',N'Viên',4500),
    (30,N'Naproxen',N'250 mg',N'Viên nén',N'Đường uống',N'Viên',6500),
    (31,N'Atorvastatin',N'10 mg',N'Viên nén',N'Đường uống',N'Viên',6000),
    (32,N'Rosuvastatin',N'10 mg',N'Viên nén',N'Đường uống',N'Viên',8500),
    (33,N'Bisoprolol',N'5 mg',N'Viên nén',N'Đường uống',N'Viên',5000),
    (34,N'Furosemide',N'40 mg',N'Viên nén',N'Đường uống',N'Viên',3000),
    (35,N'Spironolactone',N'25 mg',N'Viên nén',N'Đường uống',N'Viên',4000),
    (36,N'Levothyroxine',N'50 mcg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (37,N'Allopurinol',N'100 mg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (38,N'Colchicine',N'0,5 mg',N'Viên nén',N'Đường uống',N'Viên',6000),
    (39,N'Ferrous sulfate',N'325 mg',N'Viên nén',N'Đường uống',N'Viên',3500),
    (40,N'Cholecalciferol',N'1.000 IU',N'Viên nang',N'Đường uống',N'Viên',4500);

BEGIN TRY
    BEGIN TRANSACTION;
    EXEC sys.sp_set_session_context N'actor_user_id', @actor_id;
    EXEC sys.sp_set_session_context N'status_reason', N'Lịch hẹn dữ liệu minh họa';

    INSERT dbo.specialties(specialty_code,specialty_name,description,is_active)
    SELECT s.code,s.name,N'Chuyên khoa dùng trong dữ liệu minh họa',1 FROM @specialties s
    WHERE NOT EXISTS (SELECT 1 FROM dbo.specialties x WHERE x.specialty_code=s.code);

    INSERT dbo.services(service_category_id,specialty_id,service_code,service_name,service_type,
        default_duration_min,current_price,requires_doctor,is_active)
    SELECT c.service_category_id,sp.specialty_id,CONCAT('D26-SVC-',RIGHT(CONCAT('00',s.n),2)),
        s.name,s.kind,s.minutes,s.price,1,1
    FROM @services s JOIN dbo.service_categories c ON c.category_code=s.category_code
    LEFT JOIN @specialties v ON v.n=s.specialty_no
    LEFT JOIN dbo.specialties sp ON sp.specialty_code=v.code
    WHERE NOT EXISTS (SELECT 1 FROM dbo.services x
        WHERE x.service_code=CONCAT('D26-SVC-',RIGHT(CONCAT('00',s.n),2)));

    INSERT dbo.service_branch_prices(branch_id,service_id,price_amount,currency_code,effective_from,is_available)
    SELECT @branch_id,s.service_id,s.current_price,'VND',CONVERT(date,'20200101'),1
    FROM dbo.services s WHERE s.service_code LIKE 'D26-SVC-%'
      AND NOT EXISTS (SELECT 1 FROM dbo.service_branch_prices p
          WHERE p.branch_id=@branch_id AND p.service_id=s.service_id);

    INSERT dbo.rooms(branch_id,room_code,room_name,room_type,floor_no,capacity,is_active)
    SELECT @branch_id,CONCAT('D26-CONS-',RIGHT(CONCAT('00',d.n),2)),
        CONCAT(N'Phòng khám ',RIGHT(CONCAT('00',d.n),2)),'CONSULTATION',1,1,1
    FROM @doctors d WHERE NOT EXISTS (SELECT 1 FROM dbo.rooms r
        WHERE r.branch_id=@branch_id AND r.room_code=CONCAT('D26-CONS-',RIGHT(CONCAT('00',d.n),2)));

    -- Valid Argon2 hash of an undisclosed random secret: displayable doctors,
    -- with no published sign-in credentials.
    INSERT dbo.users(username,password_hash,display_name,status)
    SELECT CONCAT('d26.doctor.',RIGHT(CONCAT('00',d.n),2)),
        '$argon2id$v=19$m=19456,t=2,p=1$4+6hGldR02BEINk5CVMlww$iuCMKSnRuXaMujqdm3wPdt3Od9SwaIFIcUiRjXLJ5AA',
        d.full_name,'ACTIVE'
    FROM @doctors d WHERE NOT EXISTS (SELECT 1 FROM dbo.users u
        WHERE u.username_normalized=CONCAT('d26.doctor.',RIGHT(CONCAT('00',d.n),2)));

    INSERT dbo.user_roles(user_id,role_id,branch_id,granted_by_user_id,is_active)
    SELECT u.user_id,@doctor_role_id,@branch_id,@actor_id,1 FROM dbo.users u
    WHERE u.username_normalized LIKE 'd26.doctor.%'
      AND NOT EXISTS (SELECT 1 FROM dbo.user_roles r WHERE r.user_id=u.user_id
          AND r.role_id=@doctor_role_id AND r.branch_id=@branch_id AND r.is_active=1);

    INSERT dbo.employees(user_id,primary_branch_id,employee_code,employee_type,full_name,
        date_of_birth,gender,hire_date,employment_status,is_active)
    SELECT u.user_id,@branch_id,CONCAT('D26-EMP-',RIGHT(CONCAT('00',d.n),2)),
        'DOCTOR',d.full_name,DATEFROMPARTS(1975+d.n,1+(d.n%12),10),
        CASE WHEN d.n IN (1,3,6,8,10) THEN 'FEMALE' ELSE 'MALE' END,
        CONVERT(date,'20250101'),'ACTIVE',1
    FROM @doctors d JOIN dbo.users u
      ON u.username_normalized=CONCAT('d26.doctor.',RIGHT(CONCAT('00',d.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM dbo.employees e
        WHERE e.employee_code=CONCAT('D26-EMP-',RIGHT(CONCAT('00',d.n),2)));

    INSERT dbo.doctors(employee_id,medical_license_no,license_issued_date,license_expiry_date,
        academic_title,biography,default_slot_minutes,accepts_online_booking,is_active)
    SELECT e.employee_id,CONCAT('DEMO-D26-',RIGHT(CONCAT('00',d.n),2)),
        CONVERT(date,'20200101'),CONVERT(date,'20350101'),N'Bác sĩ',
        N'Hồ sơ nhân sự minh họa; giấy phép và thông tin chuyên môn không dùng làm hồ sơ thực.',30,1,1
    FROM @doctors d JOIN dbo.employees e
      ON e.employee_code=CONCAT('D26-EMP-',RIGHT(CONCAT('00',d.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM dbo.doctors x WHERE x.employee_id=e.employee_id);

    INSERT dbo.doctor_branch_assignments(doctor_id,branch_id,effective_from,is_primary,is_active)
    SELECT x.doctor_id,@branch_id,CONVERT(date,'20200101'),1,1
    FROM dbo.doctors x JOIN dbo.employees e ON e.employee_id=x.employee_id
    WHERE e.employee_code LIKE 'D26-EMP-%'
      AND NOT EXISTS (SELECT 1 FROM dbo.doctor_branch_assignments a
          WHERE a.doctor_id=x.doctor_id AND a.branch_id=@branch_id AND a.is_active=1);

    INSERT dbo.doctor_specialties(doctor_id,specialty_id,is_primary,certified_at)
    SELECT x.doctor_id,sp.specialty_id,1,CONVERT(date,'20200101')
    FROM @doctors d JOIN dbo.employees e
      ON e.employee_code=CONCAT('D26-EMP-',RIGHT(CONCAT('00',d.n),2))
    JOIN dbo.doctors x ON x.employee_id=e.employee_id
    JOIN @specialties v ON v.n=d.specialty_no
    JOIN dbo.specialties sp ON sp.specialty_code=v.code
    WHERE NOT EXISTS (SELECT 1 FROM dbo.doctor_specialties ds
        WHERE ds.doctor_id=x.doctor_id AND ds.specialty_id=sp.specialty_id);

    INSERT dbo.doctor_services(doctor_id,service_id,custom_duration_min,is_active)
    SELECT x.doctor_id,s.service_id,30,1
    FROM @doctors d JOIN dbo.employees e
      ON e.employee_code=CONCAT('D26-EMP-',RIGHT(CONCAT('00',d.n),2))
    JOIN dbo.doctors x ON x.employee_id=e.employee_id
    JOIN dbo.services s ON s.service_code=CONCAT('D26-SVC-',RIGHT(CONCAT('00',d.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM dbo.doctor_services ds
        WHERE ds.doctor_id=x.doctor_id AND ds.service_id=s.service_id);

    INSERT dbo.patients(patient_code,registration_branch_id,full_name,date_of_birth,gender,
        province,status,created_by_user_id)
    SELECT CONCAT('D26-PAT-',RIGHT(CONCAT('000',p.n),3)),@branch_id,p.full_name,
        DATEFROMPARTS(1965+(p.n*3)%40,1+(p.n%12),1+(p.n%27)),p.gender,
        N'TP. Hồ Chí Minh','ACTIVE',@actor_id
    FROM @patients p WHERE NOT EXISTS (SELECT 1 FROM dbo.patients x
        WHERE x.patient_code=CONCAT('D26-PAT-',RIGHT(CONCAT('000',p.n),3)));

    INSERT dbo.suppliers(supplier_code,supplier_name,is_active)
    SELECT v.code,v.name,1 FROM (VALUES
        ('D26-SUP-A',N'Kho phân phối dược khu vực Nam'),
        ('D26-SUP-B',N'Kho phân phối dược khu vực Đông'),
        ('D26-SUP-C',N'Kho phân phối dược khu vực Tây'),
        ('D26-SUP-D',N'Kho phân phối dược khu vực Bắc')
    ) v(code,name) WHERE NOT EXISTS (SELECT 1 FROM dbo.suppliers s WHERE s.supplier_code=v.code);

    INSERT dbo.medicines(medicine_code,generic_name,active_ingredient,strength,dosage_form,
        route,base_unit,requires_prescription,controlled_level,reorder_level,current_sale_price,is_active)
    SELECT CONCAT('D26-MED-',RIGHT(CONCAT('00',m.n),2)),m.ingredient,m.ingredient,m.strength,
        m.form,m.route,m.unit,1,'NONE',CASE WHEN m.unit IN (N'Bình',N'Tuýp') THEN 3 ELSE 20 END,
        m.price,1
    FROM @medicines m WHERE NOT EXISTS (SELECT 1 FROM dbo.medicines x
        WHERE x.medicine_code=CONCAT('D26-MED-',RIGHT(CONCAT('00',m.n),2)));

    INSERT dbo.allergens(canonical_name,allergen_type,is_active)
    SELECT m.ingredient,'DRUG',1 FROM @medicines m
    WHERE NOT EXISTS (SELECT 1 FROM dbo.allergens a
        WHERE a.canonical_name=m.ingredient AND a.allergen_type='DRUG');

    INSERT dbo.medicine_allergens(medicine_id,allergen_id,is_active,created_by_user_id)
    SELECT x.medicine_id,a.allergen_id,1,@actor_id
    FROM @medicines m JOIN dbo.medicines x
      ON x.medicine_code=CONCAT('D26-MED-',RIGHT(CONCAT('00',m.n),2))
    JOIN dbo.allergens a ON a.canonical_name=m.ingredient AND a.allergen_type='DRUG'
    WHERE NOT EXISTS (SELECT 1 FROM dbo.medicine_allergens ma
        WHERE ma.medicine_id=x.medicine_id AND ma.allergen_id=a.allergen_id);

    INSERT dbo.medicine_batches(medicine_id,supplier_id,batch_number,manufactured_date,
        expiry_date,purchase_price,sale_price,status,origin_branch_id)
    SELECT x.medicine_id,s.supplier_id,CONCAT('D26-LOT-',RIGHT(CONCAT('00',m.n),2)),
        DATEADD(month,-3,@today),DATEADD(month,18+(m.n%12),@today),
        ROUND(m.price*0.65,2),m.price,'AVAILABLE',@branch_id
    FROM @medicines m JOIN dbo.medicines x
      ON x.medicine_code=CONCAT('D26-MED-',RIGHT(CONCAT('00',m.n),2))
    JOIN dbo.suppliers s ON s.supplier_code=CONCAT('D26-SUP-',CHAR(65+(m.n-1)%4))
    WHERE NOT EXISTS (SELECT 1 FROM dbo.medicine_batches b
        WHERE b.medicine_id=x.medicine_id AND b.batch_number=CONCAT('D26-LOT-',RIGHT(CONCAT('00',m.n),2)));

    INSERT dbo.inventory_balances(inventory_location_id,medicine_batch_id,quantity_on_hand,
        quantity_reserved,last_movement_at_utc)
    SELECT @pharmacy_id,b.medicine_batch_id,
        CASE WHEN m.unit IN (N'Bình',N'Tuýp') THEN 12+(m.n%8) ELSE 60+(m.n%7)*20 END,
        0,SYSUTCDATETIME()
    FROM @medicines m JOIN dbo.medicines x
      ON x.medicine_code=CONCAT('D26-MED-',RIGHT(CONCAT('00',m.n),2))
    JOIN dbo.medicine_batches b ON b.medicine_id=x.medicine_id
      AND b.batch_number=CONCAT('D26-LOT-',RIGHT(CONCAT('00',m.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM dbo.inventory_balances ib
        WHERE ib.inventory_location_id=@pharmacy_id AND ib.medicine_batch_id=b.medicine_batch_id);

    INSERT dbo.inventory_movements(inventory_location_id,medicine_batch_id,movement_type,
        quantity_delta,balance_after,unit_cost,reference_type,reason,performed_by_user_id,request_id)
    SELECT @pharmacy_id,b.medicine_batch_id,'RECEIPT',ib.quantity_on_hand,ib.quantity_on_hand,
        b.purchase_price,'D26_SEED',N'Nhập tồn đầu kỳ minh họa',@actor_id,NEWID()
    FROM @medicines m JOIN dbo.medicines x
      ON x.medicine_code=CONCAT('D26-MED-',RIGHT(CONCAT('00',m.n),2))
    JOIN dbo.medicine_batches b ON b.medicine_id=x.medicine_id
      AND b.batch_number=CONCAT('D26-LOT-',RIGHT(CONCAT('00',m.n),2))
    JOIN dbo.inventory_balances ib ON ib.inventory_location_id=@pharmacy_id
      AND ib.medicine_batch_id=b.medicine_batch_id
    WHERE NOT EXISTS (SELECT 1 FROM dbo.inventory_movements im
        WHERE im.inventory_location_id=@pharmacy_id
          AND im.medicine_batch_id=b.medicine_batch_id AND im.reference_type='D26_SEED');

    INSERT dbo.doctor_working_schedules(doctor_id,branch_id,room_id,weekday_iso,
        local_start_time,local_end_time,slot_duration_min,booking_horizon_days,
        effective_from,is_active,workflow_status,published_at_utc,created_by_user_id)
    SELECT x.doctor_id,@branch_id,r.room_id,1,CONVERT(time,'08:00'),CONVERT(time,'10:00'),
        30,60,DATEADD(day,-7,@slot_date),1,'PUBLISHED',SYSUTCDATETIME(),@actor_id
    FROM @doctors d JOIN dbo.employees e
      ON e.employee_code=CONCAT('D26-EMP-',RIGHT(CONCAT('00',d.n),2))
    JOIN dbo.doctors x ON x.employee_id=e.employee_id
    JOIN dbo.rooms r ON r.branch_id=@branch_id
      AND r.room_code=CONCAT('D26-CONS-',RIGHT(CONCAT('00',d.n),2))
    WHERE NOT EXISTS (SELECT 1 FROM dbo.doctor_working_schedules w
        WHERE w.doctor_id=x.doctor_id AND w.branch_id=@branch_id
          AND w.weekday_iso=1 AND w.local_start_time=CONVERT(time,'08:00')
          AND w.is_active=1);

    INSERT dbo.appointment_slots(working_schedule_id,doctor_id,branch_id,room_id,
        service_date_local,start_time_local,end_time_local,starts_at_utc,ends_at_utc,
        booking_opens_at_utc,booking_closes_at_utc,status)
    SELECT w.working_schedule_id,w.doctor_id,@branch_id,w.room_id,@slot_date,
        DATEADD(minute,v.minute_offset,CONVERT(time,'08:00')),
        DATEADD(minute,v.minute_offset+30,CONVERT(time,'08:00')),
        DATEADD(minute,60+v.minute_offset,CAST(@slot_date AS datetime2)),
        DATEADD(minute,90+v.minute_offset,CAST(@slot_date AS datetime2)),
        DATEADD(day,-30,DATEADD(minute,60+v.minute_offset,CAST(@slot_date AS datetime2))),
        DATEADD(minute,-120,DATEADD(minute,60+v.minute_offset,CAST(@slot_date AS datetime2))),
        'OPEN'
    FROM dbo.doctor_working_schedules w
    JOIN dbo.doctors x ON x.doctor_id=w.doctor_id
    JOIN dbo.employees e ON e.employee_id=x.employee_id
    CROSS JOIN (VALUES(0),(30),(60)) v(minute_offset)
    WHERE e.employee_code LIKE 'D26-EMP-%' AND w.weekday_iso=1
      AND w.effective_from<=@slot_date AND (w.effective_to IS NULL OR w.effective_to>=@slot_date)
      AND NOT EXISTS (SELECT 1 FROM dbo.appointment_slots s
          WHERE s.doctor_id=w.doctor_id AND s.service_date_local=@slot_date
            AND s.start_time_local=DATEADD(minute,v.minute_offset,CONVERT(time,'08:00')));

    ;WITH ordered_slots AS (
        SELECT s.slot_id,s.doctor_id,s.starts_at_utc,s.ends_at_utc,
            ROW_NUMBER() OVER (ORDER BY e.employee_code,s.start_time_local) AS n
        FROM dbo.appointment_slots s JOIN dbo.doctors x ON x.doctor_id=s.doctor_id
        JOIN dbo.employees e ON e.employee_id=x.employee_id
        WHERE e.employee_code LIKE 'D26-EMP-%' AND s.service_date_local=@slot_date
          AND s.start_time_local IN (CONVERT(time,'08:00'),CONVERT(time,'08:30'),CONVERT(time,'09:00'))
    )
    INSERT dbo.appointments(appointment_code,branch_id,slot_id,patient_id,doctor_id,
        service_id,booking_channel,status,scheduled_start_utc,scheduled_end_utc,
        chief_complaint,booked_by_user_id,confirmed_by_user_id,confirmed_at_utc,occupies_slot)
    SELECT CONCAT('D26-APT-',RIGHT(CONCAT('000',s.n),3)),@branch_id,s.slot_id,p.patient_id,
        s.doctor_id,svc.service_id,'COUNTER','CONFIRMED',s.starts_at_utc,s.ends_at_utc,
        N'Đăng ký khám theo lịch',@actor_id,@actor_id,SYSUTCDATETIME(),1
    FROM ordered_slots s JOIN dbo.patients p
      ON p.patient_code=CONCAT('D26-PAT-',RIGHT(CONCAT('000',s.n),3))
    JOIN dbo.doctors x ON x.doctor_id=s.doctor_id
    JOIN dbo.employees e ON e.employee_id=x.employee_id
    JOIN dbo.services svc ON svc.service_code=CONCAT('D26-SVC-',RIGHT(e.employee_code,2))
    WHERE s.n<=20 AND NOT EXISTS (SELECT 1 FROM dbo.appointments a
        WHERE a.appointment_code=CONCAT('D26-APT-',RIGHT(CONCAT('000',s.n),3)));

    IF (SELECT COUNT(*) FROM dbo.doctors d JOIN dbo.employees e ON e.employee_id=d.employee_id
        WHERE e.employee_code LIKE 'D26-EMP-%')<>10
       OR (SELECT COUNT(*) FROM dbo.services WHERE service_code LIKE 'D26-SVC-%')<>20
       OR (SELECT COUNT(*) FROM dbo.patients WHERE patient_code LIKE 'D26-PAT-%')<>30
       OR (SELECT COUNT(*) FROM dbo.medicines WHERE medicine_code LIKE 'D26-MED-%')<>40
       OR (SELECT COUNT(*) FROM dbo.appointments WHERE appointment_code LIKE 'D26-APT-%')<>20
        THROW 54103, N'Số lượng dữ liệu minh họa không đạt mức yêu cầu.', 1;

    COMMIT TRANSACTION;
    PRINT N'Đã đồng bộ dữ liệu minh họa: 10 bác sĩ, 20 dịch vụ, 30 bệnh nhân, 40 thuốc, 20 lịch hẹn.';
END TRY
BEGIN CATCH
    IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
    THROW;
END CATCH;

SELECT v.table_name,v.demo_rows FROM (VALUES
    ('doctors',(SELECT COUNT(*) FROM dbo.doctors d JOIN dbo.employees e ON e.employee_id=d.employee_id WHERE e.employee_code LIKE 'D26-EMP-%')),
    ('services',(SELECT COUNT(*) FROM dbo.services WHERE service_code LIKE 'D26-SVC-%')),
    ('patients',(SELECT COUNT(*) FROM dbo.patients WHERE patient_code LIKE 'D26-PAT-%')),
    ('medicines',(SELECT COUNT(*) FROM dbo.medicines WHERE medicine_code LIKE 'D26-MED-%')),
    ('medicine_batches',(SELECT COUNT(*) FROM dbo.medicine_batches WHERE batch_number LIKE 'D26-LOT-%')),
    ('appointments',(SELECT COUNT(*) FROM dbo.appointments WHERE appointment_code LIKE 'D26-APT-%'))
) v(table_name,demo_rows);

/*
================================================================================
 HỆ THỐNG QUẢN LÝ PHÒNG KHÁM TƯ NHÂN - MICROSOFT SQL SERVER
 Phiên bản       : 1.0
 Yêu cầu         : Microsoft SQL Server 2019+ (khuyến nghị SQL Server 2022)
 Múi giờ         : Lưu thời điểm tuyệt đối bằng UTC (datetime2); chi nhánh dùng
                   Windows time-zone name, ví dụ: 'SE Asia Standard Time'.
 Cách chạy       : Mở file bằng SSMS/Azure Data Studio hoặc:
                   sqlcmd -S <server> -E -i quan_ly_phong_kham.sql -b

 QUY ƯỚC AN TOÀN
 - Backend nên chỉ được EXECUTE các stored procedure nghiệp vụ, không cấp quyền
   INSERT/UPDATE/DELETE trực tiếp trên bảng.
 - Mỗi procedure công khai tự quản lý transaction; không gọi khi đang có một
   transaction nghiệp vụ khác chưa hoàn tất.
 - Backend phải xác thực người dùng trước khi truyền @actor_user_id. request id
   có thể đặt bằng: EXEC sys.sp_set_session_context N'request_id', N'<uuid>'.
 - Không tạo sẵn tài khoản/quyền đăng nhập admin vì file không được chứa mật khẩu.
================================================================================
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
GO

IF DB_ID(N'PrivateClinicManagement') IS NULL
BEGIN
    EXEC(N'CREATE DATABASE [PrivateClinicManagement]
           COLLATE Vietnamese_100_CI_AI_SC_UTF8;');
END;
GO

USE [PrivateClinicManagement];
GO

/*=============================================================================
  1. DANH MỤC CƠ SỞ, PHÒNG, CHUYÊN KHOA VÀ DỊCH VỤ
=============================================================================*/

IF OBJECT_ID(N'dbo.branches', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.branches
    (
        branch_id                     bigint IDENTITY(1,1) NOT NULL,
        public_id                     uniqueidentifier NOT NULL CONSTRAINT DF_branches_public_id DEFAULT NEWSEQUENTIALID(),
        branch_code                   varchar(20) NOT NULL,
        branch_name                   nvarchar(200) NOT NULL,
        medical_license_no            nvarchar(100) NULL,
        phone                         varchar(20) NULL,
        email                         varchar(254) NULL,
        address_line                  nvarchar(300) NOT NULL,
        ward                          nvarchar(100) NULL,
        district                      nvarchar(100) NULL,
        province                      nvarchar(100) NULL,
        timezone_name                 sysname NOT NULL
            CONSTRAINT DF_branches_timezone DEFAULT N'SE Asia Standard Time',
        booking_horizon_days          smallint NOT NULL
            CONSTRAINT DF_branches_horizon DEFAULT (60),
        online_hold_minutes           smallint NOT NULL
            CONSTRAINT DF_branches_hold DEFAULT (15),
        cancellation_deadline_minutes int NOT NULL
            CONSTRAINT DF_branches_cancel_deadline DEFAULT (120),
        is_active                     bit NOT NULL CONSTRAINT DF_branches_active DEFAULT (1),
        created_at_utc                datetime2(3) NOT NULL
            CONSTRAINT DF_branches_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc                datetime2(3) NOT NULL
            CONSTRAINT DF_branches_updated DEFAULT SYSUTCDATETIME(),
        row_ver                       rowversion NOT NULL,
        CONSTRAINT PK_branches PRIMARY KEY CLUSTERED (branch_id),
        CONSTRAINT UQ_branches_public_id UNIQUE (public_id),
        CONSTRAINT UQ_branches_code UNIQUE (branch_code),
        CONSTRAINT CK_branches_horizon CHECK (booking_horizon_days BETWEEN 1 AND 365),
        CONSTRAINT CK_branches_hold CHECK (online_hold_minutes BETWEEN 1 AND 120),
        CONSTRAINT CK_branches_cancel CHECK (cancellation_deadline_minutes >= 0)
    );
END;
GO

IF COL_LENGTH(N'dbo.branches', N'public_id') IS NULL
    ALTER TABLE dbo.branches ADD public_id uniqueidentifier NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.branches') AND name=N'public_id' AND is_nullable=1)
BEGIN
    EXEC sys.sp_executesql N'UPDATE dbo.branches SET public_id=NEWID() WHERE public_id IS NULL;';
    EXEC sys.sp_executesql N'ALTER TABLE dbo.branches ALTER COLUMN public_id uniqueidentifier NOT NULL;';
END;
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.branches') AND name=N'DF_branches_public_id')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.branches ADD CONSTRAINT DF_branches_public_id DEFAULT NEWSEQUENTIALID() FOR public_id;';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.branches') AND name=N'UX_branches_public_id')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_branches_public_id ON dbo.branches(public_id);';
GO

IF OBJECT_ID(N'dbo.rooms', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.rooms
    (
        room_id          bigint IDENTITY(1,1) NOT NULL,
        branch_id        bigint NOT NULL,
        room_code        varchar(30) NOT NULL,
        room_name        nvarchar(150) NOT NULL,
        room_type        varchar(30) NOT NULL,
        floor_no         smallint NULL,
        capacity         smallint NOT NULL CONSTRAINT DF_rooms_capacity DEFAULT (1),
        is_active        bit NOT NULL CONSTRAINT DF_rooms_active DEFAULT (1),
        created_at_utc   datetime2(3) NOT NULL CONSTRAINT DF_rooms_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc   datetime2(3) NOT NULL CONSTRAINT DF_rooms_updated DEFAULT SYSUTCDATETIME(),
        row_ver          rowversion NOT NULL,
        CONSTRAINT PK_rooms PRIMARY KEY CLUSTERED (room_id),
        CONSTRAINT FK_rooms_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT UQ_rooms_branch_code UNIQUE (branch_id, room_code),
        CONSTRAINT CK_rooms_type CHECK (room_type IN
            ('CONSULTATION','PROCEDURE','LAB','IMAGING','PHARMACY','OTHER')),
        CONSTRAINT CK_rooms_capacity CHECK (capacity > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.specialties', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.specialties
    (
        specialty_id     bigint IDENTITY(1,1) NOT NULL,
        public_id         uniqueidentifier NOT NULL CONSTRAINT DF_specialties_public_id DEFAULT NEWSEQUENTIALID(),
        specialty_code   varchar(30) NOT NULL,
        specialty_name   nvarchar(150) NOT NULL,
        description      nvarchar(1000) NULL,
        is_active        bit NOT NULL CONSTRAINT DF_specialties_active DEFAULT (1),
        created_at_utc   datetime2(3) NOT NULL CONSTRAINT DF_specialties_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_specialties PRIMARY KEY CLUSTERED (specialty_id),
        CONSTRAINT UQ_specialties_public_id UNIQUE (public_id),
        CONSTRAINT UQ_specialties_code UNIQUE (specialty_code),
        CONSTRAINT UQ_specialties_name UNIQUE (specialty_name)
    );
END;
GO

IF COL_LENGTH(N'dbo.specialties', N'public_id') IS NULL
    ALTER TABLE dbo.specialties ADD public_id uniqueidentifier NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.specialties') AND name=N'public_id' AND is_nullable=1)
BEGIN
    EXEC sys.sp_executesql N'UPDATE dbo.specialties SET public_id=NEWID() WHERE public_id IS NULL;';
    EXEC sys.sp_executesql N'ALTER TABLE dbo.specialties ALTER COLUMN public_id uniqueidentifier NOT NULL;';
END;
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.specialties') AND name=N'DF_specialties_public_id')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.specialties ADD CONSTRAINT DF_specialties_public_id DEFAULT NEWSEQUENTIALID() FOR public_id;';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.specialties') AND name=N'UX_specialties_public_id')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_specialties_public_id ON dbo.specialties(public_id);';
GO

IF OBJECT_ID(N'dbo.service_categories', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_categories
    (
        service_category_id bigint IDENTITY(1,1) NOT NULL,
        category_code       varchar(30) NOT NULL,
        category_name       nvarchar(150) NOT NULL,
        display_order       int NOT NULL CONSTRAINT DF_service_categories_order DEFAULT (0),
        is_active           bit NOT NULL CONSTRAINT DF_service_categories_active DEFAULT (1),
        CONSTRAINT PK_service_categories PRIMARY KEY CLUSTERED (service_category_id),
        CONSTRAINT UQ_service_categories_code UNIQUE (category_code)
    );
END;
GO

IF OBJECT_ID(N'dbo.services', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.services
    (
        service_id             bigint IDENTITY(1,1) NOT NULL,
        service_category_id    bigint NOT NULL,
        specialty_id           bigint NULL,
        service_code           varchar(30) NOT NULL,
        service_name           nvarchar(200) NOT NULL,
        service_type           varchar(30) NOT NULL,
        default_duration_min   smallint NOT NULL,
        current_price          decimal(19,2) NOT NULL,
        requires_doctor        bit NOT NULL CONSTRAINT DF_services_doctor DEFAULT (1),
        result_schema_json     nvarchar(max) NULL,
        is_active              bit NOT NULL CONSTRAINT DF_services_active DEFAULT (1),
        created_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_services_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_services_updated DEFAULT SYSUTCDATETIME(),
        row_ver                rowversion NOT NULL,
        CONSTRAINT PK_services PRIMARY KEY CLUSTERED (service_id),
        CONSTRAINT FK_services_category FOREIGN KEY (service_category_id)
            REFERENCES dbo.service_categories(service_category_id),
        CONSTRAINT FK_services_specialty FOREIGN KEY (specialty_id)
            REFERENCES dbo.specialties(specialty_id),
        CONSTRAINT UQ_services_code UNIQUE (service_code),
        CONSTRAINT CK_services_type CHECK (service_type IN
            ('CONSULTATION','LAB','IMAGING','PROCEDURE','VACCINATION','OTHER')),
        CONSTRAINT CK_services_duration CHECK (default_duration_min BETWEEN 5 AND 480),
        CONSTRAINT CK_services_price CHECK (current_price >= 0),
        CONSTRAINT CK_services_result_json CHECK
            (result_schema_json IS NULL OR ISJSON(result_schema_json) = 1)
    );
END;
GO

/*=============================================================================
  2. TÀI KHOẢN, RBAC VÀ NHÂN SỰ
=============================================================================*/

IF OBJECT_ID(N'dbo.roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.roles
    (
        role_id          bigint IDENTITY(1,1) NOT NULL,
        role_code        varchar(50) NOT NULL,
        role_name        nvarchar(150) NOT NULL,
        description      nvarchar(500) NULL,
        is_system        bit NOT NULL CONSTRAINT DF_roles_system DEFAULT (0),
        is_active        bit NOT NULL CONSTRAINT DF_roles_active DEFAULT (1),
        created_at_utc   datetime2(3) NOT NULL CONSTRAINT DF_roles_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_roles PRIMARY KEY CLUSTERED (role_id),
        CONSTRAINT UQ_roles_code UNIQUE (role_code)
    );
END;
GO

IF OBJECT_ID(N'dbo.permissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.permissions
    (
        permission_id    bigint IDENTITY(1,1) NOT NULL,
        permission_code  varchar(80) NOT NULL,
        permission_name  nvarchar(200) NOT NULL,
        module_code      varchar(40) NOT NULL,
        description      nvarchar(500) NULL,
        CONSTRAINT PK_permissions PRIMARY KEY CLUSTERED (permission_id),
        CONSTRAINT UQ_permissions_code UNIQUE (permission_code)
    );
END;
GO

IF OBJECT_ID(N'dbo.users', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.users
    (
        user_id              bigint IDENTITY(1,1) NOT NULL,
        public_id            uniqueidentifier NOT NULL CONSTRAINT DF_users_public_id DEFAULT NEWSEQUENTIALID(),
        username             nvarchar(80) NOT NULL,
        email                varchar(254) NULL,
        phone                varchar(20) NULL,
        password_hash        varchar(255) NOT NULL,
        display_name         nvarchar(200) NOT NULL,
        status               varchar(20) NOT NULL CONSTRAINT DF_users_status DEFAULT ('ACTIVE'),
        failed_login_count   smallint NOT NULL CONSTRAINT DF_users_failed DEFAULT (0),
        locked_until_utc     datetime2(3) NULL,
        password_changed_utc datetime2(3) NOT NULL CONSTRAINT DF_users_password_changed DEFAULT SYSUTCDATETIME(),
        last_login_at_utc    datetime2(3) NULL,
        mfa_enabled          bit NOT NULL CONSTRAINT DF_users_mfa DEFAULT (0),
        token_version        int NOT NULL CONSTRAINT DF_users_token_version DEFAULT (1),
        created_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_users_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_users_updated DEFAULT SYSUTCDATETIME(),
        deleted_at_utc       datetime2(3) NULL,
        username_normalized  AS CONVERT(nvarchar(80), LOWER(LTRIM(RTRIM(username)))) PERSISTED,
        email_normalized     AS CONVERT(varchar(254), LOWER(LTRIM(RTRIM(email)))) PERSISTED,
        phone_normalized     AS CONVERT(varchar(20), REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(phone)), ' ', ''), '-', ''), '.', '')) PERSISTED,
        row_ver              rowversion NOT NULL,
        CONSTRAINT PK_users PRIMARY KEY CLUSTERED (user_id),
        CONSTRAINT CK_users_status CHECK (status IN ('ACTIVE','LOCKED','DISABLED','PENDING')),
        CONSTRAINT CK_users_failed CHECK (failed_login_count >= 0),
        CONSTRAINT CK_users_token_version CHECK (token_version > 0),
        CONSTRAINT CK_users_deleted CHECK
            ((status = 'DISABLED') OR deleted_at_utc IS NULL),
        CONSTRAINT CK_users_email_not_blank CHECK (email IS NULL OR LEN(LTRIM(RTRIM(email))) > 0),
        CONSTRAINT CK_users_phone_not_blank CHECK (phone IS NULL OR LEN(LTRIM(RTRIM(phone))) > 0)
    );
END;
GO

IF COL_LENGTH(N'dbo.users', N'public_id') IS NULL
    ALTER TABLE dbo.users ADD public_id uniqueidentifier NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.users') AND name=N'public_id' AND is_nullable=1)
BEGIN
    EXEC sys.sp_executesql N'UPDATE dbo.users SET public_id = NEWID() WHERE public_id IS NULL;';
    EXEC sys.sp_executesql N'ALTER TABLE dbo.users ALTER COLUMN public_id uniqueidentifier NOT NULL;';
END;
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.users') AND name=N'DF_users_public_id')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.users ADD CONSTRAINT DF_users_public_id DEFAULT NEWSEQUENTIALID() FOR public_id;';
IF COL_LENGTH(N'dbo.users', N'token_version') IS NULL
    ALTER TABLE dbo.users ADD token_version int NOT NULL CONSTRAINT DF_users_token_version DEFAULT (1) WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.users') AND name=N'CK_users_token_version')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.users ADD CONSTRAINT CK_users_token_version CHECK (token_version > 0);';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.users') AND name=N'UX_users_public_id')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_users_public_id ON dbo.users(public_id);';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.users') AND name = N'UX_users_username')
    CREATE UNIQUE INDEX UX_users_username ON dbo.users(username_normalized);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.users') AND name = N'UX_users_email')
    CREATE UNIQUE INDEX UX_users_email ON dbo.users(email_normalized) WHERE email IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.users') AND name = N'UX_users_phone')
    CREATE UNIQUE INDEX UX_users_phone ON dbo.users(phone_normalized) WHERE phone IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.user_sessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_sessions
    (
        session_id          uniqueidentifier NOT NULL CONSTRAINT DF_user_sessions_id DEFAULT NEWSEQUENTIALID(),
        user_id             bigint NOT NULL,
        refresh_token_hash  binary(32) NOT NULL,
        device_info         nvarchar(500) NULL,
        ip_address          varchar(45) NULL,
        issued_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_user_sessions_issued DEFAULT SYSUTCDATETIME(),
        expires_at_utc      datetime2(3) NOT NULL,
        revoked_at_utc      datetime2(3) NULL,
        replaced_by_id      uniqueidentifier NULL,
        revocation_reason   varchar(30) NULL,
        last_used_at_utc    datetime2(3) NULL,
        token_version_snapshot int NOT NULL CONSTRAINT DF_user_sessions_token_version DEFAULT (1),
        CONSTRAINT PK_user_sessions PRIMARY KEY CLUSTERED (session_id),
        CONSTRAINT FK_user_sessions_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_user_sessions_replaced FOREIGN KEY (replaced_by_id) REFERENCES dbo.user_sessions(session_id),
        CONSTRAINT UQ_user_sessions_token UNIQUE (refresh_token_hash),
        CONSTRAINT CK_user_sessions_expiry CHECK (expires_at_utc > issued_at_utc)
    );
END;
GO

IF COL_LENGTH(N'dbo.user_sessions', N'revocation_reason') IS NULL
    ALTER TABLE dbo.user_sessions ADD revocation_reason varchar(30) NULL;
IF COL_LENGTH(N'dbo.user_sessions', N'last_used_at_utc') IS NULL
    ALTER TABLE dbo.user_sessions ADD last_used_at_utc datetime2(3) NULL;
IF COL_LENGTH(N'dbo.user_sessions', N'token_version_snapshot') IS NULL
    ALTER TABLE dbo.user_sessions ADD token_version_snapshot int NOT NULL
        CONSTRAINT DF_user_sessions_token_version DEFAULT (1) WITH VALUES;
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.user_sessions') AND name=N'CK_user_sessions_revocation_reason')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.user_sessions ADD CONSTRAINT CK_user_sessions_revocation_reason CHECK
        (revocation_reason IS NULL OR revocation_reason IN (''ROTATED'',''LOGOUT'',''LOGOUT_ALL'',''REUSE_DETECTED'',''EXPIRED'',''ACCOUNT_CHANGED''));';
GO

IF OBJECT_ID(N'dbo.user_roles', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_roles
    (
        user_role_id      bigint IDENTITY(1,1) NOT NULL,
        public_id         uniqueidentifier NOT NULL CONSTRAINT DF_user_roles_public_id DEFAULT NEWSEQUENTIALID(),
        user_id           bigint NOT NULL,
        role_id           bigint NOT NULL,
        branch_id         bigint NULL,
        granted_by_user_id bigint NULL,
        granted_at_utc    datetime2(3) NOT NULL CONSTRAINT DF_user_roles_granted DEFAULT SYSUTCDATETIME(),
        valid_from_utc    datetime2(3) NOT NULL CONSTRAINT DF_user_roles_from DEFAULT SYSUTCDATETIME(),
        valid_to_utc      datetime2(3) NULL,
        is_active         bit NOT NULL CONSTRAINT DF_user_roles_active DEFAULT (1),
        CONSTRAINT PK_user_roles PRIMARY KEY CLUSTERED (user_role_id),
        CONSTRAINT UQ_user_roles_public_id UNIQUE (public_id),
        CONSTRAINT FK_user_roles_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_user_roles_role FOREIGN KEY (role_id) REFERENCES dbo.roles(role_id),
        CONSTRAINT FK_user_roles_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_user_roles_granter FOREIGN KEY (granted_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_user_roles_valid CHECK (valid_to_utc IS NULL OR valid_to_utc > valid_from_utc)
    );
END;
GO

IF COL_LENGTH(N'dbo.user_roles', N'public_id') IS NULL
    ALTER TABLE dbo.user_roles ADD public_id uniqueidentifier NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.user_roles') AND name=N'public_id' AND is_nullable=1)
BEGIN
    EXEC sys.sp_executesql N'UPDATE dbo.user_roles SET public_id=NEWID() WHERE public_id IS NULL;';
    EXEC sys.sp_executesql N'ALTER TABLE dbo.user_roles ALTER COLUMN public_id uniqueidentifier NOT NULL;';
END;
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.user_roles') AND name=N'DF_user_roles_public_id')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.user_roles ADD CONSTRAINT DF_user_roles_public_id DEFAULT NEWSEQUENTIALID() FOR public_id;';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.user_roles') AND name=N'UX_user_roles_public_id')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_user_roles_public_id ON dbo.user_roles(public_id);';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.user_roles') AND name = N'UX_user_roles_global')
    CREATE UNIQUE INDEX UX_user_roles_global ON dbo.user_roles(user_id, role_id)
    WHERE branch_id IS NULL AND is_active = 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.user_roles') AND name = N'UX_user_roles_branch')
    CREATE UNIQUE INDEX UX_user_roles_branch ON dbo.user_roles(user_id, role_id, branch_id)
    WHERE branch_id IS NOT NULL AND is_active = 1;
GO

IF OBJECT_ID(N'dbo.role_permissions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.role_permissions
    (
        role_id          bigint NOT NULL,
        permission_id    bigint NOT NULL,
        granted_at_utc   datetime2(3) NOT NULL CONSTRAINT DF_role_permissions_granted DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_role_permissions PRIMARY KEY CLUSTERED (role_id, permission_id),
        CONSTRAINT FK_role_permissions_role FOREIGN KEY (role_id) REFERENCES dbo.roles(role_id),
        CONSTRAINT FK_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES dbo.permissions(permission_id)
    );
END;
GO

IF OBJECT_ID(N'dbo.employees', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.employees
    (
        employee_id        bigint IDENTITY(1,1) NOT NULL,
        public_id           uniqueidentifier NOT NULL CONSTRAINT DF_employees_public_id DEFAULT NEWSEQUENTIALID(),
        user_id            bigint NULL,
        primary_branch_id  bigint NOT NULL,
        employee_code      varchar(30) NOT NULL,
        employee_type      varchar(30) NOT NULL,
        full_name          nvarchar(200) NOT NULL,
        date_of_birth      date NULL,
        gender             varchar(10) NULL,
        phone              varchar(20) NULL,
        email              varchar(254) NULL,
        address_line       nvarchar(300) NULL,
        hire_date          date NOT NULL,
        employment_status  varchar(20) NOT NULL CONSTRAINT DF_employees_status DEFAULT ('ACTIVE'),
        termination_date   date NULL,
        is_active          bit NOT NULL CONSTRAINT DF_employees_active DEFAULT (1),
        created_at_utc     datetime2(3) NOT NULL CONSTRAINT DF_employees_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc     datetime2(3) NOT NULL CONSTRAINT DF_employees_updated DEFAULT SYSUTCDATETIME(),
        row_ver            rowversion NOT NULL,
        CONSTRAINT PK_employees PRIMARY KEY CLUSTERED (employee_id),
        CONSTRAINT UQ_employees_public_id UNIQUE (public_id),
        CONSTRAINT FK_employees_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_employees_branch FOREIGN KEY (primary_branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT UQ_employees_code UNIQUE (employee_code),
        CONSTRAINT CK_employees_type CHECK (employee_type IN
            ('DOCTOR','NURSE','RECEPTIONIST','PHARMACIST','CASHIER','LAB_TECH','TECHNICIAN','MANAGER','OTHER')),
        CONSTRAINT CK_employees_gender CHECK (gender IS NULL OR gender IN ('MALE','FEMALE','OTHER')),
        CONSTRAINT CK_employees_status CHECK (employment_status IN ('ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED')),
        CONSTRAINT CK_employees_termination CHECK
            ((employment_status = 'TERMINATED' AND termination_date IS NOT NULL) OR employment_status <> 'TERMINATED')
    );
END;
GO

IF COL_LENGTH(N'dbo.employees', N'public_id') IS NULL
    ALTER TABLE dbo.employees ADD public_id uniqueidentifier NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.employees') AND name=N'public_id' AND is_nullable=1)
BEGIN
    EXEC sys.sp_executesql N'UPDATE dbo.employees SET public_id=NEWID() WHERE public_id IS NULL;';
    EXEC sys.sp_executesql N'ALTER TABLE dbo.employees ALTER COLUMN public_id uniqueidentifier NOT NULL;';
END;
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.employees') AND name=N'DF_employees_public_id')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.employees ADD CONSTRAINT DF_employees_public_id DEFAULT NEWSEQUENTIALID() FOR public_id;';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.employees') AND name=N'UX_employees_public_id')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_employees_public_id ON dbo.employees(public_id);';
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.employees') AND name = N'UX_employees_user')
    CREATE UNIQUE INDEX UX_employees_user ON dbo.employees(user_id) WHERE user_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.doctors', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.doctors
    (
        doctor_id               bigint IDENTITY(1,1) NOT NULL,
        public_id               uniqueidentifier NOT NULL CONSTRAINT DF_doctors_public_id DEFAULT NEWSEQUENTIALID(),
        employee_id             bigint NOT NULL,
        medical_license_no      nvarchar(100) NOT NULL,
        license_issued_date     date NULL,
        license_expiry_date     date NULL,
        academic_title          nvarchar(100) NULL,
        biography               nvarchar(max) NULL,
        default_slot_minutes    smallint NOT NULL CONSTRAINT DF_doctors_slot DEFAULT (30),
        accepts_online_booking  bit NOT NULL CONSTRAINT DF_doctors_online DEFAULT (1),
        is_active               bit NOT NULL CONSTRAINT DF_doctors_active DEFAULT (1),
        created_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_doctors_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_doctors_updated DEFAULT SYSUTCDATETIME(),
        row_ver                 rowversion NOT NULL,
        CONSTRAINT PK_doctors PRIMARY KEY CLUSTERED (doctor_id),
        CONSTRAINT UQ_doctors_public_id UNIQUE (public_id),
        CONSTRAINT FK_doctors_employee FOREIGN KEY (employee_id) REFERENCES dbo.employees(employee_id),
        CONSTRAINT UQ_doctors_employee UNIQUE (employee_id),
        CONSTRAINT UQ_doctors_license UNIQUE (medical_license_no),
        CONSTRAINT CK_doctors_slot CHECK (default_slot_minutes BETWEEN 5 AND 240),
        CONSTRAINT CK_doctors_license_dates CHECK
            (license_expiry_date IS NULL OR license_issued_date IS NULL OR license_expiry_date >= license_issued_date)
    );
END;
GO

IF COL_LENGTH(N'dbo.doctors', N'public_id') IS NULL
    ALTER TABLE dbo.doctors ADD public_id uniqueidentifier NULL;
IF EXISTS (SELECT 1 FROM sys.columns WHERE object_id=OBJECT_ID(N'dbo.doctors') AND name=N'public_id' AND is_nullable=1)
BEGIN
    EXEC sys.sp_executesql N'UPDATE dbo.doctors SET public_id=NEWID() WHERE public_id IS NULL;';
    EXEC sys.sp_executesql N'ALTER TABLE dbo.doctors ALTER COLUMN public_id uniqueidentifier NOT NULL;';
END;
IF NOT EXISTS (SELECT 1 FROM sys.default_constraints WHERE parent_object_id=OBJECT_ID(N'dbo.doctors') AND name=N'DF_doctors_public_id')
    EXEC sys.sp_executesql N'ALTER TABLE dbo.doctors ADD CONSTRAINT DF_doctors_public_id DEFAULT NEWSEQUENTIALID() FOR public_id;';
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id=OBJECT_ID(N'dbo.doctors') AND name=N'UX_doctors_public_id')
    EXEC sys.sp_executesql N'CREATE UNIQUE INDEX UX_doctors_public_id ON dbo.doctors(public_id);';
GO

IF OBJECT_ID(N'dbo.doctor_branch_assignments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.doctor_branch_assignments
    (
        doctor_branch_assignment_id bigint IDENTITY(1,1) NOT NULL,
        doctor_id                    bigint NOT NULL,
        branch_id                    bigint NOT NULL,
        effective_from               date NOT NULL,
        effective_to                 date NULL,
        is_primary                   bit NOT NULL CONSTRAINT DF_doctor_branch_primary DEFAULT (0),
        is_active                    bit NOT NULL CONSTRAINT DF_doctor_branch_active DEFAULT (1),
        created_at_utc               datetime2(3) NOT NULL CONSTRAINT DF_doctor_branch_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_doctor_branch_assignments PRIMARY KEY CLUSTERED (doctor_branch_assignment_id),
        CONSTRAINT FK_doctor_branch_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_doctor_branch_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT UQ_doctor_branch_period UNIQUE (doctor_id, branch_id, effective_from),
        CONSTRAINT CK_doctor_branch_period CHECK (effective_to IS NULL OR effective_to >= effective_from)
    );
END;
GO

IF OBJECT_ID(N'dbo.doctor_specialties', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.doctor_specialties
    (
        doctor_id       bigint NOT NULL,
        specialty_id    bigint NOT NULL,
        is_primary      bit NOT NULL CONSTRAINT DF_doctor_specialties_primary DEFAULT (0),
        certified_at    date NULL,
        CONSTRAINT PK_doctor_specialties PRIMARY KEY CLUSTERED (doctor_id, specialty_id),
        CONSTRAINT FK_doctor_specialties_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_doctor_specialties_specialty FOREIGN KEY (specialty_id) REFERENCES dbo.specialties(specialty_id)
    );
END;
GO

IF OBJECT_ID(N'dbo.doctor_services', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.doctor_services
    (
        doctor_id       bigint NOT NULL,
        service_id      bigint NOT NULL,
        custom_duration_min smallint NULL,
        is_active       bit NOT NULL CONSTRAINT DF_doctor_services_active DEFAULT (1),
        CONSTRAINT PK_doctor_services PRIMARY KEY CLUSTERED (doctor_id, service_id),
        CONSTRAINT FK_doctor_services_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_doctor_services_service FOREIGN KEY (service_id) REFERENCES dbo.services(service_id),
        CONSTRAINT CK_doctor_services_duration CHECK
            (custom_duration_min IS NULL OR custom_duration_min BETWEEN 5 AND 480)
    );
END;
GO

/*=============================================================================
  3. BỆNH NHÂN, NGƯỜI THÂN, DỊ ỨNG, BỆNH NỀN VÀ BẢO HIỂM
=============================================================================*/

IF OBJECT_ID(N'dbo.patients', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.patients
    (
        patient_id             bigint IDENTITY(1,1) NOT NULL,
        patient_code           varchar(30) NOT NULL,
        full_name              nvarchar(200) NOT NULL,
        date_of_birth          date NOT NULL,
        gender                 varchar(10) NOT NULL,
        national_id            varchar(30) NULL,
        health_insurance_no    varchar(30) NULL,
        phone                  varchar(20) NULL,
        email                  varchar(254) NULL,
        address_line           nvarchar(300) NULL,
        ward                   nvarchar(100) NULL,
        district               nvarchar(100) NULL,
        province               nvarchar(100) NULL,
        blood_type             varchar(3) NULL,
        occupation             nvarchar(150) NULL,
        status                 varchar(20) NOT NULL CONSTRAINT DF_patients_status DEFAULT ('ACTIVE'),
        merged_into_patient_id bigint NULL,
        created_by_user_id     bigint NULL,
        created_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_patients_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_patients_updated DEFAULT SYSUTCDATETIME(),
        national_id_normalized AS CONVERT(varchar(30), NULLIF(REPLACE(REPLACE(LTRIM(RTRIM(national_id)), ' ', ''), '-', ''), '')) PERSISTED,
        phone_normalized       AS CONVERT(varchar(20), NULLIF(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(phone)), ' ', ''), '-', ''), '.', ''), '')) PERSISTED,
        row_ver                rowversion NOT NULL,
        CONSTRAINT PK_patients PRIMARY KEY CLUSTERED (patient_id),
        CONSTRAINT UQ_patients_code UNIQUE (patient_code),
        CONSTRAINT FK_patients_merged FOREIGN KEY (merged_into_patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_patients_creator FOREIGN KEY (created_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_patients_gender CHECK (gender IN ('MALE','FEMALE','OTHER')),
        CONSTRAINT CK_patients_blood CHECK (blood_type IS NULL OR blood_type IN ('A+','A-','B+','B-','AB+','AB-','O+','O-')),
        CONSTRAINT CK_patients_status CHECK (status IN ('ACTIVE','INACTIVE','DECEASED','MERGED')),
        CONSTRAINT CK_patients_merge CHECK
            ((status = 'MERGED' AND merged_into_patient_id IS NOT NULL AND merged_into_patient_id <> patient_id)
             OR (status <> 'MERGED' AND merged_into_patient_id IS NULL)),
        CONSTRAINT CK_patients_national_id_not_blank CHECK
            (national_id IS NULL OR LEN(LTRIM(RTRIM(national_id))) > 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.patients') AND name = N'UX_patients_national_id')
    CREATE UNIQUE INDEX UX_patients_national_id ON dbo.patients(national_id_normalized)
    WHERE national_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.patients') AND name = N'IX_patients_search')
    CREATE INDEX IX_patients_search ON dbo.patients(phone_normalized, full_name, date_of_birth)
    INCLUDE (patient_code, status);
GO

IF OBJECT_ID(N'dbo.user_patient_access', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.user_patient_access
    (
        user_patient_access_id bigint IDENTITY(1,1) NOT NULL,
        user_id                 bigint NOT NULL,
        patient_id              bigint NOT NULL,
        relationship_type       varchar(20) NOT NULL,
        status                  varchar(20) NOT NULL CONSTRAINT DF_user_patient_status DEFAULT ('PENDING'),
        is_booking_allowed      bit NOT NULL CONSTRAINT DF_user_patient_booking DEFAULT (1),
        verified_by_user_id     bigint NULL,
        verified_at_utc         datetime2(3) NULL,
        revoked_at_utc          datetime2(3) NULL,
        created_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_user_patient_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_user_patient_access PRIMARY KEY CLUSTERED (user_patient_access_id),
        CONSTRAINT FK_user_patient_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_user_patient_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_user_patient_verifier FOREIGN KEY (verified_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_user_patient UNIQUE (user_id, patient_id),
        CONSTRAINT CK_user_patient_relationship CHECK (relationship_type IN
            ('SELF','CHILD','SPOUSE','PARENT','GUARDIAN','OTHER')),
        CONSTRAINT CK_user_patient_status CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
        CONSTRAINT CK_user_patient_verified CHECK
            ((status = 'ACTIVE' AND verified_at_utc IS NOT NULL) OR status <> 'ACTIVE')
    );
END;
GO

IF OBJECT_ID(N'dbo.patient_emergency_contacts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.patient_emergency_contacts
    (
        emergency_contact_id bigint IDENTITY(1,1) NOT NULL,
        patient_id            bigint NOT NULL,
        full_name             nvarchar(200) NOT NULL,
        relationship_name     nvarchar(80) NULL,
        phone                 varchar(20) NOT NULL,
        is_primary            bit NOT NULL CONSTRAINT DF_emergency_primary DEFAULT (0),
        CONSTRAINT PK_patient_emergency_contacts PRIMARY KEY CLUSTERED (emergency_contact_id),
        CONSTRAINT FK_emergency_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id)
    );
END;
GO

IF OBJECT_ID(N'dbo.patient_allergies', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.patient_allergies
    (
        patient_allergy_id bigint IDENTITY(1,1) NOT NULL,
        patient_id         bigint NOT NULL,
        allergen_name      nvarchar(200) NOT NULL,
        allergy_type       varchar(20) NOT NULL,
        severity           varchar(20) NOT NULL,
        reaction           nvarchar(500) NULL,
        noted_at           date NULL,
        is_active          bit NOT NULL CONSTRAINT DF_allergies_active DEFAULT (1),
        recorded_by_user_id bigint NULL,
        created_at_utc     datetime2(3) NOT NULL CONSTRAINT DF_allergies_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_patient_allergies PRIMARY KEY CLUSTERED (patient_allergy_id),
        CONSTRAINT FK_allergies_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_allergies_recorder FOREIGN KEY (recorded_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_allergies_type CHECK (allergy_type IN ('DRUG','FOOD','ENVIRONMENT','OTHER')),
        CONSTRAINT CK_allergies_severity CHECK (severity IN ('MILD','MODERATE','SEVERE','UNKNOWN'))
    );
END;
GO

IF OBJECT_ID(N'dbo.patient_conditions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.patient_conditions
    (
        patient_condition_id bigint IDENTITY(1,1) NOT NULL,
        patient_id           bigint NOT NULL,
        condition_code       varchar(30) NULL,
        condition_name       nvarchar(200) NOT NULL,
        diagnosed_date       date NULL,
        status               varchar(20) NOT NULL CONSTRAINT DF_conditions_status DEFAULT ('ACTIVE'),
        notes                nvarchar(1000) NULL,
        recorded_by_user_id  bigint NULL,
        created_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_conditions_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_patient_conditions PRIMARY KEY CLUSTERED (patient_condition_id),
        CONSTRAINT FK_conditions_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_conditions_recorder FOREIGN KEY (recorded_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_conditions_status CHECK (status IN ('ACTIVE','CONTROLLED','RESOLVED'))
    );
END;
GO

IF OBJECT_ID(N'dbo.insurance_providers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.insurance_providers
    (
        insurance_provider_id bigint IDENTITY(1,1) NOT NULL,
        provider_code         varchar(30) NOT NULL,
        provider_name         nvarchar(200) NOT NULL,
        phone                 varchar(20) NULL,
        is_active             bit NOT NULL CONSTRAINT DF_insurance_providers_active DEFAULT (1),
        CONSTRAINT PK_insurance_providers PRIMARY KEY CLUSTERED (insurance_provider_id),
        CONSTRAINT UQ_insurance_providers_code UNIQUE (provider_code)
    );
END;
GO

IF OBJECT_ID(N'dbo.patient_insurances', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.patient_insurances
    (
        patient_insurance_id bigint IDENTITY(1,1) NOT NULL,
        patient_id           bigint NOT NULL,
        insurance_provider_id bigint NOT NULL,
        policy_number        varchar(50) NOT NULL,
        valid_from           date NOT NULL,
        valid_to             date NOT NULL,
        coverage_percent     decimal(5,2) NOT NULL CONSTRAINT DF_patient_insurance_coverage DEFAULT (0),
        is_primary           bit NOT NULL CONSTRAINT DF_patient_insurance_primary DEFAULT (0),
        is_active            bit NOT NULL CONSTRAINT DF_patient_insurance_active DEFAULT (1),
        CONSTRAINT PK_patient_insurances PRIMARY KEY CLUSTERED (patient_insurance_id),
        CONSTRAINT FK_patient_insurance_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_patient_insurance_provider FOREIGN KEY (insurance_provider_id)
            REFERENCES dbo.insurance_providers(insurance_provider_id),
        CONSTRAINT UQ_patient_insurance_policy UNIQUE (insurance_provider_id, policy_number),
        CONSTRAINT CK_patient_insurance_dates CHECK (valid_to >= valid_from),
        CONSTRAINT CK_patient_insurance_coverage CHECK (coverage_percent BETWEEN 0 AND 100)
    );
END;
GO

/*=============================================================================
  4. LỊCH LÀM VIỆC, NGHỈ PHÉP VÀ SLOT KHÁM
=============================================================================*/

IF OBJECT_ID(N'dbo.doctor_working_schedules', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.doctor_working_schedules
    (
        working_schedule_id bigint IDENTITY(1,1) NOT NULL,
        doctor_id           bigint NOT NULL,
        branch_id           bigint NOT NULL,
        room_id             bigint NOT NULL,
        weekday_iso         tinyint NOT NULL,
        local_start_time    time(0) NOT NULL,
        local_end_time      time(0) NOT NULL,
        slot_duration_min   smallint NOT NULL,
        booking_horizon_days smallint NULL,
        effective_from      date NOT NULL,
        effective_to        date NULL,
        is_active           bit NOT NULL CONSTRAINT DF_working_schedules_active DEFAULT (1),
        created_by_user_id  bigint NOT NULL,
        created_at_utc      datetime2(3) NOT NULL CONSTRAINT DF_working_schedules_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc      datetime2(3) NOT NULL CONSTRAINT DF_working_schedules_updated DEFAULT SYSUTCDATETIME(),
        row_ver             rowversion NOT NULL,
        CONSTRAINT PK_doctor_working_schedules PRIMARY KEY CLUSTERED (working_schedule_id),
        CONSTRAINT FK_working_schedules_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_working_schedules_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_working_schedules_room FOREIGN KEY (room_id) REFERENCES dbo.rooms(room_id),
        CONSTRAINT FK_working_schedules_creator FOREIGN KEY (created_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_working_schedules_weekday CHECK (weekday_iso BETWEEN 1 AND 7),
        CONSTRAINT CK_working_schedules_time CHECK (local_start_time < local_end_time),
        CONSTRAINT CK_working_schedules_slot CHECK (slot_duration_min BETWEEN 5 AND 240),
        CONSTRAINT CK_working_schedules_horizon CHECK
            (booking_horizon_days IS NULL OR booking_horizon_days BETWEEN 1 AND 365),
        CONSTRAINT CK_working_schedules_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
    );
END;
GO

IF OBJECT_ID(N'dbo.doctor_schedule_breaks', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.doctor_schedule_breaks
    (
        schedule_break_id    bigint IDENTITY(1,1) NOT NULL,
        working_schedule_id  bigint NOT NULL,
        local_start_time     time(0) NOT NULL,
        local_end_time       time(0) NOT NULL,
        break_name           nvarchar(100) NULL,
        CONSTRAINT PK_doctor_schedule_breaks PRIMARY KEY CLUSTERED (schedule_break_id),
        CONSTRAINT FK_schedule_breaks_schedule FOREIGN KEY (working_schedule_id)
            REFERENCES dbo.doctor_working_schedules(working_schedule_id),
        CONSTRAINT CK_schedule_breaks_time CHECK (local_start_time < local_end_time)
    );
END;
GO

IF OBJECT_ID(N'dbo.doctor_time_off', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.doctor_time_off
    (
        doctor_time_off_id bigint IDENTITY(1,1) NOT NULL,
        doctor_id          bigint NOT NULL,
        branch_id          bigint NULL,
        starts_at_utc      datetime2(3) NOT NULL,
        ends_at_utc        datetime2(3) NOT NULL,
        reason             nvarchar(500) NULL,
        status             varchar(20) NOT NULL CONSTRAINT DF_time_off_status DEFAULT ('PENDING'),
        requested_by_user_id bigint NOT NULL,
        approved_by_user_id bigint NULL,
        approved_at_utc    datetime2(3) NULL,
        created_at_utc     datetime2(3) NOT NULL CONSTRAINT DF_time_off_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_doctor_time_off PRIMARY KEY CLUSTERED (doctor_time_off_id),
        CONSTRAINT FK_time_off_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_time_off_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_time_off_requester FOREIGN KEY (requested_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_time_off_approver FOREIGN KEY (approved_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_time_off_range CHECK (ends_at_utc > starts_at_utc),
        CONSTRAINT CK_time_off_status CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
        CONSTRAINT CK_time_off_approved CHECK
            ((status = 'APPROVED' AND approved_by_user_id IS NOT NULL AND approved_at_utc IS NOT NULL)
             OR status <> 'APPROVED')
    );
END;
GO

IF OBJECT_ID(N'dbo.clinic_holidays', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.clinic_holidays
    (
        clinic_holiday_id bigint IDENTITY(1,1) NOT NULL,
        branch_id         bigint NOT NULL,
        holiday_date      date NOT NULL,
        holiday_name      nvarchar(200) NOT NULL,
        is_closed_all_day bit NOT NULL CONSTRAINT DF_holidays_closed DEFAULT (1),
        local_start_time  time(0) NULL,
        local_end_time    time(0) NULL,
        created_by_user_id bigint NOT NULL,
        CONSTRAINT PK_clinic_holidays PRIMARY KEY CLUSTERED (clinic_holiday_id),
        CONSTRAINT FK_holidays_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_holidays_creator FOREIGN KEY (created_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_holidays_branch_date_name UNIQUE (branch_id, holiday_date, holiday_name),
        CONSTRAINT CK_holidays_time CHECK
        (
            (is_closed_all_day = 1 AND local_start_time IS NULL AND local_end_time IS NULL)
            OR (is_closed_all_day = 0 AND local_start_time IS NOT NULL
                AND local_end_time IS NOT NULL AND local_start_time < local_end_time)
        )
    );
END;
GO

IF OBJECT_ID(N'dbo.appointment_slots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointment_slots
    (
        slot_id                bigint IDENTITY(1,1) NOT NULL,
        working_schedule_id    bigint NOT NULL,
        doctor_id              bigint NOT NULL,
        branch_id              bigint NOT NULL,
        room_id                bigint NOT NULL,
        service_date_local     date NOT NULL,
        start_time_local       time(0) NOT NULL,
        end_time_local         time(0) NOT NULL,
        starts_at_utc          datetime2(3) NOT NULL,
        ends_at_utc            datetime2(3) NOT NULL,
        booking_opens_at_utc   datetime2(3) NOT NULL,
        booking_closes_at_utc  datetime2(3) NOT NULL,
        status                 varchar(20) NOT NULL CONSTRAINT DF_slots_status DEFAULT ('OPEN'),
        blocked_reason         nvarchar(300) NULL,
        created_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_slots_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_slots_updated DEFAULT SYSUTCDATETIME(),
        row_ver                rowversion NOT NULL,
        CONSTRAINT PK_appointment_slots PRIMARY KEY CLUSTERED (slot_id),
        CONSTRAINT FK_slots_schedule FOREIGN KEY (working_schedule_id)
            REFERENCES dbo.doctor_working_schedules(working_schedule_id),
        CONSTRAINT FK_slots_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_slots_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_slots_room FOREIGN KEY (room_id) REFERENCES dbo.rooms(room_id),
        CONSTRAINT UQ_slots_doctor_start UNIQUE (doctor_id, starts_at_utc),
        CONSTRAINT CK_slots_local_time CHECK (start_time_local < end_time_local),
        CONSTRAINT CK_slots_utc_time CHECK (starts_at_utc < ends_at_utc),
        CONSTRAINT CK_slots_booking_window CHECK (booking_opens_at_utc < booking_closes_at_utc
                                                   AND booking_closes_at_utc <= starts_at_utc),
        CONSTRAINT CK_slots_status CHECK (status IN ('OPEN','BOOKED','BLOCKED','CANCELLED')),
        CONSTRAINT CK_slots_block_reason CHECK
            ((status = 'BLOCKED' AND blocked_reason IS NOT NULL) OR status <> 'BLOCKED')
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.appointment_slots') AND name = N'IX_slots_available')
    CREATE INDEX IX_slots_available
        ON dbo.appointment_slots(branch_id, service_date_local, doctor_id, status, starts_at_utc)
        INCLUDE (room_id, booking_opens_at_utc, booking_closes_at_utc, ends_at_utc);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.appointment_slots') AND name = N'IX_slots_room_time')
    CREATE INDEX IX_slots_room_time ON dbo.appointment_slots(room_id, starts_at_utc, ends_at_utc);
GO

/*=============================================================================
  5. LỊCH HẸN, TIẾP NHẬN WALK-IN, LƯỢT KHÁM VÀ HÀNG ĐỢI
=============================================================================*/

IF OBJECT_ID(N'dbo.appointments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointments
    (
        appointment_id        bigint IDENTITY(1,1) NOT NULL,
        appointment_code      varchar(40) NOT NULL,
        branch_id             bigint NOT NULL,
        slot_id               bigint NOT NULL,
        patient_id            bigint NOT NULL,
        doctor_id             bigint NOT NULL,
        service_id            bigint NOT NULL,
        booking_channel       varchar(20) NOT NULL,
        status                varchar(20) NOT NULL,
        scheduled_start_utc   datetime2(3) NOT NULL,
        scheduled_end_utc     datetime2(3) NOT NULL,
        hold_expires_at_utc   datetime2(3) NULL,
        chief_complaint       nvarchar(1000) NULL,
        patient_note          nvarchar(1000) NULL,
        internal_note         nvarchar(1000) NULL,
        booked_by_user_id     bigint NOT NULL,
        confirmed_by_user_id  bigint NULL,
        confirmed_at_utc      datetime2(3) NULL,
        cancelled_by_user_id  bigint NULL,
        cancelled_at_utc      datetime2(3) NULL,
        cancellation_reason   nvarchar(500) NULL,
        cancellation_source   varchar(20) NULL,
        created_at_utc        datetime2(3) NOT NULL CONSTRAINT DF_appointments_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc        datetime2(3) NOT NULL CONSTRAINT DF_appointments_updated DEFAULT SYSUTCDATETIME(),
        occupies_slot          bit NOT NULL CONSTRAINT DF_appointments_occupies_slot DEFAULT (1),
        row_ver               rowversion NOT NULL,
        CONSTRAINT PK_appointments PRIMARY KEY CLUSTERED (appointment_id),
        CONSTRAINT FK_appointments_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_appointments_slot FOREIGN KEY (slot_id) REFERENCES dbo.appointment_slots(slot_id),
        CONSTRAINT FK_appointments_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_appointments_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_appointments_service FOREIGN KEY (service_id) REFERENCES dbo.services(service_id),
        CONSTRAINT FK_appointments_booker FOREIGN KEY (booked_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_appointments_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_appointments_canceller FOREIGN KEY (cancelled_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_appointments_code UNIQUE (appointment_code),
        CONSTRAINT CK_appointments_channel CHECK (booking_channel IN ('ONLINE','PHONE','COUNTER')),
        CONSTRAINT CK_appointments_status CHECK (status IN
            ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW','EXPIRED')),
        CONSTRAINT CK_appointments_time CHECK (scheduled_end_utc > scheduled_start_utc),
        CONSTRAINT CK_appointments_hold CHECK
            ((status = 'PENDING' AND hold_expires_at_utc IS NOT NULL)
             OR (status <> 'PENDING' AND hold_expires_at_utc IS NULL)),
        CONSTRAINT CK_appointments_confirmed CHECK
            ((status IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED')
              AND confirmed_at_utc IS NOT NULL) OR status NOT IN ('CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED')),
        CONSTRAINT CK_appointments_cancelled CHECK
            ((status = 'CANCELLED' AND cancelled_at_utc IS NOT NULL
              AND cancelled_by_user_id IS NOT NULL AND cancellation_reason IS NOT NULL)
             OR status <> 'CANCELLED'),
        CONSTRAINT CK_appointments_occupies_slot CHECK
            ((status IN ('PENDING','CONFIRMED','CHECKED_IN','IN_PROGRESS') AND occupies_slot = 1)
             OR (status IN ('COMPLETED','CANCELLED','NO_SHOW','EXPIRED') AND occupies_slot = 0))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.appointments') AND name = N'UX_appointments_active_slot')
    CREATE UNIQUE INDEX UX_appointments_active_slot ON dbo.appointments(slot_id)
    WHERE occupies_slot = 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.appointments') AND name = N'IX_appointments_patient_time')
    CREATE INDEX IX_appointments_patient_time
        ON dbo.appointments(patient_id, scheduled_start_utc, scheduled_end_utc, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.appointments') AND name = N'IX_appointments_doctor_time')
    CREATE INDEX IX_appointments_doctor_time
        ON dbo.appointments(doctor_id, scheduled_start_utc, scheduled_end_utc, status);
GO

IF OBJECT_ID(N'dbo.appointment_status_history', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointment_status_history
    (
        appointment_status_history_id bigint IDENTITY(1,1) NOT NULL,
        appointment_id        bigint NOT NULL,
        old_status            varchar(20) NULL,
        new_status            varchar(20) NOT NULL,
        changed_by_user_id    bigint NULL,
        reason                nvarchar(500) NULL,
        changed_at_utc        datetime2(3) NOT NULL CONSTRAINT DF_appointment_history_changed DEFAULT SYSUTCDATETIME(),
        request_id            uniqueidentifier NULL,
        CONSTRAINT PK_appointment_status_history PRIMARY KEY CLUSTERED (appointment_status_history_id),
        CONSTRAINT FK_appointment_history_appointment FOREIGN KEY (appointment_id)
            REFERENCES dbo.appointments(appointment_id),
        CONSTRAINT FK_appointment_history_user FOREIGN KEY (changed_by_user_id) REFERENCES dbo.users(user_id)
    );
END;
GO

IF OBJECT_ID(N'dbo.appointment_reschedule_history', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.appointment_reschedule_history
    (
        appointment_reschedule_history_id bigint IDENTITY(1,1) NOT NULL,
        appointment_id       bigint NOT NULL,
        old_slot_id          bigint NOT NULL,
        new_slot_id          bigint NOT NULL,
        old_doctor_id        bigint NOT NULL,
        new_doctor_id        bigint NOT NULL,
        old_service_id       bigint NOT NULL,
        new_service_id       bigint NOT NULL,
        reason               nvarchar(500) NOT NULL,
        changed_by_user_id   bigint NOT NULL,
        changed_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_reschedule_history_time DEFAULT SYSUTCDATETIME(),
        request_id           uniqueidentifier NULL,
        CONSTRAINT PK_appointment_reschedule_history PRIMARY KEY CLUSTERED (appointment_reschedule_history_id),
        CONSTRAINT FK_reschedule_history_appointment FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(appointment_id),
        CONSTRAINT FK_reschedule_history_old_slot FOREIGN KEY (old_slot_id) REFERENCES dbo.appointment_slots(slot_id),
        CONSTRAINT FK_reschedule_history_new_slot FOREIGN KEY (new_slot_id) REFERENCES dbo.appointment_slots(slot_id),
        CONSTRAINT FK_reschedule_history_old_doctor FOREIGN KEY (old_doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_reschedule_history_new_doctor FOREIGN KEY (new_doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_reschedule_history_old_service FOREIGN KEY (old_service_id) REFERENCES dbo.services(service_id),
        CONSTRAINT FK_reschedule_history_new_service FOREIGN KEY (new_service_id) REFERENCES dbo.services(service_id),
        CONSTRAINT FK_reschedule_history_user FOREIGN KEY (changed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_reschedule_history_slots CHECK (old_slot_id <> new_slot_id)
    );
END;
GO

IF OBJECT_ID(N'dbo.queue_sessions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.queue_sessions
    (
        queue_session_id   bigint IDENTITY(1,1) NOT NULL,
        branch_id          bigint NOT NULL,
        queue_date_local   date NOT NULL,
        queue_type         varchar(20) NOT NULL CONSTRAINT DF_queue_sessions_type DEFAULT ('GENERAL'),
        prefix             varchar(10) NOT NULL CONSTRAINT DF_queue_sessions_prefix DEFAULT ('A'),
        last_number        int NOT NULL CONSTRAINT DF_queue_sessions_number DEFAULT (0),
        status             varchar(20) NOT NULL CONSTRAINT DF_queue_sessions_status DEFAULT ('OPEN'),
        opened_at_utc      datetime2(3) NOT NULL CONSTRAINT DF_queue_sessions_opened DEFAULT SYSUTCDATETIME(),
        closed_at_utc      datetime2(3) NULL,
        row_ver            rowversion NOT NULL,
        CONSTRAINT PK_queue_sessions PRIMARY KEY CLUSTERED (queue_session_id),
        CONSTRAINT FK_queue_sessions_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT UQ_queue_sessions UNIQUE (branch_id, queue_date_local, queue_type),
        CONSTRAINT CK_queue_sessions_type CHECK (queue_type IN ('GENERAL','PRIORITY','LAB','PHARMACY')),
        CONSTRAINT CK_queue_sessions_status CHECK (status IN ('OPEN','CLOSED')),
        CONSTRAINT CK_queue_sessions_number CHECK (last_number >= 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.encounters', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.encounters
    (
        encounter_id            bigint IDENTITY(1,1) NOT NULL,
        encounter_code          varchar(40) NOT NULL,
        appointment_id          bigint NULL,
        branch_id               bigint NOT NULL,
        patient_id              bigint NOT NULL,
        attending_doctor_id     bigint NOT NULL,
        room_id                 bigint NULL,
        encounter_source        varchar(20) NOT NULL,
        status                  varchar(20) NOT NULL CONSTRAINT DF_encounters_status DEFAULT ('WAITING'),
        arrived_at_utc          datetime2(3) NOT NULL,
        started_at_utc          datetime2(3) NULL,
        completed_at_utc        datetime2(3) NULL,
        signed_at_utc           datetime2(3) NULL,
        signed_by_user_id       bigint NULL,
        cancelled_at_utc        datetime2(3) NULL,
        cancelled_by_user_id    bigint NULL,
        cancellation_reason     nvarchar(500) NULL,
        chief_complaint         nvarchar(1000) NULL,
        history_of_present_illness nvarchar(max) NULL,
        physical_examination    nvarchar(max) NULL,
        clinical_assessment     nvarchar(max) NULL,
        treatment_plan          nvarchar(max) NULL,
        follow_up_instructions  nvarchar(max) NULL,
        follow_up_date          date NULL,
        created_by_user_id      bigint NOT NULL,
        created_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_encounters_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_encounters_updated DEFAULT SYSUTCDATETIME(),
        occupies_appointment    bit NOT NULL CONSTRAINT DF_encounters_occupies_appointment DEFAULT (1),
        is_in_progress          bit NOT NULL CONSTRAINT DF_encounters_in_progress DEFAULT (0),
        row_ver                 rowversion NOT NULL,
        CONSTRAINT PK_encounters PRIMARY KEY CLUSTERED (encounter_id),
        CONSTRAINT FK_encounters_appointment FOREIGN KEY (appointment_id) REFERENCES dbo.appointments(appointment_id),
        CONSTRAINT FK_encounters_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_encounters_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_encounters_doctor FOREIGN KEY (attending_doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_encounters_room FOREIGN KEY (room_id) REFERENCES dbo.rooms(room_id),
        CONSTRAINT FK_encounters_signer FOREIGN KEY (signed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_encounters_canceller FOREIGN KEY (cancelled_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_encounters_creator FOREIGN KEY (created_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_encounters_code UNIQUE (encounter_code),
        CONSTRAINT CK_encounters_source CHECK (encounter_source IN ('APPOINTMENT','WALK_IN')),
        CONSTRAINT CK_encounters_source_appointment CHECK
            ((encounter_source = 'APPOINTMENT' AND appointment_id IS NOT NULL)
             OR (encounter_source = 'WALK_IN' AND appointment_id IS NULL)),
        CONSTRAINT CK_encounters_status CHECK (status IN ('WAITING','IN_PROGRESS','COMPLETED','SIGNED','CANCELLED')),
        CONSTRAINT CK_encounters_started CHECK
            ((status IN ('IN_PROGRESS','COMPLETED','SIGNED') AND started_at_utc IS NOT NULL)
             OR status NOT IN ('IN_PROGRESS','COMPLETED','SIGNED')),
        CONSTRAINT CK_encounters_completed CHECK
            ((status IN ('COMPLETED','SIGNED') AND completed_at_utc IS NOT NULL)
             OR status NOT IN ('COMPLETED','SIGNED')),
        CONSTRAINT CK_encounters_signed CHECK
            ((status = 'SIGNED' AND signed_at_utc IS NOT NULL AND signed_by_user_id IS NOT NULL)
             OR status <> 'SIGNED'),
        CONSTRAINT CK_encounters_cancelled CHECK
            ((status = 'CANCELLED' AND cancelled_at_utc IS NOT NULL
              AND cancelled_by_user_id IS NOT NULL AND cancellation_reason IS NOT NULL)
             OR status <> 'CANCELLED'),
        CONSTRAINT CK_encounters_occupies_appointment CHECK
            ((status = 'CANCELLED' AND occupies_appointment = 0)
             OR (status <> 'CANCELLED' AND occupies_appointment = 1)),
        CONSTRAINT CK_encounters_in_progress CHECK
            ((status = 'IN_PROGRESS' AND is_in_progress = 1)
             OR (status <> 'IN_PROGRESS' AND is_in_progress = 0))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.encounters') AND name = N'UX_encounters_active_appointment')
    CREATE UNIQUE INDEX UX_encounters_active_appointment ON dbo.encounters(appointment_id)
    WHERE appointment_id IS NOT NULL AND occupies_appointment = 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.encounters') AND name = N'IX_encounters_patient')
    CREATE INDEX IX_encounters_patient ON dbo.encounters(patient_id, arrived_at_utc DESC)
    INCLUDE (encounter_code, branch_id, attending_doctor_id, status);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.encounters') AND name = N'UX_encounters_doctor_in_progress')
    CREATE UNIQUE INDEX UX_encounters_doctor_in_progress ON dbo.encounters(attending_doctor_id)
    WHERE is_in_progress = 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.encounters') AND name = N'UX_encounters_room_in_progress')
    CREATE UNIQUE INDEX UX_encounters_room_in_progress ON dbo.encounters(room_id)
    WHERE is_in_progress = 1 AND room_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.encounter_staff_assignments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.encounter_staff_assignments
    (
        encounter_staff_assignment_id bigint IDENTITY(1,1) NOT NULL,
        encounter_id       bigint NOT NULL,
        employee_id        bigint NOT NULL,
        assignment_role    varchar(30) NOT NULL,
        assigned_at_utc    datetime2(3) NOT NULL CONSTRAINT DF_encounter_staff_assigned DEFAULT SYSUTCDATETIME(),
        ended_at_utc       datetime2(3) NULL,
        active_marker      AS (CASE WHEN ended_at_utc IS NULL THEN CONVERT(tinyint, 1) END) PERSISTED,
        CONSTRAINT PK_encounter_staff_assignments PRIMARY KEY CLUSTERED (encounter_staff_assignment_id),
        CONSTRAINT FK_encounter_staff_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_encounter_staff_employee FOREIGN KEY (employee_id) REFERENCES dbo.employees(employee_id),
        CONSTRAINT CK_encounter_staff_role CHECK (assignment_role IN ('ATTENDING_DOCTOR','NURSE','ASSISTANT','TECHNICIAN')),
        CONSTRAINT CK_encounter_staff_time CHECK (ended_at_utc IS NULL OR ended_at_utc >= assigned_at_utc)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.encounter_staff_assignments') AND name = N'UX_encounter_staff_active')
    CREATE UNIQUE INDEX UX_encounter_staff_active
    ON dbo.encounter_staff_assignments(encounter_id, employee_id, assignment_role)
    WHERE ended_at_utc IS NULL;
GO

IF OBJECT_ID(N'dbo.queue_tickets', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.queue_tickets
    (
        queue_ticket_id     bigint IDENTITY(1,1) NOT NULL,
        queue_session_id    bigint NOT NULL,
        encounter_id        bigint NOT NULL,
        queue_number        int NOT NULL,
        display_number      varchar(20) NOT NULL,
        priority_level      tinyint NOT NULL CONSTRAINT DF_queue_tickets_priority DEFAULT (0),
        status              varchar(20) NOT NULL CONSTRAINT DF_queue_tickets_status DEFAULT ('WAITING'),
        issued_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_queue_tickets_issued DEFAULT SYSUTCDATETIME(),
        called_at_utc       datetime2(3) NULL,
        service_started_at_utc datetime2(3) NULL,
        completed_at_utc    datetime2(3) NULL,
        called_by_user_id   bigint NULL,
        notes               nvarchar(500) NULL,
        row_ver             rowversion NOT NULL,
        CONSTRAINT PK_queue_tickets PRIMARY KEY CLUSTERED (queue_ticket_id),
        CONSTRAINT FK_queue_tickets_session FOREIGN KEY (queue_session_id) REFERENCES dbo.queue_sessions(queue_session_id),
        CONSTRAINT FK_queue_tickets_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_queue_tickets_caller FOREIGN KEY (called_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_queue_tickets_number UNIQUE (queue_session_id, queue_number),
        CONSTRAINT UQ_queue_tickets_encounter UNIQUE (encounter_id),
        CONSTRAINT CK_queue_tickets_priority CHECK (priority_level BETWEEN 0 AND 9),
        CONSTRAINT CK_queue_tickets_status CHECK (status IN ('WAITING','CALLED','SERVING','COMPLETED','SKIPPED','CANCELLED'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.queue_tickets') AND name = N'IX_queue_tickets_next')
    CREATE INDEX IX_queue_tickets_next
    ON dbo.queue_tickets(queue_session_id, status, priority_level DESC, issued_at_utc, queue_number)
    INCLUDE (encounter_id, display_number);
GO

/*=============================================================================
  6. HỒ SƠ KHÁM, CHỈ SỐ SINH TỒN, CHẨN ĐOÁN VÀ KẾT QUẢ DỊCH VỤ
=============================================================================*/

IF OBJECT_ID(N'dbo.encounter_vital_signs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.encounter_vital_signs
    (
        vital_sign_id         bigint IDENTITY(1,1) NOT NULL,
        encounter_id          bigint NOT NULL,
        measured_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_vitals_measured DEFAULT SYSUTCDATETIME(),
        temperature_c         decimal(4,1) NULL,
        pulse_bpm             smallint NULL,
        respiratory_rate_bpm  smallint NULL,
        systolic_bp_mmhg      smallint NULL,
        diastolic_bp_mmhg     smallint NULL,
        spo2_percent          decimal(5,2) NULL,
        height_cm             decimal(6,2) NULL,
        weight_kg             decimal(6,2) NULL,
        bmi                   AS
            (CASE WHEN height_cm > 0 AND weight_kg IS NOT NULL
                  THEN CONVERT(decimal(6,2), weight_kg / POWER(height_cm / CONVERT(decimal(12,4),100), 2)) END) PERSISTED,
        pain_score            tinyint NULL,
        notes                 nvarchar(500) NULL,
        measured_by_user_id   bigint NOT NULL,
        created_at_utc        datetime2(3) NOT NULL CONSTRAINT DF_vitals_created DEFAULT SYSUTCDATETIME(),
        row_ver               rowversion NOT NULL,
        CONSTRAINT PK_encounter_vital_signs PRIMARY KEY CLUSTERED (vital_sign_id),
        CONSTRAINT FK_vitals_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_vitals_user FOREIGN KEY (measured_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_vitals_temperature CHECK (temperature_c IS NULL OR temperature_c BETWEEN 25 AND 45),
        CONSTRAINT CK_vitals_pulse CHECK (pulse_bpm IS NULL OR pulse_bpm BETWEEN 10 AND 300),
        CONSTRAINT CK_vitals_respiration CHECK (respiratory_rate_bpm IS NULL OR respiratory_rate_bpm BETWEEN 1 AND 100),
        CONSTRAINT CK_vitals_systolic CHECK (systolic_bp_mmhg IS NULL OR systolic_bp_mmhg BETWEEN 30 AND 300),
        CONSTRAINT CK_vitals_diastolic CHECK (diastolic_bp_mmhg IS NULL OR diastolic_bp_mmhg BETWEEN 20 AND 200),
        CONSTRAINT CK_vitals_bp_order CHECK
            (systolic_bp_mmhg IS NULL OR diastolic_bp_mmhg IS NULL OR systolic_bp_mmhg > diastolic_bp_mmhg),
        CONSTRAINT CK_vitals_spo2 CHECK (spo2_percent IS NULL OR spo2_percent BETWEEN 0 AND 100),
        CONSTRAINT CK_vitals_height CHECK (height_cm IS NULL OR height_cm BETWEEN 20 AND 300),
        CONSTRAINT CK_vitals_weight CHECK (weight_kg IS NULL OR weight_kg BETWEEN 0.2 AND 500),
        CONSTRAINT CK_vitals_pain CHECK (pain_score IS NULL OR pain_score BETWEEN 0 AND 10)
    );
END;
GO

IF OBJECT_ID(N'dbo.diagnosis_catalog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.diagnosis_catalog
    (
        diagnosis_catalog_id bigint IDENTITY(1,1) NOT NULL,
        coding_system        varchar(20) NOT NULL CONSTRAINT DF_diagnosis_system DEFAULT ('ICD10'),
        diagnosis_code       varchar(30) NOT NULL,
        diagnosis_name       nvarchar(500) NOT NULL,
        is_active            bit NOT NULL CONSTRAINT DF_diagnosis_active DEFAULT (1),
        CONSTRAINT PK_diagnosis_catalog PRIMARY KEY CLUSTERED (diagnosis_catalog_id),
        CONSTRAINT UQ_diagnosis_catalog UNIQUE (coding_system, diagnosis_code)
    );
END;
GO

IF OBJECT_ID(N'dbo.encounter_diagnoses', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.encounter_diagnoses
    (
        encounter_diagnosis_id bigint IDENTITY(1,1) NOT NULL,
        encounter_id           bigint NOT NULL,
        diagnosis_catalog_id   bigint NULL,
        diagnosis_code_snapshot varchar(30) NOT NULL,
        diagnosis_name_snapshot nvarchar(500) NOT NULL,
        diagnosis_type         varchar(20) NOT NULL CONSTRAINT DF_encounter_diagnosis_type DEFAULT ('FINAL'),
        is_primary             bit NOT NULL CONSTRAINT DF_encounter_diagnosis_primary DEFAULT (0),
        notes                  nvarchar(1000) NULL,
        recorded_by_user_id    bigint NOT NULL,
        created_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_encounter_diagnosis_created DEFAULT SYSUTCDATETIME(),
        primary_encounter_id   AS (CASE WHEN is_primary = 1 THEN encounter_id END) PERSISTED,
        row_ver                rowversion NOT NULL,
        CONSTRAINT PK_encounter_diagnoses PRIMARY KEY CLUSTERED (encounter_diagnosis_id),
        CONSTRAINT FK_encounter_diagnosis_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_encounter_diagnosis_catalog FOREIGN KEY (diagnosis_catalog_id)
            REFERENCES dbo.diagnosis_catalog(diagnosis_catalog_id),
        CONSTRAINT FK_encounter_diagnosis_user FOREIGN KEY (recorded_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_encounter_diagnosis_code UNIQUE (encounter_id, diagnosis_code_snapshot),
        CONSTRAINT CK_encounter_diagnosis_type CHECK (diagnosis_type IN ('PROVISIONAL','DIFFERENTIAL','FINAL'))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.encounter_diagnoses') AND name = N'UX_encounter_primary_diagnosis')
    CREATE UNIQUE INDEX UX_encounter_primary_diagnosis
    ON dbo.encounter_diagnoses(encounter_id) WHERE is_primary = 1;
GO

IF OBJECT_ID(N'dbo.encounter_services', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.encounter_services
    (
        encounter_service_id bigint IDENTITY(1,1) NOT NULL,
        encounter_id         bigint NOT NULL,
        service_id           bigint NOT NULL,
        service_code_snapshot varchar(30) NOT NULL,
        service_name_snapshot nvarchar(200) NOT NULL,
        service_type_snapshot varchar(30) NOT NULL,
        quantity             decimal(12,3) NOT NULL CONSTRAINT DF_encounter_services_quantity DEFAULT (1),
        unit_price_snapshot  decimal(19,2) NOT NULL,
        discount_amount      decimal(19,2) NOT NULL CONSTRAINT DF_encounter_services_discount DEFAULT (0),
        status               varchar(20) NOT NULL CONSTRAINT DF_encounter_services_status DEFAULT ('ORDERED'),
        ordered_by_user_id   bigint NOT NULL,
        ordered_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_encounter_services_ordered DEFAULT SYSUTCDATETIME(),
        performed_by_user_id bigint NULL,
        performed_at_utc     datetime2(3) NULL,
        cancelled_by_user_id bigint NULL,
        cancelled_at_utc     datetime2(3) NULL,
        cancellation_reason  nvarchar(500) NULL,
        notes                nvarchar(1000) NULL,
        line_amount          AS CONVERT(decimal(19,2), ROUND(quantity * unit_price_snapshot - discount_amount, 2)) PERSISTED,
        row_ver              rowversion NOT NULL,
        CONSTRAINT PK_encounter_services PRIMARY KEY CLUSTERED (encounter_service_id),
        CONSTRAINT FK_encounter_services_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_encounter_services_service FOREIGN KEY (service_id) REFERENCES dbo.services(service_id),
        CONSTRAINT FK_encounter_services_orderer FOREIGN KEY (ordered_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_encounter_services_performer FOREIGN KEY (performed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_encounter_services_canceller FOREIGN KEY (cancelled_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_encounter_services_quantity CHECK (quantity > 0),
        CONSTRAINT CK_encounter_services_price CHECK (unit_price_snapshot >= 0),
        CONSTRAINT CK_encounter_services_discount CHECK
            (discount_amount >= 0 AND discount_amount <= quantity * unit_price_snapshot),
        CONSTRAINT CK_encounter_services_status CHECK (status IN ('ORDERED','IN_PROGRESS','COMPLETED','CANCELLED')),
        CONSTRAINT CK_encounter_services_performed CHECK
            ((status = 'COMPLETED' AND performed_by_user_id IS NOT NULL AND performed_at_utc IS NOT NULL)
             OR status <> 'COMPLETED'),
        CONSTRAINT CK_encounter_services_cancelled CHECK
            ((status = 'CANCELLED' AND cancelled_by_user_id IS NOT NULL
              AND cancelled_at_utc IS NOT NULL AND cancellation_reason IS NOT NULL)
             OR status <> 'CANCELLED')
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.encounter_services') AND name = N'IX_encounter_services_encounter')
    CREATE INDEX IX_encounter_services_encounter ON dbo.encounter_services(encounter_id, status)
    INCLUDE (service_id, quantity, unit_price_snapshot, discount_amount, line_amount);
GO

IF OBJECT_ID(N'dbo.service_results', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_results
    (
        service_result_id      bigint IDENTITY(1,1) NOT NULL,
        encounter_service_id   bigint NOT NULL,
        result_version         int NOT NULL CONSTRAINT DF_service_results_version DEFAULT (1),
        status                 varchar(20) NOT NULL CONSTRAINT DF_service_results_status DEFAULT ('DRAFT'),
        summary                nvarchar(max) NULL,
        conclusion             nvarchar(max) NULL,
        result_json            nvarchar(max) NULL,
        supersedes_result_id   bigint NULL,
        entered_by_user_id     bigint NOT NULL,
        entered_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_service_results_entered DEFAULT SYSUTCDATETIME(),
        verified_by_user_id    bigint NULL,
        verified_at_utc        datetime2(3) NULL,
        row_ver                rowversion NOT NULL,
        CONSTRAINT PK_service_results PRIMARY KEY CLUSTERED (service_result_id),
        CONSTRAINT FK_service_results_service FOREIGN KEY (encounter_service_id)
            REFERENCES dbo.encounter_services(encounter_service_id),
        CONSTRAINT FK_service_results_previous FOREIGN KEY (supersedes_result_id)
            REFERENCES dbo.service_results(service_result_id),
        CONSTRAINT FK_service_results_enterer FOREIGN KEY (entered_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_service_results_verifier FOREIGN KEY (verified_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_service_results_version UNIQUE (encounter_service_id, result_version),
        CONSTRAINT CK_service_results_version CHECK (result_version > 0),
        CONSTRAINT CK_service_results_status CHECK (status IN ('DRAFT','PRELIMINARY','FINAL','AMENDED','CANCELLED')),
        CONSTRAINT CK_service_results_json CHECK (result_json IS NULL OR ISJSON(result_json) = 1),
        CONSTRAINT CK_service_results_verified CHECK
            ((status IN ('FINAL','AMENDED') AND verified_by_user_id IS NOT NULL AND verified_at_utc IS NOT NULL)
             OR status NOT IN ('FINAL','AMENDED')),
        CONSTRAINT CK_service_results_supersession CHECK
            ((result_version = 1 AND supersedes_result_id IS NULL)
             OR (result_version > 1 AND supersedes_result_id IS NOT NULL))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.service_results') AND name = N'UX_service_results_supersedes')
    CREATE UNIQUE INDEX UX_service_results_supersedes ON dbo.service_results(supersedes_result_id)
    WHERE supersedes_result_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.service_result_values', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.service_result_values
    (
        service_result_value_id bigint IDENTITY(1,1) NOT NULL,
        service_result_id       bigint NOT NULL,
        item_code               varchar(50) NOT NULL,
        item_name               nvarchar(200) NOT NULL,
        value_text              nvarchar(1000) NULL,
        value_numeric           decimal(20,6) NULL,
        unit                    nvarchar(50) NULL,
        reference_range        nvarchar(200) NULL,
        abnormal_flag          varchar(10) NULL,
        display_order          int NOT NULL CONSTRAINT DF_result_values_order DEFAULT (0),
        CONSTRAINT PK_service_result_values PRIMARY KEY CLUSTERED (service_result_value_id),
        CONSTRAINT FK_result_values_result FOREIGN KEY (service_result_id) REFERENCES dbo.service_results(service_result_id),
        CONSTRAINT UQ_result_values_item UNIQUE (service_result_id, item_code),
        CONSTRAINT CK_result_values_value CHECK (value_text IS NOT NULL OR value_numeric IS NOT NULL),
        CONSTRAINT CK_result_values_flag CHECK
            (abnormal_flag IS NULL OR abnormal_flag IN ('L','H','LL','HH','A','N'))
    );
END;
GO

IF OBJECT_ID(N'dbo.medical_attachments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.medical_attachments
    (
        medical_attachment_id bigint IDENTITY(1,1) NOT NULL,
        encounter_id          bigint NOT NULL,
        encounter_service_id  bigint NULL,
        file_name              nvarchar(255) NOT NULL,
        storage_key           nvarchar(500) NOT NULL,
        mime_type             varchar(100) NOT NULL,
        byte_size             bigint NOT NULL,
        sha256_hash           binary(32) NOT NULL,
        category              varchar(30) NOT NULL,
        description           nvarchar(500) NULL,
        uploaded_by_user_id   bigint NOT NULL,
        uploaded_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_attachments_uploaded DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_medical_attachments PRIMARY KEY CLUSTERED (medical_attachment_id),
        CONSTRAINT FK_attachments_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_attachments_service FOREIGN KEY (encounter_service_id)
            REFERENCES dbo.encounter_services(encounter_service_id),
        CONSTRAINT FK_attachments_user FOREIGN KEY (uploaded_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_attachments_storage UNIQUE (storage_key),
        CONSTRAINT CK_attachments_size CHECK (byte_size > 0),
        CONSTRAINT CK_attachments_category CHECK
            (category IN ('LAB','IMAGING','PRESCRIPTION','CONSENT','REFERRAL','OTHER'))
    );
END;
GO

IF OBJECT_ID(N'dbo.encounter_signatures', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.encounter_signatures
    (
        encounter_signature_id bigint IDENTITY(1,1) NOT NULL,
        encounter_id           bigint NOT NULL,
        canonical_schema_version varchar(30) NOT NULL,
        payload_sha256         binary(32) NOT NULL,
        signature_type         varchar(30) NOT NULL,
        signature_algorithm    varchar(50) NULL,
        signature_value        varbinary(max) NULL,
        certificate_thumbprint varchar(128) NULL,
        signed_by_user_id      bigint NOT NULL,
        signed_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_encounter_signatures_signed DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_encounter_signatures PRIMARY KEY CLUSTERED (encounter_signature_id),
        CONSTRAINT FK_encounter_signatures_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_encounter_signatures_user FOREIGN KEY (signed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_encounter_signatures_encounter UNIQUE (encounter_id),
        CONSTRAINT CK_encounter_signatures_type CHECK
            (signature_type IN ('HASH_ATTESTATION','DIGITAL_SIGNATURE')),
        CONSTRAINT CK_encounter_signatures_material CHECK
            ((signature_type = 'HASH_ATTESTATION' AND signature_value IS NULL)
             OR (signature_type = 'DIGITAL_SIGNATURE' AND signature_value IS NOT NULL
                 AND signature_algorithm IS NOT NULL AND certificate_thumbprint IS NOT NULL))
    );
END;
GO

IF OBJECT_ID(N'dbo.encounter_amendments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.encounter_amendments
    (
        encounter_amendment_id bigint IDENTITY(1,1) NOT NULL,
        encounter_id           bigint NOT NULL,
        amendment_no           int NOT NULL,
        reason                 nvarchar(1000) NOT NULL,
        amendment_content      nvarchar(max) NOT NULL,
        previous_chain_hash    binary(32) NOT NULL,
        amendment_hash         binary(32) NOT NULL,
        signature_algorithm    varchar(50) NULL,
        signature_value        varbinary(max) NULL,
        amended_by_user_id     bigint NOT NULL,
        amended_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_amendments_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_encounter_amendments PRIMARY KEY CLUSTERED (encounter_amendment_id),
        CONSTRAINT FK_amendments_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_amendments_user FOREIGN KEY (amended_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_amendments_number UNIQUE (encounter_id, amendment_no),
        CONSTRAINT CK_amendments_number CHECK (amendment_no > 0)
    );
END;
GO

/*=============================================================================
  7. THUỐC, LÔ, TỒN KHO, ĐƠN THUỐC VÀ CẤP PHÁT
=============================================================================*/

IF OBJECT_ID(N'dbo.suppliers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.suppliers
    (
        supplier_id       bigint IDENTITY(1,1) NOT NULL,
        supplier_code     varchar(30) NOT NULL,
        supplier_name     nvarchar(200) NOT NULL,
        tax_code          varchar(30) NULL,
        phone             varchar(20) NULL,
        email             varchar(254) NULL,
        address_line      nvarchar(300) NULL,
        is_active         bit NOT NULL CONSTRAINT DF_suppliers_active DEFAULT (1),
        CONSTRAINT PK_suppliers PRIMARY KEY CLUSTERED (supplier_id),
        CONSTRAINT UQ_suppliers_code UNIQUE (supplier_code)
    );
END;
GO

IF OBJECT_ID(N'dbo.inventory_locations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.inventory_locations
    (
        inventory_location_id bigint IDENTITY(1,1) NOT NULL,
        branch_id             bigint NOT NULL,
        location_code         varchar(30) NOT NULL,
        location_name         nvarchar(150) NOT NULL,
        location_type         varchar(20) NOT NULL,
        is_dispensing         bit NOT NULL CONSTRAINT DF_locations_dispensing DEFAULT (0),
        is_active             bit NOT NULL CONSTRAINT DF_locations_active DEFAULT (1),
        CONSTRAINT PK_inventory_locations PRIMARY KEY CLUSTERED (inventory_location_id),
        CONSTRAINT FK_locations_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT UQ_locations_branch_code UNIQUE (branch_id, location_code),
        CONSTRAINT CK_locations_type CHECK (location_type IN ('WAREHOUSE','PHARMACY','CABINET','QUARANTINE'))
    );
END;
GO

IF OBJECT_ID(N'dbo.medicines', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.medicines
    (
        medicine_id        bigint IDENTITY(1,1) NOT NULL,
        medicine_code      varchar(30) NOT NULL,
        generic_name       nvarchar(250) NOT NULL,
        brand_name         nvarchar(250) NULL,
        active_ingredient  nvarchar(500) NOT NULL,
        strength           nvarchar(100) NOT NULL,
        dosage_form        nvarchar(100) NOT NULL,
        route              nvarchar(100) NOT NULL,
        base_unit          nvarchar(30) NOT NULL,
        registration_no   nvarchar(100) NULL,
        manufacturer      nvarchar(200) NULL,
        requires_prescription bit NOT NULL CONSTRAINT DF_medicines_rx DEFAULT (1),
        controlled_level  varchar(20) NOT NULL CONSTRAINT DF_medicines_controlled DEFAULT ('NONE'),
        reorder_level     decimal(18,3) NOT NULL CONSTRAINT DF_medicines_reorder DEFAULT (0),
        current_sale_price decimal(19,2) NOT NULL CONSTRAINT DF_medicines_price DEFAULT (0),
        is_active         bit NOT NULL CONSTRAINT DF_medicines_active DEFAULT (1),
        created_at_utc    datetime2(3) NOT NULL CONSTRAINT DF_medicines_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc    datetime2(3) NOT NULL CONSTRAINT DF_medicines_updated DEFAULT SYSUTCDATETIME(),
        row_ver           rowversion NOT NULL,
        CONSTRAINT PK_medicines PRIMARY KEY CLUSTERED (medicine_id),
        CONSTRAINT UQ_medicines_code UNIQUE (medicine_code),
        CONSTRAINT CK_medicines_controlled CHECK (controlled_level IN ('NONE','PSYCHOTROPIC','NARCOTIC','OTHER')),
        CONSTRAINT CK_medicines_reorder CHECK (reorder_level >= 0),
        CONSTRAINT CK_medicines_price CHECK (current_sale_price >= 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.medicine_batches', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.medicine_batches
    (
        medicine_batch_id bigint IDENTITY(1,1) NOT NULL,
        medicine_id       bigint NOT NULL,
        supplier_id       bigint NULL,
        batch_number      nvarchar(80) NOT NULL,
        manufactured_date date NULL,
        expiry_date       date NOT NULL,
        purchase_price    decimal(19,2) NOT NULL,
        sale_price        decimal(19,2) NOT NULL,
        status            varchar(20) NOT NULL CONSTRAINT DF_batches_status DEFAULT ('AVAILABLE'),
        received_at_utc   datetime2(3) NOT NULL CONSTRAINT DF_batches_received DEFAULT SYSUTCDATETIME(),
        created_at_utc    datetime2(3) NOT NULL CONSTRAINT DF_batches_created DEFAULT SYSUTCDATETIME(),
        row_ver           rowversion NOT NULL,
        CONSTRAINT PK_medicine_batches PRIMARY KEY CLUSTERED (medicine_batch_id),
        CONSTRAINT FK_batches_medicine FOREIGN KEY (medicine_id) REFERENCES dbo.medicines(medicine_id),
        CONSTRAINT FK_batches_supplier FOREIGN KEY (supplier_id) REFERENCES dbo.suppliers(supplier_id),
        CONSTRAINT UQ_batches_medicine_number UNIQUE (medicine_id, batch_number),
        CONSTRAINT CK_batches_dates CHECK (manufactured_date IS NULL OR expiry_date > manufactured_date),
        CONSTRAINT CK_batches_prices CHECK (purchase_price >= 0 AND sale_price >= 0),
        CONSTRAINT CK_batches_status CHECK (status IN ('AVAILABLE','QUARANTINED','RECALLED','EXPIRED','DEPLETED'))
    );
END;
GO

IF OBJECT_ID(N'dbo.inventory_balances', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.inventory_balances
    (
        inventory_location_id bigint NOT NULL,
        medicine_batch_id     bigint NOT NULL,
        quantity_on_hand      decimal(18,3) NOT NULL CONSTRAINT DF_balances_on_hand DEFAULT (0),
        quantity_reserved     decimal(18,3) NOT NULL CONSTRAINT DF_balances_reserved DEFAULT (0),
        available_quantity    AS CONVERT(decimal(18,3), quantity_on_hand - quantity_reserved) PERSISTED,
        last_movement_at_utc  datetime2(3) NULL,
        row_ver               rowversion NOT NULL,
        CONSTRAINT PK_inventory_balances PRIMARY KEY CLUSTERED (inventory_location_id, medicine_batch_id),
        CONSTRAINT FK_balances_location FOREIGN KEY (inventory_location_id)
            REFERENCES dbo.inventory_locations(inventory_location_id),
        CONSTRAINT FK_balances_batch FOREIGN KEY (medicine_batch_id) REFERENCES dbo.medicine_batches(medicine_batch_id),
        CONSTRAINT CK_balances_quantities CHECK
            (quantity_on_hand >= 0 AND quantity_reserved >= 0 AND quantity_reserved <= quantity_on_hand)
    );
END;
GO

IF OBJECT_ID(N'dbo.prescriptions', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.prescriptions
    (
        prescription_id      bigint IDENTITY(1,1) NOT NULL,
        prescription_code    varchar(40) NOT NULL,
        encounter_id         bigint NOT NULL,
        patient_id           bigint NOT NULL,
        doctor_id            bigint NOT NULL,
        branch_id            bigint NOT NULL,
        status               varchar(30) NOT NULL CONSTRAINT DF_prescriptions_status DEFAULT ('DRAFT'),
        issued_at_utc        datetime2(3) NULL,
        valid_until          date NULL,
        clinical_notes       nvarchar(1000) NULL,
        general_instructions nvarchar(1000) NULL,
        cancelled_at_utc     datetime2(3) NULL,
        cancelled_by_user_id bigint NULL,
        cancellation_reason  nvarchar(500) NULL,
        created_by_user_id   bigint NOT NULL,
        created_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_prescriptions_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_prescriptions_updated DEFAULT SYSUTCDATETIME(),
        row_ver              rowversion NOT NULL,
        CONSTRAINT PK_prescriptions PRIMARY KEY CLUSTERED (prescription_id),
        CONSTRAINT FK_prescriptions_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_prescriptions_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_prescriptions_doctor FOREIGN KEY (doctor_id) REFERENCES dbo.doctors(doctor_id),
        CONSTRAINT FK_prescriptions_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_prescriptions_canceller FOREIGN KEY (cancelled_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_prescriptions_creator FOREIGN KEY (created_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_prescriptions_code UNIQUE (prescription_code),
        CONSTRAINT CK_prescriptions_status CHECK (status IN
            ('DRAFT','ISSUED','PARTIALLY_DISPENSED','DISPENSED','CANCELLED','EXPIRED')),
        CONSTRAINT CK_prescriptions_issued CHECK
            ((status IN ('ISSUED','PARTIALLY_DISPENSED','DISPENSED')
              AND issued_at_utc IS NOT NULL AND valid_until IS NOT NULL)
             OR status NOT IN ('ISSUED','PARTIALLY_DISPENSED','DISPENSED')),
        CONSTRAINT CK_prescriptions_cancelled CHECK
            ((status = 'CANCELLED' AND cancelled_at_utc IS NOT NULL
              AND cancelled_by_user_id IS NOT NULL AND cancellation_reason IS NOT NULL)
             OR status <> 'CANCELLED')
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.prescriptions') AND name = N'IX_prescriptions_encounter')
    CREATE INDEX IX_prescriptions_encounter ON dbo.prescriptions(encounter_id, status);
GO

IF OBJECT_ID(N'dbo.prescription_items', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.prescription_items
    (
        prescription_item_id bigint IDENTITY(1,1) NOT NULL,
        prescription_id      bigint NOT NULL,
        medicine_id          bigint NOT NULL,
        medicine_name_snapshot nvarchar(300) NOT NULL,
        strength_snapshot    nvarchar(100) NOT NULL,
        dosage_form_snapshot nvarchar(100) NOT NULL,
        route_snapshot       nvarchar(100) NOT NULL,
        prescribed_quantity decimal(18,3) NOT NULL,
        dispensed_quantity  decimal(18,3) NOT NULL CONSTRAINT DF_prescription_items_dispensed DEFAULT (0),
        dose                 nvarchar(100) NOT NULL,
        frequency            nvarchar(100) NOT NULL,
        duration_days        smallint NULL,
        timing_instruction   nvarchar(200) NULL,
        usage_instruction    nvarchar(1000) NOT NULL,
        sort_order           smallint NOT NULL CONSTRAINT DF_prescription_items_order DEFAULT (0),
        row_ver              rowversion NOT NULL,
        CONSTRAINT PK_prescription_items PRIMARY KEY CLUSTERED (prescription_item_id),
        CONSTRAINT FK_prescription_items_prescription FOREIGN KEY (prescription_id)
            REFERENCES dbo.prescriptions(prescription_id),
        CONSTRAINT FK_prescription_items_medicine FOREIGN KEY (medicine_id) REFERENCES dbo.medicines(medicine_id),
        CONSTRAINT CK_prescription_items_quantity CHECK
            (prescribed_quantity > 0 AND dispensed_quantity >= 0 AND dispensed_quantity <= prescribed_quantity),
        CONSTRAINT CK_prescription_items_duration CHECK (duration_days IS NULL OR duration_days > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.dispensations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.dispensations
    (
        dispensation_id       bigint IDENTITY(1,1) NOT NULL,
        dispensation_code     varchar(40) NOT NULL,
        prescription_id       bigint NOT NULL,
        branch_id             bigint NOT NULL,
        inventory_location_id bigint NOT NULL,
        status                varchar(20) NOT NULL CONSTRAINT DF_dispensations_status DEFAULT ('DRAFT'),
        dispensed_by_user_id  bigint NOT NULL,
        opened_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_dispensations_opened DEFAULT SYSUTCDATETIME(),
        completed_at_utc      datetime2(3) NULL,
        cancelled_at_utc      datetime2(3) NULL,
        notes                 nvarchar(1000) NULL,
        row_ver               rowversion NOT NULL,
        CONSTRAINT PK_dispensations PRIMARY KEY CLUSTERED (dispensation_id),
        CONSTRAINT FK_dispensations_prescription FOREIGN KEY (prescription_id) REFERENCES dbo.prescriptions(prescription_id),
        CONSTRAINT FK_dispensations_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_dispensations_location FOREIGN KEY (inventory_location_id)
            REFERENCES dbo.inventory_locations(inventory_location_id),
        CONSTRAINT FK_dispensations_user FOREIGN KEY (dispensed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_dispensations_code UNIQUE (dispensation_code),
        CONSTRAINT CK_dispensations_status CHECK (status IN ('DRAFT','COMPLETED','CANCELLED')),
        CONSTRAINT CK_dispensations_completed CHECK
            ((status = 'COMPLETED' AND completed_at_utc IS NOT NULL) OR status <> 'COMPLETED'),
        CONSTRAINT CK_dispensations_cancelled CHECK
            ((status = 'CANCELLED' AND cancelled_at_utc IS NOT NULL) OR status <> 'CANCELLED')
    );
END;
GO


IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.dispensations') AND name = N'UX_dispensations_open_prescription')
    CREATE UNIQUE INDEX UX_dispensations_open_prescription
    ON dbo.dispensations(prescription_id) WHERE status = 'DRAFT';
GO

IF OBJECT_ID(N'dbo.dispensation_items', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.dispensation_items
    (
        dispensation_item_id  bigint IDENTITY(1,1) NOT NULL,
        dispensation_id       bigint NOT NULL,
        prescription_item_id  bigint NOT NULL,
        medicine_batch_id     bigint NOT NULL,
        quantity              decimal(18,3) NOT NULL,
        unit_price_snapshot   decimal(19,2) NOT NULL,
        line_amount           AS CONVERT(decimal(19,2), ROUND(quantity * unit_price_snapshot, 2)) PERSISTED,
        dispensed_at_utc      datetime2(3) NOT NULL CONSTRAINT DF_dispensation_items_time DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_dispensation_items PRIMARY KEY CLUSTERED (dispensation_item_id),
        CONSTRAINT FK_dispensation_items_dispensation FOREIGN KEY (dispensation_id)
            REFERENCES dbo.dispensations(dispensation_id),
        CONSTRAINT FK_dispensation_items_rx_item FOREIGN KEY (prescription_item_id)
            REFERENCES dbo.prescription_items(prescription_item_id),
        CONSTRAINT FK_dispensation_items_batch FOREIGN KEY (medicine_batch_id)
            REFERENCES dbo.medicine_batches(medicine_batch_id),
        CONSTRAINT CK_dispensation_items_quantity CHECK (quantity > 0),
        CONSTRAINT CK_dispensation_items_price CHECK (unit_price_snapshot >= 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.inventory_movements', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.inventory_movements
    (
        inventory_movement_id bigint IDENTITY(1,1) NOT NULL,
        inventory_location_id bigint NOT NULL,
        medicine_batch_id     bigint NOT NULL,
        movement_type         varchar(30) NOT NULL,
        quantity_delta        decimal(18,3) NOT NULL,
        balance_after         decimal(18,3) NOT NULL,
        unit_cost             decimal(19,2) NULL,
        reference_type        varchar(30) NULL,
        reference_id          bigint NULL,
        dispensation_item_id  bigint NULL,
        reverses_movement_id  bigint NULL,
        reason                nvarchar(500) NULL,
        performed_by_user_id  bigint NOT NULL,
        occurred_at_utc       datetime2(3) NOT NULL CONSTRAINT DF_inventory_movements_time DEFAULT SYSUTCDATETIME(),
        request_id            uniqueidentifier NULL,
        CONSTRAINT PK_inventory_movements PRIMARY KEY CLUSTERED (inventory_movement_id),
        CONSTRAINT FK_inventory_movements_location FOREIGN KEY (inventory_location_id)
            REFERENCES dbo.inventory_locations(inventory_location_id),
        CONSTRAINT FK_inventory_movements_batch FOREIGN KEY (medicine_batch_id)
            REFERENCES dbo.medicine_batches(medicine_batch_id),
        CONSTRAINT FK_inventory_movements_item FOREIGN KEY (dispensation_item_id)
            REFERENCES dbo.dispensation_items(dispensation_item_id),
        CONSTRAINT FK_inventory_movements_reversed FOREIGN KEY (reverses_movement_id)
            REFERENCES dbo.inventory_movements(inventory_movement_id),
        CONSTRAINT FK_inventory_movements_user FOREIGN KEY (performed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT CK_inventory_movements_type CHECK (movement_type IN
            ('RECEIPT','DISPENSE','RETURN_TO_STOCK','TRANSFER_IN','TRANSFER_OUT','ADJUST_IN','ADJUST_OUT','EXPIRE_OUT','REVERSAL')),
        CONSTRAINT CK_inventory_movements_delta CHECK (quantity_delta <> 0),
        CONSTRAINT CK_inventory_movements_balance CHECK (balance_after >= 0),
        CONSTRAINT CK_inventory_movements_reversal CHECK
            ((movement_type = 'REVERSAL' AND reverses_movement_id IS NOT NULL)
             OR (movement_type <> 'REVERSAL' AND reverses_movement_id IS NULL))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.inventory_movements') AND name = N'UX_inventory_movements_reversal')
    CREATE UNIQUE INDEX UX_inventory_movements_reversal ON dbo.inventory_movements(reverses_movement_id)
    WHERE reverses_movement_id IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.inventory_movements') AND name = N'IX_inventory_movements_ledger')
    CREATE INDEX IX_inventory_movements_ledger
    ON dbo.inventory_movements(inventory_location_id, medicine_batch_id, occurred_at_utc, inventory_movement_id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.inventory_movements') AND name = N'UX_inventory_movements_dispense_item')
    CREATE UNIQUE INDEX UX_inventory_movements_dispense_item
    ON dbo.inventory_movements(dispensation_item_id)
    WHERE dispensation_item_id IS NOT NULL AND movement_type = 'DISPENSE';
GO

IF OBJECT_ID(N'dbo.dispensation_item_reversals', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.dispensation_item_reversals
    (
        dispensation_item_reversal_id bigint IDENTITY(1,1) NOT NULL,
        dispensation_item_id          bigint NOT NULL,
        reversal_movement_id          bigint NOT NULL,
        return_location_id            bigint NOT NULL,
        disposition                   varchar(20) NOT NULL,
        reason                        nvarchar(500) NOT NULL,
        reversed_by_user_id           bigint NOT NULL,
        reversed_at_utc               datetime2(3) NOT NULL CONSTRAINT DF_dispense_reversals_time DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_dispensation_item_reversals PRIMARY KEY CLUSTERED (dispensation_item_reversal_id),
        CONSTRAINT FK_dispense_reversals_item FOREIGN KEY (dispensation_item_id)
            REFERENCES dbo.dispensation_items(dispensation_item_id),
        CONSTRAINT FK_dispense_reversals_movement FOREIGN KEY (reversal_movement_id)
            REFERENCES dbo.inventory_movements(inventory_movement_id),
        CONSTRAINT FK_dispense_reversals_location FOREIGN KEY (return_location_id)
            REFERENCES dbo.inventory_locations(inventory_location_id),
        CONSTRAINT FK_dispense_reversals_user FOREIGN KEY (reversed_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_dispense_reversals_item UNIQUE (dispensation_item_id),
        CONSTRAINT UQ_dispense_reversals_movement UNIQUE (reversal_movement_id),
        CONSTRAINT CK_dispense_reversals_disposition CHECK (disposition IN ('SELLABLE','QUARANTINE','DESTROY'))
    );
END;
GO

/*=============================================================================
  8. HÓA ĐƠN, THANH TOÁN VÀ HOÀN TIỀN
=============================================================================*/

IF OBJECT_ID(N'dbo.document_sequences', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.document_sequences
    (
        branch_id          bigint NOT NULL,
        document_type      varchar(20) NOT NULL,
        sequence_date      date NOT NULL,
        current_value      int NOT NULL,
        updated_at_utc     datetime2(3) NOT NULL CONSTRAINT DF_document_sequences_updated DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_document_sequences PRIMARY KEY CLUSTERED (branch_id, document_type, sequence_date),
        CONSTRAINT FK_document_sequences_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT CK_document_sequences_type CHECK (document_type IN ('PATIENT','APPOINTMENT','ENCOUNTER','PRESCRIPTION','DISPENSATION','INVOICE','PAYMENT','REFUND')),
        CONSTRAINT CK_document_sequences_value CHECK (current_value > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.invoices', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.invoices
    (
        invoice_id              bigint IDENTITY(1,1) NOT NULL,
        invoice_number          varchar(40) NOT NULL,
        encounter_id            bigint NOT NULL,
        patient_id              bigint NOT NULL,
        branch_id               bigint NOT NULL,
        supersedes_invoice_id   bigint NULL,
        status                  varchar(20) NOT NULL CONSTRAINT DF_invoices_status DEFAULT ('DRAFT'),
        subtotal_amount         decimal(19,2) NOT NULL CONSTRAINT DF_invoices_subtotal DEFAULT (0),
        discount_amount         decimal(19,2) NOT NULL CONSTRAINT DF_invoices_discount DEFAULT (0),
        tax_amount              decimal(19,2) NOT NULL CONSTRAINT DF_invoices_tax DEFAULT (0),
        total_amount            AS CONVERT(decimal(19,2), subtotal_amount - discount_amount + tax_amount) PERSISTED,
        insurance_amount        decimal(19,2) NOT NULL CONSTRAINT DF_invoices_insurance DEFAULT (0),
        patient_payable_amount  AS CONVERT(decimal(19,2), subtotal_amount - discount_amount + tax_amount - insurance_amount) PERSISTED,
        issued_at_utc           datetime2(3) NULL,
        due_at_utc              datetime2(3) NULL,
        voided_at_utc           datetime2(3) NULL,
        voided_by_user_id       bigint NULL,
        void_reason             nvarchar(500) NULL,
        created_by_user_id      bigint NOT NULL,
        created_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_invoices_created DEFAULT SYSUTCDATETIME(),
        updated_at_utc          datetime2(3) NOT NULL CONSTRAINT DF_invoices_updated DEFAULT SYSUTCDATETIME(),
        is_active_invoice       bit NOT NULL CONSTRAINT DF_invoices_active DEFAULT (1),
        row_ver                 rowversion NOT NULL,
        CONSTRAINT PK_invoices PRIMARY KEY CLUSTERED (invoice_id),
        CONSTRAINT FK_invoices_encounter FOREIGN KEY (encounter_id) REFERENCES dbo.encounters(encounter_id),
        CONSTRAINT FK_invoices_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_invoices_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_invoices_superseded FOREIGN KEY (supersedes_invoice_id) REFERENCES dbo.invoices(invoice_id),
        CONSTRAINT FK_invoices_voider FOREIGN KEY (voided_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_invoices_creator FOREIGN KEY (created_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_invoices_number UNIQUE (invoice_number),
        CONSTRAINT CK_invoices_status CHECK (status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','VOID')),
        CONSTRAINT CK_invoices_amounts CHECK
            (subtotal_amount >= 0 AND discount_amount >= 0 AND discount_amount <= subtotal_amount
             AND tax_amount >= 0 AND insurance_amount >= 0
             AND insurance_amount <= subtotal_amount - discount_amount + tax_amount),
        CONSTRAINT CK_invoices_issued CHECK
            ((status IN ('ISSUED','PARTIALLY_PAID','PAID') AND issued_at_utc IS NOT NULL)
             OR status NOT IN ('ISSUED','PARTIALLY_PAID','PAID')),
        CONSTRAINT CK_invoices_void CHECK
            ((status = 'VOID' AND voided_at_utc IS NOT NULL AND voided_by_user_id IS NOT NULL AND void_reason IS NOT NULL)
             OR status <> 'VOID'),
        CONSTRAINT CK_invoices_active CHECK
            ((status = 'VOID' AND is_active_invoice = 0)
             OR (status <> 'VOID' AND is_active_invoice = 1))
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.invoices') AND name = N'UX_invoices_active_encounter')
    CREATE UNIQUE INDEX UX_invoices_active_encounter ON dbo.invoices(encounter_id)
    WHERE is_active_invoice = 1;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.invoices') AND name = N'UX_invoices_supersedes')
    CREATE UNIQUE INDEX UX_invoices_supersedes ON dbo.invoices(supersedes_invoice_id)
    WHERE supersedes_invoice_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.invoice_items', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.invoice_items
    (
        invoice_item_id        bigint IDENTITY(1,1) NOT NULL,
        invoice_id             bigint NOT NULL,
        item_type              varchar(20) NOT NULL,
        encounter_service_id   bigint NULL,
        dispensation_item_id   bigint NULL,
        item_code_snapshot     varchar(40) NULL,
        item_name_snapshot     nvarchar(300) NOT NULL,
        quantity               decimal(18,3) NOT NULL,
        unit_price             decimal(19,2) NOT NULL,
        discount_amount        decimal(19,2) NOT NULL CONSTRAINT DF_invoice_items_discount DEFAULT (0),
        tax_rate_percent       decimal(7,4) NOT NULL CONSTRAINT DF_invoice_items_tax DEFAULT (0),
        line_subtotal          AS CONVERT(decimal(19,2), ROUND(quantity * unit_price, 2)) PERSISTED,
        line_tax               AS CONVERT(decimal(19,2), ROUND((quantity * unit_price - discount_amount) * tax_rate_percent / 100, 2)) PERSISTED,
        line_total             AS CONVERT(decimal(19,2), ROUND(quantity * unit_price - discount_amount
                                      + (quantity * unit_price - discount_amount) * tax_rate_percent / 100, 2)) PERSISTED,
        created_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_invoice_items_created DEFAULT SYSUTCDATETIME(),
        row_ver                rowversion NOT NULL,
        CONSTRAINT PK_invoice_items PRIMARY KEY CLUSTERED (invoice_item_id),
        CONSTRAINT FK_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES dbo.invoices(invoice_id),
        CONSTRAINT FK_invoice_items_service FOREIGN KEY (encounter_service_id)
            REFERENCES dbo.encounter_services(encounter_service_id),
        CONSTRAINT FK_invoice_items_dispense FOREIGN KEY (dispensation_item_id)
            REFERENCES dbo.dispensation_items(dispensation_item_id),
        CONSTRAINT CK_invoice_items_type CHECK (item_type IN ('SERVICE','MEDICINE','OTHER')),
        CONSTRAINT CK_invoice_items_source CHECK
        (
            (item_type = 'SERVICE' AND encounter_service_id IS NOT NULL AND dispensation_item_id IS NULL)
            OR (item_type = 'MEDICINE' AND encounter_service_id IS NULL AND dispensation_item_id IS NOT NULL)
            OR (item_type = 'OTHER' AND encounter_service_id IS NULL AND dispensation_item_id IS NULL)
        ),
        CONSTRAINT CK_invoice_items_quantity CHECK (quantity > 0),
        CONSTRAINT CK_invoice_items_price CHECK (unit_price >= 0),
        CONSTRAINT CK_invoice_items_discount CHECK
            (discount_amount >= 0 AND discount_amount <= quantity * unit_price),
        CONSTRAINT CK_invoice_items_tax CHECK (tax_rate_percent BETWEEN 0 AND 100)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.invoice_items') AND name = N'UX_invoice_items_service')
    CREATE UNIQUE INDEX UX_invoice_items_service ON dbo.invoice_items(invoice_id, encounter_service_id)
    WHERE encounter_service_id IS NOT NULL;
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.invoice_items') AND name = N'UX_invoice_items_dispense')
    CREATE UNIQUE INDEX UX_invoice_items_dispense ON dbo.invoice_items(invoice_id, dispensation_item_id)
    WHERE dispensation_item_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.payments', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.payments
    (
        payment_id             bigint IDENTITY(1,1) NOT NULL,
        payment_number         varchar(40) NOT NULL,
        branch_id              bigint NOT NULL,
        patient_id             bigint NOT NULL,
        amount                 decimal(19,2) NOT NULL,
        payment_method         varchar(20) NOT NULL,
        status                 varchar(20) NOT NULL CONSTRAINT DF_payments_status DEFAULT ('SUCCEEDED'),
        external_transaction_id nvarchar(150) NULL,
        idempotency_key        uniqueidentifier NOT NULL,
        paid_at_utc            datetime2(3) NOT NULL CONSTRAINT DF_payments_paid DEFAULT SYSUTCDATETIME(),
        received_by_user_id    bigint NOT NULL,
        notes                  nvarchar(500) NULL,
        created_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_payments_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_payments PRIMARY KEY CLUSTERED (payment_id),
        CONSTRAINT FK_payments_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT FK_payments_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT FK_payments_user FOREIGN KEY (received_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_payments_number UNIQUE (payment_number),
        CONSTRAINT UQ_payments_idempotency UNIQUE (idempotency_key),
        CONSTRAINT CK_payments_amount CHECK (amount > 0),
        CONSTRAINT CK_payments_method CHECK (payment_method IN ('CASH','CARD','BANK_TRANSFER','EWALLET','OTHER')),
        CONSTRAINT CK_payments_status CHECK (status IN ('PENDING','SUCCEEDED','FAILED','VOIDED')),
        CONSTRAINT CK_payments_external CHECK
            (payment_method = 'CASH' OR external_transaction_id IS NOT NULL)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.payments') AND name = N'UX_payments_external')
    CREATE UNIQUE INDEX UX_payments_external
    ON dbo.payments(payment_method, external_transaction_id)
    WHERE external_transaction_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.payment_allocations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.payment_allocations
    (
        payment_allocation_id bigint IDENTITY(1,1) NOT NULL,
        payment_id            bigint NOT NULL,
        invoice_id            bigint NOT NULL,
        allocated_amount      decimal(19,2) NOT NULL,
        allocated_at_utc      datetime2(3) NOT NULL CONSTRAINT DF_payment_allocations_time DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_payment_allocations PRIMARY KEY CLUSTERED (payment_allocation_id),
        CONSTRAINT FK_payment_allocations_payment FOREIGN KEY (payment_id) REFERENCES dbo.payments(payment_id),
        CONSTRAINT FK_payment_allocations_invoice FOREIGN KEY (invoice_id) REFERENCES dbo.invoices(invoice_id),
        CONSTRAINT UQ_payment_allocations UNIQUE (payment_id, invoice_id),
        CONSTRAINT CK_payment_allocations_amount CHECK (allocated_amount > 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.payment_refunds', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.payment_refunds
    (
        payment_refund_id      bigint IDENTITY(1,1) NOT NULL,
        refund_number          varchar(40) NOT NULL,
        payment_id             bigint NOT NULL,
        amount                 decimal(19,2) NOT NULL,
        refund_method          varchar(20) NOT NULL,
        status                 varchar(20) NOT NULL CONSTRAINT DF_refunds_status DEFAULT ('SUCCEEDED'),
        external_transaction_id nvarchar(150) NULL,
        idempotency_key        uniqueidentifier NOT NULL,
        reason                 nvarchar(500) NOT NULL,
        refunded_by_user_id    bigint NOT NULL,
        refunded_at_utc        datetime2(3) NOT NULL CONSTRAINT DF_refunds_time DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_payment_refunds PRIMARY KEY CLUSTERED (payment_refund_id),
        CONSTRAINT FK_refunds_payment FOREIGN KEY (payment_id) REFERENCES dbo.payments(payment_id),
        CONSTRAINT FK_refunds_user FOREIGN KEY (refunded_by_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_refunds_number UNIQUE (refund_number),
        CONSTRAINT UQ_refunds_idempotency UNIQUE (idempotency_key),
        CONSTRAINT CK_refunds_amount CHECK (amount > 0),
        CONSTRAINT CK_refunds_method CHECK (refund_method IN ('CASH','CARD','BANK_TRANSFER','EWALLET','OTHER')),
        CONSTRAINT CK_refunds_status CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
        CONSTRAINT CK_refunds_external CHECK
            (refund_method = 'CASH' OR external_transaction_id IS NOT NULL)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.payment_refunds') AND name = N'UX_refunds_external')
    CREATE UNIQUE INDEX UX_refunds_external
    ON dbo.payment_refunds(refund_method, external_transaction_id)
    WHERE external_transaction_id IS NOT NULL;
GO

IF OBJECT_ID(N'dbo.refund_allocations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.refund_allocations
    (
        refund_allocation_id  bigint IDENTITY(1,1) NOT NULL,
        payment_refund_id     bigint NOT NULL,
        payment_allocation_id bigint NOT NULL,
        refunded_amount       decimal(19,2) NOT NULL,
        created_at_utc        datetime2(3) NOT NULL CONSTRAINT DF_refund_allocations_time DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_refund_allocations PRIMARY KEY CLUSTERED (refund_allocation_id),
        CONSTRAINT FK_refund_allocations_refund FOREIGN KEY (payment_refund_id)
            REFERENCES dbo.payment_refunds(payment_refund_id),
        CONSTRAINT FK_refund_allocations_allocation FOREIGN KEY (payment_allocation_id)
            REFERENCES dbo.payment_allocations(payment_allocation_id),
        CONSTRAINT UQ_refund_allocations UNIQUE (payment_refund_id, payment_allocation_id),
        CONSTRAINT CK_refund_allocations_amount CHECK (refunded_amount > 0)
    );
END;
GO

/*=============================================================================
  9. THÔNG BÁO, OUTBOX, IDEMPOTENCY VÀ AUDIT APPEND-ONLY
=============================================================================*/

IF OBJECT_ID(N'dbo.notifications', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.notifications
    (
        notification_id    bigint IDENTITY(1,1) NOT NULL,
        user_id             bigint NULL,
        patient_id          bigint NULL,
        channel             varchar(20) NOT NULL,
        template_code       varchar(50) NOT NULL,
        recipient           nvarchar(254) NOT NULL,
        subject             nvarchar(300) NULL,
        body                nvarchar(max) NOT NULL,
        payload_json        nvarchar(max) NULL,
        status              varchar(20) NOT NULL CONSTRAINT DF_notifications_status DEFAULT ('PENDING'),
        scheduled_at_utc    datetime2(3) NOT NULL CONSTRAINT DF_notifications_scheduled DEFAULT SYSUTCDATETIME(),
        sent_at_utc         datetime2(3) NULL,
        retry_count         smallint NOT NULL CONSTRAINT DF_notifications_retry DEFAULT (0),
        last_error          nvarchar(1000) NULL,
        created_at_utc      datetime2(3) NOT NULL CONSTRAINT DF_notifications_created DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_notifications PRIMARY KEY CLUSTERED (notification_id),
        CONSTRAINT FK_notifications_user FOREIGN KEY (user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_notifications_patient FOREIGN KEY (patient_id) REFERENCES dbo.patients(patient_id),
        CONSTRAINT CK_notifications_channel CHECK (channel IN ('EMAIL','SMS','PUSH','IN_APP')),
        CONSTRAINT CK_notifications_status CHECK (status IN ('PENDING','PROCESSING','SENT','FAILED','CANCELLED')),
        CONSTRAINT CK_notifications_payload CHECK (payload_json IS NULL OR ISJSON(payload_json) = 1),
        CONSTRAINT CK_notifications_retry CHECK (retry_count >= 0)
    );
END;
GO

IF OBJECT_ID(N'dbo.outbox_events', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.outbox_events
    (
        outbox_event_id     bigint IDENTITY(1,1) NOT NULL,
        aggregate_type      varchar(50) NOT NULL,
        aggregate_id        varchar(100) NOT NULL,
        event_type          varchar(100) NOT NULL,
        payload_json        nvarchar(max) NOT NULL,
        occurred_at_utc     datetime2(3) NOT NULL CONSTRAINT DF_outbox_occurred DEFAULT SYSUTCDATETIME(),
        published_at_utc    datetime2(3) NULL,
        attempt_count       smallint NOT NULL CONSTRAINT DF_outbox_attempt DEFAULT (0),
        last_error          nvarchar(1000) NULL,
        CONSTRAINT PK_outbox_events PRIMARY KEY CLUSTERED (outbox_event_id),
        CONSTRAINT CK_outbox_json CHECK (ISJSON(payload_json) = 1),
        CONSTRAINT CK_outbox_attempt CHECK (attempt_count >= 0)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.outbox_events') AND name = N'IX_outbox_pending')
    CREATE INDEX IX_outbox_pending ON dbo.outbox_events(published_at_utc, outbox_event_id)
    INCLUDE (event_type, attempt_count) WHERE published_at_utc IS NULL;
GO

IF OBJECT_ID(N'dbo.idempotency_requests', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.idempotency_requests
    (
        idempotency_request_id bigint IDENTITY(1,1) NOT NULL,
        actor_user_id          bigint NOT NULL,
        operation_code         varchar(80) NOT NULL,
        idempotency_key        uniqueidentifier NOT NULL,
        request_hash           binary(32) NOT NULL,
        status                 varchar(20) NOT NULL CONSTRAINT DF_idempotency_status DEFAULT ('PROCESSING'),
        resource_type          varchar(50) NULL,
        resource_id            bigint NULL,
        response_json          nvarchar(max) NULL,
        created_at_utc         datetime2(3) NOT NULL CONSTRAINT DF_idempotency_created DEFAULT SYSUTCDATETIME(),
        completed_at_utc       datetime2(3) NULL,
        expires_at_utc         datetime2(3) NOT NULL,
        CONSTRAINT PK_idempotency_requests PRIMARY KEY CLUSTERED (idempotency_request_id),
        CONSTRAINT FK_idempotency_actor FOREIGN KEY (actor_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT UQ_idempotency_scope UNIQUE (actor_user_id, operation_code, idempotency_key),
        CONSTRAINT CK_idempotency_status CHECK (status IN ('PROCESSING','COMPLETED','FAILED')),
        CONSTRAINT CK_idempotency_json CHECK (response_json IS NULL OR ISJSON(response_json) = 1),
        CONSTRAINT CK_idempotency_expiry CHECK (expires_at_utc > created_at_utc)
    );
END;
GO

IF OBJECT_ID(N'dbo.audit_logs', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.audit_logs
    (
        audit_log_id       bigint IDENTITY(1,1) NOT NULL,
        actor_user_id      bigint NULL,
        branch_id          bigint NULL,
        action_code        varchar(100) NOT NULL,
        entity_type        varchar(50) NOT NULL,
        entity_id          varchar(100) NOT NULL,
        old_values_json    nvarchar(max) NULL,
        new_values_json    nvarchar(max) NULL,
        request_id         uniqueidentifier NULL,
        ip_address         varchar(45) NULL,
        user_agent         nvarchar(500) NULL,
        occurred_at_utc    datetime2(3) NOT NULL CONSTRAINT DF_audit_logs_time DEFAULT SYSUTCDATETIME(),
        previous_hash      binary(32) NULL,
        record_hash        binary(32) NULL,
        CONSTRAINT PK_audit_logs PRIMARY KEY CLUSTERED (audit_log_id),
        CONSTRAINT FK_audit_logs_actor FOREIGN KEY (actor_user_id) REFERENCES dbo.users(user_id),
        CONSTRAINT FK_audit_logs_branch FOREIGN KEY (branch_id) REFERENCES dbo.branches(branch_id),
        CONSTRAINT CK_audit_old_json CHECK (old_values_json IS NULL OR ISJSON(old_values_json) = 1),
        CONSTRAINT CK_audit_new_json CHECK (new_values_json IS NULL OR ISJSON(new_values_json) = 1)
    );
END;
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.audit_logs') AND name = N'IX_audit_entity')
    CREATE INDEX IX_audit_entity ON dbo.audit_logs(entity_type, entity_id, occurred_at_utc DESC);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID(N'dbo.audit_logs') AND name = N'IX_audit_actor')
    CREATE INDEX IX_audit_actor ON dbo.audit_logs(actor_user_id, occurred_at_utc DESC);
GO

/*=============================================================================
  10. DỮ LIỆU NỀN TỐI THIỂU (IDEMPOTENT)
=============================================================================*/

INSERT dbo.branches
    (branch_code, branch_name, address_line, province, timezone_name,
     booking_horizon_days, online_hold_minutes, cancellation_deadline_minutes)
SELECT 'MAIN', N'Phòng khám chính', N'Cập nhật địa chỉ phòng khám', N'TP. Hồ Chí Minh',
       N'SE Asia Standard Time', 60, 15, 120
WHERE NOT EXISTS (SELECT 1 FROM dbo.branches WHERE branch_code = 'MAIN');

INSERT dbo.specialties (specialty_code, specialty_name, description, is_active)
SELECT 'GENERAL', N'Đa khoa', N'Khám và tư vấn sức khỏe tổng quát', 1
WHERE NOT EXISTS (SELECT 1 FROM dbo.specialties WHERE specialty_code = 'GENERAL');

INSERT dbo.service_categories (category_code, category_name, display_order, is_active)
SELECT v.category_code, v.category_name, v.display_order, 1
FROM (VALUES
    ('CONSULTATION', N'Khám bệnh', 10),
    ('LAB',          N'Xét nghiệm', 20),
    ('IMAGING',      N'Chẩn đoán hình ảnh', 30),
    ('PROCEDURE',    N'Thủ thuật', 40),
    ('OTHER',        N'Dịch vụ khác', 90)
) v(category_code, category_name, display_order)
WHERE NOT EXISTS
    (SELECT 1 FROM dbo.service_categories x WHERE x.category_code = v.category_code);

INSERT dbo.services
    (service_category_id, specialty_id, service_code, service_name, service_type,
     default_duration_min, current_price, requires_doctor, is_active)
SELECT sc.service_category_id, sp.specialty_id, 'CONSULT_GENERAL',
       N'Khám đa khoa', 'CONSULTATION', 30, 200000, 1, 1
FROM dbo.service_categories sc
CROSS JOIN dbo.specialties sp
WHERE sc.category_code = 'CONSULTATION'
  AND sp.specialty_code = 'GENERAL'
  AND NOT EXISTS (SELECT 1 FROM dbo.services WHERE service_code = 'CONSULT_GENERAL');

INSERT dbo.rooms (branch_id, room_code, room_name, room_type, capacity, is_active)
SELECT b.branch_id, v.room_code, v.room_name, v.room_type, 1, 1
FROM dbo.branches b
CROSS JOIN (VALUES
    ('CONSULT-01', N'Phòng khám 01', 'CONSULTATION'),
    ('PHARMACY-01', N'Nhà thuốc', 'PHARMACY')
) v(room_code, room_name, room_type)
WHERE b.branch_code = 'MAIN'
  AND NOT EXISTS
      (SELECT 1 FROM dbo.rooms r WHERE r.branch_id = b.branch_id AND r.room_code = v.room_code);

INSERT dbo.inventory_locations
    (branch_id, location_code, location_name, location_type, is_dispensing, is_active)
SELECT b.branch_id, v.location_code, v.location_name, v.location_type, v.is_dispensing, 1
FROM dbo.branches b
CROSS JOIN (VALUES
    ('MAIN-WH', N'Kho chính', 'WAREHOUSE', CONVERT(bit,0)),
    ('MAIN-PH', N'Quầy cấp thuốc', 'PHARMACY', CONVERT(bit,1)),
    ('MAIN-QA', N'Kho cách ly', 'QUARANTINE', CONVERT(bit,0))
) v(location_code, location_name, location_type, is_dispensing)
WHERE b.branch_code = 'MAIN'
  AND NOT EXISTS
      (SELECT 1 FROM dbo.inventory_locations l
       WHERE l.branch_id = b.branch_id AND l.location_code = v.location_code);
GO

INSERT dbo.roles (role_code, role_name, description, is_system, is_active)
SELECT v.role_code, v.role_name, v.description, 1, 1
FROM (VALUES
    ('ADMIN',        N'Quản trị viên',       N'Quản trị toàn hệ thống'),
    ('MANAGER',      N'Quản lý phòng khám',  N'Quản lý vận hành theo chi nhánh'),
    ('DOCTOR',       N'Bác sĩ',              N'Khám, kê đơn và ký hồ sơ'),
    ('NURSE',        N'Điều dưỡng',           N'Tiếp nhận, sinh hiệu và hỗ trợ khám'),
    ('RECEPTIONIST', N'Lễ tân',               N'Lịch hẹn, tiếp nhận và hàng đợi'),
    ('PHARMACIST',   N'Dược sĩ',              N'Quản lý và cấp phát thuốc'),
    ('CASHIER',      N'Thu ngân',             N'Hóa đơn và thanh toán'),
    ('LAB_TECH',     N'Kỹ thuật viên',        N'Thực hiện dịch vụ và nhập kết quả'),
    ('PATIENT',      N'Bệnh nhân',            N'Đặt và quản lý lịch cá nhân')
) v(role_code, role_name, description)
WHERE NOT EXISTS (SELECT 1 FROM dbo.roles r WHERE r.role_code = v.role_code);

INSERT dbo.permissions (permission_code, permission_name, module_code, description)
SELECT v.permission_code, v.permission_name, v.module_code, v.description
FROM (VALUES
    ('USERS_MANAGE',          N'Quản lý tài khoản',             'SECURITY',   N'Tạo, khóa và cập nhật tài khoản'),
    ('ROLES_MANAGE',          N'Quản lý phân quyền',             'SECURITY',   N'Gán và thu hồi vai trò'),
    ('MASTER_DATA_MANAGE',    N'Quản lý danh mục',               'MASTER',     N'Chi nhánh, phòng, dịch vụ và thuốc'),
    ('PATIENTS_MANAGE',       N'Quản lý bệnh nhân',              'PATIENT',    N'Tạo và cập nhật hồ sơ hành chính'),
    ('PATIENTS_VIEW',         N'Xem hồ sơ bệnh nhân',            'PATIENT',    N'Tra cứu bệnh nhân theo phạm vi'),
    ('APPOINTMENTS_SELF',     N'Đặt lịch cá nhân',               'SCHEDULE',   N'Đặt/hủy lịch cho hồ sơ được ủy quyền'),
    ('APPOINTMENTS_MANAGE',   N'Quản lý lịch hẹn',               'SCHEDULE',   N'Đặt, xác nhận, đổi và hủy lịch'),
    ('APPOINTMENTS_EXPIRE',   N'Hết hạn giữ chỗ',                'SCHEDULE',   N'Tác vụ nền giải phóng lịch chờ'),
    ('SCHEDULES_MANAGE',      N'Quản lý ca và slot',             'SCHEDULE',   N'Quản lý lịch bác sĩ và sinh slot'),
    ('QUEUE_MANAGE',          N'Quản lý hàng đợi',               'QUEUE',      N'Phát số và gọi bệnh nhân'),
    ('ENCOUNTERS_CREATE',     N'Tạo lượt khám',                  'CLINICAL',   N'Check-in và tiếp nhận walk-in'),
    ('ENCOUNTERS_CLINICAL',   N'Ghi hồ sơ khám',                 'CLINICAL',   N'Sinh hiệu, chẩn đoán, dịch vụ, kết quả'),
    ('ENCOUNTERS_SIGN',       N'Ký hồ sơ khám',                  'CLINICAL',   N'Ký và khóa hồ sơ lâm sàng'),
    ('ENCOUNTERS_AMEND',      N'Bổ sung hồ sơ đã ký',            'CLINICAL',   N'Ghi phụ lục nối chuỗi hash'),
    ('PRESCRIPTIONS_WRITE',   N'Kê đơn thuốc',                   'PHARMACY',   N'Tạo và phát hành đơn'),
    ('PHARMACY_DISPENSE',     N'Cấp phát thuốc',                 'PHARMACY',   N'Cấp thuốc theo đơn và đảo sai sót'),
    ('INVENTORY_MANAGE',      N'Quản lý tồn kho',                'PHARMACY',   N'Nhập, điều chỉnh và chuyển kho'),
    ('BILLING_MANAGE',        N'Quản lý hóa đơn',                'BILLING',    N'Tạo, đồng bộ, phát hành và hủy hóa đơn'),
    ('PAYMENT_COLLECT',       N'Thu tiền',                       'BILLING',    N'Ghi nhận thanh toán'),
    ('PAYMENT_REFUND',        N'Hoàn tiền',                      'BILLING',    N'Hoàn tiền có đối soát'),
    ('REPORTS_VIEW',          N'Xem báo cáo',                    'REPORT',     N'Xem báo cáo vận hành và tài chính'),
    ('AUDIT_VIEW',            N'Xem nhật ký kiểm toán',          'AUDIT',      N'Tra cứu audit log')
) v(permission_code, permission_name, module_code, description)
WHERE NOT EXISTS
    (SELECT 1 FROM dbo.permissions p WHERE p.permission_code = v.permission_code);
GO

-- ADMIN luôn nhận toàn bộ permission hiện hữu; chạy lại file sau khi thêm permission mới.
INSERT dbo.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM dbo.roles r
CROSS JOIN dbo.permissions p
WHERE r.role_code = 'ADMIN'
  AND NOT EXISTS
      (SELECT 1 FROM dbo.role_permissions rp
       WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);

;WITH role_permission_seed AS
(
    SELECT * FROM (VALUES
        ('MANAGER','USERS_MANAGE'), ('MANAGER','MASTER_DATA_MANAGE'),
        ('MANAGER','PATIENTS_MANAGE'), ('MANAGER','PATIENTS_VIEW'),
        ('MANAGER','APPOINTMENTS_MANAGE'), ('MANAGER','SCHEDULES_MANAGE'),
        ('MANAGER','QUEUE_MANAGE'), ('MANAGER','ENCOUNTERS_CREATE'),
        ('MANAGER','BILLING_MANAGE'), ('MANAGER','REPORTS_VIEW'),
        ('DOCTOR','PATIENTS_VIEW'), ('DOCTOR','APPOINTMENTS_MANAGE'),
        ('DOCTOR','QUEUE_MANAGE'), ('DOCTOR','ENCOUNTERS_CLINICAL'),
        ('DOCTOR','ENCOUNTERS_SIGN'), ('DOCTOR','ENCOUNTERS_AMEND'),
        ('DOCTOR','PRESCRIPTIONS_WRITE'),
        ('NURSE','PATIENTS_VIEW'), ('NURSE','QUEUE_MANAGE'),
        ('NURSE','ENCOUNTERS_CREATE'), ('NURSE','ENCOUNTERS_CLINICAL'),
        ('RECEPTIONIST','PATIENTS_MANAGE'), ('RECEPTIONIST','PATIENTS_VIEW'),
        ('RECEPTIONIST','APPOINTMENTS_MANAGE'), ('RECEPTIONIST','QUEUE_MANAGE'),
        ('RECEPTIONIST','ENCOUNTERS_CREATE'),
        ('PHARMACIST','PATIENTS_VIEW'), ('PHARMACIST','PHARMACY_DISPENSE'),
        ('PHARMACIST','INVENTORY_MANAGE'),
        ('CASHIER','PATIENTS_VIEW'), ('CASHIER','BILLING_MANAGE'),
        ('CASHIER','PAYMENT_COLLECT'), ('CASHIER','PAYMENT_REFUND'),
        ('LAB_TECH','PATIENTS_VIEW'), ('LAB_TECH','ENCOUNTERS_CLINICAL'),
        ('PATIENT','APPOINTMENTS_SELF')
    ) v(role_code, permission_code)
)
INSERT dbo.role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role_permission_seed s
JOIN dbo.roles r ON r.role_code = s.role_code
JOIN dbo.permissions p ON p.permission_code = s.permission_code
WHERE NOT EXISTS
    (SELECT 1 FROM dbo.role_permissions rp
     WHERE rp.role_id = r.role_id AND rp.permission_id = p.permission_id);
GO

/*=============================================================================
  11. VIEW VẬN HÀNH VÀ ĐỐI SOÁT
=============================================================================*/

CREATE OR ALTER VIEW dbo.v_available_appointment_slots
AS
SELECT
    s.slot_id,
    s.branch_id,
    b.branch_code,
    b.branch_name,
    s.doctor_id,
    e.full_name AS doctor_name,
    s.room_id,
    r.room_code,
    s.service_date_local,
    s.start_time_local,
    s.end_time_local,
    s.starts_at_utc,
    s.ends_at_utc,
    s.booking_opens_at_utc,
    s.booking_closes_at_utc
FROM dbo.appointment_slots s
JOIN dbo.branches b ON b.branch_id = s.branch_id AND b.is_active = 1
JOIN dbo.doctors d ON d.doctor_id = s.doctor_id AND d.is_active = 1
JOIN dbo.employees e ON e.employee_id = d.employee_id AND e.is_active = 1
JOIN dbo.rooms r ON r.room_id = s.room_id AND r.is_active = 1
WHERE s.status = 'OPEN'
  AND SYSUTCDATETIME() >= s.booking_opens_at_utc
  AND SYSUTCDATETIME() < s.booking_closes_at_utc
  AND NOT EXISTS
      (SELECT 1 FROM dbo.appointments a
       WHERE a.slot_id = s.slot_id AND a.occupies_slot = 1);
GO

CREATE OR ALTER VIEW dbo.v_doctor_daily_schedule
AS
SELECT
    s.branch_id,
    s.service_date_local,
    s.doctor_id,
    e.full_name AS doctor_name,
    s.slot_id,
    s.start_time_local,
    s.end_time_local,
    s.status AS slot_status,
    a.appointment_id,
    a.appointment_code,
    a.patient_id,
    p.patient_code,
    p.full_name AS patient_name,
    a.status AS appointment_status,
    a.booking_channel
FROM dbo.appointment_slots s
JOIN dbo.doctors d ON d.doctor_id = s.doctor_id
JOIN dbo.employees e ON e.employee_id = d.employee_id
LEFT JOIN dbo.appointments a ON a.slot_id = s.slot_id AND a.occupies_slot = 1
LEFT JOIN dbo.patients p ON p.patient_id = a.patient_id;
GO

CREATE OR ALTER VIEW dbo.v_current_queue
AS
SELECT
    qs.branch_id,
    qs.queue_date_local,
    qs.queue_type,
    qt.queue_ticket_id,
    qt.display_number,
    qt.priority_level,
    qt.status,
    qt.issued_at_utc,
    qt.called_at_utc,
    en.encounter_id,
    en.encounter_code,
    en.patient_id,
    p.patient_code,
    p.full_name AS patient_name,
    en.attending_doctor_id,
    emp.full_name AS doctor_name,
    en.room_id
FROM dbo.queue_tickets qt
JOIN dbo.queue_sessions qs ON qs.queue_session_id = qt.queue_session_id
JOIN dbo.encounters en ON en.encounter_id = qt.encounter_id
JOIN dbo.patients p ON p.patient_id = en.patient_id
JOIN dbo.doctors d ON d.doctor_id = en.attending_doctor_id
JOIN dbo.employees emp ON emp.employee_id = d.employee_id
WHERE qs.status = 'OPEN' AND qt.status IN ('WAITING','CALLED','SERVING');
GO

CREATE OR ALTER VIEW dbo.v_patient_encounter_history
AS
SELECT
    en.patient_id,
    p.patient_code,
    en.encounter_id,
    en.encounter_code,
    en.branch_id,
    b.branch_name,
    en.arrived_at_utc,
    en.started_at_utc,
    en.completed_at_utc,
    en.signed_at_utc,
    en.status,
    en.encounter_source,
    en.attending_doctor_id,
    emp.full_name AS doctor_name,
    en.chief_complaint,
    en.clinical_assessment,
    en.treatment_plan
FROM dbo.encounters en
JOIN dbo.patients p ON p.patient_id = en.patient_id
JOIN dbo.branches b ON b.branch_id = en.branch_id
JOIN dbo.doctors d ON d.doctor_id = en.attending_doctor_id
JOIN dbo.employees emp ON emp.employee_id = d.employee_id;
GO

CREATE OR ALTER VIEW dbo.v_prescription_remaining
AS
SELECT
    p.prescription_id,
    p.prescription_code,
    p.status AS prescription_status,
    pi.prescription_item_id,
    pi.medicine_id,
    pi.medicine_name_snapshot,
    pi.prescribed_quantity,
    pi.dispensed_quantity,
    CONVERT(decimal(18,3), pi.prescribed_quantity - pi.dispensed_quantity) AS remaining_quantity
FROM dbo.prescriptions p
JOIN dbo.prescription_items pi ON pi.prescription_id = p.prescription_id;
GO

CREATE OR ALTER VIEW dbo.v_inventory_by_batch
AS
SELECT
    l.branch_id,
    l.inventory_location_id,
    l.location_code,
    b.medicine_batch_id,
    b.batch_number,
    b.expiry_date,
    b.status AS batch_status,
    m.medicine_id,
    m.medicine_code,
    m.generic_name,
    ib.quantity_on_hand,
    ib.quantity_reserved,
    ib.available_quantity,
    ib.last_movement_at_utc
FROM dbo.inventory_balances ib
JOIN dbo.inventory_locations l ON l.inventory_location_id = ib.inventory_location_id
JOIN dbo.medicine_batches b ON b.medicine_batch_id = ib.medicine_batch_id
JOIN dbo.medicines m ON m.medicine_id = b.medicine_id;
GO

CREATE OR ALTER VIEW dbo.v_low_stock
AS
SELECT
    l.branch_id,
    mb.medicine_id,
    m.medicine_code,
    m.generic_name,
    SUM(ib.available_quantity) AS available_quantity,
    m.reorder_level
FROM dbo.inventory_balances ib
JOIN dbo.inventory_locations l ON l.inventory_location_id = ib.inventory_location_id
JOIN dbo.medicine_batches mb ON mb.medicine_batch_id = ib.medicine_batch_id
JOIN dbo.medicines m ON m.medicine_id = mb.medicine_id
WHERE l.location_type <> 'QUARANTINE'
GROUP BY l.branch_id, mb.medicine_id, m.medicine_code, m.generic_name, m.reorder_level
HAVING SUM(ib.available_quantity) <= m.reorder_level;
GO

CREATE OR ALTER VIEW dbo.v_expiring_medicine_batches
AS
SELECT
    l.branch_id,
    ib.inventory_location_id,
    mb.medicine_batch_id,
    m.medicine_code,
    m.generic_name,
    mb.batch_number,
    mb.expiry_date,
    ib.available_quantity,
    DATEDIFF(DAY, CAST(SYSUTCDATETIME() AS date), mb.expiry_date) AS days_to_expiry
FROM dbo.inventory_balances ib
JOIN dbo.inventory_locations l ON l.inventory_location_id = ib.inventory_location_id
JOIN dbo.medicine_batches mb ON mb.medicine_batch_id = ib.medicine_batch_id
JOIN dbo.medicines m ON m.medicine_id = mb.medicine_id
WHERE ib.quantity_on_hand > 0
  AND mb.expiry_date <= DATEADD(DAY, 90, CAST(SYSUTCDATETIME() AS date));
GO

CREATE OR ALTER VIEW dbo.v_inventory_reconciliation
AS
SELECT
    ib.inventory_location_id,
    ib.medicine_batch_id,
    ib.quantity_on_hand AS balance_quantity,
    COALESCE(SUM(im.quantity_delta), 0) AS ledger_quantity,
    CONVERT(decimal(18,3), ib.quantity_on_hand - COALESCE(SUM(im.quantity_delta), 0)) AS difference
FROM dbo.inventory_balances ib
LEFT JOIN dbo.inventory_movements im
  ON im.inventory_location_id = ib.inventory_location_id
 AND im.medicine_batch_id = ib.medicine_batch_id
GROUP BY ib.inventory_location_id, ib.medicine_batch_id, ib.quantity_on_hand;
GO

CREATE OR ALTER VIEW dbo.v_invoice_balances
AS
SELECT
    i.invoice_id,
    i.invoice_number,
    i.encounter_id,
    i.patient_id,
    i.branch_id,
    i.status,
    i.patient_payable_amount,
    CONVERT(decimal(19,2), COALESCE(pa.paid_amount, 0)) AS paid_amount,
    CONVERT(decimal(19,2), COALESCE(ra.refunded_amount, 0)) AS refunded_amount,
    CONVERT(decimal(19,2), i.patient_payable_amount - COALESCE(pa.paid_amount, 0)
                              + COALESCE(ra.refunded_amount, 0)) AS balance_due
FROM dbo.invoices i
OUTER APPLY
(
    SELECT SUM(x.allocated_amount) AS paid_amount
    FROM dbo.payment_allocations x
    JOIN dbo.payments p ON p.payment_id = x.payment_id AND p.status = 'SUCCEEDED'
    WHERE x.invoice_id = i.invoice_id
) pa
OUTER APPLY
(
    SELECT SUM(x.refunded_amount) AS refunded_amount
    FROM dbo.refund_allocations x
    JOIN dbo.payment_refunds pr ON pr.payment_refund_id = x.payment_refund_id
                                AND pr.status = 'SUCCEEDED'
    JOIN dbo.payment_allocations alloc ON alloc.payment_allocation_id = x.payment_allocation_id
    WHERE alloc.invoice_id = i.invoice_id
) ra;
GO

CREATE OR ALTER VIEW dbo.v_daily_cash_collection
AS
WITH cash_events AS
(
    SELECT
        p.branch_id,
        CAST((p.paid_at_utc AT TIME ZONE 'UTC' AT TIME ZONE b.timezone_name) AS date) AS business_date,
        p.payment_method,
        p.amount AS amount
    FROM dbo.payments p
    JOIN dbo.branches b ON b.branch_id = p.branch_id
    WHERE p.status = 'SUCCEEDED'
    UNION ALL
    SELECT
        p.branch_id,
        CAST((r.refunded_at_utc AT TIME ZONE 'UTC' AT TIME ZONE b.timezone_name) AS date),
        r.refund_method,
        -r.amount
    FROM dbo.payment_refunds r
    JOIN dbo.payments p ON p.payment_id = r.payment_id
    JOIN dbo.branches b ON b.branch_id = p.branch_id
    WHERE r.status = 'SUCCEEDED'
)
SELECT branch_id, business_date, payment_method, SUM(amount) AS net_collected_amount
FROM cash_events
GROUP BY branch_id, business_date, payment_method;
GO

CREATE OR ALTER VIEW dbo.v_doctor_time_off_conflicts
AS
SELECT
    dto.doctor_time_off_id,
    dto.doctor_id,
    dto.branch_id AS time_off_branch_id,
    a.appointment_id,
    a.appointment_code,
    a.branch_id AS appointment_branch_id,
    a.scheduled_start_utc,
    a.scheduled_end_utc,
    a.status
FROM dbo.doctor_time_off dto
JOIN dbo.appointments a
  ON a.doctor_id = dto.doctor_id
 AND (dto.branch_id IS NULL OR dto.branch_id = a.branch_id)
 AND a.occupies_slot = 1
 AND a.scheduled_start_utc < dto.ends_at_utc
 AND a.scheduled_end_utc > dto.starts_at_utc
WHERE dto.status = 'APPROVED';
GO

/*=============================================================================
  12. HELPER PROCEDURES: ACTOR, RBAC, SỐ CHỨNG TỪ, AUDIT
=============================================================================*/

CREATE OR ALTER PROCEDURE dbo.sp_assert_actor
    @actor_user_id bigint
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @context_actor bigint = TRY_CONVERT(bigint, SESSION_CONTEXT(N'actor_user_id'));
    IF @context_actor IS NULL OR @context_actor <> @actor_user_id
        THROW 51000, N'Danh tính phiên làm việc không khớp actor_user_id.', 1;

    IF NOT EXISTS
    (
        SELECT 1 FROM dbo.users
        WHERE user_id = @actor_user_id
          AND status = 'ACTIVE'
          AND deleted_at_utc IS NULL
          AND (locked_until_utc IS NULL OR locked_until_utc <= SYSUTCDATETIME())
    )
        THROW 51001, N'Tài khoản không hoạt động hoặc đang bị khóa.', 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_assert_permission
    @actor_user_id bigint,
    @permission_code varchar(80),
    @branch_id bigint = NULL
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.sp_assert_actor @actor_user_id = @actor_user_id;

    IF NOT EXISTS
    (
        SELECT 1
        FROM dbo.user_roles ur
        JOIN dbo.roles r ON r.role_id = ur.role_id AND r.is_active = 1
        LEFT JOIN dbo.role_permissions rp ON rp.role_id = r.role_id
        LEFT JOIN dbo.permissions p ON p.permission_id = rp.permission_id
        WHERE ur.user_id = @actor_user_id
          AND ur.is_active = 1
          AND ur.valid_from_utc <= SYSUTCDATETIME()
          AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc > SYSUTCDATETIME())
          AND (ur.branch_id IS NULL OR ur.branch_id = @branch_id)
          AND (r.role_code = 'ADMIN' OR p.permission_code = @permission_code)
    )
        THROW 51002, N'Người dùng không có quyền thực hiện thao tác trong phạm vi này.', 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_write_audit
    @actor_user_id bigint = NULL,
    @branch_id bigint = NULL,
    @action_code varchar(100),
    @entity_type varchar(50),
    @entity_id varchar(100),
    @old_values_json nvarchar(max) = NULL,
    @new_values_json nvarchar(max) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF @old_values_json IS NOT NULL AND ISJSON(@old_values_json) <> 1
        THROW 51003, N'old_values_json không phải JSON hợp lệ.', 1;
    IF @new_values_json IS NOT NULL AND ISJSON(@new_values_json) <> 1
        THROW 51004, N'new_values_json không phải JSON hợp lệ.', 1;

    DECLARE @request_id uniqueidentifier = TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'request_id'));
    DECLARE @previous_hash binary(32);
    SELECT TOP (1) @previous_hash = record_hash
    FROM dbo.audit_logs WITH (UPDLOCK, HOLDLOCK)
    ORDER BY audit_log_id DESC;

    DECLARE @occurred_at_utc datetime2(3) = SYSUTCDATETIME();
    DECLARE @material nvarchar(max) = CONCAT(
        COALESCE(CONVERT(varchar(20), @actor_user_id), ''), '|',
        COALESCE(CONVERT(varchar(20), @branch_id), ''), '|', @action_code, '|',
        @entity_type, '|', @entity_id, '|', COALESCE(@old_values_json, ''), '|',
        COALESCE(@new_values_json, ''), '|', CONVERT(varchar(33), @occurred_at_utc, 126), '|',
        COALESCE(CONVERT(varchar(64), @previous_hash, 2), ''));
    DECLARE @record_hash binary(32) = HASHBYTES('SHA2_256', @material);

    INSERT dbo.audit_logs
        (actor_user_id, branch_id, action_code, entity_type, entity_id,
         old_values_json, new_values_json, request_id, occurred_at_utc,
         previous_hash, record_hash)
    VALUES
        (@actor_user_id, @branch_id, @action_code, @entity_type, @entity_id,
         @old_values_json, @new_values_json, @request_id, @occurred_at_utc,
         @previous_hash, @record_hash);
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_next_document_number
    @branch_id bigint,
    @document_type varchar(20),
    @sequence_date date,
    @prefix varchar(10),
    @document_number varchar(40) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;

    IF @@TRANCOUNT = 0
        THROW 51005, N'sp_next_document_number phải chạy trong transaction của nghiệp vụ.', 1;

    DECLARE @lock_result int;
    DECLARE @resource nvarchar(255) = CONCAT(N'doc-seq:', @branch_id, N':', @document_type, N':', CONVERT(char(8), @sequence_date, 112));
    EXEC @lock_result = sys.sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 10000;
    IF @lock_result < 0
        THROW 51006, N'Không thể khóa bộ đếm số chứng từ.', 1;

    DECLARE @next_value int;
    UPDATE dbo.document_sequences WITH (UPDLOCK, HOLDLOCK)
       SET current_value = current_value + 1,
           updated_at_utc = SYSUTCDATETIME(),
           @next_value = current_value + 1
     WHERE branch_id = @branch_id
       AND document_type = @document_type
       AND sequence_date = @sequence_date;

    IF @@ROWCOUNT = 0
    BEGIN
        SET @next_value = 1;
        INSERT dbo.document_sequences
            (branch_id, document_type, sequence_date, current_value)
        VALUES (@branch_id, @document_type, @sequence_date, @next_value);
    END;

    SET @document_number = CONCAT(@prefix, '-', CONVERT(char(8), @sequence_date, 112), '-',
                                  RIGHT(REPLICATE('0', 6) + CONVERT(varchar(10), @next_value), 6));
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_get_branch_business_date
    @branch_id bigint,
    @utc_time datetime2(3) = NULL,
    @business_date date OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @utc_time IS NULL SET @utc_time = SYSUTCDATETIME();

    DECLARE @timezone_name sysname;
    SELECT @timezone_name = timezone_name FROM dbo.branches WHERE branch_id = @branch_id;
    IF @timezone_name IS NULL OR NOT EXISTS
        (SELECT 1 FROM sys.time_zone_info WHERE name = @timezone_name)
        THROW 51007, N'Múi giờ chi nhánh không hợp lệ trên SQL Server.', 1;

    SET @business_date = CAST((@utc_time AT TIME ZONE 'UTC' AT TIME ZONE @timezone_name) AS date);
END;
GO

/*=============================================================================
  13. TRIGGER PHÒNG VỆ THEO TẬP (KHÔNG VIẾT THEO TỪNG ROW)
=============================================================================*/

CREATE OR ALTER TRIGGER dbo.trg_branches_timezone_guard
ON dbo.branches
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        WHERE NOT EXISTS (SELECT 1 FROM sys.time_zone_info z WHERE z.name = i.timezone_name)
    )
        THROW 52000, N'timezone_name không tồn tại trong sys.time_zone_info của SQL Server.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.branch_id = i.branch_id
        WHERE i.timezone_name <> d.timezone_name
          AND EXISTS (SELECT 1 FROM dbo.appointment_slots s WHERE s.branch_id = i.branch_id)
    )
        THROW 52001, N'Không được đổi múi giờ khi chi nhánh đã có slot lịch.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_working_schedules_guard
ON dbo.doctor_working_schedules
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.rooms r ON r.room_id = i.room_id
        WHERE r.branch_id <> i.branch_id OR r.is_active = 0
    )
        THROW 52002, N'Phòng khám không hoạt động hoặc không thuộc chi nhánh của ca làm.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        WHERE i.is_active = 1
          AND NOT EXISTS
          (
              SELECT 1
              FROM dbo.doctor_branch_assignments a
              WHERE a.doctor_id = i.doctor_id
                AND a.branch_id = i.branch_id
                AND a.is_active = 1
                AND a.effective_from <= i.effective_from
                AND (a.effective_to IS NULL OR a.effective_to >= COALESCE(i.effective_to, i.effective_from))
          )
    )
        THROW 52003, N'Bác sĩ chưa được phân công hợp lệ tại chi nhánh cho toàn bộ hiệu lực ca làm.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.doctor_working_schedules x
          ON x.working_schedule_id <> i.working_schedule_id
         AND x.is_active = 1 AND i.is_active = 1
         AND x.weekday_iso = i.weekday_iso
         AND x.local_start_time < i.local_end_time
         AND x.local_end_time > i.local_start_time
         AND x.effective_from <= COALESCE(i.effective_to, CONVERT(date,'99991231'))
         AND i.effective_from <= COALESCE(x.effective_to, CONVERT(date,'99991231'))
         AND (x.doctor_id = i.doctor_id OR x.room_id = i.room_id)
    )
        THROW 52004, N'Ca làm bị chồng lấn theo bác sĩ hoặc phòng.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.working_schedule_id = i.working_schedule_id
        WHERE EXISTS (SELECT 1 FROM dbo.appointment_slots s WHERE s.working_schedule_id = i.working_schedule_id)
          AND (i.doctor_id <> d.doctor_id OR i.branch_id <> d.branch_id OR i.room_id <> d.room_id
               OR i.weekday_iso <> d.weekday_iso OR i.local_start_time <> d.local_start_time
               OR i.local_end_time <> d.local_end_time OR i.slot_duration_min <> d.slot_duration_min
               OR i.effective_from <> d.effective_from
               OR COALESCE(i.effective_to, CONVERT(date,'99991231')) <> COALESCE(d.effective_to, CONVERT(date,'99991231')))
    )
        THROW 52005, N'Không được thay đổi cấu trúc ca làm sau khi đã sinh slot; hãy ngừng ca cũ và tạo ca mới.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_schedule_breaks_guard
ON dbo.doctor_schedule_breaks
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.doctor_working_schedules s ON s.working_schedule_id = i.working_schedule_id
        WHERE i.local_start_time < s.local_start_time OR i.local_end_time > s.local_end_time
    )
        THROW 52006, N'Khoảng nghỉ phải nằm trọn trong ca làm.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.doctor_schedule_breaks x
          ON x.working_schedule_id = i.working_schedule_id
         AND x.schedule_break_id <> i.schedule_break_id
         AND x.local_start_time < i.local_end_time
         AND x.local_end_time > i.local_start_time
    )
        THROW 52007, N'Các khoảng nghỉ trong cùng ca không được chồng lấn.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN deleted d ON d.schedule_break_id = i.schedule_break_id
        WHERE EXISTS (SELECT 1 FROM dbo.appointment_slots s WHERE s.working_schedule_id = i.working_schedule_id)
          AND (i.working_schedule_id <> d.working_schedule_id
               OR i.local_start_time <> d.local_start_time OR i.local_end_time <> d.local_end_time)
    )
        THROW 52008, N'Không được đổi khoảng nghỉ sau khi đã sinh slot.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_time_off_guard
ON dbo.doctor_time_off
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.appointments a
          ON a.doctor_id = i.doctor_id
         AND (i.branch_id IS NULL OR a.branch_id = i.branch_id)
         AND a.occupies_slot = 1
         AND a.scheduled_start_utc < i.ends_at_utc
         AND a.scheduled_end_utc > i.starts_at_utc
        WHERE i.status = 'APPROVED'
    )
        THROW 52009, N'Không thể duyệt nghỉ vì đang có lịch hẹn hoạt động bị xung đột.', 1;

    UPDATE s
       SET status = 'BLOCKED',
           blocked_reason = N'Bác sĩ nghỉ đã được duyệt',
           updated_at_utc = SYSUTCDATETIME()
    FROM dbo.appointment_slots s
    JOIN inserted i
      ON i.doctor_id = s.doctor_id
     AND (i.branch_id IS NULL OR i.branch_id = s.branch_id)
     AND i.status = 'APPROVED'
     AND s.starts_at_utc < i.ends_at_utc
     AND s.ends_at_utc > i.starts_at_utc
    WHERE s.status = 'OPEN';
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_holidays_guard
ON dbo.clinic_holidays
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1
        FROM inserted h
        JOIN dbo.appointment_slots s
          ON s.branch_id = h.branch_id AND s.service_date_local = h.holiday_date
         AND (h.is_closed_all_day = 1
              OR (s.start_time_local < h.local_end_time AND s.end_time_local > h.local_start_time))
        JOIN dbo.appointments a ON a.slot_id = s.slot_id AND a.occupies_slot = 1
    )
        THROW 52010, N'Không thể tạo giờ nghỉ lễ vì đang có lịch hẹn hoạt động.', 1;

    UPDATE s
       SET status = 'BLOCKED',
           blocked_reason = h.holiday_name,
           updated_at_utc = SYSUTCDATETIME()
    FROM dbo.appointment_slots s
    JOIN inserted h
      ON h.branch_id = s.branch_id AND h.holiday_date = s.service_date_local
     AND (h.is_closed_all_day = 1
          OR (s.start_time_local < h.local_end_time AND s.end_time_local > h.local_start_time))
    WHERE s.status = 'OPEN';
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_appointment_slots_guard
ON dbo.appointment_slots
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.doctor_working_schedules w ON w.working_schedule_id = i.working_schedule_id
        WHERE i.doctor_id <> w.doctor_id OR i.branch_id <> w.branch_id OR i.room_id <> w.room_id
           OR i.service_date_local < w.effective_from
           OR (w.effective_to IS NOT NULL AND i.service_date_local > w.effective_to)
           OR ((DATEDIFF(DAY, CONVERT(date,'19000101'), i.service_date_local) % 7) + 1) <> w.weekday_iso
           OR i.start_time_local < w.local_start_time OR i.end_time_local > w.local_end_time
    )
        THROW 52011, N'Slot không khớp ca làm, bác sĩ, chi nhánh, phòng hoặc thứ trong tuần.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.appointment_slots x
          ON x.slot_id <> i.slot_id
         AND x.status <> 'CANCELLED' AND i.status <> 'CANCELLED'
         AND x.starts_at_utc < i.ends_at_utc AND x.ends_at_utc > i.starts_at_utc
         AND (x.doctor_id = i.doctor_id OR x.room_id = i.room_id)
    )
        THROW 52012, N'Slot bị chồng lấn theo bác sĩ hoặc phòng.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.doctor_schedule_breaks b ON b.working_schedule_id = i.working_schedule_id
        WHERE i.status = 'OPEN'
          AND b.local_start_time < i.end_time_local AND b.local_end_time > i.start_time_local
    )
        THROW 52013, N'Slot giao với khoảng nghỉ trong ca.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.clinic_holidays h ON h.branch_id = i.branch_id AND h.holiday_date = i.service_date_local
        WHERE i.status = 'OPEN'
          AND (h.is_closed_all_day = 1
               OR (h.local_start_time < i.end_time_local AND h.local_end_time > i.start_time_local))
    )
        THROW 52014, N'Slot rơi vào thời gian chi nhánh nghỉ.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.doctor_time_off t ON t.doctor_id = i.doctor_id
                                    AND (t.branch_id IS NULL OR t.branch_id = i.branch_id)
                                    AND t.status = 'APPROVED'
                                    AND t.starts_at_utc < i.ends_at_utc
                                    AND t.ends_at_utc > i.starts_at_utc
        WHERE i.status = 'OPEN'
    )
        THROW 52015, N'Slot rơi vào thời gian bác sĩ nghỉ.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        JOIN deleted d ON d.slot_id = i.slot_id
        WHERE EXISTS (SELECT 1 FROM dbo.appointments a WHERE a.slot_id = i.slot_id)
          AND (i.working_schedule_id <> d.working_schedule_id OR i.doctor_id <> d.doctor_id
               OR i.branch_id <> d.branch_id OR i.room_id <> d.room_id
               OR i.service_date_local <> d.service_date_local
               OR i.start_time_local <> d.start_time_local OR i.end_time_local <> d.end_time_local
               OR i.starts_at_utc <> d.starts_at_utc OR i.ends_at_utc <> d.ends_at_utc)
    )
        THROW 52016, N'Không được đổi thời gian/phạm vi slot đã từng có lịch hẹn.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_appointments_guard_and_history
ON dbo.appointments
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.appointment_slots s ON s.slot_id = i.slot_id
        WHERE i.branch_id <> s.branch_id OR i.doctor_id <> s.doctor_id
           OR i.scheduled_start_utc <> s.starts_at_utc OR i.scheduled_end_utc <> s.ends_at_utc
    )
        THROW 52017, N'Lịch hẹn không khớp slot/bác sĩ/chi nhánh/thời gian.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.appointment_slots s ON s.slot_id = i.slot_id
        WHERE i.occupies_slot = 1 AND s.status IN ('BLOCKED','CANCELLED')
    )
        THROW 52018, N'Không thể giữ lịch trên slot đã khóa hoặc hủy.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        WHERE i.occupies_slot = 1
          AND NOT EXISTS
              (SELECT 1 FROM dbo.doctor_services ds
               WHERE ds.doctor_id = i.doctor_id AND ds.service_id = i.service_id AND ds.is_active = 1)
    )
        THROW 52019, N'Bác sĩ không được cấu hình thực hiện dịch vụ đã chọn.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.appointments x
          ON x.appointment_id <> i.appointment_id
         AND x.patient_id = i.patient_id
         AND x.occupies_slot = 1 AND i.occupies_slot = 1
         AND x.scheduled_start_utc < i.scheduled_end_utc
         AND x.scheduled_end_utc > i.scheduled_start_utc
    )
        THROW 52020, N'Bệnh nhân đã có lịch hẹn khác bị chồng thời gian.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON d.appointment_id = i.appointment_id
        WHERE d.appointment_id IS NULL AND i.status NOT IN ('PENDING','CONFIRMED')
    )
        THROW 52021, N'Lịch mới chỉ được ở trạng thái PENDING hoặc CONFIRMED.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i JOIN deleted d ON d.appointment_id = i.appointment_id
        WHERE i.status <> d.status
          AND NOT
          (
              (d.status = 'PENDING' AND i.status IN ('CONFIRMED','CANCELLED','EXPIRED'))
              OR (d.status = 'CONFIRMED' AND i.status IN ('CHECKED_IN','CANCELLED','NO_SHOW'))
              OR (d.status = 'CHECKED_IN' AND i.status IN ('IN_PROGRESS','CANCELLED'))
              OR (d.status = 'IN_PROGRESS' AND i.status IN ('COMPLETED','CANCELLED'))
          )
    )
        THROW 52022, N'Chuyển trạng thái lịch hẹn không hợp lệ.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i JOIN deleted d ON d.appointment_id = i.appointment_id
        WHERE d.status IN ('COMPLETED','CANCELLED','NO_SHOW','EXPIRED')
    )
        THROW 52023, N'Lịch hẹn ở trạng thái kết thúc là bất biến.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i JOIN deleted d ON d.appointment_id = i.appointment_id
        WHERE i.patient_id <> d.patient_id OR i.booked_by_user_id <> d.booked_by_user_id
    )
        THROW 52024, N'Không được đổi bệnh nhân hoặc người tạo của lịch hẹn.', 1;

    INSERT dbo.appointment_status_history
        (appointment_id, old_status, new_status, changed_by_user_id, reason, request_id)
    SELECT
        i.appointment_id,
        d.status,
        i.status,
        TRY_CONVERT(bigint, SESSION_CONTEXT(N'actor_user_id')),
        COALESCE(i.cancellation_reason, TRY_CONVERT(nvarchar(500), SESSION_CONTEXT(N'status_reason'))),
        TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'request_id'))
    FROM inserted i
    LEFT JOIN deleted d ON d.appointment_id = i.appointment_id
    WHERE d.appointment_id IS NULL OR d.status <> i.status;

    UPDATE s
       SET status = CASE
                        WHEN EXISTS (SELECT 1 FROM dbo.appointments a
                                     WHERE a.slot_id = s.slot_id AND a.occupies_slot = 1)
                            THEN 'BOOKED'
                        WHEN s.status = 'BOOKED' THEN 'OPEN'
                        ELSE s.status
                    END,
           updated_at_utc = SYSUTCDATETIME()
    FROM dbo.appointment_slots s
    WHERE s.slot_id IN
    (
        SELECT slot_id FROM inserted
        UNION
        SELECT slot_id FROM deleted
    );
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_encounters_guard
ON dbo.encounters
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i
        JOIN dbo.appointments a ON a.appointment_id = i.appointment_id
        WHERE i.encounter_source = 'APPOINTMENT'
          AND (i.branch_id <> a.branch_id OR i.patient_id <> a.patient_id
               OR i.attending_doctor_id <> a.doctor_id)
    )
        THROW 52025, N'Lượt khám không khớp lịch hẹn về bệnh nhân/chi nhánh/bác sĩ.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        JOIN dbo.branches b ON b.branch_id = i.branch_id
        CROSS APPLY (VALUES
            (CAST((i.arrived_at_utc AT TIME ZONE 'UTC' AT TIME ZONE b.timezone_name) AS date))
        ) bd(business_date)
        WHERE NOT EXISTS
        (
            SELECT 1
            FROM dbo.doctor_branch_assignments a
            WHERE a.doctor_id = i.attending_doctor_id AND a.branch_id = i.branch_id
              AND a.is_active = 1
              AND a.effective_from <= bd.business_date
              AND (a.effective_to IS NULL OR a.effective_to >= bd.business_date)
        )
    )
        THROW 52026, N'Bác sĩ không được phân công tại chi nhánh của lượt khám.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON d.encounter_id = i.encounter_id
        WHERE d.encounter_id IS NULL AND i.status <> 'WAITING'
    )
        THROW 52027, N'Lượt khám mới phải bắt đầu ở trạng thái WAITING.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted i JOIN deleted d ON d.encounter_id = i.encounter_id
        WHERE i.status <> d.status
          AND NOT
          (
              (d.status = 'WAITING' AND i.status IN ('IN_PROGRESS','CANCELLED'))
              OR (d.status = 'IN_PROGRESS' AND i.status IN ('COMPLETED','CANCELLED'))
              OR (d.status = 'COMPLETED' AND i.status = 'SIGNED')
          )
    )
        THROW 52028, N'Chuyển trạng thái lượt khám không hợp lệ.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.encounter_id = i.encounter_id
        WHERE d.status IN ('SIGNED','CANCELLED')
           OR (d.status = 'COMPLETED' AND i.status <> 'SIGNED')
    )
        THROW 52029, N'Lượt khám đã hoàn tất/ký/hủy là bất biến; chỉ được ký từ COMPLETED.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.encounter_id = i.encounter_id
        WHERE i.appointment_id <> d.appointment_id
           OR (i.appointment_id IS NULL AND d.appointment_id IS NOT NULL)
           OR (i.appointment_id IS NOT NULL AND d.appointment_id IS NULL)
           OR i.branch_id <> d.branch_id OR i.patient_id <> d.patient_id
           OR i.encounter_source <> d.encounter_source OR i.arrived_at_utc <> d.arrived_at_utc
    )
        THROW 52030, N'Không được đổi định danh nguồn, bệnh nhân, chi nhánh hoặc giờ đến của lượt khám.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_vitals_clinical_guard
ON dbo.encounter_vital_signs
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM
        (SELECT encounter_id FROM inserted UNION SELECT encounter_id FROM deleted) x
        JOIN dbo.encounters e ON e.encounter_id = x.encounter_id
        WHERE e.status IN ('COMPLETED','SIGNED','CANCELLED')
    )
        THROW 52031, N'Không được sửa sinh hiệu sau khi lượt khám hoàn tất/ký/hủy.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_diagnoses_clinical_guard
ON dbo.encounter_diagnoses
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM
        (SELECT encounter_id FROM inserted UNION SELECT encounter_id FROM deleted) x
        JOIN dbo.encounters e ON e.encounter_id = x.encounter_id
        WHERE e.status IN ('COMPLETED','SIGNED','CANCELLED')
    )
        THROW 52032, N'Không được sửa chẩn đoán sau khi lượt khám hoàn tất/ký/hủy.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_encounter_services_clinical_guard
ON dbo.encounter_services
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM
        (SELECT encounter_id FROM inserted UNION SELECT encounter_id FROM deleted) x
        JOIN dbo.encounters e ON e.encounter_id = x.encounter_id
        WHERE e.status IN ('COMPLETED','SIGNED','CANCELLED')
    )
        THROW 52033, N'Không được sửa dịch vụ sau khi lượt khám hoàn tất/ký/hủy.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.encounter_service_id = i.encounter_service_id
        WHERE i.status <> d.status
          AND NOT
          (
              (d.status = 'ORDERED' AND i.status IN ('IN_PROGRESS','COMPLETED','CANCELLED'))
              OR (d.status = 'IN_PROGRESS' AND i.status IN ('COMPLETED','CANCELLED'))
          )
    )
        THROW 52034, N'Chuyển trạng thái dịch vụ không hợp lệ.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_service_results_clinical_guard
ON dbo.service_results
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1
        FROM (SELECT service_result_id, encounter_service_id FROM inserted
              UNION SELECT service_result_id, encounter_service_id FROM deleted) x
        JOIN dbo.encounter_services es ON es.encounter_service_id = x.encounter_service_id
        JOIN dbo.encounters e ON e.encounter_id = es.encounter_id
        WHERE e.status IN ('COMPLETED','SIGNED','CANCELLED')
    )
        THROW 52035, N'Không được sửa kết quả sau khi lượt khám hoàn tất/ký/hủy.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.service_result_id = i.service_result_id
        WHERE d.status IN ('FINAL','AMENDED','CANCELLED')
    )
        THROW 52036, N'Phiên bản kết quả đã chốt là bất biến.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_result_values_clinical_guard
ON dbo.service_result_values
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1
        FROM (SELECT service_result_id FROM inserted UNION SELECT service_result_id FROM deleted) x
        JOIN dbo.service_results sr ON sr.service_result_id = x.service_result_id
        JOIN dbo.encounter_services es ON es.encounter_service_id = sr.encounter_service_id
        JOIN dbo.encounters e ON e.encounter_id = es.encounter_id
        WHERE sr.status IN ('FINAL','AMENDED','CANCELLED')
           OR e.status IN ('COMPLETED','SIGNED','CANCELLED')
    )
        THROW 52037, N'Không được sửa chỉ số của kết quả đã chốt hoặc lượt khám đã khóa.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_attachments_clinical_guard
ON dbo.medical_attachments
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM
        (SELECT encounter_id, encounter_service_id FROM inserted
         UNION SELECT encounter_id, encounter_service_id FROM deleted) x
        JOIN dbo.encounters e ON e.encounter_id = x.encounter_id
        WHERE e.status IN ('COMPLETED','SIGNED','CANCELLED')
    )
        THROW 52038, N'Không được sửa tệp đính kèm sau khi lượt khám hoàn tất/ký/hủy.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        JOIN dbo.encounter_services es ON es.encounter_service_id = i.encounter_service_id
        WHERE es.encounter_id <> i.encounter_id
    )
        THROW 52039, N'Tệp đính kèm dịch vụ phải thuộc cùng lượt khám.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_encounter_staff_clinical_guard
ON dbo.encounter_staff_assignments
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM
        (SELECT encounter_id FROM inserted UNION SELECT encounter_id FROM deleted) x
        JOIN dbo.encounters e ON e.encounter_id = x.encounter_id
        WHERE e.status IN ('COMPLETED','SIGNED','CANCELLED')
    )
        THROW 52040, N'Không được sửa phân công nhân sự sau khi lượt khám hoàn tất/ký/hủy.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_signatures_append_only
ON dbo.encounter_signatures
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted)
        THROW 52041, N'Chữ ký hồ sơ là dữ liệu append-only.', 1;
    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN dbo.encounters e ON e.encounter_id = i.encounter_id
        WHERE e.status <> 'SIGNED' OR e.signed_by_user_id <> i.signed_by_user_id
    )
        THROW 52042, N'Chữ ký chỉ được thêm sau khi lượt khám đã ký bởi đúng người dùng.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_amendments_append_only
ON dbo.encounter_amendments
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted)
        THROW 52043, N'Phụ lục hồ sơ là dữ liệu append-only.', 1;
    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN dbo.encounters e ON e.encounter_id = i.encounter_id
        WHERE e.status <> 'SIGNED'
    )
        THROW 52044, N'Chỉ được thêm phụ lục cho hồ sơ đã ký.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_prescriptions_guard
ON dbo.prescriptions
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM inserted i
        JOIN dbo.encounters e ON e.encounter_id = i.encounter_id
        WHERE i.patient_id <> e.patient_id OR i.doctor_id <> e.attending_doctor_id OR i.branch_id <> e.branch_id
    )
        THROW 52045, N'Đơn thuốc không khớp lượt khám.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON d.prescription_id=i.prescription_id
        JOIN dbo.encounters e ON e.encounter_id=i.encounter_id
        WHERE d.prescription_id IS NULL AND e.status IN ('SIGNED','CANCELLED')
    )
        THROW 52062, N'Không được tạo đơn thuốc mới cho lượt khám đã ký/hủy.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.prescription_id = i.prescription_id
        WHERE d.status <> 'DRAFT'
          AND (i.encounter_id <> d.encounter_id OR i.patient_id <> d.patient_id
               OR i.doctor_id <> d.doctor_id OR i.branch_id <> d.branch_id
               OR COALESCE(i.clinical_notes,N'') <> COALESCE(d.clinical_notes,N'')
               OR COALESCE(i.general_instructions,N'') <> COALESCE(d.general_instructions,N''))
    )
        THROW 52046, N'Nội dung đơn thuốc sau phát hành là bất biến.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_prescription_items_guard
ON dbo.prescription_items
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS
    (
        SELECT 1 FROM inserted i
        LEFT JOIN deleted d ON d.prescription_item_id=i.prescription_item_id
        JOIN dbo.prescriptions p ON p.prescription_id=i.prescription_id
        WHERE d.prescription_item_id IS NULL AND p.status <> 'DRAFT'
    )
        THROW 52047, N'Chỉ được thêm thuốc khi đơn ở trạng thái DRAFT.', 1;

    IF EXISTS
    (
        SELECT 1 FROM deleted d
        LEFT JOIN inserted i ON i.prescription_item_id=d.prescription_item_id
        JOIN dbo.prescriptions p ON p.prescription_id=d.prescription_id
        WHERE i.prescription_item_id IS NULL AND p.status <> 'DRAFT'
    )
        THROW 52063, N'Chỉ được xóa thuốc khi đơn ở trạng thái DRAFT.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i
        JOIN deleted d ON d.prescription_item_id=i.prescription_item_id
        JOIN dbo.prescriptions p ON p.prescription_id=i.prescription_id
        WHERE p.status <> 'DRAFT'
          AND (i.prescription_id<>d.prescription_id OR i.medicine_id<>d.medicine_id
               OR i.medicine_name_snapshot<>d.medicine_name_snapshot
               OR i.strength_snapshot<>d.strength_snapshot
               OR i.dosage_form_snapshot<>d.dosage_form_snapshot
               OR i.route_snapshot<>d.route_snapshot
               OR i.prescribed_quantity<>d.prescribed_quantity OR i.dose<>d.dose
               OR i.frequency<>d.frequency
               OR COALESCE(i.duration_days,-1)<>COALESCE(d.duration_days,-1)
               OR COALESCE(i.timing_instruction,N'')<>COALESCE(d.timing_instruction,N'')
               OR i.usage_instruction<>d.usage_instruction OR i.sort_order<>d.sort_order)
    )
        THROW 52064, N'Sau phát hành chỉ hệ thống được cập nhật lượng đã cấp; nội dung kê là bất biến.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_inventory_movements_append_only
ON dbo.inventory_movements
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52048, N'Sổ cái tồn kho là append-only; hãy tạo bút toán đảo.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_dispensation_items_append_only
ON dbo.dispensation_items
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52049, N'Dòng cấp thuốc là append-only; hãy dùng nghiệp vụ đảo cấp phát.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_dispense_reversals_append_only
ON dbo.dispensation_item_reversals
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52050, N'Bản ghi đảo cấp thuốc là append-only.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_invoice_items_guard_and_totals
ON dbo.invoice_items
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @affected TABLE (invoice_id bigint PRIMARY KEY);
    INSERT @affected(invoice_id)
    SELECT invoice_id FROM inserted
    UNION
    SELECT invoice_id FROM deleted;

    IF EXISTS
    (
        SELECT 1 FROM @affected a JOIN dbo.invoices i ON i.invoice_id = a.invoice_id
        WHERE i.status <> 'DRAFT'
    )
        THROW 52051, N'Chỉ được thay đổi dòng khi hóa đơn ở trạng thái DRAFT.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted ii
        JOIN dbo.invoices inv ON inv.invoice_id = ii.invoice_id
        JOIN dbo.encounter_services es ON es.encounter_service_id = ii.encounter_service_id
        WHERE es.encounter_id <> inv.encounter_id
    )
        THROW 52052, N'Dịch vụ nguồn không thuộc lượt khám của hóa đơn.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM inserted ii
        JOIN dbo.invoices inv ON inv.invoice_id = ii.invoice_id
        JOIN dbo.dispensation_items di ON di.dispensation_item_id = ii.dispensation_item_id
        JOIN dbo.prescription_items pi ON pi.prescription_item_id = di.prescription_item_id
        JOIN dbo.prescriptions p ON p.prescription_id = pi.prescription_id
        WHERE p.encounter_id <> inv.encounter_id
           OR EXISTS (SELECT 1 FROM dbo.dispensation_item_reversals r
                      WHERE r.dispensation_item_id = di.dispensation_item_id)
    )
        THROW 52053, N'Thuốc nguồn không thuộc lượt khám hoặc đã bị đảo cấp phát.', 1;

    UPDATE inv
       SET subtotal_amount = COALESCE(x.subtotal_amount, 0),
           discount_amount = COALESCE(x.discount_amount, 0),
           tax_amount = COALESCE(x.tax_amount, 0),
           updated_at_utc = SYSUTCDATETIME()
    FROM dbo.invoices inv
    JOIN @affected a ON a.invoice_id = inv.invoice_id
    OUTER APPLY
    (
        SELECT
            SUM(ii.line_subtotal) AS subtotal_amount,
            SUM(ii.discount_amount) AS discount_amount,
            SUM(ii.line_tax) AS tax_amount
        FROM dbo.invoice_items ii
        WHERE ii.invoice_id = inv.invoice_id
    ) x;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_invoices_guard
ON dbo.invoices
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    IF EXISTS (SELECT 1 FROM deleted d WHERE NOT EXISTS (SELECT 1 FROM inserted i WHERE i.invoice_id = d.invoice_id))
        THROW 52054, N'Không được xóa hóa đơn; hãy VOID.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.invoice_id = i.invoice_id
        WHERE d.status <> 'DRAFT'
          AND (i.encounter_id <> d.encounter_id OR i.patient_id <> d.patient_id OR i.branch_id <> d.branch_id
               OR i.subtotal_amount <> d.subtotal_amount OR i.discount_amount <> d.discount_amount
               OR i.tax_amount <> d.tax_amount OR i.insurance_amount <> d.insurance_amount)
    )
        THROW 52055, N'Nội dung tài chính hóa đơn đã phát hành là bất biến.', 1;

    IF EXISTS
    (
        SELECT 1 FROM inserted i JOIN deleted d ON d.invoice_id = i.invoice_id
        WHERE i.status <> d.status
          AND NOT
          (
              (d.status = 'DRAFT' AND i.status IN ('ISSUED','VOID'))
              OR (d.status = 'ISSUED' AND i.status IN ('PARTIALLY_PAID','PAID','VOID'))
              OR (d.status = 'PARTIALLY_PAID' AND i.status IN ('PAID','ISSUED'))
              OR (d.status = 'PAID' AND i.status IN ('PARTIALLY_PAID','ISSUED'))
          )
    )
        THROW 52056, N'Chuyển trạng thái hóa đơn không hợp lệ.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_financial_allocations_append_only
ON dbo.payment_allocations
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52057, N'Phân bổ thanh toán là append-only; điều chỉnh bằng hoàn tiền.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_refund_allocations_append_only
ON dbo.refund_allocations
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52058, N'Phân bổ hoàn tiền là append-only.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_payments_no_delete
ON dbo.payments
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52059, N'Không được xóa thanh toán.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_refunds_no_delete
ON dbo.payment_refunds
AFTER DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52060, N'Không được xóa hoàn tiền.', 1;
END;
GO

CREATE OR ALTER TRIGGER dbo.trg_audit_logs_append_only
ON dbo.audit_logs
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    THROW 52061, N'Nhật ký kiểm toán là append-only.', 1;
END;
GO

/*=============================================================================
  14. COMMAND PROCEDURES - KHỞI TẠO, NHÂN SỰ, RBAC VÀ BỆNH NHÂN
=============================================================================*/

CREATE OR ALTER PROCEDURE dbo.sp_create_room
    @actor_user_id bigint,
    @branch_id bigint,
    @room_code varchar(30),
    @room_name nvarchar(150),
    @room_type varchar(30),
    @floor_no smallint = NULL,
    @capacity smallint = 1,
    @room_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id,'MASTER_DATA_MANAGE',@branch_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.branches WITH (UPDLOCK,HOLDLOCK)
                       WHERE branch_id=@branch_id AND is_active=1)
            THROW 52990,N'Chi nhánh không tồn tại hoặc đã ngừng.',1;
        INSERT dbo.rooms(branch_id,room_code,room_name,room_type,floor_no,capacity,is_active)
        VALUES(@branch_id,@room_code,@room_name,@room_type,@floor_no,@capacity,1);
        SET @room_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@room_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ROOM_CREATED','ROOM',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_create_service
    @actor_user_id bigint,
    @branch_id bigint,
    @service_category_id bigint,
    @specialty_id bigint = NULL,
    @service_code varchar(30),
    @service_name nvarchar(200),
    @service_type varchar(30),
    @default_duration_min smallint,
    @current_price decimal(19,2),
    @requires_doctor bit = 1,
    @service_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id,'MASTER_DATA_MANAGE',@branch_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        INSERT dbo.services
            (service_category_id,specialty_id,service_code,service_name,service_type,
             default_duration_min,current_price,requires_doctor,is_active)
        VALUES
            (@service_category_id,@specialty_id,@service_code,@service_name,@service_type,
             @default_duration_min,@current_price,@requires_doctor,1);
        SET @service_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@service_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'SERVICE_CREATED','SERVICE',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_assign_doctor_service
    @actor_user_id bigint,
    @branch_id bigint,
    @doctor_id bigint,
    @service_id bigint,
    @custom_duration_min smallint = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id,'MASTER_DATA_MANAGE',@branch_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.doctor_branch_assignments
                       WHERE doctor_id=@doctor_id AND branch_id=@branch_id AND is_active=1)
            THROW 52991,N'Bác sĩ không thuộc chi nhánh.',1;
        IF EXISTS (SELECT 1 FROM dbo.doctor_services WITH (UPDLOCK,HOLDLOCK)
                   WHERE doctor_id=@doctor_id AND service_id=@service_id)
            UPDATE dbo.doctor_services SET custom_duration_min=@custom_duration_min,is_active=1
            WHERE doctor_id=@doctor_id AND service_id=@service_id;
        ELSE
            INSERT dbo.doctor_services(doctor_id,service_id,custom_duration_min,is_active)
            VALUES(@doctor_id,@service_id,@custom_duration_min,1);
        DECLARE @entity_id varchar(100)=CONCAT(@doctor_id,':',@service_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'DOCTOR_SERVICE_ASSIGNED',
             'DOCTOR_SERVICE',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_create_medicine_batch
    @actor_user_id bigint,
    @branch_id bigint,
    @medicine_code varchar(30),
    @generic_name nvarchar(250),
    @brand_name nvarchar(250)=NULL,
    @active_ingredient nvarchar(500),
    @strength nvarchar(100),
    @dosage_form nvarchar(100),
    @route nvarchar(100),
    @base_unit nvarchar(30),
    @current_sale_price decimal(19,2),
    @batch_number nvarchar(80),
    @expiry_date date,
    @purchase_price decimal(19,2),
    @batch_sale_price decimal(19,2),
    @supplier_id bigint=NULL,
    @medicine_id bigint OUTPUT,
    @medicine_batch_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id,'MASTER_DATA_MANAGE',@branch_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        SELECT @medicine_id=medicine_id FROM dbo.medicines WITH (UPDLOCK,HOLDLOCK)
        WHERE medicine_code=@medicine_code;
        IF @medicine_id IS NULL
        BEGIN
            INSERT dbo.medicines
                (medicine_code,generic_name,brand_name,active_ingredient,strength,dosage_form,
                 route,base_unit,current_sale_price,is_active)
            VALUES
                (@medicine_code,@generic_name,@brand_name,@active_ingredient,@strength,@dosage_form,
                 @route,@base_unit,@current_sale_price,1);
            SET @medicine_id=SCOPE_IDENTITY();
        END
        ELSE IF NOT EXISTS (SELECT 1 FROM dbo.medicines WHERE medicine_id=@medicine_id AND is_active=1)
            THROW 52992,N'Thuốc đã tồn tại nhưng đang ngừng hoạt động.',1;

        IF EXISTS (SELECT 1 FROM dbo.medicine_batches WITH (UPDLOCK,HOLDLOCK)
                   WHERE medicine_id=@medicine_id AND batch_number=@batch_number)
            THROW 52993,N'Số lô đã tồn tại cho thuốc này.',1;
        INSERT dbo.medicine_batches
            (medicine_id,supplier_id,batch_number,expiry_date,purchase_price,sale_price,status)
        VALUES
            (@medicine_id,@supplier_id,@batch_number,@expiry_date,@purchase_price,@batch_sale_price,'AVAILABLE');
        SET @medicine_batch_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@medicine_batch_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"medicine_id":',@medicine_id,N'}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'MEDICINE_BATCH_CREATED',
             'MEDICINE_BATCH',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_auth_record_login_failure
    @user_id bigint,
    @max_failed_attempts smallint = 5,
    @lock_minutes int = 15,
    @locked_until_utc datetime2(3) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @locked_until_utc = NULL;
    IF @max_failed_attempts NOT BETWEEN 1 AND 20 OR @lock_minutes NOT BETWEEN 1 AND 1440
        THROW 53030, N'Chính sách khóa đăng nhập không hợp lệ.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @failed smallint, @status varchar(20);
        SELECT @failed=failed_login_count, @status=status
        FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE user_id=@user_id AND deleted_at_utc IS NULL;

        IF @status='ACTIVE'
        BEGIN
            SET @failed = @failed + 1;
            IF @failed >= @max_failed_attempts
                SET @locked_until_utc = DATEADD(minute,@lock_minutes,SYSUTCDATETIME());
            UPDATE dbo.users
               SET failed_login_count=@failed,
                   locked_until_utc=COALESCE(@locked_until_utc,locked_until_utc),
                   token_version=IIF(@locked_until_utc IS NULL,token_version,token_version+1),
                   updated_at_utc=SYSUTCDATETIME()
             WHERE user_id=@user_id;
            IF @locked_until_utc IS NOT NULL
                UPDATE dbo.user_sessions
                   SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
                       revocation_reason=COALESCE(revocation_reason,'ACCOUNT_CHANGED')
                 WHERE user_id=@user_id AND revoked_at_utc IS NULL;
            DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@user_id);
            DECLARE @audit_json nvarchar(max)=CONCAT(N'{"failedCount":',@failed,N',"locked":',
                IIF(@locked_until_utc IS NULL,N'false',N'true'),N'}');
            EXEC dbo.sp_write_audit @actor_user_id=@user_id,@action_code='LOGIN_FAILED',
                @entity_type='USER',@entity_id=@entity_id,@new_values_json=@audit_json;
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_auth_create_session
    @user_id bigint,
    @expected_token_version int,
    @refresh_token_hash binary(32),
    @device_info nvarchar(500)=NULL,
    @ip_address varchar(45)=NULL,
    @expires_at_utc datetime2(3),
    @session_id uniqueidentifier OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @session_id = NEWID();
    IF @expires_at_utc<=SYSUTCDATETIME() THROW 53031,N'Hạn refresh token không hợp lệ.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS
        (
            SELECT 1 FROM dbo.users WITH (UPDLOCK,HOLDLOCK)
            WHERE user_id=@user_id AND status='ACTIVE' AND deleted_at_utc IS NULL
              AND token_version=@expected_token_version
              AND (locked_until_utc IS NULL OR locked_until_utc<=SYSUTCDATETIME())
        ) THROW 53032,N'Tài khoản không ở trạng thái cho phép đăng nhập.',1;

        INSERT dbo.user_sessions
            (session_id,user_id,refresh_token_hash,device_info,ip_address,expires_at_utc,token_version_snapshot)
        VALUES
            (@session_id,@user_id,@refresh_token_hash,@device_info,@ip_address,@expires_at_utc,@expected_token_version);
        UPDATE dbo.users SET failed_login_count=0,locked_until_utc=NULL,
            last_login_at_utc=SYSUTCDATETIME(),updated_at_utc=SYSUTCDATETIME()
        WHERE user_id=@user_id;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@session_id);
        EXEC dbo.sp_write_audit @actor_user_id=@user_id,@action_code='LOGIN_SUCCEEDED',
            @entity_type='USER_SESSION',@entity_id=@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_auth_rotate_session
    @current_refresh_token_hash binary(32),
    @new_refresh_token_hash binary(32),
    @device_info nvarchar(500)=NULL,
    @ip_address varchar(45)=NULL,
    @expires_at_utc datetime2(3),
    @user_id bigint OUTPUT,
    @token_version int OUTPUT,
    @new_session_id uniqueidentifier OUTPUT,
    @reuse_detected bit OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SELECT @user_id=NULL,@token_version=NULL,@new_session_id=NULL,@reuse_detected=0;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @session_id uniqueidentifier,@session_expires datetime2(3),@revoked datetime2(3),
                @replaced_by uniqueidentifier,@snapshot int,@status varchar(20),@current_version int,
                @locked_until_utc datetime2(3);
        SELECT @session_id=s.session_id,@user_id=s.user_id,@session_expires=s.expires_at_utc,
               @revoked=s.revoked_at_utc,@replaced_by=s.replaced_by_id,@snapshot=s.token_version_snapshot
        FROM dbo.user_sessions s WITH (UPDLOCK,HOLDLOCK)
        WHERE s.refresh_token_hash=@current_refresh_token_hash;

        IF @session_id IS NULL
        BEGIN COMMIT TRANSACTION; RETURN; END;

        SELECT @status=status,@current_version=token_version,@locked_until_utc=locked_until_utc
        FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE user_id=@user_id AND deleted_at_utc IS NULL;
        SET @token_version=@current_version;

        IF @replaced_by IS NOT NULL
        BEGIN
            SET @reuse_detected=1;
            UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
                revocation_reason=COALESCE(revocation_reason,'REUSE_DETECTED')
            WHERE user_id=@user_id AND revoked_at_utc IS NULL;
            UPDATE dbo.users SET token_version=token_version+1,updated_at_utc=SYSUTCDATETIME()
            WHERE user_id=@user_id;
            SET @token_version=@current_version+1;
            DECLARE @reuse_entity_id varchar(100)=CONVERT(varchar(100),@user_id);
            EXEC dbo.sp_write_audit @actor_user_id=@user_id,@action_code='REFRESH_TOKEN_REUSE_DETECTED',
                @entity_type='USER',@entity_id=@reuse_entity_id;
            COMMIT TRANSACTION;
            RETURN;
        END;

        IF @revoked IS NOT NULL OR @session_expires<=SYSUTCDATETIME()
           OR @status IS NULL OR @status<>'ACTIVE'
           OR (@locked_until_utc IS NOT NULL AND @locked_until_utc>SYSUTCDATETIME())
           OR @snapshot<>@current_version OR @expires_at_utc<=SYSUTCDATETIME()
        BEGIN
            UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
                revocation_reason=COALESCE(revocation_reason,IIF(@session_expires<=SYSUTCDATETIME(),'EXPIRED','ACCOUNT_CHANGED'))
            WHERE session_id=@session_id;
            COMMIT TRANSACTION;
            RETURN;
        END;

        SET @new_session_id=NEWID();
        INSERT dbo.user_sessions
            (session_id,user_id,refresh_token_hash,device_info,ip_address,expires_at_utc,token_version_snapshot)
        VALUES
            (@new_session_id,@user_id,@new_refresh_token_hash,@device_info,@ip_address,@expires_at_utc,@current_version);
        UPDATE dbo.user_sessions SET revoked_at_utc=SYSUTCDATETIME(),replaced_by_id=@new_session_id,
            revocation_reason='ROTATED',last_used_at_utc=SYSUTCDATETIME()
        WHERE session_id=@session_id;
        DECLARE @rotate_entity_id varchar(100)=CONVERT(varchar(100),@new_session_id);
        EXEC dbo.sp_write_audit @actor_user_id=@user_id,@action_code='REFRESH_TOKEN_ROTATED',
            @entity_type='USER_SESSION',@entity_id=@rotate_entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_auth_revoke_session
    @refresh_token_hash binary(32),
    @reason varchar(30)='LOGOUT'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @reason NOT IN ('LOGOUT','ACCOUNT_CHANGED') THROW 53033,N'Lý do thu hồi session không hợp lệ.',1;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @user_id bigint,@session_id uniqueidentifier;
        SELECT @user_id=user_id,@session_id=session_id FROM dbo.user_sessions WITH (UPDLOCK,HOLDLOCK)
        WHERE refresh_token_hash=@refresh_token_hash;
        UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
            revocation_reason=COALESCE(revocation_reason,@reason),last_used_at_utc=SYSUTCDATETIME()
        WHERE session_id=@session_id;
        IF @session_id IS NOT NULL
        BEGIN
            DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@session_id);
            EXEC dbo.sp_write_audit @actor_user_id=@user_id,@action_code='SESSION_REVOKED',
                @entity_type='USER_SESSION',@entity_id=@entity_id;
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_auth_revoke_all_sessions
    @actor_user_id bigint
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_actor @actor_user_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.users WITH (UPDLOCK,HOLDLOCK) WHERE user_id=@actor_user_id AND deleted_at_utc IS NULL)
            THROW 53034,N'Tài khoản không tồn tại.',1;
        UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
            revocation_reason=COALESCE(revocation_reason,'LOGOUT_ALL')
        WHERE user_id=@actor_user_id AND revoked_at_utc IS NULL;
        UPDATE dbo.users SET token_version=token_version+1,updated_at_utc=SYSUTCDATETIME()
        WHERE user_id=@actor_user_id;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@actor_user_id);
        EXEC dbo.sp_write_audit @actor_user_id=@actor_user_id,@action_code='ALL_SESSIONS_REVOKED',
            @entity_type='USER',@entity_id=@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_bootstrap_first_admin
    @username nvarchar(80),
    @email varchar(254) = NULL,
    @phone varchar(20) = NULL,
    @password_hash varchar(255),
    @display_name nvarchar(200),
    @user_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    IF LEN(@password_hash) < 40
        THROW 53000, N'password_hash phải là hash mạnh do backend tạo; không truyền mật khẩu thuần.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF EXISTS (SELECT 1 FROM dbo.users WITH (UPDLOCK, HOLDLOCK))
            THROW 53001, N'Hệ thống đã có tài khoản; thủ tục bootstrap chỉ được chạy đúng một lần.', 1;

        INSERT dbo.users (username, email, phone, password_hash, display_name, status)
        VALUES (@username, @email, @phone, @password_hash, @display_name, 'ACTIVE');
        SET @user_id = SCOPE_IDENTITY();

        INSERT dbo.user_roles (user_id, role_id, branch_id, granted_by_user_id, is_active)
        SELECT @user_id, role_id, NULL, @user_id, 1
        FROM dbo.roles WHERE role_code = 'ADMIN';

        DECLARE @bootstrap_entity_id varchar(100) = CONVERT(varchar(100), @user_id);
        EXEC dbo.sp_write_audit
            @actor_user_id = @user_id,
            @action_code = 'FIRST_ADMIN_BOOTSTRAPPED',
            @entity_type = 'USER',
            @entity_id = @bootstrap_entity_id,
            @new_values_json = N'{"role":"ADMIN"}';

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_create_staff_account
    @actor_user_id bigint,
    @branch_id bigint,
    @username nvarchar(80),
    @email varchar(254) = NULL,
    @phone varchar(20) = NULL,
    @password_hash varchar(255),
    @employee_code varchar(30),
    @employee_type varchar(30),
    @full_name nvarchar(200),
    @date_of_birth date = NULL,
    @gender varchar(10) = NULL,
    @address_line nvarchar(300) = NULL,
    @hire_date date,
    @medical_license_no nvarchar(100) = NULL,
    @license_issued_date date = NULL,
    @license_expiry_date date = NULL,
    @academic_title nvarchar(100) = NULL,
    @biography nvarchar(max) = NULL,
    @default_slot_minutes smallint = 30,
    @accepts_online_booking bit = 1,
    @specialty_id bigint = NULL,
    @user_id bigint OUTPUT,
    @employee_id bigint OUTPUT,
    @doctor_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id, 'USERS_MANAGE', @branch_id;

    IF LEN(@password_hash) < 40
        THROW 53002, N'password_hash phải là hash mạnh do backend tạo.', 1;
    IF NULLIF(LTRIM(RTRIM(@username)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(@employee_code)),'') IS NULL
       OR NULLIF(LTRIM(RTRIM(@full_name)),N'') IS NULL
        THROW 53035, N'Tên đăng nhập, mã nhân viên và họ tên là bắt buộc.', 1;
    IF @employee_type NOT IN
       ('DOCTOR','NURSE','RECEPTIONIST','PHARMACIST','CASHIER','LAB_TECH','TECHNICIAN','MANAGER','OTHER')
        THROW 53003, N'Loại nhân viên không hợp lệ.', 1;
    IF @employee_type = 'DOCTOR' AND @medical_license_no IS NULL
        THROW 53004, N'Bác sĩ bắt buộc có số chứng chỉ hành nghề.', 1;
    IF @date_of_birth IS NOT NULL AND @date_of_birth>=CONVERT(date,SYSUTCDATETIME())
        THROW 53036, N'Ngày sinh phải ở trong quá khứ.',1;
    IF @hire_date>DATEADD(day,31,CONVERT(date,SYSUTCDATETIME()))
        THROW 53037, N'Ngày vào làm không được quá 31 ngày trong tương lai.',1;
    IF @employee_type='DOCTOR' AND (@default_slot_minutes NOT BETWEEN 5 AND 240
       OR (@license_expiry_date IS NOT NULL AND @license_issued_date IS NOT NULL
           AND @license_expiry_date<@license_issued_date))
        THROW 53038, N'Thông tin hành nghề bác sĩ không hợp lệ.',1;

    DECLARE @role_code varchar(50) =
        CASE @employee_type
            WHEN 'DOCTOR' THEN 'DOCTOR'
            WHEN 'NURSE' THEN 'NURSE'
            WHEN 'RECEPTIONIST' THEN 'RECEPTIONIST'
            WHEN 'PHARMACIST' THEN 'PHARMACIST'
            WHEN 'CASHIER' THEN 'CASHIER'
            WHEN 'LAB_TECH' THEN 'LAB_TECH'
            WHEN 'TECHNICIAN' THEN 'LAB_TECH'
            WHEN 'MANAGER' THEN 'MANAGER'
            ELSE NULL
        END;
    SET @doctor_id = NULL;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF NOT EXISTS (SELECT 1 FROM dbo.branches WITH (UPDLOCK, HOLDLOCK)
                       WHERE branch_id = @branch_id AND is_active = 1)
            THROW 53005, N'Chi nhánh không tồn tại hoặc ngừng hoạt động.', 1;

        INSERT dbo.users (username, email, phone, password_hash, display_name, status)
        VALUES (@username, @email, @phone, @password_hash, @full_name, 'ACTIVE');
        SET @user_id = SCOPE_IDENTITY();

        INSERT dbo.employees
            (user_id, primary_branch_id, employee_code, employee_type, full_name,
             date_of_birth, gender, phone, email, address_line, hire_date, employment_status, is_active)
        VALUES
            (@user_id, @branch_id, @employee_code, @employee_type, @full_name,
             @date_of_birth, @gender, @phone, @email, @address_line, @hire_date, 'ACTIVE', 1);
        SET @employee_id = SCOPE_IDENTITY();

        IF @role_code IS NOT NULL
        BEGIN
            INSERT dbo.user_roles
                (user_id, role_id, branch_id, granted_by_user_id, is_active)
            SELECT @user_id, role_id, @branch_id, @actor_user_id, 1
            FROM dbo.roles WHERE role_code = @role_code;
        END;

        IF @employee_type = 'DOCTOR'
        BEGIN
            INSERT dbo.doctors
                (employee_id, medical_license_no, license_issued_date, license_expiry_date,
                 academic_title, biography, default_slot_minutes, accepts_online_booking, is_active)
            VALUES (@employee_id, @medical_license_no, @license_issued_date, @license_expiry_date,
                    @academic_title, @biography, @default_slot_minutes, @accepts_online_booking, 1);
            SET @doctor_id = SCOPE_IDENTITY();

            DECLARE @business_date date;
            EXEC dbo.sp_get_branch_business_date @branch_id, NULL, @business_date OUTPUT;
            INSERT dbo.doctor_branch_assignments
                (doctor_id, branch_id, effective_from, is_primary, is_active)
            VALUES (@doctor_id, @branch_id, @business_date, 1, 1);

            IF @specialty_id IS NULL
                SELECT @specialty_id = specialty_id FROM dbo.specialties WHERE specialty_code = 'GENERAL';
            IF NOT EXISTS (SELECT 1 FROM dbo.specialties WHERE specialty_id = @specialty_id AND is_active = 1)
                THROW 53006, N'Chuyên khoa bác sĩ không hợp lệ.', 1;

            INSERT dbo.doctor_specialties (doctor_id, specialty_id, is_primary)
            VALUES (@doctor_id, @specialty_id, 1);

            INSERT dbo.doctor_services (doctor_id, service_id, is_active)
            SELECT @doctor_id, s.service_id, 1
            FROM dbo.services s
            WHERE s.is_active = 1 AND (s.specialty_id = @specialty_id OR s.specialty_id IS NULL);
        END;

        DECLARE @staff_entity_id varchar(100) = CONVERT(varchar(100), @employee_id);
        DECLARE @staff_audit_json nvarchar(max) =
            CONCAT(N'{"user_id":', @user_id, N',"employee_type":"', @employee_type, N'"}');
        EXEC dbo.sp_write_audit
            @actor_user_id, @branch_id, 'STAFF_ACCOUNT_CREATED', 'EMPLOYEE',
            @staff_entity_id, NULL, @staff_audit_json;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_update_staff_account
    @actor_user_id bigint,
    @target_user_id bigint,
    @email varchar(254)=NULL,
    @phone varchar(20)=NULL,
    @full_name nvarchar(200),
    @date_of_birth date=NULL,
    @gender varchar(10)=NULL,
    @address_line nvarchar(300)=NULL,
    @hire_date date,
    @employment_status varchar(20),
    @termination_date date=NULL,
    @medical_license_no nvarchar(100)=NULL,
    @license_issued_date date=NULL,
    @license_expiry_date date=NULL,
    @academic_title nvarchar(100)=NULL,
    @biography nvarchar(max)=NULL,
    @default_slot_minutes smallint=NULL,
    @accepts_online_booking bit=NULL,
    @expected_employee_row_ver binary(8),
    @expected_doctor_row_ver binary(8)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@full_name)),N'') IS NULL
        THROW 53039,N'Họ tên nhân viên là bắt buộc.',1;
    IF @date_of_birth IS NOT NULL AND @date_of_birth>=CONVERT(date,SYSUTCDATETIME())
        THROW 53036,N'Ngày sinh phải ở trong quá khứ.',1;
    IF @employment_status NOT IN ('ACTIVE','ON_LEAVE','SUSPENDED','TERMINATED')
        THROW 53040,N'Trạng thái nhân sự không hợp lệ.',1;
    IF (@employment_status='TERMINATED' AND @termination_date IS NULL)
       OR (@termination_date IS NOT NULL AND @termination_date<@hire_date)
        THROW 53041,N'Ngày nghỉ việc không hợp lệ.',1;

    DECLARE @employee_id bigint,@doctor_id bigint,@branch_id bigint,@employee_type varchar(30),
            @current_employment_status varchar(20);
    SELECT @employee_id=e.employee_id,@branch_id=e.primary_branch_id,@employee_type=e.employee_type,
           @doctor_id=d.doctor_id,@current_employment_status=e.employment_status
    FROM dbo.employees e
    LEFT JOIN dbo.doctors d ON d.employee_id=e.employee_id
    WHERE e.user_id=@target_user_id;
    IF @employee_id IS NULL THROW 53042,N'Tài khoản nhân viên không tồn tại.',1;
    EXEC dbo.sp_assert_permission @actor_user_id,'USERS_MANAGE',@branch_id;
    IF @current_employment_status='TERMINATED' AND @employment_status<>'TERMINATED'
        THROW 53058,N'Không thể khôi phục hồ sơ nhân viên đã nghỉ việc; hãy tạo quy trình tái tuyển dụng riêng.',1;

    IF @employee_type='DOCTOR'
    BEGIN
        IF NULLIF(LTRIM(RTRIM(@medical_license_no)),N'') IS NULL
           OR @default_slot_minutes NOT BETWEEN 5 AND 240
           OR (@license_expiry_date IS NOT NULL AND @license_issued_date IS NOT NULL
               AND @license_expiry_date<@license_issued_date)
            THROW 53038,N'Thông tin hành nghề bác sĩ không hợp lệ.',1;
        IF @expected_doctor_row_ver IS NULL
            THROW 53043,N'Phiên bản hồ sơ bác sĩ là bắt buộc.',1;
    END;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @target_is_global_admin bit=IIF(EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            WHERE ur.user_id=@target_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
        ),1,0);
        IF @target_is_global_admin=1 AND NOT EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            WHERE ur.user_id=@actor_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
        ) THROW 51002,N'Chỉ Admin toàn cục được cập nhật hồ sơ của Admin toàn cục.',1;
        IF @actor_user_id=@target_user_id AND @employment_status IN ('SUSPENDED','TERMINATED')
            THROW 53048,N'Không được tự đình chỉ hoặc kết thúc hồ sơ đang đăng nhập.',1;
        IF @target_is_global_admin=1 AND @employment_status IN ('SUSPENDED','TERMINATED')
        BEGIN
            DECLARE @admin_lock_result int;
            EXEC @admin_lock_result=sys.sp_getapplock @Resource=N'security:global-admin',
                @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
            IF @admin_lock_result<0 THROW 53059,N'Không thể khóa tài nguyên bảo vệ Admin toàn cục.',1;
            IF NOT EXISTS
            (
                SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
                JOIN dbo.users u ON u.user_id=ur.user_id
                WHERE ur.user_id<>@target_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
                  AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
                  AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
                  AND u.status='ACTIVE' AND u.deleted_at_utc IS NULL
            ) THROW 53050,N'Không được đình chỉ Admin toàn cục cuối cùng.',1;
        END;
        UPDATE dbo.employees WITH (UPDLOCK)
           SET full_name=@full_name,date_of_birth=@date_of_birth,gender=@gender,
               phone=@phone,email=@email,address_line=@address_line,hire_date=@hire_date,
               employment_status=@employment_status,
               termination_date=IIF(@employment_status='TERMINATED',@termination_date,NULL),
               is_active=IIF(@employment_status IN ('SUSPENDED','TERMINATED'),0,1),
               updated_at_utc=SYSUTCDATETIME()
         WHERE employee_id=@employee_id AND row_ver=@expected_employee_row_ver;
        IF @@ROWCOUNT=0 THROW 53044,N'Hồ sơ nhân viên đã được người khác cập nhật.',1;

        UPDATE dbo.users
           SET display_name=@full_name,email=@email,phone=@phone,
               status=IIF(@employment_status IN ('SUSPENDED','TERMINATED'),'DISABLED',status),
               token_version=IIF(@employment_status IN ('SUSPENDED','TERMINATED'),token_version+1,token_version),
               updated_at_utc=SYSUTCDATETIME()
         WHERE user_id=@target_user_id;

        IF @doctor_id IS NOT NULL
        BEGIN
            UPDATE dbo.doctors WITH (UPDLOCK)
               SET medical_license_no=@medical_license_no,license_issued_date=@license_issued_date,
                   license_expiry_date=@license_expiry_date,academic_title=@academic_title,
                   biography=@biography,default_slot_minutes=@default_slot_minutes,
                   accepts_online_booking=@accepts_online_booking,
                   is_active=IIF(@employment_status IN ('SUSPENDED','TERMINATED'),0,1),
                   updated_at_utc=SYSUTCDATETIME()
             WHERE doctor_id=@doctor_id AND row_ver=@expected_doctor_row_ver;
            IF @@ROWCOUNT=0 THROW 53045,N'Hồ sơ bác sĩ đã được người khác cập nhật.',1;
        END;

        IF @employment_status IN ('SUSPENDED','TERMINATED')
            UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
                revocation_reason=COALESCE(revocation_reason,'ACCOUNT_CHANGED')
            WHERE user_id=@target_user_id AND revoked_at_utc IS NULL;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@employee_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"employmentStatus":"',@employment_status,N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'STAFF_ACCOUNT_UPDATED','EMPLOYEE',
            @entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_set_staff_account_status
    @actor_user_id bigint,
    @target_user_id bigint,
    @status varchar(20),
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @status NOT IN ('ACTIVE','DISABLED')
        THROW 53046,N'Trạng thái tài khoản chỉ có thể là ACTIVE hoặc DISABLED.',1;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL
        THROW 53047,N'Bắt buộc nhập lý do đổi trạng thái tài khoản.',1;
    IF @actor_user_id=@target_user_id AND @status='DISABLED'
        THROW 53048,N'Không được tự vô hiệu hóa tài khoản đang đăng nhập.',1;

    DECLARE @branch_id bigint,@current_status varchar(20),@employment_status varchar(20);
    SELECT @branch_id=e.primary_branch_id,@employment_status=e.employment_status,
           @current_status=u.status
    FROM dbo.users u JOIN dbo.employees e ON e.user_id=u.user_id
    WHERE u.user_id=@target_user_id AND u.deleted_at_utc IS NULL;
    IF @branch_id IS NULL THROW 53042,N'Tài khoản nhân viên không tồn tại.',1;
    EXEC dbo.sp_assert_permission @actor_user_id,'USERS_MANAGE',@branch_id;
    IF @status='ACTIVE' AND @employment_status='TERMINATED'
        THROW 53049,N'Không thể kích hoạt tài khoản của nhân viên đã nghỉ việc.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @target_is_global_admin bit=IIF(EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            WHERE ur.user_id=@target_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
        ),1,0);
        IF @target_is_global_admin=1 AND NOT EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            WHERE ur.user_id=@actor_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
        ) THROW 51002,N'Chỉ Admin toàn cục được đổi trạng thái của Admin toàn cục.',1;
        IF @status='DISABLED' AND @target_is_global_admin=1
        BEGIN
            DECLARE @admin_lock_result int;
            EXEC @admin_lock_result=sys.sp_getapplock @Resource=N'security:global-admin',
                @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
            IF @admin_lock_result<0 THROW 53059,N'Không thể khóa tài nguyên bảo vệ Admin toàn cục.',1;
            IF NOT EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            JOIN dbo.users u ON u.user_id=ur.user_id
            WHERE ur.user_id<>@target_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
              AND u.status='ACTIVE' AND u.deleted_at_utc IS NULL
            ) THROW 53050,N'Không được vô hiệu hóa Admin toàn cục cuối cùng.',1;
        END;

        UPDATE dbo.users WITH (UPDLOCK)
           SET status=@status,failed_login_count=IIF(@status='ACTIVE',0,failed_login_count),
               locked_until_utc=IIF(@status='ACTIVE',NULL,locked_until_utc),
               token_version=token_version+1,updated_at_utc=SYSUTCDATETIME()
         WHERE user_id=@target_user_id AND status<>@status;
        IF @@ROWCOUNT=0 AND @current_status<>@status
            THROW 53042,N'Tài khoản nhân viên không tồn tại.',1;
        UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
            revocation_reason=COALESCE(revocation_reason,'ACCOUNT_CHANGED')
        WHERE user_id=@target_user_id AND revoked_at_utc IS NULL;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@target_user_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"status":"',@status,N'","reason":"',
            STRING_ESCAPE(@reason,'json'),N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'STAFF_ACCOUNT_STATUS_CHANGED','USER',
            @entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_unlock_staff_account
    @actor_user_id bigint,
    @target_user_id bigint,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL
        THROW 53051,N'Bắt buộc nhập lý do mở khóa tài khoản.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=e.primary_branch_id FROM dbo.employees e
    JOIN dbo.users u ON u.user_id=e.user_id
    WHERE u.user_id=@target_user_id AND u.deleted_at_utc IS NULL;
    IF @branch_id IS NULL THROW 53042,N'Tài khoản nhân viên không tồn tại.',1;
    EXEC dbo.sp_assert_permission @actor_user_id,'USERS_MANAGE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            WHERE ur.user_id=@target_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
        ) AND NOT EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            WHERE ur.user_id=@actor_user_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
        ) THROW 51002,N'Chỉ Admin toàn cục được mở khóa Admin toàn cục.',1;
        UPDATE dbo.users WITH (UPDLOCK)
           SET status=IIF(status='LOCKED','ACTIVE',status),failed_login_count=0,
               locked_until_utc=NULL,token_version=token_version+1,
               updated_at_utc=SYSUTCDATETIME()
         WHERE user_id=@target_user_id AND status<>'DISABLED'
           AND (status='LOCKED' OR locked_until_utc IS NOT NULL OR failed_login_count>0);
        IF @@ROWCOUNT=0 THROW 53052,N'Tài khoản không bị khóa hoặc đang bị vô hiệu hóa.',1;
        UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
            revocation_reason=COALESCE(revocation_reason,'ACCOUNT_CHANGED')
        WHERE user_id=@target_user_id AND revoked_at_utc IS NULL;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@target_user_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"reason":"',STRING_ESCAPE(@reason,'json'),N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'STAFF_ACCOUNT_UNLOCKED','USER',
            @entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_grant_user_role
    @actor_user_id bigint,
    @target_user_id bigint,
    @role_code varchar(50),
    @branch_id bigint = NULL,
    @valid_to_utc datetime2(3) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @actor_user_id=@target_user_id
        THROW 53053,N'Không được tự gán quyền cho tài khoản đang đăng nhập.',1;
    IF @role_code='PATIENT'
        THROW 53054,N'Role PATIENT chỉ được cấp qua luồng tài khoản bệnh nhân.',1;
    IF (@role_code='ADMIN' AND @branch_id IS NOT NULL)
       OR (@role_code<>'ADMIN' AND @branch_id IS NULL)
        THROW 53055,N'ADMIN phải ở phạm vi toàn cục; role nhân viên phải thuộc một chi nhánh.',1;
    EXEC dbo.sp_assert_permission @actor_user_id, 'ROLES_MANAGE', @branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;

        IF @role_code='ADMIN'
        BEGIN
            DECLARE @admin_lock_result int;
            EXEC @admin_lock_result=sys.sp_getapplock @Resource=N'security:global-admin',
                @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
            IF @admin_lock_result<0 THROW 53059,N'Không thể khóa tài nguyên bảo vệ Admin toàn cục.',1;
        END;

        DECLARE @role_id bigint;
        SELECT @role_id = role_id FROM dbo.roles WITH (UPDLOCK, HOLDLOCK)
        WHERE role_code = @role_code AND is_active = 1;
        IF @role_id IS NULL THROW 53007, N'Vai trò không tồn tại hoặc đã ngừng.', 1;
        IF @branch_id IS NOT NULL AND NOT EXISTS
           (SELECT 1 FROM dbo.branches WHERE branch_id=@branch_id AND is_active=1)
            THROW 53005,N'Chi nhánh không tồn tại hoặc ngừng hoạt động.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE user_id = @target_user_id AND deleted_at_utc IS NULL)
            THROW 53008, N'Tài khoản đích không tồn tại.', 1;
        IF @valid_to_utc IS NOT NULL AND @valid_to_utc <= SYSUTCDATETIME()
            THROW 53009, N'Thời điểm hết hiệu lực vai trò phải ở tương lai.', 1;
        IF EXISTS
        (
            SELECT 1 FROM dbo.user_roles WITH (UPDLOCK, HOLDLOCK)
            WHERE user_id = @target_user_id AND role_id = @role_id
              AND ((branch_id = @branch_id) OR (branch_id IS NULL AND @branch_id IS NULL))
              AND is_active = 1
        )
            THROW 53010, N'Tài khoản đã có vai trò đang hoạt động trong phạm vi này.', 1;

        INSERT dbo.user_roles
            (user_id, role_id, branch_id, granted_by_user_id, valid_to_utc, is_active)
        VALUES
            (@target_user_id, @role_id, @branch_id, @actor_user_id, @valid_to_utc, 1);

        UPDATE dbo.users SET token_version=token_version+1,updated_at_utc=SYSUTCDATETIME()
        WHERE user_id=@target_user_id;
        UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
            revocation_reason=COALESCE(revocation_reason,'ACCOUNT_CHANGED')
        WHERE user_id=@target_user_id AND revoked_at_utc IS NULL;

        DECLARE @grant_entity_id varchar(100) = CONVERT(varchar(100), @target_user_id);
        DECLARE @grant_audit_json nvarchar(max) = CONCAT(N'{"role":"', @role_code, N'"}');
        EXEC dbo.sp_write_audit
            @actor_user_id, @branch_id, 'USER_ROLE_GRANTED', 'USER',
            @grant_entity_id, NULL, @grant_audit_json;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_revoke_user_role
    @actor_user_id bigint,
    @user_role_id bigint,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)), N'') IS NULL
        THROW 53011, N'Bắt buộc nhập lý do thu hồi vai trò.', 1;

    DECLARE @branch_id bigint, @target_user_id bigint, @role_code varchar(50);
    SELECT @branch_id = ur.branch_id, @target_user_id = ur.user_id, @role_code = r.role_code
    FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id = ur.role_id
    WHERE ur.user_role_id = @user_role_id;
    IF @target_user_id IS NULL THROW 53012,N'Vai trò không tồn tại hoặc đã bị thu hồi.',1;
    IF @target_user_id=@actor_user_id
        THROW 53056,N'Không được tự thu hồi vai trò của tài khoản đang đăng nhập.',1;
    EXEC dbo.sp_assert_permission @actor_user_id, 'ROLES_MANAGE', @branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF @role_code='ADMIN' AND @branch_id IS NULL
        BEGIN
            DECLARE @admin_lock_result int;
            EXEC @admin_lock_result=sys.sp_getapplock @Resource=N'security:global-admin',
                @LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
            IF @admin_lock_result<0 THROW 53059,N'Không thể khóa tài nguyên bảo vệ Admin toàn cục.',1;
            IF NOT EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur JOIN dbo.roles r ON r.role_id=ur.role_id
            JOIN dbo.users u ON u.user_id=ur.user_id
            WHERE ur.user_role_id<>@user_role_id AND r.role_code='ADMIN' AND ur.branch_id IS NULL
              AND ur.is_active=1 AND ur.valid_from_utc<=SYSUTCDATETIME()
              AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc>SYSUTCDATETIME())
              AND u.status='ACTIVE' AND u.deleted_at_utc IS NULL
            ) THROW 53057,N'Không được thu hồi Admin toàn cục cuối cùng.',1;
        END;
        UPDATE dbo.user_roles WITH (UPDLOCK, HOLDLOCK)
           SET is_active = 0, valid_to_utc = COALESCE(valid_to_utc, SYSUTCDATETIME())
         WHERE user_role_id = @user_role_id AND is_active = 1;
        IF @@ROWCOUNT = 0 THROW 53012, N'Vai trò không tồn tại hoặc đã bị thu hồi.', 1;

        UPDATE dbo.users SET token_version=token_version+1,updated_at_utc=SYSUTCDATETIME()
        WHERE user_id=@target_user_id;
        UPDATE dbo.user_sessions SET revoked_at_utc=COALESCE(revoked_at_utc,SYSUTCDATETIME()),
            revocation_reason=COALESCE(revocation_reason,'ACCOUNT_CHANGED')
        WHERE user_id=@target_user_id AND revoked_at_utc IS NULL;

        DECLARE @revoke_entity_id varchar(100) = CONVERT(varchar(100), @user_role_id);
        DECLARE @revoke_audit_json nvarchar(max) =
            CONCAT(N'{"reason":"', STRING_ESCAPE(@reason, 'json'), N'"}');
        EXEC dbo.sp_write_audit
            @actor_user_id, @branch_id, 'USER_ROLE_REVOKED', 'USER_ROLE',
            @revoke_entity_id, NULL, @revoke_audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_create_patient
    @actor_user_id bigint,
    @branch_id bigint,
    @full_name nvarchar(200),
    @date_of_birth date,
    @gender varchar(10),
    @national_id varchar(30) = NULL,
    @health_insurance_no varchar(30) = NULL,
    @phone varchar(20) = NULL,
    @email varchar(254) = NULL,
    @address_line nvarchar(300) = NULL,
    @province nvarchar(100) = NULL,
    @portal_user_id bigint = NULL,
    @relationship_type varchar(20) = 'SELF',
    @patient_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id, 'PATIENTS_MANAGE', @branch_id;

    DECLARE @business_date date;
    EXEC dbo.sp_get_branch_business_date @branch_id, NULL, @business_date OUTPUT;
    IF @date_of_birth > @business_date
        THROW 53013, N'Ngày sinh không được ở tương lai.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @patient_code varchar(40);
        EXEC dbo.sp_next_document_number
            @branch_id, 'PATIENT', @business_date, 'BN', @patient_code OUTPUT;

        INSERT dbo.patients
            (patient_code, full_name, date_of_birth, gender, national_id,
             health_insurance_no, phone, email, address_line, province, created_by_user_id)
        VALUES
            (@patient_code, @full_name, @date_of_birth, @gender, @national_id,
             @health_insurance_no, @phone, @email, @address_line, @province, @actor_user_id);
        SET @patient_id = SCOPE_IDENTITY();

        IF @portal_user_id IS NOT NULL
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE user_id = @portal_user_id AND status = 'ACTIVE')
                THROW 53014, N'Tài khoản cổng bệnh nhân không hợp lệ.', 1;
            INSERT dbo.user_patient_access
                (user_id, patient_id, relationship_type, status, is_booking_allowed,
                 verified_by_user_id, verified_at_utc)
            VALUES
                (@portal_user_id, @patient_id, @relationship_type, 'ACTIVE', 1,
                 @actor_user_id, SYSUTCDATETIME());
        END;

        DECLARE @patient_entity_id varchar(100) = CONVERT(varchar(100), @patient_id);
        DECLARE @patient_audit_json nvarchar(max) = CONCAT(N'{"patient_code":"', @patient_code, N'"}');
        EXEC dbo.sp_write_audit
            @actor_user_id, @branch_id, 'PATIENT_CREATED', 'PATIENT',
            @patient_entity_id, NULL, @patient_audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_create_patient_portal_account
    @actor_user_id bigint,
    @branch_id bigint,
    @patient_id bigint,
    @username nvarchar(80),
    @email varchar(254) = NULL,
    @phone varchar(20) = NULL,
    @password_hash varchar(255),
    @relationship_type varchar(20) = 'SELF',
    @user_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id, 'USERS_MANAGE', @branch_id;
    IF LEN(@password_hash) < 40 THROW 53015, N'password_hash phải là hash mạnh do backend tạo.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @display_name nvarchar(200);
        SELECT @display_name = full_name FROM dbo.patients WITH (UPDLOCK, HOLDLOCK)
        WHERE patient_id = @patient_id AND status = 'ACTIVE';
        IF @display_name IS NULL THROW 53016, N'Bệnh nhân không tồn tại hoặc không hoạt động.', 1;

        INSERT dbo.users (username, email, phone, password_hash, display_name, status)
        VALUES (@username, @email, @phone, @password_hash, @display_name, 'ACTIVE');
        SET @user_id = SCOPE_IDENTITY();

        INSERT dbo.user_roles (user_id, role_id, branch_id, granted_by_user_id, is_active)
        SELECT @user_id, role_id, NULL, @actor_user_id, 1
        FROM dbo.roles WHERE role_code = 'PATIENT';

        INSERT dbo.user_patient_access
            (user_id, patient_id, relationship_type, status, is_booking_allowed,
             verified_by_user_id, verified_at_utc)
        VALUES
            (@user_id, @patient_id, @relationship_type, 'ACTIVE', 1,
             @actor_user_id, SYSUTCDATETIME());

        DECLARE @portal_entity_id varchar(100) = CONVERT(varchar(100), @user_id);
        DECLARE @portal_audit_json nvarchar(max) = CONCAT(N'{"patient_id":', @patient_id, N'}');
        EXEC dbo.sp_write_audit
            @actor_user_id, @branch_id, 'PATIENT_PORTAL_ACCOUNT_CREATED', 'USER',
            @portal_entity_id, NULL, @portal_audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_link_user_patient
    @actor_user_id bigint,
    @branch_id bigint,
    @portal_user_id bigint,
    @patient_id bigint,
    @relationship_type varchar(20),
    @is_booking_allowed bit = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id, 'PATIENTS_MANAGE', @branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.users WHERE user_id = @portal_user_id AND status = 'ACTIVE')
            THROW 53017, N'Tài khoản cổng bệnh nhân không hợp lệ.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.patients WHERE patient_id = @patient_id AND status = 'ACTIVE')
            THROW 53018, N'Bệnh nhân không hợp lệ.', 1;
        IF EXISTS (SELECT 1 FROM dbo.user_patient_access WITH (UPDLOCK,HOLDLOCK)
                   WHERE user_id = @portal_user_id AND patient_id = @patient_id)
            THROW 53019, N'Quan hệ tài khoản-bệnh nhân đã tồn tại.', 1;

        INSERT dbo.user_patient_access
            (user_id, patient_id, relationship_type, status, is_booking_allowed,
             verified_by_user_id, verified_at_utc)
        VALUES
            (@portal_user_id, @patient_id, @relationship_type, 'ACTIVE',
             @is_booking_allowed, @actor_user_id, SYSUTCDATETIME());

        DECLARE @link_entity_id varchar(100) = CONVERT(varchar(100), @patient_id);
        DECLARE @link_audit_json nvarchar(max) =
            CONCAT(N'{"user_id":', @portal_user_id, N',"relationship":"', @relationship_type, N'"}');
        EXEC dbo.sp_write_audit
            @actor_user_id, @branch_id, 'USER_PATIENT_LINKED', 'PATIENT',
            @link_entity_id, NULL, @link_audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/*=============================================================================
  15. COMMAND PROCEDURES - CA LÀM, SLOT VÀ LỊCH HẸN
=============================================================================*/

CREATE OR ALTER PROCEDURE dbo.sp_assert_appointment_access
    @actor_user_id bigint,
    @appointment_id bigint,
    @allow_patient_self bit = 1
AS
BEGIN
    SET NOCOUNT ON;
    EXEC dbo.sp_assert_actor @actor_user_id;

    DECLARE @branch_id bigint, @patient_id bigint;
    SELECT @branch_id = branch_id, @patient_id = patient_id
    FROM dbo.appointments WHERE appointment_id = @appointment_id;
    IF @branch_id IS NULL THROW 53100, N'Lịch hẹn không tồn tại.', 1;

    IF EXISTS
    (
        SELECT 1
        FROM dbo.user_roles ur
        JOIN dbo.roles r ON r.role_id = ur.role_id AND r.is_active = 1
        LEFT JOIN dbo.role_permissions rp ON rp.role_id = r.role_id
        LEFT JOIN dbo.permissions p ON p.permission_id = rp.permission_id
        WHERE ur.user_id = @actor_user_id AND ur.is_active = 1
          AND ur.valid_from_utc <= SYSUTCDATETIME()
          AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc > SYSUTCDATETIME())
          AND (ur.branch_id IS NULL OR ur.branch_id = @branch_id)
          AND (r.role_code = 'ADMIN' OR p.permission_code = 'APPOINTMENTS_MANAGE')
    )
        RETURN;

    IF @allow_patient_self = 1
       AND EXISTS
       (
           SELECT 1 FROM dbo.user_patient_access
           WHERE user_id = @actor_user_id AND patient_id = @patient_id
             AND status = 'ACTIVE' AND is_booking_allowed = 1 AND revoked_at_utc IS NULL
       )
       AND EXISTS
       (
           SELECT 1
           FROM dbo.user_roles ur
           JOIN dbo.roles r ON r.role_id = ur.role_id AND r.is_active = 1
           LEFT JOIN dbo.role_permissions rp ON rp.role_id = r.role_id
           LEFT JOIN dbo.permissions p ON p.permission_id = rp.permission_id
           WHERE ur.user_id = @actor_user_id AND ur.is_active = 1
             AND ur.valid_from_utc <= SYSUTCDATETIME()
             AND (ur.valid_to_utc IS NULL OR ur.valid_to_utc > SYSUTCDATETIME())
             AND (ur.branch_id IS NULL OR ur.branch_id = @branch_id)
             AND (r.role_code = 'ADMIN' OR p.permission_code = 'APPOINTMENTS_SELF')
       )
        RETURN;

    THROW 53101, N'Không có quyền thao tác lịch hẹn này.', 1;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_create_doctor_working_schedule
    @actor_user_id bigint,
    @doctor_id bigint,
    @branch_id bigint,
    @room_id bigint,
    @weekday_iso tinyint,
    @local_start_time time(0),
    @local_end_time time(0),
    @slot_duration_min smallint,
    @effective_from date,
    @effective_to date = NULL,
    @booking_horizon_days smallint = NULL,
    @working_schedule_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id, 'SCHEDULES_MANAGE', @branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @lock_result int;
        DECLARE @resource nvarchar(255) = CONCAT(N'schedule:', @doctor_id, N':', @branch_id, N':', @weekday_iso);
        EXEC @lock_result = sys.sp_getapplock
            @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
        IF @lock_result < 0 THROW 53102, N'Không thể khóa lịch làm việc của bác sĩ.', 1;

        INSERT dbo.doctor_working_schedules
            (doctor_id, branch_id, room_id, weekday_iso, local_start_time, local_end_time,
             slot_duration_min, booking_horizon_days, effective_from, effective_to,
             is_active, created_by_user_id)
        VALUES
            (@doctor_id, @branch_id, @room_id, @weekday_iso, @local_start_time, @local_end_time,
             @slot_duration_min, @booking_horizon_days, @effective_from, @effective_to,
             1, @actor_user_id);
        SET @working_schedule_id = SCOPE_IDENTITY();

        DECLARE @entity_id varchar(100) = CONVERT(varchar(100), @working_schedule_id);
        EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'WORKING_SCHEDULE_CREATED',
             'WORKING_SCHEDULE', @entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_generate_doctor_slots
    @actor_user_id bigint,
    @working_schedule_id bigint,
    @from_date_local date,
    @to_date_local date,
    @created_count int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    SET @created_count = 0;
    IF @to_date_local < @from_date_local OR DATEDIFF(DAY, @from_date_local, @to_date_local) > 366
        THROW 53103, N'Khoảng ngày sinh slot không hợp lệ hoặc vượt quá 366 ngày.', 1;

    DECLARE
        @doctor_id bigint, @branch_id bigint, @room_id bigint,
        @weekday_iso tinyint, @schedule_start time(0), @schedule_end time(0),
        @slot_duration smallint, @effective_from date, @effective_to date,
        @timezone_name sysname, @horizon smallint, @business_date date;

    SELECT
        @doctor_id = w.doctor_id, @branch_id = w.branch_id, @room_id = w.room_id,
        @weekday_iso = w.weekday_iso, @schedule_start = w.local_start_time,
        @schedule_end = w.local_end_time, @slot_duration = w.slot_duration_min,
        @effective_from = w.effective_from, @effective_to = w.effective_to,
        @timezone_name = b.timezone_name,
        @horizon = COALESCE(w.booking_horizon_days, b.booking_horizon_days)
    FROM dbo.doctor_working_schedules w
    JOIN dbo.branches b ON b.branch_id = w.branch_id
    WHERE w.working_schedule_id = @working_schedule_id AND w.is_active = 1;
    IF @doctor_id IS NULL THROW 53104, N'Ca làm việc không tồn tại hoặc đã ngừng.', 1;
    EXEC dbo.sp_assert_permission @actor_user_id, 'SCHEDULES_MANAGE', @branch_id;
    EXEC dbo.sp_get_branch_business_date @branch_id, NULL, @business_date OUTPUT;
    IF @from_date_local < @business_date
        THROW 53105, N'Không sinh slot cho ngày đã qua.', 1;
    IF @from_date_local < @effective_from
        SET @from_date_local = @effective_from;
    IF @effective_to IS NOT NULL AND @to_date_local > @effective_to
        SET @to_date_local = @effective_to;
    IF @to_date_local < @from_date_local RETURN;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @lock_result int;
        DECLARE @resource nvarchar(255) = CONCAT(N'slot-generator:', @working_schedule_id);
        EXEC @lock_result = sys.sp_getapplock
            @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=15000;
        IF @lock_result < 0 THROW 53106, N'Không thể khóa tác vụ sinh slot.', 1;

        DECLARE @work_date date = @from_date_local;
        WHILE @work_date <= @to_date_local
        BEGIN
            IF ((DATEDIFF(DAY, CONVERT(date,'19000101'), @work_date) % 7) + 1) = @weekday_iso
            BEGIN
                DECLARE @slot_start time(0) = @schedule_start;
                WHILE @slot_start < @schedule_end
                BEGIN
                    DECLARE @slot_end time(0) = CONVERT(time(0), DATEADD(MINUTE, @slot_duration, @slot_start));
                    IF @slot_end <= @slot_start OR @slot_end > @schedule_end BREAK;

                    DECLARE @local_start datetime2(0) = DATEADD(MINUTE,
                        DATEDIFF(MINUTE, CONVERT(time(0),'00:00'), @slot_start), CONVERT(datetime2(0), @work_date));
                    DECLARE @local_end datetime2(0) = DATEADD(MINUTE,
                        DATEDIFF(MINUTE, CONVERT(time(0),'00:00'), @slot_end), CONVERT(datetime2(0), @work_date));
                    DECLARE @starts_utc datetime2(3) =
                        CONVERT(datetime2(3), @local_start AT TIME ZONE @timezone_name AT TIME ZONE 'UTC');
                    DECLARE @ends_utc datetime2(3) =
                        CONVERT(datetime2(3), @local_end AT TIME ZONE @timezone_name AT TIME ZONE 'UTC');

                    IF NOT EXISTS
                    (
                        SELECT 1 FROM dbo.doctor_schedule_breaks b
                        WHERE b.working_schedule_id = @working_schedule_id
                          AND b.local_start_time < @slot_end AND b.local_end_time > @slot_start
                    )
                    AND NOT EXISTS
                    (
                        SELECT 1 FROM dbo.clinic_holidays h
                        WHERE h.branch_id = @branch_id AND h.holiday_date = @work_date
                          AND (h.is_closed_all_day = 1
                               OR (h.local_start_time < @slot_end AND h.local_end_time > @slot_start))
                    )
                    AND NOT EXISTS
                    (
                        SELECT 1 FROM dbo.doctor_time_off t
                        WHERE t.doctor_id = @doctor_id
                          AND (t.branch_id IS NULL OR t.branch_id = @branch_id)
                          AND t.status = 'APPROVED'
                          AND t.starts_at_utc < @ends_utc AND t.ends_at_utc > @starts_utc
                    )
                    AND NOT EXISTS
                    (
                        SELECT 1 FROM dbo.appointment_slots s WITH (UPDLOCK,HOLDLOCK)
                        WHERE s.doctor_id = @doctor_id
                          AND s.starts_at_utc < @ends_utc AND s.ends_at_utc > @starts_utc
                    )
                    BEGIN
                        INSERT dbo.appointment_slots
                            (working_schedule_id, doctor_id, branch_id, room_id,
                             service_date_local, start_time_local, end_time_local,
                             starts_at_utc, ends_at_utc, booking_opens_at_utc,
                             booking_closes_at_utc, status)
                        VALUES
                            (@working_schedule_id, @doctor_id, @branch_id, @room_id,
                             @work_date, @slot_start, @slot_end,
                             @starts_utc, @ends_utc, DATEADD(DAY, -@horizon, @starts_utc),
                             DATEADD(MINUTE, -5, @starts_utc), 'OPEN');
                        SET @created_count += 1;
                    END;
                    SET @slot_start = @slot_end;
                END;
            END;
            SET @work_date = DATEADD(DAY, 1, @work_date);
        END;

        DECLARE @slot_audit_id varchar(100) = CONVERT(varchar(100), @working_schedule_id);
        DECLARE @slot_audit_json nvarchar(max) = CONCAT(
            N'{"from":"', CONVERT(char(10), @from_date_local, 23),
            N'","to":"', CONVERT(char(10), @to_date_local, 23),
            N'","created":', @created_count, N'}');
        EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'APPOINTMENT_SLOTS_GENERATED',
             'WORKING_SCHEDULE', @slot_audit_id, NULL, @slot_audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_book_appointment
    @actor_user_id bigint,
    @patient_id bigint,
    @slot_id bigint,
    @service_id bigint,
    @booking_channel varchar(20),
    @chief_complaint nvarchar(1000) = NULL,
    @patient_note nvarchar(1000) = NULL,
    @idempotency_key uniqueidentifier,
    @appointment_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @booking_channel NOT IN ('ONLINE','PHONE','COUNTER')
        THROW 53107, N'Kênh đặt lịch không hợp lệ.', 1;

    DECLARE @branch_id bigint;
    SELECT @branch_id = branch_id FROM dbo.appointment_slots WHERE slot_id = @slot_id;
    IF @branch_id IS NULL THROW 53108, N'Slot không tồn tại.', 1;

    IF @booking_channel = 'ONLINE'
    BEGIN
        EXEC dbo.sp_assert_permission @actor_user_id, 'APPOINTMENTS_SELF', @branch_id;
        IF NOT EXISTS
        (
            SELECT 1 FROM dbo.user_patient_access
            WHERE user_id = @actor_user_id AND patient_id = @patient_id
              AND status = 'ACTIVE' AND is_booking_allowed = 1 AND revoked_at_utc IS NULL
        )
            THROW 53109, N'Tài khoản không được phép đặt lịch cho bệnh nhân này.', 1;
    END
    ELSE
        EXEC dbo.sp_assert_permission @actor_user_id, 'APPOINTMENTS_MANAGE', @branch_id;

    DECLARE @request_hash binary(32) = HASHBYTES('SHA2_256', CONCAT(
        @patient_id, '|', @slot_id, '|', @service_id, '|', @booking_channel, '|',
        COALESCE(@chief_complaint,N''), '|', COALESCE(@patient_note,N'')));

    BEGIN TRY
        BEGIN TRANSACTION;

        DECLARE @old_hash binary(32), @old_status varchar(20), @old_resource_id bigint;
        SELECT @old_hash = request_hash, @old_status = status, @old_resource_id = resource_id
        FROM dbo.idempotency_requests WITH (UPDLOCK,HOLDLOCK)
        WHERE actor_user_id = @actor_user_id AND operation_code = 'BOOK_APPOINTMENT'
          AND idempotency_key = @idempotency_key;
        IF @old_hash IS NOT NULL
        BEGIN
            IF @old_hash <> @request_hash
                THROW 53110, N'Idempotency key đã được dùng với payload khác.', 1;
            IF @old_status = 'COMPLETED'
            BEGIN
                SET @appointment_id = @old_resource_id;
                COMMIT TRANSACTION;
                RETURN;
            END;
            THROW 53111, N'Yêu cầu cùng idempotency key đang được xử lý.', 1;
        END;

        INSERT dbo.idempotency_requests
            (actor_user_id, operation_code, idempotency_key, request_hash, status, expires_at_utc)
        VALUES
            (@actor_user_id, 'BOOK_APPOINTMENT', @idempotency_key, @request_hash,
             'PROCESSING', DATEADD(DAY, 1, SYSUTCDATETIME()));

        DECLARE
            @doctor_id bigint, @room_id bigint, @slot_status varchar(20),
            @starts_utc datetime2(3), @ends_utc datetime2(3),
            @booking_opens datetime2(3), @booking_closes datetime2(3),
            @service_date date, @hold_minutes smallint, @timezone_name sysname;

        SELECT
            @doctor_id = s.doctor_id, @branch_id = s.branch_id, @room_id = s.room_id,
            @slot_status = s.status, @starts_utc = s.starts_at_utc, @ends_utc = s.ends_at_utc,
            @booking_opens = s.booking_opens_at_utc, @booking_closes = s.booking_closes_at_utc,
            @service_date = s.service_date_local, @hold_minutes = b.online_hold_minutes,
            @timezone_name = b.timezone_name
        FROM dbo.appointment_slots s WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.branches b ON b.branch_id = s.branch_id
        WHERE s.slot_id = @slot_id;

        UPDATE dbo.appointments
           SET status = 'EXPIRED', occupies_slot = 0, hold_expires_at_utc = NULL,
               updated_at_utc = SYSUTCDATETIME()
         WHERE slot_id = @slot_id AND status = 'PENDING'
           AND hold_expires_at_utc <= SYSUTCDATETIME();

        IF @slot_status IN ('BLOCKED','CANCELLED')
           OR EXISTS (SELECT 1 FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK)
                      WHERE slot_id = @slot_id AND occupies_slot = 1)
            THROW 53112, N'Slot đã được giữ/đặt hoặc không còn khả dụng.', 1;
        IF SYSUTCDATETIME() < @booking_opens OR SYSUTCDATETIME() >= @booking_closes
            THROW 53113, N'Ngoài cửa sổ cho phép đặt lịch.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.patients WITH (UPDLOCK,HOLDLOCK)
                       WHERE patient_id = @patient_id AND status = 'ACTIVE')
            THROW 53114, N'Bệnh nhân không tồn tại hoặc không hoạt động.', 1;
        IF @booking_channel = 'ONLINE'
           AND NOT EXISTS (SELECT 1 FROM dbo.doctors WHERE doctor_id = @doctor_id
                           AND is_active = 1 AND accepts_online_booking = 1)
            THROW 53115, N'Bác sĩ không nhận đặt lịch online.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.services WHERE service_id = @service_id AND is_active = 1)
           OR NOT EXISTS (SELECT 1 FROM dbo.doctor_services
                          WHERE doctor_id = @doctor_id AND service_id = @service_id AND is_active = 1)
            THROW 53116, N'Dịch vụ không hợp lệ hoặc bác sĩ không thực hiện dịch vụ.', 1;
        IF EXISTS
        (
            SELECT 1 FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK)
            WHERE patient_id = @patient_id AND occupies_slot = 1
              AND scheduled_start_utc < @ends_utc AND scheduled_end_utc > @starts_utc
        )
            THROW 53117, N'Bệnh nhân đã có lịch chồng thời gian.', 1;

        DECLARE @appointment_code varchar(40);
        EXEC dbo.sp_next_document_number
            @branch_id, 'APPOINTMENT', @service_date, 'LH', @appointment_code OUTPUT;

        IF @booking_channel = 'ONLINE'
        BEGIN
            INSERT dbo.appointments
                (appointment_code, branch_id, slot_id, patient_id, doctor_id, service_id,
                 booking_channel, status, scheduled_start_utc, scheduled_end_utc,
                 hold_expires_at_utc, chief_complaint, patient_note, booked_by_user_id, occupies_slot)
            VALUES
                (@appointment_code, @branch_id, @slot_id, @patient_id, @doctor_id, @service_id,
                 @booking_channel, 'PENDING', @starts_utc, @ends_utc,
                 DATEADD(MINUTE, @hold_minutes, SYSUTCDATETIME()), @chief_complaint,
                 @patient_note, @actor_user_id, 1);
        END
        ELSE
        BEGIN
            INSERT dbo.appointments
                (appointment_code, branch_id, slot_id, patient_id, doctor_id, service_id,
                 booking_channel, status, scheduled_start_utc, scheduled_end_utc,
                 hold_expires_at_utc, chief_complaint, patient_note, booked_by_user_id,
                 confirmed_by_user_id, confirmed_at_utc, occupies_slot)
            VALUES
                (@appointment_code, @branch_id, @slot_id, @patient_id, @doctor_id, @service_id,
                 @booking_channel, 'CONFIRMED', @starts_utc, @ends_utc,
                 NULL, @chief_complaint, @patient_note, @actor_user_id,
                 @actor_user_id, SYSUTCDATETIME(), 1);
        END;
        SET @appointment_id = SCOPE_IDENTITY();

        UPDATE dbo.idempotency_requests
           SET status = 'COMPLETED', resource_type = 'APPOINTMENT',
               resource_id = @appointment_id,
               response_json = CONCAT(N'{"appointment_id":', @appointment_id, N'}'),
               completed_at_utc = SYSUTCDATETIME()
         WHERE actor_user_id = @actor_user_id AND operation_code = 'BOOK_APPOINTMENT'
           AND idempotency_key = @idempotency_key;

        INSERT dbo.outbox_events (aggregate_type, aggregate_id, event_type, payload_json)
        VALUES ('APPOINTMENT', CONVERT(varchar(100), @appointment_id),
                'APPOINTMENT_CREATED', CONCAT(N'{"appointment_id":', @appointment_id, N'}'));

        DECLARE @booking_entity_id varchar(100) = CONVERT(varchar(100), @appointment_id);
        DECLARE @booking_json nvarchar(max) = CONCAT(N'{"channel":"', @booking_channel,
                                                      N'","slot_id":', @slot_id, N'}');
        EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'APPOINTMENT_BOOKED',
             'APPOINTMENT', @booking_entity_id, NULL, @booking_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_confirm_appointment
    @actor_user_id bigint,
    @appointment_id bigint
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id = branch_id FROM dbo.appointments WHERE appointment_id = @appointment_id;
    EXEC dbo.sp_assert_permission @actor_user_id, 'APPOINTMENTS_MANAGE', @branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20), @hold_expires datetime2(3);
        SELECT @status = status, @hold_expires = hold_expires_at_utc
        FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK)
        WHERE appointment_id = @appointment_id;
        IF @status IS NULL THROW 53118, N'Lịch hẹn không tồn tại.', 1;
        IF @status = 'CONFIRMED'
        BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status <> 'PENDING' THROW 53119, N'Chỉ xác nhận lịch đang PENDING.', 1;

        IF @hold_expires <= SYSUTCDATETIME()
        BEGIN
            UPDATE dbo.appointments
               SET status = 'EXPIRED', occupies_slot = 0, hold_expires_at_utc = NULL,
                   updated_at_utc = SYSUTCDATETIME()
             WHERE appointment_id = @appointment_id;
            DECLARE @expired_entity varchar(100) = CONVERT(varchar(100), @appointment_id);
            EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'APPOINTMENT_EXPIRED',
                 'APPOINTMENT', @expired_entity;
            COMMIT TRANSACTION;
            THROW 53120, N'Giữ chỗ đã hết hạn; lịch được chuyển sang EXPIRED.', 1;
        END;

        UPDATE dbo.appointments
           SET status = 'CONFIRMED', hold_expires_at_utc = NULL,
               confirmed_by_user_id = @actor_user_id, confirmed_at_utc = SYSUTCDATETIME(),
               updated_at_utc = SYSUTCDATETIME()
         WHERE appointment_id = @appointment_id;

        DECLARE @confirm_entity varchar(100) = CONVERT(varchar(100), @appointment_id);
        EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'APPOINTMENT_CONFIRMED',
             'APPOINTMENT', @confirm_entity;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_cancel_appointment
    @actor_user_id bigint,
    @appointment_id bigint,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)), N'') IS NULL
        THROW 53121, N'Bắt buộc nhập lý do hủy lịch.', 1;
    EXEC dbo.sp_assert_appointment_access @actor_user_id, @appointment_id, 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @branch_id bigint, @patient_id bigint, @status varchar(20),
                @starts_utc datetime2(3), @deadline int, @is_staff bit = 0;
        SELECT @branch_id = a.branch_id, @patient_id = a.patient_id, @status = a.status,
               @starts_utc = a.scheduled_start_utc, @deadline = b.cancellation_deadline_minutes
        FROM dbo.appointments a WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.branches b ON b.branch_id = a.branch_id
        WHERE a.appointment_id = @appointment_id;
        IF @status = 'CANCELLED' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status NOT IN ('PENDING','CONFIRMED')
            THROW 53122, N'Chỉ được hủy lịch PENDING hoặc CONFIRMED; lịch đã check-in phải hủy lượt khám.', 1;

        IF EXISTS
        (
            SELECT 1 FROM dbo.user_roles ur
            JOIN dbo.roles r ON r.role_id = ur.role_id
            LEFT JOIN dbo.role_permissions rp ON rp.role_id = r.role_id
            LEFT JOIN dbo.permissions p ON p.permission_id = rp.permission_id
            WHERE ur.user_id = @actor_user_id AND ur.is_active = 1
              AND (ur.branch_id IS NULL OR ur.branch_id = @branch_id)
              AND (r.role_code = 'ADMIN' OR p.permission_code = 'APPOINTMENTS_MANAGE')
        ) SET @is_staff = 1;

        IF @is_staff = 0 AND SYSUTCDATETIME() > DATEADD(MINUTE, -@deadline, @starts_utc)
            THROW 53123, N'Đã quá hạn tự hủy; vui lòng liên hệ phòng khám.', 1;

        UPDATE dbo.appointments
           SET status = 'CANCELLED', occupies_slot = 0, hold_expires_at_utc = NULL,
               cancelled_by_user_id = @actor_user_id, cancelled_at_utc = SYSUTCDATETIME(),
               cancellation_reason = @reason,
               cancellation_source = CASE WHEN @is_staff = 1 THEN 'STAFF' ELSE 'PATIENT' END,
               updated_at_utc = SYSUTCDATETIME()
         WHERE appointment_id = @appointment_id;

        DECLARE @cancel_entity varchar(100) = CONVERT(varchar(100), @appointment_id);
        DECLARE @cancel_json nvarchar(max) = CONCAT(N'{"reason":"', STRING_ESCAPE(@reason,'json'), N'"}');
        EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'APPOINTMENT_CANCELLED',
             'APPOINTMENT', @cancel_entity, NULL, @cancel_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_expire_appointment_holds
    @actor_user_id bigint,
    @expired_count int OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id, 'APPOINTMENTS_EXPIRE', NULL;
    SET @expired_count = 0;

    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.appointments WITH (UPDLOCK, READPAST)
           SET status = 'EXPIRED', occupies_slot = 0, hold_expires_at_utc = NULL,
               updated_at_utc = SYSUTCDATETIME()
         WHERE status = 'PENDING' AND hold_expires_at_utc <= SYSUTCDATETIME();
        SET @expired_count = @@ROWCOUNT;

        DECLARE @expire_json nvarchar(max) = CONCAT(N'{"expired_count":', @expired_count, N'}');
        EXEC dbo.sp_write_audit @actor_user_id, NULL, 'APPOINTMENT_HOLDS_EXPIRED',
             'SYSTEM_JOB', 'APPOINTMENT_HOLD_WORKER', NULL, @expire_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_reschedule_appointment
    @actor_user_id bigint,
    @appointment_id bigint,
    @new_slot_id bigint,
    @new_service_id bigint = NULL,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)), N'') IS NULL
        THROW 53124, N'Bắt buộc nhập lý do đổi lịch.', 1;
    EXEC dbo.sp_assert_appointment_access @actor_user_id, @appointment_id, 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @old_slot_id bigint, @old_doctor_id bigint, @old_service_id bigint,
                @patient_id bigint, @branch_id bigint, @status varchar(20), @channel varchar(20);
        SELECT @old_slot_id = slot_id, @old_doctor_id = doctor_id, @old_service_id = service_id,
               @patient_id = patient_id, @branch_id = branch_id, @status = status,
               @channel = booking_channel
        FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK)
        WHERE appointment_id = @appointment_id;
        IF @status NOT IN ('PENDING','CONFIRMED')
            THROW 53125, N'Chỉ được đổi lịch PENDING hoặc CONFIRMED.', 1;
        IF @new_slot_id = @old_slot_id
            THROW 53126, N'Slot mới phải khác slot hiện tại.', 1;
        IF @new_service_id IS NULL SET @new_service_id = @old_service_id;

        DECLARE @first_slot bigint = IIF(@old_slot_id < @new_slot_id, @old_slot_id, @new_slot_id);
        DECLARE @second_slot bigint = IIF(@old_slot_id < @new_slot_id, @new_slot_id, @old_slot_id);
        DECLARE @lock_result int, @resource nvarchar(255);
        SET @resource = CONCAT(N'appointment-slot:', @first_slot);
        EXEC @lock_result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
             @LockOwner='Transaction', @LockTimeout=10000;
        IF @lock_result < 0 THROW 53127, N'Không thể khóa slot thứ nhất.', 1;
        SET @resource = CONCAT(N'appointment-slot:', @second_slot);
        EXEC @lock_result = sys.sp_getapplock @Resource=@resource, @LockMode='Exclusive',
             @LockOwner='Transaction', @LockTimeout=10000;
        IF @lock_result < 0 THROW 53128, N'Không thể khóa slot thứ hai.', 1;

        DECLARE @new_doctor_id bigint, @new_branch_id bigint, @new_status varchar(20),
                @new_start datetime2(3), @new_end datetime2(3),
                @opens datetime2(3), @closes datetime2(3), @hold_minutes smallint;
        SELECT @new_doctor_id = s.doctor_id, @new_branch_id = s.branch_id,
               @new_status = s.status, @new_start = s.starts_at_utc, @new_end = s.ends_at_utc,
               @opens = s.booking_opens_at_utc, @closes = s.booking_closes_at_utc,
               @hold_minutes = b.online_hold_minutes
        FROM dbo.appointment_slots s WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.branches b ON b.branch_id = s.branch_id
        WHERE s.slot_id = @new_slot_id;
        IF @new_doctor_id IS NULL OR @new_branch_id <> @branch_id
            THROW 53129, N'Slot mới không tồn tại hoặc không cùng chi nhánh.', 1;
        IF @new_status <> 'OPEN'
           OR EXISTS (SELECT 1 FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK)
                      WHERE slot_id = @new_slot_id AND occupies_slot = 1)
            THROW 53130, N'Slot mới không còn khả dụng.', 1;
        IF SYSUTCDATETIME() < @opens OR SYSUTCDATETIME() >= @closes
            THROW 53131, N'Slot mới ngoài cửa sổ đặt lịch.', 1;
        IF NOT EXISTS (SELECT 1 FROM dbo.doctor_services
                       WHERE doctor_id = @new_doctor_id AND service_id = @new_service_id AND is_active = 1)
            THROW 53132, N'Bác sĩ mới không thực hiện dịch vụ đã chọn.', 1;
        IF EXISTS
        (
            SELECT 1 FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK)
            WHERE appointment_id <> @appointment_id AND patient_id = @patient_id
              AND occupies_slot = 1 AND scheduled_start_utc < @new_end
              AND scheduled_end_utc > @new_start
        )
            THROW 53133, N'Bệnh nhân có lịch khác chồng với slot mới.', 1;

        UPDATE dbo.appointments
           SET slot_id = @new_slot_id, doctor_id = @new_doctor_id,
               service_id = @new_service_id, scheduled_start_utc = @new_start,
               scheduled_end_utc = @new_end,
               hold_expires_at_utc = CASE WHEN @status = 'PENDING'
                                          THEN DATEADD(MINUTE,@hold_minutes,SYSUTCDATETIME()) END,
               updated_at_utc = SYSUTCDATETIME()
         WHERE appointment_id = @appointment_id;

        INSERT dbo.appointment_reschedule_history
            (appointment_id, old_slot_id, new_slot_id, old_doctor_id, new_doctor_id,
             old_service_id, new_service_id, reason, changed_by_user_id, request_id)
        VALUES
            (@appointment_id, @old_slot_id, @new_slot_id, @old_doctor_id, @new_doctor_id,
             @old_service_id, @new_service_id, @reason, @actor_user_id,
             TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'request_id')));

        DECLARE @reschedule_entity varchar(100) = CONVERT(varchar(100), @appointment_id);
        DECLARE @reschedule_json nvarchar(max) = CONCAT(N'{"old_slot_id":', @old_slot_id,
            N',"new_slot_id":', @new_slot_id, N',"reason":"', STRING_ESCAPE(@reason,'json'), N'"}');
        EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'APPOINTMENT_RESCHEDULED',
             'APPOINTMENT', @reschedule_entity, NULL, @reschedule_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_mark_appointment_no_show
    @actor_user_id bigint,
    @appointment_id bigint,
    @reason nvarchar(500) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id = branch_id FROM dbo.appointments WHERE appointment_id = @appointment_id;
    EXEC dbo.sp_assert_permission @actor_user_id, 'APPOINTMENTS_MANAGE', @branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20), @ends_at_utc datetime2(3);
        SELECT @status = status, @ends_at_utc = scheduled_end_utc
        FROM dbo.appointments WITH (UPDLOCK,HOLDLOCK) WHERE appointment_id = @appointment_id;
        IF @status = 'NO_SHOW' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status <> 'CONFIRMED' THROW 53134, N'Chỉ đánh dấu NO_SHOW cho lịch đã xác nhận.', 1;
        IF SYSUTCDATETIME() < @ends_at_utc THROW 53135, N'Chưa qua giờ kết thúc dự kiến của lịch.', 1;

        UPDATE dbo.appointments
           SET status = 'NO_SHOW', occupies_slot = 0, internal_note = COALESCE(@reason, internal_note),
               updated_at_utc = SYSUTCDATETIME()
         WHERE appointment_id = @appointment_id;
        DECLARE @entity_id varchar(100) = CONVERT(varchar(100), @appointment_id);
        EXEC dbo.sp_write_audit @actor_user_id, @branch_id, 'APPOINTMENT_NO_SHOW',
             'APPOINTMENT', @entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/*=============================================================================
  16. COMMAND PROCEDURES - CHECK-IN, WALK-IN, HÀNG ĐỢI VÀ LƯỢT KHÁM
=============================================================================*/

CREATE OR ALTER PROCEDURE dbo.sp_allocate_queue_ticket_internal
    @actor_user_id bigint,
    @encounter_id bigint,
    @queue_type varchar(20) = 'GENERAL',
    @priority_level tinyint = 0,
    @queue_ticket_id bigint OUTPUT,
    @display_number varchar(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF @@TRANCOUNT = 0
        THROW 53200, N'Bộ cấp số hàng đợi phải chạy trong transaction nghiệp vụ.', 1;
    IF @queue_type NOT IN ('GENERAL','PRIORITY','LAB','PHARMACY') OR @priority_level NOT BETWEEN 0 AND 9
        THROW 53201, N'Loại hoặc mức ưu tiên hàng đợi không hợp lệ.', 1;

    DECLARE @branch_id bigint, @status varchar(20), @arrived_at_utc datetime2(3), @business_date date;
    SELECT @branch_id = branch_id, @status = status, @arrived_at_utc = arrived_at_utc
    FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK) WHERE encounter_id = @encounter_id;
    IF @status <> 'WAITING' THROW 53202, N'Chỉ cấp số cho lượt khám đang WAITING.', 1;
    IF EXISTS (SELECT 1 FROM dbo.queue_tickets WHERE encounter_id = @encounter_id)
        THROW 53203, N'Lượt khám đã có số hàng đợi.', 1;
    EXEC dbo.sp_get_branch_business_date @branch_id, @arrived_at_utc, @business_date OUTPUT;

    DECLARE @lock_result int;
    DECLARE @resource nvarchar(255) = CONCAT(N'queue:', @branch_id, N':', CONVERT(char(8),@business_date,112), N':', @queue_type);
    EXEC @lock_result = sys.sp_getapplock
        @Resource=@resource, @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
    IF @lock_result < 0 THROW 53204, N'Không thể khóa bộ cấp số hàng đợi.', 1;

    DECLARE @session_id bigint, @prefix varchar(10) = CASE WHEN @queue_type='PRIORITY' THEN 'P' ELSE 'A' END;
    SELECT @session_id = queue_session_id, @prefix = prefix
    FROM dbo.queue_sessions WITH (UPDLOCK,HOLDLOCK)
    WHERE branch_id = @branch_id AND queue_date_local = @business_date AND queue_type = @queue_type;
    IF @session_id IS NULL
    BEGIN
        INSERT dbo.queue_sessions
            (branch_id, queue_date_local, queue_type, prefix, last_number, status)
        VALUES (@branch_id, @business_date, @queue_type, @prefix, 0, 'OPEN');
        SET @session_id = SCOPE_IDENTITY();
    END;

    IF NOT EXISTS (SELECT 1 FROM dbo.queue_sessions WHERE queue_session_id=@session_id AND status='OPEN')
        THROW 53205, N'Phiên hàng đợi đã đóng.', 1;

    DECLARE @number_output TABLE (queue_number int);
    UPDATE dbo.queue_sessions WITH (UPDLOCK,HOLDLOCK)
       SET last_number = last_number + 1
       OUTPUT inserted.last_number INTO @number_output(queue_number)
     WHERE queue_session_id = @session_id;
    DECLARE @queue_number int = (SELECT queue_number FROM @number_output);
    SET @display_number = CONCAT(@prefix, RIGHT('0000' + CONVERT(varchar(10), @queue_number), 4));

    INSERT dbo.queue_tickets
        (queue_session_id, encounter_id, queue_number, display_number,
         priority_level, status, called_by_user_id)
    VALUES
        (@session_id, @encounter_id, @queue_number, @display_number,
         @priority_level, 'WAITING', NULL);
    SET @queue_ticket_id = SCOPE_IDENTITY();
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_check_in_appointment
    @actor_user_id bigint,
    @appointment_id bigint,
    @priority_level tinyint = 0,
    @idempotency_key uniqueidentifier,
    @encounter_id bigint OUTPUT,
    @queue_ticket_id bigint OUTPUT,
    @display_number varchar(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id = branch_id FROM dbo.appointments WHERE appointment_id = @appointment_id;
    EXEC dbo.sp_assert_permission @actor_user_id, 'ENCOUNTERS_CREATE', @branch_id;
    DECLARE @request_hash binary(32) = HASHBYTES('SHA2_256', CONCAT(@appointment_id,'|',@priority_level));

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @old_hash binary(32), @old_state varchar(20), @old_resource bigint;
        SELECT @old_hash=request_hash, @old_state=status, @old_resource=resource_id
        FROM dbo.idempotency_requests WITH (UPDLOCK,HOLDLOCK)
        WHERE actor_user_id=@actor_user_id AND operation_code='CHECK_IN_APPOINTMENT'
          AND idempotency_key=@idempotency_key;
        IF @old_hash IS NOT NULL
        BEGIN
            IF @old_hash<>@request_hash THROW 53206, N'Idempotency key đã dùng với payload khác.', 1;
            IF @old_state='COMPLETED'
            BEGIN
                SET @encounter_id=@old_resource;
                SELECT @queue_ticket_id=queue_ticket_id,@display_number=display_number
                FROM dbo.queue_tickets WHERE encounter_id=@encounter_id;
                COMMIT TRANSACTION; RETURN;
            END;
            THROW 53207, N'Yêu cầu check-in đang được xử lý.', 1;
        END;
        INSERT dbo.idempotency_requests
            (actor_user_id,operation_code,idempotency_key,request_hash,status,expires_at_utc)
        VALUES (@actor_user_id,'CHECK_IN_APPOINTMENT',@idempotency_key,@request_hash,'PROCESSING',DATEADD(DAY,1,SYSUTCDATETIME()));

        DECLARE @status varchar(20), @patient_id bigint, @doctor_id bigint, @room_id bigint,
                @service_id bigint, @start_utc datetime2(3), @end_utc datetime2(3),
                @service_date date, @complaint nvarchar(1000);
        SELECT @status=a.status,@patient_id=a.patient_id,@doctor_id=a.doctor_id,
               @room_id=s.room_id,@service_id=a.service_id,@start_utc=a.scheduled_start_utc,
               @end_utc=a.scheduled_end_utc,@service_date=s.service_date_local,@complaint=a.chief_complaint
        FROM dbo.appointments a WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.appointment_slots s ON s.slot_id=a.slot_id
        WHERE a.appointment_id=@appointment_id;
        IF @status<>'CONFIRMED' THROW 53208, N'Chỉ check-in lịch CONFIRMED.', 1;
        IF SYSUTCDATETIME()<DATEADD(MINUTE,-120,@start_utc)
            THROW 53209, N'Bệnh nhân đến quá sớm so với cửa sổ check-in.', 1;
        IF SYSUTCDATETIME()>DATEADD(MINUTE,180,@end_utc)
            THROW 53210, N'Đã quá cửa sổ check-in; cần xử lý ngoại lệ tại quầy.', 1;
        IF EXISTS (SELECT 1 FROM dbo.encounters WHERE appointment_id=@appointment_id AND status<>'CANCELLED')
            THROW 53211, N'Lịch đã có lượt khám.', 1;

        DECLARE @encounter_code varchar(40);
        EXEC dbo.sp_next_document_number @branch_id,'ENCOUNTER',@service_date,'LK',@encounter_code OUTPUT;
        INSERT dbo.encounters
            (encounter_code,appointment_id,branch_id,patient_id,attending_doctor_id,room_id,
             encounter_source,status,arrived_at_utc,chief_complaint,created_by_user_id,
             occupies_appointment,is_in_progress)
        VALUES
            (@encounter_code,@appointment_id,@branch_id,@patient_id,@doctor_id,@room_id,
             'APPOINTMENT','WAITING',SYSUTCDATETIME(),@complaint,@actor_user_id,1,0);
        SET @encounter_id=SCOPE_IDENTITY();

        INSERT dbo.encounter_services
            (encounter_id,service_id,service_code_snapshot,service_name_snapshot,
             service_type_snapshot,quantity,unit_price_snapshot,status,ordered_by_user_id)
        SELECT @encounter_id,s.service_id,s.service_code,s.service_name,s.service_type,
               1,s.current_price,'ORDERED',@actor_user_id
        FROM dbo.services s WHERE s.service_id=@service_id;

        UPDATE dbo.appointments
           SET status='CHECKED_IN',updated_at_utc=SYSUTCDATETIME()
         WHERE appointment_id=@appointment_id;

        EXEC dbo.sp_allocate_queue_ticket_internal
            @actor_user_id,@encounter_id,'GENERAL',@priority_level,
            @queue_ticket_id OUTPUT,@display_number OUTPUT;

        UPDATE dbo.idempotency_requests
           SET status='COMPLETED',resource_type='ENCOUNTER',resource_id=@encounter_id,
               response_json=CONCAT(N'{"encounter_id":',@encounter_id,N'}'),completed_at_utc=SYSUTCDATETIME()
         WHERE actor_user_id=@actor_user_id AND operation_code='CHECK_IN_APPOINTMENT'
           AND idempotency_key=@idempotency_key;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"appointment_id":',@appointment_id,
                                                  N',"queue":"',@display_number,N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'APPOINTMENT_CHECKED_IN',
             'ENCOUNTER',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_create_walk_in_encounter
    @actor_user_id bigint,
    @branch_id bigint,
    @patient_id bigint,
    @doctor_id bigint,
    @room_id bigint,
    @service_id bigint,
    @chief_complaint nvarchar(1000) = NULL,
    @priority_level tinyint = 0,
    @idempotency_key uniqueidentifier,
    @encounter_id bigint OUTPUT,
    @queue_ticket_id bigint OUTPUT,
    @display_number varchar(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CREATE',@branch_id;
    DECLARE @request_hash binary(32)=HASHBYTES('SHA2_256',CONCAT(
        @branch_id,'|',@patient_id,'|',@doctor_id,'|',@room_id,'|',@service_id,'|',
        COALESCE(@chief_complaint,N''),'|',@priority_level));

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @old_hash binary(32),@old_state varchar(20),@old_resource bigint;
        SELECT @old_hash=request_hash,@old_state=status,@old_resource=resource_id
        FROM dbo.idempotency_requests WITH (UPDLOCK,HOLDLOCK)
        WHERE actor_user_id=@actor_user_id AND operation_code='CREATE_WALK_IN'
          AND idempotency_key=@idempotency_key;
        IF @old_hash IS NOT NULL
        BEGIN
            IF @old_hash<>@request_hash THROW 53212,N'Idempotency key đã dùng với payload khác.',1;
            IF @old_state='COMPLETED'
            BEGIN
                SET @encounter_id=@old_resource;
                SELECT @queue_ticket_id=queue_ticket_id,@display_number=display_number
                FROM dbo.queue_tickets WHERE encounter_id=@encounter_id;
                COMMIT TRANSACTION; RETURN;
            END;
            THROW 53213,N'Yêu cầu walk-in đang được xử lý.',1;
        END;
        INSERT dbo.idempotency_requests
            (actor_user_id,operation_code,idempotency_key,request_hash,status,expires_at_utc)
        VALUES (@actor_user_id,'CREATE_WALK_IN',@idempotency_key,@request_hash,'PROCESSING',DATEADD(DAY,1,SYSUTCDATETIME()));

        IF NOT EXISTS (SELECT 1 FROM dbo.patients WITH (UPDLOCK,HOLDLOCK)
                       WHERE patient_id=@patient_id AND status='ACTIVE')
            THROW 53214,N'Bệnh nhân không hợp lệ.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.rooms WHERE room_id=@room_id AND branch_id=@branch_id AND is_active=1)
            THROW 53215,N'Phòng không thuộc chi nhánh hoặc ngừng hoạt động.',1;
        IF NOT EXISTS
        (
            SELECT 1 FROM dbo.doctor_branch_assignments a
            JOIN dbo.doctors d ON d.doctor_id=a.doctor_id AND d.is_active=1
            WHERE a.doctor_id=@doctor_id AND a.branch_id=@branch_id AND a.is_active=1
        ) THROW 53216,N'Bác sĩ không được phân công tại chi nhánh.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.doctor_services
                       WHERE doctor_id=@doctor_id AND service_id=@service_id AND is_active=1)
            THROW 53217,N'Bác sĩ không thực hiện dịch vụ.',1;

        DECLARE @business_date date;
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        DECLARE @encounter_code varchar(40);
        EXEC dbo.sp_next_document_number @branch_id,'ENCOUNTER',@business_date,'LK',@encounter_code OUTPUT;
        INSERT dbo.encounters
            (encounter_code,appointment_id,branch_id,patient_id,attending_doctor_id,room_id,
             encounter_source,status,arrived_at_utc,chief_complaint,created_by_user_id,
             occupies_appointment,is_in_progress)
        VALUES
            (@encounter_code,NULL,@branch_id,@patient_id,@doctor_id,@room_id,
             'WALK_IN','WAITING',SYSUTCDATETIME(),@chief_complaint,@actor_user_id,1,0);
        SET @encounter_id=SCOPE_IDENTITY();

        INSERT dbo.encounter_services
            (encounter_id,service_id,service_code_snapshot,service_name_snapshot,
             service_type_snapshot,quantity,unit_price_snapshot,status,ordered_by_user_id)
        SELECT @encounter_id,s.service_id,s.service_code,s.service_name,s.service_type,
               1,s.current_price,'ORDERED',@actor_user_id
        FROM dbo.services s WHERE s.service_id=@service_id AND s.is_active=1;
        IF @@ROWCOUNT=0 THROW 53218,N'Dịch vụ không tồn tại hoặc đã ngừng.',1;

        EXEC dbo.sp_allocate_queue_ticket_internal
            @actor_user_id,@encounter_id,'GENERAL',@priority_level,
            @queue_ticket_id OUTPUT,@display_number OUTPUT;

        UPDATE dbo.idempotency_requests
           SET status='COMPLETED',resource_type='ENCOUNTER',resource_id=@encounter_id,
               response_json=CONCAT(N'{"encounter_id":',@encounter_id,N'}'),completed_at_utc=SYSUTCDATETIME()
         WHERE actor_user_id=@actor_user_id AND operation_code='CREATE_WALK_IN'
           AND idempotency_key=@idempotency_key;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"source":"WALK_IN","queue":"',@display_number,N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'WALK_IN_ENCOUNTER_CREATED',
             'ENCOUNTER',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_call_next_queue_ticket
    @actor_user_id bigint,
    @branch_id bigint,
    @queue_type varchar(20)='GENERAL',
    @queue_ticket_id bigint OUTPUT,
    @encounter_id bigint OUTPUT,
    @display_number varchar(20) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    EXEC dbo.sp_assert_permission @actor_user_id,'QUEUE_MANAGE',@branch_id;
    SET @queue_ticket_id=NULL; SET @encounter_id=NULL; SET @display_number=NULL;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @business_date date;
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        SELECT TOP (1)
            @queue_ticket_id=qt.queue_ticket_id,@encounter_id=qt.encounter_id,
            @display_number=qt.display_number
        FROM dbo.queue_tickets qt WITH (UPDLOCK,READPAST,ROWLOCK)
        JOIN dbo.queue_sessions qs ON qs.queue_session_id=qt.queue_session_id
        JOIN dbo.encounters e ON e.encounter_id=qt.encounter_id AND e.status='WAITING'
        WHERE qs.branch_id=@branch_id AND qs.queue_date_local=@business_date
          AND qs.queue_type=@queue_type AND qs.status='OPEN' AND qt.status='WAITING'
        ORDER BY qt.priority_level DESC,qt.issued_at_utc,qt.queue_number;

        IF @queue_ticket_id IS NOT NULL
        BEGIN
            UPDATE dbo.queue_tickets
               SET status='CALLED',called_at_utc=SYSUTCDATETIME(),called_by_user_id=@actor_user_id
             WHERE queue_ticket_id=@queue_ticket_id;
            DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@queue_ticket_id);
            EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'QUEUE_TICKET_CALLED',
                 'QUEUE_TICKET',@entity_id;
        END;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_start_encounter
    @actor_user_id bigint,
    @encounter_id bigint,
    @room_id bigint = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=e.branch_id,@doctor_id=e.attending_doctor_id,@doctor_user_id=emp.user_id
    FROM dbo.encounters e
    JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id
    WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CLINICAL',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53219,N'Chỉ bác sĩ phụ trách có tài khoản đã liên kết mới được bắt đầu lượt khám.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20),@appointment_id bigint,@current_room bigint;
        SELECT @status=status,@appointment_id=appointment_id,@current_room=room_id
        FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK) WHERE encounter_id=@encounter_id;
        IF @status='IN_PROGRESS' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status<>'WAITING' THROW 53220,N'Chỉ bắt đầu lượt khám đang WAITING.',1;
        IF @room_id IS NULL SET @room_id=@current_room;
        IF @room_id IS NULL OR NOT EXISTS
           (SELECT 1 FROM dbo.rooms WHERE room_id=@room_id AND branch_id=@branch_id AND is_active=1)
            THROW 53221,N'Phòng khám không hợp lệ.',1;

        INSERT dbo.encounter_staff_assignments
            (encounter_id,employee_id,assignment_role)
        SELECT @encounter_id,d.employee_id,'ATTENDING_DOCTOR'
        FROM dbo.doctors d WHERE d.doctor_id=@doctor_id
          AND NOT EXISTS (SELECT 1 FROM dbo.encounter_staff_assignments x
                          WHERE x.encounter_id=@encounter_id AND x.employee_id=d.employee_id
                            AND x.assignment_role='ATTENDING_DOCTOR' AND x.ended_at_utc IS NULL);

        UPDATE dbo.queue_tickets
           SET status='SERVING',service_started_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND status IN ('WAITING','CALLED');
        IF @appointment_id IS NOT NULL
            UPDATE dbo.appointments SET status='IN_PROGRESS',updated_at_utc=SYSUTCDATETIME()
            WHERE appointment_id=@appointment_id AND status='CHECKED_IN';
        UPDATE dbo.encounters
           SET status='IN_PROGRESS',is_in_progress=1,room_id=@room_id,
               started_at_utc=SYSUTCDATETIME(),updated_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_STARTED','ENCOUNTER',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_update_encounter_clinical_notes
    @actor_user_id bigint,
    @encounter_id bigint,
    @history_of_present_illness nvarchar(max)=NULL,
    @physical_examination nvarchar(max)=NULL,
    @clinical_assessment nvarchar(max)=NULL,
    @treatment_plan nvarchar(max)=NULL,
    @follow_up_instructions nvarchar(max)=NULL,
    @follow_up_date date=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=e.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.encounters e JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CLINICAL',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53222,N'Chỉ bác sĩ phụ trách được ghi nội dung khám.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.encounters WITH (UPDLOCK,HOLDLOCK)
           SET history_of_present_illness=@history_of_present_illness,
               physical_examination=@physical_examination,
               clinical_assessment=@clinical_assessment,treatment_plan=@treatment_plan,
               follow_up_instructions=@follow_up_instructions,follow_up_date=@follow_up_date,
               updated_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND status='IN_PROGRESS';
        IF @@ROWCOUNT=0 THROW 53223,N'Lượt khám không ở trạng thái IN_PROGRESS.',1;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_CLINICAL_UPDATED','ENCOUNTER',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_add_vital_signs
    @actor_user_id bigint,
    @encounter_id bigint,
    @temperature_c decimal(4,1)=NULL,
    @pulse_bpm smallint=NULL,
    @respiratory_rate_bpm smallint=NULL,
    @systolic_bp_mmhg smallint=NULL,
    @diastolic_bp_mmhg smallint=NULL,
    @spo2_percent decimal(5,2)=NULL,
    @height_cm decimal(6,2)=NULL,
    @weight_kg decimal(6,2)=NULL,
    @pain_score tinyint=NULL,
    @notes nvarchar(500)=NULL,
    @vital_sign_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.encounters WHERE encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CLINICAL',@branch_id;
    IF NOT EXISTS
    (
        SELECT 1 FROM dbo.employees emp
        LEFT JOIN dbo.doctors d ON d.employee_id=emp.employee_id
        JOIN dbo.encounters e ON e.encounter_id=@encounter_id
        WHERE emp.user_id=@actor_user_id AND emp.is_active=1
          AND (emp.primary_branch_id=@branch_id OR d.doctor_id=e.attending_doctor_id)
    ) THROW 53224,N'Người dùng không phải nhân sự lâm sàng hợp lệ tại chi nhánh.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK)
                       WHERE encounter_id=@encounter_id AND status IN ('WAITING','IN_PROGRESS'))
            THROW 53225,N'Lượt khám không cho phép ghi sinh hiệu.',1;
        INSERT dbo.encounter_vital_signs
            (encounter_id,temperature_c,pulse_bpm,respiratory_rate_bpm,systolic_bp_mmhg,
             diastolic_bp_mmhg,spo2_percent,height_cm,weight_kg,pain_score,notes,measured_by_user_id)
        VALUES
            (@encounter_id,@temperature_c,@pulse_bpm,@respiratory_rate_bpm,@systolic_bp_mmhg,
             @diastolic_bp_mmhg,@spo2_percent,@height_cm,@weight_kg,@pain_score,@notes,@actor_user_id);
        SET @vital_sign_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@vital_sign_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'VITAL_SIGNS_ADDED','VITAL_SIGN',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_add_encounter_diagnosis
    @actor_user_id bigint,
    @encounter_id bigint,
    @diagnosis_catalog_id bigint=NULL,
    @diagnosis_code varchar(30),
    @diagnosis_name nvarchar(500),
    @diagnosis_type varchar(20)='FINAL',
    @is_primary bit=0,
    @notes nvarchar(1000)=NULL,
    @encounter_diagnosis_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=e.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.encounters e JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CLINICAL',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53226,N'Chỉ bác sĩ phụ trách được ghi chẩn đoán.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK)
                       WHERE encounter_id=@encounter_id AND status='IN_PROGRESS')
            THROW 53227,N'Lượt khám không ở trạng thái IN_PROGRESS.',1;
        IF @is_primary=1 AND EXISTS (SELECT 1 FROM dbo.encounter_diagnoses WITH (UPDLOCK,HOLDLOCK)
                                    WHERE encounter_id=@encounter_id AND is_primary=1)
            THROW 53228,N'Lượt khám đã có chẩn đoán chính.',1;
        IF @diagnosis_catalog_id IS NOT NULL
        BEGIN
            SELECT @diagnosis_code=diagnosis_code,@diagnosis_name=diagnosis_name
            FROM dbo.diagnosis_catalog WHERE diagnosis_catalog_id=@diagnosis_catalog_id AND is_active=1;
            IF @@ROWCOUNT=0 THROW 53229,N'Mã chẩn đoán danh mục không hợp lệ.',1;
        END;
        INSERT dbo.encounter_diagnoses
            (encounter_id,diagnosis_catalog_id,diagnosis_code_snapshot,diagnosis_name_snapshot,
             diagnosis_type,is_primary,notes,recorded_by_user_id)
        VALUES
            (@encounter_id,@diagnosis_catalog_id,@diagnosis_code,@diagnosis_name,
             @diagnosis_type,@is_primary,@notes,@actor_user_id);
        SET @encounter_diagnosis_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_diagnosis_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_DIAGNOSIS_ADDED',
             'ENCOUNTER_DIAGNOSIS',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_order_encounter_service
    @actor_user_id bigint,
    @encounter_id bigint,
    @service_id bigint,
    @quantity decimal(12,3)=1,
    @discount_amount decimal(19,2)=0,
    @notes nvarchar(1000)=NULL,
    @encounter_service_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=e.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.encounters e JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CLINICAL',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53230,N'Chỉ bác sĩ phụ trách được chỉ định dịch vụ.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK)
                       WHERE encounter_id=@encounter_id AND status='IN_PROGRESS')
            THROW 53231,N'Lượt khám không ở trạng thái IN_PROGRESS.',1;
        INSERT dbo.encounter_services
            (encounter_id,service_id,service_code_snapshot,service_name_snapshot,
             service_type_snapshot,quantity,unit_price_snapshot,discount_amount,
             status,ordered_by_user_id,notes)
        SELECT @encounter_id,s.service_id,s.service_code,s.service_name,s.service_type,
               @quantity,s.current_price,@discount_amount,'ORDERED',@actor_user_id,@notes
        FROM dbo.services s WHERE s.service_id=@service_id AND s.is_active=1;
        IF @@ROWCOUNT=0 THROW 53232,N'Dịch vụ không tồn tại hoặc đã ngừng.',1;
        SET @encounter_service_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_service_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_SERVICE_ORDERED',
             'ENCOUNTER_SERVICE',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_finalize_service_result
    @actor_user_id bigint,
    @encounter_service_id bigint,
    @summary nvarchar(max)=NULL,
    @conclusion nvarchar(max)=NULL,
    @result_json nvarchar(max)=NULL,
    @service_result_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @result_json IS NOT NULL AND ISJSON(@result_json)<>1
        THROW 53233,N'result_json không hợp lệ.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=e.branch_id
    FROM dbo.encounter_services es JOIN dbo.encounters e ON e.encounter_id=es.encounter_id
    WHERE es.encounter_service_id=@encounter_service_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CLINICAL',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @encounter_id bigint,@service_status varchar(20),@encounter_status varchar(20);
        SELECT @encounter_id=es.encounter_id,@service_status=es.status,@encounter_status=e.status
        FROM dbo.encounter_services es WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.encounters e WITH (UPDLOCK,HOLDLOCK) ON e.encounter_id=es.encounter_id
        WHERE es.encounter_service_id=@encounter_service_id;
        IF @encounter_status<>'IN_PROGRESS' OR @service_status NOT IN ('ORDERED','IN_PROGRESS')
            THROW 53234,N'Lượt khám hoặc dịch vụ không cho phép chốt kết quả.',1;
        IF EXISTS (SELECT 1 FROM dbo.service_results WHERE encounter_service_id=@encounter_service_id)
            THROW 53235,N'Dịch vụ đã có phiên bản kết quả.',1;

        INSERT dbo.service_results
            (encounter_service_id,result_version,status,summary,conclusion,result_json,
             entered_by_user_id,verified_by_user_id,verified_at_utc)
        VALUES
            (@encounter_service_id,1,'FINAL',@summary,@conclusion,@result_json,
             @actor_user_id,@actor_user_id,SYSUTCDATETIME());
        SET @service_result_id=SCOPE_IDENTITY();
        UPDATE dbo.encounter_services
           SET status='COMPLETED',performed_by_user_id=@actor_user_id,
               performed_at_utc=SYSUTCDATETIME()
         WHERE encounter_service_id=@encounter_service_id;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@service_result_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'SERVICE_RESULT_FINALIZED',
             'SERVICE_RESULT',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_complete_encounter
    @actor_user_id bigint,
    @encounter_id bigint
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=e.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.encounters e JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CLINICAL',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53236,N'Chỉ bác sĩ phụ trách được hoàn tất lượt khám.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20),@appointment_id bigint;
        SELECT @status=status,@appointment_id=appointment_id
        FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK) WHERE encounter_id=@encounter_id;
        IF @status='COMPLETED' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status<>'IN_PROGRESS' THROW 53237,N'Lượt khám không ở trạng thái IN_PROGRESS.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounter_diagnoses WITH (UPDLOCK,HOLDLOCK)
                       WHERE encounter_id=@encounter_id AND is_primary=1)
            THROW 53238,N'Phải có một chẩn đoán chính trước khi hoàn tất.',1;

        UPDATE dbo.encounter_services
           SET status='COMPLETED',performed_by_user_id=@actor_user_id,performed_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND service_type_snapshot='CONSULTATION'
           AND status IN ('ORDERED','IN_PROGRESS');
        IF EXISTS (SELECT 1 FROM dbo.encounter_services
                   WHERE encounter_id=@encounter_id AND status IN ('ORDERED','IN_PROGRESS'))
            THROW 53239,N'Còn dịch vụ chưa hoàn tất hoặc chưa hủy.',1;
        IF EXISTS (SELECT 1 FROM dbo.prescriptions
                   WHERE encounter_id=@encounter_id AND status='DRAFT')
            THROW 53240,N'Còn đơn thuốc DRAFT; hãy phát hành hoặc hủy trước khi hoàn tất.',1;

        UPDATE dbo.encounter_staff_assignments
           SET ended_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND ended_at_utc IS NULL;
        UPDATE dbo.queue_tickets
           SET status='COMPLETED',completed_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND status IN ('WAITING','CALLED','SERVING');
        IF @appointment_id IS NOT NULL
            UPDATE dbo.appointments
               SET status='COMPLETED',occupies_slot=0,updated_at_utc=SYSUTCDATETIME()
             WHERE appointment_id=@appointment_id AND status='IN_PROGRESS';
        UPDATE dbo.encounters
           SET status='COMPLETED',is_in_progress=0,completed_at_utc=SYSUTCDATETIME(),
               updated_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_COMPLETED','ENCOUNTER',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_sign_encounter
    @actor_user_id bigint,
    @encounter_id bigint,
    @signature_type varchar(30)='HASH_ATTESTATION',
    @signature_algorithm varchar(50)=NULL,
    @signature_value varbinary(max)=NULL,
    @certificate_thumbprint varchar(128)=NULL,
    @payload_sha256 binary(32) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=e.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.encounters e JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_SIGN',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53241,N'Chỉ bác sĩ phụ trách có tài khoản liên kết mới được ký.',1;
    IF @signature_type NOT IN ('HASH_ATTESTATION','DIGITAL_SIGNATURE')
        THROW 53242,N'Loại chữ ký không hợp lệ.',1;
    IF @signature_type='DIGITAL_SIGNATURE'
       AND (@signature_value IS NULL OR @signature_algorithm IS NULL OR @certificate_thumbprint IS NULL)
        THROW 53243,N'Chữ ký số thiếu giá trị, thuật toán hoặc certificate thumbprint.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20),@base_material nvarchar(max);
        SELECT @status=status,
               @base_material=CONCAT(encounter_id,'|',encounter_code,'|',branch_id,'|',patient_id,'|',
                    attending_doctor_id,'|',CONVERT(varchar(33),arrived_at_utc,126),'|',
                    CONVERT(varchar(33),started_at_utc,126),'|',CONVERT(varchar(33),completed_at_utc,126),'|',
                    COALESCE(chief_complaint,N''),'|',COALESCE(history_of_present_illness,N''),'|',
                    COALESCE(physical_examination,N''),'|',COALESCE(clinical_assessment,N''),'|',
                    COALESCE(treatment_plan,N''),'|',COALESCE(follow_up_instructions,N''),'|',
                    COALESCE(CONVERT(char(10),follow_up_date,23),''))
        FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK) WHERE encounter_id=@encounter_id;
        IF @status='SIGNED'
        BEGIN
            SELECT @payload_sha256=payload_sha256 FROM dbo.encounter_signatures WHERE encounter_id=@encounter_id;
            COMMIT TRANSACTION; RETURN;
        END;
        IF @status<>'COMPLETED' THROW 53244,N'Chỉ ký lượt khám đã COMPLETED.',1;
        IF EXISTS (SELECT 1 FROM dbo.encounter_services
                   WHERE encounter_id=@encounter_id AND status NOT IN ('COMPLETED','CANCELLED'))
            THROW 53245,N'Còn dịch vụ chưa chốt.',1;
        IF EXISTS
        (
            SELECT 1 FROM dbo.service_results sr
            JOIN dbo.encounter_services es ON es.encounter_service_id=sr.encounter_service_id
            WHERE es.encounter_id=@encounter_id AND sr.status IN ('DRAFT','PRELIMINARY')
        ) THROW 53246,N'Còn kết quả DRAFT/PRELIMINARY.',1;
        IF EXISTS (SELECT 1 FROM dbo.prescriptions WHERE encounter_id=@encounter_id AND status='DRAFT')
            THROW 53247,N'Còn đơn thuốc DRAFT.',1;

        DECLARE @vital_material nvarchar(max),@diagnosis_material nvarchar(max),
                @service_material nvarchar(max),@result_material nvarchar(max),
                @rx_material nvarchar(max),@attachment_material nvarchar(max),
                @staff_material nvarchar(max);

        SELECT @vital_material=STRING_AGG(CONVERT(nvarchar(max),CONCAT(
            vital_sign_id,':',CONVERT(varchar(33),measured_at_utc,126),':',
            COALESCE(CONVERT(varchar(30),temperature_c),''),':',COALESCE(CONVERT(varchar(30),pulse_bpm),''),':',
            COALESCE(CONVERT(varchar(30),respiratory_rate_bpm),''),':',COALESCE(CONVERT(varchar(30),systolic_bp_mmhg),''),':',
            COALESCE(CONVERT(varchar(30),diastolic_bp_mmhg),''),':',COALESCE(CONVERT(varchar(30),spo2_percent),''),':',
            COALESCE(CONVERT(varchar(30),height_cm),''),':',COALESCE(CONVERT(varchar(30),weight_kg),''),':',
            COALESCE(CONVERT(varchar(30),pain_score),''),':',COALESCE(notes,N''))),N'||')
            WITHIN GROUP (ORDER BY vital_sign_id)
        FROM dbo.encounter_vital_signs WHERE encounter_id=@encounter_id;
        SELECT @diagnosis_material=STRING_AGG(CONVERT(nvarchar(max),CONCAT(
            encounter_diagnosis_id,':',diagnosis_code_snapshot,':',diagnosis_name_snapshot,':',
            diagnosis_type,':',is_primary,':',COALESCE(notes,N''))),N'||')
            WITHIN GROUP (ORDER BY encounter_diagnosis_id)
        FROM dbo.encounter_diagnoses WHERE encounter_id=@encounter_id;

        SELECT @service_material=STRING_AGG(CONVERT(nvarchar(max),CONCAT(
            encounter_service_id,':',service_code_snapshot,':',service_name_snapshot,':',
            quantity,':',unit_price_snapshot,':',discount_amount,':',status)),N'||')
            WITHIN GROUP (ORDER BY encounter_service_id)
        FROM dbo.encounter_services WHERE encounter_id=@encounter_id;

        SELECT @result_material=STRING_AGG(CONVERT(nvarchar(max),CONCAT(
            sr.service_result_id,':',sr.encounter_service_id,':',sr.result_version,':',sr.status,':',
            COALESCE(sr.summary,N''),':',COALESCE(sr.conclusion,N''),':',COALESCE(sr.result_json,N''),':',
            COALESCE(CONVERT(varchar(30),rv.service_result_value_id),''),':',COALESCE(rv.item_code,''),':',
            COALESCE(rv.item_name,N''),':',COALESCE(rv.value_text,N''),':',
            COALESCE(CONVERT(varchar(60),rv.value_numeric),''),':',COALESCE(rv.unit,N''),':',
            COALESCE(rv.reference_range,N''),':',COALESCE(rv.abnormal_flag,''))),N'||')
            WITHIN GROUP (ORDER BY sr.service_result_id,rv.service_result_value_id)
        FROM dbo.service_results sr
        JOIN dbo.encounter_services es ON es.encounter_service_id=sr.encounter_service_id
        LEFT JOIN dbo.service_result_values rv ON rv.service_result_id=sr.service_result_id
        WHERE es.encounter_id=@encounter_id;

        SELECT @rx_material=STRING_AGG(CONVERT(nvarchar(max),CONCAT(
            p.prescription_id,':',p.prescription_code,':',p.status,':',pi.prescription_item_id,':',
            pi.medicine_id,':',pi.prescribed_quantity,':',pi.dose,':',pi.frequency,':',pi.usage_instruction)),N'||')
            WITHIN GROUP (ORDER BY p.prescription_id,pi.prescription_item_id)
        FROM dbo.prescriptions p JOIN dbo.prescription_items pi ON pi.prescription_id=p.prescription_id
        WHERE p.encounter_id=@encounter_id;

        SELECT @attachment_material=STRING_AGG(CONVERT(nvarchar(max),CONCAT(
            medical_attachment_id,':',storage_key,':',CONVERT(varchar(64),sha256_hash,2))),N'||')
            WITHIN GROUP (ORDER BY medical_attachment_id)
        FROM dbo.medical_attachments WHERE encounter_id=@encounter_id;

        SELECT @staff_material=STRING_AGG(CONVERT(nvarchar(max),CONCAT(
            encounter_staff_assignment_id,':',employee_id,':',assignment_role,':',
            CONVERT(varchar(33),assigned_at_utc,126),':',COALESCE(CONVERT(varchar(33),ended_at_utc,126),''))),N'||')
            WITHIN GROUP (ORDER BY encounter_staff_assignment_id)
        FROM dbo.encounter_staff_assignments WHERE encounter_id=@encounter_id;

        DECLARE @canonical nvarchar(max)=CONCAT(N'CLINIC_RECORD_V2|',@base_material,
            N'|VT|',COALESCE(@vital_material,N''),N'|DX|',COALESCE(@diagnosis_material,N''),
            N'|SV|',COALESCE(@service_material,N''),N'|RS|',COALESCE(@result_material,N''),
            N'|RX|',COALESCE(@rx_material,N''),N'|AT|',COALESCE(@attachment_material,N''),
            N'|ST|',COALESCE(@staff_material,N''));
        SET @payload_sha256=HASHBYTES('SHA2_256',@canonical);

        UPDATE dbo.encounters
           SET status='SIGNED',signed_at_utc=SYSUTCDATETIME(),signed_by_user_id=@actor_user_id,
               updated_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id;
        INSERT dbo.encounter_signatures
            (encounter_id,canonical_schema_version,payload_sha256,signature_type,
             signature_algorithm,signature_value,certificate_thumbprint,signed_by_user_id)
        VALUES
            (@encounter_id,'CLINIC_RECORD_V2',@payload_sha256,@signature_type,
             @signature_algorithm,@signature_value,@certificate_thumbprint,@actor_user_id);

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"sha256":"',CONVERT(varchar(64),@payload_sha256,2),
                                                 N'","signature_type":"',@signature_type,N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_SIGNED','ENCOUNTER',
             @entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_add_encounter_amendment
    @actor_user_id bigint,
    @encounter_id bigint,
    @reason nvarchar(1000),
    @amendment_content nvarchar(max),
    @signature_algorithm varchar(50)=NULL,
    @signature_value varbinary(max)=NULL,
    @encounter_amendment_id bigint OUTPUT,
    @amendment_hash binary(32) OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL OR NULLIF(LTRIM(RTRIM(@amendment_content)),N'') IS NULL
        THROW 53248,N'Lý do và nội dung phụ lục là bắt buộc.',1;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=e.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.encounters e JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_AMEND',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53249,N'Chỉ bác sĩ đã ký hồ sơ được thêm phụ lục.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK)
                       WHERE encounter_id=@encounter_id AND status='SIGNED' AND signed_by_user_id=@actor_user_id)
            THROW 53250,N'Hồ sơ chưa ký hoặc không do người dùng này ký.',1;
        DECLARE @lock_result int,@resource nvarchar(255)=CONCAT(N'encounter-amendment:',@encounter_id);
        EXEC @lock_result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',
             @LockOwner='Transaction',@LockTimeout=10000;
        IF @lock_result<0 THROW 53251,N'Không thể khóa chuỗi phụ lục.',1;

        DECLARE @amendment_no int,@previous_hash binary(32),@amended_at datetime2(3)=SYSUTCDATETIME();
        SELECT TOP(1) @amendment_no=amendment_no+1,@previous_hash=amendment_hash
        FROM dbo.encounter_amendments WITH (UPDLOCK,HOLDLOCK)
        WHERE encounter_id=@encounter_id ORDER BY amendment_no DESC;
        IF @amendment_no IS NULL
        BEGIN
            SET @amendment_no=1;
            SELECT @previous_hash=payload_sha256 FROM dbo.encounter_signatures WHERE encounter_id=@encounter_id;
        END;
        SET @amendment_hash=HASHBYTES('SHA2_256',CONCAT(
            CONVERT(varchar(64),@previous_hash,2),'|',@amendment_no,'|',@reason,'|',
            @amendment_content,'|',@actor_user_id,'|',CONVERT(varchar(33),@amended_at,126)));
        INSERT dbo.encounter_amendments
            (encounter_id,amendment_no,reason,amendment_content,previous_chain_hash,
             amendment_hash,signature_algorithm,signature_value,amended_by_user_id,amended_at_utc)
        VALUES
            (@encounter_id,@amendment_no,@reason,@amendment_content,@previous_hash,
             @amendment_hash,@signature_algorithm,@signature_value,@actor_user_id,@amended_at);
        SET @encounter_amendment_id=SCOPE_IDENTITY();

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_amendment_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"encounter_id":',@encounter_id,
                                                 N',"amendment_no":',@amendment_no,N'}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_AMENDMENT_ADDED',
             'ENCOUNTER_AMENDMENT',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_cancel_encounter
    @actor_user_id bigint,
    @encounter_id bigint,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL THROW 53252,N'Bắt buộc nhập lý do hủy lượt khám.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.encounters WHERE encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'ENCOUNTERS_CREATE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20),@appointment_id bigint;
        SELECT @status=status,@appointment_id=appointment_id
        FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK) WHERE encounter_id=@encounter_id;
        IF @status='CANCELLED' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status NOT IN ('WAITING','IN_PROGRESS')
            THROW 53253,N'Chỉ hủy lượt khám WAITING hoặc IN_PROGRESS.',1;
        IF EXISTS
        (
            SELECT 1 FROM dbo.inventory_movements im
            JOIN dbo.dispensation_items di ON di.dispensation_item_id=im.dispensation_item_id
            JOIN dbo.prescription_items pi ON pi.prescription_item_id=di.prescription_item_id
            JOIN dbo.prescriptions p ON p.prescription_id=pi.prescription_id
            WHERE p.encounter_id=@encounter_id AND im.movement_type='DISPENSE'
              AND NOT EXISTS (SELECT 1 FROM dbo.inventory_movements r WHERE r.reverses_movement_id=im.inventory_movement_id)
        ) THROW 53254,N'Không thể hủy: còn thuốc đã cấp chưa đảo.',1;
        IF EXISTS
        (
            SELECT 1 FROM dbo.invoices i
            JOIN dbo.payment_allocations pa ON pa.invoice_id=i.invoice_id
            JOIN dbo.payments p ON p.payment_id=pa.payment_id AND p.status='SUCCEEDED'
            WHERE i.encounter_id=@encounter_id
        ) THROW 53255,N'Không thể hủy: lượt khám đã có thanh toán.',1;

        UPDATE dbo.encounter_services
           SET status='CANCELLED',cancelled_by_user_id=@actor_user_id,
               cancelled_at_utc=SYSUTCDATETIME(),cancellation_reason=@reason
         WHERE encounter_id=@encounter_id AND status IN ('ORDERED','IN_PROGRESS');
        UPDATE dbo.prescriptions
           SET status='CANCELLED',cancelled_by_user_id=@actor_user_id,
               cancelled_at_utc=SYSUTCDATETIME(),cancellation_reason=@reason,
               updated_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND status='DRAFT';
        UPDATE dbo.invoices
           SET status='VOID',is_active_invoice=0,voided_at_utc=SYSUTCDATETIME(),
               voided_by_user_id=@actor_user_id,void_reason=@reason,updated_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND status='DRAFT';
        UPDATE dbo.encounter_staff_assignments SET ended_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND ended_at_utc IS NULL;
        UPDATE dbo.queue_tickets SET status='CANCELLED',completed_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id AND status IN ('WAITING','CALLED','SERVING');
        IF @appointment_id IS NOT NULL
            UPDATE dbo.appointments
               SET status='CANCELLED',occupies_slot=0,cancelled_by_user_id=@actor_user_id,
                   cancelled_at_utc=SYSUTCDATETIME(),cancellation_reason=@reason,
                   cancellation_source='STAFF',hold_expires_at_utc=NULL,updated_at_utc=SYSUTCDATETIME()
             WHERE appointment_id=@appointment_id AND status IN ('CHECKED_IN','IN_PROGRESS');
        UPDATE dbo.encounters
           SET status='CANCELLED',occupies_appointment=0,is_in_progress=0,
               cancelled_at_utc=SYSUTCDATETIME(),cancelled_by_user_id=@actor_user_id,
               cancellation_reason=@reason,updated_at_utc=SYSUTCDATETIME()
         WHERE encounter_id=@encounter_id;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@encounter_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"reason":"',STRING_ESCAPE(@reason,'json'),N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'ENCOUNTER_CANCELLED',
             'ENCOUNTER',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/*=============================================================================
  17. COMMAND PROCEDURES - ĐƠN THUỐC, CẤP PHÁT VÀ TỒN KHO
=============================================================================*/

CREATE OR ALTER PROCEDURE dbo.sp_create_prescription
    @actor_user_id bigint,
    @encounter_id bigint,
    @valid_days smallint = 7,
    @clinical_notes nvarchar(1000) = NULL,
    @general_instructions nvarchar(1000) = NULL,
    @prescription_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @valid_days NOT BETWEEN 1 AND 90
        THROW 53300, N'Hiệu lực đơn thuốc phải từ 1 đến 90 ngày.', 1;

    DECLARE @branch_id bigint, @patient_id bigint, @doctor_id bigint, @doctor_user_id bigint;
    SELECT @branch_id=e.branch_id, @patient_id=e.patient_id, @doctor_id=e.attending_doctor_id,
           @doctor_user_id=emp.user_id
    FROM dbo.encounters e
    JOIN dbo.doctors d ON d.doctor_id=e.attending_doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id
    WHERE e.encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id, 'PRESCRIPTIONS_WRITE', @branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53301, N'Chỉ bác sĩ phụ trách có tài khoản liên kết mới được kê đơn.', 1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK)
                       WHERE encounter_id=@encounter_id AND status='IN_PROGRESS')
            THROW 53302, N'Chỉ tạo đơn khi lượt khám đang IN_PROGRESS.', 1;

        DECLARE @business_date date, @prescription_code varchar(40);
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        EXEC dbo.sp_next_document_number
            @branch_id,'PRESCRIPTION',@business_date,'DT',@prescription_code OUTPUT;

        INSERT dbo.prescriptions
            (prescription_code,encounter_id,patient_id,doctor_id,branch_id,status,
             valid_until,clinical_notes,general_instructions,created_by_user_id)
        VALUES
            (@prescription_code,@encounter_id,@patient_id,@doctor_id,@branch_id,'DRAFT',
             DATEADD(DAY,@valid_days-1,@business_date),@clinical_notes,@general_instructions,@actor_user_id);
        SET @prescription_id=SCOPE_IDENTITY();

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@prescription_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'PRESCRIPTION_CREATED',
             'PRESCRIPTION',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_add_prescription_item
    @actor_user_id bigint,
    @prescription_id bigint,
    @medicine_id bigint,
    @prescribed_quantity decimal(18,3),
    @dose nvarchar(100),
    @frequency nvarchar(100),
    @duration_days smallint = NULL,
    @timing_instruction nvarchar(200) = NULL,
    @usage_instruction nvarchar(1000),
    @sort_order smallint = 0,
    @prescription_item_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=p.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.prescriptions p
    JOIN dbo.doctors d ON d.doctor_id=p.doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id
    WHERE p.prescription_id=@prescription_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PRESCRIPTIONS_WRITE',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53303,N'Chỉ bác sĩ kê đơn được thêm thuốc.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.prescriptions WITH (UPDLOCK,HOLDLOCK)
                       WHERE prescription_id=@prescription_id AND status='DRAFT')
            THROW 53304,N'Đơn thuốc không ở trạng thái DRAFT.',1;
        INSERT dbo.prescription_items
            (prescription_id,medicine_id,medicine_name_snapshot,strength_snapshot,
             dosage_form_snapshot,route_snapshot,prescribed_quantity,dose,frequency,
             duration_days,timing_instruction,usage_instruction,sort_order)
        SELECT @prescription_id,m.medicine_id,
               CONCAT(m.generic_name,CASE WHEN m.brand_name IS NULL THEN N'' ELSE CONCAT(N' (',m.brand_name,N')') END),
               m.strength,m.dosage_form,m.route,@prescribed_quantity,@dose,@frequency,
               @duration_days,@timing_instruction,@usage_instruction,@sort_order
        FROM dbo.medicines m WHERE m.medicine_id=@medicine_id AND m.is_active=1;
        IF @@ROWCOUNT=0 THROW 53305,N'Thuốc không tồn tại hoặc đã ngừng.',1;
        SET @prescription_item_id=SCOPE_IDENTITY();

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@prescription_item_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'PRESCRIPTION_ITEM_ADDED',
             'PRESCRIPTION_ITEM',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_issue_prescription
    @actor_user_id bigint,
    @prescription_id bigint
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=p.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.prescriptions p
    JOIN dbo.doctors d ON d.doctor_id=p.doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id
    WHERE p.prescription_id=@prescription_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PRESCRIPTIONS_WRITE',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53306,N'Chỉ bác sĩ kê đơn được phát hành đơn.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(30),@valid_until date,@encounter_id bigint,@business_date date;
        SELECT @status=status,@valid_until=valid_until,@encounter_id=encounter_id
        FROM dbo.prescriptions WITH (UPDLOCK,HOLDLOCK) WHERE prescription_id=@prescription_id;
        IF @status IN ('ISSUED','PARTIALLY_DISPENSED','DISPENSED')
        BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status<>'DRAFT' THROW 53307,N'Chỉ phát hành đơn DRAFT.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.prescription_items WITH (UPDLOCK,HOLDLOCK)
                       WHERE prescription_id=@prescription_id)
            THROW 53308,N'Không thể phát hành đơn rỗng.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounters WHERE encounter_id=@encounter_id AND status='IN_PROGRESS')
            THROW 53309,N'Lượt khám không còn ở trạng thái cho phép phát hành đơn.',1;
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        IF @valid_until<@business_date THROW 53310,N'Đơn đã hết hiệu lực theo ngày chi nhánh.',1;

        UPDATE dbo.prescriptions SET status='ISSUED',issued_at_utc=SYSUTCDATETIME(),
               updated_at_utc=SYSUTCDATETIME() WHERE prescription_id=@prescription_id;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@prescription_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'PRESCRIPTION_ISSUED',
             'PRESCRIPTION',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_cancel_prescription
    @actor_user_id bigint,
    @prescription_id bigint,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL THROW 53311,N'Bắt buộc nhập lý do hủy đơn.',1;
    DECLARE @branch_id bigint,@doctor_user_id bigint;
    SELECT @branch_id=p.branch_id,@doctor_user_id=emp.user_id
    FROM dbo.prescriptions p JOIN dbo.doctors d ON d.doctor_id=p.doctor_id
    JOIN dbo.employees emp ON emp.employee_id=d.employee_id
    WHERE p.prescription_id=@prescription_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PRESCRIPTIONS_WRITE',@branch_id;
    IF @doctor_user_id IS NULL OR @doctor_user_id<>@actor_user_id
        THROW 53312,N'Chỉ bác sĩ kê đơn được hủy đơn.',1;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(30);
        SELECT @status=status FROM dbo.prescriptions WITH (UPDLOCK,HOLDLOCK)
        WHERE prescription_id=@prescription_id;
        IF @status='CANCELLED' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status NOT IN ('DRAFT','ISSUED') THROW 53313,N'Đơn đã cấp thuốc hoặc hết hạn không thể hủy trực tiếp.',1;
        IF EXISTS (SELECT 1 FROM dbo.prescription_items WHERE prescription_id=@prescription_id AND dispensed_quantity>0)
            THROW 53314,N'Đơn đã có thuốc cấp; phải đảo cấp phát trước.',1;
        IF EXISTS (SELECT 1 FROM dbo.dispensations WHERE prescription_id=@prescription_id AND status='DRAFT')
            THROW 53315,N'Đang có phiên cấp thuốc mở; hãy hủy/đóng phiên trước.',1;

        UPDATE dbo.prescriptions SET status='CANCELLED',cancelled_at_utc=SYSUTCDATETIME(),
               cancelled_by_user_id=@actor_user_id,cancellation_reason=@reason,
               updated_at_utc=SYSUTCDATETIME()
         WHERE prescription_id=@prescription_id;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@prescription_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"reason":"',STRING_ESCAPE(@reason,'json'),N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'PRESCRIPTION_CANCELLED',
             'PRESCRIPTION',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_receive_stock
    @actor_user_id bigint,
    @inventory_location_id bigint,
    @medicine_batch_id bigint,
    @quantity decimal(18,3),
    @reason nvarchar(500)=NULL,
    @inventory_movement_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @quantity<=0 THROW 53316,N'Số lượng nhập phải lớn hơn 0.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.inventory_locations WHERE inventory_location_id=@inventory_location_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'INVENTORY_MANAGE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @expiry date,@unit_cost decimal(19,2),@business_date date;
        SELECT @expiry=expiry_date,@unit_cost=purchase_price
        FROM dbo.medicine_batches WITH (UPDLOCK,HOLDLOCK)
        WHERE medicine_batch_id=@medicine_batch_id AND status='AVAILABLE';
        IF @expiry IS NULL THROW 53317,N'Lô thuốc không tồn tại hoặc không khả dụng.',1;
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        IF @expiry<=@business_date THROW 53318,N'Không được nhập lô đã hết hạn hoặc hết hạn trong ngày.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.inventory_locations WHERE inventory_location_id=@inventory_location_id AND is_active=1)
            THROW 53319,N'Vị trí kho không hoạt động.',1;

        DECLARE @balance decimal(18,3);
        UPDATE dbo.inventory_balances WITH (UPDLOCK,HOLDLOCK)
           SET quantity_on_hand=quantity_on_hand+@quantity,last_movement_at_utc=SYSUTCDATETIME(),
               @balance=quantity_on_hand+@quantity
         WHERE inventory_location_id=@inventory_location_id AND medicine_batch_id=@medicine_batch_id;
        IF @@ROWCOUNT=0
        BEGIN
            SET @balance=@quantity;
            INSERT dbo.inventory_balances
                (inventory_location_id,medicine_batch_id,quantity_on_hand,quantity_reserved,last_movement_at_utc)
            VALUES (@inventory_location_id,@medicine_batch_id,@quantity,0,SYSUTCDATETIME());
        END;

        INSERT dbo.inventory_movements
            (inventory_location_id,medicine_batch_id,movement_type,quantity_delta,balance_after,
             unit_cost,reference_type,reason,performed_by_user_id,request_id)
        VALUES
            (@inventory_location_id,@medicine_batch_id,'RECEIPT',@quantity,@balance,
             @unit_cost,'GOODS_RECEIPT',@reason,@actor_user_id,
             TRY_CONVERT(uniqueidentifier,SESSION_CONTEXT(N'request_id')));
        SET @inventory_movement_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@inventory_movement_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'STOCK_RECEIVED',
             'INVENTORY_MOVEMENT',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_open_dispensation
    @actor_user_id bigint,
    @prescription_id bigint,
    @inventory_location_id bigint,
    @dispensation_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.prescriptions WHERE prescription_id=@prescription_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PHARMACY_DISPENSE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(30),@valid_until date,@business_date date;
        SELECT @status=status,@valid_until=valid_until
        FROM dbo.prescriptions WITH (UPDLOCK,HOLDLOCK) WHERE prescription_id=@prescription_id;
        IF @status NOT IN ('ISSUED','PARTIALLY_DISPENSED')
            THROW 53320,N'Đơn thuốc không ở trạng thái có thể cấp.',1;
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        IF @valid_until<@business_date
        BEGIN
            UPDATE dbo.prescriptions SET status='EXPIRED',updated_at_utc=SYSUTCDATETIME()
            WHERE prescription_id=@prescription_id;
            THROW 53321,N'Đơn thuốc đã hết hạn.',1;
        END;
        IF NOT EXISTS (SELECT 1 FROM dbo.inventory_locations WHERE inventory_location_id=@inventory_location_id
                       AND branch_id=@branch_id AND is_active=1 AND is_dispensing=1)
            THROW 53322,N'Quầy cấp thuốc không hợp lệ hoặc khác chi nhánh.',1;
        IF EXISTS (SELECT 1 FROM dbo.dispensations WITH (UPDLOCK,HOLDLOCK)
                   WHERE prescription_id=@prescription_id AND status='DRAFT')
            THROW 53323,N'Đơn thuốc đang có một phiên cấp phát mở.',1;

        DECLARE @dispensation_code varchar(40);
        EXEC dbo.sp_next_document_number @branch_id,'DISPENSATION',@business_date,'CP',@dispensation_code OUTPUT;
        INSERT dbo.dispensations
            (dispensation_code,prescription_id,branch_id,inventory_location_id,status,dispensed_by_user_id)
        VALUES
            (@dispensation_code,@prescription_id,@branch_id,@inventory_location_id,'DRAFT',@actor_user_id);
        SET @dispensation_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@dispensation_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'DISPENSATION_OPENED',
             'DISPENSATION',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_dispense_prescription_item
    @actor_user_id bigint,
    @dispensation_id bigint,
    @prescription_item_id bigint,
    @medicine_batch_id bigint,
    @quantity decimal(18,3),
    @dispensation_item_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @quantity<=0 THROW 53324,N'Số lượng cấp phải lớn hơn 0.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.dispensations WHERE dispensation_id=@dispensation_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PHARMACY_DISPENSE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @prescription_id bigint,@location_id bigint,@disp_status varchar(20),
                @rx_status varchar(30),@valid_until date,@business_date date,
                @medicine_id bigint,@prescribed decimal(18,3),@dispensed decimal(18,3),
                @batch_medicine_id bigint,@batch_status varchar(20),@expiry date,
                @unit_price decimal(19,2),@available decimal(18,3);
        SELECT @prescription_id=prescription_id,@location_id=inventory_location_id,@disp_status=status
        FROM dbo.dispensations WITH (UPDLOCK,HOLDLOCK) WHERE dispensation_id=@dispensation_id;
        IF @disp_status<>'DRAFT' THROW 53325,N'Phiên cấp phát không ở trạng thái DRAFT.',1;
        SELECT @rx_status=status,@valid_until=valid_until
        FROM dbo.prescriptions WITH (UPDLOCK,HOLDLOCK) WHERE prescription_id=@prescription_id;
        IF @rx_status NOT IN ('ISSUED','PARTIALLY_DISPENSED')
            THROW 53326,N'Đơn thuốc không còn cho phép cấp.',1;
        SELECT @medicine_id=medicine_id,@prescribed=prescribed_quantity,@dispensed=dispensed_quantity
        FROM dbo.prescription_items WITH (UPDLOCK,HOLDLOCK)
        WHERE prescription_item_id=@prescription_item_id AND prescription_id=@prescription_id;
        IF @medicine_id IS NULL THROW 53327,N'Dòng kê thuốc không thuộc đơn.',1;
        IF @dispensed+@quantity>@prescribed THROW 53328,N'Số lượng cấp vượt số lượng còn lại.',1;
        SELECT @batch_medicine_id=medicine_id,@batch_status=status,@expiry=expiry_date,@unit_price=sale_price
        FROM dbo.medicine_batches WITH (UPDLOCK,HOLDLOCK) WHERE medicine_batch_id=@medicine_batch_id;
        IF @batch_medicine_id<>@medicine_id OR @batch_status<>'AVAILABLE'
            THROW 53329,N'Lô không đúng thuốc hoặc không khả dụng.',1;
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        IF @valid_until<@business_date THROW 53330,N'Đơn thuốc đã hết hạn.',1;
        IF @expiry<=@business_date THROW 53331,N'Lô thuốc đã hết hạn hoặc hết hạn trong ngày.',1;

        SELECT @available=available_quantity
        FROM dbo.inventory_balances WITH (UPDLOCK,HOLDLOCK)
        WHERE inventory_location_id=@location_id AND medicine_batch_id=@medicine_batch_id;
        IF COALESCE(@available,0)<@quantity THROW 53332,N'Tồn khả dụng không đủ.',1;
        IF EXISTS
        (
            SELECT 1
            FROM dbo.inventory_balances ib
            JOIN dbo.medicine_batches mb ON mb.medicine_batch_id=ib.medicine_batch_id
            WHERE ib.inventory_location_id=@location_id AND mb.medicine_id=@medicine_id
              AND mb.status='AVAILABLE' AND mb.expiry_date>@business_date
              AND ib.available_quantity>0 AND mb.expiry_date<@expiry
        ) THROW 53333,N'Vi phạm FEFO: còn lô có hạn dùng sớm hơn.',1;

        UPDATE dbo.inventory_balances
           SET quantity_on_hand=quantity_on_hand-@quantity,last_movement_at_utc=SYSUTCDATETIME()
         WHERE inventory_location_id=@location_id AND medicine_batch_id=@medicine_batch_id
           AND quantity_on_hand-quantity_reserved>=@quantity;
        IF @@ROWCOUNT=0 THROW 53334,N'Tồn kho vừa thay đổi; không đủ để cấp.',1;

        INSERT dbo.dispensation_items
            (dispensation_id,prescription_item_id,medicine_batch_id,quantity,unit_price_snapshot)
        VALUES
            (@dispensation_id,@prescription_item_id,@medicine_batch_id,@quantity,@unit_price);
        SET @dispensation_item_id=SCOPE_IDENTITY();
        DECLARE @balance_after decimal(18,3);
        SELECT @balance_after=quantity_on_hand FROM dbo.inventory_balances
        WHERE inventory_location_id=@location_id AND medicine_batch_id=@medicine_batch_id;
        INSERT dbo.inventory_movements
            (inventory_location_id,medicine_batch_id,movement_type,quantity_delta,balance_after,
             unit_cost,reference_type,reference_id,dispensation_item_id,performed_by_user_id,request_id)
        VALUES
            (@location_id,@medicine_batch_id,'DISPENSE',-@quantity,@balance_after,
             @unit_price,'DISPENSATION',@dispensation_id,@dispensation_item_id,@actor_user_id,
             TRY_CONVERT(uniqueidentifier,SESSION_CONTEXT(N'request_id')));
        UPDATE dbo.prescription_items SET dispensed_quantity=dispensed_quantity+@quantity
        WHERE prescription_item_id=@prescription_item_id;
        UPDATE dbo.prescriptions SET status='PARTIALLY_DISPENSED',updated_at_utc=SYSUTCDATETIME()
        WHERE prescription_id=@prescription_id AND status='ISSUED';

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@dispensation_item_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"quantity":',@quantity,N',"batch_id":',@medicine_batch_id,N'}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'MEDICINE_DISPENSED',
             'DISPENSATION_ITEM',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_complete_dispensation
    @actor_user_id bigint,
    @dispensation_id bigint
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.dispensations WHERE dispensation_id=@dispensation_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PHARMACY_DISPENSE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @prescription_id bigint,@status varchar(20);
        SELECT @prescription_id=prescription_id,@status=status
        FROM dbo.dispensations WITH (UPDLOCK,HOLDLOCK) WHERE dispensation_id=@dispensation_id;
        IF @status='COMPLETED' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status<>'DRAFT' THROW 53335,N'Phiên cấp phát không thể hoàn tất.',1;
        IF NOT EXISTS
        (
            SELECT 1 FROM dbo.dispensation_items di
            WHERE di.dispensation_id=@dispensation_id
              AND NOT EXISTS (SELECT 1 FROM dbo.dispensation_item_reversals r
                              WHERE r.dispensation_item_id=di.dispensation_item_id)
        ) THROW 53336,N'Phiên cấp phát không có dòng thuốc còn hiệu lực.',1;

        UPDATE dbo.dispensations SET status='COMPLETED',completed_at_utc=SYSUTCDATETIME()
        WHERE dispensation_id=@dispensation_id;
        IF NOT EXISTS (SELECT 1 FROM dbo.prescription_items
                       WHERE prescription_id=@prescription_id AND dispensed_quantity<prescribed_quantity)
            UPDATE dbo.prescriptions SET status='DISPENSED',updated_at_utc=SYSUTCDATETIME()
            WHERE prescription_id=@prescription_id;
        ELSE
            UPDATE dbo.prescriptions SET status='PARTIALLY_DISPENSED',updated_at_utc=SYSUTCDATETIME()
            WHERE prescription_id=@prescription_id;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@dispensation_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'DISPENSATION_COMPLETED',
             'DISPENSATION',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_reverse_dispensation_item
    @actor_user_id bigint,
    @dispensation_item_id bigint,
    @return_location_id bigint,
    @disposition varchar(20),
    @reason nvarchar(500),
    @reversal_movement_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @disposition NOT IN ('SELLABLE','QUARANTINE','DESTROY')
        THROW 53337,N'Phân loại hàng trả không hợp lệ.',1;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL THROW 53338,N'Bắt buộc nhập lý do đảo cấp phát.',1;

    DECLARE @branch_id bigint;
    SELECT @branch_id=d.branch_id
    FROM dbo.dispensation_items di JOIN dbo.dispensations d ON d.dispensation_id=di.dispensation_id
    WHERE di.dispensation_item_id=@dispensation_item_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PHARMACY_DISPENSE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @dispensation_id bigint,@prescription_item_id bigint,@batch_id bigint,
                @quantity decimal(18,3),@prescription_id bigint,@source_movement_id bigint;
        SELECT @dispensation_id=di.dispensation_id,@prescription_item_id=di.prescription_item_id,
               @batch_id=di.medicine_batch_id,@quantity=di.quantity,@prescription_id=d.prescription_id
        FROM dbo.dispensation_items di WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.dispensations d ON d.dispensation_id=di.dispensation_id
        WHERE di.dispensation_item_id=@dispensation_item_id;
        IF @dispensation_id IS NULL THROW 53339,N'Dòng cấp phát không tồn tại.',1;
        IF EXISTS (SELECT 1 FROM dbo.dispensation_item_reversals WITH (UPDLOCK,HOLDLOCK)
                   WHERE dispensation_item_id=@dispensation_item_id)
            THROW 53340,N'Dòng cấp phát đã được đảo.',1;
        SELECT @source_movement_id=inventory_movement_id
        FROM dbo.inventory_movements WITH (UPDLOCK,HOLDLOCK)
        WHERE dispensation_item_id=@dispensation_item_id AND movement_type='DISPENSE';
        IF @source_movement_id IS NULL THROW 53341,N'Không tìm thấy bút toán cấp thuốc gốc.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.inventory_locations WHERE inventory_location_id=@return_location_id
                       AND branch_id=@branch_id AND is_active=1
                       AND ((@disposition='QUARANTINE' AND location_type='QUARANTINE')
                            OR (@disposition='SELLABLE' AND location_type<>'QUARANTINE')
                            OR @disposition='DESTROY'))
            THROW 53342,N'Vị trí nhận hàng trả không phù hợp chi nhánh/phân loại.',1;
        IF @disposition='DESTROY'
            THROW 53343,N'Hàng tiêu hủy không nhập lại tồn; hãy dùng quy trình hủy có chứng từ riêng.',1;
        IF EXISTS
        (
            SELECT 1 FROM dbo.invoice_items ii JOIN dbo.invoices i ON i.invoice_id=ii.invoice_id
            WHERE ii.dispensation_item_id=@dispensation_item_id AND i.status<>'DRAFT'
        ) THROW 53344,N'Không thể đảo vì dòng thuốc nằm trên hóa đơn đã phát hành.',1;

        DECLARE @balance_after decimal(18,3);
        UPDATE dbo.inventory_balances WITH (UPDLOCK,HOLDLOCK)
           SET quantity_on_hand=quantity_on_hand+@quantity,last_movement_at_utc=SYSUTCDATETIME(),
               @balance_after=quantity_on_hand+@quantity
         WHERE inventory_location_id=@return_location_id AND medicine_batch_id=@batch_id;
        IF @@ROWCOUNT=0
        BEGIN
            SET @balance_after=@quantity;
            INSERT dbo.inventory_balances
                (inventory_location_id,medicine_batch_id,quantity_on_hand,quantity_reserved,last_movement_at_utc)
            VALUES (@return_location_id,@batch_id,@quantity,0,SYSUTCDATETIME());
        END;
        INSERT dbo.inventory_movements
            (inventory_location_id,medicine_batch_id,movement_type,quantity_delta,balance_after,
             reference_type,reference_id,reverses_movement_id,reason,performed_by_user_id,request_id)
        VALUES
            (@return_location_id,@batch_id,'REVERSAL',@quantity,@balance_after,
             'DISPENSATION_REVERSAL',@dispensation_item_id,@source_movement_id,@reason,@actor_user_id,
             TRY_CONVERT(uniqueidentifier,SESSION_CONTEXT(N'request_id')));
        SET @reversal_movement_id=SCOPE_IDENTITY();
        INSERT dbo.dispensation_item_reversals
            (dispensation_item_id,reversal_movement_id,return_location_id,disposition,reason,reversed_by_user_id)
        VALUES
            (@dispensation_item_id,@reversal_movement_id,@return_location_id,@disposition,@reason,@actor_user_id);
        UPDATE dbo.prescription_items SET dispensed_quantity=dispensed_quantity-@quantity
        WHERE prescription_item_id=@prescription_item_id AND dispensed_quantity>=@quantity;
        IF @@ROWCOUNT=0 THROW 53345,N'Lượng đã cấp không đủ để đảo; dữ liệu cần đối soát.',1;
        DELETE ii FROM dbo.invoice_items ii JOIN dbo.invoices i ON i.invoice_id=ii.invoice_id
        WHERE ii.dispensation_item_id=@dispensation_item_id AND i.status='DRAFT';
        IF NOT EXISTS (SELECT 1 FROM dbo.prescription_items
                       WHERE prescription_id=@prescription_id AND dispensed_quantity>0)
            UPDATE dbo.prescriptions SET status='ISSUED',updated_at_utc=SYSUTCDATETIME()
            WHERE prescription_id=@prescription_id;
        ELSE IF EXISTS (SELECT 1 FROM dbo.prescription_items
                        WHERE prescription_id=@prescription_id AND dispensed_quantity<prescribed_quantity)
            UPDATE dbo.prescriptions SET status='PARTIALLY_DISPENSED',updated_at_utc=SYSUTCDATETIME()
            WHERE prescription_id=@prescription_id;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@dispensation_item_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"reversal_movement_id":',@reversal_movement_id,
                                                 N',"disposition":"',@disposition,N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'DISPENSATION_ITEM_REVERSED',
             'DISPENSATION_ITEM',@entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_cancel_dispensation
    @actor_user_id bigint,
    @dispensation_id bigint,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL
        THROW 53346,N'Bắt buộc nhập lý do hủy phiên cấp phát.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.dispensations WHERE dispensation_id=@dispensation_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PHARMACY_DISPENSE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF EXISTS
        (
            SELECT 1 FROM dbo.dispensation_items di
            WHERE di.dispensation_id=@dispensation_id
              AND NOT EXISTS (SELECT 1 FROM dbo.dispensation_item_reversals r
                              WHERE r.dispensation_item_id=di.dispensation_item_id)
        )
            THROW 53347,N'Phải đảo toàn bộ dòng thuốc trước khi hủy phiên cấp phát.',1;
        UPDATE dbo.dispensations WITH (UPDLOCK,HOLDLOCK)
           SET status='CANCELLED',cancelled_at_utc=SYSUTCDATETIME(),notes=@reason
         WHERE dispensation_id=@dispensation_id AND status='DRAFT';
        IF @@ROWCOUNT=0 THROW 53348,N'Chỉ hủy phiên cấp phát DRAFT.',1;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@dispensation_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'DISPENSATION_CANCELLED',
             'DISPENSATION',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/*=============================================================================
  18. COMMAND PROCEDURES - HÓA ĐƠN, THANH TOÁN VÀ HOÀN TIỀN
=============================================================================*/

CREATE OR ALTER PROCEDURE dbo.sp_create_invoice
    @actor_user_id bigint,
    @encounter_id bigint,
    @supersedes_invoice_id bigint = NULL,
    @invoice_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint,@patient_id bigint;
    SELECT @branch_id=branch_id,@patient_id=patient_id FROM dbo.encounters WHERE encounter_id=@encounter_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'BILLING_MANAGE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.encounters WITH (UPDLOCK,HOLDLOCK)
                       WHERE encounter_id=@encounter_id AND status IN ('IN_PROGRESS','COMPLETED','SIGNED'))
            THROW 53400,N'Lượt khám không ở trạng thái cho phép lập hóa đơn.',1;
        SELECT @invoice_id=invoice_id FROM dbo.invoices WITH (UPDLOCK,HOLDLOCK)
        WHERE encounter_id=@encounter_id AND is_active_invoice=1;
        IF @invoice_id IS NOT NULL BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @supersedes_invoice_id IS NOT NULL AND NOT EXISTS
           (SELECT 1 FROM dbo.invoices WHERE invoice_id=@supersedes_invoice_id
            AND encounter_id=@encounter_id AND status='VOID')
            THROW 53401,N'Hóa đơn được thay thế không hợp lệ hoặc chưa VOID.',1;

        DECLARE @business_date date,@invoice_number varchar(40);
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        EXEC dbo.sp_next_document_number @branch_id,'INVOICE',@business_date,'HD',@invoice_number OUTPUT;
        INSERT dbo.invoices
            (invoice_number,encounter_id,patient_id,branch_id,supersedes_invoice_id,status,
             subtotal_amount,discount_amount,tax_amount,insurance_amount,created_by_user_id,is_active_invoice)
        VALUES
            (@invoice_number,@encounter_id,@patient_id,@branch_id,@supersedes_invoice_id,'DRAFT',
             0,0,0,0,@actor_user_id,1);
        SET @invoice_id=SCOPE_IDENTITY();

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@invoice_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'INVOICE_CREATED','INVOICE',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_sync_invoice_items
    @actor_user_id bigint,
    @invoice_id bigint
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.invoices WHERE invoice_id=@invoice_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'BILLING_MANAGE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @encounter_id bigint,@status varchar(20);
        SELECT @encounter_id=encounter_id,@status=status
        FROM dbo.invoices WITH (UPDLOCK,HOLDLOCK) WHERE invoice_id=@invoice_id;
        IF @status<>'DRAFT' THROW 53402,N'Chỉ đồng bộ dòng cho hóa đơn DRAFT.',1;

        DELETE FROM dbo.invoice_items
        WHERE invoice_id=@invoice_id AND item_type IN ('SERVICE','MEDICINE');

        INSERT dbo.invoice_items
            (invoice_id,item_type,encounter_service_id,item_code_snapshot,item_name_snapshot,
             quantity,unit_price,discount_amount,tax_rate_percent)
        SELECT @invoice_id,'SERVICE',es.encounter_service_id,es.service_code_snapshot,
               es.service_name_snapshot,es.quantity,es.unit_price_snapshot,es.discount_amount,0
        FROM dbo.encounter_services es
        WHERE es.encounter_id=@encounter_id AND es.status='COMPLETED';

        INSERT dbo.invoice_items
            (invoice_id,item_type,dispensation_item_id,item_code_snapshot,item_name_snapshot,
             quantity,unit_price,discount_amount,tax_rate_percent)
        SELECT @invoice_id,'MEDICINE',di.dispensation_item_id,m.medicine_code,
               pi.medicine_name_snapshot,di.quantity,di.unit_price_snapshot,0,0
        FROM dbo.dispensation_items di
        JOIN dbo.prescription_items pi ON pi.prescription_item_id=di.prescription_item_id
        JOIN dbo.prescriptions p ON p.prescription_id=pi.prescription_id
        JOIN dbo.medicines m ON m.medicine_id=pi.medicine_id
        WHERE p.encounter_id=@encounter_id
          AND NOT EXISTS (SELECT 1 FROM dbo.dispensation_item_reversals r
                          WHERE r.dispensation_item_id=di.dispensation_item_id);

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@invoice_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'INVOICE_ITEMS_SYNCHRONIZED',
             'INVOICE',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_add_manual_invoice_item
    @actor_user_id bigint,
    @invoice_id bigint,
    @item_code varchar(40)=NULL,
    @item_name nvarchar(300),
    @quantity decimal(18,3),
    @unit_price decimal(19,2),
    @discount_amount decimal(19,2)=0,
    @tax_rate_percent decimal(7,4)=0,
    @invoice_item_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.invoices WHERE invoice_id=@invoice_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'BILLING_MANAGE',@branch_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        IF NOT EXISTS (SELECT 1 FROM dbo.invoices WITH (UPDLOCK,HOLDLOCK)
                       WHERE invoice_id=@invoice_id AND status='DRAFT')
            THROW 53403,N'Hóa đơn không ở trạng thái DRAFT.',1;
        INSERT dbo.invoice_items
            (invoice_id,item_type,item_code_snapshot,item_name_snapshot,quantity,
             unit_price,discount_amount,tax_rate_percent)
        VALUES
            (@invoice_id,'OTHER',@item_code,@item_name,@quantity,@unit_price,@discount_amount,@tax_rate_percent);
        SET @invoice_item_id=SCOPE_IDENTITY();
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@invoice_item_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'MANUAL_INVOICE_ITEM_ADDED',
             'INVOICE_ITEM',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_set_invoice_insurance_amount
    @actor_user_id bigint,
    @invoice_id bigint,
    @insurance_amount decimal(19,2)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.invoices WHERE invoice_id=@invoice_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'BILLING_MANAGE',@branch_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        UPDATE dbo.invoices WITH (UPDLOCK,HOLDLOCK)
           SET insurance_amount=@insurance_amount,updated_at_utc=SYSUTCDATETIME()
         WHERE invoice_id=@invoice_id AND status='DRAFT'
           AND @insurance_amount BETWEEN 0 AND total_amount;
        IF @@ROWCOUNT=0 THROW 53404,N'Số tiền bảo hiểm không hợp lệ hoặc hóa đơn không còn DRAFT.',1;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@invoice_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'INVOICE_INSURANCE_UPDATED',
             'INVOICE',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_issue_invoice
    @actor_user_id bigint,
    @invoice_id bigint,
    @due_at_utc datetime2(3)=NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.invoices WHERE invoice_id=@invoice_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'BILLING_MANAGE',@branch_id;
    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20),@payable decimal(19,2);
        SELECT @status=status,@payable=patient_payable_amount
        FROM dbo.invoices WITH (UPDLOCK,HOLDLOCK) WHERE invoice_id=@invoice_id;
        IF @status IN ('ISSUED','PARTIALLY_PAID','PAID') BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status<>'DRAFT' THROW 53405,N'Chỉ phát hành hóa đơn DRAFT.',1;
        IF NOT EXISTS (SELECT 1 FROM dbo.invoice_items WITH (UPDLOCK,HOLDLOCK) WHERE invoice_id=@invoice_id)
            THROW 53406,N'Không thể phát hành hóa đơn rỗng.',1;
        IF @payable<0 THROW 53407,N'Số bệnh nhân phải trả không hợp lệ.',1;
        UPDATE dbo.invoices
           SET status=CASE WHEN @payable=0 THEN 'PAID' ELSE 'ISSUED' END,
               issued_at_utc=SYSUTCDATETIME(),due_at_utc=COALESCE(@due_at_utc,SYSUTCDATETIME()),
               updated_at_utc=SYSUTCDATETIME()
         WHERE invoice_id=@invoice_id;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@invoice_id);
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'INVOICE_ISSUED','INVOICE',@entity_id;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_record_invoice_payment
    @actor_user_id bigint,
    @invoice_id bigint,
    @amount decimal(19,2),
    @payment_method varchar(20),
    @external_transaction_id nvarchar(150)=NULL,
    @idempotency_key uniqueidentifier,
    @notes nvarchar(500)=NULL,
    @payment_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @amount<=0 THROW 53408,N'Số tiền thanh toán phải lớn hơn 0.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.invoices WHERE invoice_id=@invoice_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PAYMENT_COLLECT',@branch_id;
    DECLARE @request_hash binary(32)=HASHBYTES('SHA2_256',CONCAT(
        @invoice_id,'|',@amount,'|',@payment_method,'|',COALESCE(@external_transaction_id,N'')));

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @old_hash binary(32),@old_status varchar(20),@old_resource bigint;
        SELECT @old_hash=request_hash,@old_status=status,@old_resource=resource_id
        FROM dbo.idempotency_requests WITH (UPDLOCK,HOLDLOCK)
        WHERE actor_user_id=@actor_user_id AND operation_code='RECORD_PAYMENT'
          AND idempotency_key=@idempotency_key;
        IF @old_hash IS NOT NULL
        BEGIN
            IF @old_hash<>@request_hash THROW 53409,N'Idempotency key đã dùng với payload khác.',1;
            IF @old_status='COMPLETED' BEGIN SET @payment_id=@old_resource; COMMIT TRANSACTION; RETURN; END;
            THROW 53410,N'Yêu cầu thanh toán đang được xử lý.',1;
        END;
        INSERT dbo.idempotency_requests
            (actor_user_id,operation_code,idempotency_key,request_hash,status,expires_at_utc)
        VALUES (@actor_user_id,'RECORD_PAYMENT',@idempotency_key,@request_hash,'PROCESSING',DATEADD(DAY,30,SYSUTCDATETIME()));

        DECLARE @lock_result int,@resource nvarchar(255)=CONCAT(N'invoice-payment:',@invoice_id);
        EXEC @lock_result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',
             @LockOwner='Transaction',@LockTimeout=10000;
        IF @lock_result<0 THROW 53411,N'Không thể khóa thanh toán hóa đơn.',1;
        DECLARE @status varchar(20),@patient_id bigint,@payable decimal(19,2),
                @paid decimal(19,2),@refunded decimal(19,2),@due decimal(19,2);
        SELECT @status=status,@patient_id=patient_id,@payable=patient_payable_amount
        FROM dbo.invoices WITH (UPDLOCK,HOLDLOCK) WHERE invoice_id=@invoice_id;
        IF @status NOT IN ('ISSUED','PARTIALLY_PAID')
            THROW 53412,N'Hóa đơn không ở trạng thái cho phép thu tiền.',1;
        SELECT @paid=COALESCE(SUM(pa.allocated_amount),0)
        FROM dbo.payment_allocations pa JOIN dbo.payments p ON p.payment_id=pa.payment_id
        WHERE pa.invoice_id=@invoice_id AND p.status='SUCCEEDED';
        SELECT @refunded=COALESCE(SUM(ra.refunded_amount),0)
        FROM dbo.refund_allocations ra
        JOIN dbo.payment_refunds pr ON pr.payment_refund_id=ra.payment_refund_id AND pr.status='SUCCEEDED'
        JOIN dbo.payment_allocations pa ON pa.payment_allocation_id=ra.payment_allocation_id
        WHERE pa.invoice_id=@invoice_id;
        SET @due=@payable-COALESCE(@paid,0)+COALESCE(@refunded,0);
        IF @amount>@due THROW 53413,N'Số tiền thu vượt dư nợ hóa đơn.',1;

        DECLARE @business_date date,@payment_number varchar(40);
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        EXEC dbo.sp_next_document_number @branch_id,'PAYMENT',@business_date,'TT',@payment_number OUTPUT;
        INSERT dbo.payments
            (payment_number,branch_id,patient_id,amount,payment_method,status,
             external_transaction_id,idempotency_key,received_by_user_id,notes)
        VALUES
            (@payment_number,@branch_id,@patient_id,@amount,@payment_method,'SUCCEEDED',
             @external_transaction_id,@idempotency_key,@actor_user_id,@notes);
        SET @payment_id=SCOPE_IDENTITY();
        INSERT dbo.payment_allocations(payment_id,invoice_id,allocated_amount)
        VALUES (@payment_id,@invoice_id,@amount);
        SET @due=@due-@amount;
        UPDATE dbo.invoices SET status=CASE WHEN @due=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
               updated_at_utc=SYSUTCDATETIME() WHERE invoice_id=@invoice_id;
        UPDATE dbo.idempotency_requests
           SET status='COMPLETED',resource_type='PAYMENT',resource_id=@payment_id,
               response_json=CONCAT(N'{"payment_id":',@payment_id,N'}'),completed_at_utc=SYSUTCDATETIME()
         WHERE actor_user_id=@actor_user_id AND operation_code='RECORD_PAYMENT'
           AND idempotency_key=@idempotency_key;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@payment_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"invoice_id":',@invoice_id,N',"amount":',@amount,N'}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'PAYMENT_RECORDED','PAYMENT',
             @entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_refund_payment_allocation
    @actor_user_id bigint,
    @payment_allocation_id bigint,
    @amount decimal(19,2),
    @refund_method varchar(20),
    @external_transaction_id nvarchar(150)=NULL,
    @idempotency_key uniqueidentifier,
    @reason nvarchar(500),
    @payment_refund_id bigint OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @amount<=0 THROW 53414,N'Số tiền hoàn phải lớn hơn 0.',1;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL THROW 53415,N'Bắt buộc nhập lý do hoàn tiền.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=i.branch_id
    FROM dbo.payment_allocations pa JOIN dbo.invoices i ON i.invoice_id=pa.invoice_id
    WHERE pa.payment_allocation_id=@payment_allocation_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'PAYMENT_REFUND',@branch_id;
    DECLARE @request_hash binary(32)=HASHBYTES('SHA2_256',CONCAT(
        @payment_allocation_id,'|',@amount,'|',@refund_method,'|',
        COALESCE(@external_transaction_id,N''),'|',@reason));

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @old_hash binary(32),@old_status varchar(20),@old_resource bigint;
        SELECT @old_hash=request_hash,@old_status=status,@old_resource=resource_id
        FROM dbo.idempotency_requests WITH (UPDLOCK,HOLDLOCK)
        WHERE actor_user_id=@actor_user_id AND operation_code='REFUND_PAYMENT'
          AND idempotency_key=@idempotency_key;
        IF @old_hash IS NOT NULL
        BEGIN
            IF @old_hash<>@request_hash THROW 53416,N'Idempotency key đã dùng với payload khác.',1;
            IF @old_status='COMPLETED' BEGIN SET @payment_refund_id=@old_resource; COMMIT TRANSACTION; RETURN; END;
            THROW 53417,N'Yêu cầu hoàn tiền đang được xử lý.',1;
        END;
        INSERT dbo.idempotency_requests
            (actor_user_id,operation_code,idempotency_key,request_hash,status,expires_at_utc)
        VALUES (@actor_user_id,'REFUND_PAYMENT',@idempotency_key,@request_hash,'PROCESSING',DATEADD(DAY,30,SYSUTCDATETIME()));

        DECLARE @payment_id bigint,@invoice_id bigint,@allocated decimal(19,2),
                @patient_id bigint,@payment_status varchar(20),@refunded decimal(19,2);
        SELECT @payment_id=pa.payment_id,@invoice_id=pa.invoice_id,@allocated=pa.allocated_amount,
               @patient_id=p.patient_id,@payment_status=p.status
        FROM dbo.payment_allocations pa WITH (UPDLOCK,HOLDLOCK)
        JOIN dbo.payments p WITH (UPDLOCK,HOLDLOCK) ON p.payment_id=pa.payment_id
        WHERE pa.payment_allocation_id=@payment_allocation_id;
        IF @payment_status<>'SUCCEEDED' THROW 53418,N'Thanh toán gốc không thành công.',1;
        DECLARE @lock_result int,@resource nvarchar(255)=CONCAT(N'invoice-payment:',@invoice_id);
        EXEC @lock_result=sys.sp_getapplock @Resource=@resource,@LockMode='Exclusive',
             @LockOwner='Transaction',@LockTimeout=10000;
        IF @lock_result<0 THROW 53419,N'Không thể khóa hoàn tiền hóa đơn.',1;
        SELECT @refunded=COALESCE(SUM(ra.refunded_amount),0)
        FROM dbo.refund_allocations ra
        JOIN dbo.payment_refunds pr ON pr.payment_refund_id=ra.payment_refund_id AND pr.status='SUCCEEDED'
        WHERE ra.payment_allocation_id=@payment_allocation_id;
        IF @amount>@allocated-COALESCE(@refunded,0)
            THROW 53420,N'Số tiền hoàn vượt số còn có thể hoàn của phân bổ.',1;

        DECLARE @business_date date,@refund_number varchar(40);
        EXEC dbo.sp_get_branch_business_date @branch_id,NULL,@business_date OUTPUT;
        EXEC dbo.sp_next_document_number @branch_id,'REFUND',@business_date,'HT',@refund_number OUTPUT;
        INSERT dbo.payment_refunds
            (refund_number,payment_id,amount,refund_method,status,external_transaction_id,
             idempotency_key,reason,refunded_by_user_id)
        VALUES
            (@refund_number,@payment_id,@amount,@refund_method,'SUCCEEDED',@external_transaction_id,
             @idempotency_key,@reason,@actor_user_id);
        SET @payment_refund_id=SCOPE_IDENTITY();
        INSERT dbo.refund_allocations(payment_refund_id,payment_allocation_id,refunded_amount)
        VALUES (@payment_refund_id,@payment_allocation_id,@amount);

        DECLARE @balance_due decimal(19,2);
        SELECT @balance_due=balance_due FROM dbo.v_invoice_balances WHERE invoice_id=@invoice_id;
        UPDATE dbo.invoices
           SET status=CASE WHEN @balance_due=patient_payable_amount THEN 'ISSUED'
                           WHEN @balance_due>0 THEN 'PARTIALLY_PAID' ELSE 'PAID' END,
               updated_at_utc=SYSUTCDATETIME()
         WHERE invoice_id=@invoice_id;
        UPDATE dbo.idempotency_requests
           SET status='COMPLETED',resource_type='PAYMENT_REFUND',resource_id=@payment_refund_id,
               response_json=CONCAT(N'{"payment_refund_id":',@payment_refund_id,N'}'),
               completed_at_utc=SYSUTCDATETIME()
         WHERE actor_user_id=@actor_user_id AND operation_code='REFUND_PAYMENT'
           AND idempotency_key=@idempotency_key;

        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@payment_refund_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"invoice_id":',@invoice_id,N',"amount":',@amount,N'}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'PAYMENT_REFUNDED','PAYMENT_REFUND',
             @entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

CREATE OR ALTER PROCEDURE dbo.sp_void_invoice
    @actor_user_id bigint,
    @invoice_id bigint,
    @reason nvarchar(500)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NULLIF(LTRIM(RTRIM(@reason)),N'') IS NULL THROW 53421,N'Bắt buộc nhập lý do VOID.',1;
    DECLARE @branch_id bigint;
    SELECT @branch_id=branch_id FROM dbo.invoices WHERE invoice_id=@invoice_id;
    EXEC dbo.sp_assert_permission @actor_user_id,'BILLING_MANAGE',@branch_id;

    BEGIN TRY
        BEGIN TRANSACTION;
        DECLARE @status varchar(20),@net_paid decimal(19,2);
        SELECT @status=status FROM dbo.invoices WITH (UPDLOCK,HOLDLOCK) WHERE invoice_id=@invoice_id;
        IF @status='VOID' BEGIN COMMIT TRANSACTION; RETURN; END;
        IF @status NOT IN ('DRAFT','ISSUED') THROW 53422,N'Hóa đơn đang có thanh toán hoặc trạng thái không cho phép VOID.',1;
        SELECT @net_paid=paid_amount-refunded_amount FROM dbo.v_invoice_balances WHERE invoice_id=@invoice_id;
        IF COALESCE(@net_paid,0)<>0 THROW 53423,N'Phải hoàn hết tiền trước khi VOID hóa đơn.',1;
        UPDATE dbo.invoices SET status='VOID',is_active_invoice=0,voided_at_utc=SYSUTCDATETIME(),
               voided_by_user_id=@actor_user_id,void_reason=@reason,updated_at_utc=SYSUTCDATETIME()
        WHERE invoice_id=@invoice_id;
        DECLARE @entity_id varchar(100)=CONVERT(varchar(100),@invoice_id);
        DECLARE @audit_json nvarchar(max)=CONCAT(N'{"reason":"',STRING_ESCAPE(@reason,'json'),N'"}');
        EXEC dbo.sp_write_audit @actor_user_id,@branch_id,'INVOICE_VOIDED','INVOICE',
             @entity_id,NULL,@audit_json;
        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF XACT_STATE()<>0 ROLLBACK TRANSACTION;
        THROW;
    END CATCH;
END;
GO

/*=============================================================================
  19. DATABASE ROLES VÀ QUYỀN TỐI THIỂU

  Ví dụ sau khi DBA tạo login/user cho backend:
    ALTER ROLE clinic_api_executor ADD MEMBER [clinic_api_user];
  Worker hết hạn hold:
    ALTER ROLE clinic_job_executor ADD MEMBER [clinic_job_user];
  Tài khoản báo cáo:
    ALTER ROLE clinic_report_reader ADD MEMBER [clinic_report_user];
=============================================================================*/

IF DATABASE_PRINCIPAL_ID(N'clinic_api_executor') IS NULL
    CREATE ROLE clinic_api_executor AUTHORIZATION dbo;
IF DATABASE_PRINCIPAL_ID(N'clinic_job_executor') IS NULL
    CREATE ROLE clinic_job_executor AUTHORIZATION dbo;
IF DATABASE_PRINCIPAL_ID(N'clinic_report_reader') IS NULL
    CREATE ROLE clinic_report_reader AUTHORIZATION dbo;
IF DATABASE_PRINCIPAL_ID(N'auth_core_executor') IS NULL
    CREATE ROLE auth_core_executor AUTHORIZATION dbo;
GO

DENY INSERT, UPDATE, DELETE ON SCHEMA::dbo TO clinic_api_executor;
DENY INSERT, UPDATE, DELETE ON SCHEMA::dbo TO clinic_job_executor;
DENY INSERT, UPDATE, DELETE ON SCHEMA::dbo TO clinic_report_reader;
DENY INSERT, UPDATE, DELETE ON SCHEMA::dbo TO auth_core_executor;
GO

GRANT EXECUTE ON OBJECT::dbo.sp_auth_record_login_failure TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_auth_create_session TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_auth_rotate_session TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_auth_revoke_session TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_auth_revoke_all_sessions TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_staff_account TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_update_staff_account TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_set_staff_account_status TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_unlock_staff_account TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_grant_user_role TO auth_core_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_revoke_user_role TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.users TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.user_roles TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.roles TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.role_permissions TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.permissions TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.branches TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.employees TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.doctors TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.specialties TO auth_core_executor;
GRANT SELECT ON OBJECT::dbo.doctor_specialties TO auth_core_executor;
GO

REVOKE EXECUTE ON OBJECT::dbo.sp_create_staff_account FROM clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_room TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_service TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_assign_doctor_service TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_medicine_batch TO clinic_api_executor;
REVOKE EXECUTE ON OBJECT::dbo.sp_grant_user_role FROM clinic_api_executor;
REVOKE EXECUTE ON OBJECT::dbo.sp_revoke_user_role FROM clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_patient TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_patient_portal_account TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_link_user_patient TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_doctor_working_schedule TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_generate_doctor_slots TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_book_appointment TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_confirm_appointment TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_cancel_appointment TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_reschedule_appointment TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_mark_appointment_no_show TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_check_in_appointment TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_walk_in_encounter TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_call_next_queue_ticket TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_start_encounter TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_update_encounter_clinical_notes TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_add_vital_signs TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_add_encounter_diagnosis TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_order_encounter_service TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_finalize_service_result TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_complete_encounter TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_sign_encounter TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_add_encounter_amendment TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_cancel_encounter TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_prescription TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_add_prescription_item TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_issue_prescription TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_cancel_prescription TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_receive_stock TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_open_dispensation TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_dispense_prescription_item TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_complete_dispensation TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_reverse_dispensation_item TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_cancel_dispensation TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_create_invoice TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_sync_invoice_items TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_add_manual_invoice_item TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_set_invoice_insurance_amount TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_issue_invoice TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_record_invoice_payment TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_refund_payment_allocation TO clinic_api_executor;
GRANT EXECUTE ON OBJECT::dbo.sp_void_invoice TO clinic_api_executor;
GO

GRANT EXECUTE ON OBJECT::dbo.sp_expire_appointment_holds TO clinic_job_executor;
GO

GRANT SELECT ON OBJECT::dbo.v_available_appointment_slots TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_doctor_daily_schedule TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_current_queue TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_patient_encounter_history TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_prescription_remaining TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_inventory_by_batch TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_low_stock TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_expiring_medicine_batches TO clinic_api_executor;
GRANT SELECT ON OBJECT::dbo.v_invoice_balances TO clinic_api_executor;
GO

GRANT SELECT ON OBJECT::dbo.v_doctor_daily_schedule TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_current_queue TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_patient_encounter_history TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_inventory_by_batch TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_low_stock TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_expiring_medicine_batches TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_inventory_reconciliation TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_invoice_balances TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_daily_cash_collection TO clinic_report_reader;
GRANT SELECT ON OBJECT::dbo.v_doctor_time_off_conflicts TO clinic_report_reader;
GO

/*=============================================================================
  20. KIỂM TRA SAU TRIỂN KHAI
=============================================================================*/

IF NOT EXISTS (SELECT 1 FROM sys.time_zone_info WHERE name=N'SE Asia Standard Time')
    THROW 53900, N'SQL Server không có múi giờ SE Asia Standard Time.', 1;

PRINT N'Đã triển khai schema PrivateClinicManagement thành công.';
PRINT N'Bước tiếp theo: DBA gọi dbo.sp_bootstrap_first_admin bằng password hash từ backend.';

SELECT
    (SELECT COUNT(*) FROM sys.tables WHERE schema_id=SCHEMA_ID(N'dbo')) AS table_count,
    (SELECT COUNT(*) FROM sys.views WHERE schema_id=SCHEMA_ID(N'dbo')) AS view_count,
    (SELECT COUNT(*) FROM sys.procedures WHERE schema_id=SCHEMA_ID(N'dbo')) AS procedure_count,
    (SELECT COUNT(*) FROM sys.triggers WHERE parent_class_desc='OBJECT_OR_COLUMN') AS trigger_count;
GO

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    attendance_user_id TEXT UNIQUE,
    hourly_wage REAL NOT NULL DEFAULT 0 CHECK (hourly_wage >= 0),
    base_monthly_salary REAL NOT NULL DEFAULT 0 CHECK (base_monthly_salary >= 0),
    shift_hours REAL NOT NULL DEFAULT 8 CHECK (shift_hours > 0 AND shift_hours <= 24),
    shift_start TEXT,
    shift_end TEXT,
    weekly_rest_day INTEGER NOT NULL DEFAULT 4 CHECK (weekly_rest_day BETWEEN 0 AND 6),
    start_date TEXT NOT NULL,
    start_date_verified INTEGER NOT NULL DEFAULT 1 CHECK (start_date_verified IN (0, 1)),
    end_date TEXT,
    birth_date TEXT,
    disability INTEGER NOT NULL DEFAULT 0 CHECK (disability IN (0, 1)),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_period_overrides (
    employee_id TEXT NOT NULL REFERENCES employees(id),
    period TEXT NOT NULL,
    report_start TEXT NOT NULL,
    report_end TEXT,
    PRIMARY KEY (employee_id, period),
    CHECK (report_end IS NULL OR report_end >= report_start)
);

CREATE TABLE IF NOT EXISTS attendance_allowance_balances (
    employee_id TEXT NOT NULL REFERENCES employees(id),
    period TEXT NOT NULL,
    remaining_minutes INTEGER NOT NULL CHECK (remaining_minutes BETWEEN 0 AND 120),
    note TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (employee_id, period)
);

CREATE TABLE IF NOT EXISTS attendance_month_archives (
    period TEXT PRIMARY KEY CHECK (period = '2026-09'),
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attendance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    check_time TEXT NOT NULL,
    device_ip TEXT NOT NULL,
    status TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'device' CHECK (source IN ('device', 'manual', 'demo')),
    note TEXT NOT NULL DEFAULT '',
    duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
    permission_type TEXT NOT NULL DEFAULT '',
    permission_paid INTEGER NOT NULL DEFAULT 0 CHECK (permission_paid IN (0, 1)),
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, check_time, device_ip, status)
);

CREATE INDEX IF NOT EXISTS idx_attendance_logs_check_time
    ON attendance_logs(check_time);
CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_time
    ON attendance_logs(user_id, check_time);

CREATE TABLE IF NOT EXISTS company_holidays (
    holiday_date TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_outages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT REFERENCES employees(id),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    device_label TEXT NOT NULL,
    CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS leave_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    leave_type TEXT NOT NULL CHECK (leave_type IN ('annual', 'casual', 'sick')),
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    days INTEGER NOT NULL CHECK (days > 0),
    note TEXT NOT NULL DEFAULT '',
    medical_report_reference TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_leave_records_employee_dates
    ON leave_records(employee_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS payroll_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    period TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('deduction', 'permission')),
    amount REAL NOT NULL CHECK (amount >= 0),
    note TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payroll_approvals (
    period TEXT PRIMARY KEY,
    approved_by TEXT NOT NULL,
    approved_at TEXT NOT NULL,
    snapshot_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    period TEXT NOT NULL,
    base_pay REAL NOT NULL DEFAULT 0,
    days_present INTEGER NOT NULL DEFAULT 0,
    assumed_full_shift_days INTEGER NOT NULL DEFAULT 0,
    regular_hours REAL NOT NULL DEFAULT 0,
    permission_minutes INTEGER NOT NULL DEFAULT 0,
    free_delay_minutes INTEGER NOT NULL DEFAULT 0,
    charged_delay_minutes INTEGER NOT NULL DEFAULT 0,
    deducted_days REAL NOT NULL DEFAULT 0,
    overtime_hours REAL NOT NULL DEFAULT 0,
    overtime_pay REAL NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    late_deduction REAL NOT NULL DEFAULT 0,
        absence_days INTEGER NOT NULL DEFAULT 0,
        excused_absence_days INTEGER NOT NULL DEFAULT 0,
        absence_deduction REAL NOT NULL DEFAULT 0,
    other_deductions REAL NOT NULL DEFAULT 0,
    permission_deductions REAL NOT NULL DEFAULT 0,
    net_pay REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
    calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (employee_id, period)
);

CREATE INDEX IF NOT EXISTS idx_payroll_period ON payroll(period, status);
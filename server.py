import calendar
import hmac
import io
import ipaddress
import json
import os
import re
import sqlite3
import uuid
import zipfile
from datetime import date, datetime, time, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from xml.sax.saxutils import escape as xml_escape
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parent.parent
BACKEND = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env", override=False)
APP_ENV = os.environ.get("MAKHILLS_ENV", "development").strip().lower()
IS_PRODUCTION = APP_ENV in {"prod", "production"}
TOKEN = os.environ.get("MAKHILLS_API_TOKEN", "").strip()
if IS_PRODUCTION and len(TOKEN) < 32:
    raise RuntimeError("MAKHILLS_API_TOKEN must contain at least 32 characters in production")
if not TOKEN:
    TOKEN = "dev-only-change-me"
DB_PATH = Path(os.environ.get("MAKHILLS_DB_PATH", BACKEND / "data" / "makhills.sqlite3")).expanduser()
HOST = os.environ.get("MAKHILLS_HOST", os.environ.get("HOST", "0.0.0.0"))
PORT = int(os.environ.get("PORT", os.environ.get("MAKHILLS_PORT", "8000")))
OVERTIME_MULTIPLIER = float(os.environ.get("MAKHILLS_OVERTIME_MULTIPLIER", "1.5"))
CORS_ALLOWED_ORIGINS = {
    origin.strip().rstrip("/")
    for origin in os.environ.get("MAKHILLS_CORS_ORIGINS", "").split(",")
    if origin.strip()
}
for allowed_origin in CORS_ALLOWED_ORIGINS:
    parsed_origin = urlparse(allowed_origin)
    if (parsed_origin.scheme not in {"http", "https"} or not parsed_origin.netloc
            or parsed_origin.path or parsed_origin.query or parsed_origin.fragment
            or parsed_origin.username or parsed_origin.password):
        raise ValueError(f"Invalid origin in MAKHILLS_CORS_ORIGINS: {allowed_origin}")
    if IS_PRODUCTION and parsed_origin.scheme != "https":
        raise ValueError("Production CORS origins must use HTTPS")
DEFAULT_SHIFT_START = "12:00"
DEFAULT_SHIFT_END = "20:00"
SPECIAL_SHIFT_SCHEDULES = {
    "آية": ("14:00", "20:00"),
    "رضوى": ("12:00", "18:00"),
    "إسراء": ("14:00", "20:00"),
}
REPORTING_START_DATE = date(2026, 9, 1)
DUPLICATE_PUNCH_WINDOW_SECONDS = 60
MAX_BODY_BYTES = 1_000_000


def default_shift_schedule(employee_name):
    return SPECIAL_SHIFT_SCHEDULES.get(
        employee_name, (DEFAULT_SHIFT_START, DEFAULT_SHIFT_END),
    )

STAFF = [
    ("e1", "سلمى", "مسؤولة الاستقبال", "الاستقبال"),
    ("e2", "فرح", "مبيعات", "المبيعات"),
    ("e3", "رائد", "مبيعات", "المبيعات"),
    ("e4", "ذياد", "مبيعات", "المبيعات"),
    ("e5", "المهندسة هند", "مديرة المبيعات", "المبيعات"),
    ("e6", "رضوى", "مونتير", "التسويق"),
    ("e7", "آية", "جرافيك ديزاينر", "التسويق"),
    ("e8", "إسراء", "مديرة التسويق", "التسويق"),
    ("e9", "محمد مكي", "مهام متعددة", "الإدارة"),
    ("e10", "محمد عمر", "مدير الحسابات", "الحسابات"),
    ("e11", "محمد أبو الحمد مكي", "مدير الشركة", "الإدارة العليا"),
]


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exception_type, exception_value, traceback):
        try:
            return super().__exit__(exception_type, exception_value, traceback)
        finally:
            self.close()


def connect_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=15, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_db():
    schema = (BACKEND / "schema.sql").read_text(encoding="utf-8")
    with connect_db() as connection:
        connection.executescript(schema)
        log_columns = {row["name"] for row in connection.execute("PRAGMA table_info(attendance_logs)")}
        if "source" not in log_columns:
            connection.execute("ALTER TABLE attendance_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'device'")
        if "note" not in log_columns:
            connection.execute("ALTER TABLE attendance_logs ADD COLUMN note TEXT NOT NULL DEFAULT ''")
        if "duration_minutes" not in log_columns:
            connection.execute("ALTER TABLE attendance_logs ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0")
        if "permission_type" not in log_columns:
            connection.execute("ALTER TABLE attendance_logs ADD COLUMN permission_type TEXT NOT NULL DEFAULT ''")
        if "permission_paid" not in log_columns:
            connection.execute("ALTER TABLE attendance_logs ADD COLUMN permission_paid INTEGER NOT NULL DEFAULT 0")
        employee_columns = {row["name"] for row in connection.execute("PRAGMA table_info(employees)")}
        if "end_date" not in employee_columns:
            connection.execute("ALTER TABLE employees ADD COLUMN end_date TEXT")
        if "start_date_verified" not in employee_columns:
            connection.execute("ALTER TABLE employees ADD COLUMN start_date_verified INTEGER NOT NULL DEFAULT 1")
        if "birth_date" not in employee_columns:
            connection.execute("ALTER TABLE employees ADD COLUMN birth_date TEXT")
        if "disability" not in employee_columns:
            connection.execute("ALTER TABLE employees ADD COLUMN disability INTEGER NOT NULL DEFAULT 0")
        if "base_monthly_salary" not in employee_columns:
            connection.execute(
                "ALTER TABLE employees ADD COLUMN base_monthly_salary REAL NOT NULL DEFAULT 0"
            )
        if "weekly_rest_day" not in employee_columns:
            connection.execute("ALTER TABLE employees ADD COLUMN weekly_rest_day INTEGER NOT NULL DEFAULT 4")
        connection.execute("UPDATE employees SET shift_start = ? WHERE shift_start IS NULL", (DEFAULT_SHIFT_START,))
        connection.execute("UPDATE employees SET shift_end = ? WHERE shift_end IS NULL", (DEFAULT_SHIFT_END,))
        for employee_name, (shift_start, shift_end) in SPECIAL_SHIFT_SCHEDULES.items():
            connection.execute(
                """UPDATE employees SET shift_start = ?, shift_end = ?
                   WHERE name = ? AND shift_start = ? AND shift_end = ?""",
                (shift_start, shift_end, employee_name, DEFAULT_SHIFT_START, DEFAULT_SHIFT_END),
            )
        payroll_columns = {row["name"] for row in connection.execute("PRAGMA table_info(payroll)")}
        payroll_migrations = {
            "days_present": "INTEGER NOT NULL DEFAULT 0",
            "assumed_full_shift_days": "INTEGER NOT NULL DEFAULT 0",
            "permission_minutes": "INTEGER NOT NULL DEFAULT 0",
            "free_delay_minutes": "INTEGER NOT NULL DEFAULT 0",
            "charged_delay_minutes": "INTEGER NOT NULL DEFAULT 0",
            "deducted_days": "REAL NOT NULL DEFAULT 0",
            "absence_days": "INTEGER NOT NULL DEFAULT 0",
            "excused_absence_days": "INTEGER NOT NULL DEFAULT 0",
            "absence_deduction": "REAL NOT NULL DEFAULT 0",
        }
        for column, definition in payroll_migrations.items():
            if column not in payroll_columns:
                connection.execute(f"ALTER TABLE payroll ADD COLUMN {column} {definition}")
        existing = connection.execute("SELECT COUNT(*) FROM employees").fetchone()[0]
        if existing == 0:
            today = date.today().isoformat()
            connection.executemany(
                """INSERT INTO employees
                   (id, name, position, department, hourly_wage, shift_hours,
                          shift_start, shift_end, weekly_rest_day, start_date)
                         VALUES (?, ?, ?, ?, 0, 8, ?, ?, 4, ?)""",
                [(employee_id, name, position, department, *default_shift_schedule(name), today)
                 for employee_id, name, position, department in STAFF],
            )

        connection.execute(
            "UPDATE employees SET attendance_user_id = 'FP-3' WHERE id = 'e3' AND (attendance_user_id IS NULL OR attendance_user_id = '')"
        )
        connection.execute(
            "UPDATE employees SET attendance_user_id = 'FP-3' WHERE name = 'رائد' AND (attendance_user_id IS NULL OR attendance_user_id = '')"
        )
        connection.execute(
            "UPDATE employees SET attendance_user_id = 'FP-3' WHERE id = 'e3' AND (attendance_user_id IS NULL OR attendance_user_id = '')"
        )


def company_holidays(start_date, end_date):
    if end_date < start_date:
        return set()
    with connect_db() as connection:
        rows = connection.execute(
            "SELECT holiday_date FROM company_holidays WHERE holiday_date >= ? AND holiday_date <= ?",
            (start_date.isoformat(), end_date.isoformat()),
        ).fetchall()
    return {date.fromisoformat(row["holiday_date"]) for row in rows}


def normalized_rest_days(weekly_rest_day):
    rest_days = {4}
    configured_rest_day = int(weekly_rest_day)
    if configured_rest_day != 4:
        rest_days.add(configured_rest_day)
    return rest_days


def is_scheduled_workday(work_date, weekly_rest_day, holidays=()):
    return work_date.weekday() not in normalized_rest_days(weekly_rest_day) and work_date not in holidays


def scheduled_workdays(start_date, end_date, weekly_rest_day, holidays=()):
    if end_date < start_date:
        return 0
    return sum(
        is_scheduled_workday(start_date + timedelta(days=offset), weekly_rest_day, holidays)
        for offset in range((end_date - start_date).days + 1)
    )


def workdays_in_month(year, month, weekly_rest_day, holidays=None):
    first_day = date(year, month, 1)
    if month == 12:
        next_month = date(year + 1, 1, 1)
    else:
        next_month = date(year, month + 1, 1)
    total_days = (next_month - first_day).days
    holidays = holidays if holidays is not None else company_holidays(first_day, next_month - timedelta(days=1))
    scheduled_days = scheduled_workdays(first_day, next_month - timedelta(days=1), weekly_rest_day, holidays)
    return max(0, min(scheduled_days, total_days))


def calendar_workdays_in_month(year, month):
    first_day = date(year, month, 1)
    last_day = date(year, month, calendar.monthrange(year, month)[1])
    return scheduled_workdays(first_day, last_day, 4, company_holidays(first_day, last_day))


def salary_rates(employee, reference_date=None):
    reference_date = reference_date or date.today()
    shift_hours = float(employee["shift_hours"] or 0)
    rest_day = int(employee["weekly_rest_day"])
    month_start = date(reference_date.year, reference_date.month, 1)
    month_end = date(reference_date.year, reference_date.month, calendar.monthrange(reference_date.year, reference_date.month)[1])
    holidays = company_holidays(month_start, month_end)
    scheduled_days = workdays_in_month(reference_date.year, reference_date.month, rest_day, holidays)
    monthly_salary = float(employee["base_monthly_salary"] or 0)
    stored_hourly = float(employee["hourly_wage"] or 0)
    if monthly_salary > 0 and scheduled_days and shift_hours > 0:
        daily_rate = monthly_salary / scheduled_days
        hourly_rate = daily_rate / shift_hours
    else:
        hourly_rate = stored_hourly
        daily_rate = hourly_rate * shift_hours
    return {
        "daily_rate": daily_rate,
        "hourly_rate": hourly_rate,
        "working_days_in_month": scheduled_days,
    }


def employee_dict(row):
    rates = salary_rates(row)
    return {
        "id": row["id"], "name": row["name"], "position": row["position"],
        "department": row["department"], "attendance_user_id": row["attendance_user_id"],
        "hourly_wage": row["hourly_wage"], "base_monthly_salary": row["base_monthly_salary"],
        "daily_rate": round(rates["daily_rate"], 2),
        "hourly_rate": round(rates["hourly_rate"], 2),
        "working_days_in_month": rates["working_days_in_month"],
        "shift_hours": row["shift_hours"],
            "weekly_rest_day": row["weekly_rest_day"],
        "shift_start": row["shift_start"], "shift_end": row["shift_end"],
        "start_date": row["start_date"],
        "start_date_verified": bool(row["start_date_verified"]), "end_date": row["end_date"],
        "active": bool(row["active"]),
        "birth_date": row["birth_date"], "disability": bool(row["disability"]),
    }


def compensation_configured(employee):
    return bool(float(employee["base_monthly_salary"] or 0) or float(employee["hourly_wage"] or 0))


def completed_years(start_date, as_of):
    years = as_of.year - start_date.year
    if (as_of.month, as_of.day) < (start_date.month, start_date.day):
        years -= 1
    return max(0, years)


def employee_age(birth_date, as_of):
    if not birth_date:
        return None
    born = date.fromisoformat(birth_date)
    return completed_years(born, as_of)


def annual_leave_entitlement(employee, as_of):
    if bool(employee["disability"]):
        return 45
    age = employee_age(employee["birth_date"], as_of)
    service_years = completed_years(date.fromisoformat(employee["start_date"]), as_of)
    if (age is not None and age >= 50) or service_years >= 10:
        return 30
    return 21 if service_years >= 1 else 15


def leave_balance(employee, year):
    reference_date = min(date(year, 12, 31), date.today()) if year == date.today().year else date(year, 12, 31)
    annual_entitlement = annual_leave_entitlement(employee, reference_date)
    with connect_db() as connection:
        records = connection.execute(
            """SELECT id, leave_type, start_date, end_date, days, note, medical_report_reference
               FROM leave_records WHERE employee_id = ? AND substr(start_date, 1, 4) = ?
               ORDER BY start_date, id""",
            (employee["id"], str(year)),
        ).fetchall()
    annual_used = sum(row["days"] for row in records if row["leave_type"] == "annual")
    casual_used = sum(row["days"] for row in records if row["leave_type"] == "casual")
    sick_used = sum(row["days"] for row in records if row["leave_type"] == "sick")
    return {
        "year": year,
        "annual_entitlement": annual_entitlement,
        "annual_used": annual_used,
        "casual_used": casual_used,
        "annual_remaining": max(0, annual_entitlement - annual_used - casual_used),
        "casual_entitlement": 7,
        "casual_remaining": max(0, 7 - casual_used),
        "sick_used": sick_used,
        "sick_balance": None,
        "records": [dict(row) for row in records],
    }


def scheduled_leave_dates(employee, start_date, end_date):
    if end_date < start_date:
        return set()
    with connect_db() as connection:
        records = connection.execute(
            """SELECT start_date, end_date FROM leave_records WHERE employee_id = ?
               AND start_date <= ? AND end_date >= ?""",
            (employee["id"], end_date.isoformat(), start_date.isoformat()),
        ).fetchall()
    excluded = set()
    rest_day = int(employee["weekly_rest_day"])
    holidays = company_holidays(start_date, end_date)
    for record in records:
        leave_start = max(start_date, date.fromisoformat(record["start_date"]))
        leave_end = min(end_date, date.fromisoformat(record["end_date"]))
        current = leave_start
        while current <= leave_end:
            if is_scheduled_workday(current, rest_day, holidays):
                excluded.add(current)
            current += timedelta(days=1)
    return excluded


def employee_is_on_paid_leave(connection, employee_id, work_date):
    employee = connection.execute(
        "SELECT weekly_rest_day FROM employees WHERE id = ?", (employee_id,),
    ).fetchone()
    if not employee or not is_scheduled_workday(
        work_date, int(employee["weekly_rest_day"]), company_holidays(work_date, work_date),
    ):
        return False
    return connection.execute(
        """SELECT 1 FROM leave_records WHERE employee_id = ?
           AND start_date <= ? AND end_date >= ? LIMIT 1""",
        (employee_id, work_date.isoformat(), work_date.isoformat()),
    ).fetchone() is not None


def attendance_outage_dates(employee_id, start_date, end_date):
    if end_date < start_date:
        return set()
    with connect_db() as connection:
        outages = connection.execute(
                """SELECT start_date, end_date FROM attendance_outages
                    WHERE (employee_id IS NULL OR employee_id = ?)
                      AND start_date <= ? AND end_date >= ?""",
                (employee_id, end_date.isoformat(), start_date.isoformat()),
        ).fetchall()
    dates = set()
    for outage in outages:
        current = max(start_date, date.fromisoformat(outage["start_date"]))
        outage_end = min(end_date, date.fromisoformat(outage["end_date"]))
        while current <= outage_end:
            dates.add(current)
            current += timedelta(days=1)
    return dates


def assumed_full_shift_dates(employee_id, user_id, start_date, end_date, weekly_rest_day, holidays, recorded_dates):
    """Attendance is never inferred; only recorded punches count as worked time."""
    return set()


def parse_check_time(value):
    if not isinstance(value, str):
        raise ValueError("check_time must be an ISO-8601 string")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("check_time must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone().replace(tzinfo=None)
    return parsed


def paired_punch_intervals(ins, outs):
    events = sorted(
        [(stamp, "in") for stamp in ins] + [(stamp, "out") for stamp in outs],
        key=lambda event: event[0],
    )
    pending_ins = []
    intervals = []
    for stamp, direction in events:
        if direction == "in":
            pending_ins.append(stamp)
        elif pending_ins:
            check_in = pending_ins.pop(0)
            if stamp > check_in:
                intervals.append((check_in, stamp))
    return intervals


def interval_hours(intervals, work_date, shift_start, shift_end, scheduled_day, shift_hours):
    scheduled_start = datetime.combine(work_date, shift_start)
    scheduled_end = datetime.combine(work_date, shift_end)
    if scheduled_end <= scheduled_start:
        scheduled_end += timedelta(days=1)
    regular_seconds = overtime_seconds = 0
    for check_in, check_out in intervals:
        if scheduled_day:
            regular_start = max(check_in, scheduled_start)
            regular_end = min(check_out, scheduled_end)
            if regular_end > regular_start:
                regular_seconds += int((regular_end - regular_start).total_seconds())
        if check_out > scheduled_end:
            overtime_start = max(check_in, scheduled_end)
            overtime_seconds += max(0, int((check_out - overtime_start).total_seconds()))
    regular_hours = min(float(shift_hours), regular_seconds / 3600)
    return regular_hours, overtime_seconds / 3600, intervals


def authorized_overtime_hours(overtime_hours, work_date, shift_start, shift_end, approvals):
    shift_start_at = datetime.combine(work_date, shift_start)
    shift_end_at = datetime.combine(work_date, shift_end)
    if shift_end_at <= shift_start_at:
        shift_end_at += timedelta(days=1)
    approved_minutes = 0
    for approval in approvals:
        if len(approval) == 3:
            recorded_at, approved_at, minutes = approval
            if recorded_at <= shift_end_at and approved_at <= shift_end_at:
                approved_minutes += minutes
        elif len(approval) == 2:
            approved_at, minutes = approval
            if approved_at <= shift_end_at:
                approved_minutes += minutes
    return min(overtime_hours, approved_minutes / 60)


def validate_overtime_approval(employee, work_date, duration_minutes, approval_time, recorded_at=None):
    if duration_minutes <= 0:
        raise ValueError("Overtime approval must include a positive authorized duration")
    shift_start = time.fromisoformat(employee["shift_start"] or DEFAULT_SHIFT_START)
    shift_end = time.fromisoformat(employee["shift_end"] or DEFAULT_SHIFT_END)
    shift_end_at = datetime.combine(work_date, shift_end)
    if shift_end <= shift_start:
        shift_end_at += timedelta(days=1)
    checked_point = recorded_at or approval_time or datetime.now()
    if checked_point > shift_end_at:
        raise ValueError("Overtime must be recorded no later than the scheduled shift end")


def parse_database_timestamp(value):
    value = str(value).replace(" ", "T")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone().replace(tzinfo=None)


def local_timestamp(value):
    return value.isoformat(timespec="seconds")


def parse_boolean(value, field_name):
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.strip().lower() in {"true", "false", "1", "0", "yes", "no"}:
        return value.strip().lower() in {"true", "1", "yes"}
    raise ValueError(f"{field_name} must be a boolean")


def filter_duplicate_device_punches(connection, events):
    accepted = []
    for event in sorted(events, key=lambda item: (item[0], parse_check_time(item[1]), item[3])):
        user_id, timestamp, device_ip, status = event
        checked_at = parse_check_time(timestamp)
        work_date = checked_at.date().isoformat()

        existing_rows = connection.execute(
            """SELECT check_time FROM attendance_logs
               WHERE user_id = ? AND status = ? AND source = 'device'
                 AND substr(check_time, 1, 10) = ?""",
            (user_id, status, work_date),
        ).fetchall()
        db_times = [parse_check_time(row["check_time"]) for row in existing_rows]
        same_day_accepted = [
            item for item in accepted
            if item[0] == user_id and parse_check_time(item[1]).date().isoformat() == work_date and item[3] == status
        ]
        candidate_times = [parse_check_time(item[1]) for item in same_day_accepted] + db_times

        if status == "IN":
            earliest = min(candidate_times, default=None)
            if earliest is not None:
                delta_seconds = (checked_at - earliest).total_seconds()
                if 0 <= delta_seconds < DUPLICATE_PUNCH_WINDOW_SECONDS:
                    continue
            if earliest is not None and checked_at >= earliest:
                continue
            accepted = [
                item for item in accepted
                if not (item[0] == user_id and parse_check_time(item[1]).date().isoformat() == work_date and item[3] == "IN")
            ]
            accepted.append(event)
            if earliest is not None and checked_at < earliest:
                connection.execute(
                    """DELETE FROM attendance_logs
                       WHERE user_id = ? AND status = 'IN' AND source = 'device'
                         AND substr(check_time, 1, 10) = ? AND check_time > ?""",
                    (user_id, work_date, local_timestamp(checked_at)),
                )
            continue

        if status == "OUT":
            latest = max(candidate_times, default=None)
            if latest is not None:
                delta_seconds = (checked_at - latest).total_seconds()
                if 0 < delta_seconds < DUPLICATE_PUNCH_WINDOW_SECONDS:
                    continue
            if latest is not None and checked_at <= latest:
                continue
            accepted = [
                item for item in accepted
                if not (item[0] == user_id and parse_check_time(item[1]).date().isoformat() == work_date and item[3] == "OUT")
            ]
            accepted.append(event)
            if latest is not None and checked_at > latest:
                connection.execute(
                    """DELETE FROM attendance_logs
                       WHERE user_id = ? AND status = 'OUT' AND source = 'device'
                         AND substr(check_time, 1, 10) = ? AND check_time < ?""",
                    (user_id, work_date, local_timestamp(checked_at)),
                )
            continue

        previous = accepted[:]
        if previous:
            window_start = checked_at - timedelta(seconds=DUPLICATE_PUNCH_WINDOW_SECONDS - 1)
            window_end = checked_at + timedelta(seconds=DUPLICATE_PUNCH_WINDOW_SECONDS - 1)
            if any(
                item[0] == user_id and item[3] == status and window_start <= parse_check_time(item[1]) <= window_end
                for item in accepted
            ):
                continue

        accepted.append(event)

    return sorted(accepted, key=lambda item: (parse_check_time(item[1]), item[0], item[3]))


ATTENDANCE_IN_STATUSES = {
    "IN", "LATE_IN", "LATE_IN_UNEXCUSED", "CHECK_IN", "CHECKIN", "ENTRY",
    "ARRIVAL", "حضور", "FIELD_IN",
}
ATTENDANCE_OUT_STATUSES = {
    "OUT", "EARLY_OUT", "EXIT_PERMISSION", "CHECK_OUT", "CHECKOUT", "EXIT",
    "DEPARTURE", "انصراف", "FIELD_OUT",
}


def add_work_durations(logs):
    directions = {status: "in" for status in ATTENDANCE_IN_STATUSES}
    directions.update({status: "out" for status in ATTENDANCE_OUT_STATUSES})
    grouped = {}
    for log in logs:
        log["work_duration_seconds"] = None
        status = re.sub(r"[\s-]+", "_", str(log["status"]).strip().upper())
        direction = directions.get(status)
        if not direction:
            continue
        try:
            checked_at = parse_check_time(log["check_time"])
        except ValueError:
            continue
        key = (log["user_id"], checked_at.date())
        grouped.setdefault(key, []).append((checked_at, direction, log))

    for entries in grouped.values():
        pending_check_ins = []
        for checked_at, direction, log in sorted(entries, key=lambda entry: entry[0]):
            if direction == "in":
                pending_check_ins.append(checked_at)
            elif pending_check_ins:
                check_in = pending_check_ins.pop(0)
                duration = int((checked_at - check_in).total_seconds())
                if duration >= 0:
                    log["work_duration_seconds"] = duration
    return logs


def request_is_authorized(client_ip, authorization, origin=None):
    try:
        address = ipaddress.ip_address(client_ip)
    except ValueError:
        address = None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    allowed_local_origins = {None, f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
    if not IS_PRODUCTION and address and address.is_loopback and origin in allowed_local_origins:
        return True
    return bool(TOKEN) and hmac.compare_digest(str(authorization or ""), f"Bearer {TOKEN}")


def payroll_xlsx(period):
    if not re.fullmatch(r"\d{4}-\d{2}", period):
        raise ValueError("period must use YYYY-MM")
    try:
        datetime.strptime(period, "%Y-%m")
    except ValueError as error:
        raise ValueError("period must be a valid month") from error
    with connect_db() as connection:
        records = connection.execute(
                """SELECT p.*, e.name, e.hourly_wage, e.base_monthly_salary
                    FROM payroll p JOIN employees e ON e.id = p.employee_id
               WHERE p.period = ? ORDER BY e.name""",
            (period,),
        ).fetchall()
    if not records:
        raise LookupError("Calculate payroll for this month before exporting")

    headers = [
        "الموظف", "أيام الحضور", "أيام شفت مفترض", "الساعات العادية", "دقائق التأخير",
        "دقائق الأذونات", "المجاني من الرصيد", "المتجاوز للرصيد",
        "أيام الخصم", "خصم التأخير (جنيه)", "غياب بلا عذر",
        "غياب بعذر", "خصم الغياب (جنيه)", "الراتب الأساسي (جنيه)",
        "الساعات الإضافية", "أجر الإضافي (جنيه)", "خصومات أخرى (جنيه)",
        "خصومات الأذونات (جنيه)", "الصافي (جنيه)", "الحالة",
    ]
    all_compensation_configured = all(compensation_configured(row) for row in records)
    rows = [
        [row["name"], row["days_present"], row["assumed_full_shift_days"], row["regular_hours"], row["late_minutes"],
         row["permission_minutes"], row["free_delay_minutes"], row["charged_delay_minutes"],
         row["deducted_days"] if compensation_configured(row) else "",
         row["late_deduction"] if compensation_configured(row) else "", row["absence_days"],
         row["excused_absence_days"], row["absence_deduction"] if compensation_configured(row) else "",
         row["base_pay"] if compensation_configured(row) else "", row["overtime_hours"],
         row["overtime_pay"] if compensation_configured(row) else "", row["other_deductions"],
         row["permission_deductions"] if compensation_configured(row) else "",
         row["net_pay"] if compensation_configured(row) else "",
         "معتمد" if row["status"] == "approved" else "أجر غير مسجل" if not compensation_configured(row) else "مسودة"]
        for row in records
    ]
    totals = [
        "الإجمالي", "", sum(row["assumed_full_shift_days"] for row in records),
        sum(row["regular_hours"] for row in records),
        sum(row["late_minutes"] for row in records),
        sum(row["permission_minutes"] for row in records),
        sum(row["free_delay_minutes"] for row in records),
        sum(row["charged_delay_minutes"] for row in records),
        sum(row["deducted_days"] for row in records) if all_compensation_configured else "",
        sum(row["late_deduction"] for row in records) if all_compensation_configured else "",
        sum(row["absence_days"] for row in records),
        sum(row["excused_absence_days"] for row in records),
        sum(row["absence_deduction"] for row in records) if all_compensation_configured else "",
        sum(row["base_pay"] for row in records) if all_compensation_configured else "",
        sum(row["overtime_hours"] for row in records),
        sum(row["overtime_pay"] for row in records) if all_compensation_configured else "",
        sum(row["other_deductions"] for row in records),
        sum(row["permission_deductions"] for row in records) if all_compensation_configured else "",
        sum(row["net_pay"] for row in records) if all_compensation_configured else "",
    ]

    def column_name(number):
        name = ""
        while number:
            number, remainder = divmod(number - 1, 26)
            name = chr(65 + remainder) + name
        return name

    def cell_xml(reference, value, style=0):
        style_attribute = f' s="{style}"' if style else ""
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{reference}"{style_attribute}><v>{value}</v></c>'
        text = xml_escape(str(value), {"\"": "&quot;", "'": "&apos;"})
        return f'<c r="{reference}" t="inlineStr"{style_attribute}><is><t xml:space="preserve">{text}</t></is></c>'

    sheet_rows = []
    sheet_rows.append('<row r="1" ht="30" customHeight="1">' + cell_xml("A1", "MAK HILLS GROUP", 1) + "</row>")
    sheet_rows.append('<row r="2" ht="23" customHeight="1">' + cell_xml("A2", f"كشف الرواتب الشهرية · {period}", 2) + "</row>")
    sheet_rows.append('<row r="3"/>')
    header_cells = "".join(cell_xml(f"{column_name(index)}4", value, 3) for index, value in enumerate(headers, 1))
    sheet_rows.append(f'<row r="4" ht="28" customHeight="1">{header_cells}</row>')
    for row_index, row in enumerate(rows, 5):
        cells = "".join(
            cell_xml(f"{column_name(column_index)}{row_index}", value,
                     5 if column_index == 20 else 4 if isinstance(value, (int, float)) else 0)
            for column_index, value in enumerate(row, 1)
        )
        sheet_rows.append(f"<row r=\"{row_index}\">{cells}</row>")
    total_index = len(rows) + 5
    total_cells = "".join(
        cell_xml(f"{column_name(column_index)}{total_index}", value,
                 5 if column_index == 20 else 3 if column_index == 1 else 4 if isinstance(value, (int, float)) else 3)
        for column_index, value in enumerate(totals, 1)
    )
    sheet_rows.append(f'<row r="{total_index}" ht="23" customHeight="1">{total_cells}</row>')
    widths = [24, 13, 17, 17, 15, 15, 17, 17, 13, 20, 15, 13, 20, 22, 17, 20, 20, 22, 19, 13]
    columns = "".join(f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>' for index, width in enumerate(widths, 1))
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
        f'<cols>{columns}</cols><sheetData>{"".join(sheet_rows)}</sheetData>'
        f'<autoFilter ref="A4:T{total_index-1}"/><mergeCells count="1"><mergeCell ref="A1:T1"/></mergeCells>'
        '</worksheet>'
    )
    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="3"><font><sz val="10"/><name val="Arial"/><color rgb="FF14233F"/></font><font><b/><sz val="18"/><name val="Arial"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="12"/><name val="Arial"/><color rgb="FF102347"/></font></fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF102347"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC69B4B"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1F4F8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8DFEB"/></left><right style="thin"><color rgb="FFD8DFEB"/></right><top style="thin"><color rgb="FFD8DFEB"/></top><bottom style="thin"><color rgb="FFD8DFEB"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs>
</styleSheet>'''
    workbook_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="الرواتب" sheetId="1" r:id="rId1"/></sheets></workbook>'''
    parts = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>''',
        "xl/workbook.xml": workbook_xml,
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''',
        "xl/worksheets/sheet1.xml": sheet_xml,
        "xl/styles.xml": styles_xml,
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as workbook:
        for name, content in parts.items():
            workbook.writestr(name, content.encode("utf-8"))
    return output.getvalue()


def payroll_preview(period, as_of=None, now=None):
    if not re.fullmatch(r"\d{4}-\d{2}", period):
        raise ValueError("period must use YYYY-MM")
    try:
        datetime.strptime(period, "%Y-%m")
    except ValueError as error:
        raise ValueError("period must be a valid month") from error

    now = now or datetime.now()
    as_of = as_of or now.date()
    is_current_period = period == as_of.strftime("%Y-%m")
    month_start = date.fromisoformat(f"{period}-01")
    month_end = date(
        month_start.year, month_start.month,
        calendar.monthrange(month_start.year, month_start.month)[1],
    )

    with connect_db() as connection:
        employees = connection.execute(
            """SELECT * FROM employees WHERE start_date <= ?
               AND (end_date IS NULL OR end_date >= ?)
               AND (active = 1 OR end_date IS NOT NULL) ORDER BY name""",
            (month_end.isoformat(), month_start.isoformat()),
        ).fetchall()
        period_overrides = {
            row["employee_id"]: dict(row)
            for row in connection.execute(
                "SELECT employee_id, report_start, report_end FROM payroll_period_overrides WHERE period = ?",
                (period,),
            ).fetchall()
        }
        logs = connection.execute(
            """SELECT user_id, check_time, status, duration_minutes, received_at,
                      permission_type, permission_paid FROM attendance_logs """
            "WHERE substr(check_time, 1, 7) = ? ORDER BY check_time",
            (period,),
        ).fetchall()
        adjustments = connection.execute(
            """SELECT employee_id, kind, SUM(amount) AS amount FROM payroll_adjustments
               WHERE period = ? GROUP BY employee_id, kind""",
            (period,),
        ).fetchall()
        allowance_balances = {
            row["employee_id"]: int(row["remaining_minutes"])
            for row in connection.execute(
                "SELECT employee_id, remaining_minutes FROM attendance_allowance_balances WHERE period = ?",
                (period,),
            ).fetchall()
        }
        approval = connection.execute(
            "SELECT approved_by, approved_at FROM payroll_approvals WHERE period = ?",
            (period,),
        ).fetchone()

    adjustment_map = {}
    for row in adjustments:
        adjustment_map.setdefault(row["employee_id"], {})[row["kind"]] = row["amount"]

    entries_by_user = {}
    unpaid_permission_minutes_by_user = {}
    known_users = set()
    for employee in employees:
        user_id = employee["attendance_user_id"] or employee["id"]
        known_users.add(user_id)
        entries_by_user[user_id] = []

    for log in logs:
        user_id = log["user_id"]
        if user_id not in entries_by_user:
            continue
        try:
            checked_at = parse_check_time(log["check_time"])
        except ValueError:
            continue
        if is_current_period and checked_at.date() > as_of:
            continue
        status = re.sub(r"[\s-]+", "_", log["status"].strip().upper())
        permission_type = str(log["permission_type"] or "").strip().lower()
        if status in {"PERMISSION", "إذن"} and permission_type:
            if log["permission_paid"]:
                status = "PAID_PERMISSION"
            else:
                status = "UNPAID_PERMISSION"
                unpaid_permission_minutes_by_user[user_id] = (
                    unpaid_permission_minutes_by_user.get(user_id, 0)
                    + int(log["duration_minutes"] or 0)
                )
        entries_by_user[user_id].append((
            checked_at,
            status,
            int(log["duration_minutes"] or 0),
            log["received_at"],
        ))

    staff_results = []
    for employee in employees:
        user_id = employee["attendance_user_id"] or employee["id"]
        free_delay_minutes = 120 - allowance_balances.get(employee["id"], 120)
        schedule_start = employee["shift_start"]
        schedule_end = employee["shift_end"]
        adjustments_for_employee = adjustment_map.get(employee["id"], {})
        deductions = float(adjustments_for_employee.get("deduction", 0))
        permissions = float(adjustments_for_employee.get("permission", 0))
        unpaid_permission_minutes = unpaid_permission_minutes_by_user.get(user_id, 0)
        if not schedule_start or not schedule_end:
            staff_results.append({
                **employee_dict(employee), "schedule_configured": False,
                "compensation_configured": compensation_configured(employee),
                "days_present": 0, "late_minutes": 0, "permission_minutes": 0,
                "assumed_full_shift_days": 0,
                "free_delay_minutes": 0, "charged_delay_minutes": 0,
                "deducted_days": 0, "absence_days": 0, "excused_absence_days": 0,
                "absence_deduction": 0, "regular_hours": 0,
                "overtime_hours": 0, "base_pay": 0, "overtime_pay": 0,
                "late_deduction": 0, "other_deductions": deductions,
                "permission_deductions": permissions, "net_pay": 0,
            })
            continue

        start_clock = time.fromisoformat(schedule_start)
        end_clock = time.fromisoformat(schedule_end)
        override = period_overrides.get(employee["id"], {})
        effective_start = date.fromisoformat(override.get("report_start", employee["start_date"]))
        period_start = max(month_start, effective_start)
        employee_end = date.fromisoformat(employee["end_date"]) if employee["end_date"] else month_end
        override_end = date.fromisoformat(override["report_end"]) if override.get("report_end") else month_end
        contract_end = min(month_end, employee_end, override_end)
        period_end = min(contract_end, as_of) if is_current_period else contract_end
        holidays = company_holidays(period_start, contract_end)
        leave_dates = scheduled_leave_dates(employee, period_start, period_end)
        daily = {}
        for checked_at, status, duration_minutes, received_at in entries_by_user[user_id]:
            if checked_at.date() < period_start or checked_at.date() > contract_end:
                continue
            if status in ATTENDANCE_IN_STATUSES:
                kind = "field_in" if status == "FIELD_IN" else "in"
                daily.setdefault(checked_at.date(), []).append((kind, checked_at, 0))
            elif status in ATTENDANCE_OUT_STATUSES:
                kind = "field_out" if status == "FIELD_OUT" else "out"
                daily.setdefault(checked_at.date(), []).append((kind, checked_at, 0))
            elif status in {"PERMISSION", "إذن"}:
                daily.setdefault(checked_at.date(), []).append(("permission", checked_at, duration_minutes))
            elif status == "PAID_PERMISSION":
                daily.setdefault(checked_at.date(), []).append(("paid_permission", checked_at, duration_minutes))
            elif status == "UNPAID_PERMISSION":
                daily.setdefault(checked_at.date(), []).append(("unpaid_permission", checked_at, duration_minutes))
            elif status == "OVERTIME_APPROVED":
                approval_time = checked_at
                daily.setdefault(checked_at.date(), []).append((
                    "overtime_approval", checked_at, approval_time, duration_minutes,
                ))
            elif status in {"ABSENCE_UNEXCUSED", "غياب_بدون_عذر"}:
                daily.setdefault(checked_at.date(), []).append(("absence", checked_at, 0))
            elif status in {"ABSENCE_EXCUSED", "غياب_بعذر", "LEAVE", "إجازة"}:
                daily.setdefault(checked_at.date(), []).append(("excused_absence", checked_at, 0))

        assumed_dates = assumed_full_shift_dates(
            employee["id"], user_id, period_start, min(period_end, as_of), int(employee["weekly_rest_day"]),
            holidays, set(daily),
        )
        assumed_dates.difference_update(leave_dates)
        for assumed_date in assumed_dates:
            assumed_start = datetime.combine(assumed_date, start_clock)
            assumed_end = datetime.combine(assumed_date, end_clock)
            if assumed_end <= assumed_start:
                assumed_end += timedelta(days=1)
            daily[assumed_date] = [
                ("in", assumed_start, 0), ("out", assumed_end, 0),
            ]

        days_present = late_minutes = permission_minutes = 0
        absence_dates = set()
        excused_absence_dates = set()
        regular_hours = overtime_hours = 0.0
        for work_date, punches in daily.items():
            if work_date in leave_dates:
                continue
            rest_day = int(employee["weekly_rest_day"])
            scheduled_day = is_scheduled_workday(work_date, rest_day, holidays)
            ins = [stamp for punch in punches if punch[0] in {"in", "field_in"} for stamp in [punch[1]]]
            outs = [stamp for punch in punches if punch[0] in {"out", "field_out"} for stamp in [punch[1]]]
            intervals = paired_punch_intervals(ins, outs)
            if not scheduled_day:
                if intervals:
                    _, day_overtime, _ = interval_hours(
                        intervals, work_date, start_clock, end_clock, False,
                        float(employee["shift_hours"]),
                    )
                    approvals = []
                    for punch in punches:
                        if punch[0] == "overtime_approval":
                            if len(punch) >= 4:
                                approvals.append((punch[1], punch[2], punch[3]))
                            elif len(punch) >= 3:
                                approvals.append((punch[1], punch[1], punch[2]))
                    overtime_hours += authorized_overtime_hours(
                        day_overtime, work_date, start_clock, end_clock, approvals,
                    )
                continue

            permission_minutes += sum(punch[2] for punch in punches if punch[0] == "permission")
            if any(punch[0] == "absence" for punch in punches) and work_date not in leave_dates:
                absence_dates.add(work_date)
            if any(punch[0] == "excused_absence" for punch in punches):
                excused_absence_dates.add(work_date)
            if not intervals:
                continue
            absence_dates.discard(work_date)
            excused_absence_dates.discard(work_date)
            days_present += 1
            if not any(punch[0] in {"field_in", "field_out", "paid_permission", "unpaid_permission"} for punch in punches):
                first_in = min(start for start, _ in intervals)
                shift_start = datetime.combine(work_date, start_clock)
                if work_date not in assumed_dates:
                    late_minutes += max(0, int((first_in - shift_start).total_seconds() // 60))
            day_regular, day_overtime, _ = interval_hours(
                intervals, work_date, start_clock, end_clock, True,
                float(employee["shift_hours"]),
            )
            approvals = []
            for punch in punches:
                if punch[0] == "overtime_approval":
                    if len(punch) >= 4:
                        approvals.append((punch[1], punch[2], punch[3]))
                    elif len(punch) >= 3:
                        approvals.append((punch[1], punch[1], punch[2]))
            day_overtime = authorized_overtime_hours(
                day_overtime, work_date, start_clock, end_clock, approvals,
            )
            regular_hours += day_regular
            overtime_hours += day_overtime

        if is_current_period:
            work_date = period_start
            inference_end = period_end
            first_assumed_date = min(assumed_dates) if assumed_dates else None
            if as_of == now.date() and now.time() < end_clock:
                inference_end -= timedelta(days=1)
            while work_date <= inference_end:
                punches = daily.get(work_date, [])
                has_attendance = any(
                    punch[0] in {"in", "out", "field_in", "field_out"}
                    for punch in punches
                )
                has_explicit_absence = any(punch[0] == "absence" for punch in punches)
                has_excused_absence = (
                    any(punch[0] == "excused_absence" for punch in punches)
                    or work_date in leave_dates
                )
                if (
                    first_assumed_date is not None
                    and work_date < first_assumed_date
                    and not has_attendance
                    and not has_explicit_absence
                    and not has_excused_absence
                ):
                    work_date += timedelta(days=1)
                    continue
                if (is_scheduled_workday(work_date, int(employee["weekly_rest_day"]), holidays)
                        and not has_attendance and not has_excused_absence):
                    absence_dates.add(work_date)
                work_date += timedelta(days=1)

        monthly_salary = float(employee["base_monthly_salary"])
        hourly_wage = float(employee["hourly_wage"])
        shift_hours = float(employee["shift_hours"])
        paid_leave_days = len(leave_dates)
        paid_leave_hours = paid_leave_days * shift_hours
        daily_rate = (
            salary_rates(employee, month_start)["daily_rate"]
            if monthly_salary else hourly_wage * shift_hours
        )
        permissions += unpaid_permission_minutes * hourly_wage / 60
        total_delay_minutes = late_minutes + permission_minutes
        free_delay_minutes = 120 - allowance_balances.get(employee["id"], 120)
        charged_delay_minutes = max(0, total_delay_minutes - 120)
        deducted_days = (charged_delay_minutes // 30) * 0.5
        absence_days = len(absence_dates)
        excused_absence_days = len(excused_absence_dates)
        if monthly_salary:
            month_workdays = workdays_in_month(
                month_start.year, month_start.month, int(employee["weekly_rest_day"]),
                company_holidays(month_start, month_end),
            )
            employed_workdays = scheduled_workdays(
                period_start,
                min(month_end, date.fromisoformat(employee["end_date"])) if employee["end_date"] else month_end,
                int(employee["weekly_rest_day"]), company_holidays(month_start, month_end),
            )
            base_pay = monthly_salary * employed_workdays / month_workdays if month_workdays else 0
        else:
            base_pay = (regular_hours + paid_leave_hours) * hourly_wage
        overtime_pay = overtime_hours * hourly_wage * OVERTIME_MULTIPLIER
        late_deduction = deducted_days * daily_rate
        absence_deduction = absence_days * 2 * daily_rate
        net_pay = max(0, base_pay + overtime_pay - late_deduction - absence_deduction - deductions - permissions)
        staff_results.append({
            **employee_dict(employee), "schedule_configured": True,
            "compensation_configured": compensation_configured(employee),
            "days_present": days_present, "late_minutes": late_minutes,
            "assumed_full_shift_days": len(assumed_dates),
            "paid_leave_days": paid_leave_days,
            "paid_leave_hours": round(paid_leave_hours, 2),
            "permission_minutes": permission_minutes,
            "free_delay_minutes": free_delay_minutes,
            "charged_delay_minutes": charged_delay_minutes,
            "deducted_days": deducted_days,
            "absence_days": absence_days,
            "excused_absence_days": excused_absence_days,
            "regular_hours": round(regular_hours, 2),
            "overtime_hours": round(overtime_hours, 2),
            "base_pay": round(base_pay, 2), "overtime_pay": round(overtime_pay, 2),
            "late_deduction": round(late_deduction, 2),
            "absence_deduction": round(absence_deduction, 2),
            "other_deductions": round(deductions, 2),
            "permission_deductions": round(permissions, 2), "net_pay": round(net_pay, 2),
        })

    return {
        "period": period,
        "rules": {
            "overtime_multiplier": OVERTIME_MULTIPLIER,
            "weekly_rest_day": 4,
            "monthly_free_delay_minutes": 120,
            "deduction_days_per_30_excess_minutes": 0.5,
            "unexcused_absence_deduction_days": 2,
            "unrecognized_statuses_are_ignored": True,
        },
        "unmatched_log_count": sum(1 for log in logs if log["user_id"] not in known_users),
        "totals": {
            "base_pay": round(sum(item["base_pay"] for item in staff_results), 2),
            "overtime_pay": round(sum(item["overtime_pay"] for item in staff_results), 2),
            "deductions": round(sum(item["late_deduction"] + item["absence_deduction"] + item["other_deductions"] + item["permission_deductions"] for item in staff_results), 2),
            "net_pay": round(sum(item["net_pay"] for item in staff_results), 2),
        },
        "approved": dict(approval) if approval else None,
        "employees": staff_results,
    }


def refresh_existing_payroll(period):
    with connect_db() as connection:
        existing = connection.execute(
            "SELECT 1 FROM payroll WHERE period = ? LIMIT 1", (period,)
        ).fetchone()
    if not existing:
        return

    snapshot = payroll_preview(period)
    if any(not item["schedule_configured"] for item in snapshot["employees"]):
        return
    calculated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with connect_db() as connection:
        for item in snapshot["employees"]:
            connection.execute(
                "INSERT OR IGNORE INTO payroll(employee_id, period) VALUES (?, ?)",
                (item["id"], period),
            )
            connection.execute(
                """UPDATE payroll SET base_pay = ?, days_present = ?,
                   assumed_full_shift_days = ?, regular_hours = ?, permission_minutes = ?,
                   free_delay_minutes = ?, charged_delay_minutes = ?, deducted_days = ?,
                   overtime_hours = ?, overtime_pay = ?, late_minutes = ?, late_deduction = ?,
                   absence_days = ?, excused_absence_days = ?, absence_deduction = ?,
                   other_deductions = ?, permission_deductions = ?, net_pay = ?,
                   status = 'draft', calculated_at = ?
                   WHERE employee_id = ? AND period = ?""",
                (item["base_pay"], item["days_present"], item["assumed_full_shift_days"],
                 item["regular_hours"], item["permission_minutes"], item["free_delay_minutes"],
                 item["charged_delay_minutes"], item["deducted_days"], item["overtime_hours"],
                 item["overtime_pay"], item["late_minutes"], item["late_deduction"],
                 item["absence_days"], item["excused_absence_days"], item["absence_deduction"],
                 item["other_deductions"], item["permission_deductions"], item["net_pay"],
                 calculated_at, item["id"], period),
            )


def employee_summary(employee_id, as_of=None, now=None, month=None):
    now = now or datetime.now()
    if month:
        try:
            month_date = datetime.strptime(month, "%Y-%m").date().replace(day=1)
        except ValueError as error:
            raise ValueError("month must use YYYY-MM") from error
        if month_date > now.date().replace(day=1):
            raise ValueError("month cannot be in the future")
        if month_date < REPORTING_START_DATE.replace(day=1):
            raise ValueError("month is before the reporting start date")
        requested_end = date(month_date.year, month_date.month, calendar.monthrange(month_date.year, month_date.month)[1])
        as_of = min(now.date(), requested_end)
    else:
        as_of = as_of or now.date()
    as_of = min(now.date(), max(REPORTING_START_DATE, as_of))
    period = month or as_of.strftime("%Y-%m")
    with connect_db() as connection:
        employee = connection.execute("SELECT * FROM employees WHERE id = ?", (employee_id,)).fetchone()
        if not employee:
            return None
        manual_allowance_rows = connection.execute(
            """SELECT period, remaining_minutes, note FROM attendance_allowance_balances
               WHERE employee_id = ? AND period >= ? AND period <= ?""",
            (employee_id, REPORTING_START_DATE.strftime("%Y-%m"), period),
        ).fetchall()
        manual_allowances = {row["period"]: dict(row) for row in manual_allowance_rows}
        period_override = connection.execute(
            "SELECT report_start FROM payroll_period_overrides WHERE employee_id = ? AND period = ?",
            (employee_id, period),
        ).fetchone()
        if employee["end_date"]:
            as_of = min(as_of, date.fromisoformat(employee["end_date"]))
        user_id = employee["attendance_user_id"] or employee["id"]
        start_date = max(
            REPORTING_START_DATE,
            date.fromisoformat(period_override["report_start"] if period_override else employee["start_date"]),
            date.fromisoformat(f"{period}-01") if month else REPORTING_START_DATE,
        )
        logs = connection.execute(
            """SELECT check_time, status, duration_minutes, permission_type, permission_paid, note, received_at
               FROM attendance_logs WHERE user_id = ? AND check_time >= ? AND check_time < ?
               ORDER BY check_time""",
            (user_id, start_date.isoformat(), (as_of + timedelta(days=1)).isoformat()),
        ).fetchall()
        adjustments = connection.execute(
            """SELECT kind, period, amount, note FROM payroll_adjustments
               WHERE employee_id = ? AND period >= ? AND period <= ? ORDER BY period, id""",
            (employee_id, REPORTING_START_DATE.strftime("%Y-%m"), period),
        ).fetchall()

    adjustment_totals = {}
    adjustment_records = []
    for row in adjustments:
        amount = float(row["amount"] or 0)
        adjustment_totals[row["kind"]] = adjustment_totals.get(row["kind"], 0) + amount
        adjustment_records.append({
            "period": row["period"], "kind": row["kind"], "amount": round(amount, 2),
            "note": row["note"],
        })
    daily = {}
    permission_records = []
    for log in logs:
        try:
            checked_at = parse_check_time(log["check_time"])
        except ValueError:
            continue
        status = re.sub(r"[\s-]+", "_", str(log["status"]).strip().upper())
        entry = daily.setdefault(checked_at.date(), {"ins": [], "outs": [], "excused": False,
                                                       "unexcused": False, "permissions": [],
                                                       "overtime_approvals": []})
        if status in ATTENDANCE_IN_STATUSES:
            entry["ins"].append(checked_at)
        elif status in ATTENDANCE_OUT_STATUSES:
            entry["outs"].append(checked_at)
        elif status in {"ABSENCE_EXCUSED", "غياب_بعذر", "LEAVE", "إجازة"}:
            entry["excused"] = True
        elif status in {"ABSENCE_UNEXCUSED", "غياب_بدون_عذر"}:
            entry["unexcused"] = True
        elif status == "OVERTIME_APPROVED":
            entry["overtime_approvals"].append((
                checked_at,
                checked_at,
                int(log["duration_minutes"] or 0),
            ))
        elif status in {"PERMISSION", "إذن"}:
            permission = {
                "date": checked_at.date().isoformat(),
                "time": checked_at.strftime("%H:%M"),
                "minutes": int(log["duration_minutes"] or 0),
                "type": str(log["permission_type"] or ""),
                "paid": bool(log["permission_paid"]),
                "note": str(log["note"] or ""),
            }
            entry["permissions"].append(permission)
            permission_records.append(permission)

    shift_start = time.fromisoformat(employee["shift_start"] or DEFAULT_SHIFT_START)
    shift_end = time.fromisoformat(employee["shift_end"] or DEFAULT_SHIFT_END)
    shift_end_for_today = datetime.combine(as_of, shift_end)
    if shift_end <= shift_start:
        shift_end_for_today += timedelta(days=1)
    completed_through = as_of
    if as_of == now.date() and now < shift_end_for_today:
        completed_through -= timedelta(days=1)

    leave_dates = scheduled_leave_dates(employee, start_date, completed_through)
    permission_records = [
        item for item in permission_records
        if date.fromisoformat(item["date"]) not in leave_dates
    ]
    holidays = company_holidays(start_date, as_of)
    assumed_dates = assumed_full_shift_dates(
        employee["id"], user_id, start_date, completed_through, int(employee["weekly_rest_day"]),
        holidays, set(daily),
    )
    assumed_dates.difference_update(leave_dates)
    for assumed_date in assumed_dates:
        assumed_start = datetime.combine(assumed_date, shift_start)
        assumed_end = datetime.combine(assumed_date, shift_end)
        if assumed_end <= assumed_start:
            assumed_end += timedelta(days=1)
        daily[assumed_date] = {
            "ins": [assumed_start], "outs": [assumed_end],
            "excused": False, "unexcused": False, "permissions": [],
        }
    scheduled_dates = []
    work_date = start_date
    rest_day = int(employee["weekly_rest_day"])
    while work_date <= completed_through:
        day = daily.get(work_date, {})
        worked_intervals = paired_punch_intervals(day.get("ins", []), day.get("outs", []))
        if is_scheduled_workday(work_date, rest_day, holidays) and work_date not in leave_dates:
            scheduled_dates.append(work_date)
        work_date += timedelta(days=1)

    attendance_dates = set()
    excused_dates = set()
    absence_dates = set()
    punctual_days = eligible_punctual_days = late_minutes = unpaid_permission_minutes = 0
    regular_hours = overtime_hours = 0.0
    monthly_totals = {}
    for work_date in scheduled_dates:
        month_key = work_date.strftime("%Y-%m")
        month_totals = monthly_totals.setdefault(month_key, {
            "scheduled_days": 0, "late_minutes": 0, "absence_days": 0,
            "unpaid_permission_minutes": 0, "overtime_hours": 0.0,
        })
        month_totals["scheduled_days"] += 1
        day = daily.get(work_date, {})
        ins = day.get("ins", [])
        outs = day.get("outs", [])
        permissions = day.get("permissions", [])
        if day.get("excused"):
            excused_dates.add(work_date)
        intervals = paired_punch_intervals(ins, outs)
        if intervals:
            if work_date not in assumed_dates:
                attendance_dates.add(work_date)
            paid_permission = any(item["paid"] for item in permissions)
            first_in = min(start for start, _ in intervals)
            scheduled_start = datetime.combine(work_date, shift_start)
            is_late = first_in > scheduled_start
            if not paid_permission and work_date not in assumed_dates:
                eligible_punctual_days += 1
                if is_late:
                    day_late_minutes = int((first_in - scheduled_start).total_seconds() // 60)
                    late_minutes += day_late_minutes
                    month_totals["late_minutes"] += day_late_minutes
                else:
                    punctual_days += 1
            day_regular, day_overtime, _ = interval_hours(
                intervals, work_date, shift_start, shift_end,
                is_scheduled_workday(work_date, rest_day, holidays),
                float(employee["shift_hours"]),
            )
            day_overtime = authorized_overtime_hours(
                day_overtime, work_date, shift_start, shift_end, day.get("overtime_approvals", []),
            )
            regular_hours += day_regular
            overtime_hours += day_overtime
            month_totals["overtime_hours"] += day_overtime
        else:
            first_assumed_date = min(assumed_dates) if assumed_dates else None
            if (
                first_assumed_date is not None
                and work_date < first_assumed_date
                and not day.get("unexcused")
                and not day.get("excused")
            ):
                continue
            if day.get("unexcused") or not day.get("excused"):
                absence_dates.add(work_date)
        day_unpaid_permission_minutes = sum(item["minutes"] for item in permissions if not item["paid"])
        unpaid_permission_minutes += day_unpaid_permission_minutes
        month_totals["unpaid_permission_minutes"] += day_unpaid_permission_minutes

    for leave_date in leave_dates:
        month_totals = monthly_totals.setdefault(leave_date.strftime("%Y-%m"), {
            "scheduled_days": 0, "late_minutes": 0, "absence_days": 0,
            "unpaid_permission_minutes": 0, "overtime_hours": 0.0,
        })
        month_totals["scheduled_days"] += 1

    for work_date, day in daily.items():
        if work_date in scheduled_dates or work_date in leave_dates or work_date > completed_through:
            continue
        intervals = paired_punch_intervals(day.get("ins", []), day.get("outs", []))
        if not intervals:
            continue
        month_key = work_date.strftime("%Y-%m")
        month_totals = monthly_totals.setdefault(month_key, {
            "scheduled_days": 0, "late_minutes": 0, "absence_days": 0,
            "unpaid_permission_minutes": 0, "overtime_hours": 0.0,
        })
        _, day_overtime, _ = interval_hours(
            intervals, work_date, shift_start, shift_end, False,
            float(employee["shift_hours"]),
        )
        day_overtime = authorized_overtime_hours(
            day_overtime, work_date, shift_start, shift_end,
            day.get("overtime_approvals", []),
        )
        overtime_hours += day_overtime
        month_totals["overtime_hours"] += day_overtime

    for absent_date in absence_dates:
        monthly_totals.setdefault(absent_date.strftime("%Y-%m"), {
            "scheduled_days": 0, "late_minutes": 0, "absence_days": 0,
            "unpaid_permission_minutes": 0, "overtime_hours": 0.0,
        })["absence_days"] += 1
    for permission in permission_records:
        permission_date = date.fromisoformat(permission["date"])
        if not permission["paid"] and permission_date > completed_through:
            month_totals = monthly_totals.setdefault(permission_date.strftime("%Y-%m"), {
                "scheduled_days": 0, "late_minutes": 0, "absence_days": 0,
                "unpaid_permission_minutes": 0, "overtime_hours": 0.0,
            })
            month_totals["unpaid_permission_minutes"] += permission["minutes"]
            unpaid_permission_minutes += permission["minutes"]

    paid_leave_hours = len(leave_dates) * float(employee["shift_hours"])
    rates = salary_rates(employee, as_of)
    monthly_salary = float(employee["base_monthly_salary"] or 0)
    hourly_rate = rates["hourly_rate"]
    scheduled_workdays = len(scheduled_dates) + len(leave_dates)
    elapsed_days = max(0, len(scheduled_dates) - len(assumed_dates))
    if monthly_salary:
        accrued_base = sum(
            monthly_salary * month_totals["scheduled_days"]
            / workdays_in_month(int(month_key[:4]), int(month_key[5:]), rest_day)
            for month_key, month_totals in monthly_totals.items()
            if workdays_in_month(int(month_key[:4]), int(month_key[5:]), rest_day)
        )
    else:
        accrued_base = (regular_hours + paid_leave_hours) * hourly_rate
    overtime_pay = 0
    late_deduction = absence_deduction = unpaid_permission_deduction = 0
    for month_key, month_totals in monthly_totals.items():
        month_date = date.fromisoformat(f"{month_key}-01")
        month_rates = salary_rates(employee, month_date)
        overtime_pay += month_totals["overtime_hours"] * month_rates["hourly_rate"] * OVERTIME_MULTIPLIER
        charged_delay_minutes = max(0, month_totals["late_minutes"] - 120)
        late_deduction += (charged_delay_minutes // 30) * 0.5 * month_rates["daily_rate"]
        absence_deduction += month_totals["absence_days"] * 2 * month_rates["daily_rate"]
        unpaid_permission_deduction += (
            month_totals["unpaid_permission_minutes"] * month_rates["hourly_rate"] / 60
        )
    monthly_allowance = []
    monthly_totals.setdefault(period, {
        "scheduled_days": 0, "late_minutes": 0, "absence_days": 0,
        "unpaid_permission_minutes": 0, "overtime_hours": 0.0,
    })
    for month_key, month_totals in sorted(monthly_totals.items()):
        manual_allowance = manual_allowances.get(month_key, {})
        minutes_remaining = int(manual_allowance.get("remaining_minutes", 120))
        monthly_allowance.append({
            "period": month_key,
            "allowance_minutes": 120,
            "late_minutes": month_totals["late_minutes"],
            "unpaid_permission_minutes": month_totals["unpaid_permission_minutes"],
            "minutes_used": 120 - minutes_remaining,
            "minutes_remaining": minutes_remaining,
            "manual_note": manual_allowance.get("note", ""),
        })
    latest_allowance = monthly_allowance[-1] if monthly_allowance else {
        "period": period, "allowance_minutes": 120, "late_minutes": 0,
        "unpaid_permission_minutes": 0, "minutes_used": 0, "minutes_remaining": 120,
    }
    deduction_reasons = []
    for month_key, month_totals in sorted(monthly_totals.items()):
        month_rates = salary_rates(employee, date.fromisoformat(f"{month_key}-01"))
        charged_delay_minutes = max(0, month_totals["late_minutes"] - 120)
        month_late_deduction = (charged_delay_minutes // 30) * 0.5 * month_rates["daily_rate"]
        if month_late_deduction:
            deduction_reasons.append({
                "kind": "late", "period": month_key,
                "label": f"تأخيرات متراكمة بعد الرصيد المجاني ({charged_delay_minutes} دقيقة)",
                "amount": round(month_late_deduction, 2),
            })
        if month_totals["unpaid_permission_minutes"]:
            deduction_reasons.append({
                "kind": "permission", "period": month_key,
                "label": f"أذونات غير مدفوعة ({month_totals['unpaid_permission_minutes']} دقيقة)",
                "amount": round(
                    month_totals["unpaid_permission_minutes"] * month_rates["hourly_rate"] / 60, 2
                ),
            })
        if month_totals["absence_days"]:
            deduction_reasons.append({
                "kind": "absence", "period": month_key,
                "label": f"غياب بدون عذر ({month_totals['absence_days']} يوم)",
                "amount": round(month_totals["absence_days"] * 2 * month_rates["daily_rate"], 2),
            })
    deduction_reasons.extend({
        "kind": "deduction", "period": item["period"],
        "label": f"جزاء مباشر: {item['note']}", "amount": item["amount"],
    } for item in adjustment_records if item["kind"] == "deduction")
    deduction_reasons.extend({
        "kind": "permission", "period": item["period"],
        "label": f"خصم إداري: {item['note']}", "amount": item["amount"],
    } for item in adjustment_records if item["kind"] == "permission")
    current_entitlement = max(
        0,
        accrued_base + overtime_pay - late_deduction - absence_deduction
        - unpaid_permission_deduction - adjustment_totals.get("deduction", 0)
        - adjustment_totals.get("permission", 0),
    )
    attendance_rate = 100 * len(attendance_dates) / elapsed_days if elapsed_days else 0
    punctuality_score = (
        100 * punctual_days / eligible_punctual_days if eligible_punctual_days else None
    )
    rounded_attendance_rate = round(attendance_rate, 2)
    rounded_punctuality_score = round(punctuality_score, 2) if punctuality_score is not None else None
    scoring_punctuality = (
        rounded_punctuality_score if rounded_punctuality_score is not None else rounded_attendance_rate
    )
    attendance_points = round(rounded_attendance_rate * 0.6, 2)
    punctuality_points = round(scoring_punctuality * 0.4, 2)
    performance_score = round(attendance_points + punctuality_points, 2) if elapsed_days else None
    leave_year = int(period[:4])
    leave_summary = leave_balance(employee, leave_year)
    return {
        "employee": employee_dict(employee),
        "period": {"start": start_date.isoformat(), "end": as_of.isoformat(),
                   "completed_through": completed_through.isoformat()},
        "attendance": {
            "days_present": len(attendance_dates), "workdays_elapsed": elapsed_days,
            "scheduled_workdays": scheduled_workdays,
            "verified_workdays": elapsed_days,
            "approved_leave_days": len(leave_dates),
            "paid_leave_hours": round(paid_leave_hours, 2),
            "assumed_full_shift_days": len(assumed_dates),
            "absence_days": len(absence_dates), "excused_absence_days": len(excused_dates),
            "attendance_rate": rounded_attendance_rate,
            "punctuality_score": rounded_punctuality_score,
            "punctual_days": punctual_days,
            "eligible_punctual_days": eligible_punctual_days,
            "performance_score": performance_score,
            "late_minutes": late_minutes,
            "permission_allowance": {
                **latest_allowance,
                "monthly_history": monthly_allowance,
                "records": sorted(permission_records, key=lambda item: (item["date"], item["time"]), reverse=True),
            },
        },
        "pay": {
            "monthly_salary": round(monthly_salary, 2),
            "daily_rate": round(rates["daily_rate"], 2), "hourly_rate": round(rates["hourly_rate"], 2),
            "accrued_base": round(accrued_base, 2), "overtime_hours": round(overtime_hours, 2),
            "overtime_pay": round(overtime_pay, 2), "late_deduction": round(late_deduction, 2),
            "absence_deduction": round(absence_deduction, 2),
            "unpaid_permission_minutes": unpaid_permission_minutes,
            "unpaid_permission_deduction": round(unpaid_permission_deduction, 2),
            "other_deductions": round(adjustment_totals.get("deduction", 0), 2),
            "permission_adjustments": round(adjustment_totals.get("permission", 0), 2),
            "deduction_reasons": deduction_reasons,
            "adjustments": adjustment_records,
            "current_entitlement": round(current_entitlement, 2),
        },
        "leaves": leave_summary,
    }


def monthly_performance(month):
    try:
        month_start = datetime.strptime(month, "%Y-%m").date().replace(day=1)
    except ValueError as error:
        raise ValueError("month must use YYYY-MM") from error
    if month_start < REPORTING_START_DATE.replace(day=1):
        raise ValueError("month is before the reporting start date")
    if month_start > date.today().replace(day=1):
        raise ValueError("month cannot be in the future")
    month_end = date(
        month_start.year, month_start.month,
        calendar.monthrange(month_start.year, month_start.month)[1],
    )
    month_end = min(month_end, date.today())
    with connect_db() as connection:
        employees = connection.execute(
            """SELECT * FROM employees WHERE start_date <= ?
               AND (end_date IS NULL OR end_date >= ?)
               AND (active = 1 OR end_date IS NOT NULL)""",
            (month_end.isoformat(), month_start.isoformat()),
        ).fetchall()
    results = []
    for employee in employees:
        summary = employee_summary(employee["id"], month=month)
        attendance = summary["attendance"]
        score_available = attendance["verified_workdays"] > 0
        punctuality = attendance["punctuality_score"]
        punctuality_basis = punctuality if punctuality is not None else attendance["attendance_rate"]
        attendance_points = round(attendance["attendance_rate"] * 0.6, 2) if score_available else None
        punctuality_points = round(punctuality_basis * 0.4, 2) if score_available else None
        score = round(attendance_points + punctuality_points, 2) if score_available else None
        ideal = (
            score_available
            and
            attendance["days_present"] > 0
            and attendance["assumed_full_shift_days"] == 0
            and attendance["attendance_rate"] == 100
            and punctuality == 100
        )
        rating = "بيانات غير كافية" if not score_available else (
            "الموظف المثالي" if ideal else
            "ممتاز" if score >= 90 else
            "جيد جدًا" if score >= 80 else
            "جيد" if score >= 70 else "يحتاج إلى تحسين"
        )
        ranking_breakdown = {
            "formula": "(actual_present_days / verified_workdays * 100 * 0.60) + (on_time_days / punctuality_eligible_days * 100 * 0.40)",
            "score_available": score_available,
            "weights": {"attendance": 0.6, "punctuality": 0.4},
            "attendance": {
                "present_days": attendance["days_present"],
                "verified_workdays": attendance["verified_workdays"],
                "score_percent": attendance["attendance_rate"],
                "points": round(attendance_points, 2) if attendance_points is not None else None,
            },
            "punctuality": {
                "on_time_days": attendance["punctual_days"],
                "eligible_days": attendance["eligible_punctual_days"],
                "score_percent": punctuality_basis,
                "used_attendance_fallback": punctuality is None,
                "points": round(punctuality_points, 2) if punctuality_points is not None else None,
                "late_minutes": attendance["late_minutes"],
            },
            "approved_leave_days": attendance["approved_leave_days"],
            "assumed_full_shift_days_excluded": attendance["assumed_full_shift_days"],
            "absence_days": attendance["absence_days"],
            "ideal_criteria_met": ideal,
            "tie_breakers": [
                "الموظف المثالي أولاً",
                "الدرجة الأعلى",
                "نسبة الحضور الأعلى",
                "أيام الغياب الأقل",
                "الاسم تصاعديًا عند استمرار التعادل",
            ],
        }
        results.append({
            "id": employee["id"], "name": employee["name"], "rank": 0,
            "score_available": score_available,
            "is_ideal": ideal,
            "performance_score": score, "rating": rating,
            "attendance_rate": attendance["attendance_rate"],
            "punctuality_score": punctuality,
            "days_present": attendance["days_present"],
            "workdays_elapsed": attendance["workdays_elapsed"],
            "approved_leave_days": attendance["approved_leave_days"],
            "assumed_full_shift_days": attendance["assumed_full_shift_days"],
            "absence_days": attendance["absence_days"],
            "ranking_breakdown": ranking_breakdown,
        })
    results.sort(key=lambda item: (
        not item["score_available"], not item["is_ideal"],
        -(item["performance_score"] or 0), -item["attendance_rate"],
        item["absence_days"], item["name"],
    ))
    rank = 0
    for item in results:
        if item["score_available"]:
            rank += 1
            item["rank"] = rank
        else:
            item["rank"] = None
    return {
        "month": month,
        "workdays_in_month": calendar_workdays_in_month(month_start.year, month_start.month),
        "employees": results,
    }


WEEKDAY_NAMES_AR = ("الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت", "الأحد")
LEAVE_LABELS_AR = {
    "annual": "إجازة سنوية معتمدة",
    "casual": "إجازة عارضة معتمدة",
    "sick": "إجازة مرضية مسجلة",
}


def attendance_day_report(work_date, now=None):
    now = now or datetime.now()
    if work_date < REPORTING_START_DATE:
        raise ValueError("date is before the reporting start date")
    if work_date > now.date():
        raise ValueError("date cannot be in the future")
    period = work_date.strftime("%Y-%m")
    with connect_db() as connection:
        employees = connection.execute(
                """SELECT * FROM employees WHERE (active = 1 OR end_date IS NOT NULL)
                    AND (end_date IS NULL OR end_date >= ?) ORDER BY name""",
                (work_date.isoformat(),),
        ).fetchall()
        overrides = {
            row["employee_id"]: dict(row)
            for row in connection.execute(
                "SELECT employee_id, report_start, report_end FROM payroll_period_overrides WHERE period = ?",
                (period,),
            ).fetchall()
        }
        logs = connection.execute(
            """SELECT a.*, e.id AS employee_id, e.name FROM attendance_logs a
               JOIN employees e ON a.user_id = e.id OR a.user_id = e.attendance_user_id
               WHERE substr(a.check_time, 1, 10) = ? ORDER BY a.check_time, a.id""",
            (work_date.isoformat(),),
        ).fetchall()
        leaves = connection.execute(
            """SELECT employee_id, leave_type, start_date, end_date, note
               FROM leave_records WHERE start_date <= ? AND end_date >= ?
               ORDER BY id""",
            (work_date.isoformat(), work_date.isoformat()),
        ).fetchall()

    logs_by_employee = {}
    for row in logs:
        logs_by_employee.setdefault(row["employee_id"], []).append(dict(row))
    leaves_by_employee = {}
    for row in leaves:
        leaves_by_employee.setdefault(row["employee_id"], []).append(dict(row))
    with connect_db() as connection:
        holiday = connection.execute(
            "SELECT name FROM company_holidays WHERE holiday_date = ?",
            (work_date.isoformat(),),
        ).fetchone()
    rows = []
    for employee in employees:
        employee_id = employee["id"]
        override = overrides.get(employee_id, {})
        effective_start = date.fromisoformat(override.get("report_start", employee["start_date"]))
        effective_end = date.fromisoformat(override["report_end"]) if override.get("report_end") else None
        employee_logs = logs_by_employee.get(employee_id, [])
        if effective_end and work_date > effective_end:
            continue
        if work_date < effective_start:
            if not employee_logs:
                continue
        employee_leaves = leaves_by_employee.get(employee_id, [])
        leave_record = employee_leaves[0] if employee_leaves else None
        paid_leave_day = bool(
            leave_record
            and is_scheduled_workday(
                work_date, int(employee["weekly_rest_day"]), company_holidays(work_date, work_date),
            )
        )
        user_id = employee["attendance_user_id"] or employee_id
        report_logs = [] if paid_leave_day else employee_logs
        normalized_logs = []
        for log in report_logs:
            try:
                checked_at = parse_check_time(log["check_time"])
            except ValueError:
                continue
            status = re.sub(r"[\s-]+", "_", log["status"].strip().upper())
            normalized_logs.append((checked_at, status, log))

        ins = [stamp for stamp, status, _ in normalized_logs if status in ATTENDANCE_IN_STATUSES]
        outs = [stamp for stamp, status, _ in normalized_logs if status in ATTENDANCE_OUT_STATUSES]
        has_field_in = any(status == "FIELD_IN" for _, status, _ in normalized_logs)
        has_field_out = any(status == "FIELD_OUT" for _, status, _ in normalized_logs)
        open_checkin = bool(ins and (not outs or max(ins) > max(outs)))
        day_in_progress = work_date == now.date() and now.time() < time.max
        if work_date < effective_start:
            rows.append({
                "employee_id": employee_id, "name": employee["name"],
                "attendance_user_id": employee["attendance_user_id"],
                "date": work_date.isoformat(), "weekday": WEEKDAY_NAMES_AR[work_date.weekday()],
                "status": "employment_conflict", "reason": "حركة مسجلة قبل تاريخ بدء العمل",
                "absence_reason": None,
                "check_in": min(ins).strftime("%H:%M:%S") if ins else None,
                "check_out": max(outs).strftime("%H:%M:%S") if outs else None,
                "late_minutes": 0, "overtime_minutes": 0, "actual_work_hours": 0.0,
                "punch_count": len(employee_logs), "leave_type": None,
                "leave_days": 0, "leave_conflict": False,
                "punches": employee_logs,
            })
            continue
        intervals = paired_punch_intervals(ins, outs)
        explicit_excused = any(status in {"ABSENCE_EXCUSED", "غياب_بعذر", "LEAVE", "إجازة"}
                               for _, status, _ in normalized_logs)
        explicit_unexcused = any(status in {"ABSENCE_UNEXCUSED", "غياب_بدون_عذر"}
                                 for _, status, _ in normalized_logs)
        permissions = [log for _, status, log in normalized_logs if status in {"PERMISSION", "إذن"}]
        overtime_approvals = [log for _, status, log in normalized_logs if status == "OVERTIME_APPROVED"]
        rest_day = int(employee["weekly_rest_day"])
        is_friday = work_date.weekday() == 4
        is_scheduled = is_scheduled_workday(work_date, rest_day)
        if is_friday:
            status = "rest_day"
            reason = "يوم الجمعة (إجازة أسبوعية)"
        elif holiday:
            status = "holiday"
            reason = f"عطلة رسمية: {holiday['name']}"
        elif not is_scheduled:
            status = "rest_day"
            reason = f"{WEEKDAY_NAMES_AR[work_date.weekday()]} (راحة أسبوعية)"
        elif paid_leave_day:
            status = "paid_leave"
            reason = f"إجازة مدفوعة · {LEAVE_LABELS_AR[leave_record['leave_type']]}"
        elif open_checkin:
            status = "continuous_day"
            reason = "لقد بصم حضور ولم يبصم انصراف"
            if has_field_in:
                reason += " · حضور ميداني"
        elif day_in_progress and not ins:
            status = "incomplete_day"
            reason = "لم يبصم حضور حتى الآن، في انتظار تفعيل البصمة"
            if has_field_out:
                reason += " · انصراف ميداني دون تسجيل حضور"
        elif explicit_unexcused:
            status = "absence"
            reason = "غياب بدون إذن (مسجل يدويًا)"
        elif explicit_excused:
            status = "excused_absence"
            reason = "غياب بعذر (مسجل يدويًا)"
        elif permissions:
            status = "permission"
            reason = "إذن مدفوع" if all(log["permission_paid"] for log in permissions) else "إذن مسجل"
        elif intervals:
            status = "present"
            reasons = []
            if has_field_in:
                reasons.append("حضور ميداني")
            if has_field_out:
                reasons.append("انصراف ميداني")
            if any(log_status == "LATE_IN_UNEXCUSED" for _, log_status, _ in normalized_logs):
                reasons.append("تأخير بدون عذر")
            elif any(log_status == "LATE_IN" for _, log_status, _ in normalized_logs):
                reasons.append("حضور متأخر")
            elif employee["shift_start"] and min(ins).time() > time.fromisoformat(employee["shift_start"]):
                reasons.append("حضور متأخر")
            if any(log_status == "EXIT_PERMISSION" for _, log_status, _ in normalized_logs):
                reasons.append("إذن انصراف")
            elif any(log_status == "EARLY_OUT" for _, log_status, _ in normalized_logs):
                reasons.append("انصراف مبكر")
            elif employee["shift_end"] and max(outs).time() < time.fromisoformat(employee["shift_end"]):
                reasons.append("انصراف مبكر")
            if overtime_approvals:
                reasons.append("إذن ساعات إضافية مسجل مسبقًا")
            reason = " · ".join(reasons) if reasons else "حاضر ومكتمل"
        elif ins or outs:
            status = "partial"
            reason = "لم يبصم حضور حتى الآن، في انتظار تفعيل البصمة" if outs and not ins else "لقد بصم حضور ولم يبصم انصراف"
            if has_field_in:
                reason += " · حضور ميداني"
            if has_field_out:
                reason += " · انصراف ميداني"
        elif overtime_approvals:
            status = "permission"
            reason = "إذن ساعات إضافية مسجل مسبقًا"
        else:
            status = "absence"
            reason = "غياب بدون إذن (لا يوجد إذن أو إجازة مسجلة)"

        check_in = min(ins).strftime("%H:%M:%S") if ins else None
        check_out = max(outs).strftime("%H:%M:%S") if outs else None
        actual_work_hours = round(sum(
            (interval_end - interval_start).total_seconds()
            for interval_start, interval_end in intervals
        ) / 3600, 2)
        late_minutes = 0
        overtime_minutes = 0
        shift_start_clock = time.fromisoformat(employee["shift_start"] or DEFAULT_SHIFT_START)
        shift_end_clock = time.fromisoformat(employee["shift_end"] or DEFAULT_SHIFT_END)
        shift_end_at = datetime.combine(work_date, shift_end_clock)
        if shift_end_clock <= shift_start_clock:
            shift_end_at += timedelta(days=1)
        if ins and is_scheduled and not paid_leave_day:
            shift_start_at = datetime.combine(work_date, shift_start_clock)
            late_minutes = max(0, int((min(ins) - shift_start_at).total_seconds() // 60))
        overtime_seconds = sum(
            max(0, (interval_end - max(interval_start, shift_end_at)).total_seconds())
            for interval_start, interval_end in intervals
        )
        overtime_minutes = int(overtime_seconds // 60)
        leave_type = leave_record["leave_type"] if leave_record else None
        rows.append({
            "employee_id": employee_id, "name": employee["name"],
            "attendance_user_id": employee["attendance_user_id"],
            "date": work_date.isoformat(), "weekday": WEEKDAY_NAMES_AR[work_date.weekday()],
            "status": status, "reason": reason,
            "fieldwork_in": has_field_in, "fieldwork_out": has_field_out,
            "absence_reason": reason if status in {"absence", "excused_absence"} else None,
            "absence_documented": (
                status == "absence" and explicit_unexcused
            ) or (
                status == "excused_absence" and explicit_excused
            ),
            "check_in": check_in, "check_out": check_out,
            "late_minutes": late_minutes,
            "overtime_minutes": overtime_minutes,
            "actual_work_hours": actual_work_hours,
            "punch_count": len(report_logs),
            "ignored_leave_punch_count": len(employee_logs) if paid_leave_day else 0,
            "leave_type": leave_type,
            "leave_days": len(employee_leaves),
            "leave_conflict": bool(paid_leave_day and employee_logs),
            "overtime_approved_minutes": sum(int(log["duration_minutes"] or 0) for log in overtime_approvals),
            "punches": report_logs,
        })
    present_employee_ids = {
        row["employee_id"] for row in rows if row["check_in"] is not None
    }
    return {
        "date": work_date.isoformat(), "weekday": WEEKDAY_NAMES_AR[work_date.weekday()],
        "employees": rows, "present_employee_count": len(present_employee_ids),
    }


def monthly_absence_report(period):
    try:
        month_start = datetime.strptime(period, "%Y-%m").date().replace(day=1)
    except ValueError as error:
        raise ValueError("month must use YYYY-MM") from error
    if month_start < REPORTING_START_DATE.replace(day=1):
        raise ValueError("month is before the reporting start date")
    if month_start > date.today().replace(day=1):
        raise ValueError("month cannot be in the future")
    month_end = min(date(month_start.year, month_start.month,
                         calendar.monthrange(month_start.year, month_start.month)[1]), date.today())
    absences = []
    work_date = month_start
    while work_date <= month_end:
        daily = attendance_day_report(work_date)
        absences.extend(
            row for row in daily["employees"]
            if row["status"] in {"absence", "excused_absence"}
            and row["absence_documented"]
        )
        work_date += timedelta(days=1)
    return {
        "month": period,
        "workdays_in_month": calendar_workdays_in_month(month_start.year, month_start.month),
        "absences": absences,
        "summary": {
            "unexcused_days": sum(row["status"] == "absence" for row in absences),
            "excused_days": sum(row["status"] == "excused_absence" for row in absences),
            "documented_days": len(absences),
        },
    }


def september_attendance_archive():
    month_start = date(2026, 9, 1)
    month_end = date(2026, 9, calendar.monthrange(2026, 9)[1])
    if date.today() <= month_end:
        raise ValueError("September 2026 archive is available after the month ends")
    with connect_db() as connection:
        saved_archive = connection.execute(
            "SELECT snapshot_json FROM attendance_month_archives WHERE period = '2026-09'"
        ).fetchone()
    if saved_archive:
        return json.loads(saved_archive["snapshot_json"])
    employee_totals = {}
    daily_records = []
    work_date = month_start
    while work_date <= month_end:
        daily_report = attendance_day_report(work_date)
        for row in daily_report["employees"]:
            if row["status"] in {"rest_day", "holiday", "employment_conflict"}:
                continue
            item = employee_totals.setdefault(row["employee_id"], {
                "employee_id": row["employee_id"], "name": row["name"],
                "scheduled_days": 0, "present_days": 0, "absence_days": 0,
                "excused_absence_days": 0, "paid_leave_days": 0,
                "late_minutes": 0, "overtime_minutes": 0, "actual_work_hours": 0.0,
            })
            item["scheduled_days"] += 1
            item["present_days"] += int(bool(row["check_in"]))
            item["absence_days"] += int(row["status"] == "absence")
            item["excused_absence_days"] += int(row["status"] == "excused_absence")
            item["paid_leave_days"] += int(row["status"] == "paid_leave")
            item["late_minutes"] += row["late_minutes"]
            item["overtime_minutes"] += row["overtime_minutes"]
            item["actual_work_hours"] += row["actual_work_hours"]
            daily_records.append({
                "employee_id": row["employee_id"], "name": row["name"],
                "date": row["date"], "weekday": row["weekday"],
                "status": row["status"], "reason": row["reason"],
                "check_in": row["check_in"], "check_out": row["check_out"],
                "late_minutes": row["late_minutes"],
                "overtime_minutes": row["overtime_minutes"],
                "actual_work_hours": row["actual_work_hours"],
                "fieldwork_in": row["fieldwork_in"], "fieldwork_out": row["fieldwork_out"],
            })
        work_date += timedelta(days=1)

    employees = sorted(employee_totals.values(), key=lambda item: item["name"])
    for employee in employees:
        employee["attendance_rate"] = round(
            100 * employee["present_days"] / employee["scheduled_days"], 2,
        ) if employee["scheduled_days"] else 0
        employee["actual_work_hours"] = round(employee["actual_work_hours"], 2)
    total_scheduled_days = sum(item["scheduled_days"] for item in employees)
    total_present_days = sum(item["present_days"] for item in employees)
    archive = {
        "month": "2026-09", "days_in_month": (month_end - month_start).days + 1,
        "workdays_in_month": calendar_workdays_in_month(2026, 9),
        "summary": {
            "employees": len(employees), "scheduled_employee_days": total_scheduled_days,
            "attendance_days": total_present_days,
            "absence_days": sum(item["absence_days"] + item["excused_absence_days"] for item in employees),
            "unexcused_absence_days": sum(item["absence_days"] for item in employees),
            "excused_absence_days": sum(item["excused_absence_days"] for item in employees),
            "paid_leave_days": sum(item["paid_leave_days"] for item in employees),
            "average_attendance_rate": round(
                sum(item["attendance_rate"] for item in employees) / len(employees), 2,
            ) if employees else 0,
            "overall_attendance_rate": round(100 * total_present_days / total_scheduled_days, 2)
            if total_scheduled_days else 0,
        },
        "employees": employees,
        "daily_records": daily_records,
        "read_only": True,
    }
    archive["archived_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    with connect_db() as connection:
        connection.execute(
            "INSERT OR IGNORE INTO attendance_month_archives(period, snapshot_json) VALUES (?, ?)",
            ("2026-09", json.dumps(archive, ensure_ascii=False)),
        )
        saved_archive = connection.execute(
            "SELECT snapshot_json FROM attendance_month_archives WHERE period = '2026-09'"
        ).fetchone()
    return json.loads(saved_archive["snapshot_json"])


class Handler(BaseHTTPRequestHandler):
    server_version = "MakHillsAPI/1.0"

    def log_message(self, format_string, *args):
        print("%s - %s" % (self.address_string(), format_string % args))

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.add_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def add_cors_headers(self):
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Vary", "Origin")
        if origin in CORS_ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if not origin or origin not in CORS_ALLOWED_ORIGINS:
            self.send_json(403, {"error": "Origin is not allowed"})
            return
        self.send_response(204)
        self.add_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid Content-Length") from error
        if length <= 0 or length > MAX_BODY_BYTES:
            raise ValueError("Request body is empty or exceeds 1 MB")
        try:
            return json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request body must be valid JSON") from error

    def authorized(self):
        return request_is_authorized(
            self.client_address[0],
            self.headers.get("Authorization"),
            self.headers.get("Origin"),
        )

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/v1/health":
            self.send_json(200, {"status": "ok"})
            return
        if parsed.path == "/":
            page = (ROOT / "index.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return
        if parsed.path.startswith("/assets/"):
            assets_root = (ROOT / "assets").resolve()
            asset_path = (ROOT / parsed.path.lstrip("/")).resolve()
            if not asset_path.is_relative_to(assets_root) or asset_path.suffix.lower() != ".svg" or not asset_path.is_file():
                self.send_json(404, {"error": "Not found"})
                return
            asset = asset_path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "image/svg+xml")
            self.send_header("Content-Length", str(len(asset)))
            self.send_header("Cache-Control", "public, max-age=3600")
            self.end_headers()
            self.wfile.write(asset)
            return
        if not self.authorized():
            self.send_json(401, {"error": "Bearer token required"})
            return
        summary_match = re.fullmatch(r"/api/(?:v1/)?employees/([^/]+)/summary", parsed.path)
        if summary_match:
            try:
                query = parse_qs(parsed.query)
                month = query.get("month", [""])[0]
                as_of_value = query.get("as_of", [""])[0]
                as_of = date.fromisoformat(as_of_value) if as_of_value else None
                summary = employee_summary(summary_match.group(1), as_of=as_of, month=month or None)
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
                return
            if summary is None:
                self.send_json(404, {"error": "Employee not found"})
                return
            self.send_json(200, summary)
            return
        if parsed.path == "/api/v1/performance":
            month = parse_qs(parsed.query).get("month", [date.today().strftime("%Y-%m")])[0]
            try:
                self.send_json(200, monthly_performance(month))
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
            return
        if parsed.path == "/api/v1/holidays":
            with connect_db() as connection:
                holidays = connection.execute(
                    "SELECT holiday_date, name FROM company_holidays ORDER BY holiday_date"
                ).fetchall()
            self.send_json(200, {"holidays": [dict(row) for row in holidays]})
            return
        if parsed.path == "/api/v1/attendance/outages":
            with connect_db() as connection:
                outages = connection.execute(
                    """SELECT o.id, o.start_date, o.end_date, o.device_label, o.employee_id,
                              e.name AS employee_name FROM attendance_outages o
                       LEFT JOIN employees e ON e.id = o.employee_id ORDER BY o.start_date, o.id"""
                ).fetchall()
            self.send_json(200, {"outages": [dict(row) for row in outages]})
            return
        if parsed.path == "/api/v1/employees":
            with connect_db() as connection:
                employees = connection.execute("SELECT * FROM employees ORDER BY name").fetchall()
            self.send_json(200, {"employees": [employee_dict(row) for row in employees]})
            return
        if parsed.path == "/api/v1/attendance/day":
            value = parse_qs(parsed.query).get("date", [date.today().isoformat()])[0]
            try:
                report = attendance_day_report(date.fromisoformat(value))
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
                return
            self.send_json(200, report)
            return
        if parsed.path == "/api/v1/attendance/absences":
            month = parse_qs(parsed.query).get("month", [date.today().strftime("%Y-%m")])[0]
            try:
                report = monthly_absence_report(month)
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
                return
            self.send_json(200, report)
            return
        if parsed.path == "/api/v1/attendance/archive/2026-09":
            try:
                self.send_json(200, september_attendance_archive())
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
            return
        if parsed.path in {"/api/v1/attendance", "/api/attendance"}:
            query = parse_qs(parsed.query)
            conditions = [
                "(e.end_date IS NULL OR substr(a.check_time, 1, 10) <= e.end_date)",
                "(e.id IS NULL OR a.source = 'manual' OR substr(a.check_time, 1, 10) >= COALESCE((SELECT p.report_start FROM payroll_period_overrides p WHERE p.employee_id = e.id AND p.period = substr(a.check_time, 1, 7)), e.start_date))",
            ]
            parameters = []
            if query.get("day", [""])[0]:
                conditions.append("a.check_time >= ?")
                parameters.append(REPORTING_START_DATE.isoformat())
                conditions.append("substr(a.check_time, 1, 10) = ?")
                parameters.append(query["day"][0])
            else:
                try:
                    start_date = date.fromisoformat(query.get("start_date", [""])[0]) if query.get("start_date", [""])[0] else REPORTING_START_DATE
                    end_date = date.fromisoformat(query.get("end_date", [""])[0]) if query.get("end_date", [""])[0] else date.today()
                except ValueError:
                    self.send_json(400, {"error": "start_date and end_date must use YYYY-MM-DD"})
                    return
                start_date = max(REPORTING_START_DATE, start_date)
                end_date = min(date.today(), end_date)
                conditions.extend(["a.check_time >= ?", "a.check_time < ?"])
                parameters.extend([start_date.isoformat(), (end_date + timedelta(days=1)).isoformat()])
            if query.get("employee_id", [""])[0]:
                conditions.append("e.id = ?")
                parameters.append(query["employee_id"][0])
            sort_order = "ASC" if query.get("sort", ["desc"])[0].lower() == "asc" else "DESC"
            where_clause = " WHERE " + " AND ".join(conditions) if conditions else ""
            with connect_db() as connection:
                logs = connection.execute(
                    """SELECT a.id, a.user_id, a.check_time, a.device_ip, a.status,
                              a.source, a.note, a.duration_minutes, a.permission_type,
                              a.permission_paid, a.received_at,
                                                            e.id AS employee_id, e.name,
                                                            EXISTS(SELECT 1 FROM leave_records l
                                                                         WHERE l.employee_id = e.id
                                                                             AND substr(a.check_time, 1, 10) BETWEEN l.start_date AND l.end_date)
                                                                  AS leave_conflict,
                                                              substr(a.check_time, 1, 10) < COALESCE(
                                                                  (SELECT p.report_start FROM payroll_period_overrides p
                                                                   WHERE p.employee_id = e.id AND p.period = substr(a.check_time, 1, 7)),
                                                                  e.start_date
                                                              ) AS employment_conflict
                       FROM attendance_logs a LEFT JOIN employees e
                         ON a.user_id = e.attendance_user_id OR a.user_id = e.id"""
                    + where_clause + f" ORDER BY a.check_time {sort_order}, a.id {sort_order}",
                    parameters,
                ).fetchall()
            attendance_logs = add_work_durations([dict(row) for row in logs])
            for log in attendance_logs:
                if log["leave_conflict"] or log["employment_conflict"]:
                    log["work_duration_seconds"] = None
            self.send_json(200, {"logs": attendance_logs})
            return
        if parsed.path == "/api/v1/payroll":
            period = parse_qs(parsed.query).get("month", [date.today().strftime("%Y-%m")])[0]
            try:
                datetime.strptime(period, "%Y-%m")
            except ValueError:
                self.send_json(400, {"error": "month must use YYYY-MM"})
                return
            with connect_db() as connection:
                records = connection.execute(
                          """SELECT p.*, e.name, e.position, e.department,
                                        e.hourly_wage, e.base_monthly_salary FROM payroll p
                       JOIN employees e ON e.id = p.employee_id WHERE p.period = ?
                       ORDER BY e.name""",
                    (period,),
                ).fetchall()
                adjustment_rows = connection.execute(
                    """SELECT employee_id, kind, amount, note FROM payroll_adjustments
                       WHERE period = ? ORDER BY id""",
                    (period,),
                ).fetchall()
                approval = connection.execute(
                    "SELECT approved_by, approved_at FROM payroll_approvals WHERE period = ?",
                    (period,),
                ).fetchone()
            adjustments_by_employee = {}
            for adjustment in adjustment_rows:
                adjustments_by_employee.setdefault(adjustment["employee_id"], []).append(dict(adjustment))
            payroll_records = []
            for record in records:
                item = dict(record)
                item["compensation_configured"] = compensation_configured(item)
                reasons = []
                if item["absence_deduction"]:
                    reasons.append({
                        "kind": "absence", "label": f"غياب بدون عذر ({item['absence_days']} يوم)",
                        "amount": item["absence_deduction"],
                    })
                if item["late_deduction"]:
                    reasons.append({
                        "kind": "late",
                        "label": f"تأخيرات متراكمة بعد الرصيد المجاني ({item['charged_delay_minutes']} دقيقة)",
                        "amount": item["late_deduction"],
                    })
                adjustments_for_employee = adjustments_by_employee.get(item["employee_id"], [])
                for adjustment in adjustments_for_employee:
                    reasons.append({
                        "kind": adjustment["kind"],
                        "label": ("جزاء مباشر" if adjustment["kind"] == "deduction" else "خصم إداري") + f": {adjustment['note']}",
                        "amount": adjustment["amount"],
                    })
                adjustment_total = sum(row["amount"] for row in adjustments_for_employee if row["kind"] == "deduction")
                if item["other_deductions"] > adjustment_total:
                    reasons.append({
                        "kind": "deduction", "label": "جزاءات مباشرة / خصومات إدارية",
                        "amount": item["other_deductions"] - adjustment_total,
                    })
                permission_adjustment_total = sum(row["amount"] for row in adjustments_for_employee if row["kind"] == "permission")
                unpaid_permission_total = item["permission_deductions"] - permission_adjustment_total
                if unpaid_permission_total > 0:
                    reasons.append({
                        "kind": "permission", "label": "أذونات غير مدفوعة",
                        "amount": unpaid_permission_total,
                    })
                item["deduction_reasons"] = reasons
                payroll_records.append(item)
            self.send_json(200, {"period": period, "approved": dict(approval) if approval else None,
                                 "payroll": payroll_records})
            return
        if parsed.path == "/api/v1/payroll/export.xlsx":
            period = parse_qs(parsed.query).get("month", [date.today().strftime("%Y-%m")])[0]
            try:
                workbook = payroll_xlsx(period)
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
                return
            except LookupError as error:
                self.send_json(404, {"error": str(error)})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition", f'attachment; filename="Mak-Hills-Payroll-{period}.xlsx"')
            self.send_header("Content-Length", str(len(workbook)))
            self.end_headers()
            self.wfile.write(workbook)
            return
        if parsed.path == "/api/v1/payroll/preview":
            period = parse_qs(parsed.query).get("month", [date.today().strftime("%Y-%m")])[0]
            try:
                self.send_json(200, payroll_preview(period))
            except ValueError as error:
                self.send_json(400, {"error": str(error)})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self):
        if not self.authorized():
            self.send_json(401, {"error": "Bearer token required"})
            return
        try:
            body = self.read_json()
            if not isinstance(body, (dict, list)):
                raise ValueError("Request JSON must be an object or an attendance log array")
            if self.path == "/api/v1/employees":
                if not isinstance(body, dict):
                    raise ValueError("Employee must be a JSON object")
                name = str(body.get("name", "")).strip()
                start_date = str(body.get("start_date", date.today().isoformat())).strip()
                end_date = str(body.get("end_date", "")).strip() or None
                if not name:
                    raise ValueError("name is required")
                date.fromisoformat(start_date)
                if end_date and date.fromisoformat(end_date) < date.fromisoformat(start_date):
                    raise ValueError("end_date cannot be before start_date")
                employee_id = str(body.get("id") or uuid.uuid4())
                hourly_wage = float(body.get("hourly_wage", 0))
                base_monthly_salary = float(body.get("base_monthly_salary", 0))
                birth_date = str(body.get("birth_date", "")).strip() or None
                disability = parse_boolean(body.get("disability", False), "disability")
                if birth_date:
                    date.fromisoformat(birth_date)
                    if date.fromisoformat(birth_date) >= date.today():
                        raise ValueError("birth_date must be in the past")
                shift_hours = float(body.get("shift_hours", 8))
                weekly_rest_day = int(body.get("weekly_rest_day", 4))
                if hourly_wage < 0 or base_monthly_salary < 0 or not 0 < shift_hours <= 24:
                    raise ValueError("hourly_wage must be non-negative and shift_hours must be 0-24")
                if not 0 <= weekly_rest_day <= 6:
                    raise ValueError("weekly_rest_day must be between 0 and 6")
                default_shift_start, default_shift_end = default_shift_schedule(name)
                shift_start = body.get("shift_start") or default_shift_start
                shift_end = body.get("shift_end") or default_shift_end
                time.fromisoformat(shift_start)
                time.fromisoformat(shift_end)
                with connect_db() as connection:
                    connection.execute(
                        """INSERT INTO employees(id, name, position, department, attendance_user_id,
                           hourly_wage, base_monthly_salary, shift_hours, shift_start, shift_end,
                                                       weekly_rest_day, start_date, end_date, birth_date, disability, active)
                                                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (employee_id, name, str(body.get("position", "")).strip(),
                         str(body.get("department", "")).strip(), body.get("attendance_user_id"),
                         hourly_wage, base_monthly_salary, shift_hours, shift_start, shift_end,
                                                 weekly_rest_day, start_date, end_date, birth_date, int(disability),
                                                 int(bool(body.get("active", True)))),
                    )
                    employee = connection.execute("SELECT * FROM employees WHERE id = ?", (employee_id,)).fetchone()
                self.send_json(201, {"employee": employee_dict(employee)})
                return
            if self.path == "/api/v1/holidays":
                if not isinstance(body, dict):
                    raise ValueError("Holiday must be a JSON object")
                holiday_date = date.fromisoformat(str(body.get("date", "")))
                name = str(body.get("name", "")).strip()
                if not name:
                    raise ValueError("Holiday name is required")
                with connect_db() as connection:
                    connection.execute(
                        "INSERT INTO company_holidays(holiday_date, name) VALUES (?, ?)",
                        (holiday_date.isoformat(), name),
                    )
                    period = holiday_date.strftime("%Y-%m")
                    connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                    connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (period,))
                days = workdays_in_month(holiday_date.year, holiday_date.month, 4)
                self.send_json(201, {
                    "holiday": {"date": holiday_date.isoformat(), "name": name},
                    "working_days_in_month": days,
                })
                return
            if self.path == "/api/v1/attendance/outages":
                if not isinstance(body, dict):
                    raise ValueError("Attendance outage must be a JSON object")
                start_date = date.fromisoformat(str(body.get("start_date", "")))
                end_date = date.fromisoformat(str(body.get("end_date", "")))
                device_label = str(body.get("note", body.get("device_label", ""))).strip()
                employee_id = str(body.get("employee_id", "")).strip() or None
                if end_date < start_date or not device_label:
                    raise ValueError("Provide an outage date range and a device label")
                with connect_db() as connection:
                    if employee_id and not connection.execute(
                        "SELECT 1 FROM employees WHERE id = ?", (employee_id,)
                    ).fetchone():
                        raise ValueError("Unknown employee_id for attendance outage")
                    cursor = connection.execute(
                        """INSERT INTO attendance_outages(employee_id, start_date, end_date, device_label)
                           VALUES (?, ?, ?, ?)""",
                        (employee_id, start_date.isoformat(), end_date.isoformat(), device_label),
                    )
                    period = start_date.strftime("%Y-%m")
                    while date.fromisoformat(f"{period}-01") <= end_date:
                        connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                        connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (period,))
                        period_date = date.fromisoformat(f"{period}-01")
                        if period_date.month == 12:
                            period = f"{period_date.year + 1}-01"
                        else:
                            period = f"{period_date.year}-{period_date.month + 1:02d}"
                self.send_json(201, {"outage": {
                    "id": cursor.lastrowid, "employee_id": employee_id,
                    "start_date": start_date.isoformat(),
                    "end_date": end_date.isoformat(), "device_label": device_label,
                }})
                return
            leave_match = re.fullmatch(r"/api/v1/employees/([^/]+)/leaves", self.path)
            if leave_match:
                if not isinstance(body, dict):
                    raise ValueError("Leave record must be a JSON object")
                employee_id = leave_match.group(1)
                leave_type = str(body.get("leave_type", "")).strip().lower()
                start_date = date.fromisoformat(str(body.get("start_date", "")))
                end_date = date.fromisoformat(str(body.get("end_date", "")))
                note = str(body.get("note", "")).strip()
                medical_reference = str(body.get("medical_report_reference", "")).strip()
                if leave_type not in {"annual", "casual", "sick"} or end_date < start_date:
                    raise ValueError("Provide a valid leave type and date range")
                if start_date.year != end_date.year:
                    raise ValueError("A leave record cannot cross calendar years")
                if leave_type == "casual" and (end_date - start_date).days + 1 > 2:
                    raise ValueError("Casual leave cannot exceed two consecutive calendar days")
                if leave_type == "sick" and not medical_reference:
                    raise ValueError("A medical report reference is required for sick leave")
                with connect_db() as connection:
                    employee = connection.execute(
                        "SELECT * FROM employees WHERE id = ?", (employee_id,)
                    ).fetchone()
                    if not employee:
                        self.send_json(404, {"error": "Employee not found"})
                        return
                    if start_date < date.fromisoformat(employee["start_date"]):
                        raise ValueError("Leave cannot start before the employee start date")
                    overlap = connection.execute(
                        """SELECT 1 FROM leave_records WHERE employee_id = ?
                           AND start_date <= ? AND end_date >= ? LIMIT 1""",
                        (employee_id, end_date.isoformat(), start_date.isoformat()),
                    ).fetchone()
                    if overlap:
                        raise ValueError("Leave dates overlap an existing record")
                    leave_holidays = company_holidays(start_date, end_date)
                    days = scheduled_workdays(
                        start_date, end_date, int(employee["weekly_rest_day"]), leave_holidays,
                    )
                    if days == 0:
                        raise ValueError("Leave range must include a scheduled workday")
                    balance = leave_balance(employee, start_date.year)
                    if leave_type == "casual" and balance["casual_used"] + days > 7:
                        raise ValueError("Annual casual leave limit is seven working days")
                    if leave_type in {"annual", "casual"} and days > balance["annual_remaining"]:
                        raise ValueError("Leave exceeds the remaining annual leave balance")
                    cursor = connection.execute(
                        """INSERT INTO leave_records(employee_id, leave_type, start_date, end_date,
                           days, note, medical_report_reference) VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        (employee_id, leave_type, start_date.isoformat(), end_date.isoformat(),
                         days, note, medical_reference),
                    )
                    saved = connection.execute(
                        "SELECT * FROM leave_records WHERE id = ?", (cursor.lastrowid,)
                    ).fetchone()
                self.send_json(201, {"leave": dict(saved), "balance": leave_balance(employee, start_date.year)})
                return
            if self.path == "/api/v1/attendance/sync":
                logs = body if isinstance(body, list) else body.get("logs") if isinstance(body, dict) else None
                if not isinstance(logs, list) or not logs or len(logs) > 2000:
                    raise ValueError("Send 1 to 2000 log objects in a logs array")
                normalized = []
                ignored_after_end_date = 0
                ignored_before_start_date = 0
                ignored_paid_leave_punches = 0
                with connect_db() as connection:
                    for index, log in enumerate(logs):
                        if not isinstance(log, dict):
                            raise ValueError(f"logs[{index}] must be an object")
                        employee_id = str(log.get("employee_id", "")).strip()
                        if not employee_id or len(employee_id) > 100:
                            raise ValueError(f"logs[{index}] needs a valid employee_id")
                        work_date = date.fromisoformat(str(log.get("date", "")))
                        employee = connection.execute(
                            "SELECT id, attendance_user_id, start_date, end_date FROM employees WHERE id = ? OR attendance_user_id = ?",
                            (employee_id, employee_id),
                        ).fetchone()
                        if not employee:
                            raise ValueError(f"logs[{index}] references unknown employee_id {employee_id}")
                        user_id = employee["attendance_user_id"] or employee["id"]
                        provided_punches = sum(log.get(field) not in (None, "") for field in ("check_in", "check_out"))
                        if employee_is_on_paid_leave(connection, employee["id"], work_date):
                            if not provided_punches:
                                raise ValueError(f"logs[{index}] needs check_in or check_out")
                            ignored_paid_leave_punches += provided_punches
                            continue
                        punches = 0
                        for field, status in (("check_in", "IN"), ("check_out", "OUT")):
                            value = log.get(field)
                            if value in (None, ""):
                                continue
                            if not isinstance(value, str):
                                raise ValueError(f"logs[{index}].{field} must be a time string")
                            checked_time = time.fromisoformat(value)
                            checked_at = datetime.combine(work_date, checked_time)
                            period_override = connection.execute(
                                "SELECT report_start FROM payroll_period_overrides WHERE employee_id = ? AND period = ?",
                                (employee["id"], work_date.strftime("%Y-%m")),
                            ).fetchone()
                            effective_start = date.fromisoformat(
                                period_override["report_start"] if period_override else employee["start_date"]
                            )
                            if work_date < effective_start:
                                ignored_before_start_date += 1
                                punches += 1
                                continue
                            if employee["end_date"] and work_date > date.fromisoformat(employee["end_date"]):
                                ignored_after_end_date += 1
                                punches += 1
                                continue
                            normalized.append((user_id, local_timestamp(checked_at), "biometric", status))
                            punches += 1
                        if not punches:
                            raise ValueError(f"logs[{index}] needs check_in or check_out")
                    accepted = filter_duplicate_device_punches(connection, normalized)
                    before = connection.total_changes
                    connection.executemany(
                        """INSERT OR IGNORE INTO attendance_logs(user_id, check_time, device_ip, status, source)
                                    VALUES (?, ?, ?, ?, 'device')""",
                        accepted,
                    )
                    inserted = connection.total_changes - before
                    if inserted:
                        affected_periods = {check_time[:7] for _, check_time, _, _ in normalized}
                        connection.executemany(
                            "DELETE FROM payroll_approvals WHERE period = ?",
                            [(period,) for period in affected_periods],
                        )
                        connection.executemany(
                            "UPDATE payroll SET status = 'draft' WHERE period = ?",
                            [(period,) for period in affected_periods],
                        )
                self.send_json(201, {
                    "received": len(normalized) + ignored_after_end_date + ignored_before_start_date + ignored_paid_leave_punches,
                    "ignored_after_end_date": ignored_after_end_date,
                    "ignored_before_start_date": ignored_before_start_date,
                    "ignored_paid_leave_punches": ignored_paid_leave_punches,
                    "inserted": inserted,
                    "duplicates": len(normalized) - inserted,
                })
                return

            if self.path in {"/api/v1/attendance/manual", "/api/attendance"}:
                if not isinstance(body, dict):
                    raise ValueError("Manual attendance must be a JSON object")
                employee_id = str(body.get("employee_id", "")).strip()
                status = str(body.get("status", "")).strip().upper()
                if status not in ATTENDANCE_IN_STATUSES | ATTENDANCE_OUT_STATUSES | {"PERMISSION", "OVERTIME_APPROVED", "LEAVE", "ABSENCE_UNEXCUSED", "ABSENCE_EXCUSED"}:
                    raise ValueError("Unsupported manual attendance status")
                checked_at = body.get("check_time")
                parsed_check_at = parse_check_time(checked_at)
                note = str(body.get("note", "")).strip()
                duration_minutes = int(float(body.get("duration_hours", 0)) * 60) if "duration_hours" in body else int(body.get("duration_minutes", 0))
                if duration_minutes < 0 or duration_minutes > 1440:
                    raise ValueError("duration_minutes must be between 0 and 1440")
                permission_type = str(body.get("permission_type", "")).strip().lower()
                if permission_type not in {"", "late", "early"}:
                    raise ValueError("permission_type must be late or early")
                permission_paid = parse_boolean(body.get("permission_paid", body.get("is_paid", False)), "permission_paid")
                received_at = datetime.now().astimezone().isoformat(timespec="seconds")
                with connect_db() as connection:
                    employee = connection.execute("SELECT * FROM employees WHERE id = ?", (employee_id,)).fetchone()
                    if not employee:
                        self.send_json(404, {"error": "Employee not found"})
                        return
                    if employee["end_date"] and parsed_check_at.date() > date.fromisoformat(employee["end_date"]):
                        raise ValueError("Attendance cannot be recorded after the employee end date")
                    if employee_is_on_paid_leave(connection, employee["id"], parsed_check_at.date()):
                        self.send_json(409, {"error": "Attendance cannot be recorded on an approved paid-leave day"})
                        return
                    if status == "OVERTIME_APPROVED":
                        validate_overtime_approval(
                            employee, parsed_check_at.date(), duration_minutes,
                            parse_database_timestamp(received_at),
                            recorded_at=parsed_check_at,
                        )
                    user_id = employee["attendance_user_id"] or employee["id"]
                    cursor = connection.execute(
                        """INSERT INTO attendance_logs
                           (user_id, check_time, device_ip, status, source, note, duration_minutes,
                            permission_type, permission_paid, received_at)
                           VALUES (?, ?, 'manual', ?, 'manual', ?, ?, ?, ?, ?)""",
                        (user_id, local_timestamp(parsed_check_at), status, note,
                         duration_minutes, permission_type, int(permission_paid), received_at),
                    )
                    connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (checked_at[:7],))
                    connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (checked_at[:7],))
                    log = connection.execute(
                        """SELECT a.*, e.id AS employee_id, e.name FROM attendance_logs a
                           LEFT JOIN employees e ON a.user_id = e.attendance_user_id OR a.user_id = e.id
                           WHERE a.id = ?""",
                        (cursor.lastrowid,),
                    ).fetchone()
                refresh_existing_payroll(parsed_check_at.strftime("%Y-%m"))
                self.send_json(201, {"id": cursor.lastrowid, "source": "manual", "log": dict(log)})
                return

            if self.path == "/api/v1/payroll/calculate":
                if not isinstance(body, dict):
                    raise ValueError("Payroll calculation must be a JSON object")
                period = str(body.get("period", "")).strip()
                snapshot = payroll_preview(period)
                incomplete = [item["name"] for item in snapshot["employees"] if not item["schedule_configured"]]
                if incomplete:
                    raise ValueError("Set shift start and end before calculating payroll: " + ", ".join(incomplete))
                with connect_db() as connection:
                    approved = connection.execute(
                        "SELECT 1 FROM payroll_approvals WHERE period = ?", (period,)
                    ).fetchone()
                    if approved:
                        raise ValueError("This payroll period is approved; revoke approval before recalculating")
                    calculated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                    for item in snapshot["employees"]:
                        connection.execute(
                                                        """INSERT INTO payroll(
                                                                 employee_id, period, base_pay, days_present, assumed_full_shift_days, regular_hours,
                                                                 permission_minutes, free_delay_minutes, charged_delay_minutes,
                                                                 deducted_days, overtime_hours, overtime_pay, late_minutes,
                                                                 late_deduction, absence_days, excused_absence_days,
                                                                 absence_deduction, other_deductions, permission_deductions,
                                                                 net_pay, status, calculated_at
                                                             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
                                                             ON CONFLICT(employee_id, period) DO UPDATE SET
                                                                 base_pay=excluded.base_pay, days_present=excluded.days_present,
                                                                 assumed_full_shift_days=excluded.assumed_full_shift_days,
                                                                 regular_hours=excluded.regular_hours, permission_minutes=excluded.permission_minutes,
                                                                 free_delay_minutes=excluded.free_delay_minutes,
                                                                 charged_delay_minutes=excluded.charged_delay_minutes,
                                                                 deducted_days=excluded.deducted_days, overtime_hours=excluded.overtime_hours,
                                                                 overtime_pay=excluded.overtime_pay, late_minutes=excluded.late_minutes,
                                                                 late_deduction=excluded.late_deduction, absence_days=excluded.absence_days,
                                                                 excused_absence_days=excluded.excused_absence_days,
                                                                 absence_deduction=excluded.absence_deduction,
                                                                 other_deductions=excluded.other_deductions,
                                                                 permission_deductions=excluded.permission_deductions,
                                                                 net_pay=excluded.net_pay, status='draft', calculated_at=excluded.calculated_at""",
                                                        (item["id"], period, item["base_pay"], item["days_present"],
                                                         item["assumed_full_shift_days"],
                                                         item["regular_hours"], item["permission_minutes"],
                                                         item["free_delay_minutes"], item["charged_delay_minutes"],
                                                         item["deducted_days"], item["overtime_hours"], item["overtime_pay"],
                                                         item["late_minutes"], item["late_deduction"], item["absence_days"],
                                                         item["excused_absence_days"], item["absence_deduction"],
                                                         item["other_deductions"], item["permission_deductions"],
                                                         item["net_pay"], calculated_at),
                        )
                self.send_json(201, {"period": period, "calculated_at": calculated_at,
                                     "totals": snapshot["totals"], "employees": snapshot["employees"]})
                return

            if self.path == "/api/v1/payroll/adjustments":
                if not isinstance(body, dict):
                    raise ValueError("Payroll adjustment must be a JSON object")
                employee_id = str(body.get("employee_id", "")).strip()
                period = str(body.get("period", "")).strip()
                kind = body.get("kind")
                note = str(body.get("note", "")).strip()
                amount = float(body.get("amount", -1))
                if kind not in {"deduction", "permission"} or amount < 0 or not note:
                    raise ValueError("Provide kind (deduction or permission), non-negative amount, and note")
                if not re.fullmatch(r"\d{4}-\d{2}", period):
                    raise ValueError("period must use YYYY-MM")
                with connect_db() as connection:
                    employee = connection.execute("SELECT id FROM employees WHERE id = ?", (employee_id,)).fetchone()
                    if not employee:
                        self.send_json(404, {"error": "Employee not found"})
                        return
                    cursor = connection.execute(
                        "INSERT INTO payroll_adjustments(employee_id, period, kind, amount, note) VALUES (?, ?, ?, ?, ?)",
                        (employee_id, period, kind, amount, note),
                    )
                    connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                    connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (period,))
                self.send_json(201, {"id": cursor.lastrowid})
                return

            if self.path == "/api/v1/payroll/approve":
                if not isinstance(body, dict):
                    raise ValueError("Payroll approval must be a JSON object")
                period = str(body.get("period", "")).strip()
                approved_by = str(body.get("approved_by", "")).strip()
                if not approved_by:
                    raise ValueError("approved_by is required")
                snapshot = payroll_preview(period)
                incomplete = [item["name"] for item in snapshot["employees"] if not item["schedule_configured"]]
                if incomplete:
                    raise ValueError("Set shift start and end before approving payroll: " + ", ".join(incomplete))
                missing_compensation = [
                    item["name"] for item in snapshot["employees"]
                    if not item["compensation_configured"]
                ]
                if missing_compensation:
                    raise ValueError(
                        "Set a monthly salary or hourly wage before approving payroll: "
                        + ", ".join(missing_compensation)
                    )
                unverified_start_dates = [
                    item["name"] for item in snapshot["employees"]
                    if not item["start_date_verified"]
                ]
                if unverified_start_dates:
                    raise ValueError(
                        "Verify employment start dates before approving payroll: "
                        + ", ".join(unverified_start_dates)
                    )
                with connect_db() as connection:
                    draft_count = connection.execute(
                                """SELECT COUNT(*) FROM payroll p JOIN employees e ON e.id = p.employee_id
                                    WHERE p.period = ? AND p.status = 'draft' AND e.active = 1""",
                                (period,),
                    ).fetchone()[0]
                if draft_count != len(snapshot["employees"]):
                    raise ValueError("Calculate payroll before approving it")
                snapshot["approved"] = None
                approved_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
                with connect_db() as connection:
                    connection.execute(
                        """INSERT INTO payroll_approvals(period, approved_by, approved_at, snapshot_json)
                           VALUES (?, ?, ?, ?) ON CONFLICT(period) DO UPDATE SET
                           approved_by=excluded.approved_by, approved_at=excluded.approved_at,
                           snapshot_json=excluded.snapshot_json""",
                        (period, approved_by, approved_at, json.dumps(snapshot, ensure_ascii=False)),
                    )
                    connection.execute("UPDATE payroll SET status = 'approved' WHERE period = ?", (period,))
                self.send_json(201, {"period": period, "approved_by": approved_by, "approved_at": approved_at})
                return

            self.send_json(404, {"error": "Not found"})
        except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
            self.send_json(400, {"error": str(error)})

    def do_PUT(self):
        if not self.authorized():
            self.send_json(401, {"error": "Bearer token required"})
            return
        path = urlparse(self.path).path
        salary_match = re.fullmatch(r"/api/(?:v1/)?employees/([^/]+)/salary", path)
        if salary_match:
            try:
                body = self.read_json()
                if not isinstance(body, dict):
                    raise ValueError("Salary update must be a JSON object")
                with connect_db() as connection:
                    employee = connection.execute(
                        "SELECT * FROM employees WHERE id = ?", (salary_match.group(1),)
                    ).fetchone()
                    if not employee:
                        self.send_json(404, {"error": "Employee not found"})
                        return
                    monthly_salary = float(body.get("monthly_salary", body.get("base_monthly_salary", employee["base_monthly_salary"])))
                    shift_hours = float(body.get("shift_hours", employee["shift_hours"]))
                    if monthly_salary < 0 or not 0 < shift_hours <= 24:
                        raise ValueError("monthly_salary must be non-negative and shift_hours must be 0-24")
                    scheduled_days = workdays_in_month(date.today().year, date.today().month, int(employee["weekly_rest_day"]))
                    if monthly_salary:
                        hourly_wage = monthly_salary / scheduled_days / shift_hours
                    else:
                        hourly_wage = float(body.get("hourly_wage", employee["hourly_wage"]))
                        if hourly_wage < 0:
                            raise ValueError("hourly_wage must be non-negative")
                    connection.execute(
                        "UPDATE employees SET base_monthly_salary = ?, hourly_wage = ?, shift_hours = ? WHERE id = ?",
                        (monthly_salary, hourly_wage, shift_hours, salary_match.group(1)),
                    )
                    period = date.today().strftime("%Y-%m")
                    connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                    connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (period,))
                    updated = connection.execute(
                        "SELECT * FROM employees WHERE id = ?", (salary_match.group(1),)
                    ).fetchone()
                self.send_json(200, {"employee": employee_dict(updated), "rates": salary_rates(updated)})
            except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
                self.send_json(400, {"error": str(error)})
            return

        allowance_match = re.fullmatch(r"/api/v1/permission-allowance/([^/]+)", path)
        if allowance_match:
            try:
                body = self.read_json()
                if not isinstance(body, dict):
                    raise ValueError("Allowance update must be a JSON object")
                period = str(body.get("period", "")).strip()
                period_date = datetime.strptime(period, "%Y-%m").date()
                if period_date < REPORTING_START_DATE.replace(day=1):
                    raise ValueError("month is before the reporting start date")
                if period_date > date.today().replace(day=1):
                    raise ValueError("month cannot be in the future")
                raw_remaining = body.get("remaining_minutes")
                remaining_minutes = int(raw_remaining)
                if isinstance(raw_remaining, bool) or str(raw_remaining).strip() != str(remaining_minutes):
                    raise ValueError("remaining_minutes must be a whole number")
                if not 0 <= remaining_minutes <= 120:
                    raise ValueError("remaining_minutes must be between 0 and 120")
                note = str(body.get("note", "")).strip()
                if not note or len(note) > 250:
                    raise ValueError("A note of 1 to 250 characters is required")
                with connect_db() as connection:
                    employee = connection.execute(
                        "SELECT id FROM employees WHERE id = ?", (allowance_match.group(1),)
                    ).fetchone()
                    if not employee:
                        self.send_json(404, {"error": "Employee not found"})
                        return
                    connection.execute(
                        """INSERT INTO attendance_allowance_balances
                           (employee_id, period, remaining_minutes, note)
                           VALUES (?, ?, ?, ?)
                           ON CONFLICT(employee_id, period) DO UPDATE SET
                             remaining_minutes = excluded.remaining_minutes,
                             note = excluded.note, updated_at = CURRENT_TIMESTAMP""",
                        (allowance_match.group(1), period, remaining_minutes, note),
                    )
                    connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                    connection.execute(
                        """UPDATE payroll SET free_delay_minutes = ?, status = 'draft'
                           WHERE employee_id = ? AND period = ?""",
                        (120 - remaining_minutes, allowance_match.group(1), period),
                    )
                self.send_json(200, {
                    "employee_id": allowance_match.group(1), "period": period,
                    "allowance_minutes": 120,
                    "minutes_used": 120 - remaining_minutes,
                    "minutes_remaining": remaining_minutes,
                    "manual_note": note,
                })
            except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
                self.send_json(400, {"error": str(error)})
            return

        attendance_match = re.fullmatch(r"/api/(?:v1/)?attendance/(\d+)", path)
        if not attendance_match:
            self.send_json(404, {"error": "Not found"})
            return
        try:
            body = self.read_json()
            if not isinstance(body, dict):
                raise ValueError("Attendance update must be a JSON object")
            updates = {}
            with connect_db() as connection:
                existing = connection.execute(
                    """SELECT a.*, e.id AS employee_id,
                              e.shift_start AS employee_shift_start,
                              e.shift_end AS employee_shift_end FROM attendance_logs a
                       LEFT JOIN employees e ON e.id = a.user_id OR e.attendance_user_id = a.user_id
                       WHERE a.id = ?""",
                    (attendance_match.group(1),),
                ).fetchone()
                if not existing:
                    self.send_json(404, {"error": "Attendance record not found"})
                    return
                user_id = existing["user_id"]
                if "employee_id" in body:
                    employee = connection.execute(
                        "SELECT id, attendance_user_id FROM employees WHERE id = ?", (str(body["employee_id"]),)
                    ).fetchone()
                    if not employee:
                        self.send_json(404, {"error": "Employee not found"})
                        return
                    user_id = employee["attendance_user_id"] or employee["id"]
                    updates["user_id"] = user_id
                if "check_time" in body:
                    updates["check_time"] = local_timestamp(parse_check_time(body["check_time"]))
                if "status" in body:
                    status = str(body["status"]).strip().upper()
                    if status not in ATTENDANCE_IN_STATUSES | ATTENDANCE_OUT_STATUSES | {"PERMISSION", "OVERTIME_APPROVED", "LEAVE", "ABSENCE_UNEXCUSED", "ABSENCE_EXCUSED"}:
                        raise ValueError("Unsupported attendance status")
                    updates["status"] = status
                if "duration_hours" in body:
                    updates["duration_minutes"] = int(float(body["duration_hours"]) * 60)
                elif "duration_minutes" in body:
                    updates["duration_minutes"] = int(body["duration_minutes"])
                if "note" in body or "reason" in body:
                    updates["note"] = str(body.get("note", body.get("reason", ""))).strip()
                if "permission_type" in body:
                    permission_type = str(body["permission_type"]).strip().lower()
                    if permission_type not in {"", "late", "early"}:
                        raise ValueError("permission_type must be late or early")
                    updates["permission_type"] = permission_type
                if "permission_paid" in body or "is_paid" in body:
                    updates["permission_paid"] = int(parse_boolean(body.get("permission_paid", body.get("is_paid")), "permission_paid"))
                if not updates:
                    raise ValueError("No editable attendance fields provided")
                if updates.get("duration_minutes", existing["duration_minutes"]) < 0 or updates.get("duration_minutes", existing["duration_minutes"]) > 1440:
                    raise ValueError("duration_minutes must be between 0 and 1440")
                target_employee_id = str(body.get("employee_id", existing["employee_id"] or ""))
                target_check_time = parse_check_time(body.get("check_time", existing["check_time"]))
                target_work_date = target_check_time.date()
                if target_employee_id and employee_is_on_paid_leave(connection, target_employee_id, target_work_date):
                    self.send_json(409, {"error": "Attendance cannot be recorded on an approved paid-leave day"})
                    return
                target_status = str(body.get("status", existing["status"])).strip().upper()
                approval_changed = target_status == "OVERTIME_APPROVED" and (
                    existing["status"] != "OVERTIME_APPROVED"
                    or "check_time" in body
                    or "duration_minutes" in body
                    or "duration_hours" in body
                    or "employee_id" in body
                )
                if approval_changed:
                    overtime_employee = connection.execute(
                        "SELECT shift_start, shift_end FROM employees WHERE id = ?",
                        (target_employee_id,),
                    ).fetchone()
                    if not overtime_employee:
                        self.send_json(404, {"error": "Employee not found"})
                        return
                    received_at = datetime.now().astimezone().isoformat(timespec="seconds")
                    validate_overtime_approval(
                        overtime_employee, target_work_date,
                        int(updates.get("duration_minutes", existing["duration_minutes"])),
                        parse_database_timestamp(received_at),
                        recorded_at=target_check_time,
                    )
                    updates["received_at"] = received_at
                updates["source"] = "manual"
                assignments = ", ".join(f"{column} = ?" for column in updates)
                connection.execute(
                    f"UPDATE attendance_logs SET {assignments} WHERE id = ?",
                    [*updates.values(), attendance_match.group(1)],
                )
                changed = connection.execute(
                    "SELECT * FROM attendance_logs WHERE id = ?", (attendance_match.group(1),)
                ).fetchone()
                affected_periods = {existing["check_time"][:7], changed["check_time"][:7]}
                connection.executemany("DELETE FROM payroll_approvals WHERE period = ?", [(period,) for period in affected_periods])
                connection.executemany("UPDATE payroll SET status = 'draft' WHERE period = ?", [(period,) for period in affected_periods])
                log = connection.execute(
                    """SELECT a.*, e.id AS employee_id, e.name FROM attendance_logs a
                       LEFT JOIN employees e ON a.user_id = e.attendance_user_id OR a.user_id = e.id
                       WHERE a.id = ?""",
                    (attendance_match.group(1),),
                ).fetchone()
            self.send_json(200, {"log": dict(log)})
        except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
            self.send_json(400, {"error": str(error)})

    def do_PATCH(self):
        if not self.authorized():
            self.send_json(401, {"error": "Bearer token required"})
            return
        path = urlparse(self.path).path
        attendance_match = re.fullmatch(r"/api/v1/attendance/manual/(\d+)", path)
        if attendance_match:
            try:
                body = self.read_json()
                if not isinstance(body, dict):
                    raise ValueError("Manual attendance update must be a JSON object")
                allowed_statuses = {
                    *ATTENDANCE_IN_STATUSES, *ATTENDANCE_OUT_STATUSES, "PERMISSION", "OVERTIME_APPROVED", "LEAVE",
                    "ABSENCE_UNEXCUSED", "ABSENCE_EXCUSED",
                }
                updates = []
                if "check_time" in body:
                    checked_at = parse_check_time(body["check_time"])
                    updates.append(("check_time", local_timestamp(checked_at)))
                if "status" in body:
                    status = str(body["status"]).strip().upper()
                    if status not in allowed_statuses:
                        raise ValueError("Unsupported manual attendance status")
                    updates.append(("status", status))
                if "note" in body:
                    updates.append(("note", str(body["note"]).strip()))
                if "duration_minutes" in body:
                    duration_minutes = int(body["duration_minutes"])
                    if duration_minutes < 0 or duration_minutes > 1440:
                        raise ValueError("duration_minutes must be between 0 and 1440")
                    updates.append(("duration_minutes", duration_minutes))
                if "permission_type" in body:
                    permission_type = str(body["permission_type"]).strip().lower()
                    if permission_type not in {"", "late", "early"}:
                        raise ValueError("permission_type must be late or early")
                    updates.append(("permission_type", permission_type))
                if "permission_paid" in body or "is_paid" in body:
                    permission_paid = parse_boolean(
                        body.get("permission_paid", body.get("is_paid")), "permission_paid"
                    )
                    updates.append(("permission_paid", int(permission_paid)))
                if not updates:
                    raise ValueError("No editable attendance fields provided")
                with connect_db() as connection:
                    existing = connection.execute(
                        "SELECT check_time, user_id, status, duration_minutes FROM attendance_logs WHERE id = ? AND source = 'manual'",
                        (attendance_match.group(1),),
                    ).fetchone()
                    if not existing:
                        self.send_json(404, {"error": "Manual attendance record not found"})
                        return
                    employee = connection.execute(
                        "SELECT id, shift_start, shift_end FROM employees WHERE id = ? OR attendance_user_id = ?",
                        (existing["user_id"], existing["user_id"]),
                    ).fetchone()
                    target_work_date = parse_check_time(
                        body.get("check_time", existing["check_time"])
                    ).date()
                    if employee and employee_is_on_paid_leave(connection, employee["id"], target_work_date):
                        self.send_json(409, {"error": "Attendance cannot be recorded on an approved paid-leave day"})
                        return
                    target_status = str(body.get("status", existing["status"])).strip().upper()
                    approval_changed = target_status == "OVERTIME_APPROVED" and (
                        existing["status"] != "OVERTIME_APPROVED"
                        or "check_time" in body
                        or "duration_minutes" in body
                    )
                    if approval_changed:
                        target_check_time = parse_check_time(body.get("check_time", existing["check_time"]))
                        received_at = datetime.now().astimezone().isoformat(timespec="seconds")
                        validate_overtime_approval(
                            employee,
                            target_check_time.date(),
                            int(body.get("duration_minutes", existing["duration_minutes"])),
                            parse_database_timestamp(received_at),
                            recorded_at=target_check_time,
                        )
                        updates.append(("received_at", received_at))
                    assignments = ", ".join(f"{column} = ?" for column, _ in updates)
                    connection.execute(
                        f"UPDATE attendance_logs SET {assignments} WHERE id = ? AND source = 'manual'",
                        [value for _, value in updates] + [attendance_match.group(1)],
                    )
                    changed = connection.execute(
                        "SELECT check_time FROM attendance_logs WHERE id = ?",
                        (attendance_match.group(1),),
                    ).fetchone()
                    affected_periods = {existing["check_time"][:7], changed["check_time"][:7]}
                    connection.executemany(
                        "DELETE FROM payroll_approvals WHERE period = ?",
                        [(period,) for period in affected_periods],
                    )
                    connection.executemany(
                        "UPDATE payroll SET status = 'draft' WHERE period = ?",
                        [(period,) for period in affected_periods],
                    )
                    log = connection.execute(
                        """SELECT a.*, e.id AS employee_id, e.name FROM attendance_logs a
                           LEFT JOIN employees e ON a.user_id = e.attendance_user_id OR a.user_id = e.id
                           WHERE a.id = ?""",
                        (attendance_match.group(1),),
                    ).fetchone()
                for period in affected_periods:
                    refresh_existing_payroll(period)
                self.send_json(200, {"log": dict(log)})
            except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
                self.send_json(400, {"error": str(error)})
            return

        match = re.fullmatch(r"/api/v1/employees/([^/]+)", path)
        if not match:
            self.send_json(404, {"error": "Not found"})
            return
        try:
            body = self.read_json()
            if not isinstance(body, dict):
                raise ValueError("Employee update must be a JSON object")
            fields = {
                "base_monthly_salary": ("base_monthly_salary", lambda value: float(value)),
                "attendance_user_id": ("attendance_user_id", lambda value: None if value in (None, "") else str(value).strip()),
                "name": ("name", lambda value: str(value).strip()),
                "position": ("position", lambda value: str(value).strip()),
                "department": ("department", lambda value: str(value).strip()),
                "start_date": ("start_date", lambda value: date.fromisoformat(value).isoformat()),
                "start_date_verified": ("start_date_verified", lambda value: int(parse_boolean(value, "start_date_verified"))),
                "end_date": ("end_date", lambda value: None if value in (None, "") else date.fromisoformat(value).isoformat()),
                "birth_date": ("birth_date", lambda value: None if value in (None, "") else date.fromisoformat(value).isoformat()),
                "disability": ("disability", lambda value: int(parse_boolean(value, "disability"))),
                "active": ("active", lambda value: int(bool(value))),
                "weekly_rest_day": ("weekly_rest_day", lambda value: int(value)),
                "hourly_wage": ("hourly_wage", lambda value: float(value)),
                "shift_hours": ("shift_hours", lambda value: float(value)),
                "shift_start": ("shift_start", lambda value: value),
                "shift_end": ("shift_end", lambda value: value),
            }
            updates = []
            for key, (column, convert) in fields.items():
                if key not in body:
                    continue
                value = convert(body[key])
                if key == "hourly_wage" and value < 0:
                    raise ValueError("hourly_wage must be non-negative")
                if key == "base_monthly_salary" and value < 0:
                    raise ValueError("base_monthly_salary must be non-negative")
                if key == "shift_hours" and not 0 < value <= 24:
                    raise ValueError("shift_hours must be greater than 0 and at most 24")
                if key == "weekly_rest_day" and not 0 <= value <= 6:
                    raise ValueError("weekly_rest_day must be between 0 and 6")
                if key == "birth_date" and value and date.fromisoformat(value) >= date.today():
                    raise ValueError("birth_date must be in the past")
                if key in {"shift_start", "shift_end"} and value is not None:
                    time.fromisoformat(value)
                updates.append((column, value))
            if "active" in body and "end_date" not in body:
                updates.append(("end_date", date.today().isoformat() if not parse_boolean(body["active"], "active") else None))
            if not updates:
                raise ValueError("No editable fields provided")
            with connect_db() as connection:
                exists = connection.execute("SELECT id FROM employees WHERE id = ?", (match.group(1),)).fetchone()
                if not exists:
                    self.send_json(404, {"error": "Employee not found"})
                    return
                current_dates = connection.execute(
                    "SELECT start_date, end_date FROM employees WHERE id = ?",
                    (match.group(1),),
                ).fetchone()
                update_values = dict(updates)
                final_start = update_values.get("start_date", current_dates["start_date"])
                final_end = update_values.get("end_date", current_dates["end_date"])
                if final_end and date.fromisoformat(final_end) < date.fromisoformat(final_start):
                    raise ValueError("end_date cannot be before start_date")
                assignments = ", ".join(f"{column} = ?" for column, _ in updates)
                connection.execute(
                    f"UPDATE employees SET {assignments} WHERE id = ?",
                    [value for _, value in updates] + [match.group(1)],
                )
                connection.execute("DELETE FROM payroll_approvals")
                connection.execute("UPDATE payroll SET status = 'draft'")
                updated = connection.execute("SELECT * FROM employees WHERE id = ?", (match.group(1),)).fetchone()
            self.send_json(200, {"employee": employee_dict(updated)})
        except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
            self.send_json(400, {"error": str(error)})

    def do_DELETE(self):
        if not self.authorized():
            self.send_json(401, {"error": "Bearer token required"})
            return
        holiday_match = re.fullmatch(r"/api/v1/holidays/(\d{4}-\d{2}-\d{2})", urlparse(self.path).path)
        if holiday_match:
            try:
                holiday_date = date.fromisoformat(holiday_match.group(1))
            except ValueError as error:
                self.send_json(400, {"error": "Holiday date must use YYYY-MM-DD"})
                return
            with connect_db() as connection:
                result = connection.execute(
                    "DELETE FROM company_holidays WHERE holiday_date = ?",
                    (holiday_date.isoformat(),),
                )
                if not result.rowcount:
                    self.send_json(404, {"error": "Holiday not found"})
                    return
                period = holiday_date.strftime("%Y-%m")
                connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (period,))
            self.send_json(200, {"deleted": holiday_date.isoformat()})
            return
        outage_match = re.fullmatch(r"/api/v1/attendance/outages/(\d+)", urlparse(self.path).path)
        if outage_match:
            with connect_db() as connection:
                outage = connection.execute(
                    "SELECT start_date, end_date FROM attendance_outages WHERE id = ?",
                    (outage_match.group(1),),
                ).fetchone()
                if not outage:
                    self.send_json(404, {"error": "Attendance outage not found"})
                    return
                connection.execute("DELETE FROM attendance_outages WHERE id = ?", (outage_match.group(1),))
                period_date = date.fromisoformat(f"{outage['start_date'][:7]}-01")
                final_date = date.fromisoformat(f"{outage['end_date'][:7]}-01")
                while period_date <= final_date:
                    period = period_date.strftime("%Y-%m")
                    connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                    connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (period,))
                    period_date = date(
                        period_date.year + (period_date.month == 12),
                        1 if period_date.month == 12 else period_date.month + 1,
                        1,
                    )
            self.send_json(200, {"deleted": int(outage_match.group(1))})
            return
        attendance_match = re.fullmatch(r"/api/(?:v1/)?attendance/(\d+)", urlparse(self.path).path)
        if attendance_match:
            with connect_db() as connection:
                existing = connection.execute(
                    "SELECT check_time FROM attendance_logs WHERE id = ?", (attendance_match.group(1),)
                ).fetchone()
                if not existing:
                    self.send_json(404, {"error": "Attendance record not found"})
                    return
                connection.execute("DELETE FROM attendance_logs WHERE id = ?", (attendance_match.group(1),))
                period = existing["check_time"][:7]
                connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (period,))
                connection.execute("UPDATE payroll SET status = 'draft' WHERE period = ?", (period,))
            refresh_existing_payroll(period)
            self.send_json(200, {"deleted": int(attendance_match.group(1))})
            return
        match = re.fullmatch(r"/api/v1/employees/([^/]+)", urlparse(self.path).path)
        if not match:
            self.send_json(404, {"error": "Not found"})
            return
        with connect_db() as connection:
            result = connection.execute(
                "UPDATE employees SET active = 0, end_date = COALESCE(end_date, ?) WHERE id = ?",
                (date.today().isoformat(), match.group(1)),
            )
            if not result.rowcount:
                self.send_json(404, {"error": "Employee not found"})
                return
            connection.execute("DELETE FROM payroll_approvals")
            connection.execute("UPDATE payroll SET status = 'draft'")
        self.send_json(200, {"deactivated": match.group(1)})


if __name__ == "__main__":
    initialize_db()
    print(f"Mak Hills API listening on http://{HOST}:{PORT}")
    if IS_PRODUCTION:
        print("Production mode: every API request requires MAKHILLS_API_TOKEN.")
    else:
        print("Development mode: loopback requests are passwordless; remote clients require MAKHILLS_API_TOKEN.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
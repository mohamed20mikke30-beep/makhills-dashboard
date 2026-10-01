import calendar
import os
import sys
from datetime import date, datetime, time, timedelta
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))
import server


BACKEND = Path(__file__).resolve().parent
PERIOD = os.environ.get("MAKHILLS_DEMO_PERIOD", date.today().strftime("%Y-%m"))
DEMO_STAFF = [
    ("demo-001", "يارا عادل", "مسؤولة مبيعات", "المبيعات", 18500, 125),
    ("demo-002", "زياد فؤاد", "مندوب مبيعات", "المبيعات", 16800, 115),
    ("demo-003", "ملك سامح", "مديرة مبيعات", "المبيعات", 24500, 170),
    ("demo-004", "آدم رامي", "أخصائي تسويق", "التسويق", 19200, 135),
    ("demo-005", "لينا شريف", "صانعة محتوى", "التسويق", 17600, 120),
    ("demo-006", "كريم نبيل", "مدير عمليات", "الإدارة", 28500, 200),
    ("demo-007", "نورهان ماجد", "مساعدة إدارية", "الإدارة", 16400, 110),
    ("demo-008", "عمر عاطف", "مسؤول تحصيل", "التحصيل", 17800, 125),
    ("demo-009", "مريم حسني", "أخصائية تحصيل", "التحصيل", 17100, 118),
    ("demo-010", "سيف أشرف", "مشرف تحصيل", "التحصيل", 21600, 150),
]


def validate_period():
    try:
        datetime.strptime(PERIOD, "%Y-%m")
    except ValueError as error:
        raise ValueError("MAKHILLS_DEMO_PERIOD must use YYYY-MM") from error


def seed_demo():
    validate_period()
    server.DB_PATH = Path(os.environ.get("MAKHILLS_DB_PATH", BACKEND / "data" / "makhills-demo.sqlite3"))
    server.OVERTIME_MULTIPLIER = float(os.environ.get("MAKHILLS_OVERTIME_MULTIPLIER", "1.5"))
    schema = (BACKEND / "schema.sql").read_text(encoding="utf-8")
    demo_ids = [employee[0] for employee in DEMO_STAFF]
    month_start = datetime.strptime(PERIOD, "%Y-%m").date()

    with server.connect_db() as connection:
        connection.executescript(schema)
        log_columns = {row["name"] for row in connection.execute("PRAGMA table_info(attendance_logs)")}
        if "source" not in log_columns:
            connection.execute("ALTER TABLE attendance_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'device'")
        if "note" not in log_columns:
            connection.execute("ALTER TABLE attendance_logs ADD COLUMN note TEXT NOT NULL DEFAULT ''")
        employee_columns = {row["name"] for row in connection.execute("PRAGMA table_info(employees)")}
        if "base_monthly_salary" not in employee_columns:
            connection.execute("ALTER TABLE employees ADD COLUMN base_monthly_salary REAL NOT NULL DEFAULT 0")
        payroll_columns = {row["name"] for row in connection.execute("PRAGMA table_info(payroll)")}
        if "days_present" not in payroll_columns:
            connection.execute("ALTER TABLE payroll ADD COLUMN days_present INTEGER NOT NULL DEFAULT 0")

        unrelated = connection.execute(
            "SELECT COUNT(*) FROM employees WHERE id NOT LIKE 'demo-%'"
        ).fetchone()[0]
        if unrelated:
            raise RuntimeError(
                "Refusing to mix demo data with company employees. Set MAKHILLS_DB_PATH "
                "to a separate makhills-demo.sqlite3 file first."
            )

        connection.execute("DELETE FROM payroll_approvals WHERE period = ?", (PERIOD,))
        connection.execute("DELETE FROM payroll WHERE employee_id LIKE 'demo-%'")
        connection.execute("DELETE FROM payroll_adjustments WHERE employee_id LIKE 'demo-%'")
        connection.execute("DELETE FROM attendance_logs WHERE source = 'demo'")
        connection.execute("DELETE FROM employees WHERE id LIKE 'demo-%'")

        connection.executemany(
            """INSERT INTO employees(
                 id, name, position, department, attendance_user_id, hourly_wage,
                 base_monthly_salary, shift_hours, shift_start, shift_end, start_date, active
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 8, '09:00', '17:00', ?, 1)""",
            [(employee_id, name, position, department, f"D{index:03}", hourly_wage,
              base_salary, month_start.isoformat())
             for index, (employee_id, name, position, department, base_salary, hourly_wage)
             in enumerate(DEMO_STAFF, 1)],
        )

        punches = []
        final_day = calendar.monthrange(month_start.year, month_start.month)[1]
        for day_number in range(1, final_day + 1):
            work_date = date(month_start.year, month_start.month, day_number)
            if work_date.weekday() >= 5:
                continue
            for index, employee in enumerate(DEMO_STAFF, 1):
                employee_id = employee[0]
                if (day_number + index * 3) % 23 == 0:
                    continue
                is_late = (day_number + index) % 7 == 0
                arrival = datetime.combine(work_date, time(9, 0)) + timedelta(minutes=14 if is_late else (5 if (day_number + index) % 9 == 0 else 0))
                overtime_minutes = 75 if (day_number + index * 2) % 13 == 0 else 0
                departure = datetime.combine(work_date, time(17, 0)) + timedelta(minutes=overtime_minutes)
                user_id = f"D{index:03}"
                note = "سجل تجريبي للعرض الإداري"
                punches.extend([
                    (user_id, arrival.isoformat(timespec="seconds"), "203.0.113.42", "IN", "demo", note),
                    (user_id, departure.isoformat(timespec="seconds"), "203.0.113.42", "OUT", "demo", note),
                ])
        connection.executemany(
            """INSERT OR IGNORE INTO attendance_logs
               (user_id, check_time, device_ip, status, source, note)
               VALUES (?, ?, ?, ?, ?, ?)""",
            punches,
        )
        connection.executemany(
            """INSERT INTO payroll_adjustments(employee_id, period, kind, amount, note)
               VALUES (?, ?, ?, ?, ?)""",
            [
                ("demo-003", PERIOD, "deduction", 450, "خصم إداري تجريبي"),
                ("demo-007", PERIOD, "permission", 300, "إذن غير مدفوع تجريبي"),
                ("demo-009", PERIOD, "deduction", 275, "خصم تجريبي"),
            ],
        )

    report = server.payroll_preview(PERIOD)
    calculated_at = datetime.now().astimezone().isoformat(timespec="seconds")
    with server.connect_db() as connection:
        for employee in report["employees"]:
            connection.execute(
                """INSERT INTO payroll(
                     employee_id, period, base_pay, days_present, regular_hours,
                     overtime_hours, overtime_pay, late_minutes, late_deduction,
                     other_deductions, permission_deductions, net_pay, status, calculated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)
                   ON CONFLICT(employee_id, period) DO UPDATE SET
                     base_pay=excluded.base_pay, days_present=excluded.days_present,
                     regular_hours=excluded.regular_hours, overtime_hours=excluded.overtime_hours,
                     overtime_pay=excluded.overtime_pay, late_minutes=excluded.late_minutes,
                     late_deduction=excluded.late_deduction, other_deductions=excluded.other_deductions,
                     permission_deductions=excluded.permission_deductions, net_pay=excluded.net_pay,
                     status='draft', calculated_at=excluded.calculated_at""",
                (employee["id"], PERIOD, employee["base_pay"], employee["days_present"],
                 employee["regular_hours"], employee["overtime_hours"], employee["overtime_pay"],
                 employee["late_minutes"], employee["late_deduction"], employee["other_deductions"],
                 employee["permission_deductions"], employee["net_pay"], calculated_at),
            )

    print(f"Seeded {len(DEMO_STAFF)} demo employees and {len(punches)} attendance events for {PERIOD}.")
    print(f"Demo database: {server.DB_PATH}")
    print(f"Draft net payroll: {report['totals']['net_pay']:.2f} EGP")


if __name__ == "__main__":
    seed_demo()

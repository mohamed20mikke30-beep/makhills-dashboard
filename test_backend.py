import json
import io
import sys
import tempfile
import threading
import unittest
import zipfile
from datetime import date, datetime, timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen


sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import server
import bridge
import import_attendance_2026_09


class AttendancePayrollApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory(prefix="mak-hills-test-")
        server.DB_PATH = Path(self.temporary_directory.name) / "test.sqlite3"
        server.TOKEN = "test-token"
        server.OVERTIME_MULTIPLIER = 1.5
        server.initialize_db()
        self.http_server = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.base_url = f"http://127.0.0.1:{self.http_server.server_port}"
        self.thread = threading.Thread(target=self.http_server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http_server.shutdown()
        self.http_server.server_close()
        self.thread.join(timeout=2)
        self.temporary_directory.cleanup()

    def test_september_historical_import_is_backed_up_and_idempotent(self):
        fingerprint_ids = {
            "e1": "8", "e2": "14", "e3": "11", "e4": "15", "e5": "7",
            "e6": "6", "e7": "12", "e8": "5", "e9": "13", "e10": "2",
        }
        with server.connect_db() as connection:
            connection.executemany(
                "UPDATE employees SET attendance_user_id = ? WHERE id = ?",
                [(user_id, employee_id) for employee_id, user_id in fingerprint_ids.items()],
            )
            original_start_dates = {
                row["id"]: row["start_date"]
                for row in connection.execute("SELECT id, start_date FROM employees")
            }

        first = import_attendance_2026_09.import_attendance(server.DB_PATH)
        self.assertEqual(first["imported_punches"], 317)
        self.assertTrue(Path(first["backup"]).exists())
        second = import_attendance_2026_09.import_attendance(server.DB_PATH)
        self.assertEqual(second["imported_punches"], 317)

        with server.connect_db() as connection:
            amira = connection.execute(
                "SELECT attendance_user_id, start_date, start_date_verified, end_date, active FROM employees WHERE id = 'e12'"
            ).fetchone()
            mohammad = connection.execute(
                "SELECT id, name FROM employees WHERE attendance_user_id = '13'"
            ).fetchone()
            count = connection.execute(
                "SELECT COUNT(*) FROM attendance_logs WHERE device_ip = ?",
                (import_attendance_2026_09.IMPORT_DEVICE,),
            ).fetchone()[0]
        self.assertEqual(dict(amira), {
            "attendance_user_id": "10", "start_date": "2026-09-01", "start_date_verified": 0,
            "end_date": "2026-09-27", "active": 0,
        })
        self.assertEqual((mohammad["id"], mohammad["name"]), ("e9", "محمد مكي"))
        self.assertEqual(count, 317)
        with server.connect_db() as connection:
            current_start_dates = {
                row["id"]: row["start_date"]
                for row in connection.execute("SELECT id, start_date FROM employees WHERE id != 'e12'")
            }
        self.assertEqual(current_start_dates, {key: value for key, value in original_start_dates.items() if key != "e12"})
        with server.connect_db() as connection:
            connection.execute("UPDATE employees SET start_date = '2026-09-01' WHERE id = 'e4'")
        preview = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 27), now=datetime(2026, 9, 27, 23, 0),
        )
        ziad = next(item for item in preview["employees"] if item["id"] == "e4")
        self.assertEqual(ziad["assumed_full_shift_days"], 0)
        amira_on_last_day = server.attendance_day_report(date(2026, 9, 27))
        self.assertIn("e12", [item["employee_id"] for item in amira_on_last_day["employees"]])
        amira_after_end = server.attendance_day_report(date(2026, 9, 28))
        self.assertNotIn("e12", [item["employee_id"] for item in amira_after_end["employees"]])
        ziad_summary = server.employee_summary(
            "e4", as_of=date(2026, 9, 27), now=datetime(2026, 9, 27, 23, 0), month="2026-09",
        )
        self.assertEqual(ziad_summary["attendance"]["days_present"], 1)
        self.assertEqual(ziad_summary["attendance"]["assumed_full_shift_days"], 0)
        breakdown = server.monthly_performance("2026-09")["employees"]
        self.assertIn("ranking_breakdown", breakdown[0])
        self.assertEqual(breakdown[0]["ranking_breakdown"]["weights"], {
            "attendance": 0.6, "punctuality": 0.4,
        })

    def request(self, path, method="GET", payload=None, authorized=True):
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if authorized:
            headers["Authorization"] = f"Bearer {server.TOKEN}"
        request = Request(self.base_url + path, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            return error.code, json.loads(error.read().decode("utf-8"))

    def test_monthly_allowance_changes_only_by_manual_admin_entry(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "shift_start": "12:00", "shift_end": "20:00",
        })
        self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-01", "check_in": "12:30", "check_out": "20:00"},
        ]})
        self.assertEqual(status, 201)
        status, daily = self.request("/api/v1/attendance/day?date=2026-09-01")
        self.assertEqual(status, 200)
        daily_employee = next(item for item in daily["employees"] if item["employee_id"] == "e1")
        self.assertEqual(daily_employee["late_minutes"], 30)
        self.assertEqual(daily_employee["actual_work_hours"], 7.5)
        status, summary = self.request("/api/employees/e1/summary?month=2026-09")
        self.assertEqual(status, 200)
        allowance = summary["attendance"]["permission_allowance"]
        self.assertEqual(allowance["late_minutes"], 30)
        self.assertEqual(allowance["minutes_used"], 0)
        self.assertEqual(allowance["minutes_remaining"], 120)
        preview = server.payroll_preview("2026-09")
        employee = next(item for item in preview["employees"] if item["id"] == "e1")
        self.assertEqual(employee["free_delay_minutes"], 0)

        status, updated = self.request("/api/v1/permission-allowance/e1", "PUT", {
            "period": "2026-09", "remaining_minutes": 85, "note": "قرار إداري معتمد",
        })
        self.assertEqual(status, 200)
        self.assertEqual(updated["minutes_used"], 35)
        status, summary = self.request("/api/employees/e1/summary?month=2026-09")
        self.assertEqual(status, 200)
        allowance = summary["attendance"]["permission_allowance"]
        self.assertEqual(allowance["minutes_remaining"], 85)
        self.assertEqual(allowance["manual_note"], "قرار إداري معتمد")
        preview = server.payroll_preview("2026-09")
        employee = next(item for item in preview["employees"] if item["id"] == "e1")
        self.assertEqual(employee["free_delay_minutes"], 35)
        status, _ = self.request("/api/v1/permission-allowance/e1", "PUT", {
            "period": "2026-09", "remaining_minutes": 121, "note": "قيمة غير صالحة",
        })
        self.assertEqual(status, 400)

    def test_special_shifts_drive_daily_late_and_overtime_minutes(self):
        status, result = self.request("/api/v1/employees")
        self.assertEqual(status, 200)
        by_name = {item["name"]: item for item in result["employees"]}
        self.assertEqual((by_name["آية"]["shift_start"], by_name["آية"]["shift_end"]), ("14:00", "20:00"))
        self.assertEqual((by_name["رضوى"]["shift_start"], by_name["رضوى"]["shift_end"]), ("12:00", "18:00"))
        self.assertEqual((by_name["إسراء"]["shift_start"], by_name["إسراء"]["shift_end"]), ("14:00", "20:00"))

        status, _ = self.request("/api/v1/employees/e7", "PATCH", {
            "start_date": "2026-09-01", "shift_start": "15:00", "shift_end": "21:00",
        })
        self.assertEqual(status, 200)
        server.initialize_db()
        with server.connect_db() as connection:
            ayah = connection.execute("SELECT shift_start, shift_end FROM employees WHERE id = 'e7'").fetchone()
        self.assertEqual((ayah["shift_start"], ayah["shift_end"]), ("15:00", "21:00"))
        status, _ = self.request("/api/v1/employees/e7", "PATCH", {"shift_start": "14:00", "shift_end": "20:00"})
        self.assertEqual(status, 200)
        for employee_id in ("e6", "e8", "e1"):
            status, _ = self.request(f"/api/v1/employees/{employee_id}", "PATCH", {"start_date": "2026-09-01"})
            self.assertEqual(status, 200)

        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e7", "date": "2026-09-30", "check_in": "14:15", "check_out": "20:45"},
            {"employee_id": "e6", "date": "2026-09-30", "check_in": "12:10", "check_out": "18:20"},
            {"employee_id": "e8", "date": "2026-09-30", "check_in": "14:00", "check_out": "20:00"},
            {"employee_id": "e1", "date": "2026-09-30", "check_in": "12:00", "check_out": "20:30"},
        ]})
        self.assertEqual(status, 201)
        status, daily = self.request("/api/v1/attendance/day?date=2026-09-30")
        self.assertEqual(status, 200)
        rows = {item["employee_id"]: item for item in daily["employees"]}
        self.assertEqual((rows["e7"]["late_minutes"], rows["e7"]["overtime_minutes"]), (15, 45))
        self.assertEqual((rows["e6"]["late_minutes"], rows["e6"]["overtime_minutes"]), (10, 20))
        self.assertEqual((rows["e8"]["late_minutes"], rows["e8"]["overtime_minutes"]), (0, 0))
        self.assertEqual((rows["e1"]["late_minutes"], rows["e1"]["overtime_minutes"]), (0, 30))

    def test_monthly_calendar_counts_real_days_and_excludes_holidays(self):
        for month, days_in_month in ((9, 30), (10, 31)):
            expected = sum(
                date(2026, month, day).weekday() != 4
                for day in range(1, days_in_month + 1)
            )
            self.assertEqual(server.calendar_workdays_in_month(2026, month), expected)
        with server.connect_db() as connection:
            connection.execute(
                "INSERT INTO company_holidays(holiday_date, name) VALUES ('2026-10-05', 'عطلة اختبار')"
            )
        expected_october_workdays = sum(
            date(2026, 10, day).weekday() != 4 for day in range(1, 32)
        ) - 1
        self.assertEqual(server.calendar_workdays_in_month(2026, 10), expected_october_workdays)

    def test_attendance_sync_deduplication_payroll_and_approval_invalidation(self):
        status, _ = self.request("/api/v1/employees", authorized=False)
        self.assertEqual(status, 200)

        employees = self.request("/api/v1/employees")[1]["employees"]
        self.assertEqual(len(employees), 11)
        for employee in employees:
            status, _ = self.request(
                f"/api/v1/employees/{employee['id']}", "PATCH",
                {"hourly_wage": 100, "shift_hours": 8,
                 "shift_start": "09:00", "shift_end": "17:00",
                 **({"attendance_user_id": "FP-1"} if employee["id"] == "e1" else {})},
            )
            self.assertEqual(status, 200)

        workday = date.today().isoformat()
        logs = {"logs": [
            {"employee_id": "FP-1", "date": workday, "check_in": "09:15", "check_out": "18:00"},
        ]}
        status, first_sync = self.request("/api/v1/attendance/sync", "POST", logs)
        self.assertEqual(status, 201)
        self.assertEqual(first_sync["inserted"], 2)
        _, repeated_sync = self.request("/api/v1/attendance/sync", "POST", logs)
        self.assertEqual(repeated_sync["inserted"], 0)
        self.assertEqual(repeated_sync["duplicates"], 2)
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": f"{workday}T16:59:00",
            "status": "OVERTIME_APPROVED", "duration_minutes": 60,
        })
        self.assertEqual(status, 201)

        period = workday[:7]
        preview = server.payroll_preview(period)
        salma = next(item for item in preview["employees"] if item["id"] == "e1")
        self.assertEqual(salma["late_minutes"], 15)
        self.assertEqual(salma["regular_hours"], 7.75)
        self.assertEqual(salma["overtime_hours"], 1)
        self.assertEqual(salma["base_pay"], 775)
        self.assertEqual(salma["overtime_pay"], 150)
        self.assertEqual(salma["net_pay"], 925)

        status, _ = self.request("/api/v1/payroll/calculate", "POST", {"period": period})
        self.assertEqual(status, 201)
        status, report = self.request(f"/api/v1/payroll?month={period}")
        self.assertEqual(status, 200)
        self.assertEqual(len(report["payroll"]), 11)
        workbook_bytes = server.payroll_xlsx(period)
        with zipfile.ZipFile(io.BytesIO(workbook_bytes)) as workbook:
            self.assertIn("xl/worksheets/sheet1.xml", workbook.namelist())
            sheet = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")
            styles = workbook.read("xl/styles.xml").decode("utf-8")
            self.assertIn("MAK HILLS GROUP", sheet)
            self.assertIn("آية", sheet)
            self.assertIn("FFC69B4B", styles)
        status, _ = self.request("/api/v1/payroll/approve", "POST", {"period": period, "approved_by": "محمد مكي"})
        self.assertEqual(status, 201)

        status, attendance = self.request(
            f"/api/v1/attendance?day={workday}&employee_id=e1"
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            {log["status"] for log in attendance["logs"]},
            {"IN", "OUT", "OVERTIME_APPROVED"},
        )

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": f"{workday}T12:00:00",
            "status": "PERMISSION", "note": "اختبار إدخال يدوي",
        })
        self.assertEqual(status, 201)
        status, report = self.request(f"/api/v1/payroll?month={period}")
        self.assertIsNone(report["approved"])
        self.assertTrue(all(row["status"] == "draft" for row in report["payroll"]))
        self.assertEqual(len(report["payroll"]), 11)

    def test_manual_attendance_edit_refreshes_existing_payroll(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "hourly_wage": 100, "shift_hours": 8,
            "shift_start": "09:00", "shift_end": "17:00",
        })
        self.assertEqual(status, 200)

        workday = date.today().isoformat()
        period = workday[:7]
        status, _ = self.request("/api/v1/payroll/calculate", "POST", {"period": period})
        self.assertEqual(status, 201)
        for attendance_status, check_time in (("IN", "09:00"), ("OUT", "18:00")):
            status, _ = self.request("/api/v1/attendance/manual", "POST", {
                "employee_id": "e1", "check_time": f"{workday}T{check_time}:00",
                "status": attendance_status,
            })
            self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": f"{workday}T16:59:00",
            "status": "OVERTIME_APPROVED", "duration_minutes": 60,
        })
        self.assertEqual(status, 201)

        status, report = self.request(f"/api/v1/payroll?month={period}")
        self.assertEqual(status, 200)
        salma = next(row for row in report["payroll"] if row["employee_id"] == "e1")
        self.assertEqual(salma["overtime_hours"], 1)

        status, attendance = self.request(f"/api/v1/attendance?day={workday}&employee_id=e1")
        self.assertEqual(status, 200)
        manual_out = next(log for log in attendance["logs"] if log["status"] == "OUT")
        status, _ = self.request(
            f"/api/v1/attendance/manual/{manual_out['id']}", "PATCH",
            {"check_time": f"{workday}T17:00:00"},
        )
        self.assertEqual(status, 200)

        status, report = self.request(f"/api/v1/payroll?month={period}")
        self.assertEqual(status, 200)
        salma = next(row for row in report["payroll"] if row["employee_id"] == "e1")
        self.assertEqual(salma["regular_hours"], 8)
        self.assertEqual(salma["overtime_hours"], 0)
        self.assertEqual(salma["overtime_pay"], 0)

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": f"{workday}T12:00:00",
            "status": "PERMISSION", "duration_minutes": 20,
            "permission_type": "late", "permission_paid": True,
        })
        self.assertEqual(status, 201)
        status, attendance = self.request(f"/api/v1/attendance?day={workday}&employee_id=e1")
        permission = next(log for log in attendance["logs"] if log["status"] == "PERMISSION")
        status, _ = self.request(
            f"/api/v1/attendance/manual/{permission['id']}", "PATCH",
            {"duration_minutes": 25, "permission_type": "early", "permission_paid": False},
        )
        self.assertEqual(status, 200)
        status, attendance = self.request(f"/api/v1/attendance?day={workday}&employee_id=e1")
        permission = next(log for log in attendance["logs"] if log["status"] == "PERMISSION")
        self.assertEqual(permission["duration_minutes"], 25)
        self.assertEqual(permission["permission_type"], "early")
        self.assertEqual(permission["permission_paid"], 0)
        status, report = self.request(f"/api/v1/payroll?month={period}")
        salma = next(row for row in report["payroll"] if row["employee_id"] == "e1")
        self.assertAlmostEqual(salma["permission_deductions"], 41.67)

    def test_attendance_query_defaults_to_september_reporting_window(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {"start_date": "2026-09-01"})
        self.assertEqual(status, 200)
        for timestamp in ("2026-08-31T23:59:00", "2026-09-01T00:00:00"):
            status, _ = self.request("/api/attendance", "POST", {
                "employee_id": "e1", "check_time": timestamp, "status": "IN",
            })
            self.assertEqual(status, 201)

        status, report = self.request("/api/v1/attendance")
        self.assertEqual(status, 200)
        self.assertTrue(all(log["check_time"] >= "2026-09-01" for log in report["logs"]))
        self.assertIn("2026-09-01T00:00:00", [log["check_time"] for log in report["logs"]])
        status, report = self.request("/api/v1/attendance?day=2026-08-31")
        self.assertEqual(status, 200)
        self.assertEqual(report["logs"], [])

    def test_rapid_device_duplicates_shift_boundaries_and_manual_deduction(self):
        status, employee = self.request("/api/v1/employees", "POST", {
            "name": "October payroll test", "start_date": "2026-10-01",
            "hourly_wage": 100, "shift_hours": 8,
        })
        self.assertEqual(status, 201)
        employee_id = employee["employee"]["id"]
        self.assertEqual(employee["employee"]["shift_start"], "12:00")
        self.assertEqual(employee["employee"]["shift_end"], "20:00")

        logs = {"logs": [
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "12:15:00"},
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "12:15:40"},
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "12:16:20"},
            {"employee_id": employee_id, "date": "2026-10-01", "check_out": "21:00:00"},
            {"employee_id": employee_id, "date": "2026-10-01", "check_out": "21:00:59"},
        ]}
        status, result = self.request("/api/v1/attendance/sync", "POST", logs)
        self.assertEqual(status, 201)
        self.assertEqual(result["inserted"], 2)
        self.assertEqual(result["duplicates"], 3)

        status, result = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "12:17:19"},
        ]})
        self.assertEqual(status, 201)
        self.assertEqual(result["inserted"], 0)
        self.assertEqual(result["duplicates"], 1)
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": employee_id, "check_time": "2026-10-01T19:59:00",
            "status": "OVERTIME_APPROVED", "duration_minutes": 60,
        })
        self.assertEqual(status, 201)

        preview = server.payroll_preview("2026-10")
        payroll_employee = next(item for item in preview["employees"] if item["id"] == employee_id)
        self.assertEqual(payroll_employee["late_minutes"], 15)
        self.assertEqual(payroll_employee["regular_hours"], 7.75)
        self.assertEqual(payroll_employee["overtime_hours"], 1)

        status, _ = self.request("/api/v1/payroll/adjustments", "POST", {
            "employee_id": employee_id, "period": "2026-10", "kind": "deduction",
            "amount": 25, "note": "خصم يدوي تجريبي",
        })
        self.assertEqual(status, 201)
        preview = server.payroll_preview("2026-10")
        payroll_employee = next(item for item in preview["employees"] if item["id"] == employee_id)
        self.assertEqual(payroll_employee["other_deductions"], 25)
        self.assertEqual(payroll_employee["net_pay"], 900)
        status, _ = self.request("/api/v1/payroll/calculate", "POST", {"period": "2026-10"})
        self.assertEqual(status, 201)
        status, report = self.request("/api/v1/payroll?month=2026-10")
        self.assertEqual(status, 200)
        employee_report = next(item for item in report["payroll"] if item["employee_id"] == employee_id)
        self.assertTrue(any("جزاء مباشر: خصم يدوي تجريبي" in item["label"] for item in employee_report["deduction_reasons"]))

    def test_same_day_check_ins_keep_earliest_even_when_received_later(self):
        status, employee = self.request("/api/v1/employees", "POST", {
            "name": "Check-in deduplication test", "start_date": "2026-10-01",
        })
        self.assertEqual(status, 201)
        employee_id = employee["employee"]["id"]

        status, result = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "13:00:00"},
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "12:30:00"},
            {"employee_id": employee_id, "date": "2026-10-01", "check_out": "20:00:00"},
        ]})
        self.assertEqual(status, 201)
        self.assertEqual(result["inserted"], 2)
        self.assertEqual(result["duplicates"], 1)

        status, result = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "11:45:00"},
            {"employee_id": employee_id, "date": "2026-10-01", "check_in": "14:00:00"},
        ]})
        self.assertEqual(status, 201)
        self.assertEqual(result["inserted"], 1)
        self.assertEqual(result["duplicates"], 1)

        status, attendance = self.request(
            f"/api/v1/attendance?day=2026-10-01&employee_id={employee_id}&sort=asc"
        )
        self.assertEqual(status, 200)
        self.assertEqual(
            [(log["status"], log["check_time"]) for log in attendance["logs"]],
            [("IN", "2026-10-01T11:45:00"), ("OUT", "2026-10-01T20:00:00")],
        )

    def test_attendance_duration_pairs_biometric_and_manual_entries(self):
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-10-02", "check_in": "12:00:00"},
            {"employee_id": "e1", "date": "2026-10-02", "check_out": "20:00:00"},
        ]})
        self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e2", "check_time": "2026-10-02T12:15:00", "status": "IN",
        })
        self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e2", "check_time": "2026-10-02T20:05:30", "status": "OUT",
        })
        self.assertEqual(status, 201)

        _, report = self.request("/api/v1/attendance?day=2026-10-02")
        logs = report["logs"]
        _, ascending = self.request("/api/v1/attendance?day=2026-10-02&sort=asc")
        self.assertEqual(ascending["logs"][0]["check_time"], "2026-10-02T12:00:00")
        self.assertEqual(ascending["logs"][-1]["check_time"], "2026-10-02T20:05:30")
        _, descending = self.request("/api/v1/attendance?day=2026-10-02&sort=desc")
        self.assertEqual(descending["logs"][0]["check_time"], "2026-10-02T20:05:30")
        biometric_out = next(log for log in logs if log["user_id"] == "e1" and log["status"] == "OUT")
        manual_out = next(log for log in logs if log["user_id"] == "e2" and log["status"] == "OUT")
        manual_in = next(log for log in logs if log["user_id"] == "e2" and log["status"] == "IN")
        self.assertEqual(biometric_out["work_duration_seconds"], 8 * 60 * 60)
        self.assertEqual(manual_out["work_duration_seconds"], 7 * 60 * 60 + 50 * 60 + 30)
        self.assertEqual(manual_out["source"], "manual")
        self.assertIsNone(manual_in["work_duration_seconds"])

    def test_payroll_cannot_be_calculated_or_approved_without_shift_times(self):
        period = date.today().strftime("%Y-%m")
        for employee in self.request("/api/v1/employees")[1]["employees"]:
            status, _ = self.request(
                f"/api/v1/employees/{employee['id']}", "PATCH",
                {"shift_start": None, "shift_end": None},
            )
            self.assertEqual(status, 200)
        status, response = self.request("/api/v1/payroll/calculate", "POST", {"period": period})
        self.assertEqual(status, 400)
        self.assertIn("shift start and end", response["error"])
        status, response = self.request("/api/v1/payroll/approve", "POST", {
            "period": period, "approved_by": "محمد مكي",
        })
        self.assertEqual(status, 400)
        self.assertIn("shift start and end", response["error"])

    def test_payroll_approval_requires_configured_compensation(self):
        period = date.today().strftime("%Y-%m")
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {"hourly_wage": 100})
        self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/payroll/calculate", "POST", {"period": period})
        self.assertEqual(status, 201)
        status, response = self.request("/api/v1/payroll/approve", "POST", {
            "period": period, "approved_by": "محمد مكي",
        })
        self.assertEqual(status, 400)
        self.assertIn("hourly wage", response["error"])
        for employee in self.request("/api/v1/employees")[1]["employees"]:
            status, _ = self.request(
                f"/api/v1/employees/{employee['id']}", "PATCH",
                {"hourly_wage": 100, "start_date_verified": employee["id"] != "e1"},
            )
            self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/payroll/calculate", "POST", {"period": period})
        self.assertEqual(status, 201)
        status, response = self.request("/api/v1/payroll/approve", "POST", {
            "period": period, "approved_by": "محمد مكي",
        })
        self.assertEqual(status, 400)
        self.assertIn("Verify employment start dates", response["error"])

    def test_september_backfill_field_work_and_manual_edit(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "attendance_user_id": "FP-1", "hourly_wage": 100,
            "base_monthly_salary": 3000, "shift_hours": 8,
            "shift_start": "12:00", "shift_end": "20:00",
            "start_date": "2026-09-01",
        })
        self.assertEqual(status, 200)

        backfill = {"logs": [
            {"employee_id": "FP-1", "date": f"2026-09-{day:02d}",
             "check_in": "12:50", "check_out": "20:00"}
            for day in (6, 7, 8)
        ]}
        status, result = self.request("/api/v1/attendance/sync", "POST", backfill)
        self.assertEqual(status, 201)
        self.assertEqual(result["inserted"], 6)

        field_entry = {"employee_id": "e1", "check_time": "2026-09-09T12:45:00",
                       "status": "FIELD_IN", "note": "معاينة عقارية"}
        status, created = self.request("/api/v1/attendance/manual", "POST", field_entry)
        self.assertEqual(status, 201)
        field_exit = {**field_entry, "check_time": "2026-09-09T20:00:00", "status": "FIELD_OUT"}
        status, _ = self.request("/api/v1/attendance/manual", "POST", field_exit)
        self.assertEqual(status, 201)

        status, edited = self.request(f"/api/v1/attendance/manual/{created['id']}", "PATCH", {
            "check_time": "2026-09-10T12:05:00", "status": "FIELD_IN",
            "note": "تم تعديل وقت المعاينة",
        })
        self.assertEqual(status, 200)
        self.assertEqual(edited["log"]["check_time"], "2026-09-10T12:05:00")

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-10T20:00:00",
            "status": "OUT", "note": "انتهاء العمل الميداني",
        })
        self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-13T12:00:00",
            "status": "ABSENCE_UNEXCUSED", "note": "غياب دون عذر",
        })
        self.assertEqual(status, 201)

        status, report = self.request("/api/v1/payroll/calculate", "POST", {"period": "2026-09"})
        self.assertEqual(status, 201)
        employee = next(item for item in report["employees"] if item["id"] == "e1")
        daily_rate = 3000 / server.workdays_in_month(2026, 9, 4)
        expected_late_deduction = round(0.5 * daily_rate, 2)
        self.assertEqual(employee["late_minutes"], 150)
        self.assertEqual(employee["free_delay_minutes"], 0)
        self.assertEqual(employee["charged_delay_minutes"], 30)
        self.assertEqual(employee["deducted_days"], 0.5)
        self.assertEqual(employee["assumed_full_shift_days"], 0)
        self.assertEqual(employee["late_deduction"], expected_late_deduction)
        self.assertEqual(employee["absence_days"], 1)
        self.assertEqual(employee["absence_deduction"], round(2 * daily_rate * employee["absence_days"], 2))
        expected_net_pay = max(
            0,
            round(
                employee["base_pay"] + employee["overtime_pay"]
                - employee["late_deduction"] - employee["absence_deduction"]
                - employee["other_deductions"] - employee["permission_deductions"],
                2,
            ),
        )
        self.assertEqual(employee["net_pay"], expected_net_pay)

    def test_current_month_payroll_infers_absence_only_through_cutoff(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "hourly_wage": 100,
            "base_monthly_salary": 3000, "shift_hours": 8,
            "shift_start": "12:00", "shift_end": "20:00",
            "weekly_rest_day": 4,
        })
        self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-01", "check_in": "12:00", "check_out": "20:00"},
            {"employee_id": "e1", "date": "2026-09-11", "check_in": "12:00", "check_out": "20:00"},
        ]})
        self.assertEqual(status, 201)
        for day, status_name in ((2, "ABSENCE_EXCUSED"), (3, "ABSENCE_UNEXCUSED")):
            status, _ = self.request("/api/v1/attendance/manual", "POST", {
                "employee_id": "e1", "check_time": f"2026-09-{day:02d}T12:00:00",
                "status": status_name,
            })
            self.assertEqual(status, 201)
        for day, status_name in ((7, "PERMISSION"), (8, "IN")):
            status, _ = self.request("/api/v1/attendance/manual", "POST", {
                "employee_id": "e1", "check_time": f"2026-09-{day:02d}T12:00:00",
                "status": status_name,
            })
            self.assertEqual(status, 201)

        report = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 10), now=datetime(2026, 9, 10, 20, 1)
        )
        employee = next(item for item in report["employees"] if item["id"] == "e1")
        self.assertEqual(employee["days_present"], 1)
        self.assertEqual(employee["absence_days"], 6)
        self.assertEqual(employee["excused_absence_days"], 1)
        self.assertEqual(employee["absence_deduction"], round(6 * 2 * 3000 / 26, 2))

        before_shift_end = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 10), now=datetime(2026, 9, 10, 19, 59)
        )
        employee = next(item for item in before_shift_end["employees"] if item["id"] == "e1")
        self.assertEqual(employee["absence_days"], 5)

    def test_individual_summary_salary_and_attendance_override_api(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "weekly_rest_day": 4,
            "shift_hours": 8, "shift_start": "12:00", "shift_end": "20:00",
        })
        self.assertEqual(status, 200)

        status, salary = self.request("/api/employees/e1/salary", "PUT", {
            "monthly_salary": 5200,
        })
        self.assertEqual(status, 200)
        self.assertEqual(salary["rates"]["daily_rate"], 200)
        self.assertEqual(salary["rates"]["hourly_rate"], 25)

        for timestamp, status_name in (
            ("2026-09-01T12:00:00", "IN"),
            ("2026-09-01T20:00:00", "OUT"),
            ("2026-09-02T12:30:00", "IN"),
            ("2026-09-02T20:00:00", "OUT"),
        ):
            status, _ = self.request("/api/attendance", "POST", {
                "employee_id": "e1", "check_time": timestamp, "status": status_name,
            })
            self.assertEqual(status, 201)

        status, paid_permission = self.request("/api/attendance", "POST", {
            "employee_id": "e1", "check_time": "2026-09-02T11:30:00",
            "status": "PERMISSION", "permission_type": "late",
            "duration_hours": 0.5, "permission_paid": True, "reason": "إذن مدفوع",
        })
        self.assertEqual(status, 201)
        self.assertEqual(paid_permission["log"]["duration_minutes"], 30)
        self.assertEqual(paid_permission["log"]["permission_paid"], 1)

        status, _ = self.request("/api/attendance", "POST", {
            "employee_id": "e1", "check_time": "2026-09-03T12:00:00",
            "status": "PERMISSION", "permission_type": "early",
            "duration_hours": 1, "permission_paid": False, "reason": "إذن غير مدفوع",
        })
        self.assertEqual(status, 201)
        status, summary = self.request("/api/employees/e1/summary?as_of=2026-09-03")
        self.assertEqual(status, 200)
        self.assertEqual(summary["period"]["start"], "2026-09-01")
        self.assertEqual(summary["attendance"]["days_present"], 2)
        self.assertEqual(summary["attendance"]["workdays_elapsed"], 3)
        self.assertEqual(summary["attendance"]["attendance_rate"], 66.67)
        self.assertEqual(summary["attendance"]["punctuality_score"], 100)
        self.assertEqual(summary["attendance"]["absence_days"], 1)
        self.assertEqual(summary["attendance"]["permission_allowance"]["minutes_used"], 0)
        self.assertEqual(summary["attendance"]["permission_allowance"]["minutes_remaining"], 120)
        self.assertEqual(len(summary["attendance"]["permission_allowance"]["records"]), 2)
        self.assertTrue(any("غياب بدون عذر" in item["label"] for item in summary["pay"]["deduction_reasons"]))
        self.assertEqual(summary["pay"]["daily_rate"], 200)
        self.assertEqual(summary["pay"]["hourly_rate"], 25)
        self.assertEqual(summary["pay"]["unpaid_permission_deduction"], 25)
        self.assertEqual(summary["pay"]["current_entitlement"], 175)

        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-04", "check_in": "12:00"},
        ]})
        self.assertEqual(status, 201)
        status, report = self.request("/api/v1/attendance?day=2026-09-04&employee_id=e1")
        self.assertEqual(status, 200)
        biometric_log = report["logs"][0]
        status, edited = self.request(f"/api/attendance/{biometric_log['id']}", "PUT", {
            "check_time": "2026-09-04T11:55:00", "note": "تعديل المشرف",
        })
        self.assertEqual(status, 200)
        self.assertEqual(edited["log"]["source"], "manual")
        self.assertEqual(edited["log"]["note"], "تعديل المشرف")
        status, deleted = self.request(f"/api/attendance/{biometric_log['id']}", "DELETE")
        self.assertEqual(status, 200)
        self.assertEqual(deleted["deleted"], biometric_log["id"])

    def test_monthly_performance_ranking_and_leave_balances(self):
        status, updated = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2025-01-01", "birth_date": "1980-01-01",
            "weekly_rest_day": 4, "shift_start": "12:00", "shift_end": "20:00",
        })
        self.assertEqual(status, 200)
        self.assertEqual(updated["employee"]["birth_date"], "1980-01-01")

        status, response = self.request("/api/v1/employees/e1/leaves", "POST", {
            "leave_type": "casual", "start_date": "2026-09-14",
            "end_date": "2026-09-15", "note": "ظرف عائلي",
        })
        self.assertEqual(status, 201)
        self.assertEqual(response["leave"]["days"], 2)
        self.assertEqual(response["balance"]["annual_entitlement"], 21)
        self.assertEqual(response["balance"]["annual_remaining"], 19)
        self.assertEqual(response["balance"]["casual_remaining"], 5)

        status, error = self.request("/api/v1/employees/e1/leaves", "POST", {
            "leave_type": "casual", "start_date": "2026-09-17",
            "end_date": "2026-09-19",
        })
        self.assertEqual(status, 400)
        self.assertIn("two consecutive", error["error"])

        status, error = self.request("/api/v1/employees/e1/leaves", "POST", {
            "leave_type": "sick", "start_date": "2026-09-16", "end_date": "2026-09-16",
        })
        self.assertEqual(status, 400)
        self.assertIn("medical report", error["error"])
        status, sick_leave = self.request("/api/v1/employees/e1/leaves", "POST", {
            "leave_type": "sick", "start_date": "2026-09-16", "end_date": "2026-09-16",
            "medical_report_reference": "MED-2026-01",
        })
        self.assertEqual(status, 201)
        self.assertEqual(sick_leave["balance"]["sick_used"], 1)

        logs = []
        work_date = date(2026, 9, 1)
        while work_date <= min(date(2026, 9, 30), date.today()):
            if work_date.weekday() != 4 and work_date.isoformat() not in {
                "2026-09-15", "2026-09-16",
            }:
                logs.append({
                    "employee_id": "e1", "date": work_date.isoformat(),
                    "check_in": "12:00", "check_out": "20:00",
                })
            work_date += timedelta(days=1)
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": logs})
        self.assertEqual(status, 201)
        status, report = self.request("/api/v1/performance?month=2026-09")
        self.assertEqual(status, 200)
        self.assertEqual(report["employees"][0]["id"], "e1")
        self.assertEqual(report["employees"][0]["rating"], "الموظف المثالي", report["employees"][0])
        self.assertEqual(report["employees"][0]["performance_score"], 100)
        self.assertEqual(report["employees"][0]["absence_days"], 0)
        self.assertEqual(report["employees"][0]["days_present"], report["employees"][0]["workdays_elapsed"])
        self.assertEqual(report["employees"][0]["attendance_rate"], 100)
        self.assertEqual(report["employees"][0]["approved_leave_days"], 3)
        self.assertEqual(
            report["employees"][0]["ranking_breakdown"]["attendance"]["present_days"],
            report["employees"][0]["days_present"],
        )
        self.assertEqual(
            report["employees"][0]["performance_score"],
            report["employees"][0]["ranking_breakdown"]["attendance"]["points"]
            + report["employees"][0]["ranking_breakdown"]["punctuality"]["points"],
        )
        payroll = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 28), now=datetime(2026, 9, 28, 23, 0),
        )
        salma_pay = next(item for item in payroll["employees"] if item["id"] == "e1")
        self.assertEqual(salma_pay["days_present"], 21)
        self.assertEqual(salma_pay["paid_leave_days"], 3)
        self.assertEqual(salma_pay["regular_hours"], 168)
        self.assertEqual(salma_pay["paid_leave_hours"], 24)

        status, _ = self.request("/api/v1/employees/e1", "PATCH", {"birth_date": "1970-01-01"})
        self.assertEqual(status, 200)
        status, summary = self.request("/api/v1/employees/e1/summary?month=2026-09")
        self.assertEqual(status, 200)
        self.assertEqual(summary["leaves"]["annual_entitlement"], 30)
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {"disability": True})
        self.assertEqual(status, 200)
        status, summary = self.request("/api/v1/employees/e1/summary?month=2026-09")
        self.assertEqual(summary["leaves"]["annual_entitlement"], 45)

    def test_monthly_performance_does_not_rank_without_verified_workdays(self):
        period = date.today().strftime("%Y-%m")
        with server.connect_db() as connection:
            connection.execute(
                "UPDATE employees SET weekly_rest_day = ?", (date.today().weekday(),)
            )
        report = server.monthly_performance(period)
        self.assertTrue(report["employees"])
        for employee in report["employees"]:
            self.assertFalse(employee["score_available"])
            self.assertIsNone(employee["rank"])
            self.assertIsNone(employee["performance_score"])
            self.assertIsNone(employee["ranking_breakdown"]["attendance"]["points"])
            self.assertIsNone(employee["ranking_breakdown"]["punctuality"]["points"])
        summary = server.employee_summary(
            report["employees"][0]["id"], as_of=date.today(), month=period,
        )
        self.assertIsNone(summary["attendance"]["performance_score"])

    def test_attendance_query_respects_start_date_and_approved_leave(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-10", "hourly_wage": 100,
            "shift_start": "12:00", "shift_end": "20:00",
        })
        self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/employees/e1/leaves", "POST", {
            "leave_type": "annual", "start_date": "2026-09-10",
            "end_date": "2026-09-10", "note": "إجازة معتمدة للاختبار",
        })
        self.assertEqual(status, 201)

        status, synced = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-09", "check_in": "12:00", "check_out": "20:00"},
            {"employee_id": "e1", "date": "2026-09-10", "check_in": "12:00", "check_out": "20:00"},
        ]})
        self.assertEqual(status, 201)
        self.assertEqual(synced["ignored_before_start_date"], 2)
        self.assertEqual(synced["ignored_paid_leave_punches"], 2)

        status, before_start = self.request("/api/v1/attendance?day=2026-09-09&employee_id=e1")
        self.assertEqual(status, 200)
        self.assertEqual(before_start["logs"], [])
        status, manual = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-09T12:34:00", "status": "IN",
        })
        self.assertEqual(status, 201)
        status, before_start = self.request("/api/v1/attendance?day=2026-09-09&employee_id=e1")
        self.assertEqual(status, 200)
        self.assertEqual(len(before_start["logs"]), 1)
        self.assertEqual(before_start["logs"][0]["check_time"], "2026-09-09T12:34:00")
        self.assertTrue(before_start["logs"][0]["employment_conflict"])
        self.assertIsNone(before_start["logs"][0]["work_duration_seconds"])
        status, rejected = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-10T12:00:00", "status": "IN",
        })
        self.assertEqual(status, 409)
        self.assertIn("paid-leave day", rejected["error"])
        status, rejected_edit = self.request(f"/api/v1/attendance/{manual['id']}", "PUT", {
            "check_time": "2026-09-10T12:00:00",
        })
        self.assertEqual(status, 409)
        self.assertIn("paid-leave day", rejected_edit["error"])
        conflict_day = server.attendance_day_report(date(2026, 9, 9))
        salma = next(row for row in conflict_day["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "employment_conflict")
        self.assertEqual(salma["check_in"], "12:34:00")

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-12T13:00:00",
            "status": "PERMISSION", "duration_minutes": 30,
        })
        self.assertEqual(status, 201)
        permission_day = server.attendance_day_report(date(2026, 9, 12))
        salma = next(row for row in permission_day["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "permission")
        self.assertEqual(salma["reason"], "إذن مسجل")
        with server.connect_db() as connection:
            connection.executemany(
                """INSERT INTO attendance_logs(user_id, check_time, device_ip, status, source)
                   VALUES ('e1', ?, 'legacy-device', ?, 'device')""",
                (("2026-09-10T12:00:00", "IN"), ("2026-09-10T23:00:00", "OUT")),
            )
        status, leave_day = self.request("/api/v1/attendance?day=2026-09-10&employee_id=e1")
        self.assertEqual(status, 200)
        self.assertEqual(len(leave_day["logs"]), 2)
        self.assertTrue(all(log["leave_conflict"] for log in leave_day["logs"]))
        self.assertTrue(all(log["work_duration_seconds"] is None for log in leave_day["logs"]))
        status, leave_report = self.request("/api/v1/attendance/day?date=2026-09-10")
        self.assertEqual(status, 200)
        employee_report = next(row for row in leave_report["employees"] if row["employee_id"] == "e1")
        self.assertEqual(employee_report["status"], "paid_leave")
        self.assertIsNone(employee_report["check_in"])
        self.assertIsNone(employee_report["check_out"])
        self.assertEqual(employee_report["punches"], [])
        self.assertEqual(employee_report["ignored_leave_punch_count"], 2)

        summary = server.employee_summary(
            "e1", as_of=date(2026, 9, 10), now=datetime(2026, 9, 10, 23, 0), month="2026-09",
        )
        self.assertEqual(summary["attendance"]["days_present"], 0)
        self.assertEqual(summary["attendance"]["approved_leave_days"], 1)
        self.assertEqual(summary["attendance"]["paid_leave_hours"], 8)
        self.assertEqual(summary["pay"]["overtime_hours"], 0)
        self.assertEqual(summary["pay"]["accrued_base"], 800)

    def test_daily_and_monthly_attendance_reports_show_rest_leave_and_absence(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {"start_date": "2026-09-01"})
        self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/employees/e1/leaves", "POST", {
            "leave_type": "annual", "start_date": "2026-09-03",
            "end_date": "2026-09-03", "note": "إجازة سنوية معتمدة",
        })
        self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/holidays", "POST", {
            "date": "2026-09-07", "name": "عطلة رسمية",
        })
        self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-01", "check_in": "12:00", "check_out": "20:00"},
        ]})
        self.assertEqual(status, 201)

        status, friday = self.request("/api/v1/attendance/day?date=2026-09-04")
        self.assertEqual(status, 200)
        salma = next(row for row in friday["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "rest_day")
        self.assertEqual(salma["reason"], "يوم الجمعة (إجازة أسبوعية)")

        status, absence_day = self.request("/api/v1/attendance/day?date=2026-09-02")
        self.assertEqual(status, 200)
        salma = next(row for row in absence_day["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "absence")
        self.assertIn("غياب بدون إذن", salma["absence_reason"])

        status, leave_day = self.request("/api/v1/attendance/day?date=2026-09-03")
        self.assertEqual(status, 200)
        salma = next(row for row in leave_day["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "paid_leave")
        self.assertEqual(salma["reason"], "إجازة مدفوعة · إجازة سنوية معتمدة")

        status, holiday_day = self.request("/api/v1/attendance/day?date=2026-09-07")
        self.assertEqual(status, 200)
        salma = next(row for row in holiday_day["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "holiday")
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-02T12:00:00",
            "status": "ABSENCE_UNEXCUSED", "note": "غياب موثق",
        })
        self.assertEqual(status, 201)
        status, monthly = self.request("/api/v1/attendance/absences?month=2026-09")
        self.assertEqual(status, 200)
        self.assertEqual(monthly["workdays_in_month"], 25)
        self.assertEqual(monthly["summary"]["documented_days"], 1)
        self.assertIn("2026-09-02", [row["date"] for row in monthly["absences"]])
        self.assertNotIn("2026-09-08", [row["date"] for row in monthly["absences"]])
        self.assertNotIn("2026-09-03", [row["date"] for row in monthly["absences"]])
        status, performance = self.request("/api/v1/performance?month=2026-09")
        self.assertEqual(status, 200)
        self.assertEqual(performance["workdays_in_month"], 25)

    def test_daily_and_monthly_rest_day_logic(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01",
            "active": True,
            "weekly_rest_day": 4,
        })
        self.assertEqual(status, 200)
        self.assertEqual(server.workdays_in_month(2026, 9, 4), 26)
        self.assertEqual(server.workdays_in_month(2026, 9, 5), 22)
        status, friday = self.request("/api/v1/attendance/day?date=2026-09-04")
        self.assertEqual(status, 200)
        salma = next(row for row in friday["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "rest_day")
        self.assertEqual(salma["reason"], "يوم الجمعة (إجازة أسبوعية)")

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-02T12:00:00", "status": "IN",
        })
        self.assertEqual(status, 201)
        status, partial_day = self.request("/api/v1/attendance/day?date=2026-09-02")
        self.assertEqual(status, 200)
        salma = next(row for row in partial_day["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "continuous_day")
        self.assertEqual(salma["reason"], "لقد بصم حضور ولم يبصم انصراف")

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-02T20:00:00", "status": "OUT",
        })
        self.assertEqual(status, 201)
        status, complete_day = self.request("/api/v1/attendance/day?date=2026-09-02")
        self.assertEqual(status, 200)
        salma = next(row for row in complete_day["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "present")
        self.assertEqual(salma["reason"], "حاضر ومكتمل")

    def test_today_without_punches_is_incomplete_until_day_ends(self):
        today = date.today()
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": (today - timedelta(days=1)).isoformat(), "active": True,
        })
        self.assertEqual(status, 200)
        open_report = server.attendance_day_report(
            today, now=datetime.combine(today, server.time(15, 0)),
        )
        salma = next(row for row in open_report["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "incomplete_day")
        self.assertEqual(salma["reason"], "لم يبصم حضور حتى الآن، في انتظار تفعيل البصمة")
        for check_time in ("12:00:00", "12:05:00"):
            status, _ = self.request("/api/v1/attendance/manual", "POST", {
                "employee_id": "e1", "check_time": f"{today.isoformat()}T{check_time}",
                "status": "FIELD_IN" if check_time == "12:00:00" else "IN",
            })
            self.assertEqual(status, 201)
        attended_report = server.attendance_day_report(
            today, now=datetime.combine(today, server.time(15, 0)),
        )
        salma = next(row for row in attended_report["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "continuous_day")
        self.assertEqual(attended_report["present_employee_count"], 1)
        closed_report = server.attendance_day_report(
            today - timedelta(days=1),
            now=datetime.combine(today, server.time(0, 5)),
        )
        salma = next(row for row in closed_report["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "absence")

    def test_september_archive_is_read_only_and_stable(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "active": True,
        })
        self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-01T12:00:00", "status": "IN",
        })
        self.assertEqual(status, 201)
        status, archive = self.request("/api/v1/attendance/archive/2026-09")
        self.assertEqual(status, 200)
        self.assertTrue(archive["read_only"])
        self.assertEqual(archive["month"], "2026-09")
        self.assertTrue(archive["archived_at"])
        self.assertEqual(archive["days_in_month"], 30)
        self.assertEqual(archive["summary"]["attendance_days"], 1)
        self.assertEqual(archive["summary"]["employees"], 1)
        original_record_count = len(archive["daily_records"])

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-02T12:00:00", "status": "IN",
        })
        self.assertEqual(status, 201)
        status, unchanged = self.request("/api/v1/attendance/archive/2026-09")
        self.assertEqual(status, 200)
        self.assertEqual(len(unchanged["daily_records"]), original_record_count)
        self.assertEqual(unchanged["summary"]["attendance_days"], 1)
        status, _ = self.request("/api/v1/attendance/archive/2026-09", "POST", {})
        self.assertEqual(status, 404)

    def test_fieldwork_statuses_are_preserved_in_daily_report(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "active": True,
            "shift_start": "12:00", "shift_end": "20:00",
        })
        self.assertEqual(status, 200)
        for check_time, event_status in (
            ("2026-09-29T12:15:00", "FIELD_IN"),
            ("2026-09-29T20:30:00", "FIELD_OUT"),
        ):
            status, _ = self.request("/api/v1/attendance/manual", "POST", {
                "employee_id": "e1", "check_time": check_time,
                "status": event_status, "note": "مهمة ميدانية",
            })
            self.assertEqual(status, 201)
        status, report = self.request("/api/v1/attendance/day?date=2026-09-29")
        self.assertEqual(status, 200)
        salma = next(row for row in report["employees"] if row["employee_id"] == "e1")
        self.assertEqual(salma["status"], "present")
        self.assertTrue(salma["fieldwork_in"])
        self.assertTrue(salma["fieldwork_out"])
        self.assertIn("حضور ميداني", salma["reason"])
        self.assertIn("انصراف ميداني", salma["reason"])
        self.assertEqual((salma["late_minutes"], salma["overtime_minutes"]), (15, 30))

    def test_fixed_shift_actual_hours_and_prior_approved_overtime(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "hourly_wage": 100,
            "base_monthly_salary": 0, "shift_hours": 8,
            "shift_start": "12:00", "shift_end": "20:00", "weekly_rest_day": 4,
        })
        self.assertEqual(status, 200)
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-29", "check_in": "13:35", "check_out": "19:44"},
            {"employee_id": "e1", "date": "2026-09-30", "check_in": "12:00", "check_out": "21:30"},
        ]})
        self.assertEqual(status, 201)

        status, report = self.request("/api/v1/attendance/day?date=2026-09-29")
        self.assertEqual(status, 200)
        employee_day = next(row for row in report["employees"] if row["employee_id"] == "e1")
        self.assertEqual(employee_day["check_in"], "13:35:00")
        self.assertEqual(employee_day["check_out"], "19:44:00")
        self.assertEqual(employee_day["reason"], "حضور متأخر · انصراف مبكر")

        preview = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 30), now=datetime(2026, 9, 30, 21, 0),
        )
        employee = next(item for item in preview["employees"] if item["id"] == "e1")
        self.assertEqual(employee["late_minutes"], 95)
        self.assertEqual(employee["regular_hours"], 14.15)
        self.assertEqual(employee["overtime_hours"], 0)

        status, late_approval = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-30T20:01:00",
            "status": "OVERTIME_APPROVED", "duration_minutes": 60,
        })
        self.assertEqual(status, 400)
        status, no_limit = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-30T19:59:00",
            "status": "OVERTIME_APPROVED", "duration_minutes": 0,
        })
        self.assertEqual(status, 400)
        status, approval = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-30T19:59:00",
            "status": "OVERTIME_APPROVED", "duration_minutes": 60,
        })
        self.assertEqual(status, 201)
        self.assertEqual(approval["log"]["duration_minutes"], 60)

        preview = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 30), now=datetime(2026, 9, 30, 21, 0),
        )
        employee = next(item for item in preview["employees"] if item["id"] == "e1")
        self.assertEqual(employee["regular_hours"], 14.15)
        self.assertEqual(employee["overtime_hours"], 1)
        self.assertEqual(employee["overtime_pay"], 150)

    def test_late_checkin_and_early_checkout_statuses_are_persisted_and_counted(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "shift_start": "12:00",
            "shift_end": "20:00", "weekly_rest_day": 4,
        })
        self.assertEqual(status, 200)
        for check_time, punch_status in (
            ("2026-09-01T12:30:00", "LATE_IN_UNEXCUSED"),
            ("2026-09-01T19:00:00", "EXIT_PERMISSION"),
        ):
            status, created = self.request("/api/v1/attendance/manual", "POST", {
                "employee_id": "e1", "check_time": check_time, "status": punch_status,
            })
            self.assertEqual(status, 201)
            self.assertEqual(created["log"]["status"], punch_status)

        status, report = self.request("/api/v1/attendance/day?date=2026-09-01")
        self.assertEqual(status, 200)
        employee = next(row for row in report["employees"] if row["employee_id"] == "e1")
        self.assertEqual(employee["status"], "present")
        self.assertEqual(employee["check_in"], "12:30:00")
        self.assertEqual(employee["check_out"], "19:00:00")
        self.assertEqual(employee["reason"], "تأخير بدون عذر · إذن انصراف")

        summary = server.employee_summary(
            "e1", as_of=date(2026, 9, 1), now=datetime(2026, 9, 1, 21, 0), month="2026-09",
        )
        self.assertEqual(summary["attendance"]["days_present"], 1)
        self.assertEqual(summary["attendance"]["late_minutes"], 30)

    def test_calendar_holidays_and_employment_end_date_prorate_salary(self):
        self.assertEqual(server.workdays_in_month(2026, 9, 4), 26)
        self.assertEqual(server.workdays_in_month(2026, 9, 6), 22)
        self.assertEqual(server.workdays_in_month(2026, 10, 4), 26)
        self.assertEqual(server.workdays_in_month(2026, 2, 4), 24)
        self.assertEqual(server.workdays_in_month(2026, 12, 4), 27)
        status, holiday = self.request("/api/v1/holidays", "POST", {
            "date": "2026-09-07", "name": "عطلة رسمية اختبارية",
        })
        self.assertEqual(status, 201)
        self.assertEqual(holiday["working_days_in_month"], 25)

        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "end_date": "2026-09-27",
            "base_monthly_salary": 2600, "hourly_wage": 0,
            "shift_start": "12:00", "shift_end": "20:00",
        })
        self.assertEqual(status, 200)
        preview = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 28), now=datetime(2026, 9, 28, 23, 0)
        )
        employee = next(item for item in preview["employees"] if item["id"] == "e1")
        self.assertEqual(employee["base_pay"], 2288)
        status, summary = self.request("/api/v1/employees/e1/summary?month=2026-09")
        self.assertEqual(status, 200)
        self.assertEqual(summary["period"]["end"], "2026-09-27")
        self.assertEqual(summary["attendance"]["workdays_elapsed"], 22)
        self.assertEqual(summary["attendance"]["scheduled_workdays"], 22)
        self.assertEqual(summary["attendance"]["assumed_full_shift_days"], 0)
        status, sync_result = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-28", "check_in": "12:00", "check_out": "20:00"},
        ]})
        self.assertEqual(status, 201)
        self.assertEqual(sync_result["ignored_after_end_date"], 2)
        status, attendance = self.request("/api/v1/attendance?day=2026-09-28&employee_id=e1")
        self.assertEqual(status, 200)
        self.assertEqual(attendance["logs"], [])
        status, error = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-28T12:00:00", "status": "IN",
        })
        self.assertEqual(status, 400)
        self.assertIn("employee end date", error["error"])

    def test_split_shift_uses_actual_punch_intervals(self):
        status, created = self.request("/api/v1/employees", "POST", {
            "id": "split-shift", "name": "Split shift test",
            "start_date": "2026-10-01", "hourly_wage": 100,
            "shift_hours": 8, "shift_start": "09:00", "shift_end": "17:00",
            "weekly_rest_day": 4,
        })
        self.assertEqual(status, 201)
        for timestamp, status_name in (
            ("2026-10-01T09:00:00", "IN"),
            ("2026-10-01T12:00:00", "OUT"),
            ("2026-10-01T13:00:00", "IN"),
            ("2026-10-01T17:00:00", "OUT"),
        ):
            status, _ = self.request("/api/v1/attendance/manual", "POST", {
                "employee_id": "split-shift", "check_time": timestamp,
                "status": status_name,
            })
            self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e2", "date": "2026-10-01", "check_in": "12:00"},
        ]})
        self.assertEqual(status, 201)
        report = server.payroll_preview(
            "2026-10", as_of=date(2026, 9, 28), now=datetime(2026, 9, 28, 12, 0)
        )
        employee = next(item for item in report["employees"] if item["id"] == "split-shift")
        self.assertEqual(employee["regular_hours"], 7)
        self.assertEqual(employee["base_pay"], 700)

    def test_missing_punches_and_device_outages_never_create_virtual_work_hours(self):
        status, _ = self.request("/api/v1/employees/e1", "PATCH", {
            "start_date": "2026-09-01", "hourly_wage": 100,
            "base_monthly_salary": 0, "shift_hours": 8,
            "shift_start": "12:00", "shift_end": "20:00",
            "weekly_rest_day": 4,
        })
        self.assertEqual(status, 200)
        status, outage = self.request("/api/v1/attendance/outages", "POST", {
            "start_date": "2026-09-28", "end_date": "2026-09-28",
            "employee_id": "e1",
            "note": "انقطاع الجهاز الثاني",
        })
        self.assertEqual(status, 201)
        self.assertEqual(outage["outage"]["device_label"], "انقطاع الجهاز الثاني")

        status, _ = self.request("/api/v1/attendance/manual", "POST", {
            "employee_id": "e1", "check_time": "2026-09-24T12:00:00",
            "status": "ABSENCE_UNEXCUSED", "note": "تصحيح يدوي لليوم",
        })
        self.assertEqual(status, 201)
        status, _ = self.request("/api/v1/attendance/sync", "POST", {"logs": [
            {"employee_id": "e1", "date": "2026-09-27", "check_in": "12:00", "check_out": "20:00"},
        ]})
        self.assertEqual(status, 201)

        report = server.payroll_preview(
            "2026-09", as_of=date(2026, 9, 28), now=datetime(2026, 9, 28, 21, 0)
        )
        employee = next(item for item in report["employees"] if item["id"] == "e1")
        self.assertEqual(employee["assumed_full_shift_days"], 0)
        self.assertEqual(employee["days_present"], 1)
        self.assertEqual(employee["absence_days"], 23)
        self.assertEqual(employee["regular_hours"], 8)

class ZKTecoBridgeTests(unittest.TestCase):
    def test_punches_map_to_minimal_api_payload(self):
        timestamp = datetime(2026, 10, 1, 12, 15, 30)
        check_in = SimpleNamespace(user_id="FP-12", timestamp=timestamp, punch=0)
        check_out = SimpleNamespace(user_id="FP-12", timestamp=timestamp, punch=1)

        self.assertEqual(bridge.punch_direction(check_in.punch), "check_in")
        self.assertEqual(bridge.punch_direction(check_out.punch), "check_out")
        self.assertEqual(bridge.attendance_payload(check_in, "check_in"), {
            "employee_id": "FP-12", "date": "2026-10-01", "check_in": "12:15:30",
        })
        self.assertIsNone(bridge.punch_direction(7))

    def test_sync_window_skips_pre_october_records(self):
        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return {"received": 1, "inserted": 1, "duplicates": 0}

        class Session:
            def __init__(self):
                self.payloads = []

            def post(self, url, json, timeout):
                self.payloads.append(json)
                return Response()

        records = [
            SimpleNamespace(user_id="FP-12", timestamp=datetime(2026, 9, 26, 12), punch=0),
            SimpleNamespace(user_id="FP-12", timestamp=datetime(2026, 9, 27, 12), punch=0),
        ]
        session = Session()
        with tempfile.TemporaryDirectory() as temporary_directory:
            state_path = Path(temporary_directory) / "state.json"
            with patch.object(bridge, "STATE_PATH", state_path):
                sent = bridge.send_events(session, records, {"FP-12"}, set())

        self.assertEqual(sent, 1)
        self.assertEqual(session.payloads[0]["logs"], [{
            "employee_id": "FP-12", "date": "2026-09-27", "check_in": "12:00:00",
        }])


class LocalDevelopmentAccessTests(unittest.TestCase):
    def test_unauthenticated_employee_creation_is_loopback_only(self):
        self.assertTrue(server.request_is_authorized("127.0.0.1", None))
        self.assertFalse(server.request_is_authorized("127.0.0.1", None, "https://example.com"))
        self.assertFalse(server.request_is_authorized("192.0.2.10", "Bearer arbitrary-token"))
        self.assertTrue(server.request_is_authorized("192.0.2.10", f"Bearer {server.TOKEN}"))

        test_case = AttendancePayrollApiTests()
        test_case.setUp()
        try:
            status, employee = test_case.request("/api/v1/employees", "POST", {
                "name": "Local API test", "start_date": "2026-10-01",
            }, authorized=False)
            self.assertEqual(status, 201)
            self.assertEqual(employee["employee"]["name"], "Local API test")
        finally:
            test_case.tearDown()

    def test_production_never_bypasses_auth_for_loopback(self):
        with patch.object(server, "IS_PRODUCTION", True):
            self.assertFalse(server.request_is_authorized("127.0.0.1", None))
            self.assertFalse(server.request_is_authorized("::1", None, "http://localhost:8000"))
            self.assertFalse(server.request_is_authorized("127.0.0.1", "Bearer wrong-token"))
            self.assertTrue(server.request_is_authorized("127.0.0.1", f"Bearer {server.TOKEN}"))

    def test_cors_preflight_requires_an_explicit_origin_allowlist(self):
        test_case = AttendancePayrollApiTests()
        test_case.setUp()
        try:
            with patch.object(server, "CORS_ALLOWED_ORIGINS", {"https://dashboard.example"}):
                allowed_request = Request(
                    test_case.base_url + "/api/v1/employees",
                    headers={
                        "Origin": "https://dashboard.example",
                        "Access-Control-Request-Method": "GET",
                        "Access-Control-Request-Headers": "authorization",
                    },
                    method="OPTIONS",
                )
                with urlopen(allowed_request, timeout=3) as response:
                    self.assertEqual(response.status, 204)
                    self.assertEqual(response.headers["Access-Control-Allow-Origin"], "https://dashboard.example")
                    self.assertIn("Authorization", response.headers["Access-Control-Allow-Headers"])

                denied_request = Request(
                    test_case.base_url + "/api/v1/employees",
                    headers={"Origin": "https://attacker.example"},
                    method="OPTIONS",
                )
                with self.assertRaises(HTTPError) as error:
                    urlopen(denied_request, timeout=3)
                self.assertEqual(error.exception.code, 403)
        finally:
            test_case.tearDown()


if __name__ == "__main__":
    unittest.main()

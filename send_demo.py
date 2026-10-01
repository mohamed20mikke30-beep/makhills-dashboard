import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent.parent
SERVER = Path(__file__).resolve().parent / "server.py"
TOKEN = "isolated-demo-token"


def request(base_url, path, method="GET", payload=None, authorized=True):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if authorized:
        headers["Authorization"] = f"Bearer {TOKEN}"
    http_request = Request(base_url + path, data=data, headers=headers, method=method)
    with urlopen(http_request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]

    with tempfile.TemporaryDirectory(prefix="mak-hills-demo-") as temporary_directory:
        database_path = Path(temporary_directory) / "demo.sqlite3"
        environment = os.environ.copy()
        environment.update({
            "MAKHILLS_DB_PATH": str(database_path),
            "MAKHILLS_API_TOKEN": TOKEN,
            "MAKHILLS_HOST": "127.0.0.1",
            "MAKHILLS_PORT": str(port),
            "MAKHILLS_OVERTIME_MULTIPLIER": "1.5",
        })
        process = subprocess.Popen(
            [sys.executable, str(SERVER)], cwd=ROOT, env=environment,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        base_url = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 10
            while True:
                if process.poll() is not None:
                    raise RuntimeError("Demo API exited before becoming ready")
                try:
                    request(base_url, "/api/v1/health", authorized=False)
                    break
                except (URLError, TimeoutError):
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Timed out waiting for demo API")
                    time.sleep(0.1)

            employees = request(base_url, "/api/v1/employees")["employees"]
            for employee in employees:
                settings = {
                    "hourly_wage": 100 if employee["id"] == "e1" else 0,
                    "shift_hours": 8,
                    "shift_start": "09:00",
                    "shift_end": "17:00",
                }
                if employee["id"] == "e1":
                    settings["attendance_user_id"] = "FP-1"
                request(base_url, f"/api/v1/employees/{employee['id']}", "PATCH", settings)

            workday = date.today().isoformat()
            sample_logs = {"logs": [
                {"employee_id": "FP-1", "date": workday, "check_in": "09:15", "check_out": "18:00"},
            ]}
            first_sync = request(base_url, "/api/v1/attendance/sync", "POST", sample_logs)
            repeated_sync = request(base_url, "/api/v1/attendance/sync", "POST", sample_logs)
            period = datetime.now().strftime("%Y-%m")
            report = request(base_url, "/api/v1/payroll/calculate", "POST", {"period": period})
            employee_report = next(item for item in report["employees"] if item["id"] == "e1")
            print(json.dumps({
                "first_sync": first_sync,
                "repeated_sync": repeated_sync,
                "example_employee": {
                    "name": employee_report["name"],
                    "late_minutes": employee_report["late_minutes"],
                    "regular_hours": employee_report["regular_hours"],
                    "overtime_hours": employee_report["overtime_hours"],
                    "base_pay": employee_report["base_pay"],
                    "overtime_pay_at_1_5x": employee_report["overtime_pay"],
                    "net_pay": employee_report["net_pay"],
                },
                "database": "temporary; removed automatically after the demo",
            }, ensure_ascii=False, indent=2))
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == "__main__":
    main()

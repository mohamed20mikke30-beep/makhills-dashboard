# Mak Hills attendance and payroll

This Python 3 service provides a local dashboard and SQLite API. Normal mode seeds the 11 supplied employees with zero wages, an eight-hour shift from 12:00 to 20:00, and no attendance history. Friday is the weekly rest day. Biometric sync keeps only the earliest check-in per employee per day and collapses repeated check-outs less than 60 seconds apart; manual attendance records can be edited.

## Run locally

From the workspace root:

```powershell
python backend/server.py
```

Open `http://127.0.0.1:8000`. The dashboard and API use the same origin, and localhost opens directly without a login or password. The database is created at `backend/data/makhills.sqlite3`. Do not open `index.html` directly as a `file:` URL.

In development, the server listens on all network interfaces at port `8000`. API calls from loopback are passwordless; calls from another device require `Authorization: Bearer <MAKHILLS_API_TOKEN>`. To use a phone on the same trusted Wi-Fi network, set a strong `MAKHILLS_API_TOKEN`, find the computer's IPv4 address with `ipconfig`, and visit `http://<computer-ip>:8000`. Allow inbound TCP port `8000` through Windows Firewall only for trusted private networks.

Create a local environment file from `.env.example` with `Copy-Item .env.example .env`. `.env` is ignored by git. The server loads it at startup; variables already set by the shell or hosting platform take precedence.

## Cloud deployment (Render)

The repository includes `render.yaml` for a Render Blueprint. Connect the repository in Render and create the Blueprint. It builds with `pip install -r requirements.txt`, starts `backend/server.py`, uses the platform-provided `PORT`, and checks `/api/v1/health`. Render generates `MAKHILLS_API_TOKEN`; the production server refuses to start without a 32-character token. The API requires this bearer token for every data request, including requests originating from loopback.

The Blueprint mounts a persistent disk at `/var/data` and stores SQLite at `/var/data/makhills.sqlite3`. This is intentional: free ephemeral filesystems can discard the attendance database on restart. The persistent disk requires a paid Render service; do not change the database path to ephemeral storage for real employee records. Keep one service instance with SQLite, make regular database backups, and restrict dashboard access to trusted staff.

The mounted disk starts empty. Before sharing the deployment, securely copy and verify the intended company SQLite database at `/var/data/makhills.sqlite3` using Render's private shell or a trusted transfer process, then restart the service. Otherwise the app initializes a new database with the sample employee roster and no historical attendance. Never upload the database to a public repository or expose it through a public static path.

On first visit to the deployed dashboard, enter the generated API token from the Render service environment. The browser keeps it in session storage for that tab only; it is never embedded in the HTML or URL. If hosting the UI separately, set `MAKHILLS_CORS_ORIGINS` to a comma-separated list of exact HTTPS origins, for example `https://attendance.example.com`. Leave it empty for the included same-origin dashboard. Wildcard CORS is not supported. CORS is not authentication; keep the bearer token secret.

Supported settings include `MAKHILLS_ENV`, `MAKHILLS_API_TOKEN`, `MAKHILLS_DB_PATH`, `MAKHILLS_HOST`, `PORT` (or local `MAKHILLS_PORT`), `MAKHILLS_CORS_ORIGINS`, and `MAKHILLS_OVERTIME_MULTIPLIER`. Set `MAKHILLS_ENV=production` only with a strong secret and HTTPS origins. TLS is terminated by Render; use the generated HTTPS service URL.

## Windows desktop app

Double-click `start_desktop.bat` to open the dashboard in its own `pywebview` window. The launcher creates `.venv` with Python 3 if needed and installs `requirements.txt` when project dependencies are missing. The app starts the local server and biometric bridge and stops the processes it started when the window closes. Microsoft Edge WebView2 Runtime is required.

## ZKTeco K50 Pro bridge

Connect the computer running this project and the K50 Pro to the same trusted LAN. Give the device a reserved/static address of `192.168.1.247`, enable its TCP communication port `4370`, and make sure the computer can reach that port. Set each employee's fingerprint number in the dashboard's **رقم الموظف في البصمة** field; the device `user_id` must match this value exactly. Do not expose port 4370 or the local API directly to the public internet.

Install dependencies with `\.venv\Scripts\python.exe -m pip install -r requirements.txt` (or run `./start_all.ps1`, which installs them if needed). In PowerShell, start both services with `./start_all.ps1`. The script opens the server and bridge in separate processes. Set `MAKHILLS_API_TOKEN` in the same PowerShell session before starting if using a non-default token.

Before enabling live sync, run `\.venv\Scripts\python.exe bridge.py --once --dry-run`. It reads the device and prints mapped events but does not post attendance or save its cursor. Then run `\.venv\Scripts\python.exe bridge.py` to poll every 30 seconds. The bridge sends to `/api/v1/attendance/sync`, retries after failures, and stores successfully sent device-event keys in `.zkteco-bridge-state.json` to avoid reprocessing them after restart. The current default sync window begins on `2026-09-27`; set `ZK_SYNC_FROM=YYYY-MM-DD` to choose another lower bound.

The installed `pyzk` library exposes separate raw `punch` and `status` values but does not define K50 Pro check-in/check-out meanings. The bridge defaults to punch `0` = check-in and punch `1` = check-out. Confirm this using the device's test records before live use; if needed, set `ZK_CHECKIN_PUNCH` and `ZK_CHECKOUT_PUNCH` to the observed punch values. Other punch values are logged and skipped until mapped. Device address, port, password, poll interval, and API URL can be overridden with `ZK_DEVICE_IP`, `ZK_DEVICE_PORT`, `ZK_DEVICE_PASSWORD`, `ZK_POLL_SECONDS`, and `MAKHILLS_API_URL`.

## Demo mode

```powershell
$env:MAKHILLS_API_TOKEN = "choose-a-long-random-secret"
.\backend\run_demo.ps1
```

The demo seeds 10 fictitious employees, an entire month's weekday attendance with lateness and overtime, three sample adjustments, and saved draft payroll rows into `backend/data/makhills-demo.sqlite3`. It applies the same 120-minute monthly delay allowance and 1.5x overtime multiplier as normal mode. The normal company database is not touched. To reseed a different month, set `MAKHILLS_DEMO_PERIOD=YYYY-MM` before running the script.

## API
Requests from `127.0.0.1` or `::1` are always passwordless. Requests from other devices require `Authorization: Bearer <MAKHILLS_API_TOKEN>`.

- `GET /api/v1/health`
- `GET /api/v1/employees`
- `POST /api/v1/employees` and `PATCH /api/v1/employees/{id}` for employee setup, including `start_date` and optional `end_date`
- `DELETE /api/v1/employees/{id}` deactivates an employee and records an end date without deleting history
- `GET /api/v1/performance?month=2026-09` returns monthly attendance, punctuality, scores, and descending employee ranks
- `GET /api/v1/holidays`, `POST /api/v1/holidays` (`date`, `name`), and `DELETE /api/v1/holidays/{YYYY-MM-DD}` manage official holidays
- `GET /api/v1/attendance/outages`, `POST /api/v1/attendance/outages` (`start_date`, `end_date`, `note`, optional `employee_id`), and `DELETE /api/v1/attendance/outages/{id}` manage explicitly scoped device outages
- `GET /api/v1/attendance?day=2026-09-27&employee_id=e1&sort=asc` (`sort=desc` is the default)
- `POST /api/v1/attendance/manual` with `employee_id`, `check_time`, `status` (`IN`, `OUT`, `FIELD_IN`, `FIELD_OUT`, `PERMISSION`, `LEAVE`, `ABSENCE_EXCUSED`, or `ABSENCE_UNEXCUSED`), and optional `note`
- `PATCH /api/v1/attendance/manual/{id}` to edit a manual attendance record
- `POST /api/v1/attendance/sync` with `{"logs":[{"employee_id":"fingerprint-id","date":"2026-09-27","check_in":"12:00","check_out":"20:00"}]}`. The employee ID may be the employee ID or configured fingerprint ID; either check time may be omitted.
- `POST /api/v1/payroll/calculate` with `{"period":"2026-09"}` saves a monthly draft
- `GET /api/v1/payroll?month=2026-09` returns the saved draft or approval status
- `POST /api/v1/payroll/adjustments` with employee, period, `kind` (`deduction` or `permission`), amount, and note
- `POST /api/v1/payroll/approve` with period and approver name

Biometric day records are immediately matched to an employee and stored as IN/OUT punches; device IPs and vendor status codes are not required. Field-work manual punches (`FIELD_IN`/`FIELD_OUT`) count as attendance and exempt that day from late penalties. September 2026 and other past dates can be entered from the attendance date picker. The dashboard allows setting the hourly wage, shift length, and shift start/end. Payroll calculation and approval are blocked until every active employee has a shift start and end.

The standard shift is **12:00-20:00**: lateness is measured after noon and overtime starts after 20:00. Paired check-in/check-out intervals determine paid hours, excluding gaps between intervals. Calendar workdays are calculated for the exact month, employee weekly rest day, and registered official holidays; monthly salary is prorated by scheduled workdays within the employee's start/end dates. Every report, attendance query, and payroll calculation stops at the recorded end date.

Attendance hours are calculated only from recorded, paired punches; missing punches and device outages never create assumed shifts or work hours. Approved leave dates are excluded from absence and attendance-rate calculations. Punches received on an employee's scheduled leave day are ignored by sync, manual creation or edits on that day are rejected, and existing conflicting punches remain auditable without appearing as attendance or generating regular/overtime hours. Paid leave hours are credited separately from actual worked hours.

Overtime defaults to **1.5x** and can be changed with `MAKHILLS_OVERTIME_MULTIPLIER`. Each employee receives 120 minutes of combined monthly late/permission grace; every full 30 minutes beyond the allowance deducts half a day's rate, where the day rate uses that month's scheduled workdays. Each unexcused absence deducts two days. Actual regular hours are paid at the hourly wage when no monthly base salary is configured. Manual deductions and unpaid permissions can be entered as payroll adjustments.

## Demo and tests

```powershell
python backend/send_demo.py
python -m unittest backend.test_backend
```

The demo launches a temporary isolated API/database, sends a 09:15 arrival and 18:00 departure for a 09:00-17:00 shift at 100 EGP/hour, and prints the 1.5x overtime payroll result. It does not alter the real company database.

The production deployment uses one shared bearer token, not per-user accounts or role-based access. For multiple administrators, add identity management, access auditing, and a tested backup/restore process before treating this as a complete HR production system. Confirm the device's punch mapping and test with `--dry-run` before enabling automatic sync.
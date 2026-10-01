import argparse
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import server


PUNCHES = """
2026-09-01|11|13:21|20:26
2026-09-01|2|13:35|19:44
2026-09-01|10|13:07|18:12
2026-09-01|8|10:59|20:21
2026-09-02|11|12:27|20:02
2026-09-02|12|12:17|16:53
2026-09-02|6|12:07|18:09
2026-09-02|8|10:55|19:27
2026-09-02|7|12:18|19:59
2026-09-03|11|12:01|22:04
2026-09-03|12|14:53|20:48
2026-09-03|6|12:10|18:18
2026-09-03|10|12:30|20:12
2026-09-03|5|13:15|20:48
2026-09-03|7|12:02|20:31
2026-09-05|11|12:26|20:05
2026-09-05|12|12:24|19:52
2026-09-05|6|12:37|18:45
2026-09-05|10|12:45|20:11
2026-09-05|8|10:58|19:52
2026-09-05|5|12:48|19:52
2026-09-05|7|12:14|20:12
2026-09-06|11|12:58|20:12
2026-09-06|12|13:38|19:27
2026-09-06|6|12:23|18:24
2026-09-06|10|12:45|20:11
2026-09-06|8|10:54|19:12
2026-09-06|5|13:38|19:26
2026-09-06|7|12:34|19:57
2026-09-07|11|12:20|20:05
2026-09-07|12|13:50|19:36
2026-09-07|6|12:14|18:30
2026-09-07|10|13:17|20:03
2026-09-07|8|10:58|19:36
2026-09-07|5|13:21|19:35
2026-09-08|11|12:24|20:12
2026-09-08|12|13:52|19:48
2026-09-08|10|12:27|20:26
2026-09-08|8|10:54|19:07
2026-09-08|7|13:25|20:18
2026-09-09|11|13:03|20:01
2026-09-09|12|13:48|20:02
2026-09-09|6|12:24|18:36
2026-09-09|10|12:58|20:02
2026-09-09|8|10:55|20:01
2026-09-09|5|12:36|20:05
2026-09-09|7|12:11|20:00
2026-09-10|11|12:15|19:20
2026-09-10|12|13:31|19:26
2026-09-10|6|12:17|18:14
2026-09-10|10|12:31|19:07
2026-09-10|8|10:59|19:29
2026-09-10|5|11:59|18:14
2026-09-10|7|13:02|19:59
2026-09-12|11|12:08|20:04
2026-09-12|12|12:47|18:52
2026-09-12|6|12:03|18:19
2026-09-12|10|12:34|20:16
2026-09-12|8|10:55|20:03
2026-09-12|5|13:50|20:31
2026-09-12|7|12:16|20:06
2026-09-13|11|12:42|20:19
2026-09-13|12|13:40|19:31
2026-09-13|6|12:44|18:39
2026-09-13|10|12:46|20:15
2026-09-13|8|11:01|20:04
2026-09-13|5|12:37|17:44
2026-09-13|2|13:46|19:42
2026-09-13|7|12:15|20:25
2026-09-14|11|12:17|20:08
2026-09-14|12|14:00|20:04
2026-09-14|6|12:16|18:18
2026-09-14|10|12:17|20:43
2026-09-14|8|11:00|19:57
2026-09-14|2|14:26|22:46
2026-09-14|7|12:15|20:45
2026-09-15|11|12:39|20:11
2026-09-15|12|13:51|20:08
2026-09-15|6|12:27|18:35
2026-09-15|10|12:28|20:10
2026-09-15|8|11:04|19:17
2026-09-15|2|14:40|19:27
2026-09-15|7|-|20:02
2026-09-15|5|14:15|20:08
2026-09-16|11|12:27|20:00
2026-09-16|10|12:34|20:10
2026-09-16|8|11:03|19:24
2026-09-16|5|14:22|20:41
2026-09-17|11|12:01|20:22
2026-09-17|12|13:49|20:18
2026-09-17|6|12:09|18:56
2026-09-17|10|12:33|20:20
2026-09-17|8|10:59|20:13
2026-09-17|5|13:45|20:19
2026-09-17|7|-|20:20
2026-09-19|11|12:11|20:27
2026-09-19|12|12:55|18:52
2026-09-19|6|11:57|18:03
2026-09-19|10|12:52|20:47
2026-09-19|8|11:03|19:22
2026-09-19|2|13:58|19:34
2026-09-19|7|12:30|20:30
2026-09-20|11|12:23|20:07
2026-09-20|12|13:55|20:02
2026-09-20|6|12:25|18:40
2026-09-20|10|12:32|20:29
2026-09-20|8|11:04|-
2026-09-20|5|14:30|21:00
2026-09-20|2|12:39|19:53
2026-09-20|7|-|20:15
2026-09-21|11|12:05|20:09
2026-09-21|12|13:50|20:09
2026-09-21|6|12:09|18:07
2026-09-21|10|12:07|20:40
2026-09-21|8|-|20:09
2026-09-21|5|14:23|20:40
2026-09-22|11|12:04|20:01
2026-09-22|12|13:58|21:04
2026-09-22|6|12:03|18:16
2026-09-22|10|12:23|20:07
2026-09-22|8|11:03|19:31
2026-09-22|5|14:40|21:04
2026-09-22|2|12:11|20:02
2026-09-22|7|-|20:36
2026-09-22|13|12:26|17:54
2026-09-22|14|11:42|18:03
2026-09-23|11|15:05|20:34
2026-09-23|12|14:01|20:46
2026-09-23|10|12:11|22:11
2026-09-23|8|10:50|20:41
2026-09-23|5|14:36|20:52
2026-09-23|2|12:20|20:48
2026-09-23|13|12:23|20:32
2026-09-23|14|11:47|18:42
2026-09-23|15|20:34|20:34
2026-09-24|11|12:40|20:12
2026-09-24|12|13:56|19:11
2026-09-24|6|11:55|18:08
2026-09-24|10|12:14|19:16
2026-09-24|8|11:02|19:17
2026-09-24|2|13:35|20:00
2026-09-24|13|12:20|20:00
2026-09-24|14|13:09|20:22
2026-09-24|15|-|19:21
2026-09-26|11|12:14|20:20
2026-09-26|12|12:33|18:35
2026-09-26|6|12:16|18:36
2026-09-26|7|12:03|20:29
2026-09-26|10|10:53|20:21
2026-09-26|5|13:01|19:25
2026-09-26|13|12:17|18:52
2026-09-26|14|11:45|20:29
2026-09-26|15|11:49|18:19
2026-09-27|11|12:16|20:11
2026-09-27|12|13:55|20:30
2026-09-27|6|11:35|18:05
2026-09-27|7|12:21|20:03
2026-09-27|10|10:53|20:04
2026-09-27|5|14:10|20:52
2026-09-27|2|12:53|20:03
2026-09-27|13|12:45|23:32
2026-09-27|14|11:40|20:04
"""

FINGERPRINT_EMPLOYEES = {
    "2": "e10", "5": "e8", "6": "e6", "7": "e5", "8": "e1",
    "10": "e12", "11": "e3", "12": "e7", "13": "e9", "14": "e2", "15": "e4",
}
PERIOD_START = "2026-09-01"
PERIOD_LAST_INCLUDED = "2026-09-27"
IMPORT_DEVICE = "historical-import-2026-09"


def parse_punches():
    events = []
    for line_number, line in enumerate(PUNCHES.strip().splitlines(), start=1):
        work_date, user_id, check_in, check_out = line.split("|")
        for status, value in (("IN", check_in), ("OUT", check_out)):
            if value == "-":
                continue
            timestamp = datetime.fromisoformat(f"{work_date}T{value}:00")
            events.append((user_id, timestamp.isoformat(timespec="seconds"), status))
    if not events or len(events) != len(set(events)):
        raise ValueError("Import data is empty or contains duplicate punches")
    return events


def backup_database(database_path):
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = database_path.with_name(f"{database_path.stem}.before-september-import-{stamp}{database_path.suffix}")
    source = sqlite3.connect(database_path)
    target = sqlite3.connect(backup_path)
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    return backup_path


def import_attendance(database_path):
    database_path = Path(database_path)
    if not database_path.exists():
        raise FileNotFoundError(database_path)
    server.DB_PATH = database_path
    backup_path = backup_database(database_path)
    server.initialize_db()
    events = parse_punches()

    with server.connect_db() as connection:
        for user_id, employee_id in FINGERPRINT_EMPLOYEES.items():
            employee = connection.execute(
                "SELECT id, attendance_user_id FROM employees WHERE id = ? OR attendance_user_id = ?",
                (employee_id, user_id),
            ).fetchone()
            if user_id == "10" and not employee:
                connection.execute(
                    """INSERT INTO employees
                       (id, name, position, department, attendance_user_id, hourly_wage,
                        base_monthly_salary, shift_hours, shift_start, shift_end,
                        weekly_rest_day, start_date, start_date_verified, end_date, active)
                       VALUES ('e12', 'أميرة سالم', '', '', '10', 0, 0, 8,
                               '12:00', '20:00', 4, ?, 0, ?, 0)""",
                    (PERIOD_START, PERIOD_LAST_INCLUDED),
                )
                employee = connection.execute(
                    "SELECT id, attendance_user_id FROM employees WHERE id = 'e12'"
                ).fetchone()
            if not employee or employee["id"] != employee_id or employee["attendance_user_id"] != user_id:
                raise ValueError(f"Fingerprint {user_id} does not map to expected employee {employee_id}")
            connection.execute(
                """INSERT INTO payroll_period_overrides(employee_id, period, report_start)
                   VALUES (?, '2026-09', ?)
                   ON CONFLICT(employee_id, period) DO UPDATE SET report_start = excluded.report_start""",
                (employee_id, PERIOD_START),
            )
        connection.execute(
            "UPDATE employees SET start_date_verified = 0, end_date = ?, active = 0 WHERE attendance_user_id = '10'",
            (PERIOD_LAST_INCLUDED,),
        )
        connection.execute("UPDATE employees SET name = 'محمد مكي' WHERE id = 'e9'")
        connection.execute(
            """DELETE FROM attendance_logs WHERE source = 'device'
               AND check_time >= ? AND check_time < '2026-09-28'""",
            (PERIOD_START,),
        )
        connection.executemany(
            """INSERT INTO attendance_logs
               (user_id, check_time, device_ip, status, source, note)
               VALUES (?, ?, ?, ?, 'device', '')""",
            [(user_id, timestamp, IMPORT_DEVICE, status) for user_id, timestamp, status in events],
        )
        connection.execute("DELETE FROM payroll_approvals WHERE period = '2026-09'")
        connection.execute("UPDATE payroll SET status = 'draft' WHERE period = '2026-09'")

    server.refresh_existing_payroll("2026-09")
    with server.connect_db() as connection:
        imported_count = connection.execute(
            """SELECT COUNT(*) FROM attendance_logs WHERE device_ip = ?
               AND check_time >= ? AND check_time < '2026-09-28'""",
            (IMPORT_DEVICE, PERIOD_START),
        ).fetchone()[0]
    return {"backup": str(backup_path), "imported_punches": imported_count}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", type=Path, default=server.DB_PATH)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    events = parse_punches()
    if not args.apply:
        print(json.dumps({"mode": "dry-run", "punches": len(events), "database": str(args.database)}))
        return
    print(json.dumps(import_attendance(args.database), ensure_ascii=True))


if __name__ == "__main__":
    main()
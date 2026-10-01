import argparse
import json
import logging
import os
import sys
import time
from datetime import date, datetime
from pathlib import Path

import requests
from zk import ZK


ROOT = Path(__file__).resolve().parent
DEVICE_IP = os.environ.get("ZK_DEVICE_IP", "192.168.1.247")
DEVICE_PORT = int(os.environ.get("ZK_DEVICE_PORT", "4370"))
DEVICE_PASSWORD = int(os.environ.get("ZK_DEVICE_PASSWORD", "0"))
POLL_SECONDS = max(5, int(os.environ.get("ZK_POLL_SECONDS", "30")))
API_URL = os.environ.get("MAKHILLS_API_URL", "http://127.0.0.1:8000").rstrip("/")
API_TOKEN = os.environ.get("MAKHILLS_API_TOKEN", "dev-only-change-me")
CHECK_IN_PUNCH = os.environ.get("ZK_CHECKIN_PUNCH", "0").strip()
CHECK_OUT_PUNCH = os.environ.get("ZK_CHECKOUT_PUNCH", "1").strip()
SYNC_FROM = date.fromisoformat(os.environ.get("ZK_SYNC_FROM", "2026-09-27"))
STATE_PATH = Path(os.environ.get("ZK_BRIDGE_STATE", ROOT / ".zkteco-bridge-state.json"))
BATCH_SIZE = 1000


def punch_field(value):
    return str(value).strip()


def punch_direction(punch):
    value = punch_field(punch)
    if value == CHECK_IN_PUNCH:
        return "check_in"
    if value == CHECK_OUT_PUNCH:
        return "check_out"
    return None


def event_key(attendance):
    timestamp = attendance.timestamp
    if not isinstance(timestamp, datetime):
        raise ValueError("Device attendance timestamp is not a datetime")
    return "|".join((
        str(attendance.user_id).strip(),
        timestamp.isoformat(timespec="seconds"),
        punch_field(attendance.punch),
    ))


def attendance_payload(attendance, direction):
    timestamp = attendance.timestamp
    if not isinstance(timestamp, datetime):
        raise ValueError("Device attendance timestamp is not a datetime")
    return {
        "employee_id": str(attendance.user_id).strip(),
        "date": timestamp.date().isoformat(),
        direction: timestamp.time().replace(microsecond=0).isoformat(),
    }


def load_state():
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return set()
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Cannot read bridge state file {STATE_PATH}: {error}") from error
    events = data.get("sent_events", []) if isinstance(data, dict) else []
    return {str(value) for value in events}


def save_state(sent_events):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = STATE_PATH.with_suffix(STATE_PATH.suffix + ".tmp")
    temporary_path.write_text(
        json.dumps({"sent_events": sorted(sent_events)}, ensure_ascii=True, indent=2),
        encoding="utf-8",
    )
    temporary_path.replace(STATE_PATH)


def fetch_employee_ids(session):
    response = session.get(f"{API_URL}/api/v1/employees", timeout=10)
    response.raise_for_status()
    employees = response.json().get("employees", [])
    return {
        str(value).strip()
        for employee in employees
        for value in (employee.get("attendance_user_id"), employee.get("id"))
        if value not in (None, "")
    }


def read_device_attendance():
    zk = ZK(
        DEVICE_IP,
        port=DEVICE_PORT,
        timeout=10,
        password=DEVICE_PASSWORD,
        force_udp=False,
        ommit_ping=True,
        verbose=False,
    )
    device = zk.connect()
    try:
        return device.get_attendance()
    finally:
        device.disconnect()


def send_events(session, attendance_rows, known_employee_ids, sent_events, dry_run=False):
    pending = []
    pending_keys = []
    ignored_unknown_punches = set()
    ignored_unknown_employees = set()

    for attendance in attendance_rows:
        try:
            key = event_key(attendance)
        except ValueError as error:
            logging.warning("Skipping invalid device record: %s", error)
            continue
        if attendance.timestamp.date() < SYNC_FROM:
            continue
        if key in sent_events:
            continue
        employee_id = str(attendance.user_id).strip()
        if employee_id not in known_employee_ids:
            ignored_unknown_employees.add(employee_id)
            continue
        direction = punch_direction(attendance.punch)
        if direction is None:
            ignored_unknown_punches.add(punch_field(attendance.punch))
            continue
        pending.append(attendance_payload(attendance, direction))
        pending_keys.append(key)

    if ignored_unknown_employees:
        logging.warning("Fingerprint IDs are not configured for employees: %s", ", ".join(sorted(ignored_unknown_employees)))
    if ignored_unknown_punches:
        logging.warning(
            "Unmapped device punch values %s; configure ZK_CHECKIN_PUNCH and ZK_CHECKOUT_PUNCH",
            ", ".join(sorted(ignored_unknown_punches)),
        )
    if not pending:
        logging.info("No new mapped attendance records")
        return 0
    if dry_run:
        for payload in pending:
            logging.info("DRY RUN: %s", json.dumps(payload, ensure_ascii=False))
        return len(pending)

    accepted = 0
    for offset in range(0, len(pending), BATCH_SIZE):
        batch = pending[offset:offset + BATCH_SIZE]
        batch_keys = pending_keys[offset:offset + BATCH_SIZE]
        response = session.post(
            f"{API_URL}/api/v1/attendance/sync",
            json={"logs": batch},
            timeout=20,
        )
        response.raise_for_status()
        result = response.json()
        sent_events.update(batch_keys)
        save_state(sent_events)
        accepted += len(batch)
        logging.info(
            "API accepted %s device punches (%s inserted, %s duplicates)",
            result.get("received", len(batch)),
            result.get("inserted", "?"),
            result.get("duplicates", "?"),
        )
    return accepted


def poll_once(session, sent_events, dry_run=False):
    known_employee_ids = fetch_employee_ids(session)
    attendance_rows = read_device_attendance()
    logging.info("Read %s attendance records from %s:%s", len(attendance_rows), DEVICE_IP, DEVICE_PORT)
    return send_events(session, attendance_rows, known_employee_ids, sent_events, dry_run=dry_run)


def parse_args():
    parser = argparse.ArgumentParser(description="Poll a ZKTeco device and sync attendance to Mak Hills.")
    parser.add_argument("--once", action="store_true", help="Poll once instead of running continuously.")
    parser.add_argument("--dry-run", action="store_true", help="Read and map device events without posting or saving state.")
    return parser.parse_args()


def main():
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {API_TOKEN}"})
    sent_events = load_state()
    logging.info("ZKTeco bridge for %s:%s -> %s", DEVICE_IP, DEVICE_PORT, API_URL)

    while True:
        try:
            poll_once(session, sent_events, dry_run=args.dry_run)
        except KeyboardInterrupt:
            logging.info("Bridge stopped")
            return 0
        except (requests.RequestException, OSError, RuntimeError, ValueError) as error:
            logging.error("Sync cycle failed; will retry: %s", error)
            if args.once:
                return 1
        if args.once:
            return 0
        try:
            time.sleep(POLL_SECONDS)
        except KeyboardInterrupt:
            logging.info("Bridge stopped")
            return 0


if __name__ == "__main__":
    sys.exit(main())

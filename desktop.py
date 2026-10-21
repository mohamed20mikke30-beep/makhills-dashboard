import ctypes
import logging
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import webview
from dotenv import load_dotenv

from backend.local_config import configured_api_token, load_or_create_api_token


ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 8000
SERVER_URL = f"http://127.0.0.1:{PORT}"
HEALTH_URL = f"{SERVER_URL}/api/v1/health"
STARTUP_TIMEOUT = 30

children = []
children_lock = threading.Lock()


def start_process(script):
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = subprocess.Popen(
        [sys.executable, str(ROOT / script)],
        cwd=ROOT,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    with children_lock:
        children.append(process)
    return process


def server_is_ready():
    try:
        with urllib.request.urlopen(HEALTH_URL, timeout=1) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def server_has_password_login():
    try:
        with urllib.request.urlopen(SERVER_URL, timeout=3) as response:
            page = response.read().decode("utf-8")
    except (OSError, urllib.error.URLError):
        return False
    return 'id="login"' in page and 'id="employeesView"' not in page


def wait_for_server(process):
    deadline = time.monotonic() + STARTUP_TIMEOUT
    last_error = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"backend/server.py exited with code {process.returncode}")
        if server_is_ready():
            return
        last_error = "health endpoint is not responding"
        time.sleep(0.25)
    raise RuntimeError(f"The local server did not become ready: {last_error}")


def stop_processes():
    with children_lock:
        processes = list(reversed(children))
        children.clear()
    for process in processes:
        if process.poll() is not None:
            continue
        try:
            process.terminate()
            process.wait(timeout=5)
        except ProcessLookupError:
            continue
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def show_error(message):
    logging.exception("Desktop app failed")
    if os.name == "nt":
        ctypes.windll.user32.MessageBoxW(None, str(message), "Mak Hills", 0x10)
    else:
        print(message, file=sys.stderr)


def main():
    load_dotenv(ROOT / ".env", override=False)
    if os.environ.get("MAKHILLS_API_TOKEN") in {
        "replace-with-a-long-random-secret", "dev-only-change-me",
    }:
        os.environ.pop("MAKHILLS_API_TOKEN")
    if not os.environ.get("MAKHILLS_API_TOKEN"):
        configured_api_token()
    os.environ["MAKHILLS_HOST"] = HOST
    os.environ["MAKHILLS_PORT"] = str(PORT)
    os.environ["MAKHILLS_API_URL"] = SERVER_URL
    logging.basicConfig(
        filename=ROOT / "desktop.log",
        level=logging.ERROR,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    try:
        existing_server = server_is_ready()
        if not existing_server and not os.environ.get("MAKHILLS_API_TOKEN"):
            os.environ["MAKHILLS_API_TOKEN"] = load_or_create_api_token()
        if existing_server and not os.environ.get("MAKHILLS_API_TOKEN"):
            raise RuntimeError(
                "The existing server's biometric API token is unavailable. "
                "Stop the server and restart the desktop app, or set MAKHILLS_API_TOKEN in .env."
            )
        if not existing_server:
            server = start_process("backend/server.py")
            wait_for_server(server)
        if not server_has_password_login():
            raise RuntimeError(
                "The local server does not have the password-protected login screen. "
                "Stop the old server and restart the desktop app."
            )
        start_process("bridge.py")
        window = webview.create_window(
            "Mak Hills | إدارة الموظفين",
            SERVER_URL,
            width=1440,
            height=900,
            min_size=(900, 600),
        )
        window.events.closed += lambda: threading.Thread(
            target=stop_processes,
            daemon=True,
        ).start()
        webview.start(gui="edgechromium")
    except Exception as error:
        show_error(error)
        raise
    finally:
        stop_processes()


if __name__ == "__main__":
    main()
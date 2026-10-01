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
    os.environ["MAKHILLS_HOST"] = HOST
    os.environ["MAKHILLS_PORT"] = str(PORT)
    os.environ["MAKHILLS_API_URL"] = SERVER_URL
    logging.basicConfig(
        filename=ROOT / "desktop.log",
        level=logging.ERROR,
        format="%(asctime)s %(levelname)s %(message)s",
    )

    try:
        if not server_is_ready():
            server = start_process("backend/server.py")
            wait_for_server(server)
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
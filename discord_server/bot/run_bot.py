"""Launcher for the bot: starts it, and starts it again when the dashboard's Restart button asks.

    python run_bot.py [--open-dashboard] [--no-dialogs]

It creates the dashboard key once and hands it to the bot through the environment, so the
key survives restarts (an open dashboard tab keeps working) and is never written to disk.
Stop the bot with the dashboard's Stop button, or Ctrl+C here.
"""

import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BOT = HERE / "vaultulation_bot.py"
RESTART = 3  # exit code the bot uses to ask for a restart


def main(argv):
    env = dict(os.environ)
    env["VAULTULATION_DASHBOARD_KEY"] = secrets.token_urlsafe(24)
    env["VAULTULATION_SUPERVISED"] = "1"
    args = list(argv)
    while True:
        code = subprocess.call([sys.executable, str(BOT), *args], env=env, cwd=str(HERE))
        if code != RESTART:
            print(f"Bot stopped (exit code {code}).")
            return code
        print("Restarting the bot...")
        time.sleep(1)
        # The dashboard tab is already open and keeps the same key: don't open another one.
        args = [a for a in args if a != "--open-dashboard"]


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(0)

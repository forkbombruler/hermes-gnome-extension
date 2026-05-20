#!/usr/bin/env python3
"""Hermes cron job JSON reader."""
import json
from pathlib import Path

HERMES_HOME = Path.home() / ".hermes"
JOBS_PATH = HERMES_HOME / "cron" / "jobs.json"

def _summary(j):
    sched = j.get("schedule", {})
    origin = j.get("origin", {})
    return {
        "id": j.get("id", ""),
        "name": j.get("name", "Unnamed"),
        "state": j.get("state", "unknown"),
        "enabled": j.get("enabled", False),
        "schedule": sched.get("display", sched.get("expr", "—")),
        "next_run": (j.get("next_run_at") or "")[:16],
        "last_run": (j.get("last_run_at") or "")[:16],
        "last_status": j.get("last_status", "—"),
        "platform": origin.get("platform", "local"),
        "brief": (j.get("prompt", "") or "")[:80].replace("\n", " "),
    }

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 2 and sys.argv[1] == "--logs":
        # Log reading is done in JS now, but keep CLI compat
        print("(use GNOME extension to view logs)")
    else:
        jobs = []
        if JOBS_PATH.exists():
            try:
                data = json.loads(JOBS_PATH.read_text())
                jobs = [_summary(j) for j in data.get("jobs", [])]
            except Exception:
                pass
        print(json.dumps({"jobs": jobs}, ensure_ascii=False))

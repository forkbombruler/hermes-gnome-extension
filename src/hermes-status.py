#!/usr/bin/env python3
"""Hermes Monitor data provider — outputs JSON of all cron jobs and running tasks.

Usage:
  hermes-status.py              # full status JSON
  hermes-status.py --logs <id>  # recent logs for a specific job (last 50 lines)
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
CRON_JOBS_PATH = HERMES_HOME / "cron" / "jobs.json"
CRON_OUTPUT_DIR = HERMES_HOME / "cron" / "output"
MAX_LOG_LINES = 60


def _iso_to_local(iso_str: str) -> str:
    """Convert ISO 8601 string to local time display."""
    if not iso_str:
        return "—"
    try:
        dt = datetime.fromisoformat(iso_str)
        return dt.strftime("%m-%d %H:%M")
    except (ValueError, TypeError):
        return iso_str[:16] if len(iso_str) >= 16 else iso_str


def _status_icon(state: str, enabled: bool) -> str:
    """Return an icon label for the job state."""
    if not enabled:
        return "⏸"  # paused
    state_map = {
        "scheduled": "⏳",
        "running": "🔄",
        "completed": "✅",
        "failed": "❌",
        "timed_out": "⏰",
    }
    return state_map.get(state, "❓")


def _job_summary(job: dict) -> dict:
    """Extract a compact summary from a full job dict."""
    sched = job.get("schedule", {})
    repeat = job.get("repeat", {})
    origin = job.get("origin") or {}

    return {
        "id": job.get("id", ""),
        "name": job.get("name", "Unnamed"),
        "state": job.get("state", "unknown"),
        "enabled": job.get("enabled", False),
        "icon": _status_icon(job.get("state", ""), job.get("enabled", False)),
        "schedule": sched.get("display", sched.get("expr", "—")),
        "next_run": _iso_to_local(job.get("next_run_at", "")),
        "last_run": _iso_to_local(job.get("last_run_at", "")),
        "last_status": job.get("last_status", "—"),
        "platform": origin.get("platform", "local"),
        "brief": job.get("prompt", "")[:80].replace("\n", " "),
    }


def get_all_jobs() -> list[dict]:
    """Return all cron jobs as compact summaries."""
    if not CRON_JOBS_PATH.exists():
        return []
    try:
        data = json.loads(CRON_JOBS_PATH.read_text())
        jobs = data.get("jobs", [])
        return [_job_summary(j) for j in jobs]
    except (json.JSONDecodeError, OSError):
        return []


def get_job_logs(job_id: str) -> str:
    """Return recent log lines for a specific job."""
    log_dir = CRON_OUTPUT_DIR / job_id
    if not log_dir.exists():
        return "(没有日志)"

    files = sorted(log_dir.glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not files:
        return "(日志为空)"

    lines = []
    for f in files[:3]:  # Last 3 log files
        try:
            content = f.read_text(errors="replace")
            lines.extend(content.splitlines())
        except OSError:
            continue

    recent = lines[-MAX_LOG_LINES:]
    return "\n".join(recent) if recent else "(日志为空)"


# ── CLI entry point ────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--logs":
        print(get_job_logs(sys.argv[2]))
    else:
        output = {
            "jobs": get_all_jobs(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        print(json.dumps(output, ensure_ascii=False))

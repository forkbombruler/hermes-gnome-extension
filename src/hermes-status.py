#!/usr/bin/env python3
"""Hermes Monitor data provider — outputs JSON for GNOME extension.

Reads cron jobs + session stats from Hermes Agent's data files.
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

HERMES_HOME = Path.home() / ".hermes"
JOBS_PATH = HERMES_HOME / "cron" / "jobs.json"
STATE_DB = HERMES_HOME / "state.db"


def _iso_fmt(ts: float | None) -> str:
    if not ts:
        return "—"
    return datetime.fromtimestamp(ts).strftime("%m-%d %H:%M")


# ── Cron jobs ──────────────────────────────────────────────────────────

def _status_icon(state: str, enabled: bool) -> str:
    if not enabled:
        return "⏸"
    return {"scheduled": "⏳", "running": "🔄", "completed": "✅",
            "failed": "❌", "timed_out": "⏰"}.get(state, "❓")


def get_jobs() -> list[dict]:
    if not JOBS_PATH.exists():
        return []
    try:
        data = json.loads(JOBS_PATH.read_text())
    except Exception:
        return []
    out = []
    for j in data.get("jobs", []):
        sched = j.get("schedule", {})
        origin = j.get("origin", {})
        out.append({
            "id": j.get("id", ""),
            "name": j.get("name", "Unnamed"),
            "state": j.get("state", "unknown"),
            "enabled": j.get("enabled", False),
            "icon": _status_icon(j.get("state", ""), j.get("enabled", False)),
            "schedule": sched.get("display", sched.get("expr", "—")),
            "next_run": (j.get("next_run_at") or "")[:16],
            "platform": origin.get("platform", "local"),
            "brief": (j.get("prompt", "") or "")[:80].replace("\n", " "),
        })
    return out


# ── Session stats ──────────────────────────────────────────────────────

def _agent_status() -> str:
    """Check if Hermes Agent is currently working (processing a request)."""
    state_file = HERMES_HOME / "gateway_state.json"
    if not state_file.exists():
        return "idle"
    try:
        data = json.loads(state_file.read_text())
        return "working" if data.get("active_agents", 0) > 0 else "idle"
    except Exception:
        return "idle"


def get_usage() -> dict:
    """Aggregate usage across all sessions."""
    if not STATE_DB.exists():
        return {"total_sessions": 0, "total_messages": 0,
                "input_tokens": 0, "output_tokens": 0, "cost_usd": 0}

    db = sqlite3.connect(str(STATE_DB))
    db.row_factory = sqlite3.Row
    row = db.execute("""
        SELECT COUNT(*) AS total_sessions,
               COALESCE(SUM(message_count), 0) AS total_messages,
               COALESCE(SUM(input_tokens), 0) AS input_tokens,
               COALESCE(SUM(output_tokens), 0) AS output_tokens,
               COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
               COALESCE(SUM(estimated_cost_usd), 0) AS cost_usd,
               COALESCE(SUM(api_call_count), 0) AS api_calls,
               COALESCE(SUM(tool_call_count), 0) AS tool_calls
        FROM sessions
    """).fetchone()
    db.close()
    return {
        "total_sessions": row["total_sessions"],
        "total_messages": row["total_messages"],
        "input_tokens": row["input_tokens"],
        "output_tokens": row["output_tokens"],
        "cache_read_tokens": row["cache_read_tokens"],
        "cost_usd": round(row["cost_usd"], 4),
        "api_calls": row["api_calls"],
        "tool_calls": row["tool_calls"],
    }


def get_sessions(limit: int = 10) -> list[dict]:
    """Recent sessions with model + cost info."""
    if not STATE_DB.exists():
        return []

    db = sqlite3.connect(str(STATE_DB))
    db.row_factory = sqlite3.Row
    rows = db.execute("""
        SELECT id, title, source, model, message_count, tool_call_count,
               input_tokens, output_tokens, estimated_cost_usd,
               started_at, ended_at
        FROM sessions
        ORDER BY started_at DESC
        LIMIT ?
    """, (limit,)).fetchall()
    db.close()

    return [{
        "id": r["id"],
        "title": r["title"] or "Untitled",
        "source": r["source"] or "—",
        "model": r["model"] or "—",
        "messages": r["message_count"] or 0,
        "tool_calls": r["tool_call_count"] or 0,
        "input_tokens": r["input_tokens"] or 0,
        "output_tokens": r["output_tokens"] or 0,
        "cost_usd": round(r["estimated_cost_usd"] or 0, 4),
        "started": _iso_fmt(r["started_at"]),
        "ended": _iso_fmt(r["ended_at"]),
    } for r in rows]


# ── CLI ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--usage":
        print(json.dumps(get_usage(), ensure_ascii=False))
    elif len(sys.argv) > 1 and sys.argv[1] == "--sessions":
        limit = int(sys.argv[2]) if len(sys.argv) > 2 else 10
        print(json.dumps(get_sessions(limit), ensure_ascii=False))
    else:
        output = {
            "jobs": get_jobs(),
            "usage": get_usage(),
            "sessions": get_sessions(10),
            "agent_status": _agent_status(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        print(json.dumps(output, ensure_ascii=False))

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A GNOME Shell extension (UUID: `hermes-monitor@leo`) that displays a panel indicator with a dropdown menu showing Hermes Agent monitoring data — usage stats, recent sessions, and cron job status. Targets GNOME Shell 45–50.

## Commands

```bash
make install       # Install extension to ~/.local/share/gnome-shell/extensions/
make uninstall     # Remove extension
make pack          # Create .shell-extension.zip for distribution
make test          # Validate the data provider Python script outputs valid JSON
make clean         # Remove build artifacts
```

After `make install`, restart GNOME Shell: `Alt+F2` → `r` → Enter (X11), or log out and back in (Wayland).

## Architecture

### Data flow

```
~/.hermes/
  ├── cron/jobs.json     ← Hermes Agent cron definitions
  ├── state.db           ← SQLite DB with sessions table
  └── agent_status.json  ← written by Hermes agent-status hook

        ↓  (Python reads files)

src/hermes-status.py     ← single unified data provider

        ↓  (Gio.Subprocess calls `python3 src/hermes-status.py`)

extension.js             ← parses JSON, renders menu with incremental DOM updates
```

### extension.js — main extension (600 lines)

- **`HermesMenuButton`** — a `PanelMenu.Button` subclass (GObject-registered). The entire extension lives in this class.
- **Menu sections**: Three collapsible sections — Usage, Sessions, Cron Jobs. Each has a clickable header that toggles visibility (`_toggleSection` / `_applySectionVisibility`). Section state is tracked in `this._sections`.
- **Incremental rendering**: `_updateSessionsSection` and `_updateJobsSection` diff against `this._sessionRows` / `this._jobRows` maps keyed by ID. Items no longer present are destroyed; new items are created; existing items are updated in-place via direct label property mutation.
- **Data refresh**: `_refreshAllData()` spawns `python3 src/hermes-status.py` via `Gio.Subprocess` on each timer tick and on menu open. The script returns a single JSON object with `{jobs, usage, sessions, agent_status, updated_at}`.
- **Timer**: Uses `GLib.timeout_add_seconds` with the interval from GSettings (`refresh-interval`). Timer is destroyed and re-created on setting change.
- **Position**: The panel indicator supports left/center/right placement (GSettings `position-in-panel`). Reparenting is done by removing from current panel box and inserting into the target one.
- **Entry point**: `HermesExtension` (default export) calls `enable()` / `disable()` — creates/destroys the singleton `HermesMenuButton`.

### prefs.js — preferences window

Uses `Adw.PreferencesPage` + `Adw.PreferencesGroup` with `Adw.SpinRow` (refresh interval, 5–600s) and `Adw.ComboRow` (panel position). Direct `set_int` calls on change — no apply button pattern.

### src/hermes-status.py — data provider

- Reads `~/.hermes/cron/jobs.json` for cron job definitions
- Reads `~/.hermes/state.db` (SQLite) for aggregated usage stats and recent sessions
- Reads `~/.hermes/agent_status.json` for real-time agent status
- Outputs a single JSON object to stdout when called with no arguments
- Supports `--usage` and `--sessions [limit]` flags for targeted queries
- Expected columns in `sessions` table: `id, title, source, model, message_count, tool_call_count, input_tokens, output_tokens, cache_read_tokens, estimated_cost_usd, api_call_count, started_at, ended_at`

### GSettings schema

Three keys at `org.gnome.shell.extensions.hermes-monitor`:

| Key | Type | Default | Range |
|-----|------|---------|-------|
| `refresh-interval` | int | 30 | 5–600 |
| `position-in-panel` | int | 2 (left) | 0=right, 1=center, 2=left |
| `hermes-home` | string | `~/.hermes` | — |

The `hermes-home` setting is only used by `extension.js` for resolving the script path; the Python script hardcodes `~/.hermes`.

## Key conventions

- **GNOME 50 Subprocess API**: Uses `Gio.Subprocess.new(...)` + `.communicate(null, null)` (not `GLib.spawn_command_line_sync`). This is the GNOME 45+ compatible pattern.
- **Widget lifecycle**: The extension creates rows lazily and caches them by ID. On data change, existing widgets are mutated (label text swapped) rather than rebuilt. Stale rows are `.destroy()`'d.
- **No translations yet**: `gettext` / `_()` is wired throughout but `locale/` is empty.
- **Styling**: Catppuccin-inspired dark theme colors in `stylesheet.css`. CSS class names follow the `hermes-*` namespace convention.

# Hermes Monitor — GNOME Shell Extension

🐺 A full monitoring dashboard for [Hermes Agent](https://github.com/nousresearch/hermes-agent) right in your GNOME top panel. One click to see usage stats, recent sessions, and cron job status.

![screenshot](screenshots/panel.png)

## Features

- **📊 Usage panel** — aggregate stats: total sessions, messages, tokens (in/out/cache), and estimated cost
- **📋 Session list** — recent sessions with model, message count, tool calls, and cost
- **⏰ Cron jobs** — all scheduled jobs with status icons, schedule badges, and next-run times
- **Running job badge** — panel indicator shows `⚡N` when jobs are actively running
- **Auto-refresh** — configurable polling interval (default 30 seconds)
- **In-place updates** — no full-menu rebuilds; smooth, efficient rendering

## Requirements

- GNOME Shell 45–50
- **Hermes Agent** v0.14+ with `state.db` (for session/token stats)
- Python 3.10+

## Install

```bash
# Clone and install
git clone https://github.com/forkbombruler/hermes-gnome-extension.git
cd hermes-gnome-extension
make install

# Or manually
cp -r . ~/.local/share/gnome-shell/extensions/hermes-monitor@leo/
gnome-extensions enable hermes-monitor@leo
```

Then restart GNOME Shell (log out and back in, or `Alt+F2` → `r` on X11).

## Settings

Open **GNOME Settings → Extensions → Hermes Monitor** to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Refresh interval | 30 s | How often to poll Hermes for updates |
| Hermes home | `~/.hermes` | Path to Hermes config directory |
| Panel position | right | Where to place the indicator (left/center/right) |

## How it works

The extension calls `src/hermes-status.py` (via `GLib.spawn_command_line_sync`) which reads:

| Data source | File | Contents |
|------------|------|----------|
| Cron jobs | `~/.hermes/cron/jobs.json` | Job definitions, schedules, states |
| Usage & sessions | `~/.hermes/state.db` | Aggregated token counts, cost, recent sessions |

All data is returned as a single unified JSON object and rendered incrementally — only changed rows are updated.

## Project Structure

```
hermes-gnome-extension/
├── extension.js          # Main extension logic (562 lines, GNOME 50 compatible)
├── prefs.js              # GNOME Settings preferences
├── metadata.json         # Extension metadata
├── stylesheet.css        # Panel, menu, and section theming
├── schemas/              # GSettings schema
├── src/hermes-status.py  # Unified data provider (jobs + usage + sessions)
├── icons/                # Extension icons
└── locale/               # Translations (TODO)
```

## License

MIT — see [LICENSE](LICENSE)

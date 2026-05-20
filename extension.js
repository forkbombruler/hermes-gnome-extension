/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
/**
 * Hermes Monitor — GNOME Shell Extension
 *
 * Panel indicator that shows Hermes Agent cron jobs and
 * provides one-click access to real-time execution logs.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

// ── Data provider path ──────────────────────────────────────────────

/** Full path to the Hermes status script (Python). */
function _statusScript() {
    let me = Extension.lookupByUUID('hermes-monitor@leo');
    return GLib.build_filenamev([me.path, 'src', 'hermes-status.py']);
}

// ── Async script runner ─────────────────────────────────────────────

function _callScript(args, callback) {
    try {
        let proc = Gio.Subprocess.new(
            ['python3', _statusScript()].concat(args || []),
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
        );
        proc.communicate_utf8_async(null, null, (_proc, result) => {
            let [, stdout, stderr] = _proc.communicate_utf8_finish(result);
            if (_proc.get_successful()) {
                callback(stdout, null);
            } else {
                callback(null, stderr || String(_proc.get_exit_status()));
            }
        });
    } catch (e) {
        callback(null, e.message);
    }
}

// ── Log viewer dialog ───────────────────────────────────────────────

function _showLogDialog(jobId, jobName) {
    let dialog = new St.BoxLayout({
        vertical: true,
        style_class: 'hermes-log-dialog',
        x_expand: true,
    });

    // Header bar
    let header = new St.BoxLayout({style_class: 'hermes-log-header'});
    let title = new St.Label({text: _('Log: %s').format(jobName), style_class: 'hermes-log-title'});
    let closeBtn = new St.Button({label: '✕', style_class: 'hermes-close-btn'});
    header.add(title);
    header.add(new St.Bin({x_expand: true}));
    header.add(closeBtn);
    dialog.add(header);

    // Scrollable log area
    let scroll = new St.ScrollView({
        style_class: 'hermes-log-scroll',
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        x_expand: true,
        y_expand: true,
    });
    let logLabel = new St.Label({text: _('Loading…'), style_class: 'hermes-log-text', x_expand: true});
    scroll.add_actor(logLabel);
    dialog.add(scroll);

    // Footer
    let footer = new St.BoxLayout({style_class: 'hermes-log-footer'});
    let dismissBtn = new St.Button({label: _('Close'), style_class: 'hermes-action-btn'});
    footer.add(new St.Bin({x_expand: true}));
    footer.add(dismissBtn);
    dialog.add(footer);

    // Fetch logs
    _callScript(['--logs', jobId], (stdout, stderr) => {
        let text = (stdout || stderr || _('(no log output)')).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        logLabel.clutter_text.set_markup('<tt>' + text + '</tt>');
    });

    // Position as modal overlay
    let mon = Main.layoutManager.primaryMonitor;
    dialog.set_position(mon.x + mon.width / 2 - 350, mon.y + mon.height / 2 - 250);
    dialog.set_size(700, 500);
    Main.uiGroup.add_child(dialog);
    dialog.raise_top();

    function _close() {
        Main.uiGroup.remove_child(dialog);
        dialog.destroy();
    }
    closeBtn.connect('clicked', _close);
    dismissBtn.connect('clicked', _close);
}

// ── Panel indicator class ───────────────────────────────────────────

let HermesIndicator = GObject.registerClass(
class HermesIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, _('Hermes Monitor'), false);
        this._settings = settings;

        // Icon
        this._icon = new St.Icon({
            icon_name: 'utilities-terminal-symbolic',
            style_class: 'system-status-icon hermes-panel-icon',
        });
        this.add_child(this._icon);

        // Running job count badge
        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'hermes-panel-label',
        });
        this.add_child(this._label);

        // Start refresh
        this._refresh();
        let interval = this._settings.get_int('refresh-interval');
        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval,
            () => { this._refresh(); return true; });

        // Watch for settings changes
        this._settingsChangedId = this._settings.connect('changed::refresh-interval', () => {
            if (this._timeout)
                GLib.source_remove(this._timeout);
            let secs = this._settings.get_int('refresh-interval');
            this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, secs,
                () => { this._refresh(); return true; });
        });
    }

    _refresh() {
        _callScript(null, (stdout, stderr) => {
            if (stderr || !stdout) {
                this._label.text = '!';
                this._label.style = 'color: #f85149';
                return;
            }
            try {
                let data = JSON.parse(stdout);
                let jobs = data.jobs || [];
                this._rebuildMenu(jobs);
                let running = jobs.filter(j => j.state === 'running').length;
                this._label.text = running > 0 ? String(running) : '';
                this._label.style = running > 0 ? 'color: #3fb950' : 'color: #8b949e';
            } catch (e) {
                this._label.text = '?';
                this._label.style = 'color: #d29922';
            }
        });
        return true;
    }

    _rebuildMenu(jobs) {
        this.menu.removeAll();

        // Header
        let header = new PopupMenu.PopupMenuItem(_('🐺 Hermes Scheduled Tasks'), {reactive: false});
        header.setOrnament(PopupMenu.Ornament.NONE);
        header.actor.add_style_class_name('hermes-menu-header');
        this.menu.addMenuItem(header);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (jobs.length === 0) {
            let empty = new PopupMenu.PopupMenuItem(_('  (no scheduled tasks)'), {reactive: false});
            empty.actor.add_style_class_name('hermes-empty');
            this.menu.addMenuItem(empty);
        } else {
            for (let job of jobs) {
                let item = new PopupMenu.PopupMenuItem('');
                item.setOrnament(PopupMenu.Ornament.NONE);

                let box = new St.BoxLayout({vertical: true, style_class: 'hermes-job-item'});
                let row1 = new St.BoxLayout();
                let icon = new St.Label({text: job.icon || '❓', style_class: 'hermes-job-icon'});
                let name = new St.Label({text: job.name || _('Unnamed'), style_class: 'hermes-job-name'});
                row1.add(icon);
                row1.add(name);
                box.add(row1);

                let row2 = new St.BoxLayout({style_class: 'hermes-job-meta'});
                let meta = new St.Label({
                    text: `⏰ ${job.schedule}  |  ${_('Next')}: ${job.next_run}  |  ${job.platform}`,
                    style_class: 'hermes-job-detail',
                });
                row2.add(meta);
                box.add(row2);

                if (job.brief) {
                    let row3 = new St.BoxLayout();
                    let brief = new St.Label({text: job.brief, style_class: 'hermes-job-brief'});
                    row3.add(brief);
                    box.add(row3);
                }

                item.actor.add_child(box);

                let jid = job.id;
                let jname = job.name;
                item.connect('activate', () => _showLogDialog(jid, jname));
                this.menu.addMenuItem(item);
            }
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Refresh button
        let refreshItem = new PopupMenu.PopupMenuItem(_('🔄 Refresh now'));
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);
    }

    destroy() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        super.destroy();
    }
});

// ── Extension lifecycle ─────────────────────────────────────────────

export default class HermesMonitorExtension extends Extension {
    enable() {
        let pos = this.getSettings().get_string('panel-position');
        this._indicator = new HermesIndicator(this.getSettings());
        Main.panel.addToStatusArea('hermes-monitor', this._indicator, 0, pos);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
    }
}

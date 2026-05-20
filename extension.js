import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

let hermesMenu;

const STATE_ICON = {
    running: '●',
    pending: '◐',
    idle: '○',
    failed: '◉',
    disabled: '◎',
};

const STATE_CLASS = {
    running: 'hermes-status-running',
    pending: 'hermes-status-pending',
    idle: 'hermes-status-idle',
    failed: 'hermes-status-failed',
    disabled: 'hermes-status-disabled',
};

function _stateClass(job) {
    if (!job.enabled)
        return 'disabled';
    switch (job.state) {
        case 'running': return 'running';
        case 'scheduled': return 'pending';
        case 'completed': return 'idle';
        case 'failed':
        case 'timed_out': return 'failed';
        default: return 'idle';
    }
}

function _num(n) {
    if (typeof n !== 'number')
        return '—';
    if (n >= 1_000_000)
        return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 10_000)
        return (n / 1_000).toFixed(1) + 'K';
    if (n >= 1_000)
        return n.toLocaleString();
    return String(n);
}

var HermesMenuButton = GObject.registerClass({
    GTypeName: 'HermesMenuButton',
}, class HermesMenuButton extends PanelMenu.Button {
    _init(extensionObject) {
        super._init(Clutter.ActorAlign.FILL);

        this._extensionObject = extensionObject;
        this._settings = extensionObject.getSettings();

        this._panelLabel = new St.Label({
            text: '⚙️',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'hermes-panel-label',
        });
        this.add_child(this._panelLabel);

        this._jobRows = {};
        this._sessionRows = {};
        this._usageLabels = {};
        this._sections = {usage: true, sessions: true, jobs: true};
        this._sectionChevrons = {};
        this._settingChangedSignals = [];
        this._refreshTimeoutId = null;

        let hermesHome = this._settings.get_string('hermes-home');
        if (hermesHome.startsWith('~/'))
            hermesHome = GLib.build_filenamev([GLib.get_home_dir(), hermesHome.slice(2)]);
        this._hermesHome = hermesHome;
        this._scriptPath = GLib.build_filenamev([
            this._extensionObject.path, 'src', 'hermes-status.py',
        ]);
        this._addSettingChangedSignal('refresh-interval', this._updateTimer.bind(this));
        this._addSettingChangedSignal('position-in-panel', this._positionInPanelChanged.bind(this));

        this._initializeMenu();
        this._initTimer();
        this._refreshAllData();
    }

    _initializeMenu() {
        // Section 1: Usage
        this._usageHeader = this._createSectionHeader('📊 ' + _('Usage'), 'usage');
        this.menu.addMenuItem(this._usageHeader);

        this._usageItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
            style_class: 'hermes-usage-item',
        });
        let grid = new St.BoxLayout({vertical: true, x_expand: true});

        this._usageLabels.sessions = this._addUsageRow(grid, _('Sessions'));
        this._usageLabels.messages = this._addUsageRow(grid, _('Messages'));
        this._usageLabels.tokens = this._addUsageRow(grid, _('Tokens'));
        this._usageLabels.cost = this._addUsageRow(grid, _('Cost'));

        this._usageItem.actor.add_child(grid);
        this.menu.addMenuItem(this._usageItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Section 2: Sessions
        this._sessionsHeader = this._createSectionHeader('📋 ' + _('Sessions'), 'sessions');
        this.menu.addMenuItem(this._sessionsHeader);

        this._emptySessionsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        this._emptySessionsItem.actor.add_child(new St.Label({
            text: _('No recent sessions'),
            style_class: 'hermes-empty-label',
        }));
        this.menu.addMenuItem(this._emptySessionsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Section 3: Cron Jobs
        this._jobsHeader = this._createSectionHeader('⏰ ' + _('Cron Jobs'), 'jobs');
        this.menu.addMenuItem(this._jobsHeader);

        this._emptyJobsItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        this._emptyJobsItem.actor.add_child(new St.Label({
            text: _('No Hermes cron jobs found'),
            style_class: 'hermes-empty-label',
        }));
        this.menu.addMenuItem(this._emptyJobsItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Footer
        let footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
            style_class: 'hermes-footer-item',
        });

        let btnBox = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            style_class: 'hermes-button-box',
        });

        let refreshBtn = this._createFooterButton('view-refresh-symbolic', _('Refresh'));
        refreshBtn.connect('clicked', () => {
            this._initTimer();
            this._refreshAllData();
        });
        btnBox.add_child(refreshBtn);

        let prefsBtn = this._createFooterButton('preferences-system-symbolic', _('Preferences'));
        prefsBtn.connect('clicked', () => {
            this.menu._getTopMenu().close();
            this._extensionObject.openPreferences();
        });
        btnBox.add_child(prefsBtn);

        footerItem.actor.add_child(btnBox);
        this.menu.addMenuItem(footerItem);

        this.menu.connect('open-state-changed', (self, open) => {
            if (open) this._refreshAllData();
        });
    }

    _createSectionHeader(text, sectionName) {
        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
            style_class: 'hermes-section-header',
        });
        let box = new St.BoxLayout({
            vertical: false, x_expand: true,
            reactive: true, track_hover: true,
        });
        let chevron = new St.Label({
            text: '▼',
            style_class: 'hermes-section-chevron',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._sectionChevrons[sectionName] = chevron;
        box.add_child(chevron);
        box.add_child(new St.Label({
            text,
            style_class: 'hermes-section-header-label',
        }));
        item.actor.add_child(box);
        box.connect('button-press-event', (actor, event) => {
            this._toggleSection(sectionName);
            return Clutter.EVENT_STOP;
        });
        return item;
    }

    _toggleSection(name) {
        this._sections[name] = !this._sections[name];
        this._sectionChevrons[name].text = this._sections[name] ? '▼' : '▶';
        this._applySectionVisibility(name);
    }

    _applySectionVisibility(name) {
        let expanded = this._sections[name];
        switch (name) {
        case 'usage':
            if (this._usageItem)
                this._usageItem.actor.visible = expanded;
            break;
        case 'sessions':
            for (let id of Object.keys(this._sessionRows))
                this._sessionRows[id].item.actor.visible = expanded;
            this._emptySessionsItem.actor.visible =
                expanded && Object.keys(this._sessionRows).length === 0;
            break;
        case 'jobs':
            for (let id of Object.keys(this._jobRows))
                this._jobRows[id].item.actor.visible = expanded;
            this._emptyJobsItem.actor.visible =
                expanded && Object.keys(this._jobRows).length === 0;
            break;
        }
    }

    _addUsageRow(parent, label) {
        let row = new St.BoxLayout({
            vertical: false,
            style_class: 'hermes-usage-row',
        });
        let lbl = new St.Label({
            text: label + ': —',
            style_class: 'hermes-usage-label',
        });
        row.add_child(lbl);
        parent.add_child(row);
        return lbl;
    }

    _createFooterButton(iconName, tooltip) {
        let btn = new St.Button({
            style_class: 'button hermes-footer-button',
            child: new St.Icon({
                icon_name: iconName,
                style_class: 'popup-menu-icon',
            }),
        });
        if (tooltip)
            btn.tooltip_text = tooltip;
        return btn;
    }

    _refreshAllData() {
        try {
            let proc = Gio.Subprocess.new(
                ['python3', this._scriptPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            );
            let [ok, stdout, stderr] = proc.communicate(null, null);
            let status = proc.get_exit_status();
            if (!ok || status !== 0) {
                let errMsg = '';
                if (stderr)
                    errMsg = new TextDecoder().decode(stderr.toArray());
                log('[hermes-monitor] script error (exit ' + status + '): ' + errMsg);
                return;
            }
            let text = stdout ? new TextDecoder().decode(stdout.toArray()) : '{}';
            let data = JSON.parse(text);
            this._updateUsageSection(data.usage || {});
            this._updateSessionsSection(data.sessions || []);
            this._updateJobsSection(data.jobs || []);
        } catch (e) {
            log('[hermes-monitor] refresh error: ' + e.message);
        }
    }

    // ── Usage section ─────────────────────────────────────────────────

    _updateUsageSection(usage) {
        let fmt = (n) => _num(n);
        this._usageLabels.sessions.text =
            _('Sessions') + ': ' + fmt(usage.total_sessions);
        this._usageLabels.messages.text =
            _('Messages') + ': ' + fmt(usage.total_messages);

        let tok = fmt(usage.input_tokens) + ' in / ' + fmt(usage.output_tokens) + ' out';
        if (usage.cache_read_tokens > 0)
            tok += ' (+' + fmt(usage.cache_read_tokens) + ' cache)';
        this._usageLabels.tokens.text = _('Tokens') + ': ' + tok;

        this._usageLabels.cost.text =
            _('Cost') + ': $' + (usage.cost_usd || 0).toFixed(4);
    }

    // ── Sessions section ──────────────────────────────────────────────

    _updateSessionsSection(sessions) {
        let activeIds = new Set(sessions.map(s => s.id));

        for (let id of Object.keys(this._sessionRows)) {
            if (!activeIds.has(id))
                this._removeSessionRow(id);
        }

        let insertIdx = this._insertBefore(this._emptySessionsItem);
        for (let i = 0; i < sessions.length; i++) {
            let s = sessions[i];
            if (this._sessionRows[s.id]) {
                this._updateSessionRow(s, this._sessionRows[s.id]);
            } else {
                let row = this._createSessionRow(s);
                this._sessionRows[s.id] = row;
                this.menu.addMenuItem(row.item, insertIdx + i);
            }
        }

        this._emptySessionsItem.actor.visible =
            this._sections.sessions && sessions.length === 0;
    }

    _createSessionRow(session) {
        let box = new St.BoxLayout({
            vertical: true,
            style_class: 'hermes-session-row',
            x_expand: true,
        });

        let topLine = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        let titleLabel = new St.Label({
            text: session.title || _('Untitled'),
            style_class: 'hermes-session-title',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        topLine.add_child(titleLabel);

        let costLabel = new St.Label({
            text: session.cost_usd > 0 ? '$' + session.cost_usd.toFixed(4) : '',
            style_class: 'hermes-session-cost',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topLine.add_child(costLabel);

        box.add_child(topLine);

        let bottomLine = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        let metaParts = [session.model || '—'];
        metaParts.push(session.messages + ' msg');
        if (session.tool_calls > 0)
            metaParts.push(session.tool_calls + ' tools');
        metaParts.push(session.started || '');

        let metaLabel = new St.Label({
            text: metaParts.join(' · '),
            style_class: 'hermes-session-meta',
        });
        bottomLine.add_child(metaLabel);

        box.add_child(bottomLine);

        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        item.actor.add_child(box);

        return {item, titleLabel, costLabel, metaLabel};
    }

    _updateSessionRow(session, row) {
        row.titleLabel.text = session.title || _('Untitled');
        row.costLabel.text = session.cost_usd > 0 ? '$' + session.cost_usd.toFixed(4) : '';

        let parts = [session.model || '—'];
        parts.push(session.messages + ' msg');
        if (session.tool_calls > 0)
            parts.push(session.tool_calls + ' tools');
        parts.push(session.started || '');

        row.metaLabel.text = parts.join(' · ');
    }

    _removeSessionRow(id) {
        if (this._sessionRows[id]) {
            this._sessionRows[id].item.destroy();
            delete this._sessionRows[id];
        }
    }

    // ── Jobs section ──────────────────────────────────────────────────

    _updateJobsSection(jobs) {
        let activeIds = new Set(jobs.map(j => j.id));

        for (let id of Object.keys(this._jobRows)) {
            if (!activeIds.has(id))
                this._removeJobRow(id);
        }

        let insertIdx = this._insertBefore(this._emptyJobsItem);
        for (let i = 0; i < jobs.length; i++) {
            let job = jobs[i];
            if (this._jobRows[job.id]) {
                this._updateJobRow(job, this._jobRows[job.id]);
            } else {
                let row = this._createJobRow(job);
                this._jobRows[job.id] = row;
                this.menu.addMenuItem(row.item, insertIdx + i);
            }
        }

        this._emptyJobsItem.actor.visible =
            this._sections.jobs && jobs.length === 0;

        let running = 0;
        for (let j of jobs) {
            if (j.state === 'running')
                running++;
        }
    }

    _createJobRow(job) {
        let box = new St.BoxLayout({
            vertical: true,
            style_class: 'hermes-job-row',
            x_expand: true,
        });

        let topLine = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        let cls = _stateClass(job);
        let statusDot = new St.Label({
            text: job.icon || STATE_ICON[job.state] || STATE_ICON.idle,
            style_class: 'hermes-status-dot ' + STATE_CLASS[cls],
            y_align: Clutter.ActorAlign.CENTER,
        });
        topLine.add_child(statusDot);

        let nameLabel = new St.Label({
            text: job.name || _('Unnamed'),
            style_class: 'hermes-job-name',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        topLine.add_child(nameLabel);

        let scheduleLabel = new St.Label({
            text: job.schedule || '—',
            style_class: 'hermes-job-schedule',
            y_align: Clutter.ActorAlign.CENTER,
        });
        topLine.add_child(scheduleLabel);

        box.add_child(topLine);

        let bottomLine = new St.BoxLayout({
            vertical: false,
            x_align: Clutter.ActorAlign.START,
        });

        let nextText = job.next_run
            ? _('Next: ') + job.next_run.replace('T', ' ')
            : _('No next run');
        let nextLabel = new St.Label({
            text: nextText,
            style_class: 'hermes-job-meta',
        });
        bottomLine.add_child(nextLabel);

        box.add_child(bottomLine);

        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false, can_focus: false,
        });
        item.actor.add_child(box);

        if (job.brief)
            item.actor.tooltip_text = job.brief;

        return {item, statusDot, nameLabel, scheduleLabel, nextLabel};
    }

    _updateJobRow(job, row) {
        let cls = _stateClass(job);
        row.statusDot.text = job.icon || STATE_ICON[job.state] || STATE_ICON.idle;

        for (let c of Object.values(STATE_CLASS)) {
            if (row.statusDot.has_style_class_name(c))
                row.statusDot.remove_style_class_name(c);
        }
        row.statusDot.add_style_class_name(STATE_CLASS[cls]);

        row.nameLabel.text = job.name || _('Unnamed');
        row.scheduleLabel.text = job.schedule || '—';
        row.nextLabel.text = job.next_run
            ? _('Next: ') + job.next_run.replace('T', ' ')
            : _('No next run');
    }

    _removeJobRow(id) {
        if (this._jobRows[id]) {
            this._jobRows[id].item.destroy();
            delete this._jobRows[id];
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────

    _insertBefore(anchor) {
        let items = this.menu._getMenuItems();
        for (let i = 0; i < items.length; i++) {
            if (items[i] === anchor)
                return i;
        }
        return 0;
    }

    // ── Timer ─────────────────────────────────────────────────────────

    _initTimer() {
        this._destroyTimer();
        let interval = this._settings.get_int('refresh-interval');
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refreshAllData();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _destroyTimer() {
        if (this._refreshTimeoutId) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = null;
        }
    }

    _updateTimer() {
        this._initTimer();
    }

    _addSettingChangedSignal(key, callback) {
        this._settingChangedSignals.push(
            this._settings.connect('changed::' + key, callback)
        );
    }

    _positionInPanel() {
        switch (this._settings.get_int('position-in-panel')) {
            case 0: return ['right', 0];
            case 1: return ['center', 0];
            case 2: return ['left', 0];
            default: return ['right', 0];
        }
    }

    _positionInPanelChanged() {
        this.container.get_parent().remove_child(this.container);
        let [alignment, position] = this._positionInPanel();
        let boxes = {
            left: Main.panel._leftBox,
            center: Main.panel._centerBox,
            right: Main.panel._rightBox,
        };
        boxes[alignment].insert_child_at_index(this.container, position);
    }

    destroy() {
        this._destroyTimer();

        for (let signal of this._settingChangedSignals)
            this._settings.disconnect(signal);

        super.destroy();
    }
});

export default class HermesExtension extends Extension {
    enable() {
        hermesMenu = new HermesMenuButton(this);
        let [alignment, position] = hermesMenu._positionInPanel();
        Main.panel.addToStatusArea('hermesMenu', hermesMenu, position, alignment);
    }

    disable() {
        hermesMenu.destroy();
        hermesMenu = null;
    }
}

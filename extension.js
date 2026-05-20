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

var HermesMenuButton = GObject.registerClass({
    GTypeName: 'HermesMenuButton',
}, class HermesMenuButton extends PanelMenu.Button {
    _init(extensionObject) {
        super._init(Clutter.ActorAlign.FILL);

        this._extensionObject = extensionObject;
        this._settings = extensionObject.getSettings();

        this._panelLabel = new St.Label({
            text: '⚡',
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'hermes-panel-label',
        });
        this.add_child(this._panelLabel);

        this._jobRows = {};
        this._settingChangedSignals = [];
        this._refreshTimeoutId = null;

        let hermesHome = this._settings.get_string('hermes-home');
        if (hermesHome.startsWith('~/')) {
            hermesHome = GLib.build_filenamev([GLib.get_home_dir(), hermesHome.slice(2)]);
        }
        this._jobsPath = GLib.build_filenamev([hermesHome, 'cron', 'jobs.json']);

        this._addSettingChangedSignal('refresh-interval', this._updateTimer.bind(this));
        this._addSettingChangedSignal('position-in-panel', this._positionInPanelChanged.bind(this));

        this._initializeMenu();
        this._initTimer();
        this._refreshJobData();
    }

    _initializeMenu() {
        this._summaryLabel = new St.Label({
            text: _('Loading…'),
            style_class: 'hermes-summary-label',
        });
        let summaryItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        summaryItem.actor.add_child(this._summaryLabel);
        this.menu.addMenuItem(summaryItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._emptyLabel = new St.Label({
            text: _('No Hermes cron jobs found'),
            style_class: 'hermes-empty-label',
        });
        this._emptyItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        this._emptyItem.actor.add_child(this._emptyLabel);
        this.menu.addMenuItem(this._emptyItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
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
            this._refreshJobData();
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
            if (open) this._refreshJobData();
        });
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

    _refreshJobData() {
        let file = Gio.File.new_for_path(this._jobsPath);
        let jobs = this._readJobs(file);
        if (jobs === null) {
            this._showEmpty();
            return;
        }

        this._updateSummary(jobs);

        let activeIds = new Set(jobs.map(j => j.id));

        for (let id of Object.keys(this._jobRows)) {
            if (!activeIds.has(id))
                this._removeJobRow(id);
        }

        for (let job of jobs) {
            if (this._jobRows[job.id]) {
                this._updateJobRow(job, this._jobRows[job.id]);
            } else {
                let row = this._createJobRow(job);
                this._jobRows[job.id] = row;
                let idx = this._jobInsertIndex();
                this.menu.addMenuItem(row.item, idx);
            }
        }

        let hasJobs = Object.keys(this._jobRows).length > 0;
        this._emptyItem.actor.visible = !hasJobs;
    }

    _readJobs(file) {
        if (!file.query_exists(null))
            return null;

        let [, contents] = file.load_contents(null);
        let text = new TextDecoder().decode(contents);

        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            return null;
        }

        let raw = data.jobs || [];
        // Flatten nested objects to plain strings for GJS widgets
        return raw.map(j => {
            let sched = j.schedule || {};
            let origin = j.origin || {};
            return {
                id: j.id || '',
                name: j.name || 'Unnamed',
                state: j.state || 'idle',
                enabled: j.enabled !== false,
                schedule: sched.display || sched.expr || '—',
                next_run: (j.next_run_at || '').slice(0, 16),
                last_status: j.last_status || '—',
                platform: origin.platform || 'local',
                brief: (j.prompt || '').slice(0, 80).replace(/\n/g, ' '),
            };
        });
    }

    _updateSummary(jobs) {
        let total = jobs.length;
        let running = 0;
        let failed = 0;

        for (let j of jobs) {
            if (j.state === 'running')
                running++;
            if (j.state === 'failed' || j.last_status === 'failed')
                failed++;
        }

        if (total === 0) {
            this._panelLabel.text = '⚡';
            this._summaryLabel.text = _('No Hermes cron jobs');
            return;
        }

        this._panelLabel.text = running > 0 ? `⚡${running}` : '⚡';

        let parts = [`${total} job${total !== 1 ? 's' : ''}`];
        if (running > 0)
            parts.push(`${running} running`);
        if (failed > 0)
            parts.push(`${failed} failed`);
        this._summaryLabel.text = parts.join(' · ');
    }

    _jobInsertIndex() {
        let items = this.menu._getMenuItems();
        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i] === this._emptyItem)
                return i + 1;
        }
        let footerIdx = items.length - 3;
        return footerIdx > 0 ? footerIdx : items.length;
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

        let state = job.state || 'idle';
        let statusDot = new St.Label({
            text: STATE_ICON[state] || STATE_ICON.idle,
            style_class: `hermes-status-dot ${STATE_CLASS[state] || STATE_CLASS.idle}`,
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

        let statusMetaLabel = null;
        if (job.last_status && job.last_status !== '—') {
            statusMetaLabel = new St.Label({
                text: ' · ' + job.last_status,
                style_class: `hermes-job-meta hermes-last-${job.last_status}`,
            });
            bottomLine.add_child(statusMetaLabel);
        }

        box.add_child(bottomLine);

        let item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        item.actor.add_child(box);

        if (job.brief)
            item.actor.tooltip_text = job.brief;

        return {
            item,
            statusDot,
            nameLabel,
            scheduleLabel,
            nextLabel,
            statusMetaLabel,
        };
    }

    _updateJobRow(job, row) {
        let state = job.state || 'idle';
        row.statusDot.text = STATE_ICON[state] || STATE_ICON.idle;

        for (let cls of Object.values(STATE_CLASS)) {
            if (row.statusDot.has_style_class_name(cls))
                row.statusDot.remove_style_class_name(cls);
        }
        if (STATE_CLASS[state])
            row.statusDot.add_style_class_name(STATE_CLASS[state]);

        row.nameLabel.text = job.name || _('Unnamed');
        row.scheduleLabel.text = job.schedule || '—';

        row.nextLabel.text = job.next_run
            ? _('Next: ') + job.next_run.replace('T', ' ')
            : _('No next run');

        if (row.statusMetaLabel) {
            if (job.last_status && job.last_status !== '—') {
                row.statusMetaLabel.text = ' · ' + job.last_status;
                row.statusMetaLabel.visible = true;
            } else {
                row.statusMetaLabel.visible = false;
            }
        }
    }

    _removeJobRow(id) {
        if (this._jobRows[id]) {
            this._jobRows[id].item.destroy();
            delete this._jobRows[id];
        }
    }

    _showEmpty() {
        this._panelLabel.text = '⚡';
        this._summaryLabel.text = _('No Hermes cron jobs');

        for (let id of Object.keys(this._jobRows))
            this._removeJobRow(id);

        this._emptyItem.actor.show();
    }

    _initTimer() {
        this._destroyTimer();
        let interval = this._settings.get_int('refresh-interval');
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval,
            () => {
                this._refreshJobData();
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

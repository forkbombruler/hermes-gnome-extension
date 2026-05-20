/* prefs.js — Hermes Monitor preferences window */
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class HermesMonitorPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        let page = new Adw.PreferencesPage();
        window.add(page);

        // ── General group ──────────────────────────
        let general = new Adw.PreferencesGroup({title: _('General')});
        page.add(general);

        let refreshRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('How often (in seconds) to check for job updates (5–600)'),
            adjustment: new Gtk.Adjustment({
                lower: 5, upper: 600, step_increment: 5,
            }),
            value: window._settings.get_int('refresh-interval'),
        });
        refreshRow.connect('changed', (w) => {
            window._settings.set_int('refresh-interval', w.value);
        });
        general.add(refreshRow);

        let hermesHomeRow = new Adw.EntryRow({
            title: _('Hermes home directory'),
        });
        hermesHomeRow.set_text(window._settings.get_string('hermes-home'));
        hermesHomeRow.connect('changed', (w) => {
            window._settings.set_string('hermes-home', w.get_text());
        });
        general.add(hermesHomeRow);

        // ── Panel group ────────────────────────────
        let panel = new Adw.PreferencesGroup({title: _('Panel')});
        page.add(panel);

        let posRow = new Adw.ComboRow({
            title: _('Panel position'),
            subtitle: _('Where to place the indicator in the top bar'),
            model: Gtk.StringList.new(['left', 'center', 'right']),
        });
        let posMap = {left: 0, center: 1, right: 2};
        let currentPos = window._settings.get_string('panel-position');
        posRow.set_selected(posMap[currentPos] || 2);
        posRow.connect('notify::selected', (w) => {
            let keys = ['left', 'center', 'right'];
            window._settings.set_string('panel-position', keys[w.selected] || 'right');
        });
        panel.add(posRow);
    }
}

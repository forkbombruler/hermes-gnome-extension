import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class HermesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            name: 'general',
            title: _('General'),
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: _('Behavior'),
        });
        page.add(group);

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh Interval'),
            subtitle: _('How often to check for job updates, in seconds'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 600,
                step_increment: 5,
            }),
            value: window._settings.get_int('refresh-interval'),
        });
        intervalRow.connect('changed', (row) => {
            window._settings.set_int('refresh-interval', row.value);
        });
        group.add(intervalRow);

        const panelGroup = new Adw.PreferencesGroup({
            title: _('Panel'),
        });
        page.add(panelGroup);

        const positions = new Gtk.StringList();
        positions.append(_('Right'));
        positions.append(_('Center'));
        positions.append(_('Left'));

        const positionRow = new Adw.ComboRow({
            title: _('Position in Panel'),
            subtitle: _('Where to show the indicator'),
            model: positions,
            selected: window._settings.get_int('position-in-panel'),
        });
        positionRow.connect('notify::selected', (row) => {
            window._settings.set_int('position-in-panel', row.selected);
        });
        panelGroup.add(positionRow);
    }
}

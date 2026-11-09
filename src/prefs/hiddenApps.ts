// The "Hidden apps" group of the Menu page: the apps hidden with "Hide from Menu" (setting `hidden-apps`),
// each with its icon, its name and a Restore button, plus the switch that lets search still find them.
//
// Public API:
//   hiddenAppsGroup(ctx): Adw.PreferencesGroup
//   Rows are rebuilt on every change (also when the menu hides an app while this window is open) and sorted by
//   name. An id whose app is no longer installed is greyed, says "Not installed" and can only be removed.
//   Restoring or removing offers Undo in a toast; the focus moves to the next row's button afterwards.

import Adw from 'gi://Adw';
import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {addHidden, removeHidden} from '../model/hiddenApps.js';
import type {PrefsContext} from './context.js';
import {describeEntry} from './lists.js';
import {label, LIST_ICON_SIZE, switchRow, toast, watch} from './widgets.js';

interface HiddenRow {
    id: string;
    title: string;
    installed: boolean;
    icon: string | Gio.Icon;
}

function describeHidden(ctx: PrefsContext, id: string): HiddenRow {
    const d = describeEntry({id}, ctx);
    const installed = d.subtitle !== 'Not installed';
    // An uninstalled app has no name left: show its id (without .desktop) so the user can tell which one it was.
    return {id, title: installed ? d.title : id.replace(/\.desktop$/, ''), installed, icon: d.icon};
}

export function hiddenAppsGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({
        title: 'Hidden apps',
        description: 'Apps you hid with “Hide from Menu” are left out of All Apps, the categories and Frequent. Pinned apps stay pinned.',
    });
    group.add(switchRow(ctx, 'search-hidden-apps', 'Find hidden apps in search', 'Search results can still include them'));

    const rows: Adw.ActionRow[] = [];
    const buttons: Gtk.Button[] = [];
    let pendingFocus: number | null = null;

    const hiddenIds = (): string[] => ctx.settings.get('hidden-apps');

    const setHidden = (next: string[]): void => {
        ctx.settings.set('hidden-apps', next);
    };

    const restore = (row: HiddenRow, index: number): void => {
        const before = hiddenIds();
        pendingFocus = index;
        setHidden(removeHidden(before, row.id));
        const message = row.installed ? `Restored “${row.title}”` : `Removed “${row.title}”`;
        toast(ctx, message, () => setHidden(addHidden(hiddenIds(), row.id)));
    };

    const restoreFocus = (): void => {
        const wanted = pendingFocus;
        pendingFocus = null;
        if (wanted === null)
            return;
        const target = buttons[Math.min(wanted, buttons.length - 1)];
        if (target)
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                target.grab_focus();
                return GLib.SOURCE_REMOVE;
            });
    };

    const build = (): void => {
        for (const row of rows.splice(0))
            group.remove(row);
        buttons.length = 0;
        const items = hiddenIds().map(id => describeHidden(ctx, id));
        // Installed apps by name first, then the ids of apps that are gone.
        items.sort((a, b) => Number(b.installed) - Number(a.installed) || a.title.localeCompare(b.title));
        if (items.length === 0) {
            const empty = new Adw.ActionRow({
                title: 'No hidden apps',
                subtitle: 'Right-click an app in the menu and choose “Hide from Menu”',
                sensitive: false,
            });
            group.add(empty);
            rows.push(empty);
            return;
        }
        items.forEach((item, index) => {
            const row = new Adw.ActionRow({title: GLib.markup_escape_text(item.title, -1), subtitle: item.installed ? '' : 'Not installed'});
            row.set_tooltip_text(item.id);
            const icon = typeof item.icon === 'string' ? new Gtk.Image({icon_name: item.icon}) : new Gtk.Image({gicon: item.icon});
            icon.set_pixel_size(LIST_ICON_SIZE);
            row.add_prefix(icon);
            if (!item.installed) // dim the icon only: the Remove button must not look disabled
                icon.add_css_class('dim-label');
            const button = new Gtk.Button({
                label: item.installed ? 'Restore' : 'Remove',
                valign: Gtk.Align.CENTER,
                tooltip_text: item.installed ? 'Show this app in the menu again' : 'Forget this app, it is no longer installed',
            });
            label(button, item.installed ? `Restore ${item.title}` : `Remove ${item.title}`);
            button.connect('clicked', () => restore(item, index));
            row.add_suffix(button);
            buttons.push(button);
            group.add(row);
            rows.push(row);
        });
        restoreFocus();
    };

    build();
    watch(ctx, group, ['hidden-apps'], build);
    return group;
}

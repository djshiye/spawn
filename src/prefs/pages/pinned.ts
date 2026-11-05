// Preferences page "Pinned & Shortcuts": pinned apps and folders, directory and application
// shortcuts (all reorderable) and the power buttons.
//
// Public API:
//   createPinnedPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {PowerType} from '../../core/constants.js';
import type {SettingKey} from '../../core/settings.js';
import type {PrefsContext} from '../context.js';
import {createEntryList} from '../lists.js';
import {enumRow, group, label, resetWithUndo, watch} from '../widgets.js';

const POWER: ReadonlyArray<readonly [number, string, string]> = [
    [PowerType.LOGOUT, 'Log Out', 'system-log-out-symbolic'],
    [PowerType.LOCK, 'Lock', 'system-lock-screen-symbolic'],
    [PowerType.RESTART, 'Restart', 'system-reboot-symbolic'],
    [PowerType.POWER_OFF, 'Power Off', 'system-shutdown-symbolic'],
    [PowerType.SUSPEND, 'Suspend', 'media-playback-pause-symbolic'],
    [PowerType.HYBRID_SLEEP, 'Hybrid Sleep', 'weather-clear-night-symbolic'],
    [PowerType.HIBERNATE, 'Hibernate', 'weather-clear-night-symbolic'],
    [PowerType.SWITCH_USER, 'Switch User', 'system-users-symbolic'],
];

/** Power buttons: a switch per button, order = order of the `power-options` list. */
function powerGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const key: SettingKey = 'power-options';
    const g = new Adw.PreferencesGroup({
        title: 'Power buttons',
        description: 'Choose which buttons appear and in which order.',
    });
    let rows: Adw.ActionRow[] = [];
    // Rows are rebuilt on every change; remember which button to focus again afterwards.
    const buttons = new Map<string, Gtk.Widget>();
    let pendingFocus: string[] | null = null;

    const build = (): void => {
        for (const row of rows)
            g.remove(row);
        rows = [];
        buttons.clear();
        const list = ctx.settings.get('power-options');
        list.forEach(([id, enabled], index) => {
            const info = POWER.find(p => p[0] === id);
            const row = new Adw.ActionRow({title: info?.[1] ?? `Option ${id}`});
            row.add_prefix(new Gtk.Image({icon_name: info?.[2] ?? 'system-shutdown-symbolic'}));
            const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: enabled});
            label(toggle, `Show ${row.title}`);
            toggle.connect('notify::active', () => {
                const next = ctx.settings.get('power-options').map(([i, e]): [number, boolean] => (i === id ? [i, toggle.active] : [i, e]));
                if (JSON.stringify(next) !== JSON.stringify(ctx.settings.get('power-options'))) {
                    pendingFocus = [`sw:${index}`]; // the rebuild below replaces this very switch
                    ctx.settings.set('power-options', next);
                }
            });
            const move = (delta: number): void => {
                const next = ctx.settings.get('power-options');
                const [item] = next.splice(index, 1);
                next.splice(index + delta, 0, item as [number, boolean]);
                pendingFocus = delta < 0 ? [`up:${index + delta}`, `down:${index + delta}`] : [`down:${index + delta}`, `up:${index + delta}`];
                ctx.settings.set('power-options', next);
            };
            const up = new Gtk.Button({icon_name: 'go-up-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'], tooltip_text: 'Move up', sensitive: index > 0});
            label(up, `Move ${row.title} up`);
            up.connect('clicked', () => move(-1));
            const down = new Gtk.Button({icon_name: 'go-down-symbolic', valign: Gtk.Align.CENTER, css_classes: ['flat'], tooltip_text: 'Move down', sensitive: index < list.length - 1});
            label(down, `Move ${row.title} down`);
            down.connect('clicked', () => move(1));
            buttons.set(`up:${index}`, up);
            buttons.set(`down:${index}`, down);
            buttons.set(`sw:${index}`, toggle);
            row.add_suffix(up);
            row.add_suffix(down);
            row.add_suffix(toggle);
            row.set_activatable_widget(toggle);
            g.add(row);
            rows.push(row);
        });
        const wanted = pendingFocus;
        pendingFocus = null;
        const target = wanted?.map(k => buttons.get(k)).find(b => b?.get_sensitive());
        if (target)
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                target.grab_focus();
                return GLib.SOURCE_REMOVE;
            });
    };
    build();
    watch(ctx, g, [key], build);

    const reset = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['flat'], tooltip_text: 'Restore the defaults of this section'});
    reset.connect('clicked', () => resetWithUndo(ctx, ['power-options', 'power-display-style'], 'Power buttons reset to defaults'));
    g.set_header_suffix(reset);
    return g;
}

export function createPinnedPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'pinned',
        title: 'Pinned & Shortcuts',
        icon_name: 'starred-symbolic',
    });
    const s = ctx.settings;

    const pinned = createEntryList(ctx, {
        title: 'Pinned apps',
        description: 'Shown in the pinned view. Folders can hold several apps.',
        kind: 'pinned',
        source: {get: () => s.get('pinned-apps'), set: v => s.set('pinned-apps', v), keys: ['pinned-apps']},
        reset: true,
    });
    page.add(pinned);

    const directories = createEntryList(ctx, {
        title: 'Folder shortcuts',
        description: 'Places listed in the right pane.',
        kind: 'directory',
        source: {get: () => s.get('directory-shortcuts'), set: v => s.set('directory-shortcuts', v), keys: ['directory-shortcuts']},
        reset: true,
    });
    page.add(directories);

    const applications = createEntryList(ctx, {
        title: 'Application shortcuts',
        description: 'Apps, commands and separators listed in the right pane.',
        kind: 'application',
        source: {get: () => s.get('application-shortcuts'), set: v => s.set('application-shortcuts', v), keys: ['application-shortcuts']},
        reset: true,
    });
    page.add(applications);

    page.add(powerGroup(ctx));
    page.add(group(ctx, 'Power button style', [
        enumRow(ctx, 'power-display-style', 'Show power buttons as', [
            ['Default', 'Buttons at the bottom'],
            ['In_Line', 'Buttons in line with the shortcuts'],
            ['Menu', 'A single power menu'],
        ]),
    ]));
    return page;
}

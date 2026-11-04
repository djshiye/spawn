// Preferences page "General": panel position, Activities button, hotkeys, behaviour.
//
// Public API:
//   createGeneralPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

import type {PrefsContext} from '../context.js';
import {captureShortcut} from '../shortcutDialog.js';
import {enumRow, group, label, resetWithUndo, spinRow, switchRow, toast, watch} from '../widgets.js';

/** Hotkeys group: the Super key switch plus one row per custom accelerator and an "Add" row. */
function hotkeyGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const key = 'spawn-hotkey';
    const g = new Adw.PreferencesGroup({title: 'Hotkeys'});
    g.add(switchRow(ctx, 'super-key-toggle', 'Super key opens the menu', 'Pressing and releasing the Super key toggles the menu instead of the Activities overview'));
    let rows: Gtk.Widget[] = [];

    const write = (list: string[]): void => {
        ctx.settings.set(key, list);
    };
    const capture = (index: number): void => {
        const list = ctx.settings.get(key);
        void captureShortcut(ctx.window, list[index] ?? '').then(accel => {
            if (accel === undefined || accel === null)
                return;
            const next = ctx.settings.get(key);
            if (accel === '') {
                next.splice(index, 1);
            } else {
                if (next.includes(accel) && next[index] !== accel) {
                    toast(ctx, 'That shortcut is already in the list');
                    return;
                }
                next[index] = accel;
            }
            write(next);
            if (accel === '<Super>space')
                toast(ctx, 'Note: <Super>space is also used by GNOME for input source switching');
        });
    };

    const build = (): void => {
        for (const row of rows)
            g.remove(row);
        rows = [];
        const list = ctx.settings.get(key);
        list.forEach((accel, index) => {
            const row = new Adw.ActionRow({
                title: list.length === 1 ? 'Custom shortcut' : `Custom shortcut ${index + 1}`,
                subtitle: index === 0 ? 'An extra shortcut that opens and closes the menu' : undefined,
            });
            const shown = new Gtk.ShortcutLabel({accelerator: accel, valign: Gtk.Align.CENTER});
            const change = new Gtk.Button({label: 'Change', valign: Gtk.Align.CENTER});
            change.connect('clicked', () => capture(index));
            const remove = new Gtk.Button({
                icon_name: 'edit-delete-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Remove the shortcut',
                css_classes: ['flat'],
            });
            label(remove, `Remove shortcut ${accel}`);
            remove.connect('clicked', () => {
                const next = ctx.settings.get(key);
                next.splice(index, 1);
                write(next);
            });
            row.add_suffix(shown);
            row.add_suffix(change);
            row.add_suffix(remove);
            g.add(row);
            rows.push(row);
        });
        const add = new Adw.ActionRow({
            title: list.length === 0 ? 'Custom shortcut' : 'Add another shortcut',
            subtitle: list.length === 0 ? 'An extra shortcut that opens and closes the menu' : undefined,
            activatable: true,
        });
        if (list.length === 0)
            add.add_suffix(new Gtk.Label({label: 'Not set', css_classes: ['dim-label'], valign: Gtk.Align.CENTER}));
        const addButton = new Gtk.Button({label: list.length === 0 ? 'Set' : 'Add', valign: Gtk.Align.CENTER});
        addButton.connect('clicked', () => capture(list.length));
        add.add_suffix(addButton);
        add.set_activatable_widget(addButton);
        g.add(add);
        rows.push(add);
    };
    build();
    watch(ctx, g, [key], build);
    return g;
}

export function createGeneralPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'general',
        title: 'General',
        icon_name: 'preferences-system-symbolic',
    });

    page.add(group(ctx, 'Panel', [
        enumRow(ctx, 'position-in-panel', 'Button position', [['Left', 'Left'], ['Center', 'Center'], ['Right', 'Right']]),
        spinRow(ctx, 'menu-button-position-offset', 'Position offset', 0, 20, {
            subtitle: 'Number of panel items to skip from the chosen edge',
        }),
        switchRow(ctx, 'multi-monitor', 'Show on every monitor', 'Add the menu button to the panel of each monitor (Dash to Panel)'),
        switchRow(ctx, 'hide-activities-button', 'Hide the Activities button', 'Restored to its previous state when the extension is disabled'),
    ]));

    page.add(hotkeyGroup(ctx));

    page.add(group(ctx, 'Behaviour', [
        switchRow(ctx, 'activate-on-launch', 'Switch to the app when it is already running', 'Activate the existing window instead of opening a new one'),
        switchRow(ctx, 'keep-open-on-ctrl-click', 'Keep the menu open on Ctrl+click', 'Launch several apps in a row'),
        switchRow(ctx, 'show-tooltips', 'Show tooltips'),
    ], {
        reset: ['activate-on-launch', 'keep-open-on-ctrl-click', 'show-tooltips'],
    }));

    const resetAll = new Gtk.Button({label: 'Reset General Settings', halign: Gtk.Align.CENTER, css_classes: ['destructive-action', 'pill']});
    resetAll.connect('clicked', () => {
        resetWithUndo(ctx, [
            'position-in-panel', 'menu-button-position-offset', 'multi-monitor', 'hide-activities-button',
            'super-key-toggle', 'spawn-hotkey', 'activate-on-launch', 'keep-open-on-ctrl-click', 'show-tooltips',
        ], 'General settings reset to defaults');
    });
    const tail = new Adw.PreferencesGroup();
    tail.add(resetAll);
    page.add(tail);
    return page;
}

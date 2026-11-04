// Preferences page "General": panel position, Activities button, hotkeys, behaviour.
//
// Public API:
//   createGeneralPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

import type {PrefsContext} from '../context.js';
import {captureShortcut} from '../shortcutDialog.js';
import {enumRow, group, resetKeys, spinRow, switchRow, toast, watch} from '../widgets.js';

function hotkeyRow(ctx: PrefsContext): Adw.ActionRow {
    const row = new Adw.ActionRow({
        title: 'Custom shortcut',
        subtitle: 'An extra shortcut that opens and closes the menu',
    });
    const label = new Gtk.ShortcutLabel({accelerator: '', disabled_text: 'Not set', valign: Gtk.Align.CENTER});
    const set = new Gtk.Button({label: 'Set', valign: Gtk.Align.CENTER});
    const clear = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: 'Remove the shortcut',
        css_classes: ['flat'],
    });
    const sync = (): void => {
        const keys = ctx.settings.get('menu-hotkey');
        label.set_accelerator(keys[0] ?? '');
        clear.set_sensitive(keys.length > 0);
    };
    sync();
    watch(ctx, row, ['menu-hotkey'], sync);

    set.connect('clicked', () => {
        void captureShortcut(ctx.window, ctx.settings.get('menu-hotkey')[0] ?? '').then(accel => {
            if (accel === undefined || accel === null)
                return;
            ctx.settings.set('menu-hotkey', accel === '' ? [] : [accel]);
            if (accel === '<Super>space')
                toast(ctx, 'Note: <Super>space is also used by GNOME for input source switching');
        });
    });
    clear.connect('clicked', () => ctx.settings.set('menu-hotkey', []));

    row.add_suffix(label);
    row.add_suffix(set);
    row.add_suffix(clear);
    return row;
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

    page.add(group(ctx, 'Hotkeys', [
        switchRow(ctx, 'super-key-toggle', 'Super key opens the menu', 'Pressing and releasing the Super key toggles the menu instead of the Activities overview'),
        hotkeyRow(ctx),
    ]));

    page.add(group(ctx, 'Behaviour', [
        switchRow(ctx, 'activate-on-launch', 'Switch to the app when it is already running', 'Activate the existing window instead of opening a new one'),
        switchRow(ctx, 'keep-open-on-ctrl-click', 'Keep the menu open on Ctrl+click', 'Launch several apps in a row'),
        switchRow(ctx, 'show-tooltips', 'Show tooltips'),
    ], {
        reset: ['activate-on-launch', 'keep-open-on-ctrl-click', 'show-tooltips'],
    }));

    const resetAll = new Gtk.Button({label: 'Reset General Settings', halign: Gtk.Align.CENTER, css_classes: ['destructive-action', 'pill']});
    resetAll.connect('clicked', () => {
        resetKeys(ctx, [
            'position-in-panel', 'menu-button-position-offset', 'multi-monitor', 'hide-activities-button',
            'super-key-toggle', 'menu-hotkey', 'activate-on-launch', 'keep-open-on-ctrl-click', 'show-tooltips',
        ]);
        toast(ctx, 'General settings reset to defaults');
    });
    const tail = new Adw.PreferencesGroup();
    tail.add(resetAll);
    page.add(tail);
    return page;
}

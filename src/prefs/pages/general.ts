// Preferences page "General": panel position, Activities button, hotkeys, runner, behaviour.
//
// Public API:
//   createGeneralPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import type {PrefsContext} from '../context.js';
import {captureShortcut} from '../shortcutDialog.js';
import {enumRow, group, label, resetWithUndo, spinRow, switchRow, toast, watch} from '../widgets.js';

interface AcceleratorOptions {
    key: 'spawn-hotkey' | 'runner-hotkey';
    /** Title of the first / only row, and its subtitle; further rows are numbered. */
    title: string;
    subtitle: string;
}

/** One row per accelerator of the `as` setting `opts.key` plus an "Add" row, kept in `g` (live). */
function acceleratorRows(ctx: PrefsContext, g: Adw.PreferencesGroup, opts: AcceleratorOptions): void {
    const key = opts.key;
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
                title: list.length === 1 ? opts.title : `${opts.title} ${index + 1}`,
                subtitle: index === 0 ? opts.subtitle : undefined,
            });
            const shown = new Gtk.ShortcutLabel({accelerator: accel, valign: Gtk.Align.CENTER});
            const change = new Gtk.Button({label: 'Change', valign: Gtk.Align.CENTER});
            label(change, `Change shortcut ${accel}`);
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
            title: list.length === 0 ? opts.title : 'Add another shortcut',
            subtitle: list.length === 0 ? opts.subtitle : undefined,
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
}

/** Hotkeys group: the Super key switch plus the custom accelerators of the menu. */
function hotkeyGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const g = new Adw.PreferencesGroup({title: 'Hotkeys'});
    g.add(switchRow(ctx, 'super-key-toggle', 'Super key opens the menu', 'Pressing and releasing the Super key toggles the menu instead of the Activities overview'));
    acceleratorRows(ctx, g, {
        key: 'spawn-hotkey',
        title: 'Custom shortcut',
        subtitle: 'An extra shortcut that opens and closes the menu',
    });
    return g;
}

/** Runner shortcut(s): the runner is a search-only popup that does not need the panel button. */
function runnerHotkeyGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const g = new Adw.PreferencesGroup({
        title: 'Runner',
        description: 'A search-only popup on the monitor under the pointer. It can also be opened with the D-Bus method ToggleRunner of io.github.djshiye.Spawn',
    });
    acceleratorRows(ctx, g, {
        key: 'runner-hotkey',
        title: 'Runner shortcut',
        subtitle: 'Opens and closes the runner',
    });
    return g;
}

/** `menu-position-alignment`: a 0..100 slider (Left - Center - Right), shown only while the button is centred in the panel. */
function alignmentRow(ctx: PrefsContext): Adw.ActionRow {
    const scale = new Gtk.Scale({
        orientation: Gtk.Orientation.HORIZONTAL,
        adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 1, page_increment: 10, value: ctx.settings.get('menu-position-alignment')}),
        digits: 0,
        draw_value: false,
        hexpand: true,
        valign: Gtk.Align.CENTER,
        width_request: 220,
    });
    scale.add_mark(0, Gtk.PositionType.BOTTOM, 'Left');
    scale.add_mark(50, Gtk.PositionType.BOTTOM, 'Center');
    scale.add_mark(100, Gtk.PositionType.BOTTOM, 'Right');
    label(scale, 'Menu alignment');
    ctx.settings.raw.bind('menu-position-alignment', scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    const row = new Adw.ActionRow({
        title: 'Menu alignment',
        subtitle: 'Where the menu sits relative to a button centred in the panel',
        activatable_widget: scale,
    });
    row.add_suffix(scale);
    const refresh = (): void => {
        row.visible = ctx.settings.get('position-in-panel') === 'Center';
    };
    refresh();
    watch(ctx, row, ['position-in-panel'], refresh);
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
        alignmentRow(ctx),
        spinRow(ctx, 'menu-button-position-offset', 'Position offset', 0, 20, {
            subtitle: 'Number of panel items to skip from the chosen edge',
        }),
        switchRow(ctx, 'multi-monitor', 'Show on every monitor', 'Add the menu button to the panel of each monitor (Dash to Panel)'),
        switchRow(ctx, 'hide-activities-button', 'Hide the Activities button', 'Restored to its previous state when the extension is disabled'),
    ]));

    page.add(hotkeyGroup(ctx));
    page.add(runnerHotkeyGroup(ctx));
    page.add(group(ctx, 'Runner layout', [
        enumRow(ctx, 'runner-position', 'Position', [['Top', 'Top'], ['Centered', 'Centered']], 'Where the runner opens on the monitor'),
        spinRow(ctx, 'runner-menu-width', 'Width', 300, 2000, {step: 10, subtitle: 'In pixels'}),
        spinRow(ctx, 'runner-menu-height', 'Maximum height', 300, 1000, {step: 10, subtitle: 'The runner grows with its results up to this height'}),
        spinRow(ctx, 'runner-font-size', 'Font size', 0, 30, {subtitle: 'In points; 0 uses the menu font'}),
        enumRow(ctx, 'runner-default-view', 'Before typing', [['Default', 'Nothing'], ['Pinned_Apps', 'Pinned apps'], ['Frequent_Apps', 'Frequent apps']]),
    ], {
        reset: ['runner-position', 'runner-menu-width', 'runner-menu-height', 'runner-font-size', 'runner-default-view'],
    }));

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
            'position-in-panel', 'menu-position-alignment', 'menu-button-position-offset', 'multi-monitor', 'hide-activities-button',
            'super-key-toggle', 'spawn-hotkey', 'runner-hotkey', 'runner-position', 'runner-menu-width',
            'runner-menu-height', 'runner-font-size', 'runner-default-view', 'activate-on-launch', 'keep-open-on-ctrl-click', 'show-tooltips',
        ], 'General settings reset to defaults');
    });
    const tail = new Adw.PreferencesGroup();
    tail.add(resetAll);
    page.add(tail);
    return page;
}

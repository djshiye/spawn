// Preferences page "General": the panel button, the shortcuts that open the menu, behaviour, and rows that open
// the Runner and "Keys in the menu" sub-pages.
//
// Public API:
//   createGeneralPage(ctx: PrefsContext): Adw.PreferencesPage
//   PrefsContext (prefs/context.ts): {settings, extensionDir, window, metadata}

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk?version=4.0';

import type {PrefsContext} from '../context.js';
import {captureShortcut} from '../shortcutDialog.js';
import {enumRow, group, label, spinRow, subpageGroup, switchRow, toast, watch} from '../widgets.js';
import {createShortcutsGroup} from './about.js';
import {panelButtonGroup} from './button.js';

interface AcceleratorOptions {
    key: 'spawn-hotkey' | 'runner-hotkey';
    /** Title of the first / only row, and its subtitle; further rows are numbered. */
    title: string;
    subtitle: string;
}

/** Human label of an accelerator ("Super+Space"), the raw string when it cannot be parsed. */
function accelLabel(accel: string): string {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    return ok && mods !== null ? Gtk.accelerator_get_label(keyval, mods) : accel;
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
                const otherKey = key === 'spawn-hotkey' ? 'runner-hotkey' : 'spawn-hotkey';
                if (ctx.settings.get(otherKey).includes(accel)) {
                    toast(ctx, `Already used by the ${key === 'spawn-hotkey' ? 'runner' : 'menu'} shortcut`);
                    return;
                }
                next[index] = accel;
            }
            write(next);
            if (accel === '<Super>space')
                toast(ctx, `Note: ${accelLabel(accel)} is also used by GNOME for input source switching`);
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
            label(change, `Change shortcut ${accelLabel(accel)}`);
            change.connect('clicked', () => capture(index));
            const remove = new Gtk.Button({
                icon_name: 'edit-delete-symbolic',
                valign: Gtk.Align.CENTER,
                tooltip_text: 'Remove the shortcut',
                css_classes: ['flat'],
            });
            label(remove, `Remove shortcut ${accelLabel(accel)}`);
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
        label(addButton, list.length === 0 ? `Set ${opts.title}` : `Add another shortcut for ${opts.title}`);
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
    const g = new Adw.PreferencesGroup({title: 'Opening the menu'});
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
        title: 'Shortcut',
        description: 'The runner is a search-only popup that opens on the monitor under the pointer.',
    });
    acceleratorRows(ctx, g, {
        key: 'runner-hotkey',
        title: 'Runner shortcut',
        subtitle: 'Opens and closes the runner',
    });
    return g;
}

/** "Not set" or the runner's shortcut(s), for the Runner row's subtitle. */
function runnerSummary(ctx: PrefsContext): string {
    const keys = ctx.settings.get('runner-hotkey').filter(k => k.trim() !== '');
    return keys.length === 0 ? 'Off until you give it a shortcut' : `Opens with ${keys.map(accelLabel).join(' or ')}`;
}

function runnerGroups(ctx: PrefsContext): Adw.PreferencesGroup[] {
    return [
        runnerHotkeyGroup(ctx),
        group(ctx, 'Runner layout', [
            enumRow(ctx, 'runner-position', 'Position', [['Top', 'Top'], ['Centered', 'Centred']], 'Where the runner opens on the monitor'),
            spinRow(ctx, 'runner-menu-width', 'Width', 300, 2000, {step: 10, subtitle: 'In pixels'}),
            spinRow(ctx, 'runner-menu-height', 'Maximum height', 300, 1000, {step: 10, subtitle: 'The runner grows with its results up to this height'}),
            spinRow(ctx, 'runner-font-size', 'Font size', 0, 30, {subtitle: 'In points', special: [{value: 0, label: 'Menu font'}]}),
            enumRow(ctx, 'runner-default-view', 'Before typing', [['Default', 'Nothing'], ['Pinned_Apps', 'Pinned apps'], ['Frequent_Apps', 'Frequent apps']]),
            switchRow(ctx, 'runner-run-commands', 'Run commands', 'Run what you type, like the Run dialog (Alt+F2)'),
        ], {
            reset: ['runner-position', 'runner-menu-width', 'runner-menu-height', 'runner-font-size', 'runner-default-view', 'runner-run-commands'],
        }),
    ];
}

export function createGeneralPage(ctx: PrefsContext): Adw.PreferencesPage {
    const page = new Adw.PreferencesPage({
        name: 'general',
        title: 'General',
        icon_name: 'preferences-system-symbolic',
    });

    page.add(panelButtonGroup(ctx));

    page.add(hotkeyGroup(ctx));

    page.add(group(ctx, 'Behaviour', [
        switchRow(ctx, 'activate-on-launch', 'Switch to the app when it is already running', 'Activate the existing window instead of opening a new one'),
        switchRow(ctx, 'keep-open-on-ctrl-click', 'Keep the menu open on Ctrl+click', 'Launch several apps in a row'),
        switchRow(ctx, 'show-tooltips', 'Show tooltips'),
    ], {
        reset: ['activate-on-launch', 'keep-open-on-ctrl-click', 'show-tooltips'],
    }));

    page.add(subpageGroup(ctx, 'More', [
        {
            title: 'Runner',
            subtitle: () => runnerSummary(ctx),
            keys: ['runner-hotkey'],
            icon: 'system-search-symbolic',
            build: () => runnerGroups(ctx),
        },
        {
            title: 'Keys in the menu',
            subtitle: 'Every key the open menu answers to',
            icon: 'input-keyboard-symbolic',
            build: () => [createShortcutsGroup(ctx)],
        },
    ]));
    return page;
}

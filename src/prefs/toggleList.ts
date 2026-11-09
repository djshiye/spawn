// A reorderable list of switches for an a(ib) setting ((id, enabled) pairs; the order of the list is the
// order on screen): the power buttons and the category quick links.
//
// Public API:
//   toggleListGroup(ctx, spec): Adw.PreferencesGroup
//   ToggleListSpec: {key ('power-options' | 'arcmenu-extra-categories-links'), title, description,
//                    items: [id, title, icon][], fallbackIcon, resetKeys (the group's Reset button),
//                    resetMessage (its Undo toast), extraRows? (rows appended after the toggles)}
//   Rows are rebuilt on every change; the focus returns to the switch / arrow button that was used.

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import type {SettingKey} from '../core/settings.js';
import type {PrefsContext} from './context.js';
import {label, LIST_ICON_SIZE, resetButton, resetWithUndo, watch} from './widgets.js';

export interface ToggleListSpec {
    key: 'power-options' | 'arcmenu-extra-categories-links';
    title: string;
    description: string;
    items: ReadonlyArray<readonly [number, string, string]>;
    fallbackIcon: string;
    resetKeys: readonly SettingKey[];
    resetMessage: string;
    /** Extra rows appended to the group after the toggle rows (covered by the Reset button via resetKeys). */
    extraRows?: Gtk.Widget[];
}

export function toggleListGroup(ctx: PrefsContext, spec: ToggleListSpec): Adw.PreferencesGroup {
    const key = spec.key;
    const g = new Adw.PreferencesGroup({title: spec.title, description: spec.description});
    let rows: Adw.ActionRow[] = [];
    // Rows are rebuilt on every change; remember which button to focus again afterwards.
    const buttons = new Map<string, Gtk.Widget>();
    let pendingFocus: string[] | null = null;

    const build = (): void => {
        for (const row of rows)
            g.remove(row);
        for (const row of spec.extraRows ?? []) {
            if (row.get_parent())
                g.remove(row);
        }
        rows = [];
        buttons.clear();
        const list = ctx.settings.get(key);
        list.forEach(([id, enabled], index) => {
            const info = spec.items.find(p => p[0] === id);
            const row = new Adw.ActionRow({title: info?.[1] ?? `Option ${id}`});
            row.add_prefix(new Gtk.Image({icon_name: info?.[2] ?? spec.fallbackIcon, pixel_size: LIST_ICON_SIZE}));
            const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: enabled});
            label(toggle, `Show ${row.title}`);
            toggle.connect('notify::active', () => {
                const next = ctx.settings.get(key).map(([i, e]): [number, boolean] => (i === id ? [i, toggle.active] : [i, e]));
                if (JSON.stringify(next) !== JSON.stringify(ctx.settings.get(key))) {
                    pendingFocus = [`sw:${index}`]; // the rebuild below replaces this very switch
                    ctx.settings.set(key, next);
                }
            });
            const move = (delta: number): void => {
                const next = ctx.settings.get(key);
                const [item] = next.splice(index, 1);
                next.splice(index + delta, 0, item as [number, boolean]);
                pendingFocus = delta < 0 ? [`up:${index + delta}`, `down:${index + delta}`] : [`down:${index + delta}`, `up:${index + delta}`];
                ctx.settings.set(key, next);
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
        for (const row of spec.extraRows ?? [])
            g.add(row);
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

    const reset = resetButton(ctx, spec.title, spec.resetKeys, () => resetWithUndo(ctx, spec.resetKeys, spec.resetMessage));
    g.set_header_suffix(reset);
    return g;
}

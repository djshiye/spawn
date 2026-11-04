// Small builders for settings-bound Adwaita rows, shared by every prefs page.
//
// Public API:
//   watch(ctx, widget, keys, cb)       call cb when any of `keys` changes; auto-disconnects
//   switchRow / spinRow / enumRow / entryRow / colorRow
//   optionalColorRow / optionalSpinRow  rows for the (bs) / (bi) override keys
//   group(title, rows, {description?, reset?})   PreferencesGroup with an optional Reset button
//   resetKeys(ctx, keys)               resets keys in a single delay()/apply() batch
//   toast(ctx, message)

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import type {SettingKey} from '../core/settings.js';
import type {PrefsContext} from './context.js';

export type Option = readonly [nick: string, label: string];

export function watch(ctx: PrefsContext, widget: Gtk.Widget, keys: readonly SettingKey[], cb: () => void): void {
    const raw = ctx.settings.raw;
    const ids = keys.map(key => raw.connect(`changed::${key}`, cb));
    widget.connect('destroy', () => ids.forEach(id => raw.disconnect(id)));
}

export function toast(ctx: PrefsContext, message: string): void {
    ctx.window.add_toast(new Adw.Toast({title: message, timeout: 3}));
}

export function resetKeys(ctx: PrefsContext, keys: readonly SettingKey[]): void {
    const raw = ctx.settings.raw;
    raw.delay();
    for (const key of keys)
        raw.reset(key);
    raw.apply();
}

export function group(
    ctx: PrefsContext,
    title: string,
    rows: readonly Gtk.Widget[],
    opts: {description?: string; reset?: readonly SettingKey[]; suffix?: Gtk.Widget} = {},
): Adw.PreferencesGroup {
    const g = new Adw.PreferencesGroup({title});
    if (opts.description)
        g.set_description(opts.description);
    for (const row of rows)
        g.add(row);
    if (opts.suffix) {
        g.set_header_suffix(opts.suffix);
    } else if (opts.reset) {
        const keys = opts.reset;
        const button = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Restore the defaults of this section',
            css_classes: ['flat'],
        });
        button.connect('clicked', () => {
            resetKeys(ctx, keys);
            toast(ctx, `${title} reset to defaults`);
        });
        g.set_header_suffix(button);
    }
    return g;
}

export function switchRow(ctx: PrefsContext, key: SettingKey, title: string, subtitle?: string): Adw.SwitchRow {
    const row = new Adw.SwitchRow({title});
    if (subtitle)
        row.set_subtitle(subtitle);
    ctx.settings.raw.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function spinAdjustment(value: number, min: number, max: number, step = 1): Gtk.Adjustment {
    return new Gtk.Adjustment({lower: min, upper: max, step_increment: step, page_increment: step * 5, value});
}

export function spinRow(
    ctx: PrefsContext,
    key: SettingKey,
    title: string,
    min: number,
    max: number,
    opts: {step?: number; subtitle?: string} = {},
): Adw.SpinRow {
    const row = new Adw.SpinRow({
        title,
        adjustment: spinAdjustment(ctx.settings.get(key) as number, min, max, opts.step ?? 1),
    });
    if (opts.subtitle)
        row.set_subtitle(opts.subtitle);
    ctx.settings.raw.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export function entryRow(ctx: PrefsContext, key: SettingKey, title: string): Adw.EntryRow {
    const row = new Adw.EntryRow({title});
    ctx.settings.raw.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** ComboRow over an enum key (stored as its nick string). */
export function enumRow(ctx: PrefsContext, key: SettingKey, title: string, options: readonly Option[], subtitle?: string): Adw.ComboRow {
    const raw = ctx.settings.raw;
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(options.map(o => o[1]))});
    if (subtitle)
        row.set_subtitle(subtitle);
    const sync = (): void => {
        const idx = options.findIndex(o => o[0] === raw.get_string(key));
        if (idx >= 0 && row.selected !== idx)
            row.selected = idx;
    };
    sync();
    row.connect('notify::selected', () => {
        const nick = options[row.selected]?.[0];
        if (nick !== undefined && raw.get_string(key) !== nick)
            raw.set_string(key, nick);
    });
    watch(ctx, row, [key], sync);
    return row;
}

function parseColor(text: string): Gdk.RGBA {
    const rgba = new Gdk.RGBA();
    if (!rgba.parse(text))
        rgba.parse('rgba(0,0,0,0)');
    return rgba;
}

function colorButton(title: string, initial: string, onChange: (css: string) => void): {button: Gtk.ColorDialogButton; set(css: string): void} {
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({title, with_alpha: true, modal: true}),
        valign: Gtk.Align.CENTER,
    });
    let syncing = true;
    button.set_rgba(parseColor(initial));
    syncing = false;
    button.connect('notify::rgba', () => {
        if (!syncing)
            onChange(button.get_rgba().to_string());
    });
    return {
        button,
        set(css: string) {
            if (button.get_rgba().to_string() === parseColor(css).to_string())
                return;
            syncing = true;
            button.set_rgba(parseColor(css));
            syncing = false;
        },
    };
}

export function colorRow(ctx: PrefsContext, key: SettingKey, title: string, subtitle?: string): Adw.ActionRow {
    const row = new Adw.ActionRow({title});
    if (subtitle)
        row.set_subtitle(subtitle);
    const c = colorButton(title, ctx.settings.get(key) as string, css => {
        if (ctx.settings.get(key) !== css)
            ctx.settings.set(key, css as never);
    });
    row.add_suffix(c.button);
    row.set_activatable_widget(c.button);
    watch(ctx, row, [key], () => c.set(ctx.settings.get(key) as string));
    return row;
}

/** Row for a `(bs)` key: a switch that turns the override on plus a colour button. */
export function optionalColorRow(ctx: PrefsContext, key: SettingKey, title: string): Adw.ActionRow {
    const read = (): [boolean, string] => ctx.settings.get(key) as [boolean, string];
    const row = new Adw.ActionRow({title});
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: read()[0]});
    const c = colorButton(title, read()[1], css => {
        const [on, current] = read();
        if (current !== css)
            ctx.settings.set(key, [on, css] as never);
    });
    c.button.set_sensitive(toggle.active);
    toggle.connect('notify::active', () => {
        const [on, css] = read();
        if (on !== toggle.active)
            ctx.settings.set(key, [toggle.active, css] as never);
        c.button.set_sensitive(toggle.active);
    });
    row.add_suffix(c.button);
    row.add_suffix(toggle);
    row.set_activatable_widget(toggle);
    watch(ctx, row, [key], () => {
        const [on, css] = read();
        toggle.set_active(on);
        c.set(css);
    });
    return row;
}

/** Row for a `(bi)` key: a switch that turns the override on plus a spin button. */
export function optionalSpinRow(ctx: PrefsContext, key: SettingKey, title: string, min: number, max: number): Adw.ActionRow {
    const read = (): [boolean, number] => ctx.settings.get(key) as [boolean, number];
    const row = new Adw.ActionRow({title});
    const toggle = new Gtk.Switch({valign: Gtk.Align.CENTER, active: read()[0]});
    const spin = new Gtk.SpinButton({valign: Gtk.Align.CENTER, adjustment: spinAdjustment(read()[1], min, max)});
    spin.set_sensitive(toggle.active);
    toggle.connect('notify::active', () => {
        const [on, value] = read();
        if (on !== toggle.active)
            ctx.settings.set(key, [toggle.active, value] as never);
        spin.set_sensitive(toggle.active);
    });
    spin.connect('value-changed', () => {
        const [on, value] = read();
        if (value !== spin.get_value_as_int())
            ctx.settings.set(key, [on, spin.get_value_as_int()] as never);
    });
    row.add_suffix(spin);
    row.add_suffix(toggle);
    row.set_activatable_widget(toggle);
    watch(ctx, row, [key], () => {
        const [on, value] = read();
        toggle.set_active(on);
        if (spin.get_value_as_int() !== value)
            spin.set_value(value);
    });
    return row;
}

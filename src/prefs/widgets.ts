// Small builders for settings-bound Adwaita rows, shared by every prefs page.
//
// Public API:
//   watch(ctx, widget, keys, cb)       call cb when any of `keys` changes; disconnected when the prefs
//                                      window closes (or the widget is destroyed)
//   onWindowClose(ctx, fn)             run fn once when the prefs window closes
//   label(widget, text)                sets the accessible label of a widget
//   switchRow / spinRow / enumRow / entryRow / colorRow
//   optionalColorRow / optionalSpinRow  rows for the (bs) / (bi) override keys
//   group(title, rows, {description?, reset?})   PreferencesGroup with an optional Reset button
//   resetKeys(ctx, keys)               resets keys in a single delay()/apply() batch
//   resetWithUndo(ctx, keys, message)  resetKeys + a toast whose Undo button restores the old values
//   toast(ctx, message, undo?)         plain-text toast; with `undo` it shows an Undo button (8 s)

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import type {SettingKey} from '../core/settings.js';
import type {PrefsContext} from './context.js';

export type Option = readonly [nick: string, label: string];

// A settings handler's closure references its widget, so the widget is never finalized while the
// Settings object lives and its `destroy` handler would never run. Handlers are therefore
// disposed with the window (close-request), which is also where stale callbacks would hurt.
const closers = new WeakMap<Gtk.Window, Array<() => void>>();

/** Runs `fn` once when the prefs window closes. */
export function onWindowClose(ctx: PrefsContext, fn: () => void): void {
    let list = closers.get(ctx.window);
    if (!list) {
        const fresh: Array<() => void> = [];
        list = fresh;
        closers.set(ctx.window, fresh);
        ctx.window.connect('close-request', () => {
            for (const close of fresh.splice(0))
                close();
            return false;
        });
    }
    list.push(fn);
}

/** Connects `raw` signals and disconnects them when `dispose` runs; safe to call dispose twice. */
export function connectDisposable(raw: Gio.Settings, signals: ReadonlyArray<readonly [string, () => void]>): () => void {
    const connect = (name: string, cb: () => void): number => (raw as unknown as {connect(n: string, f: () => void): number}).connect(name, cb);
    const ids = signals.map(([name, cb]) => connect(name, cb));
    let done = false;
    return () => {
        if (done)
            return;
        done = true;
        ids.forEach(id => raw.disconnect(id));
    };
}

export function watch(ctx: PrefsContext, widget: Gtk.Widget, keys: readonly SettingKey[], cb: () => void): void {
    const dispose = connectDisposable(ctx.settings.raw, keys.map(key => [`changed::${key}`, cb] as const));
    onWindowClose(ctx, dispose);
    widget.connect('destroy', dispose);
}

/** Sets the accessible name of a widget (icon-only buttons, spin buttons, colour buttons). */
export function label(widget: Gtk.Widget, text: string): void {
    widget.update_property([Gtk.AccessibleProperty.LABEL], [text]);
}

/** Plain-text toast (no Pango markup, so `&` and `<` in names are safe). `undo` adds an Undo button. */
export function toast(ctx: PrefsContext, message: string, undo?: () => void): void {
    const t = new Adw.Toast({title: message, use_markup: false, timeout: undo ? 8 : 3});
    if (undo) {
        t.set_button_label('Undo');
        t.connect('button-clicked', undo);
    }
    ctx.window.add_toast(t);
}

export function resetKeys(ctx: PrefsContext, keys: readonly SettingKey[]): void {
    const raw = ctx.settings.raw;
    raw.delay();
    for (const key of keys)
        raw.reset(key);
    raw.apply();
}

/** Resets `keys` (and the listed folders) and offers to bring the previous values back. */
export function resetWithUndo(ctx: PrefsContext, keys: readonly SettingKey[], message: string, folderIds: readonly string[] = []): void {
    const before = ctx.settings.snapshot(keys, folderIds);
    for (const id of folderIds)
        ctx.settings.deleteFolder(id);
    resetKeys(ctx, keys);
    toast(ctx, message, () => ctx.settings.restore(before));
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
        label(button, `Reset ${title}`);
        button.connect('clicked', () => resetWithUndo(ctx, keys, `${title} reset to defaults`));
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
    label(c.button, title);
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
    label(c.button, title);
    label(toggle, `Use custom ${title.toLowerCase()}`);
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
    label(spin, title);
    label(toggle, `Use custom ${title.toLowerCase()}`);
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

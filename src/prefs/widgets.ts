// Small builders for settings-bound Adwaita rows, shared by every prefs page.
//
// Public API:
//   watch(ctx, widget, keys, cb)       call cb when any of `keys` changes; disconnected when the prefs
//                                      window closes (or the widget is destroyed)
//   onWindowClose(ctx, fn)             run fn once when the prefs window closes
//   label(widget, text)                sets the accessible label of a widget
//   switchRow / spinRow / enumRow / entryRow / colorRow
//   optionalColorRow / optionalSpinRow  expander rows with an enable switch for the (bs) / (bi) override keys
//   group(title, rows, {description?, reset?})   PreferencesGroup with an optional Reset button
//   resetKeys(ctx, keys)               resets keys (one SpawnSettings.batch(); ctx.settings.raw is never delayed)
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

/** Runs `fn` once when the prefs window closes; the returned function drops it again. */
export function onWindowClose(ctx: PrefsContext, fn: () => void): () => void {
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
    const registered = list;
    registered.push(fn);
    return () => {
        const at = registered.indexOf(fn);
        if (at >= 0)
            registered.splice(at, 1);
    };
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
    // Not ctx.settings.raw.delay(): GSettings cannot leave delay mode, so later writes would stay pending.
    ctx.settings.batch(tx => {
        for (const key of keys)
            tx.reset(key);
    });
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

/** A spin value that displays as a word (e.g. -1 as "Default"); the stored number is unchanged. */
export interface SpecialValue {value: number; label: string}

/** Shows `special.label` instead of the number when the row's value equals `special.value`. */
export function showSpecialValues(row: Adw.SpinRow, specials: readonly SpecialValue[]): void {
    if (specials.length === 0)
        return;
    row.set_width_chars(9);
    row.connect('output', () => {
        const hit = specials.find(s => s.value === Math.round(row.value));
        if (!hit)
            return false;
        row.set_text(hit.label);
        return true;
    });
}

export function spinRow(
    ctx: PrefsContext,
    key: SettingKey,
    title: string,
    min: number,
    max: number,
    opts: {step?: number; subtitle?: string; special?: readonly SpecialValue[]} = {},
): Adw.SpinRow {
    const row = new Adw.SpinRow({
        title,
        adjustment: spinAdjustment(ctx.settings.get(key) as number, min, max, opts.step ?? 1),
    });
    if (opts.subtitle)
        row.set_subtitle(opts.subtitle);
    ctx.settings.raw.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    showSpecialValues(row, opts.special ?? []);
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

function colorButton(title: string, initial: string, onChange: (css: string) => void, dialogTitle = title): {button: Gtk.ColorDialogButton; set(css: string): void} {
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({title: dialogTitle, with_alpha: true, modal: true}),
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

export function colorRow(ctx: PrefsContext, key: SettingKey, title: string, subtitle?: string, groupTitle?: string): Adw.ActionRow {
    const row = new Adw.ActionRow({title});
    if (subtitle)
        row.set_subtitle(subtitle);
    const c = colorButton(title, ctx.settings.get(key) as string, css => {
        if (ctx.settings.get(key) !== css)
            ctx.settings.set(key, css as never);
    }, `Choose ${title} Colour`);
    label(c.button, groupTitle ? `${groupTitle}: ${title}` : title);
    row.add_suffix(c.button);
    row.set_activatable_widget(c.button);
    watch(ctx, row, [key], () => c.set(ctx.settings.get(key) as string));
    return row;
}

/** Row for a `(bs)` key: a switch that turns the override on plus a colour button. */
/**
 * Row for a `(bs)` key: GNOME's pattern for an optional override, an expander row whose header switch turns
 * it on (one control per row) with the colour inside. The subtitle says what is used now.
 */
export function optionalColorRow(ctx: PrefsContext, key: SettingKey, title: string, groupTitle?: string): Adw.ExpanderRow {
    const read = (): [boolean, string] => ctx.settings.get(key) as [boolean, string];
    const row = new Adw.ExpanderRow({title, show_enable_switch: true, enable_expansion: read()[0]});
    const c = colorButton(title, read()[1], css => {
        const [on, current] = read();
        if (current !== css)
            ctx.settings.set(key, [on, css] as never);
    }, `Choose ${groupTitle ? `${groupTitle} ` : ''}${title} Colour`);
    label(c.button, groupTitle ? `${groupTitle}: ${title}` : title);
    const inner = new Adw.ActionRow({title: 'Colour', activatable_widget: c.button});
    inner.add_suffix(c.button);
    row.add_row(inner);
    const subtitle = (): void => row.set_subtitle(read()[0] ? 'Custom' : 'Theme default');
    subtitle();
    row.connect('notify::enable-expansion', () => {
        const [on, css] = read();
        if (on !== row.enable_expansion)
            ctx.settings.set(key, [row.enable_expansion, css] as never);
        subtitle();
    });
    watch(ctx, row, [key], () => {
        const [on, css] = read();
        if (row.enable_expansion !== on)
            row.set_enable_expansion(on);
        c.set(css);
        subtitle();
    });
    return row;
}

/** Row for a `(bi)` key: like optionalColorRow, with a spin row inside (`unit` is shown in the subtitle). */
export function optionalSpinRow(ctx: PrefsContext, key: SettingKey, title: string, min: number, max: number, inner = 'Size', unit = 'px'): Adw.ExpanderRow {
    const read = (): [boolean, number] => ctx.settings.get(key) as [boolean, number];
    const row = new Adw.ExpanderRow({title, show_enable_switch: true, enable_expansion: read()[0]});
    const spin = new Adw.SpinRow({title: inner, adjustment: spinAdjustment(read()[1], min, max)});
    row.add_row(spin);
    const subtitle = (): void => {
        const [on, value] = read();
        row.set_subtitle(on ? `${value} ${unit}` : 'Theme default');
    };
    subtitle();
    row.connect('notify::enable-expansion', () => {
        const [on, value] = read();
        if (on !== row.enable_expansion)
            ctx.settings.set(key, [row.enable_expansion, value] as never);
        subtitle();
    });
    spin.connect('notify::value', () => {
        const [on, value] = read();
        const v = Math.round(spin.value);
        if (value !== v)
            ctx.settings.set(key, [on, v] as never);
    });
    watch(ctx, row, [key], () => {
        const [on, value] = read();
        if (row.enable_expansion !== on)
            row.set_enable_expansion(on);
        if (Math.round(spin.value) !== value)
            spin.set_value(value);
        subtitle();
    });
    return row;
}

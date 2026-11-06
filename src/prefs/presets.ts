// Theme presets in the Appearance page: a chooser, "save current as preset" and a manage dialog.
//
// A preset (theme/presets.ts, the `menu-themes` list in ArcMenu's format) is only a template: choosing one
// WRITES the eleven menu colour / shape keys and turns `override-menu-theme` on, in one
// SpawnSettings.batch with an Undo toast; `menu-themes` itself is never touched by that. "Follow the desktop
// theme" turns `override-menu-theme` off (the colour keys stay as they are). The chooser shows what the
// settings currently are: the matching preset (all eleven fields equal), else "Custom colours".
//
// Public API:
//   createPresetsGroup(ctx): Adw.PreferencesGroup   chooser + Save current + Manage rows
//   openPresetManager(ctx): void                    dialog: rename, move up / down, remove (with Undo)
//   applyPreset(ctx, preset): boolean               what choosing a preset does
//   currentColors(ctx): ThemeColors                 the eleven override values as set now
//   readPresets(ctx): ThemePreset[]                 the valid entries of `menu-themes`

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import type {SettingKey} from '../core/settings.js';
import type {ThemeColors} from '../theme/css.js';
import {
    findPreset, moveItem, parsePresets, presetFromColors, presetWrites, removeItem, renameItem, serializePresets,
    type ThemePreset, uniqueName,
} from '../theme/presets.js';
import type {PrefsContext} from './context.js';
import {promptText} from './lists.js';
import {connectDisposable, label, onWindowClose, toast, watch} from './widgets.js';

const FOLLOW = 'Follow the desktop theme';
const CUSTOM = 'Custom colours';

/** Every key choosing a preset may change (the snapshot for Undo). */
const APPLY_KEYS: readonly SettingKey[] = presetWrites({
    name: '', background: '', foreground: '', border: '', borderWidth: 0, borderRadius: 0, fontSize: 0,
    separator: '', itemHoverBg: '', itemHoverFg: '', itemActiveBg: '', itemActiveFg: '',
}).map(([key]) => key);
const WATCHED: readonly SettingKey[] = [...APPLY_KEYS, 'menu-themes'];

export function currentColors(ctx: PrefsContext): ThemeColors {
    const s = ctx.settings;
    return {
        background: s.get('menu-background-color'),
        foreground: s.get('menu-foreground-color'),
        border: s.get('menu-border-color'),
        borderWidth: s.get('menu-border-width'),
        borderRadius: s.get('menu-border-radius'),
        fontSize: s.get('menu-font-size'),
        separator: s.get('menu-separator-color'),
        itemHoverBg: s.get('menu-item-hover-bg-color'),
        itemHoverFg: s.get('menu-item-hover-fg-color'),
        itemActiveBg: s.get('menu-item-active-bg-color'),
        itemActiveFg: s.get('menu-item-active-fg-color'),
    };
}

export function readPresets(ctx: PrefsContext): ThemePreset[] {
    return parsePresets(ctx.settings.get('menu-themes')).presets;
}

function writePresets(ctx: PrefsContext, list: readonly ThemePreset[]): void {
    ctx.settings.set('menu-themes', serializePresets(list));
}

/** Writes the preset's keys together; false (nothing written) when GSettings rejects one. */
export function applyPreset(ctx: PrefsContext, preset: ThemePreset): boolean {
    const before = ctx.settings.snapshot(APPLY_KEYS);
    try {
        ctx.settings.batch(tx => {
            for (const [key, value] of presetWrites(preset)) {
                if (!tx.set(key, value as never))
                    throw new Error(`${key} rejected`);
            }
        });
    } catch {
        toast(ctx, `Could not apply "${preset.name}"`);
        return false;
    }
    toast(ctx, `Applied "${preset.name}"`, () => ctx.settings.restore(before));
    return true;
}

function flatButton(icon: string, tooltip: string, name = tooltip): Gtk.Button {
    const button = new Gtk.Button({icon_name: icon, tooltip_text: tooltip, valign: Gtk.Align.CENTER, css_classes: ['flat']});
    label(button, name);
    return button;
}

/** A small "Aa" tile in the preset's own colours; null when the CSS cannot be loaded. */
function swatch(p: ThemePreset): Gtk.Widget | null {
    try {
        const tile = new Gtk.Label({label: 'Aa', valign: Gtk.Align.CENTER, width_request: 40, height_request: 28});
        const css = new Gtk.CssProvider();
        css.load_from_string(`label { background-color: ${p.background}; color: ${p.foreground}; border: ${Math.max(1, p.borderWidth)}px solid ${p.border}; border-radius: 6px; font-weight: bold; }`);
        tile.get_style_context().add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
        return tile;
    } catch {
        return null;
    }
}

export function createPresetsGroup(ctx: PrefsContext): Adw.PreferencesGroup {
    const group = new Adw.PreferencesGroup({
        title: 'Presets',
        description: 'Choosing a preset fills in the colours and shape below and turns custom colours on.',
    });
    const combo = new Adw.ComboRow({title: 'Preset'});
    const save = new Gtk.Button({label: 'Save…', valign: Gtk.Align.CENTER, css_classes: ['flat']});
    label(save, 'Save the current colours as a preset');
    const saveRow = new Adw.ActionRow({
        title: 'Save current colours as a preset',
        activatable_widget: save,
    });
    saveRow.add_suffix(save);
    const manageRow = new Adw.ActionRow({title: 'Manage presets', subtitle: 'Rename, reorder or remove', activatable: true});
    manageRow.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
    group.add(combo);
    group.add(saveRow);
    group.add(manageRow);

    let syncing = false;
    let presets: ThemePreset[] = [];
    const sync = (): void => {
        presets = readPresets(ctx);
        const match = findPreset(presets, currentColors(ctx));
        syncing = true;
        combo.model = Gtk.StringList.new([FOLLOW, ...presets.map(p => p.name), CUSTOM]);
        if (!ctx.settings.get('override-menu-theme'))
            combo.selected = 0;
        else
            combo.selected = match >= 0 ? match + 1 : presets.length + 1;
        syncing = false;
        save.set_sensitive(match < 0);
        saveRow.set_subtitle(match < 0 ? '' : 'Not available while they already match a preset');
        manageRow.set_sensitive(presets.length > 0);
    };
    sync();

    combo.connect('notify::selected', () => {
        if (syncing)
            return;
        const i = combo.selected;
        if (i === 0) {
            ctx.settings.set('override-menu-theme', false);
        } else if (i <= presets.length) {
            const preset = presets[i - 1];
            if (preset)
                applyPreset(ctx, preset);
        } else if (!ctx.settings.get('override-menu-theme')) {
            ctx.settings.set('override-menu-theme', true);
        }
    });

    save.connect('clicked', () => {
        promptText(ctx, 'Save Preset', uniqueName(presets, 'My theme'), 'Save', name => {
            const list = readPresets(ctx);
            const colors = currentColors(ctx);
            if (findPreset(list, colors) >= 0)
                return;
            const saved = presetFromColors(uniqueName(list, name), colors);
            writePresets(ctx, [...list, saved]);
            toast(ctx, `Saved "${saved.name}"`);
        });
    });
    manageRow.connect('activated', () => openPresetManager(ctx));

    // Several keys change together when a preset is applied: refresh once, outside the signal emission.
    let pending = false;
    watch(ctx, group, WATCHED, () => {
        if (pending)
            return;
        pending = true;
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            pending = false;
            sync();
            return GLib.SOURCE_REMOVE;
        });
    });
    return group;
}

export function openPresetManager(ctx: PrefsContext): void {
    const dialog = new Adw.Dialog({title: 'Manage Presets', content_width: 460, content_height: 520});
    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(new Adw.HeaderBar());
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({description: 'Changes here only edit the saved list; the menu keeps its current colours.'});
    page.add(group);
    toolbar.set_content(page);
    dialog.set_child(toolbar);

    let rows: Gtk.Widget[] = [];
    const buttons = new Map<string, Gtk.Button>();
    let pendingFocus: string[] | null = null;

    const put = (list: readonly ThemePreset[]): void => writePresets(ctx, list);
    const move = (index: number, delta: number): void => {
        const target = index + delta;
        pendingFocus = [`${delta < 0 ? 'up' : 'down'}:${target}`, `${delta < 0 ? 'down' : 'up'}:${target}`];
        put(moveItem(readPresets(ctx), index, target));
    };
    const remove = (index: number): void => {
        const list = readPresets(ctx);
        const gone = list[index];
        if (!gone)
            return;
        const before = ctx.settings.snapshot(['menu-themes']);
        pendingFocus = [`del:${Math.min(index, list.length - 2)}`];
        put(removeItem(list, index));
        toast(ctx, `Removed "${gone.name}"`, () => ctx.settings.restore(before));
    };
    const restoreFocus = (): void => {
        const wanted = pendingFocus;
        pendingFocus = null;
        const target = wanted?.map(k => buttons.get(k)).find(b => b?.get_sensitive());
        if (target)
            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                target.grab_focus();
                return GLib.SOURCE_REMOVE;
            });
    };

    const build = (): void => {
        for (const row of rows)
            group.remove(row);
        rows = [];
        buttons.clear();
        const list = readPresets(ctx);
        if (list.length === 0) {
            const empty = new Adw.ActionRow({title: 'No saved presets', sensitive: false});
            group.add(empty);
            rows.push(empty);
            return;
        }
        list.forEach((preset, index) => {
            const row = new Adw.ActionRow({title: GLib.markup_escape_text(preset.name, -1)});
            const tile = swatch(preset);
            if (tile)
                row.add_prefix(tile);
            const rename = flatButton('document-edit-symbolic', 'Rename', `Rename ${preset.name}`);
            rename.connect('clicked', () => promptText(ctx, 'Rename Preset', preset.name, 'Rename', name => {
                const current = readPresets(ctx);
                if (current[index]?.name === preset.name)
                    put(renameItem(current, index, uniqueName(removeItem(current, index), name)));
            }));
            const up = flatButton('go-up-symbolic', 'Move up', `Move ${preset.name} up`);
            up.set_sensitive(index > 0);
            up.connect('clicked', () => move(index, -1));
            const down = flatButton('go-down-symbolic', 'Move down', `Move ${preset.name} down`);
            down.set_sensitive(index < list.length - 1);
            down.connect('clicked', () => move(index, 1));
            const del = flatButton('user-trash-symbolic', 'Remove', `Remove ${preset.name}`);
            del.connect('clicked', () => remove(index));
            buttons.set(`up:${index}`, up);
            buttons.set(`down:${index}`, down);
            buttons.set(`del:${index}`, del);
            row.add_suffix(rename);
            row.add_suffix(up);
            row.add_suffix(down);
            row.add_suffix(del);
            group.add(row);
            rows.push(row);
        });
        restoreFocus();
    };
    build();

    const disposeSignals = connectDisposable(ctx.settings.raw, [['changed::menu-themes', build]]);
    const unregister = onWindowClose(ctx, disposeSignals);
    dialog.connect('closed', () => {
        disposeSignals();
        unregister();
    });
    dialog.present(ctx.window);
}

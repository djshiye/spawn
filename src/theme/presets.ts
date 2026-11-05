// Menu theme presets: pure logic (no gi:// imports, so it runs under gjs -m tests and inside the
// migration mapping).
//
// A preset is one entry of the `menu-themes` key (type aas) in ArcMenu's format, so the ArcMenu import
// copies the key as it is: twelve strings
//   [name, background, foreground, border colour, border width, border radius, font size,
//    separator colour, hover bg, hover fg, active bg, active fg]
// (numbers are decimal strings). A preset is only a template: applying one WRITES the eleven override
// keys (menu-background-color ... menu-item-active-fg-color) plus `override-menu-theme` = true and never
// touches `menu-themes`; the keys are the source of truth for what the menu looks like.
//
// Public API:
//   PRESET_FIELDS = 12; BORDER_WIDTH_RANGE / BORDER_RADIUS_RANGE / FONT_SIZE_RANGE   [min, max] of the numeric fields
//   ThemePreset                    ThemeColors (theme/css.ts) + `name`
//   parsePreset(entry): {preset} | {error}        validates one aas entry (wrong shape, empty name, unsafe colour,
//                                                 non-numeric number => error; a number outside its range is clamped)
//   parsePresets(raw): {presets, warnings}        the valid entries in order, one warning per dropped one
//   serializePreset(p) / serializePresets(list)   back to the aas format (parse(serialize(p)) equals p)
//   presetFromColors(name, colors): ThemePreset   a preset from the current override values
//   presetColors(p): ThemeColors                  the colour/shape part of a preset
//   colorsEqual(a, b): boolean                    compares ALL eleven fields (colours ignoring case / spaces)
//   findPreset(presets, colors): number           index of the first preset whose fields all equal `colors`, else -1
//   presetWrites(p): PresetWrite[]                the key / value pairs applying `p` writes (12 entries: override on + 11 keys)
//   uniqueName(presets, wanted): string           `wanted`, or `wanted 2`, `wanted 3` ... when taken
//   moveItem(list, from, to) / removeItem(list, i) / renameItem(list, i, name)   immutable list edits for the manage dialog

import {sanitizeColor, type ThemeColors} from './css.js';

export const PRESET_FIELDS = 12;
export const BORDER_WIDTH_RANGE: readonly [number, number] = [0, 5];
export const BORDER_RADIUS_RANGE: readonly [number, number] = [0, 25];
export const FONT_SIZE_RANGE: readonly [number, number] = [8, 18];

export interface ThemePreset extends ThemeColors {
    name: string;
}

export type PresetWrite =
    | readonly ['override-menu-theme', boolean]
    | readonly ['menu-background-color' | 'menu-foreground-color' | 'menu-border-color' | 'menu-separator-color' |
        'menu-item-hover-bg-color' | 'menu-item-hover-fg-color' | 'menu-item-active-bg-color' | 'menu-item-active-fg-color', string]
    | readonly ['menu-border-width' | 'menu-border-radius' | 'menu-font-size', number];

export type ParsedPreset = {preset: ThemePreset; error?: undefined} | {preset?: undefined; error: string};

const INT_RE = /^\s*-?\d{1,6}\s*$/;

function clamp(n: number, range: readonly [number, number]): number {
    return Math.min(Math.max(n, range[0]), range[1]);
}

export function parsePreset(entry: unknown): ParsedPreset {
    if (!Array.isArray(entry))
        return {error: 'not a list of strings'};
    if (entry.length !== PRESET_FIELDS)
        return {error: `has ${entry.length} fields instead of ${PRESET_FIELDS}`};
    if (!entry.every(v => typeof v === 'string'))
        return {error: 'contains a value that is not a string'};
    const f = entry as string[];
    const name = (f[0] as string).trim();
    if (name === '')
        return {error: 'has an empty name'};
    const colours: string[] = [];
    for (const [i, what] of [[1, 'background'], [2, 'text'], [3, 'border'], [7, 'separator'], [8, 'hover background'],
        [9, 'hover text'], [10, 'pressed background'], [11, 'pressed text']] as const) {
        const colour = sanitizeColor(f[i]);
        if (colour === null)
            return {error: `has an unusable ${what} colour '${String(f[i])}'`};
        colours.push(colour);
    }
    const ints: number[] = [];
    for (const [i, what, range] of [[4, 'border width', BORDER_WIDTH_RANGE], [5, 'corner radius', BORDER_RADIUS_RANGE],
        [6, 'font size', FONT_SIZE_RANGE]] as const) {
        if (!INT_RE.test(f[i] as string))
            return {error: `has a ${what} that is not a number ('${String(f[i])}')`};
        ints.push(clamp(parseInt(f[i] as string, 10), range));
    }
    const [background, foreground, border, separator, itemHoverBg, itemHoverFg, itemActiveBg, itemActiveFg] = colours as
        [string, string, string, string, string, string, string, string];
    const [borderWidth, borderRadius, fontSize] = ints as [number, number, number];
    return {preset: {name, background, foreground, border, borderWidth, borderRadius, fontSize, separator, itemHoverBg, itemHoverFg, itemActiveBg, itemActiveFg}};
}

/** Valid entries in order; every dropped one adds `warnings` text (`menu-themes[i] 'name': reason`). */
export function parsePresets(raw: unknown): {presets: ThemePreset[]; warnings: string[]} {
    const presets: ThemePreset[] = [];
    const warnings: string[] = [];
    if (!Array.isArray(raw)) {
        warnings.push('menu-themes: unexpected value format');
        return {presets, warnings};
    }
    raw.forEach((entry, i) => {
        const r = parsePreset(entry);
        if (r.preset) {
            presets.push(r.preset);
            return;
        }
        const name = Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].trim() !== '' ? ` '${entry[0].trim()}'` : '';
        warnings.push(`menu-themes: theme #${i + 1}${name} was not imported (${r.error})`);
    });
    return {presets, warnings};
}

export function serializePreset(p: ThemePreset): string[] {
    return [p.name, p.background, p.foreground, p.border, String(p.borderWidth), String(p.borderRadius), String(p.fontSize),
        p.separator, p.itemHoverBg, p.itemHoverFg, p.itemActiveBg, p.itemActiveFg];
}

export function serializePresets(list: readonly ThemePreset[]): string[][] {
    return list.map(serializePreset);
}

export function presetColors(p: ThemePreset): ThemeColors {
    const {name: _name, ...colors} = p;
    return colors;
}

export function presetFromColors(name: string, c: ThemeColors): ThemePreset {
    return {name, ...c};
}

const canon = (c: string): string => (sanitizeColor(c) ?? c).replace(/\s+/g, '').toLowerCase();

const COLOUR_FIELDS = ['background', 'foreground', 'border', 'separator', 'itemHoverBg', 'itemHoverFg', 'itemActiveBg', 'itemActiveFg'] as const;
const INT_FIELDS = ['borderWidth', 'borderRadius', 'fontSize'] as const;

/** All eleven fields equal (colours ignoring case and spaces). */
export function colorsEqual(a: ThemeColors, b: ThemeColors): boolean {
    return COLOUR_FIELDS.every(k => canon(a[k]) === canon(b[k])) && INT_FIELDS.every(k => a[k] === b[k]);
}

export function findPreset(presets: readonly ThemePreset[], colors: ThemeColors): number {
    return presets.findIndex(p => colorsEqual(p, colors));
}

export function presetWrites(p: ThemePreset): PresetWrite[] {
    return [
        ['override-menu-theme', true],
        ['menu-background-color', p.background],
        ['menu-foreground-color', p.foreground],
        ['menu-border-color', p.border],
        ['menu-border-width', p.borderWidth],
        ['menu-border-radius', p.borderRadius],
        ['menu-font-size', p.fontSize],
        ['menu-separator-color', p.separator],
        ['menu-item-hover-bg-color', p.itemHoverBg],
        ['menu-item-hover-fg-color', p.itemHoverFg],
        ['menu-item-active-bg-color', p.itemActiveBg],
        ['menu-item-active-fg-color', p.itemActiveFg],
    ];
}

export function uniqueName(presets: readonly ThemePreset[], wanted: string): string {
    const base = wanted.trim() || 'Custom';
    const taken = new Set(presets.map(p => p.name.trim().toLowerCase()));
    if (!taken.has(base.toLowerCase()))
        return base;
    for (let n = 2; ; n++) {
        const candidate = `${base} ${n}`;
        if (!taken.has(candidate.toLowerCase()))
            return candidate;
    }
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
    const out = [...list];
    if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to)
        return out;
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item as T);
    return out;
}

export function removeItem<T>(list: readonly T[], index: number): T[] {
    return list.filter((_, i) => i !== index);
}

export function renameItem(list: readonly ThemePreset[], index: number, name: string): ThemePreset[] {
    const trimmed = name.trim();
    if (trimmed === '' || index < 0 || index >= list.length)
        return [...list];
    return list.map((p, i) => (i === index ? {...p, name: trimmed} : p));
}

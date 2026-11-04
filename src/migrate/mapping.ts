// Pure ArcMenu -> Spawn Menu settings mapping. No gi:// imports: unit-tested with gjs -m
// against tests/fixtures/arcmenu-user.json (a snapshot of docs/research/user-arcmenu-settings.ini).
//
// Public API (re-exported by migrate/arcmenu.ts):
//   ArcMenuSnapshot, MigrationItem, SkippedItem, FolderPlan, MigrationPlan
//   planMigration(snapshot, spawnDefaults?): MigrationPlan
//   describeItem(item): string, describePlan(plan): string[]
//
// Rules: only keys the user actually changed in ArcMenu (`snapshot.values`) are migrated, so
// every other setting keeps Spawn Menu's own default. Every user-set key ends up either in
// `plan.items` (as `item.from`) or in `plan.skipped` with a reason. The only exception is
// `show-activities-button`, which is migrated from its effective value even when untouched,
// because ArcMenu hides the Activities button by default and the user would otherwise see it
// reappear.

import {ARCMENU_ID_PREFIX, ShortcutId, SPAWN_ID_PREFIX} from '../core/constants.js';
import {resolveButtonIcon} from '../core/icons.js';
import type {Entry, SettingKey} from '../core/settings.js';

export const ARCMENU_UUID = 'arcmenu@arcmenu.com';

export interface ArcMenuSnapshot {
    /** Keys the user changed in ArcMenu, with their (recursively unpacked) values. */
    values: Record<string, unknown>;
    /** ArcMenu's schema defaults for every key (used for derived keys and defaults checks). */
    defaults: Record<string, unknown>;
    /** pinned-apps-folders/<uuid>/pinned-apps for every folder that has stored contents. */
    folders: Record<string, Entry[]>;
}

export interface MigrationItem {
    key: SettingKey;
    /** The ArcMenu key (or comma separated keys) the value was derived from. */
    from: string;
    value: unknown;
    differsFromDefault: boolean;
}

export interface SkippedItem {
    key: string;
    reason: string;
}

export interface FolderPlan {
    uuid: string;
    name: string;
    pinnedApps: Entry[];
}

export interface MigrationPlan {
    items: MigrationItem[];
    folders: FolderPlan[];
    skipped: SkippedItem[];
    warnings: string[];
}

// ------------------------------------------------------------------------------------------
// Value kinds for keys that are copied as-is (same name, same format).

type Kind = 'b' | 'i' | 's' | 'bs' | 'bi' | 'a{si}' | 'a(ib)' | readonly string[];

const POSITION = ['Left', 'Center', 'Right'] as const;
const APPEARANCE = ['Icon', 'Text', 'Icon_Text', 'Text_Icon', 'None'] as const;
const VIEW = ['Pinned_Apps', 'Categories_List', 'Frequent_Apps', 'All_Programs', 'Pinned_And_Frequent_Apps'] as const;
const ALL_APPS = ['Categories_List', 'All_Programs'] as const;
const AVATAR = ['Round', 'Square'] as const;
const ICON_STYLE = ['Full_Color', 'Symbolic'] as const;
const POWER_STYLE = ['Default', 'In_Line', 'Menu'] as const;
const SEARCHBAR = ['Bottom', 'Top'] as const;

/** Spawn Menu key -> kind, for keys whose ArcMenu name is identical. */
const SAME_NAME: ReadonlyArray<readonly [SettingKey, Kind]> = [
    ['multi-monitor', 'b'],
    ['activate-on-launch', 'b'],
    ['keep-open-on-ctrl-click', 'b'],
    ['show-tooltips', 'b'],
    ['position-in-panel', POSITION],
    ['menu-button-position-offset', 'i'],
    ['menu-button-appearance', APPEARANCE],
    ['menu-button-text', 's'],
    ['menu-button-icon-size', 'i'],
    ['menu-button-padding', 'i'],
    ['default-menu-view', VIEW],
    ['all-apps-button-action', ALL_APPS],
    ['menu-height', 'i'],
    ['menu-width-adjustment', 'i'],
    ['left-panel-width', 'i'],
    ['right-panel-width', 'i'],
    ['vert-separator', 'b'],
    ['multi-lined-labels', 'b'],
    ['scrollbars-visible', 'b'],
    ['scrollbars-overlay', 'b'],
    ['scrollview-fade-effect', 'b'],
    ['show-user-avatar', 'b'],
    ['avatar-style', AVATAR],
    ['icon-size-apps', 'i'],
    ['icon-size-shortcuts', 'i'],
    ['icon-size-categories', 'i'],
    ['icon-size-buttons', 'i'],
    ['icon-size-misc', 'i'],
    ['icon-size-grid', 'a{si}'],
    ['icon-style-categories', ICON_STYLE],
    ['icon-style-shortcuts', ICON_STYLE],
    ['icon-style-buttons', ICON_STYLE],
    ['power-options', 'a(ib)'],
    ['power-display-style', POWER_STYLE],
    ['search-hidden', 'b'],
    ['max-search-results', 'i'],
    ['highlight-search-result-terms', 'b'],
    ['show-search-result-details', 'b'],
    ['search-provider-open-windows', 'b'],
    ['search-provider-recent-files', 'b'],
    ['show-hidden-recent-files', 'b'],
    ['apps-show-extra-details', 'b'],
    ['apps-show-generic-names', 'b'],
    ['search-entry-border-radius', 'bi'],
    ['override-menu-theme', 'b'],
    ['menu-background-color', 's'],
    ['menu-foreground-color', 's'],
    ['menu-border-color', 's'],
    ['menu-border-width', 'i'],
    ['menu-border-radius', 'i'],
    ['menu-font-size', 'i'],
    ['menu-separator-color', 's'],
    ['menu-item-hover-bg-color', 's'],
    ['menu-item-hover-fg-color', 's'],
    ['menu-item-active-bg-color', 's'],
    ['menu-item-active-fg-color', 's'],
    ['menu-button-fg-color', 'bs'],
    ['menu-button-bg-color', 'bs'],
    ['menu-button-border-radius', 'bi'],
    ['menu-button-border-width', 'bi'],
    ['menu-button-border-color', 'bs'],
    ['menu-button-hover-bg-color', 'bs'],
    ['menu-button-hover-fg-color', 'bs'],
    ['menu-button-active-bg-color', 'bs'],
    ['menu-button-active-fg-color', 'bs'],
    ['prefs-visible-page', 'i'],
];

/** Highest page index in prefs.ts PAGES; `prefs-visible-page` is clamped to it. */
const LAST_PREFS_PAGE = 6;

function isInt(v: unknown): v is number {
    return typeof v === 'number' && Number.isInteger(v);
}

function isEntryList(v: unknown): v is Entry[] {
    return Array.isArray(v) && v.every(e => e !== null && typeof e === 'object' && typeof (e as Entry).id === 'string');
}

function validKind(kind: Kind, v: unknown): boolean {
    if (Array.isArray(kind))
        return typeof v === 'string' && (kind as readonly string[]).includes(v);
    switch (kind as string) {
    case 'b': return typeof v === 'boolean';
    case 'i': return isInt(v);
    case 's': return typeof v === 'string';
    case 'bs': return Array.isArray(v) && v.length === 2 && typeof v[0] === 'boolean' && typeof v[1] === 'string';
    case 'bi': return Array.isArray(v) && v.length === 2 && typeof v[0] === 'boolean' && isInt(v[1]);
    case 'a{si}': return v !== null && typeof v === 'object' && !Array.isArray(v) &&
        Object.values(v as Record<string, unknown>).every(isInt);
    case 'a(ib)': return Array.isArray(v) && v.every(t => Array.isArray(t) && t.length === 2 && isInt(t[0]) && typeof t[1] === 'boolean');
    default: return false;
    }
}

export function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v: unknown): unknown {
    if (Array.isArray(v))
        return v.map(sortKeys);
    if (v !== null && typeof v === 'object') {
        const o = v as Record<string, unknown>;
        return Object.fromEntries(Object.keys(o).sort().map(k => [k, sortKeys(o[k])]));
    }
    return v;
}

// ------------------------------------------------------------------------------------------
// Keys that are deliberately not migrated, with the reason shown in the preview.

const NO_LAYOUT = 'Spawn Menu has a single layout';
const SKIP_EXACT: Readonly<Record<string, string>> = {
    'menu-layout': 'handled separately (Spawn Menu has a single layout)',
    'force-menu-location': 'menu placement is always anchored to the button',
    'menu-position-alignment': 'not supported in v1',
    'menu-arrow-rise': 'menu arrow is not used',
    'context-menu-items': 'the button context menu is not part of v1',
    'menu-themes': 'theme presets are not part of v1',
    'extra-categories': 'extra categories are not part of v1',
    'arcmenu-extra-categories-links': 'extra categories are not part of v1',
    'arcmenu-extra-categories-links-location': 'extra categories are not part of v1',
    'recently-installed-apps': 'ArcMenu internal state',
    'show-recently-installed-apps': 'not part of v1',
    'update-notifier-project-version': 'ArcMenu internal state',
    'update-notifier-enabled': 'ArcMenu internal state',
    'settings-width': 'ArcMenu internal state',
    'settings-height': 'ArcMenu internal state',
    'enable-horizontal-flip': 'not supported in v1',
    'dash-to-panel-standalone': 'not part of v1',
    'runner-hotkey': 'the standalone runner is not part of v1',
    'runner-hotkey-overlay-key-enabled': 'the standalone runner is not part of v1',
    'hotkey-open-primary-monitor': 'not supported in v1',
    'runner-hotkey-open-primary-monitor': 'the standalone runner is not part of v1',
    'activate-on-hover': 'not supported in v1',
    'show-category-sub-menus': 'not supported in v1',
    'group-apps-alphabetically-list-layouts': 'not part of v1',
    'group-apps-alphabetically-grid-layouts': 'not part of v1',
    'show-external-devices': 'not part of v1',
    'show-bookmarks': 'not part of v1',
    'enable-activities-shortcut': 'not part of v1',
    'searchbar-default-top-location': 'only the bottom-location key is read',
    'hide-overview-on-startup': 'not part of v1',
    'hide-overview-on-arcmenu-open': 'not part of v1',
    'enable-unity-homescreen': NO_LAYOUT,
    'pop-folders-data': NO_LAYOUT,
    'pop-default-view': NO_LAYOUT,
};
const SKIP_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^runner-/, 'the standalone runner is not part of v1'],
    [/^raven-/, NO_LAYOUT],
    [/^(az|brisk|eleven|insider|mint|sleek|zest|unity|windows)-layout-/, NO_LAYOUT],
    [/^default-menu-view-/, NO_LAYOUT],
    [/^(enable-(weather|clock)-widget-|gnome-dash-|plasma-)/, NO_LAYOUT],
    [/^windows-/, NO_LAYOUT],
    [/^pop-/, NO_LAYOUT],
];

function skipReason(key: string): string {
    return SKIP_EXACT[key] ?? SKIP_PATTERNS.find(([re]) => re.test(key))?.[1] ?? 'no equivalent in Spawn Menu v1';
}

// ------------------------------------------------------------------------------------------
// Entry (aa{ss}) conversion.

const KNOWN_SPAWN_IDS: ReadonlySet<string> = new Set(Object.values(ShortcutId));
const ICON_MARKER = '/__bundled__';

function rewritePrefix(s: string): string {
    return s.startsWith(ARCMENU_ID_PREFIX) ? SPAWN_ID_PREFIX + s.slice(ARCMENU_ID_PREFIX.length) : s;
}

function label(e: Entry): string {
    return e.name || e.id;
}

/**
 * Rewrites built-in ids and icons from ArcMenu_* to SpawnMenu_*; drops ArcMenu-only items
 * (settings entries, unknown built-ins, commands that launch ArcMenu's prefs).
 */
export function convertEntries(entries: Entry[], where: string, warnings: string[]): Entry[] {
    const out: Entry[] = [];
    for (const entry of entries) {
        const id = rewritePrefix(entry.id);
        if (id.startsWith(SPAWN_ID_PREFIX) && !KNOWN_SPAWN_IDS.has(id)) {
            warnings.push(`${where}: dropped '${label(entry)}' (ArcMenu-only item)`);
            continue;
        }
        if (entry.id.includes(ARCMENU_UUID)) {
            warnings.push(`${where}: dropped '${label(entry)}' (refers to ArcMenu)`);
            continue;
        }
        const copy: Entry = {...entry, id};
        if (entry.icon !== undefined) {
            const icon = rewritePrefix(entry.icon);
            if (icon.startsWith(SPAWN_ID_PREFIX) && !KNOWN_SPAWN_IDS.has(icon))
                delete copy.icon;
            else
                copy.icon = icon;
        }
        out.push(copy);
    }
    return out;
}

// ------------------------------------------------------------------------------------------

const CLICK_ACTION: Readonly<Record<string, 'Menu' | 'None'>> = {ArcMenu: 'Menu', ContextMenu: 'None', None: 'None'};

/** Maps an ArcMenu `menu-button-icon` value to Spawn Menu's format; null if unsupported. */
export function convertButtonIcon(value: string): string | null {
    const resolved = resolveButtonIcon(value, ICON_MARKER);
    if (resolved.kind === 'file')
        return resolved.path.startsWith(`${ICON_MARKER}/`) ? resolved.path.slice(ICON_MARKER.length + 1) : resolved.path;
    if (value.includes('://'))
        return null;
    return resolved.name;
}

export function planMigration(snapshot: ArcMenuSnapshot, spawnDefaults?: Partial<Record<SettingKey, unknown>>): MigrationPlan {
    const values = snapshot.values;
    const defaults = snapshot.defaults ?? {};
    const plan: MigrationPlan = {items: [], folders: [], skipped: [], warnings: []};
    const handled = new Set<string>();

    const effective = (key: string): unknown => (key in values ? values[key] : defaults[key]);
    const skip = (key: string, reason: string): void => {
        handled.add(key);
        plan.skipped.push({key, reason});
    };
    const add = (key: SettingKey, from: string, value: unknown): void => {
        for (const f of from.split(', '))
            handled.add(f);
        const differs = spawnDefaults && key in spawnDefaults ? !deepEqual(value, spawnDefaults[key]) : true;
        plan.items.push({key, from, value, differsFromDefault: differs});
    };
    const isSet = (key: string): boolean => key in values;

    // Straight copies.
    for (const [key, kind] of SAME_NAME) {
        if (!isSet(key))
            continue;
        const v = values[key];
        if (!validKind(kind, v)) {
            skip(key, 'unexpected value format');
            continue;
        }
        if (key === 'prefs-visible-page') {
            add(key, key, Math.min(Math.max(v as number, 0), LAST_PREFS_PAGE));
            continue;
        }
        add(key, key, v);
    }

    // Renamed keys.
    if (isSet('arcmenu-layout-max-frequent-apps')) {
        const v = values['arcmenu-layout-max-frequent-apps'];
        if (isInt(v))
            add('max-frequent-apps', 'arcmenu-layout-max-frequent-apps', v);
        else
            skip('arcmenu-layout-max-frequent-apps', 'unexpected value format');
    }
    if (isSet('searchbar-default-bottom-location')) {
        const v = values['searchbar-default-bottom-location'];
        if (typeof v === 'string' && (SEARCHBAR as readonly string[]).includes(v))
            add('search-entry-location', 'searchbar-default-bottom-location', v);
        else
            skip('searchbar-default-bottom-location', 'unexpected value format');
    }

    // Activities button: ArcMenu hides it by default, so migrate the effective value.
    const show = effective('show-activities-button');
    if (typeof show === 'boolean')
        add('hide-activities-button', 'show-activities-button', !show);

    // Hotkeys: Super_L + overlay flag -> super-key-toggle, anything else -> menu-hotkey.
    if (isSet('arcmenu-hotkey') || isSet('arcmenu-hotkey-overlay-key-enabled')) {
        const keys = effective('arcmenu-hotkey');
        const overlay = effective('arcmenu-hotkey-overlay-key-enabled');
        if (Array.isArray(keys) && keys.every(k => typeof k === 'string') && typeof overlay === 'boolean') {
            const hotkeys = keys as string[];
            add('super-key-toggle', 'arcmenu-hotkey-overlay-key-enabled', overlay && hotkeys.includes('Super_L'));
            const others = hotkeys.filter(k => k !== 'Super_L' && k !== '');
            add('menu-hotkey', 'arcmenu-hotkey', others);
            if (!overlay && hotkeys.includes('Super_L'))
                plan.warnings.push('ArcMenu had the Super key listed but disabled; the Super key toggle is off.');
        } else {
            skip('arcmenu-hotkey', 'unexpected value format');
            skip('arcmenu-hotkey-overlay-key-enabled', 'unexpected value format');
        }
    }

    // Button click actions.
    for (const side of ['left', 'right', 'middle'] as const) {
        const from = `menu-button-${side}-click-action`;
        if (!isSet(from))
            continue;
        const v = values[from];
        const mapped = typeof v === 'string' ? CLICK_ACTION[v] : undefined;
        if (!mapped) {
            skip(from, 'unexpected value format');
            continue;
        }
        if (v === 'ContextMenu')
            plan.warnings.push(`${from}: the button context menu is not part of v1; set to None`);
        add(from as SettingKey, from, mapped);
    }

    // Button icon.
    if (isSet('menu-button-icon')) {
        const v = values['menu-button-icon'];
        const mapped = typeof v === 'string' ? convertButtonIcon(v) : null;
        if (mapped === null) {
            skip('menu-button-icon', 'icon is not available in Spawn Menu');
            plan.warnings.push(`menu-button-icon: unsupported icon '${String(v)}'; keeping the default icon`);
        } else {
            add('menu-button-icon', 'menu-button-icon', mapped);
        }
    }

    // Layout.
    if (isSet('menu-layout')) {
        const v = values['menu-layout'];
        if (v === 'arcmenu') {
            skip('menu-layout', "ArcMenu's 'arcmenu' layout is Spawn Menu's only layout");
        } else {
            skip('menu-layout', 'Spawn Menu has a single layout');
            plan.warnings.push(`menu-layout '${String(v)}' is not available; Spawn Menu uses its own 'spawn' layout`);
        }
    }

    // Shortcut / pinned lists.
    for (const key of ['directory-shortcuts', 'application-shortcuts'] as const) {
        if (!isSet(key))
            continue;
        const v = values[key];
        if (!isEntryList(v)) {
            skip(key, 'unexpected value format');
            continue;
        }
        add(key, key, convertEntries(v, key, plan.warnings));
    }

    if (isSet('pinned-apps')) {
        const v = values['pinned-apps'];
        if (!isEntryList(v)) {
            skip('pinned-apps', 'unexpected value format');
        } else {
            const pinned = convertEntries(v, 'pinned-apps', plan.warnings);
            add('pinned-apps', 'pinned-apps', pinned);
            for (const entry of pinned) {
                if (entry.isFolder !== 'true')
                    continue;
                const contents = snapshot.folders[entry.id];
                if (!contents)
                    plan.warnings.push(`Folder '${label(entry)}' has no stored contents; it will be empty`);
                plan.folders.push({
                    uuid: entry.id,
                    name: entry.name ?? '',
                    pinnedApps: convertEntries(contents ?? [], `folder '${label(entry)}'`, plan.warnings),
                });
            }
        }
    }

    // Everything else the user set has no counterpart.
    for (const key of Object.keys(values)) {
        if (!handled.has(key))
            skip(key, skipReason(key));
    }
    plan.skipped.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return plan;
}

// ------------------------------------------------------------------------------------------
// Presentation helpers.

const POWER_NAMES = ['Log Out', 'Lock', 'Restart', 'Power Off', 'Suspend', 'Hybrid Sleep', 'Hibernate', 'Switch User'];

/** Short human-readable rendering of a setting value. */
export function describeValue(value: unknown, key?: string): string {
    if (Array.isArray(value)) {
        if (key === 'power-options' && value.every(Array.isArray)) {
            const on = (value as Array<[number, boolean]>).filter(([, enabled]) => enabled).map(([id]) => POWER_NAMES[id] ?? `#${id}`);
            return on.length ? `${on.join(', ')} (in this order)` : 'none enabled';
        }
        if (value.length && value.every(e => e !== null && typeof e === 'object' && 'id' in (e as object)))
            return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
        return JSON.stringify(value);
    }
    if (value !== null && typeof value === 'object')
        return JSON.stringify(value);
    return String(value);
}

export function describeItem(item: MigrationItem): string {
    const from = item.from === item.key ? '' : ` (from ${item.from})`;
    return `${item.key} = ${describeValue(item.value, item.key)}${from}`;
}

export function describePlan(plan: MigrationPlan): string[] {
    const lines: string[] = [];
    lines.push(`Will import (${plan.items.length}):`);
    for (const item of plan.items)
        lines.push(`  ${describeItem(item)}`);
    for (const f of plan.folders)
        lines.push(`  folder '${f.name}' with ${f.pinnedApps.length} apps`);
    if (plan.skipped.length) {
        lines.push(`Skipped (${plan.skipped.length}):`);
        for (const s of plan.skipped)
            lines.push(`  ${s.key}: ${s.reason}`);
    }
    if (plan.warnings.length) {
        lines.push(`Warnings (${plan.warnings.length}):`);
        for (const w of plan.warnings)
            lines.push(`  ${w}`);
    }
    return lines;
}

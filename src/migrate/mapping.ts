// Pure ArcMenu -> Spawn settings mapping. No gi:// imports: unit-tested with gjs -m
// against tests/fixtures/arcmenu-user.json (a snapshot of docs/research/user-arcmenu-settings.ini).
//
// Public API (re-exported by migrate/arcmenu.ts):
//   ArcMenuSnapshot, MigrationItem, SkippedItem, FolderPlan, MigrationPlan
//   planMigration(snapshot, spawnDefaults?, env?): MigrationPlan, PlanEnv, INT_RANGES
//   describeItem(item): string, describePlan(plan): string[], customisedKeys(snapshot): string[]
//
// Rules: only keys the user actually changed in ArcMenu (`snapshot.values`) are migrated, so
// every other setting keeps Spawn's own default. Every user-set key ends up either in
// `plan.items` (as `item.from`) or in `plan.skipped` with a reason. The only exception is
// `show-activities-button`, which is migrated from its effective value even when untouched,
// because ArcMenu hides the Activities button by default and the user would otherwise see it
// reappear.
//
// Also: integer keys with a schema <range> are clamped (INT_RANGES, with a warning); an app id
// that would appear twice across pinned-apps and its folders keeps its first position;
// `prefs-visible-page` is deliberately not migrated (ArcMenu's page order differs).
//
// planMigration(snapshot, spawnDefaults?, env?): env.iconExists(file) lets the caller veto a
// button icon that is not on disk (this module cannot touch the file system).

import {ARCMENU_ID_PREFIX, ContextMenuId, ShortcutId, SPAWN_ICON, SPAWN_ID_PREFIX} from '../core/constants.js';
import {resolveButtonIcon} from '../core/icons.js';
import {isValidFolderId} from '../core/folderId.js';
import {parsePresets, serializePresets} from '../theme/presets.js';
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

export interface PlanEnv {
    /** Is this `menu-button-icon` value usable (bundled file / absolute path exists)? Default: yes. */
    iconExists?(value: string): boolean;
}

/** Integer keys whose Spawn schema has a <range> (kept in sync by tests/migrate.test.js). */
export const INT_RANGES: Readonly<Record<string, readonly [min: number, max: number]>> = {
    'menu-height': [360, 1600],
    'menu-width-adjustment': [-350, 800],
    'left-panel-width': [420, 1200],
    'right-panel-width': [180, 600],
    'max-frequent-apps': [1, 50],
    'runner-menu-width': [300, 2000],
    'runner-menu-height': [300, 1000],
    'menu-position-alignment': [0, 100],
    'runner-font-size': [0, 30],
    'max-search-results': [1, 50],
};
/** `menu-arrow-rise` (bi): the px part is clamped to Spawn's 0..50 (ArcMenu allows -50..50; a negative rise pulls the menu over the panel). */
const ARROW_RISE_RANGE = [0, 50] as const;

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
const LOCATION = ['Bottom', 'Top'] as const;
const RUNNER_POSITION = ['Top', 'Centered'] as const;
/** ArcMenu's `default-menu-view-runner` nicks -> Spawn's `runner-default-view` ("Frequent Apps" has a space in ArcMenu). */
const RUNNER_VIEW: Readonly<Record<string, 'Default' | 'Pinned_Apps' | 'Frequent_Apps'>> = {
    'Default': 'Default', 'Pinned_Apps': 'Pinned_Apps', 'Frequent Apps': 'Frequent_Apps',
};

/**
 * How each ArcMenu layout (MenuLayoutsInfo id) displays its items: the `display_type` its
 * constructor passes to BaseMenuLayout (menulayouts/*.js). Layouts missing here (GNOME Overview,
 * unknown ids) leave Spawn's default.
 */
const PINNED_DISPLAY: Readonly<Record<string, 'List' | 'Grid'>> = {
    'arcmenu': 'List', 'brisk': 'List', 'budgie': 'List', 'gnome-menu': 'List', 'mint': 'List', 'whisker': 'List',
    'plasma': 'List', 'tognee': 'List', 'windows': 'List', 'zest': 'List', 'runner': 'List',
    '11': 'Grid', 'az': 'Grid', 'enterprise': 'Grid', 'insider': 'Grid', 'pop': 'Grid', 'redmond': 'Grid',
    'sleek': 'Grid', 'unity': 'Grid', 'chromebook': 'Grid', 'elementary': 'Grid', 'raven': 'Grid',
};

/** Spawn key -> kind, for keys whose ArcMenu name is identical. */
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
    ['runner-position', RUNNER_POSITION],
    ['runner-menu-width', 'i'],
    ['runner-menu-height', 'i'],
    // sidebar extras (the category quick links are derived in planMigration: they also depend on extra-categories)
    ['arcmenu-extra-categories-links-location', LOCATION],
    ['show-external-devices', 'b'],
    ['show-bookmarks', 'b'],
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
    // appearance-presets
    ['menu-position-alignment', 'i'],
    ['runner-font-size', 'i'],
];

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

const NO_LAYOUT = 'Spawn has a single layout';
const SKIP_EXACT: Readonly<Record<string, string>> = {
    'menu-layout': 'handled separately (Spawn has a single layout)',
    'force-menu-location': 'menu placement is always anchored to the button',
    'extra-categories': 'only used to decide which category quick links ArcMenu really shows; Spawn has no extra category rows',
    'recently-installed-apps': 'ArcMenu internal state',
    'show-recently-installed-apps': 'not part of v1',
    'update-notifier-project-version': 'ArcMenu internal state',
    'update-notifier-enabled': 'ArcMenu internal state',
    'settings-width': 'ArcMenu internal state',
    'settings-height': 'ArcMenu internal state',
    'enable-horizontal-flip': 'not supported in v1',
    'dash-to-panel-standalone': 'not part of v1',
    'runner-hotkey-overlay-key-enabled': "the Super key only opens Spawn's menu; give the runner an ordinary shortcut",
    'hotkey-open-primary-monitor': 'not supported in v1',
    'runner-hotkey-open-primary-monitor': 'the runner always opens on the monitor under the pointer',
    'runner-menu-height-static': 'the runner always grows with its results',
    'runner-searchbar-location': 'the runner search box is always on top',
    'runner-search-display-style': 'runner results are always a list',
    'runner-show-settings-button': 'the runner has no settings button',
    'activate-on-hover': 'not supported in v1',
    'show-category-sub-menus': 'not supported: Spawn lists the apps of a category flat (sub-folders are merged into their category)',
    'group-apps-alphabetically-list-layouts': 'not part of v1',
    'group-apps-alphabetically-grid-layouts': 'not part of v1',
    'enable-activities-shortcut': 'not part of v1',
    'searchbar-default-top-location': 'only the bottom-location key is read',
    'hide-overview-on-startup': 'not part of v1',
    'hide-overview-on-arcmenu-open': 'not part of v1',
    'prefs-visible-page': "ArcMenu's page order differs from Spawn's",
    'enable-unity-homescreen': NO_LAYOUT,
    'pop-folders-data': NO_LAYOUT,
    'pop-default-view': NO_LAYOUT,
};
const SKIP_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
    [/^runner-/, 'no equivalent in the Spawn runner'],
    [/^raven-/, NO_LAYOUT],
    [/^(az|brisk|eleven|insider|mint|sleek|zest|unity|windows)-layout-/, NO_LAYOUT],
    [/^default-menu-view-/, NO_LAYOUT],
    [/^(enable-(weather|clock)-widget-|gnome-dash-|plasma-)/, NO_LAYOUT],
    [/^windows-/, NO_LAYOUT],
    [/^pop-/, NO_LAYOUT],
];

/** ArcMenu bookkeeping keys every ArcMenu user has; they are not "customised settings" the user made. */
const BOOKKEEPING_KEYS: ReadonlySet<string> = new Set([
    'prefs-visible-page',
    'recently-installed-apps',
    'update-notifier-project-version',
    'update-notifier-enabled',
    'settings-width',
    'settings-height',
]);

/** Keys of `snapshot.values` the user really customised (without ArcMenu's own bookkeeping). */
export function customisedKeys(snapshot: ArcMenuSnapshot): string[] {
    return Object.keys(snapshot.values).filter(key => !BOOKKEEPING_KEYS.has(key));
}

function skipReason(key: string): string {
    return SKIP_EXACT[key] ?? SKIP_PATTERNS.find(([re]) => re.test(key))?.[1] ?? 'no equivalent in Spawn v1';
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
 * Rewrites built-in ids and icons from ArcMenu_* to Spawn_*; drops ArcMenu-only items
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

const ARCMENU_SETTINGS_PAGES: ReadonlySet<string> = new Set([
    'ArcMenu_SettingsMenu', 'ArcMenu_SettingsLayout', 'ArcMenu_SettingsButton', 'ArcMenu_SettingsAbout', 'ArcMenu_SettingsTheme',
]);
const ARCMENU_ICON = 'ArcMenu_ArcMenuIcon';

/**
 * `context-menu-items`: like convertEntries, but ArcMenu's own entries become Spawn's:
 * ArcMenu_Settings -> Spawn_Settings ("Spawn Settings", the Spawn button icon), ArcMenu_Settings<Page>
 * (no such pages in Spawn) -> Spawn_Settings with a warning, ArcMenu_PanelExtensionSettings ->
 * Spawn_PanelExtensionSettings, icon ArcMenu_ArcMenuIcon -> Spawn_SpawnIcon; everything else as in
 * convertEntries (apps kept, other ArcMenu_ ids -> Spawn_ or dropped with a warning).
 */
export function convertContextMenuEntries(entries: Entry[], where: string, warnings: string[]): Entry[] {
    const out: Entry[] = [];
    for (const entry of entries) {
        const icon = entry.icon === ARCMENU_ICON ? SPAWN_ICON : entry.icon;
        const isPage = ARCMENU_SETTINGS_PAGES.has(entry.id);
        if (entry.id === 'ArcMenu_Settings' || isPage) {
            if (isPage)
                warnings.push(`${where}: '${label(entry)}' opened an ArcMenu settings page; Spawn has no such page, using Spawn Settings`);
            // A name the user chose is kept; ArcMenu's own labels ("ArcMenu Settings", page names) become Spawn's.
            const custom = entry.id === 'ArcMenu_Settings' && entry.name && entry.name !== 'ArcMenu Settings' ? entry.name : 'Spawn Settings';
            out.push({id: ContextMenuId.SETTINGS, name: custom, icon: icon ?? SPAWN_ICON});
            continue;
        }
        if (entry.id === 'ArcMenu_PanelExtensionSettings') {
            out.push({...entry, id: ContextMenuId.PANEL_EXTENSION_SETTINGS, ...(icon === undefined ? {} : {icon})});
            continue;
        }
        const converted = convertEntries([entry], where, warnings)[0];
        if (!converted)
            continue;
        if (icon === SPAWN_ICON)
            converted.icon = SPAWN_ICON;
        out.push(converted);
    }
    return out;
}

const REPEATABLE = new Set<string>([ShortcutId.SEPARATOR, ShortcutId.SPACER]);

/** Drops repeated ids (separators and spacers may repeat); `seen` is shared across lists. */
export function dedupeEntries(entries: Entry[], where: string, warnings: string[], seen: Set<string> = new Set()): Entry[] {
    const out: Entry[] = [];
    for (const entry of entries) {
        if (!REPEATABLE.has(entry.id)) {
            if (seen.has(entry.id)) {
                warnings.push(`${where}: '${label(entry)}' appears more than once; only the first one is kept`);
                continue;
            }
            seen.add(entry.id);
        }
        out.push(entry);
    }
    return out;
}

/** Accelerators that are only a modifier key (e.g. 'Super_R') would swallow normal typing. */
const BARE_MODIFIER = /^(Shift|Control|Alt|Super|Meta|Hyper|ISO_Level\d_Shift|Caps_Lock|Num_Lock)(_[LR]|_Lock)?$/;

// ------------------------------------------------------------------------------------------

const CLICK_ACTION: Readonly<Record<string, 'Menu' | 'ContextMenu' | 'None'>> = {ArcMenu: 'Menu', ContextMenu: 'ContextMenu', None: 'None'};

/** Maps an ArcMenu `menu-button-icon` value to Spawn's format; null if unsupported. */
export function convertButtonIcon(value: string): string | null {
    const resolved = resolveButtonIcon(value, ICON_MARKER);
    if (resolved.kind === 'file')
        return resolved.path.startsWith(`${ICON_MARKER}/`) ? resolved.path.slice(ICON_MARKER.length + 1) : resolved.path;
    if (value.includes('://'))
        return null;
    return resolved.name;
}

export function planMigration(snapshot: ArcMenuSnapshot, spawnDefaults?: Partial<Record<SettingKey, unknown>>, env: PlanEnv = {}): MigrationPlan {
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
        const range = INT_RANGES[key];
        if (range && isInt(v)) {
            const clamped = Math.min(Math.max(v, range[0]), range[1]);
            if (clamped !== v)
                plan.warnings.push(`${key}: ${v} is outside Spawn's range ${range[0]}..${range[1]}; using ${clamped}`);
            add(key, key, clamped);
            continue;
        }
        add(key, key, v);
    }

    // Renamed keys.
    if (isSet('arcmenu-layout-max-frequent-apps')) {
        const v = values['arcmenu-layout-max-frequent-apps'];
        if (isInt(v)) {
            // ArcMenu allows 0 ("no limit"); Spawn needs 1..50 (INT_RANGES), so 0 becomes the maximum.
            const [min, max] = INT_RANGES['max-frequent-apps'] as readonly [number, number];
            const clamped = v === 0 ? max : Math.min(Math.max(v, min), max);
            if (clamped !== v)
                plan.warnings.push(`max-frequent-apps: ${v} is outside Spawn's range ${min}..${max}; using ${clamped}`);
            add('max-frequent-apps', 'arcmenu-layout-max-frequent-apps', clamped);
        } else
            skip('arcmenu-layout-max-frequent-apps', 'unexpected value format');
    }
    if (isSet('searchbar-default-bottom-location')) {
        const v = values['searchbar-default-bottom-location'];
        if (typeof v === 'string' && (SEARCHBAR as readonly string[]).includes(v))
            add('search-entry-location', 'searchbar-default-bottom-location', v);
        else
            skip('searchbar-default-bottom-location', 'unexpected value format');
    }

    // appearance-presets: theme presets (same aas format, invalid entries dropped) and the arrow rise (bi, clamped).
    if (isSet('menu-themes')) {
        const v = values['menu-themes'];
        if (!Array.isArray(v)) {
            skip('menu-themes', 'unexpected value format');
        } else {
            const parsed = parsePresets(v);
            plan.warnings.push(...parsed.warnings);
            add('menu-themes', 'menu-themes', serializePresets(parsed.presets));
        }
    }
    if (isSet('menu-arrow-rise')) {
        const v = values['menu-arrow-rise'];
        if (!validKind('bi', v))
            skip('menu-arrow-rise', 'unexpected value format');
        else {
            const [on, px] = v as [boolean, number];
            const clamped = Math.min(Math.max(px, ARROW_RISE_RANGE[0]), ARROW_RISE_RANGE[1]);
            if (clamped !== px)
                plan.warnings.push(`menu-arrow-rise: ${px} is outside ${ARROW_RISE_RANGE[0]}..${ARROW_RISE_RANGE[1]}; using ${clamped}`);
            add('menu-arrow-rise', 'menu-arrow-rise', [on, clamped]);
        }
    }

    // Category quick links: ArcMenu only builds a link for a category that is ALSO enabled in `extra-categories`
    // (default: Pinned and All Programs on, Favorites / Frequent / Recent off), so a link switched on without its
    // category never showed. Spawn has no `extra-categories`: the effective value is migrated.
    if (isSet('arcmenu-extra-categories-links')) {
        const links = values['arcmenu-extra-categories-links'];
        const categories = effective('extra-categories');
        if (!validKind('a(ib)', links)) {
            skip('arcmenu-extra-categories-links', 'unexpected value format');
        } else {
            const shown = validKind('a(ib)', categories)
                ? new Set((categories as Array<[number, boolean]>).filter(([, on]) => on).map(([id]) => id))
                : null;
            const merged = (links as Array<[number, boolean]>).map(([id, on]): [number, boolean] => [id, on && (shown === null || shown.has(id))]);
            const hidden = merged.filter(([, on], i) => !on && (links as Array<[number, boolean]>)[i]?.[1]).length;
            if (hidden > 0)
                plan.warnings.push(`arcmenu-extra-categories-links: ${hidden} quick link(s) were on but their category is off in ArcMenu's extra-categories, so ArcMenu never showed them; they stay off`);
            add('arcmenu-extra-categories-links', 'arcmenu-extra-categories-links, extra-categories', merged);
        }
    }

    // Activities button: ArcMenu hides it by default, so migrate the effective value.
    const show = effective('show-activities-button');
    if (typeof show === 'boolean')
        add('hide-activities-button', 'show-activities-button', !show);

    // Hotkeys: Super_L + overlay flag -> super-key-toggle, anything else -> spawn-hotkey.
    // Accelerators that are only a modifier key are dropped with a warning (they would swallow typing).
    const cleanAccelerators = (from: string, hotkeys: string[]): string[] => {
        const others: string[] = [];
        for (const k of hotkeys) {
            if (k === 'Super_L' || k === '' || others.includes(k))
                continue;
            if (BARE_MODIFIER.test(k)) {
                plan.warnings.push(`${from}: '${k}' is a bare modifier key and was not imported`);
                continue;
            }
            others.push(k);
        }
        return others;
    };
    if (isSet('arcmenu-hotkey') || isSet('arcmenu-hotkey-overlay-key-enabled')) {
        const keys = effective('arcmenu-hotkey');
        const overlay = effective('arcmenu-hotkey-overlay-key-enabled');
        if (Array.isArray(keys) && keys.every(k => typeof k === 'string') && typeof overlay === 'boolean') {
            const hotkeys = keys as string[];
            add('super-key-toggle', 'arcmenu-hotkey-overlay-key-enabled', overlay && hotkeys.includes('Super_L'));
            add('spawn-hotkey', 'arcmenu-hotkey', cleanAccelerators('arcmenu-hotkey', hotkeys));
            if (!overlay && hotkeys.includes('Super_L'))
                plan.warnings.push('ArcMenu had the Super key listed but disabled; the Super key toggle is off.');
        } else {
            skip('arcmenu-hotkey', 'unexpected value format');
            skip('arcmenu-hotkey-overlay-key-enabled', 'unexpected value format');
        }
    }

    // Standalone runner: its own accelerator(s) and start view.
    if (isSet('runner-hotkey')) {
        const keys = values['runner-hotkey'];
        if (Array.isArray(keys) && keys.every(k => typeof k === 'string')) {
            add('runner-hotkey', 'runner-hotkey', cleanAccelerators('runner-hotkey', keys as string[]));
            if ((keys as string[]).includes('Super_L'))
                plan.warnings.push("runner-hotkey: 'Super_L' was not imported (the Super key opens Spawn's menu); set another runner shortcut");
        } else
            skip('runner-hotkey', 'unexpected value format');
    }
    if (isSet('default-menu-view-runner')) {
        const v = values['default-menu-view-runner'];
        const mapped = typeof v === 'string' ? RUNNER_VIEW[v] : undefined;
        if (mapped)
            add('runner-default-view', 'default-menu-view-runner', mapped);
        else
            skip('default-menu-view-runner', 'unexpected value format');
    }

    // Panel button context menu.
    if (isSet('context-menu-items')) {
        const v = values['context-menu-items'];
        if (!isEntryList(v))
            skip('context-menu-items', 'unexpected value format');
        else
            add('context-menu-items', 'context-menu-items', dedupeEntries(convertContextMenuEntries(v, 'context-menu-items', plan.warnings), 'context-menu-items', plan.warnings));
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
        add(from as SettingKey, from, mapped);
    }

    // Button icon.
    if (isSet('menu-button-icon')) {
        const v = values['menu-button-icon'];
        const mapped = typeof v === 'string' ? convertButtonIcon(v) : null;
        const isFile = mapped !== null && (mapped.startsWith('/') || mapped.endsWith('.svg'));
        if (mapped === null) {
            skip('menu-button-icon', 'icon is not available in Spawn');
            plan.warnings.push(`menu-button-icon: unsupported icon '${String(v)}'; keeping the default icon`);
        } else if (isFile && env.iconExists && !env.iconExists(mapped)) {
            skip('menu-button-icon', 'icon file is not bundled with Spawn');
            plan.warnings.push(`menu-button-icon: '${mapped}' is not bundled with Spawn; keeping the default icon`);
        } else {
            add('menu-button-icon', 'menu-button-icon', mapped);
        }
    }

    // Layout: Spawn has one layout, but the pinned view follows how ArcMenu's layout shows its
    // items (list or grid). The key is derived from menu-layout even when it equals the default.
    if (isSet('menu-layout')) {
        const v = values['menu-layout'];
        const display = typeof v === 'string' ? PINNED_DISPLAY[v] : undefined;
        if (display) {
            add('pinned-apps-display', 'menu-layout', display);
            if (v !== 'arcmenu')
                plan.warnings.push(`menu-layout '${v}' is not available; Spawn uses its own 'spawn' layout (pinned apps shown as a ${display.toLowerCase()})`);
        } else {
            skip('menu-layout', 'Spawn has a single layout');
            plan.warnings.push(`menu-layout '${String(v)}' is not available; Spawn uses its own 'spawn' layout`);
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
        add(key, key, dedupeEntries(convertEntries(v, key, plan.warnings), key, plan.warnings));
    }

    if (isSet('pinned-apps')) {
        const v = values['pinned-apps'];
        if (!isEntryList(v)) {
            skip('pinned-apps', 'unexpected value format');
        } else {
            // An app lives in exactly one place: top level first, then the folders in order.
            const seen = new Set<string>();
            const converted = convertEntries(v, 'pinned-apps', plan.warnings).filter(entry => {
                if (entry.isFolder === 'true' && !isValidFolderId(entry.id)) {
                    plan.warnings.push(`pinned-apps: dropped folder '${label(entry)}' (invalid folder id '${entry.id}')`);
                    return false;
                }
                return true;
            });
            const kept = new Set<Entry>(dedupeEntries(converted.filter(e => e.isFolder !== 'true'), 'pinned-apps', plan.warnings, seen));
            const folderIds = new Set<string>();
            const top = converted.filter(entry => {
                if (entry.isFolder !== 'true')
                    return kept.has(entry);
                if (folderIds.has(entry.id)) {
                    plan.warnings.push(`pinned-apps: folder '${label(entry)}' is listed more than once; only the first one is kept`);
                    return false;
                }
                folderIds.add(entry.id);
                return true;
            });
            add('pinned-apps', 'pinned-apps', top);
            for (const entry of top) {
                if (entry.isFolder !== 'true')
                    continue;
                const contents = snapshot.folders[entry.id];
                if (!contents)
                    plan.warnings.push(`Folder '${label(entry)}' has no stored contents; it will be empty`);
                const where = `folder '${label(entry)}'`;
                plan.folders.push({
                    uuid: entry.id,
                    name: entry.name ?? '',
                    pinnedApps: dedupeEntries(convertEntries(contents ?? [], where, plan.warnings), where, plan.warnings, seen),
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
        if (key === 'menu-themes' && value.every(Array.isArray))
            return `${value.length} ${value.length === 1 ? 'theme' : 'themes'}: ${(value as unknown[][]).map(t => String(t[0])).join(', ')}`;
        if (value.length && value.every(e => e !== null && typeof e === 'object' && 'id' in (e as object)))
            return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
        return JSON.stringify(value);
    }
    if (value !== null && typeof value === 'object')
        return JSON.stringify(value);
    if (typeof value === 'boolean')
        return value ? 'On' : 'Off';
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

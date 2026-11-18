// Typed accessors over Gio.Settings for the main schema and the relocatable folder schema.
//
// Public API:
//   SettingsMap                        key -> TS type for every key in schemas/*.gschema.xml
//   Entry                              one aa{ss} item ({id, name?, icon?, isFolder?})
//   new SpawnSettings(gsettings, schemaSource)
//   s.get(key) / s.set(key, value)     typed read / write (any GVariant type is handled by
//                                      reflecting the key's type from the schema); set() returns
//                                      false when GSettings rejects the value (range / enum). Booleans,
//                                      numbers and strings are cached between reads (the whole cache is
//                                      dropped on any 'changed' signal, own or outside); lists and
//                                      objects are unpacked afresh, so callers may keep and edit them.
//   s.reset(key)
//   s.onChanged(scope, keys, cb)       cb(key) after any of `keys` changes; owned by scope.
//                                      Pass [] for "any key".
//   isValidFolderId(id)                true for ids usable as a dconf path element (no '/', not empty)
//   s.folder(uuid)                     FolderSettings for folders/<uuid>/ (throws on an invalid id); one
//                                      instance per uuid is kept for the life of the settings object, so its
//                                      raw must never be delay()ed: s.privateFolder(uuid) gives an unshared one
//   s.folderSchema()                   Gio.SettingsSchema of the folder keys
//   s.deleteFolder(uuid)               resets the folder's keys (removes dconf entries)
//   s.snapshot(keys, folderIds?)       remembers the user values of keys / folders (for Undo)
//   s.restore(snapshot)                writes a snapshot back (unset values are reset)
//   s.batch(fn)                        runs fn(tx) on a THROWAWAY Gio.Settings in delay()/apply() mode:
//                                      tx.set(key, value) (false when rejected) / tx.reset(key); applied
//                                      together, or reverted when fn throws (which is rethrown); the
//                                      throwaway is created once and reused (a nested batch gets its own)
//   s.raw                              the underlying Gio.Settings (prefs bindings only). It must NEVER be
//                                      put into delay()/apply() mode: GSettings has no "undelay", so every
//                                      later write would stay pending and never reach dconf. Use batch().
//
// FolderSettings: { uuid, name (get/set), pinnedApps (get/set), onChanged(scope, cb), raw }
//
// Imports only gi://, so it can be loaded by unit tests with gjs -m.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ENTRY_LIST_KEYS, sanitizeEntries} from './entries.js';
import {isValidFolderId} from './folderId.js';
import {warn} from './log.js';
import type {Scope} from './scope.js';

export const SCHEMA_ID = 'org.gnome.shell.extensions.spawn';
export const FOLDER_SCHEMA_ID = `${SCHEMA_ID}.folder`;

export interface Entry {
    id: string;
    name?: string;
    icon?: string;
    isFolder?: string;
    [key: string]: string | undefined;
}

export type MenuPosition = 'Left' | 'Center' | 'Right';
export type MenuButtonClickAction = 'Menu' | 'None' | 'ContextMenu';
export type PinnedAppsDisplay = 'List' | 'Grid';
export type LayoutStyle = 'Classic' | 'Grid';
export type PinnedItemSize = 'Compact' | 'Comfortable' | 'Large';
export type MenuButtonAppearance = 'Icon' | 'Text' | 'Icon_Text' | 'Text_Icon' | 'None';
export type AvatarStyle = 'Round' | 'Square';
export type DefaultMenuView = 'Pinned_Apps' | 'Categories_List' | 'Frequent_Apps' | 'All_Programs' | 'Pinned_And_Frequent_Apps';
export type AllAppsButtonAction = 'Categories_List' | 'All_Programs';
export type SearchbarLocation = 'Bottom' | 'Top' | 'Auto';
export type PowerDisplayStyle = 'Default' | 'In_Line' | 'Menu';
export type MenuItemLocation = 'Bottom' | 'Top';
export type RunnerPosition = 'Top' | 'Centered';
export type RunnerDefaultView = 'Default' | 'Pinned_Apps' | 'Frequent_Apps';
export type MenuItemIconStyle = 'Full_Color' | 'Symbolic';

export interface SettingsMap {
    'dev-mode': boolean;
    'multi-monitor': boolean;
    'hide-activities-button': boolean;
    'activate-on-launch': boolean;
    'keep-open-on-ctrl-click': boolean;
    'show-tooltips': boolean;
    'super-key-toggle': boolean;
    'spawn-hotkey': string[];
    'runner-hotkey': string[];
    'runner-position': RunnerPosition;
    'runner-menu-width': number;
    'runner-menu-height': number;
    'runner-default-view': RunnerDefaultView;
    'runner-run-commands': boolean;
    'position-in-panel': MenuPosition;
    'menu-button-position-offset': number;
    'menu-button-appearance': MenuButtonAppearance;
    'menu-button-text': string;
    'menu-button-icon': string;
    'menu-button-icon-size': number;
    'menu-button-padding': number;
    'menu-button-left-click-action': MenuButtonClickAction;
    'menu-button-right-click-action': MenuButtonClickAction;
    'menu-button-middle-click-action': MenuButtonClickAction;
    'default-menu-view': DefaultMenuView;
    'all-apps-button-action': AllAppsButtonAction;
    'max-frequent-apps': number;
    'menu-height': number;
    'menu-width-adjustment': number;
    'left-panel-width': number;
    'right-panel-width': number;
    'vert-separator': boolean;
    'multi-lined-labels': boolean;
    'scrollbars-visible': boolean;
    'scrollbars-overlay': boolean;
    'scrollview-fade-effect': boolean;
    'show-user-avatar': boolean;
    'avatar-style': AvatarStyle;
    'icon-size-apps': number;
    'icon-size-shortcuts': number;
    'icon-size-categories': number;
    'icon-size-buttons': number;
    'icon-size-misc': number;
    'icon-size-grid': Record<string, number>;
    'icon-style-categories': MenuItemIconStyle;
    'icon-style-shortcuts': MenuItemIconStyle;
    'icon-style-buttons': MenuItemIconStyle;
    'pinned-apps': Entry[];
    'directory-shortcuts': Entry[];
    'application-shortcuts': Entry[];
    'context-menu-items': Entry[];
    'layout-style': LayoutStyle;
    'pinned-apps-display': PinnedAppsDisplay;
    'pinned-item-size': PinnedItemSize;
    'power-options': Array<[number, boolean]>;
    'power-display-style': PowerDisplayStyle;
    'arcmenu-extra-categories-links': Array<[number, boolean]>;
    'arcmenu-extra-categories-links-location': MenuItemLocation;
    'show-external-devices': boolean;
    'show-bookmarks': boolean;
    'search-hidden': boolean;
    'hidden-apps': string[];
    'search-hidden-apps': boolean;
    'show-new-apps-badge': boolean;
    'known-apps': string[];
    'new-apps': Record<string, number>;
    'search-entry-location': SearchbarLocation;
    'max-search-results': number;
    'highlight-search-result-terms': boolean;
    'show-search-result-details': boolean;
    'search-provider-open-windows': boolean;
    'search-provider-recent-files': boolean;
    'search-provider-shell': boolean;
    'search-calculator': boolean;
    'search-unit-conversion': boolean;
    'search-settings-panels': boolean;
    'search-app-actions': boolean;
    'search-power-actions': boolean;
    'show-hidden-recent-files': boolean;
    'apps-show-extra-details': boolean;
    'apps-show-generic-names': boolean;
    'search-entry-border-radius': [boolean, number];
    'override-menu-theme': boolean;
    'menu-background-color': string;
    'menu-foreground-color': string;
    'menu-border-color': string;
    'menu-border-width': number;
    'menu-border-radius': number;
    'menu-font-size': number;
    'menu-separator-color': string;
    'menu-item-hover-bg-color': string;
    'menu-item-hover-fg-color': string;
    'menu-item-active-bg-color': string;
    'menu-item-active-fg-color': string;
    'menu-button-fg-color': [boolean, string];
    'menu-button-bg-color': [boolean, string];
    'menu-button-border-radius': [boolean, number];
    'menu-button-border-width': [boolean, number];
    'menu-button-border-color': [boolean, string];
    'menu-button-hover-bg-color': [boolean, string];
    'menu-button-hover-fg-color': [boolean, string];
    'menu-button-active-bg-color': [boolean, string];
    'menu-button-active-fg-color': [boolean, string];
    'menu-themes': string[][];
    'menu-position-alignment': number;
    'menu-arrow-rise': [boolean, number];
    'runner-font-size': number;
    'prefs-visible-page': number;
    'migration-done': boolean;
}

export type SettingKey = keyof SettingsMap;

/** User values (null = never set, i.e. the default applies) of keys and folders, see snapshot(). */
export interface SettingsSnapshot {
    keys: Map<SettingKey, GLib.Variant | null>;
    folders: Map<string, {name: GLib.Variant | null; pinnedApps: GLib.Variant | null}>;
}

export {isValidFolderId};

function unpack<T>(variant: GLib.Variant): T {
    return variant.recursiveUnpack() as T;
}

const warnedEntries = new Set<string>();

/** An entry list without its damaged entries; each damaged one is logged once per session, not on every read. */
function readEntries(what: string, raw: unknown): Entry[] {
    return sanitizeEntries<Entry>(raw, (entry, why) => {
        const note = `${what}: ${why} ${JSON.stringify(entry)}`;
        if (warnedEntries.has(note))
            return;
        warnedEntries.add(note);
        warn(`ignoring a damaged entry in ${note}`);
    });
}

function pack(typeString: string, value: unknown): GLib.Variant {
    return new GLib.Variant(typeString, value as never);
}

function typeOf(settings: Gio.Settings, key: string): string {
    const schemaKey = settings.settings_schema?.get_key(key);
    if (!schemaKey)
        throw new Error(`unknown setting '${key}'`);
    return schemaKey.get_value_type().dup_string();
}

function connectChanged(settings: Gio.Settings, scope: Scope, keys: readonly string[], cb: (key: string) => void): void {
    if (keys.length === 0) {
        scope.connect(settings, 'changed', (_s: Gio.Settings, key: string) => cb(key));
        return;
    }
    for (const key of keys)
        scope.connect(settings, `changed::${key}`, () => cb(key));
}

export class FolderSettings {
    constructor(readonly uuid: string, readonly raw: Gio.Settings) {}

    get name(): string {
        return this.raw.get_string('name');
    }

    set name(value: string) {
        this.raw.set_string('name', value);
    }

    get pinnedApps(): Entry[] {
        return readEntries(`folder ${this.uuid} pinned-apps`, unpack<unknown>(this.raw.get_value('pinned-apps')));
    }

    set pinnedApps(value: Entry[]) {
        this.raw.set_value('pinned-apps', pack('aa{ss}', value));
    }

    onChanged(scope: Scope, cb: (key: string) => void): void {
        connectChanged(this.raw, scope, [], cb);
    }
}

/** Writes inside SpawnSettings.batch(); mirrors set()/reset() on the throwaway instance. */
export class SettingsBatch {
    constructor(private readonly _raw: Gio.Settings) {}

    /** Returns false when GSettings rejects the value (out of range / not an enum nick). */
    set<K extends SettingKey>(key: K, value: SettingsMap[K]): boolean {
        return this._raw.set_value(key, pack(typeOf(this._raw, key), value));
    }

    reset(key: SettingKey): void {
        this._raw.reset(key);
    }

    /** Puts a user value back (see snapshot()); null resets the key. Returns false when GSettings rejects the value. */
    setVariant(key: SettingKey, value: GLib.Variant | null): boolean {
        if (value === null) {
            this._raw.reset(key);
            return true;
        }
        return this._raw.set_value(key, value);
    }
}

export class SpawnSettings {
    private readonly _schemaSource: Gio.SettingsSchemaSource;
    readonly raw: Gio.Settings;
    /** Unpacked boolean / number / string values by key; emptied by every 'changed' signal. */
    private readonly _scalars = new Map<string, unknown>();
    private readonly _folders = new Map<string, FolderSettings>();
    private _batchRaw: Gio.Settings | null = null;
    private _batching = false;

    constructor(gsettings: Gio.Settings, schemaSource: Gio.SettingsSchemaSource) {
        this.raw = gsettings;
        this._schemaSource = schemaSource;
        // Connected first, so it runs before every other handler of the same emission. Dropping the whole
        // cache (not just the key) keeps a handler for one key of a multi-key write from reading a stale
        // value of another. The connection ends with `raw`, which this object owns.
        gsettings.connect('changed', () => this._scalars.clear());
    }

    get<K extends SettingKey>(key: K): SettingsMap[K] {
        if (this._scalars.has(key))
            return this._scalars.get(key) as SettingsMap[K];
        const variant = this.raw.get_value(key);
        if (ENTRY_LIST_KEYS.includes(key))
            return readEntries(key, unpack<unknown>(variant)) as SettingsMap[K];
        const value = unpack<SettingsMap[K]>(variant);
        if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string')
            this._scalars.set(key, value);
        return value;
    }

    /** Returns false when GSettings rejects the value (out of range / not an enum nick). */
    set<K extends SettingKey>(key: K, value: SettingsMap[K]): boolean {
        return this.raw.set_value(key, pack(typeOf(this.raw, key), value));
    }

    reset(key: SettingKey): void {
        this.raw.reset(key);
    }

    onChanged(scope: Scope, keys: readonly SettingKey[], cb: (key: SettingKey) => void): void {
        connectChanged(this.raw, scope, keys, key => cb(key as SettingKey));
    }

    folder(uuid: string): FolderSettings {
        if (!isValidFolderId(uuid))
            throw new Error(`invalid folder id '${uuid}'`);
        let folder = this._folders.get(uuid);
        if (!folder) {
            folder = this._newFolder(uuid);
            this._folders.set(uuid, folder);
        }
        return folder;
    }

    /**
     * A new, unshared FolderSettings. Use it (not folder()) where raw.delay() / apply() is needed: the shared
     * instance must never be put into delay mode, which GSettings cannot leave.
     */
    privateFolder(uuid: string): FolderSettings {
        if (!isValidFolderId(uuid))
            throw new Error(`invalid folder id '${uuid}'`);
        return this._newFolder(uuid);
    }

    private _newFolder(uuid: string): FolderSettings {
        const schema = this._schemaSource.lookup(FOLDER_SCHEMA_ID, true);
        if (!schema)
            throw new Error(`schema ${FOLDER_SCHEMA_ID} not found`);
        const path = `${this.raw.path}folders/${uuid}/`;
        return new FolderSettings(uuid, Gio.Settings.new_full(schema, this.raw.backend, path));
    }

    /** The schema of the folder keys (name, pinned-apps), for validating values before they are written. */
    folderSchema(): Gio.SettingsSchema {
        const schema = this._schemaSource.lookup(FOLDER_SCHEMA_ID, true);
        if (!schema)
            throw new Error(`schema ${FOLDER_SCHEMA_ID} not found`);
        return schema;
    }

    deleteFolder(uuid: string): void {
        const f = this.folder(uuid);
        f.raw.reset('name');
        f.raw.reset('pinned-apps');
        this._folders.delete(uuid);
    }

    snapshot(keys: readonly SettingKey[], folderIds: readonly string[] = []): SettingsSnapshot {
        const snap: SettingsSnapshot = {keys: new Map(), folders: new Map()};
        for (const key of keys)
            snap.keys.set(key, this.raw.get_user_value(key));
        for (const id of folderIds) {
            if (!isValidFolderId(id) || snap.folders.has(id))
                continue;
            const raw = this.folder(id).raw;
            snap.folders.set(id, {name: raw.get_user_value('name'), pinnedApps: raw.get_user_value('pinned-apps')});
        }
        return snap;
    }

    /**
     * All-or-nothing writes on a throwaway Gio.Settings (same schema, backend and path as `raw`).
     * `raw` itself is never delayed, because GSettings cannot leave delay-apply mode again.
     */
    batch(fn: (tx: SettingsBatch) => void): void {
        const schema = this.raw.settings_schema;
        if (!schema)
            throw new Error('settings have no schema');
        // The throwaway stays in delay mode between calls (apply() / revert() leave nothing pending); a batch
        // started inside another one gets a fresh instance.
        const nested = this._batching;
        let raw = nested ? null : this._batchRaw;
        if (!raw) {
            raw = Gio.Settings.new_full(schema, this.raw.backend, this.raw.path);
            raw.delay();
            if (!nested)
                this._batchRaw = raw;
        }
        this._batching = true;
        try {
            try {
                fn(new SettingsBatch(raw));
            } catch (e) {
                raw.revert();
                throw e;
            }
            raw.apply();
        } finally {
            this._batching = nested;
        }
    }

    restore(snap: SettingsSnapshot): void {
        const write = (raw: Gio.Settings, key: string, value: GLib.Variant | null): void => {
            if (value === null)
                raw.reset(key);
            else
                raw.set_value(key, value);
        };
        // Folder instances are throwaway; their two keys are written as they come.
        for (const [id, saved] of snap.folders) {
            const raw = this.folder(id).raw;
            write(raw, 'name', saved.name);
            write(raw, 'pinned-apps', saved.pinnedApps);
        }
        this.batch(tx => {
            for (const [key, value] of snap.keys)
                tx.setVariant(key, value);
        });
    }
}

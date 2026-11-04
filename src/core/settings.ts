// Typed accessors over Gio.Settings for the main schema and the relocatable folder schema.
//
// Public API:
//   SettingsMap                        key -> TS type for every key in schemas/*.gschema.xml
//   Entry                              one aa{ss} item ({id, name?, icon?, isFolder?})
//   new SpawnSettings(gsettings, schemaSource)
//   s.get(key) / s.set(key, value)     typed read / write (any GVariant type is handled by
//                                      reflecting the key's type from the schema)
//   s.reset(key)
//   s.onChanged(scope, keys, cb)       cb(key) after any of `keys` changes; owned by scope.
//                                      Pass [] for "any key".
//   s.folder(uuid)                     FolderSettings for folders/<uuid>/
//   s.deleteFolder(uuid)               resets the folder's keys (removes dconf entries)
//   s.raw                              the underlying Gio.Settings (prefs bindings only)
//
// FolderSettings: { uuid, name (get/set), pinnedApps (get/set), onChanged(scope, cb), raw }
//
// Imports only gi://, so it can be loaded by unit tests with gjs -m.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {Scope} from './scope.js';

export const SCHEMA_ID = 'org.gnome.shell.extensions.spawn-menu';
export const FOLDER_SCHEMA_ID = `${SCHEMA_ID}.folder`;

export interface Entry {
    id: string;
    name?: string;
    icon?: string;
    isFolder?: string;
    [key: string]: string | undefined;
}

export type MenuPosition = 'Left' | 'Center' | 'Right';
export type MenuButtonClickAction = 'Menu' | 'None';
export type MenuButtonAppearance = 'Icon' | 'Text' | 'Icon_Text' | 'Text_Icon' | 'None';
export type AvatarStyle = 'Round' | 'Square';
export type DefaultMenuView = 'Pinned_Apps' | 'Categories_List' | 'Frequent_Apps' | 'All_Programs' | 'Pinned_And_Frequent_Apps';
export type AllAppsButtonAction = 'Categories_List' | 'All_Programs';
export type SearchbarLocation = 'Bottom' | 'Top';
export type PowerDisplayStyle = 'Default' | 'In_Line' | 'Menu';
export type MenuItemIconStyle = 'Full_Color' | 'Symbolic';

export interface SettingsMap {
    'dev-mode': boolean;
    'multi-monitor': boolean;
    'hide-activities-button': boolean;
    'activate-on-launch': boolean;
    'keep-open-on-ctrl-click': boolean;
    'show-tooltips': boolean;
    'super-key-toggle': boolean;
    'menu-hotkey': string[];
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
    'power-options': Array<[number, boolean]>;
    'power-display-style': PowerDisplayStyle;
    'search-hidden': boolean;
    'search-entry-location': SearchbarLocation;
    'max-search-results': number;
    'highlight-search-result-terms': boolean;
    'show-search-result-details': boolean;
    'search-provider-open-windows': boolean;
    'search-provider-recent-files': boolean;
    'search-provider-shell': boolean;
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
    'prefs-visible-page': number;
    'migration-done': boolean;
}

export type SettingKey = keyof SettingsMap;

function unpack<T>(variant: GLib.Variant): T {
    return variant.recursiveUnpack() as T;
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
        return unpack<Entry[]>(this.raw.get_value('pinned-apps'));
    }

    set pinnedApps(value: Entry[]) {
        this.raw.set_value('pinned-apps', pack('aa{ss}', value));
    }

    onChanged(scope: Scope, cb: (key: string) => void): void {
        connectChanged(this.raw, scope, [], cb);
    }
}

export class SpawnSettings {
    private readonly _schemaSource: Gio.SettingsSchemaSource;
    readonly raw: Gio.Settings;

    constructor(gsettings: Gio.Settings, schemaSource: Gio.SettingsSchemaSource) {
        this.raw = gsettings;
        this._schemaSource = schemaSource;
    }

    get<K extends SettingKey>(key: K): SettingsMap[K] {
        return unpack<SettingsMap[K]>(this.raw.get_value(key));
    }

    set<K extends SettingKey>(key: K, value: SettingsMap[K]): void {
        this.raw.set_value(key, pack(typeOf(this.raw, key), value));
    }

    reset(key: SettingKey): void {
        this.raw.reset(key);
    }

    onChanged(scope: Scope, keys: readonly SettingKey[], cb: (key: SettingKey) => void): void {
        connectChanged(this.raw, scope, keys, key => cb(key as SettingKey));
    }

    folder(uuid: string): FolderSettings {
        const schema = this._schemaSource.lookup(FOLDER_SCHEMA_ID, true);
        if (!schema)
            throw new Error(`schema ${FOLDER_SCHEMA_ID} not found`);
        const path = `${this.raw.path}folders/${uuid}/`;
        return new FolderSettings(uuid, Gio.Settings.new_full(schema, null, path));
    }

    deleteFolder(uuid: string): void {
        const f = this.folder(uuid);
        f.raw.reset('name');
        f.raw.reset('pinned-apps');
    }
}

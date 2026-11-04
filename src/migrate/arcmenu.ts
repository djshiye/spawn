// ArcMenu -> Spawn migration: Gio.Settings I/O around the pure mapping in migrate/mapping.ts.
//
// Responsibility: read ArcMenu's settings through the BUNDLED compiled schema
// (data/migration/arcmenu/gschemas.compiled, so it works even when ArcMenu is uninstalled),
// map every v1 key (docs/SETTINGS.md lists the source of each), copy pinned folders, and
// apply the result to our schema. The mapping is PURE (`planMigration`) and is unit-tested
// against docs/research/user-arcmenu-settings.ini (tests/migrate.test.js).
//
// Value rules the mapping must implement (see docs/SETTINGS.md):
//   * ArcMenu_* shortcut ids -> Spawn_* (core/constants.ts ARCMENU_ID_PREFIX/SPAWN_ID_PREFIX);
//     ArcMenu-only items (ArcMenu_Settings, ArcMenu_PanelExtensionSettings, ArcMenu_ArcMenuIcon
//     entries) are dropped with a warning.
//   * hide-activities-button = !show-activities-button
//   * super-key-toggle = arcmenu-hotkey-overlay-key-enabled && 'Super_L' in arcmenu-hotkey;
//     menu-hotkey = the other accelerators of arcmenu-hotkey
//   * menu-button-icon resource URI -> bundled file name (core/icons.ts)
//   * menu-button-*-click-action: ContextMenu -> None, ArcMenu -> Menu
//   * pinned folders: {id: uuid, isFolder: 'true', name} + contents from
//     pinned-apps-folders/<uuid>/pinned-apps, copied to our folders/<uuid>/ (same uuid)
//
// Public API:
//   ArcMenuSnapshot            plain-object view of ArcMenu's settings: {values (ONLY the keys the user
//                              changed, recursively unpacked), defaults (every key's schema default),
//                              folders: Record<uuid, Entry[]>}                      [defaults is new]
//   planMigration(snapshot, spawnDefaults?): MigrationPlan                  PURE
//   MigrationPlan: {items, folders, skipped: {key, reason}[], warnings}     [skipped is new]
//   describeItem(item), describeValue(value)                                [new]
//   MigrationItem: {key: SettingKey, from: string, value: unknown, differsFromDefault: boolean}
//   FolderPlan: {uuid, name, pinnedApps: Entry[]}
//   readArcMenuSnapshot(extensionDir: string): ArcMenuSnapshot | null       Gio I/O; null if the
//                              bundled schema cannot be loaded
//   applyMigration(plan, settings: SpawnSettings): void                     writes our schema only
//   describePlan(plan): string[]                                            human-readable preview lines
//   disableArcMenu(): Promise<boolean>   explicit user action: org.gnome.Shell.Extensions
//                              DisableExtension('arcmenu@arcmenu.com'); never edits other dconf keys

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type {Entry, SpawnSettings} from '../core/settings.js';
import {ARCMENU_UUID, type ArcMenuSnapshot, type MigrationPlan} from './mapping.js';

export {
    ARCMENU_UUID,
    type ArcMenuSnapshot,
    describeItem,
    describeValue,
    describePlan,
    type FolderPlan,
    type MigrationItem,
    type MigrationPlan,
    planMigration,
    type SkippedItem,
} from './mapping.js';

const ARCMENU_SCHEMA_ID = 'org.gnome.shell.extensions.arcmenu';
const ARCMENU_FOLDER_SCHEMA_ID = 'org.gnome.shell.extensions.arcmenu.pinned-apps-folders';
const ARCMENU_PATH = '/org/gnome/shell/extensions/arcmenu/';

/** Reads the live ArcMenu settings (user-changed keys only) through the bundled schema. */
export function readArcMenuSnapshot(extensionDir: string): ArcMenuSnapshot | null {
    try {
        const source = Gio.SettingsSchemaSource.new_from_directory(`${extensionDir}/data/migration/arcmenu`, null, false);
        const schema = source.lookup(ARCMENU_SCHEMA_ID, false);
        const folderSchema = source.lookup(ARCMENU_FOLDER_SCHEMA_ID, false);
        if (!schema || !folderSchema)
            return null;
        const settings = Gio.Settings.new_full(schema, null, ARCMENU_PATH);
        const values: Record<string, unknown> = {};
        const defaults: Record<string, unknown> = {};
        for (const key of schema.list_keys()) {
            defaults[key] = schema.get_key(key).get_default_value().recursiveUnpack();
            const user = settings.get_user_value(key);
            if (user !== null)
                values[key] = user.recursiveUnpack();
        }
        const folders: Record<string, Entry[]> = {};
        const pinned = values['pinned-apps'];
        if (Array.isArray(pinned)) {
            for (const entry of pinned as Entry[]) {
                if (entry?.isFolder !== 'true')
                    continue;
                const folder = Gio.Settings.new_full(folderSchema, null, `${ARCMENU_PATH}pinned-apps-folders/${entry.id}/`);
                const user = folder.get_user_value('pinned-apps');
                if (user !== null)
                    folders[entry.id] = user.recursiveUnpack() as Entry[];
            }
        }
        return {values, defaults, folders};
    } catch (e) {
        logError(e as Error, '[spawn] reading the ArcMenu settings failed');
        return null;
    }
}

/** Writes the plan into our schema: folders first, then one delay()/apply() batch. */
export function applyMigration(plan: MigrationPlan, settings: SpawnSettings): void {
    const replacesPinned = plan.items.some(i => i.key === 'pinned-apps');
    if (replacesPinned) {
        // Folders of the previous pinned list that the import does not bring back are cleaned up.
        const keep = new Set(plan.folders.map(f => f.uuid));
        for (const entry of settings.get('pinned-apps')) {
            if (entry.isFolder === 'true' && !keep.has(entry.id))
                settings.deleteFolder(entry.id);
        }
    }
    for (const pf of plan.folders) {
        const folder = settings.folder(pf.uuid);
        folder.raw.delay();
        folder.name = pf.name;
        folder.pinnedApps = pf.pinnedApps;
        folder.raw.apply();
    }
    settings.raw.delay();
    try {
        for (const item of plan.items)
            settings.set(item.key, item.value as never);
        settings.set('migration-done', true);
    } finally {
        settings.raw.apply();
    }
}

/** Explicit user action: ask the shell to disable ArcMenu. Resolves false if that failed. */
export function disableArcMenu(): Promise<boolean> {
    return new Promise(resolve => {
        try {
            Gio.DBus.session.call(
                'org.gnome.Shell',
                '/org/gnome/Shell',
                'org.gnome.Shell.Extensions',
                'DisableExtension',
                new GLib.Variant('(s)', [ARCMENU_UUID]),
                new GLib.VariantType('(b)'),
                Gio.DBusCallFlags.NONE,
                5000,
                null,
                (conn, res) => {
                    try {
                        const reply = conn?.call_finish(res);
                        resolve(reply?.deepUnpack<[boolean]>()[0] ?? false);
                    } catch (e) {
                        logError(e as Error, '[spawn] DisableExtension failed');
                        resolve(false);
                    }
                },
            );
        } catch (e) {
            logError(e as Error, '[spawn] DisableExtension failed');
            resolve(false);
        }
    });
}

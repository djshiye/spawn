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
//   planMigration(snapshot, spawnDefaults?, env?): MigrationPlan             PURE
//   MigrationPlan: {items, folders, skipped: {key, reason}[], warnings}     [skipped is new]
//   describeItem(item), describeValue(value)                                [new]
//   MigrationItem: {key: SettingKey, from: string, value: unknown, differsFromDefault: boolean}
//   FolderPlan: {uuid, name, pinnedApps: Entry[]}
//   readArcMenuSnapshot(extensionDir: string): ArcMenuSnapshot | null       Gio I/O; null if the
//                              bundled schema cannot be loaded
//   applyMigration(plan, settings: SpawnSettings): ApplyResult              writes our schema only, all or
//                              nothing: any exception reverts every key and folder it touched. Items
//                              equal to Spawn's default are RESET instead of written (so later default
//                              changes still apply); values GSettings rejects are listed in `failed`.
//                              ApplyResult: {written, reset, failed: SettingKey[], undo: SettingsSnapshot}
//   spawnDefaults(settings), iconInstalled(extensionDir, value)             helpers for planMigration
//   describePlan(plan): string[]                                            human-readable preview lines
//   queryArcMenu(): Promise<ArcMenuStatus>   installed / enabled / version via
//                              org.gnome.Shell.Extensions.GetExtensionInfo; BUNDLED_ARCMENU_VERSION is
//                              the ArcMenu release whose schema is bundled
//   disableArcMenu(): Promise<DisableResult>  explicit user action: DisableExtension('arcmenu@arcmenu.com');
//                              'disabled' | 'not-installed' | 'already-disabled' | 'failed';
//                              never edits other dconf keys

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {isValidFolderId} from '../core/folderId.js';
import type {Entry, SettingKey, SettingsSnapshot, SpawnSettings} from '../core/settings.js';
import {ARCMENU_UUID, type ArcMenuSnapshot, type MigrationPlan} from './mapping.js';

export {
    ARCMENU_UUID,
    type ArcMenuSnapshot,
    describeItem,
    describeValue,
    describePlan,
    type FolderPlan,
    INT_RANGES,
    type MigrationItem,
    type MigrationPlan,
    type PlanEnv,
    planMigration,
    type SkippedItem,
} from './mapping.js';

const ARCMENU_SCHEMA_ID = 'org.gnome.shell.extensions.arcmenu';
const ARCMENU_FOLDER_SCHEMA_ID = 'org.gnome.shell.extensions.arcmenu.pinned-apps-folders';
const ARCMENU_PATH = '/org/gnome/shell/extensions/arcmenu/';

/** ArcMenu `version` (metadata.json) whose schema data/migration/arcmenu was taken from. */
export const BUNDLED_ARCMENU_VERSION = 74;

export interface ApplyResult {
    written: number;
    reset: number;
    /** Keys GSettings rejected (value outside the schema's range or enum); they were not written. */
    failed: SettingKey[];
    /** Previous values of everything the import touched; pass to SpawnSettings.restore() to undo. */
    undo: SettingsSnapshot;
}

export interface ArcMenuStatus {
    installed: boolean;
    enabled: boolean;
    /** metadata.json `version` (integer release number) and `version-name`. */
    version: number | null;
    versionName: string | null;
    /** The shell could not be asked (installed/enabled are then unknown and reported false). */
    unknown: boolean;
}

export type DisableResult = 'disabled' | 'not-installed' | 'already-disabled' | 'failed';

/** Spawn's schema default of every key, for planMigration()'s differsFromDefault. */
export function spawnDefaults(settings: SpawnSettings): Partial<Record<SettingKey, unknown>> {
    const defaults: Record<string, unknown> = {};
    const schema = settings.raw.settings_schema;
    for (const key of schema?.list_keys() ?? [])
        defaults[key] = schema?.get_key(key).get_default_value().recursiveUnpack();
    return defaults;
}

/** planMigration() env check: does a `menu-button-icon` value (bundled file name / path) exist? */
export function iconInstalled(extensionDir: string, value: string): boolean {
    const path = value.startsWith('/') ? value : `${extensionDir}/data/icons/${value}`;
    return Gio.File.new_for_path(path).query_exists(null);
}

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
                // An unusable folder entry is reported by planMigration; it must not break the snapshot.
                if (entry?.isFolder !== 'true' || !isValidFolderId(entry.id))
                    continue;
                try {
                    const folder = Gio.Settings.new_full(folderSchema, null, `${ARCMENU_PATH}pinned-apps-folders/${entry.id}/`);
                    const user = folder.get_user_value('pinned-apps');
                    if (user !== null)
                        folders[entry.id] = user.recursiveUnpack() as Entry[];
                } catch (e) {
                    logError(e as Error, `[spawn] reading ArcMenu folder '${entry.id}' failed`);
                }
            }
        }
        return {values, defaults, folders};
    } catch (e) {
        logError(e as Error, '[spawn] reading the ArcMenu settings failed');
        return null;
    }
}

/**
 * Writes the plan into our schema, all or nothing: the main keys go through one delay()/apply()
 * batch, and any exception reverts that batch and restores every folder it touched, then rethrows.
 * Items equal to Spawn's default are reset instead of written.
 */
export function applyMigration(plan: MigrationPlan, settings: SpawnSettings): ApplyResult {
    const raw = settings.raw;
    const oldFolders = settings.get('pinned-apps').filter(e => e.isFolder === 'true' && isValidFolderId(e.id)).map(e => e.id);
    const undo = settings.snapshot(
        [...plan.items.map(i => i.key), 'migration-done'],
        [...plan.folders.map(f => f.uuid), ...oldFolders],
    );
    const result: ApplyResult = {written: 0, reset: 0, failed: [], undo};
    const pinnedItem = plan.items.find(i => i.key === 'pinned-apps');
    raw.delay();
    try {
        for (const item of plan.items) {
            if (item.differsFromDefault === false) {
                raw.reset(item.key);
                result.reset++;
            } else if (settings.set(item.key, item.value as never)) {
                result.written++;
            } else {
                result.failed.push(item.key);
            }
        }
        if (!settings.set('migration-done', true))
            throw new Error('could not record that the import was done');
        if (pinnedItem && !result.failed.includes('pinned-apps')) {
            // Folders of the previous pinned list that the import does not bring back are cleaned up.
            const keep = new Set(plan.folders.map(f => f.uuid));
            for (const id of oldFolders) {
                if (!keep.has(id))
                    settings.deleteFolder(id);
            }
            for (const pf of plan.folders) {
                const folder = settings.folder(pf.uuid);
                folder.raw.delay();
                folder.name = pf.name;
                folder.pinnedApps = pf.pinnedApps;
                folder.raw.apply();
            }
        }
        raw.apply();
    } catch (e) {
        raw.revert();
        settings.restore(undo);
        throw e;
    }
    return result;
}

function shellCall(method: string, params: GLib.Variant | null, replyType: string): Promise<GLib.Variant | null> {
    return new Promise(resolve => {
        try {
            Gio.DBus.session.call(
                'org.gnome.Shell',
                '/org/gnome/Shell',
                'org.gnome.Shell.Extensions',
                method,
                params,
                new GLib.VariantType(replyType),
                Gio.DBusCallFlags.NONE,
                5000,
                null,
                (conn, res) => {
                    try {
                        resolve(conn?.call_finish(res) ?? null);
                    } catch (e) {
                        logError(e as Error, `[spawn] ${method} failed`);
                        resolve(null);
                    }
                },
            );
        } catch (e) {
            logError(e as Error, `[spawn] ${method} failed`);
            resolve(null);
        }
    });
}

/** Is ArcMenu installed / enabled, and which release? Never rejects. */
export async function queryArcMenu(): Promise<ArcMenuStatus> {
    const reply = await shellCall('GetExtensionInfo', new GLib.Variant('(s)', [ARCMENU_UUID]), '(a{sv})');
    if (!reply)
        return {installed: false, enabled: false, version: null, versionName: null, unknown: true};
    const info = (reply.recursiveUnpack() as [Record<string, unknown>])[0] ?? {};
    const installed = Object.keys(info).length > 0;
    const version = typeof info['version'] === 'number' ? info['version'] : null;
    const versionName = typeof info['version-name'] === 'string' ? info['version-name'] : null;
    // state 1 = ENABLED (active); older shells only have the `enabled` flag.
    const enabled = installed && (info['state'] === 1 || info['enabled'] === true);
    return {installed, enabled, version, versionName, unknown: false};
}

/** Explicit user action: ask the shell to disable ArcMenu. */
export async function disableArcMenu(): Promise<DisableResult> {
    const status = await queryArcMenu();
    if (!status.unknown && !status.installed)
        return 'not-installed';
    if (!status.unknown && !status.enabled)
        return 'already-disabled';
    const reply = await shellCall('DisableExtension', new GLib.Variant('(s)', [ARCMENU_UUID]), '(b)');
    return reply?.deepUnpack<[boolean]>()[0] ? 'disabled' : 'failed';
}

// ArcMenu -> Spawn Menu migration. STUB: signatures are final, bodies are inert.
//
// Responsibility: read ArcMenu's settings through the BUNDLED compiled schema
// (data/migration/arcmenu/gschemas.compiled, so it works even when ArcMenu is uninstalled),
// map every v1 key (docs/SETTINGS.md lists the source of each), copy pinned folders, and
// apply the result to our schema. The mapping is PURE (`planMigration`) and is unit-tested
// against docs/research/user-arcmenu-settings.ini (tests/migrate.test.js).
//
// Value rules the mapping must implement (see docs/SETTINGS.md):
//   * ArcMenu_* shortcut ids -> SpawnMenu_* (core/constants.ts ARCMENU_ID_PREFIX/SPAWN_ID_PREFIX);
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
//   ArcMenuSnapshot            plain-object view of ArcMenu's settings: {values: Record<string, unknown>
//                              (effective values, defaults included, recursively unpacked),
//                              folders: Record<uuid, Entry[]>}
//   planMigration(snapshot): MigrationPlan                                  PURE
//   MigrationPlan: {items: MigrationItem[], folders: FolderPlan[], warnings: string[]}
//   MigrationItem: {key: SettingKey, from: string, value: unknown, differsFromDefault: boolean}
//   FolderPlan: {uuid, name, pinnedApps: Entry[]}
//   readArcMenuSnapshot(extensionDir: string): ArcMenuSnapshot | null       Gio I/O; null if the
//                              bundled schema cannot be loaded
//   applyMigration(plan, settings: SpawnSettings): void                     writes our schema only
//   describePlan(plan): string[]                                            human-readable preview lines
//   disableArcMenu(): Promise<boolean>   explicit user action: org.gnome.Shell.Extensions
//                              DisableExtension('arcmenu@arcmenu.com'); never edits other dconf keys

import type {Entry, SettingKey, SpawnSettings} from '../core/settings.js';

export const ARCMENU_UUID = 'arcmenu@arcmenu.com';

export interface ArcMenuSnapshot {
    values: Record<string, unknown>;
    folders: Record<string, Entry[]>;
}

export interface MigrationItem {
    key: SettingKey;
    from: string;
    value: unknown;
    differsFromDefault: boolean;
}

export interface FolderPlan {
    uuid: string;
    name: string;
    pinnedApps: Entry[];
}

export interface MigrationPlan {
    items: MigrationItem[];
    folders: FolderPlan[];
    warnings: string[];
}

export function planMigration(_snapshot: ArcMenuSnapshot): MigrationPlan {
    // TODO(migration owner)
    return {items: [], folders: [], warnings: []};
}

export function readArcMenuSnapshot(_extensionDir: string): ArcMenuSnapshot | null {
    // TODO(migration owner)
    return null;
}

export function applyMigration(_plan: MigrationPlan, _settings: SpawnSettings): void {
    // TODO(migration owner)
}

export function describePlan(_plan: MigrationPlan): string[] {
    // TODO(migration owner)
    return [];
}

export function disableArcMenu(): Promise<boolean> {
    // TODO(migration owner)
    return Promise.resolve(false);
}

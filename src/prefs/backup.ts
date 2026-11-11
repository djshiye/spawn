// Back up and restore of all user settings: one JSON file, validated strictly on the way in.
//
// File format (UTF-8 JSON, at most MAX_BACKUP_BYTES):
//   {
//     "format": "spawn-settings", "version": 1, "extensionVersion": "1.3.0",
//     "settings": {"<key>": "<GVariant text>", ...},            only keys that differ from their default
//     "folders":  {"<uuid>": {"name": "Games", "pinned-apps": "<GVariant text>"}, ...}
//   }
// Everything Spawn keeps lives in GSettings (the main schema and the folders' relocatable schema); there are no
// other state files. Left out on purpose: every key whose schema summary says "(internal)" (the bookkeeping
// `known-apps` and `new-apps` describe the apps installed on THIS machine, restoring them elsewhere would hide or
// flood the "New" badges; the dev-only switch of dev builds never travels), plus `migration-done` and
// `prefs-visible-page`.
//
// Values are GVariant text (`variant.print(false)`) and are read back with GLib.Variant.parse() against the type
// the schema declares for that key, so the file cannot change a type; the parser only builds values, it never
// evaluates anything. Each value must then pass SettingsSchemaKey.range_check (enum nicks, ranges) and, for the
// entry lists, hold only entries with an `id`. Unknown keys are ignored and reported; a known key with a bad value
// rejects the whole file (nothing is applied).
//
// Public API:
//   BACKUP_FORMAT, BACKUP_VERSION, MAX_BACKUP_BYTES, BACKUP_EXCLUDED_KEYS, DEFAULT_BACKUP_NAME
//   createBackup(settings, extensionVersion): string          the JSON text
//   parseBackup(text, settings): ParseResult                  {ok: true, plan} | {ok: false, error}
//   describePlan(plan): string                                one line for the confirmation dialog
//   applyBackup(settings, plan): RestoreResult                replaces the current settings; {undo} for settings.restore();
//                                                             throws (after rolling back) when anything is rejected
//   readBackupFile(file): string                              size / type checked read (throws Error)
//   writeBackupFile(file, text): void                         atomic, mode 0600
//
// Imports only gi://, so it can be loaded by unit tests with gjs -m.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {sanitizeEntries} from '../core/entries.js';
import {isValidFolderId} from '../core/folderId.js';
import type {SettingKey, SettingsSnapshot, SpawnSettings} from '../core/settings.js';

export const BACKUP_FORMAT = 'spawn-settings';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024;
export const DEFAULT_BACKUP_NAME = 'spawn-settings.json';
const MAX_FOLDERS = 500;
const MAX_NAME_LENGTH = 256;

/** Keys that are never written to or read from a backup besides those marked "(internal)" in their schema summary. */
export const BACKUP_EXCLUDED_KEYS: readonly string[] = ['migration-done', 'prefs-visible-page'];

/** Excluded: the listed keys and every key whose schema summary says "(internal)" (known-apps, new-apps, the dev-only switch). */
function excluded(schema: Gio.SettingsSchema, key: string): boolean {
    return BACKUP_EXCLUDED_KEYS.includes(key) || schema.get_key(key).get_summary()?.includes('(internal)') === true;
}

interface PlannedFolder {
    name: string;
    pinnedApps: GLib.Variant;
}

export interface RestorePlan {
    /** Validated values of the keys the file sets; every other restorable key is reset to its default. */
    values: Map<string, GLib.Variant>;
    folders: Map<string, PlannedFolder>;
    /** Things in the file that were not used (unknown or excluded keys, folders nothing points at). */
    ignored: string[];
    extensionVersion: string | null;
}

export type ParseResult = {ok: true; plan: RestorePlan} | {ok: false; error: string};

export interface RestoreResult {
    undo: SettingsSnapshot;
    written: number;
    reset: number;
    folders: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Folder ids the pinned list points at. */
function folderIds(pinned: readonly {id: string; isFolder?: string}[]): string[] {
    return pinned.filter(e => e.isFolder === 'true' && isValidFolderId(e.id)).map(e => e.id);
}

function restorableKeys(settings: SpawnSettings): SettingKey[] {
    const schema = settings.raw.settings_schema;
    if (!schema)
        throw new Error('settings have no schema');
    return schema.list_keys().filter(k => !excluded(schema, k)) as SettingKey[];
}

export function createBackup(settings: SpawnSettings, extensionVersion: string): string {
    const schema = settings.raw.settings_schema;
    if (!schema)
        throw new Error('settings have no schema');
    const values: Record<string, string> = {};
    for (const key of restorableKeys(settings)) {
        const user = settings.raw.get_user_value(key);
        if (user === null || user.equal(schema.get_key(key).get_default_value()))
            continue;
        values[key] = user.print(false);
    }
    const folders: Record<string, {name: string; 'pinned-apps': string}> = {};
    for (const id of folderIds(settings.get('pinned-apps'))) {
        const raw = settings.folder(id).raw;
        folders[id] = {name: raw.get_string('name'), 'pinned-apps': raw.get_value('pinned-apps').print(false)};
    }
    return `${JSON.stringify({
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        extensionVersion,
        settings: values,
        folders,
    }, null, 2)}\n`;
}

/** Parses `text` as the value of `schemaKey` and checks its range; throws a short reason. */
function parseValue(schemaKey: Gio.SettingsSchemaKey, text: unknown): GLib.Variant {
    if (typeof text !== 'string')
        throw new Error('the value is not text');
    const variant = GLib.Variant.parse(schemaKey.get_value_type(), text, null, null);
    if (!schemaKey.range_check(variant))
        throw new Error('the value is out of range or not one of the allowed choices');
    return variant;
}

function checkEntries(variant: GLib.Variant): void {
    const list = variant.recursiveUnpack() as unknown[];
    if (sanitizeEntries(list).length !== list.length)
        throw new Error('an entry has no id');
}

export function parseBackup(text: string, settings: SpawnSettings): ParseResult {
    const schema = settings.raw.settings_schema;
    if (!schema)
        return {ok: false, error: 'The settings schema could not be loaded.'};
    const folderSchema = settings.folderSchema();
    let doc: unknown;
    try {
        doc = JSON.parse(text);
    } catch {
        return {ok: false, error: 'This is not a Spawn settings backup (the file is not valid JSON).'};
    }
    if (!isRecord(doc) || doc['format'] !== BACKUP_FORMAT)
        return {ok: false, error: 'This is not a Spawn settings backup.'};
    const version = doc['version'];
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
        return {ok: false, error: 'The backup has no valid format version.'};
    if (version > BACKUP_VERSION)
        return {ok: false, error: 'This backup was made by a newer version of Spawn. Update Spawn to restore it.'};
    const rawSettings = doc['settings'];
    const rawFolders = doc['folders'] ?? {};
    if (!isRecord(rawSettings) || !isRecord(rawFolders))
        return {ok: false, error: 'The backup is damaged (settings or folders missing).'};

    const ignored: string[] = [];
    const values = new Map<string, GLib.Variant>();
    const known = new Set(schema.list_keys());
    for (const [key, text] of Object.entries(rawSettings)) {
        if (!known.has(key) || excluded(schema, key)) {
            ignored.push(key);
            continue;
        }
        try {
            const variant = parseValue(schema.get_key(key), text);
            if (['pinned-apps', 'directory-shortcuts', 'application-shortcuts', 'context-menu-items'].includes(key))
                checkEntries(variant);
            values.set(key, variant);
        } catch (e) {
            return {ok: false, error: `The setting '${key}' in the backup is not valid: ${(e as Error).message}.`};
        }
    }

    // Folders: only those the restored pinned list points at, so a file cannot create stray dconf paths.
    const pinned = values.has('pinned-apps') ? sanitizeEntries<{id: string; isFolder?: string}>(values.get('pinned-apps')?.recursiveUnpack()) : [];
    const wanted = new Set(folderIds(pinned));
    const entries = Object.entries(rawFolders);
    if (entries.length > MAX_FOLDERS)
        return {ok: false, error: 'The backup holds an unreasonable number of folders.'};
    const folders = new Map<string, PlannedFolder>();
    for (const [id, folder] of entries) {
        if (!isValidFolderId(id)) {
            return {ok: false, error: 'The backup holds a folder with an invalid id.'};
        }
        if (!wanted.has(id)) {
            ignored.push(`folder ${id}`);
            continue;
        }
        try {
            if (!isRecord(folder) || typeof folder['name'] !== 'string' || folder['name'].length > MAX_NAME_LENGTH)
                throw new Error('the name is missing or too long');
            const name = folder['name'];
            if (!folderSchema.get_key('name').range_check(GLib.Variant.new_string(name)))
                throw new Error('the name is not allowed');
            const apps = parseValue(folderSchema.get_key('pinned-apps'), folder['pinned-apps']);
            checkEntries(apps);
            folders.set(id, {name, pinnedApps: apps});
        } catch (e) {
            return {ok: false, error: `The folder '${id}' in the backup is not valid: ${(e as Error).message}.`};
        }
    }
    for (const id of wanted) {
        if (!folders.has(id))
            ignored.push(`folder ${id} is missing from the backup`);
    }
    const ext = doc['extensionVersion'];
    return {ok: true, plan: {values, folders, ignored, extensionVersion: typeof ext === 'string' ? ext.slice(0, 40) : null}};
}

export function describePlan(plan: RestorePlan): string {
    const n = plan.values.size;
    const f = plan.folders.size;
    const parts = [`${n} ${n === 1 ? 'setting' : 'settings'}`, `${f} ${f === 1 ? 'folder' : 'folders'}`];
    return `The backup holds ${parts.join(' and ')}${plan.extensionVersion ? ` (made with Spawn ${plan.extensionVersion})` : ''}. Everything else returns to its default.`;
}

/**
 * Replaces the current settings with the plan: keys the file sets are written, every other restorable key is
 * reset, folders of the old pinned list that the backup does not bring back are removed. All-or-nothing: on any
 * failure the previous state is restored and the error rethrown.
 */
export function applyBackup(settings: SpawnSettings, plan: RestorePlan): RestoreResult {
    const schema = settings.raw.settings_schema as Gio.SettingsSchema; // restorableKeys() has checked it
    const keys = restorableKeys(settings);
    const oldFolders = folderIds(settings.get('pinned-apps'));
    const undo = settings.snapshot(keys, [...oldFolders, ...plan.folders.keys()]);
    const result: RestoreResult = {undo, written: 0, reset: 0, folders: plan.folders.size};
    try {
        settings.batch(tx => {
            for (const key of keys) {
                const value = plan.values.get(key) ?? null;
                if (value !== null && !value.get_type().equal(schema.get_key(key).get_value_type()))
                    throw new Error(`the setting '${key}' has the wrong type`);
                if (!tx.setVariant(key, value))
                    throw new Error(`the setting '${key}' was rejected`);
                if (value === null)
                    result.reset++;
                else
                    result.written++;
            }
        });
        for (const id of oldFolders) {
            if (!plan.folders.has(id))
                settings.deleteFolder(id);
        }
        for (const [id, f] of plan.folders) {
            const folder = settings.folder(id);
            folder.raw.delay();
            folder.name = f.name;
            folder.raw.set_value('pinned-apps', f.pinnedApps);
            folder.raw.apply();
        }
    } catch (e) {
        settings.restore(undo);
        throw e;
    }
    return result;
}

export function readBackupFile(file: Gio.File): string {
    const info = file.query_info('standard::type,standard::size', Gio.FileQueryInfoFlags.NONE, null);
    if (info.get_file_type() !== Gio.FileType.REGULAR)
        throw new Error('This is not a regular file.');
    if (info.get_size() > MAX_BACKUP_BYTES)
        throw new Error('The file is too large to be a Spawn backup (over 1 MiB).');
    const stream = file.read(null);
    try {
        // One byte more than allowed: a file that grew since the size check is still caught.
        const bytes = stream.read_bytes(MAX_BACKUP_BYTES + 1, null).toArray();
        if (bytes.length > MAX_BACKUP_BYTES)
            throw new Error('The file is too large to be a Spawn backup (over 1 MiB).');
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch (e) {
        if (e instanceof TypeError)
            throw new Error('The file is not text.');
        throw e;
    } finally {
        stream.close(null);
    }
}

export function writeBackupFile(file: Gio.File, text: string): void {
    // PRIVATE: created with mode 0600; replace() writes a temporary file and renames it over the target.
    file.replace_contents(new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

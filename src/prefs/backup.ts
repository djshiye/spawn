// Back up and restore of all user settings: one JSON file, validated strictly on the way in.
//
// File format (UTF-8 JSON, at most MAX_BACKUP_BYTES):
//   {
//     "format": "spawn-settings", "version": 1, "extensionVersion": "1.3.0",
//     "settings": {"<key>": "<GVariant text>", ...},            only keys that differ from their default
//     "folders":  {"<uuid>": {"name": "Games", "pinned-apps": "<GVariant text>"}, ...}
//   }
// Everything Spawn keeps lives in GSettings (the main schema and the folders' relocatable schema); there are no
// other state files. Left out on purpose: the keys in BACKUP_EXCLUDED_KEYS, all marked "(internal)" in the schema (the bookkeeping
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
//   describeCommands(plan): string                            the commands the restore adds to the menu ('' when none)
//   applyBackup(settings, plan): RestoreResult                replaces the current settings; {undo} for settings.restore();
//                                                             throws (after rolling back) when anything is rejected
//   readBackupFile(file): string                              size / type checked read (throws Error)
//   writeBackupFile(file, text): void                         atomic, mode 0600
//   readBackupFileAsync(file): Promise<string>                the same, without blocking the window (the file may sit on
//   writeBackupFileAsync(file, text): Promise<void>           a portal / FUSE / network path); the dialogs use these
//
// Imports only gi://, so it can be loaded by unit tests with gjs -m.

import Gio from 'gi://Gio';
import type GObject from 'gi://GObject';
import GLib from 'gi://GLib';

import {DEV_ONLY_KEYS} from '../core/flavour.js';
import {isCommandEntry, type RawEntry, sanitizeEntries} from '../core/entries.js';
import type {Entry} from '../core/settings.js';
import * as ops from '../model/pinnedOps.js';
import {isValidFolderId} from '../core/folderId.js';
import type {SettingKey, SettingsSnapshot, SpawnSettings} from '../core/settings.js';

export const BACKUP_FORMAT = 'spawn-settings';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 1024 * 1024;
export const DEFAULT_BACKUP_NAME = 'spawn-settings.json';
const MAX_FOLDERS = 500;
const MAX_NAME_LENGTH = 256;

/**
 * Keys that are never written to or read from a backup: bookkeeping of this machine (known-apps, new-apps), the
 * dev-only switch (named in core/flavour.ts, so a release build never mentions it) and the two state keys. Listed by name on purpose: schema summaries are translatable text, so
 * they cannot decide what travels (tests/backup.test.js checks that every "(internal)" key is listed).
 */
export const BACKUP_EXCLUDED_KEYS: readonly string[] = ['migration-done', 'prefs-visible-page', 'known-apps', 'new-apps', ...DEV_ONLY_KEYS];

function excluded(key: string): boolean {
    return BACKUP_EXCLUDED_KEYS.includes(key);
}

interface PlannedFolder {
    name: string;
    pinnedApps: GLib.Variant;
}

export interface RestorePlan {
    /** Validated values of the keys the file sets; every other restorable key is reset to its default. */
    values: Map<string, GLib.Variant>;
    folders: Map<string, PlannedFolder>;
    /** Keys in the file that this version does not know. */
    ignored: string[];
    /** Known things in the file that are not restored on purpose: keys this computer keeps (BACKUP_EXCLUDED_KEYS) and `folder <id>` that no pinned entry points at. */
    skipped: string[];
    /** Folder ids the file's pinned list points at but the file does not hold; their entries are dropped from the plan. */
    missingFolders: string[];
    /** Display lines of the commands the restore adds to the menu (entries that run their id as a command line when clicked). */
    commands: string[];
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
    return schema.list_keys().filter(k => !excluded(k)) as SettingKey[];
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

const COMMAND_KEYS = ['pinned-apps', 'directory-shortcuts', 'application-shortcuts', 'context-menu-items'] as const;

function shorten(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The entries the restore would add that run a command line when clicked, as display lines. Entries already in the
 * menu today are left out (restoring your own backup shows nothing new). Folder contents never run (they show as
 * ghost tiles), so they are not looked at.
 */
function commandsAdded(values: ReadonlyMap<string, GLib.Variant>, settings: SpawnSettings): string[] {
    const current = new Set<string>();
    for (const key of COMMAND_KEYS)
        for (const e of settings.get(key) as RawEntry[])
            current.add(e.id);
    const out: string[] = [];
    for (const key of COMMAND_KEYS) {
        const v = values.get(key);
        if (!v)
            continue;
        for (const e of sanitizeEntries(v.recursiveUnpack())) {
            if (!isCommandEntry(e, key === 'pinned-apps') || current.has(e.id))
                continue;
            const line = e.name && e.name !== e.id ? `"${shorten(e.name, 60)}" runs ${shorten(e.id, 120)}` : shorten(e.id, 120);
            if (!out.includes(line))
                out.push(line);
        }
    }
    return out;
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
    const skipped: string[] = [];
    const missingFolders: string[] = [];
    const values = new Map<string, GLib.Variant>();
    const known = new Set(schema.list_keys());
    for (const [key, text] of Object.entries(rawSettings)) {
        if (!known.has(key)) {
            ignored.push(key);
            continue;
        }
        if (excluded(key)) {
            skipped.push(key);
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
    let pinned = values.has('pinned-apps') ? sanitizeEntries<{id: string; isFolder?: string}>(values.get('pinned-apps')?.recursiveUnpack()) : [];
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
            skipped.push(`folder ${id}`);
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
    // A folder entry whose folder the file does not hold would restore as an empty, nameless folder (and delete a
    // local one): leave the entry out instead.
    for (const id of wanted) {
        if (!folders.has(id))
            missingFolders.push(id);
    }
    if (missingFolders.length > 0) {
        pinned = pinned.filter(e => !(e.isFolder === 'true' && missingFolders.includes(e.id)));
        values.set('pinned-apps', new GLib.Variant('aa{ss}', pinned as never));
    }
    // Repair a damaged pinned structure the way the ArcMenu import does (an app once, a folder once, no nested
    // folders): the menu's operations rely on it. Silent: what goes are exact duplicates the menu never shows.
    if (values.has('pinned-apps')) {
        const original = {
            top: pinned as Entry[],
            folders: Object.fromEntries([...folders].map(([id, f]) => [id, sanitizeEntries<Entry>(f.pinnedApps.recursiveUnpack())])),
        };
        const fixed = ops.normalizeSnapshot(original);
        if (fixed !== original) {
            values.set('pinned-apps', new GLib.Variant('aa{ss}', fixed.top as never));
            for (const [id, f] of folders)
                f.pinnedApps = new GLib.Variant('aa{ss}', (fixed.folders[id] ?? []) as never);
        }
    }
    const ext = doc['extensionVersion'];
    return {ok: true, plan: {values, folders, ignored, skipped, missingFolders, commands: commandsAdded(values, settings), extensionVersion: typeof ext === 'string' ? ext.slice(0, 40) : null}};
}

/** One sentence naming the commands the restore adds (at most 8), or '' when there are none. */
export function describeCommands(plan: RestorePlan): string {
    if (plan.commands.length === 0)
        return '';
    const more = plan.commands.length - 8;
    return `Commands it adds to the menu, run when clicked: ${plan.commands.slice(0, 8).join(', ')}${more > 0 ? `, and ${more} more` : ''}.`;
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
            const folder = settings.privateFolder(id);
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

const TOO_LARGE = 'The file is too large to be a Spawn backup (over 1 MiB).';

function checkInfo(info: Gio.FileInfo): void {
    if (info.get_file_type() !== Gio.FileType.REGULAR)
        throw new Error('This is not a regular file.');
    if (info.get_size() > MAX_BACKUP_BYTES)
        throw new Error(TOO_LARGE);
}

function decodeBackup(bytes: Uint8Array): string {
    if (bytes.length > MAX_BACKUP_BYTES)
        throw new Error(TOO_LARGE);
    try {
        return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
    } catch (e) {
        if (e instanceof TypeError)
            throw new Error('The file is not text.', {cause: e});
        throw e;
    }
}

export function readBackupFile(file: Gio.File): string {
    checkInfo(file.query_info('standard::type,standard::size', Gio.FileQueryInfoFlags.NONE, null));
    const stream = file.read(null);
    try {
        // One byte more than allowed: a file that grew since the size check is still caught.
        return decodeBackup(stream.read_bytes(MAX_BACKUP_BYTES + 1, null).toArray());
    } finally {
        stream.close(null);
    }
}

/** Wraps a Gio async call (start(callback)) in a promise; `finish` runs inside the callback. */
function gio<T>(start: (done: (_source: GObject.Object | null, res: Gio.AsyncResult) => void) => void, finish: (res: Gio.AsyncResult) => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        start((_source, res) => {
            try {
                resolve(finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/** readBackupFile() without blocking: the same checks, the same errors. */
export async function readBackupFileAsync(file: Gio.File): Promise<string> {
    checkInfo(await gio(done => file.query_info_async('standard::type,standard::size', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, done),
        res => file.query_info_finish(res)));
    const stream = await gio(done => file.read_async(GLib.PRIORITY_DEFAULT, null, done), res => file.read_finish(res));
    try {
        const bytes = await gio(done => stream.read_bytes_async(MAX_BACKUP_BYTES + 1, GLib.PRIORITY_DEFAULT, null, done),
            res => stream.read_bytes_finish(res));
        return decodeBackup(bytes.toArray());
    } finally {
        await gio(done => stream.close_async(GLib.PRIORITY_DEFAULT, null, done), res => stream.close_finish(res));
    }
}

const WRITE_FLAGS = Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION;

export function writeBackupFile(file: Gio.File, text: string): void {
    // PRIVATE: created with mode 0600; replace() writes a temporary file and renames it over the target.
    file.replace_contents(new TextEncoder().encode(text), null, false, WRITE_FLAGS, null);
}

/** writeBackupFile() without blocking. */
export async function writeBackupFileAsync(file: Gio.File, text: string): Promise<void> {
    await gio(done => file.replace_contents_async(new TextEncoder().encode(text), null, false, WRITE_FLAGS, null, done),
        res => file.replace_contents_finish(res));
}

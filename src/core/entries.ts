// Damaged list entries: skip the bad one, keep the rest.
//
// pinned-apps, the folders' pinned-apps, directory-shortcuts, application-shortcuts and context-menu-items are
// aa{ss} lists that a person can hand-edit (dconf-editor, a script, an old import). One entry without an `id`
// used to throw somewhere inside the code that walks the list, so the whole pinned list stopped updating or
// every shortcut disappeared. SpawnSettings now reads these lists through sanitizeEntries(), so the rest of the
// code only ever sees entries that have an id.
//
// This module has no imports so it is usable from unit tests under gjs -m.
//
// Public API:
//   ENTRY_LIST_KEYS                       the setting keys whose values are entry lists
//   sanitizeEntries(raw, onSkip?): Entry[]  the entries of `raw` that are plain objects with a non-empty string
//                                         `id` (kept as they are, in order); onSkip(entry, why) is called once for
//                                         each dropped one
//   isCommandEntry(entry, inPinned): boolean  true when clicking the entry would run its id as a command line
//                                         (the restore dialog lists such entries before they are added)
//   reinsertAt(list, item, index): T[]    a copy of `list` with `item` inserted at `index`, clamped to 0..length

export interface RawEntry {
    id: string;
    [key: string]: string | undefined;
}

export const ENTRY_LIST_KEYS: readonly string[] = [
    'pinned-apps', 'directory-shortcuts', 'application-shortcuts', 'context-menu-items',
];

export function sanitizeEntries<T extends RawEntry = RawEntry>(raw: unknown, onSkip?: (entry: unknown, why: string) => void): T[] {
    if (!Array.isArray(raw))
        return [];
    const out: T[] = [];
    for (const entry of raw) {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            onSkip?.(entry, 'not an entry');
            continue;
        }
        const id = (entry as {id?: unknown}).id;
        if (typeof id !== 'string' || id.trim() === '') {
            onSkip?.(entry, 'no id');
            continue;
        }
        out.push(entry as T);
    }
    return out;
}

/** Desktop-file ids (what Shell.AppSystem looks up); anything with a space or shell syntax is not one. */
const DESKTOP_ID = /^[A-Za-z0-9_.+-]+\.desktop$/;

/**
 * True when clicking the entry would run its id as a command line: resolveShortcut's shell fallback
 * (ui/widgets/shortcutRow.ts) or pinnedView._runCustom (create_from_commandline). Keep in step with those.
 * `inPinned`: the entry is in the top-level pinned-apps, where {isFolder: 'true'} entries are folders and never
 * run (resolveShortcut ignores isFolder).
 */
export function isCommandEntry(entry: RawEntry, inPinned: boolean): boolean {
    const id = entry.id;
    if (id.trim() === '')
        return false;
    if (inPinned && entry.isFolder === 'true')
        return false;
    if (id.startsWith('Spawn_') || id.startsWith('ArcMenu_'))
        return false; // built-ins, or nothing (unknown ones resolve to null)
    if (id.startsWith('/') || id.includes('://'))
        return false; // opened as a path / URI, never run
    return !DESKTOP_ID.test(id);
}

export function reinsertAt<T>(list: readonly T[], item: T, index: number): T[] {
    const out = [...list];
    out.splice(Math.max(0, Math.min(index, out.length)), 0, item);
    return out;
}

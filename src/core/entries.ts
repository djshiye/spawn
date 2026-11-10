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

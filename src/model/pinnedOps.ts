// Pure list manipulation for the pinned apps / folders model. No gi:// imports, so it is
// unit-tested with `gjs -m` (tests/pinned.test.js).
//
// The model is a snapshot:
//   top      the `pinned-apps` list. Folder entries are {id: <uuid>, name, isFolder: 'true'}
//   folders  uuid -> the folder's own `pinned-apps` list
// Every operation is a pure function: it returns a NEW snapshot (the input is never
// mutated) or the very same object when the operation is a no-op.
//
// Invariants kept by every operation:
//   * an app id appears at most once in the whole snapshot (top level or one folder)
//   * a folder that becomes empty through removal is deleted (top entry + folder list)
//   * a folder entry in `top` always has a list in `folders` (possibly empty only right
//     after createFolder with no ids)
//
// Index convention: every index argument refers to the list AS IT WAS BEFORE the
// operation. When the operation itself removes entries in front of the insertion point
// (moving an app out of the top level into a folder, an emptied folder disappearing, ...),
// the index is adjusted so the entry lands where the caller saw the slot. `move` is plain
// array move: remove at `from`, insert at `to` in the shortened array, so afterwards the
// entry sits at index `to`.

import type {Entry} from '../core/settings.js';

export interface PinnedSnapshot {
    readonly top: readonly Entry[];
    readonly folders: Readonly<Record<string, readonly Entry[]>>;
}

export function isFolderEntry(e: Entry): boolean {
    return e.isFolder === 'true';
}

export function emptySnapshot(): PinnedSnapshot {
    return {top: [], folders: {}};
}

/** Is `id` an app/command/folder anywhere in the snapshot (folders included)? */
export function isPinnedIn(s: PinnedSnapshot, id: string): boolean {
    if (s.top.some(e => e.id === id))
        return true;
    return Object.values(s.folders).some(list => list.some(e => e.id === id));
}

export function folderUuids(top: readonly Entry[]): string[] {
    return top.filter(isFolderEntry).map(e => e.id);
}

/**
 * Translate an index into a "visible" subset of `top` (e.g. without apps whose desktop
 * file is gone) into an index into the full list. `rawOfVisible[i]` is the full-list
 * index of the i-th visible entry. Beyond the end maps to `rawLength` (append).
 */
export function visibleToRaw(rawOfVisible: readonly number[], rawLength: number, visibleIndex: number | undefined): number | undefined {
    if (visibleIndex === undefined)
        return undefined;
    if (visibleIndex < 0)
        return 0;
    return visibleIndex >= rawOfVisible.length ? rawLength : rawOfVisible[visibleIndex];
}

/** Like visibleToRaw but for the destination of a `move`: the entry takes the slot of the visible entry at `to`. */
export function visibleToRawMove(rawOfVisible: readonly number[], rawLength: number, visibleTo: number): number {
    if (rawOfVisible.length === 0)
        return clamp(visibleTo, Math.max(0, rawLength - 1));
    return rawOfVisible[clamp(visibleTo, rawOfVisible.length - 1)];
}

// -- internals ---------------------------------------------------------------------------

interface Mutable {
    top: Entry[];
    folders: Record<string, Entry[]>;
}

function mutable(s: PinnedSnapshot): Mutable {
    const folders: Record<string, Entry[]> = {};
    for (const [uuid, list] of Object.entries(s.folders))
        folders[uuid] = [...list];
    return {top: [...s.top], folders};
}

function clamp(i: number, max: number): number {
    return Math.max(0, Math.min(i, max));
}

function topIndexOfFolder(top: readonly Entry[], uuid: string): number {
    return top.findIndex(e => isFolderEntry(e) && e.id === uuid);
}

/** Remove a folder's top entry and list. Returns the removed top index, or -1. */
function dropFolder(m: Mutable, uuid: string): number {
    const i = topIndexOfFolder(m.top, uuid);
    if (i >= 0)
        m.top.splice(i, 1);
    delete m.folders[uuid];
    return i;
}

/**
 * Pull `ids` out of the top level and every folder. Folders emptied by that are deleted
 * (except `keepFolder`). Returns the extracted entries in the order of `ids` (ids that were
 * not pinned yield a fresh {id}).
 */
function extract(m: Mutable, ids: readonly string[], keepFolder?: string): Entry[] {
    const out: Entry[] = [];
    for (const id of ids) {
        let found: Entry | undefined;
        const ti = m.top.findIndex(e => !isFolderEntry(e) && e.id === id);
        if (ti >= 0)
            found = m.top.splice(ti, 1)[0];
        for (const [uuid, list] of Object.entries(m.folders)) {
            const fi = list.findIndex(e => e.id === id);
            if (fi < 0)
                continue;
            const [e] = list.splice(fi, 1);
            found ??= e;
            if (list.length === 0 && uuid !== keepFolder)
                dropFolder(m, uuid);
        }
        out.push(found ?? {id});
    }
    return out;
}

/** Indices of `before` entries that are no longer present (by identity) in `after`. */
function removedPositions(before: readonly Entry[], after: readonly Entry[]): number[] {
    const kept = new Set(after);
    const out: number[] = [];
    before.forEach((e, i) => {
        if (!kept.has(e))
            out.push(i);
    });
    return out;
}

function adjust(index: number, removed: readonly number[]): number {
    return index - removed.filter(p => p < index).length;
}

// -- operations --------------------------------------------------------------------------

/** Pin `id` at `index` (default: end). No-op when already pinned anywhere. */
export function pin(s: PinnedSnapshot, id: string, index?: number): PinnedSnapshot {
    if (!id || isPinnedIn(s, id))
        return s;
    const m = mutable(s);
    m.top.splice(clamp(index ?? m.top.length, m.top.length), 0, {id});
    return m;
}

/** Unpin `id` wherever it is. A folder uuid deletes that folder. Emptied folders are deleted. */
export function unpin(s: PinnedSnapshot, id: string): PinnedSnapshot {
    if (topIndexOfFolder(s.top, id) >= 0)
        return deleteFolder(s, id);
    if (!isPinnedIn(s, id))
        return s;
    const m = mutable(s);
    extract(m, [id]);
    return m;
}

/** Reorder the top level: remove at `from`, insert at `to`. Out-of-range `from` is a no-op. */
export function move(s: PinnedSnapshot, from: number, to: number): PinnedSnapshot {
    if (from < 0 || from >= s.top.length)
        return s;
    const dest = clamp(to, s.top.length - 1);
    if (dest === from)
        return s;
    const m = mutable(s);
    const [e] = m.top.splice(from, 1);
    m.top.splice(dest, 0, e);
    return m;
}

/**
 * New folder `uuid` holding `ids` (pulled out of the top level or other folders). The
 * folder entry goes to `index`, by default into the slot of the first id taken from the
 * top level (drop-app-on-app semantics), else the end. Unknown ids are added as plain apps.
 */
export function createFolder(s: PinnedSnapshot, uuid: string, name: string, ids: readonly string[], index?: number): PinnedSnapshot {
    if (!uuid || topIndexOfFolder(s.top, uuid) >= 0 || uuid in s.folders)
        return s;
    const uniq = [...new Set(ids)].filter(id => id && !folderUuids(s.top).includes(id));
    const m = mutable(s);
    const before = [...m.top];
    const firstTop = before.findIndex(e => !isFolderEntry(e) && uniq.includes(e.id));
    const moved = extract(m, uniq);
    const removed = removedPositions(before, m.top);
    const wanted = index ?? (firstTop >= 0 ? firstTop : before.length);
    const at = clamp(adjust(wanted, removed), m.top.length);
    m.top.splice(at, 0, {id: uuid, name, isFolder: 'true'});
    m.folders[uuid] = moved;
    return m;
}

export function renameFolder(s: PinnedSnapshot, uuid: string, name: string): PinnedSnapshot {
    const i = topIndexOfFolder(s.top, uuid);
    if (i < 0 || s.top[i].name === name)
        return s;
    const m = mutable(s);
    m.top[i] = {...m.top[i], name};
    return m;
}

/** Delete the folder; its apps are unpinned. */
export function deleteFolder(s: PinnedSnapshot, uuid: string): PinnedSnapshot {
    if (topIndexOfFolder(s.top, uuid) < 0 && !(uuid in s.folders))
        return s;
    const m = mutable(s);
    dropFolder(m, uuid);
    return m;
}

/**
 * Dissolve the folder: its entries move to the top level, in folder order, into the slot the
 * folder occupied (the "Delete Folder" menu item: nothing gets unpinned). Entries that are
 * already pinned at the top level are not duplicated.
 */
export function dissolveFolder(s: PinnedSnapshot, uuid: string): PinnedSnapshot {
    if (topIndexOfFolder(s.top, uuid) < 0 && !(uuid in s.folders))
        return s;
    const m = mutable(s);
    const contents = m.folders[uuid] ?? [];
    const at = dropFolder(m, uuid);
    const fresh = contents.filter(e => !m.top.some(t => t.id === e.id));
    m.top.splice(at >= 0 ? at : m.top.length, 0, ...fresh);
    return m;
}

/** Reorder inside folder `uuid`: remove at `from`, insert at `to` (same contract as `move`). Out-of-range `from` is a no-op. */
export function moveInFolder(s: PinnedSnapshot, uuid: string, from: number, to: number): PinnedSnapshot {
    const list = s.folders[uuid];
    if (!list || from < 0 || from >= list.length)
        return s;
    const dest = clamp(to, list.length - 1);
    if (dest === from)
        return s;
    const m = mutable(s);
    const [e] = m.folders[uuid].splice(from, 1);
    m.folders[uuid].splice(dest, 0, e);
    return m;
}

/** Move `id` (from the top level, another folder, or unpinned) into folder `uuid` at `index` (default end). */
export function addToFolder(s: PinnedSnapshot, uuid: string, id: string, index?: number): PinnedSnapshot {
    if (!id || topIndexOfFolder(s.top, uuid) < 0 || !(uuid in s.folders) || topIndexOfFolder(s.top, id) >= 0)
        return s;
    const m = mutable(s);
    const list = m.folders[uuid];
    const own = list.findIndex(e => e.id === id);
    let at: number;
    if (own >= 0) {
        const wanted = index ?? list.length;
        const [e] = list.splice(own, 1);
        at = clamp(wanted - (own < wanted ? 1 : 0), list.length);
        list.splice(at, 0, e);
        return m;
    }
    const [e] = extract(m, [id], uuid);
    const target = m.folders[uuid];
    at = clamp(index ?? target.length, target.length);
    target.splice(at, 0, e);
    return m;
}

/** Move `id` out of folder `uuid` to the top level at `toIndex` (default end). An emptied folder is deleted. */
export function removeFromFolder(s: PinnedSnapshot, uuid: string, id: string, toIndex?: number): PinnedSnapshot {
    const list = s.folders[uuid];
    if (!list || !list.some(e => e.id === id) || topIndexOfFolder(s.top, id) >= 0)
        return s;
    const m = mutable(s);
    const fl = m.folders[uuid];
    const [e] = fl.splice(fl.findIndex(x => x.id === id), 1);
    let wanted = toIndex;
    if (fl.length === 0) {
        const f = dropFolder(m, uuid);
        if (wanted !== undefined && f >= 0 && f < wanted)
            wanted -= 1;
    }
    m.top.splice(clamp(wanted ?? m.top.length, m.top.length), 0, e);
    return m;
}

// Pinned-apps drag & drop. STUB: signatures are final.
//
// Responsibility: make tiles draggable (Clutter.DragAction / DND._Draggable), accept drops on
// the grid (reorder), on an app tile (create a folder from the two apps) and on a folder tile
// (add), and drag out of a folder back to the grid. All mutations go through PinnedStore.
//
// Public API:
//   enableDrag(scope, tile: St.Widget, payload: DragPayload): void
//   acceptDrops(scope, target: St.Widget, store: PinnedStore, drop: DropTarget): void
//   DragPayload: {id: string, folderUuid?: string}
//   DropTarget: {kind: 'grid', index: () => number} | {kind: 'app', id: string} | {kind: 'folder', uuid: string}

import type St from 'gi://St';

import type {Scope} from '../core/scope.js';
import type {PinnedStore} from '../model/pinned.js';

export interface DragPayload {
    id: string;
    folderUuid?: string;
}

export type DropTarget =
    | {kind: 'grid'; index: () => number}
    | {kind: 'app'; id: string}
    | {kind: 'folder'; uuid: string};

export function enableDrag(_scope: Scope, _tile: St.Widget, _payload: DragPayload): void {
    // TODO(ui owner)
}

export function acceptDrops(_scope: Scope, _target: St.Widget, _store: PinnedStore, _drop: DropTarget): void {
    // TODO(ui owner)
}

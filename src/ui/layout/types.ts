// Shared types of the menu layout modules (ui/layout.ts and ui/layout/*).
//
// Responsibility: the vocabulary the layout's controllers share, kept free of any widget so each module
// can depend on it without depending on the others.
//
// Public API:
//   LayoutHost      what the layout may ask of the popup (re-exported by ui/layout.ts)
//   ViewId          the views the left pane can show ('folder' is the popup over another view)
//   LayoutState     the few facts every controller reads (current view, open, destroyed, anchor side...);
//                   only the coordinator (SpawnLayout) writes them
//   Group           one keyboard group: a list or grid of focusable items with `cols` columns (or its own `move`)
//   Dir             an arrow direction
//   TileEntry       a cached pinned tile with the scope that owns its drag / drop wiring

import type Clutter from 'gi://Clutter';
import type Shell from 'gi://Shell';
import St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {Entry} from '../../core/settings.js';
import type {FolderRow, FolderTile} from '../widgets/folderTile.js';

export interface LayoutHost {
    /** Close the popup (e.g. after launching an app). */
    close(): void;
    /** Open a pinned folder (used by the folder context menu). */
    openFolder?(uuid: string): void;
    /** Open a pinned folder and start renaming it. */
    renameFolder?(uuid: string): void;
    /** Delete a pinned folder (its apps move to the top level) and offer Undo. */
    deleteFolder?(uuid: string): void;
    /** Hide an app from the generated lists (All Apps, categories, Frequent) and offer Undo. */
    hideApp?(app: Shell.App): void;
    /** Pin / unpin an app (or pinned command) and offer Undo. `name` is for the banner. */
    pin?(id: string, name: string): void;
    unpin?(id: string, name: string): void;
    /** Take an app out of a pinned folder (back to the top level) and offer Undo. */
    removeFromFolder?(uuid: string, id: string, name: string): void;
    /** Remove a right-pane shortcut and offer Undo. */
    removeShortcut?(entry: Entry, name: string): void;
    /** Open Spawn's settings window, on the Pinned page when `shortcuts` is set. */
    openSettings?(shortcuts: boolean): void;
}

export type ViewId = 'pinned' | 'frequent' | 'categories' | 'all' | 'folder' | 'results' | 'favorites' | 'recent';

/** What every controller may read about the layout; SpawnLayout is the only writer. */
export class LayoutState {
    view: ViewId = 'pinned';
    /** The view under an open folder popup (where closing the popup returns to). */
    underFolder: ViewId = 'pinned';
    isOpen = false;
    destroyed = false;
    side: St.Side = St.Side.TOP;
    anchor: St.Widget | null = null;
    /** Where the search entry currently sits (resolved from `search-entry-location`, "Auto" included). */
    searchTop = false;
}

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface Group {
    id: string;
    items: Clutter.Actor[];
    cols: number;
    /**
     * A group whose items are not a plain grid of `cols` columns (the Grid layout's All apps: letter headings are rows
     * of their own, groups end on short rows) steps itself: the item an arrow key reaches from `index`, or -1 for
     * Up / Down past its first / last row (the focus then leaves the group). Left / Right always stay inside the group.
     */
    move?(index: number, dir: Dir): number;
    /** The item `focusMain` starts on instead of the first one. */
    entry?: number;
}

export interface TileEntry {
    widget: St.Widget;
    scope: Scope;
    release(): void;
    folder?: FolderTile | FolderRow;
}

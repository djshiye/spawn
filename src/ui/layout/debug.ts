// layoutDebugState: the dev hook behind SpawnLayout.debugState().
//
// Responsibility: read the layout's observable state (view, focus, counts, sizes, highlight) for the Dev
// D-Bus interface and the sandbox scenarios. Read-only; it never builds or changes anything.
//
// Public API:
//   layoutDebugState(parts): Record<string, unknown>   `parts` are the layout's controllers (DebugParts)

import type Clutter from 'gi://Clutter';
import St from 'gi://St';

import type {FolderController} from './folders.js';
import type {LeftPane} from './leftPane.js';
import type {PaneMetrics} from './metrics.js';
import type {Navigator} from './navigation.js';
import type {PinnedView} from './pinnedView.js';
import type {RightPane} from './rightPane.js';
import type {SearchController} from './searchView.js';
import type {LayoutState} from './types.js';
import type {UndoController} from './undo.js';
import type {ViewManager} from './views.js';
import type {PointerHighlight} from '../widgets/highlight.js';
import type {SearchBox} from '../widgets/searchBox.js';
import type {TooltipManager} from '../widgets/tooltip.js';

export interface DebugParts {
    state: LayoutState;
    root: St.Widget;
    left: St.Widget;
    right: St.Widget;
    search: SearchBox;
    views: ViewManager;
    searchCtl: SearchController;
    pinned: PinnedView;
    folders: FolderController;
    metrics: PaneMetrics;
    leftPane: LeftPane;
    rightPane: RightPane;
    undo: UndoController;
    tooltips: TooltipManager;
    highlight: PointerHighlight;
    nav: Navigator;
}

/** Accessible names of the items showing a hover tint (dev hook: at most one may). */
function hoverTints(nav: Navigator): string[] {
    const {left, right, cats} = nav.paneGroups();
    return [...left, ...right, ...(cats ? [cats] : [])].flatMap(g => g.items)
        .filter(a => a instanceof St.Widget && a.hover).map(a => (a as St.Widget).accessible_name ?? '');
}

export function layoutDebugState(p: DebugParts): Record<string, unknown> {
    const focus = global.stage.key_focus as Clutter.Actor | null;
    // Reading sizes of a layout that is not parented to the stage yet (prebuilt, never opened)
    // asks for a preferred size -> theme node of an unstaged widget -> St critical.
    const staged = p.root.get_stage() !== null;
    const focusName = focus ? `${focus.constructor.name}.${(focus as St.Widget).style_class ?? ''}` : null;
    return {
        view: p.state.view,
        default: p.views.defaultView(),
        open: p.state.isOpen,
        search: p.search.text,
        focus: focusName,
        focusInLayout: Boolean(focus && p.root.contains(focus)),
        focusIndex: p.nav.locate(p.views.mainGroups(), focus)?.index ?? null,
        tiles: p.pinned.grid.tiles().length,
        display: p.metrics.listMode() ? 'List' : 'Grid',
        folder: p.state.view === 'folder' ? p.folders.view?.uuid ?? null : null,
        folderTiles: p.state.view === 'folder' ? p.folders.view?.tiles().length ?? 0 : 0,
        folderColumns: p.state.view === 'folder' ? p.folders.view?.columns ?? 0 : 0,
        results: p.searchCtl.results?.rows().length ?? 0,
        resultTitles: p.searchCtl.results?.titles() ?? [],
        links: p.leftPane.links?.actor.visible ? p.leftPane.links.buttons().length : 0,
        extraRows: p.views.extraList?.rows().length ?? 0,
        places: [p.rightPane.places.devices().length, p.rightPane.places.network().length, p.rightPane.places.bookmarks().length],
        tooltip: p.tooltips.debugText(),
        columns: p.metrics.cols,
        size: staged ? [p.root.width, p.root.height] : [0, 0],
        searchTop: p.state.searchTop,
        side: p.state.side,
        tileWidth: p.metrics.tileWidth,
        leftWidth: staged ? p.left.width : 0,
        rightWidth: staged ? p.right.width : 0,
        renaming: p.folders.view?.renaming ?? false,
        pinnedScroll: p.pinned.scroll?.vadjustment.value ?? 0,
        ghosts: p.pinned.ghostCount(),
        // accessible names of the app rows of the visible category list ("Firefox", "Firefox, new")
        appRows: (p.views.categories?.appRows() ?? []).map(r => r.accessible_name ?? ''),
        // rows of that list not built yet (All Apps builds them as they scroll into view)
        appRowsPending: p.views.categories?.pendingRows ?? 0,
        undo: p.undo.banner.visible,
        // the search highlight (Return target) and what the screen reader was told last
        selected: p.searchCtl.results?.selected()?.accessible_name ?? null,
        selectedIndex: p.searchCtl.results?.rows().indexOf(p.searchCtl.results.selected() as St.Widget) ?? -1,
        announcement: p.searchCtl.results?.announcement ?? '',
        // one-highlight rule: the item the pointer highlights, and every item showing a hover tint
        hovered: p.highlight.hovered?.accessible_name ?? null,
        hoverTints: hoverTints(p.nav),
    };
}

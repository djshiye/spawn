// SpawnLayout: the two-pane "spawn" layout (ArcMenu's "arcmenu" layout, see
// docs/research/layout.md).
//
// Responsibility: build the whole menu content as ONE St actor (`layout.actor`) that SpawnPopup
// places inside its popup. Left pane: search entry (top or bottom), the main view (pinned list or grid /
// all apps by category / frequent / search results), Back and All Apps buttons. Right
// pane: avatar, directory + application shortcuts, power bar. An open pinned folder is a popup card
// over both panes (FolderView, on top of the panes in the root's BinLayout); the view under it stays.
// Only cheap chrome is built up front; each view is created the first time it is shown.
//
// Public API:
//   new SpawnLayout(scope, services, host)
//   layout.actor: St.Widget            content root (class "spawn-layout"): the panes, plus the folder popup on top
//   layout.onOpen(anchor?, side?): void  menu is about to be shown from `anchor` (which decides the
//                                      work area the popup is clamped to) opening towards `side`
//                                      (reset view, "Auto" search position, focus search)
//   layout.onClosed(): void            menu was hidden (clear search, release caches)
//   layout.handleKey(event): boolean   Escape routing: true when the layout consumed the key
//   layout.search(query): void         put `query` in the search entry (dev / D-Bus hook)
//   layout.showView(id): void          'pinned' | 'frequent' | 'categories' | 'all' | 'favorites' | 'recent' | 'results' | 'default'
//   layout.setFakePlaces(specs | null) dev hook: fake devices / bookmarks in the right pane
//   layout.debugState(): object        view, focus, counts (dev hook)
//   LayoutHost                         what the layout may ask of the popup:
//                                      {close(), openFolder?(uuid), renameFolder?(uuid), deleteFolder?(uuid)}
//
// Sidebar extras (opt-in): category quick links (CategoryLinks; shown on the start view only, above or below
// the list) open the Pinned / Frequent / All Apps / Favorites / Recent Files views; the shortcuts list also shows
// external devices + network locations and bookmarks (Places, PlaceRow) between the folder and application shortcuts.
//
// Keyboard (besides arrows / Tab): Ctrl+Up/Down/Left/Right and Ctrl+Home/End on a focused pinned entry (top
// level or inside an open folder) move it (model/reorder.ts decides where, PinnedStore writes it, the focus
// stays on the entry). "Delete Folder" shows an in-menu banner "Folder \u201cX\u201d deleted [Undo]" for 8 s
// (UndoBanner; Ctrl+Z too); it ends when the menu closes or the pinned list changes otherwise.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {CategoryLink, ShortcutId} from '../core/constants.js';
import {debounce} from '../core/debounce.js';
import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {Entry, PinnedItemSize} from '../core/settings.js';
import type {FolderUndo, PinnedItem} from '../model/pinned.js';
import {Places, type FakePlace, type Place} from '../model/places.js';
import {reorderTarget, type ReorderKey} from '../model/reorder.js';
import type {SearchHandle, SearchResult} from '../search/engine.js';
import {AppContextMenu} from './contextMenu.js';
import {acceptDrops, enableDrag, rejectDrops} from './dnd.js';
import {ActionRow, AppRow} from './widgets/appRow.js';
import {ActionTile, AppTile, type TileHost} from './widgets/appTile.js';
import {CategoryLinks} from './widgets/categoryLinks.js';
import {CategoryList} from './widgets/categoryList.js';
import {ExtraList} from './widgets/extraList.js';
import {FolderRow, FolderTile, type FolderHost} from './widgets/folderTile.js';
import {FolderView} from './widgets/folderView.js';
import {makeFace, makeItemButton, wireItem} from './widgets/interact.js';
import {sizeMetrics} from './widgets/pinnedSize.js';
import {PlaceRow} from './widgets/placeRow.js';
import {PowerBar} from './widgets/powerBar.js';
import {ResultList, type ResultHost} from './widgets/resultList.js';
import {SearchBox} from './widgets/searchBox.js';
import {ShortcutRow, type ShortcutHost} from './widgets/shortcutRow.js';
import {TileGrid} from './widgets/tileGrid.js';
import {TooltipManager} from './widgets/tooltip.js';
import {UndoBanner} from './widgets/undoBanner.js';
import {UserCard} from './widgets/userCard.js';
import {applyScrollSettings, displayName, iconSizeFor, iconSizeOrHidden, launchApp, lookupApp, ownedScope, scrollIntoView} from './util.js';

export interface LayoutHost {
    /** Close the popup (e.g. after launching an app). */
    close(): void;
    /** Open a pinned folder (used by the folder context menu). */
    openFolder?(uuid: string): void;
    /** Open a pinned folder and start renaming it. */
    renameFolder?(uuid: string): void;
    /** Delete a pinned folder (its apps move to the top level) and offer Undo. */
    deleteFolder?(uuid: string): void;
}

export type ViewId = 'pinned' | 'frequent' | 'categories' | 'all' | 'folder' | 'results' | 'favorites' | 'recent';

/**
 * Floors the code enforces whatever the settings say (the prefs spin rows use the same minimums):
 * left pane 420 px (4 tile columns need ~390), right pane 180 px (avatar + names + 3 power buttons).
 */
export const MIN_LEFT_WIDTH = 420;
export const MIN_RIGHT_WIDTH = 180;
const MIN_COLUMNS = 3;
/**
 * Horizontal space used inside the left pane that tiles cannot use: the 16 + 16 px gutter (the pane's 8 px
 * edge plus the grid's 8 px; the left pane has no padding of its own, both are the padding of the first /
 * last column's tiles, which also absorbs a classic scrollbar).
 */
const LEFT_CHROME = 32;
const MIN_HEIGHT = 360;
/** Popup frame around the layout: content padding 2x8, shadow margins 3+3 / 14, arrow, breathing room. */
const FRAME_W = 16 + 6;
const FRAME_H = 16 + 14 + 14;
const SCREEN_MARGIN = 8;
/** Right pane margin (4) + vertical separator with its margins (1 + 2 x 6). */
const PANE_GAP = 4;
const SEPARATOR_W = 13;

/** Sizes and arrangement: re-derive the metrics and rebuild the pinned view. Disjoint from the other key sets (one handler per key). */
const RELAYOUT_KEYS = [
    'menu-height', 'menu-width-adjustment', 'left-panel-width', 'right-panel-width',
    'icon-size-grid', 'default-menu-view', 'vert-separator', 'search-entry-location', 'search-hidden',
    'multi-lined-labels', 'pinned-apps-display', 'pinned-item-size',
] as const;

/** Read once when a view is built: a change rebuilds the lists. */
const VIEW_KEYS = [
    'icon-size-apps', 'apps-show-extra-details', 'apps-show-generic-names', 'max-frequent-apps',
    'icon-size-categories', 'icon-style-categories',
] as const;

/** Scroll bar behaviour: only re-applied to the existing scroll views, nothing is rebuilt. */
const SCROLL_KEYS = ['scrollview-fade-effect', 'scrollbars-visible', 'scrollbars-overlay'] as const;

/** installed-changed bursts (a package transaction) are coalesced into one refresh. */
const INSTALLED_COALESCE_MS = 300;
/** How long a Return that found no result yet keeps waiting for the first batch. */
const ACTIVATE_WAIT_MS = 1000;
/** How long the "Folder deleted - Undo" banner stays (it also goes when the menu closes). */
const UNDO_MS = 8000;

/** Ctrl+<key> reorders the focused pinned entry. */
const REORDER_KEYS = new Map<number, ReorderKey>([
    [Clutter.KEY_Up, 'up'], [Clutter.KEY_Down, 'down'], [Clutter.KEY_Left, 'left'], [Clutter.KEY_Right, 'right'],
    [Clutter.KEY_Home, 'first'], [Clutter.KEY_End, 'last'],
]);

const RIGHT_KEYS = [
    'directory-shortcuts', 'application-shortcuts', 'icon-size-shortcuts', 'icon-style-shortcuts',
    'show-user-avatar', 'show-external-devices', 'show-bookmarks',
] as const;

/** Category quick links (default-menu-view and icon-size-categories are handled by the relayout / view-settings handlers). */
const LINK_KEYS = ['arcmenu-extra-categories-links', 'arcmenu-extra-categories-links-location'] as const;

type Dir = 'up' | 'down' | 'left' | 'right';

interface Group {
    id: string;
    items: Clutter.Actor[];
    cols: number;
}

interface TileEntry {
    widget: St.Widget;
    scope: Scope;
    release(): void;
    folder?: FolderTile | FolderRow;
}

function isDefaultViewPinnedish(view: string): boolean {
    return view === 'Pinned_Apps' || view === 'Frequent_Apps' || view === 'Pinned_And_Frequent_Apps';
}

export class SpawnLayout implements ShortcutHost {
    readonly actor: St.Widget;

    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _host: LayoutHost;

    // chrome
    private readonly _panes: St.BoxLayout;
    private readonly _left: St.BoxLayout;
    private readonly _right: St.BoxLayout;
    private readonly _vsep: St.Widget;
    private readonly _stack: St.BoxLayout;
    private readonly _nav: St.BoxLayout;
    private readonly _undoBanner: UndoBanner;
    private _undo: FolderUndo | null = null;
    private _cancelUndoTimer: (() => void) | null = null;
    private readonly _backButton: St.Button;
    private readonly _allAppsButton: St.Button;
    private readonly _search: SearchBox;
    private readonly _tooltips: TooltipManager;
    private readonly _context: AppContextMenu;

    // right pane (rebuilt as a unit)
    private _rightScope: Scope;
    private _userCard: UserCard | null = null;
    private _shortcutRows: Array<ShortcutRow | PlaceRow> = [];
    private _shortcutsBox: St.BoxLayout | null = null;
    private readonly _places: Places;
    private _powerBar: PowerBar | null = null;
    private _shortcutScroll: St.ScrollView | null = null;

    // lazily built views
    private _pinnedScroll: St.ScrollView | null = null;
    private _pinnedBox: St.BoxLayout | null = null;
    private readonly _grid = new TileGrid();
    private _frequentBox: St.BoxLayout | null = null;
    private _frequentScroll: St.ScrollView | null = null;
    private _categories: CategoryList | null = null;
    private _folderView: FolderView | null = null;
    private _extraList: ExtraList | null = null;
    private _extraScroll: St.ScrollView | null = null;
    private _links: CategoryLinks | null = null;
    private _resultsScroll: St.ScrollView | null = null;
    private _results: ResultList | null = null;
    private readonly _tileEntries = new Map<string, TileEntry>();
    private _pinnedDirty = true;
    private _pinnedSubscribed = false;

    // state
    private _view: ViewId = 'pinned';
    /** The view under an open folder popup (where closing the popup returns to). */
    private _underFolder: ViewId = 'pinned';
    /** Last keyboard-focused pinned tile and its index, to refocus a neighbour when it is destroyed. */
    private _lastTile: {widget: Clutter.Actor; index: number} | null = null;
    private _isOpen = false;
    private _searchHandle: SearchHandle | null = null;
    private _searchToken = 0;
    private _cols = 4;
    private _tileWidth = 96;
    private _tileIconSize = sizeMetrics('Compact').tileIcon;
    /** Icon size / label mode / naming the cached tiles were built with; a change rebuilds them. */
    private _tileSignature = '';
    private _side: St.Side = St.Side.TOP;
    private _anchor: St.Widget | null = null;
    /** Where the search entry currently sits (resolved from `search-entry-location`, "Auto" included). */
    private _searchTop = false;
    /** Return was pressed before the first batch of the query arrived: activate it when it does. */
    private _activateWhenReady = false;
    private _cancelActivateWait: (() => void) | null = null;
    /** cols|tile width|icon size of the last `_applyMetrics`: a change means the pinned tiles are stale. */
    private _metricsSig = '';
    private readonly _scrolls: St.ScrollView[] = [];
    private _destroyed = false;

    readonly tooltips: TooltipManager;
    private readonly _tileHost: TileHost;
    private readonly _folderHost: FolderHost;
    private readonly _resultHost: ResultHost;

    constructor(scope: Scope, services: Services, host: LayoutHost) {
        this._scope = scope;
        this._services = services;
        this._host = host;
        const settings = services.settings;

        this._tooltips = new TooltipManager(scope, settings);
        this.tooltips = this._tooltips;
        this._tileHost = {
            launch: (app, ctrl) => this._launch(app, ctrl),
            openContext: (tile, app, folderUuid) => this._context.open(tile, {
                kind: 'app',
                app,
                folderUuid: folderUuid ?? (this._view === 'folder' ? this._folderView?.uuid ?? undefined : undefined),
            }),
            tooltips: this._tooltips,
        };
        this._folderHost = {
            open: uuid => this._showFolder(uuid),
            openContext: (tile, uuid) => this._context.open(tile, {kind: 'folder', uuid}),
            tooltips: this._tooltips,
        };
        this._resultHost = {
            close: () => this.close(),
            showAllApps: () => this.showAllApps(),
            tooltips: this._tooltips,
            openResultContext: (row, result: SearchResult) => {
                const app = result.providerId === 'apps' ? lookupApp(this._services, result.id) : null;
                if (app)
                    this._context.open(row, {kind: 'app', app});
            },
        };
        // The folder context menu (Open / Rename) needs the layout, not just the popup. Deferred to an
        // idle: the menu is still closing (and restoring the focus) when its item activates.
        this._context = new AppContextMenu(scope, services, {
            close: () => host.close(),
            openFolder: uuid => {
                this._scope.idle(() => this._showFolder(uuid));
            },
            deleteFolder: uuid => this._deleteFolder(uuid),
            renameFolder: uuid => {
                this._scope.idle(() => {
                    this._showFolder(uuid);
                    if (this._view === 'folder' && this._folderView?.uuid === uuid)
                        this._folderView.startRename();
                });
            },
        });

        // A BinLayout root: the panes fill it, the folder popup (when open) lies on top of them.
        this.actor = new St.Widget({
            style_class: 'spawn-layout',
            layout_manager: new Clutter.BinLayout(),
            reactive: true,
        });
        this._panes = new St.BoxLayout({
            style_class: 'spawn-panes',
            orientation: Clutter.Orientation.HORIZONTAL,
            x_expand: true,
            y_expand: true,
        });
        this.actor.add_child(this._panes);

        // Registered FIRST so it runs LAST (LIFO): every widget scope is torn down while its
        // actors are still alive, then the root actor takes the remaining children with it.
        scope.add(() => {
            this._destroyed = true;
            this._searchHandle?.cancel();
            this.actor.destroy();
        }, 'SpawnLayout actor');

        this._left = new St.BoxLayout({style_class: 'spawn-left-pane', orientation: Clutter.Orientation.VERTICAL, y_expand: true});
        this._vsep = new St.Widget({style_class: 'spawn-vseparator', y_expand: true});
        this._right = new St.BoxLayout({style_class: 'spawn-right-pane', orientation: Clutter.Orientation.VERTICAL, y_expand: true});
        this._panes.add_child(this._left);
        this._panes.add_child(this._vsep);
        this._panes.add_child(this._right);

        this._search = new SearchBox(scope, settings);
        this._stack = new St.BoxLayout({style_class: 'spawn-stack', orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});

        this._nav = new St.BoxLayout({style_class: 'spawn-nav'});
        this._backButton = this._navButton('go-previous-symbolic', _('Back'), () => this._back());
        this._allAppsButton = this._navButton('view-app-grid-symbolic', _('All Apps'), () => this._openAllApps());
        this._nav.add_child(this._backButton);
        this._nav.add_child(this._allAppsButton);

        this._undoBanner = new UndoBanner(() => this._undoDelete());
        scope.add(() => this._cancelUndoTimer?.(), 'undo timer');
        // Any other change of the pinned list ends the undo window (restoring would clobber it).
        services.pinned.onChanged(scope, () => {
            if (this._undo && !services.pinned.isUnchangedSince(this._undo))
                this._dismissUndo();
        });

        this._places = new Places(scope.child('places'), settings);
        this._places.onChanged(scope, () => this._fillShortcuts());
        this._rightScope = scope.child('right pane');
        this._arrangeLeft();
        this._buildRight();
        this._applyMetrics();

        // search wiring
        this._search.onTextChanged(scope, text => this._onSearchText(text));
        this._search.onActivate(scope, () => this._onSearchActivate());
        this._search.onNavigate(scope, (key, shift) => this._onSearchKey(key, shift));

        // input
        this.actor.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => this._onKeyPress(event));
        this.actor.connect('button-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            if (event.get_button() === 8 && this._canGoBack()) {
                this._back();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        scope.connect(global.stage, 'notify::key-focus', () => this._onFocusChanged());

        settings.onChanged(scope, [...RELAYOUT_KEYS], () => this._relayout());
        settings.onChanged(scope, [...RIGHT_KEYS], () => this._buildRight());
        settings.onChanged(scope, [...LINK_KEYS], () => this._relink());
        settings.onChanged(scope, [...SCROLL_KEYS], () => this._onScrollSettings());
        settings.onChanged(scope, [...VIEW_KEYS], () => this._onViewSettings());

        // Apps installed / removed while the shell runs: pinned tiles (and ghosts) follow. AppIndex
        // only connects to this once it is built, so listen here too.
        const installed = debounce(scope, INSTALLED_COALESCE_MS, () => this._onInstalledChanged());
        scope.connect(Shell.AppSystem.get_default(), 'installed-changed', () => installed.call());
    }

    // ---- ShortcutHost / hosts ----

    close(): void {
        this._host.close();
    }

    showAllApps(): void {
        this._openAllApps();
    }

    // ---- public hooks ----

    onOpen(anchor: St.Widget | null = null, side: St.Side = St.Side.TOP): void {
        if (this._destroyed)
            return;
        this._isOpen = true;
        this._anchor = anchor;
        this._side = side;
        try {
            this._services.warmUp();
        } catch (e) {
            error('layout warm-up failed', e);
        }
        try {
            this._folderView?.commitRename();
            this._dismissUndo();
            this._context.close();
            this._search.setSilently('');
            this._cancelSearch();
            // The popup may open on another monitor / work area than last time: new columns or tile
            // widths make the cached pinned tiles stale.
            if (this._applyMetrics())
                this._pinnedDirty = true;
            if (this._searchOnTop() !== this._searchTop)
                this._arrangeLeft();
            this._setView(this._defaultView());
            for (const s of [this._pinnedScroll, this._frequentScroll, this._extraScroll, this._resultsScroll, this._shortcutScroll])
                s?.vadjustment.set_value(0);
            this._search.actor.visible = !this._services.settings.get('search-hidden');
            if (this._search.actor.visible)
                this._search.focus();
            else
                this._focusMain();
        } catch (e) {
            error('layout onOpen failed', e);
        }
    }

    onClosed(): void {
        this._isOpen = false;
        try {
            // Gone at once: it must not fade out over the next open of the menu.
            if (this._view === 'folder')
                this._folderView?.hide(false);
            this._dismissUndo();
            this._context.close();
            this._tooltips.hide();
            this._cancelSearch();
            this._setActivateWhenReady(false);
            this._search.setSilently('');
            this._results?.reset();
            this._services.search.cancel();
            this._services.search.clear();
        } catch (e) {
            error('layout onClosed failed', e);
        }
    }

    handleKey(event: unknown): boolean {
        const ev = event as Clutter.Event;
        if (ev.get_key_symbol() !== Clutter.KEY_Escape)
            return false;
        if (this._folderView?.renaming) {
            this._folderView.cancelRename();
            return true;
        }
        if (this._search.text.length > 0) {
            this._search.clear();
            return true;
        }
        if (this._canGoBack()) {
            this._back();
            return true;
        }
        return false;
    }

    search(query: string): void {
        if (this._isOpen && this._search.actor.visible)
            this._search.focus();
        this._search.text = query;
    }

    showView(id: string): void {
        if (id === 'default') {
            this._setView(this._defaultView());
            return;
        }
        if (id === 'results') {
            this._setView('results');
            return;
        }
        if (['pinned', 'frequent', 'categories', 'all', 'favorites', 'recent'].includes(id))
            this._setView(id as ViewId);
    }

    openFolderByIndex(index: number): void {
        const folders = this._services.pinned.items().filter(i => i.kind === 'folder');
        const f = folders[index];
        if (f?.kind === 'folder')
            this._showFolder(f.uuid);
    }

    showFolder(uuid: string): void {
        this._showFolder(uuid);
    }

    debugState(): Record<string, unknown> {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        // Reading sizes of a layout that is not parented to the stage yet (prebuilt, never opened)
        // asks for a preferred size -> theme node of an unstaged widget -> St critical.
        const staged = this.actor.get_stage() !== null;
        const focusName = focus ? `${focus.constructor.name}.${(focus as St.Widget).style_class ?? ''}` : null;
        return {
            view: this._view,
            default: this._defaultView(),
            open: this._isOpen,
            search: this._search.text,
            focus: focusName,
            focusInLayout: Boolean(focus && this.actor.contains(focus)),
            focusIndex: this._locate(this._mainGroups(), focus)?.index ?? null,
            tiles: this._grid.tiles().length,
            display: this._listMode() ? 'List' : 'Grid',
            folder: this._view === 'folder' ? this._folderView?.uuid ?? null : null,
            folderTiles: this._view === 'folder' ? this._folderView?.tiles().length ?? 0 : 0,
            folderColumns: this._view === 'folder' ? this._folderView?.columns ?? 0 : 0,
            results: this._results?.rows().length ?? 0,
            links: this._links?.actor.visible ? this._links.buttons().length : 0,
            extraRows: this._extraList?.rows().length ?? 0,
            places: [this._places.devices().length, this._places.network().length, this._places.bookmarks().length],
            tooltip: this._tooltips.debugText(),
            columns: this._cols,
            size: staged ? [this.actor.width, this.actor.height] : [0, 0],
            searchTop: this._searchTop,
            side: this._side,
            tileWidth: this._tileWidth,
            leftWidth: staged ? this._left.width : 0,
            rightWidth: staged ? this._right.width : 0,
            renaming: this._folderView?.renaming ?? false,
            pinnedScroll: this._pinnedScroll?.vadjustment.value ?? 0,
            ghosts: [...this._tileEntries.keys()].filter(k => k.startsWith('m:')).length,
        };
    }

    // ---- sizes ----

    /** Work area of the monitor the popup opens on (the anchor's, else the primary one). */
    /** Is the pinned grid on screen (its own view, or under an open folder popup)? */
    private _pinnedShowing(): boolean {
        if (!this._isOpen)
            return false;
        return this._view === 'pinned' || (this._view === 'folder' && Boolean(this._pinnedScroll?.visible));
    }

    /** Size of the menu content the folder popup is centred in (pane widths + separator, menu height). */
    private _contentSize(): {width: number; height: number} {
        // Fixed sizes from _applyMetrics: readable before the layout is staged or allocated.
        const width = this._left.width + this._right.width + PANE_GAP + (this._vsep.visible ? SEPARATOR_W : 0);
        return {width, height: this.actor.height};
    }

    private _workArea(): {width: number; height: number} | null {
        try {
            const lm = Main.layoutManager;
            const index = this._anchor ? lm.findIndexForActor(this._anchor) : lm.primaryIndex;
            const wa = lm.getWorkAreaForMonitor(index >= 0 ? index : lm.primaryIndex);
            return wa ? {width: wa.width, height: wa.height} : null;
        } catch {
            return null;
        }
    }

    /**
     * Pane widths and menu height from the settings, clamped to the work area of the anchor's
     * monitor: the left pane shrinks first (never below MIN_LEFT_WIDTH), then the right pane (never
     * below MIN_RIGHT_WIDTH); the height never exceeds the work area minus the popup frame.
     */
    private _applyMetrics(): boolean {
        const s = this._services.settings;
        let left = Math.max(MIN_LEFT_WIDTH, s.get('left-panel-width') + s.get('menu-width-adjustment'));
        let right = Math.max(MIN_RIGHT_WIDTH, s.get('right-panel-width'));
        const sep = s.get('vert-separator');
        const wa = this._workArea();

        let maxH = Infinity;
        if (wa) {
            maxH = Math.max(0, wa.height - 2 * SCREEN_MARGIN - FRAME_H);
            const maxW = wa.width - 2 * SCREEN_MARGIN - FRAME_W - PANE_GAP - (sep ? SEPARATOR_W : 0);
            if (left + right > maxW) {
                left = Math.max(MIN_LEFT_WIDTH, maxW - right);
                if (left + right > maxW)
                    right = Math.max(MIN_RIGHT_WIDTH, maxW - left);
            }
        }
        const height = Math.max(Math.min(MIN_HEIGHT, maxH), Math.min(s.get('menu-height'), maxH));

        this._left.set_width(left);
        this._right.set_width(right);
        this._vsep.visible = sep;
        this.actor.set_height(height);

        const avail = left - LEFT_CHROME;
        const metrics = sizeMetrics(s.get('pinned-item-size'));
        this._cols = Math.max(MIN_COLUMNS, Math.floor(avail / metrics.tileTargetWidth));
        this._tileWidth = Math.floor(avail / this._cols);
        const grid = s.get('icon-size-grid');
        const size = grid?.size ?? -1;
        this._tileIconSize = size > 0 ? size : metrics.tileIcon;

        const sig = `${this._cols}|${this._tileWidth}|${this._tileIconSize}`;
        const changed = this._metricsSig !== '' && sig !== this._metricsSig;
        this._metricsSig = sig;
        return changed;
    }

    private _relayout(): void {
        if (this._destroyed)
            return;
        this._applyMetrics();
        this._arrangeLeft();
        this._pinnedDirty = true;
        if (this._isOpen)
            this._setView(this._view);
        // List <-> grid (or a new column count) changes the folder contents too.
        if (this._view === 'folder')
            this._folderView?.refresh();
    }

    /** Settings that are read once when a view is built: re-apply scrolling, rebuild the lists. */
    private _onViewSettings(): void {
        if (this._destroyed)
            return;
        this._categories?.refresh();
        this._syncLinks();
        this._pinnedDirty = true;
        if (this._isOpen)
            this._setView(this._view);
        if (this._view === 'folder')
            this._folderView?.refresh();
    }

    /** Scroll bar settings: re-apply to every existing scroll view; no rebuild. */
    private _onScrollSettings(): void {
        if (this._destroyed)
            return;
        const s = this._services.settings;
        const scrolls = [
            ...this._scrolls, this._shortcutScroll,
            this._categories?.appScroll(), this._categories?.columnScroll(), this._folderView?.scroll,
        ];
        for (const scroll of scrolls) {
            if (scroll)
                applyScrollSettings(scroll, s);
        }
    }

    private _onInstalledChanged(): void {
        if (this._destroyed)
            return;
        // An app may have appeared (a ghost tile becomes real) or vanished (a tile becomes a ghost).
        if (this._pinnedSubscribed)
            this._services.pinned.invalidate();
        this._pinnedDirty = true;
        if (this._pinnedShowing())
            this._syncPinnedIfNeeded();
        if (this._isOpen && this._view === 'folder')
            this._folderView?.refresh();
    }

    // ---- chrome ----

    private _navButton(iconName: string, text: string, cb: () => void): St.Button {
        // Full pane width like every other row: only one of Back / All Apps shows at a time (_updateNav), so the
        // whole row highlights on hover and takes the click, not just the icon + label.
        const button = makeItemButton('spawn-nav-button');
        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const navIcon = new St.Icon({icon_name: iconName, icon_size: iconSizeFor(this._services.settings, 'icon-size-misc', 16), y_align: Clutter.ActorAlign.CENTER});
        this._services.settings.onChanged(this._scope, ['icon-size-misc'], () => {
            navIcon.icon_size = iconSizeFor(this._services.settings, 'icon-size-misc', 16);
        });
        box.add_child(navIcon);
        box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        button.set_child(makeFace('spawn-nav-surface', box));
        wireItem(button, {activate: () => cb()});
        return button;
    }

    /**
     * Search entry on top? `Top` / `Bottom` as set; `Auto` puts it on the side nearest the panel
     * (arrow side TOP = popup below a top panel = entry on top; BOTTOM = popup above = entry below).
     */
    private _searchOnTop(): boolean {
        const loc = this._services.settings.get('search-entry-location') as string;
        if (loc === 'Auto')
            return this._side === St.Side.TOP;
        return loc === 'Top';
    }

    /** (Re)order the left pane children: search, quick links, stack, nav according to settings. */
    private _arrangeLeft(): void {
        const top = this._searchOnTop();
        this._searchTop = top;
        this._syncLinks();
        const links = this._links?.actor ?? null;
        for (const c of [this._search.actor, this._stack, this._undoBanner.actor, this._nav, links]) {
            if (c && c.get_parent() === this._left)
                this._left.remove_child(c);
        }
        this._search.actor.remove_style_class_name('spawn-search-top');
        this._search.actor.remove_style_class_name('spawn-search-bottom');
        const linksTop = this._links?.location === 'Top';
        const add = (c: St.Widget | null): void => {
            if (c)
                this._left.add_child(c);
        };
        if (top)
            add(this._search.actor);
        if (linksTop)
            add(links);
        add(this._stack);
        if (!linksTop)
            add(links);
        add(this._undoBanner.actor);
        add(this._nav);
        if (!top)
            add(this._search.actor);
        this._search.actor.add_style_class_name(top ? 'spawn-search-top' : 'spawn-search-bottom');
    }

    /** The enabled quick links, minus the start view itself and All Apps where its nav button shows (none for the category list). */
    private _linkIds(): number[] {
        const s = this._services.settings;
        const view = s.get('default-menu-view');
        if (view === 'Categories_List')
            return [];
        const skip = new Set<number>();
        if (view === 'Pinned_Apps' || view === 'Pinned_And_Frequent_Apps')
            skip.add(CategoryLink.PINNED);
        if (view === 'Frequent_Apps' || view === 'Pinned_And_Frequent_Apps')
            skip.add(CategoryLink.FREQUENT);
        // All_Programs is the start view itself; on the pinned-ish start views the All Apps nav button is already
        // right under the links, so a second "All Apps" row would only duplicate it.
        if (view === 'All_Programs' || isDefaultViewPinnedish(view))
            skip.add(CategoryLink.ALL_PROGRAMS);
        const known = new Set<number>(Object.values(CategoryLink));
        const seen = new Set<number>();
        const ids: number[] = [];
        for (const [id, on] of s.get('arcmenu-extra-categories-links')) {
            if (on && known.has(id) && !skip.has(id) && !seen.has(id)) {
                seen.add(id);
                ids.push(id);
            }
        }
        return ids;
    }

    /** Create / refill the quick links box (it is parented by _arrangeLeft) and show it where it belongs. */
    private _syncLinks(): void {
        const s = this._services.settings;
        const location = s.get('arcmenu-extra-categories-links-location');
        const ids = this._linkIds();
        if (this._links && this._links.location !== location) {
            this._links.destroy();
            this._links = null;
        }
        if (ids.length === 0) {
            this._links?.setLinks([], 0);
        } else {
            this._links ??= new CategoryLinks({open: id => this._openLink(id), tooltips: this._tooltips}, location);
            this._links.setLinks(ids, iconSizeOrHidden(s, 'icon-size-categories', 16));
        }
        this._updateLinksVisible();
    }

    /** The links belong to the start view only: any other view (or a search) has Back instead. */
    private _updateLinksVisible(): void {
        if (this._links)
            this._links.actor.visible = this._links.buttons().length > 0 && !this._canGoBack();
    }

    private _openLink(id: number): void {
        switch (id) {
        case CategoryLink.FAVORITES: this._setView('favorites'); break;
        case CategoryLink.FREQUENT: this._setView('frequent'); break;
        case CategoryLink.ALL_PROGRAMS: this._setView('all'); break;
        case CategoryLink.PINNED: this._setView('pinned'); break;
        case CategoryLink.RECENT_FILES: this._setView('recent'); break;
        default: return;
        }
        this._focusMain();
    }

    /** The links settings changed: rebuild the box (a new location re-parents it). */
    private _relink(): void {
        if (this._destroyed)
            return;
        this._arrangeLeft();
    }

    private _buildRight(): void {
        if (this._destroyed)
            return;
        this._tooltips.hide();
        this._rightScope.dispose();
        this._userCard = null;
        this._shortcutRows = [];
        this._powerBar = null;
        this._shortcutScroll = null;
        this._shortcutsBox = null;
        for (const c of this._right.get_children())
            c.destroy();

        const s = this._services.settings;
        const scope = this._rightScope;
        const hostWithTips: ShortcutHost = {close: () => this.close(), showAllApps: () => this.showAllApps(), tooltips: this._tooltips};

        this._userCard = new UserCard(scope, s, hostWithTips);
        this._right.add_child(this._userCard.actor);
        if (s.get('show-user-avatar'))
            this._right.remove_style_class_name('spawn-no-card');
        else
            this._right.add_style_class_name('spawn-no-card');

        const shortcutsBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-shortcuts-box'});
        const scroll = this._makeScroll(shortcutsBox, 'spawn-shortcuts', false);
        this._shortcutScroll = scroll;
        this._shortcutsBox = shortcutsBox;
        this._fillShortcuts();
        this._right.add_child(scroll);

        this._powerBar = new PowerBar(scope, s, hostWithTips);
        this._right.add_child(this._powerBar.actor);
    }

    /**
     * (Re)build the rows of the shortcuts list: folder shortcuts, then external devices + network locations,
     * then bookmarks, then application shortcuts, a rule between non-empty groups. Runs again when a drive
     * is mounted / ejected or the bookmarks change.
     */
    private _fillShortcuts(): void {
        const box = this._shortcutsBox;
        if (this._destroyed || !box)
            return;
        this._tooltips.hide();
        for (const c of box.get_children())
            c.destroy();
        this._shortcutRows = [];

        const s = this._services.settings;
        const scope = this._rightScope;
        const host: ShortcutHost = {close: () => this.close(), showAllApps: () => this.showAllApps(), tooltips: this._tooltips};
        const iconSize = iconSizeOrHidden(s, 'icon-size-shortcuts', 16);
        const symbolic = s.get('icon-style-shortcuts') === 'Symbolic';

        const places: Place[] = [];
        if (s.get('show-external-devices'))
            places.push(...this._places.devices(), ...this._places.network());
        const bookmarks: Place[] = s.get('show-bookmarks') ? this._places.bookmarks() : [];
        const groups: Array<Array<Entry | Place>> = [s.get('directory-shortcuts'), places, bookmarks, s.get('application-shortcuts')]
            .filter(g => g.length > 0);
        const list: Array<Entry | Place> = [];
        groups.forEach((g, i) => {
            if (i > 0)
                list.push({id: ShortcutId.SEPARATOR});
            list.push(...g);
        });

        let lastWasSeparator = true;
        for (const item of list) {
            if (!('id' in item)) {
                const row = new PlaceRow(item, host, {iconSize});
                lastWasSeparator = false;
                this._shortcutRows.push(row);
                box.add_child(row.actor);
                continue;
            }
            const row = new ShortcutRow(item, host, {iconSize, symbolic, scope});
            if (row.isSeparator) {
                if (lastWasSeparator) {
                    row.destroy();
                    continue;
                }
                lastWasSeparator = true;
            } else {
                if (!ShortcutRow.resolve(item)) {
                    row.destroy();
                    continue;
                }
                lastWasSeparator = false;
            }
            this._shortcutRows.push(row);
            box.add_child(row.actor);
        }
        const last = this._shortcutRows[this._shortcutRows.length - 1];
        if (last?.isSeparator) {
            last.destroy();
            this._shortcutRows.pop();
        }
    }

    /** Dev hook (Ui.SetPlaces): show fake devices / network locations / bookmarks, null = the real ones. */
    setFakePlaces(specs: FakePlace[] | null): void {
        this._places.setFake(specs);
    }

    /** `track`: remember it so scroll settings changes re-apply live (views built once, not the right pane). */
    private _makeScroll(child: St.Widget, styleClass: string, track = true): St.ScrollView {
        const settings = this._services.settings;
        const scroll = new St.ScrollView({
            style_class: styleClass,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
        });
        applyScrollSettings(scroll, settings);
        scroll.add_child(child);
        if (track)
            this._scrolls.push(scroll);
        return scroll;
    }

    // ---- views ----

    private _defaultView(): ViewId {
        switch (this._services.settings.get('default-menu-view')) {
        case 'Categories_List': return 'categories';
        case 'Frequent_Apps': return 'frequent';
        case 'All_Programs': return 'all';
        default: return 'pinned';
        }
    }

    private _canGoBack(): boolean {
        return this._view !== this._defaultView() || this._search.text.length > 0;
    }

    private _back(): void {
        if (this._search.text.length > 0) {
            this._search.clear();
            return;
        }
        const folder = this._view === 'folder' ? this._folderView?.uuid ?? null : null;
        // Closing a folder popup returns to the view it was opened over (e.g. Pinned reached by a quick link).
        this._setView(this._view === 'folder' ? this._underFolder : this._defaultView());
        // Closing a folder popup: the keyboard goes back to the folder it came from.
        const folderTile = folder && this._view === 'pinned' ? this._tileEntries.get(`f:${folder}`)?.widget : null;
        if (this._isOpen && folderTile?.mapped) {
            folderTile.grab_key_focus();
            return;
        }
        if (this._isOpen) {
            // `search-hidden`: the entry is out of sight, so focus the list (typing reveals the entry).
            if (this._search.actor.visible)
                this._search.focus();
            else
                this._focusMain();
        }
    }

    private _openAllApps(): void {
        const action = this._services.settings.get('all-apps-button-action');
        this._setView(action === 'All_Programs' ? 'all' : 'categories');
        this._focusMain();
    }

    private _setView(view: ViewId): void {
        if (this._destroyed)
            return;
        this._tooltips.hide();
        if (view === 'folder') {
            // The folder is a popup over the current view: that view stays as it is underneath.
            this._ensureFolderView();
            if (this._view !== 'folder')
                this._underFolder = this._view;
            this._view = view;
            // A relayout while the popup is open (display / size settings): the pinned grid under it follows.
            if (this._pinnedShowing())
                this._syncPinnedIfNeeded();
            this._updateNav();
            this._results?.setSelectionVisible(true);
            return;
        }
        if (this._view === 'folder')
            this._folderView?.hide(this._isOpen);
        const actors = this._ensureView(view);
        this._view = view;
        for (const child of this._stack.get_children())
            child.visible = actors.includes(child);
        this._updateNav();
        if (view === 'pinned')
            this._results?.setSelectionVisible(true);
    }

    /** Build (if needed) and refresh the actors a view consists of; returns the actors to show. */
    private _ensureView(view: ViewId): Clutter.Actor[] {
        const add = (a: Clutter.Actor) => {
            if (a.get_parent() !== this._stack)
                this._stack.add_child(a);
            return a;
        };
        switch (view) {
        case 'pinned': {
            const scroll = this._ensurePinned();
            this._syncPinnedIfNeeded();
            this._refreshPinnedFrequent();
            return [add(scroll)];
        }
        case 'frequent': {
            if (!this._frequentScroll) {
                this._frequentBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-list'});
                this._frequentScroll = this._makeScroll(this._frequentBox, 'spawn-frequent');
            }
            this._fillFrequent(this._frequentBox as St.BoxLayout);
            return [add(this._frequentScroll)];
        }
        case 'categories':
        case 'all': {
            const list = this._ensureCategories();
            list.setColumnVisible(view === 'categories');
            list.showCategory('all');
            list.ensureBuilt();
            return [add(list.actor)];
        }
        case 'folder':
            // Never a stack child: _setView shows the popup on top of the panes instead.
            return [];
        case 'favorites':
        case 'recent': {
            if (!this._extraList || !this._extraScroll) {
                this._extraList = new ExtraList(this._services, {...this._tileHostWithTips(), close: () => this.close()});
                this._extraScroll = this._makeScroll(this._extraList.actor, 'spawn-frequent');
            }
            this._extraList.show(view);
            return [add(this._extraScroll)];
        }
        case 'results': {
            if (!this._resultsScroll) {
                this._results = new ResultList(this._scope, this._services.settings, this._resultHost);
                this._resultsScroll = this._makeScroll(this._results.actor, 'spawn-results');
            }
            return [add(this._resultsScroll)];
        }
        }
    }

    private _ensurePinned(): St.ScrollView {
        if (!this._pinnedScroll) {
            this._pinnedBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-pinned-box'});
            this._pinnedBox.add_child(new St.Label({text: _('Pinned'), style_class: 'spawn-section-title'}));
            this._pinnedBox.add_child(this._grid.actor);
            this._pinnedScroll = this._makeScroll(this._pinnedBox, 'spawn-pinned');
            acceptDrops(this._scope, this._pinnedScroll, this._services.pinned, {kind: 'grid', index: () => -1});
            if (!this._pinnedSubscribed) {
                this._pinnedSubscribed = true;
                this._services.pinned.onChanged(this._scope, () => {
                    this._pinnedDirty = true;
                    if (this._pinnedShowing())
                        this._syncPinnedIfNeeded();
                });
            }
        }
        return this._pinnedScroll;
    }

    private _ensureCategories(): CategoryList {
        if (!this._categories)
            this._categories = new CategoryList(this._scope.child('categories'), this._services, this._tileHostWithTips());
        return this._categories;
    }

    private _ensureFolderView(): FolderView {
        if (!this._folderView) {
            this._folderView = new FolderView(this._scope.child('folder view'), this._services, {
                ...this._tileHostWithTips(),
                back: () => this._back(),
                metrics: () => ({
                    columns: this._cols,
                    tileWidth: this._tileWidth,
                    iconSize: this._tileIconSize,
                    // The popup is always a grid, so the grid's label setting applies in the list display too.
                    multiLine: this._services.settings.get('multi-lined-labels'),
                    list: this._listMode(),
                    rowIconSize: this._rowIconSize(),
                    size: this._itemSize(),
                    ...this._contentSize(),
                }),
                openMissingContext: (tile, id) => this._context.open(tile, {kind: 'custom', id}),
            });
            this.actor.add_child(this._folderView.actor);
        }
        return this._folderView;
    }

    private _tileHostWithTips(): TileHost {
        return this._tileHost;
    }

    /** `max-frequent-apps`; anything below 1 (hand-edited dconf) falls back to the default of 8. */
    private _frequentLimit(): number {
        const n = this._services.settings.get('max-frequent-apps');
        return n > 0 ? n : 8;
    }

    private _fillFrequent(box: St.BoxLayout): void {
        this._tooltips.hide();
        for (const c of box.get_children())
            c.destroy();
        const s = this._services.settings;
        const opts = {iconSize: iconSizeFor(s, 'icon-size-apps', 28), description: s.get('apps-show-extra-details')};
        const apps = this._services.appIndex.frequent(this._frequentLimit());
        for (const app of apps)
            box.add_child(new AppRow(app, this._tileHostWithTips(), {...opts, name: displayName(app, s)}).actor);
        // each row carries 1 px of the pitch below it: the last one has nothing to separate from (the scroll range)
        (box.get_last_child() as St.Widget | null)?.set_style('padding-bottom: 0;');
        if (apps.length === 0) {
            box.add_child(new St.Label({
                text: _('Nothing here yet'),
                style_class: 'spawn-empty-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            }));
        }
    }

    /** Pinned_And_Frequent_Apps: a frequent section under the pinned grid. */
    private _refreshPinnedFrequent(): void {
        const box = this._pinnedBox;
        if (!box)
            return;
        if (this._frequentSection) {
            this._frequentSection.destroy();
            this._frequentSection = null;
        }
        if (this._services.settings.get('default-menu-view') !== 'Pinned_And_Frequent_Apps')
            return;
        const section = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        section.add_child(new St.Widget({style_class: 'spawn-separator', x_expand: true}));
        section.add_child(new St.Label({text: _('Frequent'), style_class: 'spawn-section-title'}));
        // Under the pinned LIST the frequent rows use the same pitch / inset as the pinned rows.
        const rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: this._listMode() ? 'spawn-list' : ''});
        section.add_child(rows);
        this._fillFrequent(rows);
        box.add_child(section);
        this._frequentSection = section;
    }

    private _frequentSection: St.BoxLayout | null = null;

    // ---- pinned grid ----

    private _syncPinnedIfNeeded(): void {
        if (!this._pinnedDirty && this._tileEntries.size > 0)
            return;
        this._pinnedDirty = false;
        try {
            this._syncPinned();
        } catch (e) {
            error('pinned sync failed', e);
        }
    }

    private _folderIcons(uuid: string): Gio.Icon[] {
        const icons: Gio.Icon[] = [];
        for (const e of this._services.pinned.folderApps(uuid)) {
            const icon = lookupApp(this._services, e.id)?.get_icon();
            if (icon)
                icons.push(icon);
            if (icons.length >= 4)
                break;
        }
        return icons;
    }

    /** `pinned-apps-display`: pinned apps and folder contents as full-width rows instead of tiles. */
    private _listMode(): boolean {
        return this._services.settings.get('pinned-apps-display') === 'List';
    }

    /** `pinned-item-size`: Compact / Comfortable / Large (list row height, tile icon, folder plate). */
    private _itemSize(): PinnedItemSize {
        return this._services.settings.get('pinned-item-size');
    }

    /** Icon size of list rows: `icon-size-apps` when set, else the item size's default (28 at Compact, as the frequent / all-apps rows). */
    private _rowIconSize(): number {
        return iconSizeFor(this._services.settings, 'icon-size-apps', sizeMetrics(this._itemSize()).rowIcon);
    }

    private _syncPinned(): void {
        this._tooltips.hide();
        const store = this._services.pinned;
        const settings = this._services.settings;
        const multiLine = settings.get('multi-lined-labels');
        const generic = settings.get('apps-show-generic-names');
        const list = this._listMode();
        const rowIconSize = this._rowIconSize();

        // Tiles keep their icon size / label mode / naming from when they were built: a change in
        // any of them (or list <-> grid, which swaps tiles for rows) rebuilds every entry
        // (otherwise old and new sizes mix in one grid).
        // List rows are always one line (multi-lined-labels is a grid setting).
        const size = this._itemSize();
        const signature = list ? `list${rowIconSize}|${generic}|${size}` : `grid${this._tileIconSize}|${multiLine}|${generic}|${size}`;
        if (signature !== this._tileSignature) {
            this._tileSignature = signature;
            for (const [key, entry] of [...this._tileEntries]) {
                this._tileEntries.delete(key);
                entry.release();
                entry.widget.destroy();
            }
        }

        const keep = new Set<string>();
        const tiles: St.Widget[] = [];
        const tileOpts = {iconSize: list ? rowIconSize : this._tileIconSize, multiLine: multiLine && !list};
        const dropOpts = {vertical: list};

        // A pinned app whose .desktop file is gone (uninstalled, unmounted Flatpak remote) stays in
        // the settings; it shows as a dimmed tile whose context menu offers "Unpin".
        const ghost = (id: string, key: string): TileEntry => {
            const {scope, release} = ownedScope(this._scope, key);
            const name = id.replace(/\.desktop$/, '');
            const open = () => this._context.open(tile.actor, {kind: 'custom', id});
            const tile = list
                ? new ActionRow(name, 'application-x-executable', open, undefined, {...tileOpts, context: open})
                : new ActionTile(name, 'application-x-executable', open, undefined, {...tileOpts, context: open});
            tile.actor.add_style_class_name('spawn-tile-missing');
            tile.actor.opacity = 130;
            // Not part of the store's visible index: refuse drops instead of letting them fall through
            // to the list's append-at-end target.
            rejectDrops(scope, tile.actor);
            this._tooltips.attach(tile.actor, null, () => _('%s (not installed)').format(name));
            return {scope, release, widget: tile.actor};
        };

        const make = (item: PinnedItem): {key: string; entry: TileEntry} | null => {
            switch (item.kind) {
            case 'app': {
                const app = item.missing ? null : lookupApp(this._services, item.id);
                const key = `${app ? 'a' : 'm'}:${item.id}`;
                const existing = this._tileEntries.get(key);
                if (existing)
                    return {key, entry: existing};
                if (!app)
                    return {key, entry: ghost(item.id, key)};
                const {scope, release} = ownedScope(this._scope, key);
                const name = displayName(app, settings);
                const tile = list
                    ? new AppRow(app, this._tileHostWithTips(), {...tileOpts, name, pinned: true})
                    : new AppTile(app, this._tileHostWithTips(), {...tileOpts, name});
                enableDrag(scope, tile.actor, {id: item.id});
                acceptDrops(scope, tile.actor, store, {kind: 'app', id: item.id}, dropOpts);
                return {key, entry: {widget: tile.actor, scope, release}};
            }
            case 'folder': {
                const key = `f:${item.uuid}`;
                const existing = this._tileEntries.get(key);
                if (existing?.folder) {
                    existing.folder.update(item.name, this._folderIcons(item.uuid));
                    return {key, entry: existing};
                }
                const {scope, release} = ownedScope(this._scope, key);
                const Folder = list ? FolderRow : FolderTile;
                const tile = new Folder(item.uuid, item.name, this._folderIcons(item.uuid), this._folderHost,
                    {...tileOpts, plateInset: sizeMetrics(size).plateInset});
                enableDrag(scope, tile.actor, {id: item.uuid, isFolder: true});
                acceptDrops(scope, tile.actor, store, {kind: 'folder', uuid: item.uuid}, dropOpts);
                return {key, entry: {widget: tile.actor, scope, release, folder: tile}};
            }
            case 'custom': {
                const key = `c:${item.entry.id}`;
                const existing = this._tileEntries.get(key);
                if (existing)
                    return {key, entry: existing};
                const {scope, release} = ownedScope(this._scope, key);
                const id = item.entry.id;
                const Action = list ? ActionRow : ActionTile;
                const tile = new Action(item.entry.name || id, item.entry.icon || 'application-x-executable',
                    () => this._runCustom(id), {tooltips: this._tooltips},
                    {...tileOpts, context: () => this._context.open(tile.actor, {kind: 'custom', id})});
                enableDrag(scope, tile.actor, {id, isCustom: true});
                acceptDrops(scope, tile.actor, store, {kind: 'app', id, isCustom: true}, dropOpts);
                return {key, entry: {widget: tile.actor, scope, release}};
            }
            }
        };

        for (const item of store.items(true)) {
            const made = make(item);
            if (!made)
                continue;
            // The same id twice in pinned-apps (hand-edited dconf, import) must not add one actor twice.
            if (keep.has(made.key))
                continue;
            keep.add(made.key);
            this._tileEntries.set(made.key, made.entry);
            tiles.push(made.entry.widget);
        }
        for (const [key, entry] of [...this._tileEntries]) {
            if (!keep.has(key)) {
                this._tileEntries.delete(key);
                entry.release();
                entry.widget.destroy();
            }
        }
        this._grid.setTiles(tiles, list ? 1 : this._cols, list ? -1 : this._tileWidth, size);
    }

    private _runCustom(id: string): void {
        this._host.close();
        try {
            if (id === ShortcutId.SHOW_ALL_APPS) {
                this._openAllApps();
                return;
            }
            const app = lookupApp(this._services, id);
            if (app)
                app.activate();
            else
                Gio.AppInfo.create_from_commandline(id, null, Gio.AppInfoCreateFlags.NONE).launch([], null);
        } catch (e) {
            error(`could not run ${id}`, e);
        }
    }

    // ---- folders ----

    private _showFolder(uuid: string): void {
        const fv = this._ensureFolderView();
        // The folder vanished (deleted elsewhere, emptied): show() already went back to the default
        // view, so do not switch to an empty folder view.
        if (!fv.show(uuid, this._isOpen))
            return;
        this._setView('folder');
        const first = fv.tiles()[0];
        if (this._isOpen)
            (first ?? fv.headerButtons()[0]).grab_key_focus();
    }

    // ---- delete folder + undo ----

    /** "Delete Folder": the apps move to the top level; the banner offers to put the folder back. */
    private _deleteFolder(uuid: string): void {
        const store = this._services.pinned;
        const undo = store.captureFolder(uuid);
        store.dissolveFolder(uuid);
        if (!undo)
            return;
        store.markDissolved(undo);
        this._dismissUndo();
        this._undo = undo;
        this._undoBanner.show(_('Folder \u201c%s\u201d deleted').format(undo.name));
        this._cancelUndoTimer = this._scope.timeout(UNDO_MS, () => this._dismissUndo());
    }

    private _dismissUndo(): void {
        this._cancelUndoTimer?.();
        this._cancelUndoTimer = null;
        this._undo = null;
        this._undoBanner.hide();
    }

    private _undoDelete(): void {
        const undo = this._undo;
        this._dismissUndo();
        if (!undo || this._destroyed)
            return;
        try {
            if (!this._services.pinned.restoreFolder(undo))
                return;
        } catch (e) {
            error('undo of folder delete failed', e);
            return;
        }
        // The banner (and its focus) is gone: put the keyboard on the folder that came back.
        if (this._isOpen && this._view === 'pinned') {
            this._syncPinnedIfNeeded();
            const widget = this._tileEntries.get(`f:${undo.uuid}`)?.widget;
            if (widget)
                widget.grab_key_focus();
            else
                this._focusMain();
        }
    }

    // ---- keyboard reordering (Ctrl+arrows / Ctrl+Home / Ctrl+End) ----

    /** True when the focus is on a reorderable pinned entry (the key is then consumed, even at an edge). */
    private _reorderFocused(key: ReorderKey): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus || this._destroyed)
            return false;
        const store = this._services.pinned;
        if (this._view === 'pinned') {
            const tiles = this._grid.tiles();
            const loc = this._locate([{id: 'tiles', items: tiles, cols: this._grid.columns}], focus);
            if (!loc)
                return false;
            const to = reorderTarget(loc.index, tiles.length, this._grid.columns, key);
            if (to !== null) {
                const widget = tiles[loc.index];
                this._tooltips.hide();
                store.moveShown(loc.index, to);
                // The store notified the layout synchronously: the rows are rebuilt around the same widgets.
                this._syncPinnedIfNeeded();
                widget.grab_key_focus();
            }
            return true;
        }
        const fv = this._view === 'folder' ? this._folderView : null;
        if (fv?.uuid) {
            const tiles = fv.tiles();
            const cols = fv.columns;
            const loc = this._locate([{id: 'folder', items: tiles, cols}], focus);
            if (!loc)
                return false;
            const to = reorderTarget(loc.index, tiles.length, cols, key);
            if (to !== null) {
                this._tooltips.hide();
                store.moveInFolder(fv.uuid, loc.index, to);
                // FolderView rebuilt its tiles: the moved entry is a new actor at `to`.
                fv.tiles()[to]?.grab_key_focus();
            }
            return true;
        }
        return false;
    }

    // ---- launching ----

    private _launch(app: Shell.App, ctrl: boolean): void {
        try {
            launchApp(app, this._services.settings, ctrl);
        } catch (e) {
            error(`could not launch ${app.get_id()}`, e);
        }
        const keepOpen = ctrl && this._services.settings.get('keep-open-on-ctrl-click');
        if (!keepOpen)
            this._host.close();
    }

    // ---- search ----

    private _cancelSearch(): void {
        this._searchToken++;
        this._searchHandle?.cancel();
        this._searchHandle = null;
    }

    private _onSearchText(text: string): void {
        if (this._destroyed)
            return;
        const query = text.trim();
        this._cancelSearch();
        this._setActivateWhenReady(false);
        if (query.length === 0) {
            // Drop the old rows now: the next query must not flash them (dimmed) or let Down focus them.
            this._results?.reset();
            if (this._view === 'results')
                this._setView(this._defaultView());
            if (this._services.settings.get('search-hidden') && this._search.actor.visible) {
                this._search.actor.visible = false;
                this._focusMain();
            }
            return;
        }
        this._setView('results');
        const results = this._results as ResultList;
        this._resultsScroll?.vadjustment.set_value(0);
        // Keep the previous rows (dimmed) until the first batch of this query arrives: no blank
        // flash between keystrokes.
        results.beginQuery();
        results.setSelectionVisible(true);
        const token = this._searchToken;
        try {
            this._searchHandle = this._services.search.search(query, batch => {
                if (token !== this._searchToken || this._destroyed)
                    return;
                results.addBatch(batch);
                if (this._activateWhenReady && results.first()) {
                    this._setActivateWhenReady(false);
                    results.activateFirst();
                }
            });
        } catch (e) {
            error('search failed', e);
        }
    }

    /**
     * Return in the search entry: activate the first result of the CURRENT query. Typing and
     * pressing Return inside the debounce window must not do nothing: flush the pending query
     * (synchronous providers deliver before flush() returns); if slower providers still owe the
     * first row, activate it as soon as it arrives.
     */
    private _onSearchActivate(): void {
        if (this._view !== 'results' || this._search.text.trim().length === 0)
            return;
        const results = this._results;
        if (!results)
            return;
        try {
            this._searchHandle?.flush();
        } catch (e) {
            error('search flush failed', e);
        }
        if (!results.activateFirst())
            this._setActivateWhenReady(true);
    }

    /**
     * "Return was pressed before the first row arrived". Expires after ACTIVATE_WAIT_MS: a provider
     * answering long after "No results" showed must not launch something the user never saw.
     */
    private _setActivateWhenReady(on: boolean): void {
        this._cancelActivateWait?.();
        this._cancelActivateWait = null;
        this._activateWhenReady = on;
        if (on)
            this._cancelActivateWait = this._scope.timeout(ACTIVATE_WAIT_MS, () => {
                this._cancelActivateWait = null;
                this._activateWhenReady = false;
            });
    }

    private _onSearchKey(key: number, shift: boolean): boolean {
        switch (key) {
        case Clutter.KEY_Down:
            // Deliver the synchronous batches of the pending query first: the rows we focus must
            // belong to what the entry says now, not to the previous keystroke.
            try {
                this._searchHandle?.flush();
            } catch (e) {
                error('search flush failed', e);
            }
            this._focusMain();
            return true;
        case Clutter.KEY_Up:
            if (!this._searchTop)
                this._focusMain(true);
            return true;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._cyclePane(key === Clutter.KEY_ISO_Left_Tab || shift ? -1 : 1);
            return true;
        }
        return false;
    }

    // ---- navigation ----

    private _updateNav(): void {
        // An open folder popup leaves the nav of the view under it alone (no jump behind the scrim).
        if (this._view === 'folder')
            return;
        const dv = this._services.settings.get('default-menu-view');
        const back = this._canGoBack();
        this._backButton.visible = back;
        this._allAppsButton.visible = !back && isDefaultViewPinnedish(dv);
        this._nav.visible = this._backButton.visible || this._allAppsButton.visible;
        this._updateLinksVisible();
        // dragging out of a folder onto Back removes the app from the folder
        if (!this._backDropRegistered) {
            this._backDropRegistered = true;
            acceptDrops(this._scope, this._backButton, this._services.pinned, {kind: 'unfolder', folderUuid: ''});
        }
    }

    private _backDropRegistered = false;

    private _mainGroups(): Group[] {
        switch (this._view) {
        case 'pinned': {
            const groups: Group[] = [{id: 'tiles', items: this._grid.tiles(), cols: this._grid.columns}];
            if (this._frequentSection) {
                const rows = (this._frequentSection.get_children()[2]?.get_children() ?? []).filter(c => c instanceof St.Button);
                groups.push({id: 'frequent', items: rows, cols: 1});
            }
            return groups;
        }
        case 'frequent':
            return [{id: 'frequent', items: this._frequentBox?.get_children().filter(c => c instanceof St.Button) ?? [], cols: 1}];
        case 'categories':
        case 'all':
            return [{id: 'apps', items: this._categories?.appRows() ?? [], cols: 1}];
        case 'folder': {
            const fv = this._folderView;
            if (!fv)
                return [];
            return [
                {id: 'header', items: fv.headerButtons(), cols: 2},
                {id: 'folder', items: fv.tiles(), cols: fv.columns},
            ];
        }
        case 'favorites':
        case 'recent':
            return [{id: 'extra', items: this._extraList?.rows() ?? [], cols: 1}];
        case 'results':
            // Rows of a superseded query (stale, dimmed) are never keyboard targets.
            return [{id: 'results', items: this._results?.hasResults ? this._results.rows() : [], cols: 1}];
        }
    }

    private _categoryGroup(): Group | null {
        if (this._view !== 'categories' || !this._categories)
            return null;
        return {id: 'categories', items: this._categories.categoryButtons(), cols: 1};
    }

    private _linksGroup(): Group | null {
        const links = this._links;
        return links?.actor.visible && links.buttons().length ? {id: 'links', items: links.buttons(), cols: 1} : null;
    }

    private _navGroup(): Group | null {
        const items = [this._backButton, this._allAppsButton].filter(b => b.visible && this._nav.visible);
        return items.length ? {id: 'nav', items, cols: items.length} : null;
    }

    private _undoGroup(): Group | null {
        return this._undoBanner.visible ? {id: 'undo', items: [this._undoBanner.button], cols: 1} : null;
    }

    private _rightGroups(): Group[] {
        const items: Clutter.Actor[] = [];
        if (this._userCard?.actor.visible)
            items.push(this._userCard.actor);
        for (const r of this._shortcutRows) {
            if (!r.isSeparator)
                items.push(r.actor);
        }
        const groups: Group[] = [{id: 'shortcuts', items, cols: 1}];
        const power = this._powerBar?.buttons() ?? [];
        if (power.length)
            groups.push({id: 'power', items: power, cols: power.length});
        return groups;
    }

    private _searchGroup(): Group | null {
        return this._search.actor.visible ? {id: 'search', items: [this._search.actor.clutter_text], cols: 1} : null;
    }

    /** Left column groups in vertical order. */
    private _leftColumn(): Group[] {
        // An open folder popup keeps the keyboard inside it (header, then its apps).
        if (this._view === 'folder')
            return this._mainGroups().filter(g => g.items.length > 0);
        const out: Group[] = [];
        const search = this._searchGroup();
        const top = this._searchTop;
        if (search && top)
            out.push(search);
        const links = this._linksGroup();
        const linksTop = this._links?.location === 'Top';
        if (links && linksTop)
            out.push(links);
        out.push(...this._mainGroups().filter(g => g.items.length > 0));
        if (links && !linksTop)
            out.push(links);
        const undo = this._undoGroup();
        if (undo)
            out.push(undo);
        const nav = this._navGroup();
        if (nav)
            out.push(nav);
        if (search && !top)
            out.push(search);
        return out;
    }

    private _locate(groups: Group[], focus: Clutter.Actor | null): {group: Group; index: number} | null {
        if (!focus)
            return null;
        for (const g of groups) {
            for (let i = 0; i < g.items.length; i++) {
                const it = g.items[i];
                if (it === focus || it.contains(focus))
                    return {group: g, index: i};
            }
        }
        return null;
    }

    private _focusItem(group: Group | undefined, which: 'first' | 'last' | number = 'first'): boolean {
        if (!group || group.items.length === 0)
            return false;
        const i = which === 'first' ? 0 : which === 'last' ? group.items.length - 1 : Math.min(which, group.items.length - 1);
        group.items[i].grab_key_focus();
        return true;
    }

    private _focusMain(last = false): void {
        const cats = this._categoryGroup();
        if (cats && !last && cats.items.length > 0) {
            // All apps with a category column: start on the selected category.
            this._focusItem(cats, Math.max(0, cats.items.findIndex(c => (c as St.Widget).has_style_pseudo_class('checked'))));
            return;
        }
        const groups = this._mainGroups().filter(g => g.items.length > 0);
        // In a folder popup the apps come first, the header (rename / close) second.
        if (this._view === 'folder' && !last && groups.length > 1) {
            this._focusItem(groups[1], 'first');
            return;
        }
        if (groups.length === 0) {
            // Results still pending (or none): stay where the focus is instead of jumping to Back.
            if (this._view !== 'results')
                this._focusItem(this._navGroup() ?? undefined);
            return;
        }
        this._focusItem(last ? groups[groups.length - 1] : groups[0], last ? 'last' : 'first');
    }

    private _move(dir: Dir): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        // A removable place has a second stop at the right end of its row: Right reaches the eject button, Left returns.
        const place = this._shortcutRows.find((r): r is PlaceRow => r instanceof PlaceRow && r.ejectButton !== null && (r.actor === focus || r.ejectButton === focus));
        if (place?.ejectButton) {
            if (dir === 'right' && focus === place.actor) {
                place.ejectButton.grab_key_focus();
                return true;
            }
            if (dir === 'left' && focus === place.ejectButton) {
                place.actor.grab_key_focus();
                return true;
            }
        }
        const leftCol = this._leftColumn();
        const inFolder = this._view === 'folder';
        const rightCol = inFolder ? [] : this._rightGroups().filter(g => g.items.length > 0);
        const cats = inFolder ? null : this._categoryGroup();

        let col: Group[] = leftCol;
        let loc = this._locate(leftCol, focus);
        let onRight = false;
        if (!loc) {
            loc = this._locate(rightCol, focus);
            col = rightCol;
            onRight = true;
        }
        let inCats = false;
        if (!loc && cats) {
            loc = this._locate([cats], focus);
            col = leftCol;
            inCats = true;
        }
        if (!loc) {
            this._focusMain();
            return true;
        }
        const {group, index} = loc;
        const n = group.items.length;
        const cols = group.cols;
        const groupIdx = col.indexOf(group);

        const vertical = (delta: number): boolean => {
            const row = Math.floor(index / cols);
            const target = index + delta * cols;
            if (cols > 1 && Math.floor(target / cols) >= 0 && target >= 0 && target < n && (cols > 1 && group.id !== 'nav' && group.id !== 'power' && group.id !== 'header'))
                return this._focusItem(group, target);
            if (cols > 1 && delta > 0 && group.id !== 'nav' && group.id !== 'power' && group.id !== 'header') {
                const lastRow = Math.floor((n - 1) / cols);
                if (row < lastRow)
                    return this._focusItem(group, n - 1);
            }
            if (cols === 1 && index + delta >= 0 && index + delta < n)
                return this._focusItem(group, index + delta);
            if (inCats) {
                // The category column is not one of the left column's groups: leave it explicitly.
                const search = this._searchGroup();
                if (delta > 0)
                    return this._focusItem(this._navGroup() ?? (!this._searchTop && search ? search : undefined), 'first') || true;
                return (this._searchTop && search ? this._focusItem(search, 'first') : false) || true;
            }
            const next = col[groupIdx + delta];
            if (next)
                return this._focusItem(next, delta > 0 ? Math.min(index % Math.max(cols, 1), next.items.length - 1) : 'last');
            return true;
        };

        const horizontal = (delta: number): boolean => {
            if (inCats) {
                if (delta > 0)
                    return this._focusItem(leftCol.find(g => g.id === 'apps'), 'first');
                return true;
            }
            const rowStart = cols > 1 ? Math.floor(index / cols) * cols : 0;
            const rowEnd = cols > 1 ? Math.min(n - 1, rowStart + cols - 1) : 0;
            if (cols > 1) {
                const t = index + delta;
                if (t >= rowStart && t <= rowEnd)
                    return this._focusItem(group, t);
            }
            // leaving the group sideways
            if (onRight) {
                if (delta < 0) {
                    const target = group.id === 'power' ? (this._navGroup() ?? leftCol.filter(g => g.id !== 'search').pop()) : leftCol.find(g => g.id !== 'search' && g.id !== 'links');
                    return this._focusItem(target, 'first');
                }
                return true;
            }
            if (inFolder)
                return true;
            if (delta > 0) {
                // By rank among the non-search groups: the search entry on top must not shift the mapping.
                const rank = leftCol.filter(g => g.id !== 'search' && g.id !== 'undo' && g.id !== 'links').indexOf(group);
                return this._focusItem(rightCol[Math.min(Math.max(rank, 0), rightCol.length - 1)] ?? rightCol[0], 'first');
            }
            if (cats && group.id === 'apps')
                return this._focusItem(cats, Math.max(0, cats.items.findIndex(c => (c as St.Widget).has_style_pseudo_class('checked'))));
            return true;
        };

        switch (dir) {
        case 'up': return vertical(-1);
        case 'down': return vertical(1);
        case 'left': return horizontal(-1);
        case 'right': return horizontal(1);
        }
    }

    private _cyclePane(delta: number): void {
        if (this._view === 'folder') {
            // Tab stays inside the folder popup: header <-> apps.
            const groups = this._mainGroups().filter(g => g.items.length > 0);
            const loc = this._locate(groups, global.stage.key_focus as Clutter.Actor | null);
            const current = loc ? groups.indexOf(loc.group) : -1;
            const n = groups.length;
            if (n > 0)
                this._focusItem(groups[((current + delta) % n + n) % n], 'first');
            return;
        }
        const panes: Array<() => boolean> = [];
        const search = this._searchGroup();
        const cats = this._categoryGroup();
        const main = this._mainGroups().filter(g => g.items.length > 0);
        const nav = this._navGroup();
        const right = this._rightGroups().filter(g => g.items.length > 0);
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const top = this._searchTop;

        const add = (g: Group | null | undefined, which: 'first' | 'last' = 'first') => {
            if (g && g.items.length)
                panes.push(() => this._focusItem(g, which));
        };
        const links = this._linksGroup();
        const linksTop = this._links?.location === 'Top';
        if (search && top)
            add(search);
        if (linksTop)
            add(links);
        add(cats, 'first');
        for (const g of main)
            add(g);
        if (!linksTop)
            add(links);
        const undo = this._undoGroup();
        add(undo);
        add(nav);
        if (search && !top)
            add(search);
        for (const g of right)
            add(g);

        // Which pane holds the focus?
        const all: Array<Group | null> = [search && top ? search : null, linksTop ? links : null, cats, ...main, linksTop ? null : links, undo, nav, search && !top ? search : null, ...right];
        const groups = all.filter((g): g is Group => Boolean(g && g.items.length));
        const loc = this._locate(groups, focus);
        const current = loc ? groups.indexOf(loc.group) : -1;
        const next = ((current + delta) % panes.length + panes.length) % panes.length;
        panes[next]?.();
    }

    private _onKeyPress(event: Clutter.Event): boolean {
        if (this._destroyed)
            return Clutter.EVENT_PROPAGATE;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (this._folderView?.renaming && focus && this._folderView.actor.contains(focus) && !(focus instanceof St.Button))
            return Clutter.EVENT_PROPAGATE;

        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = Boolean(state & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK));

        // Ctrl+arrows / Home / End on a pinned entry or a folder's app reorder it; Ctrl+Z undoes a folder delete.
        if ((state & Clutter.ModifierType.CONTROL_MASK) && !(state & (Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.MOD1_MASK))) {
            const reorder = REORDER_KEYS.get(sym);
            if (reorder && this._reorderFocused(reorder))
                return Clutter.EVENT_STOP;
            if ((sym === Clutter.KEY_z || sym === Clutter.KEY_Z) && this._undo) {
                this._undoDelete();
                return Clutter.EVENT_STOP;
            }
        }

        switch (sym) {
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._cyclePane(sym === Clutter.KEY_ISO_Left_Tab || (state & Clutter.ModifierType.SHIFT_MASK) ? -1 : 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            return this._move('up') ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Down:
            return this._move('down') ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Left:
            return this._move('left') ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Right:
            return this._move('right') ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_BackSpace:
            if (this._search.actor.visible && this._search.text.length > 0 && !this._search.hasFocus) {
                this._search.deleteBackward();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

        if (ctrl)
            return Clutter.EVENT_PROPAGATE;
        const unicode = Clutter.keysym_to_unicode(sym);
        if (unicode >= 32 && unicode !== 127 && !this._search.hasFocus) {
            // `search-hidden`: the entry stays out of sight until the user types, then appears.
            this._search.actor.visible = true;
            this._search.insert(String.fromCodePoint(unicode));
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    private _onFocusChanged(): void {
        if (!this._isOpen || this._destroyed)
            return;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus) {
            // The focused actor went away (view switched, tile removed): keep the keyboard alive.
            const lost = this._lastTile;
            this._scope.idle(() => {
                if (this._isOpen && !this._destroyed && !global.stage.key_focus && !this._context.isOpen) {
                    // An open folder popup keeps the keyboard (its tiles are rebuilt on every store change).
                    if (this._view === 'folder') {
                        this._focusMain();
                        return;
                    }
                    // A pinned tile was destroyed (Unpin, Delete Folder): focus its neighbour at the same index.
                    // Compare identities only: touching the destroyed tile itself logs a critical.
                    const current = this._view === 'pinned' ? this._grid.tiles() : [];
                    const tiles = lost && !current.includes(lost.widget as St.Widget) ? current : [];
                    const next = tiles[Math.min(lost?.index ?? 0, tiles.length - 1)];
                    if (next) {
                        next.grab_key_focus();
                        return;
                    }
                    if (this._search.actor.visible)
                        this._search.focus();
                    else
                        this._focusMain();
                }
            });
            return;
        }
        if (!this.actor.contains(focus))
            return;
        if (this._view === 'pinned') {
            const index = this._grid.tiles().indexOf(focus as St.Widget);
            if (index >= 0)
                this._lastTile = {widget: focus, index};
        }
        // Keep the focused item visible inside its scroll view.
        let a: Clutter.Actor | null = focus;
        while (a && a !== this.actor) {
            if (a instanceof St.ScrollView) {
                scrollIntoView(a, focus);
                break;
            }
            a = a.get_parent();
        }
        // The first search result shows as selected only while the entry has focus.
        if (this._results)
            this._results.setSelectionVisible(!this._results.actor.contains(focus));
    }
}

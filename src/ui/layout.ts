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
//   layout.prepare(anchor, side): void  closed menu (popup prebuild): build the start view for that anchor now
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
// (UndoBanner; Ctrl+Z too); it ends when the menu closes or the pinned list changes otherwise. "Hide from Menu"
// (context menu) adds the app to `hidden-apps` and shows the same banner, "\u201cX\u201d hidden [Undo]".
//
// "New" badge: apps the NewAppsStore calls new get a pill in rows and tiles and their category a dot; the layout
// only asks (TileHost.isNew), tells the store about the launches it starts and redraws what is cached when the
// store changes.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ShortcutId} from '../core/constants.js';
import {openSpawnPrefs} from '../core/openPrefs.js';
import {debounce} from '../core/debounce.js';
import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {Entry} from '../core/settings.js';
import type {PinnedItem} from '../model/pinned.js';
import type {FakePlace} from '../model/places.js';
import {nearestIndex, pageTarget, searchStep, type Pos} from '../model/listNav.js';
import {reorderTarget, type ReorderKey} from '../model/reorder.js';
import type {SearchResult} from '../search/engine.js';
import {AppContextMenu} from './contextMenu.js';
import {LeftPane} from './layout/leftPane.js';
import {RightPane} from './layout/rightPane.js';
import {UndoController} from './layout/undo.js';
import {LayoutState, type Dir, type Group, type LayoutHost, type TileEntry, type ViewId} from './layout/types.js';
import {PaneMetrics} from './layout/metrics.js';
import {ScrollFactory} from './layout/scrolls.js';
import {SearchSession} from './searchSession.js';
import {acceptDrops, enableDrag, rejectDrops} from './dnd.js';
import {bindReducedMotion, markList, nameItem} from './widgets/a11y.js';
import {ActionRow, AppRow} from './widgets/appRow.js';
import {ActionTile, AppTile, type TileHost} from './widgets/appTile.js';
import {CategoryList} from './widgets/categoryList.js';
import {ExtraList} from './widgets/extraList.js';
import {FolderRow, FolderTile, type FolderHost} from './widgets/folderTile.js';
import {FolderView} from './widgets/folderView.js';
import {PointerHighlight} from './widgets/highlight.js';
import {makeFace, makeItemButton, wireItem} from './widgets/interact.js';
import {sizeMetrics} from './widgets/pinnedSize.js';
import {ResultList, type ResultHost} from './widgets/resultList.js';
import {SearchBox} from './widgets/searchBox.js';
import {resolveShortcut, type ShortcutHost} from './widgets/shortcutRow.js';
import {TileGrid} from './widgets/tileGrid.js';
import {TooltipManager} from './widgets/tooltip.js';
import {applyScrollSettings, displayName, iconSizeFor, isPointerEvent, launchApp, lookupApp, ownedScope, scrollIntoView, showDescriptions} from './util.js';

export type {LayoutHost, ViewId} from './layout/types.js';
export {MIN_LEFT_WIDTH, MIN_RIGHT_WIDTH} from './layout/metrics.js';

/** Sizes and arrangement: re-derive the metrics and rebuild the pinned view. Disjoint from the other key sets (one handler per key). */
const RELAYOUT_KEYS = [
    'menu-height', 'menu-width-adjustment', 'left-panel-width', 'right-panel-width',
    'icon-size-grid', 'default-menu-view', 'vert-separator', 'search-entry-location', 'search-hidden',
    'multi-lined-labels', 'pinned-apps-display', 'pinned-item-size',
] as const;

/** Read once when a view is built: a change rebuilds the lists. */
const VIEW_KEYS = [
    'icon-size-apps', 'apps-show-extra-details', 'show-search-result-details', 'apps-show-generic-names', 'max-frequent-apps',
    'icon-size-categories', 'icon-style-categories', 'show-new-apps-badge',
] as const;

/** Scroll bar behaviour: only re-applied to the existing scroll views, nothing is rebuilt. */
const SCROLL_KEYS = ['scrollview-fade-effect', 'scrollbars-visible', 'scrollbars-overlay'] as const;

/** installed-changed bursts (a package transaction) are coalesced into one refresh. */
const INSTALLED_COALESCE_MS = 300;
/** How long a Return that found no result yet keeps waiting for the first batch. */
const ACTIVATE_WAIT_MS = 1000;

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

/** Centre of an actor on the stage. */
function centreOf(actor: Clutter.Actor): Pos {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return {x: x + w / 2, y: y + h / 2};
}

/** Is `actor` (at least half of it) inside the visible part of the scroll view it is in, if any? */
function inView(actor: Clutter.Actor): boolean {
    if (!actor.mapped)
        return false;
    let scroll = actor.get_parent();
    while (scroll && !(scroll instanceof St.ScrollView))
        scroll = scroll.get_parent();
    if (!scroll)
        return true;
    const c = centreOf(actor).y;
    const [, top] = scroll.get_transformed_position();
    const [, height] = scroll.get_transformed_size();
    return c >= top && c <= top + height;
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
    private readonly _undo: UndoController;
    private readonly _leftPane: LeftPane;
    private readonly _search: SearchBox;
    private readonly _tooltips: TooltipManager;
    private readonly _context: AppContextMenu;
    private readonly _highlight: PointerHighlight;

    // right pane (rebuilt as a unit)
    private readonly _rightPane: RightPane;

    // lazily built views
    private _pinnedScroll: St.ScrollView | null = null;
    private _pinnedBox: St.BoxLayout | null = null;
    private _pinnedTitle: St.Label | null = null;
    private _pinnedEmpty: St.BoxLayout | null = null;
    private _pinnedEmptyButton: St.Button | null = null;
    private readonly _grid = new TileGrid();
    private _frequentBox: St.BoxLayout | null = null;
    private _frequentScroll: St.ScrollView | null = null;
    private _categories: CategoryList | null = null;
    private _folderView: FolderView | null = null;
    private _extraList: ExtraList | null = null;
    private _extraScroll: St.ScrollView | null = null;
    private _resultsScroll: St.ScrollView | null = null;
    private _results: ResultList | null = null;
    private readonly _tileEntries = new Map<string, TileEntry>();
    private _pinnedDirty = true;
    private _pinnedSubscribed = false;

    // state
    private readonly _state = new LayoutState();
    /** Last keyboard-focused pinned tile and its index, to refocus a neighbour when it is destroyed. */
    private _lastTile: {widget: Clutter.Actor; index: number} | null = null;
    private readonly _session: SearchSession;
    /** Icon size / label mode / naming the cached tiles were built with; a change rebuilds them. */
    private _tileSignature = '';
    private readonly _metrics: PaneMetrics;
    private readonly _scrollFactory: ScrollFactory;

    readonly tooltips: TooltipManager;
    private readonly _tileHost: TileHost;
    private readonly _folderHost: FolderHost;
    private readonly _resultHost: ResultHost;

    constructor(scope: Scope, services: Services, host: LayoutHost) {
        this._scope = scope;
        this._services = services;
        this._host = host;
        const settings = services.settings;
        this._session = new SearchSession(scope, services.search, {activateWaitMs: ACTIVATE_WAIT_MS, isDead: () => this._state.destroyed});

        this._tooltips = new TooltipManager(scope, settings);
        this.tooltips = this._tooltips;
        this._tileHost = {
            launch: (app, ctrl) => this._launch(app, ctrl),
            openContext: (tile, app, folderUuid) => this._context.open(tile, {
                kind: 'app',
                app,
                folderUuid: folderUuid ?? (this._state.view === 'folder' ? this._folderView?.uuid ?? undefined : undefined),
            }),
            isNew: app => this._services.newApps.showBadge(app.get_id() ?? ''),
            tooltips: this._tooltips,
        };
        this._folderHost = {
            open: (uuid, pointer) => this._showFolder(uuid, pointer),
            openContext: (tile, uuid) => this._context.open(tile, {kind: 'folder', uuid}),
            tooltips: this._tooltips,
        };
        this._resultHost = {
            close: () => this.close(),
            showAllApps: () => this.showAllApps(),
            tooltips: this._tooltips,
            isNewApp: id => this._services.newApps.showBadge(id),
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
            deleteFolder: uuid => this._undo.deleteFolder(uuid),
            hideApp: app => this._undo.hideApp(app),
            pin: (id, name) => this._undo.changePinned(_('Pinned \u201c%s\u201d').format(name), () => this._services.pinned.pin(id)),
            unpin: (id, name) => this._undo.changePinned(_('Unpinned \u201c%s\u201d').format(name), () => this._services.pinned.unpin(id), id),
            removeFromFolder: (uuid, id, name) => this._undo.changePinned(_('Removed \u201c%s\u201d from folder').format(name),
                () => this._services.pinned.removeFromFolder(uuid, id), id),
            removeShortcut: (entry, name) => this._undo.removeShortcut(entry, name),
            openSettings: shortcuts => {
                host.close();
                this._scope.idle(() => openSpawnPrefs(this._services.settings, this._services.info.uuid, shortcuts ? 'pinned' : undefined));
            },
            renameFolder: uuid => {
                this._scope.idle(() => this._renameFolder(uuid));
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
        bindReducedMotion(scope, this.actor);
        // One highlight: the pointed-at item is it (the folder popup has its own rule, widgets/folderView.ts).
        this._highlight = new PointerHighlight(scope, this.actor, {
            ignore: item => Boolean(this._folderView?.actor.contains(item)),
            onHover: item => this._onItemHover(item),
        });

        // Registered FIRST so it runs LAST (LIFO): every widget scope is torn down while its
        // actors are still alive, then the root actor takes the remaining children with it.
        scope.add(() => {
            this._state.destroyed = true;
            this._session.cancel();
            this.actor.destroy();
        }, 'SpawnLayout actor');

        this._left = new St.BoxLayout({style_class: 'spawn-left-pane', orientation: Clutter.Orientation.VERTICAL, y_expand: true});
        this._vsep = new St.Widget({style_class: 'spawn-vseparator', y_expand: true});
        this._right = new St.BoxLayout({style_class: 'spawn-right-pane', orientation: Clutter.Orientation.VERTICAL, y_expand: true});
        this._panes.add_child(this._left);
        this._panes.add_child(this._vsep);
        this._panes.add_child(this._right);
        this._metrics = new PaneMetrics({
            settings, root: this.actor, panes: this._panes, left: this._left, right: this._right, vsep: this._vsep,
            anchor: () => this._state.anchor,
        });
        this._scrollFactory = new ScrollFactory(settings);

        this._search = new SearchBox(scope, settings);
        this._undo = new UndoController(scope, services, this._state, {
            focusMain: () => this._focusMain(),
            syncPinned: () => this._syncPinnedIfNeeded(),
            pinnedTile: key => this._tileEntries.get(key)?.widget ?? null,
        });
        this._leftPane = new LeftPane(scope, services, this._state, {
            left: this._left,
            search: this._search.actor,
            banner: this._undo.banner.actor,
            tooltips: this._tooltips,
            metrics: this._metrics,
            host: {
                canGoBack: () => this._canGoBack(),
                setView: view => this._setView(view),
                focusMain: () => this._focusMain(),
                back: () => this._back(),
                openAllApps: () => this._openAllApps(),
                arranged: top => this._results?.setReversed(!top),
            },
        });

        this._rightPane = new RightPane(scope, services, this._state, {
            pane: this._right,
            host: {close: () => this.close(), showAllApps: () => this.showAllApps(), tooltips: this._tooltips},
            tooltips: this._tooltips,
            context: this._context,
            scrolls: this._scrollFactory,
        });
        this._leftPane.arrange();
        this._rightPane.build();
        this._metrics.apply();

        // search wiring
        this._search.onTextChanged(scope, text => this._onSearchText(text));
        // An app installed or removed while results are showing: search again, so a new app shows up
        // and a removed one cannot be launched from a stale row.
        services.appIndex.onChanged(scope, () => {
            if (this._state.isOpen && this._state.view === 'results' && this._search.text.trim().length > 0)
                this._onSearchText(this._search.text);
            this._refreshGeneratedLists();
        });
        // A new app was launched or aged out: pinned entries are cached per badge state. Deferred, because the
        // launch comes from a click on one of those entries.
        services.newApps.onChanged(scope, () => {
            scope.idle(() => {
                if (this._state.destroyed)
                    return;
                this._pinnedDirty = true;
                if (this._pinnedShowing())
                    this._syncPinnedIfNeeded();
            });
        });
        this._search.onActivate(scope, () => this._onSearchActivate());
        this._search.onNavigate(scope, (key, shift, ctrl) => this._onSearchKey(key, shift, ctrl));

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
        settings.onChanged(scope, [...RIGHT_KEYS], () => this._rightPane.build());
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
        if (this._state.destroyed)
            return;
        this._state.isOpen = true;
        this._state.anchor = anchor;
        this._state.side = side;
        try {
            this._services.warmUp();
        } catch (e) {
            error('layout warm-up failed', e);
        }
        try {
            this._highlight.reset();
            this._folderView?.commitRename();
            this._undo.dismiss();
            this._context.close();
            this._search.setSilently('');
            this._session.cancel();
            // The popup may open on another monitor / work area than last time: new columns or tile
            // widths make the cached pinned tiles stale.
            if (this._metrics.apply())
                this._pinnedDirty = true;
            if (this._leftPane.searchOnTop() !== this._state.searchTop)
                this._leftPane.arrange();
            this._setView(this._defaultView());
            for (const s of [this._pinnedScroll, this._frequentScroll, this._extraScroll, this._resultsScroll, this._rightPane.scroll])
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

    /**
     * Popup prebuild (closed menu, idle after startup): build the start view for `anchor`'s work area, so
     * the first open only has to show it. Changes nothing the user can see; onOpen() still runs on open.
     */
    prepare(anchor: St.Widget | null, side: St.Side): void {
        if (this._state.destroyed || this._state.isOpen)
            return;
        try {
            this._state.anchor = anchor;
            this._state.side = side;
            if (this._metrics.apply())
                this._pinnedDirty = true;
            if (this._leftPane.searchOnTop() !== this._state.searchTop)
                this._leftPane.arrange();
            this._setView(this._defaultView());
        } catch (e) {
            error('layout prepare failed', e);
        }
    }

    onClosed(): void {
        this._state.isOpen = false;
        try {
            // Gone at once: it must not fade out over the next open of the menu.
            if (this._state.view === 'folder')
                this._folderView?.hide(false);
            this._undo.dismiss();
            this._context.close();
            this._tooltips.hide();
            this._session.cancel();
            this._session.arm(false);
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
        if (this._state.isOpen && this._search.actor.visible)
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

    /** Dev hook (Ui.SetPlaces): show fake devices / network locations / bookmarks, null = the real ones. */
    setFakePlaces(specs: FakePlace[] | null): void {
        this._rightPane.setFakePlaces(specs);
    }

    debugState(): Record<string, unknown> {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        // Reading sizes of a layout that is not parented to the stage yet (prebuilt, never opened)
        // asks for a preferred size -> theme node of an unstaged widget -> St critical.
        const staged = this.actor.get_stage() !== null;
        const focusName = focus ? `${focus.constructor.name}.${(focus as St.Widget).style_class ?? ''}` : null;
        return {
            view: this._state.view,
            default: this._defaultView(),
            open: this._state.isOpen,
            search: this._search.text,
            focus: focusName,
            focusInLayout: Boolean(focus && this.actor.contains(focus)),
            focusIndex: this._locate(this._mainGroups(), focus)?.index ?? null,
            tiles: this._grid.tiles().length,
            display: this._metrics.listMode() ? 'List' : 'Grid',
            folder: this._state.view === 'folder' ? this._folderView?.uuid ?? null : null,
            folderTiles: this._state.view === 'folder' ? this._folderView?.tiles().length ?? 0 : 0,
            folderColumns: this._state.view === 'folder' ? this._folderView?.columns ?? 0 : 0,
            results: this._results?.rows().length ?? 0,
            links: this._leftPane.links?.actor.visible ? this._leftPane.links.buttons().length : 0,
            extraRows: this._extraList?.rows().length ?? 0,
            places: [this._rightPane.places.devices().length, this._rightPane.places.network().length, this._rightPane.places.bookmarks().length],
            tooltip: this._tooltips.debugText(),
            columns: this._metrics.cols,
            size: staged ? [this.actor.width, this.actor.height] : [0, 0],
            searchTop: this._state.searchTop,
            side: this._state.side,
            tileWidth: this._metrics.tileWidth,
            leftWidth: staged ? this._left.width : 0,
            rightWidth: staged ? this._right.width : 0,
            renaming: this._folderView?.renaming ?? false,
            pinnedScroll: this._pinnedScroll?.vadjustment.value ?? 0,
            ghosts: [...this._tileEntries.keys()].filter(k => k.startsWith('m:')).length,
            // accessible names of the app rows of the visible category list ("Firefox", "Firefox, new")
            appRows: (this._categories?.appRows() ?? []).map(r => r.accessible_name ?? ''),
            // rows of that list not built yet (All Apps builds them as they scroll into view)
            appRowsPending: this._categories?.pendingRows ?? 0,
            undo: this._undo.banner.visible,
            // the search highlight (Return target) and what the screen reader was told last
            selected: this._results?.selected()?.accessible_name ?? null,
            selectedIndex: this._results?.rows().indexOf(this._results.selected() as St.Widget) ?? -1,
            announcement: this._results?.announcement ?? '',
            // one-highlight rule: the item the pointer highlights, and every item showing a hover tint
            hovered: this._highlight.hovered?.accessible_name ?? null,
            hoverTints: this._hoverTints(),
        };
    }

    /** Accessible names of the items showing a hover tint (dev hook: at most one may). */
    private _hoverTints(): string[] {
        const {left, right, cats} = this._paneGroups();
        return [...left, ...right, ...(cats ? [cats] : [])].flatMap(g => g.items)
            .filter(a => a instanceof St.Widget && a.hover).map(a => (a as St.Widget).accessible_name ?? '');
    }

    // ---- sizes ----

    /** Is the pinned grid on screen (its own view, or under an open folder popup)? */
    private _pinnedShowing(): boolean {
        if (!this._state.isOpen)
            return false;
        return this._state.view === 'pinned' || (this._state.view === 'folder' && Boolean(this._pinnedScroll?.visible));
    }

    private _relayout(): void {
        if (this._state.destroyed)
            return;
        this._metrics.apply();
        this._leftPane.arrange();
        this._pinnedDirty = true;
        if (this._state.isOpen)
            this._setView(this._state.view);
        // List <-> grid (or a new column count) changes the folder contents too.
        if (this._state.view === 'folder')
            this._folderView?.refresh();
    }

    /** Settings that are read once when a view is built: re-apply scrolling, rebuild the lists. */
    private _onViewSettings(): void {
        if (this._state.destroyed)
            return;
        this._categories?.refresh();
        this._leftPane.syncLinks();
        this._pinnedDirty = true;
        if (this._state.isOpen)
            this._setView(this._state.view);
        if (this._state.view === 'folder')
            this._folderView?.refresh();
    }

    /** Scroll bar settings: re-apply to every existing scroll view; no rebuild. */
    private _onScrollSettings(): void {
        if (this._state.destroyed)
            return;
        const s = this._services.settings;
        const scrolls = [
            ...this._scrollFactory.tracked(), this._rightPane.scroll,
            this._categories?.appScroll(), this._categories?.columnScroll(), this._folderView?.scroll,
        ];
        for (const scroll of scrolls) {
            if (scroll)
                applyScrollSettings(scroll, s);
        }
    }

    /** The catalogue changed (an app was installed, removed or hidden): Frequent lists that are on screen follow. */
    private _refreshGeneratedLists(): void {
        if (this._state.destroyed || !this._state.isOpen)
            return;
        if (this._state.view === 'frequent' && this._frequentBox)
            this._fillFrequent(this._frequentBox);
        else if (this._state.view === 'pinned')
            this._refreshPinnedFrequent();
    }

    private _onInstalledChanged(): void {
        if (this._state.destroyed)
            return;
        // An app may have appeared (a ghost tile becomes real) or vanished (a tile becomes a ghost).
        if (this._pinnedSubscribed)
            this._services.pinned.invalidate();
        this._pinnedDirty = true;
        if (this._pinnedShowing())
            this._syncPinnedIfNeeded();
        if (this._state.isOpen && this._state.view === 'folder')
            this._folderView?.refresh();
    }

    /** The links settings changed: rebuild the box (a new location re-parents it). */
    private _relink(): void {
        if (this._state.destroyed)
            return;
        this._leftPane.arrange();
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
        return this._state.view !== this._defaultView() || this._search.text.length > 0;
    }

    private _back(): void {
        if (this._search.text.length > 0) {
            this._search.clear();
            return;
        }
        const pointer = isPointerEvent();
        const folder = this._state.view === 'folder' ? this._folderView?.uuid ?? null : null;
        // Closing a folder popup returns to the view it was opened over (e.g. Pinned reached by a quick link).
        this._setView(this._state.view === 'folder' ? this._state.underFolder : this._defaultView());
        // Closing a folder popup with the keyboard (Escape, Return on Close): the keyboard goes back to the
        // folder it came from. Closed with the pointer (close button, a click outside the card): the usual
        // focus (search), so the folder is not left with a focus ring nobody asked for.
        const folderTile = folder && this._state.view === 'pinned' ? this._tileEntries.get(`f:${folder}`)?.widget : null;
        if (this._state.isOpen && folderTile?.mapped && !pointer) {
            folderTile.grab_key_focus();
            return;
        }
        if (this._state.isOpen) {
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
        if (this._state.destroyed)
            return;
        this._tooltips.hide();
        if (view === 'folder') {
            // The folder is a popup over the current view: that view stays as it is underneath.
            this._ensureFolderView();
            if (this._state.view !== 'folder')
                this._state.underFolder = this._state.view;
            this._state.view = view;
            // A relayout while the popup is open (display / size settings): the pinned grid under it follows.
            if (this._pinnedShowing())
                this._syncPinnedIfNeeded();
            this._leftPane.updateNav();
            this._results?.setSelectionVisible(true);
            return;
        }
        if (this._state.view === 'folder')
            this._folderView?.hide(this._state.isOpen);
        const actors = this._ensureView(view);
        this._state.view = view;
        for (const child of this._leftPane.stack.get_children())
            child.visible = actors.includes(child);
        this._leftPane.updateNav();
        if (view === 'pinned')
            this._results?.setSelectionVisible(true);
    }

    /** Build (if needed) and refresh the actors a view consists of; returns the actors to show. */
    private _ensureView(view: ViewId): Clutter.Actor[] {
        const add = (a: Clutter.Actor) => {
            if (a.get_parent() !== this._leftPane.stack)
                this._leftPane.stack.add_child(a);
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
                this._frequentScroll = this._scrollFactory.make(this._frequentBox, 'spawn-frequent');
            }
            this._fillFrequent(this._frequentBox as St.BoxLayout);
            return [add(this._frequentScroll)];
        }
        case 'categories':
        case 'all': {
            // On the stage before the rows are built: the first one measures how many fill the view.
            const list = this._ensureCategories();
            add(list.actor);
            list.setColumnVisible(view === 'categories');
            list.showCategory('all');
            list.ensureBuilt();
            return [list.actor];
        }
        case 'folder':
            // Never a stack child: _setView shows the popup on top of the panes instead.
            return [];
        case 'favorites':
        case 'recent': {
            if (!this._extraList || !this._extraScroll) {
                this._extraList = new ExtraList(this._services, {
                    ...this._tileHostWithTips(),
                    close: () => this.close(),
                    // recent files that arrived late: the focus moves to them as the view would have done
                    rowsChanged: () => {
                        const focus = global.stage.key_focus as Clutter.Actor | null;
                        if (this._state.isOpen && this._state.view === 'recent' && (!focus || this._leftPane.navGroup()?.items.includes(focus)))
                            this._focusMain();
                    },
                });
                this._extraScroll = this._scrollFactory.make(this._extraList.actor, 'spawn-frequent');
            }
            this._extraList.show(view);
            return [add(this._extraScroll)];
        }
        case 'results': {
            if (!this._resultsScroll) {
                const results = new ResultList(this._scope, this._services.settings, this._resultHost);
                results.setReversed(!this._state.searchTop);
                const scroll = this._scrollFactory.make(results.actor, 'spawn-results');
                // New rows (a batch, the reversed list growing upwards): keep the highlighted one in view.
                scroll.vadjustment.connect('notify::upper', () => {
                    const row = this._state.view === 'results' ? results.selected() : null;
                    if (row)
                        scrollIntoView(scroll, row);
                });
                this._results = results;
                this._resultsScroll = scroll;
            }
            return [add(this._resultsScroll)];
        }
        }
    }

    private _ensurePinned(): St.ScrollView {
        if (!this._pinnedScroll) {
            this._pinnedBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-pinned-box'});
            this._pinnedTitle = new St.Label({text: _('Pinned'), style_class: 'spawn-section-title'});
            this._pinnedBox.add_child(this._pinnedTitle);
            markList(this._grid.actor, _('Pinned apps'));
            this._pinnedBox.add_child(this._grid.actor);
            this._pinnedBox.add_child(this._makePinnedEmpty());
            this._pinnedScroll = this._scrollFactory.make(this._pinnedBox, 'spawn-pinned');
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

    /** Nothing pinned: a friendly note and a way on, in place of the "Pinned" title over empty space. */
    private _makePinnedEmpty(): St.BoxLayout {
        const box = new St.BoxLayout({
            style_class: 'spawn-empty-state spawn-pinned-empty',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(new St.Icon({icon_name: 'view-pin-symbolic', style_class: 'spawn-empty-icon', x_align: Clutter.ActorAlign.CENTER}));
        const title = new St.Label({text: _('Nothing pinned yet'), style_class: 'spawn-empty-title', x_align: Clutter.ActorAlign.CENTER});
        const hint = new St.Label({text: _('Right-click an app and choose Pin to Menu'), style_class: 'spawn-empty-hint', x_align: Clutter.ActorAlign.CENTER});
        hint.clutter_text.line_wrap = true;
        hint.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        hint.clutter_text.set_line_alignment(Pango.Alignment.CENTER);
        box.add_child(title);
        box.add_child(hint);
        const button = makeItemButton('spawn-nav-button spawn-pinned-empty-button');
        button.x_expand = false;
        button.x_align = Clutter.ActorAlign.CENTER;
        const label = new St.Label({text: _('Browse All Apps'), y_align: Clutter.ActorAlign.CENTER});
        button.set_child(makeFace('spawn-nav-surface', label));
        nameItem(button, label.text, {label});
        wireItem(button, {activate: () => this._openAllApps()});
        box.add_child(button);
        this._pinnedEmpty = box;
        this._pinnedEmptyButton = button;
        return box;
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
                    columns: this._metrics.cols,
                    tileWidth: this._metrics.tileWidth,
                    iconSize: this._metrics.tileIconSize,
                    // The popup is always a grid, so the grid's label setting applies in the list display too.
                    multiLine: this._services.settings.get('multi-lined-labels'),
                    list: this._metrics.listMode(),
                    rowIconSize: this._metrics.rowIconSize(),
                    size: this._metrics.itemSize(),
                    ...this._metrics.contentSize(),
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
        markList(box, _('Frequent apps'));
        this._tooltips.hide();
        for (const c of box.get_children())
            c.destroy();
        const s = this._services.settings;
        const opts = {iconSize: iconSizeFor(s, 'icon-size-apps', 28), description: showDescriptions(s)};
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
        const rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: this._metrics.listMode() ? 'spawn-list' : ''});
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

    private _folderCount(uuid: string): number {
        return this._services.pinned.folderApps(uuid).length;
    }

    private _syncPinned(): void {
        this._tooltips.hide();
        const store = this._services.pinned;
        const settings = this._services.settings;
        const multiLine = settings.get('multi-lined-labels');
        const generic = settings.get('apps-show-generic-names');
        const list = this._metrics.listMode();
        const rowIconSize = this._metrics.rowIconSize();

        // Tiles keep their icon size / label mode / naming from when they were built: a change in
        // any of them (or list <-> grid, which swaps tiles for rows) rebuilds every entry
        // (otherwise old and new sizes mix in one grid).
        // List rows are always one line (multi-lined-labels is a grid setting).
        const size = this._metrics.itemSize();
        const signature = list ? `list${rowIconSize}|${generic}|${size}` : `grid${this._metrics.tileIconSize}|${multiLine}|${generic}|${size}`;
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
        const tileOpts = {iconSize: list ? rowIconSize : this._metrics.tileIconSize, multiLine: multiLine && !list};
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
                // A badge on/off flips the key, so the cached entry is replaced when the app stops being new.
                const key = `${app ? 'a' : 'm'}:${item.id}${app && this._tileHost.isNew?.(app) ? '*' : ''}`;
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
                    existing.folder.update(item.name, this._folderIcons(item.uuid), this._folderCount(item.uuid));
                    return {key, entry: existing};
                }
                const {scope, release} = ownedScope(this._scope, key);
                const Folder = list ? FolderRow : FolderTile;
                const tile = new Folder(item.uuid, item.name, this._folderIcons(item.uuid), this._folderHost,
                    {...tileOpts, plateInset: sizeMetrics(size).plateInset, count: this._folderCount(item.uuid)});
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
                // Built-in shortcuts, folders and URIs show their own name and icon; a plain command keeps the generic look.
                const builtin = /^(Spawn_|ArcMenu_|\/|[a-z][a-z0-9+.-]*:\/\/)/.test(id) ? resolveShortcut(item.entry) : null;
                const tile = new Action(builtin?.name || item.entry.name || id, builtin?.icon || item.entry.icon || 'application-x-executable',
                    () => this._runCustom(item.entry), {tooltips: this._tooltips},
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
        this._grid.setTiles(tiles, list ? 1 : this._metrics.cols, list ? -1 : this._metrics.tileWidth, size);
        const empty = tiles.length === 0;
        this._grid.actor.visible = !empty;
        if (this._pinnedTitle)
            this._pinnedTitle.visible = !empty;
        if (this._pinnedEmpty)
            this._pinnedEmpty.visible = empty;
    }

    private _runCustom(entry: Entry): void {
        const id = entry.id;
        // Pinned shortcuts (Spawn_*, folders, URIs) run through the shared resolver, which closes the menu itself
        // (Spawn_ShowAllApplications must keep it open).
        const resolved = resolveShortcut(entry);
        if (resolved) {
            try {
                resolved.run({close: () => this._host.close(), showAllApps: () => this._openAllApps()}, this._scope);
            } catch (e) {
                error(`could not run ${id}`, e);
            }
            return;
        }
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

    /** `pointer`: opened with a click, so no app is highlighted until the pointer or an arrow key picks one. */
    private _showFolder(uuid: string, pointer = false): void {
        const fv = this._ensureFolderView();
        // The card opens next to the folder it came from when that folder is on screen (pinned view).
        const tile = this._state.view === 'pinned' ? this._tileEntries.get(`f:${uuid}`)?.widget ?? null : null;
        // The folder vanished (deleted elsewhere, emptied): show() already went back to the default
        // view, so do not switch to an empty folder view.
        if (!fv.show(uuid, this._state.isOpen, tile?.mapped ? tile : null))
            return;
        this._setView('folder');
        if (!this._state.isOpen)
            return;
        if (pointer) {
            fv.focusCard();
            return;
        }
        (fv.tiles()[0] ?? fv.headerButtons()[0]).grab_key_focus();
    }

    /** Open the folder and start renaming it (its context menu's Rename, F2). */
    private _renameFolder(uuid: string): void {
        this._showFolder(uuid);
        if (this._state.view === 'folder' && this._folderView?.uuid === uuid)
            this._folderView.startRename();
    }

    // ---- keyboard reordering (Ctrl+arrows / Ctrl+Home / Ctrl+End) ----

    /** True when the focus is on a reorderable pinned entry (the key is then consumed, even at an edge). */
    private _reorderFocused(key: ReorderKey): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus || this._state.destroyed)
            return false;
        const store = this._services.pinned;
        if (this._state.view === 'pinned') {
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
        const fv = this._state.view === 'folder' ? this._folderView : null;
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
        // Launched once: no longer new (an app that is already running does not change state, so say it here).
        this._services.newApps.markLaunched(app.get_id() ?? '');
        const keepOpen = ctrl && this._services.settings.get('keep-open-on-ctrl-click');
        if (!keepOpen)
            this._host.close();
    }

    // ---- search ----

    private _onSearchText(text: string): void {
        if (this._state.destroyed)
            return;
        const query = text.trim();
        this._session.cancel();
        this._session.arm(false);
        // Typing: new rows appearing under a resting pointer must not take the highlight from the best match.
        this._highlight.keyMoved(null);
        if (query.length === 0) {
            // Drop the old rows now: the next query must not flash them (dimmed) or let Down focus them.
            this._results?.reset();
            if (this._state.view === 'results')
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
        results.beginQuery(query);
        results.setSelectionVisible(true);
        this._session.start(query, results);
    }

    /**
     * Return in the search entry: activate the highlighted result of the CURRENT query (the first
     * one until Up / Down / the pointer moved the highlight). Typing and pressing Return inside the
     * debounce window must not do nothing: flush the pending query (synchronous providers deliver
     * before flush() returns); if slower providers still owe the first row, activate it as soon as
     * it arrives. `ctrl` (Ctrl+Return): as a Ctrl+click on the row.
     */
    private _onSearchActivate(ctrl = false): void {
        if (this._state.view !== 'results' || this._search.text.trim().length === 0)
            return;
        const results = this._results;
        if (!results)
            return;
        this._session.activate(results, ctrl);
    }

    /**
     * Keys in the search entry. While results show, the typing focus stays in the entry: Up / Down move
     * the highlight one result (wrapping; the first is highlighted already, so the key pointing away from
     * the entry goes to the second; with the entry below the list, whose order is mirrored, that is Up),
     * Page Up / Down one page of results, Return / Ctrl+Return activate the highlighted one, Tab goes to
     * the results. Without a query, Down (and Up when the entry is below) enter the list.
     */
    private _onSearchKey(key: number, shift: boolean, ctrl = false): boolean {
        const results = this._state.view === 'results' ? this._results : null;
        switch (key) {
        case Clutter.KEY_Down:
        case Clutter.KEY_Up: {
            const down = key === Clutter.KEY_Down;
            if (results) {
                // Deliver the synchronous batches of the pending query first: the highlight must move
                // over what the entry says now, not over the rows of the previous keystroke.
                this._session.flush();
                this._showSelection(results.moveSelection(searchStep(down ? 'down' : 'up', this._state.searchTop), false));
            } else if (down || !this._state.searchTop) {
                this._focusMain(!down);
                this._highlight.keyMoved();
            }
            return true;
        }
        case Clutter.KEY_Page_Up:
        case Clutter.KEY_Page_Down:
            if (!results)
                return false;
            this._session.flush();
            this._showSelection(this._pageTo(results.visualRows(), results.selected(), key === Clutter.KEY_Page_Down ? 1 : -1));
            return true;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            // Plain Return reaches the entry's `activate`; Ctrl+Return does not.
            if (!ctrl)
                return false;
            this._onSearchActivate(true);
            return true;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._session.flush();
            this._cyclePane(key === Clutter.KEY_ISO_Left_Tab || shift ? -1 : 1);
            this._highlight.keyMoved();
            return true;
        }
        return false;
    }

    /** The search highlight moved to `row` by a key: the hover tint elsewhere goes, the row scrolls into view. */
    private _showSelection(row: Clutter.Actor | null): void {
        if (!row)
            return;
        this._results?.select(row, true);
        this._highlight.keyMoved(row);
        scrollIntoView(this._resultsScroll, row);
    }

    /**
     * Page Up (-1) / Page Down (1) from `from` among `items` (screen order): the item one visible page of
     * their scroll view away, in the same column. Null when there is nothing to move to.
     */
    private _pageTo(items: Clutter.Actor[], from: Clutter.Actor | null, dir: 1 | -1): Clutter.Actor | null {
        const index = from ? items.indexOf(from) : -1;
        if (index < 0)
            return null;
        let scroll: Clutter.Actor | null = from;
        while (scroll && !(scroll instanceof St.ScrollView))
            scroll = scroll.get_parent();
        const page = scroll ? Math.max(scroll.height - (from as Clutter.Actor).height, (from as Clutter.Actor).height) : 0;
        const target = pageTarget(items.map(centreOf), index, dir, page);
        return target === index ? null : items[target];
    }

    // ---- navigation ----

    private _mainGroups(): Group[] {
        switch (this._state.view) {
        case 'pinned': {
            const groups: Group[] = [{id: 'tiles', items: this._grid.tiles(), cols: this._grid.columns}];
            if (this._pinnedEmpty?.visible && this._pinnedEmptyButton)
                groups.push({id: 'empty', items: [this._pinnedEmptyButton], cols: 1});
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
            return [{id: 'results', items: this._results?.hasResults ? this._results.visualRows() : [], cols: 1}];
        }
    }

    private _categoryGroup(): Group | null {
        if (this._state.view !== 'categories' || !this._categories)
            return null;
        return {id: 'categories', items: this._categories.categoryButtons(), cols: 1};
    }

    private _undoGroup(): Group | null {
        return this._undo.banner.visible ? {id: 'undo', items: [this._undo.banner.button], cols: 1} : null;
    }

    private _searchGroup(): Group | null {
        return this._search.actor.visible ? {id: 'search', items: [this._search.actor.clutter_text], cols: 1} : null;
    }

    /** Left column groups in vertical order. */
    private _leftColumn(): Group[] {
        // An open folder popup keeps the keyboard inside it (header, then its apps).
        if (this._state.view === 'folder')
            return this._mainGroups().filter(g => g.items.length > 0);
        const out: Group[] = [];
        const search = this._searchGroup();
        const top = this._state.searchTop;
        if (search && top)
            out.push(search);
        const links = this._leftPane.linksGroup();
        const linksTop = this._leftPane.links?.location === 'Top';
        if (links && linksTop)
            out.push(links);
        out.push(...this._mainGroups().filter(g => g.items.length > 0));
        if (links && !linksTop)
            out.push(links);
        const undo = this._undoGroup();
        if (undo)
            out.push(undo);
        const nav = this._leftPane.navGroup();
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
        if (this._state.view === 'folder' && !last && groups.length > 1) {
            this._focusItem(groups[1], 'first');
            return;
        }
        if (groups.length === 0) {
            // Results still pending (or none): stay where the focus is instead of jumping to Back.
            if (this._state.view !== 'results')
                this._focusItem(this._leftPane.navGroup() ?? undefined);
            return;
        }
        this._focusItem(last ? groups[groups.length - 1] : groups[0], last ? 'last' : 'first');
    }

    private _move(dir: Dir): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (this._rightPane.placeStep(dir, focus))
            return true;
        const leftCol = this._leftColumn();
        const inFolder = this._state.view === 'folder';
        const rightCol = inFolder ? [] : this._rightPane.groups().filter(g => g.items.length > 0);
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
                    return this._focusItem(this._leftPane.navGroup() ?? (!this._state.searchTop && search ? search : undefined), 'first') || true;
                return (this._state.searchTop && search ? this._focusItem(search, 'first') : false) || true;
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
            // Leaving the pane sideways: the item of the other pane at the same height (nearest column).
            if (onRight) {
                if (delta < 0)
                    this._focusNearest(leftCol.filter(g => g.id !== 'search'), focus as Clutter.Actor);
                return true;
            }
            if (inFolder)
                return true;
            if (delta > 0) {
                this._focusNearest(rightCol, focus as Clutter.Actor);
                return true;
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

    /** Focus the item of `groups` nearest to `from` on screen, vertically first (only items scrolled into view). */
    private _focusNearest(groups: Group[], from: Clutter.Actor): boolean {
        const items = groups.flatMap(g => g.items).filter(inView);
        const target = items[nearestIndex(items.map(centreOf), centreOf(from))];
        target?.grab_key_focus();
        return Boolean(target);
    }

    /** The keyboard groups by pane: the left column, the right pane (none in a folder popup), the category column. */
    private _paneGroups(): {left: Group[]; right: Group[]; cats: Group | null} {
        const inFolder = this._state.view === 'folder';
        return {
            left: this._leftColumn(),
            right: inFolder ? [] : this._rightPane.groups().filter(g => g.items.length > 0),
            cats: inFolder ? null : this._categoryGroup(),
        };
    }

    /** Home / End (first / last item) and Page Up / Down (one visible page) inside the focused list or grid. */
    private _jump(sym: number): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const {left, right, cats} = this._paneGroups();
        const loc = this._locate([...left, ...right, ...(cats ? [cats] : [])], focus);
        if (!loc || loc.group.id === 'search')
            return false;
        const items = loc.group.items;
        const current = items[loc.index];
        let target: Clutter.Actor | null;
        if (sym === Clutter.KEY_Home || sym === Clutter.KEY_KP_Home)
            target = items[0];
        else if (sym === Clutter.KEY_End || sym === Clutter.KEY_KP_End)
            target = items[items.length - 1];
        else
            target = this._pageTo(items, current, sym === Clutter.KEY_Page_Down || sym === Clutter.KEY_KP_Page_Down ? 1 : -1);
        if (target && target !== current)
            target.grab_key_focus();
        return true;
    }

    /** F2 on a pinned folder (or anywhere in its open popup): rename it. */
    private _renameFocused(): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const fv = this._folderView;
        if (!focus)
            return false;
        if (this._state.view === 'folder' && fv?.uuid && fv.actor.contains(focus)) {
            if (!fv.renaming)
                fv.startRename();
            return true;
        }
        if (this._state.view !== 'pinned')
            return false;
        for (const [key, entry] of this._tileEntries) {
            if (key.startsWith('f:') && entry.widget === focus) {
                this._renameFolder(key.slice(2));
                return true;
            }
        }
        return false;
    }

    /** Delete on a pinned app or command (top level): Unpin, exactly as its context menu does it. */
    private _unpinFocused(): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus || this._state.view !== 'pinned')
            return false;
        for (const [key, entry] of this._tileEntries) {
            if (entry.widget !== focus)
                continue;
            if (key.startsWith('f:'))
                return false;
            // a:<id>[*] (an app, * = "New" badge), m:<id> (not installed), c:<id> (command / shortcut)
            this._context.unpin(key.slice(2).replace(/\*$/, ''));
            return true;
        }
        return false;
    }

    /** The pointer is on `item` (widgets/highlight.ts): a search result takes the search highlight. */
    private _onItemHover(item: St.Widget): boolean {
        const results = this._state.view === 'results' ? this._results : null;
        if (!results || !results.rows().includes(item))
            return false;
        results.select(item);
        // Typing focus in the entry stays; a focus ring on another row goes (the generic rule).
        return this._search.hasFocus;
    }

    private _cyclePane(delta: number): void {
        if (this._state.view === 'folder') {
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
        const nav = this._leftPane.navGroup();
        const right = this._rightPane.groups().filter(g => g.items.length > 0);
        const focus = global.stage.key_focus as Clutter.Actor | null;

        const add = (g: Group | null | undefined, which: 'first' | 'last' = 'first') => {
            if (!g || !g.items.length)
                return;
            // Into the search results: the highlighted one.
            const at = g.id === 'results' ? g.items.indexOf(this._results?.selected() as Clutter.Actor) : -1;
            panes.push(() => this._focusItem(g, at >= 0 ? at : which));
        };
        const links = this._leftPane.linksGroup();
        const linksTop = this._leftPane.links?.location === 'Top';
        // Reading order wherever the entry sits: search, the list (and what is below it), right pane, power buttons.
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
        for (const g of right)
            add(g);

        // Which pane holds the focus?
        const all: Array<Group | null> = [search, linksTop ? links : null, cats, ...main, linksTop ? null : links, undo, nav, ...right];
        const groups = all.filter((g): g is Group => Boolean(g && g.items.length));
        const loc = this._locate(groups, focus);
        const current = loc ? groups.indexOf(loc.group) : -1;
        const next = ((current + delta) % panes.length + panes.length) % panes.length;
        panes[next]?.();
    }

    private _onKeyPress(event: Clutter.Event): boolean {
        if (this._state.destroyed)
            return Clutter.EVENT_PROPAGATE;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (this._folderView?.renaming && focus && this._folderView.actor.contains(focus) && !(focus instanceof St.Button))
            return Clutter.EVENT_PROPAGATE;
        // Only pointed at (the layout holds the focus): the key acts on the pointed-at item.
        if (this._highlight.takeKey(event) === 'redeliver')
            return Clutter.EVENT_STOP;

        const sym = event.get_key_symbol();
        const state = event.get_state();
        const ctrl = Boolean(state & (Clutter.ModifierType.CONTROL_MASK | Clutter.ModifierType.MOD1_MASK));

        // Ctrl+arrows / Home / End on a pinned entry or a folder's app reorder it; Ctrl+Z undoes a folder delete.
        if ((state & Clutter.ModifierType.CONTROL_MASK) && !(state & (Clutter.ModifierType.SHIFT_MASK | Clutter.ModifierType.MOD1_MASK))) {
            const reorder = REORDER_KEYS.get(sym);
            if (reorder && this._reorderFocused(reorder))
                return Clutter.EVENT_STOP;
            if ((sym === Clutter.KEY_z || sym === Clutter.KEY_Z) && this._undo.hasUndo()) {
                this._undo.undoLast();
                return Clutter.EVENT_STOP;
            }
        }

        // A key that moves the focus leaves it as the only highlight (no hover tint under a resting pointer).
        const moved = (handled: boolean): boolean => {
            this._highlight.keyMoved();
            return handled ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        };
        switch (sym) {
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab:
            this._cyclePane(sym === Clutter.KEY_ISO_Left_Tab || (state & Clutter.ModifierType.SHIFT_MASK) ? -1 : 1);
            return moved(true);
        case Clutter.KEY_Up:
            return moved(this._move('up'));
        case Clutter.KEY_Down:
            return moved(this._move('down'));
        case Clutter.KEY_Left:
            return moved(this._move('left'));
        case Clutter.KEY_Right:
            return moved(this._move('right'));
        case Clutter.KEY_Home:
        case Clutter.KEY_KP_Home:
        case Clutter.KEY_End:
        case Clutter.KEY_KP_End:
        case Clutter.KEY_Page_Up:
        case Clutter.KEY_KP_Page_Up:
        case Clutter.KEY_Page_Down:
        case Clutter.KEY_KP_Page_Down:
            if (ctrl)
                break;
            return moved(this._jump(sym));
        case Clutter.KEY_F2:
            if (!ctrl && this._renameFocused())
                return Clutter.EVENT_STOP;
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Delete:
        case Clutter.KEY_KP_Delete:
            if (!ctrl && !(state & Clutter.ModifierType.SHIFT_MASK) && this._unpinFocused())
                return Clutter.EVENT_STOP;
            return Clutter.EVENT_PROPAGATE;
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
        if (!this._state.isOpen || this._state.destroyed)
            return;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus) {
            // The focused actor went away (view switched, tile removed): keep the keyboard alive.
            const lost = this._lastTile;
            this._scope.idle(() => {
                if (this._state.isOpen && !this._state.destroyed && !global.stage.key_focus && !this._context.isOpen) {
                    // An open folder popup keeps the keyboard (its tiles are rebuilt on every store change).
                    if (this._state.view === 'folder') {
                        this._focusMain();
                        return;
                    }
                    // A pinned tile was destroyed (Unpin, Delete Folder): focus its neighbour at the same index.
                    // Compare identities only: touching the destroyed tile itself logs a critical.
                    const current = this._state.view === 'pinned' ? this._grid.tiles() : [];
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
        if (this._state.view === 'pinned') {
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
        // The search highlight follows a result row that takes the keyboard focus, and shows only while no
        // row has it (the focus ring is the highlight then).
        if (this._results) {
            const inResults = this._results.actor.contains(focus);
            if (inResults)
                this._results.select(focus);
            this._results.setSelectionVisible(!inResults);
        }
    }
}

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
import Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {openSpawnPrefs} from '../core/openPrefs.js';
import {debounce} from '../core/debounce.js';
import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {FakePlace} from '../model/places.js';
import {nearestIndex} from '../model/listNav.js';
import {reorderTarget, type ReorderKey} from '../model/reorder.js';
import type {SearchResult} from '../search/engine.js';
import {AppContextMenu} from './contextMenu.js';
import {centreOf, inView, pageTo} from './layout/geometry.js';
import {FolderController} from './layout/folders.js';
import {FrequentView} from './layout/frequentView.js';
import {LeftPane} from './layout/leftPane.js';
import {PinnedView} from './layout/pinnedView.js';
import {RightPane} from './layout/rightPane.js';
import {SearchController} from './layout/searchView.js';
import {UndoController} from './layout/undo.js';
import {LayoutState, type Dir, type Group, type LayoutHost, type ViewId} from './layout/types.js';
import {PaneMetrics} from './layout/metrics.js';
import {ScrollFactory} from './layout/scrolls.js';
import {SearchSession} from './searchSession.js';
import {bindReducedMotion} from './widgets/a11y.js';
import type {TileHost} from './widgets/appTile.js';
import {CategoryList} from './widgets/categoryList.js';
import {ExtraList} from './widgets/extraList.js';
import type {FolderHost} from './widgets/folderTile.js';
import {PointerHighlight} from './widgets/highlight.js';
import type {ResultHost} from './widgets/resultList.js';
import {SearchBox} from './widgets/searchBox.js';
import type {ShortcutHost} from './widgets/shortcutRow.js';
import {TooltipManager} from './widgets/tooltip.js';
import {applyScrollSettings, isPointerEvent, launchApp, lookupApp, scrollIntoView} from './util.js';

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
    private readonly _pinned: PinnedView;
    private readonly _frequent: FrequentView;
    private _categories: CategoryList | null = null;
    private readonly _folders: FolderController;
    private _extraList: ExtraList | null = null;
    private _extraScroll: St.ScrollView | null = null;
    private readonly _searchCtl: SearchController;

    // state
    private readonly _state = new LayoutState();
    /** Last keyboard-focused pinned tile and its index, to refocus a neighbour when it is destroyed. */
    private _lastTile: {widget: Clutter.Actor; index: number} | null = null;
    private readonly _session: SearchSession;
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
                folderUuid: folderUuid ?? (this._state.view === 'folder' ? this._folders.view?.uuid ?? undefined : undefined),
            }),
            isNew: app => this._services.newApps.showBadge(app.get_id() ?? ''),
            tooltips: this._tooltips,
        };
        this._folderHost = {
            open: (uuid, pointer) => this._folders.show(uuid, pointer),
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
                this._scope.idle(() => this._folders.show(uuid));
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
                this._scope.idle(() => this._folders.rename(uuid));
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
            ignore: item => Boolean(this._folders.view?.actor.contains(item)),
            onHover: item => this._searchCtl.onHover(item),
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
        this._frequent = new FrequentView(services, this._tileHost, this._tooltips, this._scrollFactory);
        this._pinned = new PinnedView(scope, services, this._state, {
            metrics: this._metrics,
            tooltips: this._tooltips,
            tileHost: this._tileHost,
            folderHost: this._folderHost,
            context: this._context,
            scrolls: this._scrollFactory,
            frequent: this._frequent,
            host: {close: () => this._host.close(), openAllApps: () => this._openAllApps()},
        });
        this._folders = new FolderController(scope, services, this._state, {
            root: this.actor,
            tileHost: this._tileHost,
            metrics: this._metrics,
            context: this._context,
            host: {
                setView: view => this._setView(view),
                back: () => this._back(),
                folderTile: uuid => this._pinned.tileWidget(`f:${uuid}`),
            },
        });

        this._search = new SearchBox(scope, settings);
        this._searchCtl = new SearchController(scope, services, this._state, {
            search: this._search,
            highlight: this._highlight,
            scrolls: this._scrollFactory,
            session: this._session,
            resultHost: this._resultHost,
            host: {
                setView: view => this._setView(view),
                defaultView: () => this._defaultView(),
                focusMain: last => this._focusMain(last),
                cyclePane: delta => this._cyclePane(delta),
            },
        });
        this._undo = new UndoController(scope, services, this._state, {
            focusMain: () => this._focusMain(),
            syncPinned: () => this._pinned.syncIfNeeded(),
            pinnedTile: key => this._pinned.tileWidget(key),
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
                arranged: top => this._searchCtl.results?.setReversed(!top),
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
        this._search.onTextChanged(scope, text => this._searchCtl.onText(text));
        // An app installed or removed while results are showing: search again, so a new app shows up
        // and a removed one cannot be launched from a stale row.
        services.appIndex.onChanged(scope, () => {
            if (this._state.isOpen && this._state.view === 'results' && this._search.text.trim().length > 0)
                this._searchCtl.onText(this._search.text);
            this._refreshGeneratedLists();
        });
        // A new app was launched or aged out: pinned entries are cached per badge state. Deferred, because the
        // launch comes from a click on one of those entries.
        services.newApps.onChanged(scope, () => {
            scope.idle(() => {
                if (this._state.destroyed)
                    return;
                this._pinned.dirty = true;
                if (this._pinned.showing())
                    this._pinned.syncIfNeeded();
            });
        });
        this._search.onActivate(scope, () => this._searchCtl.onActivate());
        this._search.onNavigate(scope, (key, shift, ctrl) => this._searchCtl.onKey(key, shift, ctrl));

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
            this._folders.view?.commitRename();
            this._undo.dismiss();
            this._context.close();
            this._search.setSilently('');
            this._session.cancel();
            // The popup may open on another monitor / work area than last time: new columns or tile
            // widths make the cached pinned tiles stale.
            if (this._metrics.apply())
                this._pinned.dirty = true;
            if (this._leftPane.searchOnTop() !== this._state.searchTop)
                this._leftPane.arrange();
            this._setView(this._defaultView());
            for (const s of [this._pinned.scroll, this._frequent.scroll, this._extraScroll, this._searchCtl.scroll, this._rightPane.scroll])
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
                this._pinned.dirty = true;
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
                this._folders.view?.hide(false);
            this._undo.dismiss();
            this._context.close();
            this._tooltips.hide();
            this._session.cancel();
            this._session.arm(false);
            this._search.setSilently('');
            this._searchCtl.results?.reset();
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
        if (this._folders.view?.renaming) {
            this._folders.view.cancelRename();
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
            this._folders.show(f.uuid);
    }

    showFolder(uuid: string): void {
        this._folders.show(uuid);
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
            tiles: this._pinned.grid.tiles().length,
            display: this._metrics.listMode() ? 'List' : 'Grid',
            folder: this._state.view === 'folder' ? this._folders.view?.uuid ?? null : null,
            folderTiles: this._state.view === 'folder' ? this._folders.view?.tiles().length ?? 0 : 0,
            folderColumns: this._state.view === 'folder' ? this._folders.view?.columns ?? 0 : 0,
            results: this._searchCtl.results?.rows().length ?? 0,
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
            renaming: this._folders.view?.renaming ?? false,
            pinnedScroll: this._pinned.scroll?.vadjustment.value ?? 0,
            ghosts: this._pinned.ghostCount(),
            // accessible names of the app rows of the visible category list ("Firefox", "Firefox, new")
            appRows: (this._categories?.appRows() ?? []).map(r => r.accessible_name ?? ''),
            // rows of that list not built yet (All Apps builds them as they scroll into view)
            appRowsPending: this._categories?.pendingRows ?? 0,
            undo: this._undo.banner.visible,
            // the search highlight (Return target) and what the screen reader was told last
            selected: this._searchCtl.results?.selected()?.accessible_name ?? null,
            selectedIndex: this._searchCtl.results?.rows().indexOf(this._searchCtl.results.selected() as St.Widget) ?? -1,
            announcement: this._searchCtl.results?.announcement ?? '',
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


    private _relayout(): void {
        if (this._state.destroyed)
            return;
        this._metrics.apply();
        this._leftPane.arrange();
        this._pinned.dirty = true;
        if (this._state.isOpen)
            this._setView(this._state.view);
        // List <-> grid (or a new column count) changes the folder contents too.
        if (this._state.view === 'folder')
            this._folders.view?.refresh();
    }

    /** Settings that are read once when a view is built: re-apply scrolling, rebuild the lists. */
    private _onViewSettings(): void {
        if (this._state.destroyed)
            return;
        this._categories?.refresh();
        this._leftPane.syncLinks();
        this._pinned.dirty = true;
        if (this._state.isOpen)
            this._setView(this._state.view);
        if (this._state.view === 'folder')
            this._folders.view?.refresh();
    }

    /** Scroll bar settings: re-apply to every existing scroll view; no rebuild. */
    private _onScrollSettings(): void {
        if (this._state.destroyed)
            return;
        const s = this._services.settings;
        const scrolls = [
            ...this._scrollFactory.tracked(), this._rightPane.scroll,
            this._categories?.appScroll(), this._categories?.columnScroll(), this._folders.view?.scroll,
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
        if (this._state.view === 'frequent' && this._frequent.box)
            this._frequent.refill();
        else if (this._state.view === 'pinned')
            this._pinned.refreshFrequent();
    }

    private _onInstalledChanged(): void {
        if (this._state.destroyed)
            return;
        // An app may have appeared (a ghost tile becomes real) or vanished (a tile becomes a ghost).
        if (this._pinned.subscribed)
            this._services.pinned.invalidate();
        this._pinned.dirty = true;
        if (this._pinned.showing())
            this._pinned.syncIfNeeded();
        if (this._state.isOpen && this._state.view === 'folder')
            this._folders.view?.refresh();
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
        const folder = this._state.view === 'folder' ? this._folders.view?.uuid ?? null : null;
        // Closing a folder popup returns to the view it was opened over (e.g. Pinned reached by a quick link).
        this._setView(this._state.view === 'folder' ? this._state.underFolder : this._defaultView());
        // Closing a folder popup with the keyboard (Escape, Return on Close): the keyboard goes back to the
        // folder it came from. Closed with the pointer (close button, a click outside the card): the usual
        // focus (search), so the folder is not left with a focus ring nobody asked for.
        const folderTile = folder && this._state.view === 'pinned' ? this._pinned.entries.get(`f:${folder}`)?.widget : null;
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
            this._folders.ensure();
            if (this._state.view !== 'folder')
                this._state.underFolder = this._state.view;
            this._state.view = view;
            // A relayout while the popup is open (display / size settings): the pinned grid under it follows.
            if (this._pinned.showing())
                this._pinned.syncIfNeeded();
            this._leftPane.updateNav();
            this._searchCtl.results?.setSelectionVisible(true);
            return;
        }
        if (this._state.view === 'folder')
            this._folders.view?.hide(this._state.isOpen);
        const actors = this._ensureView(view);
        this._state.view = view;
        for (const child of this._leftPane.stack.get_children())
            child.visible = actors.includes(child);
        this._leftPane.updateNav();
        if (view === 'pinned')
            this._searchCtl.results?.setSelectionVisible(true);
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
            const scroll = this._pinned.ensure();
            this._pinned.syncIfNeeded();
            this._pinned.refreshFrequent();
            return [add(scroll)];
        }
        case 'frequent':
            return [add(this._frequent.ensure())];
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
                    ...this._tileHost,
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
        case 'results':
            return [add(this._searchCtl.ensure())];
        }
    }

    private _ensureCategories(): CategoryList {
        if (!this._categories)
            this._categories = new CategoryList(this._scope.child('categories'), this._services, this._tileHost);
        return this._categories;
    }

    // ---- keyboard reordering (Ctrl+arrows / Ctrl+Home / Ctrl+End) ----

    /** True when the focus is on a reorderable pinned entry (the key is then consumed, even at an edge). */
    private _reorderFocused(key: ReorderKey): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus || this._state.destroyed)
            return false;
        const store = this._services.pinned;
        if (this._state.view === 'pinned') {
            const tiles = this._pinned.grid.tiles();
            const loc = this._locate([{id: 'tiles', items: tiles, cols: this._pinned.grid.columns}], focus);
            if (!loc)
                return false;
            const to = reorderTarget(loc.index, tiles.length, this._pinned.grid.columns, key);
            if (to !== null) {
                const widget = tiles[loc.index];
                this._tooltips.hide();
                store.moveShown(loc.index, to);
                // The store notified the layout synchronously: the rows are rebuilt around the same widgets.
                this._pinned.syncIfNeeded();
                widget.grab_key_focus();
            }
            return true;
        }
        const fv = this._state.view === 'folder' ? this._folders.view : null;
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

    // ---- navigation ----

    private _mainGroups(): Group[] {
        switch (this._state.view) {
        case 'pinned':
            return this._pinned.groups();
        case 'frequent':
            return [{id: 'frequent', items: this._frequent.rows(), cols: 1}];
        case 'categories':
        case 'all':
            return [{id: 'apps', items: this._categories?.appRows() ?? [], cols: 1}];
        case 'folder': {
            const fv = this._folders.view;
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
            return [{id: 'results', items: this._searchCtl.results?.hasResults ? this._searchCtl.results.visualRows() : [], cols: 1}];
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
            target = pageTo(items, current, sym === Clutter.KEY_Page_Down || sym === Clutter.KEY_KP_Page_Down ? 1 : -1);
        if (target && target !== current)
            target.grab_key_focus();
        return true;
    }

    /** F2 on a pinned folder (or anywhere in its open popup): rename it. */
    private _renameFocused(): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const fv = this._folders.view;
        if (!focus)
            return false;
        if (this._state.view === 'folder' && fv?.uuid && fv.actor.contains(focus)) {
            if (!fv.renaming)
                fv.startRename();
            return true;
        }
        if (this._state.view !== 'pinned')
            return false;
        for (const [key, entry] of this._pinned.entries) {
            if (key.startsWith('f:') && entry.widget === focus) {
                this._folders.rename(key.slice(2));
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
        for (const [key, entry] of this._pinned.entries) {
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
            const at = g.id === 'results' ? g.items.indexOf(this._searchCtl.results?.selected() as Clutter.Actor) : -1;
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
        if (this._folders.view?.renaming && focus && this._folders.view.actor.contains(focus) && !(focus instanceof St.Button))
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
                    const current = this._state.view === 'pinned' ? this._pinned.grid.tiles() : [];
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
            const index = this._pinned.grid.tiles().indexOf(focus as St.Widget);
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
        if (this._searchCtl.results) {
            const inResults = this._searchCtl.results.actor.contains(focus);
            if (inResults)
                this._searchCtl.results.select(focus);
            this._searchCtl.results.setSelectionVisible(!inResults);
        }
    }
}

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
// Structure: SpawnLayout is the coordinator. It builds the root actor and the pane boxes, owns the shared
// LayoutState, wires the settings and store signals, and implements the public hooks above. The work is in
// ui/layout/*, each module documenting its own API:
//   metrics.ts      PaneMetrics: pane widths, height, tile columns / width / icon size, grid / list mode
//   leftPane.ts     LeftPane: order of search / quick links / view stack / banner / Back row, quick links, Back visibility
//   rightPane.ts    RightPane: user card, shortcuts + places, power bar
//   views.ts        ViewManager: setView / Back / start view, category list, Favorites / Recent, keyboard groups
//   pinnedView.ts   PinnedView: pinned grid or list, tile cache, empty state, frequent section
//   frequentView.ts FrequentView: the Frequent list
//   folders.ts      FolderController: the folder popup
//   searchView.ts   SearchController: results view, entry text / Return / keys (query running: ui/searchSession.ts)
//   undo.ts         UndoController: the Undo banner and the actions it undoes
//   navigation.ts   Navigator: arrows / Tab / Home / End / Page keys over keyboard groups (NavSources)
//   keys.ts         KeyRouter: key-press handler (reorder, Ctrl+Z, F2, Delete, typing) and focus changes
//   scrolls.ts, geometry.ts, types.ts, debug.ts   scroll view factory, on-screen geometry, shared types, debugState
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
import type {SearchResult} from '../search/engine.js';
import {AppContextMenu} from './contextMenu.js';
import {layoutDebugState} from './layout/debug.js';
import {FolderController} from './layout/folders.js';
import {FrequentView} from './layout/frequentView.js';
import {KeyRouter} from './layout/keys.js';
import {LeftPane} from './layout/leftPane.js';
import {Navigator} from './layout/navigation.js';
import {PinnedView} from './layout/pinnedView.js';
import {RightPane} from './layout/rightPane.js';
import {SearchController} from './layout/searchView.js';
import {ViewManager} from './layout/views.js';
import {UndoController} from './layout/undo.js';
import {LayoutState, type Group, type LayoutHost, type ViewId} from './layout/types.js';
import {PaneMetrics} from './layout/metrics.js';
import {ScrollFactory} from './layout/scrolls.js';
import {SearchSession} from './searchSession.js';
import {bindReducedMotion} from './widgets/a11y.js';
import type {TileHost} from './widgets/appTile.js';
import type {FolderHost} from './widgets/folderTile.js';
import {PointerHighlight} from './widgets/highlight.js';
import type {ResultHost} from './widgets/resultList.js';
import {SearchBox} from './widgets/searchBox.js';
import type {ShortcutHost} from './widgets/shortcutRow.js';
import {TooltipManager} from './widgets/tooltip.js';
import {applyScrollSettings, launchApp, lookupApp} from './util.js';

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
    private readonly _nav: Navigator;
    private readonly _keys: KeyRouter;
    private readonly _search: SearchBox;
    private readonly _tooltips: TooltipManager;
    private readonly _context: AppContextMenu;
    private readonly _highlight: PointerHighlight;

    // right pane (rebuilt as a unit)
    private readonly _rightPane: RightPane;

    // lazily built views
    private readonly _pinned: PinnedView;
    private readonly _frequent: FrequentView;
    private readonly _folders: FolderController;
    private readonly _views: ViewManager;
    private readonly _searchCtl: SearchController;

    // state
    private readonly _state = new LayoutState();
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
            host: {close: () => this._host.close(), openAllApps: () => this._views.openAllApps()},
        });
        this._folders = new FolderController(scope, services, this._state, {
            root: this.actor,
            tileHost: this._tileHost,
            metrics: this._metrics,
            context: this._context,
            host: {
                setView: view => this._views.setView(view),
                back: () => this._views.back(),
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
                setView: view => this._views.setView(view),
                defaultView: () => this._views.defaultView(),
                focusMain: last => this._nav.focusMain(last),
                cyclePane: delta => this._nav.cyclePane(delta),
            },
        });
        this._nav = new Navigator(this._state, {
            mainGroups: () => this._views.mainGroups(),
            categoryGroup: () => this._views.categoryGroup(),
            linksGroup: () => this._leftPane.linksGroup(),
            linksTop: () => this._leftPane.links?.location === 'Top',
            navGroup: () => this._leftPane.navGroup(),
            undoGroup: () => this._undoGroup(),
            searchGroup: () => this._searchGroup(),
            rightGroups: () => this._rightPane.groups(),
            placeStep: (dir, focus) => this._rightPane.placeStep(dir, focus),
            selectedResult: () => this._searchCtl.results?.selected() ?? null,
        });
        this._undo = new UndoController(scope, services, this._state, {
            focusMain: () => this._nav.focusMain(),
            syncPinned: () => this._pinned.syncIfNeeded(),
            pinnedTile: key => this._pinned.tileWidget(key),
        });
        this._keys = new KeyRouter(scope, services, this._state, {
            root: this.actor,
            search: this._search,
            highlight: this._highlight,
            nav: this._nav,
            undo: this._undo,
            pinned: this._pinned,
            folders: this._folders,
            results: () => this._searchCtl.results,
            tooltips: this._tooltips,
            context: this._context,
        });
        this._leftPane = new LeftPane(scope, services, this._state, {
            left: this._left,
            search: this._search.actor,
            banner: this._undo.banner.actor,
            tooltips: this._tooltips,
            metrics: this._metrics,
            host: {
                canGoBack: () => this._views.canGoBack(),
                setView: view => this._views.setView(view),
                focusMain: () => this._nav.focusMain(),
                back: () => this._views.back(),
                openAllApps: () => this._views.openAllApps(),
                arranged: top => this._searchCtl.results?.setReversed(!top),
            },
        });
        this._views = new ViewManager(scope, services, this._state, {
            search: this._search,
            tooltips: this._tooltips,
            tileHost: this._tileHost,
            scrolls: this._scrollFactory,
            pinned: this._pinned,
            frequent: this._frequent,
            folders: this._folders,
            searchCtl: this._searchCtl,
            leftPane: this._leftPane,
            nav: this._nav,
            host: {close: () => this._host.close()},
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
        this.actor.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => this._keys.onKeyPress(event));
        this.actor.connect('button-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            if (event.get_button() === 8 && this._views.canGoBack()) {
                this._views.back();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        scope.connect(global.stage, 'notify::key-focus', () => this._keys.onFocusChanged());

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
        this._views.openAllApps();
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
            this._views.setView(this._views.defaultView());
            for (const s of [this._pinned.scroll, this._frequent.scroll, this._views.extraScroll, this._searchCtl.scroll, this._rightPane.scroll])
                s?.vadjustment.set_value(0);
            this._search.actor.visible = !this._services.settings.get('search-hidden');
            if (this._search.actor.visible)
                this._search.focus();
            else
                this._nav.focusMain();
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
            this._views.setView(this._views.defaultView());
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
        if (this._views.canGoBack()) {
            this._views.back();
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
            this._views.setView(this._views.defaultView());
            return;
        }
        if (id === 'results') {
            this._views.setView('results');
            return;
        }
        if (['pinned', 'frequent', 'categories', 'all', 'favorites', 'recent'].includes(id))
            this._views.setView(id as ViewId);
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
        return layoutDebugState({
            state: this._state, root: this.actor, left: this._left, right: this._right, search: this._search,
            views: this._views, searchCtl: this._searchCtl, pinned: this._pinned, folders: this._folders,
            metrics: this._metrics, leftPane: this._leftPane, rightPane: this._rightPane, undo: this._undo,
            tooltips: this._tooltips, highlight: this._highlight, nav: this._nav,
        });
    }

    // ---- sizes ----


    private _relayout(): void {
        if (this._state.destroyed)
            return;
        this._metrics.apply();
        this._leftPane.arrange();
        this._pinned.dirty = true;
        if (this._state.isOpen)
            this._views.setView(this._state.view);
        // List <-> grid (or a new column count) changes the folder contents too.
        if (this._state.view === 'folder')
            this._folders.view?.refresh();
    }

    /** Settings that are read once when a view is built: re-apply scrolling, rebuild the lists. */
    private _onViewSettings(): void {
        if (this._state.destroyed)
            return;
        this._views.categories?.refresh();
        this._leftPane.syncLinks();
        this._pinned.dirty = true;
        if (this._state.isOpen)
            this._views.setView(this._state.view);
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
            this._views.categories?.appScroll(), this._views.categories?.columnScroll(), this._folders.view?.scroll,
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

    // ---- keyboard groups (the Navigator's sources) ----

    private _undoGroup(): Group | null {
        return this._undo.banner.visible ? {id: 'undo', items: [this._undo.banner.button], cols: 1} : null;
    }

    private _searchGroup(): Group | null {
        return this._search.actor.visible ? {id: 'search', items: [this._search.actor.clutter_text], cols: 1} : null;
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
}

// SpawnLayout: the two-pane "spawn" layout (ArcMenu's "arcmenu" layout, see
// docs/research/layout.md).
//
// Responsibility: build the whole menu content as ONE St actor (`layout.actor`) that SpawnPopup
// places inside its popup. Left pane: search entry (top or bottom), the main view (pinned grid /
// all apps by category / frequent / folder / search results), Back and All Apps buttons. Right
// pane: avatar, directory + application shortcuts, power bar. Only cheap chrome is built up
// front; each view is created the first time it is shown.
//
// Public API:
//   new SpawnLayout(scope, services, host)
//   layout.actor: St.Widget            content root (class "spawn-menu-layout")
//   layout.onOpen(): void              menu is about to be shown (reset view, focus search)
//   layout.onClosed(): void            menu was hidden (clear search, release caches)
//   layout.handleKey(event): boolean   Escape routing: true when the layout consumed the key
//   layout.search(query): void         put `query` in the search entry (dev / D-Bus hook)
//   layout.showView(id): void          'pinned' | 'frequent' | 'categories' | 'all' | 'results' | 'default'
//   layout.debugState(): object        view, focus, counts (dev hook)
//   LayoutHost                         what the layout may ask of the popup:
//                                      {close(), openFolder?(uuid), renameFolder?(uuid)}

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import type Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ShortcutId} from '../core/constants.js';
import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {Entry} from '../core/settings.js';
import type {PinnedItem} from '../model/pinned.js';
import type {SearchHandle, SearchResult} from '../search/engine.js';
import {AppContextMenu} from './contextMenu.js';
import {acceptDrops, enableDrag} from './dnd.js';
import {AppRow} from './widgets/appRow.js';
import {ActionTile, AppTile, DEFAULT_TILE_ICON_SIZE, type TileHost} from './widgets/appTile.js';
import {CategoryList} from './widgets/categoryList.js';
import {FolderTile, type FolderHost} from './widgets/folderTile.js';
import {FolderView} from './widgets/folderView.js';
import {makeItemButton, wireItem} from './widgets/interact.js';
import {PowerBar} from './widgets/powerBar.js';
import {ResultList, type ResultHost} from './widgets/resultList.js';
import {SearchBox} from './widgets/searchBox.js';
import {ShortcutRow, type ShortcutHost} from './widgets/shortcutRow.js';
import {TileGrid} from './widgets/tileGrid.js';
import {TooltipManager} from './widgets/tooltip.js';
import {UserCard} from './widgets/userCard.js';
import {iconSizeFor, launchApp, lookupApp, ownedScope, scrollIntoView} from './util.js';

export interface LayoutHost {
    /** Close the popup (e.g. after launching an app). */
    close(): void;
    /** Open a pinned folder (used by the folder context menu). */
    openFolder?(uuid: string): void;
    /** Open a pinned folder and start renaming it. */
    renameFolder?(uuid: string): void;
}

export type ViewId = 'pinned' | 'frequent' | 'categories' | 'all' | 'folder' | 'results';

const MIN_LEFT_WIDTH = 420;
const MIN_COLUMNS = 3;
const TILE_TARGET_WIDTH = 88;
/** Horizontal space used by the left pane's own padding and the scrollbar gutter. */
const LEFT_CHROME = 28;

const RELAYOUT_KEYS = [
    'menu-height', 'menu-width-adjustment', 'left-panel-width', 'right-panel-width',
    'icon-size-grid', 'default-menu-view', 'vert-separator', 'search-entry-location', 'search-hidden',
] as const;

const RIGHT_KEYS = [
    'directory-shortcuts', 'application-shortcuts', 'icon-size-shortcuts', 'icon-style-shortcuts',
    'right-panel-width', 'show-user-avatar',
] as const;

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
    folder?: FolderTile;
}

function isDefaultViewPinnedish(view: string): boolean {
    return view === 'Pinned_Apps' || view === 'Frequent_Apps' || view === 'Pinned_And_Frequent_Apps';
}

export class SpawnLayout implements ShortcutHost {
    readonly actor: St.BoxLayout;

    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _host: LayoutHost;

    // chrome
    private readonly _left: St.BoxLayout;
    private readonly _right: St.BoxLayout;
    private readonly _vsep: St.Widget;
    private readonly _stack: St.BoxLayout;
    private readonly _nav: St.BoxLayout;
    private readonly _backButton: St.Button;
    private readonly _allAppsButton: St.Button;
    private readonly _search: SearchBox;
    private readonly _tooltips: TooltipManager;
    private readonly _context: AppContextMenu;

    // right pane (rebuilt as a unit)
    private _rightScope: Scope;
    private _userCard: UserCard | null = null;
    private _shortcutRows: ShortcutRow[] = [];
    private _powerBar: PowerBar | null = null;

    // lazily built views
    private _pinnedScroll: St.ScrollView | null = null;
    private _pinnedBox: St.BoxLayout | null = null;
    private readonly _grid = new TileGrid();
    private _frequentBox: St.BoxLayout | null = null;
    private _frequentScroll: St.ScrollView | null = null;
    private _categories: CategoryList | null = null;
    private _folderView: FolderView | null = null;
    private _resultsScroll: St.ScrollView | null = null;
    private _results: ResultList | null = null;
    private readonly _tileEntries = new Map<string, TileEntry>();
    private _pinnedDirty = true;
    private _pinnedSubscribed = false;

    // state
    private _view: ViewId = 'pinned';
    private _isOpen = false;
    private _searchHandle: SearchHandle | null = null;
    private _searchToken = 0;
    private _cols = 4;
    private _tileWidth = 96;
    private _tileIconSize = DEFAULT_TILE_ICON_SIZE;
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
        this._context = new AppContextMenu(scope, services, host);

        this.actor = new St.BoxLayout({
            style_class: 'spawn-menu-layout',
            orientation: Clutter.Orientation.HORIZONTAL,
            reactive: true,
        });

        // Registered FIRST so it runs LAST (LIFO): every widget scope is torn down while its
        // actors are still alive, then the root actor takes the remaining children with it.
        scope.add(() => {
            this._destroyed = true;
            this._searchHandle?.cancel();
            this.actor.destroy();
        }, 'SpawnLayout actor');

        this._left = new St.BoxLayout({style_class: 'spawn-menu-left-pane', orientation: Clutter.Orientation.VERTICAL, y_expand: true});
        this._vsep = new St.Widget({style_class: 'spawn-menu-vseparator', y_expand: true});
        this._right = new St.BoxLayout({style_class: 'spawn-menu-right-pane', orientation: Clutter.Orientation.VERTICAL, y_expand: true});
        this.actor.add_child(this._left);
        this.actor.add_child(this._vsep);
        this.actor.add_child(this._right);

        this._search = new SearchBox(scope, settings);
        this._stack = new St.BoxLayout({style_class: 'spawn-menu-stack', orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});

        this._nav = new St.BoxLayout({style_class: 'spawn-menu-nav'});
        this._backButton = this._navButton('go-previous-symbolic', 'Back', () => this._back());
        this._allAppsButton = this._navButton('view-app-grid-symbolic', 'All Apps', () => this._openAllApps());
        this._nav.add_child(this._backButton);
        this._nav.add_child(this._allAppsButton);

        this._rightScope = scope.child('right pane');
        this._arrangeLeft();
        this._buildRight();
        this._applyMetrics();

        // search wiring
        this._search.onTextChanged(scope, text => this._onSearchText(text));
        this._search.onActivate(scope, () => {
            if (this._view === 'results')
                this._results?.activateFirst();
        });
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

    }

    // ---- ShortcutHost / hosts ----

    close(): void {
        this._host.close();
    }

    showAllApps(): void {
        this._openAllApps();
    }

    // ---- public hooks ----

    onOpen(): void {
        if (this._destroyed)
            return;
        this._isOpen = true;
        try {
            this._context.close();
            this._search.setSilently('');
            this._cancelSearch();
            this._applyMetrics();
            this._setView(this._defaultView());
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
            this._context.close();
            this._tooltips.hide();
            this._cancelSearch();
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
            this._focusMain();
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
        if (['pinned', 'frequent', 'categories', 'all'].includes(id))
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
        const focusName = focus ? `${focus.constructor.name}.${(focus as St.Widget).style_class ?? ''}` : null;
        return {
            view: this._view,
            default: this._defaultView(),
            open: this._isOpen,
            search: this._search.text,
            focus: focusName,
            focusInLayout: Boolean(focus && this.actor.contains(focus)),
            tiles: this._grid.tiles().length,
            folder: this._view === 'folder' ? this._folderView?.uuid ?? null : null,
            folderTiles: this._view === 'folder' ? this._folderView?.tiles().length ?? 0 : 0,
            results: this._results?.rows().length ?? 0,
            tooltip: this._tooltips.debugText(),
            columns: this._cols,
            size: [this.actor.width, this.actor.height],
        };
    }

    // ---- sizes ----

    private _leftWidth(): number {
        const s = this._services.settings;
        return Math.max(MIN_LEFT_WIDTH, s.get('left-panel-width') + s.get('menu-width-adjustment'));
    }

    private _applyMetrics(): void {
        const s = this._services.settings;
        const left = this._leftWidth();
        const right = Math.max(180, s.get('right-panel-width'));
        const sep = s.get('vert-separator');
        const monitor = Main.layoutManager.primaryMonitor;
        const maxH = monitor ? monitor.height - 120 : 800;
        const height = Math.max(360, Math.min(s.get('menu-height'), maxH));

        this._left.set_width(left);
        this._right.set_width(right);
        this._vsep.visible = sep;
        this.actor.set_height(height);

        const avail = left - LEFT_CHROME;
        this._cols = Math.max(MIN_COLUMNS, Math.floor(avail / TILE_TARGET_WIDTH));
        this._tileWidth = Math.floor(avail / this._cols);
        const grid = s.get('icon-size-grid');
        const size = grid?.size ?? -1;
        this._tileIconSize = size > 0 ? size : DEFAULT_TILE_ICON_SIZE;
    }

    private _relayout(): void {
        if (this._destroyed)
            return;
        this._applyMetrics();
        this._arrangeLeft();
        this._pinnedDirty = true;
        if (this._isOpen)
            this._setView(this._view);
    }

    // ---- chrome ----

    private _navButton(iconName: string, text: string, cb: () => void): St.Button {
        const button = makeItemButton('spawn-menu-nav-button');
        button.x_expand = false;
        const box = new St.BoxLayout({style_class: 'spawn-menu-row-box'});
        box.add_child(new St.Icon({icon_name: iconName, icon_size: 16, y_align: Clutter.ActorAlign.CENTER}));
        box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
        button.set_child(box);
        wireItem(button, {activate: () => cb()});
        return button;
    }

    /** (Re)order the left pane children: search, stack, nav according to settings. */
    private _arrangeLeft(): void {
        const top = this._services.settings.get('search-entry-location') === 'Top';
        for (const c of [this._search.actor, this._stack, this._nav]) {
            if (c.get_parent() === this._left)
                this._left.remove_child(c);
        }
        this._search.actor.remove_style_class_name('spawn-menu-search-top');
        this._search.actor.remove_style_class_name('spawn-menu-search-bottom');
        if (top) {
            this._search.actor.add_style_class_name('spawn-menu-search-top');
            this._left.add_child(this._search.actor);
            this._left.add_child(this._stack);
            this._left.add_child(this._nav);
        } else {
            this._search.actor.add_style_class_name('spawn-menu-search-bottom');
            this._left.add_child(this._stack);
            this._left.add_child(this._nav);
            this._left.add_child(this._search.actor);
        }
    }

    private _buildRight(): void {
        if (this._destroyed)
            return;
        this._tooltips.hide();
        this._rightScope.dispose();
        this._userCard = null;
        this._shortcutRows = [];
        this._powerBar = null;
        for (const c of this._right.get_children())
            c.destroy();

        const s = this._services.settings;
        const scope = this._rightScope;
        const hostWithTips: ShortcutHost = {close: () => this.close(), showAllApps: () => this.showAllApps(), tooltips: this._tooltips};

        this._userCard = new UserCard(scope, s, hostWithTips);
        this._right.add_child(this._userCard.actor);

        const shortcutsBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-menu-shortcuts-box'});
        const scroll = this._makeScroll(shortcutsBox, 'spawn-menu-shortcuts');
        const iconSize = iconSizeFor(s, 'icon-size-shortcuts', 16);
        const symbolic = s.get('icon-style-shortcuts') === 'Symbolic';

        const dirs = s.get('directory-shortcuts');
        const apps = s.get('application-shortcuts');
        const list: Entry[] = [...dirs];
        if (dirs.length > 0 && apps.length > 0)
            list.push({id: ShortcutId.SEPARATOR});
        list.push(...apps);

        let lastWasSeparator = true;
        for (const entry of list) {
            const row = new ShortcutRow(entry, hostWithTips, {iconSize, symbolic, scope});
            if (row.isSeparator) {
                if (lastWasSeparator) {
                    row.destroy();
                    continue;
                }
                lastWasSeparator = true;
            } else {
                if (!ShortcutRow.resolve(entry)) {
                    row.destroy();
                    continue;
                }
                lastWasSeparator = false;
            }
            this._shortcutRows.push(row);
            shortcutsBox.add_child(row.actor);
        }
        const last = this._shortcutRows[this._shortcutRows.length - 1];
        if (last?.isSeparator) {
            last.destroy();
            this._shortcutRows.pop();
        }
        this._right.add_child(scroll);

        this._powerBar = new PowerBar(scope, s, hostWithTips);
        this._right.add_child(this._powerBar.actor);
    }

    private _makeScroll(child: St.Widget, styleClass: string): St.ScrollView {
        const settings = this._services.settings;
        const scroll = new St.ScrollView({
            style_class: `${styleClass}${settings.get('scrollview-fade-effect') ? ' vfade' : ''}`,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: settings.get('scrollbars-visible') ? St.PolicyType.AUTOMATIC : St.PolicyType.EXTERNAL,
            overlay_scrollbars: settings.get('scrollbars-overlay'),
            x_expand: true,
            y_expand: true,
        });
        scroll.add_child(child);
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
        this._setView(this._defaultView());
        if (this._isOpen)
            this._search.focus();
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
        const actors = this._ensureView(view);
        this._view = view;
        for (const child of this._stack.get_children())
            child.visible = actors.includes(child);
        this._updateNav();
        if (view === 'folder' || view === 'pinned')
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
                this._frequentBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-menu-list'});
                this._frequentScroll = this._makeScroll(this._frequentBox, 'spawn-menu-frequent');
            }
            this._fillFrequent(this._frequentBox as St.BoxLayout, 0);
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
        case 'folder': {
            const fv = this._ensureFolderView();
            return [add(fv.actor)];
        }
        case 'results': {
            if (!this._resultsScroll) {
                this._results = new ResultList(this._scope, this._services.settings, this._resultHost);
                this._resultsScroll = this._makeScroll(this._results.actor, 'spawn-menu-results');
            }
            return [add(this._resultsScroll)];
        }
        }
    }

    private _ensurePinned(): St.ScrollView {
        if (!this._pinnedScroll) {
            this._pinnedBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-menu-pinned-box'});
            this._pinnedBox.add_child(new St.Label({text: 'Pinned', style_class: 'spawn-menu-section-title'}));
            this._pinnedBox.add_child(this._grid.actor);
            this._pinnedScroll = this._makeScroll(this._pinnedBox, 'spawn-menu-pinned');
            acceptDrops(this._scope, this._pinnedScroll, this._services.pinned, {kind: 'grid', index: () => -1});
            if (!this._pinnedSubscribed) {
                this._pinnedSubscribed = true;
                this._services.pinned.onChanged(this._scope, () => {
                    this._pinnedDirty = true;
                    if (this._isOpen && this._view === 'pinned')
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
                metrics: () => ({columns: this._cols, tileWidth: this._tileWidth, iconSize: this._tileIconSize}),
            });
        }
        return this._folderView;
    }

    private _tileHostWithTips(): TileHost {
        return this._tileHost;
    }

    private _fillFrequent(box: St.BoxLayout, limitOverride: number): void {
        this._tooltips.hide();
        for (const c of box.get_children())
            c.destroy();
        const s = this._services.settings;
        const limit = limitOverride > 0 ? limitOverride : Math.max(0, s.get('max-frequent-apps'));
        const opts = {iconSize: iconSizeFor(s, 'icon-size-apps', 28), description: s.get('apps-show-extra-details')};
        const apps = this._services.appIndex.frequent(limit);
        for (const app of apps)
            box.add_child(new AppRow(app, this._tileHostWithTips(), opts).actor);
        if (apps.length === 0)
            box.add_child(new St.Label({text: 'Nothing here yet', style_class: 'spawn-menu-empty-label', x_align: Clutter.ActorAlign.CENTER}));
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
        section.add_child(new St.Widget({style_class: 'spawn-menu-separator', x_expand: true}));
        section.add_child(new St.Label({text: 'Frequent', style_class: 'spawn-menu-section-title'}));
        const rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        section.add_child(rows);
        this._fillFrequent(rows, Math.max(1, this._services.settings.get('max-frequent-apps')) || 8);
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

    private _syncPinned(): void {
        this._tooltips.hide();
        const store = this._services.pinned;
        const keep = new Set<string>();
        const tiles: St.Widget[] = [];

        const make = (item: PinnedItem): {key: string; entry: TileEntry} | null => {
            switch (item.kind) {
            case 'app': {
                const key = `a:${item.id}`;
                const existing = this._tileEntries.get(key);
                if (existing)
                    return {key, entry: existing};
                const app = lookupApp(this._services, item.id);
                if (!app)
                    return null;
                const {scope, release} = ownedScope(this._scope, key);
                const tile = new AppTile(app, this._tileHostWithTips(), {iconSize: this._tileIconSize});
                enableDrag(scope, tile.actor, {id: item.id});
                acceptDrops(scope, tile.actor, store, {kind: 'app', id: item.id});
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
                const tile = new FolderTile(item.uuid, item.name, this._folderIcons(item.uuid),
                    this._folderHost, {iconSize: this._tileIconSize});
                enableDrag(scope, tile.actor, {id: item.uuid, isFolder: true});
                acceptDrops(scope, tile.actor, store, {kind: 'folder', uuid: item.uuid});
                return {key, entry: {widget: tile.actor, scope, release, folder: tile}};
            }
            case 'custom': {
                const key = `c:${item.entry.id}`;
                const existing = this._tileEntries.get(key);
                if (existing)
                    return {key, entry: existing};
                const {scope, release} = ownedScope(this._scope, key);
                const id = item.entry.id;
                const tile = new ActionTile(item.entry.name || id, item.entry.icon || 'application-x-executable',
                    () => this._runCustom(id), {tooltips: this._tooltips}, {iconSize: this._tileIconSize});
                enableDrag(scope, tile.actor, {id});
                acceptDrops(scope, tile.actor, store, {kind: 'app', id});
                return {key, entry: {widget: tile.actor, scope, release}};
            }
            }
        };

        for (const item of store.items()) {
            const made = make(item);
            if (!made)
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
        this._grid.setTiles(tiles, this._cols, this._tileWidth);
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
        fv.show(uuid);
        this._setView('folder');
        const first = fv.tiles()[0];
        if (this._isOpen)
            (first ?? fv.headerButtons()[0]).grab_key_focus();
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
        if (query.length === 0) {
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
        results.reset();
        results.setSelectionVisible(true);
        const token = this._searchToken;
        try {
            this._searchHandle = this._services.search.search(query, batch => {
                if (token !== this._searchToken || this._destroyed)
                    return;
                results.addBatch(batch);
            });
        } catch (e) {
            error('search failed', e);
        }
    }

    private _onSearchKey(key: number, shift: boolean): boolean {
        switch (key) {
        case Clutter.KEY_Down:
            this._focusMain();
            return true;
        case Clutter.KEY_Up:
            if (this._services.settings.get('search-entry-location') === 'Bottom')
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
        const dv = this._services.settings.get('default-menu-view');
        const back = this._canGoBack();
        this._backButton.visible = back;
        this._allAppsButton.visible = !back && isDefaultViewPinnedish(dv);
        this._nav.visible = this._backButton.visible || this._allAppsButton.visible;
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
                const rows = this._frequentSection.get_children()[2]?.get_children() ?? [];
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
                {id: 'folder', items: fv.tiles(), cols: this._cols},
            ];
        }
        case 'results':
            return [{id: 'results', items: this._results?.rows() ?? [], cols: 1}];
        }
    }

    private _categoryGroup(): Group | null {
        if (this._view !== 'categories' || !this._categories)
            return null;
        return {id: 'categories', items: this._categories.categoryButtons(), cols: 1};
    }

    private _navGroup(): Group | null {
        const items = [this._backButton, this._allAppsButton].filter(b => b.visible && this._nav.visible);
        return items.length ? {id: 'nav', items, cols: items.length} : null;
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
        const out: Group[] = [];
        const search = this._searchGroup();
        const top = this._services.settings.get('search-entry-location') === 'Top';
        if (search && top)
            out.push(search);
        out.push(...this._mainGroups().filter(g => g.items.length > 0));
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
        if (groups.length === 0) {
            this._focusItem(this._navGroup() ?? undefined);
            return;
        }
        this._focusItem(last ? groups[groups.length - 1] : groups[0], last ? 'last' : 'first');
    }

    private _move(dir: Dir): boolean {
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const leftCol = this._leftColumn();
        const rightCol = this._rightGroups().filter(g => g.items.length > 0);
        const cats = this._categoryGroup();

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
                    const target = group.id === 'power' ? (this._navGroup() ?? leftCol.filter(g => g.id !== 'search').pop()) : leftCol.find(g => g.id !== 'search');
                    return this._focusItem(target, 'first');
                }
                return true;
            }
            if (delta > 0)
                return this._focusItem(rightCol[Math.min(groupIdx, rightCol.length - 1)] ?? rightCol[0], 'first');
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
        const panes: Array<() => boolean> = [];
        const search = this._searchGroup();
        const cats = this._categoryGroup();
        const main = this._mainGroups().filter(g => g.items.length > 0);
        const nav = this._navGroup();
        const right = this._rightGroups().filter(g => g.items.length > 0);
        const focus = global.stage.key_focus as Clutter.Actor | null;
        const top = this._services.settings.get('search-entry-location') === 'Top';

        const add = (g: Group | null | undefined, which: 'first' | 'last' = 'first') => {
            if (g && g.items.length)
                panes.push(() => this._focusItem(g, which));
        };
        if (search && top)
            add(search);
        add(cats, 'first');
        for (const g of main)
            add(g);
        add(nav);
        if (search && !top)
            add(search);
        for (const g of right)
            add(g);

        // Which pane holds the focus?
        const all: Array<Group | null> = [search && top ? search : null, cats, ...main, nav, search && !top ? search : null, ...right];
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
            this._scope.idle(() => {
                if (this._isOpen && !this._destroyed && !global.stage.key_focus && !this._context.isOpen) {
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

// ViewManager: which view the left pane shows.
//
// Responsibility: the view switch (`setView`: build the view the first time, show it and hide the others in
// the left pane's stack, or open the folder popup over the current view), the start view from
// `default-menu-view`, Back (leave a search, close a folder popup, return to the start view), the All Apps
// button's target, the views that are only a few lines (the category list, Favorites / Recent Files), and the
// keyboard groups of whichever view shows. The heavier views are their own modules (PinnedView, FrequentView,
// SearchController, FolderController).
//
// Public API:
//   new ViewManager(scope, services, state, deps)
//   views.defaultView(): ViewId      the start view for the current settings
//   views.canGoBack(): boolean       a view other than the start view shows, or a query is typed
//   views.back(toStart = false)      Escape / Back / the mouse back button (Grid: a category goes back to All apps first,
//                                    unless `toStart`: the header's "Pinned" pill)
//   views.openAllApps()              the All Apps button (`all-apps-button-action`)
//   views.setView(view)              switch view ('folder' = the popup over the current one)
//   views.mainGroups() / categoryGroup()   keyboard groups of the shown view / of its category column
//   views.categories / extraList / extraScroll   the views built here (null until first shown)
//   views.gridApps                   the Grid layout's All apps (layout/gridApps.ts; replaces the category list there)
//   views.closeOverlay(): boolean    Escape: close the Grid All apps' letter picker / category menu, true when one was open

import type Clutter from 'gi://Clutter';
import type St from 'gi://St';

import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {isPointerEvent} from '../util.js';
import {CategoryList} from '../widgets/categoryList.js';
import {ExtraList} from '../widgets/extraList.js';
import type {TileHost} from '../widgets/appTile.js';
import type {SearchBox} from '../widgets/searchBox.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import {GridAllApps} from './gridApps.js';
import type {FolderController} from './folders.js';
import type {FrequentView} from './frequentView.js';
import type {GridHeader} from './gridChrome.js';
import type {LeftPane} from './leftPane.js';
import type {PaneMetrics} from './metrics.js';
import type {Navigator} from './navigation.js';
import type {PinnedView} from './pinnedView.js';
import type {ScrollFactory} from './scrolls.js';
import type {SearchController} from './searchView.js';
import type {Group, LayoutState, ViewId} from './types.js';

export interface ViewManagerDeps {
    search: SearchBox;
    tooltips: TooltipManager;
    tileHost: TileHost;
    scrolls: ScrollFactory;
    pinned: PinnedView;
    frequent: FrequentView;
    folders: FolderController;
    searchCtl: SearchController;
    leftPane: LeftPane;
    nav: Navigator;
    metrics: PaneMetrics;
    /** The Grid layout's header: its title follows the category of All apps. */
    header: GridHeader;
    host: {
        /** Close the popup. */
        close(): void;
    };
}

export class ViewManager {
    categories: CategoryList | null = null;
    gridApps: GridAllApps | null = null;
    extraList: ExtraList | null = null;
    extraScroll: St.ScrollView | null = null;
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _search: SearchBox;
    private readonly _tooltips: TooltipManager;
    private readonly _tileHost: TileHost;
    private readonly _scrolls: ScrollFactory;
    private readonly _pinned: PinnedView;
    private readonly _frequent: FrequentView;
    private readonly _folders: FolderController;
    private readonly _searchCtl: SearchController;
    private readonly _leftPane: LeftPane;
    private readonly _nav: Navigator;
    private readonly _metrics: PaneMetrics;
    private readonly _header: GridHeader;
    private readonly _host: ViewManagerDeps['host'];

    constructor(scope: Scope, services: Services, state: LayoutState, deps: ViewManagerDeps) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._search = deps.search;
        this._tooltips = deps.tooltips;
        this._tileHost = deps.tileHost;
        this._scrolls = deps.scrolls;
        this._pinned = deps.pinned;
        this._frequent = deps.frequent;
        this._folders = deps.folders;
        this._searchCtl = deps.searchCtl;
        this._leftPane = deps.leftPane;
        this._nav = deps.nav;
        this._metrics = deps.metrics;
        this._header = deps.header;
        this._host = deps.host;
    }

    defaultView(): ViewId {
        // Grid layout: always the pinned grid (its header's pill opens All Apps).
        if (this._services.settings.get('layout-style') === 'Grid')
            return 'pinned';
        switch (this._services.settings.get('default-menu-view')) {
        case 'Categories_List': return 'categories';
        case 'Frequent_Apps': return 'frequent';
        case 'All_Programs': return 'all';
        default: return 'pinned';
        }
    }

    canGoBack(): boolean {
        return this._state.view !== this.defaultView() || this._search.text.length > 0;
    }

    back(toStart = false): void {
        if (this._search.text.length > 0) {
            this._search.clear();
            return;
        }
        // Grid: a category of All apps goes back to All apps first (the header's pill goes straight to Pinned).
        const all = this.gridApps;
        if (!toStart && this._state.view === 'all' && all && all.category !== 'all' && this._metrics.grid) {
            all.show('all');
            if (this._state.isOpen) {
                if (this._search.actor.visible)
                    this._search.focus();
                else
                    this._nav.focusMain();
            }
            return;
        }
        const pointer = isPointerEvent();
        const folder = this._state.view === 'folder' ? this._folders.view?.uuid ?? null : null;
        // Closing a folder popup returns to the view it was opened over (e.g. Pinned reached by a quick link).
        this.setView(this._state.view === 'folder' ? this._state.underFolder : this.defaultView());
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
                this._nav.focusMain();
        }
    }

    openAllApps(): void {
        const s = this._services.settings;
        // Grid layout: the icon grid, its categories are a menu in the header (one column has no room for a column of them).
        const all = s.get('layout-style') === 'Grid' || s.get('all-apps-button-action') === 'All_Programs';
        this.setView(all ? 'all' : 'categories');
        this._nav.focusMain();
    }

    setView(view: ViewId): void {
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
            if (this._metrics.grid && view === 'all') {
                const grid = this._ensureGridApps();
                add(grid.actor);
                grid.show('all');
                return [grid.actor];
            }
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
            if (!this.extraList || !this.extraScroll) {
                this.extraList = new ExtraList(this._services, {
                    ...this._tileHost,
                    close: () => this._host.close(),
                    // recent files that arrived late: the focus moves to them as the view would have done
                    rowsChanged: () => {
                        const focus = global.stage.key_focus as Clutter.Actor | null;
                        if (this._state.isOpen && this._state.view === 'recent' && (!focus || this._leftPane.navGroup()?.items.includes(focus)))
                            this._nav.focusMain();
                    },
                });
                this.extraScroll = this._scrolls.make(this.extraList.actor, 'spawn-frequent');
            }
            this.extraList.show(view);
            return [add(this.extraScroll)];
        }
        case 'results':
            return [add(this._searchCtl.ensure())];
        }
    }

    private _ensureGridApps(): GridAllApps {
        if (!this.gridApps) {
            this.gridApps = new GridAllApps(this._scope.child('grid apps'), this._services, {
                tileHost: this._tileHost,
                tooltips: this._tooltips,
                metrics: this._metrics,
                scrolls: this._scrolls,
                titleButton: this._header.titleButton,
                host: {titleChanged: name => this._header.setCategory(name)},
            });
        }
        return this.gridApps;
    }

    /** Escape: the Grid All apps' letter picker / category menu closes first (focus back on what opened it). */
    closeOverlay(): boolean {
        return this.gridApps?.closeOverlay() ?? false;
    }

    private _ensureCategories(): CategoryList {
        if (!this.categories)
            this.categories = new CategoryList(this._scope.child('categories'), this._services, this._tileHost);
        return this.categories;
    }

    // ---- keyboard groups ----

    mainGroups(): Group[] {
        switch (this._state.view) {
        case 'pinned':
            return this._pinned.groups();
        case 'frequent':
            return [{id: 'frequent', items: this._frequent.rows(), cols: 1}];
        case 'categories':
        case 'all':
            if (this._metrics.grid && this._state.view === 'all' && this.gridApps)
                return [this.gridApps.group()];
            return [{id: 'apps', items: this.categories?.appRows() ?? [], cols: 1}];
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
            return [{id: 'extra', items: this.extraList?.rows() ?? [], cols: 1}];
        case 'results':
            // Rows of a superseded query (stale, dimmed) are never keyboard targets.
            return [{id: 'results', items: this._searchCtl.results?.hasResults ? this._searchCtl.results.visualRows() : [], cols: 1}];
        }
    }

    categoryGroup(): Group | null {
        if (this._state.view !== 'categories' || !this.categories)
            return null;
        return {id: 'categories', items: this.categories.categoryButtons(), cols: 1};
    }
}

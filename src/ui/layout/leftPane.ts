// LeftPane: the chrome of the left pane around the main view.
//
// Responsibility: the vertical order of the search entry, the category quick links, the view stack, the
// Undo banner and the Back / All Apps row (by `search-entry-location` and the links location), the quick
// links themselves (which start-view lists they show, the views they open), and the visibility of Back,
// All Apps and the links for the view that shows.
//
// Public API:
//   new LeftPane(scope, services, state, deps)   deps: {left, search, banner, tooltips, metrics, host}
//   left.stack: St.BoxLayout           the views are children of it (the layout shows one at a time)
//   left.links: CategoryLinks | null   the quick links box (null until a link is enabled)
//   left.arrange()                     (re)order the pane's children; re-resolves where the entry sits
//   left.searchOnTop(): boolean        where the entry should sit now (`Auto` follows the popup side)
//   left.syncLinks()                   create / refill the quick links box
//   left.updateNav()                   Back / All Apps / links visibility for the current view
//   left.setPinDrag(on) / isBackTarget(actor) / pinnedViaBack() / gridLayout()   Back (Grid: the header's pill) as the
//                                      "Drop to pin" target of a drag from a list
//   left.linksGroup() / navGroup()     keyboard groups
//   LeftPaneHost                       what the pane asks of the layout (view switching, focus, Back)
//
// Grid layout (`layout-style` Grid, deps.grid): search entry on top, the header ("Pinned" / "All apps" and the
// pill that switches between them), the stack, the page dots, the Undo banner, the footer. No quick links and
// no Back / All Apps row (the header's pill is both).

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CategoryLink} from '../../core/constants.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {acceptDrops} from '../dnd.js';
import {iconSizeFor, iconSizeOrHidden} from '../util.js';
import {nameItem} from '../widgets/a11y.js';
import {CategoryLinks} from '../widgets/categoryLinks.js';
import {makeFace, makeItemButton, wireItem} from '../widgets/interact.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import type {GridHeader, GridPager} from './gridChrome.js';
import type {PaneMetrics} from './metrics.js';
import type {Group, LayoutState, ViewId} from './types.js';

function isDefaultViewPinnedish(view: string): boolean {
    return view === 'Pinned_Apps' || view === 'Frequent_Apps' || view === 'Pinned_And_Frequent_Apps';
}

export interface LeftPaneHost {
    canGoBack(): boolean;
    setView(view: ViewId): void;
    focusMain(): void;
    back(): void;
    openAllApps(): void;
    /** The children were (re)ordered; `top`: the search entry is above the list. */
    arranged(top: boolean): void;
}

export interface LeftPaneDeps {
    /** The pane box the children are arranged in. */
    left: St.BoxLayout;
    /** The search entry's actor and the Undo banner's actor: arranged, not owned. */
    search: St.Widget;
    banner: St.Widget;
    tooltips: TooltipManager;
    metrics: PaneMetrics;
    host: LeftPaneHost;
    /** The Grid layout's chrome, arranged when the Grid layout is on. */
    grid: {header: GridHeader; pager: GridPager; footer: St.Widget};
}

export class LeftPane {
    readonly stack: St.BoxLayout;
    links: CategoryLinks | null = null;
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _left: St.BoxLayout;
    private readonly _search: St.Widget;
    private readonly _banner: St.Widget;
    private readonly _tooltips: TooltipManager;
    private readonly _metrics: PaneMetrics;
    private readonly _host: LeftPaneHost;
    private readonly _grid: LeftPaneDeps['grid'];
    private readonly _nav: St.BoxLayout;
    private readonly _backButton: St.Button;
    private readonly _backLabel: St.Label;
    private readonly _backIcon: St.Icon;
    private readonly _allAppsButton: St.Button;
    private _backDropRegistered = false;

    constructor(scope: Scope, services: Services, state: LayoutState, deps: LeftPaneDeps) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._left = deps.left;
        this._search = deps.search;
        this._banner = deps.banner;
        this._tooltips = deps.tooltips;
        this._metrics = deps.metrics;
        this._host = deps.host;
        this._grid = deps.grid;
        this.stack = new St.BoxLayout({style_class: 'spawn-stack', orientation: Clutter.Orientation.VERTICAL, x_expand: true, y_expand: true});
        this._nav = new St.BoxLayout({style_class: 'spawn-nav'});
        const back = this._navButton('go-previous-symbolic', _('Back'), () => this._host.back());
        this._backButton = back.button;
        this._backLabel = back.label;
        this._backIcon = back.icon;
        this._allAppsButton = this._navButton('view-app-grid-symbolic', _('All Apps'), () => this._host.openAllApps()).button;
        this._nav.add_child(this._backButton);
        this._nav.add_child(this._allAppsButton);
    }

    // ---- chrome ----

    private _navButton(iconName: string, text: string, cb: () => void): {button: St.Button; label: St.Label; icon: St.Icon} {
        // Full pane width like every other row: only one of Back / All Apps shows at a time (updateNav), so the
        // whole row highlights on hover and takes the click, not just the icon + label.
        const button = makeItemButton('spawn-nav-button');
        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const navIcon = new St.Icon({icon_name: iconName, icon_size: iconSizeFor(this._services.settings, 'icon-size-misc', 16), y_align: Clutter.ActorAlign.CENTER});
        // The small icon sits centred in a slot as wide as a list row's icon, so "All Apps" / "Back"
        // start on the same text column as the app names above them.
        navIcon.x_align = Clutter.ActorAlign.CENTER;
        const slot = new St.Bin({child: navIcon, x_expand: false, y_align: Clutter.ActorAlign.CENTER});
        const sync = (): void => {
            navIcon.icon_size = iconSizeFor(this._services.settings, 'icon-size-misc', 16);
            slot.set_style(`width: ${Math.max(navIcon.icon_size, this._metrics.rowIconSize())}px;`); // CSS px: St scales them
        };
        sync();
        this._services.settings.onChanged(this._scope, ['icon-size-misc', 'icon-size-apps', 'pinned-item-size'], sync);
        box.add_child(slot);
        const navLabel = new St.Label({text, y_align: Clutter.ActorAlign.CENTER});
        box.add_child(navLabel);
        nameItem(button, text, {label: navLabel});
        button.set_child(makeFace('spawn-nav-surface', box));
        wireItem(button, {activate: () => cb()});
        return {button, label: navLabel, icon: navIcon};
    }

    /**
     * Search entry on top? `Top` / `Bottom` as set; `Auto` puts it on the side nearest the panel
     * (arrow side TOP = popup below a top panel = entry on top; BOTTOM = popup above = entry below).
     */
    searchOnTop(): boolean {
        if (this._metrics.grid)
            return true;
        const loc = this._services.settings.get('search-entry-location') as string;
        if (loc === 'Auto')
            return this._state.side === St.Side.TOP;
        return loc === 'Top';
    }

    /** (Re)order the left pane children: search, quick links, stack, nav according to settings. */
    arrange(): void {
        const top = this.searchOnTop();
        this._state.searchTop = top;
        this.syncLinks();
        const links = this.links?.actor ?? null;
        const {header, pager, footer} = this._grid;
        const dots = pager.dots;
        for (const c of [this._search, this.stack, this._banner, this._nav, links, header.actor, dots, footer]) {
            if (c && c.get_parent() === this._left)
                this._left.remove_child(c);
        }
        this._search.remove_style_class_name('spawn-search-top');
        this._search.remove_style_class_name('spawn-search-bottom');
        const linksTop = this.links?.location === 'Top';
        const add = (c: St.Widget | null): void => {
            if (c)
                this._left.add_child(c);
        };
        if (this._metrics.grid) {
            this._left.add_style_class_name('spawn-grid-column');
            add(this._search);
            add(header.actor);
            add(this.stack);
            add(dots);
            add(this._banner);
            add(footer);
            this._search.add_style_class_name('spawn-search-top');
            this._host.arranged(true);
            return;
        }
        this._left.remove_style_class_name('spawn-grid-column');
        if (top)
            add(this._search);
        if (linksTop)
            add(links);
        add(this.stack);
        if (!linksTop)
            add(links);
        add(this._banner);
        add(this._nav);
        if (!top)
            add(this._search);
        this._search.add_style_class_name(top ? 'spawn-search-top' : 'spawn-search-bottom');
        // Entry below the list: the best match sits right above it.
        this._host.arranged(top);
    }

    /** The enabled quick links, minus the start view itself and All Apps where its nav button shows (none for the category list). */
    private _linkIds(): number[] {
        const s = this._services.settings;
        const view = s.get('default-menu-view');
        if (view === 'Categories_List' || this._metrics.grid)
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

    /** Create / refill the quick links box (it is parented by arrange()) and show it where it belongs. */
    syncLinks(): void {
        const s = this._services.settings;
        const location = s.get('arcmenu-extra-categories-links-location');
        const ids = this._linkIds();
        if (this.links && this.links.location !== location) {
            this.links.destroy();
            this.links = null;
        }
        if (ids.length === 0) {
            this.links?.setLinks([], 0);
        } else {
            this.links ??= new CategoryLinks({open: id => this._openLink(id), tooltips: this._tooltips}, location);
            this.links.setLinks(ids, iconSizeOrHidden(s, 'icon-size-categories', 16));
        }
        this._updateLinksVisible();
    }

    /** The links belong to the start view only: any other view (or a search) has Back instead. */
    private _updateLinksVisible(): void {
        if (this.links)
            this.links.actor.visible = this.links.buttons().length > 0 && !this._host.canGoBack();
    }

    private _openLink(id: number): void {
        switch (id) {
        case CategoryLink.FAVORITES: this._host.setView('favorites'); break;
        case CategoryLink.FREQUENT: this._host.setView('frequent'); break;
        case CategoryLink.ALL_PROGRAMS: this._host.setView('all'); break;
        case CategoryLink.PINNED: this._host.setView('pinned'); break;
        case CategoryLink.RECENT_FILES: this._host.setView('recent'); break;
        default: return;
        }
        this._host.focusMain();
    }

    // ---- visibility ----

    updateNav(): void {
        // An open folder popup leaves the nav of the view under it alone (no jump behind the scrim).
        if (this._state.view === 'folder')
            return;
        if (this._metrics.grid) {
            const view = this._state.view;
            this._grid.header.setMode(view === 'pinned' ? 'pinned' : view === 'all' ? 'all' : 'hidden');
            this._grid.pager.setShown(view === 'pinned');
            this._nav.visible = false;
            this._updateLinksVisible();
            return;
        }
        this._grid.pager.setShown(false);
        const dv = this._services.settings.get('default-menu-view');
        const back = this._host.canGoBack();
        this._backButton.visible = back;
        this._allAppsButton.visible = !back && isDefaultViewPinnedish(dv);
        this._nav.visible = this._backButton.visible || this._allAppsButton.visible;
        this._updateLinksVisible();
        // dragging out of a folder onto Back removes the app from the folder; an app dragged from a list pins it
        if (!this._backDropRegistered) {
            this._backDropRegistered = true;
            acceptDrops(this._scope, this._backButton, this._services.pinned, {kind: 'back'});
        }
    }

    // ---- drag to pin ----

    /** Is `target` the Back button (Grid: the header's pill) or inside it (the spring-loaded hover target of a drag from a list)? */
    isBackTarget(target: Clutter.Actor | null): boolean {
        if (this._metrics.grid)
            return this._grid.header.isPill(target);
        for (let a = target; a; a = a.get_parent()) {
            if (a === this._backButton)
                return true;
        }
        return false;
    }

    /**
     * An app is dragged out of a list: Back is the way to Pinned, so it turns into a drop target that
     * says so ("Drop to pin"). Reverted when the drag ends.
     */
    setPinDrag(on: boolean): void {
        // Grid: the same on the header's pill (All apps view only; Back is not in the layout).
        this._grid.header.setPinDrag(on && this._metrics.grid);
        this._backLabel.text = on ? _('Drop to pin') : _('Back');
        this._backIcon.icon_name = on ? 'view-pin-symbolic' : 'go-previous-symbolic';
        this._backButton.accessible_name = this._backLabel.text;
        if (on)
            this._backButton.add_style_class_name('spawn-drop-ready');
        else
            this._backButton.remove_style_class_name('spawn-drop-ready');
    }

    /** The Grid layout is on. */
    gridLayout(): boolean {
        return this._metrics.grid;
    }

    /** Can a drag from a list reach Pinned through Back (the start view is a pinned one; in Grid it always is)? */
    pinnedViaBack(): boolean {
        return this._metrics.grid || isDefaultViewPinnedish(this._services.settings.get('default-menu-view'));
    }

    // ---- keyboard ----

    linksGroup(): Group | null {
        const links = this.links;
        return links?.actor.visible && links.buttons().length ? {id: 'links', items: links.buttons(), cols: 1} : null;
    }

    navGroup(): Group | null {
        if (this._metrics.grid)
            return this._grid.header.group();
        const items = [this._backButton, this._allAppsButton].filter(b => b.visible && this._nav.visible);
        return items.length ? {id: 'nav', items, cols: items.length} : null;
    }
}

// Grid start layout chrome: the pieces the "Grid" layout style (`layout-style`) adds around the shared views.
//
// Responsibility: the Grid layout is one column: search entry, a header row, the view stack (the pinned grid
// shows in pages), page dots, and a footer. This module builds the three pieces the classic two-pane layout
// does not have and that the coordinator (ui/layout.ts) and LeftPane arrange:
//   GridHeader   "Pinned" + an "All apps" pill on the start view; in All apps the title is a quiet menu button
//                ("All apps" / the category's name + a pan-down icon, opens the category menu) + a "Pinned" pill;
//                hidden in search results and other views
//   GridFooter   the user card, the folder shortcuts as icon buttons, and the power bar, in one row
//   GridPager    the pinned grid in whole pages: the scroll view shows exactly N rows, the wheel / touchpad and
//                the keyboard move a page at a time, page dots under it (click one to jump); the menu's height is
//                trimmed to the rows that fit, so no half row shows
//
// Public API:
//   isGridLayout(settings): boolean
//   new GridHeader(scope, deps)        deps: {host: {openAllApps(), back(), categories()}}
//     header.actor / header.setMode('pinned' | 'all' | 'hidden') / header.group(): Group | null
//     header.setCategory(name)        the name the All apps title shows ("All apps", or the category)
//     header.titleButton              the All apps title button (focus returns to it when its menu closes)
//   new GridFooter(scope, services, deps)   deps: {host, tooltips, context}
//     footer.actor / footer.build() / footer.group(): Group | null
//   new GridPager(scope, deps)         deps: {stack(), column(), trim(px), enabled(), settings}
//     pager.dots: St.BoxLayout          placed under the view stack by LeftPane
//     pager.attach(scroll, grid)        the pinned scroll view and its grid (once, when the view is first built)
//     pager.setShown(shown)             the pinned view is the one showing (dots visible)
//     pager.reset()                     back to the first page (menu opens)
//     pager.relayout()                  re-measure rows (settings / tiles changed)
//     pager.page / pager.pages / pager.rows   current page, page count, rows per page (0: not paging)

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {Entry, SpawnSettings} from '../../core/settings.js';
import type {AppContextMenu} from '../contextMenu.js';
import {applyScrollSettings, lookupApp} from '../util.js';
import {animationDuration, markToolbar, nameItem} from '../widgets/a11y.js';
import {makeFace, makeItemButton, wireItem} from '../widgets/interact.js';
import {PowerBar} from '../widgets/powerBar.js';
import {resolveShortcut, type ShortcutHost} from '../widgets/shortcutRow.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import {UserCard} from '../widgets/userCard.js';
import type {Group} from './types.js';

export function isGridLayout(settings: SpawnSettings): boolean {
    return settings.get('layout-style') === 'Grid';
}

// ---- header ----

export type GridHeaderMode = 'pinned' | 'all' | 'hidden';

export interface GridHeaderDeps {
    host: {openAllApps(): void; back(): void; categories(): void};
}

export class GridHeader {
    readonly actor: St.BoxLayout;
    /** All apps: the title as a button that opens the category menu. */
    readonly titleButton: St.Button;
    private readonly _title: St.Label;
    private readonly _button: St.Button;
    private readonly _label: St.Label;
    private readonly _before: St.Icon;
    private readonly _after: St.Icon;
    private readonly _categoryLabel: St.Label;
    private _category = _('All apps');
    private _mode: GridHeaderMode = 'pinned';

    constructor(_scope: Scope, deps: GridHeaderDeps) {
        this.actor = new St.BoxLayout({style_class: 'spawn-grid-header', x_expand: true});
        this._title = new St.Label({style_class: 'spawn-grid-title', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this.actor.add_child(this._title);

        // The All apps title: reads as a title, is a button (the pan-down icon says so; hover / focus show the face).
        this.titleButton = makeItemButton('spawn-nav-button spawn-grid-title-button');
        this.titleButton.x_expand = true;
        this.titleButton.x_align = Clutter.ActorAlign.START;
        this.titleButton.y_align = Clutter.ActorAlign.CENTER;
        const titleBox = new St.BoxLayout({style_class: 'spawn-grid-title-box'});
        this._categoryLabel = new St.Label({style_class: 'spawn-grid-title', y_align: Clutter.ActorAlign.CENTER});
        this._categoryLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        titleBox.add_child(this._categoryLabel);
        titleBox.add_child(new St.Icon({icon_name: 'pan-down-symbolic', icon_size: 16, style_class: 'spawn-grid-title-icon', y_align: Clutter.ActorAlign.CENTER}));
        const titleFace = makeFace('spawn-nav-surface spawn-grid-title-face', titleBox);
        titleFace.x_expand = false;
        this.titleButton.set_child(titleFace);
        wireItem(this.titleButton, {activate: () => deps.host.categories()});
        this.actor.add_child(this.titleButton);

        this._button = makeItemButton('spawn-nav-button spawn-grid-header-button');
        this._button.x_expand = false;
        this._button.y_align = Clutter.ActorAlign.CENTER;
        const box = new St.BoxLayout({style_class: 'spawn-grid-pill-box'});
        this._before = new St.Icon({icon_name: 'go-previous-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._after = new St.Icon({icon_name: 'go-next-symbolic', icon_size: 14, y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._before);
        box.add_child(this._label);
        box.add_child(this._after);
        this._button.set_child(makeFace('spawn-nav-surface spawn-grid-pill', box));
        wireItem(this._button, {
            activate: () => {
                if (this._mode === 'pinned')
                    deps.host.openAllApps();
                else
                    deps.host.back();
            },
        });
        this.actor.add_child(this._button);
        this.setMode('pinned');
    }

    setMode(mode: GridHeaderMode): void {
        this._mode = mode;
        this.actor.visible = mode !== 'hidden';
        const pinned = mode === 'pinned';
        this._title.visible = pinned;
        this.titleButton.visible = mode === 'all';
        if (mode === 'all')
            this.actor.add_style_class_name('spawn-grid-header-menu');
        else
            this.actor.remove_style_class_name('spawn-grid-header-menu');
        this._title.text = _('Pinned');
        this._label.text = pinned ? _('All apps') : _('Pinned');
        this._before.visible = !pinned;
        this._after.visible = pinned;
        nameItem(this._button, pinned ? _('Show all apps') : _('Back to pinned apps'), {label: this._label});
        this.setCategory(this._category);
    }

    setCategory(name: string): void {
        this._category = name;
        this._categoryLabel.text = name;
        nameItem(this.titleButton, _('%s, choose a category').format(name));
    }

    /** The title button (All apps) first, then the pill, left to right. */
    group(): Group | null {
        if (!this.actor.visible)
            return null;
        const items = this._mode === 'all' ? [this.titleButton, this._button] : [this._button];
        return {id: 'nav', items, cols: items.length};
    }
}

// ---- footer ----

export interface GridFooterDeps {
    host: ShortcutHost;
    tooltips: TooltipManager;
    context: AppContextMenu;
}

/** Icon-only buttons need their name quickly (the default tooltip delay is 450 ms). */
const TOOLTIP_DELAY_MS = 200;

export class GridFooter {
    readonly actor: St.BoxLayout;
    private readonly _services: Services;
    private readonly _deps: GridFooterDeps;
    /** Scope of everything built by build(); disposed and recreated by the next build. */
    private readonly _buildScope: Scope;
    private _user: UserCard | null = null;
    private _places: St.Button[] = [];
    private _power: PowerBar | null = null;

    constructor(scope: Scope, services: Services, deps: GridFooterDeps) {
        this._services = services;
        this._deps = deps;
        this.actor = new St.BoxLayout({style_class: 'spawn-grid-footer', x_expand: true});
        this._buildScope = scope.child('grid footer');
    }

    build(): void {
        this._deps.tooltips.hide();
        this._buildScope.dispose();
        this._user = null;
        this._places = [];
        this._power = null;
        for (const c of this.actor.get_children())
            c.destroy();

        const s = this._services.settings;
        const scope = this._buildScope;
        const host = this._deps.host;

        this._user = new UserCard(scope, s, host, card => this._deps.context.open(card, {kind: 'usercard'}));
        this._user.actor.x_expand = false;
        this.actor.add_child(this._user.actor);
        this.actor.add_child(new St.Widget({x_expand: true}));

        const places = new St.BoxLayout({style_class: 'spawn-grid-places'});
        markToolbar(places, _('Folders'));
        for (const entry of s.get('directory-shortcuts')) {
            try {
                const button = this._placeButton(entry);
                if (button) {
                    this._places.push(button);
                    places.add_child(button);
                }
            } catch (e) {
                error(`shortcut ${JSON.stringify(entry)} skipped`, e);
            }
        }
        if (this._places.length) {
            this.actor.add_child(places);
            this.actor.add_child(new St.Widget({style_class: 'spawn-grid-footer-rule', y_align: Clutter.ActorAlign.CENTER}));
        }

        this._power = new PowerBar(scope, s, host);
        this._power.actor.x_expand = false;
        // The bar fits its buttons to the width it is given (widgets/powerFit.ts): here it is asked for the
        // width its buttons need at normal spacing (48n + 8), not a share of the row.
        const n = Math.max(1, this._power.buttons().length);
        this._power.actor.set_width(48 * n + 8);
        this.actor.add_child(this._power.actor);
    }

    private _placeButton(entry: Entry): St.Button | null {
        const resolved = resolveShortcut(entry);
        if (!resolved)
            return null;
        const button = makeItemButton('spawn-power-button spawn-grid-icon-button');
        button.x_expand = false;
        button.y_align = Clutter.ActorAlign.CENTER;
        const icon = new St.Icon({icon_size: 16, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const src = resolved.icon;
        if (typeof src === 'string')
            icon.gicon = Gio.icon_new_for_string(src);
        else if (src)
            icon.gicon = src;
        else
            icon.icon_name = 'folder-symbolic';
        const face = makeFace('spawn-power-surface spawn-grid-icon-surface', icon);
        face.x_expand = false;
        button.set_child(face);
        nameItem(button, resolved.name);
        this._deps.tooltips.attach(button, null, () => resolved.name, {delay: TOOLTIP_DELAY_MS, above: true});
        const scope = this._buildScope;
        wireItem(button, {
            activate: () => resolved.run(this._deps.host, scope),
            context: () => {
                const app = entry.id.endsWith('.desktop') ? lookupApp(this._services, entry.id) : null;
                this._deps.context.open(button, {kind: 'shortcut', entry, name: resolved.name, app, open: () => resolved.run(this._deps.host, scope)});
            },
        });
        return button;
    }

    /** One row: Left / Right walk it, Up returns to the view above. */
    group(): Group | null {
        const items: Clutter.Actor[] = [];
        if (this._user?.actor.visible)
            items.push(this._user.actor);
        items.push(...this._places, ...(this._power?.buttons() ?? []));
        return items.length ? {id: 'footer', items, cols: items.length} : null;
    }
}

// ---- pager ----

export interface GridPagerDeps {
    /** The view stack (the pinned scroll view is one of its views). */
    stack(): St.Widget;
    /** The column the stack is in, its height as the settings ask for it (before the trim), and the most it may be. */
    column(): {box: St.Widget; height: number; max: number};
    /** Shrink the menu by `px` (absolute, 0 = untrimmed, negative = grow): whole rows, no half row. */
    trim(px: number): void;
    /** Is the Grid layout on? (Classic: the pager leaves the scroll view alone.) */
    enabled(): boolean;
    settings: SpawnSettings;
}

/** Wheel / touchpad: a smooth scroll this far (in scroll units) turns one page. */
const SMOOTH_STEP = 1.0;
const PAGE_MS = 220;
/** Rows of pinned apps on a page when the screen has the room: 4 x 6 = 24 apps at the default width. */
const MIN_ROWS = 4;

export class GridPager {
    readonly dots: St.BoxLayout;
    page = 0;
    pages = 1;
    /** Rows on one page (0 while not paging). */
    rows = 0;
    private readonly _deps: GridPagerDeps;
    private _scroll: St.ScrollView | null = null;
    private _grid: St.Widget | null = null;
    private _pageH = 0;
    private _trim = 0;
    private _smooth = 0;
    private _shown = false;
    private _laterId = 0;
    private _relayoutId = 0;
    private _dotsSig = '';
    private _destroyed = false;
    /** Pages of the pinned grid (its rows over the rows on one page). */
    private _gridPages = 1;
    /** The scroll view the pager changed (sizes, classes), so Classic can undo it once. */
    private _paged: St.ScrollView | null = null;

    constructor(scope: Scope, deps: GridPagerDeps) {
        this._deps = deps;
        this.dots = new St.BoxLayout({style_class: 'spawn-grid-dots', x_align: Clutter.ActorAlign.CENTER, visible: false});
        markToolbar(this.dots, _('Pages'));
        scope.add(() => {
            this._destroyed = true;
            const laters = global.compositor.get_laters();
            if (this._laterId)
                laters.remove(this._laterId);
            if (this._relayoutId)
                laters.remove(this._relayoutId);
            this._laterId = 0;
            this._relayoutId = 0;
        }, 'GridPager');
    }

    attach(scroll: St.ScrollView, grid: St.Widget): void {
        if (this._scroll === scroll)
            return;
        this._scroll = scroll;
        this._grid = grid;
        scroll.connect('scroll-event', (_a: Clutter.Actor, event: Clutter.Event) => this._onScroll(event));
        // Sizes change during an allocation; measuring and resizing then would be dropped: do it before the next frame.
        this._deps.stack().connect('notify::height', () => this._queueRelayout());
        grid.connect('notify::height', () => this._queueRelayout());
        // Rows come and go without the height changing (it is a whole number of pages): count the pages again.
        grid.connect('child-added', () => this._queueRelayout());
        grid.connect('child-removed', () => this._queueRelayout());
        scroll.vadjustment.connect('notify::upper', () => this._syncDots());
        this.relayout();
    }

    setShown(shown: boolean): void {
        const was = this._shown;
        this._shown = shown;
        this._syncDots();
        if (shown && !was)
            this._queueRelayout();
    }

    reset(): void {
        this.page = 0;
        this._scroll?.vadjustment.set_value(0);
        this._syncDots();
    }

    /** The focus moved onto a tile: show the page it is on (after the generic scroll-into-view ran). */
    reveal(actor: Clutter.Actor): void {
        if (!this._active() || !this._grid?.contains(actor) || this._pageH <= 0)
            return;
        const later = global.compositor.get_laters();
        if (this._laterId)
            later.remove(this._laterId);
        this._laterId = later.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            if (this._destroyed || !this._grid)
                return false;
            const [, y] = actor.get_transformed_position();
            const [, gy] = this._grid.get_transformed_position();
            const top = (y ?? 0) - (gy ?? 0);
            this._goTo(Math.floor((top + 1) / this._pageH), false);
            return false;
        });
    }

    /** Dev hook: what the pager measured last. */
    debug(): Record<string, unknown> {
        return {value: Math.round(this._scroll?.vadjustment.value ?? 0), shown: this._shown, attached: Boolean(this._scroll), pageH: this._pageH, trim: this._trim, rows: this.rows,
            stackH: this._deps.stack().height, rowH0: this._grid?.get_first_child()?.height ?? -1, dots: this.dots.visible};
    }

    private _active(): boolean {
        return Boolean(this._scroll && this._deps.enabled());
    }

    /**
     * One height for every grid row (the tallest row's: a wrapped two-line name makes a row taller), so a page
     * is a whole number of rows and turning a page never shows half a row. 0 before the tiles are styled.
     */
    private _rowHeight(): number {
        const rows = this._grid?.get_children() ?? [];
        let h = 0;
        for (const row of rows) {
            row.set_height(-1);
            h = Math.max(h, row.get_preferred_height(-1)[1]);
        }
        if (h > 0) {
            for (const row of rows)
                row.set_height(h);
        }
        return h;
    }

    private _queueRelayout(): void {
        if (this._relayoutId || this._destroyed)
            return;
        this._relayoutId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._relayoutId = 0;
            this.relayout();
            return false;
        });
    }

    relayout(): void {
        const scroll = this._scroll;
        if (this._destroyed || !scroll)
            return;
        if (!this._deps.enabled()) {
            if (this._trim !== 0) {
                this._trim = 0;
                this._deps.trim(0);
            }
            this._pageH = 0;
            this.rows = 0;
            // Classic: hands off, unless this scroll view was paged before the switch (then undo the paging once).
            if (this._paged === scroll) {
                this._paged = null;
                for (const row of this._grid?.get_children() ?? [])
                    row.set_height(-1);
                this._grid?.set_height(-1);
                scroll.set_height(-1);
                scroll.y_expand = true;
                scroll.remove_style_class_name('spawn-grid-paged');
                applyScrollSettings(scroll, this._deps.settings);
            }
            this._syncDots();
            return;
        }
        this._paged = scroll;
        // Pages, not a scroll bar or faded edges: the dots say where you are (the wheel and the keyboard still move).
        scroll.vscrollbar_policy = St.PolicyType.AUTOMATIC;
        scroll.add_style_class_name('spawn-grid-paged');
        scroll.remove_style_class_name('vfade');
        // Measured while the pinned view shows: other views have no dots row, so the stack is taller there and
        // would grow the page (the menu keeps its height from view to view).
        if (!this._shown)
            return;
        const rowH = this._rowHeight();
        if (rowH <= 0)
            return;
        // The room for the grid: the column's height (as set, before the trim) minus everything else in it, each at
        // its natural height. Measured, not read back from the allocation: no feedback between the trim and the room.
        const {box, height, max} = this._deps.column();
        const stack = this._deps.stack();
        const node = box.get_theme_node();
        const visible = box.get_children().filter(c => c.visible);
        let others = node.get_padding(St.Side.TOP) + node.get_padding(St.Side.BOTTOM) +
            Math.max(0, visible.length - 1) * node.get_length('spacing');
        for (const c of visible) {
            if (c !== stack)
                others += c.get_preferred_height(box.width)[1];
        }
        const room = height - others;
        if (room <= 0)
            return;
        // At least MIN_ROWS rows (the menu grows for them when the screen has the room), more when they fit.
        const fit = Math.floor(room / rowH);
        const most = Number.isFinite(max) ? Math.floor((max - others) / rowH) : MIN_ROWS;
        const rows = Math.max(1, Math.max(fit, Math.min(MIN_ROWS, most)));
        const pageH = rows * rowH;
        this.rows = rows;
        this._pageH = pageH;
        // Exactly one page high; what is left over comes off the menu (no half row, no gap under the grid).
        scroll.y_expand = false;
        if (scroll.height !== pageH)
            scroll.set_height(pageH);
        // The last page starts on a row of its own (a short last page shows empty space below its apps, never
        // the end of the page before it again): the grid is a whole number of pages high.
        const grid = this._grid;
        const total = grid?.get_n_children() ?? 0;
        this._gridPages = total > 0 ? Math.ceil(total / rows) : 1;
        if (grid) {
            const minH = this._gridPages * pageH;
            // Both minimum and natural (a minimum above the natural height aborts Clutter's box layout).
            if (grid.height !== minH)
                grid.set_height(minH);
        }
        const trim = Math.floor(room - pageH); // negative: the menu grows to fit MIN_ROWS
        if (trim !== this._trim) {
            this._trim = trim;
            this._deps.trim(trim);
        }
        this._goTo(this.page, false);
        this._syncDots();
    }

    private _onScroll(event: Clutter.Event): boolean {
        if (!this._active() || this._pageH <= 0)
            return Clutter.EVENT_PROPAGATE;
        let dir = 0;
        switch (event.get_scroll_direction()) {
        case Clutter.ScrollDirection.UP: dir = -1; break;
        case Clutter.ScrollDirection.DOWN: dir = 1; break;
        case Clutter.ScrollDirection.SMOOTH: {
            const [, dy] = event.get_scroll_delta();
            this._smooth += dy;
            if (Math.abs(this._smooth) >= SMOOTH_STEP) {
                dir = Math.sign(this._smooth);
                this._smooth = 0;
            }
            // a scroll that stops (touchpad finger lifted) starts the count again
            if (event.get_scroll_finish_flags() !== Clutter.ScrollFinishFlags.NONE)
                this._smooth = 0;
            break;
        }
        default: break;
        }
        if (dir !== 0)
            this._goTo(this.page + dir, true);
        return Clutter.EVENT_STOP;
    }

    private _count(): number {
        const adj = this._scroll?.vadjustment;
        if (!adj || this._pageH <= 0)
            return 1;
        return Math.max(1, this._gridPages);
    }

    private _goTo(page: number, animate: boolean): void {
        const adj = this._scroll?.vadjustment;
        if (!adj || this._pageH <= 0)
            return;
        this.pages = this._count();
        this.page = Math.max(0, Math.min(this.pages - 1, page));
        const value = this.page * this._pageH;
        const duration = animate ? animationDuration(PAGE_MS) : 0;
        adj.remove_transition('value');
        if (duration > 0 && Math.abs(adj.value - value) > 0.5)
            (adj as unknown as {ease(v: number, p: object): void}).ease(value, {duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        else
            adj.set_value(value);
        this._syncDots();
    }

    private _syncDots(): void {
        const on = this._active() && this._shown;
        this.pages = this._count();
        this.dots.visible = on;
        // Keep the row's height with one page too (no jump when a second page appears), just without dots.
        this.dots.opacity = this.pages > 1 ? 255 : 0;
        const sig = `${this.pages}|${this.page}`;
        if (sig === this._dotsSig)
            return;
        this._dotsSig = sig;
        for (const c of this.dots.get_children())
            c.destroy();
        for (let i = 0; i < this.pages; i++) {
            const dot = new St.Button({
                style_class: i === this.page ? 'spawn-grid-dot spawn-grid-dot-current' : 'spawn-grid-dot',
                can_focus: false,
                reactive: true,
                track_hover: true,
                child: new St.Widget({style_class: 'spawn-grid-dot-face'}),
            });
            nameItem(dot, _('Page %d of %d').format(i + 1, this.pages));
            dot.connect('clicked', () => this._goTo(i, true));
            this.dots.add_child(dot);
        }
    }
}

// GridAllApps: the All apps view of the Grid layout (`layout-style` Grid).
//
// Responsibility: All apps as an icon grid that uses the column's width: the same tiles, icon size and column count as
// the pinned grid (AppTile in a TileGrid, the sizes come from PaneMetrics), A-Z in letter groups. Each group is a small
// quiet letter heading ("A", digits and symbols under "#") over its own grid, so every letter starts on a new row. The
// view scrolls normally (no pages, no page dots). Nothing here is a Windows-style extra: no Recommended, no recents.
//
//   Letter jump   a heading is a button: it opens a compact letter picker over the view (# and A-Z; letters without
//                 apps are dimmed and cannot be picked). Picking a letter scrolls that group to the top and focuses its
//                 first tile; Escape closes the picker and returns to the heading.
//   Categories    the header's title button (GridHeader) opens a list of "All apps" and the categories Classic offers
//                 (Frequent is left out: the Grid start view has no usage-based lists). Picking one shows only that
//                 category's apps in the same grid, WITHOUT letter headings (they are sorted A-Z all the same; a
//                 category is short) and the header shows its name. Back / Escape in a category returns to All apps.
//
// Every tile behaves like a pinned one: click / Return launches (Ctrl = new window), right click / Menu / Shift+F10 opens
// the app's context menu, the tooltip shows a truncated name, and a drag pins it (TileHost.dragApp: the same hook the
// list rows use). The keyboard moves in 2D (arrows keep their column across the short last row of a letter and the
// headings, which are rows of their own), Home / End, Page Up / Down.
//
// Tiles are built only as needed, a group at a time (a long catalogue is ~300 apps and ~3000 actors): the groups from the
// top down to the bottom of the visible part plus a little are built, a placeholder of the exact height stands in for the
// others, so the scroll range is right from the start. Scrolling builds the groups that come into view (before the next
// frame). A key press builds ahead of the focus (two screenfuls; everything for End / Page Down / Up from below), a
// letter jump builds the group it lands on. While the view is hidden (another view, the menu closed) only the first
// screenful is kept.
//
// Public API:
//   new GridAllApps(scope, services, deps)    deps: {tileHost, tooltips, metrics, scrolls, titleButton, host: {titleChanged(name)}}
//   all.actor                                 the view: the scroll view and the overlay (letter picker / category menu) over it
//   all.show(category = 'all')                show 'all' or a GMenu category id (scrolled to the top; builds the first groups)
//   all.category: string                      what shows now ('all' or a category id)
//   all.refresh()                             rebuild now (keeps the scroll position)
//   all.changed()                             something it shows changed: refresh() when mapped, else at the next show
//   all.group(): Group                        the keyboard group of the grid (or of the open overlay): headings and tiles in
//                                             order, `move` steps the 2D moves
//   all.tiles(): St.Widget[]                  the tiles built (dev hook)
//   all.headings(): St.Button[]               the letter headings (dev hook)
//   all.toggleCategories()                    open / close the category menu (the header's title button)
//   all.overlay: 'letters' | 'categories' | null   which overlay is open
//   all.closeOverlay(): boolean               close the open overlay (focus returns to what opened it)
//   all.focusChanged(focus)                   the stage's key focus moved: an overlay the focus left closes
//   all.debug(): object                       dev hook (counts, letters, pending groups)

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import type Shell from 'gi://Shell';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import {groupByLetter, LETTERS, rowCount, stepRows, stepSlots, type RowSpan} from '../../model/letterGroups.js';
import {cardSurface} from '../../theme/css.js';
import {displayName, iconSizeOrHidden, isPointerEvent} from '../util.js';
import {animationDuration, markDialog, markList, nameItem} from '../widgets/a11y.js';
import {AppTile, type TileHost} from '../widgets/appTile.js';
import {makeFace, makeItemButton, wireItem} from '../widgets/interact.js';
import {makeNewDot} from '../widgets/newBadge.js';
import {categoryEntries} from '../widgets/categoryList.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import {TileGrid} from '../widgets/tileGrid.js';
import type {PaneMetrics} from './metrics.js';
import type {ScrollFactory} from './scrolls.js';
import type {Dir, Group} from './types.js';

/** Columns of the letter picker. */
const PICKER_COLS = 7;
/** Below the visible part: build this many pixels (CSS px) of groups ahead of it. */
const BUFFER_PX = 160;
/** The view's height before it was ever allocated (the first show of a session). */
const FALLBACK_VIEW_HEIGHT = 420;
/** Estimates before the first tile was measured (Compact: 8 + 48 + 8 + label + 8 + the 8 px gap). */
const FALLBACK_ROW_HEIGHT = 96;
const FALLBACK_HEADING_HEIGHT = 34;
/** Keys that move the keyboard to the end of the grid (or a page down): they need every group. */
const FAR_KEYS = new Set([Clutter.KEY_End, Clutter.KEY_KP_End, Clutter.KEY_Page_Down, Clutter.KEY_KP_Page_Down]);
const FADE_MS = 120;

export interface GridAppsDeps {
    tileHost: TileHost;
    tooltips: TooltipManager;
    metrics: PaneMetrics;
    scrolls: ScrollFactory;
    /** The header's title button: opens the category menu, and the focus returns to it when the menu closes. */
    titleButton: St.Widget;
    host: {
        /** The name the header's title shows changed ("All apps" or a category). */
        titleChanged(name: string): void;
    };
}

/** One letter group (or, in a category, the only group): its heading and its tiles, built when they are needed. */
interface AppGroup {
    /** '#', 'A'..'Z'; null = no heading (a category's apps). */
    letter: string | null;
    apps: Shell.App[];
    box: St.BoxLayout;
    heading: St.Button | null;
    grid: TileGrid | null;
    tiles: St.Widget[];
    /** Stands in for the tiles while they are not built (the exact height of the rows). */
    placeholder: St.Widget | null;
}

type OverlayKind = 'letters' | 'categories';

/** "Numbers and symbols" reads better than "#" aloud. */
function letterName(letter: string): string {
    return letter === '#' ? _('Numbers and symbols') : letter;
}

export class GridAllApps {
    readonly actor: St.Widget;
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _deps: GridAppsDeps;
    private readonly _scroll: St.ScrollView;
    private readonly _box: St.BoxLayout;
    private readonly _overlay: St.Widget;
    private readonly _scrim: St.Button;
    private _card: St.Widget | null = null;
    private _overlayKind: OverlayKind | null = null;
    private _overlayItems: Clutter.Actor[] = [];
    private _overlayMove: ((index: number, dir: Dir) => number) | undefined;
    private _origin: St.Widget | null = null;
    private _groups: AppGroup[] = [];
    private _category = 'all';
    private _signature = '';
    private _rowH = 0;
    private _headingH = 0;
    private _want: {index: number; col: number} | null = null;
    private _laterId = 0;
    private _cancelTrim: (() => void) | null = null;
    private _dirty = false;
    private _destroyed = false;

    constructor(scope: Scope, services: Services, deps: GridAppsDeps) {
        this._scope = scope;
        this._services = services;
        this._deps = deps;
        this.actor = new St.Widget({style_class: 'spawn-grid-apps', layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true});
        this._box = new St.BoxLayout({style_class: 'spawn-grid-apps-box', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._scroll = deps.scrolls.make(this._box, 'spawn-grid-apps-scroll');
        this.actor.add_child(this._scroll);

        // The overlay (letter picker / category menu) lies over the scroll view: a scrim that closes it on a click, and the card.
        this._overlay = new St.Widget({style_class: 'spawn-grid-overlay', layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: true, visible: false});
        // A button: it closes on the click (press and release), so no release is left for whatever lies under it.
        this._scrim = new St.Button({style_class: 'spawn-grid-scrim', reactive: true, can_focus: false, x_expand: true, y_expand: true});
        this._scrim.connect('clicked', () => this.closeOverlay());
        this._overlay.add_child(this._scrim);
        this.actor.add_child(this._overlay);

        services.appIndex.onChanged(scope, () => this.changed());
        services.newApps.onChanged(scope, () => scope.idle(() => this.changed()));

        // Scrolled, or the visible height changed: the groups coming into view, just before the next frame.
        const adjustment = this._scroll.vadjustment;
        adjustment.connect('notify::value', () => this._queueFill());
        adjustment.connect('notify::page-size', () => this._queueFill());
        // The first allocation tells how tall a row is (the estimates are replaced by it).
        this._box.connect('notify::height', () => this._queueFill());
        // Hidden (another view, the menu closed): keep only the first screenful. The trim waits for an idle, so a tile is
        // never destroyed inside the click that closed the menu.
        this.actor.connect('notify::mapped', () => {
            if (this._destroyed)
                return;
            this._cancelTrim?.();
            this._cancelTrim = null;
            if (this.actor.mapped) {
                this._queueFill();
                return;
            }
            this.closeOverlay();
            this._cancelTrim = scope.idle(() => {
                this._cancelTrim = null;
                if (!this._destroyed && !this.actor.mapped)
                    this._trim();
            });
        });
        this.actor.connect('destroy', () => {
            this._destroyed = true;
            this._groups = [];
            this._cancelFill();
        });
        scope.add(() => this.destroy(), 'GridAllApps');
    }

    get category(): string {
        return this._category;
    }

    get overlay(): OverlayKind | null {
        return this._overlayKind;
    }

    // ---- showing ----

    /** Show `category` ('all' or a GMenu category id) from its top. */
    show(category = 'all'): void {
        if (this._destroyed)
            return;
        this.closeOverlay();
        const known = category === 'all' || this._services.appIndex.categories().some(c => c.id === category);
        this._category = known ? category : 'all';
        this._rebuildIfStale(false);
        this._scroll.vadjustment.value = 0;
        this._want = null;
        this._deps.host.titleChanged(this._title());
        this._fill(true);
    }

    refresh(): void {
        if (this._destroyed)
            return;
        this._dirty = false;
        if (this._category !== 'all' && !this._services.appIndex.categories().some(c => c.id === this._category))
            this._category = 'all';
        const value = this._scroll.vadjustment.value;
        this._rebuildIfStale(true);
        this._scroll.vadjustment.value = value;
        this._deps.host.titleChanged(this._title());
        this._fill(true);
    }

    destroy(): void {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._groups = [];
        this._cancelTrim?.();
        this._cancelTrim = null;
        this._cancelFill();
        this.actor.destroy();
    }

    /** The apps, their "New" state or the naming / icon settings changed: rebuild now when showing, else at the next show. */
    changed(): void {
        if (this._destroyed)
            return;
        if (this.actor.mapped)
            this.refresh();
        else
            this._dirty = true;
    }

    private _title(): string {
        if (this._category === 'all')
            return _('All apps');
        return categoryEntries(this._services, false).find(c => c.id === this._category)?.name ?? _('All apps');
    }

    // ---- structure ----

    private _tileOptions(): {iconSize: number; multiLine: boolean; generic: boolean; size: string} {
        const settings = this._services.settings;
        return {
            iconSize: this._deps.metrics.tileIconSize,
            multiLine: settings.get('multi-lined-labels'),
            generic: settings.get('apps-show-generic-names'),
            size: this._deps.metrics.itemSize(),
        };
    }

    private _sig(): string {
        const m = this._deps.metrics;
        const o = this._tileOptions();
        return `${m.cols}|${m.tileWidth}|${o.iconSize}|${o.multiLine}|${o.generic}|${o.size}|${this._category}`;
    }

    /** Make the groups for `category` and the current sizes (nothing is built yet: placeholders). */
    private _rebuildIfStale(force: boolean): void {
        const sig = this._sig();
        if (!force && !this._dirty && sig === this._signature && this._groups.length > 0)
            return;
        this._dirty = false;
        this._signature = sig;
        this.closeOverlay();
        this._deps.tooltips.hide();
        this._groups = [];
        this._want = null;
        for (const child of this._box.get_children())
            child.destroy();
        const settings = this._services.settings;
        const apps = this._services.appIndex.categoryApps(this._category);
        if (apps.length === 0) {
            this._box.add_child(new St.Label({
                text: _('No apps'),
                style_class: 'spawn-empty-label',
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            }));
            return;
        }
        const groups = this._category === 'all'
            ? groupByLetter(apps, a => displayName(a, settings)).map(g => ({letter: g.letter as string | null, apps: g.items}))
            : [{letter: null as string | null, apps}];
        for (const g of groups)
            this._groups.push(this._makeGroup(g.letter, g.apps));
        this._sizePlaceholders();
    }

    private _makeGroup(letter: string | null, apps: Shell.App[]): AppGroup {
        const box = new St.BoxLayout({style_class: 'spawn-grid-group', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        const group: AppGroup = {letter, apps, box, heading: null, grid: null, tiles: [], placeholder: null};
        if (letter !== null) {
            const heading = makeItemButton('spawn-nav-button spawn-grid-letter');
            heading.x_expand = false;
            heading.x_align = Clutter.ActorAlign.START;
            const label = new St.Label({text: letter, style_class: 'spawn-grid-letter-label'});
            heading.set_child(makeFace('spawn-nav-surface spawn-grid-letter-face', label));
            nameItem(heading, _('%s, jump to letter').format(letterName(letter)));
            this._deps.tooltips.attach(heading, null, () => _('Jump to letter'));
            wireItem(heading, {activate: () => this._openPicker(group, heading)});
            group.heading = heading;
            box.add_child(heading);
        }
        group.placeholder = new St.Widget({x_expand: true});
        box.add_child(group.placeholder);
        this._box.add_child(box);
        return group;
    }

    private _scale(): number {
        return St.ThemeContext.get_for_stage(global.stage as Clutter.Stage).scale_factor;
    }

    private _rowHeight(): number {
        return this._rowH > 0 ? this._rowH : FALLBACK_ROW_HEIGHT * this._scale();
    }

    private _headingHeight(group: AppGroup): number {
        if (group.letter === null)
            return 0;
        return this._headingH > 0 ? this._headingH : FALLBACK_HEADING_HEIGHT * this._scale();
    }

    private _rowsOf(group: AppGroup): number {
        return rowCount(group.apps.length, this._deps.metrics.cols);
    }

    /** The height of a group: its heading and its rows (built or not). */
    private _groupHeight(group: AppGroup): number {
        return this._headingHeight(group) + this._rowsOf(group) * this._rowHeight();
    }

    private _sizePlaceholders(): void {
        for (const g of this._groups) {
            if (g.placeholder)
                g.placeholder.set_height(this._rowsOf(g) * this._rowHeight());
        }
    }

    /**
     * How tall a tile row and a heading are, from their allocation (never by asking for their preferred size before they
     * were styled: St would keep that answer and the heading, whose label has no height yet, would stay a few pixels high).
     */
    private _measure(): void {
        const first = this._groups.find(g => g.grid);
        if (!first?.grid || !first.grid.actor.mapped)
            return;
        const row = first.grid.actor.get_first_child();
        const h = row ? row.height : 0;
        const hh = first.heading ? first.heading.height : 0;
        if (h > 0 && (h !== this._rowH || (hh > 0 && hh !== this._headingH))) {
            this._rowH = h;
            if (hh > 0)
                this._headingH = hh;
            this._sizePlaceholders();
        }
    }

    // ---- building tiles ----

    private _isBuilt(group: AppGroup): boolean {
        return group.grid !== null;
    }

    private _build(group: AppGroup): void {
        if (this._isBuilt(group))
            return;
        const settings = this._services.settings;
        const o = this._tileOptions();
        const host = this._deps.tileHost;
        const tiles: St.Widget[] = [];
        for (const app of group.apps) {
            const name = displayName(app, settings);
            const tile = new AppTile(app, host, {iconSize: o.iconSize, multiLine: o.multiLine, name}).actor;
            host.dragApp?.(tile, app, name);
            tiles.push(tile);
        }
        const grid = new TileGrid();
        grid.setTiles(tiles, this._deps.metrics.cols, this._deps.metrics.tileWidth, this._deps.metrics.itemSize());
        markList(grid.actor, group.letter === null ? this._title() : _('Apps starting with %s').format(letterName(group.letter)));
        group.placeholder?.destroy();
        group.placeholder = null;
        group.box.add_child(grid.actor);
        group.grid = grid;
        group.tiles = tiles;
    }

    private _unbuild(group: AppGroup): void {
        if (!group.grid)
            return;
        this._deps.tooltips.hide();
        group.grid.actor.destroy();
        group.grid = null;
        group.tiles = [];
        group.placeholder = new St.Widget({x_expand: true});
        group.placeholder.set_height(this._rowsOf(group) * this._rowHeight());
        group.box.add_child(group.placeholder);
    }

    /** The visible height of the view as last allocated (page_size: reading the actor's height could force a layout). */
    private _viewHeight(): number {
        const page = this._scroll.vadjustment.page_size;
        if (page > 0)
            return page;
        const parent = this.actor.get_parent();
        const height = parent ? parent.allocation.get_height() : 0;
        return height > 0 ? height : FALLBACK_VIEW_HEIGHT * this._scale();
    }

    /** Build the groups down to the bottom of the visible part plus BUFFER_PX (`force`: also while not mapped, the first show). */
    private _fill(force = false): void {
        if (this._destroyed || this._groups.length === 0 || (!force && !this.actor.mapped))
            return;
        // The first group tells how tall rows are: build it, measure, then count the rest.
        const first = this._groups[0];
        if (!this._isBuilt(first)) {
            this._build(first);
            this._measure();
        } else if (this._rowH <= 0) {
            this._measure();
        }
        const bottom = this._scroll.vadjustment.value + this._viewHeight() + BUFFER_PX * this._scale();
        let top = 0;
        for (const g of this._groups) {
            if (top >= bottom)
                break;
            this._build(g);
            top += this._groupHeight(g);
        }
        this._measure();
    }

    private _queueFill(): void {
        if (this._laterId || this._destroyed)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            try {
                this._fill();
            } catch (e) {
                error('could not build the apps scrolled into view', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private _cancelFill(): void {
        if (!this._laterId)
            return;
        global.compositor.get_laters().remove(this._laterId);
        this._laterId = 0;
    }

    /** Hidden: drop the tiles below the first screenful (they are built again when they are scrolled into view). */
    private _trim(): void {
        const keep = this._viewHeight() + BUFFER_PX * this._scale();
        let top = 0;
        for (const g of this._groups) {
            if (top >= keep)
                this._unbuild(g);
            top += this._groupHeight(g);
        }
    }

    /** Build every group (End / Page Down, Up from below). */
    private _buildAll(): void {
        for (const g of this._groups)
            this._build(g);
        this._measure();
    }

    /** A key press: the groups the key can reach, two screenfuls past the focused one (everything for the far keys). */
    private _buildForKeyboard(): void {
        const event = Clutter.get_current_event();
        if (!event || event.type() !== Clutter.EventType.KEY_PRESS || this._groups.every(g => this._isBuilt(g)))
            return;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus)
            return;
        const key = event.get_key_symbol();
        if (this.actor.contains(focus)) {
            if (FAR_KEYS.has(key)) {
                this._buildAll();
                return;
            }
            const at = Math.max(0, this._groups.findIndex(g => g.box.contains(focus)));
            let reach = 0;
            for (let i = at; i < this._groups.length && reach < 2 * this._viewHeight(); i++) {
                this._build(this._groups[i]);
                reach += this._groupHeight(this._groups[i]);
            }
            return;
        }
        // Up from below the grid (the footer) lands on the very last tile.
        if ((key === Clutter.KEY_Up || key === Clutter.KEY_KP_Up) && this._scroll.mapped) {
            const [, fy] = focus.get_transformed_position();
            const [, sy] = this._scroll.get_transformed_position();
            const [, sh] = this._scroll.get_transformed_size();
            if (fy >= sy + sh - 1)
                this._buildAll();
        }
    }

    // ---- keyboard ----

    /** Headings and tiles of the built groups, in order. */
    private _items(): Clutter.Actor[] {
        const out: Clutter.Actor[] = [];
        for (const g of this._groups) {
            if (!this._isBuilt(g))
                continue;
            if (g.heading)
                out.push(g.heading);
            out.push(...g.tiles);
        }
        return out;
    }

    /** One entry per row of `_items()`: a heading is a row of one, a group's tiles fill rows of `cols`. */
    private _spans(): RowSpan[] {
        const cols = Math.max(1, this._deps.metrics.cols);
        const spans: RowSpan[] = [];
        let at = 0;
        for (const g of this._groups) {
            if (!this._isBuilt(g))
                continue;
            if (g.heading)
                spans.push({start: at++, len: 1});
            for (let i = 0; i < g.tiles.length; i += cols)
                spans.push({start: at + i, len: Math.min(cols, g.tiles.length - i)});
            at += g.tiles.length;
        }
        return spans;
    }

    private _move(index: number, dir: Dir): number {
        const spans = this._spans();
        const start = spans.find(r => index >= r.start && index < r.start + r.len);
        // Where the column was left: kept across Up / Down moves, forgotten when the focus went elsewhere.
        const col = this._want?.index === index ? this._want.col : start ? index - start.start : 0;
        const step = stepRows(spans, index, dir, col);
        if (!step)
            return dir === 'up' || dir === 'down' ? -1 : index;
        this._want = {index: step.index, col: step.col};
        return step.index;
    }

    /** The keyboard group of the open overlay, else of the grid (the layout asks for it on every key). */
    group(): Group {
        if (this._overlayKind)
            return {id: this._overlayKind, items: this._overlayItems, cols: this._overlayKind === 'letters' ? PICKER_COLS : 1, move: this._overlayMove};
        this._buildForKeyboard();
        const items = this._items();
        const first = this._groups[0];
        return {id: 'apps', items, cols: Math.max(1, this._deps.metrics.cols), move: (i, d) => this._move(i, d), entry: first?.heading ? 1 : 0};
    }

    tiles(): St.Widget[] {
        return this._groups.flatMap(g => g.tiles);
    }

    headings(): St.Button[] {
        return this._groups.flatMap(g => g.heading ? [g.heading] : []);
    }

    // ---- overlay ----

    /** The card is opaque and takes the menu's colour (as the folder card does), whatever the theme. */
    private _dress(card: St.Widget): void {
        let content: Clutter.Actor | null = this.actor.get_parent();
        while (content && !(content instanceof St.Widget && content.has_style_class_name('popup-menu-content')))
            content = content.get_parent();
        if (!(content instanceof St.Widget))
            return;
        try {
            const node = content.get_theme_node();
            const css = (c: {red: number; green: number; blue: number; alpha: number}) => `rgba(${c.red}, ${c.green}, ${c.blue}, ${c.alpha / 255})`;
            const surface = cardSurface(css(node.get_background_color()), css(node.get_foreground_color()));
            card.set_style(surface ? `background-color: ${surface};` : null);
        } catch {
            card.set_style(null);
        }
    }

    private _showOverlay(kind: OverlayKind, card: St.Widget, origin: St.Widget, items: Clutter.Actor[], focus: Clutter.Actor | undefined,
        move?: (index: number, dir: Dir) => number): void {
        this.closeOverlay();
        this._overlayKind = kind;
        this._overlayItems = items;
        this._overlayMove = move;
        this._origin = origin;
        this._card = card;
        card.reactive = true;
        this._overlay.add_child(card);
        this._overlay.show();
        this._dress(card);
        const duration = animationDuration(FADE_MS);
        if (duration > 0) {
            card.opacity = 0;
            (card as unknown as {ease(p: object): void}).ease({opacity: 255, duration, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
        }
        (focus ?? items[0])?.grab_key_focus();
    }

    closeOverlay(): boolean {
        if (!this._overlayKind)
            return false;
        const origin = this._origin;
        this._overlayKind = null;
        this._overlayItems = [];
        this._overlayMove = undefined;
        this._origin = null;
        this._deps.tooltips.hide();
        // The focus must not be left on a destroyed key: it goes back to what opened the overlay (a pick then moves it on).
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (focus && this._card?.contains(focus))
            (origin?.get_stage() ? origin : this._scroll).grab_key_focus();
        // Gone at once, destroyed once the click that picked from it is over (a button must not be destroyed inside its own click).
        const card = this._card;
        this._card = null;
        card?.hide();
        this._overlay.hide();
        if (card)
            this._scope.idle(() => card.destroy());
        return true;
    }

    /** The focus moved: an overlay it left (Tab to the footer, say) closes; the button that opened it keeps it for its own click. */
    focusChanged(focus: Clutter.Actor | null): void {
        if (!this._overlayKind || !focus || focus === this._origin || !this._card)
            return;
        // Inside the card, or an ancestor of it: pointing at a key hands the focus ring back to the layout root.
        if (this._card.contains(focus) || focus.contains(this._card))
            return;
        this.closeOverlay();
    }

    toggleCategories(): void {
        if (this._overlayKind === 'categories') {
            this.closeOverlay();
            return;
        }
        this._openCategories();
    }

    private _openCategories(): void {
        const settings = this._services.settings;
        const iconSize = iconSizeOrHidden(settings, 'icon-size-categories', 16);
        const card = new St.BoxLayout({style_class: 'spawn-grid-card spawn-grid-card-categories', orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.START});
        markDialog(card, _('Categories'));
        const list = new St.BoxLayout({style_class: 'spawn-grid-category-list', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        markList(list, _('Categories'));
        const scroll = new St.ScrollView({hscrollbar_policy: St.PolicyType.NEVER, vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true});
        scroll.set_style(`max-height: ${Math.max(120, this._viewHeight() - 24)}px;`);
        scroll.add_child(list);
        card.add_child(scroll);
        const buttons: St.Button[] = [];
        for (const cat of categoryEntries(this._services, false)) {
            const name = cat.id === 'all' ? _('All apps') : cat.name;
            const button = makeItemButton('spawn-category-row spawn-grid-category');
            const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
            const label = new St.Label({text: name, style_class: 'spawn-row-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            if (iconSize > 0) {
                const icon = new St.Icon({style_class: 'spawn-category-icon', icon_size: iconSize, y_align: Clutter.ActorAlign.CENTER});
                icon.gicon = Gio.ThemedIcon.new(cat.icon);
                box.add_child(icon);
            }
            box.add_child(label);
            if (cat.hasNew) {
                box.add_child(makeNewDot());
                button.accessible_name = _('%s, contains new apps').format(name);
            }
            button.set_child(makeFace('spawn-row-surface', box));
            nameItem(button, name, {label, listItem: true});
            if (cat.hasNew)
                button.accessible_name = _('%s, contains new apps').format(name);
            if (cat.id === this._category)
                button.add_style_pseudo_class('checked');
            wireItem(button, {activate: () => this._pick(() => this._pickCategory(cat.id))});
            list.add_child(button);
            buttons.push(button);
        }
        const current = buttons.find(b => b.has_style_pseudo_class('checked'));
        this._showOverlay('categories', card, this._deps.titleButton, buttons, current);
    }

    /** Run a pick once the click (or key press) that made it is over: the overlay's own button is still being handled. */
    private _pick(run: () => void): void {
        const keyboard = !isPointerEvent();
        this._pointerPick = !keyboard;
        this._scope.idle(() => run());
    }

    private _pointerPick = false;

    private _pickCategory(id: string): void {
        const keyboard = !this._pointerPick;
        this.closeOverlay();
        this.show(id);
        if (keyboard)
            this._focusFirstTile(this._groups[0]);
    }

    private _openPicker(group: AppGroup, heading: St.Button): void {
        const present = new Set(this._groups.map(g => g.letter));
        const card = new St.BoxLayout({style_class: 'spawn-grid-card spawn-grid-card-letters', orientation: Clutter.Orientation.VERTICAL,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        markDialog(card, _('Jump to letter'));
        const keys: St.Button[] = [];
        const enabled: boolean[] = [];
        let row: St.BoxLayout | null = null;
        LETTERS.forEach((letter, i) => {
            if (i % PICKER_COLS === 0) {
                row = new St.BoxLayout({style_class: 'spawn-grid-key-row'});
                card.add_child(row);
            }
            const on = present.has(letter);
            const key = makeItemButton(`spawn-nav-button spawn-grid-key${on ? '' : ' spawn-grid-key-off'}`);
            key.x_expand = false;
            key.set_child(makeFace('spawn-nav-surface spawn-grid-key-face', new St.Label({text: letter, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER})));
            const what = letter === '#' ? _('Apps starting with a number or symbol') : _('Apps starting with %s').format(letter);
            if (on) {
                nameItem(key, what);
                wireItem(key, {activate: () => this._pick(() => this._jump(letter))});
            } else {
                // dimmed: nothing to jump to, not focusable, not clickable
                key.reactive = false;
                key.can_focus = false;
                key.track_hover = false;
                nameItem(key, letter === '#' ? _('No apps starting with a number or symbol') : _('No apps starting with %s').format(letter));
            }
            row?.add_child(key);
            enabled.push(on);
            if (on)
                keys.push(key);
        });
        // Arrow moves skip the dimmed letters: slots are LETTERS' order, items are the enabled keys only.
        const slots = LETTERS.map((_l, i) => i).filter(i => enabled[i]);
        const move = (index: number, dir: Dir): number => {
            const slot = stepSlots(enabled, slots[index], dir, PICKER_COLS);
            return Math.max(0, slots.indexOf(slot));
        };
        const here = keys[Math.max(0, slots.findIndex(i => LETTERS[i] === group.letter))];
        this._showOverlay('letters', card, heading, keys, here, move);
    }

    /** Scroll the letter's group to the top and put the keyboard on its first tile. */
    private _jump(letter: string): void {
        const keyboard = !this._pointerPick;
        this.closeOverlay();
        const at = this._groups.findIndex(g => g.letter === letter);
        if (at < 0)
            return;
        const group = this._groups[at];
        this._build(group);
        this._measure();
        let top = 0;
        for (let i = 0; i < at; i++)
            top += this._groupHeight(this._groups[i]);
        const adj = this._scroll.vadjustment;
        adj.value = Math.max(0, Math.min(top, adj.upper - adj.page_size));
        this._want = null;
        this._fill(true);
        if (keyboard)
            this._focusFirstTile(group);
    }

    private _focusFirstTile(group: AppGroup | undefined): void {
        if (!group)
            return;
        this._build(group);
        (group.tiles[0] ?? group.heading)?.grab_key_focus();
    }

    // ---- dev hook ----

    debug(): Record<string, unknown> {
        return {
            category: this._category,
            overlay: this._overlayKind,
            letters: this._groups.map(g => g.letter ?? ''),
            groups: this._groups.length,
            built: this._groups.filter(g => this._isBuilt(g)).length,
            apps: this._groups.reduce((n, g) => n + g.apps.length, 0),
            tiles: this.tiles().length,
            cols: this._deps.metrics.cols,
            rowH: Math.round(this._rowH),
            value: Math.round(this._scroll.vadjustment.value),
            upper: Math.round(this._scroll.vadjustment.upper),
        };
    }
}

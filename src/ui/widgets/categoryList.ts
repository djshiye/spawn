// CategoryList: the "All apps" view. A category column on the left (All Apps, Frequent, then the
// GMenu categories) and the apps of the selected category as rows on the right. Moving focus onto a
// category (keyboard) or clicking it selects it.
//
// Rows are built only as needed (a list of 300+ apps cost ~300 ms and ~3000 actors, kept for the session):
// only the selected category has a list; it holds the rows from its top down to the bottom of the visible
// part plus BUFFER_ROWS, and a spacer stands in for the others so the scroll range is right from the start.
// Scrolling builds the rows that come into view (before the next frame). Selecting another category drops the
// previous list, and while the view is hidden (another view, the menu closed) the list keeps only its first
// screenful, so a long list's actors do not stay around.
// Keyboard navigation sees the rows it needs: during a key press appRows() first builds the rows ahead of
// the focused one (two screenfuls), and all of them for End / Page Down or when the focus comes into the list
// with Up (its last row); completeRows() builds all of them on request.
//
// Public API:
//   new CategoryList(scope: Scope, services: Services, host: TileHost)
//   list.actor: St.Widget
//   list.showCategory(id: string): void   ('all' | 'frequent' | GMenu id)
//   list.ensureBuilt(): void              call when the view becomes visible
//   list.refresh(): void                  rebuild the column and the selected list (AppIndex / settings changed)
//   list.setColumnVisible(visible)        false = flat "all apps" list without the category column
//   list.columnScroll() / list.appScroll()   the two scroll views (scroll settings are re-applied live)
//   list.categoryButtons(): St.Widget[]
//   list.appRows(): St.Widget[]           rows of the selected category that exist (see above)
//   list.completeRows(): void             build every row still pending, now
//   list.pendingRows: number              rows not built yet (dev hook / tests)
//   list.selectedId: string
//   list.destroy()
//   A category that contains a new app (services.newApps, show-new-apps-badge) gets a subtle dot after its name and
//   the accessible name "<name>, contains new apps"; the lists rebuild when that changes.

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
import {applyScrollSettings, displayName, iconSizeFor, iconSizeOrHidden, showDescriptions} from '../util.js';
import {markList, nameItem} from './a11y.js';
import {AppRow} from './appRow.js';
import type {TileHost} from './appTile.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import {makeNewDot} from './newBadge.js';

/** Rows built below the visible part of the list. */
const BUFFER_ROWS = 4;
/** The list's height before it was ever allocated (the first show of a session). */
const FALLBACK_VIEW_HEIGHT = 900;
/** Keys that move the keyboard to the end of the list (or a page down): they need every row. */
const FAR_KEYS = new Set([Clutter.KEY_End, Clutter.KEY_KP_End, Clutter.KEY_Page_Down, Clutter.KEY_KP_Page_Down]);

interface RowOptions {
    iconSize: number;
    description: boolean;
}

/** The list of the selected category: its apps and how many of their rows exist (in order, from the top). */
interface AppList {
    id: string;
    box: St.BoxLayout;
    apps: Shell.App[];
    built: number;
    opts: RowOptions;
    /** Stands in for the rows not built yet (keeps the scroll range); null once every row exists. */
    spacer: St.Widget | null;
}

interface CategoryEntry {
    id: string;
    name: string;
    icon: string;
    /** Contains an app that shows the "New" badge. */
    hasNew: boolean;
}

/** Adwaita symbolic icon for a GMenu category (the menu data only ships colourful ones). */
export function symbolicCategoryIcon(id: string, name: string): string {
    const key = `${id} ${name}`.toLowerCase();
    const table: Array<[RegExp, string]> = [
        [/audio|video|sound|multimedia/, 'applications-multimedia-symbolic'],
        [/develop|program/, 'applications-engineering-symbolic'],
        [/edu|science/, 'applications-science-symbolic'],
        [/game/, 'applications-games-symbolic'],
        [/graphic/, 'applications-graphics-symbolic'],
        [/network|internet/, 'web-browser-symbolic'],
        [/office/, 'x-office-document-symbolic'],
        [/setting|system/, 'applications-system-symbolic'],
        [/access|util/, 'applications-utilities-symbolic'],
    ];
    for (const [re, icon] of table) {
        if (re.test(key))
            return icon;
    }
    return 'view-more-symbolic';
}

export class CategoryList {
    readonly actor: St.BoxLayout;
    private readonly _services: Services;
    private readonly _host: TileHost;
    private readonly _column: St.ScrollView;
    private readonly _columnBox: St.BoxLayout;
    private readonly _appsScroll: St.ScrollView;
    private readonly _appsBox: St.BoxLayout;
    private readonly _separator: St.Widget;
    private readonly _buttons = new Map<string, St.Button>();
    private _list: AppList | null = null;
    /** Natural height of one row (measured on the first row built; 0 = not known yet). */
    private _rowHeight = 0;
    private _cancelTrim: (() => void) | null = null;
    /** Pending BEFORE_REDRAW later of _queueFill (0 = none). */
    private _laterId = 0;
    private _selected = 'all';
    private _columnVisible = true;
    private _built = false;
    private _dirty = false;
    private _destroyed = false;

    constructor(scope: Scope, services: Services, host: TileHost) {
        this._services = services;
        this._host = host;
        this.actor = new St.BoxLayout({style_class: 'spawn-category-list', x_expand: true, y_expand: true});

        this._columnBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'spawn-category-column-box'});
        markList(this._columnBox, _('Categories'));
        this._column = this._makeScroll(this._columnBox, 'spawn-category-column');
        this._separator = new St.Widget({style_class: 'spawn-vseparator', y_expand: true});
        this._appsBox = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-category-apps-box'});
        this._appsScroll = this._makeScroll(this._appsBox, 'spawn-category-apps');
        this._appsScroll.x_expand = true;

        this.actor.add_child(this._column);
        this.actor.add_child(this._separator);
        this.actor.add_child(this._appsScroll);

        services.appIndex.onChanged(scope, () => {
            if (this.actor.mapped)
                this.refresh();
            else
                this._dirty = true;
        });
        // A new app was launched (or aged out): redraw once the click that caused it is over, so the row that
        // was clicked is not destroyed inside its own handler.
        services.newApps.onChanged(scope, () => {
            scope.idle(() => {
                if (this._destroyed)
                    return;
                if (this.actor.mapped)
                    this.refresh();
                else
                    this._dirty = true;
            });
        });
        // Scrolled, or the visible height changed: the rows coming into view. The adjustment also changes while
        // the scroll view is allocated, so the rows are added just before the next frame, never during a layout.
        const adjustment = this._appsScroll.vadjustment;
        adjustment.connect('notify::value', () => this._queueFill());
        adjustment.connect('notify::page-size', () => this._queueFill());
        // Hidden (another view, the menu closed): keep only the first screenful. The trim waits for an idle, so a
        // row is never destroyed inside the click that closed the menu.
        this.actor.connect('notify::mapped', () => {
            if (this._destroyed)
                return;
            this._cancelTrim?.();
            this._cancelTrim = null;
            if (this.actor.mapped) {
                this._queueFill();
                return;
            }
            this._cancelTrim = scope.idle(() => {
                this._cancelTrim = null;
                if (!this._destroyed && !this.actor.mapped)
                    this._trim();
            });
        });
        // destroyed with its parent (the layout going away): nothing may touch the actors any more
        this.actor.connect('destroy', () => {
            this._destroyed = true;
            this._list = null;
            this._cancelFill();
        });
        scope.add(() => this.destroy(), 'CategoryList');
    }

    get selectedId(): string {
        return this._selected;
    }

    /** Rows of the selected category that are not built yet. */
    get pendingRows(): number {
        const list = this._list;
        return list ? list.apps.length - list.built : 0;
    }

    /** Build the category column and show the selection; call when the view becomes visible. */
    ensureBuilt(): void {
        if (this._destroyed)
            return;
        if (this._dirty) {
            this._dirty = false;
            this.refresh();
            return;
        }
        if (!this._built)
            this._buildColumn();
        this._showList(this._selected);
    }

    showCategory(id: string): void {
        if (this._destroyed)
            return;
        this._selected = id;
        if (!this._built)
            this._buildColumn();
        this._showList(id);
    }

    refresh(): void {
        if (this._destroyed)
            return;
        this._host.tooltips?.hide();
        this._dropList();
        this._rowHeight = 0; // the icon size or the descriptions may have changed
        for (const c of this._columnBox.get_children())
            c.destroy();
        this._buttons.clear();
        this._built = false;
        this._buildColumn();
        if (!this._buttons.has(this._selected))
            this._selected = 'all';
        this._showList(this._selected);
    }

    setColumnVisible(visible: boolean): void {
        this._columnVisible = visible;
        this._column.visible = visible;
        this._separator.visible = visible;
        // the flat list starts at the pane's edge: its rows own that inset (stylesheet.css)
        if (visible)
            this.actor.remove_style_class_name('spawn-category-flat');
        else
            this.actor.add_style_class_name('spawn-category-flat');
        if (!visible)
            this.showCategory('all');
    }

    categoryButtons(): St.Widget[] {
        return this._columnVisible ? [...this._buttons.values()] : [];
    }

    appRows(): St.Widget[] {
        const list = this._list;
        if (!list)
            return [];
        if (list.built < list.apps.length)
            this._buildForKeyboard(list);
        return this._rows(list);
    }

    /** Build every row of the selected category that is still pending, now. */
    completeRows(): void {
        const list = this._list;
        if (list && list.built < list.apps.length)
            this._buildRows(list, list.apps.length - list.built);
    }

    appScroll(): St.ScrollView {
        return this._appsScroll;
    }

    /** The category column's scroll view (the layout re-applies scroll settings to both). */
    columnScroll(): St.ScrollView {
        return this._column;
    }

    destroy(): void {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._list = null;
        this._cancelTrim?.();
        this._cancelTrim = null;
        this._cancelFill();
        this.actor.destroy();
    }

    private _makeScroll(child: St.BoxLayout, styleClass: string): St.ScrollView {
        const settings = this._services.settings;
        const scroll = new St.ScrollView({
            style_class: styleClass,
            hscrollbar_policy: St.PolicyType.NEVER,
            y_expand: true,
        });
        applyScrollSettings(scroll, settings);
        scroll.add_child(child);
        return scroll;
    }

    private _categories(): CategoryEntry[] {
        const index = this._services.appIndex;
        const news = this._services.newApps;
        const hasNew = (apps: readonly {get_id(): string | null}[]): boolean => news.anyNew(apps.map(a => a.get_id() ?? ''));
        const out: CategoryEntry[] = [
            {id: 'all', name: _('All Apps'), icon: 'view-app-grid-symbolic', hasNew: hasNew(index.apps())},
            {id: 'frequent', name: _('Frequent'), icon: 'document-open-recent-symbolic', hasNew: false},
        ];
        const symbolic = this._services.settings.get('icon-style-categories') === 'Symbolic';
        for (const c of index.categories()) {
            out.push({
                id: c.id,
                name: c.name,
                icon: symbolic ? symbolicCategoryIcon(c.id, c.name) : c.iconName || 'applications-other',
                hasNew: hasNew(c.apps),
            });
        }
        return out;
    }

    private _buildColumn(): void {
        const size = iconSizeOrHidden(this._services.settings, 'icon-size-categories', 16);
        const hideIcons = size === 0; // icon-size-categories = 0: no category icons
        for (const cat of this._categories()) {
            const button = makeItemButton('spawn-category-row');
            const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
            const label = new St.Label({text: cat.name, style_class: 'spawn-row-label', y_align: Clutter.ActorAlign.CENTER, x_expand: true});
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            if (!hideIcons) {
                const icon = new St.Icon({style_class: 'spawn-category-icon', icon_size: size, y_align: Clutter.ActorAlign.CENTER});
                icon.gicon = Gio.ThemedIcon.new(cat.icon);
                box.add_child(icon);
            }
            box.add_child(label);
            if (cat.hasNew) {
                box.add_child(makeNewDot());
                button.accessible_name = _('%s, contains new apps').format(cat.name);
            }
            button.set_child(makeFace('spawn-row-surface', box));
            nameItem(button, cat.name, {label, listItem: true});
            this._host.tooltips?.attach(button, label);
            wireItem(button, {activate: () => this.showCategory(cat.id)});
            button.connect('key-focus-in', () => this.showCategory(cat.id));
            this._columnBox.add_child(button);
            this._buttons.set(cat.id, button);
        }
        this._built = true;
    }

    private _showList(id: string): void {
        for (const [bid, b] of this._buttons) {
            if (bid === id)
                b.add_style_pseudo_class('checked');
            else
                b.remove_style_pseudo_class('checked');
        }
        // The frequent list reflects live usage: rebuilt every time it is shown. Any other list is kept while
        // it stays selected (only its first screenful while the view was hidden).
        const list = this._list;
        if (!list || list.id !== id || id === 'frequent') {
            this._dropList();
            this._list = this._buildList(id);
        }
        this._appsScroll.vadjustment.value = 0;
        this._queueFill();
    }

    private _dropList(): void {
        const list = this._list;
        if (!list)
            return;
        this._list = null;
        this._host.tooltips?.hide();
        list.box.destroy();
    }

    private _buildList(id: string): AppList {
        const settings = this._services.settings;
        const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        markList(box, this._buttons.get(id)?.accessible_name || id);
        this._appsBox.add_child(box);
        const list: AppList = {
            id,
            box,
            apps: [],
            built: 0,
            opts: {iconSize: iconSizeFor(settings, 'icon-size-apps', 28), description: showDescriptions(settings)},
            spacer: null,
        };
        try {
            const limit = id === 'frequent' ? Math.max(0, settings.get('max-frequent-apps')) : 0;
            list.apps = this._services.appIndex.categoryApps(id, limit);
            if (list.apps.length === 0) {
                box.add_child(new St.Label({
                    text: id === 'frequent' ? _('Nothing here yet') : _('No apps'),
                    style_class: 'spawn-empty-label',
                    x_align: Clutter.ActorAlign.CENTER,
                    y_align: Clutter.ActorAlign.CENTER,
                    y_expand: true,
                }));
                return list;
            }
            // The first row tells how many fit: build those (and BUFFER_ROWS more) now.
            this._buildRows(list, 1);
            this._buildRows(list, this._screenful() - 1);
        } catch (e) {
            error(`could not build category ${id}`, e);
        }
        return list;
    }

    private _rows(list: AppList): St.Button[] {
        return list.box.get_children().filter((c): c is St.Button => c instanceof St.Button);
    }

    private _scale(): number {
        return St.ThemeContext.get_for_stage(global.stage as Clutter.Stage).scale_factor;
    }

    /** A row's height; before one was measured (no theme node yet) the icon's, which errs towards too many rows. */
    private _rowPitch(): number {
        return this._rowHeight > 0 ? this._rowHeight : 16 * this._scale();
    }

    /** The visible height of the list as last allocated (page_size: reading the actor's height could force a layout). */
    private _viewHeight(): number {
        const page = this._appsScroll.vadjustment.page_size;
        return page > 0 ? page : FALLBACK_VIEW_HEIGHT * this._scale();
    }

    /** Rows that fill the visible part of the list, plus BUFFER_ROWS. */
    private _screenful(): number {
        return Math.ceil(this._viewHeight() / this._rowPitch()) + BUFFER_ROWS;
    }

    /** Append up to `count` pending rows of `list` (in order) and resize the spacer for the rest. */
    private _buildRows(list: AppList, count: number): void {
        const settings = this._services.settings;
        const end = Math.min(list.apps.length, list.built + Math.max(0, count));
        for (; list.built < end; list.built++) {
            const app = list.apps[list.built];
            const row = new AppRow(app, this._host, {...list.opts, name: displayName(app, settings)}).actor;
            if (list.spacer)
                list.box.insert_child_below(row, list.spacer);
            else
                list.box.add_child(row);
            if (this._rowHeight <= 0 && row.get_stage())
                this._rowHeight = row.get_preferred_height(-1)[1];
        }
        const pending = list.apps.length - list.built;
        if (pending > 0) {
            if (!list.spacer) {
                list.spacer = new St.Widget({x_expand: true});
                list.box.add_child(list.spacer);
            }
            list.spacer.height = pending * this._rowPitch();
        } else if (list.spacer) {
            list.spacer.destroy();
            list.spacer = null;
        }
    }

    /**
     * Inside a key press (keyboard navigation reads appRows()): build the rows the key can reach. End / Page Down
     * in the list, or Up from below the list (which lands on its last row), need all of them; any other key in
     * the list two screenfuls past the focused row.
     */
    private _buildForKeyboard(list: AppList): void {
        const event = Clutter.get_current_event();
        if (!event || event.type() !== Clutter.EventType.KEY_PRESS)
            return;
        const focus = global.stage.key_focus as Clutter.Actor | null;
        if (!focus)
            return;
        const key = event.get_key_symbol();
        if (list.box.contains(focus)) {
            if (FAR_KEYS.has(key)) {
                this.completeRows();
                return;
            }
            const index = this._rows(list).findIndex(r => r === focus || r.contains(focus));
            const need = Math.max(0, index) + 1 + 2 * this._screenful();
            if (need > list.built)
                this._buildRows(list, need - list.built);
            return;
        }
        if ((key === Clutter.KEY_Up || key === Clutter.KEY_KP_Up) && this._isBelowList(focus))
            this.completeRows();
    }

    /** `actor` sits below the list and overlaps it horizontally (the nav buttons, a search entry at the bottom). */
    private _isBelowList(actor: Clutter.Actor): boolean {
        if (!this._appsScroll.mapped)
            return false;
        const [ax, ay] = actor.get_transformed_position();
        const [aw] = actor.get_transformed_size();
        const [sx, sy] = this._appsScroll.get_transformed_position();
        const [sw, sh] = this._appsScroll.get_transformed_size();
        return ay >= sy + sh - 1 && ax < sx + sw && ax + aw > sx;
    }

    /** Build the rows scrolled into view, just before the next frame (never inside a layout). */
    private _queueFill(): void {
        if (this._laterId || this._destroyed)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            try {
                this._fill();
            } catch (e) {
                error('could not build the rows scrolled into view', e);
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

    /** The rows down to the bottom of the visible part of the list, plus BUFFER_ROWS. */
    private _fill(): void {
        const list = this._list;
        if (!list || this._destroyed || list.built >= list.apps.length || !this.actor.mapped)
            return;
        const bottom = this._appsScroll.vadjustment.value + this._viewHeight();
        const need = Math.ceil(bottom / this._rowPitch()) + BUFFER_ROWS;
        if (need > list.built)
            this._buildRows(list, need - list.built);
    }

    /** Hidden: drop the rows below the first screenful (they are built again when they are scrolled into view). */
    private _trim(): void {
        const list = this._list;
        if (!list)
            return;
        const keep = Math.min(list.built, this._screenful());
        if (keep >= list.built)
            return;
        this._host.tooltips?.hide();
        for (const row of this._rows(list).slice(keep))
            row.destroy();
        list.built = keep;
        this._buildRows(list, 0); // add / resize the spacer
    }
}

// PinnedView: the pinned apps view (grid or list) and its tile cache.
//
// Responsibility: the "Pinned" view: a scroll view with the title, the TileGrid of pinned apps, folders and
// pinned commands, the empty-state card, and (start view `Pinned_And_Frequent_Apps`) a frequent section under
// the grid. It keeps one cached tile per pinned entry (`entries`, keyed `a:<id>[*]`, `m:<id>` for a missing
// app, `f:<uuid>`, `c:<id>`), rebuilt from the PinnedStore when it changed (`dirty`) and the view shows, and
// owns each tile's drag source / drop target wiring. Opening a folder, the context menu and launching are
// asked of the layout through the hosts it is given.
//
// Public API:
//   new PinnedView(scope, services, state, deps)   deps: {metrics, tooltips, tileHost, folderHost, context, scrolls,
//                                                         frequent, host: {close(), openAllApps()}}
//   pinned.ensure(): St.ScrollView         build the view the first time; returns its scroll view
//   pinned.scroll                          the scroll view (null before the first ensure)
//   pinned.grid                            the TileGrid (tiles, columns)
//   pinned.entries                         the tile cache (see above)
//   pinned.dirty                           set when the store, the metrics or the catalogue changed
//   pinned.subscribed                      the store subscription was made (first ensure)
//   pinned.showing(): boolean              the grid is on screen (its own view, or under an open folder popup)
//   pinned.syncIfNeeded()                  rebuild the tiles if `dirty` (never throws)
//   pinned.refreshFrequent()               rebuild the frequent section for the current start view
//   pinned.tileWidget(key)                 the cached tile's widget, if any
//   pinned.groups(): Group[]               keyboard groups of the view (tiles, empty-state button, frequent rows)
//   pinned.ghostCount(): number            tiles of apps that are not installed (debug)

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ShortcutId} from '../../core/constants.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {Entry} from '../../core/settings.js';
import type {PinnedItem} from '../../model/pinned.js';
import type {AppContextMenu} from '../contextMenu.js';
import {acceptDrops, enableDrag, rejectDrops} from '../dnd.js';
import {displayName, lookupApp, ownedScope} from '../util.js';
import {markList, nameItem} from '../widgets/a11y.js';
import {ActionRow, AppRow} from '../widgets/appRow.js';
import {ActionTile, AppTile, type TileHost} from '../widgets/appTile.js';
import {FolderRow, FolderTile, type FolderHost} from '../widgets/folderTile.js';
import {makeFace, makeItemButton, wireItem} from '../widgets/interact.js';
import {sizeMetrics} from '../widgets/pinnedSize.js';
import {resolveShortcut} from '../widgets/shortcutRow.js';
import {TileGrid} from '../widgets/tileGrid.js';
import type {TooltipManager} from '../widgets/tooltip.js';
import type {FrequentView} from './frequentView.js';
import type {PaneMetrics} from './metrics.js';
import type {ScrollFactory} from './scrolls.js';
import type {Group, LayoutState, TileEntry} from './types.js';

export interface PinnedViewDeps {
    metrics: PaneMetrics;
    tooltips: TooltipManager;
    tileHost: TileHost;
    folderHost: FolderHost;
    context: AppContextMenu;
    scrolls: ScrollFactory;
    /** Fills the frequent section under the grid. */
    frequent: FrequentView;
    host: {
        /** Close the popup (a pinned command was run). */
        close(): void;
        /** Spawn_ShowAllApplications: keep the menu open and show All Apps. */
        openAllApps(): void;
        /** The view was built (its scroll view and the grid in it): the Grid layout pages it. */
        built?(scroll: St.ScrollView, grid: St.Widget): void;
    };
}

export class PinnedView {
    scroll: St.ScrollView | null = null;
    readonly grid = new TileGrid();
    readonly entries = new Map<string, TileEntry>();
    dirty = true;
    subscribed = false;
    private readonly _scope: Scope;
    private readonly _services: Services;
    private readonly _state: LayoutState;
    private readonly _metrics: PaneMetrics;
    private readonly _tooltips: TooltipManager;
    private readonly _tileHost: TileHost;
    private readonly _folderHost: FolderHost;
    private readonly _context: AppContextMenu;
    private readonly _scrolls: ScrollFactory;
    private readonly _frequent: FrequentView;
    private readonly _host: PinnedViewDeps['host'];
    private _box: St.BoxLayout | null = null;
    private _title: St.Label | null = null;
    private _empty: St.BoxLayout | null = null;
    private _emptyButton: St.Button | null = null;
    private _frequentSection: St.BoxLayout | null = null;
    /** Icon size / label mode / naming the cached tiles were built with; a change rebuilds them. */
    private _tileSignature = '';

    constructor(scope: Scope, services: Services, state: LayoutState, deps: PinnedViewDeps) {
        this._scope = scope;
        this._services = services;
        this._state = state;
        this._metrics = deps.metrics;
        this._tooltips = deps.tooltips;
        this._tileHost = deps.tileHost;
        this._folderHost = deps.folderHost;
        this._context = deps.context;
        this._scrolls = deps.scrolls;
        this._frequent = deps.frequent;
        this._host = deps.host;
    }

    /** Is the pinned grid on screen (its own view, or under an open folder popup)? */
    showing(): boolean {
        if (!this._state.isOpen)
            return false;
        return this._state.view === 'pinned' || (this._state.view === 'folder' && Boolean(this.scroll?.visible));
    }

    tileWidget(key: string): St.Widget | null {
        return this.entries.get(key)?.widget ?? null;
    }

    ghostCount(): number {
        return [...this.entries.keys()].filter(k => k.startsWith('m:')).length;
    }

    groups(): Group[] {
        const groups: Group[] = [{id: 'tiles', items: this.grid.tiles(), cols: this.grid.columns}];
        if (this._empty?.visible && this._emptyButton)
            groups.push({id: 'empty', items: [this._emptyButton], cols: 1});
        if (this._frequentSection) {
            const rows = (this._frequentSection.get_children()[2]?.get_children() ?? []).filter(c => c instanceof St.Button);
            groups.push({id: 'frequent', items: rows, cols: 1});
        }
        return groups;
    }

    // ---- view ----

    ensure(): St.ScrollView {
        if (!this.scroll) {
            this._box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'spawn-pinned-box'});
            this._title = new St.Label({text: _('Pinned'), style_class: 'spawn-section-title'});
            this._box.add_child(this._title);
            markList(this.grid.actor, _('Pinned apps'));
            this._box.add_child(this.grid.actor);
            this._box.add_child(this._makePinnedEmpty());
            this.scroll = this._scrolls.make(this._box, 'spawn-pinned');
            acceptDrops(this._scope, this.scroll, this._services.pinned, {kind: 'grid', index: () => -1});
            this._host.built?.(this.scroll, this.grid.actor);
            if (!this.subscribed) {
                this.subscribed = true;
                this._services.pinned.onChanged(this._scope, () => {
                    this.dirty = true;
                    if (this.showing())
                        this.syncIfNeeded();
                });
            }
        }
        return this.scroll;
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
        wireItem(button, {activate: () => this._host.openAllApps()});
        box.add_child(button);
        this._empty = box;
        this._emptyButton = button;
        return box;
    }

    /** Pinned_And_Frequent_Apps: a frequent section under the pinned grid. */
    refreshFrequent(): void {
        const box = this._box;
        if (!box)
            return;
        if (this._frequentSection) {
            this._frequentSection.destroy();
            this._frequentSection = null;
        }
        if (this._services.settings.get('default-menu-view') !== 'Pinned_And_Frequent_Apps' || this._metrics.grid)
            return;
        const section = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        section.add_child(new St.Widget({style_class: 'spawn-separator', x_expand: true}));
        section.add_child(new St.Label({text: _('Frequent'), style_class: 'spawn-section-title'}));
        // Under the pinned LIST the frequent rows use the same pitch / inset as the pinned rows.
        const rows = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: this._metrics.listMode() ? 'spawn-list' : ''});
        section.add_child(rows);
        this._frequent.fill(rows);
        box.add_child(section);
        this._frequentSection = section;
    }


    // ---- pinned grid ----

    syncIfNeeded(): void {
        if (!this.dirty && this.entries.size > 0)
            return;
        this.dirty = false;
        try {
            this._sync();
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

    private _sync(): void {
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
            for (const [key, entry] of [...this.entries]) {
                this.entries.delete(key);
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
                const existing = this.entries.get(key);
                if (existing)
                    return {key, entry: existing};
                if (!app)
                    return {key, entry: ghost(item.id, key)};
                const {scope, release} = ownedScope(this._scope, key);
                const name = displayName(app, settings);
                const tile = list
                    ? new AppRow(app, this._tileHost, {...tileOpts, name, pinned: true})
                    : new AppTile(app, this._tileHost, {...tileOpts, name});
                enableDrag(scope, tile.actor, {id: item.id});
                acceptDrops(scope, tile.actor, store, {kind: 'app', id: item.id}, dropOpts);
                return {key, entry: {widget: tile.actor, scope, release}};
            }
            case 'folder': {
                const key = `f:${item.uuid}`;
                const existing = this.entries.get(key);
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
                const existing = this.entries.get(key);
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
            this.entries.set(made.key, made.entry);
            tiles.push(made.entry.widget);
        }
        for (const [key, entry] of [...this.entries]) {
            if (!keep.has(key)) {
                this.entries.delete(key);
                entry.release();
                entry.widget.destroy();
            }
        }
        this.grid.setTiles(tiles, list ? 1 : this._metrics.cols, list ? -1 : this._metrics.tileWidth, size);
        const empty = tiles.length === 0;
        this.grid.actor.visible = !empty;
        // Grid layout: the header above the view says "Pinned".
        if (this._title)
            this._title.visible = !empty && !this._metrics.grid;
        if (this._empty)
            this._empty.visible = empty;
    }

    private _runCustom(entry: Entry): void {
        const id = entry.id;
        // Pinned shortcuts (Spawn_*, folders, URIs) run through the shared resolver, which closes the menu itself
        // (Spawn_ShowAllApplications must keep it open).
        const resolved = resolveShortcut(entry);
        if (resolved) {
            try {
                resolved.run({close: () => this._host.close(), showAllApps: () => this._host.openAllApps()}, this._scope);
            } catch (e) {
                error(`could not run ${id}`, e);
            }
            return;
        }
        this._host.close();
        try {
            if (id === ShortcutId.SHOW_ALL_APPS) {
                this._host.openAllApps();
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
}

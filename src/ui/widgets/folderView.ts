// FolderView: the contents of one pinned folder, shown as a popup card over the menu (like app
// folders on GNOME, Android or iOS) instead of replacing the pinned view. The whole layout is dimmed by
// a scrim; the card opens next to the folder it came from (below it, or above when there is no room
// below, always inside the menu) and grows out of it. It has the folder name (click to rename inline),
// a close button and the apps as a tile grid. Without a folder to anchor to it is centred. The card is
// always opaque (see raisedSurface in theme/css.ts). The grid is always tiles, also when the pinned view
// is a list, at least MIN_TILE_WIDTH wide and sized to the folder: 2 columns up to 4 apps, 3 up to 9,
// then 4 (fewer when the menu is too narrow); it scrolls when the folder is taller than the menu.
// Clicking the scrim, the close button or Escape (the layout) closes it.
// Tiles are draggable (reorder inside the folder via ui/dnd.ts); dropping one outside the card (on
// the scrim) or on the header takes it out of the folder. Rebuilt from PinnedStore whenever it changes.
//
// Public API:
//   new FolderView(scope: Scope, services: Services, host: FolderViewHost)
//   view.actor: St.Widget             the scrim (full size of its parent, hidden while closed); the
//                                     host adds it on top of the menu content
//   view.show(uuid: string, animate?, anchor?: Clutter.Actor | null): boolean  false when the folder is gone (nothing is shown, the host went back)
//   view.hide(animate?): void         close the popup (fades out when `animate`)
//   view.refresh(): void              re-sync with the store (also called on store changes)
//   view.uuid: string | null
//   view.columns: number              columns of the grid (keyboard nav / reordering)
//   view.tiles(): St.Widget[]         app tiles in order (keyboard nav)
//   view.headerButtons(): St.Widget[] name + close buttons
//   view.startRename(): void
//   view.commitRename(): void         save an inline rename in progress (menu closing)
//   view.scroll: St.ScrollView
//   view.destroy()
//   FolderViewHost: TileHost & {back(), metrics?(): {columns, tileWidth, iconSize, multiLine?, size?, width?, height?},
//                               openMissingContext?(tile, id)}
//
// Apps of the folder whose .desktop file is gone are shown as dimmed tiles (context menu: Unpin)
// instead of silently disappearing; they are not draggable.

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {PinnedItemSize} from '../../core/settings.js';
import {acceptDrops, enableDrag, rejectDrops} from '../dnd.js';
import {applyScrollSettings, displayName, lookupApp} from '../util.js';
import {animationsEnabled, markDialog} from './a11y.js';
import {ActionTile, AppTile, type TileHost} from './appTile.js';
import {makeItemButton, wireItem} from './interact.js';
import {TileGrid} from './tileGrid.js';

export interface FolderMetrics {
    columns: number;
    tileWidth: number;
    iconSize: number;
    multiLine?: boolean;
    /** List display of the pinned view. The folder popup is a grid either way; kept for the host's convenience. */
    list?: boolean;
    rowIconSize?: number;
    /** pinned-item-size tier (default Compact). */
    size?: PinnedItemSize;
    /** Size of the area the popup is centred in (the menu content); the card stays inside it. */
    width?: number;
    height?: number;
}

export type FolderViewHost = TileHost & {
    back(): void;
    metrics?(): FolderMetrics;
    /** Context menu (Unpin) of a ghost tile: a pinned app that is no longer installed. */
    openMissingContext?(tile: St.Widget, id: string): void;
};

/** Longest folder name the rename entry accepts (the name shows up in tiles and menus). */
const MAX_NAME_LENGTH = 40;

/**
 * Space the card keeps from the edges of the menu content, and the chrome inside the card that the
 * grid cannot use: header (40) + its spacing (8) + the card's vertical padding (2 x 16). Keep in step
 * with .spawn-folder-popup / .spawn-folder-header in stylesheet.css (an 8 px spacing scale).
 */
const POPUP_MARGIN = 16;
const CARD_CHROME_H = 40 + 8 + 2 * 16;
/** The card's horizontal padding (2 x 8) around the grid. */
const CARD_PAD_W = 16;
/** TileGrid's transparent gutter at the left and right end of each row (2 x 16 px). */
const GRID_GUTTER_W = 32;
/** Narrowest card: room for the title, its pencil and the close button. */
const MIN_CARD_WIDTH = 296;
/**
 * Folder tiles are at least this wide, so two-word names ("Zoom Workplace") fit on one line and longer
 * ones wrap once, evenly; the pinned grid's tiles can be narrower than that.
 */
const MIN_TILE_WIDTH = 136;
/** Least grid height worth keeping the card off its folder for (about one row of tiles). */
const MIN_SCROLL_H = 96;
/** Gap between the folder and the card that opens from it. */
const ANCHOR_GAP = 6;

const OPEN_MS = 180;
const CLOSE_MS = 120;
const CARD_START_SCALE = 0.92;

type EaseParams = Parameters<Clutter.Actor['ease']>[0];

/**
 * Ease params that scale to `scale`. The shell's ease() names the transitions after the property with
 * `_` turned into `-` (`scale_x` -> `scale-x`), so the snake_case names are the ones it tracks; the
 * typings only know the camelCase spelling.
 */
function scaleTo(scale: number, params: Record<string, unknown>): EaseParams {
    return {...params, scale_x: scale, scale_y: scale} as unknown as EaseParams;
}

/** Columns for `n` apps: 2 up to 4 (a 2x2 like the folder icon), 3 up to 9, then 4. */
export function folderColumns(n: number): number {
    if (n <= 1)
        return 1;
    if (n <= 4)
        return 2;
    if (n <= 9)
        return 3;
    return 4;
}

export class FolderView {
    readonly actor: St.Widget;
    readonly scroll: St.ScrollView;
    private readonly _services: Services;
    private readonly _host: FolderViewHost;
    private readonly _card: St.BoxLayout;
    private readonly _header: St.BoxLayout;
    private readonly _closeButton: St.Button;
    private readonly _nameButton: St.Button;
    private readonly _nameLabel: St.Label;
    private readonly _hint: St.Label;
    private readonly _grid = new TileGrid();
    private _entry: St.Entry | null = null;
    private _finish: ((commit: boolean, refocus?: boolean) => void) | null = null;
    private readonly _scope: Scope;
    /** Cancels the idle that finishes a rename after its entry lost the key focus. */
    private _cancelFocusOut: (() => void) | null = null;
    private _uuid: string | null = null;
    private _tiles: St.Widget[] = [];
    private _columns = 1;
    private _tileScope: Scope;
    private _destroyed = false;
    /** The folder the card opened from (null: centred). */
    private _anchor: Clutter.Actor | null = null;
    /** The scroll view's max-height from refresh() (whole menu), and the one in effect now (_place may lower it). */
    private _maxScroll = -1;
    private _scrollCap = -1;

    constructor(scope: Scope, services: Services, host: FolderViewHost) {
        this._services = services;
        this._host = host;
        this._scope = scope;
        this._tileScope = scope.child('folder tiles');

        // The scrim: covers the whole menu content, dims it and closes the popup on a click. The card sits
        // at its top left (fixed layout) and _place() moves it next to its folder with a translation.
        this.actor = new St.Widget({
            style_class: 'spawn-folder-scrim',
            layout_manager: new Clutter.FixedLayout(),
            reactive: true,
            x_expand: true,
            y_expand: true,
            visible: false,
        });
        this.actor.connect('button-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            const button = event.get_button();
            if (button !== 1 && button !== 3)
                return Clutter.EVENT_PROPAGATE;
            if (this._insideCard(event))
                return Clutter.EVENT_PROPAGATE;
            host.back();
            return Clutter.EVENT_STOP;
        });

        this._card = new St.BoxLayout({
            style_class: 'spawn-folder-popup',
            orientation: Clutter.Orientation.VERTICAL,
            // A translation needs no relayout, so _place() can follow every allocation without a layout loop.
            reactive: true,
        });
        this._card.set_pivot_point(0.5, 0.5);
        this.actor.add_child(this._card);
        // Keep the card next to its folder when either changes size (rename, store change, menu resize).
        this._card.connect('notify::height', () => this._place());
        this._card.connect('notify::width', () => this._place());
        this.actor.connect('notify::allocation', () => this._place());

        this._header = new St.BoxLayout({style_class: 'spawn-folder-header', reactive: true, x_expand: true});
        // Balances the close button so the title sits in the middle of the card.
        const balance = new St.Widget({style_class: 'spawn-folder-header-balance'});

        this._nameButton = makeItemButton('spawn-row spawn-folder-name');
        this._nameButton.x_expand = true;
        this._nameButton.x_align = Clutter.ActorAlign.CENTER;
        const nameBox = new St.BoxLayout({style_class: 'spawn-row-box'});
        this._nameLabel = new St.Label({style_class: 'spawn-folder-title', y_align: Clutter.ActorAlign.CENTER});
        this._nameLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        nameBox.add_child(this._nameLabel);
        nameBox.add_child(new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 14, style_class: 'spawn-folder-edit-icon', y_align: Clutter.ActorAlign.CENTER}));
        this._nameButton.set_child(nameBox);
        this._nameButton.accessible_name = _('Rename folder');
        wireItem(this._nameButton, {activate: () => this.startRename()});
        host.tooltips?.attach(this._nameButton, null, () => _('Rename folder'));

        this._closeButton = makeItemButton('spawn-row spawn-folder-close');
        this._closeButton.x_expand = false;
        this._closeButton.y_align = Clutter.ActorAlign.CENTER;
        this._closeButton.set_child(new St.Icon({icon_name: 'window-close-symbolic', icon_size: 16}));
        this._closeButton.accessible_name = _('Close');
        wireItem(this._closeButton, {activate: () => host.back()});
        host.tooltips?.attach(this._closeButton, null, () => _('Close'));

        // Shown in place of the title while an app is dragged, so the card keeps its size under the pointer.
        this._hint = new St.Label({
            text: _('Drop outside to take out of folder'),
            style_class: 'spawn-folder-hint',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            visible: false,
        });
        this._hint.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._header.add_child(balance);
        this._header.add_child(this._nameButton);
        this._header.add_child(this._hint);
        this._header.add_child(this._closeButton);
        this._card.add_child(this._header);


        this.scroll = new St.ScrollView({
            style_class: 'spawn-folder-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
        });
        applyScrollSettings(this.scroll, services.settings);
        this._grid.actor.x_expand = false;
        this._grid.actor.x_align = Clutter.ActorAlign.CENTER;
        this.scroll.add_child(this._grid.actor);
        this._card.add_child(this.scroll);

        services.pinned.onChanged(scope, () => {
            if (this._uuid && this.actor.mapped)
                this.refresh();
        });
        scope.add(() => this.destroy(), 'FolderView');
    }

    get uuid(): string | null {
        return this._uuid;
    }

    get columns(): number {
        return this._columns;
    }

    tiles(): St.Widget[] {
        return this._tiles;
    }

    headerButtons(): St.Widget[] {
        return [this._nameButton, this._closeButton];
    }

    show(uuid: string, animate = false, anchor: Clutter.Actor | null = null): boolean {
        this._uuid = uuid;
        this._anchor = anchor;
        this._cancelRename();
        this.refresh();
        if (this._uuid !== uuid)
            return false;
        this.scroll.vadjustment.value = 0;
        const wasOpen = this.actor.visible && this.actor.opacity === 255;
        this.actor.remove_all_transitions();
        this._card.remove_all_transitions();
        this.actor.reactive = true;
        this.actor.show();
        this._place();
        if (animate && animationsEnabled() && !wasOpen) {
            this.actor.opacity = 0;
            this._card.opacity = 0;
            this._card.set_scale(CARD_START_SCALE, CARD_START_SCALE);
            this.actor.ease({opacity: 255, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            this._card.ease(scaleTo(1, {opacity: 255, duration: OPEN_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD}));
        } else {
            this.actor.opacity = 255;
            this._card.opacity = 255;
            this._card.set_scale(1, 1);
        }
        return true;
    }

    /** Close the popup; `animate` fades it out (the menu is open), otherwise it goes at once. */
    hide(animate = false): void {
        if (this._destroyed)
            return;
        this._finish?.(true, false);
        this._uuid = null;
        this._anchor = null;
        this._host.tooltips?.hide();
        // No second close and no launches from the fading card.
        this.actor.reactive = false;
        this.actor.remove_all_transitions();
        this._card.remove_all_transitions();
        if (!animate || !animationsEnabled() || !this.actor.visible) {
            this.actor.hide();
            return;
        }
        this._card.ease(scaleTo(0.96, {duration: CLOSE_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD}));
        this.actor.ease({
            opacity: 0,
            duration: CLOSE_MS,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: (finished: boolean) => {
                // Not finished: show() took over mid-fade and resets opacity / scale itself.
                if (finished && !this._destroyed && this._uuid === null)
                    this.actor.hide();
            },
        });
    }

    refresh(): void {
        if (this._destroyed || !this._uuid)
            return;
        const store = this._services.pinned;
        const uuid = this._uuid;
        const folder = store.items().find(i => i.kind === 'folder' && i.uuid === uuid);
        if (!folder || folder.kind !== 'folder') {
            // Emptied or deleted: nothing left to show.
            this._uuid = null;
            this._host.back();
            return;
        }
        if (!this._entry)
            this._nameLabel.text = folder.name;
        markDialog(this._card, _('Folder: %s').replace('%s', folder.name));

        this._host.tooltips?.hide();
        // Per-tile drag/drop registrations live in a scope that is reset on every rebuild.
        this._tileScope.dispose();
        // Outside the card (the scrim) and the header take an app out of the folder; the rest of the
        // card appends it inside the folder (so a drop on its padding does not take it out by surprise).
        acceptDrops(this._tileScope, this.actor, store, {kind: 'unfolder', folderUuid: uuid});
        acceptDrops(this._tileScope, this._header, store, {kind: 'unfolder', folderUuid: uuid});
        acceptDrops(this._tileScope, this._card, store, {kind: 'grid', index: () => -1, folderUuid: uuid});

        for (const t of this._tiles)
            t.destroy();
        const metrics: FolderMetrics = this._host.metrics?.() ?? {columns: 4, tileWidth: 96, iconSize: 48};
        const tiles: St.Widget[] = [];
        const settings = this._services.settings;
        for (const entry of store.folderApps(uuid, true)) {
            const app = lookupApp(this._services, entry.id);
            if (!app) {
                tiles.push(this._ghostTile(entry.id, metrics));
                continue;
            }
            const name = displayName(app, settings);
            const actor = new AppTile(app, this._host, {
                folderUuid: uuid, iconSize: metrics.iconSize, multiLine: metrics.multiLine, name,
            }).actor;
            enableDrag(this._tileScope, actor, {
                id: entry.id,
                folderUuid: uuid,
                onDragBegin: () => this._setDragging(true),
                onDragEnd: () => this._setDragging(false),
            });
            acceptDrops(this._tileScope, actor, store, {kind: 'app', id: entry.id, folderUuid: uuid});
            tiles.push(actor);
        }
        this._tiles = tiles;

        const room = metrics.width && metrics.width > 0 ? metrics.width - 2 * POPUP_MARGIN - CARD_PAD_W - GRID_GUTTER_W : Infinity;
        const tileWidth = Math.floor(Math.min(Math.max(metrics.tileWidth, MIN_TILE_WIDTH), Math.max(metrics.tileWidth, room)));
        let columns = folderColumns(tiles.length);
        if (Number.isFinite(room))
            columns = Math.max(1, Math.min(columns, Math.floor(room / tileWidth)));
        this._columns = columns;
        this._grid.setTiles(tiles, columns, tileWidth, metrics.size);
        acceptDrops(this._tileScope, this._grid.actor, store, {kind: 'grid', index: () => -1, folderUuid: uuid});

        // The card hugs the grid; the scroll view takes over when the folder is taller than the menu.
        const gridWidth = columns * tileWidth + GRID_GUTTER_W + CARD_PAD_W;
        const maxWidth = metrics.width && metrics.width > 0 ? metrics.width - 2 * POPUP_MARGIN : Infinity;
        this._card.set_width(Math.min(maxWidth, Math.max(MIN_CARD_WIDTH, gridWidth)));
        const maxScroll = metrics.height && metrics.height > 0
            ? Math.max(80, metrics.height - 2 * POPUP_MARGIN - CARD_CHROME_H)
            : -1;
        this._maxScroll = maxScroll > 0 ? Math.floor(maxScroll) : -1;
        this._setScrollCap(this._maxScroll);
        this._place();
    }

    /**
     * Put the card next to the folder it opened from: below it, or above when it does not fit below,
     * else as close as the menu allows; centred on a tile, aligned with the start of a full-width row.
     * The open animation grows out of the side that faces the folder.
     */
    private _place(): void {
        if (this._destroyed || !this.actor.visible)
            return;
        // The scrim fills its parent (the layout). Right after show() the scrim has no allocation yet, and its
        // size would then be the card's preferred size, so measure the parent instead.
        const parent = this.actor.get_parent();
        if (!parent)
            return;
        const W = parent.width;
        const H = parent.height;
        if (!(W > 0 && H > 0))
            return;
        const cw = this._card.width;
        const ch = Math.min(this._card.get_preferred_height(cw)[1], H - 2 * POPUP_MARGIN);
        const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
        const maxX = W - cw - POPUP_MARGIN;
        const maxY = H - ch - POPUP_MARGIN;

        const anchor = this._anchor;
        if (!anchor || !anchor.mapped) {
            this._card.set_translation(clamp((W - cw) / 2, POPUP_MARGIN, maxX), clamp((H - ch) / 2, POPUP_MARGIN, maxY), 0);
            this._card.set_pivot_point(0.5, 0.5);
            return;
        }
        const [sx, sy] = parent.get_transformed_position();
        const [ax, ay] = anchor.get_transformed_position();
        const [aw, ah] = anchor.get_transformed_size();
        // Not allocated yet: the allocation that follows calls _place() again.
        if (![sx, sy, ax, ay, aw, ah].every(Number.isFinite))
            return;
        const left = ax - sx, top = ay - sy, bottom = top + ah;
        // A tile: centred under it. A full-width list row: lined up with the row's icon.
        const x = aw <= cw ? clamp(left + aw / 2 - cw / 2, POPUP_MARGIN, maxX) : clamp(left, POPUP_MARGIN, maxX);
        let y: number;
        let below = true;
        if (bottom + ANCHOR_GAP + ch <= H - POPUP_MARGIN) {
            y = bottom + ANCHOR_GAP;
        } else if (top - ANCHOR_GAP - ch >= POPUP_MARGIN) {
            y = top - ANCHOR_GAP - ch;
            below = false;
        } else {
            // Neither fits: take the roomier side and let the grid scroll there, so the card never covers its
            // folder. The new height re-runs _place(), which then fits. Too little room either way: overlap.
            const roomBelow = H - POPUP_MARGIN - bottom - ANCHOR_GAP;
            const roomAbove = top - ANCHOR_GAP - POPUP_MARGIN;
            below = roomBelow >= roomAbove;
            const cap = Math.floor(Math.max(roomBelow, roomAbove) - CARD_CHROME_H);
            if (cap >= MIN_SCROLL_H && (this._scrollCap < 0 || cap < this._scrollCap)) {
                this._setScrollCap(cap);
                return;
            }
            y = below ? bottom + ANCHOR_GAP : top - ANCHOR_GAP - ch;
        }
        y = clamp(y, POPUP_MARGIN, maxY);
        this._card.set_translation(x, y, 0);
        const px = cw > 0 ? Math.max(0, Math.min(1, (left + Math.min(aw, cw) / 2 - x) / cw)) : 0.5;
        this._card.set_pivot_point(px, below ? 0 : 1);
    }

    private _setScrollCap(cap: number): void {
        this._scrollCap = cap;
        this.scroll.set_style(cap > 0 ? `max-height: ${cap}px;` : null);
    }

    private _ghostTile(id: string, metrics: FolderMetrics): St.Widget {
        const name = id.replace(/\.desktop$/, '');
        const open = () => this._host.openMissingContext?.(ghost, id);
        const view = new ActionTile(name, 'application-x-executable', open, undefined, {
            iconSize: metrics.iconSize, multiLine: metrics.multiLine, context: open,
        });
        const ghost = view.actor;
        ghost.add_style_class_name('spawn-tile-missing');
        ghost.opacity = 130;
        rejectDrops(this._tileScope, ghost);
        this._host.tooltips?.attach(ghost, null, () => _('%s (not installed)').format(name));
        return ghost;
    }

    /** Was the press inside the card (then it belongs to the card's own items)? */
    private _insideCard(event: Clutter.Event): boolean {
        const [x, y] = event.get_coords();
        const [cx, cy] = this._card.get_transformed_position();
        const [w, h] = this._card.get_transformed_size();
        return x >= cx && x < cx + w && y >= cy && y < cy + h;
    }

    startRename(): void {
        if (!this._uuid || this._entry || this._destroyed)
            return;
        const uuid = this._uuid;
        const entry = new St.Entry({
            text: this._nameLabel.text,
            style_class: 'spawn-folder-rename',
            accessible_name: _('Folder name'),
            x_expand: true,
            can_focus: true,
        });
        this._entry = entry;
        this._nameButton.hide();
        this._header.insert_child_above(entry, this._nameButton);
        const ct = entry.clutter_text;
        ct.max_length = MAX_NAME_LENGTH;
        let finished = false;
        const finish = (commit: boolean, refocus = true) => {
            if (finished)
                return;
            finished = true;
            this._finish = null;
            this._cancelFocusOut?.();
            this._cancelFocusOut = null;
            const text = ct.text.trim();
            this._entry = null;
            entry.destroy();
            this._nameButton.show();
            if (commit && text && this._uuid === uuid)
                this._services.pinned.renameFolder(uuid, text);
            if (refocus)
                this._nameButton.grab_key_focus();
        };
        this._finish = finish;
        ct.connect('activate', () => {
            finish(true);
            return Clutter.EVENT_STOP;
        });
        // Not finished synchronously: the focus also leaves while the popup is being mapped (a reopen after
        // the menu closed mid-rename), and destroying the entry then unrealizes a mapped actor, which
        // aborts the shell. The focus went elsewhere on purpose, so it is not taken back either.
        ct.connect('key-focus-out', () => {
            this._cancelFocusOut?.();
            this._cancelFocusOut = this._scope.idle(() => {
                this._cancelFocusOut = null;
                finish(true, false);
            });
        });
        ct.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                finish(false);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        ct.grab_key_focus();
        ct.set_selection(0, -1);
    }

    /** Abort an inline rename without saving. */
    cancelRename(): void {
        this._cancelRename();
    }

    /** Save an inline rename in progress (the menu is closing); no-op otherwise. */
    commitRename(): void {
        this._finish?.(true, false);
    }

    /** True while the rename entry is open (the layout then leaves Escape/typing to it). */
    get renaming(): boolean {
        return this._entry !== null;
    }

    destroy(): void {
        if (this._destroyed)
            return;
        this._destroyed = true;
        this._cancelFocusOut?.();
        this._cancelFocusOut = null;
        this._tileScope.dispose();
        this.actor.destroy();
    }

    private _cancelRename(): void {
        this._finish?.(false);
    }

    private _setDragging(on: boolean): void {
        this._hint.visible = on;
        this._nameButton.visible = !on && !this._entry;
        if (on)
            this._header.add_style_pseudo_class('drag');
        else
            this._header.remove_style_pseudo_class('drag');
    }
}

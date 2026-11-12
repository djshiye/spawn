// FolderView: the contents of one pinned folder, shown as a popup card over the menu (like app
// folders on GNOME, Android or iOS) instead of replacing the pinned view. The whole layout is dimmed by
// a scrim; the card opens next to the folder it came from and grows out of it: below a grid tile (or
// above when there is no room below), beside a list row like a submenu, always inside the menu. That
// folder stays lit above the scrim (a Clutter.Clone of it, in its "open" style) so the card visibly
// belongs to it, the way a menu keeps the item of an open submenu highlighted. It has the folder name (click to rename inline),
// a close button and the apps as a tile grid. Without a folder to anchor to it is centred. The card is
// always opaque (see raisedSurface in theme/css.ts). The grid is always tiles, also when the pinned view
// is a list: compact, fixed-size tiles (FOLDER_TILE_WIDTH, a 40 px icon, 48 px from the Large tier up)
// whatever the pinned grid's size, like GNOME's own app folder popovers, and sized to the folder:
// 2 columns up to 4 apps, 3 up to 9, then 4 (fewer when the menu is too narrow); it scrolls when the
// folder is taller than the menu.
// Clicking the scrim, the close button or Escape (the layout) closes it.
// One highlight at a time: pointing at an app shows its hover tint and takes the focus ring off any other
// item (the card itself then holds the keyboard focus, without a ring); an arrow key moves on from the
// pointed-at app and clears the tint under a resting pointer. Opened with the pointer, the card holds the
// focus (nothing highlighted) until the pointer or an arrow key picks an app; opened with the keyboard,
// the first app has it (as GNOME 51's own popup menus do).
// Tiles are draggable (reorder inside the folder via ui/dnd.ts); dropping one outside the card (on
// the scrim) or on the header takes it out of the folder. Rebuilt from PinnedStore whenever it changes.
//
// Public API:
//   new FolderView(scope: Scope, services: Services, host: FolderViewHost)
//   view.actor: St.Widget             the scrim (full size of its parent, hidden while closed); the
//                                     host adds it on top of the menu content
//   view.show(uuid: string, animate?, anchor?: Clutter.Actor | null): boolean  false when the folder is gone (nothing is shown, the host went back)
//   view.focusCard(): void            keyboard focus on the card itself: nothing highlighted (pointer open)
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
import {cardSurface} from '../../theme/css.js';
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
 * grid cannot use: header (32) + its spacing (4) + the card's vertical padding (2 x 12). Keep in step
 * with .spawn-folder-popup / .spawn-folder-header in stylesheet.css.
 */
const POPUP_MARGIN = 16;
/** The scrim reaches the menu's edge; the panes (and the card's margins) start this far inside it (.spawn-panes margin). */
const SCRIM_INSET = 8;
const HEADER_H = 32;
const CARD_PAD_TOP = 12;
const CARD_CHROME_H = HEADER_H + 4 + 2 * CARD_PAD_TOP;
/** The card's horizontal padding (2 x 4) around the grid. */
const CARD_PAD_W = 8;
/** Transparent gutter at the left and right end of each grid row: with the card's 4 px, a 12 px inset. */
const GRID_GUTTER = 8;
const GRID_GUTTER_W = 2 * GRID_GUTTER;
/** Narrowest card: room for the title, its pencil and the close button. */
const MIN_CARD_WIDTH = 240;
/**
 * Width of a folder tile: two-word names ("Zoom Workplace") fit on one line, longer ones wrap once
 * (multi-lined-labels) or end in an ellipsis. Narrower only when the menu is too.
 */
const FOLDER_TILE_WIDTH = 112;
/** App icons in the card: 40 px, or 48 px when the pinned grid's icons are 64 px or more (Large). */
const FOLDER_ICON = 40;
const FOLDER_ICON_LARGE = 48;
/** Least grid height worth keeping the card off its folder for (about one row of tiles). */
const MIN_SCROLL_H = 96;
/** Gap between the folder and the card that opens from it. */
const ANCHOR_GAP = 6;

const ARROWS = new Set([Clutter.KEY_Up, Clutter.KEY_Down, Clutter.KEY_Left, Clutter.KEY_Right]);

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
    /** The folder drawn above the scrim (a clone of `_anchor`) while its card is open. */
    private _spotlight: Clutter.Clone | null = null;
    private _anchorDestroyId = 0;
    private _anchorAllocId = 0;
    /** The scroll view's max-height from refresh() (whole menu), and the one in effect now (_place may lower it). */
    private _maxScroll = -1;
    private _scrollCap = -1;
    /**
     * Has the pointer moved over the card since it opened? Until then a hover is only the card appearing
     * under a resting pointer (Clutter sends a crossing for that too), which must not take the focus from
     * the keyboard or highlight an app nobody pointed at.
     */
    private _pointerMoved = false;
    /** The app or header button under the pointer (where the arrow keys start while the card has the focus). */
    private _hovered: St.Widget | null = null;

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
            // Holds the keyboard while nothing is picked (no style for :focus): arrows start from the first app.
            can_focus: true,
        });
        this._card.set_pivot_point(0.5, 0.5);
        this._card.connect('motion-event', () => {
            this._pointerMoved = true;
            return Clutter.EVENT_PROPAGATE;
        });
        // The card holds the focus while an app is only pointed at: the first arrow key moves on from that
        // app (the layout's key handler, further up, then sees it focused), not from the first one.
        this._card.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            const hovered = this._hovered;
            if (global.stage.key_focus === this._card && hovered?.hover && hovered.mapped && ARROWS.has(event.get_key_symbol()))
                hovered.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });
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
        nameBox.add_child(new St.Icon({icon_name: 'document-edit-symbolic', icon_size: 12, style_class: 'spawn-folder-edit-icon', y_align: Clutter.ActorAlign.CENTER}));
        this._nameButton.set_child(nameBox);
        this._nameButton.accessible_name = _('Rename folder');
        wireItem(this._nameButton, {activate: () => this.startRename()});
        host.tooltips?.attach(this._nameButton, null, () => _('Rename folder'));

        this._closeButton = makeItemButton('spawn-row spawn-folder-close');
        this._closeButton.x_expand = false;
        this._closeButton.y_align = Clutter.ActorAlign.CENTER;
        this._closeButton.set_child(new St.Icon({icon_name: 'window-close-symbolic', icon_size: 14}));
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

        this._followHover(this._nameButton);
        this._followHover(this._closeButton);

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
        this._setAnchor(anchor);
        this._pointerMoved = false;
        this._hovered = null;
        this._cancelRename();
        this.refresh();
        if (this._uuid !== uuid)
            return false;
        this.scroll.vadjustment.value = 0;
        const wasOpen = this.actor.visible && this.actor.opacity === 255;
        this.actor.remove_all_transitions();
        this._card.remove_all_transitions();
        this.actor.reactive = true;
        this._matchMenu();
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
        this._setAnchor(null);
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
        const iconSize = metrics.iconSize >= 64 ? FOLDER_ICON_LARGE : FOLDER_ICON;
        const tiles: St.Widget[] = [];
        const settings = this._services.settings;
        for (const entry of store.folderApps(uuid, true)) {
            const app = lookupApp(this._services, entry.id);
            if (!app) {
                tiles.push(this._ghostTile(entry.id, iconSize, metrics.multiLine));
                continue;
            }
            const name = displayName(app, settings);
            const actor = new AppTile(app, this._host, {
                folderUuid: uuid, iconSize, multiLine: metrics.multiLine, name,
            }).actor;
            enableDrag(this._tileScope, actor, {
                id: entry.id,
                folderUuid: uuid,
                onDragBegin: () => this._setDragging(true),
                onDragEnd: () => this._setDragging(false),
            });
            acceptDrops(this._tileScope, actor, store, {kind: 'app', id: entry.id, folderUuid: uuid});
            this._followHover(actor);
            tiles.push(actor);
        }
        this._tiles = tiles;

        const room = metrics.width && metrics.width > 0 ? metrics.width - 2 * POPUP_MARGIN - CARD_PAD_W - GRID_GUTTER_W : Infinity;
        const tileWidth = Math.floor(Math.min(FOLDER_TILE_WIDTH, Math.max(metrics.tileWidth, room)));
        let columns = folderColumns(tiles.length);
        if (Number.isFinite(room))
            columns = Math.max(1, Math.min(columns, Math.floor(room / tileWidth)));
        this._columns = columns;
        // Always the Compact tier's tile padding: the card has its own fixed, compact metrics.
        this._grid.setTiles(tiles, columns, tileWidth, 'Compact', GRID_GUTTER);
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
     * Put the card next to the folder it opened from. A tile: centred below it, or above when it does not
     * fit below, else as close as the menu allows. A full-width list row: beside it (_placeBesideRow).
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
        const W = parent.width - 2 * SCRIM_INSET;
        const H = parent.height - 2 * SCRIM_INSET;
        if (!(W > 0 && H > 0))
            return;
        const cw = this._card.width;
        const ch = Math.min(this._card.get_preferred_height(cw)[1], H - 2 * POPUP_MARGIN);
        const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
        const maxX = W - cw - POPUP_MARGIN;
        const maxY = H - ch - POPUP_MARGIN;

        const anchor = this._anchor;
        if (this._spotlight)
            this._spotlight.visible = Boolean(anchor?.mapped);
        if (!anchor || !anchor.mapped) {
            this._placeCard(clamp((W - cw) / 2, POPUP_MARGIN, maxX), clamp((H - ch) / 2, POPUP_MARGIN, maxY));
            this._card.set_pivot_point(0.5, 0.5);
            return;
        }
        const [sx, sy] = parent.get_transformed_position();
        const [ax, ay] = anchor.get_transformed_position();
        const [aw, ah] = anchor.get_transformed_size();
        // Not allocated yet: the allocation that follows calls _place() again.
        if (![sx, sy, ax, ay, aw, ah].every(Number.isFinite))
            return;
        // The spotlight lies in the scrim's own coordinates; everything else is measured from the panes' area.
        if (this._spotlight) {
            this._spotlight.set_size(aw, ah);
            this._spotlight.set_translation(Math.round(ax - sx), Math.round(ay - sy), 0);
        }
        const left = ax - sx - SCRIM_INSET, top = ay - sy - SCRIM_INSET, bottom = top + ah;
        if (aw > cw) {
            this._placeBesideRow(left, top, aw, ah, cw, ch, W, maxX, maxY);
            return;
        }
        // A tile: centred under it.
        const x = clamp(left + aw / 2 - cw / 2, POPUP_MARGIN, maxX);
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
        this._placeCard(x, y);
        const px = cw > 0 ? Math.max(0, Math.min(1, (left + aw / 2 - x) / cw)) : 0.5;
        this._card.set_pivot_point(px, below ? 0 : 1);
    }

    /**
     * Dress the scrim and the card after the menu they lie on, whatever the theme: the scrim gets the content's
     * inner corner radius (its radius less its border) and the card an opaque colour derived from the content's
     * real background (cardSurface), so it is neither bluish on a neutral theme nor flat on a light one.
     */
    private _matchMenu(): void {
        let content: Clutter.Actor | null = this.actor.get_parent();
        while (content && !(content instanceof St.Widget && content.has_style_class_name('popup-menu-content')))
            content = content.get_parent();
        if (!(content instanceof St.Widget))
            return;
        try {
            const node = content.get_theme_node();
            const radius = Math.max(0, node.get_border_radius(St.Corner.TOPLEFT) - node.get_border_width(St.Side.LEFT));
            this.actor.set_style(`border-radius: ${radius}px;`);
            const css = (c: {red: number; green: number; blue: number; alpha: number}) => `rgba(${c.red}, ${c.green}, ${c.blue}, ${c.alpha / 255})`;
            const surface = cardSurface(css(node.get_background_color()), css(node.get_foreground_color()));
            this._card.set_style(surface ? `background-color: ${surface};` : null);
        } catch {
            this.actor.set_style(null);
            this._card.set_style(null);
        }
    }

    /** Move the card to (x, y), measured from the panes' area (the scrim is SCRIM_INSET larger on every side). */
    private _placeCard(x: number, y: number): void {
        this._card.set_translation(x + SCRIM_INSET, y + SCRIM_INSET, 0);
    }

    /**
     * A list row (its chevron says "submenu"): the card opens beside the row like a cascading menu, on the
     * chevron's side when there is room (else the other side, else as far that way as the menu allows),
     * with its header level with the row; it moves up when it would run past the bottom of the menu.
     */
    private _placeBesideRow(left: number, top: number, aw: number, ah: number, cw: number, ch: number, W: number, maxX: number, maxY: number): void {
        const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
        const rtl = this.actor.get_text_direction() === Clutter.TextDirection.RTL;
        const after = rtl ? left - ANCHOR_GAP - cw : left + aw + ANCHOR_GAP;
        const before = rtl ? left + aw + ANCHOR_GAP : left - ANCHOR_GAP - cw;
        const fits = (v: number) => v >= POPUP_MARGIN && v + cw <= W - POPUP_MARGIN;
        let x: number;
        if (fits(after))
            x = after;
        else if (fits(before))
            x = before;
        else
            x = rtl ? POPUP_MARGIN : maxX;
        x = clamp(x, POPUP_MARGIN, maxX);
        // The header's centre (card padding + half the header) on the row's centre.
        const y = clamp(top + ah / 2 - CARD_PAD_TOP - HEADER_H / 2, POPUP_MARGIN, maxY);
        this._placeCard(x, y);
        const towardRow = x + cw / 2 < left + aw / 2 ? 1 : 0;
        const py = ch > 0 ? Math.max(0, Math.min(1, (top + ah / 2 - y) / ch)) : 0.5;
        this._card.set_pivot_point(towardRow, py);
    }

    /**
     * The folder the card belongs to: marked open (.spawn-folder-open) and drawn above the scrim by a clone
     * (not reactive: a click there lands on the scrim and closes the card, like clicking an open submenu's
     * item). null drops both.
     */
    private _setAnchor(anchor: Clutter.Actor | null): void {
        const old = this._anchor;
        if (old === anchor)
            return;
        if (old) {
            if (this._anchorDestroyId)
                old.disconnect(this._anchorDestroyId);
            if (this._anchorAllocId)
                old.disconnect(this._anchorAllocId);
            if (old instanceof St.Widget)
                old.remove_style_class_name('spawn-folder-open');
        }
        this._anchorDestroyId = 0;
        this._anchorAllocId = 0;
        this._spotlight?.destroy();
        this._spotlight = null;
        this._anchor = anchor;
        if (!anchor)
            return;
        if (anchor instanceof St.Widget)
            anchor.add_style_class_name('spawn-folder-open');
        // The pinned view rebuilt its folders: the card stays, centred, without a spotlight.
        this._anchorDestroyId = (anchor as Clutter.Actor).connect('destroy', () => {
            this._anchorDestroyId = 0;
            this._anchor = null;
            this._spotlight?.destroy();
            this._spotlight = null;
            this._place();
        });
        // A tile that was just added (New Folder) is allocated after the card opened: follow it.
        this._anchorAllocId = (anchor as Clutter.Actor).connect('notify::allocation', () => this._place());
        this._spotlight = new Clutter.Clone({source: anchor, reactive: false});
        this.actor.insert_child_below(this._spotlight, this._card);
    }

    private _setScrollCap(cap: number): void {
        this._scrollCap = cap;
        this.scroll.set_style(cap > 0 ? `max-height: ${cap}px;` : null);
    }

    private _ghostTile(id: string, iconSize: number, multiLine?: boolean): St.Widget {
        const name = id.replace(/\.desktop$/, '');
        const open = () => this._host.openMissingContext?.(ghost, id);
        const view = new ActionTile(name, 'application-x-executable', open, undefined, {
            iconSize, multiLine, context: open,
        });
        const ghost = view.actor;
        ghost.add_style_class_name('spawn-tile-missing');
        ghost.opacity = 130;
        rejectDrops(this._tileScope, ghost);
        this._followHover(ghost);
        this._host.tooltips?.attach(ghost, null, () => _('%s (not installed)').format(name));
        return ghost;
    }

    /** Keyboard focus on the card itself: nothing is highlighted, the arrow keys start from the first app. */
    focusCard(): void {
        if (!this._destroyed && this.actor.visible)
            this._card.grab_key_focus();
    }

    /**
     * One highlight at a time. Pointing at `item` shows its hover tint and takes the keyboard focus ring
     * away from any other item (the card itself holds the focus, without a ring); an arrow key then starts
     * from the pointed-at item. An arrow key that moves the focus clears the hover tint of the item under a
     * resting pointer, so the ring is the only highlight. Nothing changes while renaming or dragging.
     */
    private _followHover(item: St.Widget): void {
        item.connect('notify::hover', () => {
            if (this._destroyed || !this._uuid)
                return;
            if (!item.hover) {
                if (this._hovered === item)
                    this._hovered = null;
                return;
            }
            if (!this._pointerMoved) {
                // The card opened under a resting pointer: no tint until the pointer really moves.
                item.hover = false;
                return;
            }
            this._hovered = item;
            if (this._entry || this._hint.visible || !this.actor.reactive)
                return;
            const focus = global.stage.key_focus as Clutter.Actor | null;
            if (focus && focus !== this._card && this._card.contains(focus))
                this._card.grab_key_focus();
        });
        // St only sets `hover` on crossings: the next pointer motion over an item whose tint the keyboard
        // cleared sets it again.
        item.connect('motion-event', () => {
            this._pointerMoved = true;
            if (!item.hover)
                item.hover = true;
            return Clutter.EVENT_PROPAGATE;
        });
        item.connect('key-focus-in', () => {
            for (const other of [...this._tiles, ...this.headerButtons()]) {
                if (other !== item && other.hover)
                    other.hover = false;
            }
        });
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
        this._setAnchor(null);
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

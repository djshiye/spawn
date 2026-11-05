// TileGrid: fixed-column grid of tiles (rows of a vertical box). Tiles are re-parented, never
// recreated, so a re-sync after a model change keeps focus-less state cheap.
//
// No dead zones: the container has no padding and no spacing. The gap between two tiles (and the
// gutter at the left / right edge of the grid, the pane's 8 px edge included) is transparent padding of the
// tiles' own buttons (stylesheet.css), so the whole grid belongs to some tile. The first / last column carry
// the 16 px gutter as inline padding and are that much wider.
//
// Public API:
//   new TileGrid()
//   grid.actor: St.BoxLayout
//   grid.setTiles(tiles: St.Widget[], columns: number, tileWidth: number, size?: PinnedItemSize): void
//                               tileWidth <= 0 leaves the widths alone (list mode: one column of
//                               full-width rows; the grid then carries `spawn-pinned-list`)
//                               size: the pinned-item-size tier, carried as a `spawn-size-*` class
//                               (the same tiles in the same place again is a no-op: keeps the focus)
//   grid.tiles(): St.Widget[]
//   grid.columns: number

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type {PinnedItemSize} from '../../core/settings.js';
import {SIZE_CLASSES, sizeMetrics} from './pinnedSize.js';

/**
 * Transparent gutter at the left / right end of a grid row (padding of the first / last column's tile):
 * the left pane has no padding of its own, so its 8 px edge + the 8 px grid gutter both belong to the tiles.
 */
const GUTTER = 16;

export class TileGrid {
    readonly actor: St.BoxLayout;
    private _tiles: St.Widget[] = [];
    private _columns = 1;
    private _width = -1;

    constructor() {
        this.actor = new St.BoxLayout({
            style_class: 'spawn-tile-grid',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            reactive: true,
        });
    }

    get columns(): number {
        return this._columns;
    }

    tiles(): St.Widget[] {
        return this._tiles;
    }

    setTiles(tiles: St.Widget[], columns: number, tileWidth: number, size: PinnedItemSize = 'Compact'): void {
        const sizeClass = sizeMetrics(size).styleClass;
        for (const c of SIZE_CLASSES) {
            if (c !== sizeClass)
                this.actor.remove_style_class_name(c);
        }
        this.actor.add_style_class_name(sizeClass);

        const same = this._columns === Math.max(1, columns) && this._width === tileWidth && tiles.length > 0 &&
            tiles.length === this._tiles.length && tiles.every((t, i) => t === this._tiles[i] && t.get_parent()?.get_parent() === this.actor);
        // Nothing moved (a model refresh that changed nothing visible): leave the rows alone, so the
        // keyboard focus on a tile survives it.
        if (same)
            return;
        this._columns = Math.max(1, columns);
        this._width = tileWidth;
        this._tiles = tiles;
        // Detach tiles first so destroying the old rows does not destroy them.
        for (const row of this.actor.get_children()) {
            for (const child of row.get_children())
                (row as St.BoxLayout).remove_child(child);
            row.destroy();
        }
        let row: St.BoxLayout | null = null;
        tiles.forEach((tile, i) => {
            if (i % this._columns === 0) {
                // y_expand false: tiles may expand (multi-line labels: equal height per row) without stretching the rows
                row = new St.BoxLayout({style_class: 'spawn-tile-row', y_expand: false});
                this.actor.add_child(row);
            }
            const col = i % this._columns;
            const left = tileWidth > 0 && col === 0;
            const right = tileWidth > 0 && col === this._columns - 1;
            // the gutter is the button's own transparent padding (inline: its class list stays stable)
            tile.set_style(`${left ? `padding-left: ${GUTTER}px;` : ''}${right ? `padding-right: ${GUTTER}px;` : ''}` || null);
            // The tile is `tileWidth` wide where it draws; the gutter is extra, transparent, clickable.
            tile.set_width(tileWidth > 0 ? tileWidth + (left ? GUTTER : 0) + (right ? GUTTER : 0) : -1);
            row?.add_child(tile);
        });
        if (this._columns === 1 && tileWidth <= 0)
            this.actor.add_style_class_name('spawn-pinned-list');
        else
            this.actor.remove_style_class_name('spawn-pinned-list');
    }
}

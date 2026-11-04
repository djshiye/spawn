// TileGrid: fixed-column grid of tiles (rows of a vertical box). Tiles are re-parented, never
// recreated, so a re-sync after a model change keeps focus-less state cheap.
//
// Public API:
//   new TileGrid()
//   grid.actor: St.BoxLayout
//   grid.setTiles(tiles: St.Widget[], columns: number, tileWidth: number): void
//                               tileWidth <= 0 leaves the widths alone (list mode: one column of
//                               full-width rows; the grid then carries `spawn-pinned-list`)
//                               (the same tiles in the same place again is a no-op: keeps the focus)
//   grid.tiles(): St.Widget[]
//   grid.columns: number

import Clutter from 'gi://Clutter';
import St from 'gi://St';

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

    setTiles(tiles: St.Widget[], columns: number, tileWidth: number): void {
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
            if (tileWidth > 0)
                tile.set_width(tileWidth);
            else
                tile.set_width(-1);
            row?.add_child(tile);
        });
        if (this._columns === 1 && tileWidth <= 0)
            this.actor.add_style_class_name('spawn-pinned-list');
        else
            this.actor.remove_style_class_name('spawn-pinned-list');
    }
}

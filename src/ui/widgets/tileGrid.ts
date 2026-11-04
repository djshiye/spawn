// TileGrid: fixed-column grid of tiles (rows of a vertical box). Tiles are re-parented, never
// recreated, so a re-sync after a model change keeps focus-less state cheap.
//
// Public API:
//   new TileGrid()
//   grid.actor: St.BoxLayout
//   grid.setTiles(tiles: St.Widget[], columns: number, tileWidth: number): void
//   grid.tiles(): St.Widget[]
//   grid.columns: number

import Clutter from 'gi://Clutter';
import St from 'gi://St';

export class TileGrid {
    readonly actor: St.BoxLayout;
    private _tiles: St.Widget[] = [];
    private _columns = 1;

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
        this._columns = Math.max(1, columns);
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
                row = new St.BoxLayout({style_class: 'spawn-tile-row'});
                this.actor.add_child(row);
            }
            tile.set_width(tileWidth);
            row?.add_child(tile);
        });
    }
}

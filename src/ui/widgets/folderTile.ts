// FolderTile widget. STUB: signatures are final, renders an empty actor.
//
// Pinned-grid tile for a folder: 2x2 preview of its first apps + name. Click opens FolderView; drop target for apps; context menu offers rename/delete.
//
// Public API:
//   new FolderTile(uuid: string, name: string, icons: Gio.Icon[], host: FolderHost)
//   tile.actor: St.Widget
//   tile.uuid: string
//   tile.update(name: string, icons: Gio.Icon[]): void
//   tile.destroy()
//   FolderHost: {open(uuid: string): void, openContext(tile: St.Widget, uuid: string): void}

import St from 'gi://St';
import type Gio from 'gi://Gio';

export interface FolderHost {
    open(uuid: string): void;
    openContext(tile: St.Widget, uuid: string): void;
}

export class FolderTile {
    readonly actor: St.Widget;

    constructor(private readonly _uuid: string, _name: string, _icons: Gio.Icon[], _host: FolderHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-tile spawn-menu-folder-tile'});
    }

    get uuid(): string {
        return this._uuid;
    }

    update(_name: string, _icons: Gio.Icon[]): void {
        // TODO(ui owner)
    }

    destroy(): void {
        this.actor.destroy();
    }
}

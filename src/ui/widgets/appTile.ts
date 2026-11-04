// AppTile widget. STUB: signatures are final, renders an empty actor.
//
// Pinned-grid tile: icon + label for a Shell.App; click launches (Ctrl keeps menu open per keep-open-on-ctrl-click), right-click/Menu key opens AppContextMenu, draggable.
//
// Public API:
//   new AppTile(app: Shell.App, host: TileHost, opts?: {folderUuid?: string})
//   tile.actor: St.Widget
//   tile.app: Shell.App
//   tile.destroy()
//   TileHost: {launch(app, ctrl: boolean): void, openContext(tile: St.Widget, app): void}

import type Shell from 'gi://Shell';
import St from 'gi://St';

export interface TileHost {
    launch(app: Shell.App, ctrl: boolean): void;
    openContext(tile: St.Widget, app: Shell.App): void;
}

export class AppTile {
    readonly actor: St.Widget;

    constructor(private readonly _app: Shell.App, _host: TileHost, _opts: {folderUuid?: string} = {}) {
        this.actor = new St.Bin({style_class: 'spawn-menu-tile'});
    }

    get app(): Shell.App {
        return this._app;
    }

    destroy(): void {
        this.actor.destroy();
    }
}

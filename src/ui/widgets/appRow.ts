// AppRow widget. STUB: signatures are final, renders an empty actor.
//
// List row for a Shell.App (All Apps / Frequent / search results of kind app): icon, name, optional description (apps-show-extra-details). Launch + context menu like AppTile.
//
// Public API:
//   new AppRow(app: Shell.App, host: TileHost)
//   row.actor: St.Widget
//   row.app: Shell.App
//   row.destroy()

import St from 'gi://St';
import type Shell from 'gi://Shell';
import type {TileHost} from './appTile.js';

export class AppRow {
    readonly actor: St.Widget;

    constructor(private readonly _app: Shell.App, _host: TileHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-row'});
    }

    get app(): Shell.App {
        return this._app;
    }

    destroy(): void {
        this.actor.destroy();
    }
}

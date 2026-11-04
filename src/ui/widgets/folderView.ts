// FolderView widget. STUB: signatures are final, renders an empty actor.
//
// Contents of one pinned folder, shown in place of the grid with a header (back button, editable name). Reads Services.pinned.folderApps(uuid); supports drag reorder and drag-out.
//
// Public API:
//   new FolderView(scope: Scope, services: Services, host: FolderViewHost)
//   view.actor: St.Widget
//   view.show(uuid: string): void
//   view.destroy()
//   FolderViewHost: TileHost & {back(): void}

import St from 'gi://St';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {TileHost} from './appTile.js';

export type FolderViewHost = TileHost & {back(): void};

export class FolderView {
    readonly actor: St.Widget;

    constructor(_scope: Scope, _services: Services, _host: FolderViewHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-folder-view'});
    }

    show(_uuid: string): void {
        // TODO(ui owner)
    }

    destroy(): void {
        this.actor.destroy();
    }
}

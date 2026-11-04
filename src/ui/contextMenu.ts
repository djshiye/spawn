// AppContextMenu: the app right-click / Menu-key / Shift+F10 menu. STUB: signatures are final.
//
// Responsibility: open windows (activate), New Window, desktop actions, Pin/Unpin to the
// menu, Add to folder (submenu), App details (Software), Quit. Uses Services.pinned and
// Shell.App; closes itself and calls `host.close()` when an item launches something.
//
// Public API:
//   new AppContextMenu(scope, services, host)
//   menu.open(source: St.Widget, target: ContextTarget): void   popup at `source`
//   menu.close(): void
//   ContextTarget: {kind: 'app', app: Shell.App, folderUuid?: string} | {kind: 'folder', uuid: string}

import type St from 'gi://St';
import type Shell from 'gi://Shell';

import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {LayoutHost} from './layout.js';

export type ContextTarget =
    | {kind: 'app'; app: Shell.App; folderUuid?: string}
    | {kind: 'folder'; uuid: string};

export class AppContextMenu {
    constructor(_scope: Scope, _services: Services, _host: LayoutHost) {}

    open(_source: St.Widget, _target: ContextTarget): void {
        // TODO(ui owner)
    }

    close(): void {
        // TODO(ui owner)
    }
}

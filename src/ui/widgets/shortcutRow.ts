// ShortcutRow widget. STUB: signatures are final, renders an empty actor.
//
// Right-pane shortcut (directory, application or separator) built from one Entry of directory-shortcuts / application-shortcuts. Resolves SpawnMenu_* ids (core/constants.ts ShortcutId), .desktop ids and paths/commands.
//
// Public API:
//   new ShortcutRow(entry: Entry, host: ShortcutHost)
//   row.actor: St.Widget
//   row.destroy()
//   ShortcutHost: {close(): void}

import St from 'gi://St';
import type {Entry} from '../../core/settings.js';

export interface ShortcutHost {
    close(): void;
}

export class ShortcutRow {
    readonly actor: St.Widget;

    constructor(_entry: Entry, _host: ShortcutHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-shortcut-row'});
    }

    destroy(): void {
        this.actor.destroy();
    }
}

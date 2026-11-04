// UserCard widget. STUB: signatures are final, renders an empty actor.
//
// Avatar (round/square per avatar-style, from AccountsService / GnomeDesktop user) + real name; click opens the Users panel in Settings. Hidden when show-user-avatar is false.
//
// Public API:
//   new UserCard(scope: Scope, settings: SpawnSettings, host: ShortcutHost)
//   card.actor: St.Widget
//   card.destroy()

import St from 'gi://St';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {ShortcutHost} from './shortcutRow.js';

export class UserCard {
    readonly actor: St.Widget;

    constructor(_scope: Scope, _settings: SpawnSettings, _host: ShortcutHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-user-card'});
    }

    destroy(): void {
        this.actor.destroy();
    }
}

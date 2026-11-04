// PowerBar widget. STUB: signatures are final, renders an empty actor.
//
// Power buttons from `power-options` (a(ib), ids = PowerType) in `power-display-style` (Default / In_Line / Menu): log out, lock, restart, power off, suspend, hybrid sleep, hibernate, switch user. Uses Main.panel.statusArea.quickSettings system actions / session manager D-Bus.
//
// Public API:
//   new PowerBar(scope: Scope, settings: SpawnSettings, host: ShortcutHost)
//   bar.actor: St.Widget
//   bar.destroy()

import St from 'gi://St';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {ShortcutHost} from './shortcutRow.js';

export class PowerBar {
    readonly actor: St.Widget;

    constructor(_scope: Scope, _settings: SpawnSettings, _host: ShortcutHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-power-bar'});
    }

    destroy(): void {
        this.actor.destroy();
    }
}

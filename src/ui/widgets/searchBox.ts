// SearchBox widget. STUB: signatures are final, renders an empty actor.
//
// Search entry (St.Entry with search/clear icons, border radius from search-entry-border-radius). Emits text changes to the layout, handles Escape/Down/Return and type-to-search focus forwarding.
//
// Public API:
//   new SearchBox(scope: Scope, settings: SpawnSettings)
//   box.actor: St.Widget
//   box.text: string (get/set)
//   box.onTextChanged(scope, cb: (text: string) => void)
//   box.focus(): void
//   box.clear(): void
//   box.destroy()

import St from 'gi://St';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';

export class SearchBox {
    readonly actor: St.Widget;

    constructor(_scope: Scope, _settings: SpawnSettings) {
        this.actor = new St.Bin({style_class: 'spawn-menu-search-box'});
    }

    text = '';

    onTextChanged(_scope: Scope, _cb: (text: string) => void): void {
        // TODO(ui owner)
    }

    focus(): void {
        // TODO(ui owner)
    }

    clear(): void {
        this.text = '';
    }

    destroy(): void {
        this.actor.destroy();
    }
}

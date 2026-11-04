// ResultList widget. STUB: signatures are final, renders an empty actor.
//
// Streaming search results: one section per SearchBatch (provider title + rows). Keyboard navigable, Return activates, highlights matched terms when highlight-search-result-terms is set.
//
// Public API:
//   new ResultList(scope: Scope, settings: SpawnSettings, host: ShortcutHost)
//   list.actor: St.Widget
//   list.reset(): void
//   list.addBatch(batch: SearchBatch): void
//   list.destroy()

import St from 'gi://St';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import type {SearchBatch} from '../../search/engine.js';
import type {ShortcutHost} from './shortcutRow.js';

export class ResultList {
    readonly actor: St.Widget;

    constructor(_scope: Scope, _settings: SpawnSettings, _host: ShortcutHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-result-list'});
    }

    reset(): void {
        // TODO(ui owner)
    }

    addBatch(_batch: SearchBatch): void {
        // TODO(ui owner)
    }

    destroy(): void {
        this.actor.destroy();
    }
}

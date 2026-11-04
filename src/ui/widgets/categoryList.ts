// CategoryList widget. STUB: signatures are final, renders an empty actor.
//
// All Apps view: category buttons on the left of the list / sections of rows. Backed by AppIndex.categories(); rebuilt incrementally on AppIndex.onChanged.
//
// Public API:
//   new CategoryList(scope: Scope, services: Services, host: TileHost)
//   list.actor: St.Widget
//   list.showCategory(id: string): void   ('all' | 'frequent' | GMenu id)
//   list.refresh(): void
//   list.destroy()

import St from 'gi://St';
import type {Scope} from '../../core/scope.js';
import type {Services} from '../../core/services.js';
import type {TileHost} from './appTile.js';

export class CategoryList {
    readonly actor: St.Widget;

    constructor(_scope: Scope, _services: Services, _host: TileHost) {
        this.actor = new St.Bin({style_class: 'spawn-menu-category-list'});
    }

    showCategory(_id: string): void {
        // TODO(ui owner)
    }

    refresh(): void {
        // TODO(ui owner)
    }

    destroy(): void {
        this.actor.destroy();
    }
}

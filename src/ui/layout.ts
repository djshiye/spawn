// SpawnLayout: the two-pane "spawn" layout (ArcMenu's "arcmenu" layout, see
// docs/research/layout.md). STUB: renders only a "Spawn Menu" label.
//
// Responsibility: build the whole menu content as ONE St actor (`layout.actor`) that
// SpawnPopup places inside its popup. Built lazily by SpawnPopup on first open. Left pane:
// search entry, main view (pinned / all apps by category / frequent), back + all-apps
// buttons; right pane: avatar, directory shortcuts, application shortcuts, power bar.
// Uses ui/widgets/*, ui/contextMenu.ts, ui/dnd.ts and Services.
//
// Public API:
//   new SpawnLayout(scope, services, host)
//   layout.actor: St.Widget            content root (class "spawn-menu-layout")
//   layout.onOpen(): void              menu is about to be shown (reset view, focus search)
//   layout.onClosed(): void            menu was hidden (clear search, release caches)
//   layout.handleKey(event): boolean   optional key routing hook (type-to-search etc.)
//   LayoutHost                         what the layout may ask of the popup: {close()}

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import type {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';

export interface LayoutHost {
    /** Close the popup (e.g. after launching an app). */
    close(): void;
}

export class SpawnLayout {
    readonly actor: St.BoxLayout;

    constructor(scope: Scope, _services: Services, _host: LayoutHost) {
        this.actor = new St.BoxLayout({
            style_class: 'spawn-menu-layout',
            orientation: Clutter.Orientation.VERTICAL,
        });
        this.actor.add_child(new St.Label({
            text: 'Spawn Menu',
            style_class: 'spawn-menu-placeholder-label',
        }));
        scope.add(() => this.actor.destroy(), 'SpawnLayout actor');
    }

    onOpen(): void {}

    onClosed(): void {}

    handleKey(_event: unknown): boolean {
        return false;
    }
}

// AppIndex: the application catalogue. STUB: signatures are final, bodies are inert.
//
// Responsibility: wrap Shell.AppSystem + the GMenu tree (categories) + Shell.AppUsage
// (frequent). Built ONCE lazily (`build()` on first menu open or on idle after
// startup-complete) and patched incrementally; rebuild is debounced 150 ms on
// Shell.AppSystem 'installed-changed'. No UI imports.
//
// Public API (do not change without telling the other module owners):
//   new AppIndex(scope)
//   index.built: boolean
//   index.build(): void                     idempotent; connects change signals into `scope`
//   index.apps(): Shell.App[]               all visible apps, sorted by display name
//   index.get(id: string): Shell.App | null lookup by desktop id ("org.gnome.Nautilus.desktop")
//   index.categories(): AppCategory[]       ordered; apps inside are sorted by name
//   index.frequent(limit: number): Shell.App[]
//   index.searchEntries(): AppSearchEntry[] precomputed normalised keys for search/providers/apps
//   index.onChanged(scope, cb)              cb() after any incremental update

import type Shell from 'gi://Shell';

import type {Scope} from '../core/scope.js';

export interface AppCategory {
    /** GMenu directory id, e.g. "Utilities"; special ids: "all", "frequent". */
    id: string;
    name: string;
    iconName: string;
    apps: Shell.App[];
}

export interface AppSearchEntry {
    app: Shell.App;
    id: string;
    name: string;
    /** Lower-cased, diacritics-folded, deduplicated strings to match against. */
    keys: string[];
}

export class AppIndex {
    private readonly _scope: Scope;
    private _built = false;

    constructor(scope: Scope) {
        this._scope = scope;
    }

    get built(): boolean {
        return this._built;
    }

    build(): void {
        // TODO(model owner): build the index, connect Shell.AppSystem 'installed-changed'
        // through this._scope.connect, debounce with core/debounce.
        void this._scope;
        this._built = true;
    }

    apps(): Shell.App[] {
        return [];
    }

    get(_id: string): Shell.App | null {
        return null;
    }

    categories(): AppCategory[] {
        return [];
    }

    frequent(_limit: number): Shell.App[] {
        return [];
    }

    searchEntries(): AppSearchEntry[] {
        return [];
    }

    onChanged(_scope: Scope, _cb: () => void): void {
        // TODO(model owner)
    }
}

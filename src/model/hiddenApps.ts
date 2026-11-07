// Hidden apps: pure helpers for the `hidden-apps` setting (desktop ids the user hid from the menu).
//
// "Hide from Menu" only removes an app from the lists Spawn generates (All Apps, the categories,
// Frequent and the "New" markers). A pinned app stays pinned (pinning is explicit), and search can
// still find hidden apps while `search-hidden-apps` is on. No gi:// imports: unit-tested under gjs.
//
// Public API:
//   hiddenSet(ids): Set<string>                 the ids as a set (empty / non-string entries dropped)
//   addHidden(ids, id): string[]                `ids` plus `id` (unchanged copy when already there)
//   removeHidden(ids, id): string[]             `ids` without `id`
//   filterHidden(items, idOf, hidden): T[]      the items whose id is not hidden (same array when nothing is)
//   filterCategories(categories, idOf, hidden)  categories with their hidden apps removed; a category left
//                                               empty is dropped. Category objects are copied, never mutated

export function hiddenSet(ids: readonly string[]): Set<string> {
    return new Set(ids.filter(id => typeof id === 'string' && id !== ''));
}

export function addHidden(ids: readonly string[], id: string): string[] {
    return ids.includes(id) || id === '' ? [...ids] : [...ids, id];
}

export function removeHidden(ids: readonly string[], id: string): string[] {
    return ids.filter(x => x !== id);
}

export function filterHidden<T>(items: readonly T[], idOf: (item: T) => string, hidden: ReadonlySet<string>): T[] {
    if (hidden.size === 0)
        return items as T[];
    return items.filter(item => !hidden.has(idOf(item)));
}

export function filterCategories<A, C extends {apps: A[]}>(categories: readonly C[], idOf: (app: A) => string, hidden: ReadonlySet<string>): C[] {
    if (hidden.size === 0)
        return categories as C[];
    const out: C[] = [];
    for (const category of categories) {
        const apps = category.apps.filter(app => !hidden.has(idOf(app)));
        if (apps.length > 0)
            out.push({...category, apps});
    }
    return out;
}

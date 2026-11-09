// ShellPopups: closes the OTHER popup menus of the shell (calendar / notifications, quick settings, a tray icon's
// menu, any panel button's menu) before Spawn opens its own.
//
// Super (or Spawn's hotkey, the D-Bus Toggle, the runner's hotkey) works while another menu holds the shell's
// grab, because Spawn widens the overlay-key mask to the popup action mode. Without this, the menu opened on top
// of the calendar or the quick settings and two menus overlapped. Like pressing the Activities button or opening
// another panel menu, opening Spawn now closes the other menu first (no animation, so the two never overlap even
// for a frame).
//
// Only menus that are open are closed, and never the ones listed in `keep` (Spawn's own). Everything is duck-typed
// and wrapped in try/catch: an API change turns this into a no-op, never into an error in the menu.
//
// Public API:
//   closeShellPopups(deps, keep?): number    closes the open menus deps.menus() returns (not those in `keep`);
//                                            returns how many it closed
//     deps: {menus(): unknown[] (every shell menu to consider, re-read on every call), close(menu): void}
//   isMenuOpen(menu): boolean                 `menu.isOpen === true`
//   menusOfStatusArea(statusArea): unknown[]  the `.menu` of every indicator in Main.panel.statusArea

export interface ShellPopupDeps {
    menus: () => unknown[];
    close: (menu: unknown) => void;
}

export function isMenuOpen(menu: unknown): boolean {
    try {
        return (menu as {isOpen?: unknown} | null)?.isOpen === true;
    } catch {
        return false;
    }
}

export function menusOfStatusArea(statusArea: unknown): unknown[] {
    const out: unknown[] = [];
    try {
        if (!statusArea || typeof statusArea !== 'object')
            return out;
        for (const indicator of Object.values(statusArea as Record<string, unknown>)) {
            const menu = (indicator as {menu?: unknown} | null)?.menu;
            if (menu)
                out.push(menu);
        }
    } catch {
        // an indicator that throws on access: ignore it
    }
    return out;
}

export function closeShellPopups(deps: ShellPopupDeps, keep: readonly unknown[] = []): number {
    let closed = 0;
    try {
        const seen = new Set<unknown>(keep);
        for (const menu of deps.menus()) {
            if (!menu || seen.has(menu))
                continue;
            seen.add(menu);
            if (!isMenuOpen(menu))
                continue;
            try {
                deps.close(menu);
                closed++;
            } catch {
                // one stubborn menu must not keep Spawn from opening
            }
        }
    } catch {
        // see above
    }
    return closed;
}

// PanelClickThrough: a click on a panel launcher while the menu is open does what it says, in ONE click.
//
// While the popup is open, the shell's grab owns the pointer: a press outside the popup only closes it and
// is swallowed, so a click on a Dash to Panel pinned app (or any other launcher button in the panel) just
// closes the menu, and the user has to click again. Over a fullscreen game that second click is not even
// possible, because the panel hides again as soon as the menu closes (panel/fullscreenReveal.ts). Like the
// Windows taskbar under an open Start menu, Spawn now passes that click on: when the menu closes because of
// a primary or middle press on a button in the panel the menu belongs to, that button gets the click
// (`clicked` with the same mouse button, which is what a Dash to Panel app icon launches or focuses on).
//
// Only St.Button-like actors inside the anchor's own panel box are clicked, never the Spawn button itself
// (that click closes the menu, as before), and never for a right click (which would only open a context
// menu over a panel that may be about to hide). The target is resolved when the menu closes, before the
// panel is hidden, and clicked on idle, once the grab is gone. Everything is duck-typed and wrapped in
// try/catch: an API change turns this into a no-op.
//
// Public API:
//   panelClickTarget(click, anchor, deps)   the button the closing click landed on, or null
//     click: {x, y, button} of the press / release that closed the menu (null: not a pointer close)
//     deps:  {panels(): unknown[] (panel boxes), actorAt(x, y), isButton(actor)}
//   PRIMARY / MIDDLE                        the mouse buttons that are passed on

export const PRIMARY = 1;
export const MIDDLE = 2;

export interface ClickLike {
    x: number;
    y: number;
    button: number;
}

interface ActorLike {
    contains?: (actor: unknown) => boolean;
    get_parent?: () => unknown;
}

export interface PanelClickDeps {
    /** The panel boxes Spawn knows (the shell's own and Dash to Panel's), re-read on every call. */
    panels: () => unknown[];
    /** The reactive actor under a stage point. */
    actorAt: (x: number, y: number) => unknown;
    isButton: (actor: unknown) => boolean;
}

function contains(outer: unknown, inner: unknown): boolean {
    try {
        return Boolean((outer as ActorLike | null)?.contains?.(inner));
    } catch {
        return false;
    }
}

export function panelClickTarget(click: ClickLike | null, anchor: unknown, deps: PanelClickDeps): unknown {
    try {
        if (!click || !anchor || (click.button !== PRIMARY && click.button !== MIDDLE))
            return null;
        const box = deps.panels().find(b => contains(b, anchor));
        if (!box)
            return null;
        const hit = deps.actorAt(click.x, click.y);
        if (!hit || !contains(box, hit) || contains(anchor, hit))
            return null;
        // The nearest button around the hit actor, but not above the panel box.
        for (let a: unknown = hit; a && a !== box; a = (a as ActorLike).get_parent?.()) {
            if (contains(anchor, a))
                return null;
            if (deps.isButton(a))
                return a;
        }
        return null;
    } catch {
        return null;
    }
}

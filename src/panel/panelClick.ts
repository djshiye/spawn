// PanelClickThrough: a click on ANY panel button while the menu is open does what it says, in ONE click.
//
// While the popup is open, the shell's grab owns the pointer: a press outside the popup only closes it and
// is swallowed, so a click on the clock, quick settings, a tray icon, Activities or a Dash to Panel pinned app
// just closes the menu, and the user has to click again. Over a fullscreen game that second click is not even
// possible, because the panel hides again as soon as the menu closes (panel/fullscreenReveal.ts). Like the
// Windows taskbar under an open Start menu, Spawn now passes that click on: when the menu closes because of
// a press on a button in ANY panel (the top bar, Dash to Panel's panel on every monitor, not only the one the
// menu was opened from), that button gets the click, with the same mouse button (panelClickAction):
//   - an St.Button (a Dash to Panel app icon) emits `clicked` with the primary or middle button (launch / new
//     window); a right click on it opens its own context menu (Dash to Panel's `popupMenu()`), as a right
//     click on it does without Spawn in the way (an St.Button without one, like Show Apps, just gets nothing);
//   - Activities (primary) opens the Overview;
//   - a panel menu button that uses the shell's own click gesture (the clock, quick settings, the system
//     status icons, most extension indicators) toggles its menu, with any button the gesture accepts (in
//     GNOME 49+ that is any button: a right click on the clock opens the calendar too);
//   - a panel button that handles raw presses itself (tray icons of the AppIndicator extension: Steam, Slack,
//     Discord...; legacy tray icons) gets the press itself, replayed, so left (menu or activate), middle
//     (secondary activate) and right click (menu) do exactly what that extension does for them.
//
// Only buttons inside a known panel box are clicked, never the Spawn button the menu opened from (that click
// closes the menu, as before). The target is resolved when the menu closes, before a fullscreen panel is
// hidden again, and activated on idle, once the grab is gone. Everything is duck-typed and wrapped in
// try/catch: an API change turns this into a no-op.
//
// Public API:
//   panelClickTarget(click, anchor, deps)   the button the closing click landed on, or null
//     click: {x, y, button} of the press / release that closed the menu (null: not a pointer close)
//     anchor: the Spawn button the menu is open on (never a target)
//     deps:  {panels(): unknown[] (every panel box), actorAt(x, y), isButton(actor)}
//   panelClickAction(kind, button, canReplay)  what to do with that button: 'clicked' | 'overview' | 'toggle'
//                                          | 'replay' | 'context' | null (see PanelButtonKind)
//   PRIMARY / MIDDLE / SECONDARY            the mouse buttons

export const PRIMARY = 1;
export const MIDDLE = 2;
export const SECONDARY = 3;

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
    /** Every panel box Spawn knows (the shell's own and Dash to Panel's, on every monitor), re-read on every call. */
    panels: () => unknown[];
    /** The reactive actor under a stage point. */
    actorAt: (x: number, y: number) => unknown;
    /** A clickable panel button: an St.Button or a panel menu button (clock, quick settings, an indicator). */
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
        if (!click || !anchor || (click.button !== PRIMARY && click.button !== MIDDLE && click.button !== SECONDARY))
            return null;
        const hit = deps.actorAt(click.x, click.y);
        if (!hit || contains(anchor, hit))
            return null;
        // Any panel, not only the anchor's: the clock, quick settings and a second monitor's panel count too.
        const box = deps.panels().find(b => contains(b, hit));
        if (!box)
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

/**
 * What kind of panel button the click landed on (targets.ts panelButtonKind reads it off the live actor):
 *   'launcher'    an St.Button (a Dash to Panel app icon, Show Apps)
 *   'activities'  the shell's Activities button
 *   'gesture'     a panel menu button opened by the shell's click gesture; `gestureButton` is the one mouse
 *                 button that gesture wants (0: any)
 *   'raw'         a panel button that turned the gesture off and handles presses itself (AppIndicator / tray)
 */
export type PanelButtonKind =
    | {kind: 'launcher'}
    | {kind: 'activities'}
    | {kind: 'gesture'; gestureButton: number}
    | {kind: 'raw'}
    | null;

/** 'context': open the launcher's own context menu (targets.ts calls its `popupMenu()`). */
export type PanelClickAction = 'clicked' | 'overview' | 'toggle' | 'replay' | 'context' | null;

/**
 * What passing `button` on to a button of that kind means. `canReplay`: the closing event was a press that can
 * be delivered to the button again (a raw button needs the press; without it, primary / right toggle its menu).
 */
export function panelClickAction(kind: PanelButtonKind, button: number, canReplay: boolean): PanelClickAction {
    if (!kind || (button !== PRIMARY && button !== MIDDLE && button !== SECONDARY))
        return null;
    switch (kind.kind) {
    case 'launcher':
        return button === SECONDARY ? 'context' : 'clicked';
    case 'activities':
        return button === PRIMARY ? 'overview' : null;
    case 'gesture':
        return kind.gestureButton === 0 || kind.gestureButton === button ? 'toggle' : null;
    case 'raw':
        if (canReplay)
            return 'replay';
        return button === MIDDLE ? null : 'toggle';
    default:
        return null;
    }
}

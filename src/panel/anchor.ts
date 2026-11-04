// pickAnchor: which panel button a Super / accelerator / D-Bus toggle should open the menu on.
//
// Pure (no shell imports), unit-tested in tests/core-anchor.test.js.
//
// Public API:
//   pickAnchor(buttons, monitorOf, pointerMonitor): T | null
//     the button whose monitor is `pointerMonitor` (the first such button when several share the
//     monitor), else the first button, else null.

export function pickAnchor<T>(buttons: readonly T[], monitorOf: (button: T) => number, pointerMonitor: number): T | null {
    if (pointerMonitor >= 0) {
        for (const button of buttons) {
            let index = -1;
            try {
                index = monitorOf(button);
            } catch {
                index = -1;
            }
            if (index === pointerMonitor)
                return button;
        }
    }
    return buttons[0] ?? null;
}

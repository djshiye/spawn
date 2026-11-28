// Shortcut-capture dialog for the custom menu hotkey.
//
// Public API:
//   captureShortcut(parent, current): Promise<string | null | undefined>
//     resolves to the accelerator string ('<Super>space'), '' to clear it, or undefined if
//     the user cancelled. (null is never returned; the union keeps callers explicit.)
//     A global shortcut needs Ctrl, Alt or Super (Shift alone would steal normal typing), except
//     for the F1-F12 and Menu keys. Enter confirms a captured combination; Tab moves focus.
//   keyAction(keyval, mask, pending, otherButtonFocused): KeyAction
//     the pure key decision, exported for tests.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

const GLOBAL_MODS = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.META_MASK;

function isAllowed(keyval: number, mask: number): boolean {
    if (keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F12 || keyval === Gdk.KEY_Menu)
        return true;
    return (mask & GLOBAL_MODS) !== 0;
}

export type KeyAction =
    | {kind: 'cancel'} | {kind: 'clear'} | {kind: 'confirm'} | {kind: 'pass'}
    | {kind: 'ignore'} | {kind: 'warn'} | {kind: 'capture', accel: string};

const TAB_KEYS = [Gdk.KEY_Tab, Gdk.KEY_ISO_Left_Tab, Gdk.KEY_KP_Tab];
const CONFIRM_KEYS = [Gdk.KEY_Return, Gdk.KEY_KP_Enter, Gdk.KEY_ISO_Enter, Gdk.KEY_space, Gdk.KEY_KP_Space];

/** What a key press in the capture dialog does. `mask` is already reduced with accelerator_get_default_mod_mask().
 *  `pending`: a combination has been captured. `otherButtonFocused`: focus is on a button other than "Set Shortcut"
 *  (e.g. the header bar's close button), whose own Return / Space activation must win. */
export function keyAction(keyval: number, mask: number, pending: boolean, otherButtonFocused: boolean): KeyAction {
    if (keyval === Gdk.KEY_Escape && mask === 0)
        return {kind: 'cancel'};
    if (keyval === Gdk.KEY_BackSpace && mask === 0)
        return {kind: 'clear'};
    // Tab can never be a shortcut (accelerator_valid rejects it); let GTK move the focus.
    if (TAB_KEYS.includes(keyval))
        return {kind: 'pass'};
    if (CONFIRM_KEYS.includes(keyval) && mask === 0) {
        if (otherButtonFocused)
            return {kind: 'pass'};
        return pending ? {kind: 'confirm'} : {kind: 'warn'};
    }
    const lower = Gdk.keyval_to_lower(keyval);
    // Modifier-only keys are invalid; an unmodified key is only accepted when isAllowed() (F1-F12, Menu).
    if (!Gtk.accelerator_valid(lower, mask))
        return {kind: 'ignore'};
    if (!isAllowed(lower, mask))
        return {kind: 'warn'};
    return {kind: 'capture', accel: Gtk.accelerator_name(lower, mask)};
}

export function captureShortcut(parent: Gtk.Widget, current: string): Promise<string | null | undefined> {
    return new Promise(resolve => {
        let result: string | undefined;
        let pending: string | null = null;

        const dialog = new Adw.Dialog({title: 'Set Shortcut', content_width: 400, can_close: true});
        const toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(new Adw.HeaderBar());

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 18,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 24,
            margin_end: 24,
        });
        const hint = new Gtk.Label({
            label: 'Press the key combination you want to use, then Enter to set it.\nEsc cancels, Backspace clears the shortcut.',
            justify: Gtk.Justification.CENTER,
            wrap: true,
        });
        const warning = new Gtk.Label({
            label: 'Use Ctrl, Alt or Super with the key, so the shortcut does not interfere with typing.',
            css_classes: ['dim-label', 'caption'],
            justify: Gtk.Justification.CENTER,
            wrap: true,
            visible: false,
        });
        const shown = new Gtk.ShortcutLabel({
            accelerator: current,
            halign: Gtk.Align.CENTER,
            disabled_text: 'No shortcut',
        });
        const apply = new Gtk.Button({label: 'Set Shortcut', halign: Gtk.Align.CENTER, sensitive: false, css_classes: ['suggested-action', 'pill']});
        box.append(hint);
        box.append(warning);
        box.append(shown);
        box.append(apply);
        toolbar.set_content(box);
        dialog.set_child(toolbar);

        const confirm = () => {
            result = pending ?? undefined;
            dialog.close();
        };

        const keys = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        keys.connect('key-pressed', (_c: Gtk.EventControllerKey, keyval: number, _keycode: number, state: Gdk.ModifierType) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            const focus = (dialog.get_root() as Gtk.Window | null)?.get_focus() ?? null;
            const btn = focus instanceof Gtk.Button ? focus : focus?.get_ancestor(Gtk.Button.$gtype) ?? null;
            const action = keyAction(keyval, mask, pending !== null, btn !== null && btn !== apply);
            switch (action.kind) {
            case 'cancel':
                dialog.close();
                return true;
            case 'clear':
                result = '';
                dialog.close();
                return true;
            case 'confirm':
                confirm();
                return true;
            case 'pass':
                return false;
            case 'ignore':
                return true;
            case 'warn':
                warning.set_visible(true);
                return true;
            case 'capture':
                warning.set_visible(false);
                pending = action.accel;
                shown.set_accelerator(pending);
                apply.set_sensitive(true);
                // So a screen reader announces the button and Enter / Space on it is the obvious next step.
                apply.grab_focus();
                return true;
            }
        });
        dialog.add_controller(keys);

        apply.connect('clicked', confirm);
        dialog.connect('closed', () => resolve(result));
        dialog.present(parent);
    });
}

// Shortcut-capture dialog for the custom menu hotkey.
//
// Public API:
//   captureShortcut(parent, current): Promise<string | null | undefined>
//     resolves to the accelerator string ('<Super>space'), '' to clear it, or undefined if
//     the user cancelled. (null is never returned; the union keeps callers explicit.)
//     A global shortcut needs Ctrl, Alt or Super (Shift alone would steal normal typing), except
//     for the F1-F12 and Menu keys.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

const GLOBAL_MODS = Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.ALT_MASK | Gdk.ModifierType.SUPER_MASK | Gdk.ModifierType.META_MASK;

function isAllowed(keyval: number, mask: number): boolean {
    if (keyval >= Gdk.KEY_F1 && keyval <= Gdk.KEY_F12 || keyval === Gdk.KEY_Menu)
        return true;
    return (mask & GLOBAL_MODS) !== 0;
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
            label: 'Press the key combination you want to use.\nEsc cancels, Backspace clears the shortcut.',
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

        const keys = new Gtk.EventControllerKey({propagation_phase: Gtk.PropagationPhase.CAPTURE});
        keys.connect('key-pressed', (_c: Gtk.EventControllerKey, keyval: number, _keycode: number, state: Gdk.ModifierType) => {
            const mask = state & Gtk.accelerator_get_default_mod_mask();
            if (keyval === Gdk.KEY_Escape && mask === 0) {
                dialog.close();
                return true;
            }
            if (keyval === Gdk.KEY_BackSpace && mask === 0) {
                result = '';
                dialog.close();
                return true;
            }
            const lower = Gdk.keyval_to_lower(keyval);
            // Modifier-only keys are invalid; an unmodified key is only accepted when isAllowed() (F1-F12, Menu).
            if (!Gtk.accelerator_valid(lower, mask))
                return true;
            if (!isAllowed(lower, mask)) {
                warning.set_visible(true);
                return true;
            }
            warning.set_visible(false);
            pending = Gtk.accelerator_name(lower, mask);
            shown.set_accelerator(pending);
            apply.set_sensitive(true);
            return true;
        });
        dialog.add_controller(keys);

        apply.connect('clicked', () => {
            result = pending ?? undefined;
            dialog.close();
        });
        dialog.connect('closed', () => resolve(result));
        dialog.present(parent);
    });
}

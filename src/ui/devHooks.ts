// Dev-only D-Bus hooks for driving the menu UI from the headless dev shell (tools/dev-shell*).
//
// Exported ONLY while the `dev-mode` setting is true (follows the setting live), on the object
// /io/github/djshiye/SpawnMenu/Ui, interface io.github.djshiye.SpawnMenu.Ui, over the same bus
// connection that owns io.github.djshiye.SpawnMenu (so it is reachable with that destination).
//
//   Search(s query)          type `query` into the search entry
//   ShowView(s id)           pinned | frequent | categories | all | results | default
//   OpenFolder(i index)      open the n-th pinned folder
//   Key(s name)              inject a key press+release through a virtual keyboard
//                            ("Down", "Return", "Tab", "Menu", "Escape", "a", ...);
//                            "Shift+F10" style modifiers: "Shift+Tab", "Ctrl+a"
//   Click(i x, i y, i btn)   move there, then click (async, ~250 ms)
//   Move(i x, i y)           move the virtual pointer
//   Drag(i x1, i y1, i x2, i y2)  press at 1, hold 300 ms, move in steps, release at 2 (async; ~1 s)
//   Pick(i x, i y) -> s      class + style class of the actor at those stage coordinates
//   State() -> s             JSON: view, focus, counts, popup state
//
// Public API:
//   installUiDevHooks(scope, settings, popup): void

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import type {SpawnPopup} from './menu.js';

const PATH = '/io/github/djshiye/SpawnMenu/Ui';
const IFACE = `
<node>
  <interface name="io.github.djshiye.SpawnMenu.Ui">
    <method name="Search"><arg type="s" direction="in" name="query"/></method>
    <method name="ShowView"><arg type="s" direction="in" name="id"/></method>
    <method name="OpenFolder"><arg type="i" direction="in" name="index"/></method>
    <method name="Key"><arg type="s" direction="in" name="name"/></method>
    <method name="Click"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/><arg type="i" direction="in" name="button"/></method>
    <method name="Move"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/></method>
    <method name="Drag"><arg type="i" direction="in" name="x1"/><arg type="i" direction="in" name="y1"/><arg type="i" direction="in" name="x2"/><arg type="i" direction="in" name="y2"/></method>
    <method name="Pick"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/><arg type="s" direction="out" name="actor"/></method>
    <method name="State"><arg type="s" direction="out" name="json"/></method>
  </interface>
</node>`;

type Invocation = Gio.DBusMethodInvocation;

const MODIFIERS: Record<string, number> = {
    Shift: Clutter.KEY_Shift_L,
    Ctrl: Clutter.KEY_Control_L,
    Alt: Clutter.KEY_Alt_L,
};

export function installUiDevHooks(scope: Scope, settings: SpawnSettings, popup: SpawnPopup): void {
    let exported: Gio.DBusExportedObject | null = null;
    let keyboard: Clutter.VirtualInputDevice | null = null;
    let pointer: Clutter.VirtualInputDevice | null = null;
    let disposed = false;

    const seat = () => global.stage.get_context().get_backend().get_default_seat();
    const now = () => GLib.get_monotonic_time();

    const reply = (invocation: Invocation, fn: () => GLib.Variant | void) => {
        if (disposed) {
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', 'disabled');
            return;
        }
        try {
            invocation.return_value(fn() ?? null);
        } catch (e) {
            error('ui dev hook failed', e);
            invocation.return_dbus_error('org.freedesktop.DBus.Error.Failed', e instanceof Error ? e.message : String(e));
        }
    };

    const keyval = (name: string): number => {
        if (name.length === 1)
            return Clutter.unicode_to_keysym(name.codePointAt(0) as number);
        const v = (Clutter as unknown as Record<string, unknown>)[`KEY_${name}`];
        if (typeof v !== 'number')
            throw new Error(`unknown key '${name}'`);
        return v;
    };

    const pressKey = (spec: string) => {
        keyboard ??= seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const parts = spec.split('+');
        const key = parts.pop() as string;
        const mods = parts.map(p => MODIFIERS[p]).filter(Boolean);
        let t = now();
        for (const m of mods)
            keyboard.notify_keyval(t++, m, Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(t++, keyval(key), Clutter.KeyState.PRESSED);
        keyboard.notify_keyval(t++, keyval(key), Clutter.KeyState.RELEASED);
        for (const m of mods.reverse())
            keyboard.notify_keyval(t++, m, Clutter.KeyState.RELEASED);
    };

    const impl = {
        SearchAsync: ([q]: [string], inv: Invocation) => reply(inv, () => popup.search(q)),
        ShowViewAsync: ([id]: [string], inv: Invocation) => reply(inv, () => popup.showView(id)),
        OpenFolderAsync: ([i]: [number], inv: Invocation) => reply(inv, () => popup.openFolderByIndex(i)),
        KeyAsync: ([name]: [string], inv: Invocation) => reply(inv, () => pressKey(name)),
        MoveAsync: ([x, y]: [number, number], inv: Invocation) => reply(inv, () => {
            pointer ??= seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            pointer.notify_absolute_motion(now(), x, y);
        }),
        ClickAsync: ([x, y, button]: [number, number, number], inv: Invocation) => reply(inv, () => {
            pointer ??= seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            const dev = pointer;
            dev.notify_absolute_motion(now(), x, y);
            // Let the motion be processed (hover/pick update) before pressing.
            scope.timeout(400, () => {
                dev.notify_button(now(), button, Clutter.ButtonState.PRESSED);
                scope.timeout(60, () => dev.notify_button(now(), button, Clutter.ButtonState.RELEASED));
            });
        }),
        DragAsync: ([x1, y1, x2, y2]: [number, number, number, number], inv: Invocation) => reply(inv, () => {
            pointer ??= seat().create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            const dev = pointer;
            dev.notify_absolute_motion(now(), x1, y1);
            dev.notify_button(now(), 1, Clutter.ButtonState.PRESSED);
            const steps = 8;
            let i = 0;
            const step = () => {
                i++;
                dev.notify_absolute_motion(now(), x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps);
                if (i < steps) {
                    scope.timeout(60, step);
                } else {
                    scope.timeout(250, () => dev.notify_button(now(), 1, Clutter.ButtonState.RELEASED));
                }
            };
            scope.timeout(320, step);
        }),
        PickAsync: ([x, y]: [number, number], inv: Invocation) => reply(inv, () => {
            const a = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y) as Clutter.Actor | null;
            return new GLib.Variant('(s)', [a ? `${a.constructor.name}.${(a as unknown as {style_class?: string}).style_class ?? ''}` : 'none']);
        }),
        StateAsync: (_p: unknown[], inv: Invocation) => reply(inv, () => new GLib.Variant('(s)', [JSON.stringify(popup.debugState())])),
    };

    const sync = () => {
        if (disposed)
            return;
        try {
            const want = settings.get('dev-mode');
            if (want && !exported) {
                exported = Gio.DBusExportedObject.wrapJSObject(IFACE, impl);
                exported.export(Gio.DBus.session, PATH);
            } else if (!want && exported) {
                exported.unexport();
                exported = null;
            }
        } catch (e) {
            error('ui dev hooks export failed', e);
        }
    };

    sync();
    settings.onChanged(scope, ['dev-mode'], sync);
    scope.add(() => {
        disposed = true;
        try {
            exported?.unexport();
        } catch (e) {
            error('ui dev hooks unexport failed', e);
        }
        exported = null;
        keyboard = null;
        pointer = null;
    }, 'ui dev hooks');
}

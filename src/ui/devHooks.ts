// Dev-only D-Bus hooks for driving the menu UI from the headless dev shell (tools/dev-shell*).
//
// Exported ONLY while the `dev-mode` setting is true (follows the setting live), on the object
// /io/github/djshiye/Spawn/Ui, interface io.github.djshiye.Spawn.Ui, over the same bus
// connection that owns io.github.djshiye.Spawn (so it is reachable with that destination).
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
//   Rect(s cls, i nth) -> s  JSON [x, y, w, h] (stage coordinates) of the nth VISIBLE actor whose
//                            style class list contains `cls` (popup, context menu, tooltip), or ""
//                            Scenarios use it to find targets instead of hard-coded pixels.
//   Count(s cls) -> i        how many visible actors carry `cls`
//   FocusActor(s cls, i nth) give the nth visible actor with `cls` the keyboard focus
//   MenuItems(s cls) -> s    JSON: the items of the visible menu whose actor carries `cls` (e.g. spawn-button-menu):
//                            [{kind: 'item'|'separator'|'submenu', label, visible, open?, items?}]
//   Windows() -> s           JSON: [{title, appId, type, minimized, skipTaskbar}] of every window (Show Desktop checks)
//   FocusInfo() -> s         JSON: {type, cls} of the actor holding the keyboard focus (null when none)
//   Dump() -> s              JSON: monitor, anchor, popup rect and every visible actor of the popup /
//                            context menu / tooltip with allocation, padding, margin, colours, font
//                            (the UX audit measurements; see tools/dev/scenarios/ui-ux-measure.sh)
//
// Public API:
//   installUiDevHooks(scope, settings, popup): void

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import type {SpawnPopup} from './menu.js';

const PATH = '/io/github/djshiye/Spawn/Ui';
const IFACE = `
<node>
  <interface name="io.github.djshiye.Spawn.Ui">
    <method name="Search"><arg type="s" direction="in" name="query"/></method>
    <method name="ShowView"><arg type="s" direction="in" name="id"/></method>
    <method name="OpenFolder"><arg type="i" direction="in" name="index"/></method>
    <method name="Key"><arg type="s" direction="in" name="name"/></method>
    <method name="Click"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/><arg type="i" direction="in" name="button"/></method>
    <method name="Move"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/></method>
    <method name="Drag"><arg type="i" direction="in" name="x1"/><arg type="i" direction="in" name="y1"/><arg type="i" direction="in" name="x2"/><arg type="i" direction="in" name="y2"/></method>
    <method name="Pick"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/><arg type="s" direction="out" name="actor"/></method>
    <method name="State"><arg type="s" direction="out" name="json"/></method>
    <method name="Rect"><arg type="s" direction="in" name="cls"/><arg type="i" direction="in" name="nth"/><arg type="s" direction="out" name="rect"/></method>
    <method name="Count"><arg type="s" direction="in" name="cls"/><arg type="i" direction="out" name="count"/></method>
    <method name="FocusActor"><arg type="s" direction="in" name="cls"/><arg type="i" direction="in" name="nth"/></method>
    <method name="MenuItems"><arg type="s" direction="in" name="cls"/><arg type="s" direction="out" name="json"/></method>
    <method name="Windows"><arg type="s" direction="out" name="json"/></method>
    <method name="FocusInfo"><arg type="s" direction="out" name="json"/></method>
    <method name="Dump"><arg type="s" direction="out" name="json"/></method>
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

    // ---- actor inspection (Rect / Count / FocusActor / Dump) ----

    const roots = (): Clutter.Actor[] => {
        const out: Clutter.Actor[] = [];
        const menu = popup.menuActor;
        if (menu)
            out.push(menu);
        for (const c of Main.uiGroup.get_children()) {
            const cls = (c as St.Widget).style_class ?? '';
            if (c !== menu && /spawn-(context-menu|button-menu|tooltip|power-popup)/.test(cls))
                out.push(c);
        }
        return out;
    };

    const hasClass = (a: Clutter.Actor, cls: string): boolean =>
        ` ${(a as St.Widget).style_class ?? ''} `.includes(` ${cls} `);

    // Rect / Count / FocusActor also reach the panel button(s): the main panel box and Dash to Panel's.
    const lookupRoots = (): Clutter.Actor[] => {
        const out = roots();
        const panels = new Set<Clutter.Actor>([Main.layoutManager.panelBox]);
        for (const c of Main.uiGroup.get_children()) {
            if (c.get_name() === 'panelBox' || (c as St.Widget).style_class?.includes('dashtopanelMainPanel'))
                panels.add(c);
        }
        try {
            const dtp = (global as unknown as {dashToPanel?: {panels?: Array<{panelBox?: Clutter.Actor}>}}).dashToPanel;
            for (const p of dtp?.panels ?? []) {
                if (p.panelBox)
                    panels.add(p.panelBox);
            }
        } catch {
            // no Dash to Panel
        }
        out.push(...panels);
        return out;
    };

    const findAll = (cls: string): Clutter.Actor[] => {
        const found: Clutter.Actor[] = [];
        const walk = (a: Clutter.Actor) => {
            if (!a.visible)
                return;
            if (hasClass(a, cls))
                found.push(a);
            for (const c of a.get_children())
                walk(c);
        };
        for (const r of lookupRoots())
            walk(r);
        return found;
    };

    const rectOf = (a: Clutter.Actor): number[] => {
        const [x, y] = a.get_transformed_position();
        const [w, h] = a.get_transformed_size();
        return [x, y, w, h].map(v => Math.round(v * 10) / 10);
    };

    const dump = (): string => {
        const sides: St.Side[] = [St.Side.TOP, St.Side.RIGHT, St.Side.BOTTOM, St.Side.LEFT];
        const col = (c: {red: number; green: number; blue: number; alpha: number}) => [c.red, c.green, c.blue, c.alpha];
        const items: Record<string, unknown>[] = [];
        const walk = (a: Clutter.Actor, depth: number) => {
            if (!a.visible)
                return;
            const [x, y, w, h] = rectOf(a);
            const e: Record<string, unknown> = {d: depth, type: a.constructor.name, x, y, w, h};
            const w2 = a as St.Widget;
            if (w2.style_class)
                e['cls'] = w2.style_class;
            if (a.reactive)
                e['react'] = 1;
            if ((a as St.Widget).can_focus)
                e['focus'] = 1;
            if (a instanceof St.Label)
                e['text'] = a.text;
            if (a instanceof St.Icon) {
                e['icon'] = a.icon_name ?? a.gicon?.to_string() ?? 'gicon';
                e['isize'] = a.icon_size;
            }
            if (a instanceof St.Widget) {
                try {
                    const n = a.get_theme_node();
                    e['pad'] = sides.map(s => n.get_padding(s));
                    e['mar'] = sides.map(s => n.get_margin(s));
                    e['fg'] = col(n.get_foreground_color());
                    e['bg'] = col(n.get_background_color());
                    e['radius'] = n.get_border_radius(St.Corner.TOPLEFT);
                    e['fs'] = n.get_font().get_size() / 1024;
                    e['td'] = n.get_transition_duration();
                } catch (err) {
                    e['err'] = String(err);
                }
            }
            items.push(e);
            for (const c of a.get_children())
                walk(c, depth + 1);
        };
        for (const r of roots())
            walk(r, 0);
        const mon = Main.layoutManager.primaryMonitor;
        const res: Record<string, unknown> = {
            monitor: mon ? [mon.x, mon.y, mon.width, mon.height] : null,
            scale: St.ThemeContext.get_for_stage(global.stage).scale_factor,
            side: popup.side,
            pointer: global.get_pointer(),
            items,
        };
        const anchor = popup.anchor;
        if (anchor)
            res['anchor'] = rectOf(anchor);
        const menu = popup.menuActor;
        if (menu)
            res['menu'] = rectOf(menu);
        const layout = popup.layoutActor;
        if (layout)
            res['layout'] = rectOf(layout);
        return JSON.stringify(res);
    };

    const impl = {
        RectAsync: ([cls, nth]: [string, number], inv: Invocation) => reply(inv, () => {
            const a = findAll(cls)[nth];
            return new GLib.Variant('(s)', [a ? JSON.stringify(rectOf(a)) : '']);
        }),
        CountAsync: ([cls]: [string], inv: Invocation) => reply(inv, () => new GLib.Variant('(i)', [findAll(cls).length])),
        FocusActorAsync: ([cls, nth]: [string, number], inv: Invocation) => reply(inv, () => {
            const a = findAll(cls)[nth];
            if (!a)
                throw new Error(`no visible actor with class '${cls}' at ${nth}`);
            a.grab_key_focus();
        }),
        MenuItemsAsync: ([cls]: [string], inv: Invocation) => reply(inv, () => {
            const actor = findAll(cls)[0];
            const menu = (actor as unknown as {_delegate?: {_getMenuItems?(): Array<Record<string, any>>}} | undefined)?._delegate;
            const describe = (items: Array<Record<string, any>>): unknown[] => items.map(item => {
                const out: Record<string, unknown> = {visible: item.visible};
                if (String(item.style_class ?? '').includes('popup-separator-menu-item')) {
                    out['kind'] = 'separator';
                } else if (item.menu?._getMenuItems) {
                    out['kind'] = 'submenu';
                    out['label'] = item.label?.text ?? '';
                    out['open'] = Boolean(item.menu.isOpen);
                    out['items'] = describe(item.menu._getMenuItems());
                } else {
                    out['kind'] = 'item';
                    out['label'] = item.label?.text ?? '';
                }
                return out;
            });
            return new GLib.Variant('(s)', [JSON.stringify(menu?._getMenuItems ? describe(menu._getMenuItems()) : null)]);
        }),
        WindowsAsync: (_p: unknown[], inv: Invocation) => reply(inv, () => {
            const list = global.display.list_all_windows().map(w => ({
                title: w.title ?? '',
                appId: w.get_gtk_application_id() ?? w.get_wm_class() ?? '',
                type: w.window_type,
                minimized: w.minimized,
                skipTaskbar: w.skip_taskbar,
            }));
            return new GLib.Variant('(s)', [JSON.stringify(list)]);
        }),
        FocusInfoAsync: (_p: unknown[], inv: Invocation) => reply(inv, () => {
            const f = global.stage.key_focus as Clutter.Actor | null;
            const info = f && f !== global.stage ? {type: f.constructor.name, cls: (f as St.Widget).style_class ?? ''} : null;
            return new GLib.Variant('(s)', [JSON.stringify(info)]);
        }),
        DumpAsync: (_p: unknown[], inv: Invocation) => reply(inv, () => new GLib.Variant('(s)', [dump()])),
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

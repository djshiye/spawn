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
//   Tap(i x, i y)            a touchscreen tap (touch begin, 80 ms, touch end) from a virtual touchscreen
//   Drag(i x1, i y1, i x2, i y2)  press at 1, hold 300 ms, move in steps, release at 2 (async; ~1 s)
//   Pick(i x, i y) -> s      class + style class of the actor at those stage coordinates
//   State() -> s             JSON: view, focus, counts, popup state
//   Rect(s cls, i nth) -> s  JSON [x, y, w, h] (stage coordinates) of the nth VISIBLE actor whose
//                            style class list contains `cls` (popup, context menu, tooltip), or ""
//                            Scenarios use it to find targets instead of hard-coded pixels.
//   Count(s cls) -> i        how many visible actors carry `cls`
//   Pseudo(s cls, i nth) -> s  the style pseudo classes of that actor ("hover active ..."), '' when absent
//   TextRect(s text, i nth) -> s   JSON [x, y, w, h] of the nth VISIBLE St.Label whose text is exactly `text`
//                            (a context menu item such as "Hide from Menu"), or ""
//   FocusActor(s cls, i nth) give the nth visible actor with `cls` the keyboard focus
//   MenuItems(s cls) -> s    JSON: the items of the visible menu whose actor carries `cls` (e.g. spawn-button-menu):
//                            [{kind: 'item'|'separator'|'submenu', label, visible, open?, items?}]
//   Windows() -> s           JSON: [{title, appId, type, minimized, skipTaskbar}] of every window (Show Desktop checks)
//   FocusInfo() -> s         JSON: {type, cls, name (accessible name)} of the actor holding the keyboard focus (null when none)
//   HitSweep(s itemCls) -> s JSON: hit-tests every pixel of the visible pinned list / grid (the first visible
//                            `spawn-tile-grid`, clipped to its scroll view) with Clutter.PickMode.REACTIVE and
//                            checks that each point belongs to an actor carrying `itemCls` (spawn-pinned-row /
//                            spawn-tile): {rect, rows, contiguous (the rows start at the grid's top and touch), total, hit,
//                            skipped, misses: [[x, y, picked]...]}.
//                            Every pixel row; columns: the outer 12 px at each end, 6 px around every tile edge and every 5th between.
//                            A grid's partly filled last row is only checked over its tiles' extent.
//   HitSweepIn(s containerCls, s itemCls, s rangeCls) -> s
//                            the same for a vertical list: `containerCls` is the first visible actor with that class (a scroll
//                            view or its content box), clipped to its scroll view. Items are its visible descendants with `itemCls`
//                            (several classes: `a|b`).
//                            Every pixel row that belongs to an item is hit-tested across the whole width of `rangeCls` (the
//                            pane, so its edge padding is covered; empty = the container's own width), and the bands BETWEEN
//                            items must be empty (items touch) unless a `spawn-section-title` / `spawn-separator` lies in them:
//                            {rect, range, items, contiguous, gaps: [[y0, y1]...], total, hit, skipped, misses}.
//   SetFrequent(s ids)       the Frequent lists show these desktop ids (comma separated) as the most used apps; '' = real usage
//   SetPlaces(s json)        fake external devices / network locations / bookmarks in the right pane (needs
//                            show-external-devices / show-bookmarks): [{kind: 'device'|'network'|'bookmark', name,
//                            icon?, ejectable?}]; '' = the real ones. Ejecting a fake removes it
//   A11y() -> s              JSON: the accessibility audit of everything visible in the popup, the context menus and the
//                            panel button(s): {items: [{type, cls, name, label, role, atk}], unnamed: [...], live: [...],
//                            animations}. An item is a visible St.Widget that can take the keyboard focus (or a reactive
//                            St.Button); `name` is its accessible_name, `label` the text of its label_actor (menu items), `atk`
//                            what the Atk object reports; `unnamed` lists the items with neither a name nor a label.
//                            `live` are the screen reader live regions {text, role, visible}; `animations` is
//                            St.Settings.enable_animations (ui-a11y.sh)
//   Appearance(s cls, i nth) -> s  JSON: the theme values that draw the nth visible actor with `cls` (its `.spawn-surface`
//                            face when it has one): {pseudo, bg, shadow, border, outline, td} (ui-a11y.sh compares focused and not)
//   Dump() -> s              JSON: monitor, anchor, popup rect and every visible actor of the popup /
//                            context menu / tooltip with allocation, padding, margin, colours, font
//                            (the UX audit measurements; see tools/dev/scenarios/ui-ux-measure.sh)
//
// Public API:
//   installUiDevHooks(scope, settings, popup, appIndex): void

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {error} from '../core/log.js';
import type {Scope} from '../core/scope.js';
import type {SpawnSettings} from '../core/settings.js';
import type {AppIndex} from '../model/appIndex.js';
import type {FakePlace} from '../model/places.js';
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
    <method name="Tap"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/></method>
    <method name="Drag"><arg type="i" direction="in" name="x1"/><arg type="i" direction="in" name="y1"/><arg type="i" direction="in" name="x2"/><arg type="i" direction="in" name="y2"/></method>
    <method name="Pick"><arg type="i" direction="in" name="x"/><arg type="i" direction="in" name="y"/><arg type="s" direction="out" name="actor"/></method>
    <method name="State"><arg type="s" direction="out" name="json"/></method>
    <method name="Rect"><arg type="s" direction="in" name="cls"/><arg type="i" direction="in" name="nth"/><arg type="s" direction="out" name="rect"/></method>
    <method name="Pseudo"><arg type="s" direction="in" name="cls"/><arg type="i" direction="in" name="nth"/><arg type="s" direction="out" name="pseudo"/></method>
    <method name="Count"><arg type="s" direction="in" name="cls"/><arg type="i" direction="out" name="count"/></method>
    <method name="TextRect"><arg type="s" direction="in" name="text"/><arg type="i" direction="in" name="nth"/><arg type="s" direction="out" name="rect"/></method>
    <method name="FocusActor"><arg type="s" direction="in" name="cls"/><arg type="i" direction="in" name="nth"/></method>
    <method name="MenuItems"><arg type="s" direction="in" name="cls"/><arg type="s" direction="out" name="json"/></method>
    <method name="Windows"><arg type="s" direction="out" name="json"/></method>
    <method name="FocusInfo"><arg type="s" direction="out" name="json"/></method>
    <method name="HitSweep"><arg type="s" direction="in" name="itemCls"/><arg type="s" direction="out" name="json"/></method>
    <method name="HitSweepIn"><arg type="s" direction="in" name="containerCls"/><arg type="s" direction="in" name="itemCls"/><arg type="s" direction="in" name="rangeCls"/><arg type="s" direction="out" name="json"/></method>
    <method name="SetFrequent"><arg type="s" direction="in" name="ids"/></method>
    <method name="SetPlaces"><arg type="s" direction="in" name="json"/></method>
    <method name="A11y"><arg type="s" direction="out" name="json"/></method>
    <method name="Appearance"><arg type="s" direction="in" name="cls"/><arg type="i" direction="in" name="nth"/><arg type="s" direction="out" name="json"/></method>
    <method name="Dump"><arg type="s" direction="out" name="json"/></method>
  </interface>
</node>`;

type Invocation = Gio.DBusMethodInvocation;

const MODIFIERS: Record<string, number> = {
    Shift: Clutter.KEY_Shift_L,
    Ctrl: Clutter.KEY_Control_L,
    Alt: Clutter.KEY_Alt_L,
};

export function installUiDevHooks(scope: Scope, settings: SpawnSettings, popup: SpawnPopup, appIndex: AppIndex): void {
    let exported: Gio.DBusExportedObject | null = null;
    let keyboard: Clutter.VirtualInputDevice | null = null;
    let pointer: Clutter.VirtualInputDevice | null = null;
    let touch: Clutter.VirtualInputDevice | null = null;
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
            if (c !== menu && /spawn-(context-menu|button-menu|tooltip|power-popup|runner)/.test(cls))
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

    const findText = (text: string): Clutter.Actor[] => {
        const found: Clutter.Actor[] = [];
        const walk = (a: Clutter.Actor) => {
            if (!a.visible)
                return;
            if (a instanceof St.Label && a.text === text)
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

    const hitSweep = (itemCls: string): string => {
        const grid = findAll('spawn-tile-grid')[0];
        if (!grid)
            throw new Error('no visible spawn-tile-grid');
        const [gx, gy, gw, gh] = rectOf(grid);
        // the part of the grid that is scrolled into view
        let top = gy;
        let bottom = gy + gh;
        for (let a = grid.get_parent(); a; a = a.get_parent()) {
            if (a instanceof St.ScrollView) {
                const [, sy, , sh] = rectOf(a);
                top = Math.max(top, sy);
                bottom = Math.min(bottom, sy + sh);
                break;
            }
        }
        const rows = grid.get_children().filter(r => r.visible);
        let contiguous = rows.length > 0;
        // (a folder's list may be shorter than its stretched container: only the rows have to touch)
        let prevBottom = gy;
        const spans: Array<{y0: number; y1: number; x0: number; x1: number; edges: number[]}> = [];
        for (const row of rows) {
            const [, ry, , rh] = rectOf(row);
            const tiles = row.get_children().filter(t => t.visible).map(t => rectOf(t));
            if (tiles.length === 0)
                continue;
            if (Math.abs(ry - prevBottom) > 0.5)
                contiguous = false;
            prevBottom = ry + rh;
            spans.push({
                y0: ry, y1: ry + rh,
                x0: Math.min(...tiles.map(t => t[0] as number)),
                x1: Math.max(...tiles.map(t => (t[0] as number) + (t[2] as number))),
                edges: tiles.flatMap(t => [t[0] as number, (t[0] as number) + (t[2] as number)]),
            });
        }
        let total = 0;
        let hit = 0;
        let skipped = 0;
        const misses: Array<[number, number, string]> = [];
        for (let y = Math.ceil(top); y < Math.floor(bottom); y++) {
            const span = spans.find(sp => y + 0.5 >= sp.y0 && y + 0.5 < sp.y1);
            if (!span)
                continue;
            const x0 = Math.ceil(span.x0);
            const x1 = Math.floor(span.x1);
            for (let x = x0; x < x1; x++) {
                // dense where a gap can be (the ends of the row, 6 px around every tile edge), strided between
                if (x - x0 >= 12 && x1 - 1 - x >= 12 && (x - x0) % 5 !== 0 && !span.edges.some(e => Math.abs(x + 0.5 - e) <= 6))
                    continue;
                const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x + 0.5, y + 0.5) as Clutter.Actor | null;
                let owner = false;
                let bar = false;
                for (let a: Clutter.Actor | null = picked; a && a !== grid; a = a.get_parent()) {
                    if (a instanceof St.ScrollBar)
                        bar = true;
                    if (hasClass(a, itemCls)) {
                        owner = true;
                        break;
                    }
                }
                if (bar && !owner) {
                    skipped++;
                    continue;
                }
                total++;
                if (owner)
                    hit++;
                else if (misses.length < 20)
                    misses.push([x, y, picked ? `${picked.constructor.name}.${(picked as St.Widget).style_class ?? ''}` : 'none']);
            }
        }
        return JSON.stringify({rect: [gx, gy, gw, gh], rows: rows.length, contiguous, total, hit, skipped, misses});
    };

    const hitSweepIn = (containerCls: string, itemCls: string, rangeCls: string): string => {
        const container = findAll(containerCls)[0];
        if (!container)
            throw new Error(`no visible ${containerCls}`);
        const range = rangeCls ? findAll(rangeCls)[0] : container;
        if (!range)
            throw new Error(`no visible ${rangeCls}`);
        const [rx, , rw] = rectOf(range);
        const [cx, cy, cw, ch] = rectOf(container);
        // the part of the container that is scrolled into view
        let top = cy;
        let bottom = cy + ch;
        for (let a: Clutter.Actor | null = container; a; a = a.get_parent()) {
            if (a instanceof St.ScrollView) {
                const [, sy, , sh] = rectOf(a);
                top = Math.max(top, sy);
                bottom = Math.min(bottom, sy + sh);
                break;
            }
        }
        const itemClasses = itemCls.split('|');
        const isItem = (a: Clutter.Actor): boolean => itemClasses.some(c => hasClass(a, c));
        const items: number[][] = [];
        const breaks: number[][] = [];
        const walk = (a: Clutter.Actor) => {
            if (!a.visible)
                return;
            if (isItem(a)) {
                items.push(rectOf(a));
                return;
            }
            if (hasClass(a, 'spawn-section-title') || hasClass(a, 'spawn-separator'))
                breaks.push(rectOf(a));
            for (const c of a.get_children())
                walk(c);
        };
        walk(container);
        // y bands covered by items, merged; a gap between two bands needs a title / separator in it
        const bands: Array<[number, number]> = [];
        for (const [, y, , h] of [...items].sort((a, b) => (a[1] as number) - (b[1] as number))) {
            const y0 = y as number;
            const y1 = y0 + (h as number);
            const last = bands[bands.length - 1];
            if (last && y0 <= last[1] + 0.5)
                last[1] = Math.max(last[1], y1);
            else
                bands.push([y0, y1]);
        }
        const gaps: Array<[number, number]> = [];
        for (let i = 1; i < bands.length; i++) {
            const [g0, g1] = [bands[i - 1][1], bands[i][0]];
            if (!breaks.some(b => (b[1] as number) >= g0 - 0.5 && (b[1] as number) + (b[3] as number) <= g1 + 0.5))
                gaps.push([g0, g1]);
        }
        let total = 0;
        let hit = 0;
        let skipped = 0;
        const misses: Array<[number, number, string]> = [];
        const x0 = Math.ceil(rx);
        const x1 = Math.floor(rx + rw);
        for (let y = Math.ceil(top); y < Math.floor(bottom); y++) {
            if (!bands.some(([b0, b1]) => y + 0.5 >= b0 && y + 0.5 < b1))
                continue;
            for (let x = x0; x < x1; x++) {
                // dense at both ends of the pane (its edge padding is what is under test), strided between
                if (x - x0 >= 16 && x1 - 1 - x >= 16 && (x - x0) % 5 !== 0)
                    continue;
                const picked = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x + 0.5, y + 0.5) as Clutter.Actor | null;
                let owner = false;
                let bar = false;
                for (let a: Clutter.Actor | null = picked; a; a = a.get_parent()) {
                    if (a instanceof St.ScrollBar)
                        bar = true;
                    if (isItem(a)) {
                        owner = true;
                        break;
                    }
                }
                if (bar && !owner) {
                    skipped++;
                    continue;
                }
                total++;
                if (owner)
                    hit++;
                else if (misses.length < 20)
                    misses.push([x, y, picked ? `${picked.constructor.name}.${(picked as St.Widget).style_class ?? ''}` : 'none']);
            }
        }
        return JSON.stringify({rect: [cx, cy, cw, ch], range: [rx, rw], items: items.length, contiguous: gaps.length === 0, gaps, total, hit, skipped, misses});
    };

    // ---- accessibility audit (A11y / Appearance) ----

    const a11yAudit = (): string => {
        const items: Array<Record<string, unknown>> = [];
        const unnamed: Array<Record<string, unknown>> = [];
        const seen = new Set<Clutter.Actor>();
        const inScrollBar = (a: Clutter.Actor): boolean => {
            for (let p: Clutter.Actor | null = a; p; p = p.get_parent()) {
                if (p instanceof St.ScrollBar)
                    return true;
            }
            return false;
        };
        const audit = (a: Clutter.Actor) => {
            if (!a.visible || seen.has(a))
                return;
            seen.add(a);
            if (a instanceof St.Widget && !(a instanceof St.ScrollView) && !(a instanceof St.ScrollBar) && !inScrollBar(a) &&
                (a.can_focus || (a instanceof St.Button && a.reactive))) {
                const label = a.label_actor as unknown as {text?: string} | null;
                let atkName: string | null = null;
                try {
                    atkName = a.get_accessible()?.get_name() ?? null;
                } catch {
                    atkName = null;
                }
                const e: Record<string, unknown> = {
                    type: a.constructor.name,
                    cls: a.style_class ?? '',
                    name: a.accessible_name ?? '',
                    label: label?.text ?? '',
                    role: Atk.role_get_name(a.accessible_role),
                    atk: atkName,
                };
                items.push(e);
                if (!e['name'] && !e['label'])
                    unnamed.push(e);
            }
            for (const c of a.get_children())
                audit(c);
        };
        for (const r of roots())
            audit(r);
        for (const b of findAll('spawn-button'))
            audit(b);
        const live: Array<Record<string, unknown>> = [];
        for (const c of Main.uiGroup.get_children()) {
            if (c instanceof St.Label && c.style_class === 'spawn-live-region')
                live.push({text: c.text, role: Atk.role_get_name(c.accessible_role), visible: c.visible});
        }
        return JSON.stringify({items, unnamed, live, animations: St.Settings.get().enable_animations});
    };

    const appearance = (cls: string, nth: number): string => {
        const a = findAll(cls)[nth];
        if (!a)
            throw new Error(`no visible actor with class '${cls}' at ${nth}`);
        let face: Clutter.Actor = a;
        for (const c of a.get_children()) {
            if (hasClass(c, 'spawn-surface')) {
                face = c;
                break;
            }
        }
        const node = (face as St.Widget).get_theme_node();
        const col = (c: {red: number; green: number; blue: number; alpha: number}) => [c.red, c.green, c.blue, c.alpha];
        const sh = node.get_box_shadow();
        return JSON.stringify({
            pseudo: (a as St.Widget).get_style_pseudo_class() ?? '',
            bg: col(node.get_background_color()),
            shadow: sh ? {color: col(sh.color), x: sh.xoffset, y: sh.yoffset, blur: sh.blur, spread: sh.spread, inset: sh.inset} : null,
            border: [node.get_border_width(St.Side.TOP), col(node.get_border_color(St.Side.TOP))],
            outline: node.get_outline_width(),
            td: node.get_transition_duration(),
        });
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
        TextRectAsync: ([text, nth]: [string, number], inv: Invocation) => reply(inv, () => {
            const a = findText(text)[nth];
            return new GLib.Variant('(s)', [a ? JSON.stringify(rectOf(a)) : '']);
        }),
        PseudoAsync: ([cls, nth]: [string, number], inv: Invocation) => reply(inv, () => {
            const a = findAll(cls)[nth] as unknown as {get_style_pseudo_class?: () => string | null} | undefined;
            return new GLib.Variant('(s)', [a?.get_style_pseudo_class?.() ?? '']);
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
            const info = f && f !== global.stage ? {type: f.constructor.name, cls: (f as St.Widget).style_class ?? '', name: f.accessible_name ?? ''} : null;
            return new GLib.Variant('(s)', [JSON.stringify(info)]);
        }),
        HitSweepAsync: ([cls]: [string], inv: Invocation) => reply(inv, () => new GLib.Variant('(s)', [hitSweep(cls)])),
        HitSweepInAsync: ([container, item, range]: [string, string, string], inv: Invocation) =>
            reply(inv, () => new GLib.Variant('(s)', [hitSweepIn(container, item, range)])),
        SetFrequentAsync: ([ids]: [string], inv: Invocation) => reply(inv, () => appIndex.setFrequentOverride(ids ? ids.split(',') : null)),
        SetPlacesAsync: ([json]: [string], inv: Invocation) => reply(inv, () => popup.setFakePlaces(json ? JSON.parse(json) as FakePlace[] : null)),
        A11yAsync: (_p: unknown[], inv: Invocation) => reply(inv, () => new GLib.Variant('(s)', [a11yAudit()])),
        AppearanceAsync: ([cls, nth]: [string, number], inv: Invocation) => reply(inv, () => new GLib.Variant('(s)', [appearance(cls, nth)])),
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
        TapAsync: ([x, y]: [number, number], inv: Invocation) => reply(inv, () => {
            touch ??= seat().create_virtual_device(Clutter.InputDeviceType.TOUCHSCREEN_DEVICE);
            const dev = touch;
            dev.notify_touch_down(now(), 0, x, y);
            scope.timeout(80, () => dev.notify_touch_up(now(), 0));
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
        touch = null;
    }, 'ui dev hooks');
}

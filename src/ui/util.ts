// Small shared helpers for the menu UI. No state.
//
// Public API:
//   lookupApp(services, id)                   Shell.App for a desktop id, or null
//   ownedScope(parent, label)                 child scope + release() that also unregisters it from `parent`
//   launchApp(app, settings, newWindow)       activate or open a new window, per activate-on-launch
//   iconSizeFor(settings, key, fallback)      icon-size-* setting (-1 = default) -> px
//   symbolicGIcon(icon)                       themed icon with its "-symbolic" variants tried first
//   scrollIntoView(scroll, actor)             scroll a St.ScrollView so `actor` is visible
//   isCtrlPressed()                           Ctrl held during the current event
//   isTruncated(label)                        is the label's text cut off with an ellipsis
//   clear(actor)                              destroy every child of a container

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import type St from 'gi://St';

import {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {SpawnSettings} from '../core/settings.js';

export function lookupApp(services: Services, id: string): Shell.App | null {
    try {
        // AppSystem first: AppIndex.get() builds the whole index on first use.
        return Shell.AppSystem.get_default().lookup_app(id) ?? services.appIndex.get(id);
    } catch {
        return null;
    }
}

/** A short-lived child scope that does not leave a dead closure in `parent` once released. */
export function ownedScope(parent: Scope, label: string): {scope: Scope; release(): void} {
    const scope = new Scope(label);
    const release = parent.add(() => scope.dispose(), label);
    return {scope, release};
}

export function launchApp(app: Shell.App, settings: SpawnSettings, newWindow: boolean): void {
    const canOpenNew = app.state === Shell.AppState.RUNNING && app.can_open_new_window();
    if (canOpenNew && (newWindow || !settings.get('activate-on-launch')))
        app.open_new_window(-1);
    else
        app.activate();
}

export function iconSizeFor(settings: SpawnSettings, key: 'icon-size-apps' | 'icon-size-shortcuts' | 'icon-size-categories' | 'icon-size-buttons' | 'icon-size-misc', fallback: number): number {
    const v = settings.get(key);
    return v > 0 ? v : fallback;
}

export function symbolicGIcon(icon: Gio.Icon | null): Gio.Icon | null {
    if (icon instanceof Gio.ThemedIcon) {
        const names = icon.get_names();
        return Gio.ThemedIcon.new_from_names([...names.map(n => `${n}-symbolic`), ...names]);
    }
    return icon;
}

export function scrollIntoView(scroll: St.ScrollView | null, actor: Clutter.Actor): void {
    if (!scroll || !actor.get_stage())
        return;
    const adj = scroll.vadjustment;
    const box = scroll.get_allocation_box();
    const viewH = box.y2 - box.y1;
    const [, top] = relativeY(actor, scroll.get_child() as unknown as Clutter.Actor | null);
    const h = actor.height;
    const margin = 8;
    let value = adj.value;
    if (top - margin < value)
        value = top - margin;
    else if (top + h + margin > value + viewH)
        value = top + h + margin - viewH;
    adj.value = Math.max(0, value);
}

function relativeY(actor: Clutter.Actor, ancestor: Clutter.Actor | null): [boolean, number] {
    let y = 0;
    let a: Clutter.Actor | null = actor;
    while (a && a !== ancestor) {
        y += a.y;
        a = a.get_parent();
    }
    return [a === ancestor, y];
}

export function isCtrlPressed(): boolean {
    const ev = Clutter.get_current_event();
    return Boolean(ev && (ev.get_state() & Clutter.ModifierType.CONTROL_MASK));
}

export function isTruncated(label: St.Label): boolean {
    try {
        return label.clutter_text.get_layout().is_ellipsized();
    } catch {
        return false;
    }
}

export function clear(actor: Clutter.Actor): void {
    for (const child of actor.get_children())
        child.destroy();
}

// Small shared helpers for the menu UI. No state.
//
// Public API:
//   lookupApp(services, id)                   Shell.App for a desktop id, or null
//   ownedScope(parent, label)                 child scope + release() that also unregisters it from `parent`
//   displayName(app, settings)                app name, or its GenericName when apps-show-generic-names is on
//   launchApp(app, settings, newWindow)       activate or open a new window, per activate-on-launch
//   iconSizeFor(settings, key, fallback)      icon-size-* setting (<= 0 = default) -> px
//   iconSizeOrHidden(settings, key, fallback) same for icon-size-shortcuts / -categories, but 0 stays 0 (hide the icons)
//   symbolicGIcon(icon)                       themed icon with its "-symbolic" variants tried first
//   applyScrollSettings(scroll, settings)     scrollbars-visible / -overlay / scrollview-fade-effect, live
//   scrollIntoView(scroll, actor)             scroll a St.ScrollView so `actor` is visible
//   isCtrlPressed()                           Ctrl held during the current event
//   isTruncated(label)                        is the label's text cut off with an ellipsis
//   clear(actor)                              destroy every child of a container
//   applyTone(actor, probe?)                  add/remove "spawn-light" on `actor` when the shell theme's
//                                             foreground at `probe` is dark (light shell theme)
//   warmStyles(root)                          resolve the styles (and start the icon loads) of root and its visible descendants now

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Scope} from '../core/scope.js';
import type {Services} from '../core/services.js';
import type {SpawnSettings} from '../core/settings.js';
import {iconSize as clampIconSize} from '../core/limits.js';
import {appInfoOf} from '../model/appInfo.js';

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

export function displayName(app: Shell.App, settings: SpawnSettings): string {
    const name = app.get_name() ?? '';
    if (!settings.get('apps-show-generic-names'))
        return name;
    try {
        return appInfoOf(app)?.get_generic_name() || name;
    } catch {
        return name;
    }
}

export function launchApp(app: Shell.App, settings: SpawnSettings, newWindow: boolean): void {
    const canOpenNew = app.state === Shell.AppState.RUNNING && app.can_open_new_window();
    if (canOpenNew && (newWindow || !settings.get('activate-on-launch')))
        app.open_new_window(-1);
    else
        app.activate();
}

/**
 * One "Show descriptions" switch in the prefs drives both keys (app lists: apps-show-extra-details, search
 * results: show-search-result-details); either one on (e.g. from an older version or an ArcMenu import)
 * shows them everywhere, so the menu always matches the switch.
 */
export function showDescriptions(settings: SpawnSettings): boolean {
    return settings.get('apps-show-extra-details') || settings.get('show-search-result-details');
}

export function iconSizeFor(settings: SpawnSettings, key: 'icon-size-apps' | 'icon-size-shortcuts' | 'icon-size-categories' | 'icon-size-buttons' | 'icon-size-misc', fallback: number): number {
    return clampIconSize(settings.get(key), fallback);
}

/**
 * Like iconSizeFor, but a stored 0 stays 0 = "hide these icons". Only for the keys whose rows keep a label
 * and their height without the icon (categories, shortcuts); the others treat 0 like -1 (the default).
 */
export function iconSizeOrHidden(settings: SpawnSettings, key: 'icon-size-shortcuts' | 'icon-size-categories', fallback: number): number {
    return settings.get(key) === 0 ? 0 : iconSizeFor(settings, key, fallback);
}

export function symbolicGIcon(icon: Gio.Icon | null): Gio.Icon | null {
    if (icon instanceof Gio.ThemedIcon) {
        const names = icon.get_names();
        return Gio.ThemedIcon.new_from_names([...names.map(n => `${n}-symbolic`), ...names]);
    }
    return icon;
}

export function applyScrollSettings(scroll: St.ScrollView, settings: SpawnSettings): void {
    scroll.vscrollbar_policy = settings.get('scrollbars-visible') ? St.PolicyType.AUTOMATIC : St.PolicyType.EXTERNAL;
    scroll.overlay_scrollbars = settings.get('scrollbars-overlay');
    // stylesheet.css keeps an overlay bar where it was now that the scroll view reaches the pane's edge
    if (scroll.overlay_scrollbars)
        scroll.add_style_class_name('spawn-scroll-overlay');
    else
        scroll.remove_style_class_name('spawn-scroll-overlay');
    if (settings.get('scrollview-fade-effect'))
        scroll.add_style_class_name('vfade');
    else
        scroll.remove_style_class_name('vfade');
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

/**
 * Is the event being handled a pointer or touch one (a click, not Return / Space)? St.Button reports a
 * keyboard activation as button 1 too, so the event type is the only way to tell.
 */
export function isPointerEvent(): boolean {
    const type = Clutter.get_current_event()?.type();
    return type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.BUTTON_RELEASE ||
        type === Clutter.EventType.TOUCH_BEGIN || type === Clutter.EventType.TOUCH_END;
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

/** Perceived luminance (0..255) of a Clutter colour. */
function luminance(c: {red: number; green: number; blue: number}): number {
    return 0.2126 * c.red + 0.7152 * c.green + 0.0722 * c.blue;
}

/**
 * Light shell themes have dark popup text: tag `actor` with "spawn-light" so stylesheet.css swaps its
 * white-alpha tints for black ones. `probe` is the widget whose computed foreground decides
 * (default `actor`). Dark themes (Orchis Dark, the default look) get no class.
 */
export function applyTone(actor: St.Widget, probe: St.Widget = actor): void {
    let light: boolean;
    try {
        light = luminance(probe.get_theme_node().get_foreground_color()) < 128;
    } catch {
        light = false;
    }
    if (light)
        actor.add_style_class_name('spawn-light');
    else
        actor.remove_style_class_name('spawn-light');
}

/**
 * Resolve the style of `root` and every visible descendant now (St does it when they are first mapped),
 * which also starts loading their icons. Used on a hidden popup so its first open does not pay for it.
 */
export function warmStyles(root: Clutter.Actor): void {
    const stack: Clutter.Actor[] = [root];
    while (stack.length > 0) {
        const actor = stack.pop() as Clutter.Actor;
        if (actor instanceof St.Widget)
            actor.ensure_style();
        for (const child of actor.get_children()) {
            if (child.visible)
                stack.push(child);
        }
    }
}

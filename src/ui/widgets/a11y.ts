// Accessibility helpers shared by the menu widgets (Orca / AT-SPI through Atk).
//
// Every interactive actor has an accessible name (St.Widget `accessible_name`, plus `label_actor` where a
// visible label exists), buttons keep St's default push-button role, rows of a flat list are LIST_ITEMs of a
// named LIST. The search result count is announced through a LiveRegion. "Reduce animation" is honoured by
// asking animationsEnabled() / animationDuration() before every Spawn-driven animation.
//
// Public API:
//   markDialog(actor, name)             DIALOG role + name on a popup card
//   markToolbar(actor, name)            TOOL_BAR role + name on a row of icon buttons
//   nameItem(widget, name, opts?)       accessible_name (+ label_actor, + LIST_ITEM role with opts.listItem)
//   markList(actor, name)               LIST role + name on a container of rows / tiles
//   animationsEnabled(): boolean        false when GNOME's "Reduce animation" is on
//   animationDuration(ms): number       ms, or 0 when animations are off
//   bindReducedMotion(scope, actor)     keep the `spawn-reduce-motion` class on actor in step with the setting
//   new LiveRegion(scope)               invisible ALERT label a screen reader speaks when its text changes
//   region.say(text) / region.text
//   new ResultAnnouncer(scope)          LiveRegion + CountAnnouncer: "5 results" / "No results", debounced
//   announcer.found(count, delay?) / .hold() / .reset() / .lastMessage
//   resultCountText(count)              the sentence announced for `count` results

import Atk from 'gi://Atk';
import type Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type {Scope} from '../../core/scope.js';
import {CountAnnouncer, itemName, REDUCED_MOTION_CLASS} from '../a11yCore.js';

export {itemName, REDUCED_MOTION_CLASS};

export interface NameOptions {
    /** The visible label the name comes from. */
    label?: Clutter.Actor | null;
    /** Shown description: the name becomes "Name, description". */
    description?: string | null;
    /** The widget is a row of a flat list (its container went through markList()). */
    listItem?: boolean;
}

/** Sets the accessible name (and role / label actor) of an interactive widget. Never throws. */
export function nameItem(widget: St.Widget, name: string, opts: NameOptions = {}): void {
    try {
        widget.accessible_name = itemName(name, opts.description);
        if (opts.label)
            widget.label_actor = opts.label;
        if (opts.listItem)
            widget.accessible_role = Atk.Role.LIST_ITEM;
    } catch {
        // a destroyed widget: nothing to name
    }
}

/** A container of rows or tiles is a LIST that has a name ("Pinned apps"). */
export function markList(actor: St.Widget, name: string): void {
    try {
        actor.accessible_role = Atk.Role.LIST;
        actor.accessible_name = name;
    } catch {
        // destroyed
    }
}

/** A popup card (the opened folder) is a DIALOG that has a name. */
export function markDialog(actor: St.Widget, name: string): void {
    try {
        actor.accessible_role = Atk.Role.DIALOG;
        actor.accessible_name = name;
    } catch {
        // destroyed
    }
}

/** A row of icon buttons (the power buttons) is a TOOL_BAR that has a name. */
export function markToolbar(actor: St.Widget, name: string): void {
    try {
        actor.accessible_role = Atk.Role.TOOL_BAR;
        actor.accessible_name = name;
    } catch {
        // destroyed
    }
}

// ---- reduce animation ----

/** GNOME Settings > Accessibility > Reduce Animation (org.gnome.desktop.interface enable-animations). */
export function animationsEnabled(): boolean {
    try {
        return St.Settings.get().enable_animations;
    } catch {
        return true;
    }
}

export function animationDuration(ms: number): number {
    return animationsEnabled() ? ms : 0;
}

/** Adds `spawn-reduce-motion` to `actor` while animations are off (stylesheet.css zeroes the transitions under it). */
export function bindReducedMotion(scope: Scope, actor: St.Widget): void {
    const apply = (): void => {
        if (animationsEnabled())
            actor.remove_style_class_name(REDUCED_MOTION_CLASS);
        else
            actor.add_style_class_name(REDUCED_MOTION_CLASS);
    };
    apply();
    try {
        scope.connect(St.Settings.get(), 'notify::enable-animations', apply);
    } catch {
        // no St.Settings: animations stay as they are
    }
}

// ---- announcements ----

/**
 * An invisible label with the ALERT role. Orca speaks an alert when it becomes showing, so say() hides the
 * label, changes its text and shows it again (a second identical message is spoken again). It lives in the
 * uiGroup, 1 x 1 px and fully transparent, so it takes no part in the menu's layout or hit testing.
 * ATK has no live regions; this is the mechanism the shell's own notification banners rely on.
 */
export class LiveRegion {
    readonly actor: St.Label;

    constructor(scope: Scope) {
        this.actor = new St.Label({
            style_class: 'spawn-live-region',
            accessible_role: Atk.Role.ALERT,
            accessible_name: '',
            text: '',
            opacity: 0,
            width: 1,
            height: 1,
            reactive: false,
            can_focus: false,
            visible: false,
        });
        Main.uiGroup.add_child(this.actor);
        scope.add(() => this.actor.destroy(), 'LiveRegion');
    }

    get text(): string {
        return this.actor.text ?? '';
    }

    say(text: string): void {
        const label = this.actor;
        try {
            label.hide();
            label.text = text;
            label.accessible_name = text;
            label.show();
        } catch {
            // destroyed with the uiGroup
        }
    }
}

/** "5 results" / "1 result" / "No results", spoken once the result count has settled. */
export class ResultAnnouncer {
    private readonly _region: LiveRegion;
    private readonly _counter: CountAnnouncer;

    constructor(scope: Scope) {
        this._region = new LiveRegion(scope);
        this._counter = new CountAnnouncer(
            (ms, cb) => scope.timeout(ms, cb),
            count => this._region.say(resultCountText(count)),
        );
        scope.add(() => this._counter.reset(), 'ResultAnnouncer');
    }

    get lastMessage(): string {
        return this._region.text;
    }

    /** The current search has `count` results (call after every batch; `delay` overrides the debounce). */
    found(count: number, delay?: number): void {
        this._counter.note(count, delay);
    }

    /** A new query started: nothing is said for the old count. */
    hold(): void {
        this._counter.hold();
    }

    /** The search ended. */
    reset(): void {
        this._counter.reset();
    }
}

export function resultCountText(count: number): string {
    if (count <= 0)
        return _('No results');
    return ngettext('%d result', '%d results', count).replace('%d', String(count));
}

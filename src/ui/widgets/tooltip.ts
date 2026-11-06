// TooltipManager: ONE shared hover tooltip for the whole menu (the shell's "dash-label" look).
//
// Responsibility: show the full text of truncated names (and optional descriptions) after a
// short hover delay, positioned under the widget and clamped to the monitor. Hidden on leave,
// press and when the menu closes. Code that destroys widgets with tooltips calls hide() first
// (no 'destroy' handlers are connected, so nothing is left dangling at shutdown). Gated by the `show-tooltips` setting.
//
// Public API:
//   new TooltipManager(scope, settings)
//   tooltips.attach(widget, label, extra?, opts?)   `label` is the St.Label whose truncation is
//                                            checked (or null: always show `extra`);
//                                            `extra()` may return text to show instead/also;
//                                            opts.delay: hover delay in ms (default 450; the
//                                            icon-only power buttons use 200);
//                                            opts.above: prefer above the widget (power bar)
//   tooltips.hide()

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import {isTruncated} from '../util.js';
import {surfaceOf} from './interact.js';

const SHOW_DELAY_MS = 450;

export interface TooltipOptions {
    /** Hover delay in ms before the tooltip shows. */
    delay?: number;
    /** Show above the widget instead of below (the power bar sits on the menu's bottom edge). */
    above?: boolean;
}

export class TooltipManager {
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private _label: St.Label | null = null;
    private _cancel: (() => void) | null = null;
    private _owner: St.Widget | null = null;

    constructor(scope: Scope, settings: SpawnSettings) {
        this._scope = scope;
        this._settings = settings;
        scope.add(() => this._destroy(), 'TooltipManager');
    }

    attach(widget: St.Widget, label: St.Label | null, extra?: () => string | null, opts: TooltipOptions = {}): void {
        widget.connect('notify::hover', () => {
            if (widget.hover)
                this._schedule(widget, label, extra, opts);
            else if (this._owner === widget || !this._owner)
                this.hide();
        });
        // Keyboard navigation: show the same tooltip while the widget holds key focus (the pointer
        // case is handled by notify::hover; `hover` is skipped here so clicks do not re-trigger it).
        widget.connect('key-focus-in', () => {
            if (!widget.hover)
                this._schedule(widget, label, extra, opts);
        });
        widget.connect('key-focus-out', () => {
            if (this._owner === widget || !this._owner)
                this.hide();
        });
        widget.connect('button-press-event', () => {
            this.hide();
            return Clutter.EVENT_PROPAGATE;
        });
    }

    /** Dev hook: current tooltip text, or null when hidden. */
    debugText(): string | null {
        return this._label?.visible ? this._label.text : null;
    }

    hide(): void {
        this._cancel?.();
        this._cancel = null;
        this._owner = null;
        if (this._label) {
            this._label.remove_all_transitions();
            this._label.hide();
        }
    }

    private _schedule(widget: St.Widget, label: St.Label | null, extra: (() => string | null) | undefined, opts: TooltipOptions): void {
        this._cancel?.();
        this._cancel = null;
        if (!this._settings.get('show-tooltips'))
            return;
        this._cancel = this._scope.timeout(opts.delay ?? SHOW_DELAY_MS, () => {
            this._cancel = null;
            if (!widget.get_stage() || !(widget.hover || widget.has_key_focus()))
                return;
            let text = extra?.() ?? null;
            if (!text && label && isTruncated(label))
                text = label.text;
            if (text)
                this._show(widget, text, !!opts.above);
        });
    }

    private _show(widget: St.Widget, text: string, above: boolean): void {
        if (!this._label) {
            this._label = new St.Label({style_class: 'dash-label spawn-tooltip', visible: false});
            this._label.clutter_text.line_wrap = true;
            Main.uiGroup.add_child(this._label);
        }
        const tip = this._label;
        tip.text = text;
        this._owner = widget;
        Main.uiGroup.set_child_above_sibling(tip, null);
        tip.show();

        // below (or above) the visible face, not the transparent hit area around it; flipped when it
        // would leave the monitor
        const face = surfaceOf(widget);
        const [x, y] = face.get_transformed_position();
        const [w, h] = face.get_transformed_size();
        const monitor = Main.layoutManager.findMonitorForActor(widget) ?? Main.layoutManager.primaryMonitor;
        const [, natW] = tip.get_preferred_width(-1);
        const [, natH] = tip.get_preferred_height(natW);
        let tx = Math.floor(x + (w - natW) / 2);
        const below = Math.floor(y + h + 4);
        const over = Math.floor(y - natH - 4);
        let ty = above ? over : below;
        if (monitor) {
            tx = Math.max(monitor.x + 4, Math.min(tx, monitor.x + monitor.width - natW - 4));
            if (above && ty < monitor.y + 4)
                ty = below;
            else if (!above && ty + natH > monitor.y + monitor.height - 4)
                ty = over;
        }
        tip.set_position(tx, ty);
        tip.opacity = 0;
        tip.ease({opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    private _destroy(): void {
        this._cancel?.();
        this._cancel = null;
        this._label?.destroy();
        this._label = null;
        this._owner = null;
    }
}

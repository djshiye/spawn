// MenuButton: the panel button. One instance per attached panel (see panel/attacher.ts).
//
// Responsibility: show the configured icon/text, translate clicks into popup actions.
// It does NOT own a PopupMenu (the shared SpawnPopup does); the click handling is a
// Clutter.ClickGesture because PanelMenu.Button only wires its own gesture when it owns a menu.
//
// Public API:
//   new MenuButton(deps: MenuButtonDeps)
//   button.refresh(): void             re-read icon/text/size/padding from settings
//   button.setOpen(open: boolean): void  toggles the :active pseudo class
//   button.side: 'top' | 'bottom' | 'left' | 'right'
//                                      screen edge of the panel the button sits in, computed on
//                                      every read from live geometry (a panel can move)
//   button.arrowSide: St.Side          matching BoxPointer arrow side for the popup (panel at the
//                                      top -> St.Side.TOP, i.e. the popup opens below it)
//   MenuButtonDeps: {settings, iconDir, popup: {toggle(anchor)}}
//
// Click mapping uses menu-button-{left,middle,right}-click-action ('Menu' | 'None'); the mouse
// button is read from the gesture so middle click works like any other. A hover tooltip (the
// shell's `dash-label` look; button text or "Applications") follows `show-tooltips` and is
// hidden while the menu is open. Everything is re-read by refresh(), which the attacher calls on
// icon/size/padding/appearance/text changes.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {resolveButtonIcon} from '../core/icons.js';
import {error} from '../core/log.js';
import {Scope} from '../core/scope.js';
import type {MenuButtonClickAction, SpawnSettings} from '../core/settings.js';
import {type PanelSide, panelSide} from '../panel/validate.js';

export interface MenuButtonDeps {
    settings: SpawnSettings;
    iconDir: string;
    popup: {toggle(anchor: St.Widget): void};
}

const TOOLTIP_DELAY_MS = 500;
const FALLBACK_ICON = 'start-here-symbolic';

const BUTTON_ACTION_KEY = {
    1: 'menu-button-left-click-action',
    2: 'menu-button-middle-click-action',
    3: 'menu-button-right-click-action',
} as const;

export class MenuButton extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    private _deps: MenuButtonDeps;
    private _box: St.BoxLayout;
    private _icon: St.Icon;
    private _label: St.Label;
    private _scope = new Scope('MenuButton');
    private _tooltip: St.Label | null = null;
    private _cancelTooltip: (() => void) | null = null;

    constructor(deps: MenuButtonDeps) {
        super(0.5, 'Spawn', true);
        this._deps = deps;

        this.add_style_class_name('spawn-button');

        this._box = new St.BoxLayout({style_class: 'spawn-button-box'});
        this._icon = new St.Icon({style_class: 'spawn-button-icon system-status-icon', y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'spawn-button-label', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._box);

        const gesture = new Clutter.ClickGesture();
        gesture.set_recognize_on_press(true);
        gesture.connect('recognize', () => this._onClick(gesture.get_button()));
        this.add_action(gesture);

        this._scope.connect(this, 'notify::hover', () => (this.hover ? this._scheduleTooltip() : this._hideTooltip()));
        this._scope.connect(this, 'destroy', () => {
            this._hideTooltip();
            this._scope.dispose();
        });

        this.refresh();
    }

    get side(): PanelSide {
        try {
            const lm = Main.layoutManager;
            const panel = this._panelActor();
            const [x, y] = panel.get_transformed_position();
            const [width, height] = panel.get_transformed_size();
            const index = lm.findIndexForActor(this);
            const m = lm.monitors[index >= 0 ? index : lm.primaryIndex] ?? lm.primaryMonitor;
            return panelSide({x, y, width, height}, m ?? {x: 0, y: 0, width: 1, height: 1});
        } catch {
            return 'top';
        }
    }

    get arrowSide(): St.Side {
        switch (this.side) {
        case 'bottom':
            return St.Side.BOTTOM;
        case 'left':
            return St.Side.LEFT;
        case 'right':
            return St.Side.RIGHT;
        default:
            return St.Side.TOP;
        }
    }

    /** The panel actor containing this button (falls back to the button itself). */
    private _panelActor(): St.Widget {
        let actor: Clutter.Actor | null = this.get_parent();
        while (actor) {
            // GNOME's Panel and Dash to Panel's panel are both St widgets named 'panel'.
            if (actor instanceof St.Widget && actor.get_name() === 'panel')
                return actor;
            actor = actor.get_parent();
        }
        return this;
    }

    refresh(): void {
        try {
            const s = this._deps.settings;
            const appearance = s.get('menu-button-appearance');
            const iconSize = s.get('menu-button-icon-size');
            const padding = s.get('menu-button-padding');

            const resolved = resolveButtonIcon(s.get('menu-button-icon'), this._deps.iconDir);
            if (resolved.kind === 'file' && GLib.file_test(resolved.path, GLib.FileTest.IS_REGULAR)) {
                this._icon.icon_name = null;
                this._icon.gicon = new Gio.FileIcon({file: Gio.File.new_for_path(resolved.path)});
            } else {
                this._icon.gicon = null;
                this._icon.icon_name = resolved.kind === 'name' ? resolved.name : FALLBACK_ICON;
            }
            this._icon.icon_size = iconSize;
            this._label.text = s.get('menu-button-text');

            for (const child of this._box.get_children())
                this._box.remove_child(child);
            const showIcon = appearance === 'Icon' || appearance === 'Icon_Text' || appearance === 'Text_Icon';
            const showText = appearance === 'Text' || appearance === 'Icon_Text' || appearance === 'Text_Icon';
            const items: St.Widget[] = [];
            if (showIcon)
                items.push(this._icon);
            if (showText)
                items.push(this._label);
            if (appearance === 'Text_Icon')
                items.reverse();
            for (const item of items)
                this._box.add_child(item);

            this.style = padding >= 0 ? `-minimum-hpadding: ${padding}px; -natural-hpadding: ${padding}px;` : '';
        } catch (e) {
            error('MenuButton.refresh failed', e);
        }
    }

    setOpen(open: boolean): void {
        this._hideTooltip();
        if (open)
            this.add_style_pseudo_class('active');
        else
            this.remove_style_pseudo_class('active');
    }

    private _onClick(buttonNumber: number): void {
        try {
            const key = BUTTON_ACTION_KEY[buttonNumber as keyof typeof BUTTON_ACTION_KEY];
            if (!key)
                return;
            const action: MenuButtonClickAction = this._deps.settings.get(key);
            this._hideTooltip();
            if (action === 'Menu')
                this._deps.popup.toggle(this);
        } catch (e) {
            error('MenuButton click failed', e);
        }
    }

    // ---- tooltip ----

    private _scheduleTooltip(): void {
        this._cancelTooltip?.();
        this._cancelTooltip = this._scope.timeout(TOOLTIP_DELAY_MS, () => {
            this._cancelTooltip = null;
            this._showTooltip();
        });
    }

    private _showTooltip(): void {
        if (!this.hover || this.has_style_pseudo_class('active') || !this._deps.settings.get('show-tooltips'))
            return;
        const text = this._deps.settings.get('menu-button-text').trim() || 'Applications';
        if (!this._tooltip) {
            this._tooltip = new St.Label({style_class: 'dash-label', text, opacity: 0});
            Main.uiGroup.add_child(this._tooltip);
        }
        const tip = this._tooltip;
        tip.text = text;
        const [bx, by] = this.get_transformed_position();
        const [bw, bh] = this.get_transformed_size();
        const [, natW] = tip.get_preferred_width(-1);
        const [, natH] = tip.get_preferred_height(-1);
        const monitor = Main.layoutManager.findMonitorForActor(this) ?? Main.layoutManager.primaryMonitor;
        let x = Math.round(bx + (bw - natW) / 2);
        let y = this.side === 'bottom' ? Math.round(by - natH - 4) : Math.round(by + bh + 4);
        if (monitor) {
            x = Math.max(monitor.x, Math.min(x, monitor.x + monitor.width - natW));
            y = Math.max(monitor.y, Math.min(y, monitor.y + monitor.height - natH));
        }
        tip.set_position(x, y);
        tip.remove_all_transitions();
        tip.ease({opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
    }

    private _hideTooltip(): void {
        this._cancelTooltip?.();
        this._cancelTooltip = null;
        const tip = this._tooltip;
        this._tooltip = null;
        if (!tip)
            return;
        try {
            tip.remove_all_transitions();
            tip.destroy();
        } catch {
            // already destroyed with the uiGroup
        }
    }
}

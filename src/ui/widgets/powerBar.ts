// PowerBar: power buttons from `power-options` (a(ib): id, enabled) in `power-display-style`
// (Default / In_Line: a row of icon buttons; Menu: one "Power Off" button opening a list).
//
// Buttons are ordered by severity (POWER_RANK: switch user, lock, log out, suspend, ..., restart,
// power off), not by the stored order, so the destructive pair (restart, power off) sits at the far end.
// They are spread evenly over the row: every button expands to an equal share of the width and centres its
// 40x32 surface in it (stylesheet.css), so the hit areas touch and there is no dead gap. A stray click on
// Restart / Power Off is safe: the shell asks for confirmation first.
// Every button is a transparent hit area (its padding is the gap to the pane's edge) around a
// `spawn-power-surface` that draws it. `icon-style-buttons` picks the symbolic or the full-colour icon.
//
// The row adapts to the pane's width (powerFit.ts, deferred to BEFORE_REDRAW on notify::width): buttons that
// fit 48n+8 px stay as they are; else `spawn-power-compact` (4 px gaps, surfaces shrink to >= 32 px); else the
// least important buttons move into a "More" popup menu (placed before the destructive pair; Power Off hides last).
//
// Availability follows GNOME's SystemActions (can-* properties, live) and a one-off logind probe
// for hibernate / hybrid sleep, so buttons the system cannot perform are hidden.
//
// Public API:
//   new PowerBar(scope: Scope, settings: SpawnSettings, host: ShortcutHost)
//   bar.actor: St.Widget
//   bar.buttons(): St.Widget[]       visible, focusable buttons in order (for keyboard nav)
//   bar.destroy()

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {PowerType} from '../../core/constants.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import {closeMenu, openMenu} from '../menuParams.js';
import {iconSizeFor} from '../util.js';
import {fitPowerRow, type PowerFit} from './powerFit.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import {isDestructive, isPowerAvailable, type LogindInfo, POWER_INFO, POWER_RANK, powerSignalNames, probeLogind, runPowerAction, systemActions} from './powerActions.js';
import type {ShortcutHost} from './shortcutRow.js';

/** Icon-only buttons need their name quickly (the default tooltip delay is 450 ms). */
const TOOLTIP_DELAY_MS = 200;

interface PowerButton {
    type: number;
    actor: St.Button;
    surface: St.Bin;
}

export class PowerBar {
    readonly actor: St.BoxLayout;
    private readonly _row: St.BoxLayout;
    private readonly _scope: Scope;
    private readonly _settings: SpawnSettings;
    private readonly _host: ShortcutHost;
    private readonly _buttons: PowerButton[] = [];
    private _logind: LogindInfo | null = null;
    private _destroyed = false;
    private _menuButton: St.Button | null = null;
    private _menu: PopupMenu.PopupMenu | null = null;
    private _menuManager: PopupMenu.PopupMenuManager | null = null;
    private _more: PowerButton | null = null;
    private _avail: number[] = [];
    private _fit: PowerFit | null = null;
    private _sig = '';
    private _laterId = 0;

    constructor(scope: Scope, settings: SpawnSettings, host: ShortcutHost) {
        this._scope = scope;
        this._settings = settings;
        this._host = host;
        // the divider is its own widget: it keeps the pane's 8 px inset, the buttons below do not
        this.actor = new St.BoxLayout({style_class: 'spawn-power-bar', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this.actor.add_child(new St.Widget({style_class: 'spawn-power-rule', x_expand: true}));
        this._row = new St.BoxLayout({style_class: 'spawn-power-row', x_expand: true});
        this.actor.add_child(this._row);

        this._build();
        const sa = systemActions();
        if (sa) {
            for (const sig of powerSignalNames)
                scope.connect(sa, sig, () => this._refresh());
        }
        // Not through the scope: the scope destroys the bar (and this row) before it would disconnect,
        // and disconnecting from a destroyed actor logs a critical. The handler goes with the row.
        this._row.connect('notify::width', () => this._scheduleFit());
        settings.onChanged(scope, ['power-options', 'power-display-style', 'icon-size-buttons', 'icon-style-buttons'], () => this._build());
        probeLogind().then(info => {
            if (this._destroyed)
                return;
            this._logind = info;
            this._refresh();
        }).catch(e => error('logind probe failed', e));
        scope.add(() => this._destroy(), 'PowerBar');
    }

    buttons(): St.Widget[] {
        if (this._menuButton)
            return this._menuButton.visible ? [this._menuButton] : [];
        return this._row.get_children().filter((c): c is St.Button => c instanceof St.Button && c.visible);
    }

    destroy(): void {
        this._destroy();
    }

    private _destroy(): void {
        if (this._destroyed)
            return;
        this._destroyed = true;
        if (this._laterId) {
            global.compositor.get_laters().remove(this._laterId);
            this._laterId = 0;
        }
        this._teardownMenu();
        this.actor.destroy();
    }

    private _teardownMenu(): void {
        if (this._menu) {
            this._menuManager?.removeMenu(this._menu);
            this._menu.destroy();
        }
        this._menu = null;
        this._menuManager = null;
        this._menuButton = null;
        this._more = null;
    }

    private _enabledTypes(): number[] {
        const rank = (t: number) => {
            const i = POWER_RANK.indexOf(t);
            return i < 0 ? POWER_RANK.length : i;
        };
        return this._settings.get('power-options').filter(([, on]) => on).map(([id]) => id)
            .sort((a, b) => rank(a) - rank(b));
    }

    private _build(): void {
        if (this._destroyed)
            return;
        this._host.tooltips?.hide();
        this._teardownMenu();
        this._buttons.length = 0;
        this._fit = null;
        this._sig = '';
        this._row.remove_style_class_name('spawn-power-compact');
        for (const c of this._row.get_children())
            c.destroy();

        const style = this._settings.get('power-display-style');
        const size = iconSizeFor(this._settings, 'icon-size-buttons', 16);
        if (style === 'Menu') {
            this._buildMenuButton(size);
        } else {
            let firstDestructive: St.Widget | null = null;
            for (const type of this._enabledTypes()) {
                const info = POWER_INFO[type];
                if (!info)
                    continue;
                const destructive = isDestructive(type);
                const button = makeItemButton(destructive ? 'spawn-power-button spawn-power-destructive' : 'spawn-power-button');
                button.x_expand = true; // equal shares of the row: evenly spaced
                button.y_align = Clutter.ActorAlign.CENTER;
                const icon = new St.Icon({icon_size: size, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
                this._setIcon(icon, info.icon);
                const surface = makeFace('spawn-power-surface', icon);
                surface.x_expand = false;
                surface.x_align = Clutter.ActorAlign.CENTER;
                button.set_child(surface);
                button.accessible_name = info.name;
                this._host.tooltips?.attach(button, null, () => info.name, {delay: TOOLTIP_DELAY_MS, above: true});
                wireItem(button, {activate: () => runPowerAction(type, this._host, this._scope)});
                this._row.add_child(button);
                if (destructive && !firstDestructive)
                    firstDestructive = button;
                this._buttons.push({type, actor: button, surface});
            }
            this._buildMore(size, firstDestructive);
        }
        this._refresh();
    }

    /** `icon-style-buttons`: Symbolic uses the icon as is, Full_Color tries the colour variant first. */
    private _setIcon(icon: St.Icon, name: string): void {
        if (this._settings.get('icon-style-buttons') === 'Full_Color')
            icon.gicon = Gio.ThemedIcon.new_from_names([name.replace(/-symbolic$/, ''), name]);
        else
            icon.icon_name = name;
    }

    /** The "More" button (hidden until the row overflows): sits before Restart / Power Off, opens a menu of the overflowed actions. */
    private _buildMore(size: number, before: St.Widget | null): void {
        const button = makeItemButton('spawn-power-button spawn-power-more');
        button.x_expand = true;
        button.y_align = Clutter.ActorAlign.CENTER;
        const icon = new St.Icon({icon_name: 'view-more-horizontal-symbolic', icon_size: size, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const surface = makeFace('spawn-power-surface', icon);
        surface.x_expand = false;
        surface.x_align = Clutter.ActorAlign.CENTER;
        button.set_child(surface);
        button.accessible_name = _('More');
        this._host.tooltips?.attach(button, null, () => _('More'), {delay: TOOLTIP_DELAY_MS, above: true});
        button.visible = false;
        if (before)
            this._row.insert_child_below(button, before);
        else
            this._row.add_child(button);
        this._more = {type: -1, actor: button, surface};

        const menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.BOTTOM);
        menu.actor.add_style_class_name('spawn-popup spawn-power-popup');
        const manager = new PopupMenu.PopupMenuManager(button);
        manager.addMenu(menu);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this._menu = menu;
        this._menuManager = manager;

        wireItem(button, {activate: () => {
            if (menu.isOpen) {
                closeMenu(menu);
                return;
            }
            menu.removeAll();
            for (const type of this._fit?.overflow ?? []) {
                const info = POWER_INFO[type];
                if (info)
                    menu.addAction(info.name, () => runPowerAction(type, this._host, this._scope), info.icon as never);
            }
            openMenu(menu);
        }});
    }

    private _buildMenuButton(size: number): void {
        const button = makeItemButton('spawn-power-button spawn-power-menu-button');
        button.y_align = Clutter.ActorAlign.CENTER;
        const box = new St.BoxLayout({style_class: 'spawn-row-box'});
        const menuIcon = new St.Icon({icon_size: size, y_align: Clutter.ActorAlign.CENTER});
        this._setIcon(menuIcon, POWER_INFO[PowerType.POWER_OFF].icon);
        box.add_child(menuIcon);
        box.add_child(new St.Label({text: _('Power Off'), y_align: Clutter.ActorAlign.CENTER}));
        button.set_child(makeFace('spawn-power-surface', box));
        this._row.add_child(button);
        this._menuButton = button;

        const menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.BOTTOM);
        menu.actor.add_style_class_name('spawn-popup spawn-power-popup');
        const manager = new PopupMenu.PopupMenuManager(button);
        manager.addMenu(menu);
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this._menu = menu;
        this._menuManager = manager;

        wireItem(button, {activate: () => {
            menu.removeAll();
            for (const type of this._enabledTypes()) {
                if (!this._settings.get('dev-mode') && !isPowerAvailable(type, this._logind))
                    continue;
                const info = POWER_INFO[type];
                if (!info)
                    continue;
                menu.addAction(info.name, () => runPowerAction(type, this._host, this._scope), info.icon as never);
            }
            if (menu.isOpen)
                closeMenu(menu);
            else
                openMenu(menu);
        }});
    }

    private _refresh(): void {
        if (this._destroyed)
            return;
        // dev-mode (headless test shell) has no session manager: show every configured button.
        const available = (t: number) => this._settings.get('dev-mode') || isPowerAvailable(t, this._logind);
        if (this._menuButton) {
            this._menuButton.visible = this._enabledTypes().some(available);
            this._markEnds();
            return;
        }
        this._avail = this._enabledTypes().filter(t => POWER_INFO[t] && available(t));
        this._layout();
    }

    /** Coalesced, outside the allocation cycle: the row's width changed. */
    private _scheduleFit(): void {
        if (this._laterId || this._destroyed || this._menuButton)
            return;
        this._laterId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laterId = 0;
            this._layout();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Fit the available buttons to the row's width; touches actors only when the result changed. */
    private _layout(): void {
        if (this._destroyed || this._menuButton)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage as Clutter.Stage).scale_factor;
        // the last allocation, never `width` (that asks for a preferred size, which needs a theme node, so the
        // stage) and not gated on has_allocation(): a relayout queued after the width changed must not read as 0
        const width = this._row.allocation.get_width() / scale;
        // not allocated yet: show everything as before, notify::width comes back here
        const fit = fitPowerRow(width > 0 ? width : Infinity, this._avail);
        const sig = `${fit.mode}|${fit.surface}|${fit.visible.join(',')}|${fit.overflow.join(',')}`;
        if (sig === this._sig)
            return;
        this._sig = sig;
        this._fit = fit;
        const px = fit.mode === 'normal' ? '' : `min-width: ${fit.surface}px; width: ${fit.surface}px;`;
        if (fit.mode === 'normal')
            this._row.remove_style_class_name('spawn-power-compact');
        else
            this._row.add_style_class_name('spawn-power-compact');
        for (const b of this._buttons) {
            b.actor.visible = fit.visible.includes(b.type);
            b.surface.style = px;
        }
        if (this._more) {
            this._more.actor.visible = fit.overflow.length > 0;
            this._more.surface.style = px;
            if (!this._more.actor.visible && this._menu?.isOpen)
                closeMenu(this._menu);
        }
        this._markEnds();
    }

    /** The pane's 8 px at the ends belong to the first / last visible button. */
    private _markEnds(): void {
        for (const b of this._row.get_children() as St.Widget[]) {
            b.remove_style_class_name('spawn-power-first');
            b.remove_style_class_name('spawn-power-last');
        }
        const shown = this.buttons();
        shown[0]?.add_style_class_name('spawn-power-first');
        shown[shown.length - 1]?.add_style_class_name('spawn-power-last');
    }
}

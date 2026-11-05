// PowerBar: power buttons from `power-options` (a(ib): id, enabled) in `power-display-style`
// (Default / In_Line: a row of icon buttons; Menu: one "Power Off" button opening a list).
//
// Buttons are ordered by severity (POWER_RANK: switch user, lock, log out, suspend, ..., restart,
// power off), not by the stored order; a flexible spacer pushes the destructive pair (restart,
// power off) to the far end so they are never next to the harmless ones (that spacer is dead on purpose).
// 40x32 targets, 8 px apart (stylesheet.css); every button is a transparent hit area (its padding is the
// gap to its neighbours and the pane's edge) around a `spawn-power-surface` that draws it. `icon-style-buttons` picks the symbolic or the full-colour icon.
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
import {makeFace, makeItemButton, wireItem} from './interact.js';
import {isDestructive, isPowerAvailable, type LogindInfo, POWER_INFO, POWER_RANK, powerSignalNames, probeLogind, runPowerAction, systemActions} from './powerActions.js';
import type {ShortcutHost} from './shortcutRow.js';

/** Icon-only buttons need their name quickly (the default tooltip delay is 450 ms). */
const TOOLTIP_DELAY_MS = 200;

interface PowerButton {
    type: number;
    actor: St.Button;
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
        return this._buttons.filter(b => b.actor.visible).map(b => b.actor);
    }

    destroy(): void {
        this._destroy();
    }

    private _destroy(): void {
        if (this._destroyed)
            return;
        this._destroyed = true;
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
        this._teardownMenu();
        this._buttons.length = 0;
        for (const c of this._row.get_children())
            c.destroy();

        const style = this._settings.get('power-display-style');
        const size = iconSizeFor(this._settings, 'icon-size-buttons', 16);
        if (style === 'Menu') {
            this._buildMenuButton(size);
        } else {
            let spacer = false;
            for (const type of this._enabledTypes()) {
                const info = POWER_INFO[type];
                if (!info)
                    continue;
                const destructive = isDestructive(type);
                if (destructive && !spacer && this._buttons.length > 0) {
                    spacer = true;
                    this._row.add_child(new St.Widget({style_class: 'spawn-power-spacer', x_expand: true}));
                }
                const button = makeItemButton(destructive ? 'spawn-power-button spawn-power-destructive' : 'spawn-power-button');
                button.x_expand = false;
                button.y_align = Clutter.ActorAlign.CENTER;
                const icon = new St.Icon({icon_size: size, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
                this._setIcon(icon, info.icon);
                button.set_child(makeFace('spawn-power-surface', icon));
                button.accessible_name = info.name;
                this._host.tooltips?.attach(button, null, () => info.name, {delay: TOOLTIP_DELAY_MS});
                wireItem(button, {activate: () => runPowerAction(type, this._host, this._scope)});
                this._row.add_child(button);
                this._buttons.push({type, actor: button});
            }
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
        for (const b of this._buttons)
            b.actor.visible = available(b.type);
        if (this._menuButton)
            this._menuButton.visible = this._enabledTypes().some(available);
        // the pane's 8 px at the ends belong to the first / last visible button
        const shown = this.buttons() as St.Button[];
        for (const b of [...this._buttons.map(x => x.actor), ...(this._menuButton ? [this._menuButton] : [])]) {
            b.remove_style_class_name('spawn-power-first');
            b.remove_style_class_name('spawn-power-last');
        }
        shown[0]?.add_style_class_name('spawn-power-first');
        shown[shown.length - 1]?.add_style_class_name('spawn-power-last');
    }
}

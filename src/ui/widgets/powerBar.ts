// PowerBar: power buttons from `power-options` (a(ib): id, enabled) in `power-display-style`
// (Default / In_Line: a row of icon buttons; Menu: one "Power Off" button opening a list).
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
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {PowerType} from '../../core/constants.js';
import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import {iconSizeFor} from '../util.js';
import {makeItemButton, wireItem} from './interact.js';
import {isPowerAvailable, type LogindInfo, POWER_INFO, powerSignalNames, probeLogind, runPowerAction, systemActions} from './powerActions.js';
import type {ShortcutHost} from './shortcutRow.js';

interface PowerButton {
    type: number;
    actor: St.Button;
}

export class PowerBar {
    readonly actor: St.BoxLayout;
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
        this.actor = new St.BoxLayout({style_class: 'spawn-menu-power-bar', x_expand: true});

        this._build();
        const sa = systemActions();
        if (sa) {
            for (const sig of powerSignalNames)
                scope.connect(sa, sig, () => this._refresh());
        }
        settings.onChanged(scope, ['power-options', 'power-display-style', 'icon-size-buttons'], () => this._build());
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
        return this._settings.get('power-options').filter(([, on]) => on).map(([id]) => id);
    }

    private _build(): void {
        if (this._destroyed)
            return;
        this._teardownMenu();
        this._buttons.length = 0;
        for (const c of this.actor.get_children())
            c.destroy();

        const style = this._settings.get('power-display-style');
        const size = iconSizeFor(this._settings, 'icon-size-buttons', 16);
        if (style === 'Menu') {
            this._buildMenuButton(size);
        } else {
            for (const type of this._enabledTypes()) {
                const info = POWER_INFO[type];
                if (!info)
                    continue;
                const button = makeItemButton('spawn-menu-power-button');
                button.x_expand = false;
                button.set_child(new St.Icon({icon_name: info.icon, icon_size: size}));
                button.accessible_name = info.name;
                this._host.tooltips?.attach(button, null, () => info.name);
                wireItem(button, {activate: () => runPowerAction(type, this._host, this._scope)});
                this.actor.add_child(button);
                this._buttons.push({type, actor: button});
            }
        }
        this._refresh();
    }

    private _buildMenuButton(size: number): void {
        const button = makeItemButton('spawn-menu-power-button spawn-menu-power-menu-button');
        const box = new St.BoxLayout({style_class: 'spawn-menu-row-box'});
        box.add_child(new St.Icon({icon_name: POWER_INFO[PowerType.POWER_OFF].icon, icon_size: size, y_align: Clutter.ActorAlign.CENTER}));
        box.add_child(new St.Label({text: POWER_INFO[PowerType.POWER_OFF].name, y_align: Clutter.ActorAlign.CENTER}));
        button.set_child(box);
        this.actor.add_child(button);
        this._menuButton = button;

        const menu = new PopupMenu.PopupMenu(button, 0.5, St.Side.BOTTOM);
        menu.actor.add_style_class_name('spawn-menu-popup spawn-menu-power-popup');
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
            menu.toggle();
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
    }
}

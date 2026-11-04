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
//   MenuButtonDeps: {settings, iconDir, popup: {toggle(anchor)}}
//
// Click mapping uses menu-button-{left,middle,right}-click-action ('Menu' | 'None').

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {resolveButtonIcon} from '../core/icons.js';
import {error} from '../core/log.js';
import type {MenuButtonClickAction, SpawnSettings} from '../core/settings.js';

export interface MenuButtonDeps {
    settings: SpawnSettings;
    iconDir: string;
    popup: {toggle(anchor: St.Widget): void};
}

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

    constructor(deps: MenuButtonDeps) {
        super(0.5, 'Spawn Menu', true);
        this._deps = deps;

        this.add_style_class_name('spawn-menu-button');

        this._box = new St.BoxLayout({style_class: 'spawn-menu-button-box'});
        this._icon = new St.Icon({style_class: 'spawn-menu-button-icon system-status-icon', y_align: Clutter.ActorAlign.CENTER});
        this._label = new St.Label({style_class: 'spawn-menu-button-label', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._box);

        const gesture = new Clutter.ClickGesture();
        gesture.set_recognize_on_press(true);
        gesture.connect('recognize', () => this._onClick(gesture.get_button()));
        this.add_action(gesture);

        this.refresh();
    }

    refresh(): void {
        try {
            const s = this._deps.settings;
            const appearance = s.get('menu-button-appearance');
            const iconSize = s.get('menu-button-icon-size');
            const padding = s.get('menu-button-padding');

            const resolved = resolveButtonIcon(s.get('menu-button-icon'), this._deps.iconDir);
            if (resolved.kind === 'file')
                this._icon.gicon = new Gio.FileIcon({file: Gio.File.new_for_path(resolved.path)});
            else
                this._icon.icon_name = resolved.name;
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
            if (action === 'Menu')
                this._deps.popup.toggle(this);
        } catch (e) {
            error('MenuButton click failed', e);
        }
    }
}

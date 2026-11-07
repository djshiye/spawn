// UserCard: avatar (round or square per avatar-style) + real name; click opens the Users page of
// GNOME Settings. Hidden when show-user-avatar is false.
//
// Public API:
//   new UserCard(scope: Scope, settings: SpawnSettings, host: ShortcutHost)
//   card.actor: St.Widget
//   card.destroy()

import AccountsService from 'gi://AccountsService';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as UserWidget from 'resource:///org/gnome/shell/ui/userWidget.js';

import {error} from '../../core/log.js';
import type {Scope} from '../../core/scope.js';
import type {SpawnSettings} from '../../core/settings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {nameItem} from './a11y.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import type {ShortcutHost} from './shortcutRow.js';

const AVATAR_SIZE = 40;

// Avatar is exported by the shell module but missing from the typings.
const AvatarClass = (UserWidget as unknown as {Avatar: new (user: AccountsService.User, params: {iconSize: number; styleClass: string}) => St.Widget}).Avatar;

export class UserCard {
    readonly actor: St.Button;
    private readonly _settings: SpawnSettings;
    private readonly _label: St.Label;
    private readonly _avatarBox: St.Bin;
    private _avatar: St.Widget | null = null;
    private _user: AccountsService.User | null = null;
    private _destroyed = false;

    constructor(scope: Scope, settings: SpawnSettings, host: ShortcutHost) {
        this._settings = settings;
        const button = makeItemButton('spawn-user-card');
        this.actor = button;

        const box = new St.BoxLayout({style_class: 'spawn-user-card-box', x_expand: true});
        this._avatarBox = new St.Bin({y_align: Clutter.ActorAlign.CENTER, style_class: 'spawn-avatar-box'});
        this._label = new St.Label({
            text: GLib.get_real_name() || GLib.get_user_name(),
            style_class: 'spawn-user-name',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(this._avatarBox);
        box.add_child(this._label);
        button.set_child(makeFace('spawn-card-surface', box));

        this._name();
        host.tooltips?.attach(button, this._label);
        wireItem(button, {
            activate: () => {
                host.close();
                try {
                    GLib.spawn_command_line_async('gnome-control-center system users');
                } catch (e) {
                    error('could not open the Users settings', e);
                }
            },
        });

        try {
            const manager = AccountsService.UserManager.get_default();
            const user = manager.get_user(GLib.get_user_name());
            this._user = user;
            scope.connect(user, 'notify::is-loaded', () => this._update());
            scope.connect(user, 'changed', () => this._update());
        } catch (e) {
            error('AccountsService unavailable', e);
        }
        this._update();
        this._applyStyle();
        settings.onChanged(scope, ['avatar-style', 'show-user-avatar'], () => this._applyStyle());
        scope.add(() => {
            this._destroyed = true;
            this._avatar = null;
            this.actor.destroy();
        }, 'UserCard');
    }

    destroy(): void {
        this._destroyed = true;
        this.actor.destroy();
    }

    /** "Alex Smith, account settings": the card opens the Users page. */
    private _name(): void {
        nameItem(this.actor, _('%s, account settings').replace('%s', this._label.text), {label: this._label});
    }

    private _applyStyle(): void {
        if (this._destroyed)
            return;
        const square = this._settings.get('avatar-style') === 'Square';
        // A class, not inline style: the shell's Avatar rewrites its own `style` on every update().
        for (const w of [this._avatar, this._avatarBox.get_child() as St.Widget | null]) {
            if (!w)
                continue;
            if (square)
                w.add_style_class_name('spawn-avatar-square');
            else
                w.remove_style_class_name('spawn-avatar-square');
        }
        this.actor.visible = this._settings.get('show-user-avatar');
    }

    private _update(): void {
        if (this._destroyed)
            return;
        const user = this._user;
        if (user?.is_loaded) {
            this._label.text = user.get_real_name() || user.get_user_name() || this._label.text;
            this._name();
            if (!this._avatar) {
                this._avatar = new AvatarClass(user, {iconSize: AVATAR_SIZE, styleClass: 'user-icon spawn-avatar'});
                this._avatarBox.set_child(this._avatar);
            }
            (this._avatar as unknown as {update(): void}).update();
        } else if (!this._avatar) {
            this._avatarBox.set_child(new St.Icon({icon_name: 'avatar-default-symbolic', icon_size: AVATAR_SIZE, style_class: 'user-icon spawn-avatar'}));
        }
        this._applyStyle();
    }
}

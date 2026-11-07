// UndoBanner: the in-menu toast "<message>  [Undo]" shown at the bottom of the left pane after a
// destructive action (deleting a pinned folder). Not a desktop notification: it lives inside the menu,
// uses the menu's tokens (8 px grid, .spawn-nav-button for the focusable Undo button, so it gets the
// accent focus ring like every other item) and is reachable with Tab / arrows (layout.ts adds its
// button as a keyboard group while visible). The owner decides how long it stays.
//
// Public API:
//   new UndoBanner(onUndo: () => void)
//   banner.actor: St.BoxLayout          class "spawn-undo-banner" (hidden until show())
//   banner.button: St.Button            the Undo button
//   banner.show(message: string): void
//   banner.hide(): void
//   banner.visible: boolean

import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {nameItem} from './a11y.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';

export class UndoBanner {
    readonly actor: St.BoxLayout;
    readonly button: St.Button;
    private readonly _label: St.Label;

    constructor(onUndo: () => void) {
        // An ALERT: a screen reader speaks the message when the banner appears.
        this.actor = new St.BoxLayout({style_class: 'spawn-undo-banner', x_expand: true, visible: false, accessible_role: Atk.Role.ALERT});
        this._label = new St.Label({style_class: 'spawn-undo-label', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.button = makeItemButton('spawn-nav-button spawn-undo-button');
        this.button.x_expand = false;
        // Like every menu item: a transparent button around a visible face that draws hover/focus.
        const undoLabel = new St.Label({text: _('Undo'), y_align: Clutter.ActorAlign.CENTER});
        this.button.set_child(makeFace('spawn-nav-surface', undoLabel));
        nameItem(this.button, _('Undo'), {label: undoLabel});
        wireItem(this.button, {activate: () => onUndo()});
        this.actor.add_child(this._label);
        this.actor.add_child(this.button);
    }

    get visible(): boolean {
        return this.actor.visible;
    }

    show(message: string): void {
        this._label.text = message;
        this.actor.accessible_name = message;
        this.actor.show();
    }

    hide(): void {
        this.actor.hide();
    }
}

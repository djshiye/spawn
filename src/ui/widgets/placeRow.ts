// PlaceRow: a right-pane row for a mounted device, network location or file manager bookmark
// (src/model/places.ts). A shortcut row in every respect (`spawn-shortcut-row` outer hit area, visible
// `spawn-row-surface` face) plus, for removable places, a small Eject / Unmount button at the right end
// of the face: its own focus stop (Right arrow from the row reaches it, Left comes back).
//
// Public API:
//   new PlaceRow(place: Place, host: ShortcutHost, opts?: {iconSize?: number})
//   row.actor: St.Button
//   row.ejectButton: St.Button | null     the eject button inside the face
//   row.destroy()

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import type {Place} from '../../model/places.js';
import {nameItem} from './a11y.js';
import {makeFace, makeItemButton, wireItem} from './interact.js';
import type {ShortcutHost} from './shortcutRow.js';

export class PlaceRow {
    readonly actor: St.Button;
    readonly isSeparator = false;
    readonly ejectButton: St.Button | null = null;

    constructor(place: Place, host: ShortcutHost, opts: {iconSize?: number} = {}) {
        const button = makeItemButton('spawn-shortcut-row');
        this.actor = button;

        const box = new St.BoxLayout({style_class: 'spawn-row-box', x_expand: true});
        const size = opts.iconSize ?? 16;
        if (size > 0) {
            box.add_child(new St.Icon({
                style_class: 'spawn-shortcut-icon',
                icon_size: size,
                gicon: place.icon,
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        const label = new St.Label({
            text: place.name,
            style_class: 'spawn-shortcut-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        box.add_child(label);

        if (place.ejectLabel) {
            const eject = new St.Button({
                style_class: 'spawn-eject-button',
                can_focus: true,
                reactive: true,
                track_hover: true,
                accessible_name: place.ejectLabel,
                y_align: Clutter.ActorAlign.FILL,
                child: new St.Icon({icon_name: 'media-eject-symbolic', icon_size: size > 0 ? size : 16, y_align: Clutter.ActorAlign.CENTER}),
            });
            eject.connect('clicked', () => place.eject());
            host.tooltips?.attach(eject, null, () => place.ejectLabel);
            box.add_child(eject);
            this.ejectButton = eject;
        }
        button.set_child(makeFace('spawn-row-surface', box));

        nameItem(button, place.name, {label, listItem: true});
        host.tooltips?.attach(button, label);
        wireItem(button, {
            activate: () => {
                host.close();
                place.open();
            },
        });
    }

    destroy(): void {
        this.actor.destroy();
    }
}

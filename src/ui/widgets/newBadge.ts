// The "New" markers of recently installed apps (model/newAppsStore.ts decides which apps are new).
//
// Public API:
//   makeNewBadge(): St.Label           the small "New" pill ("spawn-new-badge"), for an app row or tile
//   makeNewDot(): St.Widget            the subtle dot ("spawn-new-dot") on a category that contains a new app
//   newAccessibleName(name, isNew)     "Firefox" / "Firefox, new": the accessible name of a row or tile, so a
//                                      screen reader reads the badge too (the badge itself is decoration)

import Clutter from 'gi://Clutter';
import St from 'gi://St';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export function makeNewBadge(): St.Label {
    return new St.Label({
        text: _('New'),
        style_class: 'spawn-new-badge',
        y_align: Clutter.ActorAlign.CENTER,
    });
}

export function makeNewDot(): St.Widget {
    return new St.Widget({
        style_class: 'spawn-new-dot',
        y_align: Clutter.ActorAlign.CENTER,
    });
}

export function newAccessibleName(name: string, isNew: boolean): string {
    return isNew ? _('%s, new').format(name) : name;
}

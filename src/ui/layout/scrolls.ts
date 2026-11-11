// ScrollFactory: the scroll views of the layout's lists, all built the same way.
//
// Responsibility: create a vertical-only St.ScrollView around a list with the user's scroll bar settings
// applied, and remember the ones that must follow a live change of those settings.
//
// Public API:
//   new ScrollFactory(settings)
//   factory.make(child, styleClass, track = true): St.ScrollView
//       `track`: remember it so scroll settings changes re-apply live (views built once; not the right pane)
//   factory.tracked(): St.ScrollView[]

import St from 'gi://St';

import type {Services} from '../../core/services.js';
import {applyScrollSettings} from '../util.js';

export class ScrollFactory {
    private readonly _settings: Services['settings'];
    private readonly _scrolls: St.ScrollView[] = [];

    constructor(settings: Services['settings']) {
        this._settings = settings;
    }

    make(child: St.Widget, styleClass: string, track = true): St.ScrollView {
        const scroll = new St.ScrollView({
            style_class: styleClass,
            hscrollbar_policy: St.PolicyType.NEVER,
            x_expand: true,
            y_expand: true,
        });
        applyScrollSettings(scroll, this._settings);
        scroll.add_child(child);
        if (track)
            this._scrolls.push(scroll);
        return scroll;
    }

    tracked(): St.ScrollView[] {
        return this._scrolls;
    }
}

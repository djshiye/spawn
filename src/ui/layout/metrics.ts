// PaneMetrics: sizes of the two-pane layout and what derives from them.
//
// Responsibility: turn the size settings into pane widths, menu height, tile columns / width / icon size,
// clamped to the work area of the monitor the popup opens on; answer the display-mode questions
// (grid or list, item size, list icon size) that depend on the same settings.
//
// Public API:
//   MIN_LEFT_WIDTH, MIN_RIGHT_WIDTH   floors the code enforces whatever the settings say
//   new PaneMetrics({settings, root, panes, left, right, vsep, anchor})
//   metrics.apply(): boolean          re-derive and apply; true when columns / tile width / icon size changed
//   metrics.cols / tileWidth / tileIconSize   the current pinned-grid metrics
//   metrics.contentSize()             pane widths + separator, menu height (what the folder popup centres in)
//   metrics.listMode() / itemSize() / rowIconSize()   `pinned-apps-display`, `pinned-item-size`, list icon size

import type St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {gridIconSize} from '../../core/limits.js';
import type {Services} from '../../core/services.js';
import type {PinnedItemSize} from '../../core/settings.js';
import {iconSizeFor} from '../util.js';
import {sizeMetrics} from '../widgets/pinnedSize.js';

/**
 * Floors the code enforces whatever the settings say (the prefs spin rows use the same minimums):
 * left pane 420 px (4 tile columns need ~390), right pane 180 px (avatar + names + 3 power buttons).
 */
export const MIN_LEFT_WIDTH = 420;
export const MIN_RIGHT_WIDTH = 180;
const MIN_COLUMNS = 3;
/**
 * Horizontal space used inside the left pane that tiles cannot use: the 16 + 16 px gutter (the pane's 8 px
 * edge plus the grid's 8 px; the left pane has no padding of its own, both are the padding of the first /
 * last column's tiles, which also absorbs a classic scrollbar).
 */
const LEFT_CHROME = 32;
const MIN_HEIGHT = 360;
/** Popup frame around the layout: the panes' 2x8 inset, shadow margins 3+3 / 14, arrow, breathing room. */
const FRAME_W = 16 + 6;
const FRAME_H = 16 + 14 + 14;
/** The panes' margin inside the layout root (.spawn-panes): the folder scrim lies over the root, edge to edge, around it. */
const PANES_INSET = 8;
const SCREEN_MARGIN = 8;
/** Right pane margin (4) + vertical separator with its margins (1 + 2 x 6). */
const PANE_GAP = 4;
const SEPARATOR_W = 13;

export interface PaneMetricsDeps {
    settings: Services['settings'];
    /** The layout root (its height is set). */
    root: St.Widget;
    panes: St.Widget;
    left: St.Widget;
    right: St.Widget;
    vsep: St.Widget;
    /** The popup's anchor: decides the work area the popup is clamped to. */
    anchor(): St.Widget | null;
}

export class PaneMetrics {
    cols = 4;
    tileWidth = 96;
    tileIconSize = sizeMetrics('Compact').tileIcon;
    private readonly _d: PaneMetricsDeps;
    /** cols|tile width|icon size of the last `apply`: a change means the pinned tiles are stale. */
    private _sig = '';

    constructor(deps: PaneMetricsDeps) {
        this._d = deps;
    }

    /** Size of the menu content the folder popup is centred in (pane widths + separator, menu height). */
    contentSize(): {width: number; height: number} {
        // Fixed sizes from apply(): readable before the layout is staged or allocated.
        const width = this._d.left.width + this._d.right.width + PANE_GAP + (this._d.vsep.visible ? SEPARATOR_W : 0);
        return {width, height: this._d.panes.height};
    }

    /** Work area of the monitor the popup opens on (the anchor's, else the primary one). */
    private _workArea(): {width: number; height: number} | null {
        try {
            const lm = Main.layoutManager;
            const anchor = this._d.anchor();
            const index = anchor ? lm.findIndexForActor(anchor) : lm.primaryIndex;
            const wa = lm.getWorkAreaForMonitor(index >= 0 ? index : lm.primaryIndex);
            return wa ? {width: wa.width, height: wa.height} : null;
        } catch {
            return null;
        }
    }

    /**
     * Pane widths and menu height from the settings, clamped to the work area of the anchor's
     * monitor: the left pane shrinks first (never below MIN_LEFT_WIDTH), then the right pane (never
     * below MIN_RIGHT_WIDTH); the height never exceeds the work area minus the popup frame.
     */
    apply(): boolean {
        const s = this._d.settings;
        let left = Math.max(MIN_LEFT_WIDTH, s.get('left-panel-width') + s.get('menu-width-adjustment'));
        let right = Math.max(MIN_RIGHT_WIDTH, s.get('right-panel-width'));
        const sep = s.get('vert-separator');
        const wa = this._workArea();

        let maxH = Infinity;
        if (wa) {
            maxH = Math.max(0, wa.height - 2 * SCREEN_MARGIN - FRAME_H);
            const maxW = wa.width - 2 * SCREEN_MARGIN - FRAME_W - PANE_GAP - (sep ? SEPARATOR_W : 0);
            if (left + right > maxW) {
                left = Math.max(MIN_LEFT_WIDTH, maxW - right);
                if (left + right > maxW)
                    right = Math.max(MIN_RIGHT_WIDTH, maxW - left);
            }
        }
        const height = Math.max(Math.min(MIN_HEIGHT, maxH), Math.min(s.get('menu-height'), maxH));

        this._d.left.set_width(left);
        this._d.right.set_width(right);
        this._d.vsep.visible = sep;
        this._d.root.set_height(height + 2 * PANES_INSET);

        const avail = left - LEFT_CHROME;
        const metrics = sizeMetrics(s.get('pinned-item-size'));
        this.cols = Math.max(MIN_COLUMNS, Math.floor(avail / metrics.tileTargetWidth));
        this.tileWidth = Math.floor(avail / this.cols);
        const grid = s.get('icon-size-grid');
        this.tileIconSize = gridIconSize(grid?.size, metrics.tileIcon);

        const sig = `${this.cols}|${this.tileWidth}|${this.tileIconSize}`;
        const changed = this._sig !== '' && sig !== this._sig;
        this._sig = sig;
        return changed;
    }

    /** `pinned-apps-display`: pinned apps and folder contents as full-width rows instead of tiles. */
    listMode(): boolean {
        return this._d.settings.get('pinned-apps-display') === 'List';
    }

    /** `pinned-item-size`: Compact / Comfortable / Large (list row height, tile icon, folder plate). */
    itemSize(): PinnedItemSize {
        return this._d.settings.get('pinned-item-size');
    }

    /** Icon size of list rows: `icon-size-apps` when set, else the item size's default (28 at Compact, as the frequent / all-apps rows). */
    rowIconSize(): number {
        return iconSizeFor(this._d.settings, 'icon-size-apps', sizeMetrics(this.itemSize()).rowIcon);
    }
}

// pinned-item-size: the numbers behind Compact / Comfortable / Large (pure, no gi imports).
//
// List rows are `icon + 2 x padding` high: Compact 28 + 2x6 = 40 (the original look, the one
// off-grid value is that 6), Comfortable 32 + 2x8 = 48, Large 40 + 2x8 = 56. Grid tiles keep the
// 8 px icon / label spacing and scale the icon: 48 / 56 / 64, with 12 px (instead of 8) vertical
// padding at Large; Large also asks for wider columns, so the 420 px pane shows 3 instead of 4.
// An explicit `icon-size-apps` / `icon-size-grid` still decides the icon, the tier only supplies
// the default and the padding. The paddings and plate insets live in stylesheet.css
// (`.spawn-size-*` on the grid container): keep both in step.
//
// Public API:
//   sizeMetrics(size): SizeMetrics      {rowIcon, tileIcon, tileTargetWidth, plateInset, styleClass}
//   SIZE_CLASSES                        every `spawn-size-*` class (the container carries exactly one)

import type {PinnedItemSize} from '../../core/settings.js';

export interface SizeMetrics {
    /** Default icon of a list row. */
    rowIcon: number;
    /** Default icon of a grid tile. */
    tileIcon: number;
    /** Column width the grid aims for (columns = pane width / this). */
    tileTargetWidth: number;
    /** Padding of the folder plate inside a list row (the plate is as big as the row icon). */
    plateInset: number;
    styleClass: string;
}

const METRICS: Readonly<Record<PinnedItemSize, SizeMetrics>> = {
    Compact: {rowIcon: 28, tileIcon: 48, tileTargetWidth: 88, plateInset: 2, styleClass: 'spawn-size-compact'},
    Comfortable: {rowIcon: 32, tileIcon: 56, tileTargetWidth: 88, plateInset: 2, styleClass: 'spawn-size-comfortable'},
    Large: {rowIcon: 40, tileIcon: 64, tileTargetWidth: 120, plateInset: 4, styleClass: 'spawn-size-large'},
};

export const SIZE_CLASSES: readonly string[] = Object.values(METRICS).map(m => m.styleClass);

export function sizeMetrics(size: PinnedItemSize | string): SizeMetrics {
    return METRICS[size as PinnedItemSize] ?? METRICS.Compact;
}

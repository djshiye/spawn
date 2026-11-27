// Where a scroll view must scroll so that one item shows (pure: no gi imports, unit tested).
//
// Public API:
//   scrollTarget({value, viewH, top, height, margin?}): number
//       the new scroll offset: unchanged when the item (plus `margin`, default 8 px) is in view; the item's top minus
//       the margin when it is above; its bottom plus the margin at the view's bottom when it is below; never below 0.
//       An item less than one item-height from the top of the content (the first one under a section title) scrolls
//       to 0, so the title above it shows too.

export interface ScrollArgs {
    /** Current scroll offset. */
    value: number;
    /** Height of the scroll view. */
    viewH: number;
    /** The item's y in the scrolled content. */
    top: number;
    /** The item's height. */
    height: number;
    margin?: number;
}

export function scrollTarget({value, viewH, top, height, margin = 8}: ScrollArgs): number {
    let target = value;
    if (top - margin < value)
        target = top - margin <= height ? 0 : top - margin;
    else if (top + height + margin > value + viewH)
        target = top + height + margin - viewH;
    return Math.max(0, target);
}

// On-screen geometry helpers of the keyboard navigation.
//
// Responsibility: positions of actors on the stage (centre, inside the visible part of their scroll view)
// and the Page Up / Page Down target among a list of items. Pure functions of actors, no layout state.
//
// Public API:
//   centreOf(actor): Pos                       centre of an actor on the stage
//   inView(actor): boolean                     is (at least half of) `actor` inside its scroll view's visible part?
//   pageTo(items, from, dir): Actor | null     the item one visible page away from `from` (-1 up, 1 down), same column

import type Clutter from 'gi://Clutter';
import St from 'gi://St';

import {pageTarget, type Pos} from '../../model/listNav.js';

/** Centre of an actor on the stage. */
export function centreOf(actor: Clutter.Actor): Pos {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return {x: x + w / 2, y: y + h / 2};
}

/** Is `actor` (at least half of it) inside the visible part of the scroll view it is in, if any? */
export function inView(actor: Clutter.Actor): boolean {
    if (!actor.mapped)
        return false;
    let scroll = actor.get_parent();
    while (scroll && !(scroll instanceof St.ScrollView))
        scroll = scroll.get_parent();
    if (!scroll)
        return true;
    const c = centreOf(actor).y;
    const [, top] = scroll.get_transformed_position();
    const [, height] = scroll.get_transformed_size();
    return c >= top && c <= top + height;
}

/**
 * Page Up (-1) / Page Down (1) from `from` among `items` (screen order): the item one visible page of
 * their scroll view away, in the same column. Null when there is nothing to move to.
 */
export function pageTo(items: Clutter.Actor[], from: Clutter.Actor | null, dir: 1 | -1): Clutter.Actor | null {
    const index = from ? items.indexOf(from) : -1;
    if (index < 0)
        return null;
    let scroll: Clutter.Actor | null = from;
    while (scroll && !(scroll instanceof St.ScrollView))
        scroll = scroll.get_parent();
    const page = scroll ? Math.max(scroll.height - (from as Clutter.Actor).height, (from as Clutter.Actor).height) : 0;
    const target = pageTarget(items.map(centreOf), index, dir, page);
    return target === index ? null : items[target];
}

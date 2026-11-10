// Keyboard navigation arithmetic for the menu's lists and grids (pure: no gi imports, unit tested).
//
// Public API:
//   stepIndex(index, delta, count): number      one step with wrap-around (index -1 = nothing picked yet)
//   searchStep(key, searchOnTop): 1 | -1 | 0    which way Up / Down move the search highlight: away from the entry
//                                               = towards worse matches (top entry: Down; bottom entry, whose
//                                               results are shown best-last: Up)
//   pageTarget(items, index, dir, page): number  Page Up / Down: the item about one `page` (px) away, same column
//   nearestIndex(items, at): number             the item nearest to `at`, vertically first (moving between panes)
//   Pos: {x, y}                                 centre of an item (any common coordinate space)

export interface Pos {
    x: number;
    y: number;
}

/** Rows whose centres are this close (px) count as one row of a grid. */
const SAME_ROW = 2;

export function stepIndex(index: number, delta: number, count: number): number {
    if (count <= 0)
        return -1;
    if (index < 0)
        return delta > 0 ? 0 : count - 1;
    return ((index + delta) % count + count) % count;
}

export function searchStep(key: 'up' | 'down', searchOnTop: boolean): 1 | -1 {
    const away = searchOnTop ? 'down' : 'up';
    return key === away ? 1 : -1;
}

/** The item of `row` (a y) nearest to `x`; -1 when the row is empty. */
function inRow(items: Pos[], row: number, x: number): number {
    let best = -1;
    for (let i = 0; i < items.length; i++) {
        if (Math.abs(items[i].y - row) > SAME_ROW)
            continue;
        if (best < 0 || Math.abs(items[i].x - x) < Math.abs(items[best].x - x))
            best = i;
    }
    return best;
}

/**
 * Page Up (`dir` -1) / Page Down (1) from `index`: the farthest row whose centre is at most `page` px away (at
 * least the next row, so a key press always moves while there is somewhere to go); at the ends, the first / last
 * row. In that row, the item nearest to the current column.
 */
export function pageTarget(items: Pos[], index: number, dir: 1 | -1, page: number): number {
    const cur = items[index];
    if (!cur)
        return index;
    const ahead = items.filter(p => (p.y - cur.y) * dir > SAME_ROW).map(p => p.y);
    if (ahead.length === 0)
        return index;
    const target = cur.y + dir * Math.max(page, 1);
    const within = ahead.filter(y => (target - y) * dir >= -SAME_ROW);
    const row = within.length > 0
        ? (dir > 0 ? Math.max(...within) : Math.min(...within))
        : (dir > 0 ? Math.min(...ahead) : Math.max(...ahead));
    const hit = inRow(items, row, cur.x);
    return hit < 0 ? index : hit;
}

export function nearestIndex(items: Pos[], at: Pos): number {
    let best = -1;
    let bestDy = Infinity;
    let bestDx = Infinity;
    for (let i = 0; i < items.length; i++) {
        const dy = Math.abs(items[i].y - at.y);
        const dx = Math.abs(items[i].x - at.x);
        if (dy < bestDy - SAME_ROW || (Math.abs(dy - bestDy) <= SAME_ROW && dx < bestDx)) {
            best = i;
            bestDy = dy;
            bestDx = dx;
        }
    }
    return best;
}

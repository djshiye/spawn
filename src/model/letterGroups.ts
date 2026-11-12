// Letter groups and grid stepping of the Grid layout's All apps view (pure: no gi imports, unit tested).
//
// Responsibility: the arithmetic behind "A-Z groups, each starting on a new row" and the keyboard moves
// through such a grid (a letter heading is a row of its own, a group's last row may be short), and the
// letter picker's moves (some letters have no apps and are skipped).
//
// Public API:
//   LETTERS: string[]                           '#', 'A' ... 'Z': the picker's keys in order
//   letterOf(name): string                      'A'..'Z' (accents folded: "Édito" is E), else '#' (digits, symbols, other scripts)
//   groupByLetter(items, nameOf): LetterGroup[] items bucketed by letter, '#' first then A..Z, input order kept in a
//                                               bucket, empty buckets omitted
//   rowCount(count, cols): number               rows `count` tiles take in `cols` columns
//   RowSpan: {start, len}                       one row of a flat item list: items [start, start + len)
//   rowIndexOf(rows, index): number             the row holding item `index` (-1 when none)
//   stepRows(rows, index, dir, want): Step|null the item an arrow key reaches: up / down keep the preferred column
//                                               `want` (clamped to the target row), left / right stay in their row;
//                                               null = up / down past the first / last row (leave the grid)
//   Step: {index, col}                          the item to focus and the preferred column to remember
//   stepSlots(enabled, slot, dir, cols): number the picker's move among `enabled` slots (7 per row, some off): left / right
//                                               go to the previous / next enabled slot, up / down to the nearest enabled
//                                               slot in the same column; the same slot when there is none

export const LETTERS: string[] = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];

export type StepDir = 'up' | 'down' | 'left' | 'right';

export interface LetterGroup<T> {
    letter: string;
    items: T[];
}

export interface RowSpan {
    start: number;
    len: number;
}

export interface Step {
    index: number;
    col: number;
}

export function letterOf(name: string): string {
    const first = Array.from(name.trim())[0] ?? '';
    const folded = first.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    return /^[A-Z]$/.test(folded) ? folded : '#';
}

export function groupByLetter<T>(items: readonly T[], nameOf: (item: T) => string): Array<LetterGroup<T>> {
    const buckets = new Map<string, T[]>();
    for (const item of items) {
        const letter = letterOf(nameOf(item));
        const list = buckets.get(letter);
        if (list)
            list.push(item);
        else
            buckets.set(letter, [item]);
    }
    return LETTERS.filter(l => buckets.has(l)).map(letter => ({letter, items: buckets.get(letter) as T[]}));
}

export function rowCount(count: number, cols: number): number {
    return count <= 0 ? 0 : Math.ceil(count / Math.max(1, cols));
}

export function rowIndexOf(rows: readonly RowSpan[], index: number): number {
    return rows.findIndex(r => index >= r.start && index < r.start + r.len);
}

export function stepRows(rows: readonly RowSpan[], index: number, dir: StepDir, want: number): Step | null {
    const r = rowIndexOf(rows, index);
    if (r < 0)
        return null;
    const row = rows[r];
    const col = index - row.start;
    if (dir === 'left' || dir === 'right') {
        const t = Math.max(0, Math.min(row.len - 1, col + (dir === 'left' ? -1 : 1)));
        return {index: row.start + t, col: t};
    }
    const target = rows[r + (dir === 'up' ? -1 : 1)];
    if (!target)
        return null;
    return {index: target.start + Math.max(0, Math.min(target.len - 1, want)), col: want};
}

export function stepSlots(enabled: readonly boolean[], slot: number, dir: StepDir, cols: number): number {
    const n = enabled.length;
    if (dir === 'left' || dir === 'right') {
        const d = dir === 'left' ? -1 : 1;
        for (let i = slot + d; i >= 0 && i < n; i += d) {
            if (enabled[i])
                return i;
        }
        return slot;
    }
    const d = dir === 'up' ? -cols : cols;
    for (let i = slot + d; i >= 0 && i < n; i += d) {
        if (enabled[i])
            return i;
    }
    return slot;
}

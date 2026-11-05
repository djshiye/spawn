// Keyboard reordering of pinned entries: where does an entry go for Ctrl+arrow / Ctrl+Home / Ctrl+End?
// Pure (no gi imports), unit-tested in tests/reorder.test.js.
//
// Public API:
//   reorderTarget(index, count, columns, key): number | null
//       index    current position of the entry in the shown list (row-major for a grid)
//       count    entries in the shown list
//       columns  1 = List (Up/Down move one position, Left/Right do nothing); > 1 = Grid (Left/Right
//                one position, Up/Down one row, a row below a short last row clamps to the last slot)
//       key      'up' | 'down' | 'left' | 'right' | 'first' | 'last'
//       returns the new position, or null when the move is a no-op (edge, wrong axis, bad input)

export type ReorderKey = 'up' | 'down' | 'left' | 'right' | 'first' | 'last';

export function reorderTarget(index: number, count: number, columns: number, key: ReorderKey): number | null {
    if (!Number.isInteger(index) || !Number.isInteger(count) || index < 0 || index >= count)
        return null;
    const cols = Math.max(1, Math.floor(columns) || 1);
    let target: number;
    switch (key) {
    case 'first':
        target = 0;
        break;
    case 'last':
        target = count - 1;
        break;
    case 'up':
        target = index - cols;
        break;
    case 'down':
        target = index + cols;
        if (cols > 1 && target > count - 1 && Math.floor(index / cols) < Math.floor((count - 1) / cols))
            target = count - 1;
        break;
    case 'left':
        if (cols === 1)
            return null;
        target = index - 1;
        break;
    case 'right':
        if (cols === 1)
            return null;
        target = index + 1;
        break;
    }
    if (target < 0 || target > count - 1 || target === index)
        return null;
    return target;
}

// pinned-item-size tiers: Compact is today's look, the others are strictly bigger on the 4 px grid.
import {SIZE_CLASSES, sizeMetrics} from '../build/ui/widgets/pinnedSize.js';
import {assert, assertEquals, run, test} from './harness.js';

test('Compact keeps the original metrics (28 px row icon, 48 px tile icon, 88 px columns)', () => {
    const m = sizeMetrics('Compact');
    assertEquals([m.rowIcon, m.tileIcon, m.tileTargetWidth, m.plateInset], [28, 48, 88, 2]);
});

test('Comfortable and Large grow monotonically', () => {
    const [c, m, l] = ['Compact', 'Comfortable', 'Large'].map(sizeMetrics);
    assert(c.rowIcon < m.rowIcon && m.rowIcon < l.rowIcon, 'row icons');
    assert(c.tileIcon < m.tileIcon && m.tileIcon < l.tileIcon, 'tile icons');
    assert(l.tileTargetWidth > c.tileTargetWidth, 'Large asks for wider columns');
    for (const x of [c, m, l])
        assertEquals(x.tileIcon % 4, 0, 'tile icon on the 4 px grid');
});

test('an unknown size falls back to Compact, every tier has its own class', () => {
    assertEquals(sizeMetrics('Huge'), sizeMetrics('Compact'));
    assertEquals(new Set(SIZE_CLASSES).size, 3);
});

run();

// Power row fitting: fitPowerRow (build/ui/widgets/powerFit.js).
import {fitPowerRow, OVERFLOW_ORDER} from '../build/ui/widgets/powerFit.js';
import {PowerType as P} from '../build/core/constants.js';
import {assert, assertEquals, run, test} from './harness.js';

// rank order (POWER_RANK): switch user, lock, log out, suspend, hybrid, hibernate, restart, power off
const RANK = [P.SWITCH_USER, P.LOCK, P.LOGOUT, P.SUSPEND, P.HYBRID_SLEEP, P.HIBERNATE, P.RESTART, P.POWER_OFF];
const set = n => {
    const pick = {3: [P.LOCK, P.LOGOUT, P.POWER_OFF], 4: [P.LOCK, P.LOGOUT, P.RESTART, P.POWER_OFF],
        5: [P.LOCK, P.LOGOUT, P.SUSPEND, P.RESTART, P.POWER_OFF], 8: RANK}[n];
    return RANK.filter(t => pick.includes(t));
};
const widths = [180, 200, 248, 260, 400];

function used(r) {
    return 16 + r.slots * r.surface + Math.max(0, r.slots - 1) * r.gap;
}

test('every count / width fits and keeps Power Off visible', () => {
    for (const n of [3, 4, 5, 8]) {
        for (const w of widths) {
            const types = set(n);
            const r = fitPowerRow(w, types);
            assert(used(r) <= w, `${n} buttons @${w}: ${used(r)} px > ${w}`);
            assert(r.visible.includes(P.POWER_OFF), `${n} @${w}: Power Off hidden`);
            assertEquals([...r.visible, ...r.overflow].sort(), types.slice().sort(), `${n} @${w} partition`);
            assert(r.surface <= 40 && (r.mode === 'overflow' ? r.surface >= 32 || w < 150 : r.surface >= 32));
        }
    }
});

test('normal when 48n+8 fits (no change)', () => {
    assertEquals(fitPowerRow(400, set(8)).mode, 'normal');
    assertEquals(fitPowerRow(248, set(5)).mode, 'normal');
    assertEquals(fitPowerRow(248, set(5)).surface, 40);
    assertEquals(fitPowerRow(180, set(3)).mode, 'normal');
    assertEquals(fitPowerRow(260, set(5)).gap, 8);
});

test('compact: 5 buttons in 200 px', () => {
    const r = fitPowerRow(200, set(5));
    assertEquals(r.mode, 'compact');
    assertEquals(r.surface, 33);
    assertEquals(r.visible.length, 5);
    assertEquals(fitPowerRow(180, set(4)).mode, 'compact');
});

test('overflow: 8 buttons in 200 px keep Lock + Restart + Power Off, in rank order', () => {
    const r = fitPowerRow(200, set(8));
    assertEquals(r.mode, 'overflow');
    assertEquals(r.slots, 5);
    assertEquals(r.visible.length, 4);
    assert(r.visible.includes(P.LOCK) && r.visible.includes(P.RESTART) && r.visible.includes(P.POWER_OFF));
    assertEquals(r.overflow.includes(P.HYBRID_SLEEP) && r.overflow.includes(P.HIBERNATE), true);
    const idx = r.visible.map(t => RANK.indexOf(t));
    assertEquals(idx, idx.slice().sort((a, b) => a - b));
});

test('overflow order: Power Off is hidden last', () => {
    assertEquals(OVERFLOW_ORDER[OVERFLOW_ORDER.length - 1], P.POWER_OFF);
    const r = fitPowerRow(100, set(8));
    assertEquals(r.mode, 'overflow');
    assertEquals(r.visible, [P.POWER_OFF]);
});

test('a single button in 60 px', () => {
    const r = fitPowerRow(60, [P.POWER_OFF]);
    assertEquals(r.mode, 'normal');
    assert(used(r) <= 60);
});

run();

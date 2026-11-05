// Show Desktop decision logic (core/desktopToggle.ts): memory per workspace, stale memory, survival.
import {DesktopMemory} from '../build/core/desktopToggle.js';
import {assertEquals, run, test} from './harness.js';

const win = (seq, over = {}) => ({seq, minimized: false, showing: true, toggleable: true, ...over});
const all = (...ws) => ws.map(w => w.seq);

test('hide everything showing, then restore exactly those', () => {
    const m = new DesktopMemory();
    const a = win(1);
    const b = win(2);
    assertEquals(m.plan([a, b], all(a, b)), {hide: [1, 2], restore: []});
    a.minimized = b.minimized = true;
    a.showing = b.showing = false;
    assertEquals(m.plan([a, b], all(a, b)), {hide: [], restore: [1, 2]});
    assertEquals(m.size, 0);
});

test('a window the user minimized himself is not restored', () => {
    const m = new DesktopMemory();
    const a = win(1);
    const own = win(2, {minimized: true, showing: false});
    assertEquals(m.plan([a, own], all(a, own)), {hide: [1], restore: []});
    a.minimized = true;
    assertEquals(m.plan([a, own], all(a, own)), {hide: [], restore: [1]});
});

test('workspaces keep separate memory: toggling on ws2 does not forget ws1', () => {
    const m = new DesktopMemory();
    const ws1 = [win(1), win(2)];
    const ws2 = [win(3)];
    const live = [1, 2, 3];
    assertEquals(m.plan(ws1, live).hide, [1, 2]);
    ws1.forEach(w => { w.minimized = true; w.showing = false; });
    assertEquals(m.plan(ws2, live), {hide: [3], restore: []});
    ws2[0].minimized = true;
    ws2[0].showing = false;
    assertEquals(m.plan(ws2, live), {hide: [], restore: [3]});
    ws2[0].minimized = false;
    ws2[0].showing = true;
    // back on ws1: still remembered
    assertEquals(m.plan(ws1, live), {hide: [], restore: [1, 2]});
});

test('stale memory: a window opened afterwards is hidden first, then everything comes back', () => {
    const m = new DesktopMemory();
    const a = win(1);
    const b = win(2);
    m.plan([a, b], all(a, b));
    a.minimized = b.minimized = true;
    a.showing = b.showing = false;
    const c = win(3);
    assertEquals(m.plan([a, b, c], all(a, b, c)), {hide: [3], restore: []});
    c.minimized = true;
    c.showing = false;
    assertEquals(m.plan([a, b, c], all(a, b, c)), {hide: [], restore: [1, 2, 3]});
});

test('closed windows are forgotten; nothing to do with no windows', () => {
    const m = new DesktopMemory();
    const a = win(1);
    m.plan([a], [1]);
    assertEquals(m.size, 1);
    assertEquals(m.plan([], []), {hide: [], restore: []});
    assertEquals(m.size, 0);
});

test('restored by hand: no longer remembered', () => {
    const m = new DesktopMemory();
    const a = win(1);
    m.plan([a], [1]);
    a.minimized = true;
    a.showing = false;
    a.minimized = false;
    a.showing = true;
    assertEquals(m.plan([a], [1]), {hide: [1], restore: []});
});

test('non-toggleable windows (docks, desktop) are never hidden or remembered', () => {
    const m = new DesktopMemory();
    const dock = win(9, {toggleable: false});
    assertEquals(m.plan([dock], [9]), {hide: [], restore: []});
    assertEquals(m.size, 0);
});

test('the memory object survives (lock / unlock: same instance, ids only)', () => {
    const m = new DesktopMemory();
    const a = win(1);
    m.plan([a], [1]);
    a.minimized = true;
    a.showing = false;
    // "extension disabled and enabled": the new subsystems get the same memory
    assertEquals(m.plan([a], [1]), {hide: [], restore: [1]});
});

run();

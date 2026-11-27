// IntellihideHold (build/panel/intellihide.js) against fake Dash to Panel wrappers.
import {Scope} from '../build/core/scope.js';
import {HOLD_TEMPORARY, IntellihideHold, intellihideStatus, wrapperOfPanel} from '../build/panel/intellihide.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

const BOX = {origin: {x: 0, y: 860}, size: {width: 1600, height: 40}};

function fakeWrapper(over = {}) {
    const calls = [];
    const button = {};
    return {
        calls,
        button,
        panel: {contains: a => a === button},
        panelBox: {visible: true, translation_x: 0, translation_y: 0, get_transformed_extents: () => BOX},
        monitor: {inFullscreen: false},
        intellihide: {
            enabled: true,
            _holdStatus: 0,
            revealAndHold: (h, immediate) => { calls.push(['hold', h, immediate]); },
            release: h => { calls.push(['release', h]); },
        },
        ...over,
    };
}

function fixture(wrappers, pointer = [800, 400], watch = undefined) {
    const scope = new Scope('t');
    const state = {pointer, panels: wrappers, reads: 0, onChange: null, watchScope: null};
    const hold = new IntellihideHold(scope, {
        panels: () => state.panels,
        pointer: () => { state.reads++; return state.pointer; },
        ...(watch ? {watch} : {}),
    });
    return {scope, state, hold};
}


test('hold reveals immediately, release gives the same bit back when the pointer is away', () => {
    const w = fakeWrapper();
    const {hold, scope} = fixture([fakeWrapper(), w]);
    hold.hold(w.button);
    assertEquals(w.calls, [['hold', HOLD_TEMPORARY, true]]);
    assert(hold.held);
    hold.release();
    assertEquals(w.calls, [['hold', HOLD_TEMPORARY, true], ['release', HOLD_TEMPORARY]]);
    assert(!hold.held);
    hold.release(); // idempotent
    assertEquals(w.calls.length, 2);
    scope.dispose();
});

test('no intellihide, disabled intellihide, a non-DtP anchor and a throwing wrapper are all no-ops', () => {
    const plain = fakeWrapper({intellihide: undefined});
    const off = fakeWrapper();
    off.intellihide.enabled = false;
    const bad = {get panel() { throw new Error('stale'); }};
    const {hold, scope} = fixture([bad, plain, off]);
    for (const w of [plain, off]) {
        hold.hold(w.button);
        assert(!hold.held);
        hold.release();
    }
    hold.hold({});
    assert(!hold.held);
    assertEquals(off.calls, []);
    scope.dispose();
});

test('release waits while the pointer is on the panel, then gives the hold back once it left', () => {
    const w = fakeWrapper();
    const {hold, scope, state} = fixture([w], [800, 880]);
    hold.hold(w.button);
    hold.release();
    assert(hold.held);
    sleep(350);
    assertEquals(w.calls.length, 1); // still held: the pointer is on the panel
    state.pointer = [800, 300];
    sleep(350);
    assertEquals(w.calls, [['hold', HOLD_TEMPORARY, true], ['release', HOLD_TEMPORARY]]);
    assert(!hold.held);
    scope.dispose();
});

test('a fullscreen monitor releases at once even with the pointer on the panel', () => {
    const w = fakeWrapper({monitor: {inFullscreen: true}});
    const {hold, scope} = fixture([w], [800, 880]);
    hold.hold(w.button);
    hold.release();
    assertEquals(w.calls[1], ['release', HOLD_TEMPORARY]);
    scope.dispose();
});

test('reopening on the same panel while a release is pending keeps ONE hold; disposing releases it', () => {
    const w = fakeWrapper();
    const {hold, scope} = fixture([w], [800, 880]);
    hold.hold(w.button);
    hold.release();
    hold.hold(w.button);
    assertEquals(w.calls.length, 1); // no second revealAndHold, the pending release is cancelled
    sleep(250);
    assertEquals(w.calls.length, 1);
    scope.dispose();
    assertEquals(w.calls, [['hold', HOLD_TEMPORARY, true], ['release', HOLD_TEMPORARY]]);
});

test('a release after the panels were rebuilt reaches the old controller only', () => {
    const oldW = fakeWrapper();
    const {hold, scope, state} = fixture([oldW]);
    hold.hold(oldW.button);
    const newW = fakeWrapper();
    oldW.intellihide.enabled = false; // DtP disabled the old controller when it destroyed the panel
    state.panels = [newW];
    hold.release();
    assertEquals(newW.calls, []);
    assertEquals(oldW.calls[1], ['release', HOLD_TEMPORARY]);
    scope.dispose();
});

test('API drift (missing / throwing methods) never throws', () => {
    const w = fakeWrapper();
    w.intellihide.revealAndHold = () => { throw new Error('gone'); };
    const {hold, scope} = fixture([w]);
    hold.hold(w.button);
    assert(!hold.held);
    const w2 = fakeWrapper();
    w2.intellihide.release = undefined;
    const f2 = fixture([w2]);
    f2.hold.hold(w2.button);
    f2.hold.release();
    assert(!f2.hold.held);
    scope.dispose();
    f2.scope.dispose();
});

test('wrapperOfPanel / intellihideStatus', () => {
    const w = fakeWrapper();
    assert(wrapperOfPanel([w], w.panel) === w);
    assert(wrapperOfPanel([w], {}) === null);
    assert(wrapperOfPanel(undefined, w.panel) === null);
    assertEquals(intellihideStatus(w), {enabled: true, hold: 0, visible: true, translation: [0, 0]});
    assert(intellihideStatus(fakeWrapper({intellihide: undefined})) === null);
    assert(intellihideStatus(null) === null);
});

// With a `watch` dep the pending release is event-driven; the interval is only a slow safety net.
function watched(pointer = [800, 880], over = {}) {
    const w = fakeWrapper(over);
    const holder = {};
    const f = fixture([w], pointer, (s, cb) => { holder.onChange = cb; holder.watchScope = s; });
    f.hold.hold(w.button);
    f.hold.release();
    return {w, ...f, holder};
}

test('with a watch, a resting pointer is checked about once a second, not every 100 ms', () => {
    const {w, hold, scope, state} = watched();
    sleep(1500);
    assert(hold.held);
    assertEquals(w.calls.length, 1);
    assert(hold.debugWatch.checks >= 1 && hold.debugWatch.checks <= 2, `checks ${hold.debugWatch.checks}`);
    assert(state.reads <= 3, `reads ${state.reads}`);
    scope.dispose();
});

test('a pointer motion off the panel releases at once', () => {
    const {w, hold, scope, state, holder} = watched();
    state.pointer = [800, 300];
    holder.onChange();
    assertEquals(w.calls, [['hold', HOLD_TEMPORARY, true], ['release', HOLD_TEMPORARY]]);
    assert(!hold.held);
    assertEquals(holder.watchScope.size, 0);
    scope.dispose();
});

test('a fullscreen change releases at once with the pointer still on the panel', () => {
    const {w, hold, scope, holder} = watched();
    w.monitor.inFullscreen = true;
    holder.onChange();
    assertEquals(w.calls, [['hold', HOLD_TEMPORARY, true], ['release', HOLD_TEMPORARY]]);
    assert(!hold.held);
    scope.dispose();
});

test('motion that stays on the panel keeps the hold', () => {
    const {w, hold, scope, state, holder} = watched();
    state.pointer = [810, 885];
    holder.onChange();
    assert(hold.held);
    assertEquals(w.calls.length, 1);
    scope.dispose();
});

test('the fallback poll releases when no event came', () => {
    const w = fakeWrapper();
    const {hold, scope, state} = fixture([w], [800, 880], () => {});
    hold.hold(w.button);
    hold.release();
    state.pointer = [800, 300];
    sleep(1300);
    assert(!hold.held);
    assertEquals(w.calls.length, 2);
    scope.dispose();
});

test('reopening cancels the watch', () => {
    const {w, hold, scope, state, holder} = watched();
    hold.hold(w.button);
    assertEquals(holder.watchScope.size, 0);
    assertEquals(hold.debugWatch.pending, false);
    state.pointer = [800, 300];
    holder.onChange();
    assert(hold.held);
    assertEquals(w.calls.length, 1);
    scope.dispose();
});

test('a throwing watch falls back to the 100 ms poll', () => {
    const w = fakeWrapper();
    const {hold, scope, state} = fixture([w], [800, 880], () => { throw new Error('x'); });
    hold.hold(w.button);
    hold.release();
    state.pointer = [800, 300];
    sleep(350);
    assert(!hold.held);
    scope.dispose();
});

run();

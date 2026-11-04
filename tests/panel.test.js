import {
    ExtState, GIVE_UP_MS, isActorAlive, nextBackoffMs, panelSlot, resolveTargets, validatePanel,
} from '../build/panel/validate.js';
import {assert, assertEquals, run, test} from './harness.js';

const actor = (alive = true) => ({is_destroyed: () => !alive, get_stage: () => (alive ? {} : null), get_n_children: () => 3});
const panel = (over = {}) => ({
    statusArea: {},
    addToStatusArea: () => {},
    _leftBox: actor(),
    _centerBox: actor(),
    _rightBox: actor(),
    ...over,
});
const wrapper = (index, over = {}) => ({panel: panel(), monitor: {index}, isPrimary: index === 0, ...over});
const snap = (over = {}) => ({main: panel(), extensions: [], multiMonitor: false, primaryMonitorIndex: 0, ...over});
const dtp = (state, panels) => ({kind: 'dtp', state, emitter: panels === undefined ? undefined : {panels}});

test('validatePanel accepts a healthy panel', () => {
    assert(validatePanel(panel()).ok);
});

test('validatePanel rejects null, missing statusArea, destroyed box', () => {
    assert(!validatePanel(null).ok);
    assert(!validatePanel(undefined).ok);
    assert(!validatePanel(panel({statusArea: null})).ok);
    assert(!validatePanel(panel({addToStatusArea: undefined})).ok);
    assert(!validatePanel(panel({_rightBox: actor(false)})).ok);
    assert(!validatePanel(panel({_leftBox: undefined})).ok);
});

test('validatePanel treats a throwing getter as invalid', () => {
    const bad = panel();
    Object.defineProperty(bad, 'statusArea', {get() {
        throw new Error('disposed');
    }});
    assert(!validatePanel(bad).ok);
    assert(!isActorAlive({get_stage() {
        throw new Error('disposed');
    }}));
});

test('no panel extension: main panel is the single target', () => {
    const r = resolveTargets(snap());
    assertEquals(r.targets.map(t => t.key), ['main']);
    assert(!r.pending);
});

test('dtp active with valid panels: primary only unless multi-monitor', () => {
    const ws = [wrapper(1, {isPrimary: false}), wrapper(0)];
    const single = resolveTargets(snap({extensions: [dtp(ExtState.ACTIVE, ws)]}));
    assertEquals(single.targets.map(t => t.key), ['dtp:0']);
    const multi = resolveTargets(snap({extensions: [dtp(ExtState.ACTIVE, ws)], multiMonitor: true}));
    assertEquals(multi.targets.map(t => t.key).sort(), ['dtp:0', 'dtp:1']);
});

test('dtp active but panels missing or stale: pending, not main', () => {
    const stale = {panel: undefined, monitor: {index: 0}};
    assert(resolveTargets(snap({extensions: [dtp(ExtState.ACTIVE, [])]})).pending);
    assert(resolveTargets(snap({extensions: [dtp(ExtState.ACTIVATING, [stale])]})).pending);
    assert(resolveTargets(snap({extensions: [dtp(ExtState.ACTIVE, undefined)]})).pending);
    const destroyed = wrapper(0, {panel: panel({_rightBox: actor(false)})});
    const r = resolveTargets(snap({extensions: [dtp(ExtState.ACTIVE, [destroyed])]}));
    assert(r.pending && r.targets.length === 0);
});

test('stale emitter of an INACTIVE dtp is ignored', () => {
    const r = resolveTargets(snap({extensions: [dtp(ExtState.INACTIVE, [wrapper(0)])]}));
    assertEquals(r.targets.map(t => t.key), ['main']);
    const missing = resolveTargets(snap({extensions: [dtp(undefined, undefined)]}));
    assertEquals(missing.targets.map(t => t.key), ['main']);
});

test('invalid main panel is pending', () => {
    const r = resolveTargets(snap({main: null}));
    assert(r.pending && r.targets.length === 0);
});

test('a wrapper that throws is skipped, valid ones survive', () => {
    const throwing = {};
    Object.defineProperty(throwing, 'panel', {get() {
        throw new Error('dead');
    }});
    const r = resolveTargets(snap({extensions: [dtp(ExtState.ACTIVE, [throwing, wrapper(0)])]}));
    assertEquals(r.targets.map(t => t.key), ['dtp:0']);
});

test('backoff doubles from 100 ms and caps at 2 s', () => {
    assertEquals([0, 1, 2, 3, 4, 5, 6, 40].map(nextBackoffMs), [100, 200, 400, 800, 1600, 2000, 2000, 2000]);
    assertEquals(GIVE_UP_MS, 10000);
});

test('panelSlot', () => {
    const c = {left: 2, center: 1, right: 5};
    assertEquals(panelSlot('Left', 0, c), {box: 'left', index: 0});
    assertEquals(panelSlot('Left', 9, c), {box: 'left', index: 2});
    assertEquals(panelSlot('Center', 0, c), {box: 'center', index: 0});
    assertEquals(panelSlot('Right', 0, c), {box: 'right', index: 5});
    assertEquals(panelSlot('Right', 2, c), {box: 'right', index: 3});
    assertEquals(panelSlot('Right', 99, c), {box: 'right', index: 0});
});

run();

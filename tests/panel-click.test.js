// panelClickTarget (build/panel/panelClick.js) against a fake panel actor tree.
import {MIDDLE, PRIMARY, SECONDARY, canReplayEvent, closingClick, panelClickAction, panelClickTarget} from '../build/panel/panelClick.js';
import {assert, assertEquals, run, test} from './harness.js';

// A tiny actor tree: node(name, children) with contains / get_parent like Clutter.Actor.
function node(name, children = [], button = false) {
    const n = {name, button, children, parent: null};
    for (const c of children)
        c.parent = n;
    n.get_parent = () => n.parent;
    n.contains = a => {
        for (let x = a; x; x = x.parent) {
            if (x === n)
                return true;
        }
        return false;
    };
    return n;
}

function world() {
    const appIcon = node('icon-image');
    const appButton = node('app-button', [node('box', [appIcon])], true);
    const spawnIcon = node('spawn-icon');
    const anchor = node('spawn-button', [spawnIcon], true);
    const label = node('clock-label');
    const panel = node('panel-box', [node('left', [anchor, appButton]), node('right', [label])]);
    const other = node('other-panel', [node('other-button', [], true)]);
    const at = {};
    const deps = {
        panels: () => [other, panel],
        actorAt: (x, y) => at[`${x},${y}`] ?? null,
        isButton: a => Boolean(a?.button),
    };
    return {appIcon, appButton, spawnIcon, anchor, label, panel, other, at, deps};
}

test('a primary or middle click on a launcher in the anchor\'s panel targets that launcher', () => {
    const w = world();
    w.at['10,5'] = w.appIcon;
    assert(panelClickTarget({x: 10, y: 5, button: PRIMARY}, w.anchor, w.deps) === w.appButton);
    assert(panelClickTarget({x: 10, y: 5, button: MIDDLE}, w.anchor, w.deps) === w.appButton);
});

test('a right click is passed on too (tray icons); keyboard closes and clicks on the Spawn button itself are not', () => {
    const w = world();
    w.at['10,5'] = w.appIcon;
    w.at['1,1'] = w.spawnIcon;
    assert(panelClickTarget({x: 10, y: 5, button: SECONDARY}, w.anchor, w.deps) === w.appButton);
    assert(panelClickTarget({x: 10, y: 5, button: 8}, w.anchor, w.deps) === null);   // a "back" side button
    assert(panelClickTarget(null, w.anchor, w.deps) === null);
    assert(panelClickTarget({x: 1, y: 1, button: PRIMARY}, w.anchor, w.deps) === null);
    assert(panelClickTarget({x: 1, y: 1, button: SECONDARY}, w.anchor, w.deps) === null);
});

test('panelClickAction: a pinned app launches on left / middle click, its right click is left alone', () => {
    const k = {kind: 'launcher'};
    assert(panelClickAction(k, PRIMARY, true) === 'clicked');
    assert(panelClickAction(k, MIDDLE, true) === 'clicked');
    assert(panelClickAction(k, SECONDARY, true) === 'context');
    assert(panelClickAction(k, SECONDARY, false) === 'context');
});

test('a touchscreen tap closes like a primary click and is passed on to the button under it', () => {
    const w = world();
    w.at['10,5'] = w.appIcon;
    w.at['1,1'] = w.spawnIcon;
    for (const kind of ['touch-begin', 'touch-end']) {
        // a touch event carries no mouse button (Clutter reports 0 or garbage): it counts as PRIMARY
        for (const raw of [0, 7, SECONDARY]) {
            const click = closingClick(kind, 10, 5, raw);
            assertEquals(click, {x: 10, y: 5, button: PRIMARY});
            assert(panelClickTarget(click, w.anchor, w.deps) === w.appButton);
        }
        assert(panelClickTarget(closingClick(kind, 1, 1, 0), w.anchor, w.deps) === null);   // the Spawn button
    }
    assert(panelClickAction({kind: 'launcher'}, closingClick('touch-begin', 0, 0, 0).button, false) === 'clicked');
    assert(panelClickAction({kind: 'gesture', gestureButton: PRIMARY}, closingClick('touch-end', 0, 0, 0).button, false) === 'toggle');
});

test('closingClick keeps the mouse button of a press / release; a press and a touch begin can be replayed', () => {
    assertEquals(closingClick('press', 3, 4, SECONDARY), {x: 3, y: 4, button: SECONDARY});
    assertEquals(closingClick('release', 3, 4, MIDDLE), {x: 3, y: 4, button: MIDDLE});
    assert(canReplayEvent('press') && canReplayEvent('touch-begin'));
    assert(!canReplayEvent('release') && !canReplayEvent('touch-end'));
});

test('panelClickAction: Activities opens the Overview on a left click only', () => {
    const k = {kind: 'activities'};
    assert(panelClickAction(k, PRIMARY, true) === 'overview');
    assert(panelClickAction(k, SECONDARY, true) === null);
});

test('panelClickAction: the clock, quick settings and indicators toggle their menu with the buttons their gesture takes', () => {
    const any = {kind: 'gesture', gestureButton: 0};
    assert(panelClickAction(any, PRIMARY, true) === 'toggle');
    assert(panelClickAction(any, SECONDARY, true) === 'toggle');
    assert(panelClickAction(any, MIDDLE, false) === 'toggle');
    const leftOnly = {kind: 'gesture', gestureButton: PRIMARY};
    assert(panelClickAction(leftOnly, PRIMARY, true) === 'toggle');
    assert(panelClickAction(leftOnly, SECONDARY, true) === null);
});

test('panelClickAction: tray icons that read raw presses get the press replayed (any button)', () => {
    const raw = {kind: 'raw'};
    assert(panelClickAction(raw, PRIMARY, true) === 'replay');
    assert(panelClickAction(raw, SECONDARY, true) === 'replay');
    assert(panelClickAction(raw, MIDDLE, true) === 'replay');
    // Closed by a release (no press to replay): open its menu for left / right, nothing for middle.
    assert(panelClickAction(raw, PRIMARY, false) === 'toggle');
    assert(panelClickAction(raw, SECONDARY, false) === 'toggle');
    assert(panelClickAction(raw, MIDDLE, false) === null);
    assert(panelClickAction(null, PRIMARY, true) === null);
    assert(panelClickAction(raw, 8, true) === null);
});

test('a button in ANOTHER panel (a second monitor\'s Dash to Panel) is clicked too, not only the anchor\'s panel', () => {
    const w = world();
    w.at['60,5'] = w.other.children[0];
    assert(panelClickTarget({x: 60, y: 5, button: PRIMARY}, w.anchor, w.deps) === w.other.children[0]);
});

test('the clock and quick settings (panel menu buttons, not St.Buttons) are targets when isButton accepts them', () => {
    const w = world();
    const clock = node('clock-button', [node('clock-label2')], true);
    w.panel.children.push(clock);
    clock.parent = w.panel;
    w.at['70,5'] = clock.children[0];
    assert(panelClickTarget({x: 70, y: 5, button: PRIMARY}, w.anchor, w.deps) === clock);
});

test('no button under the click, or a click off every panel: nothing', () => {
    const w = world();
    w.at['50,5'] = w.label;                  // a plain label in the panel, no button around it
    assert(panelClickTarget({x: 50, y: 5, button: PRIMARY}, w.anchor, w.deps) === null);
    assert(panelClickTarget({x: 500, y: 500, button: PRIMARY}, w.anchor, w.deps) === null);
    assert(panelClickTarget({x: 10, y: 5, button: PRIMARY}, null, w.deps) === null);
});

test('API drift never throws', () => {
    const w = world();
    w.at['10,5'] = w.appIcon;
    const bad = {...w.deps, actorAt: () => { throw new Error('gone'); }};
    assert(panelClickTarget({x: 10, y: 5, button: PRIMARY}, w.anchor, bad) === null);
    const badPanels = {...w.deps, panels: () => [{contains: () => { throw new Error('stale'); }}, w.panel]};
    assert(panelClickTarget({x: 10, y: 5, button: PRIMARY}, w.anchor, badPanels) === w.appButton);
});

run();

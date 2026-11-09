// panelClickTarget (build/panel/panelClick.js) against a fake panel actor tree.
import {MIDDLE, PRIMARY, panelClickTarget} from '../build/panel/panelClick.js';
import {assert, run, test} from './harness.js';

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

test('right clicks, keyboard closes and clicks on the Spawn button itself are not passed on', () => {
    const w = world();
    w.at['10,5'] = w.appIcon;
    w.at['1,1'] = w.spawnIcon;
    assert(panelClickTarget({x: 10, y: 5, button: 3}, w.anchor, w.deps) === null);
    assert(panelClickTarget(null, w.anchor, w.deps) === null);
    assert(panelClickTarget({x: 1, y: 1, button: PRIMARY}, w.anchor, w.deps) === null);
});

test('no button under the click, a click off the panel, or another panel: nothing', () => {
    const w = world();
    w.at['50,5'] = w.label;                  // a plain label in the panel, no button around it
    w.at['60,5'] = w.other.children[0];      // a button in another panel
    assert(panelClickTarget({x: 50, y: 5, button: PRIMARY}, w.anchor, w.deps) === null);
    assert(panelClickTarget({x: 60, y: 5, button: PRIMARY}, w.anchor, w.deps) === null);
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

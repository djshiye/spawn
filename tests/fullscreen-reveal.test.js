// FullscreenReveal (build/panel/fullscreenReveal.js) against fake panel boxes.
import {Scope} from '../build/core/scope.js';
import {FullscreenReveal} from '../build/panel/fullscreenReveal.js';
import {assert, assertEquals, run, test} from './harness.js';

function fakePanel({visible = false, fullscreen = true} = {}) {
    const button = {};
    return {
        button,
        box: {visible, contains: a => a === button},
        monitor: {inFullscreen: fullscreen},
    };
}

function fixture(panels) {
    const scope = new Scope('t');
    const state = {panels, overview: false, dead: new Set()};
    const reveal = new FullscreenReveal(scope, {
        panels: () => state.panels,
        overviewVisible: () => state.overview,
        alive: box => !state.dead.has(box),
    });
    return {scope, state, reveal};
}

test('a panel hidden by a fullscreen window is shown while the menu is open, hidden again on close', () => {
    const p = fakePanel();
    const {reveal, scope} = fixture([fakePanel(), p]);
    reveal.show(p.button);
    assert(p.box.visible === true);
    assert(reveal.shown);
    reveal.restore();
    assert(p.box.visible === false);
    assert(!reveal.shown);
    reveal.restore(); // idempotent
    assert(p.box.visible === false);
    scope.dispose();
});

test('a visible panel, a non-fullscreen monitor and an unknown anchor are left alone', () => {
    const visible = fakePanel({visible: true});
    const hiddenNotFs = fakePanel({fullscreen: false});
    const {reveal, scope} = fixture([visible, hiddenNotFs]);
    reveal.show(visible.button);
    reveal.show(hiddenNotFs.button);
    reveal.show({});
    assert(!reveal.shown);
    assert(visible.box.visible === true);
    assert(hiddenNotFs.box.visible === false);
    reveal.restore();
    assert(visible.box.visible === true);
    scope.dispose();
});

test('the panel stays visible when fullscreen ended or the Overview is up by the time the menu closes', () => {
    const p = fakePanel();
    const {reveal, scope, state} = fixture([p]);
    reveal.show(p.button);
    p.monitor.inFullscreen = false;
    reveal.restore();
    assert(p.box.visible === true);
    p.monitor.inFullscreen = true;
    p.box.visible = false;
    reveal.show(p.button);
    state.overview = true;
    reveal.restore();
    assert(p.box.visible === true);
    scope.dispose();
});

test('the hide is immediate even with the pointer on the panel; reopening shows it again', () => {
    const p = fakePanel();
    const {reveal, scope} = fixture([p]);
    reveal.show(p.button);
    reveal.show(p.button); // already shown: no-op
    reveal.restore();
    assert(p.box.visible === false);
    reveal.show(p.button);
    assert(p.box.visible === true);
    scope.dispose();
    assert(p.box.visible === false);
});

test('opening on another panel puts the first one back', () => {
    const a = fakePanel();
    const b = fakePanel();
    const {reveal, scope} = fixture([a, b]);
    reveal.show(a.button);
    reveal.show(b.button);
    assertEquals([a.box.visible, b.box.visible], [false, true]);
    scope.dispose();
    assertEquals([a.box.visible, b.box.visible], [false, false]);
});

test('a destroyed panel box and API drift never throw', () => {
    const p = fakePanel();
    const {reveal, scope, state} = fixture([{get box() { throw new Error('stale'); }}, p]);
    reveal.show(p.button);
    state.dead.add(p.box);
    reveal.restore();
    assert(p.box.visible === true); // untouched: it is gone
    const q = fakePanel();
    q.box.contains = () => { throw new Error('gone'); };
    state.panels = [q];
    reveal.show(q.button);
    assert(!reveal.shown);
    scope.dispose();
});

run();

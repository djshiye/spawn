// FullscreenReveal (build/panel/fullscreenReveal.js) against fake panel boxes.
import {Scope} from '../build/core/scope.js';
import {FullscreenReveal} from '../build/panel/fullscreenReveal.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

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

function fakeMenu() {
    const handlers = new Map();
    let next = 1;
    return {
        isOpen: false,
        connect(sig, cb) {
            const id = next++;
            handlers.set(id, {sig, cb});
            return id;
        },
        disconnect(id) {
            handlers.delete(id);
        },
        set(open) {
            this.isOpen = open;
            for (const h of [...handlers.values()]) {
                if (h.sig === 'open-state-changed')
                    h.cb(this, open);
            }
        },
        handlerCount: () => handlers.size,
    };
}

test('a click passed on to a tray icon keeps the panel while its menu is open, then hides it', () => {
    const p = fakePanel();
    const {reveal, scope} = fixture([p]);
    const menu = fakeMenu();
    reveal.show(p.button);
    reveal.holdWhileOpen(menu);
    assert(p.box.visible === true, 'still shown while the tray menu may open');
    menu.set(true);
    assert(p.box.visible === true, 'shown while the tray menu is open');
    menu.set(false);
    assert(p.box.visible === false, 'hidden when the tray menu closes');
    assert(!reveal.shown);
    assertEquals(menu.handlerCount(), 0);
    scope.dispose();
});

test('when the held menu hands over to another (next icon, the calendar), the panel is held for that one', () => {
    const p = fakePanel();
    const {reveal, scope} = fixture([p]);
    const tray = fakeMenu();
    const calendar = fakeMenu();
    let asked = null;
    reveal.show(p.button);
    reveal.holdWhileOpen(tray, closed => {
        asked = closed;
        return closed === tray ? calendar : null;
    });
    tray.set(true);
    calendar.isOpen = true;
    tray.set(false);                      // the shell switched to the calendar
    assert(asked === tray);
    assert(p.box.visible === true, 'the panel stays under the calendar');
    assertEquals(tray.handlerCount(), 0);
    calendar.set(false);                  // nothing takes over from the calendar
    assert(p.box.visible === false);
    assertEquals(calendar.handlerCount(), 0);
    scope.dispose();
});

test('reopening Spawn or closing it ends a hold; no panel shown means nothing to hold', () => {
    const p = fakePanel();
    const {reveal, scope} = fixture([p]);
    const menu = fakeMenu();
    reveal.holdWhileOpen(menu);           // nothing shown: no-op
    assertEquals(menu.handlerCount(), 0);
    reveal.show(p.button);
    reveal.holdWhileOpen(menu);
    reveal.show(p.button);                // Spawn opened again on the same panel
    assertEquals(menu.handlerCount(), 0);
    assert(p.box.visible === true);
    reveal.holdWhileOpen({});             // not a menu: hide at once
    assert(p.box.visible === false);
    scope.dispose();
});

test('a menu that only exists after the passed-on click (an app icon\'s context menu) holds the panel once found', () => {
    const p = fakePanel();
    const {reveal, scope} = fixture([p]);
    const menu = fakeMenu();
    let created = false;
    reveal.show(p.button);
    reveal.holdUntilMenu(() => (created ? menu : null));
    assert(p.box.visible === true, 'shown until the menu is looked up');
    created = true;                       // the click was activated on idle, the menu now exists
    menu.isOpen = true;
    sleep(50);
    assert(p.box.visible === true, 'shown while the context menu is open');
    menu.set(false);
    assert(p.box.visible === false, 'hidden when it closes');
    assertEquals(menu.handlerCount(), 0);
    scope.dispose();
});

test('no menu found after the passed-on click: the panel hides again', () => {
    const p = fakePanel();
    const {reveal, scope} = fixture([p]);
    reveal.holdUntilMenu(() => null);     // nothing shown: no-op
    reveal.show(p.button);
    reveal.holdUntilMenu(() => null);
    sleep(50);
    assert(p.box.visible === false);
    reveal.show(p.button);
    reveal.holdUntilMenu(() => {
        throw new Error('drift');
    });
    sleep(50);
    assert(p.box.visible === false);
    scope.dispose();
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

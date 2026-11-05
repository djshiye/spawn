// ActivitiesHider (panel/activities.ts): hides, watches notify::visible, restores the previous state.
import {ActivitiesHider} from '../build/panel/activities.js';
import {assert, assertEquals, run, test} from './harness.js';

class FakeActor {
    constructor(visible = true) {
        this._visible = visible;
        this.handlers = new Map();
        this.next = 1;
    }
    get visible() {
        return this._visible;
    }
    set visible(v) {
        if (v === this._visible)
            return;
        this._visible = v;
        for (const h of [...this.handlers.values()])
            h();
    }
    connect(signal, cb) {
        assertEquals(signal, 'notify::visible');
        const id = this.next++;
        this.handlers.set(id, cb);
        return id;
    }
    disconnect(id) {
        this.handlers.delete(id);
    }
    is_destroyed() {
        return false;
    }
    get_stage() {
        return {};
    }
}

const panel = actor => ({statusArea: {activities: actor}});

test('hides, restores the previous visibility, stops watching', () => {
    const actor = new FakeActor(true);
    const h = new ActivitiesHider();
    h.apply(true, [panel(actor)]);
    assertEquals(actor.visible, false);
    assertEquals(actor.handlers.size, 1);
    h.apply(false, [panel(actor)]);
    assertEquals(actor.visible, true);
    assertEquals(actor.handlers.size, 0);
    assertEquals(h.size, 0);
});

test('ArcMenu showing the button again is overruled and becomes the state to restore', () => {
    const actor = new FakeActor(false); // ArcMenu hides it while enabled
    const h = new ActivitiesHider();
    h.apply(true, [panel(actor)]);
    assertEquals(actor.visible, false);
    actor.visible = true; // ArcMenu disabled: _disableButton()
    assertEquals(actor.visible, false);
    h.restore();
    assertEquals(actor.visible, true); // not left hidden for good
});

test('applying twice keeps one handler and the first saved state', () => {
    const actor = new FakeActor(true);
    const h = new ActivitiesHider();
    h.apply(true, [panel(actor)]);
    h.apply(true, [panel(actor), panel(actor)]);
    assertEquals(actor.handlers.size, 1);
    h.restore();
    assertEquals(actor.visible, true);
});

test('with hide off nothing is watched or changed', () => {
    const actor = new FakeActor(true);
    const h = new ActivitiesHider();
    h.apply(false, [panel(actor)]);
    assertEquals(actor.visible, true);
    assertEquals(actor.handlers.size, 0);
});

test('a destroyed actor is forgotten without touching its signals', () => {
    const actor = new FakeActor(true);
    const h = new ActivitiesHider();
    h.apply(true, [panel(actor)]);
    let disconnected = 0;
    actor.disconnect = () => disconnected++;
    actor.is_destroyed = () => true;
    h.apply(true, []);
    assertEquals(h.size, 0);
    assertEquals(disconnected, 0);
});

test('missing statusArea entries are ignored', () => {
    const h = new ActivitiesHider();
    h.apply(true, [null, undefined, {statusArea: {}}, {}]);
    assertEquals(h.size, 0);
    assert(true);
});

run();

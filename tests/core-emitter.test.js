// Emitter re-binding on every sync (review finding 1): a swapped Dash to Panel emitter must be heard.
import {EmitterBindings} from '../build/panel/emitterBinding.js';
import {assert, assertEquals, run, test} from './harness.js';

class FakeEmitter {
    constructor() {
        this.handlers = new Map();
        this.next = 1;
    }
    connect(signal, cb) {
        const id = this.next++;
        this.handlers.set(id, {signal, cb});
        return id;
    }
    disconnect(id) {
        this.handlers.delete(id);
    }
    emit(signal) {
        for (const h of [...this.handlers.values()]) {
            if (h.signal === signal)
                h.cb();
        }
    }
}

test('binds nothing while the provider is absent, then binds the emitter that appears', () => {
    const globals = {dtp: null, az: undefined};
    let heard = 0;
    const b = new EmitterBindings(() => globals, () => heard++);
    b.sync();
    assertEquals(b.kinds(), []);
    globals.dtp = new FakeEmitter();
    b.sync();
    assertEquals(b.kinds(), ['dtp']);
    globals.dtp.emit('panels-created');
    assertEquals(heard, 1);
});

test('an emitter swapped without any state event is re-bound on the next sync', () => {
    const first = new FakeEmitter();
    const globals = {dtp: first};
    let heard = 0;
    const b = new EmitterBindings(() => globals, () => heard++);
    b.sync();
    const second = new FakeEmitter();
    globals.dtp = second;
    second.emit('panels-created');
    assertEquals(heard, 0, 'not heard before sync');
    b.sync();
    assertEquals(first.handlers.size, 0, 'old emitter disconnected');
    assertEquals(second.handlers.size, 1);
    second.emit('panels-created');
    assertEquals(heard, 1);
});

test('sync is idempotent for an unchanged emitter and clear disconnects everything', () => {
    const e = new FakeEmitter();
    const b = new EmitterBindings(() => ({dtp: e}), () => {});
    b.sync();
    b.sync();
    b.sync();
    assertEquals(e.handlers.size, 1);
    b.clear();
    assertEquals(e.handlers.size, 0);
    assertEquals(b.kinds(), []);
});

test('an emitter that disappears is disconnected; a throwing connect does not break sync', () => {
    const e = new FakeEmitter();
    const globals = {dtp: e, az: {connect: () => { throw new Error('boom'); }}};
    const b = new EmitterBindings(() => globals, () => {});
    b.sync();
    assertEquals(b.kinds(), ['dtp']);
    globals.dtp = null;
    b.sync();
    assertEquals(e.handlers.size, 0);
    assert(b.kinds().length === 0);
});

run();

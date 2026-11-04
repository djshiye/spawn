import GObject from 'gi://GObject';

import {Scope} from '../build/core/scope.js';
import {debounce} from '../build/core/debounce.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

test('disposes LIFO', () => {
    const order = [];
    const s = new Scope('t');
    s.add(() => order.push(1));
    s.add(() => order.push(2));
    s.add(() => order.push(3));
    s.dispose();
    assertEquals(order, [3, 2, 1]);
});

test('survives a throwing teardown and runs the rest', () => {
    const order = [];
    const s = new Scope('t');
    s.add(() => order.push('first'));
    s.add(() => {
        throw new Error('boom');
    });
    s.add(() => order.push('last'));
    s.dispose();
    assertEquals(order, ['last', 'first']);
});

test('is re-usable after dispose and dispose is idempotent', () => {
    const order = [];
    const s = new Scope('t');
    s.add(() => order.push('a'));
    s.dispose();
    s.dispose();
    s.add(() => order.push('b'));
    s.dispose();
    assertEquals(order, ['a', 'b']);
    assertEquals(s.size, 0);
});

test('add() returns a release that runs the teardown once', () => {
    let n = 0;
    const s = new Scope('t');
    const release = s.add(() => n++);
    release();
    release();
    s.dispose();
    assertEquals(n, 1);
});

test('child scopes are disposed with the parent, before older parent entries', () => {
    const order = [];
    const s = new Scope('t');
    s.add(() => order.push('parent-first'));
    const c = s.child('c');
    c.add(() => order.push('child'));
    s.add(() => order.push('parent-last'));
    s.dispose();
    assertEquals(order, ['parent-last', 'child', 'parent-first']);
});

test('connect disconnects on dispose', () => {
    const Emitter = GObject.registerClass({Signals: {ping: {}}}, class Emitter extends GObject.Object {});
    const e = new Emitter();
    let hits = 0;
    const s = new Scope('t');
    s.connect(e, 'ping', () => hits++);
    e.emit('ping');
    s.dispose();
    e.emit('ping');
    assertEquals(hits, 1);
});

test('a throwing signal handler does not propagate', () => {
    const Emitter = GObject.registerClass({Signals: {ping: {}}}, class Emitter2 extends GObject.Object {});
    const e = new Emitter();
    const s = new Scope('t');
    s.connect(e, 'ping', () => {
        throw new Error('handler boom');
    });
    e.emit('ping');
    s.dispose();
});

test('timeout fires once; disposed timeout never fires', () => {
    let fired = 0;
    let cancelled = 0;
    const s = new Scope('t');
    s.timeout(5, () => fired++);
    const s2 = new Scope('t2');
    s2.timeout(5, () => cancelled++);
    s2.dispose();
    sleep(40);
    assertEquals(fired, 1);
    assertEquals(cancelled, 0);
    assertEquals(s.size, 0, 'finished timeout unregisters itself');
    s.dispose();
});

test('a throwing timeout callback is contained', () => {
    const s = new Scope('t');
    s.timeout(1, () => {
        throw new Error('timer boom');
    });
    sleep(20);
    s.dispose();
});

test('debounce coalesces calls and is cancelled by dispose', () => {
    let n = 0;
    const s = new Scope('t');
    const d = debounce(s, 15, () => n++);
    d.call();
    d.call();
    d.call();
    assert(d.pending);
    sleep(60);
    assertEquals(n, 1);
    d.call();
    s.dispose();
    sleep(40);
    assertEquals(n, 1);
});

run();

import GLib from 'gi://GLib';

import {Scope} from '../build/core/scope.js';
import {SearchEngine} from '../build/search/engine.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

function result(providerId, id) {
    return {id, providerId, title: id, score: 1, activate: () => {}};
}

/** Fake provider; `impl(query, token)` returns results or a promise. */
function fake(id, impl, enabled = true) {
    const p = {
        id,
        title: id.toUpperCase(),
        calls: [],
        cleared: 0,
        isEnabled: () => enabled,
        search(query, token) {
            p.calls.push({query, token});
            return impl(query, token);
        },
        clear() {
            p.cleared++;
        },
    };
    return p;
}

function later(ms, value) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve(value);
            return GLib.SOURCE_REMOVE;
        });
    });
}

function setup(debounceMs = 20) {
    const scope = new Scope('t');
    const engine = new SearchEngine(scope, {debounceMs});
    const batches = [];
    return {scope, engine, batches, onBatch: b => batches.push(b)};
}

test('does no work until search() and nothing before the debounce elapses', () => {
    const {scope, engine, batches, onBatch} = setup(40);
    const p = fake('a', q => [result('a', q)]);
    engine.addProvider(p);
    assertEquals(p.calls.length, 0);
    engine.search('x', onBatch);
    assertEquals(p.calls.length, 0);
    sleep(80);
    assertEquals(p.calls.length, 1);
    assertEquals(batches.length, 1);
    assertEquals(batches[0].providerId, 'a');
    assertEquals(batches[0].providerTitle, 'A');
    assertEquals(batches[0].query, 'x');
    scope.dispose();
});

test('debounce coalesces rapid calls into the last query', () => {
    const {scope, engine, batches, onBatch} = setup(40);
    const p = fake('a', q => [result('a', q)]);
    engine.addProvider(p);
    engine.search('f', onBatch);
    sleep(10);
    engine.search('fi', onBatch);
    sleep(10);
    engine.search('fir', onBatch);
    sleep(100);
    assertEquals(p.calls.map(c => c.query), ['fir']);
    assertEquals(batches.length, 1);
    scope.dispose();
});

test('a new search cancels the previous token and drops late async results', () => {
    const {scope, engine, batches, onBatch} = setup(5);
    const slow = fake('slow', q => later(60, [result('slow', q)]));
    engine.addProvider(slow);
    engine.search('one', onBatch);
    sleep(25);
    assertEquals(slow.calls.length, 1);
    const first = slow.calls[0].token;
    assertEquals(first.cancelled, false);
    assertEquals(first.cancellable.is_cancelled(), false);
    engine.search('two', onBatch);
    assertEquals(first.cancelled, true);
    assertEquals(first.cancellable.is_cancelled(), true);
    sleep(150);
    assertEquals(batches.map(b => b.query), ['two']);
    scope.dispose();
});

test('handle.cancel() and engine.cancel() stop pending and in-flight work', () => {
    const {scope, engine, batches, onBatch} = setup(30);
    const p = fake('a', () => later(30, [result('a', 'x')]));
    engine.addProvider(p);
    engine.search('q', onBatch).cancel();
    sleep(60);
    assertEquals(p.calls.length, 0);

    engine.search('q', onBatch);
    sleep(45);
    assertEquals(p.calls.length, 1);
    engine.cancel();
    assertEquals(p.calls[0].token.cancelled, true);
    sleep(80);
    assertEquals(batches.length, 0);
    scope.dispose();
});

test('an old handle cannot cancel a newer search', () => {
    const {scope, engine, batches, onBatch} = setup(10);
    engine.addProvider(fake('a', q => [result('a', q)]));
    const old = engine.search('one', onBatch);
    engine.search('two', onBatch);
    old.cancel();
    sleep(50);
    assertEquals(batches.map(b => b.query), ['two']);
    scope.dispose();
});

test('providers stream independently: fast first, slow when it resolves', () => {
    const {scope, engine, batches, onBatch} = setup(5);
    engine.addProvider(fake('slow', () => later(50, [result('slow', 's')])));
    engine.addProvider(fake('fast', () => [result('fast', 'f')]));
    engine.search('q', onBatch);
    sleep(30);
    assertEquals(batches.map(b => b.providerId), ['fast']);
    sleep(80);
    assertEquals(batches.map(b => b.providerId), ['fast', 'slow']);
    scope.dispose();
});

test('throwing / rejecting providers are isolated', () => {
    const {scope, engine, batches, onBatch} = setup(5);
    engine.addProvider(fake('boom', () => {
        throw new Error('sync boom');
    }));
    engine.addProvider(fake('reject', () => Promise.reject(new Error('async boom'))));
    engine.addProvider(fake('garbage', () => 42));
    engine.addProvider(fake('ok', () => [result('ok', 'x')]));
    engine.search('q', onBatch);
    sleep(40);
    assertEquals(batches.map(b => b.providerId), ['ok']);
    scope.dispose();
});

test('a throwing onBatch does not stop other providers', () => {
    const {scope, engine} = setup(5);
    const seen = [];
    engine.addProvider(fake('a', () => [result('a', '1')]));
    engine.addProvider(fake('b', () => [result('b', '2')]));
    engine.search('q', b => {
        seen.push(b.providerId);
        throw new Error('ui bug');
    });
    sleep(40);
    assertEquals(seen, ['a', 'b']);
    scope.dispose();
});

test('disabled providers are skipped; isEnabled is read per query', () => {
    const {scope, engine, batches, onBatch} = setup(5);
    let enabled = false;
    const p = fake('a', () => [result('a', 'x')]);
    p.isEnabled = () => enabled;
    engine.addProvider(p);
    engine.search('q', onBatch);
    sleep(30);
    assertEquals(batches.length, 0);
    enabled = true;
    engine.search('q', onBatch);
    sleep(30);
    assertEquals(batches.length, 1);
    scope.dispose();
});

test('empty query cancels pending work and delivers nothing', () => {
    const {scope, engine, batches, onBatch} = setup(30);
    const p = fake('a', () => [result('a', 'x')]);
    engine.addProvider(p);
    engine.search('abc', onBatch);
    const h = engine.search('   ', onBatch);
    h.cancel(); // no-op handle must be safe
    sleep(80);
    assertEquals(p.calls.length, 0);
    assertEquals(batches.length, 0);
    scope.dispose();
});

test('remove() and provider sources', () => {
    const {scope, engine, batches, onBatch} = setup(5);
    const a = fake('a', () => [result('a', 'x')]);
    const removeA = engine.addProvider(a);
    let dynamic = [fake('d1', () => [result('d1', 'x')])];
    engine.addProviderSource(() => dynamic);
    engine.addProviderSource(() => {
        throw new Error('bad source');
    });
    removeA();
    engine.search('q', onBatch);
    sleep(30);
    assertEquals(batches.map(b => b.providerId), ['d1']);
    dynamic = [fake('d2', () => [result('d2', 'x')])];
    engine.search('q', onBatch);
    sleep(30);
    assertEquals(batches.map(b => b.providerId), ['d1', 'd2']);
    scope.dispose();
});

test('clear() reaches providers, tolerating throwing ones', () => {
    const {scope, engine} = setup(5);
    const a = fake('a', () => []);
    const bad = fake('bad', () => []);
    bad.clear = () => {
        throw new Error('nope');
    };
    engine.addProvider(bad);
    engine.addProvider(a);
    engine.clear();
    assertEquals(a.cleared, 1);
    scope.dispose();
});

test('scope.dispose() cancels the pending query and in-flight results', () => {
    const {scope, engine, batches, onBatch} = setup(20);
    const p = fake('a', () => later(30, [result('a', 'x')]));
    engine.addProvider(p);
    engine.search('q', onBatch);
    sleep(30);
    assertEquals(p.calls.length, 1);
    scope.dispose();
    assertEquals(p.calls[0].token.cancelled, true);
    sleep(80);
    assertEquals(batches.length, 0);

    const s2 = setup(20);
    const p2 = fake('a', () => [result('a', 'x')]);
    s2.engine.addProvider(p2);
    s2.engine.search('q', s2.onBatch);
    s2.scope.dispose();
    sleep(50);
    assertEquals(p2.calls.length, 0);
    assert(s2.batches.length === 0);
});

run();

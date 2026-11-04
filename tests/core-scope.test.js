// Child scope release (review finding 6).
import {Scope} from '../build/core/scope.js';
import {assert, assertEquals, run, test} from './harness.js';

test('disposing a child drops its entry from the parent', () => {
    const parent = new Scope('p');
    assertEquals(parent.size, 0);
    for (let i = 0; i < 50; i++)
        parent.child(`c${i}`).dispose();
    assertEquals(parent.size, 0, 'parent keeps no dead child entries');
});

test('a live child is still disposed with its parent', () => {
    const order = [];
    const parent = new Scope('p');
    const child = parent.child('c');
    child.add(() => order.push('child'));
    parent.add(() => order.push('parent'));
    assertEquals(parent.size, 2);
    parent.dispose();
    assertEquals(order, ['parent', 'child']);
    assertEquals(child.size, 0);
});

test('a child that is disposed and then reused is disposed with the parent again', () => {
    const order = [];
    const parent = new Scope('p');
    const child = parent.child('c');
    child.add(() => order.push('first'));
    child.dispose();
    assertEquals(parent.size, 0);
    child.add(() => order.push('second'));
    assertEquals(parent.size, 1, 're-registered with the parent on reuse');
    parent.dispose();
    assertEquals(order, ['first', 'second']);
});

test('nested children release up the chain and survive double dispose', () => {
    const parent = new Scope('p');
    const mid = parent.child('m');
    const leaf = mid.child('l');
    assertEquals(parent.size, 1);
    assertEquals(mid.size, 1);
    leaf.dispose();
    leaf.dispose();
    assertEquals(mid.size, 0);
    mid.dispose();
    assertEquals(parent.size, 0);
    assert(true);
});

test('a child registering teardowns while it is being disposed does not re-attach', () => {
    const order = [];
    const parent = new Scope('p');
    const child = parent.child('c');
    child.add(() => child.add(() => order.push('late')));
    child.dispose();
    assertEquals(order, ['late']);
    assertEquals(parent.size, 0);
});

run();

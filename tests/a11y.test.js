// Accessibility helpers that need no shell: CountAnnouncer (debounced "N results") and itemName.
import {CountAnnouncer, itemName} from '../build/ui/a11yCore.js';
import {assertEquals, run, test} from './harness.js';

/** A fake clock: schedule() queues, advance(ms) fires what is due, in order. */
function clock() {
    let now = 0;
    let seq = 0;
    const timers = new Map();
    return {
        schedule(ms, cb) {
            const id = ++seq;
            timers.set(id, {at: now + ms, cb});
            return () => timers.delete(id);
        },
        advance(ms) {
            const end = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due)
                    break;
                now = due[1].at;
                timers.delete(due[0]);
                due[1].cb();
            }
            now = end;
        },
        pending: () => timers.size,
    };
}

function announcer(delay = 600) {
    const c = clock();
    const said = [];
    const a = new CountAnnouncer(c.schedule, n => said.push(n), delay);
    return {c, a, said};
}

test('itemName joins name and description and drops blanks', () => {
    assertEquals(itemName('Files'), 'Files');
    assertEquals(itemName('Files', 'Access and organise files'), 'Files, Access and organise files');
    assertEquals(itemName(' Files ', '  '), 'Files');
    assertEquals(itemName('', 'Only a description'), 'Only a description');
    assertEquals(itemName('Files', null), 'Files');
});

test('the count is announced once it has been stable for the delay', () => {
    const {c, a, said} = announcer();
    a.note(5);
    c.advance(599);
    assertEquals(said, []);
    c.advance(1);
    assertEquals(said, [5]);
});

test('streamed batches only announce the final count (typing does not spam)', () => {
    const {c, a, said} = announcer();
    for (const n of [2, 3, 3, 7]) {
        a.note(n);
        c.advance(200);
    }
    assertEquals(said, []);
    c.advance(600);
    assertEquals(said, [7]);
    assertEquals(c.pending(), 0);
});

test('the same count twice in a row is said once', () => {
    const {c, a, said} = announcer();
    a.note(4);
    c.advance(700);
    a.hold(); // a new query starts
    a.note(4);
    c.advance(700);
    assertEquals(said, [4]);
    a.note(2);
    c.advance(700);
    assertEquals(said, [4, 2]);
});

test('hold drops a pending announcement, reset also forgets what was said', () => {
    const {c, a, said} = announcer();
    a.note(3);
    a.hold();
    c.advance(1000);
    assertEquals(said, []);
    a.note(3);
    c.advance(700);
    assertEquals(said, [3]);
    a.reset(); // entry cleared
    a.note(3);
    c.advance(700);
    assertEquals(said, [3, 3]);
});

test('zero results are announced, with their own delay', () => {
    const {c, a, said} = announcer();
    a.note(0, 0);
    c.advance(0);
    assertEquals(said, [0]);
});

run();

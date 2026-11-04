// Tiny test harness for `gjs -m`: test(name, fn), assert helpers, summary exit code.
import GLib from 'gi://GLib';
import System from 'system';

const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

export function assert(cond, message = 'assertion failed') {
    if (!cond)
        throw new Error(message);
}

export function assertEquals(actual, expected, message = '') {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e)
        throw new Error(`${message} expected ${e}, got ${a}`.trim());
}

/** Spin a main loop for `ms` milliseconds so GLib timeouts can fire. */
export function sleep(ms) {
    const loop = new GLib.MainLoop(null, false);
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
}

export function run() {
    let failed = 0;
    for (const {name, fn} of tests) {
        try {
            fn();
            print(`  ok   ${name}`);
        } catch (e) {
            failed++;
            print(`  FAIL ${name}: ${e.message}`);
        }
    }
    print(`${tests.length - failed}/${tests.length} passed`);
    System.exit(failed ? 1 : 0);
}

// Restart to firmware setup: availability parsing and the set-flag / reboot / roll-back logic with a mocked logind.
import GLib from 'gi://GLib';

import {parseFirmwareSupport, restartIntoFirmware} from '../build/ui/widgets/firmwareReboot.js';
import {fitPowerRow, OVERFLOW_ORDER} from '../build/ui/widgets/powerFit.js';
import {PowerType as P} from '../build/core/constants.js';
import {assert, assertEquals, run, test} from './harness.js';

/** A mock logind: records every call; `failOn` names the call numbers (1-based) that reject. */
function mock({failOn = []} = {}) {
    const calls = [];
    const step = (name, ok) => {
        calls.push(name);
        return failOn.includes(calls.length) ? Promise.reject(new Error(`${name} denied`)) : ok;
    };
    return {
        calls,
        setFlag: on => step(`flag:${on}`, Promise.resolve()),
        reboot: () => step('reboot', Promise.resolve()),
    };
}

// the mocks resolve in microtasks: spin the main context until the promise settles
function settle(promise) {
    let result;
    let done = false;
    promise.then(r => { result = r; done = true; });
    const ctx = GLib.MainContext.default();
    for (let i = 0; i < 100 && !done; i++)
        ctx.iteration(false);
    assert(done, 'did not settle');
    return result;
}

test('availability: only yes and challenge', () => {
    assertEquals(parseFirmwareSupport('yes'), true);
    assertEquals(parseFirmwareSupport('challenge'), true);
    for (const v of ['no', 'na', '', 'YES', undefined, null, 1, ['yes']])
        assertEquals(parseFirmwareSupport(v), false, String(v));
});

test('success: flag set, then reboot, flag stays set', () => {
    const b = mock();
    assertEquals(settle(restartIntoFirmware(b)), {ok: true});
    assertEquals(b.calls, ['flag:true', 'reboot']);
});

test('reboot fails: the flag is unset again', () => {
    const b = mock({failOn: [2]});
    const r = settle(restartIntoFirmware(b));
    assertEquals(r, {ok: false, error: 'reboot denied', rolledBack: true});
    assertEquals(b.calls, ['flag:true', 'reboot', 'flag:false']);
});

test('setting the flag fails: no reboot, flag unset best effort', () => {
    const b = mock({failOn: [1]});
    const r = settle(restartIntoFirmware(b));
    assertEquals(r, {ok: false, error: 'flag:true denied', rolledBack: true});
    assertEquals(b.calls, ['flag:true', 'flag:false']);
    assert(!b.calls.includes('reboot'));
});

test('reboot and roll-back both fail: reported as not rolled back', () => {
    const b = mock({failOn: [2, 3]});
    const r = settle(restartIntoFirmware(b));
    assertEquals(r.ok, false);
    assertEquals(r.rolledBack, false);
});

test('non-Error rejections are reported as text', () => {
    const b = {setFlag: on => (on ? Promise.reject('boom') : Promise.resolve()), reboot: () => Promise.resolve()};
    assertEquals(settle(restartIntoFirmware(b)), {ok: false, error: 'boom', rolledBack: true});
});

test('power row: the firmware button is the first to move into More, Power Off never', () => {
    assertEquals(OVERFLOW_ORDER[0], P.FIRMWARE);
    const types = [P.LOCK, P.LOGOUT, P.RESTART, P.FIRMWARE, P.POWER_OFF];
    const r = fitPowerRow(150, types);
    assertEquals(r.mode, 'overflow');
    assert(r.overflow.includes(P.FIRMWARE) && r.visible.includes(P.POWER_OFF));
    assertEquals(fitPowerRow(400, types).visible, types);
});

run();

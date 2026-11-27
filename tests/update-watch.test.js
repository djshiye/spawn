// UpdateWatch: the "Spawn was updated" notice, including an update installed while Spawn was disabled.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Scope} from '../build/core/scope.js';
import {UpdateWatch} from '../build/core/updateWatch.js';
import {assertEquals, run, sleep, test} from './harness.js';

function setup(version) {
    const dir = GLib.dir_make_tmp('spawn-uw-XXXXXX');
    const path = GLib.build_filenamev([dir, 'metadata.json']);
    const write = v => GLib.file_set_contents(path, JSON.stringify({'version-name': v}));
    write(version);
    return {dir, path, write, file: Gio.File.new_for_path(path), notices: [], state: {notified: false}};
}

function begin(env) {
    const scope = new Scope('uw-test');
    new UpdateWatch(scope, {
        file: env.file, running: '1.6.0', state: env.state,
        notify: v => env.notices.push(v),
    }).start();
    return scope;
}

function cleanup(env) {
    GLib.unlink(env.path);
    GLib.rmdir(env.dir);
}

test('update installed while disabled is noticed on the next enable', () => {
    const env = setup('1.6.0');
    begin(env).dispose();
    env.write('1.7.0');
    const scope = begin(env);
    sleep(2500);
    scope.dispose();
    assertEquals(env.notices, ['1.7.0']);
    assertEquals(env.state.notified, true);
    // notice only once across re-enables
    begin(env).dispose();
    const again = begin(env);
    sleep(2500);
    again.dispose();
    assertEquals(env.notices, ['1.7.0']);
    cleanup(env);
});

test('no notice when the versions are equal at start', () => {
    const env = setup('1.6.0');
    const scope = begin(env);
    sleep(2500);
    scope.dispose();
    assertEquals(env.notices, []);
    cleanup(env);
});

test('disable during the settle delay fires nothing', () => {
    const env = setup('2.0.0');
    const scope = begin(env);
    sleep(200);
    scope.dispose();
    sleep(2500);
    assertEquals(env.notices, []);
    cleanup(env);
});

test('a change while enabled is still noticed', () => {
    const env = setup('1.6.0');
    const scope = begin(env);
    sleep(300);
    env.write('1.8.0');
    sleep(3000);
    scope.dispose();
    assertEquals(env.notices, ['1.8.0']);
    cleanup(env);
});

run();

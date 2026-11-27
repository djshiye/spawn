// IconFileCheck (build/core/iconFile.js): the background check of a user-chosen icon file, with a deadline.
// The file system is simulated with an injected query and sniff; the last test uses real files.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {IconFileCheck} from '../build/core/iconFile.js';
import {Scope} from '../build/core/scope.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

function fakeFs() {
    const fs = {calls: []};
    fs.query = (file, _attributes, _cancellable, done) => {
        const path = file.get_path();
        fs.calls.push(path);
        if (path.includes('/hung/'))
            return; // never answers
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5, () => {
            if (path.includes('missing')) {
                done(null, new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND, 'not found'));
            } else {
                const info = new Gio.FileInfo();
                info.set_file_type(path.includes('dir') ? Gio.FileType.DIRECTORY : Gio.FileType.REGULAR);
                done(info, null);
            }
            return GLib.SOURCE_REMOVE;
        });
    };
    fs.sniff = (path, _cancellable, done) => {
        if (path.includes('slowsniff'))
            return; // never answers
        done(!path.includes('notimage'));
    };
    return fs;
}

function verdictOf(check, path, ms = 100) {
    let out;
    check.check(path).then(v => { out = v; });
    sleep(ms);
    return out;
}

function make(options = {}) {
    const scope = new Scope('t');
    const fs = fakeFs();
    return {scope, fs, check: new IconFileCheck(scope, {query: fs.query, sniff: fs.sniff, ...options})};
}

test('an image file is ok and remembered', () => {
    const {scope, check} = make();
    assertEquals(check.last('/home/u/logo.svg'), undefined);
    assertEquals(verdictOf(check, '/home/u/logo.svg'), 'ok');
    assertEquals(check.last('/home/u/logo.svg'), 'ok');
    scope.dispose();
});

test('missing, not a regular file and not an image are bad', () => {
    const {scope, check} = make();
    assertEquals(verdictOf(check, '/home/u/missing.svg'), 'bad');
    assertEquals(verdictOf(check, '/home/u/dir.svg'), 'bad');
    assertEquals(verdictOf(check, '/home/u/notimage.svg'), 'bad');
    scope.dispose();
});

test('a hung mount answers timeout without blocking, then at once without a new query', () => {
    const {scope, fs, check} = make({timeoutMs: 50});
    const t0 = GLib.get_monotonic_time();
    let out;
    check.check('/mnt/nas/hung/logo.svg').then(v => { out = v; });
    const spent = (GLib.get_monotonic_time() - t0) / 1000;
    assert(spent < 5, `the call blocked for ${spent} ms`);
    assertEquals(out, undefined);
    sleep(20); // the main loop runs while the check waits
    sleep(100);
    assertEquals(out, 'timeout');
    const calls = fs.calls.length;
    assertEquals(verdictOf(check, '/mnt/nas/hung/other.svg', 20), 'timeout');
    assertEquals(fs.calls.length, calls);
    scope.dispose();
});

test('a sniff that never answers gives up with timeout', () => {
    const {scope, check} = make({timeoutMs: 50});
    assertEquals(verdictOf(check, '/home/u/slowsniff.svg', 200), 'timeout');
    scope.dispose();
});

test('disposing the scope while a check is pending resolves timeout; later checks too', () => {
    const {scope, check} = make({timeoutMs: 5000});
    let out;
    check.check('/home/u/slowsniff.svg').then(v => { out = v; });
    sleep(50);
    assertEquals(out, undefined);
    scope.dispose();
    sleep(50);
    assertEquals(out, 'timeout');
    assertEquals(verdictOf(check, '/home/u/logo.svg', 30), 'timeout');
});

test('real files: a bundled icon is ok, a text file and a missing file are bad', () => {
    const scope = new Scope('t');
    const check = new IconFileCheck(scope);
    const here = GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]);
    const icon = GLib.build_filenamev([here, '..', 'data', 'icons', 'distro-arch-symbolic.svg']);
    assertEquals(verdictOf(check, icon, 300), 'ok');
    const [file] = Gio.File.new_tmp('spawn-icon-XXXXXX');
    GLib.file_set_contents(file.get_path(), 'this is not an image');
    assertEquals(verdictOf(check, file.get_path(), 300), 'bad');
    file.delete(null);
    assertEquals(verdictOf(check, `${file.get_path()}-gone`, 300), 'bad');
    scope.dispose();
});

run();

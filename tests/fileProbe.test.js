// FileProbe (build/core/fileProbe.js): asynchronous file checks with a deadline, shared queries, a cap on
// the queries in flight and hung-mount detection. The hanging file system is simulated with an injected query.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Scope} from '../build/core/scope.js';
import {FileProbe, probePrefix} from '../build/core/fileProbe.js';
import {assert, assertEquals, run, sleep, test} from './harness.js';

/** A query that never answers for paths containing "/hung/" (while fs.hanging) and answers `ok` after `ms` otherwise. */
function fakeFs(ms = 5) {
    const fs = {calls: [], pending: [], hanging: true};
    fs.query = (file, attributes, cancellable, done) => {
        const path = file.get_path();
        fs.calls.push(path);
        if (fs.hanging && path.includes('/hung/')) {
            fs.pending.push({path, done}); // answered only by fs.release()
            return;
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            if (path.includes('missing'))
                done(null, new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND, 'not found'));
            else
                done(new Gio.FileInfo(), null);
            return GLib.SOURCE_REMOVE;
        });
    };
    fs.release = () => {
        fs.hanging = false;
        for (const p of fs.pending.splice(0))
            p.done(null, new GLib.Error(Gio.IOErrorEnum, Gio.IOErrorEnum.FAILED, 'came back'));
    };
    return fs;
}

function collect(promise, out, tag) {
    promise.then(r => out.push(`${tag}:${typeof r === 'string' ? r : r.state}`));
}

test('real files: an existing file is ok, a missing one missing (Gio async, no blocking call)', () => {
    const scope = new Scope('t');
    const probe = new FileProbe(scope);
    const [file] = Gio.File.new_tmp('spawn-probe-XXXXXX');
    const out = [];
    collect(probe.exists(file.get_path()), out, 'tmp');
    collect(probe.exists(`${file.get_path()}-does-not-exist`), out, 'gone');
    sleep(200);
    assertEquals(out.sort(), ['gone:missing', 'tmp:ok']);
    file.delete(null);
    scope.dispose();
});

test('the same file asked twice while its query runs: one query, both answered', () => {
    const scope = new Scope('t');
    const fs = fakeFs(20);
    const probe = new FileProbe(scope, {query: fs.query});
    const out = [];
    collect(probe.exists('/home/u/a.txt'), out, 'a1');
    collect(probe.exists('/home/u/a.txt'), out, 'a2');
    sleep(80);
    assertEquals(fs.calls, ['/home/u/a.txt']);
    assertEquals(out, ['a1:ok', 'a2:ok']);
    scope.dispose();
});

test('a hung mount: timeout at the deadline, then no more queries below its prefix until it returns', () => {
    const scope = new Scope('t');
    const fs = fakeFs();
    const probe = new FileProbe(scope, {query: fs.query, timeoutMs: 50});
    const out = [];
    collect(probe.exists('/mnt/nas/hung/report.odt'), out, 'first');
    sleep(20);
    assertEquals(out, []); // still waiting, nothing blocked
    sleep(60);
    assertEquals(out, ['first:timeout']);
    assertEquals(probe.running, 0); // an overdue query does not hold a slot
    collect(probe.exists('/mnt/nas/hung/other.odt'), out, 'same-mount');
    collect(probe.exists('/home/u/local.txt'), out, 'local');
    sleep(40);
    assertEquals(fs.calls, ['/mnt/nas/hung/report.odt', '/home/u/local.txt']);
    assertEquals(out, ['first:timeout', 'same-mount:timeout', 'local:ok']);
    fs.release(); // the share answers again: its prefix is probed again
    collect(probe.exists('/mnt/nas/hung/x.odt'), out, 'back');
    sleep(40);
    assertEquals(out[out.length - 1], 'back:ok');
    scope.dispose();
});

test('at most maxInFlight queries run; the rest wait in order under their deadline', () => {
    const scope = new Scope('t');
    const fs = fakeFs(30);
    const probe = new FileProbe(scope, {query: fs.query, maxInFlight: 2, timeoutMs: 500});
    const out = [];
    for (const n of [1, 2, 3, 4])
        collect(probe.exists(`/home/u/f${n}`), out, `f${n}`);
    assertEquals(fs.calls.length, 2);
    assertEquals(probe.running, 2);
    sleep(200);
    assertEquals(fs.calls, ['/home/u/f1', '/home/u/f2', '/home/u/f3', '/home/u/f4']);
    assertEquals(out, ['f1:ok', 'f2:ok', 'f3:ok', 'f4:ok']);
    scope.dispose();
});

test('cancel() answers every waiting caller at once; disposing the scope makes later calls time out', () => {
    const scope = new Scope('t');
    const fs = fakeFs(100);
    const probe = new FileProbe(scope, {query: fs.query, timeoutMs: 1000});
    const out = [];
    collect(probe.exists('/home/u/slow'), out, 'slow');
    sleep(10);
    probe.cancel();
    sleep(10);
    assertEquals(out, ['slow:timeout']);
    scope.dispose();
    collect(probe.exists('/home/u/after'), out, 'after');
    sleep(10);
    assertEquals(out, ['slow:timeout', 'after:timeout']);
    assert(!fs.calls.includes('/home/u/after'), 'no query after dispose');
});

test('probePrefix: three path components, or scheme://host', () => {
    assertEquals(probePrefix(Gio.File.new_for_path('/mnt/nas/share/a/b.txt')), '/mnt/nas/share');
    assertEquals(probePrefix(Gio.File.new_for_path('/x')), '/x');
    assertEquals(probePrefix(Gio.File.new_for_uri('sftp://host.lan/srv/data')), 'sftp://host.lan');
});

run();

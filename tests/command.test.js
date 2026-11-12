// The runner's Run row: when does typed text count as a command (search/command.ts). The environment is faked, so
// nothing is looked up or started; one test checks the real GLib argv splitting.
import GLib from 'gi://GLib';
import {detectCommand, expandHome} from '../build/search/command.js';
import {assertEquals, run, test} from './harness.js';

const split = line => {
    try {
        const [ok, argv] = GLib.shell_parse_argv(line);
        return ok ? argv : null;
    } catch {
        return null;
    }
};
const env = {
    parseArgv: split,
    findProgram: name => (['true', 'ls', 'my tool'].includes(name) ? `/usr/bin/${name}` : null),
    isExecutableFile: path => ['/usr/bin/env', '/home/me/bin/run-me', '/opt/with space/x'].includes(path),
    home: '/home/me',
};
const argv = q => detectCommand(q, env)?.argv ?? null;

test('a program in the PATH, with arguments', () => {
    assertEquals(argv('true'), ['true']);
    assertEquals(argv('  ls -la /tmp  '), ['ls', '-la', '/tmp']);
    assertEquals(detectCommand('  ls -la  ', env).line, 'ls -la');
});

test('quotes group words, and are removed', () => {
    assertEquals(argv('ls "my dir" \'a b\' c\\ d'), ['ls', 'my dir', 'a b', 'c d']);
    assertEquals(argv('"my tool" --x'), ['my tool', '--x']);
});

test('not offered: unknown programs, empty text, unbalanced quotes', () => {
    assertEquals(argv('definitely-not-a-program'), null);
    assertEquals(argv(''), null);
    assertEquals(argv('   '), null);
    assertEquals(argv('ls "unbalanced'), null);
    assertEquals(argv('""'), null);
});

test('absolute and ~ paths must be executable files; relative paths are not offered', () => {
    assertEquals(argv('/usr/bin/env FOO=1'), ['/usr/bin/env', 'FOO=1']);
    assertEquals(argv('/usr/bin/nope'), null);
    assertEquals(argv('~/bin/run-me now'), ['/home/me/bin/run-me', 'now']);
    assertEquals(argv('~/bin/missing'), null);
    assertEquals(argv('./run-me'), null);
    assertEquals(argv('bin/run-me'), null);
    assertEquals(argv('"/opt/with space/x"'), ['/opt/with space/x']);
    assertEquals(argv('~other/x'), null);
});

test('no shell: operators and variables are plain argument text', () => {
    assertEquals(argv('ls $HOME | wc; rm *'), ['ls', '$HOME', '|', 'wc;', 'rm', '*']);
    assertEquals(argv('$HOME/x'), null);
    assertEquals(argv('`ls`'), null);
});

test('expandHome only knows ~ and ~/', () => {
    assertEquals(expandHome('~', '/home/me'), '/home/me');
    assertEquals(expandHome('~/a', '/home/me/'), '/home/me/a');
    assertEquals(expandHome('~a/b', '/home/me'), '~a/b');
    assertEquals(expandHome('a~/b', '/home/me'), 'a~/b');
});

run();

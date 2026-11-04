// Dev Screenshot path policy (review finding 7).
import {screenshotPath} from '../build/input/paths.js';
import {assertEquals, run, test} from './harness.js';

const rt = '/run/user/1000';

test('allows paths under the runtime dir', () => {
    assertEquals(screenshotPath('/run/user/1000/spawn/a.png', rt), '/run/user/1000/spawn/a.png');
});

test('allows paths under a .dev directory', () => {
    assertEquals(screenshotPath('/home/u/spawn/.dev/shots/a.png', rt), '/home/u/spawn/.dev/shots/a.png');
});

test('rejects other absolute paths, relative paths and empty input', () => {
    assertEquals(screenshotPath('/tmp/a.png', rt), null);
    assertEquals(screenshotPath('/home/u/.bashrc', rt), null);
    assertEquals(screenshotPath('shots/a.png', rt), null);
    assertEquals(screenshotPath('', rt), null);
    assertEquals(screenshotPath('/', rt), null);
});

test('rejects .. escapes and look-alike directories', () => {
    assertEquals(screenshotPath('/run/user/1000/../../../etc/x', rt), null);
    assertEquals(screenshotPath('/home/u/.dev/../.ssh/authorized_keys', rt), null);
    assertEquals(screenshotPath('/run/user/10000/a.png', rt), null);
    assertEquals(screenshotPath('/run/user/1000', rt), null);
    assertEquals(screenshotPath('/home/u/not.dev/a.png', rt), null);
    assertEquals(screenshotPath('/home/u/.devious/a.png', rt), null);
});

test('an empty runtime dir allows only .dev paths', () => {
    assertEquals(screenshotPath('/run/user/1000/a.png', ''), null);
    assertEquals(screenshotPath('/a/.dev/b.png', ''), '/a/.dev/b.png');
});

run();

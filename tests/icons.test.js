import {resolveButtonIcon} from '../build/core/icons.js';
import {assertEquals, run, test} from './harness.js';

const dir = '/ext/data/icons';

test('bundled file name', () => {
    assertEquals(resolveButtonIcon('distro-fedora-symbolic.svg', dir), {kind: 'file', path: `${dir}/distro-fedora-symbolic.svg`});
});

test('absolute path', () => {
    assertEquals(resolveButtonIcon('/home/u/i.png', dir), {kind: 'file', path: '/home/u/i.png'});
});

test('ArcMenu resource URI maps to the bundled file', () => {
    const uri = 'resource:///org/gnome/shell/extensions/arcmenu/icons/scalable/actions/distro-fedora-symbolic.svg';
    assertEquals(resolveButtonIcon(uri, dir), {kind: 'file', path: `${dir}/distro-fedora-symbolic.svg`});
});

test('themed icon name', () => {
    assertEquals(resolveButtonIcon('start-here-symbolic', dir), {kind: 'name', name: 'start-here-symbolic'});
});

run();

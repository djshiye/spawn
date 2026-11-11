import GLib from 'gi://GLib';
import {builtinPanels, isValidPanelId, loadPanels, matchPanels, panelArgv, panelIdFromFileName} from '../build/search/panelIndex.js';
import {assert, assertEquals, run, test} from './harness.js';

const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const dir = GLib.build_filenamev([here, 'fixtures', 'panels']);
const panels = loadPanels([dir]);
const ids = q => matchPanels(q, panels).map(r => r.item.id);

test('both desktop file namings are discovered, others ignored', () => {
    assertEquals(panels.map(p => p.id).sort(), ['bluetooth', 'display', 'mouse', 'sharing', 'sound', 'wifi']);
    assertEquals(panelIdFromFileName('org.gnome.Settings-wifi-panel.desktop'), 'wifi');
    assertEquals(panelIdFromFileName('gnome-bluetooth-panel.desktop'), 'bluetooth');
    assertEquals(panelIdFromFileName('org.gnome.Settings-online-accounts-panel.desktop'), 'online-accounts');
    assertEquals(panelIdFromFileName('org.gnome.Settings.desktop'), null);
    assertEquals(panelIdFromFileName('firefox.desktop'), null);
    assertEquals(panelIdFromFileName('gnome-Evil-panel.desktop'), null);
});

test('name, icon and keywords are read from the desktop file', () => {
    const wifi = panels.find(p => p.id === 'wifi');
    assertEquals(wifi.name, 'Wi-Fi');
    assert(wifi.icon !== null);
    assert(wifi.keys.includes('hotspot'));
    assert(wifi.keys.includes('wifi')); // synonym table
});

test('panel ids are validated; the argv is fixed', () => {
    for (const ok of ['wifi', 'online-accounts', 'a1'])
        assert(isValidPanelId(ok), ok);
    for (const bad of ['', '../x', 'a b', 'a;b', '-x', 'Wifi', '$(x)', 'a'.repeat(65)])
        assert(!isValidPanelId(bad), bad);
    assertEquals(panelArgv('wifi'), ['gnome-control-center', 'wifi']);
});

test('queries find the panel by name, keyword and synonym', () => {
    assertEquals(ids('bluetooth'), ['bluetooth']);
    assertEquals(ids('wifi'), ['wifi']);
    assertEquals(ids('wi-fi'), ['wifi']);
    assertEquals(ids('wireless')[0], 'wifi');
    assertEquals(ids('display')[0], 'display');
    assertEquals(ids('monitor')[0], 'display');
    assertEquals(ids('audio')[0], 'sound');
    assertEquals(ids('sound'), ['sound']);
    assertEquals(ids('touchpad')[0], 'mouse');
    assertEquals(ids('mouse')[0], 'mouse');
    assertEquals(ids('Bluetoth')[0], 'bluetooth'); // one typo
});

test('no loose matches and a minimum length', () => {
    assertEquals(ids('wi'), []);
    assertEquals(ids(''), []);
    assertEquals(ids('--'), []);
    assertEquals(ids('xyzzy'), []);
    assertEquals(ids('dsp'), []); // scattered letters of "display"
    assertEquals(ids('firefox'), []);
});

test('the built-in list is the fallback and covers the usual names', () => {
    const b = builtinPanels();
    assertEquals(matchPanels('bluetooth', b)[0].item.id, 'bluetooth');
    assertEquals(matchPanels('wifi', b)[0].item.id, 'wifi');
    assertEquals(matchPanels('printers', b)[0].item.id, 'printers');
    assertEquals(loadPanels(['/nonexistent-dir-for-spawn-tests']), []);
});

run();

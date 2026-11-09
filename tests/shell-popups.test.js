// closeShellPopups (build/panel/shellPopups.js) against fake menus.
import {closeShellPopups, isMenuOpen, menusOfStatusArea} from '../build/panel/shellPopups.js';
import {assert, assertEquals, run, test} from './harness.js';

const menu = (isOpen, log, name) => ({isOpen, name, close: () => log.push(name)});

test('only open menus are closed, Spawn\'s own is kept, duplicates are closed once', () => {
    const log = [];
    const calendar = menu(true, log, 'calendar');
    const quick = menu(false, log, 'quick');
    const tray = menu(true, log, 'tray');
    const own = menu(true, log, 'spawn');
    const n = closeShellPopups({menus: () => [calendar, quick, tray, calendar, null, own], close: m => m.close()}, [own]);
    assertEquals(n, 2);
    assertEquals(log, ['calendar', 'tray']);
});

test('a menu that throws on close does not stop the others', () => {
    const log = [];
    const bad = {isOpen: true, close: () => { throw new Error('boom'); }};
    const good = menu(true, log, 'good');
    assertEquals(closeShellPopups({menus: () => [bad, good], close: m => m.close()}), 1);
    assertEquals(log, ['good']);
});

test('a throwing menus() list is a no-op', () => {
    assertEquals(closeShellPopups({menus: () => { throw new Error('x'); }, close: () => {}}), 0);
});

test('menusOfStatusArea collects the .menu of every indicator and ignores the rest', () => {
    const a = {};
    const b = {};
    assertEquals(menusOfStatusArea({dateMenu: {menu: a}, quickSettings: {menu: b}, activities: {}, odd: null}).length, 2);
    assertEquals(menusOfStatusArea(null), []);
    assert(isMenuOpen({isOpen: true}) && !isMenuOpen({isOpen: false}) && !isMenuOpen(null));
});

run();

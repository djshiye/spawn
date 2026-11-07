// "New" apps bookkeeping (model/newApps.ts, pure), the settings-backed store (model/newAppsStore.ts, over
// the in-memory GSettings backend, never dconf) and the hidden-apps filters (model/hiddenApps.ts).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Scope} from '../build/core/scope.js';
import {SCHEMA_ID, SpawnSettings} from '../build/core/settings.js';
import {addHidden, filterCategories, filterHidden, hiddenSet, removeHidden} from '../build/model/hiddenApps.js';
import {anyFresh, clearLaunched, isFresh, NEW_APP_TTL_S, sameState, syncNewApps} from '../build/model/newApps.js';
import {NewAppsStore} from '../build/model/newAppsStore.js';
import {assert, assertEquals, run, test} from './harness.js';

const DAY = 24 * 60 * 60;
const T0 = 1_800_000_000;
const empty = () => ({known: [], fresh: {}});

// ---- syncNewApps ----

test('the first sync seeds known-apps and marks nothing as new', () => {
    const r = syncNewApps(empty(), ['b.desktop', 'a.desktop'], T0);
    assertEquals(r.seeded, true);
    assertEquals(r.changed, true);
    assertEquals(r.state, {known: ['a.desktop', 'b.desktop'], fresh: {}});
});

test('an empty app list (catalogue not loaded) neither seeds nor forgets', () => {
    const state = {known: ['a.desktop'], fresh: {'a.desktop': T0}};
    const r = syncNewApps(state, [], T0 + 5);
    assertEquals(r.changed, false);
    assertEquals(r.seeded, false);
    assertEquals(r.state, state);
    assertEquals(syncNewApps(empty(), [], T0).changed, false);
});

test('an app installed later is new, stamped with the time it was first seen', () => {
    const seeded = syncNewApps(empty(), ['a.desktop'], T0).state;
    const r = syncNewApps(seeded, ['a.desktop', 'z.desktop'], T0 + 100);
    assertEquals(r.changed, true);
    assertEquals(r.seeded, false);
    assertEquals(r.state.known, ['a.desktop', 'z.desktop']);
    assertEquals(r.state.fresh, {'z.desktop': T0 + 100});
    assert(isFresh(r.state.fresh, 'z.desktop', T0 + 101));
    assert(!isFresh(r.state.fresh, 'a.desktop', T0 + 101));
});

test('nothing changed: no write is asked for and the same state object comes back', () => {
    const state = syncNewApps(syncNewApps(empty(), ['a.desktop'], T0).state, ['a.desktop', 'b.desktop'], T0 + 1).state;
    const again = syncNewApps(state, ['b.desktop', 'a.desktop'], T0 + 60);
    assertEquals(again.changed, false);
    assert(again.state === state, 'state was copied although nothing changed');
});

test('a new app stays new for 3 days, then ages out on the next sync', () => {
    const base = syncNewApps(empty(), ['a.desktop'], T0).state;
    const state = syncNewApps(base, ['a.desktop', 'n.desktop'], T0).state;
    assert(isFresh(state.fresh, 'n.desktop', T0 + NEW_APP_TTL_S - 1), 'new just before the limit');
    assert(!isFresh(state.fresh, 'n.desktop', T0 + NEW_APP_TTL_S), 'not new at the limit');
    assertEquals(NEW_APP_TTL_S, 3 * DAY);
    const later = syncNewApps(state, ['a.desktop', 'n.desktop'], T0 + 3 * DAY);
    assertEquals(later.changed, true);
    assertEquals(later.state.fresh, {});
    assertEquals(later.state.known, ['a.desktop', 'n.desktop']); // still known: it does not turn new again
});

test('uninstalled apps are pruned from known and fresh', () => {
    const base = syncNewApps(empty(), ['a.desktop', 'b.desktop'], T0).state;
    const state = syncNewApps(base, ['a.desktop', 'b.desktop', 'n.desktop'], T0 + 10).state;
    const r = syncNewApps(state, ['a.desktop'], T0 + 20);
    assertEquals(r.changed, true);
    assertEquals(r.state, {known: ['a.desktop'], fresh: {}});
});

test('an app that was removed and installed again is new again', () => {
    const base = syncNewApps(empty(), ['a.desktop', 'b.desktop'], T0).state;
    const gone = syncNewApps(base, ['a.desktop'], T0 + 10).state;
    const back = syncNewApps(gone, ['a.desktop', 'b.desktop'], T0 + 20).state;
    assertEquals(back.fresh, {'b.desktop': T0 + 20});
});

test('launching clears new; launching anything else changes nothing', () => {
    const base = syncNewApps(empty(), ['a.desktop'], T0).state;
    const state = syncNewApps(base, ['a.desktop', 'n.desktop'], T0 + 1).state;
    assertEquals(clearLaunched(state, 'a.desktop'), null);
    const cleared = clearLaunched(state, 'n.desktop');
    assertEquals(cleared, {known: ['a.desktop', 'n.desktop'], fresh: {}});
    assertEquals(state.fresh, {'n.desktop': T0 + 1}); // the input is not mutated
    // and it does not come back on the next sync
    assertEquals(syncNewApps(cleared, ['a.desktop', 'n.desktop'], T0 + 2).changed, false);
});

test('anyFresh and sameState', () => {
    const fresh = {'n.desktop': T0};
    assert(anyFresh(fresh, ['x.desktop', 'n.desktop'], T0 + 1));
    assert(!anyFresh(fresh, ['x.desktop'], T0 + 1));
    assert(!anyFresh(fresh, ['n.desktop'], T0 + NEW_APP_TTL_S));
    assert(sameState({known: ['a'], fresh: {a: 1}}, {known: ['a'], fresh: {a: 1}}));
    assert(!sameState({known: ['a'], fresh: {a: 1}}, {known: ['a'], fresh: {a: 2}}));
    assert(!sameState({known: ['a'], fresh: {}}, {known: ['a', 'b'], fresh: {}}));
});

// ---- hidden apps ----

test('hiddenSet / addHidden / removeHidden', () => {
    assertEquals([...hiddenSet(['a.desktop', '', 'a.desktop', 'b.desktop'])], ['a.desktop', 'b.desktop']);
    assertEquals(addHidden(['a.desktop'], 'b.desktop'), ['a.desktop', 'b.desktop']);
    assertEquals(addHidden(['a.desktop'], 'a.desktop'), ['a.desktop']);
    assertEquals(addHidden([], ''), []);
    assertEquals(removeHidden(['a.desktop', 'b.desktop'], 'a.desktop'), ['b.desktop']);
    assertEquals(removeHidden(['a.desktop'], 'x.desktop'), ['a.desktop']);
});

test('filterHidden drops hidden apps and keeps the order', () => {
    const apps = [{id: 'a.desktop'}, {id: 'b.desktop'}, {id: 'c.desktop'}];
    assertEquals(filterHidden(apps, a => a.id, new Set(['b.desktop'])).map(a => a.id), ['a.desktop', 'c.desktop']);
    assert(filterHidden(apps, a => a.id, new Set()) === apps, 'no hidden apps should return the input');
    assertEquals(filterHidden(apps, a => a.id, new Set(['nope.desktop'])).length, 3);
});

test('filterCategories removes hidden apps, drops empty categories and never mutates', () => {
    const cats = [
        {id: 'Utility', name: 'Utilities', apps: [{id: 'a.desktop'}, {id: 'b.desktop'}]},
        {id: 'Game', name: 'Games', apps: [{id: 'g.desktop'}]},
    ];
    const out = filterCategories(cats, a => a.id, new Set(['b.desktop', 'g.desktop']));
    assertEquals(out.map(c => [c.id, c.apps.map(a => a.id)]), [['Utility', ['a.desktop']]]);
    assertEquals(cats[0].apps.length, 2);
    assertEquals(cats[1].apps.length, 1);
    assertEquals(out[0].name, 'Utilities');
});

// ---- the store over real GSettings ----

const tmp = GLib.dir_make_tmp('spawn-newapps-XXXXXX');
const here = GLib.path_get_dirname(import.meta.url.replace('file://', ''));
const xml = GLib.build_filenamev([here, '..', 'schemas', 'org.gnome.shell.extensions.spawn.gschema.xml']);
Gio.File.new_for_path(xml).copy(Gio.File.new_for_path(GLib.build_filenamev([tmp, 'schema.gschema.xml'])), Gio.FileCopyFlags.OVERWRITE, null, null);
const [compiled, , err] = GLib.spawn_command_line_sync(`glib-compile-schemas ${tmp}`);
if (!compiled)
    throw new Error(`glib-compile-schemas failed: ${err}`);
const source = Gio.SettingsSchemaSource.new_from_directory(tmp, Gio.SettingsSchemaSource.get_default(), false);
GLib.spawn_command_line_sync(`rm -rf ${tmp}`);

function storeFixture(startAt = T0) {
    const backend = Gio.memory_settings_backend_new();
    const schema = source.lookup(SCHEMA_ID, true);
    const settings = new SpawnSettings(Gio.Settings.new_full(schema, backend, '/org/gnome/shell/extensions/spawn/'), source);
    const clock = {now: startAt};
    const scope = new Scope('t');
    const store = new NewAppsStore(scope, settings, {now: () => clock.now});
    return {settings, store, clock, scope};
}

test('schema: new keys default to nothing hidden, nothing known, badge and hidden-search on', () => {
    const {settings} = storeFixture();
    assertEquals(settings.get('hidden-apps'), []);
    assertEquals(settings.get('known-apps'), []);
    assertEquals(settings.get('new-apps'), {});
    assertEquals(settings.get('search-hidden-apps'), true);
    assertEquals(settings.get('show-new-apps-badge'), true);
});

test('store: first sync seeds, a later install is new, launching clears it, all written to settings', () => {
    const {settings, store, clock, scope} = storeFixture();
    store.sync(['a.desktop', 'b.desktop']);
    assertEquals(settings.get('known-apps'), ['a.desktop', 'b.desktop']);
    assertEquals(settings.get('new-apps'), {});
    assert(!store.isNew('a.desktop'));

    clock.now = T0 + 60;
    store.sync(['a.desktop', 'b.desktop', 'n.desktop']);
    assert(store.isNew('n.desktop'));
    assert(store.showBadge('n.desktop'));
    assert(store.anyNew(['b.desktop', 'n.desktop']));
    assertEquals(settings.get('new-apps'), {'n.desktop': T0 + 60});

    store.markLaunched('n.desktop');
    assert(!store.isNew('n.desktop'));
    assertEquals(settings.get('new-apps'), {});
    assertEquals(settings.get('known-apps'), ['a.desktop', 'b.desktop', 'n.desktop']);
    scope.dispose();
});

test('store: expires after three days without any write; the switch hides the badge but not the bookkeeping', () => {
    const {settings, store, clock, scope} = storeFixture();
    store.sync(['a.desktop']);
    clock.now = T0 + 10;
    store.sync(['a.desktop', 'n.desktop']);
    clock.now = T0 + 10 + NEW_APP_TTL_S - 1;
    assert(store.isNew('n.desktop'));
    settings.set('show-new-apps-badge', false);
    assert(store.isNew('n.desktop'));
    assert(!store.showBadge('n.desktop'));
    assert(!store.anyNew(['n.desktop']));
    settings.set('show-new-apps-badge', true);
    clock.now = T0 + 10 + NEW_APP_TTL_S;
    assert(!store.isNew('n.desktop'));
    scope.dispose();
});

test('store: writes only when something changed, and listeners hear each change once', () => {
    const {settings, store, clock, scope} = storeFixture();
    let changes = 0;
    let heard = 0;
    settings.onChanged(scope, ['known-apps', 'new-apps'], () => changes++);
    store.onChanged(scope, () => heard++);
    store.sync(['a.desktop']);
    assertEquals(heard, 0); // seeding redraws nothing
    const afterSeed = changes;
    assert(afterSeed > 0, 'seeding did not write');
    store.sync(['a.desktop']);
    store.sync(['a.desktop']);
    assertEquals(changes, afterSeed);
    clock.now += 5;
    store.sync(['a.desktop', 'n.desktop']);
    assertEquals(heard, 1);
    store.markLaunched('a.desktop'); // not new: no write, no notification
    assertEquals(heard, 1);
    store.markLaunched('n.desktop');
    assertEquals(heard, 2);
    scope.dispose();
});

test('store: an edit from outside (reset in Preferences) is read again and announced', () => {
    const {settings, store, clock, scope} = storeFixture();
    store.sync(['a.desktop']);
    clock.now += 1;
    store.sync(['a.desktop', 'n.desktop']);
    assert(store.isNew('n.desktop'));
    let heard = 0;
    store.onChanged(scope, () => heard++);
    settings.reset('new-apps');
    assert(!store.isNew('n.desktop'));
    assert(heard >= 1, 'the reset was not announced');
    scope.dispose();
});

run();

// rankApps() must keep returning exactly the same items, order and scores: compares the result count and
// the top 25 (id:score) of every query in SNAPSHOT_QUERIES against tests/fixtures/rank-snapshot.json
// (see gen-rank-snapshot.js; only regenerate for an intended ranking change).
import Gio from 'gi://Gio';
import {catalogue} from '../tools/dev/bench-catalogue.js';
import {rankApps} from '../build/search/rank.js';
import {SNAPSHOT_QUERIES} from './fixtures/rank-snapshot-queries.js';
import {assert, assertEquals, run, test} from './harness.js';

function loadSnapshot() {
    const file = Gio.File.new_for_uri(import.meta.url).get_parent().get_child('fixtures').get_child('rank-snapshot.json');
    const [, bytes] = file.load_contents(null);
    return JSON.parse(new globalThis.TextDecoder().decode(bytes));
}

test('rankApps matches the recorded snapshot for every query', () => {
    const snapshot = loadSnapshot();
    const items = catalogue(400);
    assertEquals(Object.keys(snapshot).length, SNAPSHOT_QUERIES.length, 'query count');
    for (const q of SNAPSHOT_QUERIES) {
        assert(q in snapshot, `no snapshot for "${q}"`);
        const ranked = rankApps(q, items);
        const got = {count: ranked.length, top: ranked.slice(0, 25).map(r => `${r.item.id}:${r.score}`)};
        assertEquals(got, snapshot[q], `query "${q}"`);
    }
});

test('rankApps stays identical on a second pass (prepared-candidate cache)', () => {
    const items = catalogue(400);
    for (const q of SNAPSHOT_QUERIES.slice(0, 40)) {
        const a = rankApps(q, items).map(r => `${r.item.id}:${r.score}`);
        const b = rankApps(q, items).map(r => `${r.item.id}:${r.score}`);
        assertEquals(b, a, `query "${q}"`);
    }
});

run();

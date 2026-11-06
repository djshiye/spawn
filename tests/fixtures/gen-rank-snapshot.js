// Regenerates rank-snapshot.json: the rankApps() result count and top 25 (ids + scores) for the benchmark
// catalogue and a wide query set. Only regenerate when a ranking change is intended:
//   npx tsc && LC_ALL=C.UTF-8 gjs -m tests/fixtures/gen-rank-snapshot.js > tests/fixtures/rank-snapshot.json
import {catalogue} from '../../tools/dev/bench-catalogue.js';
import {rankApps} from '../../build/search/rank.js';
import {SNAPSHOT_QUERIES} from './rank-snapshot-queries.js';

const items = catalogue(400);
const out = {};
for (const q of SNAPSHOT_QUERIES) {
    const ranked = rankApps(q, items);
    out[q] = {count: ranked.length, top: ranked.slice(0, 25).map(r => `${r.item.id}:${r.score}`)};
}
print(JSON.stringify(out, null, 0).replace(/\],"/g, "],\n\""));

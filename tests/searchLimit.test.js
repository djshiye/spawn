// max-search-results clamp shared by every search provider.
import {clampMaxResults, maxSearchResults} from '../build/search/limit.js';
import {assertEquals, run, test} from './harness.js';

test('clampMaxResults keeps 1..50 and truncates', () => {
    assertEquals([0, -1, 1, 5, 50, 51, 9999].map(clampMaxResults), [1, 1, 1, 5, 50, 50, 50]);
    assertEquals([clampMaxResults(7.9), clampMaxResults(NaN), clampMaxResults(undefined)], [7, 1, 1]);
});

test('maxSearchResults reads the setting through the clamp', () => {
    assertEquals(maxSearchResults({get: () => -1}), 1);
    assertEquals(maxSearchResults({get: () => 20}), 20);
});

run();

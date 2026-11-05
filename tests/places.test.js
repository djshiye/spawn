// Bookmarks file parser (build/model/bookmarkFile.js).
import {parseBookmarks} from '../build/model/bookmarkFile.js';
import {assertEquals, run, test} from './harness.js';

test('uri with and without a label, blank lines skipped', () => {
    const text = 'file:///home/u/Music\n\nfile:///home/u/My%20Docs My Docs\nsftp://host/path  Remote  box \n  \n';
    assertEquals(parseBookmarks(text), [
        {uri: 'file:///home/u/Music', label: ''},
        {uri: 'file:///home/u/My%20Docs', label: 'My Docs'},
        {uri: 'sftp://host/path', label: 'Remote  box'},
    ]);
});

test('an empty file has no bookmarks', () => {
    assertEquals(parseBookmarks(''), []);
    assertEquals(parseBookmarks('\n\n'), []);
});

run();

// Bookmarks file parser (build/model/bookmarkFile.js).
import {parseBookmarks} from '../build/model/bookmarkFile.js';
import {mountAction} from '../build/model/mountAction.js';
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

test('mountAction: eject preferred over unmount; label and action agree', () => {
    const m = (e, u) => ({can_eject: () => e, can_unmount: () => u});
    assertEquals(mountAction(m(true, true)), 'eject');
    assertEquals(mountAction(m(true, false)), 'eject');
    assertEquals(mountAction(m(false, true)), 'unmount');
    assertEquals(mountAction(m(false, false)), null);
});

run();

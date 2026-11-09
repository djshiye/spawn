// build/core/updateNotice.js: when does "Spawn was updated" apply, and what does it say.
import {parseMetadataVersion, updateMessage, updatePending, versionOf} from '../build/core/updateNotice.js';
import {assert, assertEquals, run, test} from './harness.js';

test('the version comes from version-name, else version', () => {
    assertEquals(versionOf({'version-name': '1.2.0', version: 7}), '1.2.0');
    assertEquals(versionOf({version: 7}), '7');
    assertEquals(versionOf({}), null);
    assertEquals(versionOf(null), null);
    assertEquals(versionOf({'version-name': '  '}), null);
});

test('metadata.json text: valid, damaged and half-written files', () => {
    assertEquals(parseMetadataVersion('{"uuid": "x", "version-name": "1.2.0"}'), '1.2.0');
    assertEquals(parseMetadataVersion('{"uuid": "x", "version-na'), null);
    assertEquals(parseMetadataVersion(''), null);
});

test('no notice on first install or a normal login (same version), none when a version is unknown', () => {
    assert(!updatePending('1.1.5', '1.1.5'));
    assert(!updatePending(null, '1.2.0'));
    assert(!updatePending('1.1.5', null));
    assert(!updatePending('', ''));
});

test('a different version on disk is a pending update', () => {
    assert(updatePending('1.1.5', '1.2.0'));
});

test('the message is polite, UK English and names the version', () => {
    assertEquals(updateMessage('1.2.0'), 'Spawn was updated to 1.2.0. Log out and back in to finish the update.');
});

run();

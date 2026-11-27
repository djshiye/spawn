import {compressIPv6, formatIPv4, maskToPrefix, networkAnswers, parseIPv4, parseIPv6, prefixToMask}
    from '../build/search/answers/network.js';
import {assert, assertEquals, run, test} from './harness.js';

const T = ' ';
const rows = q => networkAnswers(q).map(a => [a.id, a.title, a.description]);
const byId = (q, id) => networkAnswers(q).find(a => a.id === id);
const ids = q => networkAnswers(q).map(a => a.id);

test('helpers', () => {
    assertEquals(parseIPv4('192.168.1.10'), 3232235786);
    assertEquals(parseIPv4('255.255.255.255'), 4294967295);
    assertEquals(parseIPv4('0.0.0.0'), 0);
    for (const bad of ['1.2.3', '1.2.3.4.5', '256.1.1.1', '01.2.3.4', '1.2.3.', '', 'a.b.c.d', '1.2.3.-4', ' 1.2.3.4'])
        assertEquals(parseIPv4(bad), null, bad);
    assertEquals(formatIPv4(3232235786), '192.168.1.10');
    assertEquals(formatIPv4(4294967295), '255.255.255.255');
    assertEquals(formatIPv4(0), '0.0.0.0');
    assertEquals(prefixToMask(0), 0);
    assertEquals(prefixToMask(8), 0xff000000);
    assertEquals(prefixToMask(32), 0xffffffff);
    assertEquals(formatIPv4(prefixToMask(26)), '255.255.255.192');
    for (let p = 0; p <= 32; p++)
        assertEquals(maskToPrefix(prefixToMask(p)), p, `p${p}`);
    assertEquals(maskToPrefix(parseIPv4('255.0.255.0')), null);
    assertEquals(maskToPrefix(parseIPv4('0.255.255.255')), null);
});

test('ipv6 helpers', () => {
    assertEquals(compressIPv6(parseIPv6('2001:0db8:0000:0000:0000:0000:0000:0001')), '2001:db8::1');
    assertEquals(compressIPv6(0n), '::');
    assertEquals(compressIPv6(1n), '::1');
    assertEquals(compressIPv6(parseIPv6('1:0:0:2:0:0:0:3')), '1:0:0:2::3');
    assertEquals(compressIPv6(parseIPv6('1:0:2:0:3:0:4:0')), '1:0:2:0:3:0:4:0');
    assertEquals(compressIPv6(parseIPv6('1:0:0:2:0:0:3:4')), '1::2:0:0:3:4');
    assertEquals(compressIPv6(parseIPv6('FE80::')), 'fe80::');
    assert(parseIPv6('::ffff:192.0.2.1') === 0xffffc0000201n);
    assert(parseIPv6('1::') === 1n << 112n);
    assert(parseIPv6('::') === 0n);
    for (const bad of ['1::2::3', '12345::1', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7', ':1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7:8:',
        ':::', 'g::1', '1:2:3:4:5:6:7::8', '1.2.3.4', '::1.2.3', '1.2.3.4::1', '', ':'])
        assertEquals(parseIPv6(bad), null, bad);
});

test('/26 host in network', () => {
    assertEquals(rows('192.168.1.130/26'), [
        ['network', '192.168.1.128/26', 'Network'],
        ['range', '192.168.1.129 – 192.168.1.190', 'Usable host range'],
        ['netmask', '255.255.255.192', 'Subnet mask'],
        ['broadcast', '192.168.1.191', 'Broadcast address'],
        ['hosts', '62', 'Usable hosts'],
        ['wildcard', '0.0.0.63', 'Wildcard mask'],
    ]);
    assertEquals(byId('192.168.1.130/26', 'range').copy, '192.168.1.129-192.168.1.190');
    assertEquals(byId('192.168.1.130/26', 'network').copy, '192.168.1.128/26');
});

test('/24 /8 /30 /0', () => {
    assertEquals(rows('192.168.1.0/24').map(r => r[1]), ['192.168.1.0/24', '192.168.1.1 – 192.168.1.254',
        '255.255.255.0', '192.168.1.255', '254', '0.0.0.255']);
    const eight = networkAnswers('10.0.0.0/8');
    assertEquals(eight.find(a => a.id === 'hosts').title, `16${T}777${T}214`);
    assertEquals(eight.find(a => a.id === 'hosts').copy, '16777214');
    assertEquals(eight.find(a => a.id === 'broadcast').title, '10.255.255.255');
    assertEquals(rows('10.0.0.0/30').map(r => r[1]), ['10.0.0.0/30', '10.0.0.1 – 10.0.0.2', '255.255.255.252',
        '10.0.0.3', '2', '0.0.0.3']);
    const zero = rows('0.0.0.0/0');
    assertEquals(zero.map(r => r[1]), ['0.0.0.0/0', '0.0.0.1 – 255.255.255.254', '0.0.0.0', '255.255.255.255',
        `4${T}294${T}967${T}294`, '255.255.255.255']);
    assertEquals(byId('1.2.3.4/0', 'hosts').copy, '4294967294');
    assertEquals(byId('10.0.0.0/16', 'hosts').title, `65${T}534`);
    assertEquals(byId('10.0.0.0/20', 'hosts').title, '4094');
});

test('/31 and /32', () => {
    assertEquals(rows('10.0.0.4/31'), [
        ['network', '10.0.0.4/31', 'Network'],
        ['range', '10.0.0.4 – 10.0.0.5', 'Usable host range'],
        ['netmask', '255.255.255.254', 'Subnet mask'],
        ['hosts', '2', 'Usable hosts'],
        ['wildcard', '0.0.0.1', 'Wildcard mask'],
    ]);
    assertEquals(rows('10.0.0.5/32'), [
        ['network', '10.0.0.5/32', 'Network'],
        ['range', '10.0.0.5', 'Single host'],
        ['netmask', '255.255.255.255', 'Subnet mask'],
        ['hosts', '1', 'Usable hosts'],
        ['wildcard', '0.0.0.0', 'Wildcard mask'],
    ]);
});

test('address with mask forms', () => {
    const want = rows('10.0.0.5/24');
    for (const q of ['10.0.0.5 255.255.255.0', '10.0.0.5 mask 255.255.255.0', '10.0.0.5 netmask 255.255.255.0',
        '10.0.0.5/255.255.255.0'])
        assertEquals(rows(q), want, q);
    assertEquals(ids('10.0.0.5 255.0.255.0'), []);
    assertEquals(ids('10.0.0.5/255.0.255.0'), []);
});

test('prefix and mask on their own', () => {
    assertEquals(rows('/26'), [
        ['netmask', '255.255.255.192', 'Subnet mask'], ['hosts', '62', 'Usable hosts'],
        ['wildcard', '0.0.0.63', 'Wildcard mask'], ['addresses', '64', 'Addresses'],
    ]);
    assertEquals(rows('cidr 26'), rows('/26'));
    assertEquals(rows('prefix 26'), rows('/26'));
    assertEquals(rows('/0')[3], ['addresses', `4${T}294${T}967${T}296`, 'Addresses']);
    assertEquals(byId('/0', 'addresses').copy, '4294967296');
    assertEquals(rows('/32')[1], ['hosts', '1', 'Usable hosts']);
    const m = [['prefix', '/20', 'Prefix length'], ['hosts', '4094', 'Usable hosts'],
        ['wildcard', '0.0.15.255', 'Wildcard mask']];
    assertEquals(rows('netmask 255.255.240.0'), m);
    assertEquals(rows('mask 255.255.240.0'), m);
    assertEquals(rows('255.255.240.0'), m);
    assertEquals(rows('255.0.0.0')[0], ['prefix', '/8', 'Prefix length']);
    assertEquals(ids('255.0.255.0'), []);
    assertEquals(ids('mask 255.0.255.0'), []);
    assertEquals(rows('mask 224.0.0.0')[0], ['prefix', '/3', 'Prefix length']);
    assertEquals(rows('netmask 128.0.0.0')[0], ['prefix', '/1', 'Prefix length']);
    assertEquals(byId('10.0.0.5 240.0.0.0', 'network').title, '0.0.0.0/4');
    assertEquals(rows('netmask 255.255.255.255')[0], ['prefix', '/32', 'Prefix length']);
    assertEquals(rows('netmask 0.0.0.0')[0], ['prefix', '/0', 'Prefix length']);
});

test('subnetting', () => {
    const r = rows('192.168.1.0/24 into /26');
    assertEquals(r.length, 4);
    assertEquals(r[0], ['subnet0', '192.168.1.0/26', 'Subnet 1 of 4 · 192.168.1.1 – 192.168.1.62']);
    assertEquals(r[3], ['subnet3', '192.168.1.192/26', 'Subnet 4 of 4 · 192.168.1.193 – 192.168.1.254']);
    assertEquals(rows('192.168.1.0/24 split /26'), r);
    assertEquals(rows('192.168.1.0/24 split into /26'), r);
    assertEquals(rows('192.168.1.77/24 to /26'), r);
    assertEquals(rows('192.168.1.0/24 into 26'), r);
    const ten = networkAnswers('10.0.0.0/8 to /10');
    assertEquals(ten.map(a => a.title), ['10.0.0.0/10', '10.64.0.0/10', '10.128.0.0/10', '10.192.0.0/10']);
    assertEquals(networkAnswers('192.168.1.0/24 into /27').length, 8);
    assertEquals(networkAnswers('192.168.1.0/24 into /27')[7].id, 'subnet7');
    const many = networkAnswers('10.0.0.0/8 to /18');
    assertEquals(many.length, 8);
    assertEquals(many[6].title, '10.1.128.0/18');
    assertEquals(many[7].id, 'more');
    assertEquals(many[7].title, `1${T}024 subnets`);
    assertEquals(many[7].copy, '1024');
    assertEquals(many[7].description, `Showing the first 7 · 16${T}382 usable hosts each`);
    const small = networkAnswers('192.168.1.0/24 into /31');
    assertEquals(small[7].id, 'more');
    assertEquals(small[0].description, 'Subnet 1 of 128 · 192.168.1.0 – 192.168.1.1');
    assertEquals(networkAnswers('192.168.1.0/30 into /32')[0].description, 'Subnet 1 of 4 · 192.168.1.0');
    assertEquals(ids('192.168.1.0/24 into /24'), []);
    assertEquals(ids('192.168.1.0/24 into /16'), []);
    assertEquals(ids('192.168.1.0/24 into /33'), []);
    // Top of the address space does not overflow.
    assertEquals(networkAnswers('255.255.255.0/24 into /26')[3].title, '255.255.255.192/26');
});

test('bare IPv4 address', () => {
    assertEquals(rows('192.168.1.10'), [
        ['type', 'Private address', '192.168.0.0/16 · RFC 1918'],
        ['int', '3232235786', 'Integer'],
        ['hex', '0xC0A8010A', 'Hexadecimal'],
        ['binary', '11000000.10101000.00000001.00001010', 'Binary'],
        ['ptr', '10.1.168.192.in-addr.arpa', 'Reverse DNS name'],
    ]);
    assertEquals(byId('192.168.1.10', 'type').copy, '192.168.1.10');
    const kind = {
        '8.8.8.8': ['Public address', 'IPv4'],
        '10.1.2.3': ['Private address', '10.0.0.0/8 · RFC 1918'],
        '172.16.0.1': ['Private address', '172.16.0.0/12 · RFC 1918'],
        '172.32.0.1': ['Public address', 'IPv4'],
        '127.0.0.1': ['Loopback address', '127.0.0.0/8 · RFC 1122'],
        '169.254.1.1': ['Link-local address', '169.254.0.0/16 · RFC 3927'],
        '100.64.0.1': ['Carrier-grade NAT address', '100.64.0.0/10 · RFC 6598'],
        '100.128.0.1': ['Public address', 'IPv4'],
        '224.0.0.251': ['Multicast address', '224.0.0.0/4 · RFC 5771'],
        '192.0.2.1': ['Documentation address', '192.0.2.0/24 · RFC 5737'],
        '198.51.100.7': ['Documentation address', '198.51.100.0/24 · RFC 5737'],
        '203.0.113.9': ['Documentation address', '203.0.113.0/24 · RFC 5737'],
        '255.255.255.255': ['Broadcast address', '255.255.255.255/32 · RFC 919'],
        '240.0.0.1': ['Reserved address', '240.0.0.0/4 · RFC 1112'],
        '0.0.0.0': ['Reserved address', '0.0.0.0/8 · RFC 1122'],
        '224.0.0.0': ['Multicast address', '224.0.0.0/4 · RFC 5771'],
        '240.0.0.0': ['Reserved address', '240.0.0.0/4 · RFC 1112'],
        '254.0.0.0': ['Reserved address', '240.0.0.0/4 · RFC 1112'],
        '192.0.0.0': ['Reserved address', '192.0.0.0/24 · RFC 6890'],
        '128.0.0.0': ['Public address', 'IPv4'],
    };
    for (const [ip, [t, d]] of Object.entries(kind)) {
        const a = byId(ip, 'type');
        assert(a, ip);
        assertEquals([a.title, a.description], [t, d], ip);
    }
    assertEquals(ids('224.0.0.0'), ['type', 'int', 'hex', 'binary', 'ptr']);
    assertEquals(byId('0.0.0.0', 'int').title, '0');
    assertEquals(byId('0.0.0.0', 'hex').title, '0x00000000');
    assertEquals(byId('255.255.255.255', 'int').title, '4294967295');
    assertEquals(byId('255.255.255.255', 'ptr').title, '255.255.255.255.in-addr.arpa');
});

test('containment', () => {
    const a = networkAnswers('is 10.1.2.3 in 10.0.0.0/8');
    assertEquals(a.length, 1);
    assertEquals([a[0].id, a[0].title, a[0].copy, a[0].description],
        ['contains', 'Yes', 'Yes', '10.1.2.3 is inside 10.0.0.0/8']);
    assertEquals(byId('10.1.2.3 in 10.0.0.0/8', 'contains').title, 'Yes');
    const no = byId('is 11.1.2.3 in 10.0.0.0/8', 'contains');
    assertEquals([no.title, no.description], ['No', '11.1.2.3 is outside 10.0.0.0/8']);
    assertEquals(byId('10.0.0.0 in 10.0.0.0/32', 'contains').title, 'Yes');
    assertEquals(byId('10.0.0.1 in 10.0.0.0/32', 'contains').title, 'No');
    assertEquals(byId('1.2.3.4 in 0.0.0.0/0', 'contains').title, 'Yes');
    assertEquals(byId('is 2001:db8::5 in 2001:db8::/32', 'contains').title, 'Yes');
    assertEquals(byId('2001:db9::5 in 2001:db8::/32', 'contains').title, 'No');
    assertEquals(ids('1.2.3.4 in 5.6.7'), []);
    assertEquals(ids('1.2.3.4 in 2001:db8::/32'), []);
});

test('ipv6 network', () => {
    const r = networkAnswers('2001:db8::/48');
    assertEquals(r.map(a => [a.id, a.title, a.description]), [
        ['network', '2001:db8::/48', 'Network'],
        ['first', '2001:db8::', 'First address'],
        ['last', '2001:db8:0:ffff:ffff:ffff:ffff:ffff', 'Last address'],
        ['addresses', '2^80', 'Addresses (about 1.2 × 10^24)'],
        ['expanded', '2001:0db8:0000:0000:0000:0000:0000:0000', 'Expanded'],
    ]);
    assertEquals(r[3].copy, '1208925819614629174706176');
    assertEquals(rows('fe80::1/64').slice(0, 3), [['network', 'fe80::/64', 'Network'],
        ['first', 'fe80::', 'First address'], ['last', 'fe80::ffff:ffff:ffff:ffff', 'Last address']]);
    assertEquals(byId('fe80::1/64', 'addresses').title, '2^64');
    assertEquals(byId('fe80::1/64', 'addresses').description, 'Addresses (about 1.8 × 10^19)');
    assertEquals(byId('2001:db8::/120', 'addresses').title, '256');
    assertEquals(byId('2001:db8::/120', 'addresses').description, 'Addresses');
    assertEquals(byId('2001:db8::/128', 'addresses').title, '1');
    assertEquals(byId('2001:db8::1/128', 'last').title, '2001:db8::1');
    assertEquals(byId('2001:db8::/76', 'addresses').title, `4${T}503${T}599${T}627${T}370${T}496`);
    assertEquals(byId('2001:db8::/75', 'addresses').title, '2^53');
    assertEquals(byId('::/0', 'last').title, 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff');
    assertEquals(byId('::/0', 'addresses').description, 'Addresses (about 3.4 × 10^38)');
    assertEquals(byId('2001:DB8:0:0:0:0:0:0/32', 'network').title, '2001:db8::/32');
    assertEquals(ids('2001:db8::/129'), []);
    assertEquals(ids('2001:db8::/'), []);
});

test('ipv6 addresses', () => {
    const r = networkAnswers('2001:db8::1');
    assertEquals(r.map(a => a.id), ['type', 'compressed', 'expanded', 'ptr']);
    assertEquals(r[0].title, 'Documentation address');
    assertEquals(r[0].description, '2001:db8::/32 · RFC 3849');
    assertEquals(r[1].title, '2001:db8::1');
    assertEquals(r[2].title, '2001:0db8:0000:0000:0000:0000:0000:0001');
    assertEquals(r[3].title, '1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa');
    const types = {
        '::1': 'Loopback address', 'fe80::1': 'Link-local address', 'fd12:3456::1': 'Unique local address',
        'fc00::1': 'Unique local address', 'ff02::1': 'Multicast address', '2606:4700::1111': 'Global unicast address',
        '::0': 'Unspecified address', '::ffff:192.0.2.1': 'IPv4-mapped address', '1::1': 'Reserved address',
        '2001:DB8::ABCD': 'Documentation address',
    };
    for (const [ip, t] of Object.entries(types))
        assertEquals(byId(ip, 'type').title, t, ip);
    assertEquals(byId('::ffff:192.0.2.1', 'compressed').title, '::ffff:c000:201');
    assertEquals(byId('::1', 'ptr').title, `1.${'0.'.repeat(31)}ip6.arpa`);
    assertEquals(byId('fe80::1', 'type').description, 'fe80::/10 · RFC 4291');
    assertEquals(byId('FE80:0:0:0:0:0:0:1', 'compressed').title, 'fe80::1');
});

test('mac addresses', () => {
    assertEquals(rows('aa:bb:cc:dd:ee:ff'), [['dash', 'AA-BB-CC-DD-EE-FF', 'Hyphen format'],
        ['cisco', 'aabb.ccdd.eeff', 'Cisco format'], ['kind', 'Locally administered, unicast', 'Address type']]);
    assertEquals(rows('AA-BB-CC-DD-EE-FF').map(r => r[0]), ['colon', 'cisco', 'kind']);
    assertEquals(rows('aabb.ccdd.eeff').map(r => r[0]), ['colon', 'dash', 'kind']);
    assertEquals(byId('AA-BB-CC-DD-EE-FF', 'colon').title, 'aa:bb:cc:dd:ee:ff');
    assertEquals(byId('aabb.ccdd.eeff', 'dash').title, 'AA-BB-CC-DD-EE-FF');
    assertEquals(byId('AA:BB:CC:DD:EE:FF', 'colon').title, 'aa:bb:cc:dd:ee:ff');
    assertEquals(byId('00:1a:2b:3c:4d:5e', 'kind').title, 'Globally unique, unicast');
    assertEquals(byId('01:00:5e:00:00:fb', 'kind').title, 'Globally unique, multicast');
    assertEquals(byId('02:42:ac:11:00:02', 'kind').title, 'Locally administered, unicast');
    assertEquals(byId('03:00:00:00:00:01', 'kind').title, 'Locally administered, multicast');
    assertEquals(byId('ff:ff:ff:ff:ff:ff', 'kind').title, 'Broadcast');
    assertEquals(ids('aa:bb:cc:dd:ee'), []);
    assertEquals(ids('aa:bb-cc:dd-ee:ff'), []);
    assertEquals(ids('aa:bb:cc:dd:ee:gg'), []);
    assertEquals(ids('aa:bb:cc:dd:ee:ff:00'), []);
});

test('false positives', () => {
    for (const q of ['1.2.3', '1.2.3.4.5', '256.1.1.1', '192.168.1.0/33', '192.168.1.0/', '/33', '/', '10', '3.14',
        '1.5.2', 'v1.2.3.4', '24', 'cidr', 'mask', 'netmask', '::', ':', 'a:b', '12:30', '15:30', 'aa:bb', 'firefox',
        '2001:db8::/129', 'time in tokyo', 'http://192.168.1.1/admin', '192.168.1.1:8080', 'term', 'settings',
        'files', 'gnome text editor', '2048', 'steam', 'c', 'calc', 'prefix', 'cidr 33', '/99', '01.2.3.4',
        '1.2.3.04', 'org.gnome.Nautilus', 'gnome-terminal', 'a.b.c.d', '', '  ', 'x'.repeat(300), '10.0.0.0/8/9',
        '1.1.1.1/-1', '1:2:3:4:5:6:7:8:9', '12345::1', '1::2::3', 'mask 24', 'is 1.2.3.4 in', '192.168.1.0/24 into',
        'ftp://[::1]:21/'])
        assertEquals(ids(q), [], q);
});

test('never throws', () => {
    for (const q of ['/\u0000', ':::::::', '....', '1.2.3.4/1.2.3.4', 'fe80::/0x', ' ::1', '-', 'cidr -1'])
        assert(Array.isArray(networkAnswers(q)));
});

run();

import {hasWifi, netAnswers, netQuery, parseNmObjects} from '../build/search/answers/netinfo.js';
import {assert, assertEquals, run, test} from './harness.js';

const DEV = 'org.freedesktop.NetworkManager.Device';
const IP4 = 'org.freedesktop.NetworkManager.IP4Config';
const IP6 = 'org.freedesktop.NetworkManager.IP6Config';

// What GetManagedObjects returns once unpacked, cut down to what is read.
const objects = {
    '/org/freedesktop/NetworkManager/Devices/1': {[DEV]: {Interface: 'lo', DeviceType: 32, State: 100, HwAddress: '00:00:00:00:00:00', Ip4Config: '/ip4/1', Ip6Config: '/'}},
    '/org/freedesktop/NetworkManager/Devices/3': {[DEV]: {Interface: 'wlp3s0', DeviceType: 2, State: 30, HwAddress: 'AA:BB:CC:00:11:22', Ip4Config: '/', Ip6Config: '/'}},
    '/org/freedesktop/NetworkManager/Devices/2': {[DEV]: {Interface: 'enp5s0', DeviceType: 1, State: 100, HwAddress: 'D8:BB:C1:00:00:01', Ip4Config: '/ip4/2', Ip6Config: '/ip6/2'}},
    '/org/freedesktop/NetworkManager/Devices/4': {[DEV]: {Interface: 'virbr0', DeviceType: 13, State: 100, HwAddress: '52:54:00:00:00:02', Ip4Config: '/ip4/4', Ip6Config: '/'}},
    '/ip4/1': {[IP4]: {AddressData: [{address: '127.0.0.1', prefix: 8}], Gateway: ''}},
    '/ip4/2': {[IP4]: {AddressData: [{address: '192.168.1.23', prefix: 24}], Gateway: '192.168.1.1', NameserverData: [{address: '192.168.1.2'}, {address: '9.9.9.9'}]}},
    '/ip6/2': {[IP6]: {AddressData: [{address: 'fe80::dabb:c1ff:fe00:1', prefix: 64}, {address: '2001:db8:1::23', prefix: 64}], Gateway: 'fe80::1'}},
    '/ip4/4': {[IP4]: {AddressData: [{address: '192.168.122.1', prefix: 24}], Gateway: ''}},
    '/org/freedesktop/NetworkManager/Settings/1': {'org.freedesktop.NetworkManager.Settings.Connection': {Filename: 'x'}},
};
const devices = parseNmObjects(objects);
const titles = a => a.map(x => x.title);

test('queries', () => {
    assertEquals(netQuery('my ip'), {kind: 'ip', score: 1000});
    assertEquals(netQuery('My IP address'), {kind: 'ip', score: 1000});
    assertEquals(netQuery('what is my ip?'), {kind: 'ip', score: 1000});
    assertEquals(netQuery('ip'), {kind: 'ip', score: 840});
    assertEquals(netQuery('mac address'), {kind: 'mac', score: 900});
    assertEquals(netQuery('hostname'), {kind: 'hostname', score: 840});
    assertEquals(netQuery('default  gateway'), {kind: 'gateway', score: 1000});
    assertEquals(netQuery('dns servers'), {kind: 'dns', score: 900});
});

test('ordinary text is not a network query', () => {
    for (const q of ['', 'i', 'ipython', 'ip a', 'mac', 'macros', 'host', 'my', 'my i', 'firefox', 'dnsmasq', 'gateways', 'my ip address please and more text'])
        assertEquals(netQuery(q), null, q);
});

test('devices: loopback skipped, the connected one with a gateway first', () => {
    assertEquals(devices.map(d => d.iface), ['enp5s0', 'virbr0', 'wlp3s0']);
    assertEquals(devices[0].kind, 'Ethernet');
    assertEquals(devices[0].mac, 'd8:bb:c1:00:00:01');
    assertEquals(devices[0].ipv4, [{address: '192.168.1.23', prefix: 24}]);
    assertEquals(devices[0].dns, ['192.168.1.2', '9.9.9.9']);
    assert(hasWifi(devices));
    assert(!hasWifi(devices.filter(d => d.iface !== 'wlp3s0')));
});

test('my ip: addresses of connected devices, no link-local IPv6, then the gateway', () => {
    const a = netAnswers('ip', devices, 'fedora', 1000);
    assertEquals(titles(a), ['192.168.1.23', '192.168.122.1', '2001:db8:1::23', '192.168.1.1']);
    assertEquals(a[0].description, 'Local IPv4 address · Ethernet (enp5s0) · /24');
    assertEquals(a[0].copy, '192.168.1.23');
    assertEquals(a[2].description, 'Local IPv6 address · Ethernet (enp5s0) · /64');
    assertEquals(a[3].description, 'Default gateway · Ethernet (enp5s0)');
    assert(a.every(x => x.score === 1000));
    assertEquals(new Set(a.map(x => x.id)).size, a.length);
});

test('mac, gateway, dns, hostname', () => {
    assertEquals(titles(netAnswers('mac', devices, 'fedora', 900)), ['d8:bb:c1:00:00:01', '52:54:00:00:00:02', 'aa:bb:cc:00:11:22']);
    assertEquals(titles(netAnswers('gateway', devices, 'fedora', 900)), ['192.168.1.1', 'fe80::1']);
    assertEquals(titles(netAnswers('dns', devices, 'fedora', 900)), ['192.168.1.2', '9.9.9.9']);
    const h = netAnswers('hostname', [], 'fedora', 900);
    assertEquals(titles(h), ['fedora']);
    assertEquals(h[0].description, 'Name of this computer');
});

test('offline: one row that says so and copies nothing', () => {
    const a = netAnswers('ip', [], 'fedora', 1000);
    assertEquals(titles(a), ['Not connected to a network']);
    assertEquals(a[0].copy, '');
    assertEquals(titles(netAnswers('ip', devices.filter(d => !d.connected), 'fedora', 1000)), ['Not connected to a network']);
});

test('the limit and broken input', () => {
    assertEquals(netAnswers('ip', devices, 'fedora', 1000, 2).length, 2);
    assertEquals(parseNmObjects(null), []);
    assertEquals(parseNmObjects('x'), []);
    assertEquals(parseNmObjects({'/a': {[DEV]: {Interface: 'eth0', DeviceType: 1, State: 100, Ip4Config: '/missing'}}})[0].ipv4, []);
    assertEquals(parseNmObjects({'/a': {[DEV]: {Interface: 'eth0', DeviceType: 1, State: 100, Ip4Config: '/b'}}, '/b': {[IP4]: {AddressData: [{address: 5}, null, 'x']}}})[0].ipv4, []);
});

run();

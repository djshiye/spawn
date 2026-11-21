// Stand-in for the two services the quick settings switches and "my ip" talk to, for the headless test shell
// (tools/dev/scenarios/search-answers.sh), where neither NetworkManager nor gnome-settings-daemon runs:
//   session bus  org.gnome.SettingsDaemon.Rfkill   AirplaneMode / BluetoothAirplaneMode (read-write) and their Has* flags
//   system bus   org.freedesktop.NetworkManager    WirelessEnabled (read-write), WirelessHardwareEnabled, and an
//                ObjectManager at /org/freedesktop with one Ethernet and one Wi-Fi device
// Every property write is appended to the log file given as the first argument ("set <Property> <value>").
// Run with: gjs -m tools/dev/net-standin/service.js <log file>     (ends when its process is killed)
/* global ARGV, TextEncoder */
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const logFile = ARGV[0];

function record(line) {
    const stream = Gio.File.new_for_path(logFile).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(new TextEncoder().encode(`${line}\n`), null);
    stream.close(null);
}

function flag(state, name) {
    Object.defineProperty(state, name, {
        get() {
            return state[`_${name}`];
        },
        set(v) {
            state[`_${name}`] = v;
            record(`set ${name} ${v}`);
        },
    });
}

const rfkill = {_AirplaneMode: false, _BluetoothAirplaneMode: false, HasAirplaneMode: true, BluetoothHasAirplaneMode: true};
flag(rfkill, 'AirplaneMode');
flag(rfkill, 'BluetoothAirplaneMode');
const RFKILL_XML = `<node><interface name="org.gnome.SettingsDaemon.Rfkill">
  <property name="AirplaneMode" type="b" access="readwrite"/>
  <property name="HasAirplaneMode" type="b" access="read"/>
  <property name="BluetoothAirplaneMode" type="b" access="readwrite"/>
  <property name="BluetoothHasAirplaneMode" type="b" access="read"/>
</interface></node>`;

const nm = {_WirelessEnabled: true, WirelessHardwareEnabled: true};
flag(nm, 'WirelessEnabled');
const NM_XML = `<node><interface name="org.freedesktop.NetworkManager">
  <property name="WirelessEnabled" type="b" access="readwrite"/>
  <property name="WirelessHardwareEnabled" type="b" access="read"/>
</interface></node>`;

const v = (type, value) => new GLib.Variant(type, value);
const DEV = 'org.freedesktop.NetworkManager.Device';
const objects = {
    '/org/freedesktop/NetworkManager/Devices/1': {[DEV]: {
        Interface: v('s', 'lo'), DeviceType: v('u', 32), State: v('u', 100), HwAddress: v('s', '00:00:00:00:00:00'),
        Ip4Config: v('o', '/'), Ip6Config: v('o', '/'),
    }},
    '/org/freedesktop/NetworkManager/Devices/2': {[DEV]: {
        Interface: v('s', 'enp5s0'), DeviceType: v('u', 1), State: v('u', 100), HwAddress: v('s', 'D8:BB:C1:00:00:01'),
        Ip4Config: v('o', '/org/freedesktop/NetworkManager/IP4Config/2'), Ip6Config: v('o', '/org/freedesktop/NetworkManager/IP6Config/2'),
    }},
    '/org/freedesktop/NetworkManager/Devices/3': {[DEV]: {
        Interface: v('s', 'wlp3s0'), DeviceType: v('u', 2), State: v('u', 30), HwAddress: v('s', 'AA:BB:CC:00:11:22'),
        Ip4Config: v('o', '/'), Ip6Config: v('o', '/'),
    }},
    '/org/freedesktop/NetworkManager/IP4Config/2': {'org.freedesktop.NetworkManager.IP4Config': {
        AddressData: v('aa{sv}', [{address: v('s', '192.168.1.23'), prefix: v('u', 24)}]),
        Gateway: v('s', '192.168.1.1'),
        NameserverData: v('aa{sv}', [{address: v('s', '192.168.1.2')}]),
    }},
    '/org/freedesktop/NetworkManager/IP6Config/2': {'org.freedesktop.NetworkManager.IP6Config': {
        AddressData: v('aa{sv}', [{address: v('s', 'fe80::dabb:c1ff:fe00:1'), prefix: v('u', 64)}, {address: v('s', '2001:db8:1::23'), prefix: v('u', 64)}]),
        Gateway: v('s', 'fe80::1'),
    }},
};
const manager = {
    GetManagedObjects() {
        return v('(a{oa{sa{sv}}})', [objects]);
    },
};
const MANAGER_XML = `<node><interface name="org.freedesktop.DBus.ObjectManager">
  <method name="GetManagedObjects"><arg type="a{oa{sa{sv}}}" direction="out"/></method>
</interface></node>`;

const kept = [];

function own(busType, name, exports) {
    Gio.bus_own_name(busType, name, Gio.BusNameOwnerFlags.NONE, connection => {
        for (const [path, xml, impl] of exports) {
            const exported = Gio.DBusExportedObject.wrapJSObject(xml, impl);
            exported.export(connection, path);
            kept.push(exported); // an exported object that nothing references is collected, and its path goes with it
        }
    }, () => record(`ready ${name}`), () => record(`lost ${name}`));
}

own(Gio.BusType.SESSION, 'org.gnome.SettingsDaemon.Rfkill', [['/org/gnome/SettingsDaemon/Rfkill', RFKILL_XML, rfkill]]);
own(Gio.BusType.SYSTEM, 'org.freedesktop.NetworkManager', [
    ['/org/freedesktop/NetworkManager', NM_XML, nm],
    ['/org/freedesktop', MANAGER_XML, manager],
]);
new GLib.MainLoop(null, false).run();

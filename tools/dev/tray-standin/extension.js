// Dev sandbox only (tools/dev-shell-inner.sh installs it for scenarios marked "# uses: tray-standin").
// Two status-area icons whose click handling is a copy of the AppIndicator extension's
// (ubuntu/gnome-shell-extension-appindicator, indicatorStatusIcon.js), so the sandbox can check that a click
// passed on by Spawn reaches tray icons the way a real click does:
//   spawn-test-appindicator  IndicatorStatusIcon: click gesture OFF, vfunc_button_press_event: right = menu,
//                            middle = secondary activate, left = menu after the double-click time
//   spawn-test-legacytray    IndicatorTrayIcon (XEmbed): no menu, clicks the app on button RELEASE
// Every action is appended to $XDG_RUNTIME_DIR/spawn-tray-standin.log ("appindicator-menu-open", ...).
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const LOG = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'spawn-tray-standin.log']);

function note(line) {
    const stream = Gio.File.new_for_path(LOG).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(`${line}\n`, null);
    stream.close(null);
}

const FakeAppIndicator = GObject.registerClass(
class FakeAppIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Fake AppIndicator');
        this._clickGesture?.set_enabled(false);
        this.add_style_class_name('spawn-test-appindicator');
        this.add_child(new St.Icon({icon_name: 'face-smile-symbolic', style_class: 'system-status-icon'}));
        this.menu.addMenuItem(new PopupMenu.PopupMenuItem('Fake tray menu item'));
        this.menu.connect('open-state-changed', (_m, open) => note(`appindicator-menu-${open ? 'open' : 'closed'}`));
    }

    vfunc_event(event) {
        if (this.menu.numMenuItems && event.type() === Clutter.EventType.TOUCH_BEGIN)
            this.menu.toggle();
        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_button_press_event(event) {
        if (event.get_button() === Clutter.BUTTON_MIDDLE) {
            note('appindicator-secondary-activate');
            return Clutter.EVENT_STOP;
        }
        if (event.get_button() === Clutter.BUTTON_SECONDARY) {
            this.menu.toggle();
            return Clutter.EVENT_PROPAGATE;
        }
        if (event.get_button() === Clutter.BUTTON_PRIMARY && this.menu.numMenuItems) {
            // The real icon waits out the double-click time before it opens the menu on a single click.
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                this.menu.toggle();
                return GLib.SOURCE_REMOVE;
            });
        }
        return Clutter.EVENT_PROPAGATE;
    }
});

const FakeLegacyTray = GObject.registerClass(
class FakeLegacyTray extends PanelMenu.Button {
    _init() {
        super._init(0.5, 'Fake legacy tray icon', true);
        this.add_style_class_name('spawn-test-legacytray');
        this.add_child(new St.Icon({icon_name: 'face-cool-symbolic', style_class: 'system-status-icon'}));
        this.connect('button-press-event', (_a, event) => {
            note(`legacytray-press-${event.get_button()}`);
            this.add_style_pseudo_class('active');
            return Clutter.EVENT_PROPAGATE;
        });
        this.connect('button-release-event', (_a, event) => {
            note(`legacytray-click-${event.get_button()}`);
            this.remove_style_pseudo_class('active');
            return Clutter.EVENT_PROPAGATE;
        });
    }
});

export default class TrayStandin extends Extension {
    enable() {
        this._icons = [new FakeAppIndicator(), new FakeLegacyTray()];
        Main.panel.addToStatusArea('spawn-test-appindicator', this._icons[0], 0, 'right');
        Main.panel.addToStatusArea('spawn-test-legacytray', this._icons[1], 1, 'right');
    }

    disable() {
        this._icons?.forEach(i => i.destroy());
        this._icons = null;
    }
}

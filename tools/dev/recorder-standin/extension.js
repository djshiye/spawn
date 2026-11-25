// Dev sandbox only (tools/dev-shell-inner.sh installs it for scenarios marked "# uses: recorder-standin").
// The sandbox cannot record the screen (no PipeWire), so this shows GNOME's REAL screen recording stop button
// (Main.panel.statusArea.screenRecording, a PanelMenu.ButtonBox with its own click gesture, ui/status/remoteAccess.js)
// as if a recording were running, and stands in only for what stopping does:
//   screen-recording-indicator  the shell's own button; Main.screenshotUI.stopScreencast() is replaced by a stub
//                               that notes "recorder-stop" and hides the button, like the end of a real recording
//   spawn-test-boxindicator     an extension-style indicator without a menu (a PanelMenu.ButtonBox) that reads raw
//                               presses itself: notes "box-press-<button>"
// Every action is appended to $XDG_RUNTIME_DIR/spawn-recorder-standin.log.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

const LOG = GLib.build_filenamev([GLib.get_user_runtime_dir(), 'spawn-recorder-standin.log']);

function note(line) {
    const stream = Gio.File.new_for_path(LOG).append_to(Gio.FileCreateFlags.NONE, null);
    stream.write_all(`${line}\n`, null);
    stream.close(null);
}

const FakeBoxIndicator = GObject.registerClass(
class FakeBoxIndicator extends PanelMenu.ButtonBox {
    _init() {
        super._init({reactive: true, can_focus: true, track_hover: true});
        this.add_style_class_name('spawn-test-boxindicator');
        this.add_child(new St.Icon({icon_name: 'media-record-symbolic', style_class: 'system-status-icon'}));
        this.connect('button-press-event', (_a, event) => {
            note(`box-press-${event.get_button()}`);
            return Clutter.EVENT_STOP;
        });
    }
});

export default class RecorderStandin extends Extension {
    enable() {
        this._indicator = Main.panel.statusArea['screenRecording'];
        this._stop = Main.screenshotUI.stopScreencast;
        Main.screenshotUI.stopScreencast = () => {
            note('recorder-stop');
            this._indicator?.hide();
        };
        this._indicator?._label?.set_text('0:42');
        this._indicator?.show();
        this._box = new FakeBoxIndicator();
        // addToStatusArea only takes a PanelMenu.Button: put it there the way the shell does for its own ButtonBoxes.
        Main.panel.statusArea['spawn-test-boxindicator'] = this._box;
        Main.panel._rightBox.insert_child_at_index(this._box.container, 0);
    }

    disable() {
        if (this._stop)
            Main.screenshotUI.stopScreencast = this._stop;
        this._stop = null;
        this._indicator?.hide();
        this._indicator = null;
        delete Main.panel.statusArea['spawn-test-boxindicator'];
        this._box?.container.destroy();
        this._box = null;
    }
}

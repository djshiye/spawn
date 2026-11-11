// The shell-side UI of "Restart to Firmware Setup": a GNOME-style confirmation dialog and the failure notification.
// (The shell's own end-session dialog cannot be told to restart into the firmware, hence this one.)
//
// Public API:
//   confirmFirmwareRestart(onConfirm): void       modal "Restart to firmware setup?" with Cancel / Restart; nothing is
//                                                 changed before Restart is pressed
//   notifyFirmwareFailure(error, rolledBack): void error notification; says whether the firmware flag was cleared

import Clutter from 'gi://Clutter';

import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ModalDialog} from 'resource:///org/gnome/shell/ui/modalDialog.js';

export function confirmFirmwareRestart(onConfirm: () => void): void {
    const dialog = new ModalDialog({destroyOnClose: true, styleClass: 'spawn-firmware-dialog'});
    dialog.contentLayout.add_child(new Dialog.MessageDialogContent({
        title: _('Restart to Firmware Setup?'),
        description: _('Your computer will restart into its firmware (UEFI) settings.'),
    }));
    dialog.addButton({label: _('Cancel'), action: () => dialog.close(), key: Clutter.KEY_Escape});
    const restart = dialog.addButton({
        label: _('Restart'),
        action: () => {
            dialog.close();
            onConfirm();
        },
    });
    restart.add_style_class_name('destructive-action');
    dialog.open();
}

export function notifyFirmwareFailure(error: string, rolledBack: boolean): void {
    const tail = rolledBack
        ? _('Nothing was changed.')
        : _('The firmware setup flag could not be cleared; the next restart may open the firmware settings.');
    Main.notifyError(_('Could not restart into firmware setup'), `${error}\n${tail}`);
}

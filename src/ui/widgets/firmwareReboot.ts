// "Restart into firmware setup" (UEFI): the logic, free of gi:// imports so it can be unit-tested with a mock.
//
// systemd-logind (org.freedesktop.login1.Manager) offers CanRebootToFirmwareSetup ("yes" / "challenge" / "no" /
// "na"), SetRebootToFirmwareSetup(b) and Reboot(interactive). The flag lives in the firmware (an EFI variable) and
// outlives this process: if it were set and the restart never happened, the NEXT ordinary restart would drop into
// the firmware menu. So the flag is set only after the user confirmed, and any failure after that unsets it again.
//
// Public API:
//   parseFirmwareSupport(reply: unknown): boolean     "yes" / "challenge" -> true, everything else -> false
//   FirmwareBackend: {setFlag(on): Promise<void>, reboot(): Promise<void>}
//   restartIntoFirmware(backend): Promise<FirmwareResult>
//       sets the flag, then reboots; on failure unsets the flag. Never throws.
//   FirmwareResult: {ok: true} | {ok: false, error: string, rolledBack: boolean}

export function parseFirmwareSupport(reply: unknown): boolean {
    return reply === 'yes' || reply === 'challenge';
}

export interface FirmwareBackend {
    setFlag(on: boolean): Promise<void>;
    reboot(): Promise<void>;
}

export type FirmwareResult = {ok: true} | {ok: false; error: string; rolledBack: boolean};

function describe(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export async function restartIntoFirmware(backend: FirmwareBackend): Promise<FirmwareResult> {
    try {
        await backend.setFlag(true);
    } catch (e) {
        // The call may have failed after taking effect (timeout): unset it as well, best effort.
        const rolledBack = await backend.setFlag(false).then(() => true, () => false);
        return {ok: false, error: describe(e), rolledBack};
    }
    try {
        await backend.reboot();
        return {ok: true};
    } catch (e) {
        const rolledBack = await backend.setFlag(false).then(() => true, () => false);
        return {ok: false, error: describe(e), rolledBack};
    }
}

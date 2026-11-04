// Scope-owned trailing-edge debouncer.
//
// Public API:
//   const d = debounce(scope, ms, fn)
//   d.call()      (re)start the timer; fn runs once, `ms` after the LAST call
//   d.flush()     run fn now if a call is pending
//   d.cancel()    drop a pending call
//   d.pending     boolean
//
// The pending timer is owned by `scope`, so disposing the scope cancels it and fn never
// fires after dispose.

import type {Scope} from './scope.js';

export interface Debounced {
    call(): void;
    flush(): void;
    cancel(): void;
    readonly pending: boolean;
}

export function debounce(scope: Scope, ms: number, fn: () => void): Debounced {
    let cancelTimer: (() => void) | null = null;

    const cancel = () => {
        const c = cancelTimer;
        cancelTimer = null;
        c?.();
    };

    const fire = () => {
        cancelTimer = null;
        fn();
    };

    scope.add(cancel, 'debounce');

    return {
        call() {
            cancel();
            cancelTimer = scope.timeout(ms, fire);
        },
        flush() {
            if (!cancelTimer)
                return;
            cancel();
            fn();
        },
        cancel,
        get pending() {
            return cancelTimer !== null;
        },
    };
}

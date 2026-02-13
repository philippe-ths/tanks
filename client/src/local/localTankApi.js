/**
 * client/src/local/localTankApi.js
 *
 * Browser-side Tank API for local test mode.
 * Identical logic to server/src/runtime/tankApi.js but imports sim
 * modules from shared/sim/ instead of the server tree.
 */

import * as actions from "../../../shared/sim/actions.js";

/**
 * Create the Tank API object for a local player/bot.
 *
 * @param {{ world: Object, slot: string, onLog?: (msg: string) => void }} ctx
 * @returns {Object} the tank API
 */
export function createLocalTankApi(ctx) {
  const { world, slot, onLog } = ctx;

  /** @type {((value?: any) => void) | null} */
  let _pendingResolve = null;
  let _onActionStart = null;

  // ── Timed action helper ──────────────────────────────────

  function timedAction(name, args = [], isScan = false) {
    const accepted = actions[name](world, slot, ...args);
    if (!accepted) {
      return Promise.resolve(isScan ? false : undefined);
    }

    if (_onActionStart) _onActionStart();

    return new Promise((resolve) => {
      _pendingResolve = () => {
        if (isScan) {
          resolve(world.tanks[slot].lastScanResult ?? false);
        } else {
          resolve();
        }
      };
    });
  }

  // ── Public API ───────────────────────────────────────────

  const api = {
    turnLeft(degrees)  { return timedAction("turnLeft", [degrees]); },
    turnRight(degrees) { return timedAction("turnRight", [degrees]); },
    moveForward()  { return timedAction("moveForward"); },
    moveBackward() { return timedAction("moveBackward"); },

    scan(aDeg, bDeg) {
      return timedAction("scan", [aDeg, bDeg], true);
    },

    shoot() {
      return actions.shoot(world, slot);
    },

    log(msg) {
      if (onLog) {
        onLog(String(msg));
      } else {
        console.log(`[${slot}] ${msg}`);
      }
    },

    random() {
      return world.rng();
    },
  };

  // ── Internal accessors (non-enumerable) ──────────────────

  Object.defineProperties(api, {
    _resolvePending: {
      get() { return _pendingResolve; },
      enumerable: false,
    },
    _clearPending: {
      value() { _pendingResolve = null; },
      enumerable: false,
    },
    _hasPending: {
      get() { return _pendingResolve !== null; },
      enumerable: false,
    },
    _onActionStart: {
      set(fn) { _onActionStart = fn; },
      enumerable: false,
    },
  });

  return api;
}

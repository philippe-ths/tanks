/**
 * server/src/runtime/tankApi.js
 *
 * Defines the Tank API object exposed to player code inside `loop(tank)`.
 *
 * ── How timed actions work ───────────────────────────────────────────────
 * Each timed method (turnLeft, turnRight, moveForward, moveBackward, scan)
 * does the following:
 *   1. Calls the corresponding sim action to mark the tank busy and store
 *      the action descriptor on the world state.
 *   2. Returns a Promise that will be resolved externally **when the
 *      action completes in simulation time** (i.e. when `busyUntil` is
 *      reached and `activeAction` is cleared by `applyActiveActions`).
 *
 * The Promise is stored in `tank._pendingResolve` (a callback) so the
 * match orchestration layer can call it at the right simulation tick.
 * For scan actions, the Promise resolves with the boolean scan result
 * stored in `tank.lastScanResult`.
 *
 * ── How shoot() works ────────────────────────────────────────────────────
 * `shoot()` is instant – it calls the sim action synchronously and returns
 * a boolean immediately (no Promise).
 *
 * ── Helper methods ───────────────────────────────────────────────────────
 *   • log(msg)    – appends to a log buffer; the host can display these.
 *   • random()    – returns the next value from the seeded PRNG.
 * ─────────────────────────────────────────────────────────────────────────
 */

import * as actions from "../sim/actions.js";

/**
 * @typedef {Object} TankApiContext
 * @property {import("../sim/world.js").World} world
 *   Reference to the live world state.
 * @property {string} slot
 *   "p1" or "p2" – which tank this API controls.
 * @property {(msg: string) => void} [onLog]
 *   Optional callback invoked when the player calls `tank.log()`.
 */

/**
 * Create the Tank API object that player code interacts with.
 *
 * The returned object is the `tank` parameter passed to
 * `export default async function loop(tank) { … }`.
 *
 * @param {TankApiContext} ctx
 * @returns {Object} the tank API
 */
export function createTankApi(ctx) {
  const { world, slot, onLog } = ctx;

  /**
   * Internal: the resolve callback for the currently pending timed action.
   * Set when a timed action starts; called by the tick-resolution layer
   * when the action completes.  `null` when idle.
   *
   * @type {((value?: any) => void) | null}
   */
  let _pendingResolve = null;

  // ── Timed action helper ──────────────────────────────────────────────

  /**
   * Start a timed action and return a Promise that resolves when the
   * action finishes in sim time.
   *
   * @param {string}   name       – action function name on `actions`
   * @param {any[]}    args       – extra args after (world, slot)
   * @param {boolean}  isScan     – if true, resolve with lastScanResult
   * @returns {Promise<boolean|void>}
   */
  function timedAction(name, args = [], isScan = false) {
    const accepted = actions[name](world, slot, ...args);
    if (!accepted) {
      // Tank was busy – resolve immediately.  This shouldn't normally
      // happen because player code awaits each action sequentially, but
      // handle it gracefully.
      return Promise.resolve(isScan ? false : undefined);
    }

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

  // ── Public API ───────────────────────────────────────────────────────

  const api = {
    // ── Timed actions (each takes 1.0 s of sim time) ───────

    /**
     * Turn the tank counter-clockwise.
     * @param {number} [degrees] – how many degrees to turn (default: full action duration)
     * @returns {Promise<void>}
     */
    turnLeft(degrees) {
      return timedAction("turnLeft", [degrees]);
    },

    /**
     * Turn the tank clockwise.
     * @param {number} [degrees] – how many degrees to turn (default: full action duration)
     * @returns {Promise<void>}
     */
    turnRight(degrees) {
      return timedAction("turnRight", [degrees]);
    },

    /**
     * Move forward along the tank's heading for 1.0 s.
     * @returns {Promise<void>}
     */
    moveForward() {
      return timedAction("moveForward");
    },

    /**
     * Move backward (opposite heading) for 1.0 s.
     * @returns {Promise<void>}
     */
    moveBackward() {
      return timedAction("moveBackward");
    },

    /**
     * Scan an arc for the opponent.  Takes 1.0 s of sim time.
     * Resolves with `true` if the opponent was detected, `false` otherwise.
     *
     * @param {number} aDeg – start angle (relative to heading, CW)
     * @param {number} bDeg – end angle (relative to heading, CW)
     * @returns {Promise<boolean>}
     */
    scan(aDeg, bDeg) {
      return timedAction("scan", [aDeg, bDeg], /* isScan */ true);
    },

    // ── Instant action ─────────────────────────────────────

    /**
     * Fire a projectile in the tank's current heading direction.
     * Only one projectile per tank can exist at a time.
     *
     * @returns {boolean} true if a projectile was spawned
     */
    shoot() {
      return actions.shoot(world, slot);
    },

    // ── Helpers ────────────────────────────────────────────

    /**
     * Send a debug message to the host console / UI.
     * @param {string} msg
     */
    log(msg) {
      if (onLog) {
        onLog(String(msg));
      } else {
        console.log(`[${slot}] ${msg}`);
      }
    },

    /**
     * Return a deterministic random number in [0, 1) from the match PRNG.
     * @returns {number}
     */
    random() {
      return world.rng();
    },
  };

  // ── Internal accessors (not exposed to player code) ──────────────────
  // These are used by the match orchestration / tick-resolution layer.
  // They are non-enumerable so they don't show up if the player
  // inspects the tank object.

  Object.defineProperties(api, {
    /**
     * Resolve the currently pending timed-action Promise.
     * Called by the tick loop when `activeAction` expires.
     */
    _resolvePending: {
      get() {
        return _pendingResolve;
      },
      enumerable: false,
    },

    /**
     * Clear the pending resolve callback (e.g. on match end / forfeit).
     */
    _clearPending: {
      value() {
        _pendingResolve = null;
      },
      enumerable: false,
    },

    /**
     * Check whether there is a pending timed action awaiting resolution.
     */
    _hasPending: {
      get() {
        return _pendingResolve !== null;
      },
      enumerable: false,
    },
  });

  return api;
}

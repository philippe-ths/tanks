/**
 * server/src/runtime/actionResolver.js
 *
 * Bridges simulation-time action completion to Tank API Promises.
 *
 * ── How it works ─────────────────────────────────────────────────────────
 * The sim loop emits `actionComplete` events (via step.js → actions.js)
 * whenever a timed action reaches its `busyUntil` time and expires.
 *
 * This module provides:
 *   • `createActionResolver(tankApis)` – returns a `resolve(events)` fn
 *     that should be called from the sim loop's `onTick` callback.
 *
 * When an `actionComplete` event is seen for slot "p1" or "p2", the
 * resolver calls `_resolvePending` on the matching Tank API object,
 * which fulfils the Promise that the player code is `await`-ing.
 *
 * For `scan` actions the Promise is resolved with the boolean
 * `scanResult` carried by the event.  For all other timed actions the
 * Promise resolves with `undefined`.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Create an action resolver bound to a pair of Tank API objects.
 *
 * @param {{ p1: Object, p2: Object }} tankApis
 *   The Tank API objects created by `createTankApi()` for each slot.
 *   Must expose `_resolvePending` (getter) and `_clearPending` (method).
 * @returns {(events: import("../sim/step.js").StepEvent[]) => void}
 *   Call this with the events array returned by `step()` on every tick.
 */
export function createActionResolver(tankApis) {
  /**
   * Scan the tick's events for `actionComplete` and resolve the
   * corresponding Tank API Promise.
   *
   * @param {import("../sim/step.js").StepEvent[]} events
   */
  return function resolveActions(events) {
    for (const evt of events) {
      if (evt.kind !== "actionComplete") continue;

      const api = tankApis[evt.slot];
      if (!api) continue;

      const resolve = api._resolvePending;
      if (typeof resolve !== "function") continue;

      // Clear the stored callback first so _hasPending becomes false
      // before the resolve fires (the player's next await may
      // synchronously start a new action).
      api._clearPending();

      // Resolve the Promise.
      // For scan actions, pass the boolean result; otherwise undefined.
      resolve(evt.actionType === "scan" ? evt.scanResult : undefined);
    }
  };
}

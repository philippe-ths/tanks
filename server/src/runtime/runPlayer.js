/**
 * server/src/runtime/runPlayer.js
 *
 * Loads a player's code string, extracts `tankType` and `loop()`, and
 * runs the loop repeatedly against a Tank API object.
 *
 * ── Execution model (v1) ─────────────────────────────────────────────────
 * Player code runs **in-process** inside a `vm` sandbox for isolation
 * (no access to `require`, `process`, `fs`, etc.).  Each call to
 * `loop(tank)` is guarded by a wall-clock timeout; if the player code
 * hangs (infinite synchronous loop) the timeout fires and the player
 * forfeits.
 *
 * Because player code is inherently async (every timed action must be
 * awaited), cooperative yielding happens naturally.  The only danger is a
 * tight synchronous loop with no `await`, which the timeout catches.
 *
 * ── Future upgrade ───────────────────────────────────────────────────────
 * For stronger isolation (true preemption of infinite loops without
 * blocking the event loop), move player execution into a Worker Thread.
 * This requires a message-passing bridge for Tank API calls.
 * ─────────────────────────────────────────────────────────────────────────
 */

import vm from "node:vm";

// ── Constants ──────────────────────────────────────────────────────────

/** Max wall-clock ms allowed per single `loop()` invocation. */
const LOOP_TIMEOUT_MS = 5_000;

// ── ESM → sandbox transform ───────────────────────────────────────────

/**
 * Convert the player's ESM source into code that assigns exports onto
 * a `__exports` object available in the sandbox context.
 *
 * Handles the expected patterns:
 *   export default async function loop(tank) { … }
 *   export const tankType = "light";
 *   export const config = { … };
 *
 * @param {string} code – raw player source (ESM)
 * @returns {string} transformed source
 */
function transformESM(code) {
  return code
    // export default async function loop …
    .replace(
      /export\s+default\s+async\s+function\s+(\w+)/g,
      "__exports.$1 = async function $1",
    )
    // export default function …  (non-async variant)
    .replace(
      /export\s+default\s+function\s+(\w+)/g,
      "__exports.$1 = function $1",
    )
    // export const foo = …
    .replace(/export\s+const\s+(\w+)\s*=/g, "__exports.$1 =")
    // export let foo = …
    .replace(/export\s+let\s+(\w+)\s*=/g, "__exports.$1 =")
    // bare export default (arrow / expression)
    .replace(/export\s+default\s+/g, "__exports.default = ");
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlayerRuntime
 * @property {string}              tankType  – "light" or "heavy"
 * @property {Promise<void>}       done      – resolves/rejects when loop ends
 * @property {() => void}          stop      – request graceful stop
 * @property {boolean}             running   – whether the loop is active
 * @property {string|null}         error     – error message if crashed
 */

/**
 * Parse a player code string and prepare it for execution.
 * Does NOT start the loop yet — call `runtime.start(tankApi)` for that.
 *
 * @param {string} codeString – raw player source (ESM)
 * @returns {{ tankType: string, loopFn: Function }}
 * @throws if the code has syntax errors or is missing required exports
 */
export function loadPlayerCode(codeString) {
  const __exports = {};

  // Build a minimal sandbox context.
  // Player code can see standard JS globals but nothing Node-specific.
  const sandbox = {
    __exports,
    console: {
      log: () => {},   // silenced; players should use tank.log()
      warn: () => {},
      error: () => {},
    },
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    NaN,
    Infinity,
    undefined,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Promise,
    Symbol,
    RegExp,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    setTimeout: () => {
      throw new Error("setTimeout is not available in tank code");
    },
    setInterval: () => {
      throw new Error("setInterval is not available in tank code");
    },
  };

  vm.createContext(sandbox);

  const transformed = transformESM(codeString);

  try {
    const script = new vm.Script(transformed, {
      filename: "tank.js",
      timeout: 2_000, // compilation + top-level execution limit
    });
    script.runInContext(sandbox);
  } catch (err) {
    throw new Error(`Player code error: ${err.message}`);
  }

  // ── Validate exports ─────────────────────────────────────

  const tankType = __exports.tankType;
  if (tankType !== "light" && tankType !== "heavy") {
    throw new Error(
      `Invalid or missing tankType export (got "${tankType}"). ` +
        'Expected: export const tankType = "light" or "heavy".',
    );
  }

  // Accept either a named `loop` export or `default`
  const loopFn = __exports.loop ?? __exports.default;
  if (typeof loopFn !== "function") {
    throw new Error(
      "Missing loop function. Expected: export default async function loop(tank) { … }",
    );
  }

  return { tankType, loopFn };
}

/**
 * Start running a player's loop against a Tank API.
 *
 * The loop calls `loopFn(tankApi)` repeatedly, awaiting each invocation.
 * Each call is guarded by a wall-clock timeout.
 *
 * @param {Function} loopFn    – the player's loop function
 * @param {Object}   tankApi   – the Tank API object (from createTankApi)
 * @param {Object}   [options]
 * @param {number}   [options.timeoutMs]  – per-loop-call timeout
 * @param {(msg: string) => void} [options.onError]
 *   Called if the player code throws or times out.
 * @returns {PlayerRuntime}
 */
export function startPlayerLoop(loopFn, tankApi, options = {}) {
  const { timeoutMs = LOOP_TIMEOUT_MS, onError } = options;

  let running = true;
  let error = null;

  // Resolve this to signal external stop request
  let stopResolve;
  const stopPromise = new Promise((r) => {
    stopResolve = r;
  });

  /**
   * The main async loop.  Runs until stopped or an error occurs.
   */
  async function run() {
    while (running) {
      // Watchdog timer: resets every time player code starts a new
      // action, so the timeout only fires if the code makes no progress
      // (e.g. infinite synchronous loop without any `await`).
      const watchdog = createWatchdog(timeoutMs);
      tankApi._onActionStart = () => watchdog.reset();

      try {
        const result = await Promise.race([
          loopFn(tankApi),
          watchdog.promise,
          stopPromise,
        ]);

        watchdog.clear();
        tankApi._onActionStart = null;

        // If the stop promise resolved, result is "stopped"
        if (result === "__stopped__") {
          running = false;
          return;
        }

        // If timeout fired, result is "__timeout__"
        if (result === "__timeout__") {
          running = false;
          error = `loop() exceeded wall-clock timeout (${timeoutMs} ms)`;
          if (onError) onError(error);
          return;
        }

        // Otherwise loop() completed normally — call it again.
      } catch (err) {
        watchdog.clear();
        tankApi._onActionStart = null;
        running = false;
        error = `Runtime error: ${err.message}`;
        if (onError) onError(error);
        return;
      }
    }
  }

  const done = run();

  return {
    get running() {
      return running;
    },
    get error() {
      return error;
    },
    done,
    stop() {
      running = false;
      stopResolve("__stopped__");
      // Also clear any pending timed-action Promise so the loop
      // doesn't hang waiting for a sim tick that will never come.
      if (tankApi._clearPending) {
        tankApi._clearPending();
      }
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Create a resettable watchdog timer.
 * Resolves with "__timeout__" if not reset within `ms` milliseconds.
 * Call `reset()` each time the player makes progress (starts a new action).
 * Call `clear()` when the loop() call completes normally.
 */
function createWatchdog(ms) {
  let timer = null;
  let resolve = null;

  const promise = new Promise((r) => {
    resolve = r;
    timer = setTimeout(() => r("__timeout__"), ms);
  });

  return {
    promise,
    reset() {
      clearTimeout(timer);
      timer = setTimeout(() => resolve("__timeout__"), ms);
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

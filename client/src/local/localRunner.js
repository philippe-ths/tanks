/**
 * client/src/local/localRunner.js
 *
 * Browser-side player code loader and runner for local test mode.
 *
 * Uses `new Function()` instead of Node's `vm` module to evaluate
 * player code strings.  No true sandboxing (acceptable for local mode
 * where you're running your own code).
 */

// ── ESM → evaluable transform ─────────────────────────────────────────

/**
 * Convert ESM-style exports to assignments on an `__exports` object.
 *
 * @param {string} code – raw player source (ESM)
 * @returns {string} transformed source
 */
function transformESM(code) {
  return code
    .replace(
      /export\s+default\s+async\s+function\s+(\w+)/g,
      "__exports.$1 = async function $1",
    )
    .replace(
      /export\s+default\s+function\s+(\w+)/g,
      "__exports.$1 = function $1",
    )
    .replace(/export\s+const\s+(\w+)\s*=/g, "__exports.$1 =")
    .replace(/export\s+let\s+(\w+)\s*=/g, "__exports.$1 =")
    .replace(/export\s+default\s+/g, "__exports.default = ");
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Parse a player code string and extract `tankType` and `loopFn`.
 *
 * @param {string} codeString – raw player source (ESM)
 * @returns {{ tankType: string, loopFn: Function }}
 * @throws if the code has errors or missing exports
 */
export function loadPlayerCode(codeString) {
  const __exports = {};
  const transformed = transformESM(codeString);

  try {
    const fn = new Function("__exports", transformed);
    fn(__exports);
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

  const loopFn = __exports.loop ?? __exports.default;
  if (typeof loopFn !== "function") {
    throw new Error(
      "Missing loop function. Expected: export default async function loop(tank) { … }",
    );
  }

  return { tankType, loopFn };
}

/** Max wall-clock ms allowed per single loop() call. */
const LOOP_TIMEOUT_MS = 5_000;

/**
 * Start running a player's loop against a Tank API.
 *
 * @param {Function} loopFn
 * @param {Object}   tankApi
 * @param {Object}   [options]
 * @param {number}   [options.timeoutMs]
 * @param {(msg: string) => void} [options.onError]
 * @returns {{ running: boolean, error: string|null, done: Promise<void>, stop: () => void }}
 */
export function startPlayerLoop(loopFn, tankApi, options = {}) {
  const { timeoutMs = LOOP_TIMEOUT_MS, onError } = options;

  let running = true;
  let error = null;

  let stopResolve;
  const stopPromise = new Promise((r) => {
    stopResolve = r;
  });

  async function run() {
    while (running) {
      // Yield to the browser event loop between iterations so that
      // requestAnimationFrame (sim loop) and rendering can proceed.
      // Without this, rejected actions resolve as microtasks and the
      // while-loop spins without ever yielding, crashing the tab.
      await yieldFrame();
      if (!running) return;

      try {
        const result = await Promise.race([
          loopFn(tankApi),
          timeoutPromise(timeoutMs),
          stopPromise,
        ]);

        if (result === "__stopped__") {
          running = false;
          return;
        }

        if (result === "__timeout__") {
          running = false;
          error = `loop() exceeded wall-clock timeout (${timeoutMs} ms)`;
          if (onError) onError(error);
          return;
        }
      } catch (err) {
        running = false;
        error = `Runtime error: ${err.message}`;
        if (onError) onError(error);
        return;
      }
    }
  }

  const done = run();

  return {
    get running() { return running; },
    get error() { return error; },
    done,
    stop() {
      running = false;
      stopResolve("__stopped__");
      if (tankApi._clearPending) {
        tankApi._clearPending();
      }
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

function timeoutPromise(ms) {
  return new Promise((resolve) => {
    setTimeout(() => resolve("__timeout__"), ms);
  });
}

/**
 * Yield to the browser event loop with minimal delay.
 * Uses setTimeout(0) (~1-4 ms) instead of requestAnimationFrame (~16 ms)
 * so the tank resumes its next action almost immediately while still
 * giving the sim loop and renderer a chance to run.
 */
function yieldFrame() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

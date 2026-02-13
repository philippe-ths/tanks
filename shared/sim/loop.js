/**
 * server/src/sim/loop.js
 *
 * Runs the simulation step loop at the configured tick rate (60 Hz).
 * Provides start/stop control for clean match lifecycle management.
 *
 * Uses a self-correcting timer: each iteration measures elapsed wall-clock
 * time and runs as many fixed-dt steps as needed to stay in sync, avoiding
 * drift from setTimeout jitter.
 */

import { step } from "./step.js";

/**
 * @typedef {Object} SimLoop
 * @property {() => void} stop            - Stop the loop cleanly.
 * @property {boolean}    running         - Whether the loop is currently active.
 */

/**
 * Start the simulation loop.
 *
 * @param {import("./world.js").World} world
 * @param {Object} [options]
 * @param {(events: import("./step.js").StepEvent[]) => void} [options.onTick]
 *   Called after every tick with that tick's events.
 * @param {(events: import("./step.js").StepEvent[]) => void} [options.onMatchEnd]
 *   Called once when matchEnd is detected. The loop stops automatically.
 * @returns {SimLoop}
 */
export function startLoop(world, options = {}) {
  const { onTick, onMatchEnd } = options;
  const tickInterval = 1000 / world.constants.TICK_RATE; // ms per tick

  // Detect environment: use requestAnimationFrame in the browser (~60 fps,
  // naturally matching our 60 Hz tick rate) and setTimeout on the server.
  const inBrowser = typeof requestAnimationFrame === "function";

  let running = true;
  let lastTime = performance.now();
  let accumulator = 0;
  let timer = null;

  /** Schedule the next tick with the appropriate timer. */
  function schedule() {
    if (inBrowser) {
      timer = requestAnimationFrame(tick);
    } else {
      // Server: sleep until the next step is roughly due
      const delay = Math.max(1, tickInterval - accumulator);
      timer = setTimeout(tick, delay);
    }
  }

  /** Cancel a pending scheduled tick. */
  function cancelScheduled() {
    if (timer !== null) {
      if (inBrowser) {
        cancelAnimationFrame(timer);
      } else {
        clearTimeout(timer);
      }
      timer = null;
    }
  }

  function tick() {
    if (!running) return;

    try {
      const now = performance.now();
      accumulator += now - lastTime;
      lastTime = now;

      // Cap accumulated time to prevent spiral-of-death if the process stalls
      const maxAccum = tickInterval * 10;
      if (accumulator > maxAccum) accumulator = maxAccum;

      while (accumulator >= tickInterval && running) {
        const events = step(world);

        if (onTick) onTick(events);

        // Check for match end
        const endEvent = events.find((e) => e.kind === "matchEnd");
        if (endEvent) {
          running = false;
          if (onMatchEnd) onMatchEnd(events);
          return; // stop scheduling
        }

        accumulator -= tickInterval;
      }
    } catch (err) {
      console.error("[sim] tick error:", err);
      running = false;
      if (onMatchEnd) {
        onMatchEnd([{ kind: "matchEnd", winner: null, reason: "error" }]);
      }
      return;
    }

    if (running) {
      schedule();
    }
  }

  // Kick off
  schedule();

  return {
    get running() {
      return running;
    },
    stop() {
      running = false;
      cancelScheduled();
    },
  };
}

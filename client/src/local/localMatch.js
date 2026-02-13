/**
 * client/src/local/localMatch.js
 *
 * Orchestrates a local (no-server) match entirely in the browser.
 *
 * Reuses the same simulation modules (shared/sim/) and a browser-side
 * Tank API + player runner so the game behaves identically to a
 * server-hosted match.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   import { startLocalMatch } from "./local/localMatch.js";
 *
 *   const match = startLocalMatch(playerCodeString, {
 *     onState(snapshot)    { renderer.setState(snapshot); },
 *     onMatchStart(info)   { renderer.setMatchInfo(info); },
 *     onMatchEnd(result)   { … },
 *     onLog(slot, msg)     { console.log(`[${slot}] ${msg}`); },
 *   });
 *
 *   // To abort early:
 *   match.stop();
 * ─────────────────────────────────────────────────────────────────────────
 */

import { createWorld } from "../../../shared/sim/world.js";
import { startLoop } from "../../../shared/sim/loop.js";
import { CONSTANTS } from "../../../shared/constants.js";
import { isInScanArc } from "../../../shared/sim/scan.js";
import { createLocalTankApi } from "./localTankApi.js";
import { loadPlayerCode, startPlayerLoop } from "./localRunner.js";
import { BOT_CODE } from "./bot.js";

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Start a local match: player code (p1) vs built-in bot (p2).
 *
 * @param {string} playerCode – raw ESM source of the player's tank.js
 * @param {Object} callbacks
 * @param {(snapshot: Object) => void} [callbacks.onState]
 *   Called at ~20 Hz with a state snapshot (same shape as server MSG_STATE).
 * @param {(info: Object) => void} [callbacks.onMatchStart]
 *   Called once at match start with tank type metadata.
 * @param {(result: Object) => void} [callbacks.onMatchEnd]
 *   Called once when the match ends with { winner, reason }.
 * @param {(slot: string, msg: string) => void} [callbacks.onLog]
 *   Called when player or bot calls tank.log().
 * @param {(slot: string, msg: string) => void} [callbacks.onError]
 *   Called when a player runtime error occurs.
 * @returns {{ stop: () => void, running: boolean }}
 */
export function startLocalMatch(playerCode, callbacks = {}) {
  const { onState, onMatchStart, onMatchEnd, onLog, onError } = callbacks;

  // ── 1. Load & validate both code strings ─────────────────

  const player = loadPlayerCode(playerCode);
  const bot = loadPlayerCode(BOT_CODE);

  // ── 2. Create world ──────────────────────────────────────

  const seed = Date.now();
  const players = [
    { slot: "p1", tankType: player.tankType },
    { slot: "p2", tankType: bot.tankType },
  ];
  const world = createWorld(seed, CONSTANTS, players);

  // ── 3. Create Tank API objects ───────────────────────────

  const tankApis = {
    p1: createLocalTankApi({
      world,
      slot: "p1",
      onLog: onLog ? (msg) => onLog("p1", msg) : undefined,
    }),
    p2: createLocalTankApi({
      world,
      slot: "p2",
      onLog: onLog ? (msg) => onLog("p2", msg) : undefined,
    }),
  };

  // ── 4. Action resolver (inline) ──────────────────────────
  // Identical to server/src/runtime/actionResolver.js but kept
  // inline to avoid an extra file for a small function.

  function resolveActions(events) {
    for (const evt of events) {
      if (evt.kind !== "actionComplete") continue;

      const api = tankApis[evt.slot];
      if (!api) continue;

      const resolve = api._resolvePending;
      if (typeof resolve !== "function") continue;

      api._clearPending();
      resolve(evt.actionType === "scan" ? evt.scanResult : undefined);
    }
  }

  // ── 5. Notify match start ────────────────────────────────

  if (onMatchStart) {
    onMatchStart({
      seed,
      tanks: {
        p1: { tankType: player.tankType },
        p2: { tankType: bot.tankType },
      },
    });
  }

  // ── 6. Start sim loop ────────────────────────────────────

  let matchRunning = true;

  const ticksPerBroadcast = Math.round(
    CONSTANTS.TICK_RATE / CONSTANTS.STATE_BROADCAST_RATE,
  );
  let tickCount = 0;

  const simLoop = startLoop(world, {
    onTick(events) {
      resolveActions(events);

      // Throttled state callback (~20 Hz)
      tickCount++;
      if (tickCount >= ticksPerBroadcast && onState) {
        tickCount = 0;
        onState(buildSnapshot(world));
      }
    },

    onMatchEnd(events) {
      const endEvent = events.find((e) => e.kind === "matchEnd");
      cleanup(endEvent?.winner ?? null, endEvent?.reason ?? "unknown", null);
    },
  });

  // ── 7. Start player runtimes ─────────────────────────────

  const runtimes = {
    p1: startPlayerLoop(player.loopFn, tankApis.p1, {
      onError(msg) {
        console.error(`[local p1] ${msg}`);
        if (onError) onError("p1", msg);
        if (matchRunning) cleanup("p2", "forfeit", `P1: ${msg}`);
      },
    }),
    p2: startPlayerLoop(bot.loopFn, tankApis.p2, {
      onError(msg) {
        console.error(`[local bot] ${msg}`);
        if (onError) onError("p2", msg);
        if (matchRunning) cleanup("p1", "forfeit", `Bot: ${msg}`);
      },
    }),
  };

  // ── Cleanup ──────────────────────────────────────────────

  function cleanup(winner, reason, detail = null) {
    if (!matchRunning) return;
    matchRunning = false;

    simLoop.stop();
    runtimes.p1.stop();
    runtimes.p2.stop();

    const result = { winner, reason };
    if (detail) result.detail = detail;
    if (onMatchEnd) onMatchEnd(result);
  }

  // ── Return handle ────────────────────────────────────────

  return {
    stop() {
      cleanup(null, "aborted");
    },
    get running() {
      return matchRunning;
    },
  };
}

// ── State snapshot builder ─────────────────────────────────────────────

/**
 * Build a minimal state payload (same shape as server broadcasts).
 *
 * @param {import("../../../shared/sim/world.js").World} w
 * @returns {Object}
 */
function buildSnapshot(w) {
  const tanks = [];
  for (const [slot, t] of Object.entries(w.tanks)) {
    const entry = {
      slot,
      x: t.x,
      y: t.y,
      headingDeg: t.headingDeg,
      hp: t.hp,
      tankType: t.tankType,
    };
    // Include scan arc info so the renderer can visualise it
    if (t.activeAction?.type === "scan") {
      let found = false;
      for (const [oppSlot, opp] of Object.entries(w.tanks)) {
        if (oppSlot === slot) continue;
        if (opp.hp <= 0) continue;
        if (isInScanArc(t, opp, t.activeAction.aDeg, t.activeAction.bDeg, CONSTANTS.SCAN_RANGE)) {
          found = true;
          break;
        }
      }
      entry.scan = { aDeg: t.activeAction.aDeg, bDeg: t.activeAction.bDeg, found };
    }
    tanks.push(entry);
  }

  const projectiles = [];
  for (const p of w.projectiles.values()) {
    projectiles.push({ owner: p.owner, x: p.x, y: p.y });
  }

  return { type: "state", t: w.t, tanks, projectiles };
}

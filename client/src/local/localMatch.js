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
 *   // vs built-in bot (default):
 *   const match = startLocalMatch(playerCodeString, {
 *     onState(snapshot)    { renderer.setState(snapshot); },
 *     onMatchStart(info)   { renderer.setMatchInfo(info); },
 *     onMatchEnd(result)   { … },
 *     onLog(slot, msg)     { console.log(`[${slot}] ${msg}`); },
 *   });
 *
 *   // vs custom opponent bots:
 *   const match = startLocalMatch(playerCodeString, callbacks, {
 *     opponents: [botCode1, botCode2],
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
 * Start a local match: player code (p1) vs one or more opponents.
 *
 * @param {string} playerCode – raw ESM source of the player's tank.js
 * @param {Object} callbacks
 * @param {(snapshot: Object) => void} [callbacks.onState]
 * @param {(info: Object) => void} [callbacks.onMatchStart]
 * @param {(result: Object) => void} [callbacks.onMatchEnd]
 * @param {(slot: string, msg: string) => void} [callbacks.onLog]
 * @param {(slot: string, msg: string) => void} [callbacks.onError]
 * @param {Object} [options]
 * @param {string[]} [options.opponents] – opponent code strings; defaults to [BOT_CODE]
 * @returns {{ stop: () => void, running: boolean }}
 */
export function startLocalMatch(playerCode, callbacks = {}, options = {}) {
  const { onState, onMatchStart, onMatchEnd, onLog, onError } = callbacks;
  const opponentCodes = options.opponents ?? [BOT_CODE];

  // ── 1. Load & validate all code strings ──────────────────

  const loaded = [
    { slot: "p1", ...loadPlayerCode(playerCode) },
  ];

  for (let i = 0; i < opponentCodes.length; i++) {
    const slot = `p${i + 2}`;
    loaded.push({ slot, ...loadPlayerCode(opponentCodes[i]) });
  }

  // ── 2. Create world ──────────────────────────────────────

  const seed = Date.now();
  const players = loaded.map((p) => ({ slot: p.slot, tankType: p.tankType }));
  const world = createWorld(seed, CONSTANTS, players);

  // ── 3. Create Tank API objects ───────────────────────────

  /** @type {Record<string, Object>} */
  const tankApis = {};
  for (const p of loaded) {
    tankApis[p.slot] = createLocalTankApi({
      world,
      slot: p.slot,
      onLog: onLog ? (msg) => onLog(p.slot, msg) : undefined,
    });
  }

  // ── 4. Action resolver (inline) ──────────────────────────

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
    const tanks = {};
    for (const p of loaded) {
      tanks[p.slot] = { tankType: p.tankType };
    }
    onMatchStart({ seed, tanks });
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

  /** @type {Record<string, Object>} */
  const runtimes = {};

  for (const p of loaded) {
    const pSlot = p.slot;
    runtimes[pSlot] = startPlayerLoop(p.loopFn, tankApis[pSlot], {
      onError(msg) {
        console.error(`[local ${pSlot}] ${msg}`);
        if (onError) onError(pSlot, msg);
        // Kill this tank
        world.tanks[pSlot].hp = 0;
        // Check if only one tank remains
        const alive = Object.entries(world.tanks).filter(([, t]) => t.hp > 0);
        if (alive.length <= 1 && matchRunning) {
          const winner = alive.length === 1 ? alive[0][0] : null;
          cleanup(winner, "forfeit", `${pSlot.toUpperCase()}: ${msg}`);
        }
      },
    });
  }

  // ── Cleanup ──────────────────────────────────────────────

  function cleanup(winner, reason, detail = null) {
    if (!matchRunning) return;
    matchRunning = false;

    simLoop.stop();
    for (const r of Object.values(runtimes)) {
      r.stop();
    }

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

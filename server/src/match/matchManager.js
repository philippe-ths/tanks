/**
 * server/src/match/matchManager.js
 *
 * Orchestrates a match: loads player code, creates the world, starts the
 * sim loop and player runtimes, resolves Tank API promises each tick,
 * and handles match-end cleanup.
 *
 * Supports N players (2–MAX_PLAYERS).
 */

import { createWorld } from "../sim/world.js";
import { startLoop } from "../sim/loop.js";
import { isInScanArc } from "../sim/scan.js";
import { createTankApi } from "../runtime/tankApi.js";
import { createActionResolver } from "../runtime/actionResolver.js";
import { loadPlayerCode, startPlayerLoop } from "../runtime/runPlayer.js";
import { getAllSlots } from "../lobby.js";
import { broadcast, send } from "../connectionManager.js";
import { MSG_MATCH_START, MSG_MATCH_END, MSG_STATE, MSG_ERROR } from "../../../shared/protocol.js";
import { CONSTANTS } from "../../../shared/constants.js";

// ── Match state ────────────────────────────────────────────────────────

/** @type {import("../sim/loop.js").SimLoop | null} */
let simLoop = null;

/** @type {Object<string, import("../runtime/runPlayer.js").PlayerRuntime> | null} */
let playerRuntimes = null;

/** @type {import("../sim/world.js").World | null} */
let world = null;

/** Whether a match is currently in progress. */
let matchRunning = false;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Check if a match is currently running.
 * @returns {boolean}
 */
export function isMatchRunning() {
  return matchRunning;
}

/**
 * Attempt to start a match.  At least 2 player slots must have submitted
 * code.  If a match is already running this is a no-op.
 *
 * @param {import("ws").WebSocket} [requester]
 *   Optional — the WebSocket that triggered the start (for error feedback).
 * @returns {boolean} true if a match was started
 */
export function tryStartMatch(requester) {
  if (matchRunning) {
    if (requester) {
      send(requester, { type: MSG_ERROR, message: "A match is already in progress." });
    }
    return false;
  }

  const allSlots = getAllSlots();
  // Gather slots that have submitted code
  const readyEntries = Object.entries(allSlots).filter(([, s]) => s.hasCode && s.code);

  if (readyEntries.length < 2) {
    if (requester) {
      send(requester, { type: MSG_ERROR, message: "At least 2 players must submit code before starting." });
    }
    return false;
  }

  // ── 1. Load & validate player code ───────────────────────

  /** @type {Object<string, { loopFn: Function, tankType: string }>} */
  const playerCodes = {};

  for (const [slotName, slot] of readyEntries) {
    try {
      playerCodes[slotName] = loadPlayerCode(slot.code);
    } catch (err) {
      const msg = `${slotName.toUpperCase()} code error: ${err.message}`;
      console.error(`[match] ${msg}`);
      if (requester) send(requester, { type: MSG_ERROR, message: msg });
      return false;
    }
  }

  // ── 2. Pick seed & create world ──────────────────────────

  const seed = Date.now();
  const players = Object.entries(playerCodes).map(([slotName, code]) => ({
    slot: slotName,
    tankType: code.tankType,
  }));

  world = createWorld(seed, CONSTANTS, players);

  // ── 3. Create Tank API objects ───────────────────────────

  /** @type {Object<string, ReturnType<typeof createTankApi>>} */
  const tankApis = {};
  for (const slotName of Object.keys(playerCodes)) {
    tankApis[slotName] = createTankApi({
      world,
      slot: slotName,
      onLog: (msg) => console.log(`[${slotName}] ${msg}`),
    });
  }

  // ── 4. Wire action resolver ──────────────────────────────

  const resolveActions = createActionResolver(tankApis);

  // ── 5. Start sim loop ────────────────────────────────────

  matchRunning = true;

  const ticksPerBroadcast = Math.round(CONSTANTS.TICK_RATE / CONSTANTS.STATE_BROADCAST_RATE);
  let tickCount = 0;

  simLoop = startLoop(world, {
    onTick(events) {
      resolveActions(events);

      // Stop runtimes for tanks that just died (combat damage).
      // Without this their pending action Promise never resolves
      // and the watchdog fires a 5 s timeout error.
      if (playerRuntimes && world) {
        for (const [s, tank] of Object.entries(world.tanks)) {
          if (tank.hp <= 0 && playerRuntimes[s]?.running) {
            const api = tankApis[s];
            const resolve = api._resolvePending;
            if (resolve) { api._clearPending(); resolve(); }
            playerRuntimes[s].stop();
          }
        }
      }

      tickCount++;
      if (tickCount >= ticksPerBroadcast) {
        tickCount = 0;
        broadcast(buildStateSnapshot(world));
      }
    },

    onMatchEnd(events) {
      const endEvent = events.find((e) => e.kind === "matchEnd");
      endMatch(endEvent?.winner ?? null, endEvent?.reason ?? "unknown", null);
    },
  });

  // ── 6. Start player runtimes ─────────────────────────────

  playerRuntimes = {};
  for (const [slotName, code] of Object.entries(playerCodes)) {
    playerRuntimes[slotName] = startPlayerLoop(code.loopFn, tankApis[slotName], {
      onError: (msg) => {
        console.error(`[match] ${slotName.toUpperCase()} error: ${msg}`);
        broadcast({ type: MSG_ERROR, message: `${slotName.toUpperCase()}: ${msg}`, slot: slotName });
        // Kill this player's tank instead of ending the whole match
        if (world && matchRunning) {
          world.tanks[slotName].hp = 0;
          world.tanks[slotName].activeAction = null;
          if (playerRuntimes && playerRuntimes[slotName]) {
            playerRuntimes[slotName].stop();
          }
        }
      },
    });
  }

  // ── 7. Broadcast matchStart ──────────────────────────────

  const lobbySlots = getAllSlots();
  const tanksInfo = {};
  for (const [slotName, code] of Object.entries(playerCodes)) {
    const ls = lobbySlots[slotName];
    tanksInfo[slotName] = {
      tankType: code.tankType,
      name: ls?.name ?? slotName,
    };
  }

  broadcast({
    type: MSG_MATCH_START,
    seed,
    constants: CONSTANTS,
    tanks: tanksInfo,
  });

  const desc = Object.entries(playerCodes).map(([s, c]) => `${s}=${c.tankType}`).join(", ");
  console.log(`[match] Started — seed=${seed}, ${desc}`);

  return true;
}

/**
 * Forcefully stop the current match (e.g. on disconnect or reset).
 * Broadcasts `matchEnd` with reason "aborted".
 */
export function stopMatch() {
  if (!matchRunning) return;
  endMatch(null, "aborted");
}

// ── Internal ───────────────────────────────────────────────────────────

/**
 * Clean up everything and broadcast matchEnd.
 *
 * @param {string|null} winner
 * @param {string} reason
 */
function endMatch(winner, reason, detail = null) {
  if (!matchRunning) return;
  matchRunning = false;

  console.log(`[match] Ended — winner=${winner ?? "draw"}, reason=${reason}${detail ? ` (${detail})` : ""}`);

  if (simLoop) {
    simLoop.stop();
    simLoop = null;
  }

  if (playerRuntimes) {
    for (const rt of Object.values(playerRuntimes)) {
      rt.stop();
    }
    playerRuntimes = null;
  }

  world = null;

  const payload = { type: MSG_MATCH_END, winner, reason };
  if (detail) payload.detail = detail;
  broadcast(payload);
}

// ── State snapshot ─────────────────────────────────────────────────────

/**
 * Build a minimal state payload for client rendering.
 *
 * @param {import("../sim/world.js").World} w
 * @returns {import("../../../shared/protocol.js").StatePayload}
 */
function buildStateSnapshot(w) {
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
    // Include scan arc info so the client can visualise it
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

  return { type: MSG_STATE, t: w.t, tanks, projectiles };
}

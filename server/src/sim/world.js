/**
 * server/src/sim/world.js
 *
 * Defines the authoritative world state and factory functions.
 */

import { createPRNG } from "./prng.js";

// ── Data shapes (JSDoc) ────────────────────────────────────

/**
 * @typedef {Object} TankState
 * @property {string}      slot             - "p1" or "p2"
 * @property {number}      x
 * @property {number}      y
 * @property {number}      headingDeg       - 0–360, 0 = east, CW positive
 * @property {number}      hp
 * @property {string}      tankType         - "light" or "heavy"
 * @property {number}      busyUntil        - sim time when current action ends (0 if idle)
 * @property {string|null} activeProjectileId
 * @property {Object|null} activeAction     - current timed-action descriptor
 * @property {boolean|null} lastScanResult  - result of the most recent scan (internal; read by runtime)
 */

/**
 * @typedef {Object} Projectile
 * @property {string} id
 * @property {string} owner   - "p1" or "p2"
 * @property {number} x
 * @property {number} y
 * @property {number} vx      - units/sec
 * @property {number} vy      - units/sec
 */

/**
 * @typedef {Object} World
 * @property {number}   t             - current sim time (seconds)
 * @property {number}   seed
 * @property {Object}   constants     - snapshot of CONSTANTS used
 * @property {Function} rng           - seeded PRNG (returns 0–1)
 * @property {Object<string, TankState>} tanks
 * @property {Map<string, Projectile>} projectiles
 * @property {number}   nextProjectileId
 */

// ── Factory ────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Create a fresh world for a new match.
 *
 * @param {number} seed       - PRNG seed
 * @param {Object} constants  - the CONSTANTS object
 * @param {{ slot: string, tankType: string }[]} [players]
 *   Array of player descriptors.  Defaults to two light tanks (p1, p2).
 * @returns {World}
 */
export function createWorld(seed, constants, players) {
  _idCounter = 0;
  const rng = createPRNG(seed);

  if (!players || players.length === 0) {
    players = [
      { slot: "p1", tankType: "light" },
      { slot: "p2", tankType: "light" },
    ];
  }

  const n = players.length;
  const cx = constants.ARENA_WIDTH / 2;
  const cy = constants.ARENA_HEIGHT / 2;
  const radius = Math.min(cx, cy) * 0.55;
  const angleOffset = rng() * Math.PI * 2; // random rotation of spawn ring

  const tanks = {};
  for (let i = 0; i < n; i++) {
    const angle = angleOffset + (2 * Math.PI * i) / n;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    // Face toward the center of the arena
    const headingDeg = ((angle * 180 / Math.PI) + 180) % 360;

    tanks[players[i].slot] = createTank(
      players[i].slot, x, y, headingDeg,
      players[i].tankType, constants,
    );
  }

  /** @type {World} */
  const world = {
    t: 0,
    seed,
    constants,
    rng,
    tanks,
    projectiles: new Map(),
    nextProjectileId: 0,
  };

  return world;
}

/**
 * Reset an existing world back to time 0 with new spawn positions.
 * Re-seeds the PRNG from the stored seed.
 *
 * @param {World} world
 * @returns {World} the same (mutated) world object
 */
export function resetWorld(world) {
  const players = Object.values(world.tanks).map(t => ({
    slot: t.slot,
    tankType: t.tankType,
  }));
  const fresh = createWorld(world.seed, world.constants, players);
  Object.assign(world, fresh);
  return world;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Create a single tank state object.
 *
 * @param {string} slot
 * @param {number} x
 * @param {number} y
 * @param {number} headingDeg
 * @param {string} tankType
 * @param {Object} constants
 * @returns {TankState}
 */
function createTank(slot, x, y, headingDeg, tankType, constants) {
  const stats = constants.TANK_TYPES[tankType];
  return {
    slot,
    x,
    y,
    headingDeg,
    hp: stats.hp,
    tankType,
    busyUntil: 0,
    activeProjectileId: null,
    activeAction: null,
    lastScanResult: null,
  };
}

/**
 * Generate a unique projectile ID.
 * @returns {string}
 */
export function nextProjId() {
  return `proj_${_idCounter++}`;
}

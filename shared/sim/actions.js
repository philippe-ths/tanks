/**
 * server/src/sim/actions.js
 *
 * Timed actions that each take exactly ACTION_DURATION (1.0 s) of sim time.
 *
 * ── Design decision ──────────────────────────────────────────────────────
 * Motion and turning are applied **smoothly** over the duration:
 *   • moveForward / moveBackward – the tank translates at its moveSpeed
 *     (units / sec) every tick for 1.0 s, covering exactly
 *     moveSpeed × 1.0 = moveSpeed units total.
 *   • turnLeft / turnRight – the tank rotates at its turnRate (°/sec) every
 *     tick for 1.0 s, covering turnRate × 1.0 = turnRate degrees total.
 *   • scan(a, b) – the tank is busy for 1.0 s but no pose changes occur.
 *     The actual scan geometry is resolved when the action **completes**
 *     (i.e. when busyUntil is reached). The result is stored in
 *     `tank.lastScanResult` so the calling Promise can read it.
 *
 * Each function:
 *   1. Checks the tank is not busy (`world.t >= tank.busyUntil`).
 *   2. Sets `tank.busyUntil = world.t + ACTION_DURATION`.
 *   3. Stores an `activeAction` descriptor on the tank so that `step()`
 *      can apply per-tick increments via `applyActiveActions(world, dt)`.
 *   4. Returns `true` if the action was accepted, `false` if the tank was
 *      busy.
 *
 * ── activeAction shapes ──────────────────────────────────────────────────
 *   { type: "turnLeft"  }
 *   { type: "turnRight" }
 *   { type: "moveForward"  }
 *   { type: "moveBackward" }
 *   { type: "scan", aDeg: number, bDeg: number }
 * ─────────────────────────────────────────────────────────────────────────
 */

import { isInScanArc } from "./scan.js";
import { nextProjId } from "./world.js";

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Returns true when the tank is idle (can start a new timed action).
 *
 * @param {import("./world.js").TankState} tank
 * @param {number} now  – current world.t
 * @returns {boolean}
 */
function isIdle(tank, now) {
  // Use a small epsilon to tolerate floating-point drift from
  // accumulating many dt increments (60 × 1/60 ≠ exactly 1.0).
  return now >= tank.busyUntil - 1e-9;
}

/**
 * Mark the tank busy and store the action descriptor.
 *
 * @param {import("./world.js").TankState} tank
 * @param {number}  now
 * @param {number}  duration   – ACTION_DURATION from constants
 * @param {Object}  action     – the activeAction descriptor
 */
function beginAction(tank, now, duration, action) {
  tank.busyUntil = now + duration;
  tank.activeAction = action;
}

// ── Public action starters ─────────────────────────────────────────────

/**
 * Start a turnLeft action (counter-clockwise).
 * The tank will rotate by -turnRate °/s for a duration proportional to
 * the requested angle.  If `degrees` is omitted the full ACTION_DURATION
 * is used (producing turnRate × ACTION_DURATION degrees of rotation).
 *
 * @param {import("./world.js").World} world
 * @param {string} slot – "p1" or "p2"
 * @param {number} [degrees] – how many degrees to turn (positive value)
 * @returns {boolean} true if the action was accepted
 */
export function turnLeft(world, slot, degrees) {
  const tank = world.tanks[slot];
  if (!isIdle(tank, world.t)) return false;
  const stats = world.constants.TANK_TYPES[tank.tankType];
  const dur = degrees != null
    ? Math.abs(degrees) / stats.turnRate
    : world.constants.ACTION_DURATION;
  beginAction(tank, world.t, dur, { type: "turnLeft" });
  return true;
}

/**
 * Start a turnRight action (clockwise).
 * The tank will rotate by +turnRate °/s for a duration proportional to
 * the requested angle.  If `degrees` is omitted the full ACTION_DURATION
 * is used.
 *
 * @param {import("./world.js").World} world
 * @param {string} slot
 * @param {number} [degrees] – how many degrees to turn (positive value)
 * @returns {boolean}
 */
export function turnRight(world, slot, degrees) {
  const tank = world.tanks[slot];
  if (!isIdle(tank, world.t)) return false;
  const stats = world.constants.TANK_TYPES[tank.tankType];
  const dur = degrees != null
    ? Math.abs(degrees) / stats.turnRate
    : world.constants.ACTION_DURATION;
  beginAction(tank, world.t, dur, { type: "turnRight" });
  return true;
}

/**
 * Start a moveForward action.
 * The tank translates along its heading at moveSpeed units/s for 1.0 s.
 *
 * @param {import("./world.js").World} world
 * @param {string} slot
 * @returns {boolean}
 */
export function moveForward(world, slot) {
  const tank = world.tanks[slot];
  if (!isIdle(tank, world.t)) return false;
  beginAction(tank, world.t, world.constants.ACTION_DURATION, { type: "moveForward" });
  return true;
}

/**
 * Start a moveBackward action.
 * The tank translates opposite its heading at moveSpeed units/s for 1.0 s.
 *
 * @param {import("./world.js").World} world
 * @param {string} slot
 * @returns {boolean}
 */
export function moveBackward(world, slot) {
  const tank = world.tanks[slot];
  if (!isIdle(tank, world.t)) return false;
  beginAction(tank, world.t, world.constants.ACTION_DURATION, { type: "moveBackward" });
  return true;
}

/**
 * Start a scan action.
 * The tank is busy for 1.0 s. At action completion the scan geometry
 * is evaluated and the result (boolean) is stored on the tank.
 *
 * @param {import("./world.js").World} world
 * @param {string} slot
 * @param {number} aDeg – start angle of the scan arc (relative to heading)
 * @param {number} bDeg – end angle of the scan arc (relative to heading)
 * @returns {boolean} true if the action was accepted
 */
export function scan(world, slot, aDeg, bDeg) {
  const tank = world.tanks[slot];
  if (!isIdle(tank, world.t)) return false;
  beginAction(tank, world.t, world.constants.ACTION_DURATION, {
    type: "scan",
    aDeg,
    bDeg,
  });
  return true;
}

// ── Instant actions ────────────────────────────────────────────────────

/** Degrees → radians */
const DEG2RAD = Math.PI / 180;

/**
 * Shoot: instant action (no busy time).
 *
 * Spawns a new projectile travelling in the tank's current heading
 * direction at PROJECTILE_SPEED.  The tank can only have **one active
 * projectile** at a time — if one already exists the call is a no-op
 * and returns `false`.
 *
 * @param {import("./world.js").World} world
 * @param {string} slot – "p1" or "p2"
 * @returns {boolean} true if a projectile was spawned
 */
export function shoot(world, slot) {
  const tank = world.tanks[slot];

  // ── One-projectile-per-tank limit ────────────────────────
  if (tank.activeProjectileId != null) return false;

  const { PROJECTILE_SPEED, TANK_RADIUS } = world.constants;

  // Spawn projectile just outside the tank's collision circle so it does
  // not immediately collide with the shooter.
  const rad = tank.headingDeg * DEG2RAD;
  const spawnOffset = TANK_RADIUS + world.constants.PROJECTILE_RADIUS + 1;
  const px = tank.x + Math.cos(rad) * spawnOffset;
  const py = tank.y + Math.sin(rad) * spawnOffset;

  const vx = Math.cos(rad) * PROJECTILE_SPEED;
  const vy = Math.sin(rad) * PROJECTILE_SPEED;

  const id = nextProjId();

  /** @type {import("./world.js").Projectile} */
  const proj = { id, owner: slot, x: px, y: py, vx, vy };

  world.projectiles.set(id, proj);
  tank.activeProjectileId = id;

  return true;
}

// ── Per-tick application ───────────────────────────────────────────────

/**
 * Apply smooth per-tick increments for every tank that has an activeAction.
 *
 * Call this once per tick from `step()`, **before** advancing `world.t`.
 *
 * When a timed action expires (world.t + dt >= busyUntil) the
 * `activeAction` is cleared.  For scans the result is resolved here by
 * calling `isInScanArc` and storing the boolean in `tank.lastScanResult`
 * so the runtime/API layer can read it when resolving the Promise.
 *
 * @param {import("./world.js").World} world
 * @param {number} dt – seconds per tick (1/TICK_RATE)
 * @returns {{ slot: string, actionType: string, scanResult?: boolean }[]}
 *   Array of completed action descriptors (empty if nothing completed).
 */
export function applyActiveActions(world, dt) {
  /** @type {{ slot: string, actionType: string, scanResult?: boolean }[]} */
  const completed = [];

  for (const slot of Object.keys(world.tanks)) {
    const tank = world.tanks[slot];
    if (tank.hp <= 0) continue; // dead tanks don't act
    const action = tank.activeAction;
    if (!action) continue;

    const stats = world.constants.TANK_TYPES[tank.tankType];

    switch (action.type) {
      // ── Turning ──────────────────────────────────────────
      // turnRate is in °/sec.  Each tick we add/subtract turnRate * dt.
      case "turnLeft": {
        // Counter-clockwise → subtract from heading
        tank.headingDeg = normalizeDeg(tank.headingDeg - stats.turnRate * dt);
        break;
      }
      case "turnRight": {
        // Clockwise → add to heading
        tank.headingDeg = normalizeDeg(tank.headingDeg + stats.turnRate * dt);
        break;
      }

      // ── Movement ─────────────────────────────────────────
      // Forward = along heading; backward = opposite heading.
      // Heading 0° = east (+x), 90° = south (+y) (screen coords, CW).
      case "moveForward": {
        const rad = tank.headingDeg * DEG2RAD;
        tank.x += Math.cos(rad) * stats.moveSpeed * dt;
        tank.y += Math.sin(rad) * stats.moveSpeed * dt;
        clampToArena(tank, world.constants);
        break;
      }
      case "moveBackward": {
        const rad = tank.headingDeg * DEG2RAD;
        tank.x -= Math.cos(rad) * stats.moveSpeed * dt;
        tank.y -= Math.sin(rad) * stats.moveSpeed * dt;
        clampToArena(tank, world.constants);
        break;
      }

      // ── Scan ─────────────────────────────────────────────
      // No per-tick pose change; the tank simply waits.
      case "scan":
        break;
    }

    // ── Expiration check ─────────────────────────────────
    // Use a small epsilon to avoid floating-point edge cases where
    // world.t + dt is *just barely* less than busyUntil.
    const EPSILON = 1e-9;
    if (world.t + dt >= tank.busyUntil - EPSILON) {
      // ── Resolve scan on completion ───────────────────────
      // Evaluate the scan geometry at the moment the action finishes
      // using the current world state (positions may have changed
      // during the 1.0 s the scan was running).
      if (action.type === "scan") {
        // Check ALL opponents – scan succeeds if ANY is in the arc
        let found = false;
        for (const [oppSlot, opp] of Object.entries(world.tanks)) {
          if (oppSlot === slot) continue;
          if (opp.hp <= 0) continue;
          if (isInScanArc(tank, opp, action.aDeg, action.bDeg, world.constants.SCAN_RANGE)) {
            found = true;
            break;
          }
        }
        tank.lastScanResult = found;
      }

      const desc = { slot, actionType: action.type };
      if (action.type === "scan") {
        desc.scanResult = tank.lastScanResult ?? false;
      }
      completed.push(desc);

      tank.activeAction = null;
      // busyUntil stays as-is so future isIdle checks still work correctly
      // (world.t will be >= busyUntil on the next tick).
    }
  }

  return completed;
}

// ── Geometry helpers ───────────────────────────────────────────────────

/**
 * Normalize an angle into [0, 360).
 * @param {number} deg
 * @returns {number}
 */
function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Clamp tank position so it stays within arena bounds (accounting for
 * TANK_RADIUS so the tank graphic doesn't poke outside).
 *
 * @param {import("./world.js").TankState} tank
 * @param {Object} constants
 */
function clampToArena(tank, constants) {
  const r = constants.TANK_RADIUS;
  if (tank.x < r) tank.x = r;
  if (tank.y < r) tank.y = r;
  if (tank.x > constants.ARENA_WIDTH - r) tank.x = constants.ARENA_WIDTH - r;
  if (tank.y > constants.ARENA_HEIGHT - r) tank.y = constants.ARENA_HEIGHT - r;
}

/**
 * server/src/sim/step.js
 *
 * Advances the simulation by one fixed tick (dt = 1/TICK_RATE).
 *
 * Each call to `step(world)`:
 *  1. Moves all projectiles
 *  2. Despawns out-of-bounds projectiles
 *  3. Detects projectile-vs-tank hits and applies damage
 *  4. Checks for match end (hp <= 0 or time limit)
 *
 * Returns an array of event objects that occurred during this tick.
 */

import { applyActiveActions } from "./actions.js";

/**
 * @typedef {Object} StepEvent
 * @property {string} kind  - "hit" | "despawn" | "matchEnd"
 *
 * hit:      { kind:"hit",      projectileId, owner, target, damage }
 * despawn:  { kind:"despawn",  projectileId, owner, reason:"oob" }
 * matchEnd: { kind:"matchEnd", winner:"p1"|"p2"|null, reason:string }
 */

/**
 * Advance the world by one tick.
 *
 * @param {import("./world.js").World} world
 * @returns {StepEvent[]}
 */
export function step(world) {
  const { constants } = world;
  const dt = 1 / constants.TICK_RATE;
  const events = [];

  // ── 0) Apply active timed actions (smooth per-tick) ──────
  const completedActions = applyActiveActions(world, dt);

  // Emit an event for each action that completed this tick so the
  // runtime layer can resolve the corresponding Tank API Promise.
  for (const ca of completedActions) {
    events.push({
      kind: "actionComplete",
      slot: ca.slot,
      actionType: ca.actionType,
      scanResult: ca.scanResult,
    });
  }

  // ── 1) Move projectiles ──────────────────────────────────
  for (const proj of world.projectiles.values()) {
    proj.x += proj.vx * dt;
    proj.y += proj.vy * dt;
  }

  // ── 2) Despawn out-of-bounds projectiles ─────────────────
  for (const proj of world.projectiles.values()) {
    if (
      proj.x < -constants.PROJECTILE_RADIUS ||
      proj.x > constants.ARENA_WIDTH + constants.PROJECTILE_RADIUS ||
      proj.y < -constants.PROJECTILE_RADIUS ||
      proj.y > constants.ARENA_HEIGHT + constants.PROJECTILE_RADIUS
    ) {
      events.push({ kind: "despawn", projectileId: proj.id, owner: proj.owner, reason: "oob" });
      clearProjectileFromOwner(world, proj);
      world.projectiles.delete(proj.id);
    }
  }

  // ── 3) Detect projectile hits on tanks ───────────────────
  //    Circle-vs-circle: projectile radius + tank radius
  const hitRange = constants.PROJECTILE_RADIUS + constants.TANK_RADIUS;
  const hitRangeSq = hitRange * hitRange;

  for (const proj of world.projectiles.values()) {
    // Check every tank that is NOT the owner and still alive
    for (const [targetSlot, target] of Object.entries(world.tanks)) {
      if (targetSlot === proj.owner) continue;
      if (target.hp <= 0) continue;

      const dx = proj.x - target.x;
      const dy = proj.y - target.y;
      if (dx * dx + dy * dy <= hitRangeSq) {
        // Hit!
        target.hp -= constants.PROJECTILE_DAMAGE;
        if (target.hp < 0) target.hp = 0;

        events.push({
          kind: "hit",
          projectileId: proj.id,
          owner: proj.owner,
          target: targetSlot,
          damage: constants.PROJECTILE_DAMAGE,
        });

        clearProjectileFromOwner(world, proj);
        world.projectiles.delete(proj.id);
        break; // projectile is consumed on first hit
      }
    }
  }

  // ── 4) Advance time ─────────────────────────────────────
  world.t += dt;

  // ── 5) Detect match end ─────────────────────────────────
  const alive = Object.entries(world.tanks)
    .filter(([, t]) => t.hp > 0)
    .map(([slot]) => slot);

  if (alive.length <= 1) {
    if (alive.length === 1) {
      events.push({ kind: "matchEnd", winner: alive[0], reason: "hp" });
    } else {
      events.push({ kind: "matchEnd", winner: null, reason: "double_ko" });
    }
  } else if (world.t >= constants.MATCH_TIME_LIMIT) {
    // Time limit – highest HP wins
    alive.sort((a, b) => world.tanks[b].hp - world.tanks[a].hp);
    if (world.tanks[alive[0]].hp > world.tanks[alive[1]].hp) {
      events.push({ kind: "matchEnd", winner: alive[0], reason: "timeout" });
    } else {
      events.push({ kind: "matchEnd", winner: null, reason: "timeout" });
    }
  }

  return events;
}

// ── Helpers ────────────────────────────────────────────────

/**
 * When a projectile is removed (hit or despawn), clear the owner
 * tank's activeProjectileId so it can fire again.
 *
 * @param {import("./world.js").World} world
 * @param {import("./world.js").Projectile} proj
 */
function clearProjectileFromOwner(world, proj) {
  const owner = world.tanks[proj.owner];
  if (owner && owner.activeProjectileId === proj.id) {
    owner.activeProjectileId = null;
  }
}

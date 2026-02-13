/**
 * player/tank-wall-hugger.js — "The Wall Hugger" (Light)
 *
 * Strategy: navigate to a wall, then patrol along the edges of the arena
 * like a security guard, scanning inward. The idea is that keeping a wall
 * to your back means the enemy can only come from one direction.
 *
 * Overcomplicated because: maintains an elaborate "patrol state machine"
 * with named states, counts patrol laps, and has a "bravery meter" that
 * determines whether to chase or keep patrolling.
 *
 * NOTE: loop() is called repeatedly — each call does just a few actions.
 */

export const tankType = "light";

// ── Persistent state across loop() calls ────────────────
let state = "seeking_wall";
let bravery = 0;
let patrolLaps = 0;
let cornersTurned = 0;
let seekStep = 0;
let returnStep = 0;
let engageAttempts = 0;

const PATROL_SCAN_ANGLE = 70;
const BRAVERY_MAX = 5;
const BRAVERY_CHASE_THRESHOLD = 3;

export default async function loop(tank) {

  // ── SEEKING WALL ──────────────────────────────────────
  if (state === "seeking_wall") {
    if (seekStep === 0) {
      // Turn to a random cardinal-ish direction
      const initialTurn = Math.floor(tank.random() * 4) * 90;
      if (initialTurn > 0) {
        await tank.turnRight(initialTurn);
      }
      seekStep++;
      return;
    }

    // Drive toward wall, one step per loop call
    await tank.moveForward();

    // Opportunistic scan while driving
    const spotted = await tank.scan(-45, 45);
    if (spotted) {
      tank.shoot();
      bravery++;
      tank.log(`Lucky spot! Bravery: ${bravery}`);
    }

    seekStep++;

    if (seekStep >= 7) {
      state = "patrolling";
      tank.log("Reached wall (probably). Starting patrol.");
    }
    return;
  }

  // ── PATROLLING ────────────────────────────────────────
  if (state === "patrolling") {
    // Turn along the wall
    await tank.turnRight(90);
    cornersTurned++;

    // Move one segment + scan inward
    await tank.moveForward();
    const inward = await tank.scan(-PATROL_SCAN_ANGLE, 0);

    if (inward) {
      tank.log(`Contact during patrol! Bravery: ${bravery}`);
      bravery += 2;
      tank.shoot();

      if (bravery >= BRAVERY_CHASE_THRESHOLD) {
        tank.log("Feeling brave! Engaging!");
        state = "engaging";
        engageAttempts = 0;
        return;
      }
      tank.log("Not brave enough yet. Keep patrolling.");
      tank.shoot(); // double-tap just in case
    }

    // Track lap completion
    if (cornersTurned >= 4) {
      patrolLaps++;
      cornersTurned = 0;
      bravery = Math.min(bravery + 1, BRAVERY_MAX);
      tank.log(`Completed patrol lap ${patrolLaps}. Bravery: ${bravery}`);
    }

    return;
  }

  // ── ENGAGING ──────────────────────────────────────────
  if (state === "engaging") {
    const found = await tank.scan(-30, 30);

    if (found) {
      tank.shoot();
      await tank.moveForward();
      tank.shoot(); // double-tap
    } else {
      // Sweep left then right
      const left = await tank.scan(-90, -10);
      if (left) {
        await tank.turnLeft(30);
        tank.shoot();
        return;
      }

      const right = await tank.scan(10, 90);
      if (right) {
        await tank.turnRight(30);
        tank.shoot();
        return;
      }

      // Totally lost
      tank.log("Lost contact. Retreating to wall.");
      bravery = Math.max(0, bravery - 2);
      state = "returning";
      returnStep = 0;
      return;
    }

    engageAttempts++;
    if (engageAttempts >= 3) {
      state = "returning";
      returnStep = 0;
    }
    return;
  }

  // ── RETURNING TO WALL ─────────────────────────────────
  if (state === "returning") {
    if (returnStep === 0) {
      await tank.turnRight(180);
      returnStep++;
      return;
    }

    await tank.moveForward();
    returnStep++;

    if (returnStep >= 4) {
      state = "patrolling";
      tank.log("Back on patrol.");
    }
    return;
  }
}

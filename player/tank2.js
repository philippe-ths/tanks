/**
 * player/tank2.js
 *
 * "Stalker" — a heavy tank that methodically sweeps the arena,
 * closes distance when it detects the opponent, and fires while
 * circling to stay hard to hit.
 */

export const tankType = "heavy";

export default async function loop(tank) {
  // ── 1. Sweep: scan a wide 180° forward arc ──────────────
  const ahead = await tank.scan(-90, 90);

  if (ahead) {
    // ── 2. Locked on — shoot and strafe ────────────────────
    tank.shoot();

    // Close distance while zigzagging
    await tank.moveForward();

    // Re-check with a tight cone
    const still = await tank.scan(-20, 20);
    if (still) {
      tank.shoot();
      // Circle around the target
      if (tank.random() < 0.5) {
        await tank.turnLeft();
      }
      await tank.moveForward();
      tank.shoot();
    } else {
      // Lost them — quick sweep left and right
      const left = await tank.scan(-90, 0);
      if (left) {
        await tank.turnLeft(20);
        tank.shoot();
      } else {
        await tank.turnRight(20);
        tank.shoot();
      }
    }
  } else {
    // ── 3. No target — patrol ──────────────────────────────
    await tank.moveForward();
    await tank.moveForward();

    // Turn a random amount to sweep new area
    const r = tank.random();
    if (r < 0.33) {
      await tank.turnLeft();
    } else if (r < 0.66) {
      await tank.turnRight();
    }
    // else keep going straight — covers more ground
  }
}

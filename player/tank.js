/**
 * player/tank.js
 *
 * Example player tank — edit this file to create your own strategy!
 *
 * Your tank has these async (timed) methods:
 *   await tank.turnLeft(degrees?)    — rotate CCW (default: full turn)
 *   await tank.turnRight(degrees?)   — rotate CW  (default: full turn)
 *   await tank.moveForward()         — move along heading  (1 sec)
 *   await tank.moveBackward()        — move opposite heading (1 sec)
 *   await tank.scan(aDeg, bDeg)      — scan an arc, returns true/false (1 sec)
 *
 * And these instant methods:
 *   tank.shoot()    — fire a projectile (one active at a time), returns boolean
 *   tank.log(msg)   — debug output
 *   tank.random()   — deterministic random number [0, 1)
 */

export const tankType = "heavy";

export default async function loop(tank) {
  // Scan ahead with a narrow cone
  const found = await tank.scan(-30, 30);

  if (found) {
    tank.shoot();
    await tank.moveForward();
  } else {
    // Scan left side
    const left = await tank.scan(-90, -30);
    if (left) {
      await tank.turnLeft(15);
      tank.shoot();
      return;
    }

    // Scan right side
    const right = await tank.scan(30, 90);
    if (right) {
      await tank.turnRight(15);
      tank.shoot();
      return;
    }

    // Nothing nearby — explore
    await tank.moveForward();
    if (tank.random() < 0.3) {
      await tank.turnRight(30);
    }
  }
}

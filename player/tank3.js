/**
 * player/tank.js
 *
 * Example player tank — edit this file to create your own strategy!
 *
 * Your tank has these async (timed) methods (each takes 1 second of game time):
 *   await tank.turnLeft()       — rotate counter-clockwise
 *   await tank.turnRight()      — rotate clockwise
 *   await tank.moveForward()    — move along heading
 *   await tank.moveBackward()   — move opposite heading
 *   await tank.scan(aDeg, bDeg) — scan an arc, returns true/false
 *
 * And these instant methods:
 *   tank.shoot()    — fire a projectile (one active at a time), returns boolean
 *   tank.log(msg)   — debug output
 *   tank.random()   — deterministic random number [0, 1)
 */

export const tankType = "light";

export default async function loop(tank) {
  // Scan ahead

  const foundRight = await tank.scan(0, 90);
  if (foundRight) {
    await tank.turnRight(45);
    await tank.moveForward();
  } else {
    await tank.turnLeft(45);
    await tank.moveForward();
  }

  const lockIn = await tank.scan(-15, 15);
  if (lockIn) {
    tank.shoot();
    await tank.moveForward();
    tank.shoot();
  }

}

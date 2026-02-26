/**
 * player/tank.js
 * 
 * tankType: "light" or "heavy" - determines your tank's stats and appearance
 * heavy tanks have more HP but are slower to move and turn
 * light tanks are faster but more fragile
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
 */

export const tankType = "heavy";

export default async function loop(tank) {

  if ( await tank.scan(-15, 15) ) {
    tank.shoot();
    await tank.moveForward();
  } else {
    if ( await tank.scan(0, 180) ) {
      await tank.turnRight(45);
    } else {
      await tank.turnLeft(45);
    }
  }

}

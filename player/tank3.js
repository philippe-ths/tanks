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
 *   tank.log(msg)   — debug output
 *   tank.random()   — deterministic random number [0, 1)
 */

export const tankType = "heavy";

export default async function loop(tank) {

  if ( await tank.scan(-30, 30) ) {
    tank.shoot();
  } else {
    if ( await tank.scan(0, 180) ) {
      await tank.turnRight(90);
    } else {
      await tank.turnLeft(90);
    }

  }

}

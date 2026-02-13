/**
 * player/tank-bulldozer.js — "The Bulldozer" (Heavy)
 *
 * Drives forward shooting constantly.
 * When it hits a wall, turns and keeps going.
 */

export const tankType = "heavy";

export default async function loop(tank) {
  tank.shoot();
  await tank.moveForward();
  await tank.moveForward();
  await tank.turnRight(15);
}

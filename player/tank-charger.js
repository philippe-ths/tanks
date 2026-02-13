/**
 * player/tank-charger.js — "The Charger" (Light)
 *
 * Scans forward. If it sees something, shoot and charge.
 * If not, turn a bit and try again.
 */

export const tankType = "light";

export default async function loop(tank) {
  const found = await tank.scan(-20, 20);

  if (found) {
    tank.shoot();
    await tank.moveForward();
  } else {
    await tank.turnRight(30);
  }
}

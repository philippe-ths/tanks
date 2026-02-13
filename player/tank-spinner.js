/**
 * player/tank-spinner.js — "The Spinner" (Light)
 *
 * Just spins and shoots. That's it.
 */

export const tankType = "light";

export default async function loop(tank) {
  await tank.turnRight(15);
  tank.shoot();
}

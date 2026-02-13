/**
 * client/src/local/bot.js
 *
 * A basic built-in bot for local test mode.
 *
 * Strategy — alternating scan / move loop:
 *   1. Scan a wide 120° forward arc.
 *   2. If detected → shoot, then advance toward the opponent.
 *   3. If not detected → move forward (explore), then scan a wider
 *      180° arc to sweep more of the arena.
 *   4. If the wide scan hits → shoot + advance.
 *   5. Otherwise → turn right to reorient and repeat.
 *
 * This keeps the bot moving (harder to hit) while still covering a
 * large portion of the arena with its scans.
 */

export const BOT_CODE = `\
export const tankType = "light";

export default async function loop(tank) {
  // ── 1. Narrow forward scan (120°) ─────────────────────
  const ahead = await tank.scan(-60, 60);

  if (ahead) {
    tank.shoot();
    await tank.moveForward();
    return; // back to top of loop
  }

  // ── 2. Nothing ahead — advance to explore ─────────────
  await tank.moveForward();

  // ── 3. Wide sweep scan (180°) ─────────────────────────
  const wide = await tank.scan(-90, 90);

  if (wide) {
    tank.shoot();
    await tank.moveForward();
    return;
  }

  // ── 4. Still nothing — turn to search ─────────────────
  await tank.turnRight(45);
}
`;

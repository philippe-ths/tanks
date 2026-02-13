/**
 * server/src/sim/prng.js
 *
 * Deterministic pseudo-random number generator (Mulberry32).
 * Given the same seed, always produces the same sequence of values.
 * Used for fair, reproducible matches (spawn positions, etc.).
 */

/**
 * Create a seeded PRNG function (Mulberry32).
 *
 * @param {number} seed - An integer seed.
 * @returns {() => number} A function that returns a float in [0, 1) on each call.
 *
 * @example
 *   const rng = createPRNG(42);
 *   rng(); // 0.6011037519201636
 *   rng(); // 0.4400420198217034
 *   // Same seed → same sequence every time.
 */
export function createPRNG(seed) {
  let s = seed | 0; // ensure 32-bit integer

  return function random() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

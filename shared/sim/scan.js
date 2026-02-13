/**
 * server/src/sim/scan.js
 *
 * Scan-arc geometry: determine whether an opponent tank falls within a
 * fan-shaped scan region defined by two relative angles and a max range.
 *
 * ── Coordinate convention ────────────────────────────────────────────────
 *   • 0° = east (+x), angles increase clockwise (screen coords).
 *   • aDeg / bDeg are **relative to the scanning tank's heading**.
 *     The arc sweeps clockwise from aDeg to bDeg.
 *       – scan(-30, 30) → 60° cone centred on the heading.
 *       – scan(0, 360)  → full circle.
 *       – scan(170, -170) i.e. scan(170, 190 after normalising) → 20° arc
 *         behind the tank that wraps through 180°.
 *
 * ── Algorithm ────────────────────────────────────────────────────────────
 *   1. Compute bearing from scanner to target (absolute).
 *   2. Convert bearing to **relative** angle (subtract scanner heading).
 *   3. Normalise everything into [0, 360).
 *   4. Compute the clockwise arc span from aDeg to bDeg.
 *   5. Check whether the relative bearing falls inside that span.
 *   6. Also verify distance ≤ range.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Normalise an angle into [0, 360).
 * @param {number} deg
 * @returns {number}
 */
function normalizeDeg(deg) {
  return ((deg % 360) + 360) % 360;
}

/**
 * Determine whether the opponent is inside the scan arc.
 *
 * @param {{ x: number, y: number, headingDeg: number }} scanner
 *   Pose of the scanning tank.
 * @param {{ x: number, y: number }} target
 *   Position of the opponent tank.
 * @param {number} aDeg
 *   Start of scan arc (degrees, relative to scanner heading). The arc
 *   sweeps **clockwise** from aDeg to bDeg.
 * @param {number} bDeg
 *   End of scan arc (degrees, relative to scanner heading).
 * @param {number} range
 *   Maximum detection distance (world units).
 * @returns {boolean} true if the target is within the arc and range.
 */
export function isInScanArc(scanner, target, aDeg, bDeg, range) {
  // ── 1) Range check ───────────────────────────────────────
  const dx = target.x - scanner.x;
  const dy = target.y - scanner.y;
  const distSq = dx * dx + dy * dy;
  if (distSq > range * range) return false;

  // Edge case: scanner and target are at the exact same position.
  // Any arc includes a zero-distance target.
  if (distSq === 0) return true;

  // ── 2) Absolute bearing to target ────────────────────────
  // atan2(dy, dx) gives radians with 0 = east, positive = CCW in math
  // coords.  Our convention is CW-positive, which matches screen-y-down
  // atan2 directly (since +dy = down = clockwise from east).
  const absBearingDeg = normalizeDeg(Math.atan2(dy, dx) * (180 / Math.PI));

  // ── 3) Relative bearing (subtract scanner heading) ───────
  const relBearing = normalizeDeg(absBearingDeg - scanner.headingDeg);

  // ── 4) Normalise arc boundaries ──────────────────────────
  const a = normalizeDeg(aDeg);
  const b = normalizeDeg(bDeg);

  // ── 5) Arc containment (clockwise from a to b) ──────────
  //  The arc spans clockwise from `a` to `b`.
  //  arcSpan is the clockwise angular distance from a to b.
  //  If a === b we treat it as a full 360° scan.
  if (a === b) return true; // full circle

  const arcSpan = normalizeDeg(b - a); // clockwise span
  const offset  = normalizeDeg(relBearing - a); // how far past `a` the bearing is (CW)

  return offset <= arcSpan;
}

// ─────────────────────────────────────────────────────────────────────────
// Inline tests / examples
// ─────────────────────────────────────────────────────────────────────────
//
// All examples use:  range = 700
//
// Example 1 – Target directly ahead, narrow cone
//   scanner: { x:100, y:100, headingDeg:0 }   (facing east)
//   target:  { x:200, y:100 }                  (due east, 100 units away)
//   scan(-30, 30)  → bearing 0°, relBearing 0°
//     arc: a=330, b=30, span=60°, offset=normalizeDeg(0-330)=30  → 30 <= 60 ✔  TRUE
//
// Example 2 – Target behind, narrow forward cone
//   scanner: { x:100, y:100, headingDeg:0 }
//   target:  { x:  0, y:100 }                  (due west, 100 units)
//   scan(-30, 30)  → bearing 180°, relBearing 180°
//     arc: a=330, b=30, span=60°, offset=normalizeDeg(180-330)=210 → 210 <= 60? ✘  FALSE
//
// Example 3 – Wrap-around arc covering the rear
//   scanner: { x:100, y:100, headingDeg:0 }
//   target:  { x:  0, y:100 }                  (due west)
//   scan(170, -170)  → a=170, b=190, span=20°, relBearing=180°
//     offset=normalizeDeg(180-170)=10 → 10 <= 20 ✔  TRUE
//
// Example 4 – Out of range
//   scanner: { x:0, y:0, headingDeg:90 }       (facing south)
//   target:  { x:0, y:800 }                    (800 units south)
//   scan(-45, 45), range=700
//     dist=800 > 700 → FALSE  (range check fails before arc test)
//
// Example 5 – Full-circle scan (a === b)
//   scan(0, 0)  → a === b → TRUE (any target in range is detected)
//
// Example 6 – Target at 45° relative, scanner facing north
//   scanner: { x:100, y:100, headingDeg:270 }  (facing north, up on screen)
//   target:  { x:200, y:  0 }                  (NE, bearing ≈ 315° abs)
//     absBearing = atan2(-100,100) = -45° → normalised 315°
//     relBearing = normalise(315 - 270) = 45°
//   scan(0, 90)  → a=0, b=90, span=90°
//     offset = normalise(45-0) = 45 → 45 <= 90 ✔  TRUE
//
// Example 7 – Wide 180° rear scan
//   scanner: { x:400, y:400, headingDeg:0 }
//   target:  { x:300, y:350 }                  (behind-left)
//     dx=-100, dy=-50 → absBearing=normalise(atan2(-50,-100)*180/π)
//       = normalise(~206.57°) ≈ 206.57°
//     relBearing = normalise(206.57 - 0) = 206.57°
//   scan(90, 270) → a=90, b=270, span=180°
//     offset = normalise(206.57 - 90) = 116.57 → 116.57 <= 180 ✔  TRUE
//

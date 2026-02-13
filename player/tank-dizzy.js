/**
 * player/tank-dizzy.js — "The Dizzy Dancer" (Light)
 *
 * Strategy: spin in circles while scanning thin slices like a radar dish.
 * When a slice lights up, stop spinning, fire a burst of shots while
 * zig-zagging forward. Keeps moving erratically to be hard to hit.
 *
 * Overcomplicated because: tracks a "spin count" and does math to figure
 * out how many slices it's scanned, maintains a "confidence level" that
 * decays over time, and has an elaborate retreat sequence.
 *
 * NOTE: loop() is called repeatedly — each call should do only a few
 * actions so it stays under the 5-second wall-clock timeout.
 */

export const tankType = "light";

// ── Persistent state across loop() calls ────────────────
let sliceIndex = 0;
let confidence = 0;
let mode = "sweep";         // "sweep" | "chase" | "retreat"
let chaseStep = 0;
let retreatStep = 0;

const SLICE_WIDTH = 30;
const TOTAL_SLICES = Math.ceil(360 / SLICE_WIDTH);
const CONFIDENCE_THRESHOLD = 0.5;
const MAX_CHASE_STEPS = 3;

export default async function loop(tank) {

  // ── MODE: SWEEP (radar spin) ──────────────────────────
  if (mode === "sweep") {
    const halfSlice = SLICE_WIDTH / 2;
    const detected = await tank.scan(-halfSlice, halfSlice);

    if (detected) {
      confidence = 1.0;
      mode = "chase";
      chaseStep = 0;
      tank.log(`Target acquired on slice ${sliceIndex}!`);
      tank.shoot();
      return;
    }

    // Rotate to next slice
    if (tank.random() < 0.5) {
      await tank.turnLeft(SLICE_WIDTH);
    } else {
      await tank.turnRight(SLICE_WIDTH);
    }

    sliceIndex++;

    // After a full revolution with nothing, relocate
    if (sliceIndex >= TOTAL_SLICES) {
      sliceIndex = 0;
      tank.log("Full sweep done. Relocating like a confused roomba...");
      await tank.moveForward();
    }

    return;
  }

  // ── MODE: CHASE (zig-zag attack) ──────────────────────
  if (mode === "chase") {
    tank.shoot();

    // Zig-zag: alternate left-right while advancing
    if (chaseStep % 2 === 0) {
      await tank.turnRight(8);
      await tank.moveForward();
    } else {
      await tank.turnLeft(8);
      await tank.moveForward();
    }

    // Re-scan to track target
    const stillThere = await tank.scan(-25, 25);
    if (stillThere) {
      tank.shoot();
      confidence = Math.min(1.0, confidence + 0.2);
    } else {
      confidence -= 0.3;
      tank.log(`Lost visual. Confidence: ${confidence.toFixed(2)}`);
    }

    chaseStep++;

    // End chase if confidence drops or max steps reached
    if (confidence < CONFIDENCE_THRESHOLD || chaseStep >= MAX_CHASE_STEPS) {
      mode = "retreat";
      retreatStep = 0;
      tank.log("Chase over! Executing evasive maneuver!");
    }

    return;
  }

  // ── MODE: RETREAT (panic escape) ──────────────────────
  if (mode === "retreat") {
    if (retreatStep === 0) {
      // Turn a random amount to disengage
      const escapeAngle = tank.random() * 60 + 60;
      if (tank.random() < 0.5) {
        await tank.turnLeft(escapeAngle);
      } else {
        await tank.turnRight(escapeAngle);
      }
    }

    await tank.moveForward();
    retreatStep++;

    if (retreatStep >= 2) {
      mode = "sweep";
      sliceIndex = 0;
      confidence = 0;
      tank.log("Retreat complete. Back to scanning!");
    }

    return;
  }
}

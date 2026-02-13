/**
 * player/tank-fortress.js — "The Fortress" (Heavy)
 *
 * Strategy: heavy tank that plants itself near the center and slowly
 * rotates like a turret, scanning every direction methodically. When
 * it spots an enemy, it enters "siege mode" — fires, waits, fires again.
 * Takes advantage of high HP to trade hits rather than dodge.
 *
 * Overcomplicated because: has a "threat level" system with named levels,
 * a "patience counter" that tracks how long since last contact, and an
 * elaborate repositioning algorithm that's just moving forward twice.
 *
 * NOTE: loop() is called repeatedly — each call does just a few actions.
 */

export const tankType = "heavy";

// ── Persistent state across loop() calls ────────────────
const THREAT = {
  SAFE:    { name: "SAFE",    scanWidth: 45 },
  ALERT:   { name: "ALERT",   scanWidth: 30 },
  DANGER:  { name: "DANGER",  scanWidth: 15 },
  MAXIMUM: { name: "MAXIMUM", scanWidth: 10 },
};

let mode = "setup";          // "setup" | "sweep" | "siege" | "reposition"
let threat = THREAT.SAFE;
let patience = 6;
let sectorIndex = 0;
let siegeVolley = 0;
let setupDone = false;
let totalKillAttempts = 0;

const ROTATION_STEP = 60;
const SECTORS = Math.ceil(360 / ROTATION_STEP);
const SIEGE_VOLLEYS = 3;

export default async function loop(tank) {

  // ── MODE: SETUP (waddle to position) ──────────────────
  if (mode === "setup" && !setupDone) {
    tank.log("Fortress initializing... moving to position.");
    await tank.moveForward();
    await tank.turnRight(tank.random() * 40);
    setupDone = true;
    mode = "sweep";
    sectorIndex = 0;
    tank.log("Position established. Beginning sweep protocol.");
    return;
  }

  // ── MODE: SWEEP (lighthouse scan) ─────────────────────
  if (mode === "sweep") {
    const halfW = threat.scanWidth;
    tank.log(`Scanning sector ${sectorIndex + 1}/${SECTORS} [${threat.name}]`);

    const found = await tank.scan(-halfW, halfW);

    if (found) {
      tank.log("CONTACT! Entering siege mode!");
      threat = THREAT.DANGER;
      patience = 6;
      totalKillAttempts++;
      mode = "siege";
      siegeVolley = 0;
      tank.shoot();
      return;
    }

    // Nothing — rotate to next sector
    patience--;
    if (patience <= 0) {
      threat = THREAT.SAFE;
      patience = 6;
    }

    await tank.turnRight(ROTATION_STEP);
    sectorIndex++;

    // Full rotation done — reposition
    if (sectorIndex >= SECTORS) {
      sectorIndex = 0;
      mode = "reposition";
      tank.log(`Sweep complete. Kill attempts so far: ${totalKillAttempts}`);
    }
    return;
  }

  // ── MODE: SIEGE (fire volleys) ────────────────────────
  if (mode === "siege") {
    tank.log(`Siege volley ${siegeVolley + 1}/${SIEGE_VOLLEYS}`);
    tank.shoot();

    // Tiny aim adjustment
    const adjust = (tank.random() - 0.5) * 10;
    if (adjust > 0) {
      await tank.turnRight(Math.abs(adjust));
    } else {
      await tank.turnLeft(Math.abs(adjust));
    }

    // Confirm target
    const halfW = threat.scanWidth;
    const confirm = await tank.scan(-halfW, halfW);
    if (confirm) {
      tank.shoot();
      threat = THREAT.MAXIMUM;
      tank.log("Target confirmed! Threat: MAXIMUM");
    } else {
      tank.log("Lost target during siege.");
      threat = THREAT.ALERT;

      // Micro-search left/right
      const checkLeft = await tank.scan(-60, -10);
      if (checkLeft) {
        await tank.turnLeft(25);
        tank.shoot();
        tank.log("Re-acquired left!");
      } else {
        const checkRight = await tank.scan(10, 60);
        if (checkRight) {
          await tank.turnRight(25);
          tank.shoot();
          tank.log("Re-acquired right!");
        } else {
          tank.log("Target lost. Ending siege.");
          mode = "sweep";
          sectorIndex = 0;
          return;
        }
      }
    }

    siegeVolley++;
    if (siegeVolley >= SIEGE_VOLLEYS) {
      mode = "sweep";
      sectorIndex = 0;
    }
    return;
  }

  // ── MODE: REPOSITION (shuffle forward) ────────────────
  if (mode === "reposition") {
    tank.log("Repositioning fortress...");
    await tank.moveForward();

    const newHeading = tank.random() * 120 - 60;
    if (newHeading > 0) {
      await tank.turnRight(newHeading);
    } else {
      await tank.turnLeft(Math.abs(newHeading));
    }

    // Decay threat level
    if (threat === THREAT.MAXIMUM) threat = THREAT.DANGER;
    else if (threat === THREAT.DANGER) threat = THREAT.ALERT;
    else if (threat === THREAT.ALERT) threat = THREAT.SAFE;

    tank.log(`Threat: ${threat.name}. Back to sweep.`);
    mode = "sweep";
    sectorIndex = 0;
    return;
  }
}

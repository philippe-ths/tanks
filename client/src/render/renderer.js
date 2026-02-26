/**
 * client/src/render/renderer.js
 *
 * Canvas renderer for the tank game.
 * Draws the arena bounds, tanks (as rotated shapes), and projectiles
 * from the latest `state` message received from the server.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *   import { createRenderer } from "./render/renderer.js";
 *   const renderer = createRenderer(canvasElement);
 *   // On each state message:
 *   renderer.setState(statePayload);
 *   // The renderer runs its own rAF loop.
 *   // To stop: renderer.stop();
 * ─────────────────────────────────────────────────────────────────────────
 */

import { CONSTANTS } from "../../../shared/constants.js";

// ── Geometry constants ─────────────────────────────────────────────────

const ARENA_W = CONSTANTS.ARENA_WIDTH;
const ARENA_H = CONSTANTS.ARENA_HEIGHT;
const TANK_R = CONSTANTS.TANK_RADIUS;
const PROJ_R = CONSTANTS.PROJECTILE_RADIUS;

const DEG2RAD = Math.PI / 180;

// ── Colours ────────────────────────────────────────────────────────────

const COLORS = {
  bg: "#0e0e1a",
  border: "#334",
  grid: "#1a1a2e",
  dead: "#555",
};

/** Per-player colour palette (up to 8 players). */
const PLAYER_COLORS = [
  { body: "#3498db", turret: "#2176ae", proj: "#85c1e9" },  // blue
  { body: "#e74c3c", turret: "#b83227", proj: "#f1948a" },  // red
  { body: "#2ecc71", turret: "#27ae60", proj: "#82e0aa" },  // green
  { body: "#f39c12", turret: "#d68910", proj: "#f8c471" },  // orange
  { body: "#9b59b6", turret: "#7d3c98", proj: "#c39bd3" },  // purple
  { body: "#1abc9c", turret: "#17a589", proj: "#76d7c4" },  // teal
  { body: "#e91e63", turret: "#c2185b", proj: "#f48fb1" },  // pink
  { body: "#cddc39", turret: "#afb42b", proj: "#e6ee9c" },  // lime
];

/** Extract the 0-based index from a slot name like "p1" → 0, "p3" → 2. */
function slotIndex(slot) {
  const num = parseInt(slot.replace(/\D/g, ""), 10);
  return isNaN(num) ? 0 : num - 1;
}

/** Get the colour set for a given slot. */
function getPlayerColors(slot) {
  return PLAYER_COLORS[slotIndex(slot) % PLAYER_COLORS.length];
}

/** Module-level map of slot → display name, set by setMatchInfo(). */
let nameMap = {};

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Create a renderer bound to a `<canvas>` element.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {{ setState: (s: Object) => void, setMatchInfo: (info: Object) => void, setMatchResult: (r: Object|null) => void, stop: () => void }}
 */
export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");

  /** Latest state snapshot (set externally via setState) */
  let state = null;

  /** Match metadata (tank types, set from matchStart) */
  let matchInfo = null;

  /** Match result (set from matchEnd, null while running) */
  let matchResult = null;

  /** rAF handle */
  let rafId = null;
  let running = true;

  // ── Sizing ─────────────────────────────────────────────────

  /**
   * Resize the canvas so the arena fits with some padding, maintaining
   * aspect ratio.  Called on mount and on window resize.
   */
  function resize() {
    const dpr = window.devicePixelRatio || 1;

    // Use the canvas container width (fallback to window)
    const maxW = canvas.parentElement?.clientWidth ?? window.innerWidth;
    const maxH = window.innerHeight * 0.75;

    const scaleX = maxW / ARENA_W;
    const scaleY = maxH / ARENA_H;
    const scale = Math.min(scaleX, scaleY, 1); // never upscale past 1:1

    const cssW = Math.floor(ARENA_W * scale);
    const cssH = Math.floor(ARENA_H * scale);

    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;

    // Store the computed scale so draw() can use it
    canvas._scale = scale * dpr;
  }

  resize();
  window.addEventListener("resize", resize);

  // ── Draw loop ──────────────────────────────────────────────

  function frame() {
    if (!running) return;
    draw(ctx, canvas, state, matchInfo, matchResult);
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  // ── Returned interface ─────────────────────────────────────

  return {
    /**
     * Feed the latest state snapshot from the server.
     * @param {Object} s  – a MSG_STATE payload
     */
    setState(s) {
      state = s;
    },

    /**
     * Set match metadata (from matchStart message).
     * @param {Object} info  – { tanks: { p1: { tankType }, p2: { tankType } } }
     */
    setMatchInfo(info) {
      matchInfo = info;
      matchResult = null; // reset on new match
      // Build name map: slot → display name (fall back to slot label)
      nameMap = {};
      if (info?.tanks) {
        for (const [s, data] of Object.entries(info.tanks)) {
          nameMap[s] = data.name && data.name !== s ? data.name : s.toUpperCase();
        }
      }
    },

    /**
     * Set the match result (from matchEnd message), or null to clear.
     * @param {Object|null} r  – { winner, reason }
     */
    setMatchResult(r) {
      matchResult = r;
    },

    /** Stop the render loop and remove listeners. */
    stop() {
      running = false;
      if (rafId != null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    },
  };
}

// ── Drawing ────────────────────────────────────────────────────────────

/**
 * Main draw function – called every animation frame.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} canvas
 * @param {Object|null} state
 * @param {Object|null} matchInfo
 * @param {Object|null} matchResult
 */
function draw(ctx, canvas, state, matchInfo, matchResult) {
  const scale = canvas._scale || 1;

  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  // ── Background ─────────────────────────────────────────
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // ── Grid (subtle) ──────────────────────────────────────
  drawGrid(ctx);

  // ── Arena border ───────────────────────────────────────
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(0.5, 0.5, ARENA_W - 1, ARENA_H - 1);

  if (!state) {
    // No data yet – show placeholder
    ctx.fillStyle = "#555";
    ctx.font = "20px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for match…", ARENA_W / 2, ARENA_H / 2);
    ctx.restore();
    return;
  }

  // ── Projectiles (draw under tanks) ─────────────────────
  if (state.projectiles) {
    for (const p of state.projectiles) {
      drawProjectile(ctx, p);
    }
  }

  // ── Scan arcs (draw under tanks but over projectiles) ──
  if (state.tanks) {
    for (const t of state.tanks) {
      if (t.scan) drawScanArc(ctx, t);
    }
  }

  // ── Tanks ──────────────────────────────────────────────
  if (state.tanks) {
    for (const t of state.tanks) {
      drawTank(ctx, t);
    }
  }

  // ── HUD ───────────────────────────────────────────────
  drawHUD(ctx, state, matchInfo, matchResult);

  ctx.restore();
}

// ── Grid ───────────────────────────────────────────────────────────────

/**
 * Draw a subtle grid to help visualise scale.
 * @param {CanvasRenderingContext2D} ctx
 */
function drawGrid(ctx) {
  const step = 100;
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 0.5;

  ctx.beginPath();
  for (let x = step; x < ARENA_W; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, ARENA_H);
  }
  for (let y = step; y < ARENA_H; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(ARENA_W, y);
  }
  ctx.stroke();
}

// ── Tank drawing ───────────────────────────────────────────────────────

/**
 * Draw a single tank as a rotated rounded-rectangle body with a turret
 * barrel extending from the front.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} t  – tank state from the state payload
 */
function drawTank(ctx, t) {
  const isDead = t.hp <= 0;
  const pc = getPlayerColors(t.slot);
  const colors = isDead
    ? { body: COLORS.dead, turret: COLORS.dead }
    : { body: pc.body, turret: pc.turret };

  const isHeavy = t.tankType === "heavy";
  const rad = t.headingDeg * DEG2RAD;

  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.rotate(rad);

  if (isHeavy) {
    // ── Heavy tank: larger, blockier, with armour panels ──
    const bw = TANK_R * 2.4;
    const bh = TANK_R * 1.8;

    // Track blocks (darker, on each side)
    ctx.fillStyle = isDead ? "#444" : "#222";
    ctx.fillRect(-bw / 2 - 2, -bh / 2 - 3, bw + 4, 6);  // top track
    ctx.fillRect(-bw / 2 - 2, bh / 2 - 3, bw + 4, 6);   // bottom track

    // Main body
    ctx.fillStyle = colors.body;
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    // Armour plate lines (horizontal stripes on body)
    ctx.strokeStyle = isDead ? "#666" : "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + 3, -bh / 4);
    ctx.lineTo(bw / 2 - 3, -bh / 4);
    ctx.moveTo(-bw / 2 + 3, bh / 4);
    ctx.lineTo(bw / 2 - 3, bh / 4);
    ctx.stroke();

    // Turret barrel (thicker & longer)
    const barrelLen = TANK_R * 1.4;
    const barrelW = 8;
    ctx.fillStyle = colors.turret;
    ctx.fillRect(bw / 2 - 2, -barrelW / 2, barrelLen, barrelW);

    // Direction indicator
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(bw / 2, 0);
    ctx.lineTo(bw / 2 - 8, -5);
    ctx.lineTo(bw / 2 - 8, 5);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

  } else {
    // ── Light tank: sleek, original size ──────────────────
    const bw = TANK_R * 2;
    const bh = TANK_R * 1.4;

    ctx.fillStyle = colors.body;
    ctx.fillRect(-bw / 2, -bh / 2, bw, bh);

    // Turret barrel
    const barrelLen = TANK_R * 1.2;
    const barrelW = 5;
    ctx.fillStyle = colors.turret;
    ctx.fillRect(bw / 2 - 2, -barrelW / 2, barrelLen, barrelW);

    // Direction indicator
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(bw / 2, 0);
    ctx.lineTo(bw / 2 - 6, -4);
    ctx.lineTo(bw / 2 - 6, 4);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  // ── Slot label ─────────────────────────────────────────
  const labelOffset = isHeavy ? TANK_R * 1.3 + 6 : TANK_R + 6;
  ctx.fillStyle = colors.body;
  ctx.font = "bold 11px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(nameMap[t.slot] ?? t.slot.toUpperCase(), t.x, t.y - labelOffset);
}

// ── HUD drawing ────────────────────────────────────────────────────────

/** HUD layout constants */
const HUD = {
  barW: 160,       // HP bar width
  barH: 14,        // HP bar height
  padding: 14,     // distance from arena edge
  gap: 8,          // gap between elements
};

/**
 * Draw the Heads-Up Display: HP bars for both tanks, tank types,
 * a match timer, and match status / winner overlay.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} state
 * @param {Object|null} matchInfo
 * @param {Object|null} matchResult
 */
function drawHUD(ctx, state, matchInfo, matchResult) {
  const tanks = state.tanks ?? [];

  // ── Per-player HP bars (stacked vertically on the left) ──

  const entryH = HUD.barH + 18; // label + bar + gap
  for (let i = 0; i < tanks.length; i++) {
    const t = tanks[i];
    const pc = getPlayerColors(t.slot);
    const color = pc.body;

    const x = HUD.padding;
    const y = HUD.padding + i * entryH;

    const maxHp = CONSTANTS.TANK_TYPES[t.tankType]?.hp ?? 100;

    // Label: "P1  Light"
    const typeLabel = t.tankType
      ? t.tankType.charAt(0).toUpperCase() + t.tankType.slice(1)
      : "?";
    ctx.fillStyle = "#ccc";
    ctx.font = "bold 12px system-ui";
    ctx.textAlign = "left";
    const displayName = nameMap[t.slot] ?? t.slot.toUpperCase();
    ctx.fillText(`${displayName}  ${typeLabel}`, x, y + 11);

    // Bar background
    const barY = y + 15;
    ctx.fillStyle = "#222";
    ctx.fillRect(x, barY, HUD.barW, HUD.barH);

    // Bar fill
    const hpFrac = Math.max(0, Math.min(1, t.hp / maxHp));
    const fillColor = t.hp <= 0 ? COLORS.dead : hpFrac > 0.5 ? color : hpFrac > 0.25 ? "#e6a817" : "#c0392b";
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, barY, HUD.barW * hpFrac, HUD.barH);

    // Bar border
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, barY, HUD.barW, HUD.barH);

    // HP text
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(`${t.hp}`, x + HUD.barW / 2, barY + HUD.barH - 2);
  }

  // ── Match timer (top center) ───────────────────────────

  if (state.t != null) {
    const mins = Math.floor(state.t / 60);
    const secs = Math.floor(state.t % 60);
    const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

    ctx.fillStyle = "#888";
    ctx.font = "14px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(timeStr, ARENA_W / 2, HUD.padding + 12);
  }

  // ── Match status (center label) ────────────────────────

  if (!matchResult) {
    // "RUNNING" indicator — small, unobtrusive
    ctx.fillStyle = "#2ecc71";
    ctx.font = "11px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("● LIVE", ARENA_W / 2, HUD.padding + 28);
  }

  // ── Winner / result overlay ────────────────────────────

  if (matchResult) {
    // Semi-transparent backdrop
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(0, ARENA_H / 2 - 50, ARENA_W, 100);

    ctx.textAlign = "center";

    if (matchResult.winner) {
      const winColor = getPlayerColors(matchResult.winner).body;

      ctx.fillStyle = winColor;
      ctx.font = "bold 32px system-ui";
      const winnerLabel = nameMap[matchResult.winner] ?? matchResult.winner.toUpperCase();
      ctx.fillText(
        `${winnerLabel} WINS!`,
        ARENA_W / 2,
        ARENA_H / 2 + 4,
      );
    } else {
      ctx.fillStyle = "#aaa";
      ctx.font = "bold 32px system-ui";
      ctx.fillText("DRAW", ARENA_W / 2, ARENA_H / 2 + 4);
    }

    // Reason
    const reasonText = formatReason(matchResult.reason);
    ctx.fillStyle = "#999";
    ctx.font = "14px system-ui";
    ctx.fillText(reasonText, ARENA_W / 2, ARENA_H / 2 + 28);

    // Detail (e.g. runtime error message)
    if (matchResult.detail) {
      ctx.fillStyle = "#777";
      ctx.font = "12px system-ui";
      ctx.fillText(
        matchResult.detail.length > 60
          ? matchResult.detail.slice(0, 57) + "…"
          : matchResult.detail,
        ARENA_W / 2,
        ARENA_H / 2 + 44,
      );
    }
  }
}

/**
 * Turn a machine reason code into a human-readable string.
 * @param {string} reason
 * @returns {string}
 */
function formatReason(reason) {
  switch (reason) {
    case "hp":        return "Destroyed";
    case "double_ko": return "Double KO";
    case "timeout":   return "Time limit reached";
    case "forfeit":   return "Opponent forfeited";
    case "aborted":   return "Match aborted";
    default:          return reason ?? "";
  }
}

// ── Scan arc drawing ───────────────────────────────────────────────────

const SCAN_RANGE = CONSTANTS.SCAN_RANGE;

/**
 * Draw a translucent fan showing the tank's active scan arc.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} t  – tank state with t.scan = { aDeg, bDeg }
 */
function drawScanArc(ctx, t) {
  const baseColor = getPlayerColors(t.slot).body;
  const found = t.scan.found;
  const hitColor = "#2ecc71"; // green for successful detection

  // Convert relative scan angles to absolute radians
  const headingRad = t.headingDeg * DEG2RAD;
  const startRad = headingRad + t.scan.aDeg * DEG2RAD;
  const endRad   = headingRad + t.scan.bDeg * DEG2RAD;

  ctx.save();

  // Fill – brighter and green when enemy detected
  ctx.globalAlpha = found ? 0.22 : 0.10;
  ctx.fillStyle = found ? hitColor : baseColor;

  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.arc(t.x, t.y, SCAN_RANGE, startRad, endRad, false);
  ctx.closePath();
  ctx.fill();

  // Edge lines
  ctx.globalAlpha = found ? 0.6 : 0.30;
  ctx.strokeStyle = found ? hitColor : baseColor;
  ctx.lineWidth = found ? 2 : 1;

  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(
    t.x + Math.cos(startRad) * SCAN_RANGE,
    t.y + Math.sin(startRad) * SCAN_RANGE,
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(t.x, t.y);
  ctx.lineTo(
    t.x + Math.cos(endRad) * SCAN_RANGE,
    t.y + Math.sin(endRad) * SCAN_RANGE,
  );
  ctx.stroke();

  // Outer arc edge
  ctx.beginPath();
  ctx.arc(t.x, t.y, SCAN_RANGE, startRad, endRad, false);
  ctx.stroke();

  // "DETECTED" label when found
  if (found) {
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = hitColor;
    ctx.font = "bold 11px system-ui";
    ctx.textAlign = "center";
    const labelDist = 60;
    const midRad = (startRad + endRad) / 2;
    ctx.fillText("!", t.x + Math.cos(midRad) * labelDist, t.y + Math.sin(midRad) * labelDist);
  }

  ctx.restore();
}

// ── Projectile drawing ─────────────────────────────────────────────────

/**
 * Draw a projectile as a small glowing circle.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} p  – projectile from the state payload
 */
function drawProjectile(ctx, p) {
  const color = getPlayerColors(p.owner).proj;

  // Glow
  ctx.beginPath();
  ctx.arc(p.x, p.y, PROJ_R * 3, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.15;
  ctx.fill();
  ctx.globalAlpha = 1;

  // Core
  ctx.beginPath();
  ctx.arc(p.x, p.y, PROJ_R, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

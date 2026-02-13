/**
 * shared/constants.js
 *
 * V1 gameplay constants.
 * Imported by both server and client; keep free of Node/browser-only APIs.
 */

export const CONSTANTS = {
  // ── Arena ────────────────────────────────────────────────
  ARENA_WIDTH: 1200,        // world units
  ARENA_HEIGHT: 800,

  // ── Tick / Timing ────────────────────────────────────────
  TICK_RATE: 60,            // simulation Hz
  get DT() { return 1 / this.TICK_RATE; },  // seconds per tick
  ACTION_DURATION: 1.0,     // seconds (timed actions)
  MATCH_TIME_LIMIT: 180,    // seconds (optional; higher HP wins on timeout)

  // ── Scan ─────────────────────────────────────────────────
  SCAN_RANGE: 700,          // max detection distance (world units)

  // ── Tank (shared geometry) ───────────────────────────────
  TANK_RADIUS: 18,          // collision radius

  // ── Tank types ───────────────────────────────────────────
  TANK_TYPES: {
    light: {
      hp: 60,
      moveSpeed: 160,       // units/sec
      turnRate: 120,        // deg/sec
    },
    heavy: {
      hp: 120,
      moveSpeed: 60,        // units/sec
      turnRate: 90,         // deg/sec
    },
  },

  // ── Projectile ───────────────────────────────────────────
  PROJECTILE_SPEED: 420,    // units/sec
  PROJECTILE_RADIUS: 4,     // collision radius
  PROJECTILE_DAMAGE: 20,

  // ── Network ──────────────────────────────────────────────
  STATE_BROADCAST_RATE: 20, // Hz (server → clients)

  // ── Safety ───────────────────────────────────────────────
  MAX_CODE_SIZE: 50 * 1024, // 50 KB
  // ── Multiplayer ──────────────────────────────────────────────
  MAX_PLAYERS: 8,
  DISCOVERY_PORT: 41234,    // UDP broadcast port for LAN discovery
};

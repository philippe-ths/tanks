/**
 * shared/protocol.js
 *
 * WebSocket message type constants and JSDoc payload definitions.
 * Imported by both server and client; keep free of Node/browser-only APIs.
 */

// ── Client → Server ────────────────────────────────────────

/**
 * Player requests to join the lobby.
 * @typedef {Object} JoinPayload
 * @property {"join"}   type
 * @property {string}   name  - Display name chosen by the player.
 */
export const MSG_JOIN = "join";

/**
 * Player submits their tank code.
 * @typedef {Object} SubmitTankPayload
 * @property {"submitTank"}         type
 * @property {"light"|"heavy"}      tankType - Chosen tank class.
 * @property {string}               code     - Full text of the player's tank.js.
 */
export const MSG_SUBMIT_TANK = "submitTank";

/**
 * Player signals they are ready to start the match.
 * @typedef {Object} ReadyPayload
 * @property {"ready"} type
 */
export const MSG_READY = "ready";

/**
 * Host requests to stop the current match and return to lobby.
 * @typedef {Object} ResetMatchPayload
 * @property {"resetMatch"} type
 */
export const MSG_RESET_MATCH = "resetMatch";

// ── Server → Client ────────────────────────────────────────

/**
 * Lobby state broadcast (sent whenever lobby changes).
 * @typedef {Object} LobbyPayload
 * @property {"lobby"}  type
 * @property {Array<LobbyPlayer>} players
 *
 * @typedef {Object} LobbyPlayer
 * @property {string}  slot
 * @property {string}     name
 * @property {boolean}    hasCode  - Whether the player has submitted code.
 * @property {string}     [tankType] - "light" or "heavy", if submitted.
 */
export const MSG_LOBBY = "lobby";

/**
 * Sent when a match begins.
 * @typedef {Object} MatchStartPayload
 * @property {"matchStart"} type
 * @property {number}       seed      - PRNG seed for deterministic replay.
 * @property {Object}       constants - Snapshot of CONSTANTS used for this match.
 */
export const MSG_MATCH_START = "matchStart";

/**
 * Periodic game-state snapshot broadcast during a match.
 * @typedef {Object} StatePayload
 * @property {"state"}  type
 * @property {number}   t  - Current simulation time (seconds).
 * @property {Array<TankState>}       tanks
 * @property {Array<ProjectileState>} projectiles
 *
 * @typedef {Object} TankState
 * @property {string}  slot
 * @property {number}     x
 * @property {number}     y
 * @property {number}     headingDeg
 * @property {number}     hp
 * @property {string}     tankType
 *
 * @typedef {Object} ProjectileState
 * @property {string}  owner  - Slot of the tank that fired it.
 * @property {number}     x
 * @property {number}     y
 */
export const MSG_STATE = "state";

/**
 * Sent when a match ends.
 * @typedef {Object} MatchEndPayload
 * @property {"matchEnd"}       type
 * @property {string|null}   winner  - Slot of winner, or null on draw.
 * @property {string}           reason  - e.g. "hp", "timeout", "forfeit".
 */
export const MSG_MATCH_END = "matchEnd";

/**
 * Error message from server to a specific client.
 * @typedef {Object} ErrorPayload
 * @property {"error"}  type
 * @property {string}   message - Human-readable error description.
 */
export const MSG_ERROR = "error";

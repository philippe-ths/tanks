/**
 * server/src/lobby.js
 *
 * Manages lobby state: up to MAX_PLAYERS player slots and any
 * number of spectators. Broadcasts lobby updates on every change.
 */

import { send, broadcast } from "./connectionManager.js";
import { MSG_LOBBY } from "../../shared/protocol.js";
import { CONSTANTS } from "../../shared/constants.js";

const MAX_PLAYERS = CONSTANTS.MAX_PLAYERS;

/**
 * @typedef {Object} PlayerSlot
 * @property {string}  clientId
 * @property {import("ws").WebSocket} ws
 * @property {string}  name
 * @property {boolean} hasCode
 * @property {string|null} tankType
 * @property {string|null} code
 */

/** @type {Object<string, PlayerSlot>}  e.g. { p1: slot, p2: slot, ... } */
const slots = {};

/** @type {Set<string>} clientIds of spectators */
const spectators = new Set();

/** Server display name. */
let serverName = "";

// ── Public API ─────────────────────────────────────────────

/**
 * Set the display name for this server.
 * @param {string} name
 */
export function setServerName(name) {
  serverName = name;
}

/**
 * Get the display name for this server.
 * @returns {string}
 */
export function getServerName() {
  return serverName;
}

/**
 * Return a summary of the lobby for discovery / API.
 */
export function getLobbyInfo() {
  return {
    serverName,
    playerCount: Object.keys(slots).length,
    maxPlayers: MAX_PLAYERS,
  };
}

/**
 * Assign a connecting client to a new player slot,
 * or mark them as a spectator. Sends that client their role
 * and broadcasts the updated lobby to everyone.
 *
 * @param {import("ws").WebSocket} ws
 */
export function joinLobby(ws) {
  const clientId = ws.clientId;

  if (Object.keys(slots).length < MAX_PLAYERS) {
    const slotName = nextAvailableSlot();
    slots[slotName] = createSlot(clientId, ws);
    ws.slot = slotName;
    console.log(`[lobby] ${clientId} → ${slotName}`);
  } else {
    spectators.add(clientId);
    ws.slot = "spectator";
    console.log(`[lobby] ${clientId} → spectator (full)`);
  }

  // Tell this client which slot they got
  send(ws, { type: "hello", clientId, slot: ws.slot });

  broadcastLobby();
}

/**
 * Remove a disconnecting client from the lobby.
 * If they held a player slot, free it.
 *
 * @param {import("ws").WebSocket} ws
 */
export function leaveLobby(ws) {
  const clientId = ws.clientId;

  let freed = false;
  for (const [slotName, slot] of Object.entries(slots)) {
    if (slot.clientId === clientId) {
      delete slots[slotName];
      console.log(`[lobby] ${slotName} slot freed (${clientId})`);
      freed = true;
      break;
    }
  }
  if (!freed) {
    spectators.delete(clientId);
  }

  broadcastLobby();
}

/**
 * Get the slot record for a given slot name.
 * @param {string} slotName
 * @returns {PlayerSlot|null}
 */
export function getSlot(slotName) {
  return slots[slotName] ?? null;
}

/**
 * Get all filled slot entries.
 * @returns {Object<string, PlayerSlot>}
 */
export function getAllSlots() {
  return slots;
}

/**
 * Get the slot name for a clientId, or "spectator".
 * @param {string} clientId
 * @returns {string}
 */
export function getSlotForClient(clientId) {
  for (const [slotName, slot] of Object.entries(slots)) {
    if (slot.clientId === clientId) return slotName;
  }
  return "spectator";
}

/**
 * Return the host slot name (lowest numbered slot).
 * @returns {string|null}
 */
export function getHostSlot() {
  const names = Object.keys(slots).sort();
  return names.length > 0 ? names[0] : null;
}

/**
 * Update stored code for a player slot.
 * Call broadcastLobby() after if you want to notify clients.
 *
 * @param {string} slotName
 * @param {string} tankType
 * @param {string} code
 */
export function setCode(slotName, tankType, code) {
  const slot = slots[slotName];
  if (!slot) return;
  slot.tankType = tankType;
  slot.code = code;
  slot.hasCode = true;
}

/**
 * Clear stored code for a player slot.
 * @param {string} slotName
 */
export function clearCode(slotName) {
  const slot = slots[slotName];
  if (!slot) return;
  slot.tankType = null;
  slot.code = null;
  slot.hasCode = false;
}

/**
 * Broadcast current lobby state to all connected clients.
 */
export function broadcastLobby() {
  const players = [];

  for (const [slotName, s] of Object.entries(slots)) {
    players.push({
      slot: slotName,
      name: s.name,
      hasCode: s.hasCode,
      ...(s.tankType ? { tankType: s.tankType } : {}),
    });
  }

  broadcast({ type: MSG_LOBBY, players, serverName, hostSlot: getHostSlot() });
}

/**
 * Reset the lobby to its initial empty state.
 */
export function resetLobby() {
  for (const key of Object.keys(slots)) delete slots[key];
  spectators.clear();
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Find the lowest available slot name (p1, p2, … pN).
 * @returns {string}
 */
function nextAvailableSlot() {
  for (let i = 1; i <= MAX_PLAYERS; i++) {
    const name = `p${i}`;
    if (!(name in slots)) return name;
  }
  return `p${MAX_PLAYERS + 1}`; // should never happen (caller checks count)
}

/**
 * @param {string} clientId
 * @param {import("ws").WebSocket} ws
 * @returns {PlayerSlot}
 */
function createSlot(clientId, ws) {
  return {
    clientId,
    ws,
    name: clientId,       // default name; updated on MSG_JOIN
    hasCode: false,
    tankType: null,
    code: null,
  };
}

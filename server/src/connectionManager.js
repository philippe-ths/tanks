/**
 * server/src/connectionManager.js
 *
 * Tracks connected WebSocket clients, assigns unique clientIds,
 * and provides helpers for sending messages.
 */

import crypto from "node:crypto";

/** @type {Map<string, { ws: WebSocket, clientId: string }>} */
const clients = new Map();

/**
 * Generate a short random client ID.
 * @returns {string}
 */
function generateId() {
  return crypto.randomBytes(4).toString("hex");
}

/**
 * Register a new WebSocket connection.
 * Assigns a clientId, stores it, and sends a temporary `hello` message.
 * @param {WebSocket} ws
 * @returns {string} The assigned clientId.
 */
export function addClient(ws) {
  const clientId = generateId();
  clients.set(clientId, { ws, clientId });

  // Attach clientId to the ws instance for easy lookup later
  ws.clientId = clientId;

  console.log(`[ws] client connected  id=${clientId}  (total: ${clients.size})`);

  // Temporary hello message so the client knows its ID immediately
  send(ws, { type: "hello", clientId });

  return clientId;
}

/**
 * Remove a client by its WebSocket reference.
 * @param {WebSocket} ws
 */
export function removeClient(ws) {
  const clientId = ws.clientId;
  if (clientId) {
    clients.delete(clientId);
    console.log(`[ws] client disconnected  id=${clientId}  (total: ${clients.size})`);
  }
}

/**
 * Send a JSON message to a single client.
 * @param {WebSocket} ws
 * @param {Object} msg
 */
export function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/**
 * Broadcast a JSON message to every connected client.
 * @param {Object} msg
 */
export function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const { ws } of clients.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

/**
 * Get a client record by clientId.
 * @param {string} clientId
 * @returns {{ ws: WebSocket, clientId: string } | undefined}
 */
export function getClient(clientId) {
  return clients.get(clientId);
}

/**
 * Get all connected clients.
 * @returns {Map<string, { ws: WebSocket, clientId: string }>}
 */
export function getAllClients() {
  return clients;
}

/**
 * Close all connected WebSocket clients.
 */
export function disconnectAll() {
  for (const { ws } of clients.values()) {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      ws.close();
    }
  }
}

/**
 * server/src/discovery.js
 *
 * LAN server discovery using UDP broadcast.
 *
 * When hosting, this module broadcasts the server's presence every 2 seconds
 * on the configured DISCOVERY_PORT.  All instances also listen for broadcasts
 * from other servers and maintain a list of discovered servers.
 *
 * Uses Node's built-in `dgram` module (no extra dependencies).
 */

import dgram from "node:dgram";
import os from "node:os";
import { CONSTANTS } from "../../shared/constants.js";

const BROADCAST_INTERVAL = 2000; // ms
const SERVER_TTL = 6000;         // remove after 6 s without a broadcast
const DISCOVERY_PORT = CONSTANTS.DISCOVERY_PORT;

/**
 * @typedef {Object} DiscoveredServer
 * @property {string} name
 * @property {string} host       - IP address
 * @property {number} port       - HTTP port
 * @property {number} playerCount
 * @property {number} maxPlayers
 * @property {number} lastSeen   - Date.now() timestamp
 */

/** @type {Map<string, DiscoveredServer>} keyed by "host:port" */
const discovered = new Map();

/** UDP socket for broadcast/listen */
let socket = null;

/** Interval handle for periodic broadcast */
let broadcastTimer = null;

/** Info getter – called each broadcast to get current state */
let infoGetter = null;

// ── Public API ─────────────────────────────────────────────

/**
 * Start listening for discovery broadcasts from other servers.
 * Always safe to call (idempotent).
 */
export function startListening() {
  if (socket) return;

  socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

  socket.on("message", (buf, rinfo) => {
    try {
      const msg = JSON.parse(buf.toString());
      if (msg._tank_discovery !== 1) return;

      const key = `${rinfo.address}:${msg.port}`;

      // Skip our own broadcasts (check all local IPs)
      const localAddresses = getLocalAddresses();
      if (localAddresses.includes(rinfo.address) && msg.port === infoGetter?.()?.port) {
        return;
      }

      discovered.set(key, {
        name: msg.name,
        host: rinfo.address,
        port: msg.port,
        playerCount: msg.playerCount,
        maxPlayers: msg.maxPlayers,
        lastSeen: Date.now(),
      });
    } catch {
      // ignore malformed packets
    }
  });

  socket.on("error", (err) => {
    console.warn(`[discovery] UDP error: ${err.message}`);
  });

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
    console.log(`[discovery] Listening on UDP port ${DISCOVERY_PORT}`);
  });

  // Periodically prune stale servers
  setInterval(pruneStale, SERVER_TTL);
}

/**
 * Start broadcasting this server's presence.
 *
 * @param {() => { name: string, port: number, playerCount: number, maxPlayers: number }} getInfo
 *   A callback that returns current server info each broadcast tick.
 */
export function startBroadcasting(getInfo) {
  if (broadcastTimer) return;
  infoGetter = getInfo;

  if (!socket) startListening();

  broadcastTimer = setInterval(() => {
    if (!infoGetter) return;
    const info = infoGetter();
    const packet = JSON.stringify({
      _tank_discovery: 1,
      name: info.name,
      port: info.port,
      playerCount: info.playerCount,
      maxPlayers: info.maxPlayers,
    });
    const buf = Buffer.from(packet);
    socket.send(buf, 0, buf.length, DISCOVERY_PORT, "255.255.255.255");
  }, BROADCAST_INTERVAL);

  console.log("[discovery] Broadcasting started");
}

/**
 * Stop broadcasting (but keep listening).
 */
export function stopBroadcasting() {
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
    infoGetter = null;
    console.log("[discovery] Broadcasting stopped");
  }
}

/**
 * Return all currently-known servers on the LAN.
 * @returns {DiscoveredServer[]}
 */
export function getDiscoveredServers() {
  pruneStale();
  return Array.from(discovered.values());
}

/**
 * Get the first non-internal IPv4 address of this machine.
 * @returns {string}
 */
export function getLocalIP() {
  const addrs = getLocalAddresses();
  return addrs[0] || "127.0.0.1";
}

// ── Helpers ────────────────────────────────────────────────

function pruneStale() {
  const now = Date.now();
  for (const [key, srv] of discovered) {
    if (now - srv.lastSeen > SERVER_TTL) {
      discovered.delete(key);
    }
  }
}

function getLocalAddresses() {
  const result = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        result.push(iface.address);
      }
    }
  }
  return result;
}

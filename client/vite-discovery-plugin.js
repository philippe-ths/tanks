/**
 * client/vite-discovery-plugin.js
 *
 * Vite plugin that listens for UDP discovery broadcasts from game servers
 * on the LAN.  Intercepts GET /api/servers so that joiners who only run
 * `npm run dev` (no local game server) still see available hosts without
 * proxy errors flooding the terminal.
 *
 * When the game server IS running locally (port already bound), the plugin
 * falls back silently and lets the normal Vite proxy handle the request.
 */

import dgram from "node:dgram";
import os from "node:os";
import { CONSTANTS } from "../shared/constants.js";

const DISCOVERY_PORT = CONSTANTS.DISCOVERY_PORT; // 41234
const SERVER_TTL = 6000; // ms – drop servers silent longer than this

/** @returns {import("vite").Plugin} */
export default function discoveryPlugin() {
  /** @type {Map<string, {name:string, host:string, port:number, playerCount:number, maxPlayers:number, lastSeen:number}>} */
  const discovered = new Map();

  /** @type {dgram.Socket | null} */
  let socket = null;

  /** Whether we successfully bound the UDP port (= we handle /api/servers). */
  let active = false;

  /** Prune timer */
  let pruneTimer = null;

  // ── helpers ──────────────────────────────────────────────

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

  function pruneStale() {
    const now = Date.now();
    for (const [key, srv] of discovered) {
      if (now - srv.lastSeen > SERVER_TTL) discovered.delete(key);
    }
  }

  function cleanup() {
    if (pruneTimer) clearInterval(pruneTimer);
    pruneTimer = null;
    if (socket) {
      try { socket.close(); } catch { /* ignore */ }
      socket = null;
    }
    active = false;
  }

  // ── Vite plugin ──────────────────────────────────────────

  return {
    name: "tanks-discovery",

    configureServer(server) {
      // 1. Intercept GET /api/servers with middleware (runs before proxy)
      server.middlewares.use((req, res, next) => {
        if (req.method === "GET" && req.url === "/api/servers") {
          if (!active) return next(); // fall through to Vite proxy
          pruneStale();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(Array.from(discovered.values())));
          return;
        }
        next();
      });

      // 2. Create UDP socket for LAN discovery
      socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

      socket.on("message", (buf, rinfo) => {
        try {
          const msg = JSON.parse(buf.toString());
          if (msg._tank_discovery !== 1) return;

          const key = `${rinfo.address}:${msg.port}`;

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
        if (err.code === "EADDRINUSE") {
          console.log("[discovery] Port in use — deferring to game server");
          cleanup();
        } else {
          console.warn(`[discovery] UDP error: ${err.message}`);
        }
      });

      socket.bind(DISCOVERY_PORT, () => {
        socket.setBroadcast(true);
        active = true;
        console.log(`[discovery] Listening for LAN servers on UDP port ${DISCOVERY_PORT}`);
      });

      pruneTimer = setInterval(pruneStale, SERVER_TTL);

      // 3. Cleanup on server close
      server.httpServer?.on("close", cleanup);
    },
  };
}

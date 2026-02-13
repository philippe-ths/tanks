import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { addClient, removeClient, send } from "./connectionManager.js";
import {
  joinLobby, leaveLobby, broadcastLobby,
  getSlotForClient, setCode, getHostSlot,
  setServerName, getServerName, getLobbyInfo,
} from "./lobby.js";
import { tryStartMatch, stopMatch, isMatchRunning } from "./match/matchManager.js";
import { MSG_JOIN, MSG_SUBMIT_TANK, MSG_READY, MSG_RESET_MATCH, MSG_ERROR } from "../../shared/protocol.js";
import { CONSTANTS } from "../../shared/constants.js";
import {
  startListening, startBroadcasting, stopBroadcasting,
  getDiscoveredServers, getLocalIP,
} from "./discovery.js";
import os from "node:os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || "3000", 10);

// ── Server name (from env or default) ─────────────────────
const serverName = process.env.SERVER_NAME || `${os.hostname()}'s Server`;
setServerName(serverName);

// ── Express: serve the built client ────────────────────────
const app = express();
app.use(express.json());

const clientDist = path.resolve(__dirname, "../../client_dist");
app.use(express.static(clientDist));

// ── REST API ───────────────────────────────────────────────

/** Get info about this server */
app.get("/api/info", (_req, res) => {
  const info = getLobbyInfo();
  res.json({
    ...info,
    host: getLocalIP(),
    port: PORT,
    matchRunning: isMatchRunning(),
  });
});

/** List discovered servers on the LAN */
app.get("/api/servers", (_req, res) => {
  res.json(getDiscoveredServers());
});

/** Start hosting (begin broadcasting) */
app.post("/api/host", (req, res) => {
  const name = req.body?.name || getServerName();
  setServerName(name);
  startBroadcasting(() => ({
    name: getServerName(),
    port: PORT,
    ...getLobbyInfo(),
  }));
  res.json({ ok: true, name, host: getLocalIP(), port: PORT });
});

/** Stop hosting (stop broadcasting) */
app.post("/api/stop-host", (_req, res) => {
  stopBroadcasting();
  res.json({ ok: true });
});

// ── HTTP server ────────────────────────────────────────────
const server = createServer(app);

// ── WebSocket server (shares the HTTP server) ──────────────
const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  addClient(ws);
  joinLobby(ws);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(ws, msg);
    } catch {
      console.warn(`[ws] non-JSON message from ${ws.clientId}`);
    }
  });

  ws.on("close", () => {
    const slotName = getSlotForClient(ws.clientId);
    if (slotName !== "spectator" && isMatchRunning()) {
      // In N-player, a disconnect doesn't necessarily end the match.
      // Kill that player's tank if a match is running.
      // stopMatch() would end for everyone – we only do that if
      // there would be fewer than 2 players left, handled by sim.
    }
    leaveLobby(ws);
    removeClient(ws);
  });
});

/**
 * Route an incoming message to the appropriate handler.
 * @param {import("ws").WebSocket} ws
 * @param {Object} msg
 */
function handleMessage(ws, msg) {
  switch (msg.type) {
    case MSG_JOIN:
      console.log(`[msg] join from ${ws.clientId}:`, msg.name);
      break;

    case MSG_SUBMIT_TANK:
      handleSubmitTank(ws, msg);
      break;

    case MSG_READY:
      tryStartMatch(ws);
      break;

    case MSG_RESET_MATCH:
      handleResetMatch(ws);
      break;

    default:
      console.log(`[msg] unknown type "${msg.type}" from ${ws.clientId}`);
  }
}

/**
 * Validate and store a player's submitted tank code.
 * @param {import("ws").WebSocket} ws
 * @param {Object} msg
 */
function handleSubmitTank(ws, msg) {
  const slotName = getSlotForClient(ws.clientId);

  if (slotName === "spectator") {
    send(ws, { type: MSG_ERROR, message: "Spectators cannot submit tank code." });
    return;
  }

  const { tankType, code } = msg;

  if (tankType !== "light" && tankType !== "heavy") {
    send(ws, { type: MSG_ERROR, message: `Invalid tankType "${tankType}". Must be "light" or "heavy".` });
    return;
  }

  if (typeof code !== "string" || code.length === 0) {
    send(ws, { type: MSG_ERROR, message: "Code must be a non-empty string." });
    return;
  }

  if (code.length > CONSTANTS.MAX_CODE_SIZE) {
    send(ws, {
      type: MSG_ERROR,
      message: `Code too large (${code.length} bytes). Max is ${CONSTANTS.MAX_CODE_SIZE} bytes.`,
    });
    return;
  }

  setCode(slotName, tankType, code);
  console.log(`[msg] submitTank from ${ws.clientId} (${slotName}): ${tankType}, ${code.length} bytes`);
  broadcastLobby();
}

/**
 * Handle a reset-match request. Only the host (lowest-numbered slot) can reset.
 * @param {import("ws").WebSocket} ws
 */
function handleResetMatch(ws) {
  const slotName = getSlotForClient(ws.clientId);
  const hostSlot = getHostSlot();

  if (slotName !== hostSlot) {
    send(ws, { type: MSG_ERROR, message: "Only the host can reset the match." });
    return;
  }

  if (!isMatchRunning()) {
    send(ws, { type: MSG_ERROR, message: "No match is currently running." });
    return;
  }

  console.log(`[msg] resetMatch from ${ws.clientId} (${slotName})`);
  stopMatch();
  broadcastLobby();
}

// ── Start listening ────────────────────────────────────────

// Always listen for other servers on the LAN
startListening();

server.listen(PORT, "0.0.0.0", () => {
  const ip = getLocalIP();
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
  console.log(`LAN address: http://${ip}:${PORT}`);
  console.log(`Server name: ${getServerName()}`);
});

export { app, server, wss };

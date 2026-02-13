/**
 * client/src/main.js
 *
 * Entry point for the browser client.
 * Supports three modes:
 *   1. Host – start a game server and open the lobby.
 *   2. Join – discover or manually connect to a remote server.
 *   3. Local Test – run against a built-in bot, no server needed.
 */

import { createRenderer } from "./render/renderer.js";
import { startLocalMatch } from "./local/localMatch.js";

// ── Error toast system ─────────────────────────────────────

const toastContainer = document.getElementById("error-toast-container");

function showToast(title, body = "", level = "error", duration = 6000) {
  if (!toastContainer) return;
  const el = document.createElement("div");
  el.className = `error-toast ${level}`;
  el.innerHTML =
    `<div class="toast-title">${escHtml(title)}</div>` +
    (body ? `<div>${escHtml(body)}</div>` : "");
  toastContainer.appendChild(el);
  console.error(`[${level}] ${title}${body ? " — " + body : ""}`);
  setTimeout(() => {
    el.classList.add("fade-out");
    el.addEventListener("animationend", () => el.remove());
  }, duration);
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── State ──────────────────────────────────────────────────

/** @type {WebSocket|null} */
let ws = null;
let clientId = null;
let slot = null;
let lobbyPlayers = [];
let renderer = null;
let localMatch = null;
let localCode = null;
let discoveryInterval = null;
/** The base URL of the server we're connected to (or our own origin). */
let serverOrigin = location.origin;

// ── DOM elements ───────────────────────────────────────────

const statusEl    = document.getElementById("status");
const landingEl   = document.getElementById("landing");
const lobbyEl     = document.getElementById("lobby");
const lobbyTitle  = document.getElementById("lobby-title");
const yourSlotEl  = document.getElementById("your-slot");
const btnStart    = document.getElementById("btn-start");
const tankFileInput = document.getElementById("tank-file");
const uploadMsgEl = document.getElementById("upload-msg");
const arenaContainer = document.getElementById("arena-container");
const arenaCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById("arena-canvas"));
const btnReset    = document.getElementById("btn-reset");
const btnHost     = document.getElementById("btn-host");
const serverNameInput = document.getElementById("server-name");
const btnJoinManual = document.getElementById("btn-join-manual");
const joinAddressInput = document.getElementById("join-address");
const serverListEl = document.getElementById("server-list");
const btnBack     = document.getElementById("btn-back");
const localFileInput = document.getElementById("local-file");
const localMsgEl  = document.getElementById("local-msg");
const btnLocal    = document.getElementById("btn-local");
const slotTbody   = document.getElementById("slot-tbody");

// ── WebSocket connection ───────────────────────────────────

/**
 * Connect to a server's WebSocket endpoint.
 * @param {string} url  Full WebSocket URL (e.g. ws://192.168.1.5:3000/ws)
 */
function connect(url) {
  disconnect(); // close any existing connection

  setStatus("Connecting…");
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    setStatus("Connected (waiting for lobby…)");
  });

  ws.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch {
      console.warn("[ws] non-JSON message", event.data);
    }
  });

  ws.addEventListener("close", () => {
    setStatus("Disconnected");
    ws = null;
    // Don't auto-reconnect – let user go back to landing
  });

  ws.addEventListener("error", () => {
    console.warn("[ws] connection error");
    showToast("Connection Error", "Could not connect to server.", "warning", 4000);
  });
}

/** Close the current connection if any. */
function disconnect() {
  if (ws) {
    ws.onclose = null; // suppress handler
    ws.close();
    ws = null;
  }
  slot = null;
  clientId = null;
  lobbyPlayers = [];
}

/**
 * Send a JSON message to the server.
 * @param {Object} msg
 */
export function sendMsg(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Message handling ───────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {
    case "hello":
      clientId = msg.clientId;
      slot = msg.slot ?? null;
      setStatus(`Connected — slot: ${slot ?? "spectator"}`);
      console.log("[hello]", msg);
      break;

    case "lobby":
      console.log("[lobby]", msg);
      lobbyPlayers = msg.players ?? [];
      if (msg.serverName && lobbyTitle) {
        lobbyTitle.textContent = `Lobby — ${msg.serverName}`;
      }
      renderLobby();
      if (slot && slot !== "spectator") {
        const me = lobbyPlayers.find((p) => p.slot === slot);
        if (me?.hasCode) {
          showUploadMsg(`✅ Code uploaded (${me.tankType})`, false);
        }
      }
      break;

    case "error":
      console.warn("[error]", msg.message);
      showUploadMsg(`❌ ${msg.message}`, true);
      showToast("Server Error", msg.message);
      break;

    case "matchStart":
      console.log("[matchStart]", msg);
      showArena();
      if (!renderer && arenaCanvas) renderer = createRenderer(arenaCanvas);
      if (renderer) renderer.setMatchInfo(msg);
      break;

    case "state":
      if (renderer) renderer.setState(msg);
      break;

    case "matchEnd":
      console.log("[matchEnd]", msg);
      if (renderer) renderer.setMatchResult(msg);
      if (msg.reason === "forfeit" && msg.detail) {
        showToast("Player Forfeited", msg.detail, "warning", 5000);
      }
      const delay = msg.reason === "aborted" ? 500 : 4000;
      setTimeout(() => returnToLobby(), delay);
      break;
  }
}

// ── UI state transitions ──────────────────────────────────

function setStatus(text) {
  if (statusEl) statusEl.textContent = text;
}

function showLanding() {
  disconnect();
  if (landingEl) landingEl.classList.remove("hidden");
  if (lobbyEl) lobbyEl.classList.add("hidden");
  if (arenaContainer) arenaContainer.classList.add("hidden");
  setStatus("");
  startDiscovery();
}

function showLobby() {
  if (landingEl) landingEl.classList.add("hidden");
  if (lobbyEl) lobbyEl.classList.remove("hidden");
  if (arenaContainer) arenaContainer.classList.add("hidden");
  stopDiscovery();
}

function showArena() {
  if (landingEl) landingEl.classList.add("hidden");
  if (lobbyEl) lobbyEl.classList.add("hidden");
  if (arenaContainer) arenaContainer.classList.remove("hidden");
}

function returnToLobby() {
  if (renderer) { renderer.stop(); renderer = null; }
  if (arenaContainer) arenaContainer.classList.add("hidden");
  // If we have a live WS, go to lobby; otherwise go to landing
  if (ws && ws.readyState === WebSocket.OPEN) {
    showLobby();
  } else {
    showLanding();
  }
}

// ── Dynamic lobby rendering ────────────────────────────────

function renderLobby() {
  if (!lobbyEl || !slotTbody) return;
  lobbyEl.classList.remove("hidden");

  if (yourSlotEl) {
    yourSlotEl.textContent = slot
      ? `You are: ${slot.toUpperCase()}`
      : "You are: spectator";
  }

  // Rebuild table body
  slotTbody.innerHTML = "";
  for (const p of lobbyPlayers) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.slot.toUpperCase()}</td>
      <td>${escHtml(p.name)}</td>
      <td>${p.hasCode ? "✅" : "❌"}</td>
      <td>${p.tankType ?? "—"}</td>
    `;
    slotTbody.appendChild(tr);
  }

  // Enable start when ≥ 2 players have code
  const readyCount = lobbyPlayers.filter((p) => p.hasCode).length;
  if (btnStart) btnStart.disabled = readyCount < 2;
}

// ── Host flow ──────────────────────────────────────────────

if (btnHost) {
  btnHost.addEventListener("click", async () => {
    const name = serverNameInput?.value.trim() || "My Server";
    try {
      const res = await fetch("/api/host", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      console.log("[host]", data);
      serverOrigin = location.origin;

      // Connect own WS
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      connect(`${proto}//${location.host}/ws`);
      showLobby();
    } catch (err) {
      showToast("Host Error", err.message);
    }
  });
}

// ── Join flow ──────────────────────────────────────────────

if (btnJoinManual) {
  btnJoinManual.addEventListener("click", () => {
    const addr = joinAddressInput?.value.trim();
    if (!addr) return;
    joinServer(addr);
  });
}

/**
 * Connect to a remote server by its address ("host:port" or full URL).
 * @param {string} addr
 */
function joinServer(addr) {
  // Normalise to host:port
  let host = addr.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host.includes(":")) host += ":3000";

  serverOrigin = `http://${host}`;
  const wsUrl = `ws://${host}/ws`;
  connect(wsUrl);
  showLobby();
}

// ── Server discovery ──────────────────────────────────────

function startDiscovery() {
  stopDiscovery();
  pollServers(); // immediate first poll
  discoveryInterval = setInterval(pollServers, 3000);
}

function stopDiscovery() {
  if (discoveryInterval) {
    clearInterval(discoveryInterval);
    discoveryInterval = null;
  }
}

async function pollServers() {
  try {
    const res = await fetch("/api/servers");
    const servers = await res.json();
    renderServerList(servers);
  } catch {
    // We might not have a local server running – that's OK
    if (serverListEl) {
      serverListEl.innerHTML = `<p class="hint">No local server detected. Enter an address manually.</p>`;
    }
  }
}

function renderServerList(servers) {
  if (!serverListEl) return;
  if (!servers || servers.length === 0) {
    serverListEl.innerHTML = `<p class="hint">No servers found on the network yet…</p>`;
    return;
  }
  serverListEl.innerHTML = "";
  for (const s of servers) {
    const btn = document.createElement("button");
    btn.className = "server-entry";
    btn.innerHTML = `
      <span class="server-name">${escHtml(s.name)}</span>
      <span class="server-info">${s.host}:${s.port} · ${s.playerCount}/${s.maxPlayers} players</span>
    `;
    btn.addEventListener("click", () => joinServer(`${s.host}:${s.port}`));
    serverListEl.appendChild(btn);
  }
}

// ── File upload (lobby) ───────────────────────────────────

/**
 * Extract `tankType` from a tank.js source string.
 * Looks for: export const tankType = "light" (or 'light' or "heavy" / 'heavy')
 * @param {string} code
 * @returns {string} "light" or "heavy"
 */
function parseTankType(code) {
  const m = code.match(/export\s+const\s+tankType\s*=\s*["']([^"']+)["']/);
  if (!m) throw new Error('Missing tankType export. Expected: export const tankType = "light" or "heavy"');
  const t = m[1];
  if (t !== "light" && t !== "heavy") {
    throw new Error(`Invalid tankType "${t}". Must be "light" or "heavy".`);
  }
  return t;
}

if (tankFileInput) {
  tankFileInput.addEventListener("change", async () => {
    const file = tankFileInput.files?.[0];
    if (!file) return;
    try {
      const code = await file.text();
      const tankType = parseTankType(code);
      sendMsg({ type: "submitTank", tankType, code });
      showUploadMsg("Uploading…", false);
    } catch (err) {
      showUploadMsg(`❌ ${err.message}`, true);
    }
  });
}

function showUploadMsg(text, isError) {
  if (!uploadMsgEl) return;
  uploadMsgEl.textContent = text;
  uploadMsgEl.classList.toggle("error", isError);
  uploadMsgEl.classList.toggle("success", !isError);
}

// ── Start / Reset buttons ─────────────────────────────────

if (btnStart) {
  btnStart.addEventListener("click", () => sendMsg({ type: "ready" }));
}

if (btnReset) {
  btnReset.addEventListener("click", () => {
    if (localMatch) {
      localMatch.stop();
      localMatch = null;
      returnToLobby();
      return;
    }
    sendMsg({ type: "resetMatch" });
  });
}

if (btnBack) {
  btnBack.addEventListener("click", () => showLanding());
}

// ── Local test mode ────────────────────────────────────────

// ── Local test mode ────────────────────────────────────────

/** @type {{ name: string, code: string }[]} */
let customBots = [];
let opponentMode = "bot"; // "bot" | "custom"

const botFilesInput = document.getElementById("bot-files");
const botListEl = document.getElementById("bot-list");
const botMsgEl = document.getElementById("bot-msg");
const customBotsSection = document.getElementById("custom-bots-section");
const opponentRadios = document.querySelectorAll('input[name="opponent-mode"]');

// ── Opponent mode toggle ───────────────────────────────────

for (const radio of opponentRadios) {
  radio.addEventListener("change", (e) => {
    opponentMode = /** @type {HTMLInputElement} */ (e.target).value;
    if (customBotsSection) {
      customBotsSection.classList.toggle("hidden", opponentMode !== "custom");
    }
    if (btnLocal) {
      btnLocal.textContent =
        opponentMode === "custom" ? "Run Match" : "Run vs Bot";
    }
    updateLocalButton();
  });
}

// ── Player file input ──────────────────────────────────────

if (localFileInput) {
  localFileInput.addEventListener("change", async () => {
    const file = localFileInput.files?.[0];
    if (!file) return;
    try {
      localCode = await file.text();
      showLocalMsg(`Loaded ${file.name} (${localCode.length} bytes)`, false);
    } catch (err) {
      showLocalMsg(`❌ Failed to read file: ${err.message}`, true);
      localCode = null;
    }
    updateLocalButton();
  });
}

// ── Bot file input (multi) ─────────────────────────────────

if (botFilesInput) {
  botFilesInput.addEventListener("change", async () => {
    const files = botFilesInput.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      try {
        const code = await file.text();
        // Validate that it parses (has tankType + loop)
        // We do a quick regex check here; full validation happens at match start
        if (!/export\s+const\s+tankType/.test(code)) {
          showBotMsg(`❌ ${file.name}: missing tankType export`, true);
          continue;
        }
        customBots.push({ name: file.name, code });
      } catch (err) {
        showBotMsg(`❌ Failed to read ${file.name}: ${err.message}`, true);
      }
    }

    // Clear the input so the same file(s) can be re-added
    botFilesInput.value = "";
    renderBotList();
    updateLocalButton();
  });
}

function renderBotList() {
  if (!botListEl) return;
  botListEl.innerHTML = "";
  for (let i = 0; i < customBots.length; i++) {
    const bot = customBots[i];
    const li = document.createElement("li");

    // Extract tank type for display
    const typeMatch = bot.code.match(/export\s+const\s+tankType\s*=\s*["']([^"']+)["']/);
    const typeLabel = typeMatch ? typeMatch[1] : "?";

    li.innerHTML = `
      <span><span class="bot-name">${escHtml(bot.name)}</span><span class="bot-type">(${escHtml(typeLabel)})</span></span>
    `;
    const btn = document.createElement("button");
    btn.className = "btn-remove";
    btn.textContent = "✕";
    btn.title = "Remove";
    btn.addEventListener("click", () => {
      customBots.splice(i, 1);
      renderBotList();
      updateLocalButton();
    });
    li.appendChild(btn);
    botListEl.appendChild(li);
  }
  if (customBots.length > 0) {
    showBotMsg(`${customBots.length} bot${customBots.length > 1 ? "s" : ""} loaded`, false);
  } else {
    showBotMsg("", false);
  }
}

function updateLocalButton() {
  if (!btnLocal) return;
  if (!localCode) {
    btnLocal.disabled = true;
    return;
  }
  if (opponentMode === "custom") {
    // Need at least 1 custom bot (2 total participants)
    btnLocal.disabled = customBots.length < 1;
  } else {
    btnLocal.disabled = false;
  }
}

function showBotMsg(text, isError) {
  if (!botMsgEl) return;
  botMsgEl.textContent = text;
  botMsgEl.classList.toggle("error", isError);
  botMsgEl.classList.toggle("success", !isError);
}

// ── Run local match ────────────────────────────────────────

if (btnLocal) {
  btnLocal.addEventListener("click", () => {
    if (!localCode) return;
    if (localMatch) { localMatch.stop(); localMatch = null; }

    showArena();
    if (!renderer && arenaCanvas) renderer = createRenderer(arenaCanvas);

    const matchOptions = {};
    if (opponentMode === "custom" && customBots.length > 0) {
      matchOptions.opponents = customBots.map((b) => b.code);
    }

    try {
      localMatch = startLocalMatch(localCode, {
        onMatchStart(info) { if (renderer) renderer.setMatchInfo(info); },
        onState(snapshot) { if (renderer) renderer.setState(snapshot); },
        onMatchEnd(result) {
          console.log("[local] matchEnd", result);
          if (renderer) renderer.setMatchResult(result);
          if (result.reason === "forfeit" && result.detail) {
            showToast("Player Error", result.detail, "warning", 5000);
          }
          const d = result.reason === "aborted" ? 500 : 4000;
          setTimeout(() => { returnToLobby(); localMatch = null; }, d);
        },
        onLog(slotName, msg) { console.log(`[${slotName}] ${msg}`); },
        onError(slotName, msg) { showToast(`${slotName.toUpperCase()} Runtime Error`, msg); },
      }, matchOptions);
      showLocalMsg("", false);
    } catch (err) {
      console.error("[local] Failed to start match:", err);
      showLocalMsg(`❌ ${err.message}`, true);
      const msg = err.message || String(err);
      if (msg.includes("tankType")) {
        showToast("Invalid Tank Type", msg + '\nExpected: export const tankType = "light" or "heavy"');
      } else if (msg.includes("Missing loop function")) {
        showToast("Missing loop()", msg);
      } else {
        showToast("Code Error", msg);
      }
      showLanding();
    }
  });
}

function showLocalMsg(text, isError) {
  if (!localMsgEl) return;
  localMsgEl.textContent = text;
  localMsgEl.classList.toggle("error", isError);
  localMsgEl.classList.toggle("success", !isError);
}

// ── Boot ───────────────────────────────────────────────────

showLanding();

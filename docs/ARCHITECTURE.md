# Architecture

This app is a top-down “programmable tank” game for learning entry-level coding. Players edit **one file** (`player/tank.js`) and can:

- **Test locally** vs a bot
- **Play LAN multiplayer** (same Wi-Fi) by joining a host server

The **host server is authoritative**: it runs the simulation and streams state to connected clients for rendering.

---

## Goals

- Real code editing experience (syntax highlighting, real `if`, functions)
- Simple tank API: `tank.turnLeft()`, `tank.scan(a,b)`, `tank.shoot()`, etc.
- Deterministic, fair simulation for head-to-head matches
- Minimal setup for players (LAN play; no port forwarding)

---

## Non-Goals (v1)

- Internet matchmaking
- Complex physics and map obstacles (walls/LOS)
- Running arbitrary untrusted code on public infrastructure

---

## High-Level Components

### 1) Host Server (Node.js)
**Responsibilities**
- Serves the client web app over HTTP
- Accepts WebSocket connections from players
- Receives each player’s `tank.js` content (upload)
- Runs the authoritative simulation loop
- Broadcasts game state snapshots to clients

**Suggested modules**
- `http/` static hosting (Express or similar)
- `ws/` WebSocket server (e.g., `ws`)
- `match/` lobby + match start/end orchestration
- `sim/` world state + physics + actions + scanning
- `runtime/` executes player `tank.js` against a restricted Tank API

---

### 2) Client (Browser)
**Responsibilities**
- Connect to host via WebSocket
- Upload local `tank.js` (and/or paste in UI)
- Render top-down match (Canvas)
- Show HUD (HP, tank types, match status)
- Provide local test mode (run simulation locally without server)

**Suggested modules**
- `net/` WebSocket client + message handling
- `render/` Canvas renderer + camera scaling
- `ui/` lobby, upload, start match, errors
- `local/` local simulation mode and bot opponent

---

### 3) Shared (Protocol + Constants)
**Responsibilities**
- Message definitions (join, submitTank, lobby, matchStart, state, matchEnd)
- Gameplay constants (speeds, HP, projectile stats, scan range)
- Utilities (angle normalize, distance, arc checks)

---

## Data Flow

### LAN Multiplayer (Same Wi-Fi)
1. Host runs: `npm run host`
2. Players open: `http://HOST_IP:3000`
3. Each player uploads their `player/tank.js`
4. Server validates code, assigns player slots, and starts the match
5. Server simulates and broadcasts state frames to clients
6. Clients render frames; server declares winner

### Local Test Mode
1. Player edits `player/tank.js`
2. Runs client locally: `npm run dev`
3. Click “Test Locally”
4. Browser runs simulation + tank code locally (no networking)

---

## Player Code Execution Model

Players export:

- `export const tankType = "light" | "heavy";`
- `export default async function loop(tank) { ... }`

The engine repeatedly calls `loop(tank)`:

- **Timed actions** must be awaited (each consumes **1.0 second** of game time):
  - `await tank.turnLeft()`
  - `await tank.turnRight()`
  - `await tank.moveForward()`
  - `await tank.moveBackward()`
  - `await tank.scan(aDeg, bDeg)` → returns `true/false`
- **Instant action**:
  - `tank.shoot()` (spawns projectile if none active for that tank)

Core constraints enforced by engine:
- One timed action at a time (awaited actions serialize naturally)
- One projectile per tank at a time (shoot does nothing if one exists)

Players do **not** get direct access to world state (positions/HP/etc.). The only sensor in v1 is `scan()` returning a boolean.

---

## Determinism Strategy

- Use a fixed internal simulation tick (e.g., 60Hz)
- Timed actions last exactly 1.0 seconds (60 ticks)
- Scans resolve based on world state **when the scan completes**
- Projectiles move deterministically per tick
- Server is authoritative; clients are render-only

To ensure fair matches:
- Use a seeded deterministic PRNG for initial spawns (server sends seed on `matchStart`)

---

## Stability and Safety (LAN-Friendly, Still Required)

Even on LAN, someone will accidentally write a bad loop. Prevent lockups:

- Run player code in isolation:
  - Server: worker thread or child process per player runtime
  - Client local test: Web Worker
- Enforce budgets:
  - Max wall-clock time per `loop()` call
  - Kill/forfeit if the player runtime hangs or exceeds limits
- Restrict what player code can access:
  - No filesystem/network access from inside the tank runtime
  - Only the Tank API is exposed

---

## Suggested Repository Layout

/
  README.md
  docs/
    ARCHITECTURE.md
    SPEC.md
    PROMPTS.md
  server/
    src/
      index.js
      match/
      sim/
      runtime/
  client/
    src/
      main.js
      net/
      render/
      ui/
      local/
  shared/
    constants.js
    protocol.js
  player/
    tank.js

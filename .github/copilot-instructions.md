# Copilot Instructions — Tanks

## Project Overview
A top-down tank coding game where players write JavaScript (`player/tank.js`) to control a tank via a small async API. Supports LAN multiplayer (authoritative Node server) and browser-only local test mode (vs bot). No frameworks — vanilla JS, Canvas rendering, ESM everywhere.

## Architecture

### Module Layout
- **`shared/`** — Environment-agnostic sim engine, constants, protocol. Imported by both server and client.
- **`server/`** — Express + `ws` WebSocket server. Runs player code via `node:vm`. No build step.
- **`client/`** — Vite SPA. Canvas renderer, lobby UI, local test mode. Builds to `../client_dist/`.
- **`player/`** — Example tank files. Each exports `tankType` and `loop(tank)`.

### Sim Engine (`shared/sim/`)
The simulation is the core of the project. Key files:
- `world.js` — `createWorld(seed, constants, players)` factory; tanks keyed by slot string (`"p1"`, `"p2"`, …)
- `step.js` — Single-tick advancement: actions → projectile movement → hit detection → match-end check
- `actions.js` — Timed action system: `turnLeft/Right`, `moveForward/Backward`, `scan`; smooth per-tick interpolation with `busyUntil` + `activeAction`
- `loop.js` — Fixed-timestep game loop (60 Hz), auto-detects browser (rAF) vs Node (setTimeout)
- `scan.js` — Arc-based detection: clockwise from `aDeg` to `bDeg` relative to heading

**Important**: `server/src/sim/` contains copies of `shared/sim/`. When modifying sim logic, update **both** locations to keep them in sync.

### Action Resolution Pattern (Critical)
The bridge between sim-time and async player code:
1. Player calls `await tank.moveForward()` → sim marks tank busy, a Promise is returned
2. The resolve callback is stored via `_pendingResolve` closure on the tankApi object
3. Sim ticks forward; when `busyUntil` is reached, `applyActiveActions()` emits `actionComplete` event
4. `actionResolver` scans events, calls `_resolvePending()` → Promise resolves → player `await` completes

This pattern is implemented twice: `server/src/runtime/` (vm + worker-like) and `client/src/local/` (Function constructor).

### Player Code Execution
- **Server**: `runPlayer.js` — `node:vm` sandbox. ESM syntax is regex-transformed to CJS-like assignments (`transformESM()`). Sandboxed globals: no `require`, `process`, `fs`, `setTimeout`. 5s wall-clock timeout per `loop()` call.
- **Client local**: `localRunner.js` — `new Function()` with same ESM transform. Adds `yieldFrame()` (setTimeout(0)) between loop iterations to avoid blocking the browser.

### Networking
- WebSocket (JSON, no binary). Protocol constants in `shared/protocol.js`.
- Client→Server: `join`, `submitTank`, `ready`, `resetMatch`
- Server→Client: `hello`, `lobby`, `matchStart`, `state` (20 Hz), `matchEnd`, `error`
- LAN discovery: UDP broadcast on port 41234 via `dgram` (`server/src/discovery.js`)
- Vite dev proxy: `/ws` and `/api` forward to `localhost:3000`

## Conventions

### Code Style
- **Pure ESM** — `"type": "module"` in all `package.json` files. Always use `.js` extensions in imports.
- **No TypeScript** — JSDoc `@typedef`, `@param`, `@returns` for type documentation.
- **No classes** — Functional style with factory functions: `createWorld()`, `createRenderer()`, `createTankApi()`, `createPRNG()`.
- **Named exports only** — except player code's `export default async function loop(tank)`.

### Naming
- Slots: string keys `"p1"` through `"p8"`, not numeric indices.
- Angles: `headingDeg`, 0° = east, clockwise positive.
- Time: `world.t` in seconds, `DT = 1/TICK_RATE` (1/60).
- Constants: frozen object `CONSTANTS` in `shared/constants.js` with computed getter for `DT`.

### Error Handling
- Player runtime errors set that tank's HP to 0 (forfeit) instead of crashing the match.
- WS parse errors are logged as warnings, never fatal.
- Runtime timeout (5s wall-clock) → forfeit for that player.

## Dev Workflow

```bash
npm install                # install all workspaces
npm run host               # start server on 0.0.0.0:3000 (serves client_dist/)
npm run dev                # Vite dev server on :5173 (proxies /ws, /api to :3000)
npm run build              # build client to client_dist/
```

**Dev mode requires both processes**: game server on :3000 AND Vite on :5173. Access via `localhost:5173`.

No test framework, linter, or CI is configured.

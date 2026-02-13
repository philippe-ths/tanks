# docs/PROMPTS.md

# Prompts for Copilot (Bite-Size Build Plan)

Use these prompts in order. Each prompt is designed to be achievable in one sitting and keep Copilot focused.

**Assumptions**
- Web client (Canvas) + Node.js host server (LAN).
- Players write one file: `player/tank.js`.
- Timed actions are awaited (each takes **1 second of game time**).
- `shoot()` is instant but limited to **one active projectile per tank**.
- LAN only (same Wi-Fi). No internet matchmaking in v1.

---

## 0) Repo scaffolding

1) **Prompt:**  
“Create the repo layout: `server/`, `client/`, `shared/`, `player/`, `docs/`. Add root `README.md`, `docs/ARCHITECTURE.md`, `docs/SPEC.md`, `docs/PROMPTS.md`.”

2) **Prompt:**  
“Create a root `package.json` using npm workspaces for `server` and `client`. Add scripts: `host`, `dev`, `build`, `preview` (wire them up later).”

3) **Prompt:**  
“In `shared/constants.js`, define v1 constants: arena size, scan range, tank stats (light/heavy), projectile stats, tick rate. Export a single `CONSTANTS` object.”

4) **Prompt:**  
“In `shared/protocol.js`, define string constants for message types and add JSdoc for each payload shape (`join`, `submitTank`, `lobby`, `matchStart`, `state`, `matchEnd`, `error`). Export them.”

---

## 1) Server: HTTP + WebSocket skeleton

5) **Prompt:**  
“Implement `server/src/index.js` as an HTTP server (Express) that serves static files from a `client_dist/` folder and starts a WebSocket server using `ws`. Listen on `0.0.0.0:3000`.”

6) **Prompt:**  
“Add a basic WebSocket connection manager: track clients, assign each a `clientId`, and log connect/disconnect. Send a `hello` message on connect (temporary).”

7) **Prompt:**  
“Implement server lobby state: allow up to 2 players (`p1`, `p2`). On connect assign a slot if available, otherwise mark as spectator. Broadcast a `lobby` message on any lobby change.”

---

## 2) Client: connect + lobby UI

8) **Prompt:**  
“Create a minimal browser client in `client/src/` (Vite recommended). On load, connect to WebSocket server at the same host/port. Display connection status.”

9) **Prompt:**  
“Implement client handling of `lobby` messages and show a simple lobby UI: your slot (p1/p2/spectator), whether each slot has submitted code, and a start button (disabled until both submitted).”

---

## 3) Tank file upload flow

10) **Prompt:**  
“In the client, add a file picker that lets a user select `tank.js`, read it as text, and send `{ type:'submitTank', tankType, code }` to the server.”

11) **Prompt:**  
“On the server, implement `submitTank` validation:  
- tankType must be `light` or `heavy`  
- code must be under a max size (e.g., 50KB)  
Store code per slot and broadcast updated lobby. Send `error` message on failure.”

12) **Prompt:**  
“In the client, add UI for tankType selection (light/heavy) and show upload success/error messages.”

---

## 4) Simulation: world state + tick loop

13) **Prompt:**  
“Create `server/src/sim/world.js` defining the world state:  
- time `t`  
- tanks: pose (x,y,heading), hp, type, busyUntil, activeProjectileId  
- projectiles: owner, x,y, vx,vy  
Add `createWorld(seed, constants)` and `resetWorld()`.”

14) **Prompt:**  
“Create a deterministic PRNG (`server/src/sim/prng.js`) using a seed. Use it to choose initial spawn positions and headings for both tanks.”

15) **Prompt:**  
“Create `server/src/sim/step.js` that advances the simulation by one fixed tick (dt=1/60):  
- move projectiles  
- despawn out-of-bounds projectiles  
- detect projectile hits on tanks and apply damage  
- detect match end (hp <= 0)  
Return events (hit, despawn, matchEnd).”

16) **Prompt:**  
“Create `server/src/sim/loop.js` to run the step loop at 60Hz and provide a way to start/stop a match loop cleanly.”

---

## 5) Tank actions: movement + turning + busy time

17) **Prompt:**  
“In `server/src/sim/actions.js`, implement timed actions that take exactly 1.0s of sim time: `turnLeft`, `turnRight`, `moveForward`, `moveBackward`, and `scan(a,b)`.  
Decide: apply motion/turning smoothly over the second (recommended) and document it in code comments.”

18) **Prompt:**  
“Implement tank busy logic: a tank cannot start a timed action if `now < busyUntil`. When an action starts, set `busyUntil = now + 1.0` and store action info so it can be applied during ticks.”

19) **Prompt:**  
“Implement smooth action application during ticks: each tick, if a tank has an active action, apply a fraction of movement/turn for that tick until the 1.0s completes.”

---

## 6) Scanning geometry

20) **Prompt:**  
“Implement `server/src/sim/scan.js`: given `tankPose`, `opponentPose`, `aDeg`, `bDeg`, range, determine if opponent is within the scan arc (relative to tank heading) and within range. Handle wrap-around arcs (e.g., 170..-170). Add several inline tests/examples in comments.”

21) **Prompt:**  
“Wire scan into actions: `scan(a,b)` is a timed action that resolves at the end of the 1.0s. Store the boolean scan result somewhere per tank (internal only) so the Promise can resolve.”

---

## 7) Shooting + projectile limit

22) **Prompt:**  
“Implement `shoot()` as an instant action: spawn a projectile if the tank has no active projectile. Projectile inherits tank heading direction. Return boolean fired/not-fired.  
Ensure: only one projectile exists per tank at a time.”

23) **Prompt:**  
“On projectile hit or despawn, clear the owner tank’s `activeProjectileId` so it can fire again.”

---

## 8) Player runtime: execute `player/tank.js`

24) **Prompt:**  
“Define the server-side Tank API object used by player code (`server/src/runtime/tankApi.js`).  
Methods: `turnLeft`, `turnRight`, `moveForward`, `moveBackward`, `scan(a,b)`, `shoot()`, `log(msg)`, `random()`.  
Timed methods return Promises that resolve when the timed action completes in simulation time.”

25) **Prompt:**  
“Implement `server/src/runtime/runPlayer.js` to load a code string and execute it safely:  
- Expect `export default async function loop(tank) {}` and `export const tankType = ...`  
- Call `loop(tank)` repeatedly (await it each time)  
- Enforce a wall-clock timeout per `loop()` call (kill/forfeit on hang)  
Start simple: run each player in a Worker Thread or child process to prevent server lockups.”

26) **Prompt:**  
“Connect the Tank API promises to simulation time: when a timed action starts, the Promise should resolve only when the action finishes at `busyUntil`. For `scan`, resolve the boolean result at completion.”

---

## 9) Match orchestration + broadcasting

27) **Prompt:**  
“Create `server/src/match/matchManager.js`: when both players have submitted code, start a match:  
- pick seed  
- create world  
- start sim loop  
- start both player runtimes  
- broadcast `matchStart` with seed and constants  
On match end, broadcast `matchEnd` and stop runtimes/loop.”

28) **Prompt:**  
“Broadcast `state` snapshots to clients at a lower rate (e.g., 10–20Hz). The sim still runs at 60Hz. Keep payload minimal: tank poses, hp, tank types, projectile positions.”

---

## 10) Client rendering (Canvas)

29) **Prompt:**  
“Implement Canvas rendering in `client/src/render/renderer.js`: draw arena bounds, tanks, and projectiles from the latest `state` message. Render tanks as rotated triangles or rectangles.”

30) **Prompt:**  
“Add a HUD: show HP for both tanks, tank types, and match status (running/winner).”

---

## 11) Local test mode (no server)

31) **Prompt:**  
“Implement local test mode in the client: reuse the same simulation logic in-browser (copy sim modules to `shared/` or make a client sim). Load local `player/tank.js` and run it vs a simple built-in bot tank.”

32) **Prompt:**  
“Write a basic bot in `client/src/local/bot.js`: alternate between scanning wide arcs and moving forward; shoot when scan returns true.”

---

## 12) Guardrails + polish

33) **Prompt:**  
“Add friendly error reporting: tank code syntax errors, runtime timeouts, invalid tankType, connection errors. Display them in the UI and log to console.”

34) **Prompt:**  
“Add a ‘Reset Match’ button for the host that stops the current match and returns to lobby state cleanly.”

35) **Prompt:**  
“Add a replay option: server stores a list of state frames and offers a JSON download at match end.”

---

## Definition of Done (v1)

- Players edit only `player/tank.js`
- Local test works (tank vs bot)
- LAN match works (host + 1 opponent) with authoritative server
- Timed actions take 1.0 second of game time via `await`
- `shoot()` is instant but limited to one projectile active per tank
- `scan(a,b)` uses relative angles, unlimited arc width, and returns boolean
- UI shows match, HP, and winner

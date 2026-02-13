# Spec

## Summary

A top-down tank programming game. Players control a tank by writing JavaScript in a single file (`player/tank.js`) using a small Tank API. The game supports:

- **Local test**: run your tank vs a bot on one machine
- **LAN multiplayer**: host runs a Node server; others join on the same Wi-Fi

The **server is authoritative** in LAN mode: it runs the simulation and broadcasts state to clients for rendering.

---

## Core Rules

### Tank Types
Each player chooses one:

- **Light**
  - Faster movement
  - Lower HP
- **Heavy**
  - Slower movement
  - Higher HP

### Timing Model
- The simulation runs at a fixed internal tick rate (recommended: **60 Hz**).
- Some Tank API calls are **timed actions** that take **1.0 second of game time**.
- Timed actions must be awaited (`await`), enforcing “one action at a time”.
- `shoot()` is **instant** (no 1.0s cost), but is limited by “one projectile active”.

### Constraints
- A tank can only perform **one timed action at a time**.
- Each tank can have **only one active projectile** at a time.
  - If the player calls `shoot()` while a projectile from that tank still exists, it does nothing.

---

## Win Conditions

- Primary: opponent HP reaches **0** → win
- Optional: match time limit (e.g., 180 seconds)
  - If time limit reached: higher HP wins; tie = draw

---

## World / Coordinates

- 2D top-down arena rectangle.
- Units are arbitrary (pixels or “world units”), but consistent across server/client.
- Tank pose:
  - position `(x, y)`
  - heading angle `headingDeg` (0–360)
- Choose and document an angle convention (recommended):
  - `0°` points right (east)
  - positive degrees rotate clockwise
- Arena bounds:
  - Tanks are clamped inside arena
  - Projectiles despawn when leaving arena

---

## Player File: `player/tank.js`

Players edit one file.

### Required Exports

```js
export const tankType = "light"; // or "heavy"

export const config = {
  mode: "local",          // "local" | "lan"
  host: "192.168.0.10",   // LAN host IP (only used if mode==="lan")
  port: 3000
};

export default async function loop(tank) {
  // Your tank logic goes here
}
```

Notes:
- `loop(tank)` is called repeatedly by the engine.
- The engine calls `loop()` again only after the previous call completes.
- Players do not receive direct state (positions/HP/etc.). The only sensor is scan.

---

## Tank API (Player-Facing)

### Timed actions (each takes 1.0 second of game time)
Must be awaited:

- `await tank.turnLeft()`
- `await tank.turnRight()`
- `await tank.moveForward()`
- `await tank.moveBackward()`
- `await tank.scan(aDeg, bDeg) -> boolean`

### Instant action (no 1.0 second cost)
- `tank.shoot() -> boolean`
  - Returns `true` if a projectile was spawned, `false` if blocked by projectile limit.

### Optional helper methods (safe + useful)
- `tank.log(message: string)`  
  Sends debug output to the host/client console.
- `tank.random() -> number`  
  Deterministic PRNG value in `[0,1)` (server-seeded) for fair randomness.

---

## Actions: Detailed Behavior

### Turning
- `turnLeft()` / `turnRight()` are timed actions (1.0s).
- Turning amount is hardcoded by the engine (no parameters).
- The change in heading can be applied:
  - smoothly over the 1 second (recommended), or
  - instantly at the end of the 1 second (simpler)
- Choose one approach and keep it consistent everywhere.

### Movement
- `moveForward()` / `moveBackward()` are timed actions (1.0s).
- Distance is hardcoded by the engine (no parameters).
- Movement should occur in the direction of current heading.
- Tank remains within bounds (clamp).

### Scanning
- `await tank.scan(aDeg, bDeg)` is a timed action (1.0s).
- Angles are **relative to current tank heading** at the time the scan runs.
- Arc width has **no limit** in v1 (players can scan wide arcs like `0..180`).
- Scan has a fixed maximum range (constant).
- At scan completion, compute whether opponent is within arc + range.
- Returns:
  - `true` if opponent detected
  - `false` otherwise
- No cooldown.

### Shooting
- `tank.shoot()` spawns a projectile instantly if allowed.
- If a projectile from that tank already exists, the call does nothing and returns `false`.
- Projectile:
  - Moves at constant speed per tick
  - Collides with opponent tank (hit) or despawns when leaving arena
  - On hit: reduce opponent HP by fixed damage; despawn projectile

---

## Collision Model (v1)

- Tank collision:
  - Minimal: tanks can pass through each other (acceptable for v1), or
  - Simple: prevent overlap by pushing apart (optional)
- Projectile collision:
  - Circle vs circle (projectile radius vs tank radius) is sufficient

---

## Determinism Requirements

- Server must simulate with fixed timestep and consistent math.
- Use seeded PRNG for any randomness (spawns, optional bot behavior).
- Clients do not simulate authoritative state in LAN mode; they render server snapshots.

---

## Networking (LAN)

### Transport
- WebSocket (JSON messages)

### Message Types (suggested)

Client → Server
- `join`: `{ type: "join", name: string }`
- `submitTank`: `{ type: "submitTank", tankType: "light"|"heavy", code: string }`
- `ready`: `{ type: "ready" }`

Server → Client
- `lobby`: `{ type: "lobby", players: Array<{slot:"p1"|"p2", name:string, hasCode:boolean, tankType?:string}> }`
- `matchStart`: `{ type: "matchStart", seed: number, constants: object }`
- `state`: `{ type: "state", t: number, tanks: [...], projectiles: [...] }`
- `matchEnd`: `{ type: "matchEnd", winner: "p1"|"p2"|null, reason: string }`
- `error`: `{ type: "error", message: string }`

### State Payload (minimum)
- `tanks`: for each tank
  - id/slot
  - x, y
  - headingDeg
  - hp
  - tankType
- `projectiles`: for each projectile
  - owner slot
  - x, y
  - headingDeg (or vx/vy)

Broadcast cadence:
- Simulate at 60Hz
- Broadcast state at 10–20Hz (to reduce bandwidth)

---

## Runtime Safety / Timeouts

Even on LAN, prevent accidental hangs:

- Run each player’s code in isolation (Worker Thread / child process).
- Enforce:
  - Max wall-clock time per `loop()` invocation
  - Max code size
- If a runtime errors or times out:
  - Declare forfeit (or stop its tank and let match continue)

---

## Suggested Default Constants (Tune Later)

Place these in `shared/constants.js`.

- Arena: 1200 x 800
- Scan range: 700
- Tank radius: 18
- Projectile radius: 4
- Projectile speed: 420 units/sec
- Projectile damage: 20
- Light:
  - HP: 60
  - Move speed: 160 units/sec
  - Turn rate: 120 deg/sec
- Heavy:
  - HP: 120
  - Move speed: 100 units/sec
  - Turn rate: 90 deg/sec

---

## Example Player Code

```js
export const tankType = "light";

export default async function loop(tank) {
  await tank.turnLeft();
  if (await tank.scan(-10, 10)) {
    tank.shoot();
  }
  await tank.moveForward();
}
```

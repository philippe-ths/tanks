# Tank Coding Game (LAN + Local)

A top-down game where you program a tank using JavaScript and a small Tank API. You control your tank with:

- `if` statements
- calling methods (`tank.turnLeft()`, `tank.scan()`, etc.)
- `async/await` for actions that take time

Players typically edit **one file**: `player/tank.js`.

---

## What you can do

- **Test locally** against a simple bot
- **Play on LAN** (same Wi-Fi): one person hosts, others join in a browser

---

## Requirements

- Node.js 20+ recommended
- All players on the same Wi-Fi for LAN play

---

## Quick Start (Host a LAN Match)

1) Install dependencies:
```bash
npm install
```

2) Start the host server:
```bash
npm run host
```

3) Find the host machine’s local IP:
- Windows: `ipconfig`
- macOS/Linux: `ifconfig` or `ip a`

4) On each player device, open in a browser:
`http://HOST_IP:3000`

5) In the lobby:
- Select **Light** or **Heavy**
- Upload your `player/tank.js` (or paste it if UI supports it)
- When both players are ready, start the match

---

## Quick Start (Local Test)

1) Install:
```bash
npm install
```

2) Run the dev client:
```bash
npm run dev
```

3) Open the URL shown in the terminal (usually `http://localhost:5173`)

4) Click **Test Locally** to run your tank vs a bot.

---

## Editing Your Tank (One File)

Open: `player/tank.js`

### Example

```js
export const tankType = "light"; // "light" | "heavy"

export const config = {
  mode: "local",          // "local" | "lan"
  host: "192.168.0.10",   // used only for LAN mode
  port: 3000
};

export default async function loop(tank) {
  await tank.turnLeft();                 // takes 1 second
  if (await tank.scan(-10, 10)) {        // takes 1 second, returns true/false
    tank.shoot();                        // instant, but one projectile max
  }
  await tank.moveForward();              // takes 1 second
}
```

---

## Tank API

Timed actions (each takes **1 second of game time**):
- `await tank.turnLeft()`
- `await tank.turnRight()`
- `await tank.moveForward()`
- `await tank.moveBackward()`
- `await tank.scan(aDeg, bDeg)` → returns `true` / `false`

Instant action:
- `tank.shoot()` → fires if you don’t already have a projectile active

Notes:
- Scan angles are **relative to your tank’s current facing**
- Scan arc width is unlimited (you can scan wide arcs like `0..180`)
- Only **one projectile** from your tank may exist at a time
  - Calling `shoot()` again while your projectile is still flying does nothing

---

## Gameplay Rules

- Light tanks move faster but have less HP.
- Heavy tanks move slower but have more HP.
- The server is authoritative in LAN mode.
- A match ends when one tank’s HP reaches 0 (or optional time limit).

---

## Troubleshooting

### Other players can’t connect to host
- Confirm everyone is on the same Wi-Fi
- Allow Node through the host’s firewall prompt
- Double check the host IP and port
- Make sure you’re using `http://HOST_IP:3000`

### My tank doesn’t do anything
- Make sure you exported:
  - `export default async function loop(tank) { ... }`
- Timed actions must be awaited (`await tank.turnLeft()`, etc.)
- Check the UI error panel / browser console for syntax errors

---

## Scripts (suggested)

These may vary depending on final setup:

- `npm run host` → start server on `0.0.0.0:3000`
- `npm run dev` → start client dev server
- `npm run build` → build client
- `npm run preview` → preview built client

---

## Docs

- `docs/ARCHITECTURE.md` — system design and component overview
- `docs/SPEC.md` — gameplay rules, Tank API, networking contract
- `docs/PROMPTS.md` — step-by-step Copilot prompts to build the app

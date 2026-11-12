# 🐍 Snake 2 — Online Duel (real 1v1)

An online multiplayer extension of **Snake 2 – Neon Arcade**. The original single-player game, neon artwork, face-apple image, maps, powerups, cosmetics and local coin/skin store are preserved. The new **⚔️ ONLINE 1v1** button opens a multiplayer lobby and two synchronized, independent 14×14 Snake arenas.

## What is included?

- **Private 6-character room codes** with "Create Room", "Join Room", and "Copy Invite".
- **Two computers / browsers** connecting live using **WebSockets** (`/ws`).
- **Split arenas**: players compete for highest score; snakes cannot collide across boards.
- **Best of five**: first player to win **3 rounds** wins the match. A tie replays the round.
- **60-second rounds**, or sooner when both snakes crash. If one crashes, the other can keep playing until the time expires or they crash as well.
- **Server-authoritative** movement, spawns, scores, powerups and outcomes; each client sends only directions.
- **Powerups enabled**: freeze/slow movement (8 sec), one-hit shield, and shorten the snake.
- **Golden apples** worth 5 points, ordinary face-apples worth 1. Each apple eaten makes your snake faster, up to a safe speed cap.
- **Maps**: Garden, Jungle, Volcano, Ice World and Neon City (including portals).
- **Existing snake skins**: green, gold, ice, fire, neon. The selected existing skin is shown online; no new purchase system is required.
- **Rematch** after a completed best-of-five match. Both players must agree.
- **Reconnect grace period of 30 sec** after a dropped connection, otherwise the disconnected player forfeits the match.
- Mobile/desktop controls and smooth `requestAnimationFrame` canvas drawing.
- No external JavaScript dependencies, API keys, build step or database required for this prototype.

## Run locally

Install **Node.js 22 or newer**.

```bash
cd Snake2_Online_1v1
npm start
```

Open **http://localhost:3000**. To test the two-player game on one computer, open two **different browser profiles or private-window sessions** and use the room code. For two different computers on the same Wi-Fi, you can try the host computer's LAN IP instead of `localhost`, provided your firewall permits connections. For players in different locations, deploy the project as shown below.

To run tests:

```bash
npm test
```

The automated tests cover the game rules, private lobby lifecycle, first-to-three scoring, rematches, reconnect, and an actual two-client WebSocket exchange.

## Deploy to a public game address (Render)

This project needs a **Node web service** because the multiplayer game runs on the server. A static-only host or a single downloaded HTML file cannot host the multiplayer WebSocket server.

1. Download and unzip this project.
2. Create a new GitHub repository and upload the **contents** of the `Snake2_Online_1v1` folder to its root (including `server`, `public`, `package.json` and `render.yaml`).
3. Go to [Render](https://dashboard.render.com/), sign up/sign in, choose **New → Web Service**, and connect your new repository.
4. Choose Node as runtime. Set **Build Command** to `npm install --omit=dev`, **Start Command** to `npm start`, and Health Check to `/healthz`. Alternatively, use the included `render.yaml` blueprint.
5. Deploy with **one instance**. Render provides an HTTPS URL, for example `https://your-snake-2.onrender.com` (example only; not a live site).
6. Open that exact URL on **both computers**. Player A selects **ONLINE 1v1 → CREATE PRIVATE ROOM**. Player B selects **ONLINE 1v1 → JOIN** and enters the code; or opens the invite link.
7. Both players click **I'M READY**. The round begins after a short countdown. At the end of the match, both players can request a rematch.

The browser automatically uses `wss://` for secure public sites and `ws://` for local testing. No WebSocket URL has to be edited.

**Important hosting limits:** Rooms exist in this server's RAM, so a server restart or redeployment ends active matches. Run only one server instance; horizontal autoscaling would require an external shared room/state system. Free hosts may sleep when idle and may be slower to wake; check the host's current conditions before choosing a plan. The existing solo coin/skin records remain in each player's **local browser storage**, not in a shared online account. Multiplayer itself doesn't mint extra shop coins.

## Deploy with Docker

```bash
docker build -t snake2-online .
docker run -p 3000:3000 -e PORT=3000 snake2-online
```

Visit http://localhost:3000. A production reverse proxy must support WebSocket `Upgrade` headers.

## Folder structure

```text
Snake2_Online_1v1/
├── package.json              # Node 22, no npm dependencies
├── render.yaml               # One-instance Render setup
├── Dockerfile                # Optional Docker deployment
├── public/
│   ├── index.html            # Existing Snake 2 game + Online Duel menu; includes the original artwork
│   ├── multiplayer.css       # Matching glossy neon UI
│   └── multiplayer.js        # Room UI, input controls and smooth split-board renderer
├── server/
│   ├── index.js              # HTTP server, /healthz, /ws route
│   ├── ws-native.js          # Small JSON WebSocket transport, no external modules
│   ├── game-engine.js        # Server-authoritative Snake rules and powerups
│   └── room-server.js        # Rooms, rounds, reconnects, results, rematches
└── tests/
    ├── engine.test.js
    └── network.test.js
```

## Notes on safety and limitations

- Only the person with the private room code can join a free slot. Treat invite URLs as private links.
- The server gives players a random **reconnect token**, stored in browser session storage. Don't share your token.
- The server checks incoming message sizes, player input, basic request rates and connection limits. This prototype is intended for casual friends' matches, not high-stakes competitive tournaments.
- Do not open `public/index.html` directly from your filesystem for online play: run the server or use a deployed HTTPS address instead.
- The current project does **not** have matchmaking, accounts, persistent global leaderboards, voice chat, or cross-server rooms.

# 🚀 Star Beans

A colourful multiplayer space party game for **2–5 players** on phones, iPads and computers.
One player is secretly the **Impostor**. Crewmates finish tasks and try to find them;
the Impostor tries to eliminate the crew without getting caught.

> Star Beans is an original game inspired by social deduction games like *Among Us*.
> All art is drawn with code. It is not affiliated with Innersloth.

---

## How it fits together

```
 Phones / iPads  ──►  GitHub Pages (the game: HTML, CSS, JavaScript)
        │
        └──── secure WebSocket (wss://) ────►  Render (server/server.js, Node.js + Socket.IO)
        │
        └──── WebRTC voice, player to player (with TURN relay if needed)
```

* **GitHub Pages** only hosts the game files. It can't run the multiplayer server.
* **Render** (or any host that supports WebSockets) runs `server/server.js`. It runs rooms,
  roles, tasks, meetings and votes, and passes voice-chat setup messages between players.
* **Voice chat** goes directly between players with WebRTC. On some home or mobile networks it
  needs a **TURN** relay. The server hands out TURN details, so no secrets go in the game files.

## Files

| File | What it does |
|---|---|
| `index.html` | The page: home screen, lobby, game screen, overlays |
| `style.css` | All the colours, buttons and layout (landscape + touch friendly) |
| `config.js` | **Where you paste your server address** (`SERVER_URL`) |
| `map.js` | The spaceship: rooms, corridors, walls, obstacles, task stations, collisions |
| `art.js` | Draws the cute bean astronauts |
| `tasks.js` | Task mini-games (wires, numbers, hold, tap targets) |
| `multiplayer.js` | Connects to the server and reconnects if the connection drops |
| `voice.js` | Microphone voice chat (WebRTC) |
| `video.js` | Video faces bar (Daily) – little camera bubbles of everyone |
| `game.js` | Main game: lobby, controls, drawing, meetings, voting, win/lose screens |
| `server/server.js` | The multiplayer server |
| `server/package.json` | Tells the host what the server needs (Socket.IO) |

## How to play

1. One player taps **Create Room** and shares the **6-character room code**.
2. Everyone else types the code and taps **Join Room** (up to 5 players).
3. Everyone taps **I'm Ready** and **Allow Mic**. The admin (👑) taps **Start Game**.
4. **Crewmates:** walk to the yellow **!** stations and tap **USE** to do tasks.
   When the task bar is full, the crew wins.
5. **Impostor:** get close to a crewmate and tap **ELIMINATE** (there's a cooldown).
6. Found an eliminated crewmate? Tap **REPORT**. Suspicious? Press the red **emergency button**
   in the Cafeteria (once per player per game).
7. In meetings, talk through your microphones, then vote (or skip). Ghosts can't vote,
   and living players can't hear them.
8. The crew wins by finishing every task or voting out the Impostor. The Impostor wins by
   eliminating the crew.

**Controls:** joystick bottom-left (touch anywhere on the left side), buttons bottom-right.
On a computer: **WASD/arrows** to move, **E** use, **R** report, **Q** eliminate.

**Admin (👑):** Start, Pause, Resume, Restart, and End. If the admin disconnects, the next
player becomes admin automatically.

## Deploying (summary)

The chat guides you through each step. Here's the short version:

1. Create a GitHub repository and upload all the files (keep the `server` folder).
2. GitHub → **Settings → Pages** → Source: *Deploy from a branch* → `main` / `(root)` → Save.
3. Go to [render.com](https://render.com) → **New → Web Service** → pick your repository:
   * **Root Directory:** `server`
   * **Build Command:** `npm install`
   * **Start Command:** `npm start`
   * **Instance type:** Free
4. Copy your Render address (like `https://star-beans-server.onrender.com`) into `config.js`
   as `SERVER_URL` and commit.
5. *(Recommended)* On Render → **Environment**, add `ALLOWED_ORIGINS` =
   `https://YOUR-GITHUB-USERNAME.github.io`
6. *(Recommended for voice)* Create a free TURN account at [metered.ca](https://www.metered.ca),
   then on Render add `METERED_DOMAIN` (like `yourapp.metered.live`) and `METERED_API_KEY`.
   Never put these in `config.js`.

7. *(For the video faces bar)* Make a free account at [daily.co](https://dashboard.daily.co),
   go to **Developers** and copy your **API key**. On Render → **Environment**, add
   `DAILY_API_KEY` = that key. Never put it in `config.js`. Without it the faces bar just stays hidden.

### Video faces bar

A row of round camera bubbles sits at the bottom of the screen (at the top during meetings).
Tap 📷/🚫 to turn your camera on or off (it starts **off**), and ✕ to shrink the bar.
It is video only – talking still happens through the game's voice chat in meetings.
Players without a camera on show their bean instead.

### Free Render servers go to sleep

A free Render web service sleeps after about 15 minutes with no visitors. The first player
to open the game then waits about a minute while it wakes up. The game shows
"Can't reach the game server yet…" and connects by itself once the server is awake.
Open the game a minute before you play.

## Testing on your own computer (optional)

```bash
cd server
npm install
npm start
```
Open `http://localhost:3000` in two browser tabs. The server also serves the game files
when you test locally, and `SERVER_URL` can stay empty.

## Troubleshooting

* **"Room not found"**: room codes only last while the server is running. Create a new room.
* **Stuck on "Connecting…"**: check `SERVER_URL` in `config.js` starts with `https://`, and
  open `YOUR-SERVER/health` in a browser. You should see `{"ok":true,...}`.
* **Can't hear each other**: tap **Allow Mic**, check browser microphone permission, and set
  up TURN (step 6). On iPhone, tap the screen once if a "Tap to hear voices" button appears.
  Headphones help prevent echo.
* **Phone locked or the app switched**: the game keeps your seat for 60 seconds. Come back
  and it reconnects you.
* **Changes don't show up**: GitHub Pages can take 1–2 minutes to update. Refresh the page.

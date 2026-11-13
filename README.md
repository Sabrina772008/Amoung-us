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
        └──── Daily video call (see + hear everyone), private room per game
```

* **GitHub Pages** only hosts the game files. It can't run the multiplayer server.
* **Render** (or any host that supports WebSockets) runs `server/server.js`. It runs rooms,
  roles, tasks, meetings and votes, and passes voice-chat setup messages between players.
* **Video call** runs on Daily. The server makes a private Daily room per game and hands each
  player a pass, so the Daily API key never goes in the game files.

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
| `voice.js` | Small bridge: the game's mic buttons control the video call's mic |
| `video.js` | Video call (Daily) – see and hear everyone in the room |
| `game.js` | Main game: login, lobby, controls, drawing, meetings, voting, win/lose screens |
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
7. In meetings, talk it over on the video call, then vote (or skip). Ghosts can't vote.
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

8. *(Logins)* Supabase logins are already set up (see below). The older option: on Render, add `PLAYER_ACCOUNTS` with one
   `Name:password` pair per cousin, separated by commas, for example
   `Sabrina:moon42, Ali:rocket7, Zara:comet9`. Everyone then logs in on the home screen
   and stays logged in on that phone/tablet. Their game name and video bubble use their
   login name. To add a cousin or change a password, edit this setting (that logs
   everyone out once). Leave it empty to play without logins.

### Logins (Supabase)

Logins use the **Friend Arcade** Supabase project, so cousins make their own accounts:

* On the home screen tap **New here? Create an account**, pick a name and a password (6+ characters).
* Next time just **Log in**. Each phone/tablet remembers you until you tap **Log out**.
* No email needed: names are stored as `name@players.friendarcade.app`, the same style
  Friend Arcade uses, so an existing Friend Arcade login works here too.
* See or remove accounts in Supabase → Friend Arcade → **Authentication → Users**.
* `config.js` holds the Supabase address and the **publishable** key. That key is meant to be
  public. Never put the **secret** key in the game files.
* (Old option: `PLAYER_ACCOUNTS` on Render only applies if Supabase is switched off with
  `SUPABASE_URL=off`.)

### Video call

Everyone in a room is in one private video call (Daily): you can **see and hear each other
the whole time** – in the lobby, while playing and in meetings.

* The bar at the bottom (at the top during meetings) has 🎤 mic on/off, 📷 camera on/off and
  ✕ to shrink it (sound keeps playing when it's shrunk).
* Mic and camera start **on**; the browser asks for permission the first time.
* Whoever is talking gets a green glow. 🔇 shows who is muted. No camera? Their bean shows instead.
* On iPhone/iPad, if a blue 🔊 button appears, tap it (or anywhere) to hear everyone.
* The lobby **Allow Mic** and meeting **Mute** buttons control the same call mic.

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

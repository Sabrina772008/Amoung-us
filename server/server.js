/*
 * Star Beans – multiplayer game server
 * ------------------------------------
 * Node.js + Socket.IO. This server is the "referee": it keeps the official
 * game state (rooms, roles, tasks, meetings, votes) and relays WebRTC voice
 * signaling between players. It does NOT run on GitHub Pages – deploy it to a
 * host that supports long-lived WebSocket connections (for example Render).
 *
 * Environment variables (all optional):
 *   PORT              – port to listen on (hosts like Render set this for you)
 *   ALLOWED_ORIGINS   – comma separated list of websites allowed to connect,
 *                       e.g. "https://yourname.github.io". Default: allow all.
 *   METERED_DOMAIN    – e.g. "yourapp.metered.live"   (free TURN from metered.ca)
 *   METERED_API_KEY   – your Metered TURN API key      (kept secret on the server)
 *   TURN_URLS         – alternative: comma separated TURN urls
 *   TURN_USERNAME     – username for TURN_URLS
 *   TURN_CREDENTIAL   – password for TURN_URLS
 */
'use strict';

/* ------------------------------------------------------------------ */
/* Game settings                                                        */
/* ------------------------------------------------------------------ */
const SETTINGS = {
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 5,
  TASKS_PER_PLAYER: 5,
  KILL_RANGE: 110,            // how close the impostor must be (map units)
  REPORT_RANGE: 150,
  BUTTON_RANGE: 170,
  FIRST_KILL_COOLDOWN: 15000, // ms after the round starts
  KILL_COOLDOWN: 25000,       // ms between eliminations
  EMERGENCY_COOLDOWN: 15000,  // ms after round start / meeting before the button works
  DISCUSSION_TIME: 20000,
  VOTING_TIME: 60000,
  EJECT_TIME: 6500,
  ROLE_REVEAL_TIME: 4000,
  RECONNECT_GRACE_GAME: 60000,  // keep a disconnected player's seat this long
  RECONNECT_GRACE_LOBBY: 20000,
  TICK_MS: 80,
};

// Must match the task ids in map.js
const TASK_IDS = [
  'gh_water', 'gh_seeds', 'caf_trash', 'comm_wires', 'comm_download',
  'med_scan', 'storage_wires', 'storage_fuel', 'nav_course', 'nav_numbers',
  'eng_fuel', 'eng_wires', 'reactor_start', 'shield_prime',
];

const BUTTON_POS = { x: 1300, y: 300 }; // emergency button (Cafeteria)
const COLORS = ['red', 'blue', 'green', 'pink', 'orange', 'yellow',
  'purple', 'cyan', 'white', 'lime', 'brown', 'black'];
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function cleanName(n) {
  n = String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
  return n;
}
function cleanCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }
function cleanId(id) { return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40); }
function num(v, d) { v = Number(v); return Number.isFinite(v) ? v : d; }

/* ------------------------------------------------------------------ */
/* Core game logic – works with any Socket.IO-like `io` object          */
/* ------------------------------------------------------------------ */
function createGameServer(io) {
  const rooms = new Map();          // code -> room
  const socketsById = new Map();    // socket.id -> socket

  function newCode() {
    let code;
    do {
      code = '';
      for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    } while (rooms.has(code));
    return code;
  }

  function createRoom() {
    const room = {
      code: newCode(),
      players: new Map(),  // playerId -> player
      order: [],           // join order of playerIds
      adminId: null,
      phase: 'lobby',      // lobby | playing | meeting | ejecting | ended
      paused: false,
      round: 0,
      posSeq: 0,
      bodies: [],
      meeting: null,
      ejection: null,
      result: null,
      emergencyCooldown: 0,
      revealLeft: 0,
      lastSync: 0,
      timer: null,
    };
    rooms.set(room.code, room);
    room.timer = setInterval(() => tick(room), SETTINGS.TICK_MS);
    return room;
  }

  function deleteRoom(room) {
    clearInterval(room.timer);
    for (const p of room.players.values()) if (p.graceTimer) clearTimeout(p.graceTimer);
    rooms.delete(room.code);
  }

  function makePlayer(id, name, color) {
    return {
      id, name, color, socketId: null, connected: true, ready: false, conn: 0,
      x: BUTTON_POS.x, y: BUTTON_POS.y + 150, dir: 1, moving: false,
      alive: true, deathKnown: false, role: 'crew', tasks: [],
      emergencyUsed: false, killCooldown: 0, vote: undefined, graceTimer: null,
    };
  }

  function freeColor(room, wanted) {
    const used = new Set([...room.players.values()].map(p => p.color));
    if (COLORS.includes(wanted) && !used.has(wanted)) return wanted;
    return COLORS.find(c => !used.has(c));
  }

  function uniqueName(room, name, selfId) {
    let base = name || 'Player';
    let n = base, i = 2;
    const taken = new Set([...room.players.values()].filter(p => p.id !== selfId).map(p => p.name.toLowerCase()));
    while (taken.has(n.toLowerCase())) n = base.slice(0, 12) + ' ' + (i++);
    return n;
  }

  /* ---------------- snapshots (each player gets their own view) --------------- */
  function publicPlayer(room, p, viewer) {
    const inGame = room.phase !== 'lobby';
    let alive = true;
    if (inGame && !p.alive) {
      const knows = p.deathKnown || viewer.id === p.id || !viewer.alive || viewer.role === 'impostor' || room.phase === 'ended';
      alive = !knows;
    }
    return {
      id: p.id, name: p.name, color: p.color, ready: p.ready, connected: p.connected,
      alive, conn: p.conn, isAdmin: room.adminId === p.id,
      role: (room.phase === 'ended' || p.id === viewer.id) ? p.role : undefined,
    };
  }

  function taskProgress(room) {
    let total = 0, done = 0;
    for (const p of room.players.values()) {
      if (p.role !== 'crew') continue;
      total += p.tasks.length;
      done += p.tasks.filter(t => t.done).length;
    }
    return total ? done / total : 0;
  }

  function viewFor(room, viewer) {
    const v = {
      code: room.code, phase: room.phase, paused: room.paused, round: room.round,
      adminId: room.adminId, myId: viewer.id, posSeq: room.posSeq,
      settings: { minPlayers: SETTINGS.MIN_PLAYERS, maxPlayers: SETTINGS.MAX_PLAYERS,
        killRange: SETTINGS.KILL_RANGE, reportRange: SETTINGS.REPORT_RANGE, buttonRange: SETTINGS.BUTTON_RANGE },
      players: room.order.map(id => room.players.get(id)).filter(Boolean).map(p => publicPlayer(room, p, viewer)),
      me: {
        role: viewer.role, alive: viewer.alive, x: viewer.x, y: viewer.y,
        tasks: viewer.tasks, killCooldown: viewer.killCooldown, emergencyUsed: viewer.emergencyUsed,
      },
      emergencyCooldown: room.emergencyCooldown,
      revealLeft: room.revealLeft,
      taskProgress: taskProgress(room),
      bodies: room.bodies,
      meeting: null, ejection: room.ejection, result: room.result,
    };
    if (room.meeting) {
      const m = room.meeting;
      v.meeting = {
        stage: m.stage, timeLeft: m.timeLeft, callerId: m.callerId, reason: m.reason,
        bodyName: m.bodyName, bodyColor: m.bodyColor,
        voted: [...room.players.values()].filter(p => p.vote !== undefined).map(p => p.id),
        myVote: viewer.vote,
      };
    }
    return v;
  }

  function sendRoom(room) {
    for (const p of room.players.values()) {
      if (!p.connected || !p.socketId) continue;
      const s = socketsById.get(p.socketId);
      if (s) s.emit('room', viewFor(room, p));
    }
    room.lastSync = Date.now();
  }

  function sendEvent(room, ev) {
    io.to(room.code).emit('event', ev);
  }

  function sendPositions(room) {
    if (room.phase !== 'playing') return;
    const all = [...room.players.values()];
    const living = all.filter(p => p.alive).map(p => [p.id, Math.round(p.x), Math.round(p.y), p.dir, p.moving ? 1 : 0]);
    const everyone = all.map(p => [p.id, Math.round(p.x), Math.round(p.y), p.dir, p.moving ? 1 : 0]);
    for (const p of all) {
      if (!p.connected) continue;
      const s = socketsById.get(p.socketId);
      if (s) s.emit('pos', p.alive ? living : everyone); // ghosts are invisible to the living
    }
  }

  /* ---------------- game flow ---------------- */
  function spawnAll(room) {
    const list = room.order.map(id => room.players.get(id)).filter(Boolean);
    list.forEach((p, i) => {
      const a = (i / Math.max(list.length, 1)) * Math.PI * 2 + Math.PI / 2;
      p.x = BUTTON_POS.x + Math.cos(a) * 150;
      p.y = BUTTON_POS.y + Math.sin(a) * 135;
      p.moving = false;
    });
    room.posSeq++;
  }

  function startGame(room) {
    const list = [...room.players.values()];
    const impostor = list[Math.floor(Math.random() * list.length)];
    for (const p of list) {
      p.alive = true; p.deathKnown = false; p.vote = undefined;
      p.emergencyUsed = false;
      p.role = p === impostor ? 'impostor' : 'crew';
      p.tasks = shuffle(TASK_IDS).slice(0, SETTINGS.TASKS_PER_PLAYER).map(id => ({ id, done: false }));
      p.killCooldown = p.role === 'impostor' ? SETTINGS.FIRST_KILL_COOLDOWN : 0;
    }
    room.round++;
    room.phase = 'playing';
    room.paused = false;
    room.bodies = [];
    room.meeting = null;
    room.ejection = null;
    room.result = null;
    room.emergencyCooldown = SETTINGS.EMERGENCY_COOLDOWN;
    room.revealLeft = SETTINGS.ROLE_REVEAL_TIME;
    spawnAll(room);
    sendRoom(room);
  }

  function backToLobby(room) {
    room.phase = 'lobby';
    room.paused = false;
    room.bodies = []; room.meeting = null; room.ejection = null; room.result = null;
    for (const p of room.players.values()) {
      p.ready = false; p.alive = true; p.role = 'crew'; p.tasks = []; p.vote = undefined; p.deathKnown = false;
    }
    sendRoom(room);
  }

  function endGame(room, winner, reason) {
    room.phase = 'ended';
    room.paused = false;
    room.meeting = null;
    const impostors = [...room.players.values()].filter(p => p.role === 'impostor');
    room.result = {
      winner, reason,
      impostorIds: impostors.map(p => p.id),
      impostorNames: impostors.map(p => p.name),
      impostorColors: impostors.map(p => p.color),
    };
    sendRoom(room);
  }

  // Returns true if the game ended
  function checkWin(room) {
    if (room.phase === 'lobby' || room.phase === 'ended') return false;
    const list = [...room.players.values()];
    const imps = list.filter(p => p.role === 'impostor' && p.alive);
    const crewAlive = list.filter(p => p.role === 'crew' && p.alive);
    if (imps.length === 0) {
      endGame(room, 'crew', list.some(p => p.role === 'impostor') ? 'The impostor was caught!' : 'The impostor left the game.');
      return true;
    }
    // In small games (2–3 players) the impostor must catch everyone, so the last
    // crewmate can still win by finishing tasks. With 4–5 players, standard rules.
    const smallGame = list.length <= 3;
    if (crewAlive.length === 0 || (!smallGame && crewAlive.length <= imps.length)) {
      endGame(room, 'impostor', 'The impostor eliminated the crew!');
      return true;
    }
    if (taskProgress(room) >= 1 && list.some(p => p.role === 'crew')) {
      endGame(room, 'crew', 'All tasks completed!');
      return true;
    }
    return false;
  }

  function startMeeting(room, caller, reason, body) {
    room.phase = 'meeting';
    for (const p of room.players.values()) {
      p.vote = undefined;
      p.moving = false;
      if (!p.alive) p.deathKnown = true;
    }
    room.meeting = {
      stage: 'discussion', timeLeft: SETTINGS.DISCUSSION_TIME, callerId: caller.id, reason,
      bodyName: body ? body.name : null, bodyColor: body ? body.color : null,
    };
    room.bodies = [];
    sendEvent(room, { type: 'meeting', reason, callerName: caller.name });
    sendRoom(room);
  }

  function finishVoting(room) {
    const living = [...room.players.values()].filter(p => p.alive);
    const tally = {};   // targetId|'skip' -> [voterIds]
    for (const p of living) {
      const v = p.vote === undefined ? 'skip' : p.vote;
      (tally[v] = tally[v] || []).push(p.id);
    }
    let best = null, bestN = 0, tie = false;
    for (const [k, voters] of Object.entries(tally)) {
      if (voters.length > bestN) { best = k; bestN = voters.length; tie = false; }
      else if (voters.length === bestN) tie = true;
    }
    let ejected = null;
    if (!tie && best && best !== 'skip') ejected = room.players.get(best) || null;
    if (ejected) { ejected.alive = false; ejected.deathKnown = true; }
    room.meeting = null;
    room.phase = 'ejecting';
    room.ejection = {
      ejectedId: ejected ? ejected.id : null,
      name: ejected ? ejected.name : null,
      color: ejected ? ejected.color : null,
      wasImpostor: ejected ? ejected.role === 'impostor' : false,
      tie, skipped: !ejected && !tie,
      tally, timeLeft: SETTINGS.EJECT_TIME,
    };
    for (const p of room.players.values()) p.vote = undefined;
    sendRoom(room);
  }

  function afterEjection(room) {
    room.ejection = null;
    if (checkWin(room)) return;
    room.phase = 'playing';
    room.emergencyCooldown = SETTINGS.EMERGENCY_COOLDOWN;
    for (const p of room.players.values()) {
      if (p.role === 'impostor') p.killCooldown = SETTINGS.KILL_COOLDOWN;
    }
    spawnAll(room);
    sendRoom(room);
  }

  function tick(room) {
    const dt = SETTINGS.TICK_MS;
    if (room.phase === 'lobby') return;
    if (!room.paused) {
      if (room.phase === 'playing') {
        if (room.revealLeft > 0) room.revealLeft = Math.max(0, room.revealLeft - dt);
        else {
          room.emergencyCooldown = Math.max(0, room.emergencyCooldown - dt);
          for (const p of room.players.values()) {
            if (p.killCooldown > 0) p.killCooldown = Math.max(0, p.killCooldown - dt);
          }
        }
      } else if (room.phase === 'meeting') {
        const m = room.meeting;
        m.timeLeft -= dt;
        if (m.timeLeft <= 0) {
          if (m.stage === 'discussion') { m.stage = 'voting'; m.timeLeft = SETTINGS.VOTING_TIME; sendRoom(room); }
          else { finishVoting(room); }
        }
      } else if (room.phase === 'ejecting') {
        room.ejection.timeLeft -= dt;
        if (room.ejection.timeLeft <= 0) afterEjection(room);
      }
    }
    sendPositions(room);
    // keep clocks in sync once a second during timed phases
    if (room.phase !== 'ended' && Date.now() - room.lastSync > 1000) sendRoom(room);
  }

  /* ---------------- leaving / admin hand-over ---------------- */
  function pickNewAdmin(room) {
    const next = room.order.map(id => room.players.get(id)).find(p => p && p.connected);
    const fallback = room.order.map(id => room.players.get(id)).find(Boolean);
    const chosen = next || fallback;
    room.adminId = chosen ? chosen.id : null;
    if (chosen) sendEvent(room, { type: 'toast', text: `${chosen.name} is now the admin 👑` });
  }

  function removePlayer(room, p, why) {
    if (p.graceTimer) clearTimeout(p.graceTimer);
    room.players.delete(p.id);
    room.order = room.order.filter(id => id !== p.id);
    const s = p.socketId && socketsById.get(p.socketId);
    if (s) { s.leave(room.code); s.data.roomCode = null; }
    if (room.players.size === 0) { deleteRoom(room); return; }
    sendEvent(room, { type: 'toast', text: `${p.name} ${why || 'left the room'}` });
    sendEvent(room, { type: 'peer-left', id: p.id });
    if (room.adminId === p.id) pickNewAdmin(room);
    if (room.phase === 'meeting' && room.meeting && room.meeting.stage === 'voting') maybeAllVoted(room);
    if (room.phase !== 'lobby' && room.phase !== 'ended') {
      if (room.players.size < SETTINGS.MIN_PLAYERS) {
        endGame(room, 'none', 'Not enough players left.');
        return;
      }
      if (checkWin(room)) return;
    }
    sendRoom(room);
  }

  function maybeAllVoted(room) {
    const living = [...room.players.values()].filter(p => p.alive);
    if (living.length && living.every(p => p.vote !== undefined)) finishVoting(room);
  }

  /* ---------------- socket handling ---------------- */
  io.on('connection', (socket) => {
    socketsById.set(socket.id, socket);
    socket.data = socket.data || {};

    const ctx = () => {
      const room = rooms.get(socket.data.roomCode);
      if (!room) return {};
      const p = room.players.get(socket.data.playerId);
      if (!p || p.socketId !== socket.id) return {};
      return { room, p };
    };
    const reply = (ack, data) => { if (typeof ack === 'function') ack(data); };

    function attach(room, p) {
      if (p.graceTimer) { clearTimeout(p.graceTimer); p.graceTimer = null; }
      const old = p.socketId && socketsById.get(p.socketId);
      if (old && old !== socket) { old.leave(room.code); old.data.roomCode = null; }
      p.socketId = socket.id;
      p.connected = true;
      p.conn++;
      socket.data.roomCode = room.code;
      socket.data.playerId = p.id;
      socket.join(room.code);
    }

    socket.on('create-room', (data, ack) => {
      data = data || {};
      const pid = cleanId(data.playerId);
      const name = cleanName(data.name);
      if (!pid) return reply(ack, { ok: false, error: 'Missing player id.' });
      if (!name) return reply(ack, { ok: false, error: 'Please type your name first.' });
      leaveCurrent();
      const room = createRoom();
      const p = makePlayer(pid, name, freeColor(room, data.color));
      p.ready = true;
      room.players.set(pid, p);
      room.order.push(pid);
      room.adminId = pid;
      attach(room, p);
      reply(ack, { ok: true, code: room.code });
      sendRoom(room);
    });

    socket.on('join-room', (data, ack) => {
      data = data || {};
      const code = cleanCode(data.code);
      const pid = cleanId(data.playerId);
      const room = rooms.get(code);
      if (!room) return reply(ack, { ok: false, error: 'Room not found. Check the code.' });
      if (!pid) return reply(ack, { ok: false, error: 'Missing player id.' });
      const existing = room.players.get(pid);
      if (existing) {                               // re-joining after a disconnect
        if (socket.data.roomCode && socket.data.roomCode !== code) leaveCurrent();
        attach(room, existing);
        reply(ack, { ok: true, code, rejoined: true });
        sendEvent(room, { type: 'peer-refresh', id: pid });
        sendRoom(room);
        return;
      }
      const name = cleanName(data.name);
      if (!name) return reply(ack, { ok: false, error: 'Please type your name first.' });
      if (room.phase !== 'lobby') return reply(ack, { ok: false, error: 'That game has already started. Ask the admin to end it, then join.' });
      if (room.players.size >= SETTINGS.MAX_PLAYERS) return reply(ack, { ok: false, error: 'Room is full (5 players max).' });
      leaveCurrent();
      const p = makePlayer(pid, uniqueName(room, name, pid), freeColor(room, data.color));
      room.players.set(pid, p);
      room.order.push(pid);
      attach(room, p);
      reply(ack, { ok: true, code });
      sendEvent(room, { type: 'toast', text: `${p.name} joined!` });
      sendRoom(room);
    });

    function leaveCurrent() {
      const { room, p } = ctx();
      if (room && p) removePlayer(room, p, 'left the room');
    }
    socket.on('leave-room', (_, ack) => { leaveCurrent(); reply(ack, { ok: true }); });

    socket.on('update-profile', (data, ack) => {
      const { room, p } = ctx();
      if (!room) return reply(ack, { ok: false, error: 'Not in a room.' });
      if (room.phase !== 'lobby') return reply(ack, { ok: false, error: 'You can only change this in the lobby.' });
      data = data || {};
      if (data.name !== undefined) {
        const n = cleanName(data.name);
        if (!n) return reply(ack, { ok: false, error: 'Name cannot be empty.' });
        p.name = uniqueName(room, n, p.id);
      }
      if (data.color !== undefined) {
        if (!COLORS.includes(data.color)) return reply(ack, { ok: false, error: 'Unknown color.' });
        const taken = [...room.players.values()].some(o => o !== p && o.color === data.color);
        if (taken) return reply(ack, { ok: false, error: 'Someone already picked that color.' });
        p.color = data.color;
      }
      reply(ack, { ok: true, name: p.name, color: p.color });
      sendRoom(room);
    });

    socket.on('set-ready', (ready) => {
      const { room, p } = ctx();
      if (!room || room.phase !== 'lobby') return;
      p.ready = !!ready;
      sendRoom(room);
    });

    socket.on('admin', (data, ack) => {
      const { room, p } = ctx();
      if (!room) return reply(ack, { ok: false, error: 'Not in a room.' });
      if (room.adminId !== p.id) return reply(ack, { ok: false, error: 'Only the admin can do that.' });
      const action = data && data.action;
      if (action === 'start') {
        if (room.phase !== 'lobby') return reply(ack, { ok: false, error: 'Game already running.' });
        const list = [...room.players.values()].filter(x => x.connected);
        if (list.length < SETTINGS.MIN_PLAYERS) return reply(ack, { ok: false, error: `Need at least ${SETTINGS.MIN_PLAYERS} players.` });
        const notReady = list.filter(x => x.id !== p.id && !x.ready);
        if (notReady.length) return reply(ack, { ok: false, error: `Waiting for: ${notReady.map(x => x.name).join(', ')}` });
        startGame(room);
      } else if (action === 'pause') {
        if (room.phase === 'lobby' || room.phase === 'ended') return reply(ack, { ok: false, error: 'Nothing to pause.' });
        room.paused = true;
        for (const x of room.players.values()) x.moving = false;
        sendEvent(room, { type: 'toast', text: 'Game paused by the admin ⏸' });
        sendRoom(room);
      } else if (action === 'resume') {
        room.paused = false;
        sendEvent(room, { type: 'toast', text: 'Game resumed ▶' });
        sendRoom(room);
      } else if (action === 'restart') {
        if (room.phase === 'lobby') return reply(ack, { ok: false, error: 'Use Start instead.' });
        if (room.players.size < SETTINGS.MIN_PLAYERS) return reply(ack, { ok: false, error: 'Not enough players.' });
        startGame(room);
      } else if (action === 'end') {
        backToLobby(room);
      } else {
        return reply(ack, { ok: false, error: 'Unknown action.' });
      }
      reply(ack, { ok: true });
    });

    socket.on('move', (d) => {
      const { room, p } = ctx();
      if (!room || room.phase !== 'playing' || room.paused || room.revealLeft > 0 || !d) return;
      p.x = Math.max(0, Math.min(3000, num(d.x, p.x)));
      p.y = Math.max(0, Math.min(2000, num(d.y, p.y)));
      p.dir = d.dir < 0 ? -1 : 1;
      p.moving = !!d.moving;
    });

    socket.on('kill', (d, ack) => {
      const { room, p } = ctx();
      if (!room || room.phase !== 'playing' || room.paused || room.revealLeft > 0) return reply(ack, { ok: false });
      if (p.role !== 'impostor' || !p.alive || p.killCooldown > 0) return reply(ack, { ok: false, error: 'Not ready yet.' });
      const t = room.players.get(cleanId(d && d.targetId));
      if (!t || !t.alive || t.role === 'impostor') return reply(ack, { ok: false });
      if (dist(p, t) > SETTINGS.KILL_RANGE * 1.4) return reply(ack, { ok: false, error: 'Too far away.' });
      t.alive = false;
      t.moving = false;
      p.killCooldown = SETTINGS.KILL_COOLDOWN;
      room.bodies.push({ id: 'b' + Date.now() + Math.floor(Math.random() * 1000), victimId: t.id, name: t.name, color: t.color, x: t.x, y: t.y });
      const ts = socketsById.get(t.socketId);
      if (ts) ts.emit('event', { type: 'eliminated', by: p.color });
      reply(ack, { ok: true });
      if (!checkWin(room)) sendRoom(room);
    });

    socket.on('report', (d, ack) => {
      const { room, p } = ctx();
      if (!room || room.phase !== 'playing' || room.paused || !p.alive) return reply(ack, { ok: false });
      const body = room.bodies.find(b => b.id === (d && d.bodyId));
      if (!body) return reply(ack, { ok: false });
      if (dist(p, body) > SETTINGS.REPORT_RANGE * 1.4) return reply(ack, { ok: false, error: 'Too far away.' });
      startMeeting(room, p, 'report', body);
      reply(ack, { ok: true });
    });

    socket.on('emergency', (_, ack) => {
      const { room, p } = ctx();
      if (!room || room.phase !== 'playing' || room.paused || !p.alive) return reply(ack, { ok: false });
      if (p.emergencyUsed) return reply(ack, { ok: false, error: 'You already used your emergency meeting.' });
      if (room.emergencyCooldown > 0 || room.revealLeft > 0) return reply(ack, { ok: false, error: 'Button is cooling down.' });
      if (dist(p, BUTTON_POS) > SETTINGS.BUTTON_RANGE * 1.4) return reply(ack, { ok: false, error: 'Too far from the button.' });
      p.emergencyUsed = true;
      startMeeting(room, p, 'emergency', null);
      reply(ack, { ok: true });
    });

    socket.on('task-complete', (d, ack) => {
      const { room, p } = ctx();
      if (!room || room.phase !== 'playing' || room.paused) return reply(ack, { ok: false });
      if (p.role !== 'crew') return reply(ack, { ok: false });
      const t = p.tasks.find(x => x.id === (d && d.taskId));
      if (!t || t.done) return reply(ack, { ok: false });
      t.done = true;
      reply(ack, { ok: true });
      if (!checkWin(room)) sendRoom(room);
    });

    socket.on('vote', (d, ack) => {
      const { room, p } = ctx();
      if (!room || room.phase !== 'meeting' || room.paused || !room.meeting || room.meeting.stage !== 'voting') return reply(ack, { ok: false, error: 'Voting is not open.' });
      if (!p.alive) return reply(ack, { ok: false, error: 'Ghosts cannot vote.' });
      if (p.vote !== undefined) return reply(ack, { ok: false, error: 'You already voted.' });
      const target = d && d.targetId;
      if (target !== 'skip') {
        const t = room.players.get(cleanId(target));
        if (!t || !t.alive) return reply(ack, { ok: false, error: 'You cannot vote for that player.' });
      }
      p.vote = target === 'skip' ? 'skip' : cleanId(target);
      reply(ack, { ok: true });
      sendRoom(room);
      maybeAllVoted(room);
    });

    // WebRTC signaling relay: forward offers/answers/ICE candidates to one player in the same room
    socket.on('rtc-signal', (d) => {
      const { room, p } = ctx();
      if (!room || !d) return;
      const target = room.players.get(cleanId(d.to));
      if (!target || !target.connected) return;
      const ts = socketsById.get(target.socketId);
      if (ts) ts.emit('rtc-signal', { from: p.id, data: d.data });
    });

    socket.on('disconnect', () => {
      socketsById.delete(socket.id);
      const room = rooms.get(socket.data.roomCode);
      if (!room) return;
      const p = room.players.get(socket.data.playerId);
      if (!p || p.socketId !== socket.id) return;
      p.connected = false;
      p.moving = false;
      if (room.adminId === p.id && [...room.players.values()].some(o => o.connected)) pickNewAdmin(room);
      if (![...room.players.values()].some(o => o.connected)) {
        // everyone is gone: give them a short time to come back, then delete the room
        p.graceTimer = setTimeout(() => {
          if (![...room.players.values()].some(o => o.connected)) deleteRoom(room);
        }, SETTINGS.RECONNECT_GRACE_GAME);
        return;
      }
      sendEvent(room, { type: 'toast', text: `${p.name} lost connection…` });
      const grace = room.phase === 'lobby' ? SETTINGS.RECONNECT_GRACE_LOBBY : SETTINGS.RECONNECT_GRACE_GAME;
      p.graceTimer = setTimeout(() => {
        if (!p.connected && rooms.get(room.code) === room && room.players.get(p.id) === p) removePlayer(room, p, 'disconnected');
      }, grace);
      sendRoom(room);
    });
  });

  return { rooms, SETTINGS };
}

/* ------------------------------------------------------------------ */
/* HTTP + Socket.IO server (only runs with `node server.js`)            */
/* ------------------------------------------------------------------ */
function startHttpServer() {
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const { Server } = require('socket.io');

  const PORT = process.env.PORT || 3000;
  const origins = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
  const corsOrigin = origins.includes('*') ? '*' : origins;

  // Optional: also serve the game files (handy for testing on your own computer)
  const CLIENT_DIR = path.resolve(__dirname, '..');
  const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

  async function iceServers() {
    const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    try {
      if (process.env.METERED_DOMAIN && process.env.METERED_API_KEY) {
        const url = `https://${process.env.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(process.env.METERED_API_KEY)}`;
        const r = await fetch(url);
        if (r.ok) { const arr = await r.json(); if (Array.isArray(arr)) return list.concat(arr); }
        else console.warn('Metered TURN request failed:', r.status);
      }
    } catch (e) { console.warn('Could not fetch TURN credentials:', e.message); }
    if (process.env.TURN_URLS) {
      list.push({
        urls: process.env.TURN_URLS.split(',').map(s => s.trim()),
        username: process.env.TURN_USERNAME || '',
        credential: process.env.TURN_CREDENTIAL || '',
      });
    }
    return list;
  }

  function setCors(req, res) {
    const o = req.headers.origin;
    if (corsOrigin === '*') res.setHeader('Access-Control-Allow-Origin', '*');
    else if (o && corsOrigin.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    setCors(req, res);
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, game: 'Star Beans', rooms: game.rooms.size }));
    }
    if (url.pathname === '/ice-servers') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(await iceServers()));
    }
    // static files (only files that live next to the server folder, never the server folder itself)
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(CLIENT_DIR, '.' + rel);
    const ext = path.extname(file);
    if (file.startsWith(CLIENT_DIR + path.sep) && !file.startsWith(__dirname) && MIME[ext] && fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': MIME[ext] });
      return fs.createReadStream(file).pipe(res);
    }
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('Star Beans server is running! 🚀');
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  const io = new Server(server, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    pingInterval: 10000,
    pingTimeout: 20000,
  });
  const game = createGameServer(io);
  server.listen(PORT, () => console.log(`Star Beans server listening on port ${PORT}`));

  // Keep-awake: free Render servers fall asleep after ~15 minutes with no visitors.
  // Render tells the server its own public address (RENDER_EXTERNAL_URL), so every
  // 10 minutes the server visits its own /health page. That counts as a visitor,
  // so it never falls asleep. (Set KEEP_AWAKE=off on Render to switch this off.)
  const selfUrl = process.env.KEEP_AWAKE_URL || process.env.RENDER_EXTERNAL_URL;
  if (selfUrl && process.env.KEEP_AWAKE !== 'off' && typeof fetch === 'function') {
    const ping = () => fetch(selfUrl.replace(/\/+$/, '') + '/health', { cache: 'no-store' })
      .then(r => console.log('Keep-awake ping:', r.status))
      .catch(e => console.warn('Keep-awake ping failed:', e.message));
    setInterval(ping, 10 * 60 * 1000);
    setTimeout(ping, 30 * 1000);
  }
}

if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  startHttpServer();
}
if (typeof module !== 'undefined') module.exports = { createGameServer, SETTINGS };

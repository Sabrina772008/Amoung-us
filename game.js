/*
 * Star Beans – main game: screens, lobby, drawing, controls, meetings.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const COLOR_NAMES = Object.keys(Art.COLORS);
  const SPEED = 270;              // map units per second
  const USE_RANGE = 115;
  const VIEW_HEIGHT = 560;        // how much of the map you see (map units, vertical)
  const VISION = { crew: 390, impostor: 500 };

  /* ===================================================================== */
  /* Sound effects (made with code, no files needed)                       */
  /* ===================================================================== */
  const Sound = {
    ctx: null,
    unlock() {
      try {
        if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { /* no audio */ }
    },
    tone(freq, dur, type, vol, when, slide) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + (when || 0);
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
      g.gain.setValueAtTime(vol || 0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    play(name) {
      if (!this.ctx) return;
      switch (name) {
        case 'click': this.tone(660, 0.06, 'square', 0.05); break;
        case 'pop': this.tone(500, 0.12, 'sine', 0.15, 0, 900); break;
        case 'error': this.tone(180, 0.2, 'sawtooth', 0.08); break;
        case 'task': [523, 659, 784].forEach((f, i) => this.tone(f, 0.15, 'triangle', 0.15, i * 0.09)); break;
        case 'kill': this.tone(300, 0.35, 'sawtooth', 0.15, 0, 60); break;
        case 'alarm': for (let i = 0; i < 3; i++) { this.tone(880, 0.18, 'square', 0.08, i * 0.3); this.tone(660, 0.18, 'square', 0.08, i * 0.3 + 0.15); } break;
        case 'vote': this.tone(440, 0.1, 'triangle', 0.12); break;
        case 'join': this.tone(600, 0.1, 'sine', 0.1); this.tone(900, 0.12, 'sine', 0.1, 0.08); break;
        case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.15, i * 0.14)); break;
        case 'lose': [400, 330, 260, 200].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.15, i * 0.18)); break;
        case 'reveal': this.tone(220, 0.8, 'sine', 0.15, 0, 440); break;
      }
    },
  };
  window.Sound = Sound;

  /* ===================================================================== */
  /* State                                                                 */
  /* ===================================================================== */
  const S = {
    screen: 'home',
    view: null,              // latest room snapshot from the server
    recvAt: 0,               // when we got it (for local countdowns)
    prev: null,              // previous snapshot (to detect changes)
    me: { x: 1300, y: 450, dir: 1, moving: false, phase: 0 },
    others: new Map(),       // id -> { x, y, tx, ty, dir, moving, phase, seen }
    posSeq: -1,
    lastSent: { t: 0, x: 0, y: 0, moving: false },
    keys: {},
    joy: { x: 0, y: 0, active: false, id: null },
    profile: { name: '', color: 'red' },
    selectedVote: null,
    taskCollapsed: false,
    revealUntil: 0,
    revealRound: -1,
    ejectStart: 0,
    lastTime: performance.now(),
  };

  try {
    S.profile.name = localStorage.getItem('sb_name') || '';
    S.profile.color = localStorage.getItem('sb_color') || COLOR_NAMES[Math.floor(Math.random() * 6)];
  } catch (e) { /* ignore */ }

  function saveProfile() {
    try { localStorage.setItem('sb_name', S.profile.name); localStorage.setItem('sb_color', S.profile.color); } catch (e) { /* ignore */ }
  }

  /* ===================================================================== */
  /* Small helpers                                                         */
  /* ===================================================================== */
  function onTap(el, fn) {
    el.addEventListener('click', (e) => { Sound.unlock(); fn(e); });
  }
  function toast(text, ms) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), ms || 2800);
  }
  function setStatus(el, text, isError) {
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }
  function showScreen(name) {
    if (S.screen === name) return;
    S.screen = name;
    ['home', 'lobby', 'game'].forEach(s => $('screen-' + s).classList.toggle('hidden', s !== name));
    document.body.classList.toggle('in-game', name === 'game');
    if (name !== 'game') { Tasks.close(true); $('admin-menu').classList.add('hidden'); }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function player(id) { return S.view && S.view.players.find(p => p.id === id); }
  function isAdmin() { return S.view && S.view.adminId === S.view.myId; }
  // time left on a server timer, counted down locally
  function left(ms) {
    if (!S.view || S.view.paused) return ms;
    return Math.max(0, ms - (performance.now() - S.recvAt));
  }
  function secs(ms) { return Math.ceil(ms / 1000); }

  /* ===================================================================== */
  /* HOME SCREEN                                                           */
  /* ===================================================================== */
  function buildColorGrid(container, onPick) {
    container.innerHTML = '';
    COLOR_NAMES.forEach(c => {
      const b = document.createElement('button');
      b.className = 'color-swatch';
      b.dataset.color = c;
      b.setAttribute('aria-label', Art.COLORS[c].label);
      const img = document.createElement('img');
      img.src = Art.avatarURL(c);
      img.alt = '';
      b.appendChild(img);
      onTap(b, () => onPick(c));
      container.appendChild(b);
    });
  }
  function markColors(container, selected, taken) {
    container.querySelectorAll('.color-swatch').forEach(b => {
      b.classList.toggle('selected', b.dataset.color === selected);
      b.classList.toggle('taken', !!(taken && taken.has(b.dataset.color)) && b.dataset.color !== selected);
    });
  }

  function initHome() {
    $('name-input').value = S.profile.name;
    buildColorGrid($('color-grid-home'), (c) => {
      S.profile.color = c; saveProfile();
      markColors($('color-grid-home'), c);
      drawHomeArt();
      Sound.play('click');
    });
    markColors($('color-grid-home'), S.profile.color);
    $('name-input').addEventListener('input', () => { S.profile.name = $('name-input').value; saveProfile(); });
    $('code-input').addEventListener('input', () => {
      $('code-input').value = $('code-input').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });
    // allow links like .../index.html?room=ABC123
    const params = new URLSearchParams(location.search);
    if (params.get('room')) $('code-input').value = params.get('room').toUpperCase().slice(0, 6);

    onTap($('create-btn'), async () => {
      const name = $('name-input').value.trim();
      if (!name) { setStatus($('home-status'), 'Please type your name first 🙂', true); $('name-input').focus(); return; }
      goFullscreen();
      setBusy(true);
      setStatus($('home-status'), 'Creating room…');
      const r = await Net.createRoom(name, S.profile.color);
      setBusy(false);
      if (!r.ok) return setStatus($('home-status'), r.error || 'Could not create room.', true);
      setStatus($('home-status'), '');
    });
    onTap($('join-btn'), async () => {
      const name = $('name-input').value.trim();
      const code = $('code-input').value.trim().toUpperCase();
      if (!name) { setStatus($('home-status'), 'Please type your name first 🙂', true); $('name-input').focus(); return; }
      if (code.length !== 6) { setStatus($('home-status'), 'Room codes have 6 letters/numbers.', true); $('code-input').focus(); return; }
      goFullscreen();
      setBusy(true);
      setStatus($('home-status'), 'Joining…');
      const r = await Net.joinRoom(code, name, S.profile.color);
      setBusy(false);
      if (!r.ok) return setStatus($('home-status'), r.error || 'Could not join.', true);
      setStatus($('home-status'), '');
    });
    drawHomeArt();
  }
  function setBusy(b) { $('create-btn').disabled = b; $('join-btn').disabled = b; }

  function drawHomeArt() {
    const cv = $('home-art'), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const others = COLOR_NAMES.filter(c => c !== S.profile.color);
    const crew = [others[0], others[3], S.profile.color, others[6], others[2]];
    crew.forEach((c, i) => {
      const x = 50 + i * 65, y = 120 + (i === 2 ? -8 : Math.abs(2 - i) * 6);
      Art.drawBean(ctx, x, y, c, { dir: i < 2 ? 1 : -1, size: i === 2 ? 1.5 : 1.15 });
    });
  }

  /* ===================================================================== */
  /* LOBBY SCREEN                                                          */
  /* ===================================================================== */
  function initLobby() {
    buildColorGrid($('color-grid-lobby'), async (c) => {
      const r = await Net.request('update-profile', { color: c });
      if (!r.ok) toast(r.error || 'Could not change colour');
      else { S.profile.color = r.color; saveProfile(); Sound.play('click'); }
    });
    onTap($('save-name'), saveLobbyName);
    $('lobby-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveLobbyName(); });
    onTap($('copy-code'), copyCode);
    if (navigator.share) {
      $('share-code').classList.remove('hidden');
      onTap($('share-code'), () => {
        const code = S.view ? S.view.code : '';
        navigator.share({ title: 'Star Beans', text: `Join my Star Beans room! Code: ${code}`, url: shareLink(code) }).catch(() => {});
      });
    }
    onTap($('ready-btn'), () => {
      const me = player(S.view.myId);
      Net.send('set-ready', !(me && me.ready));
      Sound.play('click');
    });
    onTap($('start-btn'), async () => {
      const r = await Net.admin('start');
      if (!r.ok) setStatus($('lobby-hint'), r.error, true);
    });
    onTap($('mic-btn'), async () => {
      await Voice.requestMic();
      renderMicButton();
    });
    onTap($('leave-btn'), async () => {
      await Net.leaveRoom();
      Voice.closeAll();
      if (window.Video) Video.leave();
      S.view = null;
      showScreen('home');
    });
    renderMicButton();
  }
  function shareLink(code) {
    return location.origin + location.pathname + '?room=' + encodeURIComponent(code);
  }
  async function saveLobbyName() {
    const n = $('lobby-name').value.trim();
    if (!n) return toast('Name cannot be empty');
    const r = await Net.request('update-profile', { name: n });
    if (!r.ok) toast(r.error || 'Could not change name');
    else { S.profile.name = r.name; saveProfile(); $('lobby-name').blur(); toast('Name saved ✔'); }
  }
  function copyCode() {
    const code = S.view ? S.view.code : '';
    const done = () => toast('Room code copied! 📋');
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(code).then(done).catch(fallback);
    else fallback();
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = code; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Code: ' + code); }
      ta.remove();
    }
  }
  function renderMicButton() {
    const b = $('mic-btn');
    const st = Voice.micState;
    b.textContent = { off: '🎤 Allow Mic', asking: '🎤 Asking…', on: '🎤 Mic Ready ✔', denied: '🎤 Mic Blocked', unsupported: '🎤 No Mic Support' }[st] || '🎤 Allow Mic';
    b.disabled = st === 'on' || st === 'unsupported';
  }

  function renderLobby(v) {
    $('room-code').textContent = v.code;
    $('player-count').textContent = `${v.players.length}/${v.settings.maxPlayers}`;
    const list = $('player-list');
    list.innerHTML = '';
    v.players.forEach(p => {
      const li = document.createElement('li');
      if (p.id === v.myId) li.classList.add('me');
      li.innerHTML = `<img src="${Art.avatarURL(p.color, { crown: p.isAdmin })}" alt="">
        <span class="pname">${p.isAdmin ? '👑 ' : ''}${esc(p.name)}${p.id === v.myId ? ' (you)' : ''}</span>
        ${!p.connected ? '<span class="tag off">offline</span>' : p.isAdmin ? '<span class="tag ready">admin</span>' : p.ready ? '<span class="tag ready">ready ✔</span>' : '<span class="tag">not ready</span>'}`;
      list.appendChild(li);
    });
    const me = player(v.myId);
    if (document.activeElement !== $('lobby-name')) $('lobby-name').value = me ? me.name : '';
    const taken = new Set(v.players.filter(p => p.id !== v.myId).map(p => p.color));
    markColors($('color-grid-lobby'), me && me.color, taken);
    if (me) { S.profile.color = me.color; S.profile.name = me.name; saveProfile(); }

    const admin = v.adminId === v.myId;
    $('ready-btn').classList.toggle('hidden', admin);
    $('ready-btn').textContent = me && me.ready ? '✔ Ready! (tap to undo)' : "✋ I'm Ready";
    $('ready-btn').className = 'big-btn ' + (me && me.ready ? 'blue' : 'green') + (admin ? ' hidden' : '');
    $('start-btn').classList.toggle('hidden', !admin);
    const notReady = v.players.filter(p => !p.isAdmin && !p.ready);
    const enough = v.players.length >= v.settings.minPlayers;
    $('start-btn').disabled = !enough || notReady.length > 0;
    let hint = '';
    if (!enough) hint = `Share the code! You need at least ${v.settings.minPlayers} players.`;
    else if (notReady.length) hint = `Waiting for ${notReady.map(p => p.name).join(', ')} to be ready…`;
    else hint = admin ? 'Everyone is ready – press Start!' : 'Waiting for the admin to start…';
    setStatus($('lobby-hint'), hint);
  }

  /* ===================================================================== */
  /* ROOM UPDATES FROM THE SERVER                                          */
  /* ===================================================================== */
  Net.on('room', (v) => {
    const prev = S.view;
    S.prev = prev;
    S.view = v;
    S.recvAt = performance.now();
    if (window.Video) Video.update(v);

    if (v.phase === 'lobby') {
      showScreen('lobby');
      renderLobby(v);
      Voice.syncPeers(v.myId, v.players, false);
      Voice.setMode(false, true, {});
      return;
    }
    showScreen('game');

    // new round started
    if (!prev || prev.round !== v.round || prev.phase === 'lobby') {
      S.others.clear();
      S.selectedVote = null;
      if (v.revealLeft > 0 && S.revealRound !== v.round) {
        S.revealRound = v.round;
        S.revealUntil = performance.now() + v.revealLeft;
        showReveal(v);
      }
    }
    // teleport (start of round / after meetings)
    if (v.posSeq !== S.posSeq) {
      S.posSeq = v.posSeq;
      S.me.x = v.me.x; S.me.y = v.me.y; S.me.moving = false;
      S.others.forEach(o => { o.snap = true; });
    }
    // phase changes
    const pPhase = prev ? prev.phase : null;
    if (v.phase === 'meeting' && pPhase !== 'meeting') {
      Tasks.close(true);
      S.selectedVote = null;
      Sound.play('alarm');
      if (navigator.vibrate) navigator.vibrate([100, 60, 100]);
    }
    if (v.phase === 'ejecting' && pPhase !== 'ejecting') S.ejectStart = performance.now();
    if (v.phase === 'ended' && pPhase !== 'ended') {
      Tasks.close(true);
      const won = didIWin(v);
      Sound.play(won ? 'win' : 'lose');
    }
    if (v.paused) Tasks.close(true);
    if (prev && prev.me.alive && !v.me.alive && v.phase === 'playing') Tasks.close(true);

    updateHud(v);
    updateOverlays(v);

    // voice chat: connect to everyone during a game, only "on" during meetings
    Voice.syncPeers(v.myId, v.players, true);
    const aliveMap = {};
    v.players.forEach(p => { aliveMap[p.id] = p.alive; });
    Voice.setMode(v.phase === 'meeting', v.me.alive, aliveMap);
  });

  Net.on('pos', (list) => {
    if (!S.view) return;
    const seen = new Set();
    for (const [id, x, y, dir, moving] of list) {
      if (id === S.view.myId) continue;
      seen.add(id);
      let o = S.others.get(id);
      if (!o) { o = { x, y, tx: x, ty: y, dir, moving: !!moving, phase: 0 }; S.others.set(id, o); }
      if (o.snap || Math.hypot(o.x - x, o.y - y) > 400) { o.x = x; o.y = y; o.snap = false; }
      o.tx = x; o.ty = y; o.dir = dir; o.moving = !!moving;
    }
    for (const id of [...S.others.keys()]) if (!seen.has(id)) S.others.delete(id);
  });

  Net.on('event', (e) => {
    if (e.type === 'toast') { toast(e.text); if (/joined/.test(e.text)) Sound.play('join'); }
    else if (e.type === 'eliminated') {
      Sound.play('kill');
      if (navigator.vibrate) navigator.vibrate(300);
      toast('💥 You were eliminated! You are now a ghost 👻', 4000);
    } else if (e.type === 'peer-left') Voice.closePeer(e.id);
  });

  Net.on('status', ({ status, message }) => {
    const inRoom = !!Net.roomCode;
    $('conn-banner').classList.toggle('hidden', status !== 'offline' || !inRoom);
    if (S.screen === 'home') {
      if (status === 'connecting') setStatus($('home-status'), 'Connecting to the game server…');
      else if (status === 'online') setStatus($('home-status'), '🟢 Connected to the game server');
      else if (status === 'offline') setStatus($('home-status'), message || 'Connection lost. Retrying…', true);
    }
  });
  Net.on('kicked', (msg) => {
    toast(msg || 'You left the room');
    S.view = null;
    Voice.closeAll();
    if (window.Video) Video.leave();
    showScreen('home');
  });
  Net.on('rtc-signal', (d) => Voice.handleSignal(d));
  Voice.onChange = () => { renderMicButton(); renderVoiceStatus(); };

  /* ===================================================================== */
  /* HUD                                                                   */
  /* ===================================================================== */
  function myTaskMap(v) {
    const m = {};
    if (v && v.me.tasks) v.me.tasks.forEach(t => { m[t.id] = t.done; });
    return m;
  }
  function updateHud(v) {
    const imp = v.me.role === 'impostor';
    const badge = $('role-badge');
    badge.textContent = !v.me.alive ? (imp ? '👻 IMPOSTOR GHOST' : '👻 GHOST') : imp ? '😈 IMPOSTOR' : '🧑‍🚀 CREWMATE';
    badge.className = 'role-badge' + (imp ? ' impostor' : '') + (!v.me.alive ? ' ghost' : '');
    const ul = $('task-list');
    ul.innerHTML = '';
    if (imp) {
      const li = document.createElement('li');
      li.className = 'fake';
      li.textContent = 'Eliminate the crew! These tasks are fake – pretend to do them:';
      ul.appendChild(li);
    }
    v.me.tasks.forEach(t => {
      const def = GameMap.taskById(t.id);
      const li = document.createElement('li');
      li.textContent = `${def.room}: ${def.name}`;
      if (t.done) li.className = 'done';
      else if (imp) li.className = 'fake';
      ul.appendChild(li);
    });
    $('task-count').textContent = imp ? '' : `${v.me.tasks.filter(t => t.done).length}/${v.me.tasks.length}`;
    $('task-panel').classList.toggle('collapsed', S.taskCollapsed);
    $('task-bar').style.width = Math.round(v.taskProgress * 100) + '%';
    $('admin-btn').classList.toggle('hidden', !isAdmin());
    if (!isAdmin()) $('admin-menu').classList.add('hidden');
    $('adm-pause').classList.toggle('hidden', v.paused);
    $('adm-resume').classList.toggle('hidden', !v.paused);
    $('btn-kill').classList.toggle('hidden', !(imp && v.me.alive));
    $('btn-report').classList.toggle('hidden', !v.me.alive);
    $('ghost-banner').classList.toggle('hidden', v.me.alive || v.phase !== 'playing');
  }

  function updateOverlays(v) {
    $('meeting-overlay').classList.toggle('hidden', v.phase !== 'meeting');
    $('eject-overlay').classList.toggle('hidden', v.phase !== 'ejecting');
    $('end-overlay').classList.toggle('hidden', v.phase !== 'ended');
    $('paused-overlay').classList.toggle('hidden', !v.paused || v.phase === 'meeting');
    $('paused-resume').classList.toggle('hidden', !isAdmin());
    $('meeting-admin').classList.toggle('hidden', !isAdmin());
    if (v.phase !== 'playing') { $('reveal-overlay').classList.add('hidden'); S.revealUntil = 0; }
    if (v.phase === 'meeting') renderMeeting(v);
    if (v.phase === 'ejecting') renderEjection(v);
    if (v.phase === 'ended') renderEnd(v);
  }

  function showReveal(v) {
    const imp = v.me.role === 'impostor';
    $('reveal-sub').textContent = imp ? 'Shhh… it’s a secret!' : 'Welcome aboard!';
    $('reveal-title').textContent = imp ? 'You are the IMPOSTOR' : 'You are a CREWMATE';
    $('reveal-title').className = 'reveal-title ' + (imp ? 'impostor' : 'crew');
    $('reveal-avatar').src = Art.avatarURL(player(v.myId).color);
    $('reveal-text').textContent = imp
      ? 'Sneak up on crewmates and eliminate them without getting caught. Don’t tell anyone!'
      : 'There is 1 impostor among us. Finish your tasks and find the impostor!';
    $('reveal-overlay').classList.remove('hidden');
    Sound.play('reveal');
  }

  /* ===================================================================== */
  /* MEETINGS & VOTING                                                     */
  /* ===================================================================== */
  function renderMeeting(v) {
    const m = v.meeting;
    const caller = player(m.callerId);
    $('meeting-title').textContent = m.reason === 'report' ? '📢 Eliminated crewmate found!' : '🚨 Emergency Meeting!';
    let sub = caller ? `${caller.name} ${m.reason === 'report' ? `reported ${m.bodyName}` : 'pressed the button'}. ` : '';
    sub += m.stage === 'discussion' ? 'Talk it over… voting opens soon.' : 'Vote for who you think is the impostor!';
    if (!v.me.alive) sub = '👻 Ghosts can’t vote. Only other ghosts can hear you.';
    $('meeting-sub').textContent = sub;

    const canVote = v.me.alive && m.stage === 'voting' && m.myVote === undefined && !v.paused;
    const cards = $('meeting-cards');
    cards.innerHTML = '';
    v.players.forEach(p => {
      const card = document.createElement('div');
      card.className = 'vote-card' + (!p.alive ? ' dead' : '') + (S.selectedVote === p.id ? ' selected' : '') + (m.myVote === p.id ? ' myvote' : '');
      card.innerHTML = `<img src="${Art.avatarURL(p.color, { dead: !p.alive })}" alt="">
        <span class="vname">${p.isAdmin ? '👑 ' : ''}${esc(p.name)}${p.id === v.myId ? ' (you)' : ''}</span>
        ${p.id === m.callerId ? '<span class="caller-badge">📣</span>' : ''}
        ${m.voted.includes(p.id) ? '<span class="voted-badge">VOTED</span>' : ''}`;
      if (canVote && p.alive) {
        card.addEventListener('click', () => { S.selectedVote = p.id; Sound.play('click'); renderMeeting(S.view); });
        if (S.selectedVote === p.id) {
          const c = document.createElement('span');
          c.className = 'confirm';
          c.innerHTML = '<button class="ok">✔</button><button class="no">✕</button>';
          c.querySelector('.ok').addEventListener('click', (e) => { e.stopPropagation(); castVote(p.id); });
          c.querySelector('.no').addEventListener('click', (e) => { e.stopPropagation(); S.selectedVote = null; renderMeeting(S.view); });
          card.appendChild(c);
        }
      }
      cards.appendChild(card);
    });
    $('skip-btn').disabled = !canVote;
    $('skip-btn').textContent = m.myVote === 'skip' ? '⏭ You skipped' : '⏭ Skip vote';
    $('skip-confirm').classList.toggle('hidden', !(canVote && S.selectedVote === 'skip'));
    renderVoiceStatus();
  }
  async function castVote(targetId) {
    S.selectedVote = null;
    const r = await Net.request('vote', { targetId });
    if (!r.ok) toast(r.error || 'Vote failed');
    else Sound.play('vote');
  }

  function renderVoiceStatus() {
    const st = Voice.micState;
    const mute = $('mute-btn');
    if (st === 'on') mute.textContent = Voice.muted ? '🔇 Unmute' : '🎤 Mute';
    else if (st === 'denied') mute.textContent = '🎤 Mic blocked';
    else if (st === 'unsupported') mute.textContent = '🎤 No mic';
    else mute.textContent = '🎤 Turn on mic';
    $('sound-btn').classList.toggle('hidden', !Voice.needsTap);
    const total = Voice.peers.size;
    let text = total ? `Voice: ${Voice.connectedCount()}/${total} connected` : '';
    if (st === 'denied') text = 'Microphone blocked – allow it in your browser settings.';
    $('voice-status').textContent = text;
  }

  /* ===================================================================== */
  /* EJECTION + END SCREENS                                                */
  /* ===================================================================== */
  function renderEjection(v) {
    const e = v.ejection;
    let text, sub = '';
    if (e.ejectedId) {
      text = `${e.name} was ejected.`;
      sub = e.wasImpostor ? `${e.name} was the Impostor! 🎉` : `${e.name} was not the Impostor. 😮`;
    } else if (e.tie) { text = 'No one was ejected.'; sub = 'It was a tie!'; }
    else { text = 'No one was ejected.'; sub = 'Most players skipped.'; }
    $('eject-text').textContent = text;
    $('eject-sub').textContent = sub;
  }

  function didIWin(v) {
    const r = v.result;
    if (!r || r.winner === 'none') return false;
    return (r.winner === 'impostor') === (v.me.role === 'impostor');
  }
  function renderEnd(v) {
    const r = v.result;
    const won = didIWin(v);
    const t = $('end-title');
    if (r.winner === 'none') { t.textContent = 'GAME OVER'; t.className = 'end-title'; }
    else { t.textContent = won ? 'VICTORY!' : 'DEFEAT'; t.className = 'end-title ' + (won ? 'win' : 'lose'); }
    $('end-sub').textContent = (r.winner === 'crew' ? '🧑‍🚀 Crewmates win! ' : r.winner === 'impostor' ? '😈 Impostor wins! ' : '') + r.reason;
    $('end-impostor').innerHTML = r.impostorIds.length
      ? r.impostorNames.map((n, i) => `<img src="${Art.avatarURL(r.impostorColors[i])}" alt=""> <span>The impostor was <span style="color:${Art.COLORS[r.impostorColors[i]].main}">${esc(n)}</span></span>`).join('')
      : '';
    $('end-admin').classList.toggle('hidden', !isAdmin());
    $('end-wait').classList.toggle('hidden', isAdmin());
  }

  // floating bean animation on the ejection screen
  function drawEjection(now) {
    const cv = $('eject-canvas');
    const w = cv.clientWidth, h = cv.clientHeight, dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#050816'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const x = ((i * 137.5 + now * 0.05 * (1 + i % 3)) % (w + 20)) - 10;
      const y = (i * 71.3) % h;
      ctx.fillStyle = 'rgba(255,255,255,' + (0.3 + (i % 5) / 7) + ')';
      ctx.fillRect(w - x, y, 2, 2);
    }
    const e = S.view && S.view.ejection;
    if (e && e.ejectedId) {
      const t = Math.min(1, (now - S.ejectStart) / 5000);
      ctx.save();
      ctx.translate(-80 + t * (w + 160), h * 0.32);
      ctx.rotate(now / 500);
      Art.drawBean(ctx, 0, 0, e.color, { dir: 1, size: 1.6 });
      ctx.restore();
    }
  }

  /* ===================================================================== */
  /* GAME BUTTONS                                                          */
  /* ===================================================================== */
  function initGameUi() {
    onTap($('task-toggle'), () => { S.taskCollapsed = !S.taskCollapsed; $('task-panel').classList.toggle('collapsed', S.taskCollapsed); });
    onTap($('admin-btn'), () => $('admin-menu').classList.toggle('hidden'));
    onTap($('meeting-admin'), () => $('admin-menu').classList.toggle('hidden'));
    onTap($('adm-close'), () => $('admin-menu').classList.add('hidden'));
    const adminAction = (action, confirmBtn, label) => async () => {
      if (confirmBtn && !confirmBtn.dataset.armed) {
        confirmBtn.dataset.armed = '1';
        const old = confirmBtn.textContent;
        confirmBtn.textContent = 'Tap again to confirm';
        setTimeout(() => { delete confirmBtn.dataset.armed; confirmBtn.textContent = old; }, 2500);
        return;
      }
      if (confirmBtn) { delete confirmBtn.dataset.armed; confirmBtn.textContent = label; }
      $('admin-menu').classList.add('hidden');
      const r = await Net.admin(action);
      if (!r.ok) toast(r.error || 'Could not do that');
    };
    onTap($('adm-pause'), adminAction('pause'));
    onTap($('adm-resume'), adminAction('resume'));
    onTap($('paused-resume'), adminAction('resume'));
    onTap($('adm-restart'), adminAction('restart', $('adm-restart'), '🔄 Restart round'));
    onTap($('adm-end'), adminAction('end', $('adm-end'), '⏹ End game'));
    onTap($('end-again'), adminAction('restart'));
    onTap($('end-lobby'), adminAction('end'));
    onTap($('fs-btn'), toggleFullscreen);

    onTap($('skip-btn'), () => { S.selectedVote = 'skip'; renderMeeting(S.view); });
    onTap($('skip-yes'), () => castVote('skip'));
    onTap($('skip-no'), () => { S.selectedVote = null; renderMeeting(S.view); });
    onTap($('mute-btn'), async () => {
      if (Voice.micState === 'on') Voice.toggleMute();
      else if (Voice.micState === 'off' || Voice.micState === 'denied') await Voice.requestMic();
      renderVoiceStatus();
    });
    onTap($('sound-btn'), () => Voice.unlockAudio());

    const press = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); Sound.unlock(); fn(); });
    press($('btn-use'), doUse);
    press($('btn-report'), doReport);
    press($('btn-kill'), doKill);

    // first tap anywhere unlocks sound (needed on iPhone/iPad)
    document.addEventListener('pointerdown', () => { Sound.unlock(); if (Voice.needsTap) Voice.unlockAudio(); }, { passive: true });
  }

  function goFullscreen() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement && el.requestFullscreen && matchMedia('(pointer: coarse)').matches) {
        el.requestFullscreen().then(() => {
          if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
        }).catch(() => {});
      }
    } catch (e) { /* not supported (iPhone) */ }
  }
  function toggleFullscreen() {
    const el = document.documentElement;
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => toast('Tip: on iPhone, use Share → Add to Home Screen for full screen'));
      else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
      else toast('Tip: on iPhone, use Share → Add to Home Screen for full screen');
    } catch (e) { /* ignore */ }
  }

  /* ===================================================================== */
  /* ACTIONS (use / report / eliminate)                                    */
  /* ===================================================================== */
  function canAct() {
    const v = S.view;
    return v && v.phase === 'playing' && !v.paused && performance.now() > S.revealUntil && !Tasks.isOpen();
  }
  function nearestTask() {
    const v = S.view;
    let best = null, bd = USE_RANGE;
    for (const t of v.me.tasks) {
      if (t.done) continue;
      const def = GameMap.taskById(t.id);
      const d = Math.hypot(def.x - S.me.x, def.y - S.me.y);
      if (d < bd) { bd = d; best = def; }
    }
    return best;
  }
  function nearButton() {
    const v = S.view;
    if (!v.me.alive || v.me.emergencyUsed) return false;
    return Math.hypot(GameMap.BUTTON.x - S.me.x, GameMap.BUTTON.y - S.me.y) < v.settings.buttonRange;
  }
  function nearestBody() {
    const v = S.view;
    let best = null, bd = v.settings.reportRange;
    for (const b of v.bodies) {
      const d = Math.hypot(b.x - S.me.x, b.y - S.me.y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  function nearestVictim() {
    const v = S.view;
    let best = null, bd = v.settings.killRange;
    for (const [id, o] of S.others) {
      const p = player(id);
      if (!p || !p.alive) continue;
      const d = Math.hypot(o.x - S.me.x, o.y - S.me.y);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  function doUse() {
    if (!canAct()) return;
    const v = S.view;
    const task = nearestTask();
    if (task) {
      Tasks.open(task, {
        onDone: async () => {
          if (v.me.role === 'impostor') { toast('Nice acting! (Impostor tasks are fake 😈)'); return; }
          const r = await Net.request('task-complete', { taskId: task.id });
          if (r.ok) toast('✔ ' + task.name + ' done!');
        },
      });
      return;
    }
    if (nearButton()) {
      if (left(v.emergencyCooldown) > 0) { toast(`Button ready in ${secs(left(v.emergencyCooldown))}s`); return; }
      Net.request('emergency', {}).then(r => { if (!r.ok && r.error) toast(r.error); });
    }
  }
  function doReport() {
    if (!canAct() || !S.view.me.alive) return;
    const b = nearestBody();
    if (b) Net.request('report', { bodyId: b.id }).then(r => { if (!r.ok && r.error) toast(r.error); });
  }
  function doKill() {
    if (!canAct()) return;
    const v = S.view;
    if (v.me.role !== 'impostor' || !v.me.alive || left(v.me.killCooldown) > 0) return;
    const id = nearestVictim();
    if (!id) return;
    Net.request('kill', { targetId: id }).then(r => {
      if (r.ok) Sound.play('kill');
      else if (r.error) toast(r.error);
    });
  }

  /* ===================================================================== */
  /* INPUT: joystick + keyboard                                            */
  /* ===================================================================== */
  function initInput() {
    const zone = $('joy-zone'), base = $('joy-base'), knob = $('joy-knob');
    const R = 60;
    let center = null;
    function setKnob(dx, dy) {
      const kw = knob.offsetWidth, bw = base.clientWidth;
      knob.style.left = (bw / 2 - kw / 2 + dx) + 'px';
      knob.style.top = (bw / 2 - kw / 2 + dy) + 'px';
    }
    zone.addEventListener('pointerdown', (e) => {
      if (S.joy.active) return;
      e.preventDefault();
      Sound.unlock();
      S.joy.active = true; S.joy.id = e.pointerId;
      const zr = zone.getBoundingClientRect();
      const bw = base.offsetWidth;
      // the joystick appears where your thumb touches
      base.style.left = (e.clientX - zr.left - bw / 2) + 'px';
      base.style.top = (e.clientY - zr.top - bw / 2) + 'px';
      base.style.bottom = 'auto';
      center = { x: e.clientX, y: e.clientY };
      try { zone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      move(e);
    });
    function move(e) {
      if (!S.joy.active || e.pointerId !== S.joy.id) return;
      let dx = e.clientX - center.x, dy = e.clientY - center.y;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = dx / d * R; dy = dy / d * R; }
      setKnob(dx, dy);
      const mag = Math.min(1, d / R);
      S.joy.x = d > 6 ? (dx / (Math.hypot(dx, dy) || 1)) * mag : 0;
      S.joy.y = d > 6 ? (dy / (Math.hypot(dx, dy) || 1)) * mag : 0;
    }
    function end(e) {
      if (e.pointerId !== S.joy.id) return;
      S.joy.active = false; S.joy.x = 0; S.joy.y = 0; S.joy.id = null;
      base.style.left = ''; base.style.top = ''; base.style.bottom = '';
      setKnob(0, 0);
    }
    zone.addEventListener('pointermove', move);
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      S.keys[e.key.toLowerCase()] = true;
      if (S.screen !== 'game') return;
      if (e.key === 'e' || e.key === 'E' || e.key === ' ') doUse();
      if (e.key === 'r' || e.key === 'R') doReport();
      if (e.key === 'q' || e.key === 'Q') doKill();
      if (e.key === 'Escape') Tasks.close();
    });
    window.addEventListener('keyup', (e) => { S.keys[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { S.keys = {}; });
  }

  function inputVector() {
    let x = S.joy.x, y = S.joy.y;
    const k = S.keys;
    if (k.arrowleft || k.a) x -= 1;
    if (k.arrowright || k.d) x += 1;
    if (k.arrowup || k.w) y -= 1;
    if (k.arrowdown || k.s) y += 1;
    const m = Math.hypot(x, y);
    if (m > 1) { x /= m; y /= m; }
    return { x, y };
  }

  /* ===================================================================== */
  /* MAIN LOOP                                                             */
  /* ===================================================================== */
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  const mini = $('mini-map').getContext('2d');
  let miniTimer = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }
  window.addEventListener('resize', resize);

  function update(dt) {
    const v = S.view;
    if (!v || v.phase !== 'playing') return;
    const now = performance.now();
    if (S.revealUntil && now > S.revealUntil) { $('reveal-overlay').classList.add('hidden'); S.revealUntil = 0; }

    // my movement
    let moving = false;
    if (canAct()) {
      const iv = inputVector();
      if (iv.x || iv.y) {
        const dx = iv.x * SPEED * dt, dy = iv.y * SPEED * dt;
        if (!v.me.alive) {   // ghosts float through walls
          S.me.x = Math.max(60, Math.min(GameMap.WORLD.w - 60, S.me.x + dx));
          S.me.y = Math.max(60, Math.min(GameMap.WORLD.h - 60, S.me.y + dy));
        } else {
          const p = GameMap.moveWithCollision(S.me.x, S.me.y, dx, dy, 18);
          S.me.x = p.x; S.me.y = p.y;
          // gently bump into other players
          for (const [id, o] of S.others) {
            const pl = player(id);
            if (!pl || !pl.alive) continue;
            const ddx = S.me.x - o.x, ddy = S.me.y - o.y, d = Math.hypot(ddx, ddy);
            if (d > 0 && d < 34) {
              const push = (34 - d);
              const nx = S.me.x + ddx / d * push, ny = S.me.y + ddy / d * push;
              if (GameMap.canStand(nx, ny, 18)) { S.me.x = nx; S.me.y = ny; }
            }
          }
        }
        if (Math.abs(iv.x) > 0.15) S.me.dir = iv.x < 0 ? -1 : 1;
        moving = true;
        S.me.phase += dt * 12;
      }
    }
    S.me.moving = moving;

    // tell the server where I am (about 15 times a second)
    const ls = S.lastSent;
    if (now - ls.t > 66 && (Math.abs(ls.x - S.me.x) > 0.5 || Math.abs(ls.y - S.me.y) > 0.5 || ls.moving !== moving)) {
      Net.send('move', { x: Math.round(S.me.x), y: Math.round(S.me.y), dir: S.me.dir, moving });
      ls.t = now; ls.x = S.me.x; ls.y = S.me.y; ls.moving = moving;
    }

    // smooth other players towards their latest position
    const k = 1 - Math.exp(-dt * 14);
    for (const o of S.others.values()) {
      const ox = o.x, oy = o.y;
      o.x += (o.tx - o.x) * k;
      o.y += (o.ty - o.y) * k;
      const moved = Math.hypot(o.x - ox, o.y - oy);
      if (o.moving || moved > 0.3) o.phase += dt * 12;
    }

    // action buttons
    const task = nearestTask();
    const useReady = !!task || (nearButton() && left(v.emergencyCooldown) <= 0);
    $('btn-use').classList.toggle('ready', canAct() && useReady);
    $('btn-use').querySelector('.a-icon').textContent = task ? task.icon : nearButton() ? '🚨' : '✋';
    $('btn-report').classList.toggle('ready', canAct() && v.me.alive && !!nearestBody());
    if (v.me.role === 'impostor' && v.me.alive) {
      const cd = left(v.me.killCooldown);
      $('btn-kill').querySelector('.a-cd').textContent = cd > 0 ? secs(cd) : '';
      $('btn-kill').classList.toggle('ready', canAct() && cd <= 0 && !!nearestVictim());
    }
    $('room-name').textContent = GameMap.roomAt(S.me.x, S.me.y);
  }

  function render(now) {
    const v = S.view;
    if (S.screen !== 'game' || !v) return;
    if (v.phase === 'ejecting') { drawEjection(now); }
    if (v.phase === 'meeting') {
      const m = v.meeting;
      $('meeting-timer').textContent = secs(left(m.timeLeft));
      $('meeting-timer').style.color = m.stage === 'voting' ? '#ffe066' : '#fff';
      return;
    }
    if (v.phase !== 'playing' && v.phase !== 'ended') return;

    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw) return;
    if (canvas.width !== Math.round(cw * Math.min(window.devicePixelRatio || 1, 2))) resize();
    const dpr = canvas.width / cw;
    const scale = Math.min(ch / VIEW_HEIGHT, cw / 760);
    const vw = cw / scale, vh = ch / scale;
    const camX = S.me.x - vw / 2, camY = S.me.y - vh / 2;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, -camX * dpr * scale, -camY * dpr * scale);
    const view = { x: camX, y: camY, w: vw, h: vh };

    const myTasks = v.me.role === 'crew' || v.me.role === 'impostor' ? myTaskMap(v) : {};
    GameMap.drawMap(ctx, view, now, { myTasks });

    const alive = v.me.alive;
    const visionR = !alive ? Infinity : v.me.role === 'impostor' ? VISION.impostor : VISION.crew;
    const inVision = (x, y) => Math.hypot(x - S.me.x, y - S.me.y) < visionR + 20;

    // bodies
    for (const b of v.bodies) if (inVision(b.x, b.y)) {
      Art.drawBody(ctx, b.x, b.y, b.color, now);
      Art.drawNameTag(ctx, b.x, b.y - 50, b.name, { color: '#ffb3ba' });
    }

    // characters, sorted so lower ones are drawn on top
    const list = [];
    for (const [id, o] of S.others) {
      const p = player(id);
      if (!p) continue;
      if (!inVision(o.x, o.y)) continue;
      list.push({ p, x: o.x, y: o.y, dir: o.dir, moving: o.moving, phase: o.phase, me: false });
    }
    const mp = player(v.myId);
    if (mp) list.push({ p: mp, x: S.me.x, y: S.me.y, dir: S.me.dir, moving: S.me.moving, phase: S.me.phase, me: true });
    list.sort((a, b) => a.y - b.y);
    for (const c of list) {
      const ghost = !c.p.alive || (c.me && !v.me.alive);
      Art.drawBean(ctx, c.x, c.y, c.p.color, { dir: c.dir, moving: c.moving, phase: c.phase, ghost });
    }
    for (const c of list) {
      const ghost = !c.p.alive || (c.me && !v.me.alive);
      const label = (c.p.isAdmin ? '👑 ' : '') + c.p.name;
      const color = c.me && v.me.role === 'impostor' ? '#ff6b78' : '#fff';
      Art.drawNameTag(ctx, c.x, c.y - (ghost ? 58 : 48), label, { color });
    }

    // highlight what you can interact with
    if (canAct()) {
      const t = nearestTask();
      if (t) ring(t.x, t.y, 36, '#ffe066', now);
      else if (nearButton()) ring(GameMap.BUTTON.x, GameMap.BUTTON.y, 40, '#ff6b78', now);
      if (v.me.role === 'impostor' && v.me.alive && left(v.me.killCooldown) <= 0) {
        const id = nearestVictim();
        const o = id && S.others.get(id);
        if (o) ring(o.x, o.y, 34, '#ff4757', now);
      }
    }

    // darkness outside your vision
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (alive) {
      const sx = (S.me.x - camX) * scale, sy = (S.me.y - camY) * scale, r = visionR * scale;
      const g = ctx.createRadialGradient(sx, sy, r * 0.65, sx, sy, r);
      g.addColorStop(0, 'rgba(4,6,18,0)');
      g.addColorStop(1, 'rgba(4,6,18,0.88)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);
    }

    // mini map (a few times per second is enough)
    if (now - miniTimer > 250) {
      miniTimer = now;
      const mc = $('mini-map');
      GameMap.drawMiniMap(mini, mc.width, mc.height, S.me, v.me.role === 'crew' ? myTaskMap(v) : null);
    }
  }

  function ring(x, y, r, color, now) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(now / 150);
    ctx.beginPath(); ctx.arc(x, y, r + 4 * Math.sin(now / 200), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function loop(now) {
    const dt = Math.min(0.05, (now - S.lastTime) / 1000);
    S.lastTime = now;
    try {
      update(dt);
      render(now);
    } catch (e) { console.error(e); }
    requestAnimationFrame(loop);
  }

  /* ===================================================================== */
  /* START                                                                 */
  /* ===================================================================== */
  initHome();
  initLobby();
  initGameUi();
  initInput();
  resize();
  Net.connect();
  requestAnimationFrame(loop);

  // when the phone wakes up again, make sure we are connected
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Net.socket && !Net.socket.connected) Net.socket.connect();
  });

  window.StarBeans = { S }; // handy for debugging in the browser console
})();

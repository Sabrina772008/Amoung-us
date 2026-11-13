/*
 * Star Beans – connection to the multiplayer server (Socket.IO)
 */
(function () {
  'use strict';

  function serverUrl() {
    const params = new URLSearchParams(location.search);
    let url = params.get('server') || (window.STAR_BEANS_CONFIG && window.STAR_BEANS_CONFIG.SERVER_URL) || '';
    url = url.trim().replace(/\/+$/, '');
    if (!url) return location.origin;            // local testing: same address as the page
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    // Pages served over https must talk to the server over https / wss
    if (location.protocol === 'https:' && url.startsWith('http://')) url = 'https://' + url.slice(7);
    return url;
  }

  // A stable id for this browser tab, so you can reconnect to your seat if the connection drops
  function playerId() {
    let id = null;
    try { id = sessionStorage.getItem('sb_pid'); } catch (e) { /* private mode */ }
    if (!id) {
      id = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      try { sessionStorage.setItem('sb_pid', id); } catch (e) { /* ignore */ }
    }
    return id;
  }

  // Your login pass, so you stay logged in on this phone/tablet
  function loadToken() { try { return localStorage.getItem('sb_login') || ''; } catch (e) { return ''; } }
  function saveToken(t) { try { if (t) localStorage.setItem('sb_login', t); else localStorage.removeItem('sb_login'); } catch (e) { /* ignore */ } }

  // Supabase: cousins make their own accounts. Names become a pretend email
  // address (the same style Friend Arcade uses), so nobody needs a real email.
  const CFG = window.STAR_BEANS_CONFIG || {};
  const sb = (window.supabase && CFG.SUPABASE_URL && CFG.SUPABASE_KEY)
    ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
    : null;
  function nameToEmail(name) {
    const slug = String(name || '').trim().toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9._-]/g, '');
    return slug ? slug + '@players.friendarcade.app' : '';
  }
  function friendlyError(msg) {
    msg = String(msg || '');
    if (/already registered|already exists/i.test(msg)) return 'That name is already taken. Try logging in, or pick another name.';
    if (/invalid login|invalid credentials/i.test(msg)) return 'Name or password is wrong.';
    if (/at least 6|password should be/i.test(msg)) return 'Passwords need at least 6 letters or numbers.';
    if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
    if (/email/i.test(msg)) return 'Names can only use letters, numbers, dots and dashes.';
    return msg || 'Something went wrong. Try again.';
  }

  const listeners = {};
  const Net = {
    socket: null,
    url: '',
    pid: playerId(),
    roomCode: null,
    status: 'idle',   // idle | connecting | online | offline
    token: loadToken(),
    sb,
    login: { known: false, required: false, name: null },

    on(event, fn) { (listeners[event] = listeners[event] || []).push(fn); },
    fire(event, data) { (listeners[event] || []).forEach(fn => fn(data)); },

    connect() {
      if (this.socket) return;
      if (typeof io !== 'function') {
        this.setStatus('offline', 'Could not load the multiplayer library. Check your internet connection.');
        return;
      }
      this.url = serverUrl();
      if (/\.github\.io$/i.test(location.hostname) && this.url === location.origin) {
        this.setStatus('offline', 'The game server address is missing. Put your Render address in config.js (SERVER_URL).');
        return;
      }
      this.setStatus('connecting');
      const s = io(this.url, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 800,
        reconnectionDelayMax: 4000,
        timeout: 20000,
        // our login pass, sent again on every reconnect
        auth: (cb) => {
          if (!sb) return cb({ token: this.token });
          sb.auth.getSession().then(({ data }) => cb({ token: (data && data.session && data.session.access_token) || this.token }))
            .catch(() => cb({ token: this.token }));
        },
      });
      this.socket = s;
      s.on('connect', () => {
        this.setStatus('online');
        if (this.roomCode) {
          // we were in a room – take our seat back
          this.request('join-room', { code: this.roomCode, playerId: this.pid }).then(r => {
            if (!r.ok) { this.roomCode = null; this.fire('kicked', r.error); }
          });
        }
      });
      s.on('disconnect', () => this.setStatus('offline'));
      s.on('connect_error', () => this.setStatus('offline', 'Can’t reach the game server yet. If it was asleep it can take up to a minute to wake up…'));
      s.on('login-state', (st) => {
        // the server forgot our pass (passwords changed, or it expired)
        if (st.required && !st.name && this.token && st.mode !== 'supabase') { this.token = ''; saveToken(''); }
        this.login = { known: true, required: !!st.required, mode: st.mode || 'accounts', name: st.name || null };
        this.fire('login', this.login);
      });
      s.on('room', (v) => { this.roomCode = v.code; this.fire('room', v); });
      s.on('pos', (p) => this.fire('pos', p));
      s.on('event', (e) => this.fire('event', e));
      s.on('rtc-signal', (d) => this.fire('rtc-signal', d));
    },

    setStatus(st, msg) {
      this.status = st;
      this.fire('status', { status: st, message: msg });
    },

    // emit with a reply (Promise). Times out after 10 seconds.
    request(event, data) {
      return new Promise((resolve) => {
        if (!this.socket || !this.socket.connected) return resolve({ ok: false, error: 'Not connected to the server yet.' });
        let done = false;
        const t = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, error: 'The server did not answer. Try again.' }); } }, 10000);
        this.socket.emit(event, data, (res) => { if (done) return; done = true; clearTimeout(t); resolve(res || { ok: false }); });
      });
    },

    send(event, data) {
      if (this.socket && this.socket.connected) this.socket.emit(event, data);
    },

    async logIn(name, password) {
      if (this.login.mode === 'supabase' && sb) {
        const email = nameToEmail(name);
        if (!email) return { ok: false, error: 'Type your name.' };
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error || !data.session) return { ok: false, error: friendlyError(error && error.message) };
        return this.request('auth', { token: data.session.access_token });
      }
      const r = await this.request('login', { name, password });
      if (r.ok) { this.token = r.token; saveToken(r.token); }
      return r;
    },
    async signUp(name, password) {
      if (!sb) return { ok: false, error: 'Sign-up is not available.' };
      name = String(name || '').trim().slice(0, 14);
      const email = nameToEmail(name);
      if (!email) return { ok: false, error: 'Type a name.' };
      if (String(password || '').length < 6) return { ok: false, error: 'Passwords need at least 6 letters or numbers.' };
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: name, username: name } } });
      if (error) return { ok: false, error: friendlyError(error.message) };
      if (!data.session) return { ok: false, error: 'Account made, but it needs checking first. Ask the grown-up who runs the game.' };
      return this.request('auth', { token: data.session.access_token });
    },
    async logOut() {
      this.token = ''; saveToken('');
      if (sb) { try { await sb.auth.signOut(); } catch (e) { /* ignore */ } }
      this.roomCode = null;
      return this.request('logout', {});
    },

    async createRoom(name, color) {
      const r = await this.request('create-room', { name, color, playerId: this.pid });
      if (r.ok) this.roomCode = r.code;
      return r;
    },
    async joinRoom(code, name, color) {
      const r = await this.request('join-room', { code, name, color, playerId: this.pid });
      if (r.ok) this.roomCode = r.code;
      return r;
    },
    async leaveRoom() {
      const r = await this.request('leave-room', {});
      this.roomCode = null;
      return r;
    },
    admin(action) { return this.request('admin', { action }); },

    async fetchIceServers() {
      try {
        const base = this.url || serverUrl();
        const r = await fetch(base + '/ice-servers', { cache: 'no-store' });
        if (r.ok) return await r.json();
      } catch (e) { /* fall through */ }
      return [{ urls: ['stun:stun.l.google.com:19302'] }];
    },
  };

  if (sb) {
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session && Net.socket && Net.socket.connected && Net.login.name) {
        Net.request('auth', { token: session.access_token });
      }
    });
  }

  window.Net = Net;
})();

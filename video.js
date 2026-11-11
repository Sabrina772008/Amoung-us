/*
 * Star Beans – video faces bar (Daily, daily.co)
 *
 * - A little row of camera bubbles so cousins can see each other while playing.
 * - Video only: talking still uses the game's own voice chat (voice.js), so the
 *   "no talking outside meetings" rule and the ghost rules still work.
 * - The server makes a private Daily room for each game room and gives every
 *   player a personal pass (token). No Daily keys are in the game files.
 * - Your camera starts OFF. Tap 📷 to turn it on.
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const Video = {
    call: null,
    roomCode: null,      // game room we joined video for
    joining: false,
    lastTry: 0,
    state: 'off',        // off | joining | on | unavailable | error
    camOn: false,
    collapsed: false,
    players: [],
    myId: null,
    tiles: new Map(),    // key -> { el, video, track }

    supported() {
      return typeof window.Daily !== 'undefined' && !!(navigator.mediaDevices && window.RTCPeerConnection);
    },

    /** Called by game.js on every room update */
    update(view) {
      if (!view) { this.leave(); return; }
      this.players = view.players || [];
      this.myId = view.myId;
      document.body.classList.toggle('video-meeting', view.phase === 'meeting');
      if (this.roomCode !== view.code) {
        this.leave();
        this.roomCode = view.code;
        this.join();
      } else if (this.state === 'error' && !this.joining && Date.now() - this.lastTry > 20000) {
        this.join();  // try again now and then if it failed
      }
      this.render();
    },

    async join() {
      if (!this.supported() || this.joining || this.state === 'unavailable') { this.render(); return; }
      const code = this.roomCode;
      this.lastTry = Date.now();
      this.joining = true;
      this.state = 'joining';
      this.render();
      try {
        const r = await Net.request('video-join', {});
        if (code !== this.roomCode) return;  // left the room while waiting
        if (!r.ok) {
          this.state = r.off ? 'unavailable' : 'error';
          this.render();
          return;
        }
        const call = Daily.createCallObject({
          audioSource: false,          // never use the mic here – voice.js does that
          videoSource: true,
          startVideoOff: !this.camOn,
          startAudioOff: true,
          subscribeToTracksAutomatically: true,
        });
        this.call = call;
        const refresh = () => this.render();
        ['joined-meeting', 'participant-joined', 'participant-updated', 'participant-left', 'track-started', 'track-stopped']
          .forEach(ev => call.on(ev, refresh));
        call.on('camera-error', (e) => {
          console.warn('Camera error', e);
          this.camOn = false;
          this.toast('Camera not allowed. Check your browser’s camera permission.');
          this.render();
        });
        call.on('error', (e) => {
          console.warn('Daily error', e);
          this.state = 'error';
          this.destroyCall();
          this.render();
        });
        call.on('left-meeting', () => { if (this.call === call) { this.state = 'off'; this.render(); } });
        await call.join({ url: r.url, token: r.token });
        if (this.call !== call) return;
        this.state = 'on';
        // small bubbles only need the smallest video layer (saves data)
        try { call.updateReceiveSettings({ base: { video: { layer: 0 } } }); } catch (e) { /* ignore */ }
      } catch (e) {
        console.warn('Video join failed', e);
        this.state = 'error';
        this.destroyCall();
      } finally {
        this.joining = false;
        this.render();
      }
    },

    destroyCall() {
      const call = this.call;
      this.call = null;
      if (call) { call.leave().catch(() => {}).finally(() => call.destroy().catch(() => {})); }
    },

    leave() {
      this.destroyCall();
      this.roomCode = null;
      if (this.state !== 'unavailable') this.state = 'off';
      document.body.classList.remove('video-meeting');
      this.render();
    },

    toggleCamera() {
      this.camOn = !this.camOn;
      if (this.state === 'error' && !this.joining) this.join();
      if (this.call) this.call.setLocalVideo(this.camOn);
      this.render();
    },

    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      this.render();
    },

    toast(text) {
      const box = $('toasts');
      if (!box) return;
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = text;
      box.appendChild(t);
      setTimeout(() => t.remove(), 3500);
    },

    /* ------------------------- drawing the bar ------------------------- */
    render() {
      const bar = $('video-bar');
      if (!bar) return;
      const show = !!this.roomCode && this.supported() && this.state !== 'unavailable';
      bar.classList.toggle('hidden', !show);
      document.body.classList.toggle('video-on', show && !this.collapsed);
      if (!show) { this.clearTiles(); return; }
      bar.classList.toggle('collapsed', this.collapsed);

      const camBtn = $('video-cam');
      camBtn.textContent = this.camOn ? '📷' : '🚫';
      camBtn.classList.toggle('off', !this.camOn);
      camBtn.setAttribute('aria-label', this.camOn ? 'Turn camera off' : 'Turn camera on');
      $('video-hide').textContent = this.collapsed ? '👀' : '✕';
      $('video-hide').setAttribute('aria-label', this.collapsed ? 'Show faces' : 'Hide faces');

      const status = $('video-status');
      status.textContent = this.state === 'joining' ? '…' : this.state === 'error' ? '⚠️' : '';
      status.classList.toggle('hidden', !status.textContent);

      if (this.collapsed || !this.call) { this.clearTiles(); return; }

      // one bubble per Daily participant, matched to the game player (same id)
      const parts = this.call.participants();
      const wanted = new Map();
      for (const key of Object.keys(parts)) {
        const dp = parts[key];
        const v = dp.tracks && dp.tracks.video;
        const track = v && v.state === 'playable' ? v.persistentTrack : null;
        const gp = this.players.find(p => p.id === dp.user_id);
        wanted.set(dp.session_id, {
          local: !!dp.local,
          track,
          name: gp ? gp.name : (dp.user_name || '?'),
          color: gp ? gp.color : null,
          alive: gp ? gp.alive !== false : true,
          order: gp ? this.players.indexOf(gp) : 99,
        });
      }
      for (const [id, tile] of this.tiles) if (!wanted.has(id)) { tile.el.remove(); this.tiles.delete(id); }

      const list = $('video-tiles');
      [...wanted.entries()].sort((a, b) => (b[1].local - a[1].local) || (a[1].order - b[1].order)).forEach(([id, info]) => {
        let tile = this.tiles.get(id);
        if (!tile) {
          const el = document.createElement('div');
          el.className = 'video-tile';
          const video = document.createElement('video');
          video.autoplay = true;
          video.muted = true;               // video only – no sound from here
          video.setAttribute('playsinline', '');
          const label = document.createElement('span');
          label.className = 'video-name';
          el.append(video, label);
          tile = { el, video, label, track: null };
          this.tiles.set(id, tile);
        }
        list.appendChild(tile.el);  // keeps order
        const c = info.color && window.Art && Art.COLORS[info.color];
        tile.el.style.borderColor = c ? c.main : 'rgba(255,255,255,0.5)';
        tile.el.style.setProperty('--bean', c ? c.main : '#5664a8');
        tile.el.classList.toggle('me', info.local);
        tile.el.classList.toggle('ghost', !info.alive);
        tile.el.classList.toggle('no-cam', !info.track);
        // no camera? show their bean instead
        const bean = !info.track && info.color && window.Art ? Art.avatarURL(info.color, { dead: !info.alive }) : '';
        if (tile.bean !== bean) { tile.bean = bean; tile.el.style.backgroundImage = bean ? `url("${bean}")` : ''; }
        tile.label.textContent = info.local ? 'You' : info.name;
        if (tile.track !== info.track) {
          tile.track = info.track;
          tile.video.srcObject = info.track ? new MediaStream([info.track]) : null;
          if (info.track) tile.video.play().catch(() => {});
        }
      });
    },

    clearTiles() {
      for (const tile of this.tiles.values()) { tile.video.srcObject = null; tile.el.remove(); }
      this.tiles.clear();
    },

    init() {
      const tap = (el, fn) => el && el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      tap($('video-cam'), () => this.toggleCamera());
      tap($('video-hide'), () => this.toggleCollapsed());
      // stop touches on the bar from moving the joystick
      const bar = $('video-bar');
      if (bar) ['pointerdown', 'touchstart'].forEach(ev => bar.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
      this.render();
    },
  };

  window.Video = Video;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Video.init());
  else Video.init();
})();

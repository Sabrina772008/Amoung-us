/*
 * Star Beans – video call (Daily, daily.co)
 *
 * - Everyone in a game room is in one private video call: you can see AND
 *   hear each other the whole time, in the lobby, while playing and in meetings.
 * - The server makes a private Daily room for each game room and gives every
 *   player a personal pass (token). No Daily keys are in the game files.
 * - Buttons on the bar: 🎤 mic on/off, 📷 camera on/off, ✕ shrink the bar.
 *   Mic and camera start ON (the browser asks for permission once).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const prefs = (() => { try { return JSON.parse(localStorage.getItem('sb_av') || '{}'); } catch (e) { return {}; } })();
  function savePrefs(v) { try { localStorage.setItem('sb_av', JSON.stringify({ mic: v.micOn, cam: v.camOn })); } catch (e) { /* ignore */ } }

  const Video = {
    call: null,
    roomCode: null,      // game room we joined the call for
    joining: false,
    lastTry: 0,
    state: 'off',        // off | joining | on | unavailable | error
    micOn: prefs.mic !== false,
    camOn: prefs.cam !== false,
    micBlocked: false,
    camBlocked: false,
    needsTap: false,     // iPhone/iPad: a tap is needed before sound can play
    collapsed: false,
    players: [],
    myId: null,
    speaker: null,       // session id of whoever is talking
    tiles: new Map(),    // session id -> { el, video, audio, label, track, audioTrack }
    onChange: null,      // voice.js listens to this

    supported() {
      return typeof window.Daily !== 'undefined' && !!(navigator.mediaDevices && window.RTCPeerConnection);
    },

    changed() { this.render(); if (this.onChange) this.onChange(); },

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
      } else if (this.state === 'error' && !this.joining && Date.now() - this.lastTry > 15000) {
        this.join();  // try again now and then if it failed
      }
      this.render();
    },

    async join() {
      if (!this.supported() || this.joining || this.state === 'unavailable') { this.changed(); return; }
      const code = this.roomCode;
      this.lastTry = Date.now();
      this.joining = true;
      this.state = 'joining';
      this.changed();
      try {
        const r = await Net.request('video-join', {});
        if (code !== this.roomCode) return;  // left the room while waiting
        if (!r.ok) {
          this.state = r.off ? 'unavailable' : 'error';
          this.changed();
          return;
        }
        const call = Daily.createCallObject({
          audioSource: true,
          videoSource: true,
          startVideoOff: !this.camOn,
          startAudioOff: !this.micOn,
          subscribeToTracksAutomatically: true,
          dailyConfig: { useDevicePreferenceCookies: true },
        });
        this.call = call;
        const refresh = () => this.render();
        ['joined-meeting', 'participant-joined', 'participant-updated', 'participant-left', 'track-started', 'track-stopped']
          .forEach(ev => call.on(ev, refresh));
        call.on('active-speaker-change', (e) => {
          this.speaker = e && e.activeSpeaker ? e.activeSpeaker.peerId : null;
          this.render();
        });
        call.on('camera-error', (e) => {
          console.warn('Camera/mic error', e);
          const blocked = e && e.error && e.error.blockedMedia;
          if (!blocked || blocked.includes('video')) { this.camBlocked = true; this.camOn = false; }
          if (!blocked || blocked.includes('audio')) { this.micBlocked = true; this.micOn = false; }
          this.toast('Camera or microphone not allowed. Check your browser’s permission settings.');
          this.changed();
        });
        call.on('error', (e) => {
          console.warn('Daily error', e);
          this.state = 'error';
          this.destroyCall();
          this.changed();
        });
        call.on('left-meeting', () => { if (this.call === call) { this.state = 'off'; this.changed(); } });
        await call.join({ url: r.url, token: r.token });
        if (this.call !== call) return;
        this.state = 'on';
        // make sure our wishes win over the room defaults
        call.setLocalAudio(this.micOn);
        call.setLocalVideo(this.camOn);
        // bubbles are small, so the smallest video layer is enough (saves data)
        try { call.updateReceiveSettings({ base: { video: { layer: 0 } } }); } catch (e) { /* ignore */ }
      } catch (e) {
        console.warn('Video join failed', e);
        this.state = 'error';
        this.destroyCall();
      } finally {
        this.joining = false;
        this.changed();
      }
    },

    destroyCall() {
      const call = this.call;
      this.call = null;
      this.speaker = null;
      if (call) { call.leave().catch(() => {}).finally(() => call.destroy().catch(() => {})); }
    },

    leave() {
      this.destroyCall();
      this.roomCode = null;
      if (this.state !== 'unavailable') this.state = 'off';
      document.body.classList.remove('video-meeting');
      this.changed();
    },

    setMic(on) {
      this.micOn = on;
      if (on) this.micBlocked = false;
      savePrefs(this);
      if (this.state === 'error' && !this.joining) this.join();
      if (this.call && this.state === 'on') this.call.setLocalAudio(on);
      this.changed();
    },
    toggleMic() { this.setMic(!this.micOn); },

    toggleCamera() {
      this.camOn = !this.camOn;
      if (this.camOn) this.camBlocked = false;
      savePrefs(this);
      if (this.state === 'error' && !this.joining) this.join();
      if (this.call && this.state === 'on') this.call.setLocalVideo(this.camOn);
      this.changed();
    },

    toggleCollapsed() {
      this.collapsed = !this.collapsed;
      this.render();
    },

    // retry playing everyone's sound after a tap (needed on iPhone/iPad)
    unlockAudio() {
      this.needsTap = false;
      for (const t of this.tiles.values()) if (t.audioTrack) t.audio.play().catch(() => {});
      this.changed();
    },

    remoteCount() {
      if (!this.call) return 0;
      return Object.values(this.call.participants()).filter(p => !p.local).length;
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
      const micBtn = $('video-mic');
      micBtn.textContent = this.micOn ? '🎤' : '🔇';
      micBtn.classList.toggle('off', !this.micOn);
      micBtn.setAttribute('aria-label', this.micOn ? 'Mute microphone' : 'Unmute microphone');
      $('video-hide').textContent = this.collapsed ? '👀' : '✕';
      $('video-hide').setAttribute('aria-label', this.collapsed ? 'Show faces' : 'Hide faces');
      $('video-sound').classList.toggle('hidden', !this.needsTap);

      const status = $('video-status');
      status.textContent = this.state === 'joining' ? '…' : this.state === 'error' ? '⚠️' : '';
      status.classList.toggle('hidden', !status.textContent);

      if (!this.call) { this.clearTiles(); return; }

      // one bubble per person in the call, matched to the game player (same id)
      const parts = this.call.participants();
      const wanted = new Map();
      for (const key of Object.keys(parts)) {
        const dp = parts[key];
        const v = dp.tracks && dp.tracks.video;
        const a = dp.tracks && dp.tracks.audio;
        const gp = this.players.find(p => p.id === dp.user_id);
        wanted.set(dp.session_id, {
          local: !!dp.local,
          track: v && v.state === 'playable' ? v.persistentTrack : null,
          audioTrack: !dp.local && a && a.state === 'playable' ? a.persistentTrack : null,
          micOff: !(a && (a.state === 'playable' || a.state === 'loading' || a.state === 'sendable')),
          name: gp ? gp.name : (dp.user_name || '?'),
          color: gp ? gp.color : null,
          alive: gp ? gp.alive !== false : true,
          order: gp ? this.players.indexOf(gp) : 99,
        });
      }
      for (const [id, tile] of this.tiles) if (!wanted.has(id)) { this.removeTile(tile); this.tiles.delete(id); }

      const list = $('video-tiles');
      [...wanted.entries()].sort((a, b) => (b[1].local - a[1].local) || (a[1].order - b[1].order)).forEach(([id, info]) => {
        let tile = this.tiles.get(id);
        if (!tile) {
          const el = document.createElement('div');
          el.className = 'video-tile';
          const video = document.createElement('video');
          video.autoplay = true;
          video.muted = true;               // sound plays through the <audio> element
          video.setAttribute('playsinline', '');
          const audio = document.createElement('audio');
          audio.autoplay = true;
          const label = document.createElement('span');
          label.className = 'video-name';
          el.append(video, audio, label);
          tile = { el, video, audio, label, track: null, audioTrack: null };
          this.tiles.set(id, tile);
        }
        // (when the bar is shrunk the bubbles are only hidden, so sound keeps playing)
        list.appendChild(tile.el);
        const c = info.color && window.Art && Art.COLORS[info.color];
        tile.el.style.borderColor = c ? c.main : 'rgba(255,255,255,0.5)';
        tile.el.style.setProperty('--bean', c ? c.main : '#5664a8');
        tile.el.classList.toggle('me', info.local);
        tile.el.classList.toggle('ghost', !info.alive);
        tile.el.classList.toggle('no-cam', !info.track);
        tile.el.classList.toggle('muted', info.local ? !this.micOn : info.micOff);
        tile.el.classList.toggle('speaking', this.speaker === id && !(info.local && !this.micOn));
        // no camera? show their bean instead
        const bean = !info.track && info.color && window.Art ? Art.avatarURL(info.color, { dead: !info.alive }) : '';
        if (tile.bean !== bean) { tile.bean = bean; tile.el.style.backgroundImage = bean ? `url("${bean}")` : ''; }
        tile.label.textContent = info.local ? 'You' : info.name;
        if (tile.track !== info.track) {
          tile.track = info.track;
          tile.video.srcObject = info.track ? new MediaStream([info.track]) : null;
          if (info.track) tile.video.play().catch(() => {});
        }
        if (tile.audioTrack !== info.audioTrack) {
          tile.audioTrack = info.audioTrack;
          tile.audio.srcObject = info.audioTrack ? new MediaStream([info.audioTrack]) : null;
          if (info.audioTrack) {
            tile.audio.play().catch(() => { if (!this.needsTap) { this.needsTap = true; $('video-sound').classList.remove('hidden'); } });
          }
        }
      });
    },

    removeTile(tile) {
      tile.video.srcObject = null;
      tile.audio.srcObject = null;
      tile.el.remove();
    },

    clearTiles() {
      for (const tile of this.tiles.values()) this.removeTile(tile);
      this.tiles.clear();
    },

    init() {
      const tap = (el, fn) => el && el.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      tap($('video-mic'), () => this.toggleMic());
      tap($('video-cam'), () => this.toggleCamera());
      tap($('video-hide'), () => this.toggleCollapsed());
      tap($('video-sound'), () => this.unlockAudio());
      // stop touches on the bar from moving the joystick
      const bar = $('video-bar');
      if (bar) ['pointerdown', 'touchstart'].forEach(ev => bar.addEventListener(ev, e => e.stopPropagation(), { passive: true }));
      // any tap on the page lets blocked sound start playing
      document.addEventListener('pointerdown', () => { if (this.needsTap) this.unlockAudio(); }, { passive: true });
      this.render();
    },
  };

  window.Video = Video;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Video.init());
  else Video.init();
})();

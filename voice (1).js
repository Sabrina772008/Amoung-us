/*
 * Star Beans – microphone voice chat (WebRTC, peer to peer)
 *
 * - Every pair of players gets one audio connection (fine for 2–5 players).
 * - Signaling (offers/answers/ICE) goes through the Socket.IO server.
 * - STUN/TURN servers are fetched from the server at /ice-servers, so TURN
 *   secrets stay on the server.
 * - Voice is only switched on during meetings. Ghosts can hear everyone and
 *   talk to other ghosts; living players never hear ghosts.
 */
(function () {
  'use strict';

  const Voice = {
    myId: null,
    stream: null,          // my microphone
    micState: 'off',       // off | asking | on | denied | unsupported
    muted: false,
    active: false,         // true during meetings
    iceServers: null,
    peers: new Map(),      // playerId -> { pc, audio, initiator, conn, chain, state }
    alive: {},             // playerId -> alive?
    meAlive: true,
    onChange: null,

    supported() {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.RTCPeerConnection);
    },

    async requestMic() {
      if (!this.supported()) { this.micState = 'unsupported'; this.changed(); return false; }
      if (this.stream) return true;
      this.micState = 'asking'; this.changed();
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        this.micState = 'on';
        const track = this.stream.getAudioTracks()[0];
        track.enabled = false;
        for (const peer of this.peers.values()) this.attachMic(peer);
        this.apply();
        this.changed();
        return true;
      } catch (e) {
        console.warn('Microphone error', e);
        this.micState = 'denied';
        this.changed();
        return false;
      }
    },

    changed() { if (this.onChange) this.onChange(); },

    toggleMute() {
      this.muted = !this.muted;
      this.apply();
      this.changed();
    },

    async ensureIce() {
      if (!this.iceServers) this.iceServers = await Net.fetchIceServers();
      return this.iceServers;
    },

    /** Called whenever the room changes. players: [{id, connected, conn, alive}] */
    async syncPeers(myId, players, inGame) {
      this.myId = myId;
      if (!this.supported()) return;
      const wanted = new Map();
      const me = players.find(p => p.id === myId);
      const myConn = me ? me.conn : 0;
      this.keys = {};
      if (inGame) for (const p of players) if (p.id !== myId && p.connected) { wanted.set(p.id, p); this.keys[p.id] = myConn + ':' + p.conn; }
      // close peers that left, or where someone reconnected (start fresh)
      for (const [id, peer] of this.peers) {
        if (!wanted.has(id) || peer.key !== this.keys[id]) this.closePeer(id);
      }
      if (!inGame) return;
      await this.ensureIce();
      for (const [id, p] of wanted) {
        if (this.peers.has(id)) continue;
        const initiator = myId < id;  // only one side sends the offer
        const peer = this.makePeer(id, initiator);
        if (initiator) this.makeOffer(peer);
      }
    },

    makePeer(id, initiator) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers || [] });
      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.muted = true;
      document.getElementById('voice-audio').appendChild(audio);
      const peer = { id, pc, audio, initiator, key: (this.keys || {})[id], chain: Promise.resolve(), state: 'new', transceiver: null };
      this.peers.set(id, peer);

      pc.onicecandidate = (e) => {
        if (e.candidate) Net.send('rtc-signal', { to: id, data: { type: 'candidate', candidate: e.candidate } });
      };
      pc.ontrack = (e) => {
        audio.srcObject = (e.streams && e.streams[0]) || new MediaStream([e.track]);
        this.apply();
      };
      pc.onconnectionstatechange = () => {
        peer.state = pc.connectionState;
        this.changed();
        if (pc.connectionState === 'failed' && this.peers.get(id) === peer) {
          // try again from scratch
          setTimeout(() => {
            if (this.peers.get(id) !== peer) return;
            this.closePeer(id);
            const np = this.makePeer(id, initiator);
            if (initiator) this.makeOffer(np);
          }, 1500);
        }
      };
      if (initiator) {
        peer.transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
        this.attachMic(peer);
      }
      return peer;
    },

    attachMic(peer) {
      const track = this.stream ? this.stream.getAudioTracks()[0] : null;
      if (peer.transceiver && track) peer.transceiver.sender.replaceTrack(track).catch(() => {});
    },

    async makeOffer(peer) {
      try {
        const offer = await peer.pc.createOffer();
        await peer.pc.setLocalDescription(offer);
        Net.send('rtc-signal', { to: peer.id, data: { type: 'offer', sdp: peer.pc.localDescription } });
      } catch (e) { console.warn('offer failed', e); }
    },

    handleSignal(msg) {
      const from = msg.from, data = msg.data || {};
      let peer = this.peers.get(from);
      if (data.type === 'offer') {
        // a fresh offer always means a fresh connection
        if (peer) this.closePeer(from);
        peer = this.makePeer(from, false);
      }
      if (!peer) return;
      peer.chain = peer.chain.then(async () => {
        const pc = peer.pc;
        try {
          if (data.type === 'offer') {
            await this.ensureIce();
            await pc.setRemoteDescription(data.sdp);
            peer.transceiver = pc.getTransceivers()[0] || null;
            if (peer.transceiver) peer.transceiver.direction = 'sendrecv';
            this.attachMic(peer);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            Net.send('rtc-signal', { to: from, data: { type: 'answer', sdp: pc.localDescription } });
          } else if (data.type === 'answer') {
            if (pc.signalingState === 'have-local-offer') await pc.setRemoteDescription(data.sdp);
          } else if (data.type === 'candidate') {
            if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
            else { peer.pending = peer.pending || []; peer.pending.push(data.candidate); }
          }
          if (pc.remoteDescription && peer.pending) {
            const list = peer.pending; peer.pending = null;
            for (const c of list) await pc.addIceCandidate(c).catch(() => {});
          }
        } catch (e) { console.warn('signal error', e); }
      });
    },

    closePeer(id) {
      const peer = this.peers.get(id);
      if (!peer) return;
      try { peer.pc.close(); } catch (e) { /* ignore */ }
      peer.audio.srcObject = null;
      peer.audio.remove();
      this.peers.delete(id);
      this.changed();
    },

    closeAll() { for (const id of [...this.peers.keys()]) this.closePeer(id); },

    /** Turn voice on/off. alive: {playerId: bool} */
    setMode(active, meAlive, alive) {
      this.active = active;
      this.meAlive = meAlive;
      this.alive = alive || {};
      this.apply();
    },

    apply() {
      const track = this.stream ? this.stream.getAudioTracks()[0] : null;
      if (track) track.enabled = this.active && !this.muted;
      for (const [id, peer] of this.peers) {
        const peerAlive = this.alive[id] !== false;
        // living players cannot hear ghosts; ghosts hear everybody
        const hear = this.active && (!this.meAlive || peerAlive);
        peer.audio.muted = !hear;
        if (hear && peer.audio.srcObject) {
          const p = peer.audio.play();
          if (p && p.catch) p.catch(() => { this.needsTap = true; this.changed(); });
        }
      }
    },

    // iPhone/iPad need a tap before sound can play
    unlockAudio() {
      this.needsTap = false;
      for (const peer of this.peers.values()) {
        if (peer.audio.srcObject) peer.audio.play().catch(() => {});
      }
      this.changed();
    },

    connectedCount() {
      let n = 0;
      for (const p of this.peers.values()) if (p.state === 'connected') n++;
      return n;
    },
  };

  window.Voice = Voice;
})();

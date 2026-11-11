/*
 * Star Beans – voice chat
 *
 * Talking now happens in the Daily video call (video.js): everyone can hear
 * each other the whole time. This file is a small bridge so the game's mic
 * buttons (lobby "Allow Mic", meeting "Mute") control the video call's mic.
 */
(function () {
  'use strict';

  const V = () => window.Video;

  const Voice = {
    onChange: null,

    get micState() {
      const v = V();
      if (!v || !v.supported()) return 'unsupported';
      if (v.micBlocked) return 'denied';
      if (v.state === 'joining') return v.micOn ? 'asking' : 'off';
      return v.micOn ? 'on' : 'off';
    },
    get muted() { const v = V(); return !!v && !v.micOn; },
    get needsTap() { const v = V(); return !!v && v.needsTap; },
    // renderVoiceStatus() shows "Voice: x/y connected"
    get peers() { const v = V(); return { size: v ? v.remoteCount() : 0 }; },
    connectedCount() { const v = V(); return v ? v.remoteCount() : 0; },

    async requestMic() { if (V()) V().setMic(true); return true; },
    toggleMute() { if (V()) V().toggleMic(); },
    unlockAudio() { if (V()) V().unlockAudio(); },

    // the old peer-to-peer voice is no longer used
    syncPeers() {},
    setMode() {},
    handleSignal() {},
    closePeer() {},
    closeAll() {},
  };

  window.Voice = Voice;
  // when the call's mic/camera changes, let the game redraw its mic buttons
  const hook = () => { if (window.Video) window.Video.onChange = () => { if (Voice.onChange) Voice.onChange(); }; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();

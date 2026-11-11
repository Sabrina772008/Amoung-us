/*
 * Star Beans – character art (cute bean astronauts drawn with code)
 */
(function () {
  'use strict';

  const COLORS = {
    red: { main: '#ff4757', dark: '#b8202f', label: 'Red' },
    blue: { main: '#3d7bff', dark: '#1f45b8', label: 'Blue' },
    green: { main: '#2ed573', dark: '#16924a', label: 'Green' },
    pink: { main: '#ff7eb6', dark: '#d04986', label: 'Pink' },
    orange: { main: '#ffa502', dark: '#c26f00', label: 'Orange' },
    yellow: { main: '#ffe23d', dark: '#c9a800', label: 'Yellow' },
    purple: { main: '#a55eea', dark: '#6c2fb0', label: 'Purple' },
    cyan: { main: '#3ee6e6', dark: '#159a9a', label: 'Cyan' },
    white: { main: '#f1f2f6', dark: '#a4a8b8', label: 'White' },
    lime: { main: '#a3f04a', dark: '#64a81c', label: 'Lime' },
    brown: { main: '#a0673a', dark: '#683f1f', label: 'Brown' },
    black: { main: '#4b4f63', dark: '#25283a', label: 'Black' },
  };
  const OUTLINE = '#151829';

  function rr(ctx, x, y, w, h, r) {
    if (!Array.isArray(r)) r = [r, r, r, r];
    const [tl, tr, br, bl] = r.map(v => Math.min(v, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
    ctx.lineTo(x + w, y + h - br); ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
    ctx.lineTo(x + bl, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
    ctx.lineTo(x, y + tl); ctx.quadraticCurveTo(x, y, x + tl, y);
    ctx.closePath();
  }

  /**
   * Draw a bean astronaut centred at (x, y).
   * o: { dir: 1|-1, moving, phase, ghost, size, alpha }
   */
  function drawBean(ctx, x, y, colorName, o) {
    o = o || {};
    const c = COLORS[colorName] || COLORS.red;
    const s = o.size || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;

    if (o.ghost) {
      ctx.globalAlpha = (o.alpha !== undefined ? o.alpha : 1) * 0.55;
      const float = Math.sin((o.phase || 0) * 0.5 + performance.now() / 400) * 4;
      ctx.translate(0, float - 6);
      if (o.dir < 0) ctx.scale(-1, 1);
      // halo
      ctx.strokeStyle = '#ffe066'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, -40, 14, 4, 0, 0, Math.PI * 2); ctx.stroke();
      // wavy body
      ctx.fillStyle = c.main; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-18, 10);
      ctx.lineTo(-18, -12);
      ctx.quadraticCurveTo(-18, -32, 0, -32);
      ctx.quadraticCurveTo(18, -32, 18, -12);
      ctx.lineTo(18, 10);
      const t = performance.now() / 200;
      for (let i = 0; i <= 6; i++) {
        const px = 18 - i * 6;
        ctx.lineTo(px, 14 + Math.sin(t + i) * 4 * (i % 2 ? 1 : -1));
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      drawVisor(ctx);
      ctx.restore();
      return;
    }

    const moving = !!o.moving;
    const phase = o.phase || 0;
    const swing = moving ? Math.sin(phase) * 7 : 0;
    const bob = moving ? -Math.abs(Math.sin(phase)) * 3 : 0;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(0, 28, 21, 6, 0, 0, Math.PI * 2); ctx.fill();

    if (o.dir < 0) ctx.scale(-1, 1);
    ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE;

    // legs
    ctx.fillStyle = c.dark;
    rr(ctx, -15 + swing, 10, 13, 17, [3, 3, 6, 6]); ctx.fill(); ctx.stroke();
    rr(ctx, 3 - swing, 10, 13, 17, [3, 3, 6, 6]); ctx.fill(); ctx.stroke();

    ctx.translate(0, bob);
    // backpack
    ctx.fillStyle = c.dark;
    rr(ctx, -27, -14, 12, 26, 5); ctx.fill(); ctx.stroke();
    // body
    ctx.fillStyle = c.main;
    rr(ctx, -19, -32, 38, 50, [19, 19, 9, 9]); ctx.fill(); ctx.stroke();
    // belly shine
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    rr(ctx, -14, -26, 7, 28, 4); ctx.fill();
    drawVisor(ctx);
    // blush
    ctx.fillStyle = 'rgba(255,120,150,0.55)';
    ctx.beginPath(); ctx.ellipse(13, 2, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();

    if (o.hat === 'crown') drawCrown(ctx, 0, -36, 0.8);
    ctx.restore();
  }

  function drawVisor(ctx) {
    ctx.fillStyle = '#9fe6ff';
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 3;
    rr(ctx, -3, -22, 26, 16, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5fb7d9';
    rr(ctx, 0, -13, 20, 5, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    rr(ctx, 6, -19, 10, 4, 2); ctx.fill();
  }

  function drawCrown(ctx, x, y, s) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.fillStyle = '#ffd32a'; ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-12, 6); ctx.lineTo(-14, -8); ctx.lineTo(-6, -2); ctx.lineTo(0, -12);
    ctx.lineTo(6, -2); ctx.lineTo(14, -8); ctx.lineTo(12, 6); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // A knocked-out bean lying on the floor with dizzy stars
  function drawBody(ctx, x, y, colorName, time) {
    const c = COLORS[colorName] || COLORS.red;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(0, 14, 34, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE;
    ctx.save();
    ctx.rotate(-Math.PI / 2);
    ctx.translate(0, 0);
    ctx.fillStyle = c.dark;
    rr(ctx, -27, -14, 12, 26, 5); ctx.fill(); ctx.stroke();
    ctx.fillStyle = c.main;
    rr(ctx, -19, -32, 38, 50, [19, 19, 9, 9]); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#9fe6ff';
    rr(ctx, -3, -22, 26, 16, 8); ctx.fill(); ctx.stroke();
    // X eyes
    ctx.strokeStyle = OUTLINE; ctx.lineWidth = 2.5;
    [[4, -14], [15, -14]].forEach(([ex, ey]) => {
      ctx.beginPath(); ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3);
      ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3); ctx.stroke();
    });
    ctx.restore();
    // dizzy stars
    for (let i = 0; i < 3; i++) {
      const a = time / 400 + i * (Math.PI * 2 / 3);
      drawStar(ctx, Math.cos(a) * 26 + 10, -26 + Math.sin(a) * 8, 6, '#ffe066');
    }
    ctx.restore();
  }

  function drawStar(ctx, x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r / 2.2 : r;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.closePath(); ctx.fill();
  }

  function drawNameTag(ctx, x, y, text, opts) {
    opts = opts || {};
    ctx.save();
    ctx.font = 'bold 17px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = opts.color || '#fff';
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Cached small pictures for menus
  const avatarCache = {};
  function avatarURL(colorName, opts) {
    opts = opts || {};
    const key = colorName + (opts.dead ? '-dead' : '') + (opts.crown ? '-crown' : '');
    if (avatarCache[key]) return avatarCache[key];
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 96;
    const ctx = cv.getContext('2d');
    ctx.scale(1.35, 1.35);
    drawBean(ctx, 36, 42, colorName, { dir: 1, hat: opts.crown ? 'crown' : null });
    if (opts.dead) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = '#ff3b4e'; ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(18, 18); ctx.lineTo(78, 78); ctx.moveTo(78, 18); ctx.lineTo(18, 78); ctx.stroke();
    }
    return (avatarCache[key] = cv.toDataURL());
  }

  window.Art = { COLORS, drawBean, drawBody, drawNameTag, drawCrown, drawStar, avatarURL, rr };
})();

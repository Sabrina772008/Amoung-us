/*
 * Star Beans – the spaceship map
 * Rooms, corridors, obstacles, task stations, collision and drawing.
 */
(function () {
  'use strict';

  const WORLD = { w: 2650, h: 1700 };

  // Walkable rooms (x, y, w, h)
  const ROOMS = [
    { id: 'greenhouse', name: 'Greenhouse', x: 200, y: 100, w: 500, h: 400, floor: '#2f6b4f', tile: '#3a7d5d' },
    { id: 'cafeteria', name: 'Cafeteria', x: 1000, y: 100, w: 600, h: 400, floor: '#5b6c8f', tile: '#6a7ca1' },
    { id: 'comms', name: 'Communications', x: 1900, y: 100, w: 500, h: 400, floor: '#5d4f86', tile: '#6c5d98' },
    { id: 'medbay', name: 'MedBay', x: 200, y: 700, w: 450, h: 350, floor: '#3f7f8c', tile: '#4d93a1' },
    { id: 'storage', name: 'Storage', x: 1050, y: 700, w: 500, h: 350, floor: '#7a6247', tile: '#8a7155' },
    { id: 'navigation', name: 'Navigation', x: 1950, y: 700, w: 500, h: 350, floor: '#2f5d8a', tile: '#3b6c9c' },
    { id: 'engine', name: 'Engine Room', x: 200, y: 1250, w: 500, h: 350, floor: '#7c4a3a', tile: '#8d5848' },
    { id: 'reactor', name: 'Reactor', x: 1000, y: 1250, w: 600, h: 350, floor: '#6b3f6f', tile: '#7c4d80' },
    { id: 'shields', name: 'Shields', x: 1950, y: 1250, w: 500, h: 350, floor: '#4b6f3a', tile: '#5a8047' },
  ];

  // Corridors overlap rooms a little so the floor is continuous
  const CORRIDORS = [
    { x: 680, y: 240, w: 340, h: 120 },   // Greenhouse - Cafeteria
    { x: 1580, y: 240, w: 340, h: 120 },  // Cafeteria - Comms
    { x: 390, y: 480, w: 120, h: 240 },   // Greenhouse - MedBay
    { x: 1240, y: 480, w: 120, h: 240 },  // Cafeteria - Storage
    { x: 2090, y: 480, w: 120, h: 240 },  // Comms - Navigation
    { x: 630, y: 820, w: 440, h: 120 },   // MedBay - Storage
    { x: 1530, y: 820, w: 440, h: 120 },  // Storage - Navigation
    { x: 390, y: 1030, w: 120, h: 240 },  // MedBay - Engine
    { x: 1240, y: 1030, w: 120, h: 240 }, // Storage - Reactor
    { x: 2090, y: 1030, w: 120, h: 240 }, // Navigation - Shields
    { x: 680, y: 1370, w: 340, h: 120 },  // Engine - Reactor
    { x: 1580, y: 1370, w: 390, h: 120 }, // Reactor - Shields
  ];

  // Things you bump into
  const OBSTACLES = [
    { x: 380, y: 230, w: 150, h: 60, kind: 'planter' },
    { x: 380, y: 350, w: 150, h: 60, kind: 'planter' },
    { x: 1250, y: 250, w: 100, h: 100, kind: 'button-table' },
    { x: 1050, y: 150, w: 110, h: 60, kind: 'table' },
    { x: 1050, y: 400, w: 110, h: 60, kind: 'table' },
    { x: 1440, y: 400, w: 110, h: 60, kind: 'table' },
    { x: 2100, y: 210, w: 180, h: 60, kind: 'desk' },
    { x: 240, y: 760, w: 70, h: 110, kind: 'bed' },
    { x: 240, y: 900, w: 70, h: 110, kind: 'bed' },
    { x: 1400, y: 740, w: 70, h: 60, kind: 'crate' },
    { x: 1440, y: 970, w: 80, h: 55, kind: 'crate' },
    { x: 1080, y: 960, w: 70, h: 60, kind: 'crate' },
    { x: 2300, y: 830, w: 100, h: 110, kind: 'console' },
    { x: 260, y: 1390, w: 140, h: 120, kind: 'engine' },
    { x: 1240, y: 1380, w: 120, h: 120, kind: 'reactor' },
    { x: 2210, y: 1450, w: 90, h: 90, kind: 'shield' },
  ];

  // Task stations. type = which mini-game opens.
  const TASKS = [
    { id: 'gh_water', room: 'Greenhouse', name: 'Water the Plants', type: 'targets', icon: '🌱', x: 290, y: 150 },
    { id: 'gh_seeds', room: 'Greenhouse', name: 'Sort Seed Pods', type: 'numbers', icon: '🌰', x: 620, y: 450 },
    { id: 'caf_trash', room: 'Cafeteria', name: 'Empty the Garbage', type: 'hold', icon: '🗑️', x: 1550, y: 150 },
    { id: 'comm_wires', room: 'Communications', name: 'Fix Wiring', type: 'wires', icon: '🔌', x: 1980, y: 150 },
    { id: 'comm_download', room: 'Communications', name: 'Download Data', type: 'hold', icon: '📡', x: 2330, y: 450 },
    { id: 'med_scan', room: 'MedBay', name: 'Submit Scan', type: 'hold', icon: '🩺', x: 570, y: 990 },
    { id: 'storage_wires', room: 'Storage', name: 'Fix Wiring', type: 'wires', icon: '🔌', x: 1110, y: 750 },
    { id: 'storage_fuel', room: 'Storage', name: 'Fill Fuel Can', type: 'hold', icon: '⛽', x: 1300, y: 1000 },
    { id: 'nav_course', room: 'Navigation', name: 'Chart Course', type: 'targets', icon: '⭐', x: 2400, y: 750 },
    { id: 'nav_numbers', room: 'Navigation', name: 'Reboot Navigation', type: 'numbers', icon: '🧭', x: 2010, y: 1000 },
    { id: 'eng_fuel', room: 'Engine Room', name: 'Fuel Engines', type: 'hold', icon: '🔥', x: 290, y: 1300 },
    { id: 'eng_wires', room: 'Engine Room', name: 'Fix Wiring', type: 'wires', icon: '🔌', x: 640, y: 1550 },
    { id: 'reactor_start', room: 'Reactor', name: 'Start Reactor', type: 'numbers', icon: '⚛️', x: 1080, y: 1550 },
    { id: 'shield_prime', room: 'Shields', name: 'Prime Shields', type: 'targets', icon: '🛡️', x: 2390, y: 1310 },
  ];

  const BUTTON = { x: 1300, y: 300 };
  const WALL = 22;
  const WALKABLE = ROOMS.concat(CORRIDORS);

  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }
  function inWalkable(px, py) {
    for (let i = 0; i < WALKABLE.length; i++) if (inRect(px, py, WALKABLE[i])) return true;
    return false;
  }
  function circleHitsRect(cx, cy, rad, r) {
    const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
    const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
    return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < rad * rad;
  }
  // Is a character with "foot circle" radius rad allowed to stand at (x, y)?
  function canStand(x, y, rad) {
    rad = rad || 18;
    if (!inWalkable(x, y)) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (!inWalkable(x + Math.cos(a) * rad, y + Math.sin(a) * rad)) return false;
    }
    for (const o of OBSTACLES) if (circleHitsRect(x, y, rad, o)) return false;
    return true;
  }
  // Move with wall sliding
  function moveWithCollision(x, y, dx, dy, rad) {
    let nx = x, ny = y;
    if (canStand(x + dx, y, rad)) nx = x + dx;
    if (canStand(nx, y + dy, rad)) ny = y + dy;
    return { x: nx, y: ny };
  }
  function roomAt(x, y) {
    const r = ROOMS.find(r => inRect(x, y, r));
    return r ? r.name : 'Hallway';
  }

  /* ------------------------------- drawing -------------------------------- */
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Background stars (fixed random)
  const STARS = [];
  (function () {
    let s = 12345;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 260; i++) STARS.push({ x: rnd() * (WORLD.w + 800) - 400, y: rnd() * (WORLD.h + 800) - 400, r: rnd() * 2 + 0.6, tw: rnd() * 6 });
  })();

  function visible(r, view) {
    return r.x + r.w + 60 > view.x && r.x - 60 < view.x + view.w && r.y + r.h + 60 > view.y && r.y - 60 < view.y + view.h;
  }

  function drawMap(ctx, view, time, opts) {
    opts = opts || {};
    // space
    ctx.fillStyle = '#0b1026';
    ctx.fillRect(view.x - 10, view.y - 10, view.w + 20, view.h + 20);
    for (const st of STARS) {
      if (st.x < view.x - 5 || st.x > view.x + view.w + 5 || st.y < view.y - 5 || st.y > view.y + view.h + 5) continue;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time / 600 + st.tw);
      ctx.fillStyle = '#fff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    // hull + walls: draw expanded rectangles first, floors on top
    ctx.fillStyle = '#c9d3ea';
    for (const r of WALKABLE) if (visible(r, view)) { rr(ctx, r.x - WALL, r.y - WALL, r.w + WALL * 2, r.h + WALL * 2, 14); ctx.fill(); }
    ctx.fillStyle = '#8c97b5';
    for (const r of WALKABLE) if (visible(r, view)) { rr(ctx, r.x - WALL + 6, r.y - WALL + 6, r.w + WALL * 2 - 12, r.h + WALL * 2 - 12, 12); ctx.fill(); }

    // corridor floor
    for (const c of CORRIDORS) {
      if (!visible(c, view)) continue;
      ctx.fillStyle = '#3d4560';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 2;
      const horiz = c.w > c.h;
      ctx.beginPath();
      if (horiz) for (let x = c.x + 20; x < c.x + c.w; x += 40) { ctx.moveTo(x, c.y); ctx.lineTo(x, c.y + c.h); }
      else for (let y = c.y + 20; y < c.y + c.h; y += 40) { ctx.moveTo(c.x, y); ctx.lineTo(c.x + c.w, y); }
      ctx.stroke();
      // guide lights
      ctx.fillStyle = '#ffd34d';
      for (let i = 0; i < 6; i++) {
        const t = (i + (time / 900) % 1) / 6;
        if (horiz) ctx.fillRect(c.x + t * c.w, c.y + 6, 6, 4), ctx.fillRect(c.x + t * c.w, c.y + c.h - 10, 6, 4);
        else ctx.fillRect(c.x + 6, c.y + t * c.h, 4, 6), ctx.fillRect(c.x + c.w - 10, c.y + t * c.h, 4, 6);
      }
    }

    // room floors with tiles
    for (const r of ROOMS) {
      if (!visible(r, view)) continue;
      ctx.fillStyle = r.floor;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = r.tile;
      for (let y = r.y; y < r.y + r.h; y += 50) {
        for (let x = r.x + ((y - r.y) / 50 % 2) * 50; x < r.x + r.w; x += 100) {
          ctx.fillRect(x + 2, y + 2, Math.min(46, r.x + r.w - x - 2), Math.min(46, r.y + r.h - y - 2));
        }
      }
    }
    // re-draw corridor joins over room tiles so doorways look open
    for (const c of CORRIDORS) {
      if (!visible(c, view)) continue;
      ctx.fillStyle = 'rgba(61,69,96,0.55)';
      ctx.fillRect(c.x, c.y, c.w, c.h);
    }

    // obstacles
    for (const o of OBSTACLES) if (visible(o, view)) drawObstacle(ctx, o, time);

    // emergency button
    const pulse = 1 + 0.08 * Math.sin(time / 250);
    ctx.fillStyle = '#7a0f1a';
    ctx.beginPath(); ctx.arc(BUTTON.x, BUTTON.y + 4, 24 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff3b4e';
    ctx.beginPath(); ctx.arc(BUTTON.x, BUTTON.y, 22 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath(); ctx.arc(BUTTON.x - 7, BUTTON.y - 7, 6, 0, Math.PI * 2); ctx.fill();

    // task stations
    const myTasks = opts.myTasks || {};
    for (const t of TASKS) {
      if (t.x < view.x - 80 || t.x > view.x + view.w + 80 || t.y < view.y - 80 || t.y > view.y + view.h + 80) continue;
      const mine = myTasks[t.id];
      ctx.fillStyle = '#23283d';
      rr(ctx, t.x - 26, t.y - 20, 52, 40, 8); ctx.fill();
      ctx.fillStyle = mine === false ? '#ffe066' : '#56e0a0';
      ctx.globalAlpha = mine === false ? 0.75 + 0.25 * Math.sin(time / 200) : 0.5;
      rr(ctx, t.x - 20, t.y - 14, 40, 22, 5); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(t.icon, t.x, t.y - 3);
      if (mine === false) {
        ctx.fillStyle = '#ffe066';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('!', t.x, t.y - 38 + Math.sin(time / 200) * 3);
      }
    }

    // room labels
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 26px "Trebuchet MS", sans-serif';
    for (const r of ROOMS) {
      if (!visible(r, view)) continue;
      const lx = r.x + r.w / 2, ly = r.y + 34;
      const tw = ctx.measureText(r.name).width + 28;
      ctx.fillStyle = 'rgba(10,14,35,0.55)';
      rr(ctx, lx - tw / 2, ly - 18, tw, 36, 18); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(r.name, lx, ly + 1);
    }
  }

  function drawObstacle(ctx, o, time) {
    ctx.save();
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    rr(ctx, o.x + 4, o.y + 8, o.w, o.h, 10); ctx.fill();
    switch (o.kind) {
      case 'planter':
        ctx.fillStyle = '#7b4b2a'; rr(ctx, o.x, o.y, o.w, o.h, 10); ctx.fill();
        ctx.fillStyle = '#4e2f1a'; rr(ctx, o.x + 6, o.y + 6, o.w - 12, o.h - 12, 8); ctx.fill();
        for (let i = 0; i < 4; i++) {
          const px = o.x + 22 + i * 35, py = o.y + o.h / 2;
          ctx.fillStyle = ['#5fd068', '#8ee26b', '#ff8fb1', '#ffd34d'][i];
          ctx.beginPath(); ctx.arc(px, py - 4, 13, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#3fa34d';
          ctx.beginPath(); ctx.ellipse(px - 8, py + 6, 8, 4, -0.5, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'button-table':
        ctx.fillStyle = '#d7deef'; ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, o.w / 2 + 10, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#aab4cf'; ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, o.w / 2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'table':
        ctx.fillStyle = '#d7deef'; rr(ctx, o.x, o.y, o.w, o.h, 14); ctx.fill();
        ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.arc(o.x + 30, o.y + 30, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#54a0ff'; ctx.beginPath(); ctx.arc(o.x + 75, o.y + 28, 8, 0, Math.PI * 2); ctx.fill();
        break;
      case 'desk':
        ctx.fillStyle = '#2b2f45'; rr(ctx, o.x, o.y, o.w, o.h, 8); ctx.fill();
        for (let i = 0; i < 3; i++) {
          ctx.fillStyle = i % 2 ? '#48dbfb' : '#1dd1a1';
          ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time / 300 + i);
          rr(ctx, o.x + 12 + i * 56, o.y + 10, 44, 28, 4); ctx.fill();
        }
        ctx.globalAlpha = 1;
        break;
      case 'bed':
        ctx.fillStyle = '#e8eef7'; rr(ctx, o.x, o.y, o.w, o.h, 10); ctx.fill();
        ctx.fillStyle = '#7fd1e8'; rr(ctx, o.x + 6, o.y + 30, o.w - 12, o.h - 36, 8); ctx.fill();
        ctx.fillStyle = '#fff'; rr(ctx, o.x + 12, o.y + 6, o.w - 24, 20, 8); ctx.fill();
        break;
      case 'crate':
        ctx.fillStyle = '#c58b4a'; rr(ctx, o.x, o.y, o.w, o.h, 6); ctx.fill();
        ctx.strokeStyle = '#8a5a2b'; ctx.lineWidth = 4;
        ctx.strokeRect(o.x + 6, o.y + 6, o.w - 12, o.h - 12);
        ctx.beginPath(); ctx.moveTo(o.x + 6, o.y + 6); ctx.lineTo(o.x + o.w - 6, o.y + o.h - 6); ctx.stroke();
        break;
      case 'console':
        ctx.fillStyle = '#20253a'; rr(ctx, o.x, o.y, o.w, o.h, 12); ctx.fill();
        ctx.fillStyle = '#54a0ff'; ctx.globalAlpha = 0.7 + 0.3 * Math.sin(time / 400);
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 32, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 20, 0, Math.PI * 2); ctx.stroke();
        break;
      case 'engine':
        ctx.fillStyle = '#555c73'; rr(ctx, o.x, o.y, o.w, o.h, 20); ctx.fill();
        ctx.fillStyle = '#ff9f43';
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time / 150);
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 34, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffd34d';
        ctx.beginPath(); ctx.arc(o.x + o.w / 2, o.y + o.h / 2, 16, 0, Math.PI * 2); ctx.fill();
        break;
      case 'reactor': {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        ctx.fillStyle = '#2b2140'; ctx.beginPath(); ctx.arc(cx, cy, o.w / 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c56cf0'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time / 250);
        ctx.beginPath(); ctx.arc(cx, cy, 36, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#f8c4ff'; ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.ellipse(cx, cy, 44, 14, time / 800 + i * Math.PI / 3, 0, Math.PI * 2); ctx.stroke();
        }
        break;
      }
      case 'shield': {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        ctx.fillStyle = '#26402a'; rr(ctx, o.x, o.y, o.w, o.h, 16); ctx.fill();
        ctx.strokeStyle = '#7bed9f'; ctx.lineWidth = 4;
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time / 300);
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2;
          ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * 30, cy + Math.sin(a) * 30);
        }
        ctx.closePath(); ctx.stroke();
        ctx.globalAlpha = 1;
        break;
      }
    }
    ctx.restore();
  }

  // Tiny overview map (used in the HUD)
  function drawMiniMap(ctx, w, h, me, tasksLeft) {
    const s = Math.min(w / WORLD.w, h / WORLD.h);
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate((w - WORLD.w * s) / 2, (h - WORLD.h * s) / 2);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(160,180,230,0.55)';
    for (const r of WALKABLE) ctx.fillRect(r.x, r.y, r.w, r.h);
    if (tasksLeft) {
      ctx.fillStyle = '#ffe066';
      for (const t of TASKS) if (tasksLeft[t.id] === false) { ctx.beginPath(); ctx.arc(t.x, t.y, 34, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.fillStyle = '#ff3b4e';
    ctx.beginPath(); ctx.arc(BUTTON.x, BUTTON.y, 30, 0, Math.PI * 2); ctx.fill();
    if (me) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(me.x, me.y, 48, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  window.GameMap = {
    WORLD, ROOMS, CORRIDORS, OBSTACLES, TASKS, BUTTON,
    canStand, moveWithCollision, roomAt, drawMap, drawMiniMap, rr,
    taskById: id => TASKS.find(t => t.id === id),
  };
})();

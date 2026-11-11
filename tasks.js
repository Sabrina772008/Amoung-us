/*
 * Star Beans – task mini-games (all tap / touch friendly)
 *   wires   – tap a wire on the left, then the same colour on the right
 *   numbers – tap the numbers 1..8 in order
 *   hold    – press and hold the big button until the bar is full
 *   targets – tap the things that pop up
 */
(function () {
  'use strict';

  let modal, box, current = null;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function shuffle(a) {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  function tap(node, fn) {
    node.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(e); });
  }

  function open(task, callbacks) {
    modal = document.getElementById('task-modal');
    close(true);
    current = { task, cb: callbacks || {}, timers: [] };
    modal.innerHTML = '';
    box = el('div', 'task-box');
    const head = el('div', 'task-head');
    head.appendChild(el('div', 'task-title', `${task.icon} ${task.name}`));
    const x = el('button', 'task-close', '✕');
    x.setAttribute('aria-label', 'Close task');
    tap(x, () => close());
    head.appendChild(x);
    box.appendChild(head);
    const body = el('div', 'task-body');
    box.appendChild(body);
    modal.appendChild(box);
    modal.classList.remove('hidden');
    const games = { wires, numbers, hold, targets };
    (games[task.type] || hold)(body, task);
  }

  function finish() {
    if (!current) return;
    const cb = current.cb;
    const done = el('div', 'task-done', '✔ Task complete!');
    box.appendChild(done);
    if (window.Sound) Sound.play('task');
    current.timers.push(setTimeout(() => { close(true); if (cb.onDone) cb.onDone(); }, 700));
    current.finished = true;
  }

  function close(silent) {
    if (current) {
      current.timers.forEach(clearTimeout);
      current.timers.forEach(clearInterval);
      const cb = current.cb;
      const wasFinished = current.finished;
      current = null;
      if (!silent && !wasFinished && cb.onClose) cb.onClose();
    }
    if (modal) { modal.classList.add('hidden'); modal.innerHTML = ''; }
  }
  function isOpen() { return !!current; }

  /* --------------------------- WIRES --------------------------- */
  function wires(body) {
    const cols = ['#ff4757', '#3d7bff', '#ffe23d', '#ff7eb6'];
    body.appendChild(el('p', 'task-hint', 'Tap a wire on the left, then the matching colour on the right.'));
    const area = el('div', 'wires-area');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'wires-svg');
    const left = el('div', 'wires-col'), right = el('div', 'wires-col right');
    area.appendChild(left); area.appendChild(svg); area.appendChild(right);
    body.appendChild(area);
    const L = shuffle(cols), R = shuffle(cols);
    let picked = null, doneCount = 0;
    const leftBtns = L.map(c => { const b = el('button', 'wire-end'); b.style.background = c; b.dataset.c = c; left.appendChild(b); return b; });
    const rightBtns = R.map(c => { const b = el('button', 'wire-end'); b.style.background = c; b.dataset.c = c; right.appendChild(b); return b; });

    function center(b) {
      const a = svg.getBoundingClientRect(), r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2 - a.left, y: r.top + r.height / 2 - a.top };
    }
    leftBtns.forEach(b => tap(b, () => {
      if (b.classList.contains('done')) return;
      leftBtns.forEach(x => x.classList.remove('picked'));
      b.classList.add('picked'); picked = b;
      if (window.Sound) Sound.play('click');
    }));
    rightBtns.forEach(b => tap(b, () => {
      if (!picked || b.classList.contains('done')) return;
      if (b.dataset.c !== picked.dataset.c) {
        b.classList.add('wrong'); setTimeout(() => b.classList.remove('wrong'), 300);
        if (window.Sound) Sound.play('error');
        return;
      }
      const p1 = center(picked), p2 = center(b);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', 0); line.setAttribute('y1', p1.y);
      line.setAttribute('x2', '100%'); line.setAttribute('y2', p2.y);
      line.setAttribute('stroke', b.dataset.c); line.setAttribute('stroke-width', 12); line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
      picked.classList.add('done'); picked.classList.remove('picked'); b.classList.add('done');
      picked = null; doneCount++;
      if (window.Sound) Sound.play('click');
      if (doneCount === cols.length) finish();
    }));
  }

  /* --------------------------- NUMBERS --------------------------- */
  function numbers(body) {
    body.appendChild(el('p', 'task-hint', 'Tap the numbers in order: 1, 2, 3 …'));
    const grid = el('div', 'num-grid');
    body.appendChild(grid);
    let next = 1;
    const btns = shuffle([1, 2, 3, 4, 5, 6, 7, 8]).map(n => {
      const b = el('button', 'num-btn', String(n));
      tap(b, () => {
        if (n === next) {
          b.classList.add('ok'); next++;
          if (window.Sound) Sound.play('click');
          if (next > 8) finish();
        } else if (n > next) {
          btns.forEach(x => x.classList.remove('ok'));
          next = 1;
          grid.classList.add('shake'); setTimeout(() => grid.classList.remove('shake'), 350);
          if (window.Sound) Sound.play('error');
        }
      });
      grid.appendChild(b);
      return b;
    });
  }

  /* --------------------------- HOLD --------------------------- */
  function hold(body, task) {
    const words = {
      caf_trash: ['Hold to empty the garbage', '🗑️'],
      comm_download: ['Hold to download', '📡'],
      med_scan: ['Hold to scan', '🩺'],
      storage_fuel: ['Hold to fill the fuel can', '⛽'],
      eng_fuel: ['Hold to fuel the engine', '🔥'],
    }[task.id] || ['Hold the button', '⚡'];
    body.appendChild(el('p', 'task-hint', words[0] + ' (keep your finger on the button).'));
    const bar = el('div', 'hold-bar'); const fill = el('div', 'hold-fill'); bar.appendChild(fill);
    const btn = el('button', 'hold-btn', words[1]);
    body.appendChild(bar); body.appendChild(btn);
    let progress = 0, holding = false;
    const NEED = 3200;
    const down = (e) => { e.preventDefault(); holding = true; btn.classList.add('active'); };
    const up = () => { holding = false; btn.classList.remove('active'); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointerleave', up);
    btn.addEventListener('pointercancel', up);
    let last = performance.now();
    const iv = setInterval(() => {
      const now = performance.now(), dt = now - last; last = now;
      if (holding) progress += dt;
      fill.style.width = Math.min(100, progress / NEED * 100) + '%';
      if (progress >= NEED) { clearInterval(iv); finish(); }
    }, 50);
    current.timers.push(iv);
  }

  /* --------------------------- TARGETS --------------------------- */
  function targets(body, task) {
    const icon = { gh_water: '🌱', nav_course: '⭐', shield_prime: '🛡️' }[task.id] || '⭐';
    const what = { gh_water: 'Tap each thirsty plant!', nav_course: 'Tap the stars to chart the course!', shield_prime: 'Tap the shield panels!' }[task.id] || 'Tap the targets!';
    body.appendChild(el('p', 'task-hint', what));
    const field = el('div', 'target-field');
    const counter = el('div', 'target-count', '0 / 6');
    body.appendChild(field); body.appendChild(counter);
    let hits = 0;
    function spawn() {
      if (!current) return;
      field.innerHTML = '';
      const t = el('button', 'target', icon);
      t.style.left = (8 + Math.random() * 74) + '%';
      t.style.top = (8 + Math.random() * 64) + '%';
      tap(t, () => {
        hits++;
        counter.textContent = `${hits} / 6`;
        t.classList.add('pop');
        if (window.Sound) Sound.play('pop');
        if (hits >= 6) { setTimeout(finish, 150); }
        else current.timers.push(setTimeout(spawn, 180));
      });
      field.appendChild(t);
    }
    spawn();
  }

  window.Tasks = { open, close, isOpen };
})();

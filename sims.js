/* Simulations you drive with the cursor, on the front door.

   The user, 2026-11-14: "the cursor sim websites should be integrated" and "make various
   cursor sim websites and add it to my personal website as a whole section". Three, in
   the order he picked them for projects/cursor-sims: a fluid, orbits, reaction-diffusion.

     Fluid     incompressible Navier-Stokes on a grid, Stam's "stable fluids": semi-
               Lagrangian advection, a pressure projection (Gauss-Seidel, warm-started
               from the last frame) and vorticity confinement so stirred eddies keep
               spinning instead of smearing out. Drag to push fluid and drop dye.
     Orbits    N-body gravity with a kick-drift-kick leapfrog, which is symplectic: the
               energy readout wanders but does not drift. Drag back and let go to launch
               a planet slingshot-style; the dotted line is its predicted path, computed
               by running the whole system forward. Bodies that touch merge, conserving
               momentum.
     Patterns  Gray-Scott reaction-diffusion: two chemicals, one feeding on the other.
               Paint to seed it; the presets are (F, k) points from Pearson's map.

   Each core is plain arithmetic on typed arrays, exported for node so the physics is
   tested without a browser (test/sims.test.cjs). The page side shares one canvas, runs
   only while the stage is on screen, and starts paused under reduced motion.

   Plain script with the logic exported for node, like find.js and graph.js. */
(function (root) {
  'use strict';

  // ================================================================ fluid
  function Fluid(w, h) {
    this.w = w; this.h = h;
    var n = w * h, F = function () { return new Float32Array(n); };
    this.u = F(); this.v = F(); this.u0 = F(); this.v0 = F();
    this.p = F(); this.div = F(); this.curl = F();
    this.r = F(); this.g = F(); this.b = F(); this.t0 = F();
  }

  // Bilinear sample of field f at real (x, y), clamped inside the walls.
  Fluid.prototype.sample = function (f, x, y) {
    var w = this.w, h = this.h;
    x = x < 0.5 ? 0.5 : x > w - 1.5 ? w - 1.5 : x;
    y = y < 0.5 ? 0.5 : y > h - 1.5 ? h - 1.5 : y;
    var x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (f[i] * (1 - fx) + f[i + 1] * fx) * (1 - fy) + (f[i + w] * (1 - fx) + f[i + w + 1] * fx) * fy;
  };

  // dst = src carried back along (u, v) for dt seconds. Velocity is in cells/second.
  Fluid.prototype.advect = function (dst, src, dt) {
    var w = this.w, h = this.h, u = this.u0, v = this.v0;
    for (var y = 1; y < h - 1; y++) for (var x = 1, i = y * w + 1; x < w - 1; x++, i++)
      dst[i] = this.sample(src, x - dt * u[i], y - dt * v[i]);
  };

  // Closed box: no flow through or along the walls.
  Fluid.prototype.walls = function () {
    var w = this.w, h = this.h, u = this.u, v = this.v, x, y;
    for (x = 0; x < w; x++) { u[x] = v[x] = 0; u[(h - 1) * w + x] = v[(h - 1) * w + x] = 0; }
    for (y = 0; y < h; y++) { u[y * w] = v[y * w] = 0; u[y * w + w - 1] = v[y * w + w - 1] = 0; }
  };

  // Make (u, v) divergence-free: solve lap(p) = div(u) and subtract grad(p).
  Fluid.prototype.project = function (iters) {
    var w = this.w, h = this.h, u = this.u, v = this.v, p = this.p, d = this.div, x, y, i, k;
    for (y = 1; y < h - 1; y++) for (x = 1, i = y * w + 1; x < w - 1; x++, i++)
      d[i] = -0.5 * (u[i + 1] - u[i - 1] + v[i + w] - v[i - w]);
    for (k = 0; k < iters; k++) {
      for (y = 1; y < h - 1; y++) for (x = 1, i = y * w + 1; x < w - 1; x++, i++)
        p[i] = (d[i] + p[i - 1] + p[i + 1] + p[i - w] + p[i + w]) * 0.25;
      for (x = 0; x < w; x++) { p[x] = p[x + w]; p[(h - 1) * w + x] = p[(h - 2) * w + x]; }
      for (y = 0; y < h; y++) { p[y * w] = p[y * w + 1]; p[y * w + w - 1] = p[y * w + w - 2]; }
    }
    for (y = 1; y < h - 1; y++) for (x = 1, i = y * w + 1; x < w - 1; x++, i++) {
      u[i] -= 0.5 * (p[i + 1] - p[i - 1]);
      v[i] -= 0.5 * (p[i + w] - p[i - w]);
    }
    this.walls();
  };

  // Largest |div u| over the interior. On this collocated grid project() cannot take it
  // to zero: a checkerboard mode is invisible to the centred-difference gradient, so a
  // floor remains (~4 after 1000 iterations on the test's splats). Use rmsDiv to judge.
  Fluid.prototype.maxDiv = function () {
    var w = this.w, h = this.h, u = this.u, v = this.v, m = 0;
    for (var y = 2; y < h - 2; y++) for (var x = 2, i = y * w + 2; x < w - 2; x++, i++)
      m = Math.max(m, Math.abs(0.5 * (u[i + 1] - u[i - 1] + v[i + w] - v[i - w])));
    return m;
  };

  Fluid.prototype.rmsDiv = function () {
    var w = this.w, h = this.h, u = this.u, v = this.v, s = 0, n = 0;
    for (var y = 2; y < h - 2; y++) for (var x = 2, i = y * w + 2; x < w - 2; x++, i++) {
      var d = 0.5 * (u[i + 1] - u[i - 1] + v[i + w] - v[i - w]); s += d * d; n++;
    }
    return Math.sqrt(s / n);
  };

  // Vorticity confinement: push along grad|curl| x curl, putting back the spin that
  // grid-scale numerical diffusion takes out.
  Fluid.prototype.confine = function (eps, dt) {
    var w = this.w, h = this.h, u = this.u, v = this.v, c = this.curl, x, y, i;
    for (y = 1; y < h - 1; y++) for (x = 1, i = y * w + 1; x < w - 1; x++, i++)
      c[i] = 0.5 * ((v[i + 1] - v[i - 1]) - (u[i + w] - u[i - w]));
    for (y = 2; y < h - 2; y++) for (x = 2, i = y * w + 2; x < w - 2; x++, i++) {
      var nx = 0.5 * (Math.abs(c[i + 1]) - Math.abs(c[i - 1])),
          ny = 0.5 * (Math.abs(c[i + w]) - Math.abs(c[i - w])),
          l = Math.sqrt(nx * nx + ny * ny) + 1e-5;
      u[i] += dt * eps * (ny / l) * c[i];
      v[i] -= dt * eps * (nx / l) * c[i];
    }
  };

  Fluid.prototype.energy = function () {
    var s = 0, u = this.u, v = this.v;
    for (var i = 0; i < u.length; i++) s += u[i] * u[i] + v[i] * v[i];
    return s / 2;
  };

  // Push the fluid by (dx, dy) cells/s and add colour in a soft disc of radius r.
  Fluid.prototype.splat = function (x, y, dx, dy, r, rgb) {
    var w = this.w, h = this.h, r2 = r * r;
    for (var j = Math.max(1, Math.floor(y - 2 * r)); j <= Math.min(h - 2, Math.ceil(y + 2 * r)); j++)
      for (var i = Math.max(1, Math.floor(x - 2 * r)); i <= Math.min(w - 2, Math.ceil(x + 2 * r)); i++) {
        var d2 = (i - x) * (i - x) + (j - y) * (j - y);
        if (d2 > 4 * r2) continue;
        var k = Math.exp(-d2 / r2), n = j * w + i;
        this.u[n] += dx * k; this.v[n] += dy * k;
        if (rgb) { this.r[n] += rgb[0] * k; this.g[n] += rgb[1] * k; this.b[n] += rgb[2] * k; }
      }
  };

  Fluid.prototype.step = function (dt, o) {
    o = o || {};
    var iters = o.iters || 20, fade = o.fade != null ? o.fade : 0.35;
    if (o.confine) this.confine(o.confine, dt);
    this.project(iters);
    this.u0.set(this.u); this.v0.set(this.v);
    this.advect(this.u, this.u0, dt);
    this.advect(this.v, this.v0, dt);
    this.walls();
    this.project(iters);
    var keep = Math.max(0, 1 - fade * dt);
    var self = this;
    ['r', 'g', 'b'].forEach(function (c) {
      self.t0.set(self[c]);
      self.advect(self[c], self.t0, dt);
      var f = self[c];
      for (var i = 0; i < f.length; i++) f[i] *= keep;
    });
  };

  // ================================================================ orbits
  // G = 1; world units are "stage pixels at 600 high".
  function Orbits(o) {
    o = o || {};
    this.bodies = [];
    this.soft = o.soft != null ? o.soft : 4;
    this.merged = 0; this.escaped = 0;
  }
  Orbits.radius = function (m) { return 1.6 + Math.cbrt(m) * 0.09; };
  Orbits.prototype.add = function (x, y, vx, vy, m) {
    var b = { x: x, y: y, vx: vx, vy: vy, m: m, r: Orbits.radius(m), ax: 0, ay: 0, trail: [] };
    this.bodies.push(b); this.accel(); return b;
  };
  Orbits.prototype.accel = function () {
    var B = this.bodies, e2 = this.soft * this.soft, i, j;
    for (i = 0; i < B.length; i++) B[i].ax = B[i].ay = 0;
    for (i = 0; i < B.length; i++) for (j = i + 1; j < B.length; j++) {
      var a = B[i], b = B[j], dx = b.x - a.x, dy = b.y - a.y,
          d2 = dx * dx + dy * dy + e2, inv = 1 / (d2 * Math.sqrt(d2));
      a.ax += b.m * dx * inv; a.ay += b.m * dy * inv;
      b.ax -= a.m * dx * inv; b.ay -= a.m * dy * inv;
    }
  };
  // Kick-drift-kick. Merging happens between steps, so each step itself is symplectic.
  Orbits.prototype.step = function (dt) {
    var B = this.bodies, i;
    for (i = 0; i < B.length; i++) { B[i].vx += B[i].ax * dt / 2; B[i].vy += B[i].ay * dt / 2; B[i].x += B[i].vx * dt; B[i].y += B[i].vy * dt; }
    this.accel();
    for (i = 0; i < B.length; i++) { B[i].vx += B[i].ax * dt / 2; B[i].vy += B[i].ay * dt / 2; }
  };
  // Bodies that overlap become one, with mass, momentum and centre of mass conserved.
  Orbits.prototype.merge = function () {
    var B = this.bodies, hit = false;
    for (var i = 0; i < B.length; i++) for (var j = i + 1; j < B.length; j++) {
      var a = B[i], b = B[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > (a.r + b.r) * 0.7) continue;
      var m = a.m + b.m;
      a.x = (a.x * a.m + b.x * b.m) / m; a.y = (a.y * a.m + b.y * b.m) / m;
      a.vx = (a.vx * a.m + b.vx * b.m) / m; a.vy = (a.vy * a.m + b.vy * b.m) / m;
      a.m = m; a.r = Orbits.radius(m);
      B.splice(j, 1); j--; this.merged++; hit = true;
    }
    if (hit) this.accel();
    return hit;
  };
  // Drop bodies further than `far` from the centre of mass of the system.
  Orbits.prototype.cull = function (cx, cy, far) {
    var n = this.bodies.length;
    this.bodies = this.bodies.filter(function (b) { return Math.hypot(b.x - cx, b.y - cy) < far; });
    this.escaped += n - this.bodies.length;
    if (n !== this.bodies.length) this.accel();
  };
  Orbits.prototype.energy = function () {
    var B = this.bodies, e2 = this.soft * this.soft, k = 0, p = 0;
    for (var i = 0; i < B.length; i++) {
      k += 0.5 * B[i].m * (B[i].vx * B[i].vx + B[i].vy * B[i].vy);
      for (var j = i + 1; j < B.length; j++)
        p -= B[i].m * B[j].m / Math.sqrt((B[i].x - B[j].x) * (B[i].x - B[j].x) + (B[i].y - B[j].y) * (B[i].y - B[j].y) + e2);
    }
    return k + p;
  };
  Orbits.prototype.momentum = function () {
    var px = 0, py = 0;
    this.bodies.forEach(function (b) { px += b.m * b.vx; py += b.m * b.vy; });
    return [px, py];
  };
  // Where a body launched now would go: the whole system run forward on a copy.
  Orbits.prototype.predict = function (x, y, vx, vy, m, steps, dt) {
    var c = new Orbits({ soft: this.soft });
    this.bodies.forEach(function (b) { c.bodies.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, m: b.m, r: b.r, ax: 0, ay: 0 }); });
    var me = c.add(x, y, vx, vy, m), path = [];
    for (var s = 0; s < steps; s++) {
      c.step(dt);
      path.push(me.x, me.y);
      for (var k = 0; k < c.bodies.length - 1; k++) {
        var o = c.bodies[k];
        if (Math.hypot(o.x - me.x, o.y - me.y) < (o.r + me.r) * 0.7) return path;   // it would hit
      }
    }
    return path;
  };
  // A star and a few planets on circular orbits about it.
  Orbits.prototype.seedSystem = function (cx, cy, M) {
    this.bodies = []; this.merged = this.escaped = 0;
    this.add(cx, cy, 0, 0, M);
    var self = this;
    [[70, 900, 0.4], [125, 2400, 2.1], [190, 1600, 4.0], [255, 5200, 5.3]].forEach(function (q) {
      var r = q[0], a = q[2], v = Math.sqrt(M / r);
      self.add(cx + r * Math.cos(a), cy + r * Math.sin(a), -v * Math.sin(a), v * Math.cos(a), q[1]);
    });
    // Zero the total momentum so the star does not wander off the stage.
    var p = this.momentum(), m = 0;
    this.bodies.forEach(function (b) { m += b.m; });
    this.bodies.forEach(function (b) { b.vx -= p[0] / m; b.vy -= p[1] / m; });
  };

  // ================================================================ Gray-Scott
  function GrayScott(w, h) {
    this.w = w; this.h = h;
    var n = w * h;
    this.u = new Float32Array(n).fill(1); this.v = new Float32Array(n);
    this.u2 = new Float32Array(n); this.v2 = new Float32Array(n);
  }
  GrayScott.PRESETS = {
    coral: [0.0545, 0.062], mitosis: [0.0367, 0.0649], worms: [0.046, 0.063], spots: [0.03, 0.062],
  };
  GrayScott.prototype.paint = function (x, y, r) {
    var w = this.w, h = this.h;
    for (var j = Math.floor(y - r); j <= Math.ceil(y + r); j++) for (var i = Math.floor(x - r); i <= Math.ceil(x + r); i++) {
      if ((i - x) * (i - x) + (j - y) * (j - y) > r * r) continue;
      var n = ((j % h + h) % h) * w + ((i % w + w) % w);
      // (0.5, 0.5): a full-strength seed (v=1) starves itself in the mitosis regime and
      // dies; this one grows under every preset (measured, test/sims.test.cjs).
      this.v[n] = 0.5; this.u[n] = 0.5;
    }
  };
  // n steps of dt=1 with Du=1, Dv=0.5 and the 3x3 Laplacian (sides .2, corners .05,
  // centre -1), wrap-around edges.
  GrayScott.prototype.step = function (n, F, k) {
    var w = this.w, h = this.h;
    for (var s = 0; s < n; s++) {
      var U = this.u, V = this.v, U2 = this.u2, V2 = this.v2;
      for (var y = 0; y < h; y++) {
        var yu = ((y - 1 + h) % h) * w, yc = y * w, yd = ((y + 1) % h) * w;
        for (var x = 0; x < w; x++) {
          var xl = (x - 1 + w) % w, xr = (x + 1) % w, i = yc + x;
          var lu = 0.2 * (U[yc + xl] + U[yc + xr] + U[yu + x] + U[yd + x]) + 0.05 * (U[yu + xl] + U[yu + xr] + U[yd + xl] + U[yd + xr]) - U[i];
          var lv = 0.2 * (V[yc + xl] + V[yc + xr] + V[yu + x] + V[yd + x]) + 0.05 * (V[yu + xl] + V[yu + xr] + V[yd + xl] + V[yd + xr]) - V[i];
          var uvv = U[i] * V[i] * V[i];
          U2[i] = U[i] + (lu - uvv + F * (1 - U[i]));
          V2[i] = V[i] + (0.5 * lv + uvv - (F + k) * V[i]);
        }
      }
      this.u = U2; this.v = V2; this.u2 = U; this.v2 = V;
    }
  };

  var api = { Fluid: Fluid, Orbits: Orbits, GrayScott: GrayScott };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HubSims = api;

  if (typeof document === 'undefined') return;

  // ================================================================ the page side
  function boot() {
    var sec = document.getElementById('sims'), cv = document.getElementById('sim');
    if (!sec || !cv || !cv.getContext) return;
    var ctx = cv.getContext('2d'), stage = cv.parentNode, hud = document.getElementById('sim-hud');
    var tabs = [].slice.call(sec.querySelectorAll('[role="tab"]'));
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dark = matchMedia('(prefers-color-scheme: dark)');
    var W = 0, H = 0, dpr = 1, which = 'fluid', playing = !still, visible = false, raf = 0;
    var ptr = { down: false, x: 0, y: 0, px: 0, py: 0, t: 0, sx: 0, sy: 0 }, lastTouch = 0;
    var off = document.createElement('canvas'), octx = off.getContext('2d'), img = null;
    var S = {};                       // one live instance per sim, kept across tab switches

    function css(name) { return getComputedStyle(sec).getPropertyValue(name).trim(); }
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function grid(base) { var a = W / H || 1.6; return a >= 1 ? [Math.round(base * a), base] : [base, Math.round(base / a)]; }
    function surface(w, h) {
      if (off.width !== w || off.height !== h) { off.width = w; off.height = h; img = octx.createImageData(w, h); }
      return img;
    }
    function blit() {
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, W, H);
    }
    function hex(c) {
      var m = /^#?([0-9a-f]{6})$/i.exec(c || '');
      if (!m) return [128, 128, 128];
      var n = parseInt(m[1], 16); return [n >> 16 & 255, n >> 8 & 255, n & 255];
    }

    // --- fluid ---------------------------------------------------------------
    var hue = 0;
    function hsv(hh) {
      var f = function (n) { var k = (n + hh * 6) % 6; return 1 - Math.max(0, Math.min(k, 4 - k, 1)); };
      return [f(5), f(3), f(1)];
    }
    var fluid = {
      title: 'Fluid',
      make: function () { var g = grid(80); return new Fluid(g[0], g[1]); },
      step: function (f, dt) {
        var sx = f.w / W, sy = f.h / H, idle = performance.now() - ptr.t > 2500;
        if (ptr.down) {
          var dx = (ptr.x - ptr.px) / dt * sx, dy = (ptr.y - ptr.py) / dt * sy;
          hue = (hue + dt * 0.12) % 1;
          f.splat(ptr.x * sx, ptr.y * sy, dx * 0.6, dy * 0.6, Math.max(2, f.h / 22), hsv(hue).map(function (c) { return c * 0.9; }));
        } else if (idle) {
          // Nobody stirring: a slow phantom spoon, so the stage is never a blank rectangle.
          var t = performance.now() / 1000, a = t * 0.7;
          hue = (hue + dt * 0.05) % 1;
          f.splat(f.w / 2 + Math.cos(a) * f.w * 0.28, f.h / 2 + Math.sin(a * 1.3) * f.h * 0.3,
                  -Math.sin(a) * f.w * 0.5, Math.cos(a * 1.3) * f.h * 0.5, Math.max(2, f.h / 26), hsv(hue).map(function (c) { return c * 0.5; }));
        }
        ptr.px = ptr.x; ptr.py = ptr.y;
        f.step(dt, { iters: 16, confine: 12, fade: 0.25 });
      },
      draw: function (f) {
        var d = surface(f.w, f.h).data, dk = dark.matches, bg = hex(css('--card-2'));
        for (var i = 0, n = f.w * f.h; i < n; i++) {
          var r = f.r[i], g = f.g[i], b = f.b[i], m = Math.max(r, g, b, 1e-6);
          // The dye's hue at full saturation, laid over the ground with an opacity from its
          // amount. Mixing amounts straight into RGB (the first try) turned faint dye into
          // grey-brown mud on the light ground.
          var a = Math.min(1, m * (dk ? 1.4 : 1.8)), k = dk ? 255 : 225;
          d[4 * i]     = bg[0] * (1 - a) + k * (r / m) * a;
          d[4 * i + 1] = bg[1] * (1 - a) + k * (g / m) * a;
          d[4 * i + 2] = bg[2] * (1 - a) + k * (b / m) * a;
          d[4 * i + 3] = 255;
        }
        blit();
      },
      info: function (f) { return f.w + '×' + f.h + ' grid · 16 pressure iterations · vorticity ε 12'; },
    };

    // --- orbits --------------------------------------------------------------
    var aim = null;
    function world() { var k = 600 / H; return { k: k, w: W * k, h: 600 }; }
    var orbits = {
      title: 'Orbits',
      make: function () { var o = new Orbits(), wd = world(); o.seedSystem(wd.w / 2, wd.h / 2, 2.2e6); o.e0 = o.energy(); return o; },
      step: function (o, dt) {
        var n = 8, h = dt / n, wd = world();
        for (var s = 0; s < n; s++) { o.step(h); if (o.merge()) o.e0 = o.energy(); }
        o.bodies.forEach(function (b) { b.trail.push(b.x, b.y); if (b.trail.length > 240) b.trail.splice(0, 2); });
        o.cull(wd.w / 2, wd.h / 2, Math.max(wd.w, wd.h) * 2.5);
      },
      draw: function (o) {
        var wd = world(), s = 1 / wd.k, dk = dark.matches, ink = css('--ink'), acc = css('--gold');
        ctx.fillStyle = css('--card-2'); ctx.fillRect(0, 0, W, H);
        var heavy = o.bodies.reduce(function (m, b) { return b.m > m.m ? b : m; }, { m: 0 });
        o.bodies.forEach(function (b) {
          var t = b.trail;
          if (t.length < 4) return;
          ctx.strokeStyle = b === heavy ? acc : ink; ctx.lineWidth = 1;
          for (var i = 2; i < t.length; i += 2) {
            ctx.globalAlpha = (i / t.length) * (dk ? 0.5 : 0.35);
            ctx.beginPath(); ctx.moveTo(t[i - 2] * s, t[i - 1] * s); ctx.lineTo(t[i] * s, t[i + 1] * s); ctx.stroke();
          }
        });
        ctx.globalAlpha = 1;
        o.bodies.forEach(function (b) {
          ctx.fillStyle = b === heavy ? acc : ink;
          if (b === heavy) { ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.arc(b.x * s, b.y * s, b.r * s * 2.4, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1; }
          ctx.beginPath(); ctx.arc(b.x * s, b.y * s, Math.max(2, b.r * s), 0, 6.2832); ctx.fill();
        });
        if (aim) {
          ctx.strokeStyle = acc; ctx.lineWidth = 1.5; ctx.setLineDash([2, 5]);
          ctx.beginPath();
          for (var i = 0; i < aim.path.length; i += 2) ctx[i ? 'lineTo' : 'moveTo'](aim.path[i] * s, aim.path[i + 1] * s);
          ctx.stroke(); ctx.setLineDash([]);
          ctx.globalAlpha = 0.5; ctx.strokeStyle = ink;
          ctx.beginPath(); ctx.moveTo(aim.x * s, aim.y * s); ctx.lineTo(ptr.x, ptr.y); ctx.stroke(); ctx.globalAlpha = 1;
          ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(aim.x * s, aim.y * s, Math.max(2, Orbits.radius(aim.m) * s), 0, 6.2832); ctx.fill();
        }
      },
      info: function (o) {
        var de = o.e0 ? Math.abs((o.energy() - o.e0) / o.e0) * 100 : 0;
        return o.bodies.length + ' bodies · energy drift ' + de.toFixed(3) + '% · ' + o.merged + ' merged · ' + o.escaped + ' escaped';
      },
    };
    function aimAt(o) {
      var wd = world(), k = wd.k;
      aim.vx = (aim.x - ptr.x * k) * 2.2; aim.vy = (aim.y - ptr.y * k) * 2.2;
      aim.path = o.predict(aim.x, aim.y, aim.vx, aim.vy, aim.m, 260, 1 / 90);
    }

    // --- reaction-diffusion ----------------------------------------------------
    var preset = 'coral', lut = null, lutKey = '';
    var patterns = {
      title: 'Patterns',
      make: function () {
        var g = grid(110), gs = new GrayScott(g[0], g[1]);
        for (var q = 0; q < 7; q++) gs.paint(g[0] * (0.2 + 0.6 * ((q * 0.618) % 1)), g[1] * (0.2 + 0.6 * ((q * 0.382) % 1)), 3);
        return gs;
      },
      step: function (gs) {
        if (ptr.down) gs.paint(ptr.x / W * gs.w, ptr.y / H * gs.h, Math.max(2, gs.h / 40));
        var fk = GrayScott.PRESETS[preset];
        gs.step(12, fk[0], fk[1]);
      },
      draw: function (gs) {
        var key = dark.matches + css('--card-2') + css('--accent');
        if (key !== lutKey) {
          lutKey = key; lut = new Uint8ClampedArray(256 * 3);
          var a = hex(css('--card-2')), b = hex(dark.matches ? '#9cc3d5' : '#2f4858'), c = hex(css('--gold'));
          for (var i = 0; i < 256; i++) {
            var t = i / 255, m = t < 0.5 ? t * 2 : (t - 0.5) * 2, A = t < 0.5 ? a : b, B = t < 0.5 ? b : c;
            for (var ch = 0; ch < 3; ch++) lut[i * 3 + ch] = A[ch] + (B[ch] - A[ch]) * m;
          }
        }
        var d = surface(gs.w, gs.h).data, V = gs.v;
        for (var j = 0, n = gs.w * gs.h; j < n; j++) {
          var x = Math.max(0, Math.min(255, (V[j] * 3.2 * 255) | 0)) * 3;
          d[4 * j] = lut[x]; d[4 * j + 1] = lut[x + 1]; d[4 * j + 2] = lut[x + 2]; d[4 * j + 3] = 255;
        }
        blit();
      },
      info: function (gs) { var fk = GrayScott.PRESETS[preset]; return gs.w + '×' + gs.h + ' grid · F ' + fk[0] + ' · k ' + fk[1] + ' · 12 steps/frame'; },
    };

    var SIMS = { fluid: fluid, orbits: orbits, patterns: patterns };
    function cur() { return S[which] || (S[which] = SIMS[which].make()); }

    // --- loop: fixed 60 Hz physics, fps measured, idle when off screen --------------
    var last = 0, fpsT = 0, frames = 0, fps = 0;
    function frame(t) {
      raf = 0;
      var sim = SIMS[which], st = cur(), dt = 1 / 60;
      if (playing) sim.step(st, dt);
      sim.draw(st);
      frames++;
      if (t - fpsT > 500) { fps = Math.round(frames * 1000 / (t - fpsT)); frames = 0; fpsT = t; if (hud) hud.textContent = sim.info(st) + (playing ? ' · ' + fps + ' fps' : ' · paused'); }
      last = t;
      if (visible && (playing || ptr.down)) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

    // --- input ---------------------------------------------------------------
    function local(ev) { var r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    cv.addEventListener('pointerdown', function (ev) {
      var xy = local(ev);
      ptr.down = true; ptr.x = ptr.px = ptr.sx = xy[0]; ptr.y = ptr.py = ptr.sy = xy[1]; ptr.t = performance.now();
      cv.setPointerCapture(ev.pointerId);
      if (which === 'orbits') { var k = world().k; aim = { x: xy[0] * k, y: xy[1] * k, m: 1500 + Math.random() * 3000 }; aimAt(cur()); }
      kick();
    });
    cv.addEventListener('pointermove', function (ev) {
      var xy = local(ev); ptr.x = xy[0]; ptr.y = xy[1]; if (ptr.down) ptr.t = performance.now();
      if (aim) aimAt(cur());
      if (ptr.down) kick();
    });
    function up() {
      if (aim) {
        var o = cur();
        if (Math.hypot(ptr.x - ptr.sx, ptr.y - ptr.sy) > 3) { o.add(aim.x, aim.y, aim.vx, aim.vy, aim.m); o.e0 = o.energy(); }
        aim = null;
      }
      ptr.down = false; ptr.t = performance.now(); kick();
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);

    // --- controls --------------------------------------------------------------
    function select(name, focus) {
      // A launch being aimed belongs to the orbits sim; switching mid-drag must drop it, or
      // the next pointer move runs Orbits code on a Fluid (it did: 'o.predict is not a function').
      aim = null; ptr.down = false;
      which = name;
      tabs.forEach(function (b) {
        var on = b.dataset.sim === name;
        b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
        if (on && focus) b.focus();
      });
      [].forEach.call(sec.querySelectorAll('[data-for]'), function (p) { p.hidden = p.dataset.for !== name; });
      cv.setAttribute('aria-label', cv.dataset['label' + name.charAt(0).toUpperCase() + name.slice(1)] || '');
      fpsT = performance.now(); frames = 0; kick();
    }
    tabs.forEach(function (b, i) {
      b.addEventListener('click', function () { select(b.dataset.sim); });
      b.addEventListener('keydown', function (ev) {
        var d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
        if (d) { ev.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length].dataset.sim, true); }
      });
    });
    var playBtn = document.getElementById('sim-play');
    function setPlay(p) { playing = p; if (playBtn) { playBtn.textContent = p ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', !p); } kick(); }
    if (playBtn) playBtn.addEventListener('click', function () { setPlay(!playing); });
    var resetBtn = document.getElementById('sim-reset');
    if (resetBtn) resetBtn.addEventListener('click', function () { S[which] = SIMS[which].make(); kick(); });
    [].forEach.call(sec.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () {
        preset = b.dataset.preset;
        [].forEach.call(sec.querySelectorAll('[data-preset]'), function (x) { x.setAttribute('aria-pressed', x === b); });
        S.patterns = patterns.make(); kick();
      });
    });
    var fullBtn = document.getElementById('sim-full');
    if (fullBtn) {
      if (!stage.requestFullscreen) fullBtn.hidden = true;
      else fullBtn.addEventListener('click', function () {
        if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen();
      });
    }
    document.addEventListener('fullscreenchange', function () { size(); S = {}; kick(); });

    size(); setPlay(playing); select(which);
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) {
      visible = e[0].isIntersecting && !document.hidden; if (visible) kick();
    }, { rootMargin: '100px' }).observe(stage);
    else visible = true;
    document.addEventListener('visibilitychange', function () { visible = !document.hidden; if (visible) kick(); });
    var rz = 0;
    addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { var w0 = W, h0 = H; size(); if (Math.abs(W / H - w0 / h0) > 0.05) S = {}; kick(); }, 150);
    });
    if (dark.addEventListener) dark.addEventListener('change', kick);
    sec.classList.add('live');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);

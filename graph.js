/* The hero graph, interactive: one node per card on the shelf, in that card's own accent,
   joined to the sites it is most ALIKE — not to whatever happens to be drawn nearby.

   The user, 2026-11-14: "The graph of all sites should be interactive." The old picture
   was a sunflower spiral with distance-based lines, so an edge meant nothing. Now:

     * Edges come from the cards' own words. Each card's title + blurb becomes a TF-IDF
       vector; every node keeps its K most similar neighbours above a floor. Hovering a
       node names the words that tie it to each neighbour, so an edge explains itself.
     * The layout is a small force simulation (repulsion, springs along edges, a pull to
       the centre), so related sites settle into clusters and a dragged node drags its
       neighbours with it.
     * Hover a node: it and its neighbours light up, the rest dim, and its card on the
       shelf is outlined. Hover a card: its node lights up. Click a node: open the site.
       On touch, the first tap selects and the second opens.
     * "Find a site" filters the graph too: a hidden card's node fades out.

   The cards stay the accessible version of every link here, so the canvas stays
   aria-hidden. Under reduced motion the simulation is run to rest before the first
   frame and drawn still; hover and click still work.

   Plain script with the logic exported for node, like find.js. */
(function (root) {
  'use strict';

  var STOP = ('the a an and or of to in on for with from by at as is are be it its this that ' +
    'your you our we what which who how when where than then there their them they each ' +
    'every any all one two three into over about after before more most much many very ' +
    'can will would not no but just only also out up down off per vs via site page day ' +
    'days today live real tool tools find see get whose here near now open map maps ' +
    'was were been has have had since same still ' +
    // the two Spanish-language sites
    'los las del que una uno para por con sin todo todos sus aqui mas').split(' ');
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = 1; });

  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Words worth comparing: folded, 3+ letters, not a stop word, a plural 's' dropped so
  // "menus" meets "menu". Deliberately crude — 33 short blurbs do not need a stemmer.
  function tokens(text) {
    var out = [];
    fold(text).split(' ').forEach(function (w) {
      if (w.length < 3 || STOPSET[w] || /^\d+$/.test(w)) return;
      if (w.length > 4 && /ies$/.test(w)) w = w.slice(0, -3) + 'y';
      else if (w.length > 4 && /[^s]s$/.test(w)) w = w.slice(0, -1);
      out.push(w);
    });
    return out;
  }

  // TF-IDF vectors, L2-normalised, as {word: weight}. A word on every card weighs 0.
  function vectors(docs) {
    var toks = docs.map(tokens), df = {}, n = docs.length;
    toks.forEach(function (ts) {
      var seen = {};
      ts.forEach(function (w) { if (!seen[w]) { seen[w] = 1; df[w] = (df[w] || 0) + 1; } });
    });
    return toks.map(function (ts) {
      var tf = {}, v = {}, norm = 0;
      ts.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; });
      Object.keys(tf).forEach(function (w) {
        var x = tf[w] * Math.log(n / df[w]);
        if (x > 0) { v[w] = x; norm += x * x; }
      });
      norm = Math.sqrt(norm) || 1;
      Object.keys(v).forEach(function (w) { v[w] /= norm; });
      return v;
    });
  }

  function cosine(a, b) {
    var s = 0;
    for (var w in a) if (b[w]) s += a[w] * b[w];
    return s;
  }

  // The words two vectors share, heaviest first.
  function shared(a, b, max) {
    return Object.keys(a).filter(function (w) { return b[w]; })
      .sort(function (x, y) { return a[y] * b[y] - a[x] * b[x] || (x < y ? -1 : 1); })
      .slice(0, max || 3);
  }

  // Undirected edges: each node proposes its k most similar partners with similarity of
  // at least `floor`; the union is kept. A node left with no edge at all keeps its single
  // best partner if they share any word (weak: true), so nothing floats unexplained.
  // Returns [{a, b, w, words, weak}], a < b, sorted.
  function edges(docs, k, floor) {
    var v = vectors(docs), n = docs.length, keep = {}, weak = {}, best = [];
    for (var i = 0; i < n; i++) {
      var cand = [];
      for (var j = 0; j < n; j++) if (j !== i) {
        var s = cosine(v[i], v[j]);
        if (s > 0) cand.push([s, j]);
      }
      cand.sort(function (p, q) { return q[0] - p[0] || p[1] - q[1]; });
      best[i] = cand[0];
      cand.filter(function (c) { return c[0] >= floor; }).slice(0, k).forEach(function (c) {
        var a = Math.min(i, c[1]), b = Math.max(i, c[1]);
        keep[a + ',' + b] = c[0];
      });
    }
    for (i = 0; i < n; i++) {
      var has = Object.keys(keep).some(function (key) { var ab = key.split(','); return +ab[0] === i || +ab[1] === i; });
      if (!has && best[i]) {
        var a2 = Math.min(i, best[i][1]), b2 = Math.max(i, best[i][1]);
        keep[a2 + ',' + b2] = best[i][0]; weak[a2 + ',' + b2] = 1;
      }
    }
    return Object.keys(keep).map(function (key) {
      var ab = key.split(',').map(Number);
      return { a: ab[0], b: ab[1], w: keep[key], words: shared(v[ab[0]], v[ab[1]], 3), weak: !!weak[key] };
    }).sort(function (p, q) { return p.a - q.a || p.b - q.b; });
  }

  // One step of the layout, in unit space (the canvas maps [0,1]² onto itself).
  // Nodes: {x, y, vx, vy, pinned}. Returns the total kinetic energy, so callers can
  // tell when it has come to rest.
  function step(nodes, links, o) {
    o = o || {};
    var rep = o.rep != null ? o.rep : 0.00006, spring = o.spring != null ? o.spring : 0.06,
        len = o.len != null ? o.len : 0.13, grav = o.grav != null ? o.grav : 0.03,
        damp = o.damp != null ? o.damp : 0.82, n = nodes.length, i, j;
    for (i = 0; i < n; i++) {
      var p = nodes[i];
      p.fx = (0.5 - p.x) * grav; p.fy = (0.5 - p.y) * grav;
    }
    for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
      var a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y,
          d2 = dx * dx + dy * dy + 1e-4, f = rep / d2, d = Math.sqrt(d2);
      a.fx += f * dx / d; a.fy += f * dy / d; b.fx -= f * dx / d; b.fy -= f * dy / d;
    }
    links.forEach(function (e) {
      var a = nodes[e.a], b = nodes[e.b], dx = b.x - a.x, dy = b.y - a.y,
          d = Math.sqrt(dx * dx + dy * dy) || 1e-6, f = spring * (d - len) * (0.5 + e.w);
      a.fx += f * dx / d; a.fy += f * dy / d; b.fx -= f * dx / d; b.fy -= f * dy / d;
    });
    var ke = 0;
    for (i = 0; i < n; i++) {
      var q = nodes[i];
      if (q.pinned) { q.vx = q.vy = 0; continue; }
      q.vx = (q.vx + q.fx) * damp; q.vy = (q.vy + q.fy) * damp;
      // Speed cap: two nodes seeded almost on top of each other repel hard enough to
      // fling one across the canvas and wedge it in a corner. 33 cards did exactly that.
      var sp = Math.hypot(q.vx, q.vy);
      if (sp > VMAX) { q.vx *= VMAX / sp; q.vy *= VMAX / sp; }
      q.x = Math.min(0.97, Math.max(0.03, q.x + q.vx));
      q.y = Math.min(0.97, Math.max(0.03, q.y + q.vy));
      ke += q.vx * q.vx + q.vy * q.vy;
    }
    return ke;
  }

  var VMAX = 0.02;

  // Deterministic start: the sunflower spiral the old picture used.
  function seed(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var a = i * 2.39996, r = Math.sqrt((i + 0.5) / n) * 0.38;
      out.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a), vx: 0, vy: 0 });
    }
    return out;
  }

  var api = { fold: fold, tokens: tokens, vectors: vectors, cosine: cosine, shared: shared,
              edges: edges, step: step, seed: seed, K: 2, FLOOR: 0.08 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HubGraph = api;

  if (typeof document === 'undefined') return;

  // ---------------------------------------------------------------- the page side
  function boot() {
    var cv = document.getElementById('graph');
    if (!cv || !cv.getContext) return;
    var fig = cv.parentNode, tip = document.getElementById('graph-tip');
    var ctx = cv.getContext('2d');
    var dark = matchMedia('(prefers-color-scheme: dark)');
    var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    var cards = [].slice.call(document.querySelectorAll('.shelf .site'));
    if (!cards.length) return;
    var info = cards.map(function (li) {
      var a = li.querySelector('a.hit');
      return {
        li: li,
        href: a ? a.getAttribute('href') : '',
        title: (li.querySelector('h2') || {}).textContent || '',
        blurb: (li.querySelector('.blurb') || {}).textContent || '',
        l: li.style.getPropertyValue('--site').trim() || '#6b7280',
        d: li.style.getPropertyValue('--site-dark').trim() || '#9aa3ad',
      };
    });
    // One node that is not a site: the physics lab. It has no .site card, so its `li`
    // is a stub -- the only thing the renderer asks of li is `.hidden`, checked at
    // three places. It steps aside whenever the shelf is being filtered, because a
    // lone bright node while every real site dims reads as a bug, not emphasis.
    info.push({
      li: { get hidden() { return cards.some(function (c) { return c.hidden; }); } },
      href: 'nature.html', special: true,
      title: "Nature's intricacies",
      blurb: 'physics lab simulations animated ball bounce pendulum wave chain water',
      l: '#8a5a12', d: '#e8b45c',
    });

    var links = edges(info.map(function (c) { return c.title + ' ' + c.title + ' ' + c.blurb; }),
                      api.K, api.FLOOR);
    var nbr = info.map(function () { return []; });
    links.forEach(function (e) { nbr[e.a].push(e); nbr[e.b].push(e); });
    var nodes = seed(info.length);
    nodes.forEach(function (p, i) { p.deg = nbr[i].length; p.ph = i * 1.7; });
    for (var w = 0; w < 400; w++) step(nodes, links);       // start near rest: no jumble on load

    var W = 0, H = 0, dpr = 1, hot = -1, sel = -1, drag = null, moved = false, ptr = null;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    // Unit space -> pixels, leaving room for the caption at the bottom.
    function box() { var m = Math.min(W, H - 40); return { m: m, ox: (W - m) / 2, oy: (H - 40 - m) / 2 + 4 }; }
    function px(p) { var b = box(); return [b.ox + p.x * b.m, b.oy + p.y * b.m]; }
    function unit(x, y) { var b = box(); return [(x - b.ox) / b.m, (y - b.oy) / b.m]; }
    function radius(i) { return (info[i].special ? 5.6 : 3.2) + Math.sqrt(nodes[i].deg) * 1.6; }
    function at(x, y) {
      var best = -1, bd = 1e9;
      for (var i = 0; i < nodes.length; i++) {
        if (info[i].li.hidden) continue;
        var p = px(nodes[i]), d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bd && d < radius(i) + 12) { bd = d; best = i; }
      }
      return best;
    }

    function lit(i) { return i < 0 ? null : nbr[i].reduce(function (s, e) { s[e.a] = s[e.b] = 1; return s; }, (function () { var o = {}; o[i] = 1; return o; })()); }

    function draw(t) {
      var dk = dark.matches, focus = sel >= 0 ? sel : hot, on = lit(focus);
      ctx.clearRect(0, 0, W, H);
      var P = nodes.map(function (p, i) {
        var q = px(p);
        if (!still && !p.pinned) { q[0] += Math.sin(t * 0.0004 + p.ph) * 1.6; q[1] += Math.cos(t * 0.00035 + p.ph) * 1.6; }
        return q;
      });
      var ink = dk ? '#cfd3d8' : '#3b4048';
      links.forEach(function (e) {
        var hid = info[e.a].li.hidden || info[e.b].li.hidden;
        if (hid) return;
        var touch = focus >= 0 && (e.a === focus || e.b === focus);
        ctx.globalAlpha = on ? (touch ? 0.85 : 0.06) : 0.18 + e.w * 0.6;
        ctx.strokeStyle = touch ? (dk ? info[focus].d : info[focus].l) : ink;
        ctx.lineWidth = touch ? 1.8 : 1;
        ctx.setLineDash(e.weak ? [3, 4] : []);   // a weak tie: the best it has, under the floor
        ctx.beginPath(); ctx.moveTo(P[e.a][0], P[e.a][1]); ctx.lineTo(P[e.b][0], P[e.b][1]); ctx.stroke();
      });
      ctx.setLineDash([]);
      for (var i = 0; i < nodes.length; i++) {
        var c = dk ? info[i].d : info[i].l, r = radius(i), dim = info[i].li.hidden ? 0.08 : (on && !on[i] ? 0.22 : 1);
        if (info[i].special && !info[i].li.hidden) {        // mark it, do not just enlarge it
          var rp = px(nodes[i]);
          ctx.globalAlpha = dim; ctx.strokeStyle = c; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(rp[0], rp[1], r + 3.5, 0, 6.2832); ctx.stroke();
        }
        var pulse = still ? 0 : Math.sin(t * 0.0012 + nodes[i].ph) * 0.5;
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.16 * dim;
        ctx.beginPath(); ctx.arc(P[i][0], P[i][1], r * 2.6 + pulse * 2 + (i === focus ? 5 : 0), 0, 6.2832); ctx.fill();
        ctx.globalAlpha = dim;
        ctx.beginPath(); ctx.arc(P[i][0], P[i][1], r + pulse * 0.4 + (i === focus ? 2 : 0), 0, 6.2832); ctx.fill();
        if (i === focus) {
          ctx.lineWidth = 2; ctx.strokeStyle = dk ? '#eceae4' : '#15171a';
          ctx.beginPath(); ctx.arc(P[i][0], P[i][1], r + 5, 0, 6.2832); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      place(focus, P);
    }

    // The tooltip names the site and what ties it to its neighbours.
    var tipFor = -1;
    function place(i, P) {
      if (!tip) return;
      if (i < 0) { if (!tip.hidden) tip.hidden = true; tipFor = -1; return; }
      if (tipFor !== i) {
        tipFor = i;
        var ties = nbr[i].map(function (e) {
          var o = e.a === i ? e.b : e.a;
          return '<li><b>' + esc(info[o].title) + '</b>' + (e.words.length ? ' <span>' + esc(e.words.join(' · ')) + '</span>' : '') + '</li>';
        }).join('');
        tip.innerHTML = '<strong>' + esc(info[i].title) + '</strong>' +
          (ties ? '<ul>' + ties + '</ul>' : '<p>No close neighbour — a one-off.</p>') +
          '<em>' + (sel === i ? 'Tap again to open &rarr;' : 'Click to open &rarr;') + '</em>';
        tip.hidden = false;
      }
      var x = P[i][0], y = P[i][1], tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = Math.min(W - tw - 8, Math.max(8, x - tw / 2));
      var top = y - th - 18 < 6 ? y + 18 : y - th - 18;
      tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    function mark(i) {
      cards.forEach(function (li, k) { li.classList.toggle('lit', k === i); });
    }

    // --- the loop: simulate while anything moves, idle otherwise -----------------
    var raf = 0, visible = true, rest = 0;
    function frame(t) {
      raf = 0;
      var ke = still && !drag ? 0 : step(nodes, links);
      if (drag || ke > 1e-7) rest = 0; else rest++;
      draw(t);
      if (visible && (!still || drag || rest < 2)) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf && visible) raf = requestAnimationFrame(frame); }

    function local(ev) { var r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
    cv.addEventListener('pointermove', function (ev) {
      var xy = local(ev); ptr = xy;
      if (drag) {
        var u = unit(xy[0], xy[1]);
        if (Math.hypot(xy[0] - drag.sx, xy[1] - drag.sy) > 4) moved = true;
        drag.node.x = Math.min(0.97, Math.max(0.03, u[0]));
        drag.node.y = Math.min(0.97, Math.max(0.03, u[1]));
        kick(); return;
      }
      if (ev.pointerType === 'touch') return;
      var h = at(xy[0], xy[1]);
      if (h !== hot) { hot = h; mark(h); cv.style.cursor = h >= 0 ? 'pointer' : ''; kick(); }
    });
    cv.addEventListener('pointerdown', function (ev) {
      var xy = local(ev), i = at(xy[0], xy[1]);
      moved = false;
      if (i < 0) { if (sel >= 0) { sel = -1; mark(-1); kick(); } return; }
      drag = { node: nodes[i], i: i, sx: xy[0], sy: xy[1], touch: ev.pointerType === 'touch' };
      nodes[i].pinned = true;
      cv.setPointerCapture(ev.pointerId);
      kick();
    });
    function release(ev, cancelled) {
      if (!drag) return;
      var d = drag; drag = null; d.node.pinned = false; kick();
      if (cancelled || moved) return;
      if (d.touch && sel !== d.i) { sel = d.i; mark(d.i); kick(); return; }   // first tap selects
      if (info[d.i].href) location.href = info[d.i].href;
    }
    cv.addEventListener('pointerup', function (ev) { release(ev, false); });
    cv.addEventListener('pointercancel', function (ev) { release(ev, true); });
    cv.addEventListener('pointerleave', function () { if (!drag && hot >= 0) { hot = -1; mark(-1); cv.style.cursor = ''; kick(); } });

    // A card under the pointer lights its node.
    cards.forEach(function (li, i) {
      li.addEventListener('pointerenter', function () { if (!drag) { hot = i; kick(); } });
      li.addEventListener('pointerleave', function () { if (hot === i) { hot = -1; kick(); } });
    });
    // Find a site hides cards; redraw so their nodes fade.
    var q = document.getElementById('find-q');
    if (q) q.addEventListener('input', function () { setTimeout(kick, 0); });

    size(); draw(0); kick();
    // Two conditions, kept apart: a tab coming back must not restart a graph scrolled away.
    var inView = true;
    function seen() { visible = inView && !document.hidden; if (visible) kick(); }
    if ('IntersectionObserver' in window) new IntersectionObserver(function (e) { inView = e[0].isIntersecting; seen(); }).observe(cv);
    document.addEventListener('visibilitychange', seen);
    addEventListener('resize', function () { size(); tipFor = -1; kick(); });
    if (dark.addEventListener) dark.addEventListener('change', kick);
    fig.classList.add('live');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);

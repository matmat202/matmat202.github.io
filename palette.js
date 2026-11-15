/* The command palette: ⌘K / Ctrl+K / "/" anywhere on the hub opens one box that reaches
   everything — every site on the shelf, every section, each simulation, email, résumé.

   The user, 2026-11-14: "make all of the website in general more interactive and
   impressive from a software engineering standpoint." A palette is the interface
   engineers already live in (editors, Linear, GitHub), and it earns its place here:
   with 33 sites the shelf is long, and a phone visitor gets the same list from the
   button in the top bar.

   Ranking is a small fuzzy matcher: the query's letters must appear in order; a match
   scores higher at the start of a word, in a run of consecutive letters, and in the
   title rather than the description. Ties keep the palette's own order. Up/Down move,
   Enter runs, Escape closes, and focus goes back to where it came from.

   Every command also exists as an ordinary link or button on the page, so this is an
   accelerator, never the only way to anything.

   Plain script with the logic exported for node, like find.js. */
(function (root) {
  'use strict';

  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  // Score `text` against `q`: null unless every letter of q, in order, either STARTS a
  // word of text or directly follows the letter matched before it. So "sdm" is Stanford
  // Dining Menus and "tide" is Tide Table, but "orb" is not "Stanford Roots ... born" —
  // the first version took any letters in order and filled the list with such noise.
  // A continued run is preferred to a jump; a jump goes to the next word start.
  // Returns {score, hits} with the matched character indices (for highlighting).
  function fuzzy(text, q) {
    var t = fold(text), s = fold(q).replace(/\s+/g, '');
    if (!s) return { score: 0, hits: [] };
    var hits = [], score = 0, run = 0, prev = -1;
    function starts(k) { return k === 0 || /[^a-z0-9]/.test(t[k - 1]); }
    for (var qi = 0; qi < s.length; qi++) {
      var c = s[qi], found = -1;
      if (prev >= 0 && t[prev + 1] === c) found = prev + 1;
      else for (var k = prev + 1; k < t.length; k++) if (t[k] === c && starts(k)) { found = k; break; }
      if (found < 0) return null;
      run = found === prev + 1 && prev >= 0 ? run + 1 : 0;
      score += 1 + (starts(found) ? 6 : 0) + run * 5 - (found === 0 ? 0 : Math.min(found, 40) * 0.02);
      hits.push(found); prev = found;
    }
    return { score: score, hits: hits };
  }

  // Rank commands [{title, hint}] for q. Returns [{i, score, hits}] best first; the
  // title counts fully, the hint at half weight.
  function rank(cmds, q) {
    var out = [];
    // An empty query needs no case of its own: fuzzy() scores every title 0 for it.
    cmds.forEach(function (c, i) {
      var a = fuzzy(c.title, q), b = c.hint ? fuzzy(c.hint, q) : null;
      if (!a && !b) return;
      var sa = a ? a.score : -Infinity, sb = b ? b.score / 2 : -Infinity;
      out.push({ i: i, score: Math.max(sa, sb), hits: sa >= sb && a ? a.hits : [] });
    });
    // Array.prototype.sort is stable (ES2019), so equal scores keep the palette's order.
    return out.sort(function (x, y) { return y.score - x.score; });
  }

  var api = { fold: fold, fuzzy: fuzzy, rank: rank };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HubPalette = api;

  if (typeof document === 'undefined') return;

  function boot() {
    var dlg = document.getElementById('palette'), input = document.getElementById('pal-q'),
        list = document.getElementById('pal-list'), opener = document.getElementById('pal-open');
    if (!dlg || !input || !list || typeof dlg.showModal !== 'function') return;

    // --- the commands: read off the page, so they cannot drift from it -------------
    var cmds = [];
    function add(kind, title, hint, run) { cmds.push({ kind: kind, title: title, hint: hint || '', run: run }); }
    function go(href) { return function () { location.href = href; }; }
    function to(id, then) {
      return function () {
        var el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        if (then) then();
      };
    }
    [].forEach.call(document.querySelectorAll('#sims [role="tab"]'), function (b) {
      add('Simulation', b.textContent.trim(), (document.querySelector('[data-for="' + b.dataset.sim + '"] h3') || {}).textContent,
          to('sims', function () { b.click(); }));
    });
    add('Section', 'Simulations', 'physics you can touch', to('sims'));
    add('Section', 'The work', 'every published site', to('work'));
    add('Section', 'Contact', 'say hello', to('contact'));
    var mail = document.querySelector('.contact a[href^="mailto:"]');
    if (mail) add('Contact', 'Email Mateo', mail.getAttribute('href').slice(7), go(mail.getAttribute('href')));
    [].forEach.call(document.querySelectorAll('.hero .links a'), function (a) {
      var t = a.textContent.trim();
      if (/^email$/i.test(t)) return;
      add('Link', t, a.getAttribute('href').replace(/^https?:\/\//, ''), go(a.getAttribute('href')));
    });
    var how = document.querySelector('a[href="how.html"]');
    if (how) add('Page', 'How these were made', 'the autonomous sandbox behind this page', go('how.html'));
    [].forEach.call(document.querySelectorAll('.shelf .site'), function (li) {
      var a = li.querySelector('a.hit');
      if (!a) return;
      add('Site', (li.querySelector('h2') || {}).textContent || '', (li.querySelector('.blurb') || {}).textContent, go(a.getAttribute('href')));
    });

    // --- rendering -------------------------------------------------------------------
    var shown = [], at = 0, back = null;
    function mark(text, hits) {
      var set = {}, out = '';
      hits.forEach(function (h) { set[h] = 1; });
      for (var i = 0; i < text.length; i++) {
        var ch = text[i].replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
        out += set[i] ? '<mark>' + ch + '</mark>' : ch;
      }
      return out;
    }
    function render() {
      shown = rank(cmds, input.value);   // no cap: a slice(0, 40) hid 4 of the 44 commands
      at = Math.min(at, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map(function (r, k) {
        var c = cmds[r.i];
        return '<li role="option" id="pal-' + k + '" aria-selected="' + (k === at) + '" data-k="' + k + '">' +
          '<span class="pk">' + c.kind + '</span><span class="pt">' + mark(c.title, r.hits) + '</span>' +
          (c.hint ? '<span class="ph">' + mark(c.hint, []) + '</span>' : '') + '</li>';
      }).join('') : '<li class="none">Nothing matches &ldquo;' + mark(input.value, []) + '&rdquo;.</li>';
      input.setAttribute('aria-activedescendant', shown.length ? 'pal-' + at : '');
      var cur = document.getElementById('pal-' + at);
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    function move(d) {
      if (!shown.length) return;
      at = (at + d + shown.length) % shown.length;
      [].forEach.call(list.children, function (li, k) { li.setAttribute('aria-selected', k === at); });
      input.setAttribute('aria-activedescendant', 'pal-' + at);
      var cur = document.getElementById('pal-' + at);
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
    }
    function run(k) {
      var r = shown[k];
      if (!r) return;
      close(false);
      cmds[r.i].run();
    }
    function open() {
      if (dlg.open) return;
      back = document.activeElement;
      input.value = ''; at = 0; render();
      dlg.showModal(); input.focus();
    }
    function close(restore) {
      if (!dlg.open) return;
      dlg.close();
      if (restore !== false && back && back.focus) back.focus();
    }

    input.addEventListener('input', function () { at = 0; render(); });
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); move(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); move(-1); }
      else if (ev.key === 'Enter') { ev.preventDefault(); run(at); }
    });
    list.addEventListener('click', function (ev) {
      var li = ev.target.closest && ev.target.closest('li[data-k]');
      if (li) run(+li.dataset.k);
    });
    list.addEventListener('pointermove', function (ev) {
      var li = ev.target.closest && ev.target.closest('li[data-k]');
      if (li && +li.dataset.k !== at) move(+li.dataset.k - at);
    });
    dlg.addEventListener('click', function (ev) { if (ev.target === dlg) close(); });   // the backdrop
    dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); close(); });
    if (opener) { opener.hidden = false; opener.addEventListener('click', open); }

    document.addEventListener('keydown', function (ev) {
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((ev.target || {}).tagName || '') || (ev.target || {}).isContentEditable;
      if ((ev.key === 'k' || ev.key === 'K') && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); dlg.open ? close() : open(); }
      else if (ev.key === '/' && !typing && !dlg.open) { ev.preventDefault(); open(); }
    });

    // --- scroll-spy: the top bar shows which section you are in ----------------------
    var nav = [].slice.call(document.querySelectorAll('.bar nav a[href^="#"]'));
    if ('IntersectionObserver' in window && nav.length) {
      var vis = {};
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { vis[e.target.id] = e.isIntersecting; });
        var cur = null;
        nav.forEach(function (a) { var id = a.getAttribute('href').slice(1); if (!cur && vis[id]) cur = a; });
        nav.forEach(function (a) { if (a === cur) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); });
      }, { rootMargin: '-45% 0px -50% 0px' });
      nav.forEach(function (a) { var el = document.getElementById(a.getAttribute('href').slice(1)); if (el) io.observe(el); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(typeof self !== 'undefined' ? self : this);

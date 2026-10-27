/* Today's daily games, on the hub.

   Every site serves from matmat202.github.io, so the hub shares one localStorage with all
   of them and can read what each game already saved — nothing new is stored, and nothing
   leaves the browser. What each game keeps, read from its own app.js on 2026-10-27:

     which-first / which-country / further-north / which-read-more
         '<p>:<day>'  the picks made so far (an array; 10 is a finished ten)
         '<p>:days'   the days finished, for the streak
     stanford-outlines
         'outlines.v1' {days: {<day>: {n: answers, c: chosen or null}}}

   The games do not agree on what "today" is, and the hub has to use each one's own
   answer or it reports a finished game as unplayed:
     local calendar date  — which-first, which-country, further-north
     campus date (Pacific) — stanford-outlines
     yesterday in UTC     — which-read-more, whose ten is the last day Wikimedia has
                            published. For a few hours after UTC midnight the game falls
                            back one more day; the hub does NOT follow it there, because
                            accepting that day would show yesterday's finished ten as
                            "played today" all day long. A short false "not yet" beats a
                            day-long false "done".

   Plain script, no modules: the hub page is generated and this file is the one piece of
   it with behaviour, so it must load from a bare <script src> and from node's require. */
(function (root) {
  'use strict';

  var GAMES = [
    { repo: 'stanford-outlines', kind: 'outlines', key: 'outlines.v1', day: 'campus' },
    { repo: 'which-first', kind: 'picks', prefix: 'wf:', day: 'local' },
    { repo: 'which-country', kind: 'picks', prefix: 'wc:', day: 'local' },
    { repo: 'further-north', kind: 'picks', prefix: 'fn:', day: 'local' },
    { repo: 'which-read-more', kind: 'picks', prefix: 'wrm:', day: 'utc-1' },
  ];
  var ROUNDS = 10;

  function pad(x) { return String(x).padStart(2, '0'); }

  // Calendar arithmetic on 'YYYY-MM-DD' strings, done in UTC so a DST night cannot
  // make a day 23 hours long and skip it.
  function shift(ymd, n) {
    var t = Date.parse(ymd + 'T12:00:00Z') + n * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  // The day key(s) a game would be on at `now`, newest first.
  function daysFor(game, now) {
    if (game.day === 'local') {
      return [now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())];
    }
    if (game.day === 'campus') {
      return [new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now)];
    }
    return [new Date(now.getTime() - 86400000).toISOString().slice(0, 10)];
  }

  // Consecutive finished days ending at `today`, or at the day before while today is
  // still open — the same rule every game uses for its own streak line.
  function streak(done, today) {
    var have = {};
    done.forEach(function (d) { have[d] = true; });
    var d = have[today] ? today : shift(today, -1);
    var n = 0;
    while (have[d]) { n++; d = shift(d, -1); }
    return n;
  }

  function parse(raw) {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // One game's state from a getItem-shaped reader. Junk in storage reads as unplayed,
  // never as a throw: one game's bad record must not blank the other four.
  function statusOf(game, get, now) {
    var days = daysFor(game, now);
    var out = { repo: game.repo, state: 'none', played: 0, of: ROUNDS, right: null, streak: 0 };
    var finished = [];
    var entries = {};
    if (game.kind === 'outlines') {
      var h = parse(get(game.key));
      var all = h && h.days && typeof h.days === 'object' ? h.days : {};
      Object.keys(all).forEach(function (d) {
        var e = all[d];
        if (!e || !Array.isArray(e.c) || !Array.isArray(e.n) || !e.c.length) return;
        var played = e.c.filter(function (x) { return x != null; }).length;
        var right = e.c.filter(function (x, i) { return x != null && x === e.n[i]; }).length;
        entries[d] = { played: played, of: e.c.length, right: right };
        if (played === e.c.length) finished.push(d);
      });
    } else {
      var list = parse(get(game.prefix + 'days'));
      if (Array.isArray(list)) finished = list.filter(function (d) { return typeof d === 'string'; });
      days.forEach(function (d) {
        var picks = parse(get(game.prefix + d));
        if (Array.isArray(picks) && picks.length) {
          entries[d] = { played: Math.min(picks.length, ROUNDS), of: ROUNDS, right: null };
        }
      });
    }
    // The newest of the candidate days that has anything on it is the one being played.
    var day = days[0];
    for (var i = 0; i < days.length; i++) {
      if (entries[days[i]] || finished.indexOf(days[i]) >= 0) { day = days[i]; break; }
    }
    var e = entries[day];
    var isDone = finished.indexOf(day) >= 0 || (e && e.played >= e.of);
    if (e) { out.played = e.played; out.of = e.of; out.right = e.right; }
    if (isDone) { out.state = 'done'; out.played = out.of; } else if (e && e.played > 0) out.state = 'part';
    out.streak = streak(finished, day);
    return out;
  }

  function label(s) {
    var head = s.state === 'done' ? 'Played today' + (s.right != null ? ' · ' + s.right + '/' + s.of : '')
      : s.state === 'part' ? 'Today: ' + s.played + ' of ' + s.of + ' played'
      : 'Today’s ten: not played yet';
    var tail = '';
    if (s.streak > 0) {
      tail = s.state === 'done' ? ' · ' + s.streak + '-day streak'
        : ' · ' + s.streak + '-day streak on the line';
    }
    return head + tail;
  }

  function summary(list) {
    var done = list.filter(function (s) { return s.state === 'done'; }).length;
    return done === list.length && list.length
      ? 'All ' + list.length + ' daily games played today.'
      : 'Daily games: ' + done + ' of ' + list.length + ' played today.';
  }

  // Badge each daily game's card and put one line under the heading. Only games whose
  // card is on the page count, so a site taken down does not leave "1 of 5" unreachable.
  function decorate(doc, get, now) {
    var shown = [];
    GAMES.forEach(function (g) {
      var a = doc.querySelector('a.hit[href$="/' + g.repo + '/"]');
      if (!a) return;
      var s = statusOf(g, get, now);
      shown.push(s);
      var p = doc.createElement('p');
      p.className = 'today';
      p.dataset.state = s.state;
      p.textContent = label(s);
      var where = a.querySelector('.where');
      a.insertBefore(p, where || null);
    });
    if (!shown.length) return shown;
    var sum = doc.createElement('p');
    sum.className = 'today-sum';
    sum.textContent = summary(shown);
    var sub = doc.querySelector('header .sub');
    if (sub) sub.after(sum);
    return shown;
  }

  var api = { GAMES: GAMES, daysFor: daysFor, shift: shift, streak: streak, statusOf: statusOf,
    label: label, summary: summary, decorate: decorate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    root.Dailies = api;
    var run = function () {
      var get = function (k) { try { return root.localStorage.getItem(k); } catch (e) { return null; } };
      decorate(root.document, get, new Date());
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run);
    else run();
  }
})(typeof window !== 'undefined' ? window : this);

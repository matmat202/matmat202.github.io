/* Today on campus, on the hub: three facts the other sites already know, read live.

   The point of the hub owning this is that every site serves from matmat202.github.io, so
   it can read their published data with no copy of its own:

     dinner specials  /stanford-dining-menus/data/specials.json   same origin
                      /stanford-dining-menus/data/site.json       hall ids -> names
     next tide        NOAA CO-OPS, the API tide-table itself calls (CORS *)
     sunset           /daylight/sun-logic.js, imported as daylight's own module

   Each line links to the site that answers it in full. A line whose source fails is
   dropped rather than shown stale or guessed: specials.json covers a two-week PDF, so on
   a day outside it the honest answer is "none listed", not the nearest day's.

   Campus clock throughout (America/Los_Angeles): a visitor in New York at 11 pm is asking
   about Stanford's evening, not their own tomorrow.

   Plain script with the logic exported for node, like dailies.js. */
(function (root) {
  'use strict';

  var TZ = 'America/Los_Angeles';
  var CAMPUS = { lat: 37.4275, lon: -122.1697, tz: TZ };
  // Palo Alto Yacht Harbor: the nearest prediction station to campus (subordinate, so
  // high/low only, which is all this line uses).
  var STATION = { id: '9414525', name: 'Palo Alto Yacht Harbor' };

  function parts(now) {
    var o = {};
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  // 'YYYY-MM-DD' on campus.
  function campusDay(now) { var p = parts(now); return p.year + '-' + p.month + '-' + p.day; }
  // 'YYYY-MM-DD HH:MM' on campus: the shape NOAA's lst_ldt predictions use, so the two
  // compare as strings with no instant conversion (NOAA has done the DST work already).
  function campusWall(now) { var p = parts(now); return campusDay(now) + ' ' + p.hour + ':' + p.minute; }

  function clock(hhmm) {
    var h = +hhmm.slice(0, 2), m = hhmm.slice(3, 5);
    return (h % 12 || 12) + ':' + m + (h < 12 ? ' am' : ' pm');
  }

  // Whose dinner the line is about: today's until the last hall's dinner ends (20:30 on
  // weekdays, per site.json's hours), tomorrow's after 21:00. At 10 pm tonight's
  // special is a menu nobody can still eat.
  var DINNER_OVER = 21;
  function dinnerDay(now) {
    var day = campusDay(now);
    if (+parts(now).hour < DINNER_OVER) return { day: day, tomorrow: false };
    var t = new Date(Date.parse(day + 'T12:00:00Z') + 86400000);
    return { day: t.toISOString().slice(0, 10), tomorrow: true };
  }

  // The dinner specials for `day` as [{hall, text, event}], hall named as the dining site
  // names it. null when the day is outside every source's date range (unknown, not "none").
  function specialsOn(specials, site, day) {
    var covered = (specials.sources || []).some(function (s) { return s.from <= day && day <= s.to; });
    if (!covered) return null;
    var names = {};
    ((site && site.halls) || []).forEach(function (h) { names[h.id] = h.name; });
    return (specials.specials || [])
      .filter(function (s) { return s.date === day; })
      .map(function (s) { return { hall: names[s.hall] || s.hall, text: s.text, event: !!s.event }; })
      .sort(function (a, b) { return a.hall < b.hall ? -1 : a.hall > b.hall ? 1 : 0; });
  }

  // The first high or low strictly after now, from NOAA's {predictions:[{t,v,type}]}.
  function nextTide(noaa, now) {
    var wall = campusWall(now);
    var ps = (noaa && noaa.predictions) || [];
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].t > wall) {
        return {
          high: ps[i].type === 'H', feet: +ps[i].v,
          time: clock(ps[i].t.slice(11, 16)), today: ps[i].t.slice(0, 10) === wall.slice(0, 10),
        };
      }
    }
    return null;
  }
  function tideLabel(t) {
    return (t.high ? 'High' : 'Low') + ' tide ' + (t.today ? '' : 'tomorrow ') + t.time +
      ', ' + t.feet.toFixed(1) + ' ft';
  }

  // Sunset if it is still ahead today, else tomorrow's sunrise. `sunOn` is daylight's.
  function sunNext(sunOn, now) {
    var d = campusDay(now).split('-').map(Number);
    var s = sunOn(d, CAMPUS);
    if (s.set != null && now.getTime() < s.set) return { kind: 'Sunset', at: s.set };
    var t = new Date(Date.UTC(d[0], d[1] - 1, d[2] + 1));
    var n = sunOn([t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()], CAMPUS);
    return n.rise == null ? null : { kind: 'Sunrise tomorrow', at: n.rise };
  }
  function sunLabel(s) { return s.kind + ' ' + clock(campusWall(new Date(s.at)).slice(11, 16)); }

  function noaaUrl(now) {
    return 'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?' + new URLSearchParams({
      product: 'predictions', application: 'matmat202-hub', station: STATION.id,
      datum: 'MLLW', interval: 'hilo', units: 'english', time_zone: 'lst_ldt', format: 'json',
      begin_date: campusDay(now).replace(/-/g, ''), range: '48',
    });
  }

  var API = {
    STATION: STATION, CAMPUS: CAMPUS, campusDay: campusDay, campusWall: campusWall, clock: clock,
    dinnerDay: dinnerDay, specialsOn: specialsOn, nextTide: nextTide, tideLabel: tideLabel,
    sunNext: sunNext, sunLabel: sunLabel, noaaUrl: noaaUrl,
  };
  if (typeof module === 'object' && module.exports) { module.exports = API; return; }
  root.HubToday = API;

  // ---- the page ------------------------------------------------------------------
  var box = document.getElementById('today');
  if (!box) return;
  var now = new Date();
  function json(u) { return fetch(u).then(function (r) { if (!r.ok) throw r.status; return r.json(); }); }
  function row(id, href, html) {
    var li = document.getElementById(id);
    li.querySelector('a').href = href;
    li.querySelector('.v').innerHTML = html;
    li.hidden = false;
    box.hidden = false;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  Promise.all([json('/stanford-dining-menus/data/specials.json'), json('/stanford-dining-menus/data/site.json')])
    .then(function (r) {
      var dd = dinnerDay(now), sp = specialsOn(r[0], r[1], dd.day);
      if (sp == null) return;
      var when = dd.tomorrow ? 'tomorrow' : 'today';
      row('t-dinner', '/stanford-dining-menus/', sp.length
        ? (dd.tomorrow ? '<span class="at">Tomorrow</span>' : '') +
          '<ul>' + sp.map(function (s) { return '<li><b>' + esc(s.hall) + '</b> ' + esc(s.text) + '</li>'; }).join('') + '</ul>'
        : 'No specials listed for ' + when);
    }).catch(function () {});

  json(noaaUrl(now)).then(function (r) {
    var t = nextTide(r, now);
    if (t) row('t-tide', '/tide-table/', esc(tideLabel(t)) + ' <span class="at">at ' + STATION.name + '</span>');
  }).catch(function () {});

  import('/daylight/sun-logic.js').then(function (m) {
    var s = sunNext(m.sunOn, now);
    if (s) row('t-sun', '/daylight/', esc(sunLabel(s)) + ' <span class="at">on campus</span>');
  }).catch(function () {});
})(this);

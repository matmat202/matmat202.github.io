/* Find a site, on the hub: a filter over the shelf.

   With 33 cards in one alphabetical column, a phone visitor looking for the tide table
   or the parking finder scrolls about ten screens. Typing "tide" should leave one card.

   What a query matches: the card's title, its blurb and its address, folded the same way
   on both sides (case, accents and Spanish ¿¡ dropped), so "cual" finds "¿Cuál se filtró
   más?" and "DINING" finds the menus. Every word of the query must appear somewhere on the
   card: "stanford roots" is one card, not every Stanford one. The daily-game badges are
   not matched — "played" is state, not what a site is.

   The query lives in the address as ?q=, so a filtered shelf is a link worth sending
   ("everything Stanford": /?q=stanford). Escape clears it. Without JavaScript the box
   stays hidden and the whole shelf shows, which is what the page was before.

   Plain script with the logic exported for node, like dailies.js and today.js. */
(function (root) {
  'use strict';

  // Lower case, accents off, anything that is not a letter or digit becomes a space.
  function fold(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function words(q) { var f = fold(q); return f ? f.split(' ') : []; }

  // Does a card whose text is `hay` answer the query? An empty query matches everything.
  function matches(hay, q) {
    var h = ' ' + fold(hay) + ' ', ws = words(q);
    for (var i = 0; i < ws.length; i++) if (h.indexOf(ws[i]) < 0) return false;
    return true;
  }

  // The indices of `cards` (an array of strings) that the query keeps, in shelf order.
  function keep(cards, q) {
    var out = [];
    for (var i = 0; i < cards.length; i++) if (matches(cards[i], q)) out.push(i);
    return out;
  }

  // The line under the box. '' when nothing is typed: the count above already says it.
  function status(shown, total, q) {
    if (!words(q).length) return '';
    if (!shown) return 'No site matches \u201c' + String(q).trim() + '\u201d.';
    return shown === total ? 'All ' + total + ' sites match.'
      : shown + ' of ' + total + (total === 1 ? ' site' : ' sites');
  }

  var API = { fold: fold, words: words, matches: matches, keep: keep, status: status };
  if (typeof module === 'object' && module.exports) { module.exports = API; return; }
  root.HubFind = API;

  // ---- the page ------------------------------------------------------------------
  var form = document.getElementById('find');
  if (!form) return;
  var box = form.querySelector('input'), say = document.getElementById('find-status');
  var lis = [].slice.call(document.querySelectorAll('.shelf .site'));
  var texts = lis.map(function (li) {
    return [].map.call(li.querySelectorAll('h2, .blurb, .host'), function (e) { return e.textContent; }).join(' ');
  });

  function apply(push) {
    var q = box.value, kept = keep(texts, q), on = {};
    kept.forEach(function (i) { on[i] = true; });
    lis.forEach(function (li, i) { li.hidden = !on[i]; });
    say.textContent = status(kept.length, lis.length, q);
    if (push) {
      var u = new URL(location.href);
      if (words(q).length) u.searchParams.set('q', q.trim()); else u.searchParams.delete('q');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
  }

  box.value = new URLSearchParams(location.search).get('q') || '';
  form.hidden = false;
  apply(false);
  box.addEventListener('input', function () { apply(true); });
  box.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && box.value) { box.value = ''; apply(true); }
  });
  // Enter on a phone keyboard: put the keyboard away and land on the first match.
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    box.blur();
    var first = lis.filter(function (li) { return !li.hidden; })[0];
    if (first) first.scrollIntoView({ block: 'start' });
  });
})(this);

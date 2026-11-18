/* niel-trains logic. Pure functions: no page code and no network code.
   The page uses it as window.CFLogic. The tests use it with require(). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CFLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GYM_MIN_ID = 100000;               // gym contests have ids from 100000
  const CONTEST_TYPES = { CONTESTANT: 1, OUT_OF_COMPETITION: 1, VIRTUAL: 1 };
  const IGNORED_TAGS = { '*special': 1 };
  const MIN_RATING = 800, MAX_RATING = 3500;
  const DAY = 86400;
  const RESOLVE_DAYS = { spoiled: 7, parked: 30 };
  const MIN_FREQ = 0.03;                   // a topic is "common" from 3% of problems near your level
  const CODE_PREFIX = 'cfcoach1:';          // the first name of the site. It stays, so that old codes work.
  const REL_NONE = 2000000000;
  const WINS_TO_PASS = 2;                  // duel wins that pass a checkpoint
  const OFFICIAL = { CONTESTANT: 1, OUT_OF_COMPETITION: 1 };
  const VIRTUAL = { VIRTUAL: 1 };

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const roundLevel = level => clamp(Math.round(level / 100) * 100, MIN_RATING, MAX_RATING);
  const targetRating = (level, delta) => clamp(Math.round((level + delta) / 100) * 100, MIN_RATING, MAX_RATING);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

  // ------------------------------------------------------------------ data

  function makeProblem(cid, idx, name, rating, tags) {
    return { cid: cid, idx: String(idx), name: name || '', rating: rating || null,
             tags: (tags || []).map(t => String(t).toLowerCase()), key: cid + String(idx) };
  }

  function problemFromApi(d) {
    if (!d || d.contestId == null || d.contestId >= GYM_MIN_ID || d.index == null) return null;
    return makeProblem(d.contestId, d.index, d.name, d.rating, d.tags);
  }

  function submissionFromApi(d) {
    const p = problemFromApi(d && d.problem);
    if (!p) return null;
    const time = d.creationTimeSeconds || 0, a = d.author || {};
    // rel: seconds from the start of the contest. Codeforces gives a very large number outside a contest.
    const rel = d.relativeTimeSeconds != null && d.relativeTimeSeconds < REL_NONE ? d.relativeTimeSeconds : null;
    return { id: d.id, key: p.key, p: p, ok: d.verdict === 'OK', time: time, ptype: a.participantType || 'PRACTICE',
             rel: rel, start: a.startTimeSeconds || (rel == null ? 0 : time - rel),
             verdict: d.verdict || '', passed: d.passedTestCount || 0 };
  }

  // Accepts "1277B", "1277 b", "1277/B1" or a Codeforces problem link.
  function parseProblemId(text) {
    let t = String(text || '').trim();
    t = t.replace(/^https?:\/\/([a-z0-9-]+\.)?codeforces\.(com|net)\//i, '');
    t = t.replace('problemset/problem/', '').replace('contest/', '');
    const m = /(\d{1,6})\s*(?:\/problem\/|\/)?\s*([A-Za-z][0-9]?)(?![A-Za-z0-9])/.exec(t);
    return m ? { cid: Number(m[1]), idx: m[2].toUpperCase() } : null;
  }

  // ------------------------------------------------------------ user history

  const solvedKeys = subs => new Set(subs.filter(s => s.ok).map(s => s.key));
  const attemptedKeys = subs => new Set(subs.map(s => s.key));

  function firstOkAfter(subs, key, after) {
    let best = null;
    for (const s of subs) {
      if (s.ok && s.key === key && s.time >= after && (!best || s.time < best.time)) best = s;
    }
    return best;
  }

  // -------------------------------------------------------- problem choice

  // include: the problem has at least one of these topics (empty = any topic).
  // exclude: the problem has none of these topics.
  function matches(p, include, exclude, requireTag) {
    let hasIncluded = !include || include.size === 0;
    for (const t of p.tags) {
      if (IGNORED_TAGS[t]) return false;
      if (exclude && exclude.has(t)) return false;
      if (!hasIncluded && include.has(t)) hasIncluded = true;
    }
    if (!hasIncluded) return false;
    if (requireTag && p.tags.indexOf(requireTag) < 0) return false;
    return true;
  }

  // Picks an unseen problem at o.rating. If there is none, it tries 100 and 200 away.
  // Newer contests are a little more likely, because very old problems can have odd formats.
  function pickProblem(problems, o) {
    const rnd = o.rnd || Math.random;
    for (const widen of [0, 100, -100, 200, -200]) {
      const r = o.rating + widen;
      if (r < MIN_RATING || r > MAX_RATING) continue;
      const pool = problems.filter(p => p.rating === r &&
        !(o.skipKeys && o.skipKeys.has(p.key)) && !(o.skipNames && o.skipNames.has(p.name)) &&
        matches(p, o.include, o.exclude, o.requireTag));
      if (!pool.length) continue;
      pool.sort((a, b) => a.cid - b.cid);
      const newer = pool.slice(Math.floor(pool.length / 2));
      const from = (newer.length && rnd() < 0.7) ? newer : pool;
      return from[Math.min(from.length - 1, Math.floor(rnd() * from.length))];
    }
    return null;
  }

  // ---------------------------------------------------------- topic report

  /* Input: { problems, subs, results, level, now, windowDays }
     results: { problemKey: 'clean' | 'hint1' | 'hint2' | 'spoiled' } from this site.
     A solve counts as strength if it has no result (solved outside the site) or it is clean.

     For each topic:
       freq    share of problems rated level .. level+300 that have the topic
       common  freq >= 3%. Rare topics (for example graph matchings at 1000) get no weakness score.
       solved  clean solves in the period        recent  solves in the last 30 days
       failed  problems tried and never solved   notClean  solves marked hint or spoiled
       level   the rating where you have 3 or more clean solves at that rating or higher
       band    above | around | below | nodata   (200 or more away from your level)
       score   weakness. Higher = weaker. */
  function topicReport(inp) {
    const problems = inp.problems || [], subs = inp.subs || [], results = inp.results || {};
    const now = inp.now, windowDays = inp.windowDays || 0;
    const minFreq = inp.minFreq == null ? MIN_FREQ : inp.minFreq;
    const lo = roundLevel(inp.level), hi = Math.min(MAX_RATING, lo + 300);

    let bandSize = 0;
    const count = {}, allTags = {};
    for (const p of problems) {
      for (const t of p.tags) if (!IGNORED_TAGS[t]) allTags[t] = 1;
      if (p.rating == null || p.rating < lo || p.rating > hi) continue;
      bandSize++;
      for (const t of new Set(p.tags)) if (!IGNORED_TAGS[t]) count[t] = (count[t] || 0) + 1;
    }

    const byKey = new Map(problems.map(p => [p.key, p]));
    const firstOk = new Map(), tried = new Map();
    for (const s of subs) {
      if (!tried.has(s.key)) tried.set(s.key, byKey.get(s.key) || s.p);
      if (s.ok && (!firstOk.has(s.key) || s.time < firstOk.get(s.key))) firstOk.set(s.key, s.time);
    }

    const winStart = windowDays ? now - windowDays * DAY : -Infinity;
    const recentStart = now - 30 * DAY;
    const acc = {};
    const A = t => acc[t] || (acc[t] = { solvedAll: 0, solvedWin: 0, ratings: [], recent: 0, failed: 0, notClean: 0 });
    let total = 0;
    for (const [key, p] of tried) {
      const tags = p.tags.filter(t => !IGNORED_TAGS[t]);
      for (const t of tags) allTags[t] = 1;
      if (!firstOk.has(key)) { for (const t of tags) A(t).failed++; continue; }
      const when = firstOk.get(key);
      const res = results[key];
      const strength = !res || res === 'clean';
      const inWin = when >= winStart;
      if (strength && inWin) total++;
      for (const t of tags) {
        const a = A(t);
        if (when >= recentStart) a.recent++;
        if (!strength) { a.notClean++; continue; }
        a.solvedAll++;
        if (inWin) { a.solvedWin++; if (p.rating != null) a.ratings.push(p.rating); }
      }
    }

    const zero = { solvedAll: 0, solvedWin: 0, ratings: [], recent: 0, failed: 0, notClean: 0 };
    const topics = Object.keys(allTags).map(tag => {
      const a = acc[tag] || zero;
      const freq = bandSize ? (count[tag] || 0) / bandSize : 0;
      const common = freq >= minFreq;
      const rs = a.ratings.slice().sort((x, y) => y - x);
      const level = rs.length >= 3 ? rs[2] : null;
      const band = level == null ? 'nodata' : level >= lo + 200 ? 'above' : level <= lo - 200 ? 'below' : 'around';
      const cover = (total && freq) ? (a.solvedWin / total) / freq : 0;
      const lack = Math.max(0, 1 - Math.min(cover, 1));
      const attempts = a.solvedAll + a.failed + a.notClean;
      const failRate = attempts >= 3 ? (a.failed + a.notClean) / attempts : 0;
      const gap = level == null ? 0 : clamp((lo - level) / 400, 0, 1);
      const score = common ? lack + 0.5 * failRate + 0.3 * gap : 0;
      return { tag: tag, freq: freq, common: common, solved: a.solvedWin, solvedAll: a.solvedAll,
               recent: a.recent, failed: a.failed, notClean: a.notClean, level: level, band: band, score: score };
    });
    topics.sort((x, y) => (Number(y.common) - Number(x.common)) || (y.score - x.score) ||
                          (y.freq - x.freq) || cmp(x.tag, y.tag));
    return { level: lo, hi: hi, total: total, topics: topics };
  }

  // Weak topics for training. include and exclude are Sets of topic names.
  function weakTags(report, include, exclude, top) {
    top = top || 6;
    const allowed = t => !(exclude && exclude.has(t.tag)) && (!include || !include.size || include.has(t.tag));
    let pool = report.topics.filter(t => t.common && allowed(t));
    // If you include only rare topics, train those.
    if (!pool.length && include && include.size) pool = report.topics.filter(allowed);
    const weak = pool.filter(t => t.score > 0).slice(0, top);
    return weak.length ? weak : pool.slice(0, top);
  }

  function pickWeakTag(weak, rnd) {
    if (!weak.length) return null;
    rnd = rnd || Math.random;
    const weights = weak.map(t => Math.max(t.score, 0.05));
    let x = rnd() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weak.length; i++) { x -= weights[i]; if (x <= 0) return weak[i].tag; }
    return weak[weak.length - 1].tag;
  }

  // The lists for the report card.
  function summary(report, exclude) {
    const withLevel = report.topics.filter(t => t.level != null).sort((a, b) => (b.level - a.level) || cmp(a.tag, b.tag));
    return {
      above: withLevel.filter(t => t.band === 'above'),
      around: withLevel.filter(t => t.band === 'around'),
      below: withLevel.filter(t => t.band === 'below'),
      noRecent: report.topics.filter(t => t.common && t.recent === 0),
      gaps: weakTags(report, null, exclude, 3).filter(t => t.score > 0)
    };
  }

  // --------------------------------------------------------------- upsolve

  /* For each finished contest that you took part in (live or virtual):
     the easiest problem that you did not solve (first: true), and each other
     problem that you tried and did not solve. Newest contest first.
     unfinished: Set of contest ids that are not finished. skip: keys to hide. */
  function upsolveList(subs, problems, unfinished, skip) {
    const solved = solvedKeys(subs);
    const solvedNames = new Set(subs.filter(s => s.ok).map(s => s.p.name));   // Div. 1 / Div. 2 copies
    const lastTime = new Map(), attempted = new Map();
    for (const s of subs) {
      if (!CONTEST_TYPES[s.ptype]) continue;
      const cid = s.p.cid;
      if (unfinished && unfinished.has(cid)) continue;
      lastTime.set(cid, Math.max(lastTime.get(cid) || 0, s.time));
      if (!solved.has(s.key)) attempted.set(s.key, s.p);
    }
    const byContest = new Map();
    for (const p of problems) {
      if (!lastTime.has(p.cid)) continue;
      if (!byContest.has(p.cid)) byContest.set(p.cid, []);
      byContest.get(p.cid).push(p);
    }
    const out = [];
    const cids = Array.from(lastTime.keys()).sort((a, b) => (lastTime.get(b) - lastTime.get(a)) || (b - a));
    for (const cid of cids) {
      const list = (byContest.get(cid) || []).slice();
      for (const [k, p] of attempted) if (p.cid === cid && !list.some(q => q.key === k)) list.push(p);
      list.sort((a, b) => cmp(a.idx, b.idx));
      let first = true;
      for (const p of list) {
        if (solved.has(p.key) || solvedNames.has(p.name)) continue;
        const tried = attempted.has(p.key);
        if ((first || tried) && !(skip && skip.has(p.key))) {
          out.push({ p: p, first: first, attempted: tried, time: lastTime.get(cid) });
        }
        first = false;
      }
    }
    return out;
  }

  // --------------------------------------------------------------- re-solve

  const dueTime = (kind, markedAt) => markedAt + RESOLVE_DAYS[kind] * DAY;

  // ------------------------------------------------------------- sync code

  function encodeState(obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return CODE_PREFIX + btoa(bin);
  }

  function decodeState(code) {
    const bad = new Error('That code is not a niel-trains code. Copy the full code and try again.');
    const text = String(code || '').replace(/\s+/g, '');
    if (text.indexOf(CODE_PREFIX) !== 0) throw bad;
    let obj;
    try {
      const bin = atob(text.slice(CODE_PREFIX.length));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      obj = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) { throw bad; }
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.quests) || !Array.isArray(obj.marks)) throw bad;
    return obj;
  }

  // ---------------------------------------------------------------- log row

  const RESULT_LABEL = { clean: 'clean', hint1: 'hint level 1', hint2: 'hint level 2', spoiled: 'spoiled', parked: 'parked' };

  // One row for a sheet. Tabs between the cells:
  // date | problem | SOLVE | time | result | failure reason | lesson
  function logRow(r) {
    const clean = s => String(s || '').replace(/[\t\r\n]+/g, ' ').trim();
    return [r.date, clean(r.key + ' ' + r.name), 'SOLVE', '', RESULT_LABEL[r.result] || '',
            r.result === 'clean' ? 'none' : '', clean(r.idea)].join('\t');
  }

  // ------------------------------------------------------------------ ranks

  // color: 0 gray, 1 green, 2 cyan, 3 blue, 4 violet, 5 orange, 6 red
  const RANKS = [[1200, 'newbie', 0], [1400, 'pupil', 1], [1600, 'specialist', 2], [1900, 'expert', 3],
                 [2100, 'candidate master', 4], [2300, 'master', 5], [2400, 'international master', 5],
                 [2600, 'grandmaster', 6], [3000, 'international grandmaster', 6], [Infinity, 'legendary grandmaster', 6]];

  function rankOf(rating) {
    if (!rating) return { name: 'unrated', color: 0 };
    for (const r of RANKS) if (rating < r[0]) return { name: r[1], color: r[2] };
    return { name: 'legendary grandmaster', color: 6 };
  }

  // --------------------------------------------------------------- progress

  // Numbers for the banner and for the "progress" command, from your whole history.
  function progress(subs, problems, now) {
    const byKey = new Map(problems.map(p => [p.key, p]));
    const firstOk = new Map(), tried = new Map(), live = new Set(), virtual = new Set();
    for (const s of subs) {
      if (!tried.has(s.key)) tried.set(s.key, byKey.get(s.key) || s.p);
      if (s.ok && (!firstOk.has(s.key) || s.time < firstOk.get(s.key))) firstOk.set(s.key, s.time);
      if (s.ptype === 'CONTESTANT' || s.ptype === 'OUT_OF_COMPETITION') live.add(s.p.cid);
      if (s.ptype === 'VIRTUAL') virtual.add(s.p.cid);
    }
    const buckets = new Map(), solvedN = {}, failedN = {};
    let unrated = 0, recent7 = 0, recent30 = 0, lastOk = 0;
    for (const [key, p] of tried) {
      const tags = p.tags.filter(t => !IGNORED_TAGS[t]);
      if (!firstOk.has(key)) { for (const t of tags) failedN[t] = (failedN[t] || 0) + 1; continue; }
      const when = firstOk.get(key);
      if (when >= now - 7 * DAY) recent7++;
      if (when >= now - 30 * DAY) recent30++;
      if (when > lastOk) lastOk = when;
      if (p.rating == null) unrated++;
      else {
        const lo = Math.floor((p.rating - MIN_RATING) / 200) * 200 + MIN_RATING;      // 800-900, 1000-1100, ...
        buckets.set(lo, (buckets.get(lo) || 0) + 1);
      }
      for (const t of tags) solvedN[t] = (solvedN[t] || 0) + 1;
    }
    const topics = Object.keys(solvedN).map(t => ({ tag: t, n: solvedN[t] })).sort((a, b) => (b.n - a.n) || cmp(a.tag, b.tag));
    // "Harder so far": 4 or more problems tried, and fewer than half of them solved.
    const harder = Object.keys(failedN)
      .map(t => ({ tag: t, solved: solvedN[t] || 0, tried: (solvedN[t] || 0) + failedN[t] }))
      .filter(x => x.tried >= 4 && x.solved * 2 < x.tried)
      .sort((a, b) => (a.solved / a.tried - b.solved / b.tried) || cmp(a.tag, b.tag));
    return { total: firstOk.size, unsolved: tried.size - firstOk.size, unrated: unrated, recent7: recent7, recent30: recent30,
             lastOk: lastOk, contests: live.size, virtuals: virtual.size, topics: topics, harder: harder,
             buckets: Array.from(buckets.keys()).sort((a, b) => a - b).map(lo => ({ lo: lo, hi: lo + 100, n: buckets.get(lo) })) };
  }

  // -------------------------------------------------------------------- UVa

  // "uva 100", "UVa 00100", "uva-100" and "uva100" give 100. A link to the problem PDF also works.
  function parseUva(text) {
    const t = String(text || '').trim();
    const m = /^uva[\s_-]*0*(\d{1,5})$/i.exec(t) || /onlinejudge\.org\/external\/\d+\/p?0*(\d{1,5})\.(?:pdf|html)/i.exec(t);
    const n = m ? Number(m[1]) : 0;
    return n > 0 ? n : null;
  }

  // One problem from uHunt: { pid, num, title, status }. Status 0: the judge does not have the problem now.
  function uvaProblemFromApi(d) {
    if (!d || !d.pid || !d.num) return null;
    return { oj: 'uva', pid: d.pid, num: d.num, name: String(d.title || ''), key: 'uva' + d.num, cid: null, idx: null,
             rating: null, tags: [], open: d.status !== 0 };
  }

  // One submission from uHunt: [id, problem id, verdict, runtime, time, language, rank]. Verdict 90 is Accepted.
  // uHunt gives the problem id, not the problem number, so the key is "uvap" + id.
  function uvaSubFromApi(a) {
    if (!Array.isArray(a) || a.length < 5) return null;
    return { id: a[0], key: 'uvap' + a[1], ok: a[2] === 90, time: a[4] };
  }

  // -------------------------------------------------------------------- CP4

  /* The problems of one category of the book list: the entry-level problem, then the starred problems, then the others.
     Keys: "u100" is UVa 100. "khello" is Kattis hello. "o1.4h/0" is a problem on a different judge. */
  function cp4Items(cat) {
    const items = [];
    for (const n of cat.u) items.push({ key: 'u' + Math.abs(n), kind: 'uva', id: Math.abs(n), star: n < 0 });
    for (const name of cat.k) {
      const star = name[0] === '*', id = star ? name.slice(1) : name;
      items.push({ key: 'k' + id, kind: 'kattis', id: id, star: star });
    }
    cat.o.forEach((name, i) => items.push({ key: 'o' + cat.id + '/' + i, kind: 'other', id: name, star: false }));
    for (const it of items) it.entry = it.key === cat.e;
    const rank = it => it.entry ? 0 : it.star ? 1 : 2;
    return items.map((it, i) => [it, i]).sort((a, b) => (rank(a[0]) - rank(b[0])) || (a[1] - b[1])).map(x => x[0]);
  }

  /* Counts for the book ("all"), each chapter ("1"), each section ("1.4") and each category ("1.4a").
     done: a function that tells if the problem with a key is done. cats3: categories with 3 or more done problems. */
  function cp4Stats(book, done) {
    const zero = () => ({ total: 0, done: 0, stars: 0, starsDone: 0 });
    const out = { all: zero(), by: {}, cats: 0, cats3: 0 };
    for (const ch of book.chapters) {
      const c = out.by[String(ch.n)] = zero();
      for (const sec of ch.sections) {
        const sc = out.by[sec.code] = zero();
        for (const cat of sec.cats) {
          const k = out.by[cat.id] = zero();
          for (const it of cp4Items(cat)) {
            const d = done(it.key) ? 1 : 0;
            for (const t of [k, sc, c, out.all]) {
              t.total++; t.done += d;
              if (it.star) { t.stars++; t.starsDone += d; }
            }
          }
          out.cats++;
          if (k.done >= 3) out.cats3++;
        }
      }
    }
    return out;
  }

  // "1" is a chapter. "1.4" is a section. "1.4a" is a category. Other text gives null.
  function cp4Find(book, text) {
    const t = String(text || '').trim().toLowerCase().replace(/^(chapter|ch)\s*/, '');
    for (const ch of book.chapters) {
      if (t === String(ch.n)) return { chapter: ch };
      for (const sec of ch.sections) {
        if (t === sec.code) return { chapter: ch, section: sec };
        for (const cat of sec.cats) if (t === cat.id) return { chapter: ch, section: sec, cat: cat };
      }
    }
    return null;
  }

  // ----------------------------------------------------------------- rivals

  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  // The chance that you finish above a rival in one contest, from the two ratings (the Elo formula).
  const winChance = (mine, theirs) => 1 / (1 + Math.pow(10, (theirs - mine) / 400));

  function ratingChangeFromApi(d) {
    if (!d || d.contestId == null) return null;
    return { cid: d.contestId, name: d.contestName || '', rank: d.rank || 0, old: d.oldRating || 0,
             now: d.newRating || 0, time: d.ratingUpdateTimeSeconds || 0 };
  }

  // Numbers from the rated contests of one handle.
  function career(changes) {
    const list = changes.slice().sort((a, b) => a.time - b.time);
    const out = { count: list.length, peak: 0, peakTime: 0, bestRank: null, last: 0, form: [] };
    for (const c of list) {
      if (c.now > out.peak) { out.peak = c.now; out.peakTime = c.time; }
      if (c.rank > 0 && (!out.bestRank || c.rank < out.bestRank.rank)) out.bestRank = { rank: c.rank, name: c.name, cid: c.cid };
    }
    if (list.length) out.last = list[list.length - 1].time;
    out.form = list.slice(-5).map(c => c.now - c.old);
    return out;
  }

  // A wrong attempt adds penalty. A compilation error and a failure on test 1 do not.
  const countsAsWrong = s => s.passed > 0 && s.verdict !== 'COMPILATION_ERROR' && s.verdict !== 'SKIPPED' && s.verdict !== 'TESTING';

  /* The result of one handle in one contest, from its submissions.
     o.types: the participant types that count. o.virtual: use the first virtual contest that started at o.after or later.
     Result: { solved, penalty, problems: [{ idx, time, wrong }], start }, or null with no submission.
     penalty: the minutes to each Accepted, plus 10 for each wrong attempt before it. */
  function contestResult(subs, cid, o) {
    let list = subs.filter(s => s.p.cid === cid && o.types[s.ptype] && s.rel != null);
    if (o.virtual) {
      const starts = list.map(s => s.start).filter(t => t >= (o.after || 0));
      if (!starts.length) return null;
      const first = Math.min.apply(null, starts);
      list = list.filter(s => s.start === first);
    }
    if (!list.length) return null;
    list.sort((a, b) => (a.rel - b.rel) || (a.id - b.id));
    const byIdx = {};
    for (const s of list) {
      const r = byIdx[s.p.idx] || (byIdx[s.p.idx] = { idx: s.p.idx, time: null, wrong: 0 });
      if (r.time != null) continue;             // after the first Accepted, more submissions do not count
      if (s.ok) r.time = s.rel; else if (countsAsWrong(s)) r.wrong++;
    }
    const problems = Object.keys(byIdx).sort(cmp).map(k => byIdx[k]);
    let solved = 0, penalty = 0;
    for (const r of problems) if (r.time != null) { solved++; penalty += Math.floor(r.time / 60) + 10 * r.wrong; }
    return { solved: solved, penalty: penalty, problems: problems, start: list[0].start };
  }

  // 1: a wins. -1: b wins. 0: draw. More solved problems wins. With the same number, the lower penalty wins.
  function compareResults(a, b) {
    if (a.solved !== b.solved) return a.solved > b.solved ? 1 : -1;
    if (a.penalty !== b.penalty) return a.penalty < b.penalty ? 1 : -1;
    return 0;
  }

  /* Contests for a duel: rated contests of the rival that you did not touch. Newest first.
     o: { changes, rivalSubs, mySubs, problems, skip: Set of contest ids, unfinished: Set | null, durations: { id: seconds } } */
  function duelCandidates(o) {
    const mine = new Set(o.mySubs.map(s => s.p.cid)), myNames = new Set(o.mySubs.map(s => s.p.name));
    const names = new Map();
    for (const p of o.problems) { if (!names.has(p.cid)) names.set(p.cid, []); names.get(p.cid).push(p.name); }
    const solvedIn = new Set(o.rivalSubs.filter(s => s.ok && OFFICIAL[s.ptype] && s.rel != null).map(s => s.p.cid));
    return o.changes.slice().sort((a, b) => b.time - a.time).filter(c =>
      !mine.has(c.cid) && !(o.skip && o.skip.has(c.cid)) && !(o.unfinished && o.unfinished.has(c.cid)) &&
      o.durations[c.cid] > 0 && solvedIn.has(c.cid) &&
      names.has(c.cid) && !names.get(c.cid).some(n => myNames.has(n)));       // also no Div. 1 / Div. 2 copy that you saw
  }

  /* Your checkpoints, highest rating first. rivals: [{ handle, rating, maxRating, missing }].
     duels: [{ rival, status: open | won | lost | draw | dropped, endedAt }].
     next: the rival with the lowest rating that you did not pass. */
  function ladder(rivals, duels, myRating) {
    const rows = rivals.map(r => {
      const wins = duels.filter(d => same(d.rival, r.handle) && d.status === 'won').map(d => d.endedAt).sort((a, b) => a - b);
      const rating = r.rating || 0;
      return { handle: r.handle, rating: rating, maxRating: r.maxRating || 0, missing: !!r.missing, wins: wins.length,
               losses: duels.filter(d => same(d.rival, r.handle) && d.status === 'lost').length,
               passedAt: wins.length >= WINS_TO_PASS ? wins[WINS_TO_PASS - 1] : null,
               gap: rating - myRating, chance: winChance(myRating, rating), next: false };
    }).sort((a, b) => (b.rating - a.rating) || cmp(a.handle.toLowerCase(), b.handle.toLowerCase()));
    const open = rows.filter(r => !r.passedAt && !r.missing);
    if (open.length) open[open.length - 1].next = true;
    return rows;
  }

  /* Topics where a rival is ahead of you. mine and theirs are topic reports for the same level.
     A topic counts if it is common near your level, and the level of the rival is 200 or more above your level
     (or you have no level). */
  function topicEdges(mine, theirs, top) {
    const my = {};
    for (const t of mine.topics) my[t.tag] = t;
    return theirs.topics.filter(t => t.level != null && my[t.tag] && my[t.tag].common &&
        (my[t.tag].level == null || t.level - my[t.tag].level >= 200))
      .map(t => ({ tag: t.tag, theirs: t.level, mine: my[t.tag].level }))
      .sort((a, b) => ((b.theirs - (b.mine || 0)) - (a.theirs - (a.mine || 0))) || cmp(a.tag, b.tag))
      .slice(0, top || 5);
  }

  // 425 seconds is "0:07". 6720 seconds is "1:52".
  function clock(sec) {
    const m = Math.floor(sec / 60);
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
  }

  // --------------------------------------------------------------- commands

  const ALIASES = { '?': 'help', h: 'help', commands: 'help', home: 'fetch', neofetch: 'fetch', fastfetch: 'fetch',
                    stats: 'progress', quests: 'desk', ls: 'desk', done: 'check', claim: 'check', training: 'train',
                    gitgud: 'train', suggestion: 'suggest', getquest: 'suggest', quest: 'suggest', finished: 'history',
                    hint: 'hint1', spoil: 'spoiled', cls: 'clear', rivals: 'rival', checkpoints: 'rival',
                    ladder: 'rival', fight: 'duel', book: 'cp4', checklist: 'cp4' };

  // "/suggest 1200" and "suggest 1200" are the same command.
  function parseCommand(line) {
    const t = String(line || '').trim().replace(/^[\/$>]\s*/, '');
    if (!t) return null;
    const m = /^(\S+)\s*([\s\S]*)$/.exec(t);
    const name = m[1].toLowerCase();
    return { name: ALIASES[name] || name, rest: m[2].trim() };
  }

  const SHORT_TOPICS = { bs: 'binary search', ds: 'data structures', nt: 'number theory' };

  // Finds the topic for a typed name: the full name, then the start of the name,
  // then the start of a word, then any part. "dfs" gives "dfs and similar".
  function resolveTopic(text, tags) {
    let q = String(text || '').trim().toLowerCase();
    if (SHORT_TOPICS[q]) q = SHORT_TOPICS[q];
    if (tags.indexOf(q) >= 0) return { tag: q };
    let hits = tags.filter(t => t.indexOf(q) === 0);
    if (!hits.length) hits = tags.filter(t => t.split(/[\s-]+/).some(w => w.indexOf(q) === 0));
    if (!hits.length) hits = tags.filter(t => t.indexOf(q) >= 0);
    if (hits.length === 1) return { tag: hits[0] };
    return { error: hits.length ? '"' + q + '" matches more than one topic: ' + hits.join(', ') + '. Type more letters.'
                                : 'No topic matches "' + q + '".' };
  }

  // A list of topics with commas between them.
  function resolveTopics(text, tags) {
    const out = { tags: [], errors: [] };
    const names = String(text || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!names.length) out.errors.push('Name one topic or more, with commas between them.');
    for (const n of names) {
      const r = resolveTopic(n, tags);
      if (r.error) out.errors.push(r.error);
      else if (out.tags.indexOf(r.tag) < 0) out.tags.push(r.tag);
    }
    return out;
  }

  // Arguments of suggest and train:  [rating] [with topics] [without topics]
  // rating: 1200 = that rating. +200 or -100 = from your level. "level" = your level.
  function parseGetArgs(rest, tags) {
    const out = { errors: [] };
    const parts = String(rest || '').toLowerCase().split(/\b(without|with)\b/);
    const head = parts[0].trim();
    if (head === 'level') out.delta = 0;
    else if (/^[+-]\d+$/.test(head)) out.delta = Number(head);
    else if (/^\d+$/.test(head)) {
      const n = Number(head);
      if (n >= MIN_RATING && n <= MAX_RATING) out.exact = Math.round(n / 100) * 100;
      else out.errors.push('A rating is from ' + MIN_RATING + ' to ' + MAX_RATING + '. For a rating from your level, use a sign: +200.');
    } else if (head) out.errors.push('niel-trains cannot read "' + head + '". Use: [rating] [with topics] [without topics].');
    for (let i = 1; i < parts.length; i += 2) {
      const r = resolveTopics(parts[i + 1], tags);
      out.errors = out.errors.concat(r.errors);
      const list = parts[i] === 'with' ? 'include' : 'exclude';
      out[list] = (out[list] || []).concat(r.tags);
    }
    return out;
  }

  return {
    parseUva: parseUva, uvaProblemFromApi: uvaProblemFromApi, uvaSubFromApi: uvaSubFromApi,
    cp4Items: cp4Items, cp4Stats: cp4Stats, cp4Find: cp4Find,
    WINS_TO_PASS: WINS_TO_PASS, OFFICIAL: OFFICIAL, VIRTUAL: VIRTUAL, same: same, winChance: winChance,
    ratingChangeFromApi: ratingChangeFromApi, career: career, contestResult: contestResult, compareResults: compareResults,
    duelCandidates: duelCandidates, ladder: ladder, topicEdges: topicEdges, clock: clock,
    rankOf: rankOf, progress: progress, ALIASES: ALIASES, parseCommand: parseCommand, resolveTopic: resolveTopic,
    resolveTopics: resolveTopics, parseGetArgs: parseGetArgs,
    MIN_RATING: MIN_RATING, MAX_RATING: MAX_RATING, DAY: DAY, RESOLVE_DAYS: RESOLVE_DAYS,
    IGNORED_TAGS: IGNORED_TAGS, RESULT_LABEL: RESULT_LABEL,
    roundLevel: roundLevel, targetRating: targetRating, makeProblem: makeProblem,
    problemFromApi: problemFromApi, submissionFromApi: submissionFromApi, parseProblemId: parseProblemId,
    solvedKeys: solvedKeys, attemptedKeys: attemptedKeys, firstOkAfter: firstOkAfter,
    matches: matches, pickProblem: pickProblem, topicReport: topicReport, weakTags: weakTags,
    pickWeakTag: pickWeakTag, summary: summary, upsolveList: upsolveList, dueTime: dueTime,
    encodeState: encodeState, decodeState: decodeState, logRow: logRow
  };
}));

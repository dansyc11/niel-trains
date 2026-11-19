/* niel-trains: Codeforces API, saved data, and the commands of the terminal. */
(function () {
  'use strict';

  const L = window.CFLogic;
  const API = 'https://codeforces.com/api/';
  // Codeforces allows about one API call every 2 seconds.
  const GAP_MS = typeof window.CFCOACH_GAP_MS === 'number' ? window.CFCOACH_GAP_MS : 2100;
  // The keys have the first name of the site. They stay, so that your saved data stays.
  const K_STATE = 'cfcoach.state.v1', K_PROBLEMS = 'cfcoach.problems.v1', K_CONTESTS = 'cfcoach.contests.v1',
        K_TERM = 'cfcoach.term.v1', K_RIVALS = 'cfcoach.rivals.v1', K_UVAP = 'cfcoach.uvap.v1';
  const PROBLEMS_MAX_AGE = 12 * 3600, CONTESTS_MAX_AGE = 3600, RIVAL_MAX_AGE = 24 * 3600, MAX_RIVALS = 10;
  const HANDLE_RE = /^[A-Za-z0-9_.-]{3,24}$/;
  const SOURCE_TEXT = { suggest: 'A suggestion.', training: 'Training for a weak topic.', upsolve: 'An upsolve.',
                        resolve: 'A new try from scratch.', start: 'Your own pick.' };
  const LOGO = ['          _      __', '   ____  (_)__  / /', '  / __ \\/ / _ \\/ /', ' / / / / /  __/ /', '/_/ /_/_/\\___/_/'].join('\n');
  const SEAL = '<p class="seal"><i aria-hidden="true">░░░░░░░░</i>The rating and the topics are sealed.</p>';

  const $ = id => document.getElementById(id);
  const $out = $('out'), $cmd = $('cmd'), $ac = $('ac'), $chips = $('chips'), $live = $('live'), $ps1 = $('ps1'),
        $top = $('top'), $bar = $('bar');
  const nowSec = () => Math.floor(Date.now() / 1000);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ saved data

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* no storage */ } }

  function freshState() {
    return { v: 1, handle: '', levelOverride: null, ratingMode: 'delta', delta: 100, deltaHi: 200, exact: 1200, exactHi: null, country: '',
             only: { suggest: [], train: [] }, off: { suggest: [], train: [] }, maxOpen: 3, windowDays: 365, quests: [], marks: [], rivals: [], duels: [], uva: null, cp4: {}, nextId: 1 };
  }

  function cleanState(raw) {
    const s = freshState();
    if (!raw || typeof raw !== 'object') return s;
    for (const k of Object.keys(s)) if (raw[k] !== undefined) s[k] = raw[k];
    for (const k of ['quests', 'marks', 'rivals', 'duels']) if (!Array.isArray(s[k])) s[k] = [];
    // Old data has one include list and one exclude list for both commands.
    const tagList = x => Array.isArray(x) ? x.filter(t => typeof t === 'string') : [];
    const pair = (now, old) => ({ suggest: tagList(now && now.suggest !== undefined ? now.suggest : old),
                                  train: tagList(now && now.train !== undefined ? now.train : old) });
    s.only = pair(raw.only, raw.include);
    s.off = pair(raw.off, raw.exclude);
    s.handle = String(s.handle || '');
    if (raw.deltaHi === undefined) {                         // data from before the rating range
      if (raw.delta === undefined || Number(raw.delta) === 200) { s.delta = 100; s.deltaHi = 200; } else s.deltaHi = null;
    }
    s.deltaHi = s.deltaHi == null ? null : Number(s.deltaHi) || 0;
    s.exactHi = Number(s.exactHi) || null;
    s.country = String(s.country || '');
    s.delta = Number(s.delta) || 0;
    s.exact = Number(s.exact) || 1200;
    s.maxOpen = Math.max(1, Math.min(5, Number(s.maxOpen) || 3));
    s.windowDays = Number(s.windowDays) || 0;
    s.levelOverride = Number(s.levelOverride) || null;
    if (!s.cp4 || typeof s.cp4 !== 'object' || Array.isArray(s.cp4)) s.cp4 = {};
    s.uva = s.uva && Number(s.uva.uid) > 0 && s.uva.uname ? { uname: String(s.uva.uname), uid: Number(s.uva.uid) } : null;
    s.quests = s.quests.filter(q => q && q.p && q.p.key);
    s.marks = s.marks.filter(m => m && m.p && m.p.key);
    s.rivals = s.rivals.filter(r => r && typeof r.handle === 'string' && r.handle);
    s.duels = s.duels.filter(d => d && d.cid && d.rival && d.ghost);
    const ids = s.quests.concat(s.marks, s.duels).map(x => Number(x.id) || 0);
    s.nextId = Math.max(Number(s.nextId) || 1, 1 + Math.max(0, ...ids));
    return s;
  }

  // The theme and the command history stay on this device. They are not in the export code.
  function cleanTerm(raw) {
    const t = { theme: 'dark', hist: [], jsonp: false, stay: false };
    if (raw && typeof raw === 'object') {
      t.jsonp = raw.jsonp === true;
      t.stay = raw.stay === true;
      if (['dark', 'light', 'auto'].indexOf(raw.theme) >= 0) t.theme = raw.theme;
      if (Array.isArray(raw.hist)) t.hist = raw.hist.filter(x => typeof x === 'string').slice(-50);
    }
    return t;
  }

  let state = cleanState(lsGet(K_STATE));
  const term = cleanTerm(lsGet(K_TERM));
  const save = () => { const ok = lsSet(K_STATE, state); queuePush(); return ok; };
  const saveTerm = () => lsSet(K_TERM, term);

  const data = { problems: null, byKey: new Map(), tags: [], subs: null, rating: null, maxRating: null, unfinished: null,
                 durations: {}, rivalSubs: {}, uvaSubs: null, uvaName: '', uvaList: null };
  const ui = { busy: false };

  // ---------------------------------------------------------- lock and sync

  /* lock.js sets window.NT_LOCK: the place of your data on GitHub, and your GitHub key, encrypted with your password.
     Without lock.js the site has no password, and your data stays in this browser. */
  const LOCK = window.NT_LOCK && window.NT_LOCK.box ? window.NT_LOCK : null;
  const K_TOKEN = 'nt.key.v1', K_DIRTY = 'nt.dirty.v1', K_FIND = 'cfcoach.find.v1';
  const SYNC_MS = typeof window.NT_SYNC_MS === 'number' ? window.NT_SYNC_MS : 2500;
  const sync = { token: null, sha: null, status: 'off', error: '', at: 0, timer: null, busy: false, again: false };
  let locked = false;

  function readToken() {
    try { return sessionStorage.getItem(K_TOKEN) || localStorage.getItem(K_TOKEN) || null; } catch (e) { return null; }
  }
  // The open key stays in this tab. With "stay on", it also stays in this browser.
  function storeToken() {
    try {
      sessionStorage.setItem(K_TOKEN, sync.token);
      if (term.stay) localStorage.setItem(K_TOKEN, sync.token); else localStorage.removeItem(K_TOKEN);
    } catch (e) { /* no storage */ }
  }
  function dropToken() {
    try { sessionStorage.removeItem(K_TOKEN); localStorage.removeItem(K_TOKEN); } catch (e) { /* no storage */ }
    sync.token = null;
  }

  async function gh(method, body, keepalive) {
    let res;
    try {
      res = await fetch('https://api.github.com/repos/' + LOCK.owner + '/' + LOCK.repo + '/contents/' + LOCK.path, {
        method: method, cache: 'no-store', keepalive: !!keepalive, body: body ? JSON.stringify(body) : undefined,
        headers: Object.assign({ Authorization: 'Bearer ' + sync.token, Accept: 'application/vnd.github+json' },
                               body ? { 'Content-Type': 'application/json' } : {}) });
    } catch (e) { throw new Error('GitHub did not answer. Check your connection.'); }
    if (res.status === 401) throw new Error('GitHub refused the key. The key can be expired. Make a new key, then run setup-lock.cjs again.');
    if (res.status === 403) throw new Error('GitHub refused the request. The key can lack access to the repo, or GitHub limits the saves for some minutes.');
    return res;
  }

  // Reads the saved data. found is false when the file does not exist yet.
  async function pull() {
    const res = await gh('GET');
    if (res.status === 404) return { found: false, sha: null };
    if (!res.ok) throw new Error('GitHub error ' + res.status + '.');
    const json = await res.json();
    let saved = null;
    try { saved = JSON.parse(L.b64ToText(json.content)); } catch (e) { throw new Error('niel-trains cannot read ' + LOCK.path + ' on GitHub.'); }
    return { found: true, sha: json.sha, state: saved };
  }

  // Writes the saved data. Gives false if a different device saved first.
  async function push(keepalive) {
    const body = { message: 'Save', content: L.textToB64(JSON.stringify(state)) };
    if (sync.sha) body.sha = sync.sha;
    const res = await gh('PUT', body, keepalive);
    if (res.status === 409 || res.status === 422) return false;
    if (res.status === 404) throw new Error('GitHub cannot find ' + LOCK.owner + '/' + LOCK.repo + ', or the key cannot write to it.');
    if (!res.ok) throw new Error('GitHub error ' + res.status + '.');
    sync.sha = (await res.json()).content.sha;
    return true;
  }

  function adopt(remote) {
    state = cleanState(remote.state);
    lsSet(K_STATE, state);
    lsDel(K_DIRTY);
    sync.sha = remote.sha;
  }

  function setSync(status, error) {
    sync.status = status;
    sync.error = error || '';
    if (status === 'ok') sync.at = nowSec();
    renderSync();
  }

  function renderSync() {
    const el = $('st-sync');
    if (!el) return;
    el.hidden = !LOCK || locked;
    const text = { ok: 'saved', saving: 'saving…', error: 'not saved', off: 'no sync' }[sync.status];
    el.textContent = text;
    el.classList.toggle('due', sync.status === 'error');
    el.setAttribute('aria-label', 'GitHub sync: ' + text + '. Show the sync status.');
  }

  // Each change goes to GitHub a moment later.
  function queuePush() {
    if (!LOCK || !sync.token || locked) return;
    lsSet(K_DIRTY, 1);
    setSync('saving');
    clearTimeout(sync.timer);
    sync.timer = setTimeout(() => { pushNow(); }, SYNC_MS);
  }

  // Saves to GitHub now. Gives 'ok', 'conflict', 'busy' or 'error'.
  async function pushNow(keepalive) {
    clearTimeout(sync.timer);
    sync.timer = null;
    if (!LOCK || !sync.token) return 'error';
    if (sync.busy) { sync.again = true; return 'busy'; }
    sync.busy = true;
    let out = 'ok';
    try {
      if (await push(keepalive)) { lsDel(K_DIRTY); setSync('ok'); }
      else {
        const remote = await pull();
        if (remote.found) adopt(remote); else sync.sha = null;
        setSync('ok');
        out = 'conflict';
        notice(ln('A different device saved newer data. niel-trains loaded that data. ' +
                  'Your last change on this device is not in it. Make the change again.', 'err'));
        renderStatus();
      }
    } catch (e) { setSync('error', e.message); out = 'error'; }
    sync.busy = false;
    if (sync.again) { sync.again = false; queuePush(); }
    return out;
  }

  // After the password: load the data from GitHub. A change that this device did not save yet goes to GitHub first.
  async function syncStart() {
    const remote = await pull();
    const unsaved = lsGet(K_DIRTY) === 1 && !!state.handle;
    if (remote.found && !unsaved) adopt(remote);
    else {
      sync.sha = remote.sha;
      if (state.handle) {
        if (await push()) lsDel(K_DIRTY);
        else { const again = await pull(); if (again.found) adopt(again); }
      }
    }
    setSync('ok');
  }

  // --------------------------------------------------------- Codeforces API

  let chain = Promise.resolve(), lastCall = 0;

  function api(method, params, ms) {
    const run = async () => {
      const wait = GAP_MS - (Date.now() - lastCall);
      if (wait > 0) await sleep(wait);
      try { return await call(method, params, true, ms); } finally { lastCall = Date.now(); }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  // Codeforces also answers with JSONP: a script that calls a function with the data.
  function jsonp(url, ms) {
    return new Promise((resolve, reject) => {
      const name = 'ntcb' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
      const el = document.createElement('script');
      const end = (fn, late) => {
        clearTimeout(timer);
        if (late) window[name] = () => {}; else delete window[name];
        el.remove();
        fn();
      };
      const timer = setTimeout(() => end(() => reject(new Error('timeout')), true), ms || 60000);
      window[name] = json => end(() => resolve(json));
      el.onerror = () => end(() => reject(new Error('load')));
      el.src = url + '&jsonp=' + name;
      document.head.appendChild(el);
    });
  }

  // The normal request first. If the browser blocks it, JSONP. The site then keeps JSONP for the next visits.
  async function request(url, ms) {
    if (term.jsonp) {
      try { return await jsonp(url, ms); } catch (e) {
        // With JSONP, a request that Codeforces refuses gives no reason.
        throw new Error('Codeforces did not answer, or it did not accept the request. Check the handle and your connection, then try again.');
      }
    }
    let res = null;
    try { res = await fetch(url); } catch (e) { /* blocked, or no connection */ }
    if (res) {
      try { return await res.json(); } catch (e) {
        throw new Error('Codeforces sent an answer that niel-trains cannot read. Codeforces can be busy. Try again in a minute.');
      }
    }
    await sleep(GAP_MS);
    let json;
    try { json = await jsonp(url, ms); } catch (e) {
      throw new Error('Codeforces did not answer. Check your connection, or try again in a minute.');
    }
    term.jsonp = true;
    saveTerm();
    return json;
  }

  async function call(method, params, retry, ms) {
    const json = await request(API + method + '?' + new URLSearchParams(params), ms);
    if (json.status === 'OK') return json.result;
    const comment = String(json.comment || 'unknown error');
    if (retry && /limit/i.test(comment)) { await sleep(Math.max(GAP_MS, 300)); return call(method, params, false, ms); }
    const who = /handle (\S+) not found/i.exec(comment);
    const err = new Error(who ? 'Codeforces does not know the handle "' + who[1] + '". Check the spelling.' : 'Codeforces error: ' + comment);
    err.comment = comment;
    err.badHandle = who ? who[1] : null;
    throw err;
  }

  const toSubs = list => list.map(L.submissionFromApi).filter(Boolean);

  function mergeSubs(fresh) {
    const have = new Set(data.subs.map(s => s.id));
    for (const s of fresh) if (!have.has(s.id)) data.subs.push(s);
  }

  // The problem list is big, so the saved copy is packed: [contest, index, name, rating, [tag numbers]].
  function packProblems(list) {
    const tags = [], idx = new Map();
    const rows = list.map(p => [p.cid, p.idx, p.name, p.rating || 0, p.tags.map(t => {
      if (!idx.has(t)) { idx.set(t, tags.length); tags.push(t); }
      return idx.get(t);
    })]);
    return { t: nowSec(), tags: tags, rows: rows };
  }
  const unpackProblems = c => c.rows.map(r => L.makeProblem(r[0], r[1], r[2], r[3] || null, r[4].map(i => c.tags[i])));

  function setProblems(list) {
    data.problems = list;
    data.byKey = new Map(list.map(p => [p.key, p]));
    const tags = new Set();
    for (const p of list) for (const t of p.tags) if (!L.IGNORED_TAGS[t]) tags.add(t);
    data.tags = Array.from(tags).sort();
  }

  async function loadProblems() {
    const cached = lsGet(K_PROBLEMS);
    if (cached && cached.rows && !data.problems) setProblems(unpackProblems(cached));
    if (cached && cached.rows && nowSec() - cached.t < PROBLEMS_MAX_AGE) return;
    live(data.problems ? 'Updating the problem list…' : 'Loading the problem list. The first time takes a few seconds…');
    try {
      const res = await api('problemset.problems', {});
      const list = res.problems.map(L.problemFromApi).filter(Boolean);
      setProblems(list);
      lsSet(K_PROBLEMS, packProblems(list));
    } catch (e) {
      if (!data.problems) throw e;          // an old copy is good enough
    }
  }

  async function loadContests() {
    const cached = lsGet(K_CONTESTS);
    if (cached && Array.isArray(cached.ids)) data.unfinished = new Set(cached.ids);
    if (cached && cached.dur) data.durations = cached.dur;
    if (cached && cached.dur && nowSec() - cached.t < CONTESTS_MAX_AGE) return;
    live('Checking which contests are running…');
    try {
      const res = await api('contest.list', { gym: 'false' });
      const ids = res.filter(c => c.phase !== 'FINISHED').map(c => c.id), dur = {};
      for (const c of res) if (c.phase === 'FINISHED' && c.durationSeconds) dur[c.id] = c.durationSeconds;     // a duel needs the length
      data.unfinished = new Set(ids);
      data.durations = dur;
      lsSet(K_CONTESTS, { t: nowSec(), ids: ids, dur: dur });
    } catch (e) { /* the upsolve list has a safe fallback */ }
  }

  function renameRival(r, handle) {
    for (const d of state.duels) if (L.same(d.rival, r.handle)) d.rival = handle;
    r.handle = handle;
  }

  // One call gives your profile and the profiles of your rivals.
  async function loadProfiles() {
    let rivals = state.rivals.filter(r => !r.missing), infos = null;
    while (!infos) {
      try {
        infos = await api('user.info', { handles: [state.handle].concat(rivals.map(r => r.handle)).join(';') });
      } catch (e) {
        const bad = e.badHandle && rivals.find(r => L.same(r.handle, e.badHandle));
        if (bad) { bad.missing = true; rivals = rivals.filter(r => r !== bad); }      // this rival changed the handle or left
        else if (rivals.length && !e.comment) rivals = [];                             // no reason: ask for your profile only
        else throw e;
      }
    }
    data.rating = infos[0].rating || null;
    data.maxRating = infos[0].maxRating || null;
    if (infos[0].handle) state.handle = infos[0].handle;                               // the spelling from Codeforces
    rivals.forEach((r, i) => {
      const u = infos[i + 1];
      if (!u) return;
      if (u.handle && u.handle !== r.handle) renameRival(r, u.handle);
      r.rating = u.rating || 0;
      r.maxRating = u.maxRating || 0;
    });
  }

  function unpackChanges(rows) {
    return rows.map(r => ({ cid: r[0], name: r[1], rank: r[2], old: r[3], now: r[4], time: r[5] }));
  }

  // The rated contests of a handle. The saved copy is good for one day.
  async function loadChanges(handle) {
    const key = handle.toLowerCase(), all = lsGet(K_RIVALS) || {};
    if (all[key] && nowSec() - all[key].t < RIVAL_MAX_AGE) return unpackChanges(all[key].rows);
    live('Reading the rated contests of ' + handle + '…');
    const list = (await api('user.rating', { handle: handle })).map(L.ratingChangeFromApi).filter(Boolean);
    all[key] = { t: nowSec(), rows: list.map(c => [c.cid, c.name, c.rank, c.old, c.now, c.time]) };
    lsSet(K_RIVALS, all);
    return list;
  }

  // The submissions of a handle. They stay in memory for one hour.
  async function loadRivalSubs(handle) {
    const key = handle.toLowerCase(), hit = data.rivalSubs[key];
    if (hit && nowSec() - hit.t < 3600) return hit.subs;
    live('Reading the submissions of ' + handle + '…');
    const subs = toSubs(await api('user.status', { handle: handle }));
    data.rivalSubs[key] = { t: nowSec(), subs: subs };
    return subs;
  }

  // ------------------------------------------------------ UVa through uHunt

  // uHunt needs no key. It lets a page from a different site call it.
  async function uhunt(path, lenient) {
    let res;
    try { res = await fetch('https://uhunt.onlinejudge.org/api/' + path); } catch (e) {
      throw new Error('uHunt did not answer. Check your connection, or try again in a minute.');
    }
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) {
      if (lenient) return null;
      throw new Error('uHunt sent an answer that niel-trains cannot read.');
    }
  }

  async function loadUva() {
    if (!state.uva) return;
    live('Loading your UVa submissions…');
    const r = await uhunt('subs-user/' + state.uva.uid);
    data.uvaSubs = ((r && r.subs) || []).map(L.uvaSubFromApi).filter(Boolean);
    data.uvaName = (r && r.name) || '';
  }

  // The UVa problem list of uHunt: the number, the id and the name of each problem. The saved copy is good for 30 days.
  async function loadUvaList(savedOnly) {
    if (data.uvaList) return;
    let c = lsGet(K_UVAP);
    if (!c || !Array.isArray(c.rows) || nowSec() - c.t > 30 * L.DAY) {
      if (savedOnly) return;
      live('Loading the UVa problem names from uHunt…');
      const list = await uhunt('p');
      const rows = (Array.isArray(list) ? list : []).map(x => Array.isArray(x) ? [x[0], x[1], String(x[2] || '')]
        : x && x.pid ? [x.pid, x.num, String(x.title || '')] : null).filter(r => r && r[0] > 0 && r[1] > 0);
      if (!rows.length) throw new Error('uHunt sent no problem list.');
      c = { t: nowSec(), rows: rows };
      lsSet(K_UVAP, c);
    }
    data.uvaList = { byNum: new Map(c.rows.map(r => [r[1], { pid: r[0], title: r[2] }])), byPid: new Map(c.rows.map(r => [r[0], r[1]])) };
  }

  // The newest UVa submissions, added to the loaded ones.
  async function refreshUva() {
    if (!data.uvaSubs) return loadUva();
    const r = await uhunt('subs-user-last/' + state.uva.uid + '/100');
    const have = new Set(data.uvaSubs.map(x => x.id));
    for (const x of ((r && r.subs) || []).map(L.uvaSubFromApi).filter(Boolean)) if (!have.has(x.id)) data.uvaSubs.push(x);
  }

  // Loads the profiles, the submissions, the problem list and the contest list. Returns { error } on failure.
  async function loadAll() {
    ui.busy = true;
    try {
      live('Loading your Codeforces profile…');
      await loadProfiles();
      live('Loading your submissions…');
      data.subs = toSubs(await api('user.status', { handle: state.handle }));
      await loadProblems();
      await loadContests();
      try { await loadUva(); } catch (e) { data.uvaSubs = null; }       // UVa is an extra. A uHunt problem must not stop the load.
      try { await loadUvaList(true); } catch (e) { /* the saved list is optional */ }
      matchAccepted();
      save();
      return {};
    } catch (e) {
      return { error: e.message };
    } finally {
      ui.busy = false;
      live('');
      renderStatus();
    }
  }

  // ---------------------------------------------------------------- helpers

  const currentLevel = () => state.levelOverride || data.rating || L.MIN_RATING;
  const ready = () => !!(data.problems && data.subs);
  const isOpen = q => q.status === 'open' || q.status === 'accepted';
  const openQuests = () => state.quests.filter(isOpen);
  // A problem is a Codeforces problem, or a UVa problem ({ oj: 'uva', pid, num }).
  const isUva = p => p.oj === 'uva';
  const label = p => isUva(p) ? 'UVa ' + p.num : p.key;
  const show = key => /^uva\d+$/.test(key) ? 'UVa ' + key.slice(3) : key;
  const subKey = p => isUva(p) ? 'uvap' + p.pid : p.key;                 // the key of the problem in the submissions
  const subsFor = p => isUva(p) ? data.uvaSubs || [] : data.subs;
  const problemUrl = p => isUva(p)
    ? 'https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem=' + p.pid
    : 'https://codeforces.com/problemset/problem/' + p.cid + '/' + encodeURIComponent(p.idx);
  const slim = p => isUva(p)
    ? { oj: 'uva', pid: p.pid, num: p.num, cid: null, idx: null, name: p.name, rating: null, tags: [], key: p.key }
    : { cid: p.cid, idx: p.idx, name: p.name, rating: p.rating, tags: p.tags.slice(), key: p.key };
  const solvedQuests = () => state.quests.filter(q => q.status === 'solved').sort((a, b) => b.endedAt - a.endedAt);
  const openMarks = () => state.marks.filter(m => !m.doneAt).sort((a, b) => a.dueAt - b.dueAt);

  const myRating = () => data.rating || currentLevel();
  const openDuel = () => state.duels.find(d => d.status === 'open') || null;
  const findRival = h => state.rivals.find(r => L.same(r.handle, h)) || null;
  const ladder = () => L.ladder(state.rivals, state.duels, myRating());

  function seen() {
    const keys = L.attemptedKeys(data.subs), names = new Set(data.subs.map(s => s.p.name));
    for (const q of state.quests) { keys.add(q.p.key); names.add(q.p.name); }
    for (const m of state.marks) { keys.add(m.p.key); names.add(m.p.name); }
    const d = openDuel();          // the contest of an open duel must stay new
    if (d) for (const p of data.problems) if (p.cid === d.cid) { keys.add(p.key); names.add(p.name); }
    return { keys: keys, names: names };
  }

  // How you solved each problem, from this site. Later events replace earlier events.
  function resultsMap() {
    const events = [];
    for (const q of state.quests) {
      if (q.status === 'solved' && q.result) events.push([q.endedAt, q.p.key, q.result]);
      if (q.status === 'spoiled') events.push([q.endedAt, q.p.key, 'spoiled']);
    }
    for (const m of state.marks) if (m.kind === 'spoiled') events.push([m.markedAt, m.p.key, 'spoiled']);
    events.sort((a, b) => a[0] - b[0]);
    const out = {};
    for (const e of events) out[e[1]] = e[2];
    return out;
  }

  // A problem that is open on your desk has no result yet.
  const pendingKeys = () => new Set(state.quests.filter(isOpen).map(q => q.p.key));
  const reportInput = extra => Object.assign({ problems: data.problems, subs: data.subs, results: resultsMap(), level: currentLevel(),
    anchor: data.rating || currentLevel(), now: nowSec(), windowDays: state.windowDays, pending: pendingKeys(),
    unfinished: data.unfinished, compareDays: 30 }, extra);
  const report = () => L.topicReport(reportInput());

  function upsolveItems() {
    const skip = new Set();
    for (const q of state.quests) if (isOpen(q)) skip.add(q.p.key);
    for (const m of state.marks) if (!m.doneAt) skip.add(m.p.key);
    const items = L.upsolveList(data.subs, data.problems, data.unfinished, skip);
    // Without the contest list, hide contests from the last 6 hours. One of them can be running.
    return data.unfinished ? items : items.filter(x => x.time < nowSec() - 6 * 3600);
  }

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  function rel(sec) {
    const d = sec - nowSec(), a = Math.abs(d);
    if (a < 90) return d <= 0 ? 'a moment ago' : 'in a moment';
    for (const [n, unit] of [[30 * L.DAY, 'month'], [L.DAY, 'day'], [3600, 'hour'], [60, 'minute']]) {
      if (a >= n) return rtf.format(Math.round(d / n), unit);
    }
    return rtf.format(Math.round(d / 60), 'minute');
  }

  function localDate(sec) {
    const d = new Date(sec * 1000), two = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
  }

  function orList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' or ' + items[items.length - 1];
  }

  const plural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
  const defaultBand = () => state.ratingMode === 'exact' ? { lo: state.exact, hi: state.exactHi || state.exact }
                                                        : L.targetBand(currentLevel(), state.delta, state.deltaHi);
  const bandText = b => b.lo === b.hi ? String(b.lo) : b.lo + ' to ' + b.hi;
  const stepText = d => (d < 0 ? '−' : '+') + Math.abs(d);

  function ratingText() {
    const b = defaultBand();
    if (state.ratingMode === 'exact') return bandText(b);
    const d = state.delta, e = state.deltaHi;
    const from = state.levelOverride ? L.roundLevel(currentLevel()) + ' set by hand' : 'your rating';
    return bandText(b) + ' (' + from +
      (e != null && e !== d ? ' ' + stepText(Math.min(d, e)) + ' to ' + stepText(Math.max(d, e)) : d ? ' ' + stepText(d) : '') + ')';
  }

  // Topic switches. off: never give the topic. only: give only these topics.
  const MODES = ['suggest', 'train'];
  const topicOn = (tag, mode) => state.only[mode].length ? state.only[mode].indexOf(tag) >= 0 : state.off[mode].indexOf(tag) < 0;

  function modeText(mode) {
    const parts = [state.only[mode].length ? 'only ' + orList(state.only[mode]) : 'any topic'];
    if (state.off[mode].length) parts.push('never ' + orList(state.off[mode]));
    return parts.join(', ');
  }
  const filterText = () => modeText('suggest') === modeText('train') ? modeText('suggest')
    : 'suggest: ' + modeText('suggest') + '. train: ' + modeText('train');
  function filterShort() {
    const f = m => state.only[m].map(t => '+' + t).concat(state.off[m].map(t => '−' + t)).join(' ') || 'any topic';
    return f('suggest') === f('train') ? f('suggest') : f('suggest') + ' | train ' + f('train');
  }
  const levelFrom = () => state.levelOverride ? 'You set it by hand.'
    : data.rating ? 'It follows your Codeforces rating (' + data.rating + ').' : 'You have no rating yet, so it starts at 800.';
  const periodName = () => state.windowDays === 90 ? 'the last 90 days' : state.windowDays === 365 ? 'the last 12 months' : 'all time';

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- actions

  function addQuest(p, source, tag, markId) {
    const q = { id: state.nextId++, p: slim(p), source: source, tag: tag || null, markId: markId || null,
                startedAt: nowSec(), status: 'open', onDesk: true, result: null, idea: '',
                solvedAt: null, endedAt: null, wasSolved: L.solvedKeys(subsFor(p)).has(subKey(p)) };
    state.quests.push(q);
    save();
    return q;
  }

  function addMark(p, kind) {
    const now = nowSec();
    for (const m of state.marks) if (!m.doneAt && m.p.key === p.key) m.doneAt = now;     // one open mark for each problem
    state.marks.push({ id: state.nextId++, p: slim(p), kind: kind, markedAt: now, dueAt: L.dueTime(kind, now), doneAt: null });
  }

  // Finds Accepted solutions in the loaded submissions.
  function matchAccepted() {
    const found = { quests: [], marks: [] };
    for (const q of state.quests) {
      if (q.status !== 'open') continue;
      const hit = L.firstOkAfter(subsFor(q.p), subKey(q.p), q.wasSolved ? q.startedAt - 120 : 0);
      if (hit) { q.status = 'accepted'; q.solvedAt = hit.time; found.quests.push(q); }
    }
    for (const m of state.marks) {
      if (m.doneAt || state.quests.some(q => q.markId === m.id && isOpen(q))) continue;
      // A parked problem is done when you solve it. A spoiled problem needs a new Accepted after the due date.
      const hit = L.firstOkAfter(subsFor(m.p), subKey(m.p), m.kind === 'parked' ? m.markedAt - 120 : m.dueAt);
      if (hit) { m.doneAt = hit.time; found.marks.push(m); }
    }
    if (found.quests.length || found.marks.length) save();
    return found;
  }

  function chooseResult(q, result) {
    const now = nowSec(), before = q.status === 'solved' ? q.result : null;
    q.status = 'solved'; q.result = result; q.onDesk = false;
    if (!before) q.endedAt = now;
    const mark = q.markId && state.marks.find(m => m.id === q.markId);
    if (mark && !mark.doneAt) mark.doneAt = now;
    if (result === 'spoiled' && before !== 'spoiled') addMark(q.p, 'spoiled');
    // A result that changes from spoiled to a different result removes the 7-day mark.
    if (before === 'spoiled' && result !== 'spoiled') {
      state.marks = state.marks.filter(m => !(m.kind === 'spoiled' && !m.doneAt && m.p.key === q.p.key));
    }
    save();
  }

  function putAway(q, kind) {
    q.status = kind; q.endedAt = nowSec(); q.onDesk = false;
    if (kind !== 'dropped') addMark(q.p, kind);
    save();
  }

  function flipTopic(tag, mode) {
    const only = state.only[mode], off = state.off[mode];
    if (only.length) state.only[mode] = only.indexOf(tag) >= 0 ? only.filter(t => t !== tag) : only.concat([tag]);
    else state.off[mode] = off.indexOf(tag) >= 0 ? off.filter(t => t !== tag) : off.concat([tag]);
    save();
  }

  // ------------------------------------------------------------- HTML parts

  const runBtn = (cmd, label) => '<button type="button" class="c" data-run="' + esc(cmd) + '">' + esc(label || cmd) + '</button>';
  const fillBtn = (text, label) => '<button type="button" class="c" data-fill="' + esc(text) + '">' + esc(label || text.trim()) + '</button>';
  const acts = (...parts) => '<div class="acts">' + parts.join('') + '</div>';
  const ln = (html, cls) => '<p class="ln' + (cls ? ' ' + cls : '') + '">' + html + '</p>';
  const head = text => '<p class="h">' + esc(text) + '</p>';
  const kv = rows => '<dl class="kv">' + rows.map((r, i) =>
    '<div style="--i:' + (i + 2) + '"><dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd></div>').join('') + '</dl>';
  const pLink = p => '<a class="pl" href="' + esc(problemUrl(p)) + '" target="_blank" rel="noopener"><b>' + esc(label(p)) + '</b>' + esc(p.name) + '</a>';
  const ratingHtml = p => '<span style="color:var(--rk' + L.rankOf(p.rating).color + ')">● ' + (p.rating || 'no rating') + '</span>';

  function openLine(p, trained, fresh) {
    const tags = p.tags.filter(t => !L.IGNORED_TAGS[t]);
    return '<p class="open' + (fresh ? ' unseal' : '') + '">' + ratingHtml(p) +
      tags.map(t => '<span' + (t === trained ? ' class="tr"' : '') + '>' + esc(t) + '</span>').join('') +
      (tags.length ? '' : '<span class="dim">no topics</span>') + '</p>';
  }

  function questCard(q, fresh) {
    const k = q.p.key, uva = isUva(q.p), seal = uva ? '' : SEAL;      // UVa has no ratings and no topics to seal
    let h = '<div class="prob' + (q.status === 'accepted' ? ' acc' : q.status === 'solved' ? ' fin' : '') + '"><p class="pname">' + pLink(q.p) + '</p>';
    if (q.status === 'open') {
      h += seal + ln(esc(SOURCE_TEXT[q.source] + ' You started it ' + rel(q.startedAt) + '.'), 'dim') +
           acts(runBtn('park ' + k), runBtn('spoiled ' + k), runBtn('drop ' + k));
    } else if (q.status === 'accepted') {
      h += seal + ln('Accepted on ' + (uva ? 'UVa' : 'Codeforces') + '. How did you solve it?', 'good') +
           acts(runBtn('clean ' + k), runBtn('hint1 ' + k), runBtn('hint2 ' + k), runBtn('spoiled ' + k)) +
           ln('clean: no hint above level 0, no tags and no editorial. spoiled: you saw the key idea or the solution.', 'dim small');
    } else if (q.status === 'solved') {
      h += (uva ? '' : openLine(q.p, q.tag, fresh)) +
           ln('Solved: ' + esc(L.RESULT_LABEL[q.result] || '') + '.' +
              (q.result === 'spoiled' ? ' It comes back in 7 days for a new try from scratch.' : ''), 'good') +
           (q.tag ? ln('This was training for ' + esc(q.tag) + '.') : '') +
           (q.idea ? ln('Key idea: ' + esc(q.idea)) : ln('Write the key idea in one or two sentences.', 'dim')) +
           acts(fillBtn('idea ' + k + ' ', 'idea ' + k + ' …'), runBtn('log ' + k));
    }
    return h + '</div>';
  }

  const rankSpan = (handle, rating) => '<b style="color:var(--rk' + L.rankOf(rating).color + ')">' + esc(handle) + '</b> ' + (rating || 'no rating');
  const gapText = gap => gap > 0 ? gap + ' above you' : gap < 0 ? -gap + ' below you' : 'level with you';
  const pct = x => x < 0.01 ? 'under 1%' : x > 0.99 ? 'over 99%' : Math.round(x * 100) + '%';

  // 20 cells. The filled cells show a share from 0 to 1.
  function meter(x, label, n) {
    n = n || 20;
    const on = Math.max(x >= 0.005 ? 1 : 0, Math.round(x * n));
    let cells = '';
    for (let i = 0; i < n; i++) cells += '<i' + (i < on ? ' class="on"' : '') + '></i>';
    return '<span class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + Math.round(x * 100) +
      '" aria-label="' + esc(label) + '">' + cells + '</span>';
  }

  function fmtDuration(sec) {
    const m = Math.round(sec / 60), h = Math.floor(m / 60), rest = m % 60;
    return (h ? h + ' h' : '') + (h && rest ? ' ' : '') + (rest || !h ? rest + ' min' : '');
  }

  // ---- the topic table: how often a topic occurs, your rating in it, and a switch for suggest and for train
  const FREQ = [[0.2, 'often', 'fg'], [0.06, 'sometimes', 'fy'], [0, 'rare', 'fx']];
  const bandBtn = (lo, label, aria) => '<button type="button" class="c" data-band="' + lo + '"' +
    (aria ? ' aria-label="' + aria + '"' : '') + '>' + label + '</button>';

  // On a narrow screen the table has no column heads, so each switch shows its command.
  const swText = (mode, on) => '<span class="swl">' + mode + ' </span>' + (on ? 'on' : 'off');

  function sw(tag, mode) {
    const on = topicOn(tag, mode);
    return '<button type="button" class="c sw" data-sw="' + mode + '" data-tag="' + esc(tag) + '" aria-pressed="' + on +
      '" aria-label="' + esc(mode + ' ' + tag) + '">' + swText(mode, on) + '</button>';
  }

  function topicTable(lo) {
    const mine = L.roundLevel(currentLevel());
    lo = Math.max(L.MIN_RATING, Math.min(L.MAX_RATING - 300, lo == null || isNaN(lo) ? mine : lo));
    const band = L.bandShares(data.problems, lo, lo + 300), me = {};
    for (const t of report().topics) me[t.tag] = t;
    const rows = data.tags.map(t => ({ tag: t, share: band.share[t] || 0, me: me[t] }))
      .filter(r => r.share >= 0.01 || (r.me && r.me.rating != null) || !topicOn(r.tag, 'suggest') || !topicOn(r.tag, 'train'))
      .sort((a, b) => (b.share - a.share) || (a.tag < b.tag ? -1 : 1));
    return '<div class="ttable">' +
      '<div class="tband">' + bandBtn(lo - 100, '−', 'Lower rating') + '<span>rated <b>' + lo + '</b> to <b>' + (lo + 300) + '</b>' +
        (lo === mine ? ' (you)' : '') + '</span>' + bandBtn(lo + 100, '+', 'Higher rating') + (lo === mine ? '' : bandBtn(mine, 'my rating')) + '</div>' +
      '<div class="trw th"><span>topic</span><span>how often</span><span>you</span><span>suggest</span><span>train</span><span></span></div>' +
      rows.map(r => {
        const f = FREQ.find(x => r.share >= x[0]);
        return '<div class="trw"><span>' + esc(r.tag) + '</span><span class="fq ' + f[2] + '">' + f[1] + ' ' +
          (r.share < 0.005 ? '<1' : Math.round(100 * r.share)) + '%</span><span>' +
          (r.me && r.me.rating != null ? '<b>' + r.me.rating + '</b>' + (r.me.wins < 3 ? '?' : '') : '<span class="dim">none</span>') + '</span>' +
          sw(r.tag, 'suggest') + sw(r.tag, 'train') +
          '<button type="button" class="c" data-only="' + esc(r.tag) + '" aria-label="' + esc('Train only ' + r.tag) + '">only</button></div>';
      }).join('') +
      '<p class="ln dim small">suggest gives: <span data-live="f-suggest">' + esc(modeText('suggest')) + '</span>.<br>' +
      'train gives: <span data-live="f-train">' + esc(modeText('train')) + '</span>.</p>' +
      '<div class="acts"><button type="button" class="c" data-allon="1">all on</button></div></div>';
  }

  function logoHtml(color) {
    return '<pre class="logo" aria-hidden="true" style="--rk:' + color + '">' + esc(LOGO) + '</pre>';
  }

  const deltaText = (d, tail) => d ? ' <b class="' + (d > 0 ? 'up' : 'down') + '">' + (d > 0 ? '+' : '−') + Math.abs(d) + '</b>' + tail : '';

  // The rating of each common topic, highest first. Green: strong. Red: a gap.
  function topicBars(rep) {
    const list = rep.topics.filter(t => t.common && t.rating != null).sort((a, b) => (b.rating - a.rating) || (a.tag < b.tag ? -1 : 1));
    if (!list.length) return '';
    const lo = 600, hi = Math.max(1600, list[0].rating + 100);
    return '<div class="tbars">' + list.map(t => {
      const color = t.wins < 3 ? 'var(--line)' : t.group === 'strong' ? 'var(--ok)' : t.group === 'gap' ? 'var(--err)' : 'var(--dim)';
      return '<div class="tbar"><span>' + esc(t.tag) + '</span><b>' + t.rating + (t.wins < 3 ? '?' : '') + '</b><span class="bt"><span class="bf" style="width:' +
        Math.max(2, Math.min(100, 100 * (t.rating - lo) / (hi - lo))).toFixed(1) + '%;--c:' + color + '"></span></span><span>' +
        deltaText(t.delta, '') + '</span></div>';
    }).join('') + '</div>' +
      ln('Your rating in each common topic. Green: strong. Red: a gap. ?: fewer than 3 solves. The last column is the change in 30 days. ' +
         runBtn('topics'), 'dim small');
  }

  // The banner: your Codeforces numbers, in the style of fastfetch.
  function banner() {
    const now = nowSec(), rank = L.rankOf(data.rating);
    const rep = report(), sum = L.summary(rep, new Set(state.off.train)), prog = L.progress(data.subs, data.problems, now);
    const open = openQuests(), acc = open.filter(q => q.status === 'accepted').length;
    const marks = openMarks(), due = marks.filter(m => m.dueAt <= now).length, ups = upsolveItems().length;
    const pr = sum.practice;
    const lad = ladder(), next = lad.find(r => r.next);
    const title = state.handle + '@codeforces';
    const rows = [
      ['Rating', data.rating ? '<span class="rk">' + data.rating + ' ' + esc(rank.name) + '</span>' +
                 (data.maxRating ? ' (max ' + data.maxRating + ')' : '') : 'no rating yet'],
      ['Practice', pr.rating != null ? '<b>' + pr.rating + '</b>' + deltaText(pr.delta, ' in 30 days') : 'no results yet'],
      ['Solved', plural(prog.total, 'problem') + ', ' + prog.recent30 + ' in the last 30 days'],
      ['Last AC', prog.lastOk ? esc(rel(prog.lastOk)) : 'none yet'],
      ['Contests', prog.contests + ' live, ' + prog.virtuals + ' virtual'],
      ['Start next', sum.next.length ? sum.next.slice(0, 3).map(t => esc(t.tag)).join(', ') : 'none yet'],
      ['Desk', open.length ? open.length + ' open' + (acc ? ', ' + acc + ' with Accepted' : '') : 'empty'],
      ['Upsolve', ups ? plural(ups, 'problem') : 'nothing'],
      ['Next', esc('suggest at ' + ratingText() + ', ' + filterText())],
      ['Rival', !lad.length ? 'none yet' : !next ? 'you passed all ' + plural(lad.length, 'checkpoint')
        : rankSpan(next.handle, next.rating) + ', ' + gapText(next.gap) + ', ' + next.wins + ' of ' + L.WINS_TO_PASS + ' duel wins' +
          (openDuel() ? ', 1 duel open' : '')]
    ];
    if (state.uva) {
      const ac = data.uvaSubs ? data.uvaSubs.filter(x => x.ok) : [];
      rows.splice(5, 0, ['UVa', !data.uvaSubs ? 'no answer from uHunt'
        : plural(L.solvedKeys(data.uvaSubs).size, 'solved problem') + (ac.length ? ', last AC ' + esc(rel(Math.max.apply(null, ac.map(x => x.time)))) : '')]);
    }
    if (window.CP4) {
      const b = L.cp4Stats(window.CP4, cp4Done()).all;
      if (b.done) rows.splice(rows.length - 2, 0, ['CP4', 'Book 1: ' + b.done + ' of ' + b.total + ' done, ' + b.starsDone + ' of them starred']);
    }
    // The meter: your chance to finish above your next checkpoint in one contest.
    const odds = next ? meter(next.chance, 'Your win chance against ' + next.handle) + esc(pct(next.chance)) + ' win chance'
      : '<span class="dim">' + (lad.length ? 'Add a stronger rival for a new checkpoint.' : 'Add a rival, and this line shows your win chance.') + '</span> ' +
        fillBtn('rival add ', 'rival add …');
    return '<div class="fetch" style="--rk:var(--rk' + rank.color + ')">' + logoHtml('var(--rk' + rank.color + ')') +
      '<div class="rise"><p class="ftitle"><span class="rk">' + esc(state.handle) + '</span>@codeforces</p>' +
      '<p class="frule" aria-hidden="true" style="--i:1">' + '-'.repeat(title.length) + '</p>' + kv(rows) +
      '<p class="odds" style="--i:' + (rows.length + 2) + '">' + odds + '</p>' + topicBars(rep) + '</div></div>';
  }

  function bannerTail() {
    return openQuests().filter(q => q.status === 'accepted').map(q => questCard(q)).join('') +
      ln('Type a command, or select one below. ' + runBtn('help') + ' shows every command.', 'dim');
  }

  const loadingBanner = () => '<div class="fetch">' + logoHtml('var(--dim)') +
    '<div><p class="ftitle">' + esc(state.handle) + '@codeforces</p><p class="ln dim">Loading from Codeforces…</p></div></div>';

  const welcome = () => logoHtml('var(--accent)') +
    ln('<b>niel-trains</b> gives you one Codeforces problem at a time.') +
    ln('The rating and the topics stay sealed until you solve the problem. There are no deadlines and no streaks.') +
    ln('Type your Codeforces handle, then press Enter.', 'good') +
    ln('niel-trains reads your public submissions from Codeforces. It saves your data only in this browser.', 'dim small');

  function showWelcome(before) {
    const el = addEntry(null);
    el.classList.add('intro');
    el.querySelector('.body').innerHTML = before + welcome();
  }

  // --------------------------------------------------------------- commands

  function need(io) {
    if (ready()) return true;
    if (ui.busy) io.err('niel-trains loads your data now. Try again in a moment.');
    else io.print(ln('Your data is not loaded.', 'err') + acts(runBtn('refresh')));
    return false;
  }

  const busy = io => io.err('niel-trains is busy with Codeforces. Try again in a moment.');
  const badId = text => 'niel-trains cannot read the problem "' + text + '". Use a form such as 1277B.';

  function keyFrom(io, text) {
    const num = L.parseUva(text);
    if (num) return 'uva' + num;
    const id = L.parseProblemId(text);
    if (!id) { io.err(badId(text)); return null; }
    return id.cid + id.idx;
  }

  const findProblem = key => data.byKey.get(key) || (data.subs.find(s => s.key === key) || {}).p || null;

  function deskRoom(io) {
    if (openQuests().length < state.maxOpen) return true;
    io.print(ln('Your desk is full. Finish a problem or put one away first.', 'err') + acts(runBtn('desk'), runBtn('limit')));
    return false;
  }

  function chooseOne(io, name, pool) {
    io.print(ln('More than one problem fits. Add the problem to the command.') + acts(...pool.map(q => runBtn(name + ' ' + q.p.key))));
  }

  function cmdGet(io, rest, mode) {
    if (!need(io)) return;
    const word = mode === 'training' ? 'train' : 'suggest';
    const a = L.parseGetArgs(rest, data.tags);
    if (a.errors.length) {
      a.errors.forEach(e => io.err(e));
      return io.print(ln('Use: ' + esc(word + ' ' + BY_NAME[word].args), 'dim') + acts(runBtn('help ' + word)));
    }
    if (!deskRoom(io)) return;
    const band = a.exact != null ? { lo: a.exact, hi: a.exactHi || a.exact }
      : a.delta != null ? L.targetBand(currentLevel(), a.delta, a.deltaHi) : defaultBand();
    // "with" replaces your included topics for this one problem. "without" adds to your excluded topics.
    const sws = word === 'train' ? 'train' : 'suggest';
    const include = new Set(a.include || state.only[sws]), exclude = new Set(state.off[sws].concat(a.exclude || []));
    const hadInclude = include.size > 0;
    for (const t of a.include || []) if (!(a.exclude || []).includes(t)) exclude.delete(t);
    for (const t of a.exclude || []) include.delete(t);
    if (hadInclude && !include.size) return io.err('These filters leave no topic. Change the topics, or run unfilter all.');
    let requireTag = null;
    if (mode === 'training') {
      requireTag = L.pickWeakTag(L.weakTags(report(), include, exclude, 6));
      if (!requireTag) return io.err('No topic fits your topic filters. Remove a filter, then try again.');
    }
    const s = seen();
    const p = L.pickProblem(data.problems, { lo: band.lo, hi: band.hi, skipKeys: s.keys, skipNames: s.names,
      include: mode === 'training' ? null : include, exclude: exclude, requireTag: requireTag });
    if (!p) return io.err('No new problem fits this rating and these topics. Change the rating or remove a topic filter.');
    io.print(questCard(addQuest(p, mode, requireTag)) +
      ln('Open the problem and solve it at your own speed. After Codeforces shows Accepted, run ' + runBtn('check'), 'dim'));
  }

  async function startUva(io, num) {
    const key = 'uva' + num;
    if (!state.uva) {
      return io.print(ln('Set your UVa username first. niel-trains then sees your UVa verdicts.', 'err') + acts(fillBtn('uva ', 'uva …')));
    }
    if (openQuests().some(q => q.p.key === key)) return io.err('UVa ' + num + ' is already on your desk.');
    if (!deskRoom(io)) return;
    if (ui.busy) return busy(io);
    ui.busy = true;
    live('Asking uHunt for UVa ' + num + '…');
    try {
      const p = L.uvaProblemFromApi(await uhunt('p/num/' + num, true));
      if (!p) io.err('UVa has no problem ' + num + '.');
      else if (!p.open) io.err('UVa ' + num + ' is not available on the judge now.');
      else {
        if (!data.uvaSubs) await loadUva();
        const mark = state.marks.find(m => !m.doneAt && m.p.key === key);
        const q = addQuest(p, mark ? 'resolve' : 'start', null, mark ? mark.id : null);
        io.print(questCard(q) + (q.wasSolved ? ln('You solved this problem before. Only a new Accepted counts.', 'dim') : '') +
          ln('UVa has no ratings and no topics. After UVa shows Accepted, run ' + runBtn('check'), 'dim'));
      }
    } catch (e) { io.err(e.message); }
    ui.busy = false;
    live('');
  }

  function cmdStart(io, rest) {
    if (!need(io)) return;
    if (!rest.trim()) {
      return io.print(ln('Use: start &lt;problem or link&gt;. For example: start 1277B, or start uva 100') +
        acts(fillBtn('start ', 'start …'), fillBtn('start uva ', 'start uva …'), runBtn('upsolve'), runBtn('resolve')));
    }
    const num = L.parseUva(rest);
    if (num) return startUva(io, num);
    const key = keyFrom(io, rest);
    if (!key) return;
    const p = findProblem(key);
    if (!p) return io.err('Problem ' + key + ' is not in the Codeforces problem list.');
    if (openQuests().some(q => q.p.key === key)) return io.err(key + ' is already on your desk.');
    if (!deskRoom(io)) return;
    const mark = state.marks.find(m => !m.doneAt && m.p.key === key);
    const source = mark ? 'resolve' : upsolveItems().some(x => x.p.key === key) ? 'upsolve' : 'start';
    io.print(questCard(addQuest(p, source, null, mark ? mark.id : null)) +
      ln('After Codeforces shows Accepted, run ' + runBtn('check'), 'dim'));
  }

  function cmdDesk(io, rest) {
    if (!need(io)) return;
    const size = /^size\b\s*(.*)$/i.exec((rest || '').trim());
    if (size) return cmdLimit(io, size[1]);
    const open = openQuests();
    if (!open.length) return io.print(ln('Your desk is empty.') + acts(runBtn('suggest'), runBtn('train'), runBtn('upsolve')));
    io.print(ln(open.length + ' of ' + state.maxOpen + ' places are in use.', 'dim') + open.map(q => questCard(q)).join('') +
      (open.some(q => q.status === 'open') ? ln('After a judge shows Accepted for a problem, run ' + runBtn('check'), 'dim') : ''));
  }

  async function cmdCheck(io) {
    if (!need(io)) return;
    if (ui.busy) return busy(io);
    ui.busy = true;
    live('Checking Codeforces…');
    try {
      mergeSubs(toSubs(await api('user.status', { handle: state.handle, from: 1, count: 200 })));
      if (state.uva && (openQuests().some(q => isUva(q.p)) || state.marks.some(m => !m.doneAt && isUva(m.p)))) {
        live('Checking UVa…');
        try { await refreshUva(); } catch (e) { io.err(e.message); }
      }
      const found = matchAccepted();
      const waiting = openQuests().filter(q => q.status === 'accepted');
      const d = openDuel(), inDuel = d && myDuelResult(d);
      for (const m of found.marks) io.print(ln(esc(label(m.p)) + ' has a new Accepted. It leaves your re-solve list.', 'good'));
      if (waiting.length) io.print(waiting.map(q => questCard(q)).join(''));
      else if (!found.marks.length && !inDuel) {
        io.print(ln(openQuests().length ? 'No new Accepted yet. A judge can need a minute to show a new verdict.'
                                        : 'No new Accepted. Your desk is empty.'));
      }
      if (inDuel) io.print(settleDuel(d));
    } catch (e) { io.err(e.message); }
    ui.busy = false;
    live('');
  }

  // clean, hint1, hint2 and spoiled.
  function cmdResult(io, rest, name) {
    if (!need(io)) return;
    const open = openQuests();
    let q = null, key = null;
    if (rest.trim()) {
      key = keyFrom(io, rest);
      if (!key) return;
      q = open.find(x => x.p.key === key);
    } else {
      const pool = name === 'spoiled' ? open : open.filter(x => x.status === 'accepted');
      if (pool.length > 1) return chooseOne(io, name, pool);
      if (!pool.length) {
        return io.print(ln(!open.length ? 'Your desk is empty. To set a result for a different problem, add its ID.'
                                        : 'No problem on your desk has Accepted yet.', 'err') + (open.length ? acts(runBtn('check')) : ''));
      }
      q = pool[0]; key = q.p.key;
    }
    if (q && q.status === 'accepted') { chooseResult(q, name); return io.print(questCard(q, true) + gainHtml(q.p)); }
    if (q && name === 'spoiled') {
      putAway(q, 'spoiled');
      return io.print(ln('<b>' + esc(show(key)) + '</b> is spoiled. Write the code yourself now. It comes back in 7 days for a new try from scratch.'));
    }
    if (q) return io.print(ln('No Accepted for ' + esc(show(key)) + ' yet.', 'err') + acts(runBtn('check')));
    const done = solvedQuests().find(x => x.p.key === key);
    if (done) {
      chooseResult(done, name);
      return io.print(ln('The result of <b>' + esc(show(key)) + '</b> is now ' + esc(L.RESULT_LABEL[name]) + '.') + questCard(done) +
                      gainHtml(done.p));
    }
    if (name !== 'spoiled') return io.err(show(key) + ' is not on your desk.');
    if (/^uva\d+$/.test(key)) return io.err(show(key) + ' is not on your desk. Start it first: start uva ' + key.slice(3));
    const p = findProblem(key);
    if (!p) return io.err('Problem ' + key + ' is not in the Codeforces problem list.');
    addMark(p, 'spoiled'); save();
    io.print(ln('<b>' + esc(show(key)) + '</b> is marked spoiled. It comes back in 7 days.'));
  }

  function cmdPutAway(io, rest, kind) {
    if (!need(io)) return;
    const name = kind === 'parked' ? 'park' : 'drop';
    const open = openQuests();
    let q = null, key = null;
    if (rest.trim()) {
      key = keyFrom(io, rest);
      if (!key) return;
      q = open.find(x => x.p.key === key);
    } else {
      const pool = open.filter(x => x.status === 'open');
      if (pool.length > 1) return chooseOne(io, name, pool);
      if (!pool.length) return io.err('No open problem is on your desk.');
      q = pool[0]; key = q.p.key;
    }
    if (q && q.status === 'accepted') {
      return io.print(ln(esc(show(key)) + ' has Accepted. Choose a result.', 'err') +
        acts(runBtn('clean ' + key), runBtn('hint1 ' + key), runBtn('hint2 ' + key), runBtn('spoiled ' + key)));
    }
    if (q) {
      putAway(q, kind);
      return io.print(ln('<b>' + esc(show(key)) + '</b> ' + (kind === 'parked' ? 'is parked. It comes back in 30 days.' : 'is off your desk. It does not come back.')));
    }
    if (kind !== 'parked') return io.err(show(key) + ' is not on your desk.');
    if (/^uva\d+$/.test(key)) return io.err(show(key) + ' is not on your desk. Start it first: start uva ' + key.slice(3));
    const p = findProblem(key);
    if (!p) return io.err('Problem ' + key + ' is not in the Codeforces problem list.');
    addMark(p, 'parked'); save();
    io.print(ln('<b>' + esc(show(key)) + '</b> is marked parked. It comes back in 30 days.'));
  }

  // The solved problem for idea and log: the one that you name, or the latest one.
  function solvedFor(io, rest) {
    const solved = solvedQuests();
    if (!solved.length) { io.err('No solved problem yet. This command works after you set a result.'); return null; }
    const m = /^(\S+)\s*([\s\S]*)$/.exec(rest.trim());
    if (m && /^(\d{1,6}[a-z]\d?|uva\d{1,5}|https?:\/\/\S+)$/i.test(m[1])) {
      const num = L.parseUva(m[1]), id = num ? null : L.parseProblemId(m[1]);
      const key = num ? 'uva' + num : id ? id.cid + id.idx : null;
      const hit = key && solved.find(x => x.p.key === key);
      if (hit) return { q: hit, text: m[2].trim() };
    }
    return { q: solved[0], text: rest.trim() };
  }

  function cmdIdea(io, rest) {
    if (!need(io)) return;
    const r = solvedFor(io, rest);
    if (!r) return;
    const k = r.q.p.key;
    if (!r.text) {
      return io.print(ln(r.q.idea ? 'Key idea of <b>' + esc(show(k)) + '</b>: ' + esc(r.q.idea) : '<b>' + esc(show(k)) + '</b> has no key idea yet.') +
        acts(fillBtn('idea ' + k + ' ', 'idea ' + k + ' …')));
    }
    r.q.idea = r.text.slice(0, 600);
    save();
    io.print(ln('Saved the key idea of <b>' + esc(show(k)) + '</b>.') + acts(runBtn('log ' + k)));
  }

  async function cmdLog(io, rest) {
    if (!need(io)) return;
    const r = solvedFor(io, rest);
    if (!r) return;
    const q = r.q;
    const row = L.logRow({ date: localDate(q.endedAt), key: label(q.p), name: q.p.name, result: q.result, idea: q.idea });
    const ok = await copy(row);
    io.print(ln(ok ? 'Copied. Paste the row into your log sheet.' : 'niel-trains cannot use the clipboard here. Select the row and copy it by hand.') +
      '<pre class="code">' + esc(row) + '</pre>' +
      (q.idea ? '' : ln('This row has no key idea.', 'dim') + acts(fillBtn('idea ' + q.p.key + ' ', 'idea ' + q.p.key + ' …'))));
  }

  async function cmdFetch(io, rest, name) {
    if (!ready() || name === 'refresh' || nowSec() - (data.at || 0) > 600) {
      if (ui.busy) return busy(io);
      if (name === 'refresh') for (const r of state.rivals) r.missing = false;
      io.set(loadingBanner());
      const res = await loadAll();
      data.at = nowSec();
      if (res.error) return io.set(ln(esc(res.error), 'err') + acts(runBtn('refresh'), runBtn('handle')));
    }
    io.set(banner() + bannerTail());
  }

  // After a result: the change of your practice rating and of the topic ratings of that problem.
  function gainHtml(p) {
    const full = (p && data.byKey.get(p.key)) || p;
    if (!full || full.rating == null || !data.subs) return '';
    const before = pendingKeys();
    before.add(full.key);
    const a = L.topicReport(reportInput({ pending: before, compareDays: 0 })), b = L.topicReport(reportInput({ compareDays: 0 }));
    const old = {};
    for (const t of a.topics) old[t.tag] = t;
    const line = (x, y) => y.rating == null ? 'no result'
      : x.rating == null ? 'first result: <b>' + y.rating + '</b>'
      : y.rating !== x.rating ? x.rating + ' → <b>' + y.rating + '</b>' + deltaText(y.rating - x.rating, '')
      : '<b>' + y.rating + '</b>, no change';
    const rows = [['practice', line(a.practice, b.practice)]];
    for (const t of b.topics) if ((full.tags || []).indexOf(t.tag) >= 0) rows.push([t.tag, line(old[t.tag] || { rating: null }, t)]);
    return '<div class="gain">' + kv(rows) + '</div>';
  }

  function cmdTopics(io, rest) {
    if (!need(io)) return;
    const rep = report(), sum = L.summary(rep, new Set(state.off.train)), pr = rep.practice;
    const names = (list, rated) => list.length ? list.map(t => esc(t.tag) + (rated ? ' <b>' + t.rating + '</b>' : '')).join(', ')
                                               : '<span class="dim">none</span>';
    io.print(ln('Your rating is <b>' + (data.rating || 'not set yet') + '</b>. Your practice rating is ' +
        (pr.rating != null ? '<b>' + pr.rating + '</b>' + deltaText(pr.delta, ' in 30 days') + ', from ' + plural(pr.n, 'result') + '.'
                           : 'not ready. It needs one result.')) +
      kv([['strong', names(sum.strong, true)], ['on level', names(sum.level, true)], ['gaps', names(sum.gaps)], ['start next', names(sum.next)]]) +
      acts(runBtn('train'), sum.next.length ? fillBtn('train with ' + sum.next.slice(0, 3).map(t => t.tag).join(', ')) : '', runBtn('days')) +
      (rep.level < 1400 ? ln('Below 1400, your plan puts three skills first: direct simulation, brute force, and case work on paper. ' +
                             'New topics come second.', 'dim small') : '') +
      topicTable(parseInt(rest, 10)) +
      ln('how often: the share of the Codeforces problems in that rating range with the topic. − and + move the range. ' +
         'suggest and train always use your own rating.', 'dim small') +
      ln('you: your practice rating in the topic, from ' + periodName() + '. ?: fewer than 3 solves. ' +
         'A contest problem counts in full. A solve outside a contest counts as a problem 200 easier, with half the weight. ' +
         'A result loses half of its weight each 180 days.', 'dim small') +
      ln('strong: 3 or more solves, and 75 or more above your practice rating. gaps: often or sometimes near your rating, and lower or with fewer than 3 solves. ' +
         'only: train gives that topic and no other. These numbers are estimates.', 'dim small'));
  }

  function cmdProgress(io) {
    if (!need(io)) return;
    const pr = L.progress(data.subs, data.problems, nowSec());
    if (!pr.total) return io.print(ln('No solved problems yet.'));
    const max = Math.max(pr.unrated, ...pr.buckets.map(b => b.n));
    const bar = (label, n, color) => '<div class="bar"><span class="bl">' + label + '</span><span class="bt"><span class="bf" style="width:' +
      (100 * n / max).toFixed(1) + '%;--c:' + color + '"></span></span><span>' + n + '</span></div>';
    let h = head('Solved by rating');
    for (const b of pr.buckets) h += bar(b.lo + '-' + b.hi, b.n, 'var(--rk' + L.rankOf(b.lo).color + ')');
    if (pr.unrated) h += bar('no rating', pr.unrated, 'var(--line)');
    h += kv([
      ['total', pr.total + ' solved, ' + pr.unsolved + ' tried and not solved'],
      ['recent', pr.recent7 + ' in the last 7 days, ' + pr.recent30 + ' in the last 30 days'],
      ['contests', pr.contests + ' live, ' + pr.virtuals + ' virtual'],
      ['most practiced', pr.topics.slice(0, 8).map(t => esc(t.tag) + ' ' + t.n).join(', ')],
      ['harder so far', pr.harder.length ? pr.harder.slice(0, 5).map(x => esc(x.tag) + ' ' + x.solved + ' of ' + x.tried).join(', ') : 'none']
    ]) + ln('harder so far: topics where you solved fewer than half of the problems that you tried.', 'dim small');
    io.print(h);
  }

  function cmdUpsolve(io, rest) {
    if (!need(io)) return;
    const items = upsolveItems(), shown = rest.trim().toLowerCase() === 'all' ? items : items.slice(0, 12);
    if (!items.length) return io.print(ln('Nothing to upsolve.'));
    let h = ln('Problems from your contests, live and virtual, that you did not solve. <span class="star">★</span> is the easiest one of its contest. Start there.', 'dim');
    for (const x of shown) {
      h += '<div class="row"><span class="main">' + (x.first ? '<span class="star" role="img" aria-label="Easiest unsolved problem of this contest">★</span> ' : '') +
           pLink(x.p) + '<br><span class="dim small">' + (x.attempted ? 'You tried it.' : 'You did not try it.') +
           ' Your last contest submission was ' + esc(rel(x.time)) + '.</span></span>' + runBtn('start ' + x.p.key) + '</div>';
    }
    if (items.length > shown.length) h += acts(runBtn('upsolve all', 'upsolve all (' + items.length + ')'));
    io.print(h + ln('An upsolve has no timer. Use your hint ladder before the editorial.', 'dim small'));
  }

  function cmdResolve(io) {
    if (!need(io)) return;
    const now = nowSec(), marks = openMarks();
    const rule = ln('A spoiled problem comes back after 7 days. A parked problem comes back after 30 days. Solve each one again from scratch.', 'dim small');
    if (!marks.length) return io.print(ln('Nothing to solve again.') + rule);
    let h = '';
    for (const m of marks) {
      const kind = (m.kind === 'spoiled' ? 'Spoiled ' : 'Parked ') + rel(m.markedAt) + '.';
      const isDue = m.dueAt <= now, onDesk = state.quests.some(q => q.markId === m.id && isOpen(q));
      h += '<div class="row"><span class="main">' + pLink(m.p) + '<br><span class="small">' +
           (isDue ? '<span class="good">Due now.</span> ' : '') + '<span class="dim">' + esc(kind + (isDue ? '' : ' It comes back ' + rel(m.dueAt) + '.')) +
           '</span></span></span>' + (onDesk ? '<span class="dim small">on your desk</span>' : isDue ? runBtn('start ' + m.p.key) : '') + '</div>';
    }
    io.print(h + rule + ln('To mark a problem from outside niel-trains, add its ID: spoiled 1277B, or park 1277B.', 'dim small'));
  }

  function cmdHistory(io) {
    if (!need(io)) return;
    const done = state.quests.filter(q => q.status === 'solved' || q.status === 'parked' || q.status === 'spoiled')
      .sort((a, b) => b.endedAt - a.endedAt).slice(0, 30);
    if (!done.length) return io.print(ln('No finished problems yet.'));
    let h = '';
    for (const q of done) {
      const what = q.status === 'solved' ? 'Solved: ' + (L.RESULT_LABEL[q.result] || '') : q.status === 'parked' ? 'Parked' : 'Spoiled';
      h += '<div class="row"><span class="main">' + pLink(q.p) + '<br><span class="dim small">' + esc(what + ', ' + localDate(q.endedAt) + '.') + '</span>' +
           (q.status === 'solved' && !isUva(q.p) ? openLine(q.p, q.tag) : '') + (q.idea ? '<span class="small">' + esc(q.idea) + '</span>' : '') + '</span>' +
           (q.status === 'solved' ? runBtn('log ' + q.p.key) : '') + '</div>';
    }
    io.print(h);
  }

  function cmdRating(io, rest) {
    const t = rest.trim().toLowerCase();
    if (t) {
      const a = /with/.test(t) ? { errors: [1] } : L.parseGetArgs(t, []);
      if (a.errors.length) return io.err('Use a rating such as 1200, a step from your level such as +200, a range such as +100..+200, or the word level.');
      const lim = x => Math.max(-400, Math.min(1000, x));
      if (a.exact != null) { state.ratingMode = 'exact'; state.exact = a.exact; state.exactHi = a.exactHi || null; }
      else { state.ratingMode = 'delta'; state.delta = lim(a.delta); state.deltaHi = a.deltaHi == null ? null : lim(a.deltaHi); }
      save();
    }
    io.print(ln('suggest and train give problems at ' + esc(ratingText()) + '.') +
      acts(runBtn('target +100'), runBtn('target +100..+200'), runBtn('target +200'), runBtn('target +300'), fillBtn('target 1200')));
  }

  const filterLine = () => ln('suggest and train use: <span data-live="filters">' + esc(filterText()) + '</span>.');

  const cmdFilters = io => cmdTopics(io, '');

  function cmdFilterSet(io, rest, name) {
    if (!need(io)) return;
    if (!rest.trim()) return cmdFilters(io);
    const r = L.resolveTopics(rest, data.tags);
    if (r.errors.length) return r.errors.forEach(e => io.err(e));
    const to = name === 'include' ? 'only' : 'off', from = name === 'include' ? 'off' : 'only';
    for (const m of MODES) for (const t of r.tags) {
      state[from][m] = state[from][m].filter(x => x !== t);
      if (state[to][m].indexOf(t) < 0) state[to][m] = state[to][m].concat([t]);
    }
    save();
    io.print(filterLine());
  }

  function cmdUnfilter(io, rest) {
    if (!need(io)) return;
    const t = rest.trim().toLowerCase();
    if (!t) return cmdFilters(io);
    let gone = null;
    if (t !== 'all') {
      const r = L.resolveTopics(rest, data.tags);
      if (r.errors.length) return r.errors.forEach(e => io.err(e));
      gone = new Set(r.tags);
    }
    for (const m of MODES) for (const k of ['only', 'off']) state[k][m] = gone ? state[k][m].filter(x => !gone.has(x)) : [];
    save();
    io.print(filterLine());
  }

  function cmdPeriod(io, rest) {
    const t = rest.trim().toLowerCase();
    if (t) {
      if (t !== '90' && t !== '365' && t !== 'all') return io.err('Use 90, 365 or all.');
      state.windowDays = t === 'all' ? 0 : Number(t);
      save();
    }
    io.print(ln('The topic levels count solves from ' + periodName() + '.') + acts(runBtn('period 90'), runBtn('period 365'), runBtn('period all')));
  }

  function cmdLevel(io, rest) {
    const t = rest.trim().toLowerCase();
    if (t) {
      if (t === 'auto') state.levelOverride = null;
      else if (/^\d+$/.test(t) && Number(t) >= L.MIN_RATING && Number(t) <= L.MAX_RATING) state.levelOverride = Math.round(Number(t) / 100) * 100;
      else return io.err('Use a number from 800 to 3500, or auto.');
      save();
    }
    io.print(ln('Your level is <b>' + L.roundLevel(currentLevel()) + '</b>. ' + esc(levelFrom())) + acts(runBtn('level auto'), fillBtn('level ', 'level …')));
  }

  function cmdLimit(io, rest) {
    const t = rest.trim();
    if (t) {
      if (!/^[1-5]$/.test(t)) return io.err('Use a number from 1 to 5.');
      state.maxOpen = Number(t);
      save();
    }
    io.print(ln('Your desk has room for ' + plural(state.maxOpen, 'open problem') + '.') + acts(...[1, 2, 3, 4, 5].map(n => runBtn('desk size ' + n))));
  }

  async function cmdHandle(io, rest) {
    const h = rest.trim();
    if (!h) {
      return io.print(state.handle ? ln('Your handle is <b>' + esc(state.handle) + '</b>.') + acts(fillBtn('handle ', 'handle …'))
                                   : ln('Type your Codeforces handle, then press Enter.'));
    }
    if (!HANDLE_RE.test(h)) return io.err('A Codeforces handle has 3 to 24 characters: letters, digits, "_", "." and "-".');
    if (ui.busy) return busy(io);
    const old = { handle: state.handle, subs: data.subs, rating: data.rating, maxRating: data.maxRating };
    state.handle = h; data.subs = null; data.rating = null; data.maxRating = null;
    io.set(loadingBanner());
    const res = await loadAll();
    if (res.error) {
      state.handle = old.handle; data.subs = old.subs; data.rating = old.rating; data.maxRating = old.maxRating;
      return io.set(ln(esc(res.error), 'err') + (old.handle ? ln('Your handle is still ' + esc(old.handle) + '.', 'dim') : ''));
    }
    for (const el of $out.querySelectorAll('.entry.intro')) el.remove();
    io.set(banner() + bannerTail());
  }

  function uvaSummary() {
    const subs = data.uvaSubs;
    if (!subs) return ln('uHunt did not answer, so your UVa submissions are not loaded.', 'err') + acts(runBtn('refresh'));
    const last = subs.filter(x => x.ok).reduce((m, x) => Math.max(m, x.time), 0);
    return ln('UVa username: <b>' + esc(state.uva.uname) + '</b>' + (data.uvaName ? ' (' + esc(data.uvaName) + ')' : '') + '. ' +
              plural(L.solvedKeys(subs).size, 'solved problem') + ', ' + plural(subs.length, 'submission') + '.' +
              (last ? ' The last Accepted was ' + esc(rel(last)) + '.' : '')) +
      ln('To start a UVa problem, give its number: start uva 100. CP4 writes that problem as UVa 00100.', 'dim') +
      acts(fillBtn('start uva ', 'start uva …'), runBtn('uva off'));
  }

  async function cmdUva(io, rest) {
    const t = rest.trim();
    if (!t) {
      return io.print(state.uva ? uvaSummary()
        : ln('niel-trains can check UVa problems through uHunt. Set your UVa username first.') + acts(fillBtn('uva ', 'uva …')));
    }
    if (t.toLowerCase() === 'off') {
      state.uva = null; data.uvaSubs = null; data.uvaName = '';
      save();
      return io.print(ln('The UVa username is removed. Your UVa problems stay in your history.'));
    }
    if (!/^[^\s\/]{1,40}$/.test(t)) return io.err('"' + t + '" is not a UVa username.');
    if (ui.busy) return busy(io);
    ui.busy = true;
    live('Asking uHunt for ' + t + '…');
    try {
      const uid = Number(await uhunt('uname2uid/' + encodeURIComponent(t), true));
      if (!uid) io.err('uHunt does not know the UVa username "' + t + '". Use the username of your UVa account, not your full name.');
      else {
        state.uva = { uname: t, uid: uid };
        save();
        await loadUva();
        matchAccepted();
        io.print(uvaSummary());
      }
    } catch (e) { io.err(e.message); }
    ui.busy = false;
    live('');
  }

  // ------------------------------------------------------- CP4 Book 1 list

  // UVa numbers with Accepted on the judge. This needs your UVa username and the problem list of uHunt.
  function uvaSolvedNums() {
    const out = new Set();
    if (!data.uvaSubs || !data.uvaList) return out;
    for (const x of data.uvaSubs) {
      const num = x.ok && data.uvaList.byPid.get(Number(x.key.slice(4)));
      if (num) out.add(num);
    }
    return out;
  }

  // A problem of the list is done with your mark, or with Accepted on UVa.
  function cp4Done() {
    const auto = uvaSolvedNums();
    return key => !!state.cp4[key] || (key[0] === 'u' && auto.has(Number(key.slice(1))));
  }

  const cnt = x => x.done + ' of ' + x.total;

  function cp4Row(it, done) {
    const on = done(it.key), auto = on && !state.cp4[it.key];
    let name, text;
    if (it.kind === 'uva') {
      const info = data.uvaList && data.uvaList.byNum.get(it.id);
      const url = info ? problemUrl({ oj: 'uva', pid: info.pid }) : 'https://onlinejudge.org/external/' + Math.floor(it.id / 100) + '/' + it.id + '.pdf';
      text = 'UVa ' + it.id;
      name = '<a class="pl" href="' + esc(url) + '" target="_blank" rel="noopener"><b>' + text + '</b>' + esc(info ? info.title : '') + '</a>';
    } else if (it.kind === 'kattis') {
      text = 'Kattis ' + it.id;
      name = '<a class="pl" href="https://open.kattis.com/problems/' + esc(it.id) + '" target="_blank" rel="noopener"><b>Kattis</b>' + esc(it.id) + '</a>';
    } else {
      text = it.id;
      name = '<span>' + esc(it.id) + '</span>';
    }
    return '<div class="pr"><button type="button" class="ck" data-ck="' + esc(it.key) + '" aria-pressed="' + on + '"' +
      (auto ? ' data-auto="1" title="Accepted on UVa"' : '') + ' aria-label="' + esc(text) + ' is done">' + (on ? '[x]' : '[ ]') + '</button><span>' + name +
      (it.star ? ' <span class="star" role="img" aria-label="starred">★</span>' : '') +
      (it.entry ? ' <span class="dim small">entry level</span>' : '') + (auto ? ' <span class="good small">Accepted on UVa</span>' : '') + '</span></div>';
  }

  function cp4CatHtml(cat, st, done, open) {
    const items = L.cp4Items(cat), top = items.filter(it => it.star || it.entry), more = items.filter(it => !(it.star || it.entry));
    return '<div class="cat"><p class="h"><span class="sc">' + cat.id + '</span>' + esc(cat.title) +
      ' <span class="dim" data-cnt="' + cat.id + '">' + cnt(st.by[cat.id]) + '</span></p>' + top.map(it => cp4Row(it, done)).join('') +
      (more.length ? '<details class="more"' + (open ? ' open' : '') + '><summary>' + plural(more.length, 'more problem') + '</summary>' +
                     more.map(it => cp4Row(it, done)).join('') + '</details>' : '') + '</div>';
  }

  function cp4Overview(book, only) {
    const st = L.cp4Stats(book, cp4Done());
    let h = only ? '' : ln('<b>' + esc(book.book) + '</b>: <span data-cnt="all">' + cnt(st.all) + '</span> problems done. Starred: <span data-cnt="all*">' +
                           st.all.starsDone + ' of ' + st.all.stars + '</span>.') +
                        ln('Categories with 3 or more done: <span data-cnt="cats3">' + st.cats3 + '</span> of ' + st.cats +
                           '. The book names 3 problems for each category as a first target.', 'dim');
    for (const ch of book.chapters) {
      if (only && ch !== only) continue;
      h += '<p class="h">Chapter ' + ch.n + ': ' + esc(ch.title) + ' <span class="dim" data-cnt="' + ch.n + '">' + cnt(st.by[ch.n]) + '</span></p>';
      for (const sec of ch.sections) {
        const x = st.by[sec.code];
        h += '<div class="row"><span class="main"><span class="sc">' + sec.code + '</span><b>' + esc(sec.title) + '</b><br><span class="dim small">' +
             meter(x.total ? x.done / x.total : 0, 'Done in section ' + sec.code, 10) + '<span data-cnt="' + sec.code + '">' + cnt(x) + '</span>, ' +
             sec.cats.length + (sec.cats.length === 1 ? ' category' : ' categories') + '</span></span>' + runBtn('cp4 ' + sec.code) + '</div>';
      }
    }
    return h + ln('Sections 1.4 to 4.6 have the exercise lists of the book. A section with no list is not here.', 'dim small');
  }

  let cp4Note = '';

  async function cmdCp4(io, rest) {
    const book = window.CP4;
    if (!book) return io.err('The file cp4.js is missing. Upload it next to index.html.');
    const t = rest.trim().toLowerCase();
    if (!data.uvaList && !ui.busy) {            // the names of the UVa problems. The list also works without them.
      ui.busy = true;
      try { await loadUvaList(); cp4Note = ''; } catch (e) { cp4Note = 'uHunt did not answer, so the UVa problems have no names now.'; }
      ui.busy = false;
      live('');
    }
    const note = (cp4Note ? ln(esc(cp4Note), 'dim small') : '') +
      (state.uva ? '' : ln('Set your UVa username with ' + fillBtn('uva ', 'uva …') + ' and the UVa problems get their marks from the judge.', 'dim small'));
    if (!t) return io.print(cp4Overview(book) + note);
    const hit = L.cp4Find(book, t);
    if (!hit) {
      return io.print(ln('CP4 Book 1 has no part "' + esc(t) + '". Use a chapter (1), a section (1.4) or a category (1.4a).', 'err') + acts(runBtn('cp4')));
    }
    if (!hit.section) return io.print(cp4Overview(book, hit.chapter) + acts(runBtn('cp4')));
    const done = cp4Done(), st = L.cp4Stats(book, done), sec = hit.section;
    const cats = hit.cat ? [hit.cat] : sec.cats;
    io.print(ln('<b>' + sec.code + ' ' + esc(sec.title) + '</b>: <span data-cnt="' + sec.code + '">' + cnt(st.by[sec.code]) + '</span> done.') +
      ln('Select [ ] to mark a problem as done. <span class="star">★</span> is a starred problem of the book. The hints are in the book.', 'dim small') +
      cats.map(c => cp4CatHtml(c, st, done, !!hit.cat)).join('') + note + acts(runBtn('cp4'), hit.cat ? runBtn('cp4 ' + sec.code) : ''));
  }

  function syncCp4() {
    if (!window.CP4 || !document.querySelector('[data-ck], [data-cnt]')) return;
    const done = cp4Done(), st = L.cp4Stats(window.CP4, done);
    for (const el of document.querySelectorAll('[data-ck]')) {
      const on = done(el.dataset.ck);
      el.setAttribute('aria-pressed', String(on));
      el.textContent = on ? '[x]' : '[ ]';
    }
    for (const el of document.querySelectorAll('[data-cnt]')) {
      const k = el.dataset.cnt;
      el.textContent = k === 'cats3' ? st.cats3 : k === 'all*' ? st.all.starsDone + ' of ' + st.all.stars : cnt(k === 'all' ? st.all : st.by[k]);
    }
  }

  const sysLight = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function applyTheme() {
    const t = term.theme === 'auto' ? (sysLight && sysLight.matches ? 'light' : 'dark') : term.theme;
    document.documentElement.setAttribute('data-theme', t);
  }

  function cmdTheme(io, rest) {
    const t = rest.trim().toLowerCase();
    if (t) {
      if (['dark', 'light', 'auto'].indexOf(t) < 0) return io.err('Use dark, light or auto.');
      term.theme = t;
      saveTerm();
      applyTheme();
    }
    io.print(ln('The theme is ' + term.theme + '.' + (term.theme === 'auto' ? ' It follows your device.' : '')) +
      acts(runBtn('theme dark'), runBtn('theme light'), runBtn('theme auto')));
  }

  function cmdExport(io) {
    io.print(ln('This code holds your open problems, results, marks, rivals, duels, CP4 check marks and settings. On your other device, type import, then paste the code.') +
      '<pre class="code">' + esc(L.encodeState(state)) + '</pre>' + acts('<button type="button" class="c" data-copy>copy the code</button>'));
  }

  async function cmdImport(io, rest) {
    if (!rest.trim()) return io.print(ln('Use: import &lt;code&gt;. Make the code with export on your other device.') + acts(fillBtn('import ', 'import …')));
    let obj;
    try { obj = L.decodeState(rest); } catch (e) { return io.err(e.message); }
    if (ui.busy) return busy(io);
    state = cleanState(obj);
    save();
    data.subs = null; data.rating = null; data.maxRating = null;
    renderStatus();
    if (!state.handle) return io.print(ln('The data on this device is replaced.') + ln('Type your Codeforces handle, then press Enter.'));
    io.set(loadingBanner());
    const res = await loadAll();
    io.set(ln('The data on this device is replaced.', 'good') +
      (res.error ? ln(esc(res.error), 'err') + acts(runBtn('refresh')) : banner() + bannerTail()));
  }

  function cmdReset(io, rest) {
    if (rest.trim().toLowerCase() !== 'confirm') {
      return io.print(ln('reset deletes your open problems, results, marks, rivals, duels, CP4 check marks and settings on this device' +
                         (LOCK ? ' and in your GitHub repo' : '') + '. Codeforces keeps your submissions.') +
        ln('To continue, run: reset confirm', 'err') + acts(fillBtn('reset confirm')));
    }
    [K_STATE, K_PROBLEMS, K_CONTESTS, K_RIVALS, K_UVAP, K_FIND].forEach(lsDel);
    state = freshState();
    if (LOCK && sync.token) save();
    Object.assign(data, { problems: null, byKey: new Map(), tags: [], subs: null, rating: null, maxRating: null, unfinished: null,
                          durations: {}, rivalSubs: {}, uvaSubs: null, uvaName: '', uvaList: null });
    $out.innerHTML = '';
    showWelcome(ln('All niel-trains data on this device is deleted.', 'dim'));
  }

  // ---------------------------------------------------------- lock and sync

  // A line of output with no command above it.
  function notice(html) {
    const el = addEntry(null);
    el.querySelector('.body').innerHTML = html;
    reveal(el);
  }

  function showLock() {
    locked = true;
    $out.innerHTML = '';
    const el = addEntry(null);
    el.classList.add('intro');
    el.querySelector('.body').innerHTML = logoHtml('var(--accent)') + ln('<b>niel-trains</b> is locked.') +
      ln('Type your password, then press Enter.', 'dim') + '<p class="ln" id="lockmsg" role="status"></p>';
    $cmd.value = '';
    $cmd.type = 'password';
    $cmd.setAttribute('autocomplete', 'current-password');
    renderStatus();
    updateAc();
  }

  function lockMsg(text, cls) {
    const el = $('lockmsg');
    if (el) { el.textContent = text; el.className = 'ln ' + cls; }
  }

  async function unlock(password) {
    if (ui.busy) return;
    ui.busy = true;
    lockMsg('Checking the password…', 'dim');
    const token = await L.openBox(LOCK, password);
    ui.busy = false;
    if (!token) return lockMsg('Wrong password.', 'err');
    sync.token = token;
    storeToken();
    locked = false;
    $cmd.type = 'text';
    $cmd.setAttribute('autocomplete', 'off');
    $out.innerHTML = '';
    await boot();
  }

  // The start of the site, after the password if there is one.
  async function boot() {
    let before = '';
    if (LOCK && sync.token) {
      live('Loading your data from GitHub…');
      try { await syncStart(); } catch (e) {
        setSync('error', e.message);
        before = ln(esc(e.message) + ' This device shows its own copy of your data.', 'err');
      }
      live('');
    }
    renderStatus();
    if (state.handle) { if (before) notice(before); run('fetch'); }
    else showWelcome(before);
  }

  const noLock = () => ln('This site has no password lock. Your data stays in this browser.') +
    ln('For a lock, run setup-lock.cjs in the folder of the site, then push lock.js.', 'dim');

  async function cmdSync(io, rest) {
    if (!LOCK) return io.print(noLock());
    const t = rest.trim().toLowerCase();
    if (t === 'push' || t === 'pull') {
      while (sync.busy) await sleep(50);
      if (t === 'push') {
        lsSet(K_STATE, state);
        const r = await pushNow();
        if (r === 'error') return io.err(sync.error);
        if (r === 'ok') io.print(ln('Saved to GitHub.', 'good'));
      } else {
        try {
          const remote = await pull();
          if (!remote.found) return io.print(ln('GitHub has no saved data yet.'));
          adopt(remote);
          setSync('ok');
        } catch (e) { setSync('error', e.message); return io.err(e.message); }
        io.print(ln('Loaded the data from GitHub. It replaced the data on this device.', 'good') + acts(runBtn('refresh')));
      }
    } else if (t) return io.err('Use: sync, sync push or sync pull.');
    const status = sync.status === 'ok' ? 'saved' + (sync.at ? ' ' + rel(sync.at) : '') : sync.status === 'saving' ? 'a change waits for GitHub'
      : sync.status === 'error' ? 'not saved. ' + sync.error : 'no sync';
    io.print(kv([['Place', esc(LOCK.owner + '/' + LOCK.repo + ', file ' + LOCK.path) + ' (your private repo)'],
                 ['Status', esc(status)],
                 ['This device', term.stay ? 'stays unlocked' : 'asks for the password in each new tab']]) +
      acts(runBtn('sync push'), runBtn('sync pull'), runBtn(term.stay ? 'stay off' : 'stay on'), runBtn('lock')));
  }

  async function cmdLock(io) {
    if (!LOCK) return io.print(noLock());
    while (sync.busy) await sleep(50);
    if (sync.timer || lsGet(K_DIRTY) === 1) {
      const r = await pushNow();
      if (r !== 'ok') return io.err('Your last change is not on GitHub yet' + (sync.error ? ': ' + sync.error : '.') + ' Run sync push, then lock again.');
    }
    dropToken();
    [K_STATE, K_RIVALS, K_UVAP, K_FIND].forEach(lsDel);
    location.reload();
  }

  function cmdStay(io, rest) {
    if (!LOCK) return io.print(noLock());
    const t = rest.trim().toLowerCase();
    if (t === 'on' || t === 'off') { term.stay = t === 'on'; saveTerm(); storeToken(); }
    else if (t) return io.err('Use: stay on or stay off.');
    io.print(ln(term.stay ? 'This browser stays unlocked. Use this only on your own device. lock signs you out.'
                          : 'This browser asks for the password in each new tab.') +
             acts(runBtn(term.stay ? 'stay off' : 'stay on'), runBtn('lock')));
  }

  // ------------------------------------------------------- rivals and duels

  function ladderHtml() {
    const lad = ladder(), my = myRating();
    if (!lad.length) {
      return ln('You have no rivals yet. A rival is a Codeforces handle that you want to pass. Each rival is a checkpoint.') +
        ln('You pass a checkpoint when you win ' + L.WINS_TO_PASS + ' duels against it.', 'dim') + acts(fillBtn('rival add ', 'rival add …'));
    }
    const you = '<div class="rrow you"><span class="rmark">you</span><span>' + rankSpan(state.handle, data.rating) + ' ' +
                esc(L.rankOf(data.rating).name) + '</span></div>';
    let h = ln('Your checkpoints, highest rating first. You pass a checkpoint when you win ' + L.WINS_TO_PASS + ' duels against it.', 'dim');
    let placed = false;
    for (const r of lad) {
      if (!placed && r.rating <= my) { h += you; placed = true; }
      const sub = r.missing ? 'Codeforces does not know this handle now. Remove it, then add the new handle.'
        : meter(r.chance, 'Your win chance against ' + r.handle) + esc(pct(r.chance) + ' win chance, ' + gapText(r.gap) + '. Duels: ' +
          r.wins + ' won, ' + r.losses + ' lost.' + (r.passedAt ? ' Passed on ' + localDate(r.passedAt) + '.' : ''));
      h += '<div class="rrow' + (r.passedAt ? ' passed' : r.next ? ' next' : '') + '"><span class="rmark">' +
           (r.passedAt ? '[x]' : r.next ? '[&gt;]' : '[ ]') + '</span><span>' + rankSpan(r.handle, r.rating) + ' ' + esc(L.rankOf(r.rating).name) +
           '</span><span class="racts">' + (r.missing ? runBtn('rival remove ' + r.handle) : runBtn('duel ' + r.handle) + runBtn('scout ' + r.handle)) +
           '</span><span class="rsub">' + sub + '</span></div>';
    }
    if (!placed) h += you;
    return h + ln('[x] passed. [&gt;] your next checkpoint. The win chance comes from the two ratings.', 'dim small') +
      acts(fillBtn('rival add ', 'rival add …'), fillBtn('rival remove ', 'rival remove …'));
  }

  async function rivalAdd(io, names) {
    if (!names.length) return io.print(ln('Use: rival add &lt;handles&gt;. Put commas between the handles.') + acts(fillBtn('rival add ', 'rival add …')));
    let list = [];
    for (const n of names) {
      if (!HANDLE_RE.test(n)) io.err('"' + n + '" is not a Codeforces handle.');
      else if (L.same(n, state.handle)) io.err(n + ' is your handle.');
      else if (findRival(n)) io.err(n + ' is already one of your rivals.');
      else if (!list.some(x => L.same(x, n))) list.push(n);
    }
    const room = MAX_RIVALS - state.rivals.length;
    if (list.length > room) {
      io.err('You can have ' + MAX_RIVALS + ' rivals. Remove one first.');
      list = list.slice(0, Math.max(0, room));
    }
    if (!list.length) return;
    if (ui.busy) return busy(io);
    ui.busy = true;
    live('Loading the profiles…');
    try {
      let infos = null;
      while (!infos && list.length) {
        try { infos = await api('user.info', { handles: list.join(';') }); } catch (e) {
          if (!e.badHandle || !list.some(x => L.same(x, e.badHandle))) throw e;
          io.err(e.message);
          list = list.filter(x => !L.same(x, e.badHandle));
        }
      }
      for (const u of infos || []) {
        if (findRival(u.handle) || L.same(u.handle, state.handle)) continue;       // an old handle of a rival, or of you
        state.rivals.push({ handle: u.handle, rating: u.rating || 0, maxRating: u.maxRating || 0, addedAt: nowSec(), missing: false });
      }
      save();
      io.print(ladderHtml());
    } catch (e) { io.err(e.message); }
    ui.busy = false;
    live('');
  }

  function rivalRemove(io, names) {
    if (!names.length) return io.print(ln('Use: rival remove &lt;handles&gt;.') + acts(fillBtn('rival remove ', 'rival remove …')));
    const cache = lsGet(K_RIVALS) || {};
    for (const n of names) {
      const r = findRival(n);
      if (!r) { io.err(n + ' is not one of your rivals.'); continue; }
      state.rivals = state.rivals.filter(x => x !== r);
      delete cache[r.handle.toLowerCase()];
      delete data.rivalSubs[r.handle.toLowerCase()];
    }
    lsSet(K_RIVALS, cache);
    save();
    io.print(ladderHtml());
  }

  // Active users of one country, from the Codeforces list of rated users. The default range is from above you to candidate master.
  async function rivalFind(io, words) {
    let lo = null, hi = null, all = false;
    const name = [];
    for (const w of words) {
      const m = /^(\d{3,4})(?:-|\.\.)(\d{3,4})$/.exec(w);
      if (m) { lo = Math.min(Number(m[1]), Number(m[2])); hi = Math.max(Number(m[1]), Number(m[2])); }
      else if (w.toLowerCase() === 'all') all = true;
      else name.push(w);
    }
    const country = name.join(' ') || state.country || 'Indonesia';
    if (lo == null) { lo = myRating() + 1; hi = Math.max(2099, lo); }
    let cache = lsGet(K_FIND);
    if (!cache || !Array.isArray(cache.users) || String(cache.country).toLowerCase() !== country.toLowerCase() || nowSec() - cache.at > RIVAL_MAX_AGE) {
      if (ui.busy) return busy(io);
      ui.busy = true;
      live('Loading the active users from Codeforces. This list is large. It can take a minute…');
      try {
        const list = await api('user.ratedList', { activeOnly: true, includeRetired: false }, 240000);
        cache = { country: country, at: nowSec(), users: L.countryUsers(list, country) };
        lsSet(K_FIND, cache);
      } catch (e) { io.err(e.message); cache = null; }
      ui.busy = false;
      live('');
      if (!cache) return;
    }
    if (!cache.users.length) {
      return io.err('Codeforces lists no active user with the country "' + country + '". Write the country as a Codeforces profile shows it.');
    }
    if (name.length && state.country !== country) { state.country = country; save(); }
    const skip = new Set(state.rivals.map(r => r.handle.toLowerCase()).concat(state.handle.toLowerCase()));
    const inRange = cache.users.filter(u => u.rating >= lo && u.rating <= hi && !skip.has(u.handle.toLowerCase()));
    const list = all ? inRange : L.spread(cache.users, lo, hi, 12, skip);
    if (!list.length) return io.print(ln('No active user from ' + esc(country) + ' has a rating from ' + lo + ' to ' + hi + '.') + acts(fillBtn('rival find 1200-1600')));
    io.print(ln(plural(inRange.length, 'active user') + ' from <b>' + esc(country) + '</b> with a rating from ' + lo + ' to ' + hi + '.' +
                (list.length < inRange.length ? ' These ' + list.length + ' are spread over the ratings.' : '')) +
      list.slice().reverse().map(u => '<div class="rrow"><span class="rmark">[ ]</span><span>' + rankSpan(u.handle, u.rating) + ' ' +
        esc(L.rankOf(u.rating).name) + ' <span class="dim">max ' + u.maxRating + '</span></span><span class="racts">' +
        runBtn('rival add ' + u.handle) + runBtn('scout ' + u.handle) + '</span></div>').join('') +
      ln('Active: a rated contest in the last month. The list is from Codeforces and stays on this device for one day.', 'dim small') +
      acts(list.length < inRange.length ? runBtn('rival find all') : '', fillBtn('rival find 1200-1600'), fillBtn('rival find Singapore')));
  }

  function cmdRival(io, rest) {
    if (!need(io)) return;
    const m = /^(\S+)\s*([\s\S]*)$/.exec(rest.trim());
    if (!m) return io.print(ladderHtml());
    const verb = m[1].toLowerCase(), names = m[2].split(/[\s,;]+/).filter(Boolean);
    if (verb === 'add') return rivalAdd(io, names);
    if (verb === 'find') return rivalFind(io, names);
    if (verb === 'remove' || verb === 'rm' || verb === 'delete') return rivalRemove(io, names);
    return cmdScout(io, rest);
  }

  function scoutHtml(info, changes, subs) {
    const now = nowSec(), level = currentLevel(), rating = info.rating || 0;
    const c = L.career(changes), pr = L.progress(subs, data.problems, now), chance = L.winChance(myRating(), rating);
    const mine = L.topicReport(reportInput({ windowDays: 0, compareDays: 0 }));
    const theirs = L.topicReport({ problems: data.problems, subs: subs, results: {}, level: level, anchor: rating || level, now: now, windowDays: 0 });
    const edges = L.topicEdges(mine, theirs, 5), top = pr.buckets[pr.buckets.length - 1];
    const row = ladder().find(r => L.same(r.handle, info.handle));
    const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n);
    const rows = [
      ['Rating', '<span class="rk">' + (rating ? rating + ' ' + esc(L.rankOf(rating).name) : 'no rating') + '</span>' +
                 (info.maxRating ? ' (max ' + info.maxRating + ')' : '')],
      ['Against you', esc(gapText(rating - myRating()))],
      ['Win chance', meter(chance, 'Your win chance against ' + info.handle) + esc(pct(chance))],
      ['Contests', c.count ? plural(c.count, 'rated contest') + '. The last one was ' + esc(rel(c.last)) + '.' : 'no rated contests']
    ];
    if (c.count) rows.push(['Form', esc(c.form.map(sign).join(', ')) + ' <span class="dim">(the last rating changes, oldest first)</span>']);
    if (c.peak) rows.push(['Peak', c.peak + ', ' + esc(rel(c.peakTime))]);
    if (c.bestRank) rows.push(['Best rank', c.bestRank.rank + ' in ' + esc(c.bestRank.name)]);
    rows.push(['Solved', plural(pr.total, 'problem') + ', ' + pr.recent30 + ' in the last 30 days' + (top ? '. Hardest: ' + top.lo + '-' + top.hi : '')]);
    rows.push(['Topics', pr.topics.slice(0, 6).map(t => esc(t.tag) + ' ' + t.n).join(', ') || 'none']);
    rows.push(['Ahead of you', edges.length ? edges.map(e => esc(e.tag) + ' ' + e.theirs + ' <span class="dim">(you: ' + (e.mine || 'no rating') + ')</span>').join(', ')
                                            : 'no common topic near your level']);
    if (row) rows.push(['Duels', row.wins + ' won, ' + row.losses + ' lost' + (row.passedAt ? '. Passed on ' + localDate(row.passedAt) : '')]);
    return '<div class="scout" style="--rk:var(--rk' + L.rankOf(rating).color + ')"><p class="ftitle"><span class="rk">' + esc(info.handle) +
      '</span>@codeforces</p>' + kv(rows) + '</div>' +
      acts(row ? runBtn('duel ' + info.handle) : runBtn('rival add ' + info.handle),
           edges.length ? fillBtn('train with ' + edges.slice(0, 3).map(e => e.tag).join(', ')) : '') +
      ln('Ahead of you: common topics near your level where the topic rating of ' + esc(info.handle) + ' is 200 or more above your topic rating. ' +
         'Both topic levels count all solves.', 'dim small');
  }

  async function cmdScout(io, rest) {
    if (!need(io)) return;
    const h = rest.trim().split(/[\s,;]+/)[0];
    if (!h) {
      return io.print(ln('Use: scout &lt;handle&gt;. It works for each Codeforces handle.') +
        acts(...state.rivals.map(r => runBtn('scout ' + r.handle)), fillBtn('scout ', 'scout …')));
    }
    if (!HANDLE_RE.test(h)) return io.err('"' + h + '" is not a Codeforces handle.');
    if (ui.busy) return busy(io);
    ui.busy = true;
    try {
      let info = findRival(h);
      if (!info || info.missing) {
        live('Loading the profile of ' + h + '…');
        const u = (await api('user.info', { handles: h }))[0];
        info = { handle: u.handle, rating: u.rating || 0, maxRating: u.maxRating || 0 };
      }
      const changes = await loadChanges(info.handle), subs = await loadRivalSubs(info.handle);
      io.print(scoutHtml(info, changes, subs));
    } catch (e) { io.err(e.message); }
    ui.busy = false;
    live('');
  }

  function duelCard(d) {
    return '<div class="prob"><p class="pname"><a class="pl" href="https://codeforces.com/contests/' + d.cid + '" target="_blank" rel="noopener"><b>' +
      d.cid + '</b>' + esc(d.name) + '</a></p>' +
      '<p class="seal"><i aria-hidden="true">░░░░░░░░</i>The result of ' + esc(d.rival) + ' in this contest is sealed.</p>' +
      ln('A duel against ' + esc(d.rival) + '. The contest is ' + fmtDuration(d.duration) + ' long. You started the duel ' + esc(rel(d.startedAt)) + '.', 'dim') +
      '<ol class="steps"><li>Open the contest. Select Virtual participation.</li><li>Do the full contest. Do not read the standings.</li>' +
      '<li>After the contest ends, run duel check.</li></ol>' + acts(runBtn('duel check'), runBtn('duel drop')) + '</div>' +
      ln('More solved problems wins. With the same number, the lower penalty wins. ' +
         'The penalty is the minutes to each Accepted, plus 10 for each wrong attempt.', 'dim small');
  }

  // Your result in the contest of a duel: your first virtual contest after the duel started.
  const myDuelResult = d => L.contestResult(data.subs, d.cid, { types: L.VIRTUAL, virtual: true, after: d.startedAt - 300 });

  function duelTable(d) {
    const idxs = new Set(data.problems.filter(p => p.cid === d.cid).map(p => p.idx)), mine = {}, theirs = {};
    for (const r of d.mine.problems) { mine[r.idx] = r; idxs.add(r.idx); }
    for (const r of d.ghost.problems) { theirs[r.idx] = r; idxs.add(r.idx); }
    const cell = r => !r || (r.time == null && !r.wrong) ? '<span class="dim">-</span>'
      : r.time != null ? L.clock(r.time) + (r.wrong ? ' <span class="dim">+' + r.wrong + '</span>' : '') : '<span class="dim">−' + r.wrong + '</span>';
    const won = d.status === 'won', lost = d.status === 'lost';
    let t = '<div class="dtab"><span></span><span class="hd">you</span><span class="hd">' + esc(d.rival) + '</span>';
    for (const i of Array.from(idxs).sort()) t += '<span class="hd">' + esc(i) + '</span><span>' + cell(mine[i]) + '</span><span>' + cell(theirs[i]) + '</span>';
    return t + '<span class="hd">solved</span><span' + (won ? ' class="win"' : '') + '>' + d.mine.solved + '</span><span' + (lost ? ' class="win"' : '') + '>' +
      d.ghost.solved + '</span><span class="hd">penalty</span><span>' + d.mine.penalty + '</span><span>' + d.ghost.penalty + '</span></div>' +
      ln('Each cell is the time of the Accepted, in hours and minutes. +1 is one wrong attempt before it. −1 is one wrong attempt and no Accepted.', 'dim small');
  }

  // Reads your virtual contest and decides the open duel. Returns the text for the screen.
  function settleDuel(d) {
    const mine = myDuelResult(d), now = nowSec();
    if (!mine) {
      return ln('niel-trains found no virtual submission of you in this contest after the duel started.', 'err') +
        ln('Do the contest as a virtual participation, then run duel check again. niel-trains sees your contest only through your submissions.', 'dim') +
        acts(runBtn('duel'), runBtn('duel drop'));
    }
    const end = mine.start + d.duration;
    if (now < end) return ln('Your virtual contest is not over. It ends ' + esc(rel(end)) + '. Run duel check after that.') + acts(runBtn('duel check'));
    const res = L.compareResults(mine, d.ghost);
    d.mine = { solved: mine.solved, penalty: mine.penalty, problems: mine.problems };
    d.status = res > 0 ? 'won' : res < 0 ? 'lost' : 'draw';
    d.endedAt = now;
    save();
    const row = ladder().find(r => L.same(r.handle, d.rival)), next = ladder().find(r => r.next);
    let h = (res > 0 ? ln('You won the duel against ' + esc(d.rival) + '.', 'good') : res < 0 ? ln(esc(d.rival) + ' won this duel.', 'err')
                     : ln('The duel against ' + esc(d.rival) + ' is a draw. It does not count.')) + ln(esc(d.name), 'dim') + duelTable(d);
    if (row && res > 0 && row.passedAt === d.endedAt) {
      h += ln('Checkpoint passed: ' + esc(d.rival) + '.', 'good') +
           ln(next ? 'Your next checkpoint is ' + rankSpan(next.handle, next.rating) + '.' : 'You passed all your checkpoints. Add a stronger rival.');
    } else if (row) {
      h += ln('Against ' + esc(d.rival) + ': ' + row.wins + ' of ' + L.WINS_TO_PASS + ' wins' + (row.losses ? ', ' + row.losses + (row.losses === 1 ? ' loss' : ' losses') : '') + '.');
    }
    return h + ln('A duel is practice only after the upsolve. Solve the easiest problem that you did not solve.', 'dim') +
      acts(runBtn('upsolve'), runBtn('duel'), runBtn('rival'));
  }

  async function duelCheck(io) {
    const d = openDuel();
    if (!d) return io.print(ln('No duel is open.') + acts(runBtn('duel')));
    if (ui.busy) return busy(io);
    ui.busy = true;
    live('Checking Codeforces…');
    try {
      mergeSubs(toSubs(await api('user.status', { handle: state.handle, from: 1, count: 200 })));
      matchAccepted();
      io.print(settleDuel(d));
    } catch (e) { io.err(e.message); }
    ui.busy = false;
    live('');
  }

  async function cmdDuel(io, rest) {
    if (!need(io)) return;
    const arg = rest.trim().split(/[\s,;]+/)[0] || '', low = arg.toLowerCase(), open = openDuel();
    if (low === 'check') return duelCheck(io);
    if (low === 'history') return cmdDuels(io);
    if (low === 'drop') {
      if (!open) return io.err('No duel is open.');
      open.status = 'dropped'; open.endedAt = nowSec();
      save();
      return io.print(ln('The duel against ' + esc(open.rival) + ' is dropped. It does not count.') + acts(runBtn('duel'), runBtn('rival')));
    }
    if (open) return io.print((arg ? ln('One duel is open. Finish it or drop it first.', 'err') : '') + duelCard(open));
    const lad = ladder();
    if (!lad.length) return io.print(ln('A duel needs a rival. Add the people that you want to pass.') + acts(fillBtn('rival add ', 'rival add …')));
    const target = arg ? lad.find(r => L.same(r.handle, arg)) : lad.find(r => r.next);
    if (!target && arg) return io.print(ln(esc(arg) + ' is not one of your rivals.', 'err') + acts(runBtn('rival add ' + arg), runBtn('rival')));
    if (!target) return io.print(ln('You passed all your checkpoints. Add a stronger rival, or name a rival for a new duel.') + acts(fillBtn('rival add ', 'rival add …'), runBtn('rival')));
    if (target.missing) return io.print(ln('Codeforces does not know the handle ' + esc(target.handle) + ' now.', 'err') + acts(runBtn('rival')));
    if (ui.busy) return busy(io);
    ui.busy = true;
    try {
      const changes = await loadChanges(target.handle), subs = await loadRivalSubs(target.handle);
      // No contest of an old duel, and no contest with a problem from your desk or your re-solve list.
      const skip = new Set(state.duels.map(d => d.cid).concat(state.quests.map(q => q.p.cid), state.marks.map(m => m.p.cid)));
      const pool = L.duelCandidates({ changes: changes, rivalSubs: subs, mySubs: data.subs, problems: data.problems, skip: skip,
                                      unfinished: data.unfinished, durations: data.durations }).slice(0, 10);
      if (!pool.length) {
        io.print(ln('No contest fits a duel against ' + esc(target.handle) + '.', 'err') +
          ln('A duel needs a rated contest that ' + esc(target.handle) + ' did, with one or more solved problems, and that you did not touch.', 'dim') +
          acts(runBtn('scout ' + target.handle), runBtn('rival')));
      } else {
        const c = pool[Math.floor(Math.random() * pool.length)];
        const d = { id: state.nextId++, rival: target.handle, cid: c.cid, name: c.name, duration: data.durations[c.cid], startedAt: nowSec(),
                    status: 'open', ghost: L.contestResult(subs, c.cid, { types: L.OFFICIAL }), mine: null, endedAt: null };
        state.duels.push(d);
        save();
        io.print(duelCard(d));
      }
    } catch (e) { io.err(e.message); }
    ui.busy = false;
    live('');
  }

  function cmdDuels(io) {
    if (!need(io)) return;
    const list = state.duels.slice().sort((a, b) => (b.startedAt - a.startedAt) || (b.id - a.id)).slice(0, 30);
    if (!list.length) return io.print(ln('No duels yet.') + acts(runBtn('duel'), runBtn('rival')));
    const word = { open: 'Open', won: 'Won', lost: 'Lost', draw: 'Draw', dropped: 'Dropped' };
    let h = '';
    for (const d of list) {
      const score = d.mine ? ' You: ' + d.mine.solved + ' solved, penalty ' + d.mine.penalty + '. ' + d.rival + ': ' + d.ghost.solved +
                             ' solved, penalty ' + d.ghost.penalty + '.' : '';
      h += '<div class="row"><span class="main"><span class="' + (d.status === 'won' ? 'good' : d.status === 'lost' ? 'err' : 'dim') + '">' + word[d.status] +
           '</span> against <b>' + esc(d.rival) + '</b>, ' + localDate(d.endedAt || d.startedAt) + '<br><span class="dim small">' + esc(d.name + '.' + score) +
           '</span></span>' + (d.status === 'open' ? runBtn('duel') : '') + '</div>';
    }
    io.print(h);
  }

  const GROUPS = [['get', 'Get a problem'], ['work', 'Work on a problem'], ['rivals', 'Rivals and duels'], ['see', 'See your data'],
                  ['set', 'Filters and settings'], ['data', 'Data and screen']];
  const GET_MORE = [
    'rating: 1200 is that rating. +200 or -100 counts from your level. +100..+200 is a range. The word level is your level.',
    'With no rating, the command uses the rating from the rating command.',
    'with: the problem has one or more of these topics. This replaces your included topics for this one problem.',
    'without: the problem has none of these topics. This adds to your excluded topics for this one problem.',
    'You get only problems that you did not try before.'
  ];
  const COMMANDS = [
    { name: 'suggest', group: 'get', args: '[rating] [with topics] [without topics]', run: (io, r) => cmdGet(io, r, 'suggest'),
      desc: 'Get one problem. The rating and the topics stay sealed.', more: GET_MORE,
      ex: ['suggest', 'suggest 1200', 'suggest +300 with dp, greedy', 'suggest without geometry'] },
    { name: 'train', group: 'get', args: '[rating] [with topics] [without topics]', run: (io, r) => cmdGet(io, r, 'training'),
      desc: 'Get one problem from one of your weak topics. The topic stays secret.',
      more: ['A weak topic is common near your level, and you solved few problems with it.', 'With topics, train picks only from those topics.'].concat(GET_MORE.slice(0, 2), GET_MORE.slice(3)),
      ex: ['train', 'train +100', 'train without geometry, games', 'train with dp, graphs'] },
    { name: 'start', group: 'get', args: '<problem or link>', run: cmdStart, desc: 'Put your own problem on the desk: a Codeforces problem or a UVa problem.',
      more: ['Use this for an upsolve, for a problem from your re-solve list, or for any Codeforces problem.',
             'For a UVa problem, give the number: start uva 100. Set your UVa username first with the uva command.'],
      ex: ['start 1277B', 'start https://codeforces.com/contest/1277/problem/B', 'start uva 100'] },
    { name: 'desk', group: 'work', run: cmdDesk, desc: 'Show your open problems.' },
    { name: 'check', group: 'work', run: cmdCheck, desc: 'Ask Codeforces for your new Accepted verdicts, and for the result of an open duel.' },
    { name: 'clean', group: 'work', args: '[problem]', run: cmdResult, desc: 'Result: no hint above level 0, no tags and no editorial.',
      more: ['Without a problem, the command uses the one problem on your desk that has Accepted.', 'To change a result later, give the command with the problem.'] },
    { name: 'hint1', group: 'work', args: '[problem]', run: cmdResult, desc: 'Result: solved with hint level 1.' },
    { name: 'hint2', group: 'work', args: '[problem]', run: cmdResult, desc: 'Result: solved with hint level 2.' },
    { name: 'spoiled', group: 'work', args: '[problem]', run: cmdResult, desc: 'You saw the key idea or the solution. The problem comes back in 7 days.',
      more: ['For an open problem, spoiled puts the problem away.', 'For a problem that is not on your desk, spoiled adds it to your re-solve list.'] },
    { name: 'park', group: 'work', args: '[problem]', run: (io, r) => cmdPutAway(io, r, 'parked'), desc: 'Stop for now. The problem comes back in 30 days.',
      more: ['Park a problem after you have no ideas left to test.', 'For a problem that is not on your desk, park adds it to your re-solve list.'] },
    { name: 'drop', group: 'work', args: '[problem]', run: (io, r) => cmdPutAway(io, r, 'dropped'), desc: 'Remove an open problem. It does not come back.' },
    { name: 'idea', group: 'work', args: '[problem] <text>', run: cmdIdea, desc: 'Save the key idea of a solved problem.',
      more: ['Without a problem, the command uses your latest solved problem.'], ex: ['idea Sort, then take the largest items first.'] },
    { name: 'log', group: 'work', args: '[problem]', run: cmdLog, desc: 'Copy a row for your log sheet.',
      more: ['The row has tabs between the cells: date, problem, SOLVE, time, result, failure reason, lesson.'] },
    { name: 'rival', group: 'rivals', args: '[add | remove | find] [handles]', run: cmdRival, desc: 'Show your checkpoints. Add, remove or find a rival.',
      more: ['A rival is a Codeforces handle that you want to pass. Each rival is a checkpoint.',
             'rival find shows active users of your country, from above your rating to candidate master. Example: rival find Indonesia 1200-1600.',
             'You pass a checkpoint when you win ' + L.WINS_TO_PASS + ' duels against it.',
             'Put commas between handles. The list stays in this browser and in your export code.'],
      ex: ['rival', 'rival add ', 'rival remove '] },
    { name: 'scout', group: 'rivals', args: '<handle>', run: cmdScout, desc: 'Show the record of a handle, and the topics where it is ahead of you.' },
    { name: 'duel', group: 'rivals', args: '[handle | check | drop]', run: cmdDuel, desc: 'Start a duel against your next checkpoint, or show the open duel.',
      more: ['niel-trains picks a rated contest that the rival did and you did not. You do it as a virtual contest on Codeforces.',
             'The result of the rival stays sealed until your contest ends.',
             'More solved problems wins. With the same number, the lower penalty wins.',
             'duel check reads your result. duel drop stops the duel with no result.'],
      ex: ['duel', 'duel check', 'duel drop'] },
    { name: 'duels', hidden: true, group: 'rivals', run: cmdDuels, desc: 'List your duels.' },
    { name: 'fetch', group: 'see', run: cmdFetch, desc: 'Show the banner with your Codeforces numbers.' },
    { name: 'topics', group: 'see', args: '[all]', run: cmdTopics, desc: 'Show your practice rating and your rating in each topic.' },
    { name: 'progress', group: 'see', run: cmdProgress, desc: 'Show your solves by rating and by topic.' },
    { name: 'cp4', group: 'see', args: '[chapter | section | category]', run: cmdCp4, desc: 'Show the problem list of CP4 Book 1, with a check box for each problem.',
      more: ['cp4 shows the chapters and the sections. cp4 1.4 shows one section. cp4 1.4a shows one category.',
             'Select [ ] to mark a problem as done. Select [x] to clear the mark.',
             'With a UVa username, a UVa problem gets its mark from the judge.',
             'The list has the problem IDs of the book. The hints are in the book.'],
      ex: ['cp4', 'cp4 1.4', 'cp4 3.2a'] },
    { name: 'upsolve', group: 'see', args: '[all]', run: cmdUpsolve, desc: 'List the contest problems that you did not solve.' },
    { name: 'resolve', hidden: true, group: 'see', run: cmdResolve, desc: 'List your spoiled and parked problems.' },
    { name: 'history', group: 'see', run: cmdHistory, desc: 'List the problems that you finished here.' },
    { name: 'target', group: 'set', args: '[1200 | +200 | +100..+200]', run: cmdRating, desc: 'Set how far above your rating the problems are.',
      ex: ['target +100..+200', 'target +200', 'target 1200'] },
    { name: 'days', group: 'set', args: '[90 | 365 | all]', run: cmdPeriod, desc: 'Set the number of days that the topic ratings count.' },
    { name: 'rating', hidden: true, group: 'set', args: '[1200 | +200 | +100..+200 | level]', run: cmdRating, desc: 'Set the rating for suggest and train.' },
    { name: 'include', hidden: true, group: 'set', args: '<topics>', run: cmdFilterSet, desc: 'Give only problems with one or more of these topics.',
      more: ['Put commas between topics. A part of a name is enough: dfs gives dfs and similar.'], ex: ['include dp, greedy'] },
    { name: 'exclude', hidden: true, group: 'set', args: '<topics>', run: cmdFilterSet, desc: 'Never give problems with these topics.',
      more: ['Put commas between topics. A part of a name is enough: geo gives geometry.'], ex: ['exclude geometry, fft'] },
    { name: 'unfilter', hidden: true, group: 'set', args: '<topics | all>', run: cmdUnfilter, desc: 'Remove topic filters.', ex: ['unfilter dp', 'unfilter all'] },
    { name: 'filters', hidden: true, group: 'set', run: cmdFilters, desc: 'Show all topics. Change the filters with + and −.' },
    { name: 'period', hidden: true, group: 'set', args: '[90 | 365 | all]', run: cmdPeriod, desc: 'Set the period of solves that the topic levels count.' },
    { name: 'level', hidden: true, group: 'set', args: '[number | auto]', run: cmdLevel, desc: 'Set your level by hand, or follow your rating.' },
    { name: 'limit', hidden: true, group: 'set', args: '[1-5]', run: cmdLimit, desc: 'Set the number of open problems on your desk.' },
    { name: 'handle', group: 'set', args: '[name]', run: cmdHandle, desc: 'Set your Codeforces handle.' },
    { name: 'uva', group: 'set', args: '[username | off]', run: cmdUva, desc: 'Set your UVa username. check then reads your UVa verdicts through uHunt.',
      more: ['UVa is the Online Judge at onlinejudge.org. uHunt is its statistics site.',
             'After you set the username, start a UVa problem by its number: start uva 100.',
             'UVa has no ratings and no topics, so a UVa problem has no seal.'], ex: ['uva', 'uva ', 'uva off'] },
    { name: 'theme', group: 'set', args: '[dark | light | auto]', run: cmdTheme, desc: 'Set the colors.' },
    { name: 'sync', group: 'data', args: '[push | pull]', run: cmdSync, desc: 'Show where your data is saved. Save or load it now.',
      more: ['With a lock, niel-trains saves your data in your private GitHub repo after each change.',
             'push saves now. pull loads the data from GitHub. It replaces the data on this device.'] },
    { name: 'lock', group: 'data', run: cmdLock, desc: 'Sign out in this browser. The site asks for the password again.' },
    { name: 'stay', group: 'data', args: '[on | off]', run: cmdStay, desc: 'Keep this browser unlocked, or not.' },
    { name: 'export', group: 'data', run: cmdExport, desc: 'Make a code that moves your data to a different device.' },
    { name: 'import', group: 'data', args: '<code>', run: cmdImport, desc: 'Replace the data on this device with the data from a code.' },
    { name: 'refresh', hidden: true, group: 'data', run: cmdFetch, desc: 'Load your data from Codeforces again.' },
    { name: 'reset', group: 'data', run: cmdReset, desc: 'Delete all niel-trains data.' },
    { name: 'clear', group: 'data', run: () => {}, desc: 'Clear the screen.' },
    { name: 'help', group: 'data', args: '[command]', run: cmdHelp, desc: 'Show all commands, or one command in detail.' }
  ];
  const BY_NAME = {};
  for (const c of COMMANDS) BY_NAME[c.name] = c;
  const NO_HANDLE = { help: 1, theme: 1, handle: 1, import: 1, reset: 1, sync: 1, lock: 1, stay: 1 };       // these work before you set a handle

  function cmdHelp(io, rest) {
    const t = rest.trim().toLowerCase().replace(/^\//, '');
    if (t) {
      const c = BY_NAME[L.ALIASES[t] || t];
      if (!c) return unknown(io, t);
      const also = Object.keys(L.ALIASES).filter(a => L.ALIASES[a] === c.name);
      let h = ln('<b>' + esc(c.name) + '</b>' + (c.args ? ' ' + esc(c.args) : '')) + ln(esc(c.desc));
      for (const s of c.more || []) h += ln(esc(s), 'dim');
      h += acts(...(c.ex || [c.name]).map(x => fillBtn(x)));
      if (also.length) h += ln('Other names: ' + esc(also.join(', ')) + '.', 'dim small');
      return io.print(h);
    }
    let h = ln('niel-trains gives you one Codeforces problem at a time. The rating and the topics stay sealed until you solve the problem.') +
            ln('Type a command and press Enter, or select a command. Tab completes a command or a topic. The Up key shows your last commands.', 'dim');
    for (const [g, title] of GROUPS) {
      h += head(title) + '<div class="help">';
      for (const c of COMMANDS.filter(x => x.group === g && !x.hidden)) {
        h += '<span>' + runBtn(c.name) + '</span><span>' + (c.args ? '<span class="args">' + esc(c.args) + '</span><br>' : '') +
             '<span class="dim">' + esc(c.desc) + '</span></span>';
      }
      h += '</div>';
    }
    h += head('Examples') + acts(fillBtn('suggest 1200 with dp, greedy'), fillBtn('train +100 without geometry'),
                                 fillBtn('exclude geometry, fft'), fillBtn('start 1277B'), fillBtn('help suggest')) +
         ln('[x] is optional. <x> is necessary. An example goes into the command line. You can change it before you run it.'.replace(/</g, '&lt;').replace(/>/g, '&gt;'), 'dim small');
    io.print(h);
  }

  function distance(a, b) {
    const d = [];
    for (let i = 0; i <= a.length; i++) d[i] = [i];
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }

  function unknown(io, name) {
    const near = COMMANDS.map(c => c.name).filter(n => n.indexOf(name) === 0 || distance(n, name) <= (name.length > 4 ? 2 : 1)).slice(0, 3);
    io.print(ln('niel-trains: command not found: ' + esc(name), 'err') +
      acts(...(near.length ? ['<span class="dim">Did you mean</span>'].concat(near.map(n => runBtn(n))) : []), runBtn('help')));
  }

  // --------------------------------------------------------------- terminal

  function live(text) { $live.textContent = text; }

  function addEntry(text) {
    const el = document.createElement('section');
    el.className = 'entry';
    const shown = text == null ? '' : text.length > 90 ? text.slice(0, 90) + '…' : text;
    el.innerHTML = (text == null ? '' : '<p class="ln echo"><span class="ps">' + esc($ps1.textContent) + '</span>' + esc(shown) + '</p>') +
                   '<div class="body"></div>';
    $out.appendChild(el);
    while ($out.children.length > 60) $out.removeChild($out.firstChild);
    return el;
  }

  // Shows the new output. A long output starts at its command line.
  function reveal(entry) {
    if (!entry.isConnected) return window.scrollTo(0, 0);
    const room = window.innerHeight - $top.offsetHeight - $bar.offsetHeight;
    if (entry.offsetHeight > room) entry.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, document.documentElement.scrollHeight);
  }

  function syncToggles() {
    for (const el of document.querySelectorAll('[data-sw]')) {
      const on = topicOn(el.dataset.tag, el.dataset.sw);
      el.setAttribute('aria-pressed', String(on));
      el.innerHTML = swText(el.dataset.sw, on);
    }
    for (const m of MODES) for (const el of document.querySelectorAll('[data-live="f-' + m + '"]')) el.textContent = modeText(m);
    for (const el of document.querySelectorAll('[data-live="filters"]')) el.textContent = filterText();
  }

  function renderStatus() {
    const has = !!state.handle && !locked;
    for (const el of document.querySelectorAll('[data-user]')) el.hidden = !has;
    $ps1.textContent = locked ? 'password:' : has ? '$' : 'handle:';
    $cmd.placeholder = locked ? 'your password' : has ? 'type a command, or help' : 'your Codeforces handle';
    $chips.hidden = locked;
    renderSync();
    const u = $('st-user'), d = $('st-desk'), du = $('st-due'), f = $('st-filters'), dl = $('st-duel');
    u.hidden = d.hidden = f.hidden = !has;
    du.hidden = dl.hidden = true;
    if (!has) return;
    const duel = openDuel();
    dl.hidden = !duel;
    if (duel) {
      dl.textContent = 'duel ' + duel.rival;
      dl.setAttribute('aria-label', 'A duel against ' + duel.rival + ' is open. Show the duel.');
    }
    u.style.setProperty('--rk', 'var(--rk' + L.rankOf(data.rating).color + ')');
    u.innerHTML = '<b>' + esc(state.handle) + '</b>' + (data.rating ? ' ' + data.rating : '');
    const n = openQuests().length, due = state.marks.filter(m => !m.doneAt && m.dueAt <= nowSec()).length;
    d.textContent = 'desk ' + n + '/' + state.maxOpen;
    d.setAttribute('aria-label', 'Desk: ' + n + ' of ' + state.maxOpen + ' places in use. Show the desk.');
    du.hidden = !due;
    du.textContent = 'due ' + due;
    du.setAttribute('aria-label', plural(due, 'problem') + ' due for a new try. Show the re-solve list.');
    f.textContent = filterShort();
    f.setAttribute('aria-label', 'Topic filters: ' + filterText() + '. Show the filters.');
  }

  async function run(line) {
    const text = String(line || '').trim();
    let c = L.parseCommand(text);
    if (!c || locked) return;
    if (c.name === 'clear') { $out.innerHTML = ''; return; }
    const entry = addEntry(text), body = entry.querySelector('.body');
    const io = {
      print: html => body.insertAdjacentHTML('beforeend', html),
      set: html => { body.innerHTML = html; },
      err: msg => body.insertAdjacentHTML('beforeend', ln(esc(msg), 'err'))
    };
    reveal(entry);
    if (!state.handle && !NO_HANDLE[c.name]) {
      // Before you set a handle, a word that is not a command is your handle.
      if (BY_NAME[c.name]) { io.print(ln('Set your handle first. Type your Codeforces handle, then press Enter.', 'err')); return; }
      c = { name: 'handle', rest: text.replace(/^[\/$>]\s*/, '') };
    }
    try {
      const cmd = BY_NAME[c.name];
      if (cmd) await cmd.run(io, c.rest, c.name); else unknown(io, c.name);
    } catch (e) {
      io.err('niel-trains found an error: ' + (e && e.message ? e.message : e));
    }
    renderStatus();
    syncToggles();
    syncCp4();
    reveal(entry);
  }

  // ----------------------------------------------------------- completions

  const FIXED_ARGS = { theme: ['dark', 'light', 'auto'], period: ['90', '365', 'all'], limit: ['1', '2', '3', '4', '5'],
                       rating: ['level', '+100', '+100..+200', '+200', '+300', '-100'], target: ['+100', '+100..+200', '+200', '+300'], days: ['90', '365', 'all'], level: ['auto'], topics: ['all'], upsolve: ['all'],
                       sync: ['push', 'pull'], stay: ['on', 'off'] };

  function keysFor(name) {
    if (!ready()) return [];
    const open = openQuests();
    if (name === 'clean' || name === 'hint1' || name === 'hint2') return open.filter(q => q.status === 'accepted').map(q => q.p.key);
    if (name === 'spoiled') return open.map(q => q.p.key);
    if (name === 'park' || name === 'drop') return open.filter(q => q.status === 'open').map(q => q.p.key);
    if (name === 'log' || name === 'idea') return solvedQuests().slice(0, 5).map(q => q.p.key);
    if (name === 'start') {
      const now = nowSec();
      return openMarks().filter(m => m.dueAt <= now).map(m => m.p.key).concat(upsolveItems().slice(0, 6).map(x => x.p.key));
    }
    return null;
  }

  function topicHits(frag, pool) {
    const hits = pool.filter(t => t.indexOf(frag) === 0);
    for (const t of pool) if (hits.indexOf(t) < 0 && t.split(/[\s-]+/).some(w => w.indexOf(frag) === 0)) hits.push(t);
    for (const t of pool) if (hits.indexOf(t) < 0 && t.indexOf(frag) >= 0) hits.push(t);
    return hits.filter(t => t !== frag);
  }

  // Each item has the text to show (label) and the full new command line (value).
  function completions(text) {
    const m = /^(\s*[\/$>]?\s*)(\S*)(\s*)([\s\S]*)$/.exec(text);
    const lead = m[1], word = m[2].toLowerCase(), rest = m[4];
    if (!word) return [];
    if (!m[3]) {
      return COMMANDS.filter(c => (c.name.indexOf(word) === 0 && c.name !== 'clear' && !c.hidden) || c.name === word).slice(0, 8)
        .map(c => ({ label: c.name, desc: c.args || '', value: lead + c.name + ' ' }));
    }
    const name = L.ALIASES[word] || word, start = lead + m[2] + ' ';
    const pick = (list, frag) => list.filter(x => x.toLowerCase().indexOf(frag) === 0 && x.toLowerCase() !== frag).slice(0, 8)
      .map(x => ({ label: x, value: start + x }));
    const first = /\s/.test(rest) ? null : rest.toLowerCase();
    if (name === 'cp4' && window.CP4) {
      const codes = [];
      for (const ch of window.CP4.chapters) for (const sec of ch.sections) { codes.push(sec.code); for (const cat of sec.cats) codes.push(cat.id); }
      return first == null ? [] : pick(first.length < 3 ? codes.filter(c => c.length === 3) : codes, first);
    }
    if (name === 'rival' || name === 'scout' || name === 'duel') {
      const handles = state.rivals.map(r => r.handle);
      if (first != null) return pick((name === 'rival' ? ['add', 'remove'] : name === 'duel' ? ['check', 'drop'] : []).concat(handles), first);
      const rm = name === 'rival' && /^(remove\s+)(\S*)$/i.exec(rest);
      return rm ? handles.filter(h => h.toLowerCase().indexOf(rm[2].toLowerCase()) === 0 && h.toLowerCase() !== rm[2].toLowerCase())
        .map(h => ({ label: h, value: start + rm[1] + h })) : [];
    }
    if (FIXED_ARGS[name]) return first == null ? [] : pick(FIXED_ARGS[name], first);
    if (name === 'help') return first == null ? [] : pick(COMMANDS.map(c => c.name), first);
    const keys = keysFor(name);
    if (keys) return first == null ? [] : pick(Array.from(new Set(keys)), first);

    // Topics: after include, exclude and unfilter, and after "with" and "without".
    let from = -1;
    if (name === 'include' || name === 'exclude' || name === 'unfilter') from = 0;
    else if (name === 'suggest' || name === 'train') {
      const re = /\b(without|with)\s/gi;
      let k;
      while ((k = re.exec(rest))) from = k.index + k[0].length;
    }
    if (from < 0) return [];
    const cut = Math.max(from, rest.lastIndexOf(',') + 1), frag = rest.slice(cut).trim().toLowerCase();
    if (!frag) return [];
    const before = rest.slice(0, cut) + (cut > 0 && !/\s$/.test(rest.slice(0, cut)) ? ' ' : '');
    const pool = name === 'unfilter' ? state.only.suggest.concat(state.only.train, state.off.suggest, state.off.train, ['all']) : data.tags;
    return topicHits(frag, pool).slice(0, 8).map(t => ({ label: t, value: start + before + t }));
  }

  function updateAc() {
    const items = state.handle && !locked ? completions($cmd.value) : [];
    $ac.hidden = !items.length;
    $chips.hidden = locked || items.length > 0;
    $ac.innerHTML = items.map(it => '<button type="button" class="c" data-complete="' + esc(it.value) + '">' + esc(it.label) +
      (it.desc ? '<span>' + esc(it.desc) + '</span>' : '') + '</button>').join('');
  }

  function setInput(text) {
    $cmd.value = text;
    $cmd.focus();
    $cmd.setSelectionRange(text.length, text.length);
    updateAc();
  }

  // ----------------------------------------------------------------- events

  let histPos = null, draft = '';

  function remember(text) {
    histPos = null;
    if (text.length > 200 || /^[\/$>]?\s*import\b/i.test(text)) return;       // a code is too long for the history
    if (term.hist[term.hist.length - 1] !== text) term.hist.push(text);
    term.hist = term.hist.slice(-50);
    saveTerm();
  }

  $('prompt').addEventListener('submit', e => {
    e.preventDefault();
    const text = $cmd.value.trim();
    $cmd.value = '';
    updateAc();
    if (!text) return;
    if (locked) { unlock(text); return; }                   // a password does not go into the history or the output
    remember(text);
    run(text);
  });

  $cmd.addEventListener('input', () => { histPos = null; updateAc(); });

  $cmd.addEventListener('keydown', e => {
    if (locked) return;
    if (e.key === 'ArrowUp' && term.hist.length) {
      e.preventDefault();
      if (histPos === null) { draft = $cmd.value; histPos = term.hist.length; }
      histPos = Math.max(0, histPos - 1);
      setInput(term.hist[histPos]);
    } else if (e.key === 'ArrowDown' && histPos !== null) {
      e.preventDefault();
      histPos++;
      if (histPos >= term.hist.length) { histPos = null; setInput(draft); } else setInput(term.hist[histPos]);
    } else if (e.key === 'Tab' && !e.shiftKey) {
      const firstItem = $ac.hidden ? null : $ac.querySelector('[data-complete]');
      if (firstItem) { e.preventDefault(); setInput(firstItem.dataset.complete); }
    } else if (e.key === 'Escape') {
      setInput('');
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      $out.innerHTML = '';
    }
  });

  // A tap on a completion must not close the keyboard of a phone.
  $ac.addEventListener('mousedown', e => e.preventDefault());

  document.addEventListener('click', e => {
    const el = e.target.closest('button');
    if (!el || el.disabled) return;
    const d = el.dataset;
    if (d.run != null) { remember(d.run); run(d.run); }
    else if (d.fill != null) setInput(d.fill);
    else if (d.complete != null) setInput(d.complete);
    else if (d.sw) { flipTopic(d.tag, d.sw); syncToggles(); renderStatus(); }
    else if (d.only) { state.only.train = [d.only]; save(); syncToggles(); renderStatus(); }
    else if (d.allon) { state.only = { suggest: [], train: [] }; state.off = { suggest: [], train: [] }; save(); syncToggles(); renderStatus(); }
    else if (d.band) { const table = el.closest('.ttable'); if (table) table.outerHTML = topicTable(Number(d.band)); }
    else if (d.ck) {
      if (d.auto) return;                                   // the judge gave this mark
      if (state.cp4[d.ck]) delete state.cp4[d.ck]; else state.cp4[d.ck] = 1;
      save();
      syncCp4();
    }
    else if (d.copy != null) {
      const pre = el.closest('.body').querySelector('pre.code');
      copy(pre.textContent).then(ok => { el.textContent = ok ? 'copied' : 'select the code and copy it by hand'; });
    }
  });

  // A key that you press outside the command line goes into the command line.
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
    const tag = e.target.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA') $cmd.focus();
  });

  if (sysLight && sysLight.addEventListener) sysLight.addEventListener('change', applyTheme);

  // ------------------------------------------------------------------ start

  // A change that still waits goes to GitHub when you leave the page.
  window.addEventListener('pagehide', () => { if (sync.timer) pushNow(true); });

  applyTheme();
  sync.token = LOCK ? readToken() : null;
  if (LOCK && !sync.token) showLock(); else boot();
  if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) $cmd.focus();
}());

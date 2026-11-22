// Spieleabend – Host-Bildschirm + Handys
// Start: node server.js   (Node.js 18+, keine Pakete nötig)
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { isCorrect } = require("./match");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const load = f => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));
const SCH = load("schaetz.json");                 // [frage, antwort, einheit, kategorie, zusatz]
const LEO = load("leopardy.json");                // {pool:[{name, lv:[[[q,a,note]]]}], alt:{}}
const ACT = load("begriffe.json");                 // {say|mime|draw: {1..5: []}}
const SCH_CATS = [...new Set(SCH.map(q => q[3]))];
const LEO_VALUES = [100,200,300,400,500,600,700,800];
const TEAM_NAMES = ["Team Rot","Team Grün","Team Blau","Team Lime"];

const rooms = new Map();
const rid = n => crypto.randomBytes(n).toString("hex");
const shuffle = a => { for (let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const pickRand = a => a[Math.floor(Math.random()*a.length)];

/* ---------------- Räume & Teams ---------------- */
function newCode(){
  const L = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let c; do { c = Array.from({length:4}, () => pickRand(L)).join(""); } while (rooms.has(c));
  return c;
}
function createRoom(){
  const r = { code:newCode(), hostToken:rid(16), players:[], teamCount:2, teamNames:[...TEAM_NAMES],
              g:null, lastResult:null, seen:{ sch:new Set(), leo:new Set(), act:new Set() },
              clients:new Set(), timer:null, touched:Date.now() };
  rooms.set(r.code, r);
  return r;
}
const teamSize = (r, t) => r.players.filter(p => p.team === t).length;
function assignTeam(r, p){
  let best = [], min = Infinity;
  for (let t=0; t<r.teamCount; t++){ const n = teamSize(r,t); if (n < min){ min = n; best = [t]; } else if (n === min) best.push(t); }
  p.team = pickRand(best);
}
function shuffleTeams(r){
  shuffle(r.players.slice()).forEach((p,i) => { p.team = i % r.teamCount; });
}
const membersOf = (r, t) => r.players.filter(p => p.team === t);
const activeTeams = r => [...Array(r.teamCount).keys()].filter(t => membersOf(r,t).length);

/* ---------------- Timer ---------------- */
function setTimer(r, ms, fn){ clearTimeout(r.timer); r.timer = setTimeout(() => { r.timer = null; fn(); broadcast(r); }, ms); }
function clearTimer(r){ clearTimeout(r.timer); r.timer = null; }

/* ---------------- Schätz-Duell ---------------- */
function schStart(r, o){
  const cats = (o.cats||[]).filter(c => SCH_CATS.includes(c));
  const useCats = cats.length ? cats : SCH_CATS;
  const n = [5,10,15,20].includes(+o.rounds) ? +o.rounds : 10;
  const inCats = SCH.map((q,i) => i).filter(i => useCats.includes(SCH[i][3]));
  let pool = inCats.filter(i => !r.seen.sch.has(i));
  if (pool.length < n){ inCats.forEach(i => r.seen.sch.delete(i)); pool = inCats.slice(); }
  const order = shuffle(pool).slice(0, n); order.forEach(i => r.seen.sch.add(i));
  r.g = { kind:"sch", mode:o.mode === "team" ? "team" : "solo", time:[0,30,60,90].includes(+o.time) ? +o.time : 60,
          order, round:0, phase:"guess", guesses:{}, last:null, scores:{}, teamScores:Array(r.teamCount).fill(0) };
  schRound(r);
}
function schRound(r){
  const g = r.g; g.phase = "guess"; g.guesses = {}; g.last = null;
  g.endAt = g.time ? Date.now() + g.time*1000 : null;
  if (g.time) setTimer(r, g.time*1000, () => schReveal(r)); else clearTimer(r);
}
function schReveal(r){
  const g = r.g; if (g.phase !== "guess") return;
  clearTimer(r);
  const Q = SCH[g.order[g.round]], a = Q[1], year = Q[2] === "";
  const ids = Object.keys(g.guesses).filter(id => r.players.some(p => p.id === id));
  const d = Object.fromEntries(ids.map(id => [id, Math.abs(g.guesses[id] - a)]));
  const min = ids.length ? Math.min(...Object.values(d)) : null;
  const closest = ids.filter(id => d[id] === min);
  const pts = {}, hit = {};
  ids.forEach(id => {
    hit[id] = year ? d[id] <= 5 : d[id] / Math.max(Math.abs(a), 1e-9) < 0.05;
    pts[id] = (closest.includes(id) ? 1 : 0) + (hit[id] ? 1 : 0);
    g.scores[id] = (g.scores[id] || 0) + pts[id];
    const p = r.players.find(x => x.id === id);
    if (g.mode === "team" && p) g.teamScores[p.team] += pts[id];
  });
  g.last = { pts, hit, closest };
  g.phase = "reveal"; g.endAt = null;
}
function schNext(r){
  const g = r.g; if (g.phase !== "reveal") return;
  if (g.round + 1 >= g.order.length){ finish(r); return; }
  g.round++; schRound(r);
}
function schMaybeAuto(r){
  const g = r.g; if (!g || g.kind !== "sch" || g.phase !== "guess") return;
  const online = r.players.filter(p => p.conns > 0);
  if (online.length && online.every(p => g.guesses[p.id] != null)) schReveal(r);
}

/* ---------------- Leopardy ---------------- */
const BUZZ_MS = 35000, REBUZZ_MS = 20000, ANSWER_MS = 30000, RESULT_MS = 15000;
function leoStart(r, o){
  const rows = o.board === "kurz" ? [1,3,5,7] : [0,1,2,3,4,5,6,7];
  const picks = {};
  LEO.pool.forEach((c,ci) => rows.forEach(lv => {
    const n = c.lv[lv].length;
    let opts = [...Array(n).keys()].filter(i => !r.seen.leo.has(ci+"-"+lv+"-"+i));
    if (!opts.length){ for (let i=0;i<n;i++) r.seen.leo.delete(ci+"-"+lv+"-"+i); opts = [...Array(n).keys()]; }
    const i = pickRand(opts); r.seen.leo.add(ci+"-"+lv+"-"+i); picks[ci+"-"+lv] = i;
  }));
  r.g = { kind:"leo", input:o.input === "rufen" ? "rufen" : "tippen", rows, picks, used:{}, turn:pickRand(activeTeams(r)), phase:"board", cur:null,
          teamScores:Array(r.teamCount).fill(0) };
  clearTimer(r);
}
const leoEntry = r => { const c = r.g.cur; return LEO.pool[c.ci].lv[c.lv][r.g.picks[c.ci+"-"+c.lv]]; };
function leoPick(r, ci, lv){
  const g = r.g; const k = ci+"-"+lv;
  if (g.phase !== "board" || !g.rows.includes(lv) || !LEO.pool[ci] || g.used[k] !== undefined) return;
  g.cur = { ci, lv, v:LEO_VALUES[lv], tried:[], wrongs:[], buzzTeam:null, buzzPlayer:null, ok:null, winner:-1 };
  leoBuzzOpen(r, BUZZ_MS);
}
function leoBuzzOpen(r, ms){
  const g = r.g; g.phase = "buzz"; g.cur.buzzTeam = null; g.cur.buzzPlayer = null; g.endAt = Date.now() + ms;
  setTimer(r, ms, () => leoResult(r));
}
function leoBuzz(r, p){
  const g = r.g, c = g.cur;
  if (g.phase !== "buzz" || c.tried.includes(p.team)) return;
  const ms = g.input === "rufen" ? 45000 : ANSWER_MS;
  c.buzzTeam = p.team; c.buzzPlayer = p.id; g.phase = "answer"; g.endAt = Date.now() + ms; c.answerSec = ms / 1000;
  setTimer(r, ms, () => leoAnswer(r, p, null));
}
function leoAnswer(r, p, text){
  const g = r.g, c = g.cur;
  if (g.phase !== "answer" || p.team !== c.buzzTeam) return;
  if (g.input === "rufen" && text != null) return;          // beim Rausrufen entscheidet der Spielleiter
  const [, a] = leoEntry(r);
  leoResolve(r, text != null && isCorrect(text, a, LEO.alt[a]), text);
}
function leoResolve(r, ok, text){
  const g = r.g, c = g.cur;
  clearTimer(r);
  if (ok){
    g.teamScores[c.buzzTeam] += c.v; c.ok = true; c.winner = c.buzzTeam; c.lastText = text || "";
    g.turn = c.buzzTeam; leoResult(r); return;
  }
  g.teamScores[c.buzzTeam] -= c.v;
  c.tried.push(c.buzzTeam); c.wrongs.push({ team:c.buzzTeam, text: text == null ? "Zeit abgelaufen" : text, timeout: text == null && g.input !== "rufen" });
  const rest = activeTeams(r).filter(t => !c.tried.includes(t));
  if (rest.length) leoBuzzOpen(r, REBUZZ_MS); else leoResult(r);
}
function leoResult(r){
  const g = r.g; g.phase = "result"; g.endAt = Date.now() + RESULT_MS;
  g.used[g.cur.ci+"-"+g.cur.lv] = g.cur.winner;
  setTimer(r, RESULT_MS, () => leoContinue(r));
}
function leoContinue(r){
  const g = r.g; if (g.phase !== "result") return;
  clearTimer(r);
  if (Object.keys(g.used).length >= LEO.pool.length * g.rows.length){ finish(r); return; }
  if (g.cur.winner < 0){ const at = activeTeams(r); g.turn = at[(at.indexOf(g.turn) + 1) % at.length] ?? at[0]; }
  g.phase = "board"; g.cur = null; g.endAt = null;
}
function leoOverride(r, ok){
  const g = r.g, c = g.cur; if (g.phase !== "result") return;
  if (ok && !c.ok && c.wrongs.length){
    const w = c.wrongs[c.wrongs.length-1]; g.teamScores[w.team] += 2*c.v;
    c.ok = true; c.winner = w.team; g.turn = w.team; c.lastText = w.text; c.wrongs.pop();
  } else if (!ok && c.ok){
    g.teamScores[c.winner] -= 2*c.v; c.wrongs.push({ team:c.winner, text:c.lastText });
    c.ok = false; c.winner = -1;
  } else return;
  g.used[c.ci+"-"+c.lv] = c.winner;
  g.endAt = Date.now() + RESULT_MS; setTimer(r, RESULT_MS, () => leoContinue(r));
}
function leoSwap(r){
  const g = r.g, c = g.cur; if (g.phase !== "buzz" || c.wrongs.length) return;
  const n = LEO.pool[c.ci].lv[c.lv].length, k = c.ci+"-"+c.lv;
  const opts = [...Array(n).keys()].filter(i => i !== g.picks[k]);
  g.picks[k] = pickRand(opts); leoBuzzOpen(r, BUZZ_MS);
}

/* ---------------- Activity: Erklären, Pantomime, Zeichnen ---------------- */
// Stufen 1–5. Jeder Treffer hebt die Stufe um 1, Punkte = Stufe + 1. Überspringen bleibt auf der Stufe.
const ACT_MODES = ["say", "mime", "draw"];
const actPts = lv => lv + 1;
function actStart(r, o){
  const modes = Array.isArray(o.modes) ? ACT_MODES.filter(m => o.modes.includes(m)) : [];
  r.g = { kind:"act", input:o.input === "tippen" ? "tippen" : "rufen", feed:[], time:[60,90,120].includes(+o.time) ? +o.time : 90, goal:[30,50,75,100].includes(+o.goal) ? +o.goal : 50,
          modes: modes.length ? modes : ACT_MODES.slice(), allTeams:o.all !== "aus", turn:pickRand(activeTeams(r)), expIdx:Array(r.teamCount).fill(0), teamScores:Array(r.teamCount).fill(0) };
  actTurn(r);
}
function actTurn(r){
  const g = r.g, ms = membersOf(r, g.turn), online = ms.filter(p => p.conns > 0), list = online.length ? online : ms;
  g.suggest = list.length ? list[g.expIdx[g.turn] % list.length].id : null;   // Vorschlag, das Team entscheidet selbst
  g.explainer = null;
  g.mode = pickRand(g.modes); g.all = g.allTeams && Math.random() < 0.15;   // vom Host abschaltbar
  g.phase = "who"; g.level = null; g.word = null; g.words = []; g.feed = []; g.endAt = null; actClearDrawing(g); clearTimer(r);
}
function actDraw(r, exclude){
  const g = r.g, list = ACT[g.mode][g.level], key = w => g.mode + "|" + w;
  let opts = list.filter(w => w !== exclude && !r.seen.act.has(key(w)));
  if (!opts.length){ list.forEach(w => r.seen.act.delete(key(w))); opts = list.filter(w => w !== exclude); }
  const w = pickRand(opts); r.seen.act.add(key(w)); return w;
}
function actNewWord(r, exclude){ const g = r.g; g.word = actDraw(r, exclude); actClearDrawing(g); }
function actClearDrawing(g){ g.drawN = (g.drawN || 0) + 1; g.strokes = []; g.drawPts = 0; }
// Ein Begriff erraten (team) oder übersprungen (null): Punkte gutschreiben, Stufe hoch, sofort der nächste Begriff
function actMark(r, team){
  const g = r.g; if (g.phase !== "run") return;
  const pts = team != null ? actPts(g.level) : 0;
  g.words.push({ w:g.word, team, pts, lv:g.level });
  if (team != null){ g.teamScores[team] += pts; g.level = Math.min(5, g.level + 1); }
  actNewWord(r, g.word);
}
function actEnd(r){
  const g = r.g; if (g.phase !== "run") return;
  clearTimer(r);
  g.words.push({ w:g.word, team:null, pts:0, lv:g.level, open:true });
  g.phase = "result"; g.endAt = null;
}
function actNext(r){
  const g = r.g; if (g.phase !== "result") return;
  if (g.teamScores.some(s => s >= g.goal)){ finish(r); return; }
  g.expIdx[g.turn]++;
  const at = activeTeams(r); g.turn = at[(at.indexOf(g.turn) + 1) % at.length] ?? at[0];
  actTurn(r);
}
// Zeichnen: Striche kommen in kleinen Stücken vom Handy und gehen direkt an Host-Bildschirm und Zuschauer-Handys
const DRAW_MAX_PTS = 40000;
function actDrawIn(r, segs){
  const g = r.g, out = [];
  for (const s of (Array.isArray(segs) ? segs : []).slice(0, 40)){
    const id = String(s && s.id || "").slice(0, 12); if (!id) continue;
    const pts = (Array.isArray(s.p) ? s.p : []).slice(0, 400)
      .filter(q => Array.isArray(q) && Number.isFinite(q[0]) && Number.isFinite(q[1]))
      .map(q => [Math.round(Math.min(1, Math.max(0, q[0])) * 1000) / 1000, Math.round(Math.min(1, Math.max(0, q[1])) * 1000) / 1000]);
    if (!pts.length || g.drawPts + pts.length > DRAW_MAX_PTS) continue;
    let st = g.strokes.find(x => x.id === id);
    if (!st){ st = { id, c:Math.min(4, Math.max(0, s.c | 0)), w:Math.min(2, Math.max(0, s.w | 0)), p:[] }; g.strokes.push(st); }
    st.p.push(...pts); g.drawPts += pts.length;
    out.push({ id, c:st.c, w:st.w, p:pts });
  }
  if (out.length) drawEvent(r, "draw", { n:g.drawN, segs:out });
}
function drawWatchers(r){ return [...r.clients].filter(c => c.host); }   // das Bild zeigt der Fernseher
function drawEvent(r, type, data){
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of drawWatchers(r)) c.res.write(msg);
}
function drawSync(r, only){
  const g = r.g; if (!g || g.kind !== "act") return;
  const msg = `event: drawsync\ndata: ${JSON.stringify({ n:g.drawN, strokes:g.strokes })}\n\n`;
  if (only) only.res.write(msg); else for (const c of drawWatchers(r)) c.res.write(msg);
}

/* ---------------- Spielende ---------------- */
function finish(r){
  const g = r.g; clearTimer(r);
  let ranking;
  if (g.kind === "sch" && g.mode === "solo")
    ranking = r.players.map(p => ({ name:p.name, team:p.team, score:g.scores[p.id] || 0 })).sort((a,b) => b.score - a.score);
  else
    ranking = activeTeams(r).map(t => ({ name:r.teamNames[t], team:t, score:g.teamScores[t] })).sort((a,b) => b.score - a.score);
  g.phase = "end"; g.endAt = null; g.ranking = ranking;
}

/* ---------------- Ansichten ---------------- */
function lanUrls(){
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(`http://${a.address}:${PORT}`);
  return out;
}
function view(r, me, host){
  const g = r.g;
  const v = {
    now:Date.now(), code:r.code, host:!!host, urls:lanUrls(),
    you: me ? { id:me.id, name:me.name, team:me.team } : null,
    teamCount:r.teamCount,
    teams:[...Array(r.teamCount).keys()].map(t => ({ name:r.teamNames[t], members:membersOf(r,t).map(p => ({ id:p.id, name:p.name, online:p.conns > 0 })) })),
    game:g ? g.kind : null, lastResult:r.lastResult, schCats:SCH_CATS
  };
  if (!g) return v;
  v.phase = g.phase; v.endAt = g.endAt || null; v.ranking = g.ranking || null;
  if (g.teamScores) v.teamScores = g.teamScores;
  const nameOf = id => (r.players.find(p => p.id === id) || {}).name || "?";

  if (g.kind === "sch"){
    const Q = SCH[g.order[g.round]], show = g.phase !== "guess";
    Object.assign(v, { mode:g.mode, round:g.round, total:g.order.length, time:g.time,
      q:{ text:Q[0], unit:Q[2], cat:Q[3], year:Q[2] === "" },
      answer: show ? { value:Q[1], note:Q[4] || "" } : null,
      scores:g.scores,
      guesses: r.players.map(p => ({ id:p.id, name:p.name, team:p.team, submitted:g.guesses[p.id] != null,
        value: show || p === me ? (g.guesses[p.id] ?? null) : null,
        pts: show && g.last ? g.last.pts[p.id] || 0 : 0, hit: show && g.last ? !!g.last.hit[p.id] : false })),
      closest: show && g.last ? g.last.closest : [] });
  }
  if (g.kind === "leo"){
    v.board = { cats:LEO.pool.map(c => c.name), rows:g.rows.map(lv => ({ lv, value:LEO_VALUES[lv] })), used:g.used };
    v.turn = g.turn; v.input = g.input;
    if (g.cur){
      const [q, a, note] = leoEntry(r), c = g.cur;
      v.cur = { cat:LEO.pool[c.ci].name, value:c.v, q, tried:c.tried, wrongs:c.wrongs, buzzTeam:c.buzzTeam,
                buzzName: c.buzzPlayer ? nameOf(c.buzzPlayer) : null, answerSec:c.answerSec || 30, ok:c.ok, winner:c.winner,
                answer: g.phase === "result" ? a : null, note: g.phase === "result" ? (note || "") : null,
                canSwap: g.phase === "buzz" && !c.wrongs.length,
                peek: host && g.input === "rufen" && g.phase === "answer" ? a : null };
    }
  }
  if (g.kind === "act"){
    const isExp = me && me.id === g.explainer;
    // Begriff sehen: wer dran ist, und zum Mitfiebern alle aus Teams, die gerade nicht raten
    const watch = !!me && !isExp && !g.all && me.team !== g.turn && (g.phase === "ready" || g.phase === "run");
    Object.assign(v, { turn:g.turn, explainer:g.explainer, explainerName:g.explainer ? nameOf(g.explainer) : null,
      suggest:g.suggest, suggestName:g.suggest ? nameOf(g.suggest) : null,
      mode:g.mode, modes:g.modes, all:g.all, level:g.level, pts:g.level ? actPts(g.level) : null, goal:g.goal, time:g.time, drawN:g.drawN,
      word: g.word != null && g.phase !== "result" && (isExp || watch) ? g.word : null, isExplainer:!!isExp, watching:watch,
      guessed: g.words.filter(x => x.team != null).length, input:g.input, feed:g.feed.slice(-8),
      canType: !!me && g.input === "tippen" && g.phase === "run" && !isExp && (g.all || me.team === g.turn),
      words: g.phase === "result" ? g.words : null });
  }
  return v;
}

/* ---------------- Live-Verbindungen ---------------- */
function send(c){
  const r = rooms.get(c.code); if (!r) return;
  const me = c.host ? null : r.players.find(p => p.token === c.token);
  c.res.write(`data: ${JSON.stringify(view(r, me, c.host))}\n\n`);
}
function broadcast(r){ r.touched = Date.now(); for (const c of r.clients) send(c); }
setInterval(() => {
  for (const r of rooms.values()){
    for (const c of r.clients) c.res.write(": ping\n\n");
    if (!r.clients.size && Date.now() - r.touched > 6*3600e3){ clearTimer(r); rooms.delete(r.code); }
  }
}, 20000);

/* ---------------- HTTP ---------------- */
function body(req){
  return new Promise(res => { let s = ""; req.on("data", d => { s += d; if (s.length > 2e4) req.destroy(); });
    req.on("end", () => { try { res(JSON.parse(s || "{}")); } catch { res({}); } }); });
}
function json(res, code, obj){ res.writeHead(code, { "Content-Type":"application/json; charset=utf-8", "Cache-Control":"no-store" }); res.end(JSON.stringify(obj)); }
const FILES = { "/":"player.html", "/host":"host.html", "/style.css":"style.css", "/common.js":"common.js", "/qrcode.js":"qrcode.js" };
const TYPES = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8" };
// Hintergrundmusik für den Host-Bildschirm: mit Range-Anfragen, damit der Browser streamen und loopen kann
const MUSIC = path.join(ROOT, "public", "music.mp3");
function sendMusic(req, res){
  fs.stat(MUSIC, (err, st) => {
    if (err){ res.writeHead(404); return res.end(); }
    const head = { "Content-Type":"audio/mpeg", "Accept-Ranges":"bytes", "Cache-Control":"public, max-age=86400" };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (!m){ res.writeHead(200, { ...head, "Content-Length":st.size }); return fs.createReadStream(MUSIC).pipe(res); }
    let start = m[1] === "" ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
    let end = m[1] !== "" && m[2] !== "" ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size){ res.writeHead(416, { "Content-Range":"bytes */" + st.size }); return res.end(); }
    res.writeHead(206, { ...head, "Content-Range":`bytes ${start}-${end}/${st.size}`, "Content-Length":end - start + 1 });
    fs.createReadStream(MUSIC, { start, end }).pipe(res);
  });
}
const cleanName = s => String(s || "").replace(/\s+/g, " ").trim().slice(0, 20);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && FILES[url.pathname]){
    const f = path.join(ROOT, "public", FILES[url.pathname]);
    res.writeHead(200, { "Content-Type":TYPES[path.extname(f)], "Cache-Control":"no-store" });
    return fs.createReadStream(f).pipe(res);
  }
  if (url.pathname === "/ping"){ res.writeHead(204); return res.end(); }   // hält Gratis-Hoster wach
  if (req.method === "GET" && url.pathname === "/music.mp3") return sendMusic(req, res);
  if (req.method === "GET" && url.pathname === "/events"){
    const r = rooms.get((url.searchParams.get("room") || "").toUpperCase());
    if (!r){ res.writeHead(404); return res.end(); }
    const host = url.searchParams.get("host") === r.hostToken;
    const token = url.searchParams.get("token") || "";
    res.writeHead(200, { "Content-Type":"text/event-stream", "Cache-Control":"no-store", Connection:"keep-alive", "X-Accel-Buffering":"no" });
    res.write("retry: 2000\n\n");
    const c = { res, code:r.code, token, host };
    r.clients.add(c);
    const p = r.players.find(x => x.token === token); if (p) p.conns++;
    broadcast(r);
    if (r.g && r.g.kind === "act" && r.g.strokes && r.g.strokes.length) drawSync(r, c);
    req.on("close", () => {
      r.clients.delete(c);
      const p2 = r.players.find(x => x.token === token); if (p2) p2.conns = Math.max(0, p2.conns - 1);
      setTimeout(() => { schMaybeAuto(r); broadcast(r); }, 50);
    });
    return;
  }
  if (req.method !== "POST" || !url.pathname.startsWith("/api/")){ res.writeHead(404); return res.end("Nicht gefunden"); }

  const b = await body(req), action = url.pathname.slice(5);
  if (action === "create"){ const r = createRoom(); return json(res, 200, { room:r.code, hostToken:r.hostToken }); }
  const r = rooms.get(String(b.room || "").toUpperCase());
  if (!r) return json(res, 404, { error:"Diesen Raum gibt es nicht (mehr). Bitte den QR-Code neu scannen." });

  if (action === "join"){
    const name = cleanName(b.name);
    if (!name) return json(res, 400, { error:"Bitte gib einen Namen ein." });
    let p = r.players.find(x => x.token === b.token);
    if (p){ p.name = name; broadcast(r); return json(res, 200, { token:p.token }); }
    if (r.players.length >= 30) return json(res, 400, { error:"Der Raum ist voll." });
    p = { id:rid(5), token:rid(16), name, team:0, conns:0 };
    assignTeam(r, p); r.players.push(p); broadcast(r);
    return json(res, 200, { token:p.token });
  }

  if (action === "host"){
    if (b.hostToken !== r.hostToken) return json(res, 403, { error:"Kein Host" });
    const g = r.g, k = g && g.kind;
    switch (b.do){
      case "teams":   r.teamCount = Math.min(4, Math.max(2, +b.n || 2)); shuffleTeams(r); break;
      case "shuffle": shuffleTeams(r); break;
      case "rename":  if (b.team >= 0 && b.team < 4) r.teamNames[b.team] = cleanName(b.name) || TEAM_NAMES[b.team]; break;
      case "kick":    r.players = r.players.filter(p => p.id !== b.id); break;
      case "start":
        if (b.game === "sch") schStart(r, b.opts || {});
        else if (activeTeams(r).length < 2) return json(res, 400, { error:"Dafür braucht es mindestens 2 Teams mit Spielern." });
        else if (b.game === "leo") leoStart(r, b.opts || {});
        else if (b.game === "act") actStart(r, b.opts || {});
        break;
      case "lobby":   clearTimer(r); if (g && g.phase === "end") r.lastResult = { kind:k, ranking:g.ranking }; r.g = null; break;
      case "finish":  if (g) finish(r); break;
      case "reveal":  if (k === "sch") schReveal(r); if (k === "leo" && (g.phase === "buzz" || g.phase === "answer")){ clearTimer(r); leoResult(r); } break;
      case "next":    if (k === "sch") schNext(r); if (k === "leo") leoContinue(r); if (k === "act") actNext(r); break;
      case "pick":    if (k === "leo") leoPick(r, +b.ci, +b.lv); break;
      case "swap":    if (k === "leo") leoSwap(r); break;
      case "judge":   if (k === "leo" && g.input === "rufen" && g.phase === "answer") leoResolve(r, !!b.ok, b.ok ? "laut gerufen" : "laut gerufen, falsch"); break;
      case "override":if (k === "leo") leoOverride(r, !!b.ok); break;
      case "skipExp": if (k === "act" && g.phase !== "result" && g.phase !== "run"){ g.explainer = null; g.level = null; g.word = null; g.phase = "who"; } break;
      case "actGot":  if (k === "act") actMark(r, b.team == null ? null : +b.team); break;
      case "actEnd":  if (k === "act") actEnd(r); break;
      case "score":   if (g && g.teamScores && g.teamScores[b.team] != null) g.teamScores[b.team] += +b.delta || 0; break;
    }
    broadcast(r); return json(res, 200, { ok:true });
  }

  const p = r.players.find(x => x.token === b.token);
  if (!p) return json(res, 401, { error:"unknown" });
  const g = r.g, k = g && g.kind;
  if (action === "act" && g){
    switch (b.do){
      case "guess": {
        const v = Number(b.value);
        if (k !== "sch" || g.phase !== "guess" || !Number.isFinite(v)) break;
        g.guesses[p.id] = v; schMaybeAuto(r); break;
      }
      case "pick":   if (k === "leo" && p.team === g.turn) leoPick(r, +b.ci, +b.lv); break;
      case "buzz":   if (k === "leo") leoBuzz(r, p); break;
      case "answer": if (k === "leo") leoAnswer(r, p, String(b.text || "").slice(0, 120)); break;
      case "claim":  if (k === "act" && g.phase === "who" && p.team === g.turn){ g.explainer = p.id; g.phase = "choose"; } break;
      case "unclaim":if (k === "act" && (g.phase === "choose" || g.phase === "ready") && p.id === g.explainer){ g.explainer = null; g.level = null; g.word = null; g.phase = "who"; } break;
      case "diff":   if (k === "act" && g.phase === "choose" && p.id === g.explainer && [1,2,3].includes(+b.level)){ g.level = +b.level; actNewWord(r); g.phase = "ready"; } break;
      case "swapWord": if (k === "act" && g.phase === "ready" && p.id === g.explainer) actNewWord(r, g.word); break;
      case "skip":   if (k === "act" && g.phase === "run" && p.id === g.explainer) actMark(r, null); break;
      case "draw":
        if (k === "act" && g.phase === "run" && g.mode === "draw" && p.id === g.explainer && +b.n === g.drawN) actDrawIn(r, b.segs);
        return json(res, 200, { ok:true });   // kein volles Update, nur der Strich-Stream
      case "undo":   if (k === "act" && g.mode === "draw" && p.id === g.explainer && +b.n === g.drawN){ const st = g.strokes.pop(); if (st) g.drawPts -= st.p.length; drawSync(r); } return json(res, 200, { ok:true });
      case "clear":  if (k === "act" && g.mode === "draw" && p.id === g.explainer && +b.n === g.drawN){ g.strokes = []; g.drawPts = 0; drawSync(r); } return json(res, 200, { ok:true });
      case "go":     if (k === "act" && g.phase === "ready" && p.id === g.explainer){ g.phase = "run"; g.endAt = Date.now() + g.time*1000; setTimer(r, g.time*1000, () => actEnd(r)); } break;
      case "got":    if (k === "act" && p.id === g.explainer && g.input === "rufen"){ const t = g.all ? +b.team : g.turn; if (r.teamNames[t] && t < r.teamCount) actMark(r, t); } break;
      case "guessWord": {
        if (k !== "act" || g.phase !== "run" || g.input !== "tippen" || p.id === g.explainer || !(g.all || p.team === g.turn)) break;
        const text = String(b.text || "").slice(0, 80).trim(); if (!text) break;
        const ok = isCorrect(text, g.word);
        g.feed.push({ name:p.name, team:p.team, text: ok ? g.word : text, ok });
        if (g.feed.length > 30) g.feed.shift();
        if (ok) actMark(r, p.team);
        break;
      }
      case "fail":   if (k === "act" && p.id === g.explainer) actEnd(r); break;
      case "actNext":if (k === "act" && p.id === g.explainer) actNext(r); break;
    }
    broadcast(r); return json(res, 200, { ok:true });
  }
  json(res, 400, { error:"Unbekannte Aktion" });
});

server.listen(PORT, "0.0.0.0", () => {
  const u = lanUrls();
  console.log("\n  Spieleabend läuft!\n");
  console.log("  Host-Bildschirm (auf diesem Gerät öffnen):  http://localhost:" + PORT + "/host");
  if (u.length) console.log("  Im WLAN erreichbar unter:  " + u.join("  ") + "\n  Die Handys scannen einfach den QR-Code am Host-Bildschirm.");
  console.log("\n  Beenden mit Strg+C.\n");
});

// Gemeinsame Helfer für Host und Handy
const $ = id => document.getElementById(id);
function el(tag, cls, txt){ const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
const TC = i => `var(--t${i})`;
const PC = ["#ff6f59","#43e5a6","#6fd3ff","#c6f04a","#ffc53d","#ff8fd6","#ffa94d","#b9f2e8"];
const fmt = n => Number(n).toLocaleString("de-AT", { maximumFractionDigits:3 });
const store = { get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return null; } },
                set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} },
                del(k){ try { localStorage.removeItem(k); } catch(e){} } };

let clockOffset = 0;
// Verbindung zum Raum. Bricht sie ab, prüft ein Wächter alle 2 s, ob der Raum noch existiert:
// ja -> neu verbinden (WLAN-Aussetzer, Server-Neustart), nein -> onGone (Raum ist weg).
function connect(qs, onView, onStatus, onEvent, onGone){
  let es, timer = null, closed = false;
  const watch = () => {
    if (timer || closed) return;
    timer = setInterval(async () => {
      if (closed){ clearInterval(timer); timer = null; return; }
      if (es && es.readyState === 1){ clearInterval(timer); timer = null; return; }
      try {
        const r = await fetch("/exists?room=" + encodeURIComponent(qs.room), { cache:"no-store" });
        if (r.status === 404){ clearInterval(timer); timer = null; closed = true; if (es) es.close(); onGone && onGone(); }
        else if (r.ok && (!es || es.readyState === 2)) open();
      } catch(e){ /* Server gerade nicht erreichbar, weiter warten */ }
    }, 2000);
  };
  const open = () => {
    if (es) es.close();
    es = new EventSource("/events?" + new URLSearchParams(qs));
    es.onmessage = e => { const v = JSON.parse(e.data); clockOffset = v.now - Date.now(); onStatus && onStatus(true); onView(v); };
    es.onerror = () => { onStatus && onStatus(false); watch(); };
    ["draw", "drawsync", "seen"].forEach(t => es.addEventListener(t, e => onEvent && onEvent(t, JSON.parse(e.data))));
  };
  open(); watch();
  return { reopen:open, close(){ closed = true; es && es.close(); } };
}
async function post(path, data){
  const r = await fetch("/api/" + path, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok){ const e = new Error(j.error || "Fehler"); e.status = r.status; throw e; }
  return j;
}
const secsLeft = endAt => Math.max(0, Math.ceil((endAt - (Date.now() + clockOffset)) / 1000));
const mmss = s => Math.floor(s/60) + ":" + String(s % 60).padStart(2, "0");
// Countdown-Elemente: <span data-end="…" data-total="…">
setInterval(() => {
  document.querySelectorAll("[data-end]").forEach(x => {
    const s = secsLeft(+x.dataset.end);
    if (x.classList.contains("bar")){ x.style.setProperty("--p", Math.max(0, s / (+x.dataset.total || 1))); return; }
    x.textContent = s > 0 ? mmss(s) : "Zeit!";
    x.classList.toggle("low", s <= 5);
  });
}, 200);
function countdown(endAt, cls){ const s = el("span", "clock " + (cls || "")); s.dataset.end = endAt; s.textContent = mmss(secsLeft(endAt)); return s; }
function timebar(endAt, totalSec){ const b = el("div", "bar"); b.dataset.end = endAt; b.dataset.total = totalSec; b.style.setProperty("--p", secsLeft(endAt)/totalSec); return b; }

/* „2.850“, „3,05“, „1,8 Mio“ */
function parseNum(s){
  s = String(s).trim().toLowerCase().replace(/\s+/g, " ");
  let mult = 1;
  const m = s.match(/(mrd|milliarde\w*|mio|million\w*|tsd|tausend)\.?$/);
  if (m){ mult = /^m(rd|illiard)/.test(m[1]) ? 1e9 : /^(mio|million)/.test(m[1]) ? 1e6 : 1e3; s = s.slice(0, m.index).trim(); }
  s = s.replace(/\s/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return isFinite(n) && /^-?[\d.]+$/.test(s) ? Math.round(n * mult * 1000) / 1000 : NaN;
}
const pct = (g, a) => { const r = Math.abs(g - a) / Math.max(Math.abs(a), 1e-9) * 100; return (r < 10 ? r.toFixed(1).replace(".", ",") : Math.round(r).toLocaleString("de-AT")) + " %"; };

/* Maßband für die Schätz-Auflösung */
function tape(answer, year, marks){
  const vals = [answer, ...marks.map(m => m.value)];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (!year) lo = Math.min(0, lo);
  let span = hi - lo || Math.abs(answer) || 1; lo -= span * .06; hi += span * .06; span = hi - lo;
  const pos = v => (v - lo) / span * 100;
  const wrap = el("div", "tapewrap"), t = el("div", "tape");
  const put = (v, color, txt, cls, lv) => {
    const k = el("div", "mk " + cls); k.style.setProperty("--c", color); k.style.setProperty("--lv", lv);
    const p = pos(v); k.style.left = p + "%"; if (p < 12) k.classList.add("edgeL"); if (p > 88) k.classList.add("edgeR");
    k.appendChild(el("span", null, txt)); t.appendChild(k);
  };
  const lastAt = []; let maxLv = 0;
  marks.map(m => ({ m, x:pos(m.value) })).sort((a, b) => a.x - b.x).forEach(it => {
    let lv = 0; while (lastAt[lv] !== undefined && it.x - lastAt[lv] < 20) lv++;
    lastAt[lv] = it.x; maxLv = Math.max(maxLv, lv); put(it.m.value, it.m.color, it.m.name, "up", lv);
  });
  put(answer, "var(--fg)", "Lösung", "truth dn", 0);
  wrap.style.paddingTop = (36 + maxLv * 20) + "px";
  wrap.appendChild(t); return wrap;
}

/* Zeichenfläche (4:3). Koordinaten sind 0..1, damit Handy und Fernseher dasselbe Bild zeigen.
   Das Element bleibt über Neuzeichnungen hinweg erhalten, die Striche liegen im Speicher. */
const INK = ["#1a0820", "#e8432f", "#2f6fe8", "#1f9d5c", "#f5f0e6"];   // letzte Farbe = Radierer (Papier)
const PEN = [0.006, 0.013, 0.045];
function makeBoard(){
  const cv = el("canvas", "board-canvas"), ctx = cv.getContext("2d");
  const B = { cv, ctx, n:-1, strokes:[] };
  const lw = s => PEN[s.w] * cv.width;
  const seg = (s, from) => {
    const P = s.p, W = cv.width, H = cv.height;
    ctx.strokeStyle = INK[s.c]; ctx.fillStyle = INK[s.c]; ctx.lineWidth = lw(s); ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (P.length === 1 || (from === 0 && P.length === 1)){ ctx.beginPath(); ctx.arc(P[0][0]*W, P[0][1]*H, lw(s)/2, 0, Math.PI*2); ctx.fill(); return; }
    ctx.beginPath(); const a = Math.max(0, from - 1); ctx.moveTo(P[a][0]*W, P[a][1]*H);
    for (let i = a + 1; i < P.length; i++) ctx.lineTo(P[i][0]*W, P[i][1]*H);
    ctx.stroke();
  };
  B.redraw = () => { ctx.fillStyle = INK[4]; ctx.fillRect(0, 0, cv.width, cv.height); B.strokes.forEach(s => seg(s, 0)); };
  B.fit = () => {
    const r = cv.getBoundingClientRect(); if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.round(r.width * dpr), h = Math.round(r.width * 0.75 * dpr);
    if (cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; }
    B.redraw();
  };
  B.reset = n => { B.n = n; B.strokes = []; B.redraw(); };
  B.sync = d => { B.n = d.n; B.strokes = d.strokes.map(s => ({ ...s, p:s.p.slice() })); B.redraw(); };
  B.add = d => {
    if (d.n !== B.n) B.reset(d.n);
    for (const x of d.segs){
      let s = B.strokes.find(q => q.id === x.id);
      if (!s){ s = { id:x.id, c:x.c, w:x.w, p:[] }; B.strokes.push(s); }
      const from = s.p.length; s.p.push(...x.p); seg(s, from);
    }
  };
  B.seg = seg;
  window.addEventListener("resize", () => { if (cv.isConnected) B.fit(); });
  return B;
}

/* KI-Moderator-Satz, falls die KI etwas zur Situation gesagt hat */
function aiLine(text){ const p = el("p", "aicomment"); p.append(el("span", "ai-tag", "KI-Moderator"), " " + text); return p; }

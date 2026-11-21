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
function connect(qs, onView, onStatus){
  let es;
  const open = () => {
    if (es) es.close();
    es = new EventSource("/events?" + new URLSearchParams(qs));
    es.onmessage = e => { const v = JSON.parse(e.data); clockOffset = v.now - Date.now(); onStatus && onStatus(true); onView(v); };
    es.onerror = () => { onStatus && onStatus(false); };
  };
  open();
  return { reopen:open, close(){ es && es.close(); } };
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

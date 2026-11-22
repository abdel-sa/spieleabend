// KI-Helfer über Groq (OpenAI-kompatible Schnittstelle).
// Ohne GROQ_API_KEY ist alles aus und die Spiele laufen mit ihren eigenen Regeln weiter.
// Gratis-Tarif: wenige Anfragen pro Minute und pro Tag, deshalb wird gebündelt und zwischengespeichert.
const KEY = process.env.GROQ_API_KEY || "";
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const FALLBACK_MODEL = "llama-3.1-8b-instant";
const URL = "https://api.groq.com/openai/v1/chat/completions";
const MOCK = process.env.AI_MOCK === "1";          // für lokale Tests ohne Schlüssel

const state = { ok:0, fail:0, lastError:"", blockedUntil:0, model:MODEL, minute:[], day:{ d:"", n:0 } };
const MAX_PER_MIN = Number(process.env.AI_MAX_PER_MIN) || 24;      // etwas unter dem Limit bleiben
const MAX_PER_DAY = Number(process.env.AI_MAX_PER_DAY) || 900;

const available = () => (!!KEY || MOCK) && Date.now() >= state.blockedUntil;
function budget(){
  const now = Date.now(), d = new Date().toISOString().slice(0, 10);
  state.minute = state.minute.filter(t => now - t < 60000);
  if (state.day.d !== d) state.day = { d, n:0 };
  return state.minute.length < MAX_PER_MIN && state.day.n < MAX_PER_DAY;
}
function status(){
  if (!KEY && !MOCK) return { on:false, text:"Kein Groq-Schlüssel hinterlegt" };
  if (Date.now() < state.blockedUntil) return { on:false, text:"Limit erreicht, kurze Pause" };
  if (!budget()) return { on:false, text:"Tageslimit fast erreicht" };
  return { on:true, text:state.fail > state.ok && state.fail > 2 ? "KI antwortet gerade unzuverlässig" : "KI bereit" };
}

// Antwort als JSON herauslösen, auch wenn das Modell Text drumherum schreibt
function parseJson(s){
  try { return JSON.parse(s); } catch(e){}
  const m = String(s || "").match(/\{[\s\S]*\}/); if (m){ try { return JSON.parse(m[0]); } catch(e){} }
  return null;
}

async function chat(system, user, { maxTokens = 700, temperature = 0.2, model = state.model } = {}){
  if (MOCK) return mock(system, user);
  if (!available()) throw new Error("KI nicht verfügbar");
  if (!budget()) throw new Error("KI-Limit erreicht");
  state.minute.push(Date.now()); state.day.n++;
  const body = { model, temperature, max_tokens:maxTokens, response_format:{ type:"json_object" },
    messages:[{ role:"system", content:system }, { role:"user", content:user }] };
  if (/gpt-oss/.test(model)) body.reasoning_effort = "low";
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(URL, { method:"POST", signal:ctl.signal,
      headers:{ "Authorization":"Bearer " + KEY, "Content-Type":"application/json" }, body:JSON.stringify(body) });
    if (res.status === 429){
      const wait = Number(res.headers.get("retry-after")) || 20;
      state.blockedUntil = Date.now() + Math.min(120, wait) * 1000;
      throw new Error("Groq-Limit (429)");
    }
    if (!res.ok){
      const t = await res.text().catch(() => "");
      // Modell nicht (mehr) verfügbar: einmal auf das Ersatzmodell wechseln
      if ((res.status === 404 || /model/i.test(t)) && model !== FALLBACK_MODEL){ state.model = FALLBACK_MODEL; return chat(system, user, { maxTokens, temperature, model:FALLBACK_MODEL }); }
      throw new Error("Groq " + res.status + " " + t.slice(0, 120));
    }
    const j = await res.json();
    const out = parseJson(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
    if (!out) throw new Error("Antwort war kein JSON");
    state.ok++; return out;
  } catch(e){
    state.fail++; state.lastError = String(e.message || e); throw e;
  } finally { clearTimeout(to); }
}

/* ---------- Bündelnde Prüfwarteschlange ----------
   Viele kleine Prüfungen (z. B. Stadt-Land-Fluss-Antworten aller Spieler) werden gesammelt
   und alle ~1,5 s in EINER Anfrage geprüft. Gleiche Fragen landen im Zwischenspeicher. */
function makeChecker({ system, render, maxBatch = 25, interval = 1500 }){
  const cache = new Map(), queue = new Map();   // key -> { item, cbs:[] }
  let busy = false;
  async function tick(){
    if (busy || !queue.size) return;
    if (!available() || !budget()){ return; }   // warten, bis wieder Luft ist
    busy = true;
    const batch = [...queue.entries()].slice(0, maxBatch);
    batch.forEach(([k]) => queue.delete(k));
    try {
      const out = await chat(system, render(batch.map(([, v]) => v.item)), { maxTokens:900 });
      const res = Array.isArray(out.results) ? out.results : [];
      batch.forEach(([k, v], i) => {
        const r = res.find(x => +x.i === i) || res[i];
        const val = r ? { ok:!!r.ok, hint:String(r.hint || "").slice(0, 80) } : null;
        if (val) cache.set(k, val);
        v.cbs.forEach(cb => cb(val));
      });
    } catch(e){
      batch.forEach(([, v]) => v.cbs.forEach(cb => cb(null)));   // null = KI konnte nicht prüfen
    } finally { busy = false; }
  }
  setInterval(tick, interval).unref();
  return {
    check(key, item, cb){
      if (cache.has(key)) return cb(cache.get(key));
      if (!available()) return cb(null);
      const q = queue.get(key); if (q) q.cbs.push(cb); else queue.set(key, { item, cbs:[cb] });
    },
    pending: () => queue.size,
  };
}

/* ---------- Testmodus ohne Schlüssel (AI_MOCK=1) ---------- */
function mock(system, user){
  const u = String(user);
  if (/"items"/.test(u)){
    const items = (parseJson(u) || {}).items || [];
    return { results:items.map((it, i) => {
      const t = String(it.antwort || it.eingabe || "").toLowerCase();
      const bad = /xxx|quatsch|asdf/.test(t);
      return { i, ok:!bad, hint:bad ? "Passt nicht zur Kategorie" : "" };
    }) };
  }
  return { text:"KI-Moderator (Test): Starke Runde, alle!" };
}

module.exports = { chat, makeChecker, status, available, parseJson };

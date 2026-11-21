// Antwortprüfung mit Tippfehler-Toleranz (für Leopardy)
function base(s){
  return String(s).toLowerCase()
    .replace(/[„“"«»]/g," ")
    .replace(/(\d+)\s*(?:zu|-|–)\s*(\d+)/g,"$1:$2")
    .replace(/ß/g,"ss").replace(/ä/g,"a").replace(/ö/g,"o").replace(/ü/g,"u")
    .normalize("NFD").replace(/[̀-ͯ]/g,"")
    .replace(/['’`ʿʾ]/g,"")
    .replace(/[^a-z0-9:]+/g," ")
    .replace(/ae/g,"a").replace(/oe/g,"o").replace(/ue/g,"u")
    .replace(/dsch/g,"j").replace(/tsch/g,"ch").replace(/sch/g,"sh").replace(/ph/g,"f").replace(/th/g,"t").replace(/dh/g,"d").replace(/kh/g,"k")
    .replace(/ck/g,"k").replace(/c(?!h)/g,"k").replace(/y/g,"i").replace(/ie/g,"i").replace(/w/g,"v").replace(/z/g,"s")
    .replace(/([a-z])\1+/g,"$1").trim();
}
const NUMW = {}, STOP = new Set();
Object.entries({null:0,eins:1,ein:1,eine:1,erste:1,erster:1,zwei:2,zweite:2,zweiter:2,zweites:2,drei:3,dritte:3,dritter:3,vier:4,vierte:4,
  "fünf":5,"fünfte":5,sechs:6,sechste:6,sieben:7,siebte:7,acht:8,achte:8,neun:9,zehn:10,elf:11,"zwölf":12,sechzehn:16,siebzehn:17})
  .forEach(([w,n]) => NUMW[base(w)] = String(n));
const ROM = {ii:"2",iii:"3",iv:"4",v:"5",vi:"6",vii:"7",viii:"8"};
("der die das den dem des ein eine einen the al el as ad an ar at az ash asch von im in jahr n h nh "+
 "ich glaube denke es ist war vielleicht antwort lautet also bin mir sicher").split(" ").forEach(w => STOP.add(base(w)));

function toks(s){
  const t = base(s).split(" ").filter(Boolean).map(w => ROM[w] || NUMW[w] || w);
  const k = t.filter(w => !STOP.has(w));
  return k.length ? k : t;
}
function lev(a,b){
  const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
  let p=[...Array(n+1).keys()];
  for(let i=1;i<=m;i++){ const c=[i]; for(let j=1;j<=n;j++) c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1)); p=c; }
  return p[n];
}
function near(a,b){
  if (a===b) return true;
  if (/\d/.test(a) || /\d/.test(b)) return false;      // Zahlen müssen exakt stimmen
  const L = Math.max(a.length,b.length);
  const tol = L<=4 ? 0 : L<=7 ? 1 : 2;
  return lev(a,b) <= tol;
}
function sameSeq(u, v){
  if (u.length === v.length && u.every((w,i) => near(w, v[i]))) return true;
  return u.length !== v.length && near(u.join(""), v.join(""));
}
function matchOne(ut, vt){
  if (!vt.length || !ut.length) return false;
  if (sameSeq(ut, vt)) return true;
  if (ut.length > vt.length + 3) return false;          // keine Antwort-Listen erraten
  for (let len = Math.max(1, vt.length-1); len <= vt.length+1; len++)
    for (let i = 0; i + len <= ut.length; i++)
      if (sameSeq(ut.slice(i,i+len), vt)) return true;
  return false;
}
function variants(answer, alts){
  const out = [answer.replace(/\(.*?\)/g," ").replace(/„.*?“/g," ")];
  (answer.match(/\((.*?)\)/g)||[]).forEach(x => out.push(x.slice(1,-1)));
  (answer.match(/„(.*?)“/g)||[]).forEach(x => out.push(x.slice(1,-1)));
  (alts||[]).forEach(a => out.push(a));
  return out.filter(v => v.trim());
}
function isCorrect(input, answer, alts){
  const ut = toks(input);
  if (!ut.length) return false;
  for (const v of variants(answer, alts)){
    if (matchOne(ut, toks(v))) return true;
    const parts = v.split(/\s+(?:und|&)\s+/i);
    if (parts.length > 1 && parts.every(p => matchOne(ut, toks(p.replace(/\s+[–-]\s+.*/,""))))) return true;
  }
  return false;
}
module.exports = { isCorrect };

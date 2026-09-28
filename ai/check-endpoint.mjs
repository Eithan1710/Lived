// Checks the DEPLOYED AI worker end to end, the same way the site calls it.
// Run by .github/workflows/ai-check.yml (Actions → "AI check" → Run workflow). Locally:
//   AI_ENDPOINT=https://lived-ai.<you>.workers.dev ORIGIN=https://eithan1710.github.io node ai/check-endpoint.mjs
// Uses about 30 free-tier Gemini requests.
import {buildCases, check} from './cases.mjs';

const endpoint = (process.env.AI_ENDPOINT || '').replace(/\/+$/, '');
const origin = process.env.ORIGIN || 'https://eithan1710.github.io';
if(!endpoint){ console.error('AI_ENDPOINT is not set (GitHub secret AI_ENDPOINT).'); process.exit(1); }

// 1. setup
const h = await fetch(endpoint + '/health', {signal: AbortSignal.timeout(15000)}).catch(e => ({ok:false, status:0, text: async () => e.message}));
console.log(`/health → ${h.status}\n${await h.text()}\n`);

// 2. the site's origin is accepted (CORS)
const pre = await fetch(endpoint + '/', {method:'OPTIONS', headers:{Origin: origin, 'Access-Control-Request-Method':'POST'}});
console.log(`CORS preflight from ${origin} → ${pre.status} ${pre.headers.get('access-control-allow-origin') || '(no allow-origin header)'}\n`);

// 3. real sentences
const pad = n => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
let fails = 0, errors = 0; const times = []; const wins = {};
const cases = buildCases(now);
for(const c of cases){
  let ev = null, err = '', traceText = '';
  try{
    const t0 = Date.now();
    const r = await fetch(endpoint + '/', {method:'POST', signal: AbortSignal.timeout(15000), headers:{'Content-Type':'application/json', Origin: origin},
      body: JSON.stringify({text: c.text, today, now: `${pad(now.getHours())}:${pad(now.getMinutes())}`, weekday: now.getDay(), tz: 'Asia/Jerusalem'})});
    const body = await r.json().catch(() => ({}));
    const tr = (body.meta && body.meta.trace) || [];
    traceText = tr.map(x => `${x.model.replace('gemini-', '')} ${x.ms}ms ${x.result}`).join(' | ');
    for(const x of tr) if(x.result === 'ok') wins[x.model] = (wins[x.model] || 0) + 1;
    delete body.meta;
    if(r.ok) ev = body; else err = `HTTP ${r.status} ${JSON.stringify(body)}`;
    const ms = Date.now() - t0; times.push(ms);
    if(ms > 10000) err = (err ? err + '; ' : '') + `took ${ms} ms — the site stops waiting at 10000 ms`;
  }catch(e){ err = e.message; }
  const p = err ? [err] : check(ev, c);
  if(err) errors++; else if(p.length) fails++;
  console.log(`${p.length ? 'FAIL' : 'ok  '} ${c.text}\n     → ${ev ? JSON.stringify(ev) : ''}${traceText ? '\n     ⏱ ' + traceText : ''}${p.length ? '\n     ✗ ' + p.join('; ') : ''}`);
  await new Promise(r => setTimeout(r, 4500));   // stay under the free-tier requests-per-minute limit
}
times.sort((a, b) => a - b);
console.log(`\nAI: ${cases.length - fails - errors}/${cases.length} passed, ${fails} wrong, ${errors} errors`);
if(times.length) console.log(`response time: median ${times[times.length >> 1]} ms, slowest ${times[times.length - 1]} ms`);
console.log('answered by:', JSON.stringify(wins));
process.exit(fails + errors ? 1 : 0);

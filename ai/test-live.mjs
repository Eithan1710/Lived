// Live test against the real Gemini API directly (no worker). Needs GEMINI_API_KEY (env var or .env in the repo root).
// Run: node ai/test-live.mjs      (about 30 free-tier requests)
import {readFileSync} from 'node:fs';
import {extract} from './worker.js';
import {buildCases, check} from './cases.mjs';

const env = {...process.env};
try{
  for(const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')){
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if(m && !env[m[1]]) env[m[1]] = m[2];
  }
}catch(e){}
if(!env.GEMINI_API_KEY){ console.error('Set GEMINI_API_KEY (or put it in .env)'); process.exit(1); }

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const ctx = {today: `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`,
  weekday: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()],
  now: `${pad(now.getHours())}:${pad(now.getMinutes())}`, tz: Intl.DateTimeFormat().resolvedOptions().timeZone};
let fails = 0;
const cases = buildCases(now);
for(const c of cases){
  let ev, err;
  try{ ev = await extract(c.text, ctx, env); }catch(e){ err = `${e.message} ${e.detail || ''}`; }
  const p = err ? [err] : check(ev, c);
  if(p.length) fails++;
  console.log(`${p.length ? 'FAIL' : 'ok  '} ${c.text}\n     → ${ev ? JSON.stringify(ev) : ''}${p.length ? '\n     ✗ ' + p.join('; ') : ''}`);
  await new Promise(r => setTimeout(r, 4500));
}
console.log(fails ? `\n${fails} of ${cases.length} failed` : `\nall ${cases.length} passed`);
process.exit(fails ? 1 : 0);

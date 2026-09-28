// Live test against the real Gemini API. Needs GEMINI_API_KEY (env var or .env in the repo root). Free tier: ~10 requests.
// Run: node ai/test-live.mjs
import {readFileSync} from 'node:fs';
import {extract} from './worker.js';

const env = {...process.env};
try{
  for(const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')){
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if(m && !env[m[1]]) env[m[1]] = m[2];
  }
}catch(e){}
if(!env.GEMINI_API_KEY){ console.error('Set GEMINI_API_KEY (or put it in .env)'); process.exit(1); }

const pad = n => String(n).padStart(2,'0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today = new Date(); today.setHours(12,0,0,0);
const plus = n => { const d = new Date(today); d.setDate(d.getDate()+n); return ymd(d); };
const nextDow = (dow, strict) => { let n = (dow - today.getDay() + 7) % 7; if(n===0 && strict) n = 7; return n; };
const lastDow = dow => -(((today.getDay() - dow + 7) % 7) || 7);
const ctx = {today: ymd(today), weekday: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][today.getDay()], now: '12:00', tz: Intl.DateTimeFormat().resolvedOptions().timeZone};

const cases = [
  ['Dinner with Sarah tomorrow at 8pm',        {date:[plus(1)], time:'20:00', category:'food'}],
  ['Gym today at 6',                           {date:[plus(0)], time:'18:00', category:'fitness'}],
  ['Meeting with John next Tuesday at 10',     {date:[plus(nextDow(2,true)), plus(nextDow(2,true)+7)], time:'10:00', category:'work'}],
  ["Mom's birthday on October 20",             {dateEnds:'-10-20', time:'', category:'birthday'}],
  ['Barcelona game Sunday at 9pm',             {date:[plus(nextDow(0,false)), plus(nextDow(0,true))], time:'21:00', category:'sports'}],
  ['Dentist appointment tomorrow at 14:30',    {date:[plus(1)], time:'14:30', category:'health'}],
  ['Concert in Tel Aviv next Friday',          {date:[plus(nextDow(5,true)), plus(nextDow(5,true)+7)], time:'', category:'entertainment', location:/tel aviv/i}],
  ['Yesterday I had dinner with Sarah at 8pm', {date:[plus(-1)], time:'20:00', category:'food'}],
  ['אתמול ארוחת ערב עם שרה ב-20:00',            {date:[plus(-1)], time:'20:00', category:'food'}],
  ['הלכתי לרופא שיניים ביום חמישי שעבר',         {date:[plus(lastDow(4))], time:'', category:'health'}],
  ['פגישה עם יוסי מחר ב-14:00 בתל אביב',         {date:[plus(1)], time:'14:00', category:'work', location:/תל אביב/}],
];

let fails = 0;
for(const [text, exp] of cases){
  let ev, err;
  try{ ev = await extract(text, ctx, env); }catch(e){ err = `${e.message} ${e.detail||''}`; }
  const problems = [];
  if(!ev) problems.push(err || 'invalid output');
  else {
    if(exp.date && !exp.date.includes(ev.date)) problems.push(`date ${ev.date} (expected ${exp.date.join(' or ')})`);
    if(exp.dateEnds && !ev.date.endsWith(exp.dateEnds)) problems.push(`date ${ev.date}`);
    if(ev.time !== exp.time) problems.push(`time "${ev.time}" (expected "${exp.time}")`);
    if(ev.category !== exp.category) problems.push(`category ${ev.category} (expected ${exp.category})`);
    if(exp.location && !exp.location.test(ev.location)) problems.push(`location "${ev.location}"`);
  }
  if(problems.length) fails++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '}  ${text}\n      → ${ev ? JSON.stringify(ev) : ''}${problems.length ? '\n      ✗ ' + problems.join('; ') : ''}`);
  await new Promise(r => setTimeout(r, 4500));   // stay under the free-tier requests-per-minute limit
}
console.log(fails ? `\n${fails} of ${cases.length} failed` : `\nall ${cases.length} passed`);
process.exit(fails ? 1 : 0);

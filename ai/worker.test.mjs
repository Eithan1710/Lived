// Offline tests for ai/worker.js (no API key needed): request shape, validation, origin check, errors.
// Run: node ai/worker.test.mjs
import assert from 'node:assert/strict';
import worker, {clean, extract, SCHEMA, CATEGORIES, DEFAULT_MODEL} from './worker.js';

let sent;
const gemini = (payload, status = 200) => async (url, opts) => {
  sent = {url, opts, body: JSON.parse(opts.body)};
  return new Response(JSON.stringify(status === 200 ? {candidates:[{content:{parts:[{text: typeof payload === 'string' ? payload : JSON.stringify(payload)}]}}]} : {error:{message:'x'}}), {status});
};
const env = {GEMINI_API_KEY:'test-key', ALLOWED_ORIGINS:'https://site.test'};
const ctx = {today:'2026-09-28', weekday:'Monday', now:'10:00', tz:'Asia/Jerusalem'};

// request sent to Gemini: model, key in header (not URL), JSON schema output, temperature 0
await extract('Dinner with Sarah tomorrow at 8pm', ctx, env, gemini({title:'Dinner with Sarah', date:'2026-09-29', time:'20:00', endTime:'', location:'', notes:'', category:'food'}));
assert.match(sent.url, new RegExp(`/models/${DEFAULT_MODEL}:generateContent$`));
assert.equal(sent.opts.headers['x-goog-api-key'], 'test-key');
assert.ok(!sent.url.includes('test-key'), 'key must not be in the URL');
assert.equal(sent.body.generationConfig.responseMimeType, 'application/json');
assert.deepEqual(sent.body.generationConfig.responseJsonSchema, SCHEMA);
assert.equal(sent.body.generationConfig.temperature, 0);
assert.deepEqual(SCHEMA.properties.category.enum, CATEGORIES);
assert.match(sent.body.contents[0].parts[0].text, /Today: 2026-09-28 \(Monday\)/);

// validation / normalisation
assert.deepEqual(clean({title:' Gym ', date:'2026-09-28', time:'6:05', endTime:'7:00', location:'', notes:'', category:'fitness'}),
  {title:'Gym', date:'2026-09-28', time:'06:05', endDate:'', endTime:'07:00', location:'', notes:'', category:'fitness'});
// multi-day: endDate kept only when valid and after the start date
assert.equal(clean({title:'Trip', date:'2026-10-03', time:'', endDate:'2026-10-06', category:'travel'}).endDate, '2026-10-06');
assert.equal(clean({title:'Trip', date:'2026-10-03', time:'', endDate:'2026-10-03', category:'travel'}).endDate, '');
assert.equal(clean({title:'Trip', date:'2026-10-03', time:'', endDate:'2026-10-01', category:'travel'}).endDate, '');
assert.equal(clean({title:'Trip', date:'2026-10-03', time:'', endDate:'oct 6', category:'travel'}).endDate, '');
assert.equal(clean({title:'Trip', date:'2026-10-03', time:'', endDate:'2028-10-06', category:'travel'}).endDate, '');
assert.equal(clean({title:'x', date:'tomorrow', time:'', category:'food'}), null);            // bad date → reject
assert.equal(clean({title:'x', date:'2026-10-20', time:'25:00', category:'nope'}).time, '');   // bad time → all-day
assert.equal(clean({title:'x', date:'2026-10-20', time:'', category:'nope'}).category, 'other');
assert.equal(clean({title:'x', date:'2026-10-20', time:'', endTime:'10:00', category:'food'}).endTime, ''); // no end without start
await assert.rejects(extract('x', ctx, env, gemini('not json')));   // invalid answers from both models → error

// HTTP handler
const call = (origin, body, method = 'POST') => worker.fetch(new Request('https://w.test/', {method, headers:{'Origin':origin, 'Content-Type':'application/json'}, body: method==='POST' ? JSON.stringify(body) : undefined}), env);
assert.equal((await call('https://evil.test', {text:'hi'})).status, 403);
assert.equal((await call('https://site.test', {text:''})).status, 400);
assert.equal((await call('https://site.test', null, 'OPTIONS')).status, 200);
assert.equal((await worker.fetch(new Request('https://w.test/', {method:'POST', headers:{Origin:'https://site.test'}, body:'{"text":"a"}'}), {ALLOWED_ORIGINS:'https://site.test'})).status, 500);

const realFetch = globalThis.fetch;
globalThis.fetch = gemini({}, 429);
let r = await call('https://site.test', {text:'Gym today at 6', today:'2026-09-28', weekday:1});
assert.equal(r.status, 429);
assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://site.test');
globalThis.fetch = gemini({title:'Gym', date:'2026-09-28', time:'18:00', endTime:'', location:'', notes:'', category:'fitness'});
r = await call('https://site.test', {text:'Gym today at 6', today:'2026-09-28', weekday:1});
assert.equal(r.status, 200);
const gymBody = await r.json();
assert.equal(gymBody.meta.trace[0].result, 'ok'); delete gymBody.meta;
assert.deepEqual(gymBody, {title:'Gym', date:'2026-09-28', time:'18:00', endDate:'', endTime:'', location:'', notes:'', category:'fitness'});
globalThis.fetch = realFetch;
// retry: a 503 then a good answer → success; 429 → no retry
let calls = 0;
const flaky = async (u, o) => { calls++; return calls === 1 ? new Response('{}', {status:503}) : gemini({title:'A', date:'2026-10-01', time:'', category:'food'})(u, o); };
assert.equal((await extract('x', ctx, env, flaky)).title, 'A'); assert.equal(calls, 2);
// 429 on the main model → fallback model (separate quota); both 429 → error
calls = 0; const seen = [];
const quota = async (u) => { calls++; seen.push(u.match(/models\/([^:]+)/)[1]); return new Response('{}', {status:429}); };
await assert.rejects(extract('x', ctx, env, quota)); assert.equal(calls, 2);
assert.deepEqual(seen, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
// a bad key (400/401/403) is not retried
calls = 0;
await assert.rejects(extract('x', ctx, env, async () => { calls++; return new Response('{"error":{"message":"API key not valid"}}', {status:400}); }));
assert.equal(calls, 1);
// thinkingConfig is sent to Gemini 3 models; a model that rejects it is asked again without it
let bodies = [];
const noThink = async (u, o) => { const b = JSON.parse(o.body); bodies.push(b);
  if(b.generationConfig.thinkingConfig) return new Response('{"error":{"message":"thinking_level is not supported"}}', {status:400});
  return gemini({title:'T', date:'2026-10-01', time:'', category:'food'})(u, o); };
assert.equal((await extract('x', ctx, env, noThink)).title, 'T');
assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingLevel, 'minimal');
assert.equal(bodies[1].generationConfig.thinkingConfig, undefined);
// hedging: main model slow → fallback asked after 2.5 s, its answer wins; trace records both
{
  const seen = [], trace = [];
  const slowMain = async (u, o) => { const m = u.match(/models\/([^:]+)/)[1]; seen.push(m);
    if(m === 'gemini-3.1-flash-lite') await new Promise(r => setTimeout(r, 4000));
    return gemini({title: m, date:'2026-10-01', time:'', category:'food'})(u, o); };
  const t0 = Date.now();
  const ev = await extract('x', ctx, env, slowMain, trace);
  assert.equal(ev.title, 'gemini-3.5-flash-lite');
  assert.ok(Date.now() - t0 < 3500, 'fallback answer should arrive after ~2.5 s');
  assert.deepEqual(seen, ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite']);
  assert.equal(trace[0].model, 'gemini-3.5-flash-lite');
}
// fast main model → fallback never asked
{
  const seen = [];
  await extract('x', ctx, env, async (u, o) => { seen.push(u); return gemini({title:'A', date:'2026-10-01', time:'', category:'food'})(u, o); });
  await new Promise(r => setTimeout(r, 2700));
  assert.equal(seen.length, 1);
}
console.log('worker tests passed');

// /health: reports setup without revealing the key
globalThis.fetch = async () => new Response(JSON.stringify({name:'models/x'}), {status:200});
let h = await worker.fetch(new Request('https://w.test/health'), {GEMINI_API_KEY:'secret-key', ALLOWED_ORIGINS:'https://site.test'});
let hj = await h.json();
assert.equal(h.status, 200); assert.equal(hj.gemini, 'ok'); assert.equal(hj.keySet, true);
assert.ok(!JSON.stringify(hj).includes('secret-key'));
globalThis.fetch = async () => new Response(JSON.stringify({error:{message:'API key not valid'}}), {status:400});
hj = await (await worker.fetch(new Request('https://w.test/health'), {GEMINI_API_KEY:'bad', ALLOWED_ORIGINS:'x'})).json();
assert.match(hj.gemini, /HTTP 400: API key not valid/);
hj = await (await worker.fetch(new Request('https://w.test/health'), {ALLOWED_ORIGINS:'x'})).json();
assert.equal(hj.keySet, false); assert.equal(hj.ok, false);
globalThis.fetch = realFetch;
// key under a slightly different name is still found; health lists names, not values
globalThis.fetch = async () => new Response('{}', {status:200});
hj = await (await worker.fetch(new Request('https://w.test/health'), {'GEMINI_API_KEY ':'k1', ALLOWED_ORIGINS:'x'})).json();
assert.equal(hj.keySet, true); assert.ok(hj.variableNames.includes('GEMINI_API_KEY ')); assert.ok(!JSON.stringify(hj).includes('k1'));
hj = await (await worker.fetch(new Request('https://w.test/health'), {google_api_key:'k2', ALLOWED_ORIGINS:'x'})).json();
assert.equal(hj.keySet, true);
globalThis.fetch = realFetch;
console.log('health tests passed');

// End-to-end test: deleting an event removes it from Google Calendar (fake Calendar API, mocked sign-in).
// Needs Playwright with Chromium and python3. Run from the repo root:  node tests/google-delete.test.mjs
import {mkdtempSync, copyFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module'; import {execSync, spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let chromium;
try{ ({chromium} = require('playwright')); }catch(e){ ({chromium} = require(execSync('npm root -g').toString().trim() + '/playwright')); }
const dir = mkdtempSync(join(tmpdir(), 'lived-test-'));
for(const f of ['index.html', 'manifest.json', 'icon.svg', 'icon-192.png']) copyFileSync(f, join(dir, f));
writeFileSync(join(dir, 'config.js'), 'window.LIVED_CONFIG = {"GOOGLE_CLIENT_ID":"test.apps.googleusercontent.com","AI_ENDPOINT":""};\n');
const site = spawn('python3', ['-m','http.server','8124','--bind','127.0.0.1','--directory', dir], {stdio:'ignore'});
await new Promise(r => setTimeout(r, 800));

// ---------- fake Google Calendar ----------
const store = new Map();               // id → event
let nextId = 1, mode = {}, calls = [];
const b64 = s => Buffer.from(s).toString('base64').replace(/=+$/,'');
function make(body){ const id = 'ev' + String(nextId++).padStart(6, '0'); const it = {...body, id, status:'confirmed', htmlLink:`https://www.google.com/calendar/event?eid=${b64(id + ' me@example.com')}`}; store.set(id, it); return it; }

const b = await chromium.launch(); const p = await b.newPage({viewport:{width:390, height:900}});
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.route('https://fonts.googleapis.com/**', r => r.abort());
let tokenRequests = 0;
await p.route('https://accounts.google.com/gsi/client', r => r.fulfill({contentType:'text/javascript', body:
  `window.google={accounts:{oauth2:{initTokenClient:(o)=>({requestAccessToken(){ window.__tokReq=(window.__tokReq||0)+1; const t=this; setTimeout(()=>window.__popupFail ? t.error_callback({type:'popup_closed'}) : t.callback({access_token:'tok'+window.__tokReq,expires_in:3600}),10); }}),revoke(){}}}};`}));
await p.route('https://www.googleapis.com/calendar/v3/**', async r => {
  const req = r.request(), u = new URL(req.url()), m = req.method();
  calls.push(`${m} ${u.pathname.replace('/calendar/v3','')}${u.search}`);
  const json = (code, obj) => r.fulfill({status:code, contentType:'application/json', body: obj === undefined ? '' : JSON.stringify(obj)});
  if(mode.fail401 && m !== 'GET'){ mode.fail401 = false; return json(401, {error:{message:'Invalid Credentials'}}); }
  if(m === 'POST'){ if(mode.slowInsert) await new Promise(x => setTimeout(x, 1500)); return json(200, make(JSON.parse(req.postData()))); }
  if(m === 'DELETE'){
    if(mode.deleteFail){ return json(mode.deleteFail, {error:{message:'boom'}}); }
    if(mode.slowDelete) await new Promise(x => setTimeout(x, 700));
    const id = decodeURIComponent(u.pathname.split('/').pop());
    const it = store.get(id);
    if(!it) return json(404, {error:{message:'Not Found'}});
    if(it.status === 'cancelled') return json(410, {error:{message:'Resource has been deleted'}});
    it.status = 'cancelled'; return r.fulfill({status:204, body:''});
  }
  if(m === 'GET'){
    let items = [...store.values()].filter(x => x.status !== 'cancelled');
    const pep = u.searchParams.get('privateExtendedProperty');
    if(pep){ const [k, v] = pep.split('='); items = items.filter(x => x.extendedProperties?.private?.[k] === v); }
    const q = u.searchParams.get('q'); if(q) items = items.filter(x => (x.summary || '').includes(q));
    return json(200, {items});
  }
  json(400, {});
});

await p.goto('http://127.0.0.1:8124/'); await p.waitForTimeout(400);
const alive = () => [...store.values()].filter(x => x.status !== 'cancelled');
const ui = () => p.evaluate(() => events.map(e => e.title));
async function create(text){
  await p.fill('#text', text); await p.press('#text', 'Enter'); await p.waitForSelector('#saveBtn');
  await p.click('#saveBtn'); await p.waitForTimeout(150);
}
const item = title => p.locator('.ev', {hasText: title});
async function del(title, confirm = true){
  if(!(await item(title).locator('.more').isVisible())) await item(title).locator('.body').click();
  await item(title).locator('[data-act="del"]').click();
  if(confirm) await item(title).locator('[data-act="del"]').click();
}
const log = (...a) => console.log('✓', ...a);

// 1. create → appears in Google with ID + livedId stored
await create('ארוחת ערב עם שרה מחר ב-20:00');
await create('חדר כושר מחר ב-18:00');
store.set('foreign1', {id:'foreign1', status:'confirmed', summary:'ארוחת ערב עם שרה', start:{dateTime:'2026-10-12T20:00:00+03:00'}, end:{dateTime:'2026-10-12T21:00:00+03:00'}});
let saved = await p.evaluate(() => JSON.parse(localStorage.getItem('lived_events')));
assert.equal(alive().length, 3);
assert.ok(saved.every(e => e.g === 'ok' && /^ev\d+$/.test(e.gId) && e.gCal === 'primary'));
assert.ok(alive().filter(x => x.id !== 'foreign1').every(x => saved.some(e => e.id === x.extendedProperties.private.livedId)));
log('create: both events in Google; app stores gId/gCal; Google event carries livedId');

// 2. delete → DELETE with the right ID; others untouched
calls = [];
const dinnerId = saved.find(e => e.title.startsWith('ארוחת')).gId;
await del('ארוחת ערב עם שרה'); await p.waitForTimeout(200);
assert.deepEqual(calls, [`DELETE /calendars/primary/events/${dinnerId}?sendUpdates=none`]);
assert.equal(store.get(dinnerId).status, 'cancelled');
assert.ok(store.get('foreign1').status === 'confirmed' && alive().some(x => x.summary.includes('כושר')));
assert.deepEqual(await ui(), ['חדר כושר']);
log('delete: exactly one DELETE for the right ID; unrelated + same-titled foreign event untouched; UI updated');

// 3. API failure → stays everywhere, error + retry; retry succeeds
await create('פגישה עם יוסי מחר ב-10:00');
mode.deleteFail = 500; calls = [];
await del('פגישה עם יוסי'); await p.waitForTimeout(200);
assert.ok((await ui()).includes('פגישה עם יוסי'));
assert.ok(alive().some(x => x.summary === 'פגישה עם יוסי'));
assert.match(await item('פגישה עם יוסי').locator('.err').textContent(), /לא אישר את המחיקה/);
assert.equal(await item('פגישה עם יוסי').locator('[data-act="del"]').textContent(), 'נסו שוב');
await p.reload(); assert.ok((await ui()).includes('פגישה עם יוסי'));            // still saved after reload
saved = await p.evaluate(() => JSON.parse(localStorage.getItem('lived_events')));
assert.ok(saved.every(e => !('deleting' in e) && !('delError' in e)));
mode.deleteFail = 0;
await del('פגישה עם יוסי'); await p.waitForTimeout(200);   // after reload: fresh confirm flow
assert.ok(!(await ui()).includes('פגישה עם יוסי')); assert.ok(!alive().some(x => x.summary === 'פגישה עם יוסי'));
log('500 on delete: event kept in app + Google, error shown with "נסו שוב", survives reload; retry deletes it');

// 3b. retry button straight from the error state
await create('קפה עם מיכל מחר ב-9:00');
mode.deleteFail = 503; await del('קפה עם מיכל'); await p.waitForTimeout(150);
mode.deleteFail = 0; await item('קפה עם מיכל').locator('[data-act="del"]').click(); await p.waitForTimeout(200);
assert.ok(!(await ui()).includes('קפה עם מיכל')); assert.ok(!alive().some(x => x.summary === 'קפה עם מיכל'));
log('503 then "נסו שוב": deleted in Google and app');

// 4. already deleted in Google (410 / 404) → handled as success
await create('ריצה מחר בבוקר');
let id = (await p.evaluate(() => events.find(e => e.title === 'ריצה').gId));
store.get(id).status = 'cancelled';                                       // deleted directly in Google
await del('ריצה'); await p.waitForTimeout(200);
assert.ok(!(await ui()).includes('ריצה'));
await create('יוגה מחר ב-7:00');
id = await p.evaluate(() => events.find(e => e.title === 'יוגה').gId); store.delete(id);    // gone entirely → 404
await del('יוגה'); await p.waitForTimeout(200);
assert.ok(!(await ui()).includes('יוגה'));
log('event already deleted in Google (410 and 404): removed from the app without an error');

// 5. expired session (401) → token cleared, clear message; retry gets a new token and deletes
await create('שיעור גיטרה מחר ב-17:00');
mode.fail401 = true; const tokBefore = await p.evaluate(() => window.__tokReq || 0);
await del('שיעור גיטרה'); await p.waitForTimeout(200);
assert.match(await item('שיעור גיטרה').locator('.err').textContent(), /ההתחברות ל-Google פגה/);
assert.equal(await p.evaluate(() => accessToken), null);
await item('שיעור גיטרה').locator('[data-act="del"]').click(); await p.waitForTimeout(250);
assert.ok(await p.evaluate(() => window.__tokReq) > tokBefore);
assert.ok(!(await ui()).includes('שיעור גיטרה')); assert.ok(!alive().some(x => x.summary === 'שיעור גיטרה'));
log('401: session-expired message, token dropped; retry signs in again and deletes');

// 6. sign-in cancelled → not deleted, message
await create('מסיבה בשבת ב-22:00');
await p.evaluate(() => { accessToken = null; tokenExp = 0; window.__popupFail = true; });
await del('מסיבה'); await p.waitForTimeout(200);
assert.match(await item('מסיבה').locator('.err').textContent(), /ההתחברות ל-Google בוטלה/);
assert.ok(alive().some(x => x.summary === 'מסיבה'));
await p.evaluate(() => { window.__popupFail = false; });
await item('מסיבה').locator('[data-act="del"]').click(); await p.waitForTimeout(250);
assert.ok(!alive().some(x => x.summary === 'מסיבה'));
log('sign-in popup closed: nothing deleted, message; retry works');

// 7. duplicate requests: rapid clicks → one DELETE
await create('ספרייה מחר ב-12:00');
mode.slowDelete = true; calls = [];
await item('ספרייה').locator('.body').click(); await item('ספרייה').locator('[data-act="del"]').click();
await p.evaluate(() => { const b = document.querySelector('.ev.open [data-act="del"]'); b.click(); b.click(); b.click(); });
await p.waitForTimeout(100);
assert.equal(await item('ספרייה').locator('.del').textContent(), 'מוחק…');
await p.waitForTimeout(900);
assert.equal(calls.filter(c => c.startsWith('DELETE')).length, 1); mode.slowDelete = false;
assert.ok(!(await ui()).includes('ספרייה'));
log('triple click on confirm: a single DELETE request, button shows "מוחק…"');

// 8. legacy event saved before this fix: only gLink, no gId
const legacy = make({summary:'אירוע ישן', start:{date:'2026-09-01'}, end:{date:'2026-09-02'}});
await p.evaluate(l => { events.push({id:'old1', title:'אירוע ישן', start:new Date(2026,8,1), end:new Date(2026,8,2), allDay:true, location:'', notes:'', cat:'other', g:'ok', gLink:l}); persist(); renderTimeline(); }, legacy.htmlLink);
calls = []; await del('אירוע ישן'); await p.waitForTimeout(200);
assert.deepEqual(calls, [`DELETE /calendars/primary/events/${legacy.id}?sendUpdates=none`]);
assert.equal(store.get(legacy.id).status, 'cancelled');
log('legacy event (only htmlLink stored): ID recovered from the link and deleted');

// 9. event sent to Google's pre-filled page (no ID): found by exact match only
const tplEvent = make({summary:'✈️ טיול לצפון', description:'✈️ טיולים', start:{date:'2026-10-20'}, end:{date:'2026-10-22'}});
const lookalike = make({summary:'טיול לצפון', description:'משהו אחר', start:{date:'2026-10-20'}, end:{date:'2026-10-22'}});
await p.evaluate(() => { events.push({id:'tpl1', title:'טיול לצפון', start:new Date(2026,9,20), end:new Date(2026,9,22), allDay:true, location:'', notes:'', cat:'travel', g:'opened'}); persist(); renderTimeline(); });
calls = []; await del('טיול לצפון'); await p.waitForTimeout(250);
assert.equal(store.get(tplEvent.id).status, 'cancelled');
assert.equal(store.get(lookalike.id).status, 'confirmed');
assert.ok(calls.some(c => c === `DELETE /calendars/primary/events/${tplEvent.id}?sendUpdates=none`) && calls.filter(c => c.startsWith('DELETE')).length === 1);
log('pre-filled-page event: exact match deleted, look-alike with different description untouched');

// 9b. ambiguous / no match → not deleted in Google, app removes it with a "not found" note
await p.evaluate(() => { events.push({id:'tpl2', title:'טיול לצפון', start:new Date(2026,9,25), end:new Date(2026,9,26), allDay:true, location:'', notes:'', cat:'travel', g:'opened'}); persist(); renderTimeline(); });
calls = []; await del('טיול לצפון'); await p.waitForTimeout(250);
assert.equal(calls.filter(c => c.startsWith('DELETE')).length, 0);
assert.equal(store.get(lookalike.id).status, 'confirmed');
log('pre-filled-page event not in Google: no DELETE sent, nothing else touched');

// 10. never synced → local only, no API call
await p.evaluate(() => { events.push({id:'loc1', title:'רק מקומי', start:new Date(2026,9,1), end:new Date(2026,9,2), allDay:true, location:'', notes:'', cat:'other'}); persist(); renderTimeline(); });
calls = []; await del('רק מקומי'); await p.waitForTimeout(150);
assert.equal(calls.length, 0); assert.ok(!(await ui()).includes('רק מקומי'));
log('event never sent to Google: deleted locally, no API call');

// 11. delete while the insert is still in flight → blocked (no orphan in Google)
mode.slowInsert = true;
await p.fill('#text', 'כנס מחר ב-9:00'); await p.press('#text', 'Enter'); await p.waitForSelector('#saveBtn'); await p.click('#saveBtn');
await p.waitForTimeout(150);
await del('כנס'); await p.waitForTimeout(100);
assert.ok((await ui()).includes('כנס'));
await p.waitForTimeout(1600); mode.slowInsert = false;
assert.ok(alive().some(x => x.summary === 'כנס'));
await del('כנס'); await p.waitForTimeout(200);
assert.ok(!alive().some(x => x.summary === 'כנס') && !(await ui()).includes('כנס'));
log('delete during a pending insert: refused until the insert finished, then deleted from both');

// 12. explicit "app only" removal after a failure
await create('ארוחה עם אבא מחר ב-13:00');
mode.deleteFail = 403; await del('ארוחה עם אבא'); await p.waitForTimeout(200); mode.deleteFail = 0;
assert.match(await item('ארוחה עם אבא').locator('.err').textContent(), /אין הרשאה/);
await item('ארוחה עם אבא').locator('[data-act="dellocal"]').click(); await p.waitForTimeout(150);
assert.ok(!(await ui()).includes('ארוחה עם אבא')); assert.ok(alive().some(x => x.summary === 'ארוחה עם אבא'));
log('403: permission message; "מחיקה רק מהאפליקציה" removes only from the app (Google copy kept, as stated)');

assert.ok(alive().some(x => x.summary.includes('כושר')) && store.get('foreign1').status === 'confirmed');
assert.deepEqual(errs, []);
log('unrelated events still in Google at the end; no page errors');
await b.close(); site.kill();
console.log('google delete tests passed');

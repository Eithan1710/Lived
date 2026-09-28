/* Lived — AI event parser (Cloudflare Worker).
   Turns "Dinner with Sarah tomorrow at 8pm in Tel Aviv" into a fixed JSON shape, using the
   Google Gemini API (free tier) with a JSON schema, so the model can only answer in that shape.

   Environment (set in Cloudflare, never in the repo — see .env.example):
   - GEMINI_API_KEY   secret   API key from Google AI Studio (a project WITHOUT billing = free tier only).
   - ALLOWED_ORIGINS  var      comma-separated site origins allowed to call this worker.
   - GEMINI_MODEL     var      optional, default below.

   Response (always this shape, status 200):
   {title, date:"YYYY-MM-DD", time:"HH:MM"|"", endDate:"YYYY-MM-DD"|"", endTime:"HH:MM"|"", location, notes, category}
   Anything else is an error status; the app then falls back to its built-in parser. */

export const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
export const CATEGORIES = ['food','fitness','work','birthday','sports','health','travel','entertainment','social','family','study','other'];

export const SCHEMA = {
  type: 'object',
  properties: {
    title:    {type:'string', description:'Short event name in the language of the note, without date, time or location words.'},
    date:     {type:'string', description:'Start date, YYYY-MM-DD.'},
    time:     {type:'string', description:'Start time HH:MM (24h), or "" if no time is mentioned.'},
    endDate:  {type:'string', description:'Last day YYYY-MM-DD if the event spans more than one day (or ends after midnight), else "".'},
    endTime:  {type:'string', description:'End time HH:MM (24h) only if stated, else "". It is on endDate when endDate is set.'},
    location: {type:'string', description:'Place, or "" if none.'},
    notes:    {type:'string', description:'Other useful details from the note, or "".'},
    category: {type:'string', enum: CATEGORIES}
  },
  required: ['title','date','time','endDate','endTime','location','notes','category']
};

export const SYSTEM = `You turn one short personal note (Hebrew or English) into a calendar event.
The note may describe something that already happened ("אתמול…", "Yesterday I had…", "last Friday") or something planned ("מחר…", "next Tuesday").
Rules:
- title: a short noun phrase in the note's language: "Dinner with Sarah", "ארוחת ערב עם שרה", "Mom's birthday". No "I had", no date/time/place words.
- Numeric dates are DAY first, then month (Israeli style): "12/10" = 12 October, "3.11" = 3 November, "25-26.9" = 25–26 September.
- date: resolve relative dates from the given today and weekday. "tomorrow"/"מחר" = today+1, "yesterday"/"אתמול" = today-1.
  A bare weekday ("Sunday", "ביום ראשון") = the next such day, unless the note is in past tense, then the previous one.
  "next <weekday>" = the first such day after today. "last <weekday>"/"<יום> שעבר" = the most recent such day before today.
  A date without a year = the nearest occurrence in the direction the note implies (past tense → past, otherwise the next one).
- time: 24h. "8pm"/"8 בערב" = 20:00. A bare hour 1–7 without am/morning means pm ("Gym at 6" = 18:00). "" if no time.
- endDate: for events that last several days, the LAST day (inclusive): "3-6 באוקטובר" → date 10-03, endDate 10-06; "טיול 25-26.9" → date 09-25, endDate 09-26;
  "from Oct 3 to Oct 6", "מ-3 עד 6 באוקטובר", "Sunday to Tuesday", "for 3 days" (date + 2), "לשבוע" (date + 6), "חופשה ביוון 12/10 עד 15/10".
  Also set it when a timed event ends after midnight ("party 22:00-02:00" → endDate = next day). "" for single-day events.
- endTime: only if the note states an end; with endDate it is the time on the last day ("from Oct 3 9:00 to Oct 5 17:00").
- location: only an explicit place ("in Tel Aviv", "בתל אביב"), else "".
- category, pick the best fit:
  food = meals, restaurants, coffee, drinks with food · fitness = gym, workout, running, yoga · work = meetings, calls, interviews, office ·
  birthday = birthdays · sports = watching or playing a game/match (football, basketball, "Barcelona game") · health = doctor, dentist, therapy, tests ·
  travel = trips, flights, vacations · entertainment = concerts, movies, shows, theater · social = friends, parties, dates, bars ·
  family = family visits and gatherings · study = classes, exams, lectures · other = none of these.`;

const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Makes sure the model output is exactly the promised shape; returns null if it can't be trusted.
export function clean(j){
  if(!j || typeof j !== 'object') return null;
  const str = v => typeof v === 'string' ? v.trim() : '';
  const date = str(j.date);
  if(!DATE.test(date) || isNaN(new Date(date + 'T00:00:00Z'))) return null;
  const hhmm = v => { const m = str(v).match(TIME); return m ? `${m[1].padStart(2,'0')}:${m[2]}` : ''; };
  const time = hhmm(j.time);
  // endDate must be a real date after the start date, and not absurdly far (a year at most)
  let endDate = str(j.endDate);
  if(!DATE.test(endDate) || isNaN(new Date(endDate + 'T00:00:00Z')) || endDate <= date
     || new Date(endDate) - new Date(date) > 366 * 864e5) endDate = '';
  return {
    title: str(j.title).slice(0, 120),
    date,
    time,
    endDate,
    endTime: time ? hhmm(j.endTime) : '',
    location: str(j.location).slice(0, 120),
    notes: str(j.notes).slice(0, 500),
    category: CATEGORIES.includes(j.category) ? j.category : 'other'
  };
}

export async function extract(text, ctx, env, fetchImpl = fetch){
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {'x-goog-api-key': env.GEMINI_API_KEY, 'Content-Type': 'application/json'},
    body: JSON.stringify({
      systemInstruction: {parts: [{text: SYSTEM}]},
      contents: [{role: 'user', parts: [{text: `Today: ${ctx.today} (${ctx.weekday}). Time now: ${ctx.now || 'unknown'}. Time zone: ${ctx.tz || 'unknown'}.\nNote: ${text}`}]}],
      generationConfig: {temperature: 0, responseMimeType: 'application/json', responseJsonSchema: SCHEMA}
    })
  });
  if(!res.ok){
    const err = new Error(`gemini ${res.status}`); err.status = res.status;
    try{ err.detail = (await res.json()).error?.message; }catch(e){}
    throw err;
  }
  const data = await res.json();
  const out = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  let parsed = null;
  try{ parsed = JSON.parse(out); }catch(e){}
  return clean(parsed);
}

const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function cors(origin){
  return {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Vary':'Origin'};
}
const reply = (body, status, headers) => new Response(JSON.stringify(body), {status, headers:{...headers, 'Content-Type':'application/json'}});

// GET /health — open it in a browser to check the setup. Shows no secrets: only whether a key is set
// and whether Gemini accepts it for the configured model (a model lookup, which uses no generation quota).
async function health(env){
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const out = {ok:false, model, keySet: !!env.GEMINI_API_KEY, allowedOrigins: String(env.ALLOWED_ORIGINS || '')};
  if(out.keySet){
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {headers:{'x-goog-api-key': env.GEMINI_API_KEY}});
    out.gemini = r.ok ? 'ok' : `HTTP ${r.status}: ${(await r.json().catch(()=>({}))).error?.message || ''}`.slice(0, 300);
    out.ok = r.ok && !!out.allowedOrigins;
  }
  return new Response(JSON.stringify(out, null, 2), {status: out.ok ? 200 : 500, headers:{'Content-Type':'application/json'}});
}

export default {
  async fetch(req, env){
    if(req.method === 'GET' && new URL(req.url).pathname === '/health') return health(env);
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    if(!allowed.includes(origin)) return reply({error:'origin not allowed'}, 403, {});
    const h = cors(origin);
    if(req.method === 'OPTIONS') return new Response(null, {headers:h});
    if(req.method !== 'POST') return reply({error:'POST only'}, 405, h);
    if(!env.GEMINI_API_KEY) return reply({error:'GEMINI_API_KEY is not set'}, 500, h);

    let body;
    try{ body = await req.json(); }catch(e){ return reply({error:'bad json'}, 400, h); }
    const text = String(body.text || '').trim().slice(0, 300);
    if(!text) return reply({error:'empty text'}, 400, h);
    const ctx = {
      today: DATE.test(body.today) ? body.today : new Date().toISOString().slice(0,10),
      weekday: WEEKDAYS[Number(body.weekday)] || WEEKDAYS[new Date().getUTCDay()],
      now: TIME.test(body.now || '') ? body.now : '',
      tz: String(body.tz || '').slice(0, 64)
    };

    try{
      const event = await extract(text, ctx, env);
      if(!event) return reply({error:'model returned an invalid event'}, 502, h);
      return reply(event, 200, h);
    }catch(e){
      // 429 = free-tier quota used up; the app falls back to its built-in parser
      console.log('gemini error', e.status, e.detail || e.message);
      return reply({error: e.status === 429 ? 'rate limited' : 'ai unavailable'}, e.status === 429 ? 429 : 502, h);
    }
  }
};

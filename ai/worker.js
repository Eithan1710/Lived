/* Lived — AI parser (Cloudflare Worker). Optional; the site works without it.
   Turns "Yesterday I had dinner with Sarah at 8pm" into structured event JSON using the Anthropic API (Claude).

   Configuration (Cloudflare, never in the repo):
   - ANTHROPIC_API_KEY  (secret)  `wrangler secret put ANTHROPIC_API_KEY` — your own Anthropic account key.
   - ALLOWED_ORIGINS    (var)     comma-separated site origins allowed to call this worker,
                                  e.g. "https://eithan1710.github.io". Requests from other origins are refused. */
const MODEL = 'claude-haiku-4-5-20251001';
const CATEGORIES = ['birthday','health','date','sport','gym','trip','show','study','work','food','family','friends','other'];

const SYSTEM = `You extract one calendar event from a short personal note (usually Hebrew, sometimes English).
The note may describe something that already happened ("אתמול…", "Yesterday I had…", "last Friday") or something planned ("מחר…", "next week").
Reply with JSON only:
{"title": string, "date": "YYYY-MM-DD", "time": "HH:MM" | null, "endTime": "HH:MM" | null,
 "location": string, "notes": string, "category": one of ${JSON.stringify(CATEGORIES)}}
Rules:
- title: short noun phrase in the note's language, without date/time/location words or "I had"/"הייתי" ("Dinner with Sarah", "ארוחת ערב עם שרה").
- date: resolve relative dates against the given today/weekday. Past-tense notes point to the past, future-tense to the future.
  A date without a year: the closest matching date in the direction the note implies.
- time: 24h, null if no time is mentioned. "8 בערב" / "8pm" = 20:00.
- endTime only if an end is stated.
- location: only if a place is mentioned, else "".
- notes: other useful details from the note, else "".`;

function cors(origin){
  return {'Access-Control-Allow-Origin':origin, 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type', 'Vary':'Origin'};
}
const reply = (body, status, headers) => new Response(typeof body==='string' ? body : JSON.stringify(body), {status, headers:{...headers, 'Content-Type':'application/json'}});

export default {
  async fetch(req, env){
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    if(!allowed.includes(origin)) return reply({error:'origin not allowed'}, 403, {});
    const h = cors(origin);
    if(req.method === 'OPTIONS') return new Response(null, {headers:h});
    if(req.method !== 'POST') return reply({error:'POST only'}, 405, h);
    if(!env.ANTHROPIC_API_KEY) return reply({error:'not configured'}, 500, h);

    let body;
    try{ body = await req.json(); }catch(e){ return reply({error:'bad json'}, 400, h); }
    const text = String(body.text || '').trim().slice(0, 300);
    if(!text) return reply({error:'empty'}, 400, h);
    const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today) ? body.today : new Date().toISOString().slice(0,10);
    const weekday = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][Number(body.weekday)] || '';
    const now = /^\d{2}:\d{2}$/.test(body.now) ? body.now : '';

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json'},
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM,
        messages: [{role:'user', content:`Today: ${today} (${weekday}), time now ${now}.\nNote: ${text}`}]
      })
    });
    if(!res.ok) return reply({error:'ai error'}, 502, h);
    const data = await res.json();
    const out = (data.content || []).map(c=>c.text || '').join('');
    try{
      const j = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
      return reply({title:j.title, date:j.date, time:j.time, endTime:j.endTime, location:j.location, notes:j.notes, category:j.category}, 200, h);
    }catch(e){ return reply({error:'ai returned no json'}, 502, h); }
  }
};

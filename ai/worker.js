/* EventAi — optional AI parser (Cloudflare Worker).
   Turns "פגישה עם יוסי מחר ב-14:00 בתל אביב" into structured event JSON using Claude.
   Deploy: `wrangler deploy ai/worker.js --name eventai-ai`, then `wrangler secret put ANTHROPIC_API_KEY`,
   and put the worker URL in CONFIG.AI_ENDPOINT in index.html.
   The API key stays on the server; the app falls back to its built-in parser if this is down. */
const CATEGORIES = ['birthday','health','date','sport','gym','trip','show','study','work','food','family','friends','other'];

const SYSTEM = `You extract a single calendar event from a short user message (usually Hebrew, sometimes English).
Reply with JSON only, no prose:
{"title": string, "date": "YYYY-MM-DD", "time": "HH:MM" | null, "endTime": "HH:MM" | null,
 "location": string, "notes": string, "category": one of ${JSON.stringify(CATEGORIES)}}
Rules:
- title: short and natural, in the user's language, without the date/time/location words.
- Resolve relative dates ("מחר", "ביום ראשון", "next Friday") against the current date given to you. A date with no year that already passed this year means next year.
- time: 24h. null when no time is mentioned (an all-day event). "8 בערב" = 20:00.
- endTime only if the user said when it ends.
- location: only if a place is mentioned, else "".
- notes: other useful details the user wrote (people to bring, what to prepare), else "".`;

const CORS = {'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type'};

export default {
  async fetch(req, env){
    if(req.method === 'OPTIONS') return new Response(null, {headers:CORS});
    if(req.method !== 'POST') return new Response('POST only', {status:405, headers:CORS});
    let body;
    try{ body = await req.json(); }catch(e){ return new Response('bad json', {status:400, headers:CORS}); }
    const text = String(body.text || '').slice(0, 500);
    if(!text.trim()) return new Response('empty', {status:400, headers:CORS});

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:'POST',
      headers:{'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json'},
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{role:'user', content:`Now: ${body.now || new Date().toISOString()} (time zone ${body.tz || 'UTC'})\nMessage: ${text}`}]
      })
    });
    if(!res.ok) return new Response('ai error', {status:502, headers:CORS});
    const data = await res.json();
    const out = (data.content || []).map(c=>c.text || '').join('');
    const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
    try{ JSON.parse(json); }catch(e){ return new Response('ai returned no json', {status:502, headers:CORS}); }
    return new Response(json, {headers:{...CORS, 'Content-Type':'application/json'}});
  }
};

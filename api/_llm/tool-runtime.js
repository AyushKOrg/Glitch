// Runtime implementations for model-callable tools.
const { searchWeb } = require('../_search');
const { runGoogleTool } = require('../../lib/connectors');

async function weatherCurrent(location, days=3) {
  const query=String(location||'').trim().slice(0,120);
  if(!query) return 'A location is required.';
  const geo=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query,count:'1',language:'en',format:'json'}),{signal:AbortSignal.timeout(10000)});
  const gd=await geo.json(), place=gd.results&&gd.results[0];
  if(!place) return 'I could not find that location.';
  const params=new URLSearchParams({latitude:String(place.latitude),longitude:String(place.longitude),current:'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:String(Math.min(7,Math.max(1,Number(days)||3))),timezone:'auto'});
  const r=await fetch('https://api.open-meteo.com/v1/forecast?'+params,{signal:AbortSignal.timeout(10000)});
  const d=await r.json();
  if(!r.ok) return 'The weather service returned an error.';
  return JSON.stringify({location:[place.name,place.admin1,place.country].filter(Boolean).join(', '),current:d.current,daily:d.daily,timezone:d.timezone});
}

// ---- tool execution ---------------------------------------------------------
// ctx.searchCache remembers results for this request, so a failed search is not retried by the model's
// own tool calls (which previously burned the whole step budget on repeated failures).
function recentUserContext(ctx) {
  return (ctx.recentUserMessages || []).slice(-3, -1).map((t) => `- ${String(t).slice(0, 200)}`).join('\n');
}

async function webSearch(ctx, query) {
  ctx.searchCache = ctx.searchCache || new Map();
  const key = String(query).toLowerCase();
  if (ctx.searchCache.has(key)) return ctx.searchCache.get(key);
  // If a search already failed in this request, don't try again: tell the model to answer from knowledge.
  if (ctx.searchFailedText) return ctx.searchFailedText;

  const res = await searchWeb(query, recentUserContext(ctx));
  const text = res.ok
    ? res.text
    : `SEARCH_UNAVAILABLE: ${res.text} Do NOT call web_search again. Give the best-effort answer from existing knowledge, clearly say what cannot be verified live, and do not respond only with an apology or ask the user to explain a recognizable topic.`;
  if (res.ok) ctx.searchCache.set(key, text);
  else ctx.searchFailedText = text;
  return text;
}

async function runTool(ctx, name, args) {
  args = args && typeof args === 'object' ? args : {};
  if (name === 'web_search') return webSearch(ctx, String(args.query || '').slice(0, 300));
  if (name === 'weather_current') return weatherCurrent(args.location,args.days);
  // Gmail is declared to the model as `gmail_search` (without the google_ prefix).
  // Route that exact public tool name to the same authenticated Google connector.
  if ((name === 'gmail_search' || name.startsWith('google_')) && ctx.user) return runGoogleTool(ctx.user, name, args);
  if (name === 'gmail_search' || name.startsWith('google_')) return 'Sign in and connect Google in Settings → Connectors first.';
  return `Unknown tool: ${name}`;
}

module.exports = { runTool };

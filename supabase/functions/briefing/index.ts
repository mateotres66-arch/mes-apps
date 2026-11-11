// Briefing du matin : appelée toutes les 5 min par pg_cron (en-tête x-cron-secret),
// ou par l'app avec le jeton de l'utilisateur et {"test": true} pour une notification d'essai.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { envoyer } from './webpush.js';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
// Secrets rangés dans Supabase Vault, lus par une fonction SQL réservée au service_role.
let VAPID: any = null;
let CRON_SECRET = '';
async function chargerSecrets() {
  if (VAPID && CRON_SECRET) return;
  const [jwk, cron] = await Promise.all([
    sb.rpc('secret_briefing', { nom: 'briefing_vapid_jwk' }),
    sb.rpc('secret_briefing', { nom: 'briefing_cron_secret' }),
  ]);
  VAPID = jwk.data ? JSON.parse(jwk.data) : null;
  CRON_SECRET = cron.data ?? '';
}
const SUJET = 'https://mateotres66-arch.github.io/mes-apps/';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' };

// Heure de Paris
function maintenantParis() {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const jour = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) + 1;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), jour };
}
const enMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Heure prévue aujourd'hui : heure du réveil les jours de réveil, sinon heure « sans réveil ».
export function heurePrevue(r: any, date: string, jour: number) {
  const reveil = r.jours_reveil.includes(jour) && !(r.sans_reveil_le ?? []).includes(date);
  return enMinutes(reveil ? r.heure_reveil : r.heure_sans_reveil);
}

const CODES: [number[], string, string][] = [
  [[0], '☀️', 'ensoleillé'], [[1], '🌤️', 'plutôt dégagé'], [[2], '⛅', 'partiellement nuageux'], [[3], '☁️', 'couvert'],
  [[45, 48], '🌫️', 'brouillard'], [[51, 53, 55, 56, 57], '🌦️', 'bruine'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'pluie'],
  [[71, 73, 75, 77, 85, 86], '❄️', 'neige'], [[95, 96, 99], '⛈️', 'orage'],
];

async function message(userId: string, date: string) {
  let meteo = '';
  try {
    const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=42.70&longitude=3.03&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=Europe%2FParis&forecast_days=1');
    const d = (await r.json()).daily;
    const [, ic, tx] = CODES.find(([l]) => l.includes(d.weather_code[0])) ?? [[], '🌡️', ''];
    meteo = `${ic} ${Math.round(d.temperature_2m_min[0])}° → ${Math.round(d.temperature_2m_max[0])}°, ${tx}${d.precipitation_probability_max[0] >= 40 ? `, pluie ${d.precipitation_probability_max[0]}%` : ''}`;
  } catch { /* météo indisponible : on envoie quand même le reste */ }
  const { data } = await sb.from('donnees').select('cle, valeur').eq('user_id', userId);
  const matin = data?.find((x) => x.cle === 'matin')?.valeur ?? {};
  const rdv = (matin.rdv ?? []).filter((x: any) => x.date === date).sort((a: any, b: any) => (a.heure || '').localeCompare(b.heure || ''));
  const taches = (matin.taches ?? []).filter((t: any) => !t.fait).length;
  const lignes = [meteo];
  lignes.push(rdv.length ? '📅 ' + rdv.map((x: any) => (x.heure ? x.heure.replace(':', 'h') + ' ' : '') + x.texte).join(' · ') : '📅 Rien de prévu');
  if (taches) lignes.push(`✅ ${taches} tâche${taches > 1 ? 's' : ''} à faire`);
  return JSON.stringify({ title: 'Bonjour Mateo 👋 Ton briefing', body: lignes.filter(Boolean).join('\n'), url: './matin.html?briefing=1' });
}

async function envoyerA(userId: string, date: string) {
  const { data: abos } = await sb.from('abonnements_push').select('id, endpoint, p256dh, auth').eq('user_id', userId);
  if (!abos?.length) return 0;
  const msg = await message(userId, date);
  let ok = 0;
  for (const a of abos) {
    const code = await envoyer(a, msg, VAPID, SUJET).catch(() => 0);
    if (code === 404 || code === 410) await sb.from('abonnements_push').delete().eq('id', a.id); // téléphone désabonné
    if (code >= 200 && code < 300) ok++;
  }
  return ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  await chargerSecrets();
  if (!VAPID) return new Response('VAPID manquant', { status: 500, headers: CORS });
  const { date, minutes, jour } = maintenantParis();

  // Notification d'essai demandée depuis l'app : on identifie l'utilisateur par son jeton.
  const corps = await req.json().catch(() => ({}));
  if (corps.test) {
    const jeton = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const { data: { user } } = await sb.auth.getUser(jeton);
    if (!user) return new Response('non connecté', { status: 401, headers: CORS });
    const n = await envoyerA(user.id, date);
    return Response.json({ envoyes: n }, { headers: CORS });
  }

  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('interdit', { status: 403 });
  const { data: reglages } = await sb.from('reglages_briefing').select('*').eq('actif', true);
  const envoyes: string[] = [];
  for (const r of reglages ?? []) {
    if (r.dernier_envoi === date) continue;
    const prevue = heurePrevue(r, date, jour);
    // fenêtre d'une heure : si le cron a raté un passage, on rattrape ; au-delà, trop tard
    if (minutes < prevue || minutes > prevue + 60) continue;
    await sb.from('reglages_briefing').update({ dernier_envoi: date }).eq('user_id', r.user_id);
    if (await envoyerA(r.user_id, date)) envoyes.push(r.user_id);
  }
  return Response.json({ date, minutes, envoyes: envoyes.length });
});

// Voix naturelle du briefing : Google Cloud Text-to-Speech.
// L'app envoie {texte} avec le jeton de l'utilisateur connecté ; la fonction renvoie {audio: mp3 en base64}.
// Secret à définir dans Supabase (Edge Functions > Secrets) : GOOGLE_TTS_KEY.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const CLE = Deno.env.get('GOOGLE_TTS_KEY') ?? '';
const API = 'https://texttospeech.googleapis.com/v1';
const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': req.headers.get('access-control-request-headers') ?? 'authorization, x-client-info, apikey, content-type',
});

// Meilleure voix féminine française disponible : Chirp 3 HD, puis Neural2, Studio, WaveNet.
let voix: { languageCode: string; name: string } | null = null;
export function choisirVoix(liste: { name: string; ssmlGender: string }[]) {
  const femmes = liste.filter((v) => v.name.startsWith('fr-FR') && v.ssmlGender === 'FEMALE');
  for (const famille of ['Chirp3-HD', 'Chirp-HD', 'Neural2', 'Studio', 'Wavenet']) {
    const v = femmes.find((x) => x.name.includes(`-${famille}-`));
    if (v) return v.name;
  }
  return femmes[0]?.name ?? null;
}
async function voixFr() {
  if (voix) return voix;
  const r = await fetch(`${API}/voices?languageCode=fr-FR`, { headers: { 'X-Goog-Api-Key': CLE } });
  if (!r.ok) throw new Error('liste des voix : ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const nom = choisirVoix((await r.json()).voices ?? []);
  if (!nom) throw new Error('aucune voix féminine française');
  return (voix = { languageCode: 'fr-FR', name: nom });
}

Deno.serve(async (req) => {
  const CORS = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!CLE) return new Response('GOOGLE_TTS_KEY manquant', { status: 500, headers: CORS });
  // réservé aux utilisateurs connectés : la clé Google est payante au-delà du quota gratuit
  const jeton = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const { data: { user } } = await sb.auth.getUser(jeton);
  if (!user) return new Response('non connecté', { status: 401, headers: CORS });
  const { texte } = await req.json().catch(() => ({}));
  if (typeof texte !== 'string' || !texte.trim() || texte.length > 2000) return new Response('texte invalide', { status: 400, headers: CORS });
  try {
    const v = await voixFr();
    const r = await fetch(`${API}/text:synthesize`, {
      method: 'POST',
      headers: { 'X-Goog-Api-Key': CLE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: texte }, voice: v, audioConfig: { audioEncoding: 'MP3' } }),
    });
    if (!r.ok) throw new Error('synthèse : ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const { audioContent } = await r.json();
    return Response.json({ audio: audioContent, voix: v.name }, { headers: CORS });
  } catch (e) {
    return new Response(String((e as Error).message), { status: 502, headers: CORS });
  }
});

const { stockage, uid, echapper, isoJour, lundi, indexJour, JOURS } = window.commun;
const $ = (id) => document.getElementById(id);

const BUREAU = 'C:\\Users\\mateo\\Desktop\\';
const LIENS_DEFAUT = [
  { nom: 'Mes sites', cible: BUREAU + 'Mes sites.lnk' },
  { nom: 'Obsidian', cible: BUREAU + 'Obsidian.lnk' },
  { nom: 'VS Code', cible: BUREAU + 'Visual Studio Code.lnk' },
  { nom: 'Roblox Studio', cible: BUREAU + 'Roblox Studio.lnk' },
  { nom: 'Gmail', cible: 'https://mail.google.com' },
  { nom: 'Claude', cible: 'https://claude.ai' },
];

let etat = { taches: [], rdv: [], liens: LIENS_DEFAUT };
let jourAffiche = '';

const enregistrer = () => stockage.ecrire('matin', etat);

// ---------- Horloge ----------
function horloge() {
  const n = new Date();
  $('heure').textContent = n.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const h = n.getHours();
  $('salut').textContent = h < 5 ? 'Bonne nuit, Mateo' : h < 12 ? 'Bonjour, Mateo' : h < 18 ? 'Bon après-midi, Mateo' : 'Bonsoir, Mateo';
  const d = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('date').textContent = d.charAt(0).toUpperCase() + d.slice(1);
  if (isoJour(n) !== jourAffiche) { jourAffiche = isoJour(n); toutAfficher(); }
}

// ---------- Météo (Open-Meteo, sans clé) ----------
const CODES = [
  [[0], '☀️', 'Ensoleillé'], [[1], '🌤️', 'Plutôt dégagé'], [[2], '⛅', 'Partiellement nuageux'], [[3], '☁️', 'Couvert'],
  [[45, 48], '🌫️', 'Brouillard'], [[51, 53, 55, 56, 57], '🌦️', 'Bruine'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Pluie'],
  [[71, 73, 75, 77, 85, 86], '❄️', 'Neige'], [[95, 96, 99], '⛈️', 'Orage'],
];
const code = (c) => CODES.find(([l]) => l.includes(c)) || [[], '🌡️', '—'];

async function meteo() {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=42.70&longitude=3.03'
    + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,precipitation,is_day'
    + '&hourly=temperature_2m,apparent_temperature,weather_code,precipitation_probability,precipitation,wind_speed_10m,relative_humidity_2m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max'
    + '&timezone=Europe%2FParis&forecast_days=7';
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    await stockage.ecrire('meteo', { recu: Date.now(), d });
    afficherMeteo(d, null);
  } catch {
    const cache = await stockage.lire('meteo');
    if (cache) afficherMeteo(cache.d, new Date(cache.recu));
    else $('meteo').innerHTML = '<p class="vide">Météo indisponible (pas de connexion ?)</p>';
  }
}

let derniereMeteo = null;
function afficherMeteo(d, depuis) {
  derniereMeteo = d;
  const [, icone, texte] = code(d.current.weather_code);
  const jours = d.daily.time.slice(0, 4).map((t, i) => {
    const [, ic] = code(d.daily.weather_code[i]);
    const nomJour = i === 0 ? "Auj." : new Date(t + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short' });
    return `<div class="jour"><b>${nomJour}</b><span>${ic}</span>${Math.round(d.daily.temperature_2m_max[i])}° <span class="petit" style="display:inline;font-size:13px">${Math.round(d.daily.temperature_2m_min[i])}°</span>
      <div class="petit">💧 ${d.daily.precipitation_probability_max[i] ?? 0}%</div></div>`;
  }).join('');
  $('meteo').innerHTML = `
    <div class="meteo-now">
      <div class="meteo-icone" aria-hidden="true">${icone}</div>
      <div>
        <div class="meteo-temp">${Math.round(d.current.temperature_2m)}°</div>
        <div>${texte} · ressenti ${Math.round(d.current.apparent_temperature)}°</div>
        <div class="petit">Vent ${Math.round(d.current.wind_speed_10m)} km/h${depuis ? ' · hors ligne, données de ' + depuis.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
      </div>
    </div>
    <div class="jours">${jours}</div>
    <button class="contour" id="voir-detail" style="width:100%;margin-top:14px">Voir la météo en détail</button>`;
  if ($('detail-meteo').open) detailMeteo();
}

// ---------- Météo détaillée ----------
const heureFr = (iso) => iso.slice(11, 16);
const jourFr = (iso, i) => i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : new Date(iso + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });

function courbe(h) {
  // 24 prochaines heures : température (ligne) et risque de pluie (barres)
  const L = 760, H = 170, haut = 24, bas = 30;
  const t = h.temps, min = Math.min(...t) - 1, max = Math.max(...t) + 1;
  const x = (i) => 20 + i * ((L - 40) / (t.length - 1));
  const y = (v) => haut + (H - haut - bas) * (1 - (v - min) / (max - min));
  const barres = h.pluie.map((p, i) => `<rect x="${x(i) - 9}" y="${H - bas - (p / 100) * 50}" width="18" height="${(p / 100) * 50}" rx="3" fill="var(--bleu)" opacity=".35"/>`).join('');
  const ligne = t.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const etiquettes = t.map((v, i) => i % 3 ? '' : `
    <text x="${x(i)}" y="${y(v) - 9}" text-anchor="middle" font-size="12" font-weight="600" fill="var(--encre)">${Math.round(v)}°</text>
    <text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11" fill="var(--doux)">${h.heures[i]}</text>`).join('');
  return `<svg viewBox="0 0 ${L} ${H}" width="100%" role="img" aria-label="Température et risque de pluie sur 24 heures">
    ${barres}<path d="${ligne}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>${etiquettes}</svg>`;
}

function detailMeteo() {
  const d = derniereMeteo;
  if (!d) return;
  if (!d.hourly) { $('detail-contenu').innerHTML = '<p class="vide">Détail indisponible hors ligne. Reconnecte-toi puis clique sur ↻.</p>'; return; }
  const c = d.current;
  const [, icone, texte] = code(c.weather_code);
  // index de l'heure en cours dans les prévisions horaires
  const maintenant = new Date();
  let debut = d.hourly.time.findIndex((t) => new Date(t) > maintenant) - 1;
  if (debut < 0) debut = 0;
  const idx = [...Array(24).keys()].map((k) => debut + k).filter((i) => i < d.hourly.time.length);
  const h = { temps: idx.map((i) => d.hourly.temperature_2m[i]), pluie: idx.map((i) => d.hourly.precipitation_probability[i] ?? 0), heures: idx.map((i) => heureFr(d.hourly.time[i])) };
  const lever = heureFr(d.daily.sunrise[0]), coucher = heureFr(d.daily.sunset[0]);
  const uv = Math.round(d.daily.uv_index_max[0]);
  const niveauUv = uv < 3 ? 'faible' : uv < 6 ? 'modéré' : uv < 8 ? 'élevé' : 'très élevé';
  const heures = idx.map((i) => {
    const [, ic] = code(d.hourly.weather_code[i]);
    return `<div class="h"><b>${heureFr(d.hourly.time[i])}</b><span aria-hidden="true">${ic}</span><strong>${Math.round(d.hourly.temperature_2m[i])}°</strong>
      <small>💧 ${d.hourly.precipitation_probability[i] ?? 0}%</small><small>💨 ${Math.round(d.hourly.wind_speed_10m[i])}</small></div>`;
  }).join('');
  const jours = d.daily.time.map((t, i) => {
    const [, ic, tx] = code(d.daily.weather_code[i]);
    return `<tr><td class="j">${jourFr(t, i)}</td><td><span aria-hidden="true">${ic}</span> ${tx}</td>
      <td class="num"><b>${Math.round(d.daily.temperature_2m_max[i])}°</b> / ${Math.round(d.daily.temperature_2m_min[i])}°</td>
      <td class="num">💧 ${d.daily.precipitation_probability_max[i] ?? 0}% · ${String(d.daily.precipitation_sum[i] ?? 0).replace('.', ',')} mm</td>
      <td class="num">💨 ${Math.round(d.daily.wind_speed_10m_max[i])} km/h (raf. ${Math.round(d.daily.wind_gusts_10m_max[i])})</td>
      <td class="num">☀️ UV ${Math.round(d.daily.uv_index_max[i])}</td>
      <td class="num petit">${heureFr(d.daily.sunrise[i])} – ${heureFr(d.daily.sunset[i])}</td></tr>`;
  }).join('');
  $('detail-contenu').innerHTML = `
    <div class="dm-haut">
      <div class="meteo-now"><div class="meteo-icone" aria-hidden="true">${icone}</div>
        <div><div class="meteo-temp">${Math.round(c.temperature_2m)}°</div><div>${texte} · ressenti ${Math.round(c.apparent_temperature)}°</div></div></div>
      <div class="tuiles">
        <div><span>Humidité</span><b>${c.relative_humidity_2m} %</b></div>
        <div><span>Vent</span><b>${Math.round(c.wind_speed_10m)} km/h</b><small>rafales ${Math.round(c.wind_gusts_10m)}</small></div>
        <div><span>Pluie aujourd'hui</span><b>${String(d.daily.precipitation_sum[0] ?? 0).replace('.', ',')} mm</b></div>
        <div><span>Indice UV</span><b>${Math.round(uv)}</b><small>${niveauUv}</small></div>
        <div><span>Lever</span><b>${lever}</b></div>
        <div><span>Coucher</span><b>${coucher}</b></div>
      </div>
    </div>
    <h3>Prochaines 24 heures</h3>
    <div class="courbe">${courbe(h)}</div>
    <div class="heures">${heures}</div>
    <h3>7 jours</h3>
    <div class="tableau"><table>${jours}</table></div>`;
}
$('meteo').addEventListener('click', (e) => {
  if (!e.target.closest('#voir-detail')) return;
  detailMeteo();
  $('detail-meteo').showModal();
});
$('fermer-detail').addEventListener('click', () => $('detail-meteo').close());
$('detail-meteo').addEventListener('click', (e) => { if (e.target === $('detail-meteo')) $('detail-meteo').close(); });

// ---------- Tâches ----------
function afficherTaches() {
  const auj = isoJour(new Date());
  // les tâches faites un jour précédent disparaissent ; les non faites restent (en retard)
  etat.taches = etat.taches.filter((t) => !(t.fait && t.faitLe && t.faitLe < auj));
  const ul = $('liste-taches');
  const restantes = etat.taches.filter((t) => !t.fait).length;
  $('compte').textContent = etat.taches.length ? `${restantes} restante${restantes > 1 ? 's' : ''}` : '';
  if (!etat.taches.length) { ul.innerHTML = '<li class="vide">Rien à faire. Profite !</li>'; return; }
  const triees = [...etat.taches].sort((a, b) => a.fait - b.fait || a.cree.localeCompare(b.cree));
  ul.innerHTML = triees.map((t) => `
    <li class="tache ${t.fait ? 'faite' : ''}" data-id="${t.id}">
      <input type="checkbox" id="t-${t.id}" ${t.fait ? 'checked' : ''}>
      <label for="t-${t.id}">${echapper(t.texte)}</label>
      ${!t.fait && t.cree < auj ? '<span class="retard">depuis ' + new Date(t.cree + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + '</span>' : ''}
      <button class="discret suppr" aria-label="Supprimer">✕</button>
    </li>`).join('');
}
$('liste-taches').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const t = etat.taches.find((x) => x.id === li.dataset.id);
  if (e.target.matches('input[type=checkbox]')) { t.fait = e.target.checked; t.faitLe = t.fait ? isoJour(new Date()) : null; }
  else if (e.target.matches('.suppr')) etat.taches = etat.taches.filter((x) => x !== t);
  else return;
  enregistrer(); afficherTaches();
});
$('form-tache').addEventListener('submit', (e) => {
  e.preventDefault();
  const texte = $('nouvelle-tache').value.trim();
  if (!texte) return;
  etat.taches.push({ id: uid(), texte, fait: false, cree: isoJour(new Date()) });
  $('nouvelle-tache').value = '';
  enregistrer(); afficherTaches();
});

// ---------- Rendez-vous ----------
function afficherRdv() {
  const auj = isoJour(new Date());
  const fin = window.commun.decaler(auj, 7);
  etat.rdv = etat.rdv.filter((r) => r.date >= auj); // les rendez-vous passés sont supprimés
  const proches = etat.rdv.filter((r) => r.date <= fin).sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || '')));
  const plusTard = etat.rdv.length - proches.length;
  $('liste-rdv').innerHTML = (proches.length ? proches.map((r) => {
    const quand = r.date === auj ? "Aujourd'hui" : new Date(r.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    return `<li data-id="${r.id}"><span class="rdv-quand ${r.date === auj ? 'aujourdhui' : ''}">${quand}${r.heure ? ' · ' + r.heure : ''}</span>
      <span style="flex:1;overflow-wrap:anywhere">${echapper(r.texte)}</span><button class="discret suppr" aria-label="Supprimer">✕</button></li>`;
  }).join('') : '<li class="vide">Aucun rendez-vous cette semaine.</li>')
    + (plusTard ? `<li class="petit">+ ${plusTard} plus tard</li>` : '');
}
$('liste-rdv').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li || !e.target.matches('.suppr')) return;
  etat.rdv = etat.rdv.filter((r) => r.id !== li.dataset.id);
  enregistrer(); afficherRdv();
});
$('form-rdv').addEventListener('submit', (e) => {
  e.preventDefault();
  etat.rdv.push({ id: uid(), date: $('rdv-date').value, heure: $('rdv-heure').value, texte: $('rdv-texte').value.trim() });
  $('rdv-texte').value = ''; $('rdv-heure').value = '';
  enregistrer(); afficherRdv();
});

// ---------- Repas du jour (lu dans l'app Repas & courses) ----------
async function afficherRepas() {
  const r = await stockage.lire('repas');
  const n = new Date();
  const menu = r?.menus?.[lundi(n)] || {};
  const j = JOURS[indexJour(n)];
  const nomPlat = (id) => r?.recettes?.find((x) => x.id === id)?.nom;
  const lignes = [['Midi', menu[j + '-midi']], ['Soir', menu[j + '-soir']]]
    .map(([moment, id]) => `<div class="plat"><span class="petit">${moment}</span><b>${id ? echapper(nomPlat(id) || '—') : '<span class="vide">Pas prévu</span>'}</b></div>`).join('');
  $('repas-jour').innerHTML = lignes + '<p class="petit" style="margin:12px 0 0">Prévois la semaine dans l’app « Repas &amp; courses ».</p>';
}

// ---------- Raccourcis ----------
function afficherLiens() {
  // sur téléphone, seuls les liens web marchent (pas les programmes du PC)
  const visible = (l) => window.api || /^https?:\/\//i.test(l.cible);
  $('liens').innerHTML = etat.liens.map((l, i) => !visible(l) ? '' : `
    <div class="lien"><button class="ouvrir" data-i="${i}" title="${echapper(l.cible)}">${echapper(l.nom)}</button>
    <button class="discret suppr" data-i="${i}" aria-label="Retirer ${echapper(l.nom)}">✕</button></div>`).join('');
}
$('liens').addEventListener('click', async (e) => {
  const i = Number(e.target.dataset.i);
  if (Number.isNaN(i)) return;
  if (e.target.matches('.suppr')) { etat.liens.splice(i, 1); enregistrer(); afficherLiens(); return; }
  $('erreur-lien').textContent = '';
  const cible = etat.liens[i].cible;
  if (!window.api) { window.open(cible); return; }
  const res = await window.api.ouvrir(cible);
  if (res !== 'ok') $('erreur-lien').textContent = res === 'introuvable' ? `Introuvable : ${cible}` : `Impossible d'ouvrir : ${res}`;
});
$('form-lien').addEventListener('submit', (e) => {
  e.preventDefault();
  etat.liens.push({ nom: $('lien-nom').value.trim(), cible: $('lien-cible').value.trim().replace(/^"|"$/g, '') });
  $('lien-nom').value = ''; $('lien-cible').value = '';
  enregistrer(); afficherLiens();
});

function toutAfficher() { afficherTaches(); afficherRdv(); afficherRepas(); afficherLiens(); }

$('maj-meteo').addEventListener('click', meteo);
// synchro : changement venu du téléphone ou de l'autre app
stockage.surChangement?.('matin', (v) => { etat = { ...etat, ...v }; toutAfficher(); });
stockage.surChangement?.('repas', afficherRepas);
window.addEventListener('focus', afficherRepas); // menu modifié dans l'autre app

(async () => {
  const sauve = await stockage.lire('matin');
  if (sauve) etat = { ...etat, ...sauve };
  $('rdv-date').value = isoJour(new Date());
  horloge();
  setInterval(horloge, 1000);
  meteo();
  setInterval(meteo, 30 * 60 * 1000);
})();

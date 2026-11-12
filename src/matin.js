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

let etat = { taches: [], rdv: [], recurrentes: [], liens: LIENS_DEFAUT, planning: {} };
let jourAffiche = '';

const enregistrer = () => stockage.ecrire('matin', etat);

// ---------- Horloge ----------
let derniereMinute = -1;
function horloge() {
  const n = new Date();
  $('heure').textContent = n.toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' }).replace(/^0/, '');
  const h = n.getHours();
  $('salut').textContent = h < 5 ? 'Bonne nuit Mateo' : h < 12 ? 'Bonjour Mateo' : h < 18 ? 'Bon après-midi Mateo' : 'Bonsoir Mateo';
  const d = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('date').textContent = d.charAt(0).toUpperCase() + d.slice(1);
  if (isoJour(n) !== jourAffiche) { jourAffiche = isoJour(n); toutAfficher(); }
  else if (n.getMinutes() !== derniereMinute) { afficherBoulot(); afficherJournee(); afficherSoleil(); }
  derniereMinute = n.getMinutes();
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
  const j = d.daily;
  const [, icDemain] = code(j.weather_code[1]);
  $('meteo').innerHTML = `
    <div class="m-temp gros">${Math.round(d.current.temperature_2m)}°</div>
    <div class="m-ico" aria-hidden="true">${icone}</div>
    <div>${texte} · ${Math.round(j.temperature_2m_min[0])}° → ${Math.round(j.temperature_2m_max[0])}°</div>
    <div class="m-mini"><span>💧 <b>${j.precipitation_probability_max[0] ?? 0} %</b></span><span>💨 <b>${Math.round(d.current.wind_speed_10m)} km/h</b></span>
      ${j.time.length > 1 ? `<span>Demain <b>${icDemain} ${Math.round(j.temperature_2m_max[1])}°</b></span>` : ''}</div>
    ${depuis ? `<div class="petit">Hors ligne · données de ${depuis.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>` : ''}
    <button type="button" id="voir-detail">Voir le détail →</button>`;
  afficherSoleil();
  if ($('detail-meteo').open) detailMeteo();
}
// sous l'heure : prochain lever ou coucher du soleil
function afficherSoleil() {
  const j = derniereMeteo?.daily;
  if (!j?.sunrise) return;
  const maint = new Date().toTimeString().slice(0, 5);
  const lever = j.sunrise[0].slice(11, 16), coucher = j.sunset[0].slice(11, 16);
  $('heure-sous').textContent = maint < lever ? `Lever du soleil ${lever.replace(/^0/, '')}`
    : maint < coucher ? `Coucher du soleil ${coucher}` : j.sunrise[1] ? `Lever demain ${j.sunrise[1].slice(11, 16).replace(/^0/, '')}` : '';
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

// ---------- Tâches récurrentes ----------
const NOMS_JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const libelleRegle = (r) => r === 'jour' ? 'chaque jour' : r.startsWith('sem:') ? 'chaque ' + NOMS_JOURS[Number(r.slice(4)) - 1] : 'le ' + r.slice(5) + ' du mois';
// Crée la tâche du jour pour chaque récurrente due aujourd'hui (une seule fois par jour).
function genererRecurrentes() {
  const auj = isoJour(new Date());
  let change = false;
  for (const r of etat.recurrentes || []) {
    if (r.derniere === auj || !window.commun.recurrenteDue(r.regle, auj)) continue;
    r.derniere = auj;
    // pas de doublon si la précédente n'est pas encore faite
    if (!etat.taches.some((t) => t.rec === r.id && !t.fait)) etat.taches.push({ id: uid(), texte: r.texte, fait: false, cree: auj, rec: r.id });
    change = true;
  }
  if (change) enregistrer();
}
function afficherRecurrentes() {
  const l = etat.recurrentes || [];
  $('bloc-recurrentes').hidden = !l.length;
  $('liste-recurrentes').innerHTML = l.map((r) => `<li data-id="${r.id}"><span style="flex:1">${echapper(r.texte)}</span><span class="puce">${libelleRegle(r.regle)}</span><button class="discret suppr" aria-label="Arrêter de répéter">✕</button></li>`).join('');
}
$('liste-recurrentes').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li || !e.target.matches('.suppr')) return;
  etat.recurrentes = etat.recurrentes.filter((r) => r.id !== li.dataset.id);
  enregistrer(); afficherRecurrentes();
});

// ---------- Tâches ----------
function afficherTaches() {
  genererRecurrentes();
  afficherRecurrentes();
  const auj = isoJour(new Date());
  // les tâches faites un jour précédent disparaissent ; les non faites restent (en retard)
  etat.taches = etat.taches.filter((t) => !(t.fait && t.faitLe && t.faitLe < auj));
  const ul = $('liste-taches');
  const restantes = etat.taches.filter((t) => !t.fait).length;
  $('compte').textContent = etat.taches.length ? `${etat.taches.length - restantes} / ${etat.taches.length}` : '';
  if (!etat.taches.length) { ul.innerHTML = '<li class="vide">Rien à faire. Profite !</li>'; return; }
  const triees = [...etat.taches].sort((a, b) => a.fait - b.fait || a.cree.localeCompare(b.cree));
  ul.innerHTML = triees.map((t) => `
    <li class="tache ${t.fait ? 'faite' : ''}" data-id="${t.id}">
      <input type="checkbox" id="t-${t.id}" ${t.fait ? 'checked' : ''}>
      <label for="t-${t.id}">${echapper(t.texte)}</label>
      ${!t.fait && t.cree < auj ? '<span class="retard" title="Depuis le ' + new Date(t.cree + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + '">en retard</span>' : ''}
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
  let regle = $('repetition').value;
  if (regle === 'mois') regle = 'mois:' + new Date().getDate();
  if (regle) (etat.recurrentes ||= []).push({ id: uid(), texte, regle });
  else etat.taches.push({ id: uid(), texte, fait: false, cree: isoJour(new Date()) });
  $('nouvelle-tache').value = '';
  $('repetition').value = '';
  enregistrer(); afficherTaches();
});

// ---------- Ta journée : boulot, pause, repas et rendez-vous dans l'ordre des heures ----------
let repasDuJour = { midi: null, soir: null };
const heureAff = (h) => h.replace(/^0/, '');
function afficherJournee() {
  const auj = isoJour(new Date());
  const maint = new Date().toTimeString().slice(0, 5);
  const fin = window.commun.decaler(auj, 7);
  etat.rdv = etat.rdv.filter((r) => r.date >= auj); // les rendez-vous passés sont supprimés
  const c = window.commun.creneauDuJour(etat.planning, auj);
  const ev = [];
  if (c) {
    ev.push({ h: c.debut, fin: c.pause?.debut || c.fin, type: 'boulot', titre: 'Boulot', sous: `jusqu’à ${heureCourte(c.fin)}` });
    if (c.pause) ev.push({ h: c.pause.debut, fin: c.pause.fin, type: 'pause', titre: 'Pause', sous: `jusqu’à ${heureCourte(c.pause.fin)}` },
      { h: c.pause.fin, fin: c.fin, type: 'boulot', titre: 'Reprise', sous: `fin à ${heureCourte(c.fin)}` });
  }
  if (repasDuJour.midi) ev.push({ h: c?.pause?.debut || '12:30', type: 'repas', titre: repasDuJour.midi, sous: 'déjeuner' });
  if (repasDuJour.soir) ev.push({ h: '19:30', type: 'repas', titre: repasDuJour.soir, sous: 'dîner' });
  for (const r of etat.rdv.filter((x) => x.date === auj)) ev.push({ h: r.heure || '', type: 'rdv', titre: r.texte, sous: 'rendez-vous', id: r.id });
  ev.sort((a, b) => (a.h || '00:00').localeCompare(b.h || '00:00'));
  const ligne = (e) => `<li class="${e.type} ${e.h && (e.fin || e.h) < maint ? 'passe' : ''}" ${e.id ? `data-id="${e.id}"` : ''}>
    <span class="h">${e.h ? heureAff(e.h) : '—'}</span><span class="b"></span>
    <div><b>${echapper(e.titre)}</b><p>${e.sous}</p></div>
    ${e.id ? '<button class="discret suppr" aria-label="Supprimer ce rendez-vous">✕</button>' : '<span></span>'}</li>`;
  const plusTard = etat.rdv.filter((r) => r.date > auj && r.date <= fin).sort((a, b) => (a.date + (a.heure || '')).localeCompare(b.date + (b.heure || '')));
  $('nb-journee').textContent = ev.length || '';
  $('liste-rdv').innerHTML = (ev.length ? ev.map(ligne).join('') : '<li class="vide" style="display:block">Rien de prévu. Journée libre.</li>')
    + (plusTard.length ? '<li class="plus-tard">Cette semaine</li>' + plusTard.map((r) => {
      const jour = new Date(r.date + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
      return `<li class="rdv" data-id="${r.id}"><span class="h" style="font-weight:500;color:var(--doux)">${jour}</span><span class="b"></span>
        <div><b>${echapper(r.texte)}</b><p>${r.heure ? heureAff(r.heure) : 'rendez-vous'}</p></div><button class="discret suppr" aria-label="Supprimer ce rendez-vous">✕</button></li>`;
    }).join('') : '');
}
const afficherRdv = afficherJournee;
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
  const nomPlat = (id) => (id ? r?.recettes?.find((x) => x.id === id)?.nom || null : null);
  repasDuJour = { midi: nomPlat(menu[j + '-midi']), soir: nomPlat(menu[j + '-soir']) };
  const plat = (moment, nom) => `<div class="plat"><small>${moment}</small>${nom ? `<b>${echapper(nom)}</b>` : '<span class="vide">Pas prévu</span>'}</div>`;
  $('repas-jour').innerHTML = plat('Midi', repasDuJour.midi) + plat('Soir', repasDuJour.soir);
  afficherJournee();
}

// ---------- Planning de travail (récurrent, chaque semaine) ----------
const { creneauDuJour, heureCourte, texteCreneau, pauseValide } = window.commun;
const plage = (c) => `${heureCourte(c.debut)} – ${heureCourte(c.fin)}`;

const minutes = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
const duree = (m) => `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`;
const minutesTravail = (c) => minutes(c.fin) - minutes(c.debut) - (c.pause ? minutes(c.pause.fin) - minutes(c.pause.debut) : 0);
function afficherBoulot() {
  const n = new Date();
  const auj = isoJour(n);
  const c = creneauDuJour(etat.planning, auj);
  if (!c) {
    // prochain jour travaillé
    let prochain = null;
    for (let i = 1; i <= 7 && !prochain; i++) { const iso = window.commun.decaler(auj, i); const x = creneauDuJour(etat.planning, iso); if (x) prochain = [iso, x]; }
    $('boulot').innerHTML = `<div class="b-heures gros">Repos</div><div class="b-pause">Profite de ta journée</div>
      ${prochain ? `<div class="b-statut">Prochain : ${new Date(prochain[0] + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long' })} à ${heureCourte(prochain[1].debut)}</div>` : ''}`;
    return;
  }
  const m = n.getHours() * 60 + n.getMinutes();
  const d = minutes(c.debut), f = minutes(c.fin), total = f - d;
  const pct = (x) => Math.max(0, Math.min(100, ((x - d) / total) * 100));
  let statut;
  if (m < d) statut = `Tu commences dans ${duree(d - m)}`;
  else if (m >= f) statut = 'Journée terminée, bravo';
  else if (c.pause && m >= minutes(c.pause.debut) && m < minutes(c.pause.fin)) statut = `En pause jusqu’à ${heureCourte(c.pause.fin)}`;
  else statut = `En cours · fin dans ${duree(f - m)}`;
  const milieu = c.pause ? c.pause.debut : `${String(Math.floor((d + total / 2) / 60)).padStart(2, '0')}:${String(Math.round((d + total / 2) % 60)).padStart(2, '0')}`;
  $('boulot').innerHTML = `<div class="b-heures gros">${plage(c)}</div>
    <div class="b-pause">${c.pause ? `pause ${heureCourte(c.pause.debut)} – ${heureCourte(c.pause.fin)}` : `${duree(minutesTravail(c))} de travail`}</div>
    <div class="prog" role="progressbar" aria-label="Avancement de la journée de travail" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct(m))}">
      ${c.pause ? `<i class="pause" style="left:${pct(minutes(c.pause.debut))}%;width:${pct(minutes(c.pause.fin)) - pct(minutes(c.pause.debut))}%"></i>` : ''}
      <i class="fait" style="width:${pct(m)}%"></i></div>
    <div class="echelle"><span>${heureCourte(c.debut)}</span><span>${heureCourte(milieu)}</span><span>${heureCourte(c.fin)}</span></div>
    <div class="b-statut">${statut}</div>`;
}
function afficherPlanning() {
  const auj = isoJour(new Date());
  const debutSem = lundi(new Date());
  let total = 0;
  const jours = NOMS_JOURS.map((nom, i) => {
    const iso = window.commun.decaler(debutSem, i);
    const c = creneauDuJour(etat.planning, iso);
    const mt = c ? minutesTravail(c) : 0;
    total += mt;
    return { nom, iso, c, mt };
  });
  $('semaine').innerHTML = jours.map((j) => `<span class="${j.c ? 'on' : ''} ${j.iso === auj ? 'auj' : ''} ${j.c ? '' : 'off'}" style="height:${j.c ? Math.max(25, Math.min(100, (j.mt / 600) * 100)) : 12}%"
    title="${j.nom} : ${j.c ? texteCreneau(j.c) : 'repos'}"></span>`).join('');
  $('semaine-jours').innerHTML = jours.map((j) => `<span class="${j.iso === auj ? 'auj' : ''}">${j.nom[0].toUpperCase()}</span>`).join('');
  $('planning-auj').textContent = total ? duree(total) : '';
  afficherBoulot();
}
$('semaine').addEventListener('click', () => $('modif-planning').click());
// Fenêtre de réglage : rien n'est changé avant « Enregistrer »
$('modif-planning').addEventListener('click', () => {
  $('planning-msg').textContent = '';
  $('planning-jours').innerHTML = NOMS_JOURS.map((nom, i) => {
    const p = etat.planning?.[i + 1];
    const off = p ? '' : 'disabled', offP = p?.pause ? '' : 'disabled';
    return `<div class="jour-p" data-j="${i + 1}">
      <div class="rang"><label><input type="checkbox" class="travail" ${p ? 'checked' : ''}> ${nom}</label>
        <input type="time" class="debut" value="${p?.debut || '09:00'}" aria-label="Début ${nom}" ${off}>
        <input type="time" class="fin" value="${p?.fin || '17:00'}" aria-label="Fin ${nom}" ${off}></div>
      <div class="rang pause"><label><input type="checkbox" class="a-pause" ${p?.pause ? 'checked' : ''} ${off}> ☕ Pause</label>
        <input type="time" class="p-debut" value="${p?.pause?.debut || '13:00'}" aria-label="Début de pause ${nom}" ${offP}>
        <input type="time" class="p-fin" value="${p?.pause?.fin || '14:00'}" aria-label="Fin de pause ${nom}" ${offP}></div></div>`;
  }).join('');
  $('fen-planning').showModal();
});
$('planning-jours').addEventListener('change', (e) => {
  const ligne = e.target.closest('[data-j]');
  if (!ligne || e.target.type !== 'checkbox') return;
  const q = (c) => ligne.querySelector(c);
  const travail = q('.travail').checked, pause = travail && q('.a-pause').checked;
  q('.debut').disabled = q('.fin').disabled = q('.a-pause').disabled = !travail;
  q('.p-debut').disabled = q('.p-fin').disabled = !pause;
});
$('planning-ok').addEventListener('click', () => {
  const nouveau = {};
  for (const ligne of $('planning-jours').querySelectorAll('[data-j]')) {
    const q = (c) => ligne.querySelector(c);
    if (!q('.travail').checked) continue;
    const c = { debut: q('.debut').value || '09:00', fin: q('.fin').value || '17:00' };
    if (c.debut >= c.fin) return ($('planning-msg').textContent = `${NOMS_JOURS[ligne.dataset.j - 1]} : la fin doit être après le début.`);
    if (q('.a-pause').checked) {
      c.pause = { debut: q('.p-debut').value, fin: q('.p-fin').value };
      if (!pauseValide(c)) return ($('planning-msg').textContent = `${NOMS_JOURS[ligne.dataset.j - 1]} : la pause doit être pendant la journée, et finir après avoir commencé.`);
    }
    nouveau[ligne.dataset.j] = c;
  }
  etat.planning = nouveau;
  enregistrer(); afficherPlanning();
  $('fen-planning').close();
});
$('planning-fermer').addEventListener('click', () => $('fen-planning').close());

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

function toutAfficher() { afficherTaches(); afficherRdv(); afficherRepas(); afficherLiens(); afficherPlanning(); }

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

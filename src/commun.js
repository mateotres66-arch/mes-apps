// Code partagé par les deux apps (et par test.js sous Node).
(function (racine) {
  const JOURS = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const JOURS_LONGS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

  // Lundi de la semaine de la date (heure locale), au format AAAA-MM-JJ : clé du menu.
  function lundi(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoJour(d);
  }
  function isoJour(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function decaler(iso, jours) {
    const [a, m, j] = iso.split('-').map(Number);
    return isoJour(new Date(a, m - 1, j + jours));
  }
  const indexJour = (date) => (date.getDay() + 6) % 7;

  const UNITES = { g: 'g', gr: 'g', kg: 'kg', ml: 'ml', cl: 'cl', l: 'l', cs: 'c. à s.', 'c.à.s': 'c. à s.', cc: 'c. à c.', 'c.à.c': 'c. à c.', pincee: 'pincée', pincée: 'pincée', tranche: 'tranche', tranches: 'tranche', boite: 'boîte', boîte: 'boîte', boites: 'boîte', boîtes: 'boîte', sachet: 'sachet', sachets: 'sachet', gousse: 'gousse', gousses: 'gousse' };

  // "200 g pâtes" -> {qte:200, unite:'g', nom:'pâtes'} ; "2 oeufs" -> {qte:2, unite:'', nom:'oeufs'} ; "sel" -> {qte:null, ...}
  function lireIngredient(ligne) {
    const t = String(ligne).trim().replace(/\s+/g, ' ');
    const m = t.match(/^(\d+\/\d+|\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (!m) return { qte: null, unite: '', nom: t };
    let qte = m[1].includes('/') ? m[1].split('/').reduce((a, b) => Number(a) / Number(b)) : Number(m[1].replace(',', '.'));
    let reste = m[2];
    let unite = '';
    const mot = reste.split(' ')[0].toLowerCase();
    if (UNITES[mot] && reste.includes(' ')) { unite = UNITES[mot]; reste = reste.slice(mot.length).trim(); }
    reste = reste.replace(/^(de |d'|d’)/i, '');
    if (unite === 'kg') { qte *= 1000; unite = 'g'; }
    if (unite === 'l') { qte *= 1000; unite = 'ml'; }
    if (unite === 'cl') { qte *= 10; unite = 'ml'; }
    return { qte, unite, nom: reste };
  }

  const cleNom = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/s\b/g, '').trim();

  // ---------- Idées repas : quelles recettes faire avec ce qu'on a ----------
  const SYNONYMES = { spaghetti: 'pate', nouille: 'pate', 'steak hache': 'boeuf hache', 'filet cabillaud': 'cabillaud', 'pave saumon': 'saumon' };
  const mots = (n) => {
    let s = cleNom(n.replace(/œ/g, 'oe')).replace(/[’']/g, ' ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    s = SYNONYMES[s] || s;
    return s.split(' ').filter((m) => m && !['de', 'd', 'du', 'la', 'le', 'les', 'des', 'a', 'au', 'aux'].includes(m));
  };
  // "poulet" correspond à "blanc de poulet", "tomates" à "tomates concassées" : tous les mots de l'un sont dans l'autre.
  function correspond(a, b) {
    const ma = mots(a), mb = mots(b);
    if (!ma.length || !mb.length) return false;
    return ma.every((m) => mb.includes(m)) || mb.every((m) => ma.includes(m));
  }
  const dansPlacard = (nom, placard) => placard.some((p) => correspond(p, nom) && mots(nom).length <= mots(p).length);

  // stock : lignes tapées par l'utilisateur ; recettes : [{nom, ingredients}] ; renvoie les recettes faisables, les meilleures d'abord.
  function proposerRepas(stock, recettes, placard = []) {
    const dispo = stock.map((l) => lireIngredient(l).nom).filter((n) => mots(n).length);
    if (!dispo.length) return [];
    const res = [];
    for (const recette of recettes) {
      const utiles = recette.ingredients.map((l) => lireIngredient(l).nom).filter((n) => !dansPlacard(n, placard));
      if (!utiles.length) continue;
      const trouves = utiles.filter((n) => dispo.some((d) => correspond(d, n)));
      if (!trouves.length) continue;
      res.push({ recette, trouves, manquants: utiles.filter((n) => !trouves.includes(n)), score: trouves.length / utiles.length });
    }
    return res.sort((a, b) => b.score - a.score || b.trouves.length - a.trouves.length || a.recette.nom.localeCompare(b.recette.nom, 'fr'));
  }

  // Additionne les ingrédients de plusieurs recettes, mis à l'échelle (personnes / portions de la recette).
  function listeCourses(plats) {
    const total = new Map();
    for (const { recette, personnes } of plats) {
      const facteur = recette.portions ? personnes / recette.portions : 1;
      for (const ligne of recette.ingredients) {
        if (!ligne.trim()) continue;
        const i = lireIngredient(ligne);
        const cle = cleNom(i.nom) + '|' + i.unite;
        const prec = total.get(cle);
        if (!prec) total.set(cle, { nom: i.nom, unite: i.unite, qte: i.qte === null ? null : i.qte * facteur, recettes: [recette.nom] });
        else {
          prec.qte = prec.qte === null || i.qte === null ? prec.qte ?? (i.qte === null ? null : i.qte * facteur) : prec.qte + i.qte * facteur;
          if (!prec.recettes.includes(recette.nom)) prec.recettes.push(recette.nom);
        }
      }
    }
    return [...total.entries()].map(([cle, v]) => ({ cle, ...v })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  }

  function formatQte(qte, unite) {
    if (qte === null) return '';
    let q = qte, u = unite;
    if (u === 'g' && q >= 1000) { q /= 1000; u = 'kg'; }
    if (u === 'ml' && q >= 1000) { q /= 1000; u = 'l'; }
    // on n'achète pas 6,5 oignons ni 1,5 boîte : arrondi au-dessus pour ce qui se compte
    const compte = ['', 'boîte', 'sachet', 'gousse', 'tranche'].includes(u);
    const arr = compte ? Math.ceil(q - 1e-9) : u === 'g' || u === 'ml' ? Math.ceil(q) : Math.round(q * 100) / 100;
    return `${String(arr).replace('.', ',')}${u ? ' ' + u : ''}`;
  }

  // Stockage : fichiers JSON via Electron, localStorage si la page est ouverte dans un navigateur (tests).
  const stockage = {
    async lire(cle) {
      if (racine.api) return racine.api.lire(cle);
      try { return JSON.parse(localStorage.getItem('mesapps-' + cle)); } catch { return null; }
    },
    async ecrire(cle, v) {
      if (racine.api) return racine.api.ecrire(cle, v);
      try { localStorage.setItem('mesapps-' + cle, JSON.stringify(v)); } catch {}
    },
  };

  // Tâche récurrente due ce jour-là ? regle : "jour" | "sem:1".."sem:7" (1 = lundi) | "mois:1".."mois:31"
  // (le 31 tombe le dernier jour des mois plus courts)
  function recurrenteDue(regle, iso) {
    const [a, m, j] = iso.split('-').map(Number);
    const d = new Date(a, m - 1, j);
    if (regle === 'jour') return true;
    const [type, n] = regle.split(':');
    if (type === 'sem') return indexJour(d) + 1 === Number(n);
    if (type === 'mois') return j === Math.min(Number(n), new Date(a, m, 0).getDate());
    return false;
  }

  // Planning de travail récurrent : { "1": {debut:"09:00", fin:"17:00"}, ... } (1 = lundi). Créneau du jour ou null.
  const creneauDuJour = (planning, iso) => {
    const [a, m, j] = iso.split('-').map(Number);
    return planning?.[indexJour(new Date(a, m - 1, j)) + 1] || null;
  };
  const heureCourte = (h) => h ? h.replace(/^0/, '').replace(':00', 'h').replace(':', 'h') : '';

  // "9h – 17h · pause 13h – 14h" ; pause : {debut, fin} facultative, à l'intérieur de la journée
  const texteCreneau = (c) => `${heureCourte(c.debut)} – ${heureCourte(c.fin)}` + (c.pause ? ` · pause ${heureCourte(c.pause.debut)} – ${heureCourte(c.pause.fin)}` : '');
  const pauseValide = (c) => c.pause.debut < c.pause.fin && c.pause.debut > c.debut && c.pause.fin < c.fin;

  // ---------- Briefing parlé ----------
  const CIEL = [[[0], 'grand soleil'], [[1], 'ciel plutôt dégagé'], [[2], 'quelques nuages'], [[3], 'ciel couvert'], [[45, 48], 'du brouillard'],
    [[51, 53, 55, 56, 57], 'de la bruine'], [[61, 63, 65, 66, 67, 80, 81, 82], 'de la pluie'], [[71, 73, 75, 77, 85, 86], 'de la neige'], [[95, 96, 99], 'de l’orage']];
  const ciel = (c) => (CIEL.find(([l]) => l.includes(c)) || [[], 'temps variable'])[1];
  // "09:00" -> "9 heures", "12:30" -> "midi 30", "00:15" -> "minuit 15"
  function heureParlee(h) {
    const [hh, mm] = h.split(':').map(Number);
    const base = hh === 0 ? 'minuit' : hh === 12 ? 'midi' : `${hh} heure${hh > 1 ? 's' : ''}`;
    return base + (mm ? ' ' + mm : '');
  }
  const deg = (v) => `${Math.round(v)} degré${Math.abs(Math.round(v)) > 1 ? 's' : ''}`;
  const virgule = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

  // Météo complète du jour à lire : maintenant, déroulé de la journée, pluie, vent, UV, soleil, conseils.
  // d : réponse Open-Meteo (current, hourly, daily) ; heure : heure actuelle (0-23).
  function meteoParlee(d, heure) {
    if (!d?.daily) return [];
    const j = d.daily, p = [];
    if (d.current) p.push(`En ce moment à Canet, il fait ${deg(d.current.temperature_2m)}, ressenti ${deg(d.current.apparent_temperature)}, avec ${ciel(d.current.weather_code)}.`);
    p.push(`Aujourd’hui, les températures vont de ${deg(j.temperature_2m_min[0])} à ${deg(j.temperature_2m_max[0])}.`);
    if (d.hourly) {
      const auj = j.time[0];
      const point = (h) => { const i = d.hourly.time.indexOf(`${auj}T${String(h).padStart(2, '0')}:00`); return i < 0 ? null : { c: ciel(d.hourly.weather_code[i]), t: d.hourly.temperature_2m[i] }; };
      const moments = [['ce matin', 9, 11], ['cet après-midi', 15, 17], ['ce soir', 20, 22]].filter(([, , fin]) => heure <= fin)
        .map(([nom, h]) => [nom, point(h)]).filter(([, x]) => x);
      if (moments.length > 1 && moments.every(([, x]) => x.c === moments[0][1].c)) p.push(`${moments[0][1].c[0].toUpperCase() + moments[0][1].c.slice(1)} tout le reste de la journée.`);
      else if (moments.length) p.push(moments.map(([nom, x]) => `${nom}, ${x.c} et ${deg(x.t)}`).join(' ; ').replace(/^./, (c) => c.toUpperCase()) + '.');
    }
    const pluie = j.precipitation_probability_max[0] ?? 0, mm = j.precipitation_sum[0] ?? 0;
    p.push(pluie >= 40 ? `Risque de pluie : ${pluie} pour cent${mm >= 0.5 ? `, environ ${virgule(mm)} millimètres` : ''}. Prends un parapluie.`
      : pluie >= 15 ? `Petit risque de pluie, ${pluie} pour cent.` : 'Pas de pluie prévue.');
    const vent = Math.round(j.wind_speed_10m_max[0]), rafales = Math.round(j.wind_gusts_10m_max[0]);
    p.push(`Vent jusqu’à ${vent} kilomètres heure, rafales à ${rafales}.` + (rafales >= 60 ? ' Ça va souffler très fort, fais attention.' : rafales >= 40 ? ' Ça va souffler.' : ''));
    const uv = Math.round(j.uv_index_max[0]);
    if (uv >= 3) p.push(`Indice UV de ${uv}` + (uv >= 6 ? ', pense à la crème solaire.' : ', niveau modéré.'));
    if (j.temperature_2m_min[0] <= 5) p.push('Il fait froid, couvre-toi bien.');
    const lever = j.sunrise[0].slice(11, 16), coucher = j.sunset[0].slice(11, 16);
    p.push(heure <= Number(lever.slice(0, 2)) ? `Le soleil se lève à ${heureParlee(lever)} et se couche à ${heureParlee(coucher)}.` : `Le soleil se couche à ${heureParlee(coucher)}.`);
    return p;
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const echapper = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const commun = { JOURS, JOURS_LONGS, lundi, isoJour, decaler, indexJour, lireIngredient, listeCourses, formatQte, correspond, proposerRepas, recurrenteDue, creneauDuJour, heureCourte, texteCreneau, pauseValide, heureParlee, meteoParlee, stockage, uid, echapper };
  if (typeof module !== 'undefined') module.exports = commun;
  else racine.commun = commun;
})(typeof window !== 'undefined' ? window : globalThis);

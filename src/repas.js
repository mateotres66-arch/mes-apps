const { stockage, uid, echapper, lundi, decaler, isoJour, indexJour, listeCourses, formatQte, JOURS, JOURS_LONGS } = window.commun;
const $ = (id) => document.getElementById(id);

const RECETTES_DEPART = [
  ['Pâtes carbonara', 2, ['250 g spaghetti', '150 g lardons', '2 oeufs', '50 g parmesan', 'poivre']],
  ['Poulet curry et riz', 4, ['600 g blanc de poulet', '1 oignon', '40 cl lait de coco', '2 cs curry', '300 g riz']],
  ['Chili con carne', 4, ['500 g boeuf haché', '1 boîte haricots rouges', '1 boîte tomates concassées', '1 oignon', '300 g riz', '1 cc cumin']],
  ['Salade niçoise', 2, ['1 boîte thon', '4 tomates', '2 oeufs', '1 poivron', '50 g olives noires', 'huile d’olive']],
  ['Omelette pommes de terre', 2, ['5 oeufs', '400 g pommes de terre', '1 oignon', 'sel']],
  ['Soupe de légumes', 4, ['3 carottes', '2 poireaux', '400 g pommes de terre', '1 oignon', '1 cube bouillon']],
];

let etat = { recettes: [], menus: {}, personnes: {}, coches: {}, extras: {}, defautPersonnes: 2 };
let semaine = lundi(new Date());
let recetteOuverte = null;

const enregistrer = () => stockage.ecrire('repas', etat);
const recette = (id) => etat.recettes.find((r) => r.id === id);
const triees = () => [...etat.recettes].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
const personnesSemaine = () => etat.personnes[semaine] ?? etat.defautPersonnes;
const dateCourte = (iso) => new Date(iso + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

// ---------- Onglets ----------
document.querySelector('nav').addEventListener('click', (e) => {
  const b = e.target.closest('.onglet');
  if (!b) return;
  document.querySelectorAll('.onglet').forEach((o) => o.setAttribute('aria-selected', String(o === b)));
  document.querySelectorAll('.vue').forEach((v) => { v.hidden = v.id !== 'vue-' + b.dataset.vue; });
  if (b.dataset.vue === 'courses') afficherCourses();
  if (b.dataset.vue === 'semaine') afficherSemaine();
  if (b.dataset.vue === 'idees') { calculerIdees(); afficherIdees(); }
  if (b.dataset.vue === 'recettes') afficherListeRecettes();
});

// ---------- Semaine ----------
function afficherSemaine() {
  const fin = decaler(semaine, 6);
  $('titre-semaine').textContent = `Semaine du ${dateCourte(semaine)} au ${dateCourte(fin)}`;
  $('personnes').value = personnesSemaine();
  const menu = etat.menus[semaine] || {};
  const options = '<option value="">—</option>' + triees().map((r) => `<option value="${r.id}">${echapper(r.nom)}</option>`).join('');
  const auj = isoJour(new Date());
  let html = '<div class="tete"></div><div class="tete">Midi</div><div class="tete">Soir</div>';
  JOURS.forEach((j, i) => {
    const date = decaler(semaine, i);
    html += `<div class="nomjour ${date === auj ? 'auj' : ''}">${JOURS_LONGS[i]}<small>${new Date(date + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</small></div>`;
    for (const m of ['midi', 'soir']) html += `<div><select data-cle="${j}-${m}" aria-label="${JOURS_LONGS[i]} ${m}">${options}</select></div>`;
  });
  $('grille-semaine').innerHTML = html;
  $('grille-semaine').querySelectorAll('select').forEach((s) => { s.value = menu[s.dataset.cle] || ''; });
}
$('grille-semaine').addEventListener('change', (e) => {
  const cle = e.target.dataset.cle;
  if (!cle) return;
  const menu = (etat.menus[semaine] ||= {});
  if (e.target.value) menu[cle] = e.target.value; else delete menu[cle];
  enregistrer();
});
$('sem-prec').onclick = () => { semaine = decaler(semaine, -7); afficherSemaine(); };
$('sem-suiv').onclick = () => { semaine = decaler(semaine, 7); afficherSemaine(); };
$('sem-auj').onclick = () => { semaine = lundi(new Date()); afficherSemaine(); };
$('personnes').addEventListener('change', (e) => {
  const n = Math.min(20, Math.max(1, Number(e.target.value) || 1));
  etat.personnes[semaine] = n; etat.defautPersonnes = n;
  enregistrer();
});
$('hasard').onclick = () => {
  if (!etat.recettes.length) return;
  const menu = (etat.menus[semaine] ||= {});
  // évite de reprendre deux fois la même recette tant qu'il en reste d'autres
  let pioche = [];
  for (const j of JOURS) for (const m of ['midi', 'soir']) {
    if (menu[`${j}-${m}`]) continue;
    if (!pioche.length) pioche = etat.recettes.map((r) => r.id).sort(() => Math.random() - 0.5);
    menu[`${j}-${m}`] = pioche.pop();
  }
  enregistrer(); afficherSemaine();
};

// ---------- Idées repas ----------
const { proposerRepas, correspond } = window.commun;
const lignesStock = () => (etat.stock || '').split(/\n|,(?!\d)/).map((l) => l.trim()).filter(Boolean);
// Mes recettes + celles de la bibliothèque que je n'ai pas encore (même nom).
function candidates() {
  const miens = new Set(etat.recettes.map((r) => r.nom.toLowerCase()));
  const lib = window.BIBLIOTHEQUE.filter(([nom]) => !miens.has(nom.toLowerCase()))
    .map(([nom, portions, ingredients]) => ({ id: 'lib:' + nom, nom, portions, ingredients, etapes: '', bibliotheque: true }));
  return [...etat.recettes, ...lib];
}
let idees = [];
function calculerIdees() {
  idees = proposerRepas(lignesStock(), candidates(), window.PLACARD);
  if ($('seulement-complets').checked) idees = idees.filter((i) => !i.manquants.length);
}
// Copie une recette de la bibliothèque dans mes recettes la première fois qu'on l'utilise.
function adopter(r) {
  if (!r.bibliotheque) return r.id;
  const deja = etat.recettes.find((x) => x.nom.toLowerCase() === r.nom.toLowerCase());
  if (deja) return deja.id;
  const id = uid();
  etat.recettes.push({ id, nom: r.nom, portions: r.portions, ingredients: [...r.ingredients], etapes: '' });
  return id;
}
function casesVides() {
  const menu = etat.menus[semaine] || {};
  const vides = [];
  for (const j of JOURS) for (const m of ['midi', 'soir']) if (!menu[`${j}-${m}`]) vides.push(`${j}-${m}`);
  return vides;
}
function afficherIdees() {
  $('stock').value = etat.stock || '';
  const menu = etat.menus[semaine] || {};
  const prevus = new Set(Object.values(menu).map((id) => recette(id)?.nom.toLowerCase()));
  $('titre-idees').textContent = idees.length ? `${idees.length} idée${idees.length > 1 ? 's' : ''} · semaine du ${dateCourte(semaine)}` : 'Idées';
  if (!lignesStock().length) { $('liste-idees').innerHTML = '<p class="vide">Tape tes courses à gauche puis clique sur « Proposer des repas ».</p>'; return; }
  if (!idees.length) { $('liste-idees').innerHTML = '<p class="vide">Aucune recette ne correspond. Ajoute d’autres produits ou décoche le filtre.</p>'; return; }
  $('liste-idees').innerHTML = idees.map((i, n) => {
    const deja = prevus.has(i.recette.nom.toLowerCase());
    return `<article class="idee ${deja ? 'ajoutee' : ''}">
      <h3>${echapper(i.recette.nom)}</h3>
      <div class="jauge" title="${Math.round(i.score * 100)} % des ingrédients"><i style="width:${Math.round(i.score * 100)}%"></i></div>
      <div class="ok">✓ ${echapper(i.trouves.join(', '))}</div>
      ${i.manquants.length ? `<div class="manque">Manque : ${echapper(i.manquants.join(', '))}</div>` : '<div class="ok"><b>Rien à racheter</b></div>'}
      <div class="bas"><span class="petit">${i.recette.bibliotheque ? 'Nouvelle recette' : 'Ma recette'}</span><span class="espace"></span>
        <button class="${deja ? 'contour' : ''}" data-n="${n}">${deja ? '+ Encore' : '+ Semaine'}</button></div>
    </article>`;
  }).join('');
}
$('form-stock').addEventListener('submit', (e) => {
  e.preventDefault();
  etat.stock = $('stock').value;
  enregistrer();
  calculerIdees(); afficherIdees();
  $('info-idees').textContent = '';
});
$('seulement-complets').addEventListener('change', () => { calculerIdees(); afficherIdees(); });
$('liste-idees').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-n]');
  if (!b) return;
  const vide = casesVides()[0];
  if (!vide) { $('info-idees').textContent = 'La semaine est déjà pleine. Change de semaine dans l’onglet « Semaine ».'; return; }
  (etat.menus[semaine] ||= {})[vide] = adopter(idees[Number(b.dataset.n)].recette);
  enregistrer();
  const [j, m] = vide.split('-');
  $('info-idees').textContent = `Ajouté : ${JOURS_LONGS[JOURS.indexOf(j)]} ${m}.`;
  afficherIdees();
});
$('remplir').onclick = () => {
  etat.stock = $('stock').value;
  calculerIdees();
  const vides = casesVides();
  if (!idees.length) { afficherIdees(); return; }
  if (!vides.length) { $('info-idees').textContent = 'La semaine est déjà pleine.'; return; }
  // chaque idée une fois, les meilleures d'abord, puis on recommence si la semaine n'est pas pleine
  const menu = (etat.menus[semaine] ||= {});
  vides.forEach((cle, k) => { menu[cle] = adopter(idees[k % idees.length].recette); });
  enregistrer();
  $('info-idees').textContent = `${vides.length} repas ajoutés à la semaine du ${dateCourte(semaine)}. Ce qui manque est dans « Liste de courses ».`;
  afficherIdees();
};

// ---------- Recettes ----------
function afficherListeRecettes() {
  const q = $('cherche').value.trim().toLowerCase();
  const liste = triees().filter((r) => r.nom.toLowerCase().includes(q));
  $('liste-recettes').innerHTML = liste.length
    ? liste.map((r) => `<li data-id="${r.id}" tabindex="0" aria-current="${r.id === recetteOuverte}">${echapper(r.nom)}</li>`).join('')
    : '<li class="vide">Aucune recette.</li>';
}
function ouvrirRecette(id) {
  recetteOuverte = id;
  const r = recette(id) || { nom: '', portions: etat.defautPersonnes, ingredients: [], etapes: '' };
  $('r-nom').value = r.nom; $('r-portions').value = r.portions;
  $('r-ingredients').value = r.ingredients.join('\n'); $('r-etapes').value = r.etapes || '';
  $('supprimer').hidden = !recette(id);
  $('sauve').textContent = '';
  afficherListeRecettes();
}
$('liste-recettes').addEventListener('click', (e) => { const li = e.target.closest('li[data-id]'); if (li) ouvrirRecette(li.dataset.id); });
$('liste-recettes').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.click(); });
$('cherche').addEventListener('input', afficherListeRecettes);
$('nouvelle').onclick = () => { ouvrirRecette(null); $('r-nom').focus(); };
$('editeur').addEventListener('submit', (e) => {
  e.preventDefault();
  const donnees = {
    nom: $('r-nom').value.trim(),
    portions: Math.max(1, Number($('r-portions').value) || 1),
    ingredients: $('r-ingredients').value.split('\n').map((l) => l.trim()).filter(Boolean),
    etapes: $('r-etapes').value.trim(),
  };
  const r = recette(recetteOuverte);
  if (r) Object.assign(r, donnees);
  else { recetteOuverte = uid(); etat.recettes.push({ id: recetteOuverte, ...donnees }); }
  enregistrer();
  ouvrirRecette(recetteOuverte);
  $('sauve').textContent = '✓ Enregistrée';
});
$('supprimer').onclick = () => {
  const r = recette(recetteOuverte);
  if (!r || !confirm(`Supprimer « ${r.nom} » ? Elle sera aussi retirée des menus.`)) return;
  etat.recettes = etat.recettes.filter((x) => x !== r);
  for (const menu of Object.values(etat.menus)) for (const k in menu) if (menu[k] === r.id) delete menu[k];
  enregistrer();
  ouvrirRecette(triees()[0]?.id ?? null);
};

// ---------- Courses ----------
function articles() {
  const menu = etat.menus[semaine] || {};
  const plats = Object.values(menu).map(recette).filter(Boolean).map((r) => ({ recette: r, personnes: personnesSemaine() }));
  return listeCourses(plats);
}
// Coché si l'utilisateur l'a coché, sinon si le produit est déjà dans « Mes courses / mon frigo ».
const enStock = (a) => lignesStock().some((s) => correspond(window.commun.lireIngredient(s).nom, a.nom));
function etatCoches(liste) {
  const c = etat.coches[semaine] || {};
  return Object.fromEntries(liste.map((a) => [a.cle, a.cle in c ? c[a.cle] : enStock(a)]));
}
function afficherCourses() {
  $('titre-courses').textContent = `Courses · semaine du ${dateCourte(semaine)} (${personnesSemaine()} pers.)`;
  const liste = articles();
  const coches = etatCoches(liste);
  $('liste-courses').innerHTML = liste.length ? liste.map((a) => `
    <li class="article ${coches[a.cle] ? 'coche' : ''}">
      <input type="checkbox" id="c-${encodeURIComponent(a.cle)}" data-cle="${echapper(a.cle)}" ${coches[a.cle] ? 'checked' : ''}>
      <label for="c-${encodeURIComponent(a.cle)}"><span class="qte">${formatQte(a.qte, a.unite)}</span><span>${echapper(a.nom)}</span>
      <span class="source">${echapper(a.recettes.join(', '))}${enStock(a) ? ' · déjà acheté' : ''}</span></label>
    </li>`).join('') : '<li class="vide">Aucun repas prévu cette semaine. Remplis l’onglet « Semaine ».</li>';
  const extras = etat.extras[semaine] || [];
  $('liste-extras').innerHTML = extras.length ? extras.map((x) => `
    <li class="article ${x.fait ? 'coche' : ''}" data-id="${x.id}"><input type="checkbox" id="x-${x.id}" ${x.fait ? 'checked' : ''}>
    <label for="x-${x.id}">${echapper(x.texte)}</label><button class="discret suppr" aria-label="Retirer">✕</button></li>`).join('')
    : '<li class="vide">Rien en plus.</li>';
}
$('liste-courses').addEventListener('change', (e) => {
  const cle = e.target.dataset.cle;
  (etat.coches[semaine] ||= {})[cle] = e.target.checked;
  enregistrer(); afficherCourses();
});
$('liste-extras').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  const extras = etat.extras[semaine];
  const x = extras.find((y) => y.id === li.dataset.id);
  if (e.target.matches('input')) x.fait = e.target.checked;
  else if (e.target.matches('.suppr')) etat.extras[semaine] = extras.filter((y) => y !== x);
  else return;
  enregistrer(); afficherCourses();
});
$('form-extra').addEventListener('submit', (e) => {
  e.preventDefault();
  (etat.extras[semaine] ||= []).push({ id: uid(), texte: $('extra').value.trim(), fait: false });
  $('extra').value = '';
  enregistrer(); afficherCourses();
});
$('decocher').onclick = () => {
  etat.coches[semaine] = Object.fromEntries(articles().map((a) => [a.cle, false]));
  (etat.extras[semaine] || []).forEach((x) => { x.fait = false; });
  enregistrer(); afficherCourses();
};
$('copier').onclick = async () => {
  const coches = etatCoches(articles());
  const lignes = articles().filter((a) => !coches[a.cle]).map((a) => `- ${formatQte(a.qte, a.unite)} ${a.nom}`.replace('-  ', '- '));
  (etat.extras[semaine] || []).filter((x) => !x.fait).forEach((x) => lignes.push('- ' + x.texte));
  await navigator.clipboard.writeText(`Courses semaine du ${dateCourte(semaine)}\n` + lignes.join('\n'));
  $('copier').textContent = '✓ Copiée';
  setTimeout(() => { $('copier').textContent = 'Copier la liste'; }, 1500);
};

// synchro : changement venu du téléphone ou du PC -> on redessine l'onglet ouvert
stockage.surChangement?.('repas', (v) => {
  etat = { ...etat, ...v };
  const vue = document.querySelector('.onglet[aria-selected="true"]').dataset.vue;
  if (vue === 'semaine') afficherSemaine();
  else if (vue === 'courses') afficherCourses();
  else if (vue === 'idees') { calculerIdees(); afficherIdees(); }
  else afficherListeRecettes();
});

(async () => {
  const sauve = await stockage.lire('repas');
  if (sauve) etat = { ...etat, ...sauve };
  else {
    // pas enregistré tout de suite : sinon ces recettes de départ écraseraient celles du cloud à la première synchro
    etat.recettes = RECETTES_DEPART.map(([nom, portions, ingredients]) => ({ id: uid(), nom, portions, ingredients, etapes: '' }));
  }
  afficherSemaine();
  ouvrirRecette(triees()[0]?.id ?? null);
})();

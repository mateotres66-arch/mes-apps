const assert = require('assert');
const c = require('./src/commun.js');

assert.deepStrictEqual(c.lireIngredient('200 g pâtes'), { qte: 200, unite: 'g', nom: 'pâtes' });
assert.deepStrictEqual(c.lireIngredient('2 oeufs'), { qte: 2, unite: '', nom: 'oeufs' });
assert.deepStrictEqual(c.lireIngredient('1,5 kg de pommes de terre'), { qte: 1500, unite: 'g', nom: 'pommes de terre' });
assert.deepStrictEqual(c.lireIngredient('20 cl crème'), { qte: 200, unite: 'ml', nom: 'crème' });
assert.deepStrictEqual(c.lireIngredient('sel'), { qte: null, unite: '', nom: 'sel' });
assert.strictEqual(c.lireIngredient('1/2 citron').qte, 0.5);

assert.strictEqual(c.lundi(new Date(2026, 10, 11)), '2026-11-09'); // mercredi -> lundi
assert.strictEqual(c.lundi(new Date(2026, 10, 15)), '2026-11-09'); // dimanche -> lundi précédent
assert.strictEqual(c.decaler('2026-11-09', 7), '2026-11-16');
assert.strictEqual(c.decaler('2026-12-28', 7), '2027-01-04');

const pates = { nom: 'Pâtes', portions: 2, ingredients: ['200 g pâtes', '1 oignon', 'sel'] };
const soupe = { nom: 'Soupe', portions: 4, ingredients: ['2 oignons', '0,5 kg pâtes', 'sel'] };
const l = c.listeCourses([{ recette: pates, personnes: 4 }, { recette: soupe, personnes: 2 }]);
const trouve = (n) => l.find((x) => x.nom.startsWith(n));
assert.strictEqual(trouve('pâtes').qte, 400 + 250);
assert.strictEqual(trouve('oignon').qte, 2 + 1); // "oignon" et "oignons" fusionnés
assert.strictEqual(trouve('sel').qte, null);
assert.deepStrictEqual(trouve('sel').recettes, ['Pâtes', 'Soupe']);
assert.strictEqual(c.formatQte(650, 'g'), '650 g');
assert.strictEqual(c.formatQte(1500, 'g'), '1,5 kg');
assert.strictEqual(c.formatQte(null, ''), '');
assert.strictEqual(c.formatQte(6.5, ''), '7');
assert.strictEqual(c.formatQte(1.5, 'boîte'), '2 boîte');
assert.strictEqual(c.formatQte(1.5, 'c. à c.'), '1,5 c. à c.');
// Tâches récurrentes
assert.ok(c.recurrenteDue('jour', '2026-11-11'));
assert.ok(c.recurrenteDue('sem:2', '2026-11-10')); // mardi
assert.ok(!c.recurrenteDue('sem:2', '2026-11-11'));
assert.ok(c.recurrenteDue('mois:1', '2026-12-01'));
assert.ok(c.recurrenteDue('mois:31', '2026-11-30')); // dernier jour d'un mois de 30 jours
assert.ok(!c.recurrenteDue('mois:31', '2026-11-29'));
assert.ok(c.recurrenteDue('mois:31', '2027-02-28'));

// Planning de travail
const plan = { 1: { debut: '09:00', fin: '17:30' }, 3: { debut: '14:00', fin: '22:00' } };
assert.deepStrictEqual(c.creneauDuJour(plan, '2026-11-09'), plan[1]); // lundi
assert.strictEqual(c.creneauDuJour(plan, '2026-11-10'), null); // mardi : repos
assert.deepStrictEqual(c.creneauDuJour(plan, '2026-11-18'), plan[3]); // mercredi, semaine suivante
assert.strictEqual(c.creneauDuJour(undefined, '2026-11-09'), null);
assert.strictEqual(c.heureCourte('09:00'), '9h');
assert.strictEqual(c.heureCourte('17:30'), '17h30');

const coupe = { debut: '09:00', fin: '17:00', pause: { debut: '13:00', fin: '14:00' } };
assert.strictEqual(c.texteCreneau(coupe), '9h – 17h · pause 13h – 14h');
assert.strictEqual(c.texteCreneau(plan[1]), '9h – 17h30');
assert.ok(c.pauseValide(coupe));
assert.ok(!c.pauseValide({ ...coupe, pause: { debut: '14:00', fin: '13:00' } })); // à l'envers
assert.ok(!c.pauseValide({ ...coupe, pause: { debut: '08:00', fin: '10:00' } })); // hors journée

// Briefing parlé
assert.strictEqual(c.heureParlee('09:00'), '9 heures');
assert.strictEqual(c.heureParlee('12:30'), 'midi 30');
assert.strictEqual(c.heureParlee('01:05'), '1 heure 5');
const h = (j) => Array.from({ length: 24 }, (_, i) => `2026-11-${j}T${String(i).padStart(2, '0')}:00`);
const met = {
  current: { temperature_2m: 11.4, apparent_temperature: 9.6, weather_code: 0 },
  hourly: { time: [...h(12), ...h(13)], weather_code: Array(48).fill(0).map((_, i) => (i >= 18 ? 61 : 0)), temperature_2m: Array(48).fill(14) },
  daily: { time: ['2026-11-12', '2026-11-13'], weather_code: [61, 3], temperature_2m_min: [4.2, 8], temperature_2m_max: [17.6, 15],
    precipitation_probability_max: [70, 10], precipitation_sum: [3.24, 0], wind_speed_10m_max: [25, 10], wind_gusts_10m_max: [52, 20],
    uv_index_max: [2, 1], sunrise: ['2026-11-12T07:41', '2026-11-13T07:42'], sunset: ['2026-11-12T17:20', '2026-11-13T17:19'] },
};
const dit = c.meteoParlee(met, 7).join(' ');
for (const bout of ['il fait 11 degrés, ressenti 10 degrés, avec grand soleil', 'de 4 degrés à 18 degrés', 'Ce matin, grand soleil et 14 degrés ; cet après-midi, grand soleil et 14 degrés ; ce soir, de la pluie et 14 degrés',
  '70 pour cent, environ 3,2 millimètres. Prends un parapluie', 'rafales à 52. Ça va souffler.', 'couvre-toi', 'se lève à 7 heures 41 et se couche à 17 heures 20'])
  assert.ok(dit.includes(bout), 'manque « ' + bout + ' » dans : ' + dit);
assert.ok(!dit.includes('UV')); // UV 2 : rien à dire
assert.ok(!/demain/i.test(dit)); // on ne parle que d'aujourd'hui
assert.ok(!c.meteoParlee(met, 21).join(' ').includes('ce matin')); // le soir, on ne parle plus du matin
assert.deepStrictEqual(c.meteoParlee(null, 8), []);

// Idées repas
const { BIBLIOTHEQUE, PLACARD } = require('./src/bibliotheque.js');
const lib = BIBLIOTHEQUE.map(([nom, portions, ingredients]) => ({ nom, portions, ingredients }));
assert.ok(c.correspond('poulet', 'blanc de poulet'));
assert.ok(c.correspond('Tomates', 'tomates concassées'));
assert.ok(c.correspond('spaghettis', 'pâtes'));
assert.ok(!c.correspond('poulet', 'pommes de terre'));
const idees = c.proposerRepas(['600 g poulet', 'riz', 'oignons', 'lait de coco'], lib, PLACARD);
assert.strictEqual(idees[0].recette.nom, 'Poulet curry et riz');
assert.deepStrictEqual(idees[0].manquants, []); // curry = placard
assert.ok(idees.length > 10, 'beaucoup de propositions : ' + idees.length);
assert.deepStrictEqual(c.proposerRepas(['', '  '], lib, PLACARD), []);
for (const [nom, , ing] of BIBLIOTHEQUE) for (const l of ing) assert.ok(c.lireIngredient(l).nom, nom + ' : ' + l);
console.log('ok : tous les tests passent (' + idees.length + ' idées pour poulet/riz/oignons/coco)');

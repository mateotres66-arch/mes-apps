// Briefing du matin : lecture à voix haute + réglages du réveil + notifications push sur le téléphone.
(function () {
  const VAPID_PUBLIQUE = 'BBCyZgdhPX4mOxBash9GdkUXQNtYzrO9p4zToF5zt2I7cau-V2ehUUE2Sw5ikRdIv7nqT5wHrNRkOTsDJB_qVpI';
  const { stockage, isoJour, decaler, lundi, indexJour, JOURS, echapper } = window.commun;
  const $ = (id) => document.getElementById(id);
  const sync = () => window.commun.sync;

  // ---------- Texte du briefing ----------
  const { heureParlee, meteoParlee, creneauDuJour } = window.commun;
  const boulotParle = (c) => `de ${heureParlee(c.debut)} à ${heureParlee(c.fin)}${c.pause ? `, pause de ${heureParlee(c.pause.debut)} à ${heureParlee(c.pause.fin)}` : ''}`;
  const rdvParle = (r) => (r.heure ? `${r.texte} à ${heureParlee(r.heure)}` : r.texte);

  async function texteBriefing() {
    const n = new Date();
    const auj = isoJour(n);
    const date = n.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const salut = n.getHours() < 12 ? 'Bonjour' : n.getHours() < 18 ? 'Bon après-midi' : 'Bonsoir';
    const morceaux = [`${salut} Mateo ! On est ${date}.`];

    // Météo du jour, courte
    // météo pas encore arrivée (appli tout juste ouverte, ex. depuis la notification) : on l'attend, 6 s maximum
    if (typeof derniereMeteo !== 'undefined' && !derniereMeteo?.daily && typeof meteo === 'function')
      await Promise.race([meteo(), new Promise((ok) => setTimeout(ok, 6000))]);
    const d = typeof derniereMeteo !== 'undefined' ? derniereMeteo : null; // défini par matin.js
    const phrasesMeteo = meteoParlee(d);
    morceaux.push(...(phrasesMeteo.length ? phrasesMeteo : ['Je n’ai pas pu récupérer la météo.']));

    // Emploi du jour : boulot, rendez-vous, tâches, repas
    const e = typeof etat !== 'undefined' ? etat : { rdv: [], taches: [] }; // défini par matin.js
    const boulot = creneauDuJour(e.planning, auj);
    morceaux.push(boulot ? `Tu travailles ${boulotParle(boulot)}.` : 'Tu es de repos.');
    const rdv = (e.rdv || []).filter((r) => r.date === auj).sort((a, b) => (a.heure || '').localeCompare(b.heure || ''));
    if (rdv.length) morceaux.push(`Rendez-vous : ${rdv.map(rdvParle).join(', puis ')}.`);
    const taches = (e.taches || []).filter((t) => !t.fait);
    if (taches.length) morceaux.push(`À faire : ${taches.slice(0, 3).map((t) => t.texte).join(', ')}${taches.length > 3 ? `, et ${taches.length - 3} autre${taches.length > 4 ? 's' : ''}` : ''}.`);
    const r = await stockage.lire('repas');
    const menu = r?.menus?.[lundi(n)] || {};
    const j = JOURS[indexJour(n)];
    const nom = (id) => r?.recettes?.find((x) => x.id === id)?.nom;
    const midi = nom(menu[j + '-midi']), soir = nom(menu[j + '-soir']);
    if (midi || soir) morceaux.push(`Au menu : ${[midi && 'à midi, ' + midi, soir && 'le soir, ' + soir].filter(Boolean).join(', et ')}.`);

    morceaux.push('Bonne journée !');
    return morceaux.join(' ');
  }

  // ---------- Voix ----------
  // 1) voix naturelle Google (fonction Supabase « voix », compte connecté) ; 2) sinon voix de l'appareil
  const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  let parle = false, lecteur = null;
  function voixFr() {
    const v = speechSynthesis.getVoices().filter((x) => x.lang?.toLowerCase().startsWith('fr'));
    return v.find((x) => /natural|online|google|denise|hortense|amelie|audrey/i.test(x.name)) || v[0] || null;
  }
  function arreter() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (lecteur) { lecteur.pause(); lecteur = null; }
    parle = false; majBoutonVoix();
  }
  async function audioGoogle(texte) {
    const s = sync();
    if (!s?.utilisateur()) return null;
    try {
      const { data, error } = await s.sb.functions.invoke('voix', { body: { texte } });
      return error || !data?.audio ? null : 'data:audio/mpeg;base64,' + data.audio;
    } catch { return null; }
  }
  function voixAppareil(texte) {
    if (!('speechSynthesis' in window)) { alert('La synthèse vocale n’est pas disponible sur cet appareil.'); return arreter(); }
    const u = new SpeechSynthesisUtterance(texte);
    u.lang = 'fr-FR'; u.voice = voixFr(); u.rate = 0.95;
    u.onend = u.onerror = arreter;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
  async function ecouter() {
    if (parle) return arreter();
    parle = true; majBoutonVoix();
    if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(' ')); // débloque la voix pendant l'appui (iPhone)
    // lecteur créé pendant l'appui : l'iPhone autorise ensuite la lecture, même après l'attente réseau
    const a = new Audio(SILENCE);
    a.play().catch(() => {});
    lecteur = a;
    const texte = await texteBriefing();
    const mp3 = await audioGoogle(texte);
    if (lecteur !== a) return; // arrêté pendant le chargement
    if (!mp3) { lecteur = null; return voixAppareil(texte); }
    a.src = mp3;
    a.onended = a.onerror = arreter;
    a.play().catch(() => { lecteur = null; voixAppareil(texte); });
  }

  // ---------- Interface ----------
  const style = document.createElement('style');
  style.textContent = `
    .actions-entete { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    #bouton-voix { font-size: 16px; padding: 10px 16px; }
    #bouton-reveil { padding: 10px 14px; }
    #grand-briefing { position: fixed; inset: 0; z-index: 60; background: rgba(10,10,14,.75); display: flex; align-items: center; justify-content: center; }
    #grand-briefing button { font-size: 22px; padding: 22px 30px; border-radius: 99px; box-shadow: var(--ombre); }
    #reveil { width: min(460px, calc(100vw - 32px)); border: 1px solid var(--ligne); border-radius: 16px; background: var(--carte); color: var(--encre); padding: 22px; }
    #reveil::backdrop { background: rgba(10,10,14,.55); }
    #reveil .jours-sem { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0 4px; }
    #reveil .jours-sem label { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 13px; background: var(--fond); border-radius: 10px; padding: 6px 8px; cursor: pointer; }
    #reveil .ligne { display: grid; grid-template-columns: 1fr 120px; gap: 10px; align-items: center; margin: 10px 0; }
    #reveil h3 { font-size: 14px; margin: 18px 0 6px; }
    #reveil .act { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    #reveil-msg { font-size: 13px; min-height: 1em; margin-top: 10px; }
  `;
  document.head.appendChild(style);

  const entete = document.querySelector('header');
  const boite = document.createElement('div');
  boite.className = 'actions-entete';
  boite.innerHTML = `<button id="bouton-voix" type="button">🔊 Écouter mon briefing</button><button id="bouton-reveil" type="button" class="contour">⏰ Réveil &amp; notifs</button>`;
  entete.appendChild(boite);
  const majBoutonVoix = () => { if ($('bouton-voix')) $('bouton-voix').textContent = parle ? '⏹ Arrêter' : '🔊 Écouter mon briefing'; };
  $('bouton-voix').onclick = ecouter;

  // ouvert depuis la notification : gros bouton (la voix a besoin d'un appui sur l'écran)
  const params = new URLSearchParams(location.search);
  if (params.has('briefing')) {
    const g = document.createElement('div');
    g.id = 'grand-briefing';
    g.innerHTML = '<button type="button">🔊 Écouter mon briefing</button>';
    g.onclick = () => { g.remove(); ecouter(); };
    document.body.appendChild(g);
    history.replaceState(null, '', location.pathname);
  }

  // ---------- Réglages du réveil ----------
  const NOMS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const DEFAUT = { actif: true, heure_reveil: '06:25', heure_sans_reveil: '09:00', jours_reveil: [1, 2, 3, 4, 5], sans_reveil_le: [] };
  let reglages = { ...DEFAUT };
  const fen = document.createElement('dialog');
  fen.id = 'reveil';
  document.body.appendChild(fen);
  const pushPossible = () => 'serviceWorker' in navigator && 'PushManager' in window && !window.api;
  const iosNonInstalle = () => /iphone|ipad/i.test(navigator.userAgent) && !navigator.standalone;

  async function chargerReglages() {
    const s = sync();
    if (!s?.utilisateur()) return false;
    const { data } = await s.sb.from('reglages_briefing').select('*').maybeSingle();
    reglages = { ...DEFAUT, ...(data || {}) };
    reglages.heure_reveil = reglages.heure_reveil.slice(0, 5);
    reglages.heure_sans_reveil = reglages.heure_sans_reveil.slice(0, 5);
    return true;
  }
  async function enregistrerReglages() {
    const auj = isoJour(new Date());
    reglages.sans_reveil_le = [...new Set(reglages.sans_reveil_le)].filter((d) => d >= auj); // on oublie les dates passées
    const { actif, heure_reveil, heure_sans_reveil, jours_reveil, sans_reveil_le } = reglages;
    const { error } = await sync().sb.from('reglages_briefing')
      .upsert({ user_id: sync().utilisateur().id, actif, heure_reveil, heure_sans_reveil, jours_reveil, sans_reveil_le });
    return error;
  }

  function dessiner() {
    const demain = decaler(isoJour(new Date()), 1);
    const sansDemain = reglages.sans_reveil_le.includes(demain);
    fen.innerHTML = `
      <h2 style="margin:0 0 4px">⏰ Réveil &amp; notifications</h2>
      <p class="petit" style="margin:0">Chaque matin, une notification avec la météo et ta journée. Heure de Paris.</p>
      <label style="display:flex;gap:10px;align-items:center;margin-top:14px"><input type="checkbox" id="r-actif" ${reglages.actif ? 'checked' : ''}> Envoyer le briefing chaque matin</label>
      <h3>Jours où ton réveil sonne</h3>
      <div class="jours-sem">${NOMS.map((n, i) => `<label><input type="checkbox" value="${i + 1}" ${reglages.jours_reveil.includes(i + 1) ? 'checked' : ''}>${n}</label>`).join('')}</div>
      <div class="ligne"><label for="r-heure">Notification les jours de réveil</label><input type="time" id="r-heure" value="${reglages.heure_reveil}" required></div>
      <div class="ligne"><label for="r-heure2">Les jours sans réveil</label><input type="time" id="r-heure2" value="${reglages.heure_sans_reveil}" required></div>
      <button type="button" class="contour" id="r-demain">${sansDemain ? '✓ Demain : pas de réveil (annuler)' : '😴 Demain : pas de réveil'}</button>
      <h3>Cet appareil</h3>
      <div class="act">
        ${pushPossible() ? '<button type="button" id="r-activer">🔔 Recevoir les notifications ici</button>' : `<span class="petit">${window.api ? 'Les notifications arrivent sur le téléphone : active-les depuis l’app du téléphone.' : 'Notifications non disponibles dans ce navigateur.'}</span>`}
        <button type="button" class="contour" id="r-test">Envoyer un test</button>
      </div>
      ${iosNonInstalle() ? '<p class="petit" style="color:var(--rouge)">Sur iPhone, installe d’abord l’app : Partager → « Sur l’écran d’accueil », puis ouvre-la depuis l’icône.</p>' : ''}
      <div id="reveil-msg" role="status"></div>
      <div class="act"><button type="button" id="r-ok">Enregistrer</button><button type="button" class="discret" id="r-fermer">Fermer</button></div>`;
    const msg = (t, err) => { $('reveil-msg').textContent = t; $('reveil-msg').style.color = err ? 'var(--rouge)' : 'var(--vert)'; };
    const lire = () => {
      reglages.actif = $('r-actif').checked;
      reglages.jours_reveil = [...fen.querySelectorAll('.jours-sem input:checked')].map((i) => Number(i.value));
      reglages.heure_reveil = $('r-heure').value || '06:25';
      reglages.heure_sans_reveil = $('r-heure2').value || '09:00';
    };
    $('r-fermer').onclick = () => fen.close();
    $('r-ok').onclick = async () => { lire(); const e = await enregistrerReglages(); e ? msg('Erreur : ' + e.message, true) : (msg('✓ Enregistré'), setTimeout(() => fen.close(), 700)); };
    $('r-demain').onclick = async () => {
      lire();
      reglages.sans_reveil_le = sansDemain ? reglages.sans_reveil_le.filter((d) => d !== demain) : [...reglages.sans_reveil_le, demain];
      const e = await enregistrerReglages();
      if (e) return msg('Erreur : ' + e.message, true);
      dessiner();
      msg(sansDemain ? 'Demain : notification à l’heure du réveil.' : `Demain : notification à ${reglages.heure_sans_reveil.replace(':', 'h')}.`);
    };
    if ($('r-activer')) $('r-activer').onclick = async () => {
      try {
        if (iosNonInstalle()) return msg('Installe d’abord l’app sur l’écran d’accueil.', true);
        if (await Notification.requestPermission() !== 'granted') return msg('Notifications refusées. Autorise-les dans les réglages du téléphone.', true);
        const reg = await navigator.serviceWorker.ready;
        const cle = Uint8Array.from(atob(VAPID_PUBLIQUE.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        const abo = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cle });
        const j = abo.toJSON();
        const sb = sync().sb;
        await sb.from('abonnements_push').delete().eq('endpoint', j.endpoint);
        const { error } = await sb.from('abonnements_push').insert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, appareil: navigator.userAgent.slice(0, 190) });
        if (error) return msg('Erreur : ' + error.message, true);
        lire();
        await enregistrerReglages();
        msg('✓ Notifications activées sur cet appareil.');
      } catch (e) { msg('Impossible : ' + e.message, true); }
    };
    $('r-test').onclick = async () => {
      msg('Envoi…');
      const { data, error } = await sync().sb.functions.invoke('briefing', { body: { test: true } });
      if (error) return msg('Erreur : ' + error.message, true);
      msg(data.envoyes ? `✓ Envoyé à ${data.envoyes} appareil${data.envoyes > 1 ? 's' : ''}.` : 'Aucun appareil abonné : active d’abord les notifications sur ton téléphone.', !data.envoyes);
    };
  }

  $('bouton-reveil').onclick = async () => {
    if (!(await chargerReglages())) {
      fen.innerHTML = `<h2 style="margin:0 0 6px">⏰ Réveil &amp; notifications</h2><p>Connecte-toi d’abord à la synchro (bouton ☁ en bas à droite) : les notifications passent par ton compte.</p><div class="act"><button type="button" id="r-fermer">OK</button></div>`;
      $('r-fermer').onclick = () => fen.close();
    } else dessiner();
    fen.showModal();
  };

  window.commun.texteBriefing = texteBriefing; // pour les tests
})();

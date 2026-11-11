// Synchro PC <-> téléphone via Supabase (table public.donnees, un document JSON par app, protégé par RLS).
// Les données restent aussi en local : sans connexion internet, tout marche, la synchro reprend ensuite.
(function () {
  const URL_SB = 'https://aodlmvxvyjnujrcxfbny.supabase.co';
  const CLE_PUBLIQUE = 'sb_publishable_9hBj8q-g1IXpIqJSpiwsTw_ZTROlW_x'; // clé publique, faite pour être dans l'app
  const SYNCHRO = ['matin', 'repas']; // la météo reste locale

  const { stockage } = window.commun;
  const lireLocal = stockage.lire.bind(stockage);
  const ecrireLocal = stockage.ecrire.bind(stockage);
  if (!window.supabase) return; // bibliothèque absente : mode local seul

  // Sur PC, la session est un fichier partagé par les deux apps (une seule connexion).
  const stockageSession = window.api
    ? {
        getItem: async () => (await window.api.lire('session'))?.v ?? null,
        setItem: (_k, v) => window.api.ecrire('session', { v }),
        removeItem: () => window.api.ecrire('session', { v: null }),
      }
    : undefined;
  const sb = window.supabase.createClient(URL_SB, CLE_PUBLIQUE, {
    auth: { persistSession: true, autoRefreshToken: true, storage: stockageSession, storageKey: 'mesapps-auth' },
  });

  const abonnes = {};
  let utilisateur = null;
  let connexionManuelle = false;
  let etatSync = 'local'; // local | ok | envoi | hors-ligne
  const enAttente = new Set();

  async function envoyer(cle, valeur) {
    if (!utilisateur) return;
    etatSync = 'envoi'; majBouton();
    const { error } = await sb.from('donnees').upsert({ user_id: utilisateur.id, cle, valeur, maj: new Date().toISOString() });
    if (error) { enAttente.add(cle); etatSync = 'hors-ligne'; } else { enAttente.delete(cle); etatSync = 'ok'; }
    majBouton();
  }

  // Prend la version la plus récente (champ _maj) entre local et cloud ; cloudGagne = juste après une connexion.
  async function synchroniser(cle, cloudGagne = false) {
    const local = await lireLocal(cle);
    const { data, error } = await sb.from('donnees').select('valeur').eq('cle', cle).maybeSingle();
    if (error) { etatSync = 'hors-ligne'; majBouton(); return; }
    const distant = data?.valeur;
    if (distant && (cloudGagne || !local || (distant._maj || 0) > (local._maj || 0))) {
      await ecrireLocal(cle, distant);
      abonnes[cle]?.forEach((cb) => cb(distant));
    } else if (local && (!distant || (local._maj || 0) > (distant._maj || 0))) {
      await envoyer(cle, local);
    }
  }

  stockage.ecrire = async (cle, valeur) => {
    if (SYNCHRO.includes(cle)) valeur._maj = Date.now();
    await ecrireLocal(cle, valeur);
    if (SYNCHRO.includes(cle)) envoyer(cle, valeur);
  };
  stockage.surChangement = (cle, cb) => { (abonnes[cle] ||= []).push(cb); };

  let canal = null;
  function ecouter() {
    if (canal) sb.removeChannel(canal);
    canal = sb.channel('donnees-' + Math.random().toString(36).slice(2))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'donnees', filter: `user_id=eq.${utilisateur.id}` }, async (p) => {
        const { cle, valeur } = p.new || {};
        if (!SYNCHRO.includes(cle) || !valeur) return;
        const local = await lireLocal(cle);
        if ((valeur._maj || 0) <= (local?._maj || 0)) return; // c'est notre propre écriture
        await ecrireLocal(cle, valeur);
        abonnes[cle]?.forEach((cb) => cb(valeur));
      })
      .subscribe();
  }

  async function demarrer(cloudGagne) {
    etatSync = 'ok'; majBouton();
    for (const cle of SYNCHRO) await synchroniser(cle, cloudGagne);
    ecouter();
  }

  // ---------- Bouton + fenêtre de connexion ----------
  const style = document.createElement('style');
  style.textContent = `
    #sync-bouton { position: fixed; right: 14px; bottom: 14px; z-index: 50; background: var(--carte); color: var(--doux); border: 1px solid var(--ligne); border-radius: 99px; padding: 6px 12px; font-size: 13px; font-weight: 500; box-shadow: var(--ombre); }
    #sync-bouton.ok { color: var(--vert); }
    #sync-fenetre { width: min(400px, calc(100vw - 32px)); border: 1px solid var(--ligne); border-radius: 16px; background: var(--carte); color: var(--encre); padding: 22px; }
    #sync-fenetre::backdrop { background: rgba(10,10,14,.55); }
    #sync-fenetre label { display: block; font-size: 13px; color: var(--doux); margin: 12px 0 4px; }
    #sync-fenetre input { width: 100%; }
    #sync-fenetre .act { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
    #sync-msg { font-size: 13px; margin-top: 10px; min-height: 1em; }
  `;
  document.head.appendChild(style);
  const bouton = document.createElement('button');
  bouton.id = 'sync-bouton';
  bouton.type = 'button';
  document.body.appendChild(bouton);
  const fen = document.createElement('dialog');
  fen.id = 'sync-fenetre';
  document.body.appendChild(fen);

  function majBouton() {
    const t = { local: '☁ Synchro désactivée', ok: '☁ Synchronisé', envoi: '☁ Envoi…', 'hors-ligne': '☁ Hors ligne' }[utilisateur ? etatSync : 'local'];
    bouton.textContent = t;
    bouton.className = utilisateur && etatSync === 'ok' ? 'ok' : '';
  }

  function ouvrirFenetre() {
    if (utilisateur) {
      fen.innerHTML = `<h2 style="margin:0 0 6px">Synchro</h2><p>Connecté : <b>${window.commun.echapper(utilisateur.email)}</b></p>
        <p class="petit">Tes tâches, rendez-vous, recettes et menus sont les mêmes sur le PC et le téléphone.</p>
        <div class="act"><button type="button" id="sync-fermer">OK</button><button type="button" class="discret" id="sync-deco">Se déconnecter</button></div>`;
      fen.querySelector('#sync-fermer').onclick = () => fen.close();
      fen.querySelector('#sync-deco').onclick = async () => { await sb.auth.signOut(); fen.close(); };
    } else {
      fen.innerHTML = `<h2 style="margin:0 0 6px">Activer la synchro</h2>
        <p class="petit" style="margin:0">Le même compte sur le PC et le téléphone. Juste après la connexion, les données du cloud remplacent celles de cet appareil (s'il y en a).</p>
        <form id="sync-form">
          <label for="sync-email">Email</label><input id="sync-email" type="email" autocomplete="email" required>
          <label for="sync-mdp">Mot de passe</label><input id="sync-mdp" type="password" autocomplete="current-password" minlength="8" required>
          <div class="act"><button>Se connecter</button><button type="button" class="contour" id="sync-creer">Créer mon compte</button><button type="button" class="discret" id="sync-annuler">Annuler</button></div>
          <div id="sync-msg" role="status"></div>
        </form>`;
      const msg = (t, erreur) => { const m = fen.querySelector('#sync-msg'); m.textContent = t; m.style.color = erreur ? 'var(--rouge)' : 'var(--vert)'; };
      const champs = () => ({ email: fen.querySelector('#sync-email').value.trim(), password: fen.querySelector('#sync-mdp').value });
      fen.querySelector('#sync-annuler').onclick = () => fen.close();
      fen.querySelector('#sync-form').onsubmit = async (e) => {
        e.preventDefault();
        msg('Connexion…');
        connexionManuelle = true;
        const { error } = await sb.auth.signInWithPassword(champs());
        if (error) msg(error.message === 'Email not confirmed' ? 'Confirme d’abord ton email (lien reçu par mail), puis reconnecte-toi.' : error.message === 'Invalid login credentials' ? 'Email ou mot de passe incorrect.' : error.message, true);
        else fen.close();
      };
      fen.querySelector('#sync-creer').onclick = async () => {
        if (!fen.querySelector('#sync-form').reportValidity()) return;
        msg('Création…');
        connexionManuelle = true;
        const { data, error } = await sb.auth.signUp(champs());
        if (error) msg(error.message, true);
        else if (!data.session) msg('Compte créé. Clique sur le lien reçu par email, puis reviens ici et clique « Se connecter ».');
        else fen.close();
      };
    }
    fen.showModal();
  }
  bouton.onclick = ouvrirFenetre;

  sb.auth.onAuthStateChange((evenement, session) => {
    const avant = utilisateur;
    utilisateur = session?.user ?? null;
    majBouton();
    // setTimeout : ne pas appeler Supabase à l'intérieur du rappel d'auth (risque de blocage)
    if (utilisateur && !avant) {
      const cloudGagne = connexionManuelle; // connexion faite depuis la fenêtre : le cloud gagne
      connexionManuelle = false;
      setTimeout(() => demarrer(cloudGagne), 0);
    }
    if (!utilisateur && canal) { sb.removeChannel(canal); canal = null; }
  });
  window.addEventListener('online', () => { if (utilisateur) [...enAttente].forEach(async (c) => envoyer(c, await lireLocal(c))); });
  window.addEventListener('focus', () => { if (utilisateur) SYNCHRO.forEach((c) => synchroniser(c)); });
  majBouton();
})();

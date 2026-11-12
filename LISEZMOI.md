# Mes apps

Deux applications de bureau (Electron) :

- **Tableau du matin** : heure, météo de Canet-en-Roussillon (Open-Meteo), planning de travail de la semaine (récurrent), tâches, rendez-vous des 7 prochains jours, repas du jour, raccourcis.
- **Repas & courses** : recettes, menu de la semaine (midi/soir), liste de courses calculée selon le nombre de personnes.

## Lancer

Double-clic sur les raccourcis du bureau « Tableau du matin » et « Repas & courses ».
Sans raccourci : `npm run matin` ou `npm run repas` dans ce dossier.

## Données

Fichiers JSON dans `%APPDATA%\MesApps\donnees\` (`matin.json`, `repas.json`). Sauvegarde ce dossier pour ne rien perdre.

## Tests

`npm test` vérifie le calcul de la liste de courses et des semaines.

## Voix naturelle du briefing (Google Cloud Text-to-Speech)

Fonction Supabase `voix`. Sans clé ou sans connexion, l'app utilise la voix de l'appareil.

1. Google Cloud : créer un projet, activer « Cloud Text-to-Speech API », créer une clé API (Identifiants) limitée à cette API.
2. Supabase : Edge Functions > Secrets, ajouter `GOOGLE_TTS_KEY` = la clé.
3. Déployer : `supabase functions deploy voix`.

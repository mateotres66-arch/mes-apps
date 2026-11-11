const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const APPS = {
  matin: { titre: 'Tableau du matin', largeur: 1180, hauteur: 780 },
  repas: { titre: 'Repas & courses', largeur: 1280, hauteur: 820 },
};
const nom = process.argv.find((a) => APPS[a]) || 'matin';
const conf = APPS[nom];

// Chaque app a son propre profil (et donc sa propre instance unique) ; les données sont partagées.
app.setName(conf.titre);
app.setPath('userData', path.join(app.getPath('appData'), 'MesApps', nom));
const DONNEES = path.join(app.getPath('appData'), 'MesApps', 'donnees');
fs.mkdirSync(DONNEES, { recursive: true });
const fichier = (cle) => {
  if (!/^[a-z]+$/.test(cle)) throw new Error('clé invalide');
  return path.join(DONNEES, cle + '.json');
};

ipcMain.handle('lire', (_e, cle) => {
  try { return JSON.parse(fs.readFileSync(fichier(cle), 'utf8')); } catch { return null; }
});
ipcMain.handle('ecrire', (_e, cle, valeur) => {
  const f = fichier(cle);
  // écriture atomique : un crash pendant l'écriture ne corrompt pas le fichier
  fs.writeFileSync(f + '.tmp', JSON.stringify(valeur, null, 2));
  fs.renameSync(f + '.tmp', f);
  return true;
});
ipcMain.handle('ouvrir', async (_e, cible) => {
  if (typeof cible !== 'string' || !cible) return 'vide';
  if (/^https?:\/\//i.test(cible)) { await shell.openExternal(cible); return 'ok'; }
  if (!fs.existsSync(cible)) return 'introuvable';
  return (await shell.openPath(cible)) || 'ok';
});

if (!app.requestSingleInstanceLock()) app.quit();

// Sauvegarde hebdomadaire dans Documents\MesApps-sauvegardes (le plan gratuit Supabase n'en fait pas).
function sauvegardeHebdo() {
  const dossier = path.join(app.getPath('documents'), 'MesApps-sauvegardes');
  fs.mkdirSync(dossier, { recursive: true });
  const existantes = fs.readdirSync(dossier).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const derniere = existantes.at(-1)?.slice(0, 10);
  const auj = new Date().toISOString().slice(0, 10);
  if (derniere && (new Date(auj) - new Date(derniere)) / 864e5 < 7) return;
  const lire = (cle) => { try { return JSON.parse(fs.readFileSync(fichier(cle), 'utf8')); } catch { return null; } };
  const donnees = { matin: lire('matin'), repas: lire('repas') };
  if (!donnees.matin && !donnees.repas) return;
  fs.writeFileSync(path.join(dossier, auj + '.json'), JSON.stringify({ date: auj, ...donnees }, null, 2));
  existantes.slice(0, Math.max(0, existantes.length + 1 - 12)).forEach((f) => fs.rmSync(path.join(dossier, f))); // garde les 12 dernières
}

let fenetre;
app.whenReady().then(() => {
  if (nom === 'matin') { try { sauvegardeHebdo(); } catch (e) { console.error('sauvegarde', e); } }
  Menu.setApplicationMenu(null);
  fenetre = new BrowserWindow({
    width: conf.largeur,
    height: conf.hauteur,
    minWidth: 760,
    minHeight: 560,
    title: conf.titre,
    icon: path.join(__dirname, 'icones', nom + '.ico'),
    backgroundColor: '#14161b',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (nom === 'matin') fenetre.maximize(); // le tableau du matin s'ouvre toujours en grand
  fenetre.loadFile(path.join(__dirname, 'src', nom + '.html'));
  // liens externes : navigateur, jamais dans l'app
  fenetre.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  fenetre.webContents.on('will-navigate', (e) => e.preventDefault());
});
app.on('second-instance', () => { if (fenetre) { if (fenetre.isMinimized()) fenetre.restore(); fenetre.focus(); } });
app.on('window-all-closed', () => app.quit());

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const http = require('http');

const USER_DATA  = app.getPath('userData');
const ENV_FILE   = path.join(USER_DATA, '.env');
const DATA_FILE  = path.join(USER_DATA, 'atlas_data.json');
const UPLOADS    = path.join(USER_DATA, 'uploads');
const ASSETS_SRC = path.join(process.resourcesPath, 'assets');
const ASSETS_USR = path.join(USER_DATA, 'assets');

[UPLOADS, path.join(UPLOADS,'_thumbs'), ASSETS_USR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const droneTarget = path.join(ASSETS_USR, 'site_drone.png');
const droneSource = path.join(ASSETS_SRC, 'site_drone.png');
if (!fs.existsSync(droneTarget) && fs.existsSync(droneSource)) {
  fs.copyFileSync(droneSource, droneTarget);
}

if (!fs.existsSync(ENV_FILE)) {
  fs.writeFileSync(ENV_FILE, '# Cle API Mammouth\nMAMMOUTH_API_KEY=COLLE-TA-CLE-ICI\n\nPORT=3737\n');
}

process.env.ATLAS_USER_DATA = USER_DATA;
process.env.ATLAS_DATA_FILE = DATA_FILE;
process.env.ATLAS_UPLOADS   = UPLOADS;
process.env.ATLAS_ASSETS    = ASSETS_USR;

require('dotenv').config({ path: ENV_FILE });

const PORT = parseInt(process.env.PORT) || 3737;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: 'Atlas Photographique — Chevalon',
    backgroundColor: '#000000',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
    show: false,
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL('http://localhost:' + PORT);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function saveKeyToEnv(key) {
  let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf-8') : '';
  if (content.includes('MAMMOUTH_API_KEY=')) {
    content = content.replace(/MAMMOUTH_API_KEY=.*/,'MAMMOUTH_API_KEY=' + key);
  } else {
    content += '\nMAMMOUTH_API_KEY=' + key + '\n';
  }
  fs.writeFileSync(ENV_FILE, content);
  process.env.MAMMOUTH_API_KEY = key;
}

function showApiKeyDialog() {
  const keyWin = new BrowserWindow({
    width: 480, height: 340,
    resizable: false, minimizable: false, maximizable: false,
    title: 'Atlas Chevalon — Configuration',
    backgroundColor: '#000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    show: false,
  });

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a0a;color:#fff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;padding:36px}
.box{width:100%;text-align:center}
.lbl{font-size:8px;letter-spacing:.2em;text-transform:uppercase;color:#555;margin-bottom:14px}
h1{font-size:20px;font-weight:700;margin-bottom:10px}
p{font-size:11px;color:#777;line-height:1.7;margin-bottom:22px}
a{color:#4d9fff;text-decoration:none}
input{width:100%;background:#111;border:1px solid #2a2a2a;color:#fff;font-size:13px;padding:11px 13px;outline:none;margin-bottom:10px;font-family:inherit}
input:focus{border-color:#555}
button{width:100%;padding:12px;background:#fff;color:#000;border:none;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;cursor:pointer}
button:hover{background:#ddd}
.err{color:#ff3b30;font-size:9px;margin-top:6px;display:none}
</style></head>
<body><div class="box">
  <div class="lbl">Configuration requise</div>
  <h1>Cle API Mammouth</h1>
  <p>Entre ta cle pour activer la classification IA.<br>
  <a onclick="require('electron').shell.openExternal('https://mammouth.ai/')" href="#">Obtenir une cle sur mammouth.ai</a></p>
  <input type="text" id="k" placeholder="Colle ta cle Mammouth ici...">
  <button id="btn" onclick="save()">Enregistrer et continuer</button>
  <div class="err" id="err">Cle vide — reessaie</div>
</div>
<script>
const { ipcRenderer } = require('electron');
document.getElementById('k').focus();
document.getElementById('k').addEventListener('keydown', function(e){ if(e.key==='Enter') save(); });
function save(){
  var key = document.getElementById('k').value.trim();
  if(!key){ document.getElementById('err').style.display='block'; return; }
  document.getElementById('btn').textContent = 'Enregistrement...';
  document.getElementById('btn').disabled = true;
  document.getElementById('err').style.display = 'none';
  ipcRenderer.send('save-api-key', key);
}
ipcRenderer.on('save-success', function(){ window.close(); });
ipcRenderer.on('save-error', function(){
  document.getElementById('err').style.display='block';
  document.getElementById('btn').textContent='Enregistrer et continuer';
  document.getElementById('btn').disabled=false;
});
</script></body></html>`;

  keyWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  keyWin.once('ready-to-show', () => keyWin.show());
  keyWin.on('closed', () => { if (mainWindow) setTimeout(() => mainWindow.reload(), 500); });
}

function waitForServer(port, retries, cb) {
  http.get('http://localhost:' + port + '/api/stats', () => cb())
    .on('error', () => {
      if (retries <= 0) { cb(new Error('timeout')); return; }
      setTimeout(() => waitForServer(port, retries - 1, cb), 400);
    });
}

const { ipcMain } = require('electron');
ipcMain.on('save-api-key', (event, key) => {
  try {
    saveKeyToEnv(key);
    event.reply('save-success');
  } catch(e) {
    event.reply('save-error');
  }
});

app.whenReady().then(() => {
  try { require('./server.js'); }
  catch(e) { dialog.showErrorBox('Erreur serveur', e.message); app.quit(); return; }

  waitForServer(PORT, 25, (err) => {
    if (err) { dialog.showErrorBox('Timeout', 'Le serveur ne repond pas.'); app.quit(); return; }
    createWindow();
    const apiKey = process.env.MAMMOUTH_API_KEY;
    if (!apiKey || apiKey === 'COLLE-TA-CLE-ICI') {
      setTimeout(() => showApiKeyDialog(), 800);
    }
  });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (mainWindow === null) createWindow(); });

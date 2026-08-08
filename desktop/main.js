const { app, BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

const configPath = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const JARVIS_URL = process.env.JARVIS_URL || config.url;

function createWindow() {
  const win = new BrowserWindow({
    width: 480,
    height: 820,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: '#020409',
    title: 'J.A.R.V.I.S.',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(JARVIS_URL);
}

app.whenReady().then(() => {
  // Zezwalaj automatycznie na kamere/mikrofon/powiadomienia dla wlasnej aplikacji
  // (to Twoje wlasne okno, nie obca strona - nie ma powodu pytac za kazdym razem).
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ['media', 'notifications', 'clipboard-read'];
    callback(allowed.includes(permission));
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

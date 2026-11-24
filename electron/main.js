const { app, BrowserWindow, protocol, net, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

const SMOKE = process.argv.includes('--smoke');
// Automated tests use their own throw-away profile so they never touch your real save.
if (SMOKE) app.setPath('userData', path.join(os.tmpdir(), 'vyt1-smoke'));
const db = require('./db');

protocol.registerSchemesAsPrivileged([
  { scheme: 'vyt', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, backgroundColor: '#000', title: 'VYT 1', icon: path.join(__dirname, '..', 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, backgroundThrottling: false, preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type === 'keyDown' && i.key === 'F11') win.setFullScreen(!win.isFullScreen());
  });
  win.loadURL('vyt://app/index.html' + (SMOKE ? '?auto=' + (process.env.AUTO || '1') + (process.env.NOGRAIN ? '&nograin=1' : '') + (process.env.NOSHADOW ? '&noshadow=1' : '') : ''));
  if (SMOKE) {
    win.webContents.on('console-message', (_e, level, msg) => console.log('[renderer]', level, msg));
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      require('fs').writeFileSync(process.env.SMOKE_OUT || 'smoke.png', img.toPNG());
      app.quit();
    }, +(process.env.SMOKE_MS || 12000));
  }
}

app.whenReady().then(async () => {
  await db.init();
  ipcMain.handle('db:load', () => db.load());
  ipcMain.handle('db:save', (_e, s, note) => db.save(s, note));
  ipcMain.handle('db:recent', (_e, n) => db.recent(n));
  ipcMain.handle('db:reset', () => db.reset());
  ipcMain.handle('db:path', () => db.filePath());

  const root = app.getAppPath();
  protocol.handle('vyt', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const file = p.startsWith('/vendor/three/')
      ? path.join(root, 'node_modules', 'three', p.slice('/vendor/three/'.length))
      : path.join(root, 'src', p);
    if (!path.resolve(file).startsWith(root)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
});
app.on('before-quit', () => db.flush());
app.on('window-all-closed', () => app.quit());

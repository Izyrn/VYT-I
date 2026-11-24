// Renders build/icon.png (512x512) with a hidden Electron window. Run: npx electron tools/make-icon.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 512, height: 512, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body style="margin:0"><canvas id=c width=512 height=512></canvas></body></html>');
  const url = await win.webContents.executeJavaScript(`(() => {
    const c = document.getElementById('c'), g = c.getContext('2d');
    const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
    const bg = g.createLinearGradient(0, 0, 0, 512); bg.addColorStop(0, '#0a1830'); bg.addColorStop(0.55, '#26507e'); bg.addColorStop(1, '#f0a35a');
    rr(0, 0, 512, 512, 96); g.fillStyle = bg; g.fill(); g.save(); rr(0, 0, 512, 512, 96); g.clip();
    g.fillStyle = '#12161c'; g.beginPath(); g.moveTo(256, 250); g.lineTo(640, 512); g.lineTo(-128, 512); g.closePath(); g.fill();
    g.fillStyle = '#f5c518'; for (let i = 0; i < 6; i++) { const t0 = i / 6, t1 = t0 + 0.09, y0 = 250 + t0 * t0 * 262, y1 = 250 + t1 * t1 * 262, w0 = 2 + t0 * t0 * 14, w1 = 2 + t1 * t1 * 14; g.beginPath(); g.moveTo(256 - w0, y0); g.lineTo(256 + w0, y0); g.lineTo(256 + w1, y1); g.lineTo(256 - w1, y1); g.fill(); }
    g.fillStyle = '#1b2638'; for (let i = 0; i < 7; i++) { const h = 60 + (i * 53 % 90); g.fillRect(40 + i * 30, 250 - h, 24, h); g.fillRect(300 + i * 26, 250 - (50 + (i * 37 % 100)), 22, 50 + (i * 37 % 100)); }
    g.restore(); g.fillStyle = '#ffd34d'; g.font = 'bold 150px Arial Black, Arial'; g.textAlign = 'center'; g.shadowColor = '#000a'; g.shadowBlur = 14; g.fillText('VYT', 256, 190); g.font = 'bold 120px Arial Black, Arial'; g.fillText('1', 256, 318);
    return c.toDataURL('image/png');
  })()`);
  fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), Buffer.from(url.split(',')[1], 'base64'));
  app.quit();
});

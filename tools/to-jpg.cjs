// Shrinks screenshots for the website: npx electron tools/to-jpg.cjs
const { app, nativeImage } = require('electron'); const fs = require('fs'); const path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(() => {
  const dir = path.join(__dirname, '..', 'docs', 'img');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.png') || f === 'icon.png') continue;
    const img = nativeImage.createFromPath(path.join(dir, f)).resize({ width: 1280, quality: 'best' });
    fs.writeFileSync(path.join(dir, f.replace('.png', '.jpg')), img.toJPEG(80)); fs.unlinkSync(path.join(dir, f));
  }
  app.quit();
});

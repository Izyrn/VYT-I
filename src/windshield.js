/** Rain drops and wiper blades drawn over the screen in the cockpit view. */
export class Windshield {
  constructor(canvas) { this.c = canvas; this.g = canvas.getContext('2d'); this.drops = []; this.phase = 0; this.prev = 0; this.resize(); }
  resize() { this.c.width = innerWidth; this.c.height = innerHeight; }
  /** mode: 'auto' | 'on' | 'off' */
  update(dt, rain, active, mode) {
    const c = this.c, g = this.g;
    if (!active) { c.style.display = 'none'; return; }
    c.style.display = 'block'; const W = c.width, H = c.height; g.clearRect(0, 0, W, H);
    for (let n = rain * 70 * dt + Math.random(); n >= 1 && this.drops.length < 260; n--) this.drops.push({ x: Math.random() * W, y: Math.random() * H * 0.92, r: 2 + Math.random() * 5, vy: 0 });
    const on = mode === 'on' || (mode === 'auto' && rain > 0.25);
    const pivX = W * 0.5, pivY = H * 1.04, len = H * 1.1;
    if (on || (this.phase % 2) > 0.02) this.phase += dt / 1.3;
    const tri = 1 - Math.abs(1 - (this.phase % 2)), theta = Math.PI * 0.93 - tri * Math.PI * 0.86;       // blade angle (radians from the right)
    const lo = Math.min(theta, this.prev), hi = Math.max(theta, this.prev); this.prev = theta;
    this.drops = this.drops.filter((d) => {
      const dx = d.x - pivX, dy = pivY - d.y, a = Math.atan2(dy, dx), dist = Math.hypot(dx, dy);
      if (dist < len && a >= lo - 0.03 && a <= hi + 0.03) return false;                               // swept away
      if (d.r > 4.2) { d.vy += dt * 40; d.y += d.vy * dt; d.r -= dt * 0.35; }                            // big drops run down the glass
      return d.y < H && d.r > 1.2;
    });
    for (const d of this.drops) {
      const gr = g.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r * 1.4);
      gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(190,210,230,0.22)'); gr.addColorStop(1, 'rgba(20,30,40,0.18)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(d.x, d.y, d.r, d.r * 1.25, 0, 0, 7); g.fill();
    }
    if (on || (this.phase % 2) > 0.02) {
      const ex = pivX + Math.cos(theta) * len, ey = pivY - Math.sin(theta) * len;
      g.lineCap = 'round'; g.strokeStyle = '#0c0c0e'; g.lineWidth = 9; g.beginPath(); g.moveTo(pivX, pivY); g.lineTo(ex, ey); g.stroke();
      g.strokeStyle = '#2a2d33'; g.lineWidth = 3; g.stroke();
    }
  }
}

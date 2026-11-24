import { clamp } from './util.js';

/** Robberies and delivery jobs at the cafés / diners / marts scattered around the map. */
export class Jobs {
  constructor(world, car, save, toast) {
    this.world = world; this.car = car; this.save = save; this.toast = toast;
    this.rob = null;       // { poi, t }
    this.job = null;       // { from, to, dist, left, startDmg }
    this.waypoint = null;  // { x, z } set from the map
    this.clock = 0; this.onCrime = null; this.progress = null; this.events = null; this.who = () => car.s;
  }

  nearPoi() {
    const s = this.who();
    for (const p of this.world.pois) if (Math.hypot(s.x - p.x, s.z - p.z) < 5.5) return p;
    return null;
  }
  cooling(p) { return p.cool > this.clock; }

  startRob() {
    const p = this.nearPoi();
    if (!p || this.rob) return;
    if (this.car.speed > 3) return this.toast('Stop the car first');
    if (this.cooling(p)) return this.toast(`${p.name} was robbed recently - nothing left`);
    this.rob = { poi: p, t: 0 };
    this.toast(`Robbing ${p.name}... stay in the circle`);
  }

  startJob() {
    const p = this.nearPoi();
    if (!p) return;
    if (this.job) return this.toast('You already have a delivery (K cancels it)');
    const far = this.world.pois.filter((q) => q !== p && Math.hypot(q.x - p.x, q.z - p.z) > 700);
    const to = far[(Math.random() * far.length) | 0];
    if (!to) return;
    const dist = Math.hypot(to.x - p.x, to.z - p.z);
    this.job = { from: p, to, dist, left: dist / 13 + 50, startDmg: this.car.damageTotal };
    this.toast(`Delivery: take the order to ${to.name} (${(dist / 1000).toFixed(1)} km)`);
  }
  cancelJob() { if (this.job) { this.job = null; this.toast('Delivery cancelled'); } }

  robInside(poi) {
    if (this.cooling(poi)) return this.toast('The register is empty - ' + poi.name + ' was robbed recently');
    const take = Math.round((350 + Math.random() * 750) * (poi.type === 'mart' ? 1.25 : 1)); this.save.money += take; poi.cool = this.clock + 240;
    this.toast('You emptied the register: +$' + take.toLocaleString() + '. Get out before the police arrive!');
    if (this.progress) { this.progress.award(15, 'robbery'); this.progress.m.stats.robberies++; }
    if (this.onCrime) this.onCrime(2);
  }

  target() {
    const ev = this.events?.target(); if (ev) return ev;
    if (this.job) return { x: this.job.to.x, z: this.job.to.z, color: '#ffd60a', name: this.job.to.name };
    if (this.waypoint) return { x: this.waypoint.x, z: this.waypoint.z, color: '#ff4fd8', name: 'Waypoint' };
    return null;
  }

  update(dt) {
    this.clock += dt;
    const s = this.who(), near = this.nearPoi();
    if (this.rob) {
      const r = this.rob;
      if (near !== r.poi || this.car.speed > 4) { this.toast('Robbery aborted'); this.rob = null; }
      else {
        r.t += dt;
        if (r.t >= 7) {
          const take = Math.round((350 + Math.random() * 750) * (r.poi.type === 'mart' ? 1.25 : 1));
          this.save.money += take; r.poi.cool = this.clock + 240;
          this.toast(`Robbery done: +$${take.toLocaleString()}`); this.rob = null;
          if (this.onCrime) this.onCrime(2);
        }
      }
    }
    if (this.job) {
      const j = this.job; j.left -= dt;
      if (Math.hypot(s.x - j.to.x, s.z - j.to.z) < 6 && this.car.speed < 5 && Math.hypot(this.car.s.x - j.to.x, this.car.s.z - j.to.z) < 45) {
        let pay = Math.round(j.dist * 0.5 + 120);
        if (j.left > 0) pay += Math.min(300, Math.round(j.left * 3)); else pay = Math.round(pay * 0.35);
        const dmg = Math.max(0, this.car.damageTotal - j.startDmg);
        pay = Math.round(pay * (1 - clamp(dmg * 3, 0, 0.7)));
        if (this.progress) { pay = this.progress.pay(pay); this.progress.award(20 + Math.round(j.dist * 0.02), 'delivery'); this.progress.m.stats.deliveries++; } else this.save.money += pay;
        this.toast(`Delivered! +$${pay.toLocaleString()}${j.left <= 0 ? ' (late)' : ''}${dmg > 0.02 ? ' (damaged goods)' : ''}`);
        this.job = null;
      }
    }
    for (const p of this.world.pois) {
      const tgt = this.job && this.job.to === p;
      p.beam.material.opacity = tgt ? 0.45 : 0.1;
    }
  }

  hudLines() {
    const out = [];
    if (this.job) {
      const j = this.job, d = Math.hypot(this.who().x - j.to.x, this.who().z - j.to.z);
      const m = Math.max(0, Math.floor(j.left / 60)), s = Math.max(0, Math.floor(j.left % 60));
      out.push(`DELIVERY → ${j.to.name} · ${(d / 1000).toFixed(2)} km · ${j.left > 0 ? `${m}:${String(s).padStart(2, '0')}` : 'LATE'}`);
    }
    return out;
  }
}

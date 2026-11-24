import * as THREE from 'three';
import { clamp, wrapPi } from './util.js';
import { createHuman } from './human.js';

const fmtT = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

/** Street races, drift challenge and taxi fares. Uses the car (not on foot). */
export class Events {
  constructor(scene, world, car, progress, hooks) {
    this.scene = scene; this.world = world; this.car = car; this.progress = progress; this.hooks = hooks; // { toast, persist }
    this.active = null; this.cool = 0;
    this.marker = new THREE.Group();
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(10, 12.5, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })));
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 110, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }));
    beam.position.y = 55; this.marker.add(beam); this.marker.children[0].position.y = 0.2; this.marker.visible = false; scene.add(this.marker);
    this.fare = null;
    this.races = this.buildRaces();
  }

  buildRaces() {
    const W = this.world, mk = (id, name, a, b, kmh, reward, tier) => {
      const pts = W.route(a[0], a[1], b[0], b[1]), cps = []; let last = pts[0];
      for (let i = 1; i < pts.length; i++) if (Math.hypot(pts[i].x - last.x, pts[i].z - last.z) > 90 || i === pts.length - 1) { cps.push({ x: pts[i].x, z: pts[i].z }); last = pts[i]; }
      let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
      return { id, name, tier, start: { x: pts[0].x, z: pts[0].z }, cps, len, par: Math.round(len / (kmh / 3.6)), reward };
    };
    return [
      mk('downtown', 'Downtown Sprint', [-420, 0], [420, -360], 62, 900, 'Easy'),
      mk('highway', 'Highway Run', [300, 4.6], [2150, 4.6], 150, 1800, 'Medium'),
      mk('mountain', 'Mountain Pass', [4.6, -700], [4.6, -3100], 125, 2400, 'Hard'),
      mk('airport', 'Airport Dash', [-500, 4.6], [-2500, 1380], 140, 2600, 'Hard'),
    ];
  }
  drift() { return { cx: -2500, cz: 1500, hx: 430, hz: 24 }; }

  start(kind, id) {
    if (this.active) return this.hooks.toast('Finish or cancel your current event first (phone > Events)');
    if (kind === 'race') { const r = this.races.find((x) => x.id === id); this.active = { kind, race: r, phase: 'goto', cp: 0, t: 0, count: 3.5 }; this.hooks.toast('Drive to the start line - ' + r.name); }
    else if (kind === 'drift') { this.active = { kind, phase: 'goto', score: 0, combo: 1, idle: 0, t: 60, count: 3.5 }; this.hooks.toast('Drive to the airport runway for the drift challenge'); }
    else if (kind === 'taxi') { this.active = { kind, phase: 'search', fares: 0, earned: 0, t: 1.5 }; this.hooks.toast('Taxi mode on - fares will appear on your GPS'); }
  }
  cancel() { if (this.active) { this.clearFare(); this.active = null; this.marker.visible = false; this.hooks.toast('Event cancelled'); } }
  clearFare() { if (this.fare?.human) this.scene.remove(this.fare.human.group); this.fare = null; }

  target() {
    const a = this.active; if (!a) return null;
    if (a.kind === 'race') return a.phase === 'goto' || a.phase === 'count' ? { x: a.race.start.x, z: a.race.start.z, color: '#35d07f', name: a.race.name + ' - start' } : a.phase === 'run' ? { x: a.race.cps[a.cp].x, z: a.race.cps[a.cp].z, color: '#ff4fd8', name: 'Checkpoint ' + (a.cp + 1) } : null;
    if (a.kind === 'drift' && a.phase === 'goto') { const z = this.drift(); return { x: z.cx, z: z.cz, color: '#35d07f', name: 'Drift zone' }; }
    if (a.kind === 'taxi' && this.fare) return this.fare.phase === 'pickup' ? { x: this.fare.x, z: this.fare.z, color: '#ffd60a', name: 'Passenger' } : { x: this.fare.dx, z: this.fare.dz, color: '#ffd60a', name: 'Drop-off' };
    return null;
  }
  hudLines() {
    const a = this.active; if (!a) return [];
    if (a.kind === 'race') return [a.phase === 'run' ? 'RACE ' + a.race.name + ' - CP ' + (a.cp + 1) + '/' + a.race.cps.length + ' - ' + fmtT(a.t) + ' / par ' + fmtT(a.race.par) : a.phase === 'count' ? 'RACE starts in ' + Math.max(0, Math.ceil(a.count)) : 'RACE: drive to the start line'];
    if (a.kind === 'drift') return [a.phase === 'run' ? 'DRIFT ' + Math.round(a.score) + ' pts  x' + a.combo.toFixed(1) + '  ' + Math.ceil(a.t) + ' s' + (a.out ? ' (back on the runway!)' : '') : a.phase === 'count' ? 'DRIFT starts in ' + Math.max(0, Math.ceil(a.count)) : 'DRIFT: go to the airport runway'];
    if (a.kind === 'taxi') return [this.fare ? 'TAXI ' + (this.fare.phase === 'pickup' ? 'pick up the passenger' : 'drop-off - rating ' + this.fare.rating.toFixed(1) + ' *') : 'TAXI: waiting for a fare... (' + a.fares + ' done, $' + a.earned + ')'];
    return [];
  }

  update(dt) {
    this.cool = Math.max(0, this.cool - dt);
    const a = this.active, c = this.car, s = c.s; if (!a) { this.marker.visible = false; return; }
    const tg = this.target();
    if (tg && (a.kind !== 'drift' || a.phase === 'goto')) { this.marker.visible = true; this.marker.position.set(tg.x, this.world.heightAt(tg.x, tg.z, 3), tg.z); this.marker.children[0].material.color.set(tg.color); this.marker.children[1].material.color.set(tg.color); } else this.marker.visible = false;

    if (a.kind === 'race') {
      const r = a.race;
      if (a.phase === 'goto') { if (Math.hypot(s.x - r.start.x, s.z - r.start.z) < 14) a.phase = 'count'; }
      else if (a.phase === 'count') {
        const before = Math.ceil(a.count); a.count -= dt; const now = Math.ceil(a.count);
        if (now !== before && now >= 0) this.hooks.toast(now > 0 ? String(now) : 'GO!');
        if (a.count <= 0) { a.phase = 'run'; a.t = 0; a.cp = 0; }
      } else if (a.phase === 'run') {
        a.t += dt;
        const cp = r.cps[a.cp];
        if (Math.hypot(s.x - cp.x, s.z - cp.z) < (a.cp === r.cps.length - 1 ? 12 : 16)) {
          a.cp++;
          if (a.cp >= r.cps.length) { this.finishRace(a); return; }
          this.hooks.toast('Checkpoint ' + a.cp + '/' + r.cps.length);
        }
        if (a.t > r.par * 1.8) { this.hooks.toast('Too slow - race failed'); this.active = null; this.marker.visible = false; }
      }
    } else if (a.kind === 'drift') {
      const z = this.drift(), inZone = Math.abs(s.x - z.cx) < z.hx && Math.abs(s.z - z.cz) < z.hz;
      if (a.phase === 'goto') { if (inZone) a.phase = 'count'; }
      else if (a.phase === 'count') { const b = Math.ceil(a.count); a.count -= dt; const n = Math.ceil(a.count); if (n !== b && n >= 0) this.hooks.toast(n > 0 ? String(n) : 'DRIFT!'); if (a.count <= 0) a.phase = 'run'; }
      else if (a.phase === 'run') {
        a.t -= dt; a.out = !inZone;
        const sp = c.speed, ang = Math.abs(wrapPi(Math.atan2(s.vx, s.vz) - s.yaw));
        if (inZone && sp > 7 && ang > 0.2 && ang < 1.4 && c.t.grounded > 0.5) { a.combo = Math.min(6, a.combo + dt * 0.45); a.idle = 0; a.score += ang * sp * a.combo * dt * 8; }
        else { a.idle += dt; if (a.idle > 1.2) a.combo = 1; }
        if (a.t <= 0) this.finishDrift(a);
      }
    } else if (a.kind === 'taxi') this.updateTaxi(dt, a);
  }

  finishRace(a) {
    const r = a.race, t = a.t; let tier = 0, label = 'Finished';
    if (t <= r.par * 0.9) { tier = 1.5; label = 'GOLD'; } else if (t <= r.par) { tier = 1; label = 'SILVER'; } else if (t <= r.par * 1.25) { tier = 0.5; label = 'BRONZE'; }
    this.active = null; this.marker.visible = false; this.hooks.persist();
    if (tier) { const paid = this.progress.pay(r.reward * tier); this.progress.award(tier === 1.5 ? 100 : tier === 1 ? 60 : 30, 'race'); this.progress.m.stats.races++; this.hooks.toast(label + '! ' + fmtT(t) + ' - prize $' + paid.toLocaleString()); }
    else this.hooks.toast('Race over: ' + fmtT(t) + ' (par ' + fmtT(r.par) + ') - no prize');
  }
  finishDrift(a) {
    const sc = a.score; this.active = null; this.marker.visible = false;
    const tier = sc >= 9000 ? ['GOLD', 3200, 150] : sc >= 4000 ? ['SILVER', 1400, 70] : sc >= 1500 ? ['BRONZE', 500, 30] : null;
    if (tier) { const paid = this.progress.pay(tier[1]); this.progress.award(tier[2], 'drift'); this.progress.m.stats.drifts++; this.hooks.toast(tier[0] + ' drift! ' + Math.round(sc) + ' pts - $' + paid.toLocaleString()); }
    else this.hooks.toast('Drift score ' + Math.round(sc) + ' - not enough for a medal (1500 needed)');
    this.hooks.persist();
  }

  /* ---------- taxi ---------- */
  randomRoadPoint(minD, maxD) {
    const s = this.car.s, roads = this.world.roads;
    for (let i = 0; i < 40; i++) {
      const r = roads[(Math.random() * roads.length) | 0], a = r.a0 + 30 + Math.random() * (r.a1 - r.a0 - 60), lat = (Math.random() < 0.5 ? -1 : 1) * (r.w / 2 + 1.6);
      const x = r.axis === 'x' ? a : r.c + lat, z = r.axis === 'x' ? r.c + lat : a, d = Math.hypot(x - s.x, z - s.z);
      if (d > minD && d < maxD && Math.abs(x) < 3800 && Math.abs(z) < 3800) return { x, z };
    }
    return null;
  }
  updateTaxi(dt, a) {
    const c = this.car, s = c.s;
    if (!this.fare) {
      a.t -= dt; if (a.t > 0) return;
      const p = this.randomRoadPoint(250, 700); if (!p) { a.t = 3; return; }
      const human = createHuman({ hairStyle: Math.random() < 0.5 ? 'long' : 'short' }); human.group.position.set(p.x, 0.1, p.z); this.scene.add(human.group);
      this.fare = { phase: 'pickup', x: p.x, z: p.z, human, wait: 0, rating: 5, hard: 0, prevSpeed: 0, dmg0: 0, dist: 0 };
      this.hooks.toast('New fare! Pick up the passenger at the marker.');
      return;
    }
    const f = this.fare; if (f.human) f.human.pose(performance.now() / 600, 0, 'idle');
    if (f.phase === 'pickup') {
      if (Math.hypot(s.x - f.x, s.z - f.z) < 10 && c.speed < 3) f.wait += dt; else f.wait = 0;
      if (f.wait > 1.2) {
        this.scene.remove(f.human.group); f.human = null;
        const d = this.randomRoadPoint(900, 2600) || { x: s.x + 900, z: s.z }; f.dx = d.x; f.dz = d.z; f.phase = 'ride'; f.dmg0 = c.damageTotal; f.prevSpeed = c.speed;
        f.dist = Math.hypot(d.x - s.x, d.z - s.z); this.hooks.toast('Passenger on board - drive to the drop-off. Smooth driving earns tips.');
      }
    } else {
      const dec = (f.prevSpeed - c.speed) / Math.max(dt, 0.001); if (dec > 11 && f.hard < 4) { f.hard++; f.rating -= 0.4; } f.prevSpeed = c.speed;
      f.rating = Math.max(1, Math.min(5, f.rating - (c.damageTotal - f.dmg0) * 6)); f.dmg0 = c.damageTotal;
      if (Math.hypot(s.x - f.dx, s.z - f.dz) < 12 && c.speed < 3) {
        const base = 25 + f.dist * 0.06, tip = f.rating > 3 ? base * 0.12 * (f.rating - 3) : 0, paid = this.progress.pay(base + tip);
        this.progress.award(35, 'taxi'); this.progress.m.stats.taxi++; a.fares++; a.earned += paid;
        this.hooks.toast('Fare complete: $' + paid.toLocaleString() + ' (rating ' + f.rating.toFixed(1) + ')'); this.fare = null; a.t = 4; this.hooks.persist();
      }
    }
  }
}

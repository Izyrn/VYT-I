import * as THREE from 'three';
import { clamp, wrapPi } from './util.js';

const box = new THREE.BoxGeometry(1, 1, 1);

function truckMesh() {
  const g = new THREE.Group();
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2b705, roughness: 0.45, metalness: 0.3 }), dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c141c, roughness: 0.05, metalness: 0.7 });
  const mk = (m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(box, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; g.add(o); return o; };
  mk(yellow, 0, 1.1, 1.5, 2.1, 1.0, 2.0);                 // cab
  mk(glass, 0, 1.75, 1.75, 1.9, 0.7, 1.2);
  mk(dark, 0, 0.75, -1.1, 2.2, 0.25, 4.0);                // flatbed
  mk(yellow, 0, 1.0, -1.1, 2.0, 0.12, 3.7);
  mk(dark, 0, 0.55, 2.55, 2.1, 0.28, 0.3);                // bumper
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14).rotateZ(Math.PI / 2), wm = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  for (const [x, z] of [[1, 1.6], [-1, 1.6], [1, -1.9], [-1, -1.9]]) { const w = new THREE.Mesh(wg, wm); w.position.set(x * 1.05, 0.42, z); g.add(w); }
  const bar = (c, x) => { const m = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0 })); m.scale.set(0.5, 0.18, 0.35); m.position.set(x, 2.25, 1.5); g.add(m); return m; };
  const l1 = bar(0xffa000, -0.4), l2 = bar(0xffa000, 0.4);
  g.userData = { l1, l2, load: null };
  return g;
}

/**
 * Roadside assistance: a mechanic van repairs your car, a fuel truck brings petrol, and a tow truck
 * takes the car to the dealership or home. Call it from the menu (Y).
 */
export class Assist {
  constructor(scene, world, car, save, hooks) {
    this.scene = scene; this.world = world; this.car = car; this.save = save; this.hooks = hooks; // { toast, persist, towTo(kind) }
    this.job = null; this.cool = 0; this.clock = 0;
  }
  get busy() { return !!this.job; }

  quote(kind) {
    const d = Math.hypot(this.car.s.x - this.world.dealership.x, this.car.s.z - this.world.dealership.z);
    if (kind === 'repair') { const dmg = this.car.damageTotal * Math.max(800, this.car.def.price * 0.25); return Math.round(150 + dmg * 1.4); }
    if (kind === 'fuel') return Math.round(75 + Math.min(15, this.car.def.tank - this.car.fuel) * 2.9);
    return Math.round(250 + d * 0.06);       // tow
  }

  request(kind, dest) {
    if (this.world.garageActive) return this.hooks.toast('Roadside assistance cannot reach you underground - drive out first');
    if (this.job) return this.hooks.toast('A service vehicle is already on its way');
    if (this.cool > 0) return this.hooks.toast(`Dispatch is busy - try again in ${Math.ceil(this.cool)} s`);
    const cost = this.quote(kind);
    if (this.save.money < cost) return this.hooks.toast('Not enough money for that service');
    this.job = { kind, dest, cost, truck: null, state: 'dispatch', t: 3, work: 0, path: [], pi: 1, pathT: 0 };
    this.hooks.toast('Dispatch: help is on the way. Stay near your car.');
  }
  cancel() { if (this.job) { if (this.job.truck) this.scene.remove(this.job.truck); this.job = null; this.hooks.toast('Service cancelled'); } }

  spawnTruck(j) {
    const p = this.car.s, cand = this.world.roads.filter((r) => Math.abs((r.axis === 'x' ? p.z : p.x) - r.c) < 300);
    const r = cand.length ? cand[(Math.random() * cand.length) | 0] : this.world.roads[0];
    const a = r.axis === 'x' ? p.x : p.z, s = clamp(a + (Math.random() < 0.5 ? -1 : 1) * (170 + Math.random() * 120), r.a0 + 5, r.a1 - 5);
    const x = r.axis === 'x' ? s : r.c, z = r.axis === 'x' ? r.c : s;
    const g = truckMesh(); g.position.set(x, 0.02, z); this.scene.add(g);
    j.truck = g; j.x = x; j.z = z; j.yaw = r.axis === 'x' ? Math.PI / 2 : 0; j.v = 0;
  }

  update(dt) {
    this.clock += dt; this.cool = Math.max(0, this.cool - dt);
    const j = this.job; if (!j) return;
    const P = this.car.s;
    if (j.state === 'dispatch') { j.t -= dt; if (j.t <= 0) { this.spawnTruck(j); j.state = 'drive'; } return; }
    const g = j.truck, dist = Math.hypot(P.x - j.x, P.z - j.z);
    g.userData.l1.material.emissiveIntensity = g.userData.l2.material.emissiveIntensity = Math.floor(this.clock * 6) % 2 ? 4 : 0;
    if (j.state === 'drive') {
      j.pathT -= dt;
      if (j.pathT <= 0) { j.pathT = 1.5; j.path = dist > 40 ? this.world.route(j.x, j.z, P.x, P.z) : []; j.pi = 1; }
      let tx = P.x + Math.cos(P.yaw) * 4.2, tz = P.z - Math.sin(P.yaw) * 4.2;
      if (j.path.length > 1) {
        while (j.pi < j.path.length - 1 && Math.hypot(j.path[j.pi].x - j.x, j.path[j.pi].z - j.z) < 12) j.pi++;
        if (dist > 40) { tx = j.path[j.pi].x; tz = j.path[j.pi].z; }
      }
      const diff = wrapPi(Math.atan2(tx - j.x, tz - j.z) - j.yaw);
      j.yaw += clamp(diff, -1.8 * dt, 1.8 * dt);
      let target = 22; if (Math.abs(diff) > 0.6) target = 8; if (dist < 30) target = Math.max(2, dist * 0.35);
      j.v += clamp(target - j.v, -16 * dt, 8 * dt);
      const fx = Math.sin(j.yaw), fz = Math.cos(j.yaw);
      j.x += fx * j.v * dt; j.z += fz * j.v * dt;
      if (this.world.queryColliders(j.x + fx * 3, j.z + fz * 3, 1.2, 0.5).length) { j.v = 0; j.yaw += 0.8 * dt; }
      if (dist < 7.5 && this.car.speed < 3) { j.state = 'work'; j.work = 0; j.v = 0; this.hooks.toast(j.kind === 'tow' ? 'The tow truck has arrived - loading your car...' : 'Help has arrived!'); }
      else if (dist < 7.5 && this.car.speed >= 3) j.v = 0;
    } else if (j.state === 'work') {
      j.work += dt;
      if (j.work >= (j.kind === 'tow' ? 4 : 7)) this.finish(j);
    } else if (j.state === 'leave') {
      j.t -= dt; j.v = Math.min(18, j.v + 8 * dt); j.x += Math.sin(j.yaw) * j.v * dt; j.z += Math.cos(j.yaw) * j.v * dt;
      if (j.t <= 0 || dist > 500) { this.scene.remove(g); this.job = null; return; }
    }
    g.position.set(j.x, this.world.heightAt(j.x, j.z, 3) + 0.02, j.z); g.rotation.y = j.yaw;
  }

  progress() { const j = this.job; return j && j.state === 'work' ? j.work / (j.kind === 'tow' ? 4 : 7) : null; }
  status() {
    const j = this.job; if (!j) return null;
    if (j.state === 'dispatch') return 'Dispatch is sending a vehicle...';
    if (j.state === 'drive') return `${j.kind === 'tow' ? 'Tow truck' : j.kind === 'fuel' ? 'Fuel truck' : 'Mechanic'} arriving - ${Math.round(Math.hypot(this.car.s.x - j.x, this.car.s.z - j.z))} m away`;
    if (j.state === 'work') return j.kind === 'tow' ? 'Loading your car...' : j.kind === 'fuel' ? 'Refuelling...' : 'Mechanic at work...';
    return null;
  }

  finish(j) {
    const sv = this.save, car = this.car;
    sv.money = Math.max(0, sv.money - j.cost);
    if (j.kind === 'repair') { car.repair(); this.hooks.toast(`Your car has been repaired (-$${j.cost.toLocaleString()})`); }
    else if (j.kind === 'fuel') { car.fuel = Math.min(car.def.tank, car.fuel + 15); this.hooks.toast(`Fuel delivered: +15 L (-$${j.cost.toLocaleString()})`); }
    else { this.hooks.towTo(j.dest); this.hooks.toast(`Your car was towed (-$${j.cost.toLocaleString()})`); }
    this.hooks.persist();
    j.state = 'leave'; j.t = 18; this.cool = 45;
  }
}

import * as THREE from 'three';
import { clamp, wrapPi } from './util.js';
import { trafficMesh } from './traffic.js';

/** Wanted level + police cars that follow the road network (GPS route) and try to box you in. */
export class Police {
  constructor(scene, world, car, hooks) {
    this.scene = scene; this.world = world; this.car = car; this.hooks = hooks; // hooks: { toast, busted }
    this.wanted = 0; this.cars = []; this.calm = 0; this.bust = 0; this.spawnT = 2; this.clock = 0; this.nearest = 1e9;
  }

  addWanted(n) {
    const w = Math.min(3, this.wanted + n);
    if (w > this.wanted) this.hooks.toast(`WANTED ${'★'.repeat(w)} - police are coming!`);
    this.wanted = w; this.calm = 0;
  }
  clear() {
    this.wanted = 0; this.bust = 0;
    for (const c of this.cars) this.scene.remove(c.mesh);
    this.cars.length = 0;
  }

  makeCar(x, z, yaw) {
    const mesh = trafficMesh(0xf4f4f4);
    const bar = (col, px) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.35), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0 }));
      m.position.set(px, 1.55, -0.2); mesh.add(m); return m;
    };
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.22, 4.0), new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.5 }));
    stripe.position.y = 0.62; mesh.add(stripe);
    this.scene.add(mesh);
    return { mesh, red: bar(0xff2020, -0.3), blue: bar(0x2060ff, 0.3), x, z, yaw, v: 0, path: [], pi: 1, pathT: 0, rev: 0 };
  }

  spawn() {
    const p = this.car.s, cand = this.world.roads.filter((r) => Math.abs((r.axis === 'x' ? p.z : p.x) - r.c) < 300);
    if (!cand.length) return;
    const r = cand[(Math.random() * cand.length) | 0], a = r.axis === 'x' ? p.x : p.z;
    const s = clamp(a + (Math.random() < 0.5 ? -1 : 1) * (220 + Math.random() * 120), r.a0 + 5, r.a1 - 5);
    const x = r.axis === 'x' ? s : r.c, z = r.axis === 'x' ? r.c : s;
    if (Math.hypot(x - p.x, z - p.z) < 160) return;
    this.cars.push(this.makeCar(x, z, r.axis === 'x' ? Math.PI / 2 : 0));
  }

  update(dt) {
    this.clock += dt;
    const P = this.who ? this.who() : this.car.s; const C = this.car.s;
    if (this.wanted > 0) {
      this.spawnT -= dt;
      if (this.cars.length < this.wanted && this.spawnT <= 0) { this.spawnT = 5; this.spawn(); }
    }
    this.nearest = 1e9;
    for (const c of this.cars) {
      const dx = P.x - c.x, dz = P.z - c.z, dist = Math.hypot(dx, dz);
      this.nearest = Math.min(this.nearest, dist);
      c.pathT -= dt;
      if (c.pathT <= 0) { c.pathT = 1.5; c.path = dist > 90 ? this.world.route(c.x, c.z, P.x, P.z) : []; c.pi = 1; }
      let tx = P.x, tz = P.z;
      if (c.path.length > 1) {
        while (c.pi < c.path.length - 1 && Math.hypot(c.path[c.pi].x - c.x, c.path[c.pi].z - c.z) < 14) c.pi++;
        tx = c.path[c.pi].x; tz = c.path[c.pi].z;
      }
      const diff = wrapPi(Math.atan2(tx - c.x, tz - c.z) - c.yaw);
      if (c.rev > 0) { c.rev -= dt; c.v = -4; c.yaw += 0.9 * dt; }
      else {
        c.yaw += clamp(diff, -2.1 * dt, 2.1 * dt);
        let target = 26 + 5 * this.wanted;
        if (Math.abs(diff) > 0.6) target = 9;
        if (dist < 30) target = Math.max(8, this.car.speed + 6);
        c.v += clamp(target - c.v, -22 * dt, 11 * dt);
      }
      const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      c.x += fx * c.v * dt; c.z += fz * c.v * dt;
      if (this.world.queryColliders(c.x + fx * 2.4, c.z + fz * 2.4, 1.1, 0.5).length) { c.rev = 0.7; c.v *= 0.2; c.pathT = 0; }
      // contact with the player
      const pf = [Math.sin(C.yaw), Math.cos(C.yaw)], half = this.car.def.len / 2 - 0.8;
      for (const po of [-half, 0, half]) for (const co of [-1.4, 0, 1.4]) {
        const ax = C.x + pf[0] * po, az = C.z + pf[1] * po, bx = c.x + fx * co, bz = c.z + fz * co;
        const ddx = ax - bx, ddz = az - bz, d = Math.hypot(ddx, ddz), R = this.car.def.W / 2 + 0.95;
        if (d < R && d > 1e-3) {
          const nx = ddx / d, nz = ddz / d;
          this.car.hit(nx, nz, R - d, bx + nx * 0.95, bz + nz * 0.95, 0.3, fx * c.v * 0.7, fz * c.v * 0.7);
          c.v *= 0.4;
        }
      }
      c.mesh.position.set(c.x, this.world.heightAt(c.x, c.z, 3) + 0.02, c.z); c.mesh.rotation.y = c.yaw;
      const f = Math.floor(this.clock * 8) % 2;
      c.red.material.emissiveIntensity = f ? 5 : 0; c.blue.material.emissiveIntensity = f ? 0 : 5;
    }
    // busted / escape logic
    if (this.wanted > 0) {
      if (this.nearest < 7 && this.car.speed < 6) this.bust += dt; else this.bust = Math.max(0, this.bust - dt * 0.6);
      if (this.bust > 2.5) { this.bust = 0; this.hooks.busted(); return; }
      if (this.nearest > 160) this.calm += dt; else this.calm = 0;
      if (this.calm > 25) {
        this.calm = 0; this.wanted--;
        this.hooks.toast(this.wanted ? `Wanted level dropped (${'★'.repeat(this.wanted)})` : 'You lost the police!');
        if (!this.wanted) this.clear();
      }
    }
  }
  get stars() { return '★'.repeat(this.wanted) + '☆'.repeat(3 - this.wanted); }
}

import * as THREE from 'three';
import { instancedParked, checkPark, instanced, BAY_W, BAY_L, PARKED_COLORS, parkSignTexture } from './parking.js';

const ORIGIN_X = 14000, W = 64, D = 34, H = 3.2;
const box = new THREE.BoxGeometry(1, 1, 1), flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function label(text, w, h, bg, fg) {
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * h / w); const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.fillStyle = fg; g.font = 'bold ' + Math.round(c.height * 0.55) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 + 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
}

/**
 * Underground car park under every tower: drive down the ramp, park in a bay, drive out through the EXIT.
 * The garage lives far outside the map; the car physics use world.garageActive to find the floor and the walls.
 */
export class Garage {
  constructor(scene, world, env, hooks) {
    this.scene = scene; this.world = world; this.env = env; this.h = hooks; // { car, keep(), fade(fn), toast }
    this.group = new THREE.Group(); this.group.position.set(ORIGIN_X, 0, 0); this.group.visible = false; scene.add(this.group);
    this.room = new THREE.Group(); this.group.add(this.room);
    this.active = false; this.colliders = []; this.bays = []; this.hidden = []; this.clock = 0; this.still = 0; this.b = null;
    const conc = canvasConcrete();
    this.M = {
      floor: new THREE.MeshStandardMaterial({ map: conc, roughness: 0.85 }), wall: new THREE.MeshStandardMaterial({ color: 0x9a9a96, roughness: 0.95 }),
      ceil: new THREE.MeshStandardMaterial({ color: 0x777773, roughness: 0.95 }), panel: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.9 }),
      line: new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xe8c020, roughness: 0.6 }), pillar: new THREE.MeshStandardMaterial({ color: 0x8c8c88, roughness: 0.9 }),
      day: new THREE.MeshBasicMaterial({ color: 0xfff6d8 }),
    };
  }

  B(x, y0, z, w, h, d, mat, col = true) {
    const m = new THREE.Mesh(box, mat); m.scale.set(w, h, d); m.position.set(x, y0 + h / 2, z); m.castShadow = true; m.receiveShadow = true; this.room.add(m);
    if (col) this.colliders.push({ minX: ORIGIN_X + x - w / 2, maxX: ORIGIN_X + x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, yMin: 0, yMax: h + y0, q: 0 });
    return m;
  }
  clear() { while (this.room.children.length) this.room.remove(this.room.children[0]); this.colliders = []; this.bays = []; }

  build(b) {
    this.clear(); const M = this.M, W2 = W / 2, D2 = D / 2, rng = this.world.rng;
    // shell
    this.B(0, -0.1, 0, W + 1, 0.1, D + 1, M.floor, false); this.B(0, H, 0, W + 1, 0.3, D + 1, M.ceil, false);
    this.B(0, 0, -D2 - 0.2, W + 1, H, 0.4, M.wall); this.B(0, 0, D2 + 0.2, W + 1, H, 0.4, M.wall); this.B(-W2 - 0.2, 0, 0, 0.4, H, D + 1, M.wall);
    this.B(W2 + 0.2, 0, -D2 / 2 - 2.3, 0.4, H, D2 - 4.6 + 0.01, M.wall); this.B(W2 + 0.2, 0, D2 / 2 + 2.3, 0.4, H, D2 - 4.6 + 0.01, M.wall);   // exit gap |z| < 4.6
    this.B(W2 + 0.2, 2.6, 0, 0.4, H - 2.6, 9.2, M.wall, false);
    this.B(W2 + 0.55, 0, 0, 0.1, 2.6, 8.8, M.day, false);                       // daylight outside the exit
    const ex = label('EXIT', 6, 1.2, '#14803a', '#ffffff'); ex.rotation.y = -Math.PI / 2; ex.position.set(W2 - 0.1, 2.9, 0); this.room.add(ex);
    const nm = label(b.name + '  -  P1', 10, 1.4, '#1b2a40', '#ffd34d'); nm.rotation.y = Math.PI / 2; nm.position.set(-W2 + 0.05, 2.5, 0); this.room.add(nm);
    // bays: four rows, each pair back to back, with wheel stops, lines and parked cars
    const rows = [-14.4, -2.6, 2.6, 14.4], n = Math.floor(52 / BAY_W), lines = [], stops = [], items = [];
    for (const z of rows) for (let i = 0; i < n; i++) {
      const x = -W2 + 1.35 + i * BAY_W + BAY_W / 2 - 0.5;
      lines.push({ x: x - BAY_W / 2, z, sx: 0.1, sz: BAY_L });
      const far = Math.abs(z) > 10 ? Math.sign(z) : -Math.sign(z);
      stops.push({ x, z: z + far * (BAY_L / 2 - 0.5), sx: 1.4, sz: 0.18 });
      const bay = { x: ORIGIN_X + x, z, yaw: 0, axis: 'x', occupied: false, cool: 0 }; this.bays.push(bay);
      if (rng() < 0.5) { bay.occupied = true; items.push({ x, z, yaw: rng() < 0.5 ? 0 : Math.PI, k: (rng() * 4) | 0, color: PARKED_COLORS[(rng() * 8) | 0] }); }
    }
    instanced(this.room, flat, M.line, lines, (o, p) => { o.position.set(p.x, 0.02, p.z); o.scale.set(p.sx, 1, p.sz); o.rotation.set(0, 0, 0); });
    instanced(this.room, box, M.yellow, stops, (o, p) => { o.position.set(p.x, 0.07, p.z); o.scale.set(p.sx, 0.12, p.sz); o.rotation.set(0, 0, 0); });
    instancedParked(this.room, items, (a, bb, c, d, y0, y1) => this.colliders.push({ minX: ORIGIN_X + a, maxX: ORIGIN_X + bb, minZ: c, maxZ: d, yMin: y0, yMax: y1, q: 0 }), 0);
    // pillars down the middle, ceiling lights, direction arrows
    for (let x = -W2 + 4; x <= W2 - 6; x += 8) { this.B(x, 0, 0, 0.8, H, 0.8, M.pillar); this.B(x, 0, 0.0, 0.84, 0.5, 0.84, M.yellow, false); }
    for (let x = -W2 + 4; x <= W2 - 4; x += 8) for (const z of [-8.5, 8.5]) this.B(x, H - 0.1, z, 2.8, 0.1, 0.5, M.panel, false);
    for (const z of [-8.5, 8.5]) for (const x of [-20, 0, 20]) { const a = label(z < 0 ? '→' : '←', 1.6, 1.0, '#00000000', '#e8e8e8'); a.rotation.x = -Math.PI / 2; a.position.set(x, 0.03, z); a.material.transparent = true; this.room.add(a); }
    const ps = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: parkSignTexture() })); ps.rotation.y = Math.PI / 2; ps.position.set(-W2 + 0.1, 1.6, 8); this.room.add(ps);
    // pool lights
    const ex2 = this.world.extras; ex2.override = true;
    const pts = [[-22, -8.5], [0, -8.5], [22, -8.5], [-22, 8.5], [0, 8.5], [22, 8.5]];
    ex2.lights.forEach((l, i) => { const p = pts[i]; l.position.set(ORIGIN_X + p[0], H - 0.5, p[1]); l.userData.fixed = 85; });
    this.b = b;
  }

  enter(b) {
    if (this.active || this.pending) return;
    this.pending = true;
    this.h.fade(() => {
      this.pending = false; this.b = b; this.build(b); this.active = true; this.world.garageActive = true; this.world.garage = this; this.hideWorld(); this.group.visible = true; this.still = 0;
      const car = this.h.car; car.place(ORIGIN_X + 24, 8, -Math.PI / 2); car.s.y = 0.7; car.s.vx = car.s.vz = 0; car.engine.rpm = car.engine.rpm || 0;
      this.h.toast('Underground car park - find a free bay, or follow the green EXIT sign to leave');
    });
  }
  /** Drive back out to the street. */
  leave() {
    if (!this.active || this.leaving) return;
    this.leaving = true;
    this.h.fade(() => {
      this.leaving = false; const b = this.b, r = b.ramp, car = this.h.car; this.close();
      car.place(r.x + r.nx * 5, r.z + r.nz * 5, Math.atan2(r.nx, r.nz)); car.s.y = this.world.heightAt(car.s.x, car.s.z, 3) + 0.7; car.s.vx = car.s.vz = 0;
    });
  }
  /** Switch the garage off without moving the car (the caller teleports it). */
  close() {
    this.active = false; this.world.garageActive = false; this.group.visible = false; this.restoreWorld(); this.clear();
    const ex = this.world.extras; ex.override = false; ex.lights.forEach((l) => { l.userData.fixed = 0; });
  }
  hideWorld() {
    this.hidden = []; const keep = new Set([this.group, this.env.sky, this.env.stars, ...this.h.keep()]);
    for (const c of this.scene.children) { if (keep.has(c) || c.isLight) continue; if (c.visible) { c.visible = false; this.hidden.push(c); } }
  }
  restoreWorld() { for (const c of this.hidden) c.visible = true; this.hidden = []; }

  query(x, z, r, y) {
    const out = [];
    for (const c of this.colliders) if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ && y + 0.8 > c.yMin && y - 0.4 < c.yMax) out.push(c);
    return out;
  }

  /** Per frame while driving inside. Returns { perfect } when you park, 'exit' handled internally. */
  update(dt, car) {
    if (!this.active) return null;
    this.clock += dt; const s = car.s;
    if (s.x > ORIGIN_X + W / 2 - 3 && Math.abs(s.z) < 4.5) { this.leave(); return null; }
    if (car.speed > 0.5) { this.still = 0; return null; }
    this.still += dt; if (this.still < 1.2) return null;
    const r = checkPark(car, this.bays, this.clock, () => 'x');
    if (r) { this.still = 0; return { ...r, lot: this.b.name + ' garage' }; }
    return null;
  }
}

function canvasConcrete() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#7d7d79'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) { const v = 100 + Math.random() * 55; g.fillStyle = 'rgb(' + v + ',' + v + ',' + (v - 3) + ')'; g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
  g.strokeStyle = '#6a6a66'; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(16, 8); t.colorSpace = THREE.SRGBColorSpace; return t;
}

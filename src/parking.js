import * as THREE from 'three';
import { wrapPi } from './util.js';
import { CARS } from './car.js';
import { shellGeos } from './carmodel.js';

export const BAY_W = 2.7, BAY_L = 5.2, AISLE = 6, LOT_D = BAY_L * 2 + AISLE;     // 16.4 m deep for a two-row lot

/**
 * Surface parking lots: marked bays, wheel stops, a P sign, parked cars you can bump into,
 * and park detection ("Perfect park!") when you stop neatly inside a free bay.
 * u runs along the lot, v across it. rows:1 makes a small one-row driveway (used at villas).
 */
export const LOT_SITES = [
  { name: 'East Gate Parking', x: 650, z: 22.2, axis: 'x', w: 44, rv: -1, roadDist: 22.2 },
  { name: 'West Gate Parking', x: -650, z: -22.2, axis: 'x', w: 44, rv: 1, roadDist: 22.2 },
  { name: 'Residential Parking', x: -400, z: 280.8, axis: 'x', w: 44, rv: 1, roadDist: 19.2 },
  { name: 'Town Parking', x: 2840, z: 22.2, axis: 'x', w: 44, rv: -1, roadDist: 22.2 },
  { name: 'Northern Rest Stop', x: 22.2, z: -2700, axis: 'z', w: 44, rv: -1, roadDist: 22.2 },
  { name: 'Airport Parking', x: -2520.2, z: 1150, axis: 'z', w: 56, rv: 1, roadDist: 20.2 },
  { name: 'Desert Parking', x: 3019.2, z: 800, axis: 'z', w: 44, rv: -1, roadDist: 19.2 },
  { name: 'VYT Auto Lot', x: -215, z: 165, axis: 'x', w: 44, rv: -1, roadDist: 0 },
];
export const lotDepth = (s) => (s.rows === 1 ? BAY_L + 1.6 : LOT_D);

function pTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#1b5fb8'; g.fillRect(0, 0, 128, 128); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#fff'; g.font = 'bold 92px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('P', 64, 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export const parkSignTexture = pTex;

const flatGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function instanced(parent, geo, mat, list, f, cast = false) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)), o = new THREE.Object3D();
  list.forEach((it, i) => { f(o, it); o.updateMatrix(); im.setMatrixAt(i, o.matrix); });
  im.count = list.length; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true; parent.add(im); return im;
}

/** Instanced parked cars. items: {x,z,yaw,k (0-3),color}. collide(minX,maxX,minZ,maxZ,y0,y1) registers a collider. */
export function instancedParked(parent, items, collide, groundY = 0) {
  const byDef = [[], [], [], []]; items.forEach((it) => byDef[it.k].push(it));
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c141c, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.55, depthWrite: false });
  const body = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.55, envMapIntensity: 1.1 });
  const wheelG = new THREE.CylinderGeometry(0.33, 0.33, 0.26, 12).rotateZ(Math.PI / 2), wheelM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const wheelList = [], c = new THREE.Color();
  byDef.forEach((list, k) => {
    if (!list.length) return;
    const def = CARS[k], sg = shellGeos(def), place = (o, it) => { o.position.set(it.x, groundY + 0.52, it.z); o.rotation.set(0, it.yaw, 0); o.scale.set(1, 1, 1); };
    const h = instanced(parent, sg.hull, body, list, place, true); list.forEach((it, i) => h.setColorAt(i, c.set(it.color)));
    const g = instanced(parent, sg.gh, [glass, body], list, place, true); list.forEach((it, i) => g.setColorAt(i, c.set(it.color)));
    for (const it of list) {
      for (const [wx, wz] of [[1, 0.46], [-1, 0.46], [1, -0.54], [-1, -0.54]]) {
        const lx = wx * (def.W / 2 - 0.12), lz = wz * def.L, sy = Math.sin(it.yaw), cy = Math.cos(it.yaw);
        wheelList.push({ x: it.x + lx * cy + lz * sy, z: it.z - lx * sy + lz * cy, yaw: it.yaw });
      }
      const along = Math.abs(Math.sin(it.yaw)) > 0.5, hw = def.W / 2, hl = def.len / 2;
      collide(it.x - (along ? hl : hw), it.x + (along ? hl : hw), it.z - (along ? hw : hl), it.z + (along ? hw : hl), groundY, groundY + 1.6);
    }
  });
  instanced(parent, wheelG, wheelM, wheelList, (o, w) => { o.position.set(w.x, groundY + 0.33, w.z); o.rotation.set(0, w.yaw, 0); o.scale.set(1, 1, 1); });
}
export const PARKED_COLORS = [0xb0b0b0, 0x1c2a44, 0x7a1f1f, 0x2f4f3a, 0xe6e1d3, 0x222222, 0xc9a227, 0x9a9ea4];

/** Park check against a list of bays; shared by lots and garages. */
export function checkPark(car, bays, clock, axisOf) {
  const s = car.s;
  for (const b of bays) {
    if (b.occupied || b.cool > clock) continue;
    const ax = axisOf(b), dx = s.x - b.x, dz = s.z - b.z, uOff = ax === 'x' ? dx : dz, vOff = ax === 'x' ? dz : dx;
    let ang = Math.abs(wrapPi(s.yaw - b.yaw)); ang = Math.min(ang, Math.PI - ang);
    if (Math.abs(uOff) < 1.05 && Math.abs(vOff) < 2.0 && ang < 0.24) { b.cool = clock + 600; return { perfect: Math.abs(uOff) < 0.4 && ang < 0.09 && Math.abs(vOff) < 0.9 }; }
  }
  return null;
}

export class Parking {
  constructor(world, extraSites = []) {
    this.world = world; this.scene = world.scene; this.lots = []; this.bays = []; this.clock = 0; this.still = 0;
    const rng = world.rng, items = [], lines = [], stops = [], poles = [], signs = [], aprons = [], pads = [], lamps = [];
    for (const s of LOT_SITES.concat(extraSites)) {
      const lot = { ...s, id: this.lots.length, d: lotDepth(s) }; this.lots.push(lot);
      const to = (u, v) => (s.axis === 'x' ? [s.x + u, s.z + v] : [s.x + v, s.z + u]);
      const one = s.rows === 1, W = s.w + 2, [px, pz] = to(0, 0);
      pads.push({ x: px, z: pz, sx: s.axis === 'x' ? W : lot.d + 2, sz: s.axis === 'x' ? lot.d + 2 : W });
      const n = Math.floor((s.w - 2) / BAY_W), gaps = one ? [] : [-s.w / 4, s.w / 4];
      for (const row of one ? [1] : [1, -1]) {
        for (let i = 0; i < n; i++) {
          const u = -s.w / 2 + 1.3 + i * BAY_W + BAY_W / 2, v = one ? 0 : row * (AISLE / 2 + BAY_L / 2);
          const driveway = row === s.rv && gaps.some((g) => Math.abs(u - g) < 3.4) && s.roadDist > 0;
          const [bx, bz] = to(u, v), [lx, lz] = to(u - BAY_W / 2, v);
          lines.push({ x: lx, z: lz, sx: s.axis === 'x' ? 0.1 : BAY_L, sz: s.axis === 'x' ? BAY_L : 0.1 });
          if (driveway) continue;
          const bay = { x: bx, z: bz, lot: lot.id, row, yaw: s.axis === 'x' ? 0 : Math.PI / 2, occupied: false, cool: 0, axis: s.axis }; this.bays.push(bay);
          const [wx, wz] = to(u, v + (one ? -1 : row) * (BAY_L / 2 - 0.5));
          stops.push({ x: wx, z: wz, sx: s.axis === 'x' ? 1.4 : 0.18, sz: s.axis === 'x' ? 0.18 : 1.4 });
          if (rng() < (one ? 0.3 : 0.42)) {
            bay.occupied = true;
            items.push({ x: bx, z: bz, yaw: bay.yaw + (rng() < 0.5 ? Math.PI : 0), k: (rng() * 4) | 0, color: PARKED_COLORS[(rng() * 8) | 0] });
          }
        }
        const [ex, ez] = to(s.w / 2 - 1.3, one ? 0 : row * (AISLE / 2 + BAY_L / 2));
        lines.push({ x: ex, z: ez, sx: s.axis === 'x' ? 0.1 : BAY_L, sz: s.axis === 'x' ? BAY_L : 0.1 });
      }
      if (s.roadDist > 0 && !one) for (const g of gaps) {
        const len = s.roadDist - (lot.d / 2 + 0.8), mid = s.rv * (lot.d / 2 + len / 2), [ax, az] = to(g, mid);
        aprons.push({ x: ax, z: az, sx: s.axis === 'x' ? 6.4 : len, sz: s.axis === 'x' ? len : 6.4 });
      }
      for (const [u, v] of one ? [[-s.w / 2, 0]] : [[-s.w / 2, 0], [s.w / 2, 0], [0, 0]]) { const [lx, lz] = to(u, v); lamps.push({ x: lx, z: lz }); }
      const [gx, gz] = to((gaps[0] ?? -s.w / 2) + 3.8, (s.rv || 1) * (lot.d / 2 + 0.6)); poles.push({ x: gx, z: gz });
      signs.push({ x: gx, z: gz, ry: s.axis === 'x' ? (s.rv > 0 ? 0 : Math.PI) : (s.rv > 0 ? Math.PI / 2 : -Math.PI / 2) });
    }
    this.buildMeshes({ items, lines, stops, poles, signs, aprons, pads, lamps });
  }

  buildMeshes({ items, lines, stops, poles, signs, aprons, pads, lamps }) {
    const scene = this.scene, W = this.world;
    const asph = new THREE.MeshStandardMaterial({ color: 0x3b3e43, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    instanced(scene, flatGeo, asph, pads, (o, p) => { o.position.set(p.x, 0.045, p.z); o.scale.set(p.sx, 1, p.sz); o.rotation.set(0, 0, 0); });
    instanced(scene, flatGeo, asph, aprons, (o, p) => { o.position.set(p.x, 0.046, p.z); o.scale.set(p.sx, 1, p.sz); o.rotation.set(0, 0, 0); });
    const paintM = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5 });
    instanced(scene, flatGeo, paintM, lines, (o, p) => { o.position.set(p.x, 0.05, p.z); o.scale.set(p.sx, 1, p.sz); o.rotation.set(0, 0, 0); });
    instanced(scene, boxGeo, new THREE.MeshStandardMaterial({ color: 0x9a9a95, roughness: 0.9 }), stops, (o, p) => { o.position.set(p.x, 0.1, p.z); o.scale.set(p.sx, 0.14, p.sz); o.rotation.set(0, 0, 0); });
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.6 });
    instanced(scene, new THREE.CylinderGeometry(0.06, 0.08, 1, 8).translate(0, 0.5, 0), metal, poles, (o, p) => { o.position.set(p.x, 0, p.z); o.scale.set(1, 3.4, 1); o.rotation.set(0, 0, 0); });
    instanced(scene, new THREE.CylinderGeometry(0.1, 0.12, 1, 8).translate(0, 0.5, 0), metal, lamps, (o, p) => { o.position.set(p.x, 0, p.z); o.scale.set(1, 8.5, 1); o.rotation.set(0, 0, 0); });
    const ex = W.extras;
    if (ex) {
      instanced(scene, boxGeo, ex.headMat, lamps, (o, p) => { o.position.set(p.x, 8.4, p.z); o.scale.set(1.1, 0.16, 0.5); o.rotation.set(0, 0, 0); });
      instanced(scene, flatGeo, ex.poolMat, lamps, (o, p) => { o.position.set(p.x, 0.17, p.z); o.scale.set(17, 1, 17); o.rotation.set(0, 0, 0); });
    }
    const sm = new THREE.MeshBasicMaterial({ map: pTex() }), back = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (const s of signs) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), sm); m.position.set(s.x, 3.1, s.z); m.rotation.y = s.ry; scene.add(m);
      const b = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), back); b.position.set(s.x - Math.sin(s.ry) * 0.02, 3.1, s.z - Math.cos(s.ry) * 0.02); b.rotation.y = s.ry + Math.PI; scene.add(b);
    }
    instancedParked(scene, items, (a, b, c, d, y0, y1) => W.addCollider(a, b, c, d, y0, y1));
  }

  lotAt(x, z) {
    for (const s of this.lots) {
      const du = s.axis === 'x' ? x - s.x : z - s.z, dv = s.axis === 'x' ? z - s.z : x - s.x;
      if (Math.abs(du) < s.w / 2 + 1 && Math.abs(dv) < s.d / 2 + 1) return s;
    }
    return null;
  }
  nearest(x, z) { let best = null, bd = 1e9; for (const s of this.lots) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } } return best; }

  /** Call each frame with the car. Returns { perfect, lot } the moment you park in a free bay, else null. */
  update(dt, car) {
    this.clock += dt;
    if (car.speed > 0.5) { this.still = 0; return null; }
    this.still += dt; if (this.still < 1.2) return null;
    const lot = this.lotAt(car.s.x, car.s.z); if (!lot) return null;
    const r = checkPark(car, this.bays.filter((b) => b.lot === lot.id), this.clock, (b) => b.axis);
    if (r) { this.still = 0; return { ...r, lot: lot.name }; }
    return null;
  }
}

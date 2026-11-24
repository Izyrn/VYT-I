import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';
import { parkSignTexture } from './parking.js';

const NAMES_A = ['Meridian', 'Harbor', 'Apex', 'Summit', 'Aurora', 'Crescent', 'Vista', 'Orion', 'Zenith', 'Atlas', 'Beacon', 'Cedar', 'Ember', 'Falcon', 'Glacier', 'Horizon', 'Ivory', 'Juniper', 'Kestrel', 'Lumen'];
const NAMES_B = ['Tower', 'Plaza', 'Residences', 'Heights', 'Court', 'Place', 'Gardens', 'Lofts'];
export const buildingName = (i) => `${NAMES_A[(i * 7) % NAMES_A.length]} ${NAMES_B[(i * 3 + (i >> 3)) % NAMES_B.length]}`;

/** Apartments on offer at a building's reception. Prices are higher downtown and for taller towers. */
export function offersFor(b) {
  const floors = Math.max(3, Math.floor(b.h / 3.6)), v = (b.id % 5) * 20;
  const pick = (k) => 2 + ((b.id * 5 + k * 3) % Math.max(1, floors - 2));
  const out = [
    { key: 'studio', name: 'Studio', floor: pick(1), price: 5000 + v },
    { key: 'one', name: '1-bedroom', floor: pick(2), price: 5300 + v },
    { key: 'two', name: '2-bedroom', floor: pick(3), price: 5600 + v },
  ];
  if (b.h > 70) out.push({ key: 'pent', name: 'Penthouse', floor: floors, price: 5900 + v });
  return out;
}

function instanced(scene, geo, mat, items, cast = false) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length)), o = new THREE.Object3D();
  items.forEach((it, i) => {
    o.position.set(it.x, it.y, it.z); o.scale.set(it.sx ?? 1, it.sy ?? 1, it.sz ?? 1); o.rotation.set(it.rx || 0, it.ry || 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix);
  });
  im.count = items.length; im.castShadow = cast; im.frustumCulled = false; scene.add(im); return im;
}
function glowTexture(inner, outer) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, inner); gr.addColorStop(0.45, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c);
}

/** Street lamps (with real lights near the player), traffic lights and building entrances. */
export class Extras {
  constructor(world) {
    this.world = world; this.scene = world.scene; this.t = 0; this.lampT = 0; this.lampOn = 0; this.override = false;
    this.buildLamps(); this.buildTrafficLights(); this.buildEntrances();
  }

  /* ---------------- street lamps ---------------- */
  buildLamps() {
    const W = this.world, spots = [];
    const onOther = (x, z, self) => W.roads.some((o) => {
      if (o === self) return false;
      const [p, q] = o.axis === 'x' ? [x, z] : [z, x];
      return Math.hypot(Math.max(o.a0 - p, 0, p - o.a1), Math.abs(q - o.c)) - o.w / 2 < 2.5;
    });
    for (const r of W.roads) {
      const step = r.type === 'highway' ? 70 : r.type === 'street' ? 40 : 55, H = r.type === 'highway' ? 9.5 : 7.8;
      for (let s = r.a0 + 25, n = 0; s < r.a1 - 20; s += step, n++) {
        const side = n % 2 ? 1 : -1, off = side * (r.w / 2 + 1.3);
        const x = r.axis === 'x' ? s : r.c + off, z = r.axis === 'x' ? r.c + off : s;
        if ((x > 1330 && x < 1770 && Math.abs(z) < 30) || (x > -1650 && x < -1450 && Math.abs(z) < 30)) continue;   // tunnel, bridge
        if (onOther(x, z, r)) continue;
        spots.push({ x, z, dx: r.axis === 'x' ? 0 : -side, dz: r.axis === 'x' ? -side : 0, H });
      }
    }
    this.spots = spots;
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.6, metalness: 0.6 });
    this.headMat = new THREE.MeshStandardMaterial({ color: 0x555555, emissive: 0xffd98a, emissiveIntensity: 0 });
    W.lampMat = this.headMat;
    const poles = [], arms = [], heads = [], pools = [];
    for (const s of spots) {
      const ry = Math.atan2(-s.dz, s.dx);
      poles.push({ x: s.x, y: 0, z: s.z, sx: 1, sy: s.H, sz: 1 });
      arms.push({ x: s.x + s.dx * 1.2, y: s.H, z: s.z + s.dz * 1.2, sx: 2.4, sy: 0.12, sz: 0.14, ry });
      heads.push({ x: s.x + s.dx * 2.3, y: s.H - 0.12, z: s.z + s.dz * 2.3, sx: 0.95, sy: 0.15, sz: 0.42, ry });
      pools.push({ x: s.x + s.dx * 2.3, y: 0.16, z: s.z + s.dz * 2.3, sx: 15, sy: 1, sz: 15 });
    }
    instanced(this.scene, new THREE.CylinderGeometry(0.09, 0.15, 1, 8).translate(0, 0.5, 0), metal, poles, true);
    instanced(this.scene, new THREE.BoxGeometry(1, 1, 1), metal, arms);
    instanced(this.scene, new THREE.BoxGeometry(1, 1, 1), this.headMat, heads);
    this.poolMat = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,214,140,0.9)', 'rgba(255,190,100,0.25)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, fog: false });
    instanced(this.scene, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.poolMat, pools);
    // a few real lights follow the player so road, car and walls pick up the lamp light
    this.lights = [];
    for (let i = 0; i < 6; i++) { const l = new THREE.PointLight(0xffd9a0, 0, 32, 2); l.castShadow = false; this.scene.add(l); this.lights.push(l); }
  }

  /* ---------------- traffic lights ---------------- */
  buildTrafficLights() {
    const poles = [], hx = [], hz = [], lens = { xr: [], xy: [], xg: [], zr: [], zy: [], zg: [] };
    for (let ix = -4; ix <= 4; ix++) for (let iz = -4; iz <= 4; iz++) {
      const cx = ix * 120, cz = iz * 120, wz = ix === 0 ? 9 : 6, wx = iz === 0 ? 9 : 6;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = cx + sx * (wz + 1.7), pz = cz + sz * (wx + 1.7);
        poles.push({ x: px, y: 0, z: pz, sx: 1, sy: 5.8, sz: 1 });
        hx.push({ x: px + sx * 0.28, y: 4.9, z: pz, sx: 0.34, sy: 1.15, sz: 0.4 });
        hz.push({ x: px, y: 3.5, z: pz + sz * 0.28, sx: 0.4, sy: 1.15, sz: 0.34 });
        [['r', 0.38], ['y', 0], ['g', -0.38]].forEach(([k, dy]) => {
          lens['x' + k].push({ x: px + sx * 0.47, y: 4.9 + dy, z: pz, sx: 0.07, sy: 0.26, sz: 0.26 });
          lens['z' + k].push({ x: px, y: 3.5 + dy, z: pz + sz * 0.47, sx: 0.26, sy: 0.26, sz: 0.07 });
        });
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1), dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6 });
    instanced(this.scene, new THREE.CylinderGeometry(0.08, 0.11, 1, 8).translate(0, 0.5, 0), dark, poles, true);
    instanced(this.scene, box, dark, hx); instanced(this.scene, box, dark, hz);
    const cols = { r: 0xff2a1a, y: 0xffb300, g: 0x20e070 };
    this.lensMats = {};
    for (const [key, items] of Object.entries(lens)) {
      const m = new THREE.MeshStandardMaterial({ color: 0x101010, emissive: cols[key[1]], emissiveIntensity: 0.1 });
      this.lensMats[key] = m; instanced(this.scene, box, m, items);
    }
  }
  /** Signal state for traffic travelling along the given axis ('x' or 'z'). */
  lightState(axis) {
    const t = this.t % 34;
    if (axis === 'x') return t < 14 ? 'green' : t < 16 ? 'yellow' : 'red';
    return t < 17 ? 'red' : t < 31 ? 'green' : t < 33 ? 'yellow' : 'red';
  }

  /* ---------------- building entrances ---------------- */
  buildEntrances() {
    const W = this.world, frames = [], doors = [], canopies = [], signs = [], mats = [], rampHoles = [], rampFrames = [], rampSigns = [], rampFloors = [];
    W.buildings.forEach((b, i) => {
      b.id = i; b.name = buildingName(i);
      const faces = [[1, 0, b.cx + b.w / 2, b.cz], [-1, 0, b.cx - b.w / 2, b.cz], [0, 1, b.cx, b.cz + b.d / 2], [0, -1, b.cx, b.cz - b.d / 2]];
      let best = null, bd = 1e9;
      for (const f of faces) { const d = W.roadDist(f[2] + f[0] * 7, f[3] + f[1] * 7); if (d < bd) { bd = d; best = f; } }
      const [nx, nz, ex, ez] = best, ry = nx ? Math.PI / 2 : 0;
      b.door = { x: ex + nx * 3, z: ez + nz * 3, nx, nz, ex, ez };
      frames.push({ x: ex + nx * 0.28, y: 1.85, z: ez + nz * 0.28, sx: 4.8, sy: 3.7, sz: 0.55, ry });
      doors.push({ x: ex + nx * 0.58, y: 1.55, z: ez + nz * 0.58, sx: 3.9, sy: 3.1, sz: 0.08, ry });
      canopies.push({ x: ex + nx * 1.5, y: 3.95, z: ez + nz * 1.5, sx: 7, sy: 0.28, sz: 2.8, ry });
      signs.push({ x: ex + nx * 0.4, y: 5.3, z: ez + nz * 0.4, sx: 5.2, sy: 1.0, sz: 0.18, ry });
      mats.push({ x: ex + nx * 2.6, y: 0.17, z: ez + nz * 2.6, sx: 9, sy: 1, sz: 9 });
      // underground car park: a ramp on another side of the building, facing the nearest road
      let best2 = null, bd2 = 1e9;
      for (const f of faces) { if (f === best) continue; const d = W.roadDist(f[2] + f[0] * 7, f[3] + f[1] * 7); if (d < bd2) { bd2 = d; best2 = f; } }
      const [rnx, rnz, rex, rez] = best2, rry = rnx ? Math.PI / 2 : 0;
      b.ramp = { x: rex + rnx * 3.2, z: rez + rnz * 3.2, nx: rnx, nz: rnz };
      rampHoles.push({ x: rex + rnx * 0.3, y: 1.6, z: rez + rnz * 0.3, sx: 5, sy: 3.2, sz: 0.5, ry: rry });
      rampFrames.push({ x: rex + rnx * 0.35, y: 3.45, z: rez + rnz * 0.35, sx: 5.4, sy: 0.35, sz: 0.55, ry: rry });
      rampSigns.push({ x: rex + rnx * 0.7, y: 4.9, z: rez + rnz * 0.7, sx: 1.6, sy: 1.6, sz: 1, ry: Math.atan2(rnx, rnz) });
      rampFloors.push({ x: rex + rnx * 3.8, y: 0.16, z: rez + rnz * 3.8, sx: rnx ? 7 : 5.2, sy: 1, sz: rnx ? 5.2 : 7 });
    });
    const box = new THREE.BoxGeometry(1, 1, 1);
    instanced(this.scene, box, new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.5, metalness: 0.6 }), frames);
    this.doorMat = new THREE.MeshStandardMaterial({ color: 0x1d3342, roughness: 0.08, metalness: 0.8, emissive: 0xffd9a0, emissiveIntensity: 0.15 });
    instanced(this.scene, box, this.doorMat, doors);
    instanced(this.scene, box, new THREE.MeshStandardMaterial({ color: 0xb89b4a, roughness: 0.4, metalness: 0.7 }), canopies, true);
    this.signMat = new THREE.MeshStandardMaterial({ color: 0x3a2f12, emissive: 0xffc94d, emissiveIntensity: 0.35 });
    instanced(this.scene, box, this.signMat, signs);
    this.entPoolMat = new THREE.MeshBasicMaterial({ map: glowTexture('rgba(255,225,170,0.85)', 'rgba(255,200,120,0.22)'), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.25, fog: false });
    instanced(this.scene, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.entPoolMat, mats);
    instanced(this.scene, box, new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9 }), rampHoles);
    instanced(this.scene, box, new THREE.MeshStandardMaterial({ color: 0xe8c020, roughness: 0.5 }), rampFrames);
    instanced(this.scene, new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: parkSignTexture() }), rampSigns);
    instanced(this.scene, new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), rampFloors);
  }
  nearEntrance(x, z, r = 4.2) {
    let best = null, bd = r;
    for (const b of this.world.buildings) { const d = Math.hypot(x - b.door.x, z - b.door.z); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  update(dt, env, focus) {
    this.t += dt;
    const on = env.night;
    this.lampOn = on;
    this.poolMat.opacity = on * 0.6;
    this.doorMat.emissiveIntensity = 0.15 + on * 1.6; this.signMat.emissiveIntensity = 0.35 + on * 2.2; this.entPoolMat.opacity = 0.12 + on * 0.5;
    const L = this.lensMats;
    for (const axis of ['x', 'z']) {
      const s = this.lightState(axis);
      L[axis + 'r'].emissiveIntensity = s === 'red' ? 3.2 : 0.08;
      L[axis + 'y'].emissiveIntensity = s === 'yellow' ? 3.2 : 0.08;
      L[axis + 'g'].emissiveIntensity = s === 'green' ? 3.2 : 0.08;
    }
    // One shared pool of real lights: nearest street lamps (at night) and tunnel lights; building interiors take over the pool.
    this.lampT -= dt;
    if (!this.override && this.lampT <= 0) {
      this.lampT = 0.25;
      const best = [], consider = (d, pos, always) => {
        if (d > 3600) return;
        if (best.length < this.lights.length) { best.push([d, pos, always]); best.sort((p, q) => p[0] - q[0]); }
        else if (d < best[best.length - 1][0]) { best[best.length - 1] = [d, pos, always]; best.sort((p, q) => p[0] - q[0]); }
      };
      if (on > 0.02) for (const s of this.spots) consider((s.x - focus.x) ** 2 + (s.z - focus.z) ** 2, [s.x + s.dx * 2.3, s.H - 0.4, s.z + s.dz * 2.3], false);
      if (Math.abs(focus.z) < 60 && focus.x > 1300 && focus.x < 1800) for (let x = 1375; x <= 1725; x += 25) consider((x - focus.x) ** 2 + focus.z ** 2, [x, 6.6, 0], true);
      this.lights.forEach((l, i) => { const p = best[i]; if (p) { l.position.set(...p[1]); l.userData.always = p[2]; } else { l.position.set(0, -50, 0); l.userData.always = false; } });
    }
    for (const l of this.lights) l.intensity = this.override ? (l.userData.fixed || 0) : 1500 * (l.userData.always ? 1 : on);
  }
}

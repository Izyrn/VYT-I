import * as THREE from 'three';
import { clamp, lerp, wrapPi } from './util.js';
import { CARS } from './car.js';
import { createLowCar } from './carmodel.js';
import { createHuman } from './human.js';

const COLORS = [0xb0b0b0, 0x1c2a44, 0x7a1f1f, 0x2f4f3a, 0xe6e1d3, 0x222222, 0xc9a227];
const box = new THREE.BoxGeometry(1, 1, 1);

export function trafficMesh(color, idx = 1) {
  return createLowCar(CARS[idx % 4], color);
}

export class Traffic {
  constructor(scene, world, player) {
    this.scene = scene; this.world = world; this.player = player;
    this.cars = []; this.peds = []; this.onCrime = null; this.crimeCool = 0; this.extraVehicles = null; this.walker = null;
    this.roads = world.roads.filter((r) => r.a1 - r.a0 > 100);
    for (let i = 0; i < 40; i++) this.cars.push(this.makeCar(i));
    this.setCount(26);
    this.pedCount = 40;
    for (let i = 0; i < 60; i++) { const p = this.makePed(); p.idx = i; this.peds.push(p); }
  }
  setCount(n) { this.cars.forEach((c, i) => { c.active = i < n; c.mesh.visible = c.active && c.placed; }); }

  makeCar(i) {
    const mesh = trafficMesh(COLORS[i % COLORS.length], (i * 7 + (i >> 2)) % CARS.length); this.scene.add(mesh); mesh.visible = false;
    return { mesh, x: 0, z: 0, yaw: 0, v: 0, road: null, dir: 1, limit: 15, active: true, placed: false, crash: 0, vx: 0, vz: 0, spawnT: i * 0.05 };
  }

  lane(r, dir) { return (r.type === 'highway' ? 4.6 : 3) * dir; }
  respawn(c) {
    const p = this.player.s, cand = [];
    for (const r of this.roads) {
      const [a, b] = r.axis === 'x' ? [p.x, p.z] : [p.z, p.x];
      if (Math.abs(b - r.c) < 380) cand.push(r);
    }
    if (!cand.length) { c.placed = false; c.mesh.visible = false; return; }
    const r = cand[(Math.random() * cand.length) | 0];
    const a = r.axis === 'x' ? p.x : p.z, b = r.axis === 'x' ? p.z : p.x;
    const off = Math.sqrt(Math.max(0, 380 * 380 - (b - r.c) ** 2));
    const s = clamp(a + (Math.random() < 0.5 ? -1 : 1) * (140 + Math.random() * Math.max(10, off - 140)), r.a0 + 5, r.a1 - 5);
    const dir = Math.random() < 0.5 ? 1 : -1;
    c.road = r; c.dir = dir; c.limit = r.type === 'highway' ? 22 + Math.random() * 8 : 11 + Math.random() * 3; c.v = c.limit * 0.7;
    if (r.axis === 'x') { c.x = s; c.z = r.c + this.lane(r, dir); c.yaw = dir > 0 ? Math.PI / 2 : -Math.PI / 2; }
    else { c.z = s; c.x = r.c - this.lane(r, dir); c.yaw = dir > 0 ? 0 : Math.PI; }
    if (Math.hypot(c.x - p.x, c.z - p.z) < 120) { c.placed = false; c.mesh.visible = false; return; }
    c.placed = true; c.crash = 0; c.mesh.visible = c.active;
  }

  update(dt, env) {
    const P = this.player, ps = P.s;
    const night = env.night; this.crimeCool -= dt;
    for (const c of this.cars) {
      if (!c.active) continue;
      const dist = Math.hypot(c.x - ps.x, c.z - ps.z);
      if (!c.placed || dist > 420) { c.spawnT -= dt; if (c.spawnT <= 0) { c.spawnT = 0.5; this.respawn(c); } if (!c.placed) continue; }
      const r = c.road;
      // crashed: coast to a stop
      if (c.crash > 0) { c.crash -= dt; c.vx *= 1 - dt * 1.2; c.vz *= 1 - dt * 1.2; c.x += c.vx * dt; c.z += c.vz * dt; if (c.crash <= 0) c.v = 0; this.sync(c, night, true); continue; }
      // pure-pursuit target
      const s = r.axis === 'x' ? c.x : c.z, look = 7 + c.v * 0.6;
      let ts = s + c.dir * look;
      if (ts > r.a1 || ts < r.a0) { c.dir = -c.dir; ts = s + c.dir * look; }
      const tx = r.axis === 'x' ? ts : r.c - this.lane(r, c.dir) * 1, tz = r.axis === 'x' ? r.c + this.lane(r, c.dir) : ts;
      const want = Math.atan2(tx - c.x, tz - c.z), diff = wrapPi(want - c.yaw);
      c.yaw += clamp(diff, -1.4 * dt * (1 + c.v * 0.05), 1.4 * dt * (1 + c.v * 0.05));
      // turn at intersections
      if (!c.turnCool || performance.now() > c.turnCool) {
        for (const o of this.roads) {
          if (o.axis === r.axis || Math.abs(o.c - s) > 4 * Math.max(1, c.v * dt * 3) || Math.random() > 0.3) continue;
          const oa = r.axis === 'x' ? c.z : c.x;
          if (oa < o.a0 || oa > o.a1) continue;
          c.road = o; c.dir = Math.random() < 0.5 ? 1 : -1; c.limit = o.type === 'highway' ? 22 : 11; c.turnCool = performance.now() + 4000; break;
        }
      }
      // obstacle ahead
      let target = c.limit; const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      const check = (ox, oz, ov) => {
        const dx = ox - c.x, dz = oz - c.z, ahead = dx * fx + dz * fz, side = Math.abs(dx * fz - dz * fx);
        if (ahead > 0 && ahead < 10 + c.v * 1.4 && side < 2.4) target = Math.min(target, ahead < 6 ? 0 : Math.max(0, ov * 0.8));
      };
      check(ps.x, ps.z, P.speed);
      for (const o of this.cars) if (o !== c && o.placed && o.active) check(o.x, o.z, o.v);
      for (const pd of this.peds) if (pd.placed && pd.down <= 0) check(pd.x, pd.z, 0);
      if (Math.abs(diff) > 0.45) target = Math.min(target, 6);
      // traffic lights on the city grid
      if (this.world.extras && r.c % 120 === 0 && Math.abs(r.c) <= 480 && Math.abs(s) <= 600) {
        const gx = c.dir > 0 ? Math.ceil((s + 8) / 120) * 120 : Math.floor((s - 8) / 120) * 120, ahead = (gx - s) * c.dir;
        if (Math.abs(gx) <= 480 && ahead > 7 && ahead < 40 && this.world.extras.lightState(r.axis) !== 'green') target = Math.min(target, Math.max(0, (ahead - 9) * 0.9));
      }
      c.v += clamp(target - c.v, -9 * dt, 3.2 * dt);
      c.x += Math.sin(c.yaw) * c.v * dt; c.z += Math.cos(c.yaw) * c.v * dt;
      // collide with player (two circles each)
      const pf = [Math.sin(ps.yaw), Math.cos(ps.yaw)], half = P.def.len / 2 - 0.8;
      for (const po of [-half, 0, half]) for (const co of [-1.4, 0, 1.4]) {
        const ax = ps.x + pf[0] * po, az = ps.z + pf[1] * po, bx = c.x + fx * co, bz = c.z + fz * co;
        const dx = ax - bx, dz = az - bz, d = Math.hypot(dx, dz), R = P.def.W / 2 + 0.95;
        if (d < R && d > 1e-3) {
          const nx = dx / d, nz = dz / d, cvx = fx * c.v, cvz = fz * c.v;
          P.hit(nx, nz, R - d, bx + nx * 0.95, bz + nz * 0.95, 0.3, cvx * 0.6, cvz * 0.6);
          if (this.crimeCool <= 0 && P.speed > 7) { this.crimeCool = 12; this.onCrime && this.onCrime(1); }
          c.vx = cvx - nx * 4 + ps.vx * 0.4; c.vz = cvz - nz * 4 + ps.vz * 0.4; c.crash = 6; c.v = 0;
        }
      }
      this.sync(c, night, false);
    }
    this.updatePeds(dt);
  }
  sync(c, night, crashed) {
    c.mesh.position.set(c.x, 0.02, c.z); c.mesh.rotation.y = c.yaw;
    c.mesh.userData.lamp.emissiveIntensity = night > 0.3 ? 2.5 : 0;
    c.mesh.userData.tail.emissiveIntensity = crashed ? 0 : night > 0.3 ? 1 : 0;
  }

  /* ---------- pedestrians: sidewalks, crossings, traffic awareness ---------- */
  makePed() {
    const h = createHuman(); h.group.visible = false; this.scene.add(h.group);
    return { h, g: h.group, x: 0, z: 0, dirx: 0, dirz: 0, road: null, lat: 0, dir: 1, t: Math.random() * 6, down: 0, placed: false, wait: 0, v: 0, turnCool: 0, speed: 1.1 + Math.random() * 0.5, y: 0.06, idleT: 0, phoneUser: Math.random() < 0.4, idx: 0 };
  }
  setPedCount(n) { this.pedCount = n; }

  /** Everything with an engine that a pedestrian should look out for. */
  collectVehicles() {
    const out = (this._veh ||= []); out.length = 0;
    const P = this.player;
    out.push({ x: P.s.x, z: P.s.z, yaw: P.s.yaw, hl: P.def.len / 2, hw: P.def.W / 2, vx: P.s.vx, vz: P.s.vz, player: true });
    for (const c of this.cars) if (c.placed && c.active) out.push({ x: c.x, z: c.z, yaw: c.yaw, hl: 2.2, hw: 0.95, vx: c.crash > 0 ? c.vx : Math.sin(c.yaw) * c.v, vz: c.crash > 0 ? c.vz : Math.cos(c.yaw) * c.v });
    if (this.extraVehicles) for (const e of this.extraVehicles()) out.push(e);
    return out;
  }
  /** Road whose carriageway contains the point (other than `except`), or null. */
  onCarriageway(x, z, except) {
    for (const r of this.world.roads) {
      if (r === except) continue;
      const [p, q] = r.axis === 'x' ? [x, z] : [z, x];
      if (Math.hypot(Math.max(r.a0 - p, 0, p - r.a1), Math.abs(q - r.c)) - r.w / 2 < -0.3) return r;
    }
    return null;
  }
  /** Is it safe to step onto `road` at (x,z)? Signals count: cars are held at red, so red = go. */
  safeToCross(road, x, z, veh) {
    const along = road.axis === 'x' ? x : z, signal = this.world.extras && road.c % 120 === 0 && Math.abs(road.c) <= 480 && Math.abs(along) <= 480;
    const red = signal && this.world.extras.lightState(road.axis) === 'red';
    for (const v of veh) {
      const sp = Math.hypot(v.vx, v.vz), d = Math.hypot(v.x - x, v.z - z);
      if (d < (red ? 9 : 28) && sp > (red ? 3 : 1)) return false;
    }
    return true;
  }
  /** Distance from a point to a vehicle's body (negative inside), plus the point's position along the vehicle's heading. */
  vehicleGap(v, x, z) {
    const dx = x - v.x, dz = z - v.z, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const lf = dx * sy + dz * cy, ll = dx * cy - dz * sy;
    const cf = clamp(lf, -v.hl, v.hl), cl = clamp(ll, -v.hw, v.hw);
    return { d: Math.hypot(lf - cf, ll - cl), lf, ll };
  }

  updatePeds(dt) {
    const ps = this.player.s, streets = this.roads.filter((r) => r.type === 'street'), veh = this.collectVehicles();
    const walker = this.walker ? this.walker() : null, inCity = (x, z) => Math.abs(x) < 540 && Math.abs(z) < 540;
    for (const p of this.peds) {
      if (p.idx >= this.pedCount) { p.placed = false; p.g.visible = false; continue; }
      const dPlayer = Math.hypot(p.x - ps.x, p.z - ps.z);
      if (!p.placed || dPlayer > 200) {
        const r = streets[(Math.random() * streets.length) | 0], a = (r.axis === 'x' ? ps.x : ps.z) + (Math.random() - 0.5) * 220, side = Math.random() < 0.5 ? -1 : 1;
        const s = clamp(a, r.a0 + 8, r.a1 - 8), dir = Math.random() < 0.5 ? 1 : -1;
        p.road = r; p.lat = side * (r.w / 2 + 1.6); p.dir = dir; p.down = 0; p.wait = 0; p.turnCool = 2 + Math.random() * 3;
        p.x = r.axis === 'x' ? s : r.c + p.lat; p.z = r.axis === 'x' ? r.c + p.lat : s;
        p.dirx = r.axis === 'x' ? dir : 0; p.dirz = r.axis === 'x' ? 0 : dir;
        const dd = Math.hypot(p.x - ps.x, p.z - ps.z); p.placed = dd > 25 && dd < 180 && !this.onCarriageway(p.x, p.z, null);
        p.g.visible = p.placed; p.g.rotation.x = 0; continue;
      }
      if (p.down > 0) { p.down -= dt; p.g.rotation.x = Math.min(1.5, p.g.rotation.x + dt * 6); if (p.down <= 0) p.placed = false; continue; }

      const r = p.road, onRoad = this.onCarriageway(p.x, p.z, null);
      // --- perception: cars heading for me? ---
      let danger = false;
      for (const v of veh) {
        const sp = Math.hypot(v.vx, v.vz), g = this.vehicleGap(v, p.x, p.z);
        if (g.d < 0.45 && sp > 2.2) {                      // run over
          p.down = 4; p.g.rotation.x = 0.1; if (v.player && this.onCrime) this.onCrime(1); break;
        }
        if (sp > 1.2 && g.lf > v.hl && Math.abs(g.ll) < v.hw + 1.5 && g.lf - v.hl < sp * 1.7 + 3) danger = true;
      }
      if (p.down > 0) continue;
      if (danger && !onRoad) p.wait = 0.5;
      p.wait = Math.max(0, p.wait - dt); p.turnCool -= dt;

      // --- decide movement ---
      let speed = p.speed * (onRoad ? 1.7 : 1);
      if (p.wait > 0 && !(onRoad && danger)) speed = 0;                       // stand still while a car passes (but keep running if caught on the road)
      const nx = p.x + p.dirx * speed * dt, nz = p.z + p.dirz * speed * dt;
      if (speed > 0) {
        const nextRoad = this.onCarriageway(nx, nz, null);
        if (nextRoad && !onRoad && !this.safeToCross(nextRoad, nx, nz, veh)) { speed = 0; p.wait = 0.25; }
      }
      p.v += (speed - p.v) * Math.min(1, dt * 8);
      p.x += p.dirx * p.v * dt; p.z += p.dirz * p.v * dt;

      // --- turn at street corners / turn around at road ends ---
      const s = r.axis === 'x' ? p.x : p.z;
      if (s < r.a0 + 5 || s > r.a1 - 5) { p.dir = -p.dir; p.dirx *= -1; p.dirz *= -1; }
      else if (p.turnCool <= 0 && !onRoad) {
        for (const o of streets) {
          if (o.axis === r.axis || r.c < o.a0 || r.c > o.a1) continue;
          const corner = o.c - p.dir * (o.w / 2 + 1.6);
          if (Math.abs(s - corner) < 0.4 && Math.random() < 0.45) {
            const lateralOld = r.axis === 'x' ? p.z : p.x, nd = Math.random() < 0.5 ? 1 : -1;
            p.road = o; p.lat = -p.dir * (o.w / 2 + 1.6); p.dir = nd; p.turnCool = 4;
            p.dirx = o.axis === 'x' ? nd : 0; p.dirz = o.axis === 'x' ? 0 : nd;
            if (o.axis === 'x') p.z = o.c + p.lat; else p.x = o.c + p.lat;
            void lateralOld; break;
          }
        }
      }
      // relax back to the sidewalk lane (after being nudged by other people)
      if (!onRoad) { const rr = p.road; if (rr.axis === 'x') p.z += (rr.c + p.lat - p.z) * Math.min(1, dt * 2); else p.x += (rr.c + p.lat - p.x) * Math.min(1, dt * 2); }

      // --- animation ---
      p.t += p.v > 0.15 ? p.v * dt * 2.9 : dt * 1.4;
      p.idleT = p.v < 0.15 ? p.idleT + dt : 0;
      p.h.pose(p.t, p.v, p.v >= 0.15 ? 'walk' : p.phoneUser && p.idleT > 2 ? 'phone' : 'idle');
      p.h.setShadow(dPlayer < 45);
      p.g.position.set(p.x, onRoad ? 0.02 : inCity(p.x, p.z) ? 0.12 : 0.02, p.z);
      p.g.rotation.y = Math.atan2(p.dirx, p.dirz);
    }
    // --- people do not walk through each other (or through you on foot) ---
    for (let i = 0; i < this.peds.length; i++) {
      const a = this.peds[i]; if (!a.placed || a.down > 0) continue;
      for (let j = i + 1; j < this.peds.length; j++) {
        const b = this.peds[j]; if (!b.placed || b.down > 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 0.8 && d > 1e-3) { const push = (0.8 - d) / 2, ux = dx / d, uz = dz / d; a.x -= ux * push; a.z -= uz * push; b.x += ux * push; b.z += uz * push; }
      }
      if (walker) { const dx = a.x - walker.x, dz = a.z - walker.z, d = Math.hypot(dx, dz); if (d < 0.9 && d > 1e-3) { a.x += dx / d * (0.9 - d); a.z += dz / d * (0.9 - d); } }
    }
  }
}

import * as THREE from 'three';
import { clamp, lerp, smoothstep, wrapPi } from './util.js';
import { createCarMesh } from './carmodel.js';
export { createCarMesh };

/** Fuel burn is scaled up so a tank lasts ~1 hour of play instead of several real-world hours. */
export const FUEL_SCALE = 8;
const G = 9.81;

export const CARS = [
  { id: 'swift', name: 'VYT Swift', blurb: 'Light hatchback. Cheap to run.', price: 0, mass: 1050, L: 2.5, W: 1.7, len: 3.9, hgt: 1.45, wr: 0.31,
    tmax: 165, gears: [3.6, 2.1, 1.45, 1.05, 0.82], final: 4.2, redline: 6800, idle: 850, tank: 42, burn: 0.9, color: 0xd8d8d2, grip: 1.0, cyl: 4, awd: false },
  { id: 'meridian', name: 'Meridian S', blurb: 'Comfortable family sedan.', price: 19000, mass: 1500, L: 2.8, W: 1.82, len: 4.7, hgt: 1.42, wr: 0.33,
    tmax: 270, gears: [3.5, 2.2, 1.5, 1.1, 0.85, 0.7], final: 3.6, redline: 6500, idle: 800, tank: 58, burn: 1.1, color: 0x233a63, grip: 1.05, cyl: 6, awd: false },
  { id: 'atlas', name: 'Atlas 4x4', blurb: 'All-wheel-drive SUV. Great off-road.', price: 36000, mass: 2100, L: 2.95, W: 1.95, len: 4.9, hgt: 1.8, wr: 0.38,
    tmax: 420, gears: [3.9, 2.3, 1.5, 1.1, 0.85, 0.7], final: 3.9, redline: 5800, idle: 780, tank: 85, burn: 1.7, color: 0x3d4a35, grip: 1.1, cyl: 6, awd: true },
  { id: 'corsa', name: 'Corsa GT', blurb: 'Rear-drive V8 coupe. Loves to drift.', price: 48000, mass: 1380, L: 2.6, W: 1.88, len: 4.4, hgt: 1.28, wr: 0.33,
    tmax: 430, gears: [3.4, 2.3, 1.7, 1.35, 1.1, 0.9], final: 3.7, redline: 7600, idle: 900, tank: 52, burn: 1.5, color: 0xb3202a, grip: 1.15, cyl: 8, awd: false },
  { id: 'courier', name: 'Courier Van', blurb: 'Big, tall and patient. Hauls anything.', price: 28000, mass: 2500, L: 3.3, W: 2.05, len: 5.4, hgt: 2.15, wr: 0.38,
    tmax: 330, gears: [4.2, 2.5, 1.6, 1.1, 0.8], final: 4.2, redline: 5200, idle: 780, tank: 80, burn: 1.6, color: 0xe8e8e8, grip: 1.0, cyl: 4, awd: false, cdA: 1.1 },
  { id: 'kodiak', name: 'Kodiak 4x4 Pickup', blurb: 'Rugged V8 pickup with a load bed.', price: 52000, mass: 2300, L: 3.2, W: 2.0, len: 5.3, hgt: 1.85, wr: 0.4,
    tmax: 480, gears: [4.0, 2.4, 1.6, 1.15, 0.9, 0.7], final: 4.1, redline: 5600, idle: 760, tank: 90, burn: 1.9, color: 0x8a5a2a, grip: 1.1, cyl: 8, awd: true, cdA: 1.0 },
  { id: 'vento', name: 'Vento R', blurb: 'Mid-engine supercar. Frighteningly fast.', price: 95000, mass: 1250, L: 2.6, W: 1.96, len: 4.5, hgt: 1.15, wr: 0.33,
    tmax: 520, gears: [3.3, 2.4, 1.8, 1.45, 1.2, 1.0, 0.85], final: 3.5, redline: 8800, idle: 950, tank: 60, burn: 1.9, color: 0xffc400, grip: 1.25, cyl: 8, awd: false, cdA: 0.55 },
  { id: 'ghost', name: 'Ghost 900 Motorcycle', blurb: 'Two wheels, lots of power. Lean into corners.', price: 14000, mass: 230, L: 1.45, W: 0.8, len: 2.1, hgt: 1.15, wr: 0.31, bike: true,
    tmax: 120, gears: [2.8, 1.9, 1.45, 1.15, 0.95, 0.8], final: 4.3, redline: 11000, idle: 1100, tank: 17, burn: 0.55, color: 0x1f6fb5, grip: 1.1, cyl: 4, awd: false, cdA: 0.4 },
  { id: 'wavecrest', name: 'Wavecrest Speedboat', blurb: 'Sail the river. Only works on water.', price: 38000, mass: 1100, L: 3.6, W: 2.2, len: 5.5, hgt: 1.3, wr: 0.3, boat: true,
    tmax: 360, gears: [2.2, 1.4, 1.0, 0.8], final: 3.0, redline: 6000, idle: 800, tank: 80, burn: 2.2, color: 0xe8eef2, grip: 1.0, cyl: 6, awd: true, cdA: 0.7 },
];
export const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];

/* ------------------------------------------------------------------ */
/* Visual model                                                         */
/* ------------------------------------------------------------------ */
/** Push hull vertices inward near a local-space impact point. */
export function dentHull(m, localPoint, dir, amount) {
  const pos = m.hullGeo.attributes.position;
  const hullOffsetY = m.hull.position.y;
  const R = 1.7;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i) + hullOffsetY, z = pos.getZ(i);
    const d = Math.hypot(x - localPoint.x, y - localPoint.y, z - localPoint.z);
    if (d < R) {
      const f = (1 - d / R) ** 2 * amount * (0.7 + 0.6 * Math.random());
      pos.setXYZ(i, x + dir.x * f, y - hullOffsetY + dir.y * f * 0.4, z + dir.z * f);
    }
  }
  pos.needsUpdate = true;
  m.hullGeo.computeVertexNormals();
}
export function resetHull(m) {
  const o = m.hullGeo.userData.orig;
  m.hullGeo.attributes.position.array.set(o);
  m.hullGeo.attributes.position.needsUpdate = true;
  m.hullGeo.computeVertexNormals();
}

/* ------------------------------------------------------------------ */
/* Soft particles (tyre smoke / engine smoke)                           */
/* ------------------------------------------------------------------ */
export class Fx {
  constructor(scene) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    this.tex = new THREE.CanvasTexture(c);
    this.items = [];
    for (let i = 0; i < 48; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s);
      this.items.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), size: 1, grow: 1 });
    }
    this.next = 0;
  }
  emit(p, vel, color, size, life, grow = 2.2) {
    const it = this.items[this.next++ % this.items.length];
    it.s.position.copy(p); it.vel.copy(vel); it.size = size; it.life = it.max = life; it.grow = grow;
    it.s.material.color.set(color); it.s.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) { it.s.visible = false; continue; }
      const k = 1 - it.life / it.max;
      it.s.position.addScaledVector(it.vel, dt);
      it.s.scale.setScalar(it.size * (1 + k * it.grow));
      it.s.material.opacity = (1 - k) * 0.55;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Vehicle: drivetrain + tyre model + suspension                        */
/* ------------------------------------------------------------------ */
export class Vehicle {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.def = CARS[0];
    this.s = { x: 0, z: 0, y: 1, yaw: 0, vx: 0, vz: 0, vy: 0, w: 0, pitch: 0, pitchV: 0, roll: 0, rollV: 0 };
    this.comp = [0, 0, 0, 0];
    this.ctrl = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.engine = { state: 'off', rpm: 0, crank: 0 };
    this.gear = 1; this.auto = true; this.shiftTimer = 0; this.shiftCool = 0;
    this.fuel = 30; this.damage = { front: 0, rear: 0, left: 0, right: 0, engine: 0 };
    this.steerAngle = 0; this.surface = { mu: 1, road: true };
    this.wet = 0; this.axPrev = 0; this.alPrev = 0; this.wheelSpin = 0;
    this.lights = { head: false, ind: 0, blink: false, blinkT: 0, brake: false, reverse: false };
    this.t = { speedKph: 0, rpm: 0, slip: 0, wheelspin: 0, locked: false, grounded: 1, impact: 0 };
    this.events = [];
    this.model = null; this.holder = new THREE.Group(); scene.add(this.holder);
    this.setModel(CARS[0]);
  }

  setModel(def, saved) {
    if (this.model) this.holder.remove(this.model.root);
    this.def = def;
    this.up = { engine: 0, tires: 0, brakes: 0, ...(saved?.up || {}) };
    this.paint = saved?.paint ?? def.color;
    this.model = createCarMesh(def, { paintColor: this.paint });
    this.holder.add(this.model.root);
    this.model.root.rotation.order = 'YXZ';
    this.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.fuel = saved?.fuel ?? def.tank * 0.6;
    this.damage = saved?.damage ? { ...saved.damage } : { front: 0, rear: 0, left: 0, right: 0, engine: 0 };
    this.engine = { state: 'off', rpm: 0, crank: 0 };
    this.gear = 1;
    this.m = def.mass;
    this.Iz = def.mass * def.L * 0.46 * def.L * 0.54 * 1.2;
    this.Ip = def.mass * (def.L * 0.34) ** 2; this.Ir = def.mass * (def.W * 0.4) ** 2;
    this.hcg = 0.55;
    this.applyDamageVisual();
    this.applyLights();
  }

  place(x, z, yaw) {
    Object.assign(this.s, { x, z, yaw, vx: 0, vz: 0, vy: 0, w: 0, pitch: 0, roll: 0, pitchV: 0, rollV: 0 });
  }

  get damageTotal() { const d = this.damage; return (d.front + d.rear + d.left + d.right + d.engine) / 5; }
  get perf() { return lerp(1, 0.25, this.damage.engine); }
  get speed() { return Math.hypot(this.s.vx, this.s.vz); }
  get fwd() { return [Math.sin(this.s.yaw), Math.cos(this.s.yaw)]; }

  /* --- engine ------------------------------------------------------ */
  toggleIgnition() {
    const e = this.engine;
    if (e.state === 'off') {
      if (this.fuel <= 0.01) { this.events.push('nofuel'); return; }
      if (this.damage.engine > 0.95) { this.events.push('engine-dead'); return; }
      e.state = 'starting'; e.crank = 0; this.events.push('crank');
    } else {
      e.state = 'off'; this.events.push('stop');
    }
  }
  torque(rpm) {
    const x = clamp(rpm / this.def.redline, 0, 1.1);
    return this.def.tmax * (1 + 0.1 * this.up.engine) * Math.max(0.15, 0.55 + 1.9 * x - 1.9 * x * x);
  }
  shiftUp() { if (this.auto) return; const n = this.def.gears.length; if (this.gear < n) this.setGear(this.gear + 1); }
  shiftDown() { if (this.auto) return; if (this.gear > -1) this.setGear(this.gear - 1); }
  setGear(g) { this.gear = g; this.shiftTimer = 0.22; this.events.push('shift'); }
  toggleAuto() { this.auto = !this.auto; if (this.auto && this.gear < 1 && this.speed < 1) this.gear = 1; }

  /* --- main step --------------------------------------------------- */
  update(dt, world) {
    this.world = world;
    this.surface = world.surfaceAt(this.s.x, this.s.z, this.surface);
    if (this.def.boat) { this.surface.mu = 0.32; this.surface.road = false; }
    this.drivetrain(dt);
    const n = Math.max(1, Math.min(6, Math.ceil(dt / (1 / 120))));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.step(h, world);
    this.collideStatic(world);
    this.updateVisual(dt);
    this.updateLights(dt);
    this.updateFx(dt);
    this.t.speedKph = this.speed * 3.6;
    this.t.rpm = this.engine.rpm;
  }

  drivetrain(dt) {
    const d = this.def, e = this.engine, c = this.ctrl, s = this.s;
    const [fx, fz] = this.fwd;
    const vF = s.vx * fx + s.vz * fz;
    const speed = Math.abs(vF);

    // Steering (speed-sensitive, slewed)
    const maxSteer = d.bike ? lerp(0.5, 0.05, smoothstep(0, 40, speed)) : lerp(0.58, 0.075, smoothstep(0, 55, speed));
    const target = -c.steer * maxSteer + (this.damage.right - this.damage.left) * 0.06;
    this.steerAngle += clamp(target - this.steerAngle, -dt * 2.6, dt * 2.6);

    // Automatic gear selection
    let thr = c.throttle, brk = c.brake;
    if (this.auto) {
      if (speed < 0.8) {
        if (c.brake > 0.2 && c.throttle < 0.1 && this.gear >= 0) { this.gear = -1; }
        else if (c.throttle > 0.2 && c.brake < 0.1 && this.gear <= 0) { this.gear = 1; }
      }
      if (this.gear < 0) { thr = c.brake; brk = c.throttle; }
    }
    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    this.shiftCool = Math.max(0, this.shiftCool - dt);

    const ratio = this.gear > 0 ? d.gears[this.gear - 1] * d.final : this.gear < 0 ? 3.3 * d.final : 0;
    const wheelRpm = (speed / d.wr) * 60 / (2 * Math.PI) * ratio;

    if (e.state === 'starting') {
      e.crank += dt;
      e.rpm = lerp(e.rpm, 230 + Math.sin(e.crank * 38) * 40, 1 - Math.exp(-10 * dt));
      if (e.crank > 1.3) { e.state = 'running'; e.rpm = 1300; this.events.push('started'); }
      thr = 0;
    }

    this.driveReq = 0; this.brakeReq = brk;
    if (e.state === 'running') {
      if (this.fuel <= 0) { e.state = 'off'; this.events.push('stop'); this.events.push('nofuel'); }
      const idle = d.idle;
      if (this.auto && this.gear > 0 && this.shiftCool <= 0 && this.shiftTimer <= 0) {
        const upRpm = lerp(0.46, 0.9, thr) * d.redline;
        const lowRatio = this.gear > 1 ? d.gears[this.gear - 2] * d.final : 0;
        const rpmLower = lowRatio ? (speed / d.wr) * 60 / (2 * Math.PI) * lowRatio : 0;
        if (e.rpm > upRpm && this.gear < d.gears.length && thr > 0.02) { this.setGear(this.gear + 1); this.shiftCool = 0.6; }
        else if (this.gear > 1 && ((e.rpm < lerp(0.2, 0.34, thr) * d.redline) || (thr > 0.85 && rpmLower < 0.82 * d.redline && e.rpm < 0.5 * d.redline))) {
          this.setGear(this.gear - 1); this.shiftCool = 0.5;
        }
      }
      let targetRpm;
      if (ratio === 0 || this.shiftTimer > 0) targetRpm = idle + thr * (d.redline - idle) * 0.92;
      else targetRpm = Math.max(idle, wheelRpm);
      // clutch slip when launching
      const slipping = ratio !== 0 && wheelRpm < idle * 1.15;
      if (slipping) targetRpm = idle + thr * (d.redline * 0.35 - idle);
      e.rpm = lerp(e.rpm, targetRpm, 1 - Math.exp(-(ratio === 0 ? 8 : 16) * dt));
      e.rpm = clamp(e.rpm, 0, d.redline * 1.02);

      // Manual stall
      if (!this.auto && this.gear !== 0 && !slipping && wheelRpm < 420 && speed < 3 && this.gear > 1) {
        e.state = 'off'; this.events.push('stall'); this.events.push('stop');
      }
      const limiter = e.rpm >= d.redline ? 0 : 1;
      let T = this.torque(e.rpm) * thr * this.perf * limiter * (slipping ? 0.7 : 1) * (this.shiftTimer > 0 ? 0 : 1);
      const dir = this.gear < 0 ? -1 : 1;
      if (ratio !== 0) {
        this.driveReq = dir * T * ratio * 0.9 / d.wr;
        if (thr < 0.03 && !slipping) {
          const eb = 55 * (e.rpm / d.redline) * ratio * 0.9 / d.wr; // engine braking
          this.driveReq = -Math.sign(vF || dir) * Math.min(eb, 2500);
        }
      }
      // fuel
      const rf = e.rpm / d.redline;
      this.fuel = Math.max(0, this.fuel - d.burn * FUEL_SCALE * (0.0004 + 0.009 * thr * rf * (limiter ? 1 : 0) + 0.0006 * rf) * dt);
    } else if (e.state === 'off') {
      e.rpm = lerp(e.rpm, 0, 1 - Math.exp(-6 * dt));
    }
  }

  step(h, world) {
    const d = this.def, s = this.s, m = this.m;
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    const fx = sy, fz = cy, lx = cy, lz = -sy;
    let vF = s.vx * fx + s.vz * fz;
    let vL = s.vx * lx + s.vz * lz;
    const a = d.L * 0.46, b = d.L * 0.54, tw = d.W - 0.22;

    // --- suspension & ground contact -----------------------------------
    const corners = [[a, tw / 2], [a, -tw / 2], [-b, tw / 2], [-b, -tw / 2]];
    const gy = [];
    let contacts = 0, sumF = 0, tauP = 0, tauR = 0;
    const kBase = (m / 4) * (2 * Math.PI * 1.55) ** 2;
    const cBase = 2 * 0.38 * Math.sqrt(kBase * m / 4);
    for (let i = 0; i < 4; i++) {
      const [lzi, lxi] = corners[i];
      const px = s.x + fx * lzi + lx * lxi, pz = s.z + fz * lzi + lz * lxi;
      const g = d.boat ? Math.max(world.terrainH(px, pz), -3.0) : world.heightAt(px, pz, s.y - 0.45);
      gy.push(g);
      const cornerY = s.y + lzi * s.pitch + lxi * s.roll;
      const comp = (g + 0.62) - cornerY;
      const v = (comp - this.comp[i]) / h; this.comp[i] = comp;
      if (comp > 0) {
        contacts++;
        const axleScale = lzi > 0 ? (2 * b / d.L) : (2 * a / d.L);
        let F = (kBase * comp + cBase * clamp(v, -3, 3)) * axleScale;
        if (comp > 0.26) F += 5 * kBase * (comp - 0.26) * axleScale;
        F = Math.max(0, F);
        sumF += F; tauP += F * lzi; tauR += F * lxi;
      }
    }
    const grounded = contacts / 4; this.t.grounded = grounded;
    const slopeF = ((gy[0] + gy[1]) - (gy[2] + gy[3])) / (2 * d.L);
    const slopeL = ((gy[0] + gy[2]) - (gy[1] + gy[3])) / (2 * tw);

    s.vy += (sumF / m - G) * h;
    s.y += s.vy * h;
    s.pitchV += ((tauP + m * this.axPrev * this.hcg) / this.Ip) * h;
    s.rollV += ((tauR + m * this.alPrev * this.hcg) / this.Ir) * h;
    s.pitchV *= 1 - Math.min(1, 1.2 * h); s.rollV *= 1 - Math.min(1, 1.2 * h);
    s.pitch = clamp(s.pitch + s.pitchV * h, -0.45, 0.45);
    s.roll = clamp(s.roll + s.rollV * h, -0.45, 0.45);

    // --- tyre forces --------------------------------------------------
    let Fx = 0, Fy = 0, tau = 0;
    if (grounded > 0) {
      const mu = this.surface.mu * d.grip * (1 + 0.06 * this.up.tires) * (this.surface.road ? 1 - 0.4 * this.wet : 1 - 0.18 * this.wet);
      const Nf = Math.max(0, m * G * b / d.L - m * this.axPrev * this.hcg / d.L) * grounded;
      const Nr = Math.max(0, m * G * a / d.L + m * this.axPrev * this.hcg / d.L) * grounded;
      const sgn = vF >= 0 ? 1 : -1;
      const vAbs = Math.max(Math.abs(vF), 1.2);
      const delta = this.steerAngle;
      const alphaF = Math.atan2(vL + a * s.w, vAbs) - delta * sgn;
      const alphaR = Math.atan2(vL - b * s.w, vAbs);

      // Longitudinal
      const spdBlend = smoothstep(0, 1.5, Math.abs(vF));
      let drive = this.driveReq;
      const capTotal = mu * (Nf + Nr);
      const capDrive = d.awd ? capTotal : mu * Nr;
      let spin = 0;
      if (Math.abs(drive) > capDrive) { spin = (Math.abs(drive) - capDrive) / capDrive; drive = Math.sign(drive) * capDrive * 0.88; }
      this.t.wheelspin = spin;
      let brake = this.brakeReq * m * G * 0.95 * (1 + 0.08 * this.up.brakes) * grounded;
      this.t.locked = false;
      if (brake > capTotal * 0.98) { brake = capTotal * 0.85; this.t.locked = this.brakeReq > 0.9 && Math.abs(vF) > 6; }
      const brakeApplied = Math.min(brake, Math.abs(vF) * m / h) * Math.sign(vF || 1);
      const hand = this.ctrl.handbrake ? Math.min(mu * Nr * 0.9, Math.abs(vF) * m / h * 0.5) * Math.sign(vF || 1) : 0;
      const roll = 0.015 * m * G * Math.sign(vF) * spdBlend;
      const drag = 0.5 * 1.2 * (d.cdA || 0.7) * vF * Math.abs(vF) + (d.boat ? vF * Math.abs(vF) * 4.5 + vF * 150 : 0);

      const FxF = (d.awd ? 0.4 * drive : 0) - 0.65 * brakeApplied;
      const FxR = (d.awd ? 0.6 * drive : drive) - 0.35 * brakeApplied - hand;
      const rearScale = this.ctrl.handbrake ? 0.38 : 1;

      let capF = Math.sqrt(Math.max(0, (mu * Nf) ** 2 - FxF ** 2)); capF = Math.max(capF, 0.2 * mu * Nf);
      let capR = Math.sqrt(Math.max(0, (mu * Nr * rearScale) ** 2 - FxR ** 2)); capR = Math.max(capR, 0.12 * mu * Nr);
      const sat = (C, al, cap) => {
        if (cap < 1) return 0;
        let f = cap * Math.tanh(C * al / cap);
        f *= 1 - 0.22 * smoothstep(0.2, 0.6, Math.abs(al));
        return -f;
      };
      const Fyf = sat(8.0 * Nf, alphaF, capF);
      const Fyr = sat(9.0 * Nr * rearScale, alphaR, capR);
      const lowSpeed = spdBlend;
      Fx = FxF + FxR - roll - drag - Fyf * Math.sin(delta);
      Fy = (Fyf * Math.cos(delta) + Fyr) * lowSpeed;
      tau = (a * Fyf * Math.cos(delta) - b * Fyr) * lowSpeed;
      this.t.slip = Math.max(Math.abs(alphaR), Math.abs(alphaF)) * lowSpeed;
      this.wheelSpin += (vF / d.wr) * h * (1 + spin * 2.5);
      this.rearSlipForce = Math.abs(Fyr) / Math.max(1, mu * Nr);
    }
    // slopes
    const aF = Fx / m - G * slopeF * grounded;
    const aL = Fy / m - G * slopeL * grounded;
    s.vx += (fx * aF + lx * aL) * h;
    s.vz += (fz * aF + lz * aL) * h;
    s.w += (tau / this.Iz) * h;
    this.axPrev = lerp(this.axPrev, aF, Math.min(1, h * 10));
    this.alPrev = lerp(this.alPrev, aL, Math.min(1, h * 10));

    // Low speed: kinematic steering & lateral stabilisation
    vF = s.vx * fx + s.vz * fz; vL = s.vx * lx + s.vz * lz;
    const blend = (1 - smoothstep(1.5, 5, Math.abs(vF))) * grounded;
    if (blend > 0) {
      s.w = lerp(s.w, vF * Math.tan(this.steerAngle) / d.L, blend * Math.min(1, h * 14));
      const k = blend * Math.min(1, h * 12);
      s.vx -= lx * vL * k; s.vz -= lz * vL * k;
    }
    // Parked
    if (this.speed < 0.12 && this.driveReq === 0 && this.brakeReq < 0.01 && Math.abs(slopeF) < 0.1) { s.vx = s.vz = 0; s.w = 0; }
    if (this.ctrl.brake > 0.01 && this.speed < 0.25 && !(this.auto && this.gear < 0)) { s.vx = s.vz = 0; }

    s.x += s.vx * h; s.z += s.vz * h; s.yaw = wrapPi(s.yaw + s.w * h);

    // world edge
    const E = 3940;
    if (Math.abs(s.x) > E) { s.x = Math.sign(s.x) * E; s.vx *= -0.3; }
    if (Math.abs(s.z) > E) { s.z = Math.sign(s.z) * E; s.vz *= -0.3; }
    // safety: fell through
    if (s.y < -30) { s.y = world.heightAt(s.x, s.z, 5) + 1; s.vy = 0; }
  }

  /* --- collisions -------------------------------------------------- */
  collideStatic(world) {
    const s = this.s, d = this.def;
    const [fx, fz] = this.fwd;
    if (d.boat) {                                   // river banks act as walls
      for (const off of [d.len * 0.45, 0, -d.len * 0.45]) {
        const cx = s.x + fx * off, cz = s.z + fz * off;
        if (world.terrainH(cx, cz) > -1.4) { const sp = this.speed; s.x -= s.vx * 0.06; s.z -= s.vz * 0.06; if (sp > 3) this.crash(Math.min(sp, 12) * 0.5, cx, cz, -fx, -fz); s.vx *= -0.25; s.vz *= -0.25; s.w *= 0.5; break; }
      }
      return;
    }
    const r = d.W / 2 + 0.04;
    const offs = [d.len / 2 - r, 0, -(d.len / 2 - r)];
    for (const off of offs) {
      const cx = s.x + fx * off, cz = s.z + fz * off;
      const list = world.queryColliders(cx, cz, r + 0.2, s.y);
      for (const c of list) {
        const qx = clamp(cx, c.minX, c.maxX), qz = clamp(cz, c.minZ, c.maxZ);
        let dx = cx - qx, dz = cz - qz, dist = Math.hypot(dx, dz);
        if (dist >= r) continue;
        let nx, nz, pen;
        if (dist < 1e-4) { // centre inside box: push out the shortest way
          const l = cx - c.minX, rr = c.maxX - cx, t = cz - c.minZ, bt = c.maxZ - cz;
          const mn = Math.min(l, rr, t, bt);
          if (mn === l) { nx = -1; nz = 0; } else if (mn === rr) { nx = 1; nz = 0; } else if (mn === t) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
          pen = mn + r;
        } else { nx = dx / dist; nz = dz / dist; pen = r - dist; }
        this.hit(nx, nz, pen, cx, cz, 0.15);
      }
    }
  }

  /** Resolve a contact with outward normal (nx,nz) pointing away from the obstacle. */
  hit(nx, nz, pen, cx, cz, restitution, otherVx = 0, otherVz = 0) {
    const s = this.s;
    s.x += nx * pen; s.z += nz * pen;
    const rvx = s.vx - otherVx, rvz = s.vz - otherVz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) {
      const j = -(1 + restitution) * vn;
      s.vx += nx * j; s.vz += nz * j;
      // friction along the surface
      s.vx *= 0.985; s.vz *= 0.985;
      const rx = cx - s.x, rz = cz - s.z;
      s.w += ((rz * nx * j - rx * nz * j) / (this.Iz / this.m)) * 0.6;
      s.w = clamp(s.w, -3, 3);
      const impact = -vn;
      if (impact > 2) this.crash(impact, cx, cz, nx, nz);
    }
  }

  crash(impact, cx, cz, nx, nz) {
    this._lastImp = impact.toFixed(1);
    const s = this.s;
    this.t.impact = Math.max(this.t.impact, impact);
    this.events.push(impact > 8 ? 'crash-big' : 'crash');
    // convert to local frame
    const dx = cx - s.x, dz = cz - s.z;
    const lzp = dx * Math.sin(s.yaw) + dz * Math.cos(s.yaw);
    const lxp = dx * Math.cos(s.yaw) - dz * Math.sin(s.yaw);
    const dmg = clamp(Math.pow(Math.max(0, impact - 2), 1.25) * 0.012, 0, 0.5);
    const zone = Math.abs(lzp) > Math.abs(lxp) ? (lzp > 0 ? 'front' : 'rear') : (lxp > 0 ? 'left' : 'right');
    this.damage[zone] = clamp(this.damage[zone] + dmg, 0, 1);
    if (zone === 'front') this.damage.engine = clamp(this.damage.engine + dmg * 0.7, 0, 1);
    else if (zone === 'rear') this.damage.engine = clamp(this.damage.engine + dmg * 0.15, 0, 1);
    else this.damage.engine = clamp(this.damage.engine + dmg * 0.1, 0, 1);
    // local direction of push (into the car)
    const ldx = -(nx * Math.cos(s.yaw) - nz * Math.sin(s.yaw));
    const ldz = -(nx * Math.sin(s.yaw) + nz * Math.cos(s.yaw));
    dentHull(this.model, new THREE.Vector3(lxp, 0, lzp), new THREE.Vector3(ldx, 0, ldz), clamp(impact * 0.05, 0.04, 0.45));
    this.applyDamageVisual();
    if (this.damage.engine > 0.97 && this.engine.state !== 'off') { this.engine.state = 'off'; this.events.push('stop'); }
  }

  applyDamageVisual() {
    const k = clamp(this.damageTotal * 1.6, 0, 1);
    const base = new THREE.Color(this.paint);
    this.model.mats.paint.color.copy(base).lerp(new THREE.Color(0x25201c), k * 0.55);
    this.model.mats.paint.roughness = lerp(0.28, 0.7, k);
  }

  setPaint(c) { this.paint = c; this.applyDamageVisual(); }

  repair() {
    for (const k of Object.keys(this.damage)) this.damage[k] = 0;
    resetHull(this.model);
    this.applyDamageVisual();
  }

  /* --- visuals ----------------------------------------------------- */
  updateVisual(dt) {
    const s = this.s, m = this.model, d = this.def;
    m.root.position.set(s.x, s.y, s.z);
    m.root.rotation.set(0, s.yaw, 0);
    if (d.bike) { this.lean = lerp(this.lean || 0, clamp(-this.steerAngle * this.speed * 0.05, -0.6, 0.6), Math.min(1, dt * 6)); m.root.rotation.z = this.lean; }
    m.body.rotation.set(-s.pitch, 0, s.roll);
    // wheels: stay on the ground
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
    for (const w of m.wheels) {
      const px = s.x + sy * w.lz + cy * w.lx, pz = s.z + cy * w.lz - sy * w.lx;
      const g = this.world ? this.world.heightAt(px, pz, s.y - 0.45) : s.y - 0.5;
      const target = clamp(g + d.wr - s.y, -0.62, -0.28);
      w.steer.position.set(w.lx, lerp(w.steer.position.y, target, Math.min(1, dt * 30)), w.lz);
      w.steer.rotation.y = w.front ? this.steerAngle : 0;
      const [fx, fz] = this.fwd;
      w.spin.rotation.x += ((s.vx * fx + s.vz * fz) / d.wr) * dt * (w.front ? 1 : 1 + this.t.wheelspin * 2);
    }
    m.wheelMesh.rotation.z = -this.steerAngle * 5.5;
    m.driverHead.rotation.y = this.steerAngle * 1.2; m.driverHair.rotation.y = this.steerAngle * 1.2;
    m.driver.rotation.z = -this.steerAngle * 0.12;
  }

  updateLights(dt) {
    const L = this.lights, M = this.model.mats;
    L.blinkT += dt;
    if (L.ind) { if (L.blinkT > 0.38) { L.blinkT = 0; L.blink = !L.blink; this.events.push(L.blink ? 'tick' : 'tock'); } }
    else { L.blink = false; L.blinkT = 0; }
    L.brake = this.ctrl.brake > 0.05 && !(this.auto && this.gear < 0 && this.ctrl.brake > 0) || this.ctrl.handbrake;
    L.reverse = this.gear < 0 && this.engine.state === 'running';
    this.applyLights();
  }
  applyLights() {
    const L = this.lights, M = this.model.mats;
    M.head.emissiveIntensity = L.head ? 3 : 0;
    M.tail.emissiveIntensity = L.brake ? 3.2 : L.head ? 1.1 : 0;
    const left = L.blink && (L.ind === 1 || L.ind === 3), right = L.blink && (L.ind === 2 || L.ind === 3);
    M.indL.emissiveIntensity = left ? 4 : 0; M.indR.emissiveIntensity = right ? 4 : 0;
    for (const b of this.model.beams) b.intensity = L.head ? 4000 : 0;
    const nt = this.night ?? 1;
    for (const bm of this.model.beamMats) bm.uniforms.uOn.value = L.head ? 0.25 + 0.75 * nt : 0;
  }
  setIndicator(v) { this.lights.ind = this.lights.ind === v ? 0 : v; this.lights.blinkT = 1; }

  updateFx(dt) {
    const s = this.s, d = this.def;
    this._fxT = (this._fxT || 0) - dt;
    if (this._fxT > 0) return;
    this._fxT = 0.04;
    const [fx, fz] = this.fwd;
    if (d.boat) {
      if (this.speed > 2.5) this.fx.emit(new THREE.Vector3(s.x - fx * d.len * 0.45, -2.9, s.z - fz * d.len * 0.45), new THREE.Vector3(-fx * 2, 0.3, -fz * 2), 0xeaf6ff, 0.5, 1.2, 3);
      return;
    }
    const slide = this.t.slip > 0.28 && this.speed > 6 && this.t.grounded > 0.5;
    if (slide || this.t.wheelspin > 0.15 || this.t.locked) {
      for (const side of [-1, 1]) {
        const lx = Math.cos(s.yaw) * side * (d.W / 2 - 0.2), lz = -Math.sin(s.yaw) * side * (d.W / 2 - 0.2);
        const p = new THREE.Vector3(s.x + lx - fx * d.L * 0.54, s.y - 0.4, s.z + lz - fz * d.L * 0.54);
        const col = this.surface.road ? 0xdddddd : 0xb7a37a;
        this.fx.emit(p, new THREE.Vector3(s.vx * 0.15, 0.8, s.vz * 0.15), col, 1.0, 1.1);
      }
    }
    if (this.damage.engine > 0.55 && this.engine.state !== 'off') {
      const p = new THREE.Vector3(s.x + fx * d.len * 0.35, s.y + 0.5, s.z + fz * d.len * 0.35);
      this.fx.emit(p, new THREE.Vector3(0, 1.6, 0), this.damage.engine > 0.8 ? 0x111111 : 0x777777, 0.6, 1.6, 3);
    }
    if (this.engine.state === 'running' && this.engine.rpm > 0) {
      const p = new THREE.Vector3(s.x - fx * (d.len / 2 + 0.05) + Math.cos(s.yaw) * 0.5, s.y - 0.35, s.z - fz * (d.len / 2 + 0.05) - Math.sin(s.yaw) * 0.5);
      if (Math.random() < 0.3 + this.ctrl.throttle * 0.5) this.fx.emit(p, new THREE.Vector3(-fx * 1, 0.25, -fz * 1), 0x888888, 0.2, 0.7, 2);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Tyre marks                                                           */
/* ------------------------------------------------------------------ */
export class Skids {
  constructor(scene) {
    this.max = 900; this.i = 0; this.last = [null, null, null, null];
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6, fog: true });
    this.im = new THREE.InstancedMesh(geo, mat, this.max); this.im.count = 0; this.im.frustumCulled = false; this.o = new THREE.Object3D(); scene.add(this.im);
  }
  add(x0, z0, x1, z1, y) {
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz); if (len < 0.15) return;
    this.o.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); this.o.rotation.set(0, Math.atan2(dx, dz), 0); this.o.scale.set(0.22, 1, len + 0.05); this.o.updateMatrix();
    this.im.setMatrixAt(this.i % this.max, this.o.matrix); this.i++; this.im.count = Math.min(this.i, this.max); this.im.instanceMatrix.needsUpdate = true;
  }
  update(v) {
    const d = v.def, s = v.s, sy = Math.sin(s.yaw), cy = Math.cos(s.yaw), t = v.t;
    const sliding = v.surface.road && !d.boat && t.grounded > 0.5 && v.speed > 4 && (t.slip > 0.3 || t.locked || t.wheelspin > 0.3);
    const a = d.L * 0.46, b = d.L * 0.54, tw = d.W - 0.22;
    const corners = [[a, tw / 2], [a, -tw / 2], [-b, tw / 2], [-b, -tw / 2]];
    corners.forEach(([lz, lx], i) => {
      if (d.bike && Math.abs(lx) > 0.01 && i % 2) { this.last[i] = null; return; }
      const front = i < 2, want = sliding && (!front || t.locked);
      if (!want) { this.last[i] = null; return; }
      const x = s.x + sy * lz + cy * lx, z = s.z + cy * lz - sy * lx, p = this.last[i];
      if (p && Math.hypot(x - p[0], z - p[1]) < 4) this.add(p[0], p[1], x, z, 0.1);
      this.last[i] = [x, z];
    });
  }
}

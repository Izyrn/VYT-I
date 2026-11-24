import * as THREE from 'three';
import { clamp, lerp, smoothstep, wrapPi } from './util.js';
import { createHuman } from './human.js';

const box = new THREE.BoxGeometry(1, 1, 1);

function planeMesh() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.35, metalness: 0.2 }), red = new THREE.MeshStandardMaterial({ color: 0xc0252b, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7 }), glass = new THREE.MeshStandardMaterial({ color: 0x0c141c, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.5, depthWrite: false });
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1, parent = body) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; parent.add(o); return o; };
  add(new THREE.CapsuleGeometry(0.85, 5.2, 6, 14).rotateX(Math.PI / 2), white, 0, 0, 0, 1, 1.05, 1);        // fuselage
  add(new THREE.CylinderGeometry(0.88, 0.88, 0.22, 16).rotateX(Math.PI / 2), red, 0, 0, 1.3);               // stripe
  add(box, white, 0, 0.18, 0.5, 11.2, 0.12, 1.5); add(box, red, 0, 0.18, 0.5, 2.0, 0.125, 1.52);           // wing
  add(box, white, 0, 0.35, -3.6, 3.6, 0.09, 0.9); add(box, white, 0, 1.0, -3.55, 0.1, 1.4, 1.1);            // tail plane + fin
  add(box, glass, 0, 0.62, 0.7, 1.3, 0.55, 1.6).rotation.x = -0.12;                                          // canopy
  const prop = new THREE.Group(); prop.position.set(0, 0, 3.25); body.add(prop);
  add(new THREE.CylinderGeometry(0.17, 0.2, 0.4, 12).rotateX(Math.PI / 2), dark, 0, 0, 0, 1, 1, 1, prop);
  add(box, dark, 0, 0, 0, 0.2, 2.5, 0.05, prop); const blur = add(new THREE.CircleGeometry(1.3, 24), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }), 0, 0, 0.05, 1, 1, 1, prop); void blur;
  // landing gear
  const wm = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }), wg = new THREE.CylinderGeometry(0.32, 0.32, 0.2, 14).rotateZ(Math.PI / 2);
  for (const [x, z] of [[1.3, 0.7], [-1.3, 0.7], [0, 2.4]]) { add(box, dark, x, -0.65, z, 0.08, 0.9, 0.08); const w = new THREE.Mesh(wg, wm); w.position.set(x, -1.1, z); body.add(w); }
  const pilot = createHuman({ female: false, shirt: 0x2f5d9a, hairStyle: 'cap', longSleeve: true, shorts: false }); pilot.group.scale.setScalar(0.85); pilot.group.position.set(0, 0.62 - pilot.hipY * 0.85, 0.75); pilot.pose(0, 0, 'sit'); body.add(pilot.group);
  g.userData = { prop, body };
  return g;
}

/**
 * Light-aircraft flight model (arcade): thrust, drag, stall, banked turns and ground handling.
 * Keys: Shift/Ctrl throttle, W/S pitch, A/D roll (steer on the ground), Q/E rudder, Space brake.
 */
export class Flight {
  constructor(scene, world, hooks) {
    this.scene = scene; this.world = world; this.hooks = hooks;      // hooks: { toast, crash }
    this.mesh = planeMesh(); scene.add(this.mesh);
    this.park = { x: -2290, z: 1458, yaw: Math.PI / 2 };
    this.s = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, v: 0, vy: 0, thr: 0, prop: 0 };
    this.active = false; this.onGround = true; this.reset();
  }
  reset() {
    const p = this.park, s = this.s; s.x = p.x; s.z = p.z; s.yaw = p.yaw; s.pitch = 0; s.roll = 0; s.v = 0; s.vy = 0; s.thr = 0;
    s.y = this.world.heightAt(s.x, s.z, 5) + 1.18; this.onGround = true; this.sync();
  }
  near(x, z, r = 9) { return !this.active && Math.hypot(x - this.s.x, z - this.s.z) < r; }
  board() { this.active = true; this.hooks.toast('In the air! Shift/Ctrl throttle · W/S pitch · A/D roll · Q/E rudder · Space brake · G to exit when stopped'); }
  exitSpot() { const s = this.s; return { x: s.x + Math.cos(s.yaw) * 6.5, z: s.z - Math.sin(s.yaw) * 6.5 }; }
  get speedKph() { return this.s.v * 3.6; }
  get alt() { return Math.max(0, this.s.y - this.world.heightAt(this.s.x, this.s.z, this.s.y) - 1.18); }
  sync() {
    const s = this.s, m = this.mesh; m.position.set(s.x, s.y, s.z); m.rotation.order = 'YXZ'; m.rotation.set(-s.pitch, s.yaw, s.roll);
    s.prop += (s.thr * 40 + 6) * 0.016; m.userData.prop.rotation.z = s.prop * 6;
  }

  update(dt, keys) {
    const s = this.s, W = this.world;
    if (!this.active) { this.sync(); return; }
    const up = (k) => (keys.has(k) ? 1 : 0), thrIn = up('ShiftLeft') - up('ControlLeft'), pitchIn = up('KeyS') - up('KeyW'), rollIn = up('KeyD') - up('KeyA'), yawIn = up('KeyQ') - up('KeyE');
    s.thr = clamp(s.thr + thrIn * dt * 0.5, 0, 1);
    const gy = W.heightAt(s.x, s.z, s.y + 2) + 1.18, onGround = s.y <= gy + 0.05 && s.vy <= 0.5;
    this.onGround = onGround;
    const stall = smoothstep(16, 32, s.v), auth = clamp(s.v / 24, 0.2, 1);
    // speed
    const thrust = s.thr * 9.5 * (1 - s.v / 95), drag = 0.0011 * s.v * s.v + (onGround ? 0.5 + (keys.has('Space') ? 9 : 0) : 0);
    s.v = Math.max(0, s.v + (thrust - drag - 9.81 * Math.sin(s.pitch)) * dt);
    // attitude
    if (onGround) {
      s.roll += (0 - s.roll) * Math.min(1, dt * 4);
      s.yaw += -rollIn * 0.55 * Math.min(1, s.v / 9) * dt;                                       // nose-wheel steering
      const rot = s.v > 30 ? pitchIn * 0.5 : 0;
      s.pitch += (rot - s.pitch) * Math.min(1, dt * 2.5);
      s.y = gy;
      if (s.v > 32 && pitchIn > 0) { s.vy = 2; s.y = gy + 0.2; this.onGround = false; }
    } else {
      s.roll = clamp(s.roll + rollIn * 1.4 * auth * dt, -1.25, 1.25);
      if (!rollIn) s.roll *= 1 - dt * 0.7;
      s.pitch = clamp(s.pitch + pitchIn * 0.85 * auth * dt, -0.9, 0.9);
      if (!pitchIn) s.pitch *= 1 - dt * 0.25;
      s.yaw += (-Math.tan(s.roll) * 9.81 / Math.max(s.v, 22) * 0.9 + yawIn * 0.5 * auth) * dt;
      if (stall < 0.99) s.pitch -= (1 - stall) * 0.55 * dt;                                       // nose drops when too slow
      s.vy = s.v * Math.sin(s.pitch) - (1 - stall) * 20;
      s.y += s.vy * dt;
      if (s.y <= gy) {                                                                              // touchdown
        if (s.vy < -7 || Math.abs(s.roll) > 0.5 || Math.abs(s.pitch) > 0.45) { this.hooks.crash('You crashed the plane'); return; }
        s.y = gy; s.vy = 0; s.pitch *= 0.4;
      }
    }
    const f = Math.cos(s.pitch);
    s.x += Math.sin(s.yaw) * s.v * f * dt; s.z += Math.cos(s.yaw) * s.v * f * dt;
    if (Math.abs(s.x) > 3900) { s.x = Math.sign(s.x) * 3900; s.yaw += 1.2 * dt; } if (Math.abs(s.z) > 3900) { s.z = Math.sign(s.z) * 3900; s.yaw += 1.2 * dt; }
    if (W.queryColliders(s.x, s.z, 5, s.y).length && s.y < 220 && !this.onGround) { this.hooks.crash('You flew into a building'); return; }
    this.sync();
  }
}

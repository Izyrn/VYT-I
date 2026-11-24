import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural humans: proportioned body with neck, head (face, ears, hair styles), shoulders, jointed arms and legs,
 * hands and shoes. Parts are merged with baked vertex colours so a person costs ~12 meshes and one shared material.
 * Poses: walk / run / idle (breathing, looking around) / phone / sit.
 */
const SKIN = [0xf3cfae, 0xe4b48f, 0xcf9570, 0xa66d48, 0x7a4b30, 0x5b3822];
const HAIR = [0x16100c, 0x2b1d14, 0x4a3320, 0x7a5330, 0xb98a45, 0x9a9a9a, 0x7c2f1d];
const SHIRT = [0xd9d9d9, 0x2f5d9a, 0xb03a3a, 0x3d7a4a, 0xe2b93a, 0x6a4a8f, 0x2b2b2e, 0xd77f9b, 0x4aa3a8, 0xc27a3a, 0x8aa0b8];
const PANTS = [0x232a36, 0x3b4252, 0x5a4a3a, 0x1b1b1f, 0x4a5a6a, 0x6a6a70, 0x2f3d2f];
const SHOES = [0x161616, 0xf0f0f0, 0x5a3a22, 0x2a3a5a, 0xaa2a2a];
const pick = (a) => a[(Math.random() * a.length) | 0];

export const humanMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0 });

function P(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  const c = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
const sph = new THREE.SphereGeometry(1, 14, 10), box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 5, 10);
const merge = (list) => { const g = mergeGeometries(list, false); list.forEach((x) => x.dispose()); return g; };

export function randomLook(over = {}) {
  const female = Math.random() < 0.5;
  return Object.assign({
    female, height: (female ? 1.62 : 1.74) + (Math.random() - 0.5) * 0.14, build: 0.9 + Math.random() * 0.25, skin: pick(SKIN), hair: pick(HAIR),
    hairStyle: pick(female ? ['long', 'long', 'ponytail', 'short', 'bun'] : ['short', 'short', 'short', 'bald', 'cap', 'beard']),
    shirt: pick(SHIRT), pants: pick(PANTS), shoes: pick(SHOES), longSleeve: Math.random() < 0.5, shorts: Math.random() < 0.15, skirt: female && Math.random() < 0.25,
  }, over);
}

export function createHuman(look = {}) {
  const o = randomLook(look), f = o.female, b = o.build;
  const sw = (f ? 0.92 : 1.05) * b, hipW = (f ? 1.12 : 0.98) * b;              // shoulder / hip width factors
  const LEG = 0.42, ARM = 0.27, HIP_Y = 0.92;

  // ---- torso (chest + neck + shoulders) and pelvis ----
  const torso = merge([
    P(cyl, o.shirt, 0, 0.27, 0, 0.165 * sw, 0.5, 0.115 * b),                                   // chest/abdomen
    P(cyl, o.shirt, 0, 0.1, 0, 0.15 * hipW, 0.22, 0.11 * b),                                    // waist taper
    P(sph, o.shirt, 0.19 * sw, 0.5, 0, 0.065, 0.065, 0.065), P(sph, o.shirt, -0.19 * sw, 0.5, 0, 0.065, 0.065, 0.065),
    P(cyl, o.skin, 0, 0.58, 0, 0.05, 0.1, 0.05),                                                // neck
    ...(f ? [P(sph, o.shirt, 0.07, 0.4, 0.07, 0.07, 0.06, 0.05), P(sph, o.shirt, -0.07, 0.4, 0.07, 0.07, 0.06, 0.05)] : []),
  ]);
  const pelvis = merge([
    P(cyl, o.skirt ? o.pants : o.pants, 0, -0.02, 0, 0.16 * hipW, 0.2, 0.115 * b),
    ...(o.skirt ? [P(new THREE.CylinderGeometry(0.15, 0.24, 0.3, 14), o.pants, 0, -0.17, 0, hipW, 1, 0.9 * b)] : []),
  ]);

  // ---- head: face, ears, hair ----
  const hp = [
    P(sph, o.skin, 0, 0, 0, 0.098, 0.118, 0.106), P(sph, o.skin, 0, -0.05, 0.015, 0.075, 0.07, 0.08),                           // skull + jaw
    P(box, o.skin, 0, -0.005, 0.108, 0.022, 0.04, 0.035),                                                                       // nose
    P(sph, o.skin, 0.1, 0, 0, 0.02, 0.03, 0.02), P(sph, o.skin, -0.1, 0, 0, 0.02, 0.03, 0.02),                                // ears
    P(sph, 0xffffff, 0.04, 0.025, 0.093, 0.018, 0.014, 0.01), P(sph, 0xffffff, -0.04, 0.025, 0.093, 0.018, 0.014, 0.01),        // eyes
    P(sph, 0x1a1410, 0.04, 0.025, 0.1, 0.009, 0.009, 0.006), P(sph, 0x1a1410, -0.04, 0.025, 0.1, 0.009, 0.009, 0.006),
    P(box, o.hair, 0.04, 0.05, 0.1, 0.04, 0.008, 0.01), P(box, o.hair, -0.04, 0.05, 0.1, 0.04, 0.008, 0.01),                    // brows
    P(box, 0x8a3a3a, 0, -0.055, 0.1, 0.04, 0.009, 0.01),                                                                        // mouth
  ];
  const hairCap = (r = 0.108) => P(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.58), o.hair, 0, 0.012, -0.004, r, r * 1.12, r * 1.06);
  switch (o.hairStyle) {
    case 'bald': break;
    case 'long': hp.push(hairCap(0.112), P(box, o.hair, 0, -0.1, -0.075, 0.2, 0.3, 0.05), P(box, o.hair, 0.1, -0.06, -0.02, 0.025, 0.2, 0.08), P(box, o.hair, -0.1, -0.06, -0.02, 0.025, 0.2, 0.08)); break;
    case 'ponytail': hp.push(hairCap(0.112), P(sph, o.hair, 0, -0.02, -0.13, 0.04, 0.04, 0.05), P(cap(0.025, 0.12), o.hair, 0, -0.12, -0.15)); break;
    case 'bun': hp.push(hairCap(0.112), P(sph, o.hair, 0, 0.12, -0.04, 0.05, 0.05, 0.05)); break;
    case 'cap': hp.push(hairCap(0.104), P(sph, o.shirt, 0, 0.03, -0.004, 0.115, 0.1, 0.112), P(box, o.shirt, 0, 0.035, 0.12, 0.17, 0.012, 0.1)); break;
    case 'beard': hp.push(hairCap(0.108), P(sph, o.hair, 0, -0.075, 0.05, 0.07, 0.05, 0.06)); break;
    default: hp.push(hairCap(0.108));
  }
  const head = merge(hp);

  // ---- limbs ----
  const sleeve = o.longSleeve;
  const upperArm = (side) => merge([P(cap(0.044, ARM - 0.09), o.shirt, 0, -ARM / 2, 0), ...(sleeve ? [] : [P(cap(0.04, 0.1), o.skin, 0, -ARM + 0.06, 0)])]);
  const foreArm = merge([P(cap(0.038, ARM - 0.1), sleeve ? o.shirt : o.skin, 0, -ARM / 2, 0), P(sph, o.skin, 0, -ARM - 0.02, 0, 0.042, 0.05, 0.036)]);
  const thigh = merge([P(cap(0.075 * b, LEG - 0.15), o.pants, 0, -LEG / 2, 0)]);
  const bare = o.shorts || o.skirt;
  const shin = merge([P(cap(0.058 * b, LEG - 0.12), bare ? o.skin : o.pants, 0, -LEG / 2, 0), P(box, o.shoes, 0, -LEG - 0.02, 0.05, 0.1, 0.075, 0.25), P(sph, o.shoes, 0, -LEG - 0.02, 0.17, 0.05, 0.035, 0.05)]);

  // ---- skeleton ----
  const root = new THREE.Group(), hips = new THREE.Group(); hips.position.y = HIP_Y; root.add(hips);
  const mesh = (geo, parent) => { const m = new THREE.Mesh(geo, humanMaterial); m.castShadow = true; parent.add(m); return m; };
  mesh(pelvis, hips);
  const spine = new THREE.Group(); spine.position.y = 0.04; hips.add(spine); mesh(torso, spine);
  const headPivot = new THREE.Group(); headPivot.position.y = 0.66; spine.add(headPivot); mesh(head, headPivot);
  const mkArm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * 0.2 * sw, 0.5, 0); spine.add(sh); mesh(upperArm(side), sh);
    const el = new THREE.Group(); el.position.y = -ARM; sh.add(el); mesh(foreArm, el); return { sh, el };
  };
  const mkLeg = (side) => {
    const hp2 = new THREE.Group(); hp2.position.set(side * 0.095 * hipW, 0, 0); hips.add(hp2); mesh(thigh, hp2);
    const kn = new THREE.Group(); kn.position.y = -LEG; hp2.add(kn); mesh(shin, kn); return { hp: hp2, kn };
  };
  const aL = mkArm(1), aR = mkArm(-1), lL = mkLeg(1), lR = mkLeg(-1);
  // a phone the character can hold
  const phone = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0x111418, emissive: 0x2a5aa0, emissiveIntensity: 0.6 })); phone.scale.set(0.05, 0.1, 0.012); phone.position.set(0, -ARM - 0.02, 0.03); phone.visible = false; aR.el.add(phone);
  const s = o.height / 1.74; root.scale.setScalar(s);

  const parts = { hips, spine, head: headPivot, armL: aL.sh, armR: aR.sh, elbowL: aL.el, elbowR: aR.el, legL: lL.hp, legR: lR.hp, kneeL: lL.kn, kneeR: lR.kn, phone };
  const meshes = []; root.traverse((m) => { if (m.isMesh) meshes.push(m); });
  const api = {
    group: root, parts, look: o, hipY: HIP_Y,
    setShadow(on) { for (const m of meshes) m.castShadow = on; },
    /** phase: walk-cycle phase (radians), v: speed m/s, mode: walk | idle | phone | sit */
    pose(phase, v, mode = 'walk', lookYaw = 0) {
      const A = Math.min(1.25, v / 1.4), run = v > 3.4 ? Math.min(1, (v - 3.4) / 2.5) : 0;
      phone.visible = mode === 'phone';
      if (mode === 'sit') {
        hips.position.y = HIP_Y; parts.legL.rotation.x = parts.legR.rotation.x = -1.45; parts.kneeL.rotation.x = parts.kneeR.rotation.x = 1.5;
        parts.armL.rotation.set(-0.95, 0, 0.1); parts.armR.rotation.set(-0.95, 0, -0.1); parts.elbowL.rotation.x = parts.elbowR.rotation.x = -0.85;
        spine.rotation.set(-0.04, 0, 0); headPivot.rotation.set(0, lookYaw, 0); return;
      }
      if (mode === 'bike') {
        hips.position.y = HIP_Y; parts.legL.rotation.set(-0.95, 0, -0.12); parts.legR.rotation.set(-0.95, 0, 0.12); parts.kneeL.rotation.x = parts.kneeR.rotation.x = 1.75;
        parts.armL.rotation.set(-1.15, 0, 0.12); parts.armR.rotation.set(-1.15, 0, -0.12); parts.elbowL.rotation.x = parts.elbowR.rotation.x = -0.5;
        spine.rotation.set(0.5, 0, 0); headPivot.rotation.set(-0.45, lookYaw, 0); return;
      }
      const sn = Math.sin(phase), sp = Math.sin(phase + Math.PI), amp = 0.5 * A + 0.55 * run;
      parts.legL.rotation.x = sn * amp; parts.legR.rotation.x = sp * amp;
      parts.kneeL.rotation.x = Math.max(0, Math.sin(phase + 1.3)) * (0.85 * A + 0.8 * run) + 0.04;
      parts.kneeR.rotation.x = Math.max(0, Math.sin(phase + Math.PI + 1.3)) * (0.85 * A + 0.8 * run) + 0.04;
      parts.armL.rotation.set(sp * amp * 0.85, 0, 0.05); parts.armR.rotation.set(sn * amp * 0.85, 0, -0.05);
      parts.elbowL.rotation.x = -(0.12 + 0.5 * run + 0.18 * A * (1 + sp) * 0.5); parts.elbowR.rotation.x = -(0.12 + 0.5 * run + 0.18 * A * (1 + sn) * 0.5);
      spine.rotation.set(0.03 * A + run * 0.2, sn * 0.12 * A, Math.sin(phase * 2) * 0.015 * A);
      hips.position.y = HIP_Y - Math.abs(Math.cos(phase)) * 0.04 * A; hips.rotation.y = -sn * 0.08 * A;
      headPivot.rotation.set(-run * 0.12, -sn * 0.05 * A + lookYaw, 0);
      if (v < 0.15) {                                                              // idle: breathing, looking around, shifting weight
        spine.scale.y = 1 + 0.012 * Math.sin(phase * 0.7); headPivot.rotation.y = lookYaw + Math.sin(phase * 0.35) * 0.45; headPivot.rotation.x = Math.sin(phase * 0.21) * 0.06;
        parts.legL.rotation.x = 0.03; parts.legR.rotation.x = -0.02; hips.rotation.z = Math.sin(phase * 0.3) * 0.02;
      } else spine.scale.y = 1;
      if (mode === 'phone') {                                                        // holding a phone in front of the face
        parts.armR.rotation.set(-1.05, 0.15, -0.1); parts.elbowR.rotation.x = -1.75; headPivot.rotation.x = 0.28; headPivot.rotation.y = 0.0;
      }
    },
  };
  api.pose(0, 0, 'idle');
  return api;
}

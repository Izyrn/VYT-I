import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';
import { createHuman } from './human.js';

/**
 * Procedural car bodies: smooth lofted shells (hull + greenhouse) built from per-model side profiles,
 * with arches, grille, mirrors, plates, exhausts, spoilers, detailed wheels and a driver.
 * The hull is a dense mesh so crash dents can deform it.
 */
const box = new THREE.BoxGeometry(1, 1, 1);

// belt = bonnet/boot-lid height along the body (t: 0 = rear ... 1 = front), cab = greenhouse range
const PROFILES = {
  swift:    { belt: [[0, 0.3], [0.2, 0.34], [0.62, 0.31], [0.8, 0.2], [1, 0.12]], cab: [0.1, 0.72], slopeF: 0.15, slopeR: 0.06, bottom: -0.33, bulge: 0.02 },
  meridian: { belt: [[0, 0.24], [0.25, 0.31], [0.4, 0.31], [0.72, 0.28], [0.86, 0.16], [1, 0.1]], cab: [0.3, 0.68], slopeF: 0.13, slopeR: 0.1, bottom: -0.33, bulge: 0.01 },
  atlas:    { belt: [[0, 0.4], [0.3, 0.43], [0.8, 0.43], [0.9, 0.31], [1, 0.25]], cab: [0.06, 0.82], slopeF: 0.07, slopeR: 0.035, bottom: -0.2, bulge: 0.0 },
  vento:    { belt: [[0, 0.2], [0.3, 0.22], [0.55, 0.18], [0.78, 0.08], [1, 0.0]], cab: [0.34, 0.62], slopeF: 0.18, slopeR: 0.12, bottom: -0.36, bulge: 0.06 },
  kodiak:   { belt: [[0, 0.36], [0.35, 0.38], [0.55, 0.42], [0.82, 0.43], [0.92, 0.3], [1, 0.24]], cab: [0.42, 0.78], slopeF: 0.07, slopeR: 0.03, bottom: -0.18, bulge: 0.0 },
  courier:  { belt: [[0, 0.5], [0.75, 0.5], [0.9, 0.32], [1, 0.24]], cab: [0.03, 0.88], slopeF: 0.09, slopeR: 0.015, bottom: -0.2, bulge: 0.0 },
  corsa:    { belt: [[0, 0.22], [0.3, 0.25], [0.55, 0.23], [0.75, 0.12], [1, 0.04]], cab: [0.3, 0.62], slopeF: 0.17, slopeR: 0.12, bottom: -0.35, bulge: 0.05 },
};
const pl = (pts, t) => {
  for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) { const [t0, v0] = pts[i - 1], [t1, v1] = pts[i]; return lerp(v0, v1, (t - t0) / (t1 - t0 || 1)); }
  return pts[pts.length - 1][1];
};
const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

function loft(stations, M, ringFn) {
  const N = stations.length, pos = new Float32Array(N * M * 3), idx = [];
  for (let i = 0; i < N; i++) {
    const pts = ringFn(stations[i], i);
    for (let k = 0; k < M; k++) pos.set(pts[k], (i * M + k) * 3);
  }
  for (let i = 0; i < N - 1; i++) for (let k = 0; k < M; k++) {
    const a = i * M + k, b = i * M + ((k + 1) % M), c = (i + 1) * M + k, d = (i + 1) * M + ((k + 1) % M);
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

/** Builds the dense hull + greenhouse geometry for a car definition. Cached per model for the low-poly traffic. */
function buildShell(def) {
  const P = PROFILES[def.id] || PROFILES.meridian, L = def.len, W = def.W, roof = -0.5 + def.hgt;
  const N = 56, M = 28, ts = [];
  for (let i = 0; i <= N; i++) ts.push(0.5 - 0.5 * Math.cos(Math.PI * i / N));     // dense at both ends
  // smoothed belt line
  let belt = ts.map((t) => pl(P.belt, t));
  for (let it = 0; it < 4; it++) belt = belt.map((v, i) => (i && i < N ? (belt[i - 1] + 2 * v + belt[i + 1]) / 4 : v));
  const cap = (t) => { const u = Math.min(t, 1 - t), r = 0.05; return u >= r ? 1 : Math.sqrt(Math.max(0, 1 - ((r - u) / r) ** 2)); };
  const hwAt = (t) => (W / 2) * (1 - 0.14 * smoothstep(0.84, 1, t) - 0.03 * smoothstep(0.16, 0, t)) * (1 + P.bulge * smoothstep(0.4, 0.1, t));
  const botAt = (t) => P.bottom + 0.1 * smoothstep(0.88, 1, t) + 0.08 * smoothstep(0.12, 0, t);

  const hullGeo = loft(ts, M, (t, i) => {
    const f = cap(t), y0 = botAt(t), y1 = belt[i], cy = (y0 + y1) / 2, hh = ((y1 - y0) / 2) * f, hw = hwAt(t) * f, z = (t - 0.5) * L, pts = [];
    for (let k = 0; k < M; k++) {
      const a = (2 * Math.PI * k) / M, c = Math.cos(a), s = Math.sin(a);
      const up = Math.max(0, s);
      pts.push([hw * sgnPow(c, 2 / 4.5) * (1 - 0.07 * up), cy + hh * sgnPow(s, 2 / 4.5) + (s > 0 ? 0.015 * up : 0), z]);
    }
    return pts;
  });

  const S = (t) => smoothstep(P.cab[0], P.cab[0] + P.slopeR, t) * smoothstep(P.cab[1], P.cab[1] - P.slopeF, t);
  const gh = loft(ts, M, (t, i) => {
    const s = S(t), y0 = belt[i] - 0.05, y1 = belt[i] - 0.01 + (roof - belt[i]) * s, cy = (y0 + y1) / 2, hh = (y1 - y0) / 2, hw = hwAt(t) * 0.9 * cap(t), z = (t - 0.5) * L, pts = [];
    for (let k = 0; k < M; k++) {
      const a = (2 * Math.PI * k) / M, c = Math.cos(a), sn = Math.sin(a), y = cy + hh * sgnPow(sn, 2 / 3);
      const tuck = lerp(1, 0.74, clamp((y - y0) / Math.max(0.001, y1 - y0), 0, 1));
      pts.push([hw * sgnPow(c, 2 / 3) * tuck, y, z]);
    }
    return pts;
  });
  // roof quads get the paint material, the rest is glass
  const idx = gh.index.array, nrm = gh.attributes.normal, paintIdx = [], glassIdx = [], M2 = M;
  for (let q = 0; q < idx.length; q += 6) {
    const ia = idx[q], ib = idx[q + 1], ic = idx[q + 2], id = idx[q + 4];
    const ny = (nrm.getY(ia) + nrm.getY(ib) + nrm.getY(ic) + nrm.getY(id)) / 4, ring = Math.floor(ia / M2), t = ts[Math.min(ring, N)];
    const target = ny > 0.55 && S(t) > 0.97 && S(ts[Math.min(ring + 1, N)]) > 0.97 ? paintIdx : glassIdx;
    for (let j = 0; j < 6; j++) target.push(idx[q + j]);
  }
  gh.setIndex([...glassIdx, ...paintIdx]); gh.clearGroups();
  gh.addGroup(0, glassIdx.length, 0); gh.addGroup(glassIdx.length, paintIdx.length, 1);
  return { hullGeo, gh, P, belt, ts, roof, hwAt, botAt, beltAt: (t) => pl(P.belt, t) };
}
const shellCache = new Map();
const shellFor = (def) => { if (!shellCache.has(def.id)) shellCache.set(def.id, buildShell(def)); return shellCache.get(def.id); };

function plateTexture(text) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#f1f1ea'; g.fillRect(0, 0, 128, 64); g.strokeStyle = '#223'; g.lineWidth = 4; g.strokeRect(2, 2, 124, 60);
  g.fillStyle = '#1b2a55'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function makeWheel(def, side, mats) {
  const wr = def.wr, steer = new THREE.Group(), spin = new THREE.Group();
  const prof = [[wr * 0.6, -0.12], [wr * 0.86, -0.135], [wr * 0.97, -0.1], [wr, -0.04], [wr, 0.04], [wr * 0.97, 0.1], [wr * 0.86, 0.135], [wr * 0.6, 0.12]].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.Mesh(new THREE.LatheGeometry(prof, 30).rotateZ(Math.PI / 2), mats.tire); tire.castShadow = true; spin.add(tire);
  const rimM = new THREE.Mesh(new THREE.CylinderGeometry(wr * 0.62, wr * 0.62, 0.2, 24).rotateZ(Math.PI / 2), mats.rim); spin.add(rimM);
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.Mesh(box, mats.rim); sp.scale.set(0.05, wr * 1.1, 0.09); sp.position.x = side * 0.11; sp.rotation.x = (k * 2 * Math.PI) / 5; spin.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(wr * 0.16, wr * 0.16, 0.06, 12).rotateZ(Math.PI / 2), mats.dark); hub.position.x = side * 0.13; spin.add(hub);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(wr * 0.5, wr * 0.5, 0.03, 20).rotateZ(Math.PI / 2), mats.disc); disc.position.x = -side * 0.05; spin.add(disc);
  const cal = new THREE.Mesh(box, mats.caliper); cal.scale.set(0.06, wr * 0.32, wr * 0.4); cal.position.set(-side * 0.07, wr * 0.32, 0); steer.add(cal);
  steer.add(spin);
  return { steer, spin };
}

export function createCarMesh(def, opts = {}) {
  if (def.bike) return createBikeMesh(def, opts);
  if (def.boat) return createBoatMesh(def, opts);
  const { paintColor } = opts;
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const W = def.W, L = def.len, H = def.hgt, sh = shellFor(def), P = sh.P;
  const paint = new THREE.MeshPhysicalMaterial({ color: paintColor ?? def.color, roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c141c, roughness: 0.04, metalness: 0.7, transparent: true, opacity: 0.58, depthWrite: false, envMapIntensity: 1.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.7 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.15, metalness: 1 });
  const head = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, emissive: 0xfff2d0, emissiveIntensity: 0, roughness: 0.15 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, emissive: 0xff1010, emissiveIntensity: 0, roughness: 0.3 });
  const indL = new THREE.MeshStandardMaterial({ color: 0x8a5000, emissive: 0xff8a00, emissiveIntensity: 0 });
  const indR = indL.clone();
  const mats = { paint, head, tail, indL, indR };

  // Hull (dense, deformable) and greenhouse
  const hullGeo = sh.hullGeo.clone();
  hullGeo.userData.orig = hullGeo.attributes.position.array.slice();
  const hull = new THREE.Mesh(hullGeo, paint); hull.castShadow = true; body.add(hull);
  const green = new THREE.Mesh(sh.gh, [glass, paint]); green.castShadow = true; body.add(green);

  const zAt = (t) => (t - 0.5) * L, beltAt = sh.beltAt;
  const front = L / 2, rear = -L / 2;
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };
  const ball = new THREE.SphereGeometry(0.5, 14, 10);

  // wheel arches (dark discs flush with the body side) + wheels
  const wr = def.wr, a = def.L * 0.46, b = def.L * 0.54, tw = W - 0.22;
  const tireM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.2, metalness: 1 });
  const wmats = { tire: tireM, rim: rimMat, dark, disc: new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.4, metalness: 0.8 }), caliper: new THREE.MeshStandardMaterial({ color: 0xc41e1e, roughness: 0.4 }) };
  const wheels = [];
  [[a, 1], [a, -1], [-b, 1], [-b, -1]].forEach(([lz, side], i) => {
    const w = makeWheel(def, side, wmats); root.add(w.steer);
    wheels.push({ steer: w.steer, spin: w.spin, lz, lx: side * tw / 2, front: i < 2 });
    const t = lz / L + 0.5, hw = sh.hwAt(t);
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(wr * 1.16, wr * 1.16, 0.02, 22).rotateZ(Math.PI / 2), dark);
    arch.position.set(side * (hw * 0.995), -0.5 + wr, lz); body.add(arch);
  });

  // grille, bumpers, lights
  const ly = lerp(beltAt(0.97), sh.botAt(0.97), 0.42);
  add(box, dark, 0, ly - 0.02, front - 0.02, W * 0.44, 0.17, 0.05);
  add(box, chrome, 0, ly + 0.07, front - 0.015, W * 0.42, 0.015, 0.05);
  add(box, dark, 0, P.bottom + 0.1, front - 0.1, W * 0.84, 0.13, 0.22);
  add(box, dark, 0, P.bottom + 0.1, rear + 0.1, W * 0.84, 0.13, 0.22);
  for (const s of [1, -1]) {
    const hl = add(ball, head, s * W * 0.34, ly + 0.02, front - 0.07, 0.3, 0.14, 0.14); hl.rotation.y = s * 0.25;
    add(box, tail, s * W * 0.36, beltAt(0.04) - 0.1, rear + 0.03, 0.34, 0.1, 0.05);
    add(box, s > 0 ? indL : indR, s * W * 0.43, ly - 0.07, front - 0.06, 0.14, 0.07, 0.05);
    add(box, s > 0 ? indL : indR, s * W * 0.43, beltAt(0.04) - 0.2, rear + 0.03, 0.14, 0.07, 0.05);
    // mirrors
    const mt = P.cab[1] - P.slopeF * 0.7;
    add(box, paint, s * (sh.hwAt(mt) * 0.97 + 0.07), beltAt(mt) + 0.14, zAt(mt) - 0.05, 0.14, 0.1, 0.1);
    // exhaust tips
    add(new THREE.CylinderGeometry(0.04, 0.04, 0.14, 10).rotateX(Math.PI / 2), chrome, s * W * 0.25, P.bottom + 0.1, rear - 0.03);
    // door seams + handles
    for (const tt of [P.cab[0] + (P.cab[1] - P.cab[0]) * 0.46]) {
      add(box, dark, s * (sh.hwAt(tt) + 0.002), beltAt(tt) - 0.12, zAt(tt), 0.008, 0.46, 0.012);
      add(box, chrome, s * (sh.hwAt(tt) + 0.008), beltAt(tt) + 0.02, zAt(tt) + 0.22, 0.012, 0.025, 0.14);
    }
  }
  // plates
  const plT = plateTexture('VYT ' + (def.id.length * 137 % 900 + 100));
  for (const [z, ry] of [[front + 0.005, 0], [rear - 0.005, Math.PI]]) {
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshStandardMaterial({ map: plT, roughness: 0.5 }));
    pm.position.set(0, P.bottom + 0.3, z); pm.rotation.y = ry; body.add(pm);
  }
  // model specific parts
  if (def.id === 'corsa' || def.id === 'vento') {
    const wz = rear + 0.28, wy = beltAt(0.08) + 0.22;
    add(box, paint, 0, wy, wz, W * 0.82, 0.04, 0.3);
    for (const s of [1, -1]) add(box, dark, s * W * 0.32, wy - 0.12, wz, 0.04, 0.22, 0.1);
    add(box, dark, 0, P.bottom + 0.02, front - 0.35, W * 0.7, 0.04, 0.3);                       // splitter
  } else if (def.id === 'atlas') {
    const ry = sh.roof + 0.04;
    for (const s of [1, -1]) add(box, chrome, s * W * 0.34, ry, zAt((P.cab[0] + P.cab[1]) / 2 - 0.02), 0.04, 0.05, L * 0.5);
    add(box, dark, 0, P.bottom + 0.35, front + 0.05, W * 0.8, 0.07, 0.12);                      // bull bar
    for (const s of [1, -1]) add(box, dark, s * W * 0.3, P.bottom + 0.22, front + 0.05, 0.06, 0.34, 0.1);
    add(box, dark, 0, beltAt(0.9) + 0.0, zAt(0.9), W * 0.5, 0.015, 0.6);                         // bonnet scoop strip
  } else if (def.id === 'kodiak') {
    for (const s of [1, -1]) add(box, paint, s * (W / 2 - 0.05), beltAt(0.2) + 0.2, zAt(0.2), 0.08, 0.4, L * 0.38);
    add(box, paint, 0, beltAt(0.02) + 0.2, zAt(0.02) + 0.04, W - 0.1, 0.4, 0.08); add(box, dark, 0, beltAt(0.3) + 0.0, zAt(0.2), W - 0.3, 0.03, L * 0.36);
    add(box, dark, 0, P.bottom + 0.35, front + 0.05, W * 0.8, 0.07, 0.12);
  } else if (def.id === 'courier') {
    add(box, dark, 0, beltAt(0.5) + 0.05, rear + 0.02, W * 0.9, 1.0, 0.05); add(box, chrome, 0, beltAt(0.5) + 0.05, rear + 0.01, 0.02, 1.0, 0.05);
  } else if (def.id === 'swift') {
    add(new THREE.CylinderGeometry(0.008, 0.008, 0.24, 6), dark, -W * 0.3, sh.roof + 0.12, zAt(P.cab[0] + 0.08));
    add(box, dark, 0, sh.roof + 0.02, zAt(P.cab[0] + 0.03), W * 0.5, 0.05, 0.05);                // rear roof spoiler
  } else if (def.id === 'meridian') {
    add(box, chrome, 0, beltAt(0.5) - 0.2, zAt(0.5) + 0.0, W * 1.0, 0.012, 0.012);              // chrome belt line
    add(box, chrome, 0, sh.roof - 0.02, zAt((P.cab[0] + P.cab[1]) / 2), W * 0.02, 0.01, 0.01);
  }

  // headlight spot lights and light cones
  const beams = [];
  for (const s of [1, -1]) {
    const sp = new THREE.SpotLight(0xfff0d8, 0, 110, 0.62, 0.55, 1.6);
    sp.position.set(s * W * 0.34, ly, front - 0.1);
    const tgt = new THREE.Object3D(); tgt.position.set(s * W * 0.34, ly - 1.2, front + 30);
    body.add(sp, tgt); sp.target = tgt; beams.push(sp);
  }
  const beamMats = [];
  for (const s of [1, -1]) {
    const geo = new THREE.ConeGeometry(2.6, 16, 20, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 8);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uOn: { value: 0 } },
      vertexShader: 'varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform float uOn; varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main() { float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float a = pow(1.0 - vUv.y, 1.4) * f * 0.2 * uOn; gl_FragColor = vec4(vec3(1.0, 0.93, 0.78) * a, a); }',
    });
    const cone = new THREE.Mesh(geo, mat); cone.position.set(s * W * 0.34, ly, front); cone.renderOrder = 2; body.add(cone); beamMats.push(mat);
  }

  // cockpit interior + driver
  const belt0 = beltAt((P.cab[0] + P.cab[1]) / 2);
  const dashT = P.cab[1] - P.slopeF * 0.75, dashZ = zAt(dashT) - 0.3, dashY = beltAt(dashT) + 0.1;
  const cockpitGroup = new THREE.Group();
  const dash = add(box, dark, 0, dashY, dashZ, W * 0.8, 0.22, 0.34, cockpitGroup);
  add(box, new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.6 }), W * 0.2, dashY + 0.13, dashZ - 0.02, 0.34, 0.1, 0.1, cockpitGroup);
  add(box, new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.8 }), 0, belt0 - 0.05, zAt((P.cab[0] + P.cab[1]) / 2 - 0.1), W * 0.8, 0.12, 1.0, cockpitGroup); // seats base
  const wheelMesh = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 22), dark);
  wheelMesh.position.set(W * 0.2, dashY + 0.1, dashZ - 0.3); wheelMesh.rotation.x = -1.1; cockpitGroup.add(wheelMesh);
  body.add(cockpitGroup);

  const hm = createHuman({ female: false, shirt: 0x3f6fb5, pants: 0x2a2f3a, hairStyle: 'short', hair: 0x2a1c12, skin: 0xd2a07a, height: 1.74, longSleeve: true, shorts: false, build: 1 });
  const driver = new THREE.Group(), dx = W * 0.2, dz = dashZ - 0.62;
  hm.group.scale.setScalar(0.85);
  hm.group.position.set(dx, Math.max(sh.roof - 0.82, belt0 - 0.2) - hm.hipY * 0.85, dz);
  hm.pose(0, 0, 'sit'); driver.add(hm.group);
  const dHead = hm.parts.head, hair = { rotation: { y: 0 } };
  body.add(driver);

  return { root, body, hull, hullGeo, wheels, mats, beams, beamMats, cabin: green, roof: green, wheelMesh, cockpitGroup, driver, driverHead: dHead, driverHair: hair,
    eye: new THREE.Vector3(dx, sh.roof - 0.22, dz + 0.2) };
}

/** Lightweight version for traffic and police: shared shell geometry, simple wheels, no dynamic lights. */
const lowCache = { wheel: null, mats: null };
export function createLowCar(def, color) {
  const sh = shellFor(def), g = new THREE.Group(), L = def.len, W = def.W, P = sh.P;
  lowCache.mats ||= {
    glass: new THREE.MeshStandardMaterial({ color: 0x0c141c, roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.45, depthWrite: false }),
    tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }), dark: new THREE.MeshStandardMaterial({ color: 0x101010 }),
  };
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.6, envMapIntensity: 1.2 });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff0c0, emissiveIntensity: 0 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x500000, emissive: 0xff1010, emissiveIntensity: 0 });
  const hull = new THREE.Mesh(sh.hullGeo, paint), gre = new THREE.Mesh(sh.gh, [lowCache.mats.glass, paint]);
  hull.castShadow = gre.castShadow = true; g.add(hull, gre);
  const wg = (lowCache.wheel ||= new THREE.CylinderGeometry(1, 1, 0.26, 14).rotateZ(Math.PI / 2));
  for (const [x, z] of [[1, 0.46], [-1, 0.46], [1, -0.54], [-1, -0.54]]) {
    const w = new THREE.Mesh(wg, lowCache.mats.tire); w.scale.set(def.wr, def.wr, def.wr); w.position.set(x * (W / 2 - 0.12), -0.5 + def.wr, z * def.L); g.add(w);
  }
  const mk = (m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(box, m); o.scale.set(sx, sy, sz); o.position.set(x, y, z); g.add(o); };
  for (const s of [1, -1]) { mk(lamp, s * W * 0.34, sh.beltAt(0.97) - 0.1, L / 2, 0.3, 0.12, 0.06); mk(tail, s * W * 0.36, sh.beltAt(0.04) - 0.1, -L / 2, 0.34, 0.1, 0.06); }
  // driver silhouette
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0xc99572 }));
  head.position.set(W * 0.2, sh.roof - 0.25, (P.cab[1] - P.slopeF * 1.2 - 0.5) * L); g.add(head);
  g.position.y = 0.5;                       // ground sits 0.5 below the model origin
  const holder = new THREE.Group(); holder.add(g);
  holder.userData = { lamp, tail, paint };
  return holder;
}

/* ------------------------------------------------------------------ */
/* Motorcycle and boat models                                           */
/* ------------------------------------------------------------------ */
function baseMats(def, paintColor) {
  const paint = new THREE.MeshPhysicalMaterial({ color: paintColor ?? def.color, roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4 });
  const head = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, emissive: 0xfff2d0, emissiveIntensity: 0, roughness: 0.15 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x6a0a0a, emissive: 0xff1010, emissiveIntensity: 0, roughness: 0.3 });
  const indL = new THREE.MeshStandardMaterial({ color: 0x8a5000, emissive: 0xff8a00, emissiveIntensity: 0 });
  return { paint, head, tail, indL, indR: indL.clone() };
}

export function createBikeMesh(def, { paintColor } = {}) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const mats = baseMats(def, paintColor), dark = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.6, metalness: 0.5 }), chrome = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.15, metalness: 1 });
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
  // tank (deformable "hull"), engine, seat, tail
  const hullGeo = new THREE.CapsuleGeometry(0.2, 0.5, 6, 14).rotateX(Math.PI / 2); hullGeo.userData.orig = hullGeo.attributes.position.array.slice();
  const hull = add(hullGeo, mats.paint, 0, 0.18, 0.22, 0.85, 0.85, 1);
  add(box, dark, 0, -0.18, 0.05, 0.32, 0.38, 0.6); add(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 10).rotateX(Math.PI / 2), dark, 0, -0.14, 0.32);
  add(box, dark, 0, 0.12, -0.32, 0.28, 0.1, 0.62); add(box, mats.paint, 0, 0.2, -0.78, 0.26, 0.14, 0.5);
  add(new THREE.CylinderGeometry(0.045, 0.06, 0.9, 10).rotateX(Math.PI / 2), chrome, 0.2, -0.22, -0.4);
  add(box, mats.tail, 0, 0.2, -1.04, 0.2, 0.07, 0.04);
  for (const s of [1, -1]) add(box, s > 0 ? mats.indL : mats.indR, s * 0.14, 0.2, -1.03, 0.07, 0.05, 0.04);
  // wheels: front one carries the fork + handlebars so it steers with them
  const wr = def.wr, tireM = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 }), rimM = new THREE.MeshStandardMaterial({ color: 0xcfd3d8, roughness: 0.2, metalness: 1 });
  const wmats = { tire: tireM, rim: rimM, dark, disc: new THREE.MeshStandardMaterial({ color: 0x6b6f75, roughness: 0.4, metalness: 0.8 }), caliper: new THREE.MeshStandardMaterial({ color: 0xc41e1e, roughness: 0.4 }) };
  const wheels = [], a = def.L * 0.46, b = def.L * 0.54;
  [[a, true], [-b, false]].forEach(([lz, front]) => {
    const w = makeWheel(def, 0.001, wmats); w.spin.scale.x = 0.55; root.add(w.steer);
    wheels.push({ steer: w.steer, spin: w.spin, lz, lx: 0, front });
    if (front) {
      const fork = add(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), chrome, 0.1, 0.34, -0.06, 1, 1, 1, w.steer); fork.rotation.x = -0.28; add(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), chrome, -0.1, 0.34, -0.06, 1, 1, 1, w.steer).rotation.x = -0.28;
      add(box, dark, 0, 0.7, -0.14, 0.62, 0.035, 0.035, w.steer);                                                // handlebar
      add(new THREE.SphereGeometry(0.11, 12, 10), mats.head, 0, 0.58, 0.1, 1, 1, 0.8, w.steer);                // headlight
      add(box, mats.paint, 0, wr + 0.06, 0.02, 0.2, 0.025, 0.36, w.steer);                                       // front mudguard
      for (const s of [1, -1]) add(box, s > 0 ? mats.indL : mats.indR, s * 0.31, 0.7, -0.14, 0.05, 0.05, 0.05, w.steer);
    } else add(box, mats.paint, 0, wr + 0.05, -0.02, 0.18, 0.02, 0.5, w.steer);
  });
  // rider
  const hm = createHuman({ female: false, shirt: 0x15181f, pants: 0x1b1b1f, shoes: 0x161616, hairStyle: 'cap', hair: 0x2a1c12, longSleeve: true, shorts: false, height: 1.74, build: 1 });
  hm.group.scale.setScalar(0.92); hm.group.position.set(0, 0.2 - 0.92 * 0.92 + 0.02, -0.34); hm.pose(0, 0, 'bike');
  const driver = new THREE.Group(); driver.add(hm.group); body.add(driver);
  const beams = [], sp = new THREE.SpotLight(0xfff0d8, 0, 100, 0.55, 0.5, 1.6); sp.position.set(0, 0.75, a); const tg = new THREE.Object3D(); tg.position.set(0, 0.2, a + 30); body.add(sp, tg); sp.target = tg; beams.push(sp);
  const wheelMesh = new THREE.Object3D(), cockpitGroup = new THREE.Group(); body.add(cockpitGroup);
  return { root, body, hull, hullGeo, wheels, mats, beams, beamMats: [], cabin: hull, roof: hull, wheelMesh, cockpitGroup, driver, driverHead: hm.parts.head, driverHair: { rotation: { y: 0 } }, human: hm, eye: new THREE.Vector3(0, 0.88, -0.1) };
}

export function createBoatMesh(def, { paintColor } = {}) {
  const root = new THREE.Group(), body = new THREE.Group(); body.position.y = -0.22; root.add(body);
  const W = def.W, L = def.len, mats = baseMats(def, paintColor);
  const white = new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.4 }), dark = new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.6, metalness: 0.4 }), seat = new THREE.MeshStandardMaterial({ color: 0x23394f, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c141c, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.45, depthWrite: false });
  const add = (geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
  // hull with a pointed bow (dense so crashes can dent it)
  const hullGeo = new THREE.BoxGeometry(W, 0.7, L * 0.72, 6, 2, 10); hullGeo.userData.orig = hullGeo.attributes.position.array.slice();
  const hull = add(hullGeo, mats.paint, 0, -0.05, -L * 0.14);
  add(new THREE.ConeGeometry(W * 0.707, L * 0.3, 4).rotateY(Math.PI / 4).rotateX(Math.PI / 2), mats.paint, 0, -0.05, L * 0.37, 1, 0.7 / W, 1);
  add(box, white, 0, 0.32, -L * 0.14, W * 0.96, 0.06, L * 0.72);                                          // deck
  add(box, white, 0, 0.28, L * 0.2, W * 0.5, 0.05, L * 0.28);
  add(box, dark, 0, -0.38, -L * 0.14, W * 0.9, 0.12, L * 0.6);                                              // keel strip
  // console, windscreen, seats
  add(box, white, -0.45, 0.65, -0.2, 0.7, 0.6, 0.9); add(box, glass, -0.45, 1.05, 0.12, 0.74, 0.5, 0.05).rotation.x = -0.3;
  add(box, seat, 0.55, 0.5, -0.9, 0.7, 0.3, 0.6); add(box, seat, 0.55, 0.75, -1.2, 0.7, 0.4, 0.1); add(box, seat, -0.55, 0.5, -1.4, 0.7, 0.3, 0.6);
  // outboard motor
  add(box, dark, 0, 0.35, -L * 0.5 - 0.1, 0.4, 0.7, 0.35); add(new THREE.CylinderGeometry(0.06, 0.06, 0.8, 8), dark, 0, -0.1, -L * 0.5 - 0.15);
  // rails and lights
  for (const s of [1, -1]) { add(box, white, s * W * 0.48, 0.55, -L * 0.14, 0.04, 0.5, L * 0.6); add(box, mats.head, s * 0.3, 0.5, L * 0.36, 0.16, 0.08, 0.06); add(box, mats.tail, s * 0.4, 0.5, -L * 0.5, 0.16, 0.08, 0.06); }
  // skipper at the helm
  const hm = createHuman({ female: false, shirt: 0xe8e8e8, pants: 0x1b2a44, hairStyle: 'cap', longSleeve: false, shorts: true, height: 1.74, build: 1 });
  hm.group.scale.setScalar(0.92); hm.group.position.set(-0.45, 0.35 - 0.0, -0.75); hm.pose(0, 0, 'idle'); hm.parts.armL.rotation.x = hm.parts.armR.rotation.x = -0.9; hm.parts.elbowL.rotation.x = hm.parts.elbowR.rotation.x = -0.6;
  const driver = new THREE.Group(); driver.add(hm.group); body.add(driver);
  const beams = [], sp = new THREE.SpotLight(0xfff0d8, 0, 90, 0.6, 0.5, 1.6); sp.position.set(0, 0.5, L * 0.36); const tg = new THREE.Object3D(); tg.position.set(0, 0.2, L * 0.36 + 30); body.add(sp, tg); sp.target = tg; beams.push(sp);
  const wheelMesh = new THREE.Object3D(), cockpitGroup = new THREE.Group(); body.add(cockpitGroup);
  return { root, body, hull, hullGeo, wheels: [], mats, beams, beamMats: [], cabin: hull, roof: hull, wheelMesh, cockpitGroup, driver, driverHead: hm.parts.head, driverHair: { rotation: { y: 0 } }, human: hm, eye: new THREE.Vector3(-0.45, 1.25, -0.5) };
}

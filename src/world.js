import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { clamp, lerp, smoothstep, mulberry32, fbm } from './util.js';
import { Extras } from './extras.js';
import { createHuman } from './human.js';

export const HALF = 4000, SEG = 320, CELL = (HALF * 2) / SEG;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.buildings = [];
    this.wetU = { value: 0 }; this.timeU = { value: 0 }; this.windU = { value: 0.5 };
    this.rng = mulberry32(20240607);
    this.roads = []; this.zones = []; this.colliders = []; this.stations = [];
    this.hash = new Map(); this.qid = 0; this.nightMats = [];
    this.layout();
    this.buildTerrain();
    this.buildRoads();
    this.buildCity();
    this.buildStations();
    this.buildPOIs();
    this.buildProperties();
    this.buildGraph();
    this.buildLandmarks();
    this.buildNature();
    this.extras = new Extras(this);   // street lamps, traffic lights, building entrances
    this.buildHash();
    this.buildMinimap();
    this.dealership = { x: -180, z: 130 };
    this.spawn = { x: -250, z: 4.5, yaw: Math.PI / 2 };
  }

  /* ---------- layout ---------- */
  road(axis, c, a0, a1, w, type) { this.roads.push({ axis, c, a0, a1, w, type }); }
  zone(x0, x1, z0, z1, m) { this.zones.push({ x0, x1, z0, z1, m }); }
  layout() {
    this.road('x', 0, -4000, 4000, 18, 'highway');
    this.road('z', 0, -4000, 4000, 18, 'highway');
    for (let k = -4; k <= 4; k++) if (k) { this.road('x', k * 120, -480, 480, 12, 'street'); this.road('z', k * 120, -480, 480, 12, 'street'); }
    this.road('z', -2500, 0, 1480, 14, 'road');          // airport access
    this.road('z', 3000, 0, 1200, 12, 'road');           // desert town
    this.road('x', 300, -1100, 0, 12, 'street');         // residential connector
    for (let i = 0; i < 5; i++) this.road('z', -1000 + i * 100, 300, 800, 10, 'street');
    for (let j = 1; j <= 5; j++) this.road('x', 300 + j * 100, -1000, -600, 10, 'street');
    this.zone(-540, 540, -540, 540, 120);
    this.zone(-1150, -550, 250, 850, 80);
    this.zone(-3050, -1950, 1350, 1750, 150);
    this.zone(2200, 2800, -150, 150, 80); this.zone(-150, 150, -2650, -2250, 80); this.zone(2800, 3250, 1000, 1300, 80);
    this.sites = [[700, -34], [-700, 34], [1850, -34], [34, -1500], [34, 1800], [2450, -34], [34, -2400], [3034, 600], [-1900, 34],
      // extra stations so fuel is never more than ~1.5 km away
      [-3600, -34], [-2900, 34], [-1100, -34], [1100, 34], [2100, -34], [3300, 34], [3800, -34],
      [-34, -3600], [-34, -3300], [-34, -1900], [34, -1000], [-34, -800], [-34, 1200], [34, 2400], [-34, 3000], [34, 3600],
      [-2534, 700], [3034, 300], [-2534, 1250]];
    for (const [x, z] of this.sites) this.zone(x - 30, x + 30, z - 30, z + 30, 40);
    // Points of interest: [buildingX, buildingZ, ringX, ringZ]  (ring = where you park to rob / pick up / deliver)
    this.poiSites = [
      [-3200, -40, -3200, -20], [-2300, 40, -2300, 20], [-1300, -40, -1300, -20], [-800, 40, -800, 20],
      [900, -40, 900, -20], [2000, 40, 2000, 20], [3500, -40, 3500, -20],
      [40, -3000, 20, -3000], [-40, -2050, -20, -2050], [40, -1250, 20, -1250], [-40, 1500, -20, 1500],
      [40, 2100, 20, 2100], [-40, 2700, -20, 2700], [40, 3300, 20, 3300],
      [2960, 800, 2980, 800], [-2540, 900, -2520, 900], [-1060, 262, -1060, 284], [-180, -205, -180, -170],
    ];
    // Houses for sale: [buildingX, buildingZ, ringX, ringZ]
    this.propSites = [[-1800, -55, -1800, -26], [62, 900, 26, 900], [3062, 450, 3022, 450], [-70, -1650, -26, -1650], [-2420, 520, -2470, 520]];
    for (const [bx, bz, rx, rz] of this.propSites) this.zone(Math.min(bx, rx) - 28, Math.max(bx, rx) + 28, Math.min(bz, rz) - 28, Math.max(bz, rz) + 28, 50);
    for (const [bx, bz, rx, rz] of this.poiSites) this.zone(Math.min(bx, rx) - 12, Math.max(bx, rx) + 12, Math.min(bz, rz) - 12, Math.max(bz, rz) + 12, 40);
  }

  roadDist(x, z) {
    let best = 1e9;
    for (const r of this.roads) {
      const [p, q] = r.axis === 'x' ? [x, z] : [z, x];
      const d = Math.hypot(Math.max(r.a0 - p, 0, p - r.a1), Math.abs(q - r.c)) - r.w / 2;
      if (d < best) best = d;
    }
    return best;
  }
  zoneDist(x, z) {
    let best = 1e9;
    for (const q of this.zones) {
      const d = Math.hypot(Math.max(q.x0 - x, 0, x - q.x1), Math.max(q.z0 - z, 0, z - q.z1));
      best = Math.min(best, d / q.m);
    }
    return best;
  }
  desertAmt(x, z) { return smoothstep(900, 1700, x) * smoothstep(-1500, -500, z); }

  genHeight(x, z) {
    let h = (fbm(x * 0.0009, z * 0.0009, 7) - 0.5) * 60;
    const mz = smoothstep(-900, -1800, z), mx = smoothstep(200, 800, Math.abs(x));
    const ridge = 1 - Math.abs(fbm(x * 0.0016, z * 0.0016, 11) * 2 - 1);
    h += mz * mx * (Math.pow(ridge, 1.6) * 520 + fbm(x * 0.006, z * 0.006, 3) * 60);
    const edge = smoothstep(3300, 3900, Math.max(Math.abs(x), Math.abs(z)));
    h += edge * ridge * 260;
    const dd = this.desertAmt(x, z);
    h = lerp(h, fbm(x * 0.004, z * 0.004, 5) * 26, dd * 0.8);
    const mask = Math.min(smoothstep(10, 100, this.roadDist(x, z)), smoothstep(0, 1, this.zoneDist(x, z)));
    h *= mask;
    const rx = x - (-1550 + Math.sin(z * 0.002) * 60);
    { const k = Math.exp(-((rx / 40) ** 2)); h = h * (1 - k) - 9 * k; }
    return h;
  }

  buildTerrain() {
    const N = SEG + 1;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), uv = new Float32Array(N * N * 2);
    this.hgrid = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -HALF + i * CELL, z = -HALF + j * CELL, h = this.genHeight(x, z), k = j * N + i;
      this.hgrid[k] = h; pos.set([x, h, z], k * 3); uv.set([i / SEG, j / SEG], k * 2);
    }
    const idx = new Uint32Array(SEG * SEG * 6); let p = 0;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx.set([a, c, b, b, c, d], p); p += 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal, c = new THREE.Color();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, x = pos[k * 3], h = pos[k * 3 + 1], z = pos[k * 3 + 2];
      const slope = 1 - nrm.getY(k), dd = this.desertAmt(x, z), v = (fbm(x * 0.02, z * 0.02, 2) - 0.5) * 0.12;
      c.setRGB(0.16 + v, 0.30 + v, 0.09 + v * 0.5);
      c.lerp(new THREE.Color(0.55 + v, 0.42 + v, 0.22), dd);
      if (slope > 0.22 || h > 140) c.lerp(new THREE.Color(0.28, 0.26, 0.24), clamp(slope * 2 + (h - 140) / 200, 0, 1));
      if (h > 330) c.lerp(new THREE.Color(0.9, 0.92, 0.95), smoothstep(330, 400, h));
      if (h < -1) c.lerp(new THREE.Color(0.3, 0.27, 0.2), 0.8);
      col.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const nt = this.noiseTex();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, map: nt, bumpMap: nt, bumpScale: 1.1, envMapIntensity: 0.4 });
    const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true;
    this.scene.add(mesh);
    const water = new Water(new THREE.PlaneGeometry(900, 8000), {
      textureWidth: 256, textureHeight: 256, waterNormals: this.waterNormals(), sunDirection: new THREE.Vector3(0.5, 0.8, 0.3),
      sunColor: 0xffffff, waterColor: 0x0b3a55, distortionScale: 2.4, fog: true,
    });
    water.rotation.x = -Math.PI / 2; water.position.set(-1550, -3, 0); water.material.uniforms.size.value = 5; this.water = water; this.scene.add(water);
  }
  noiseTex() {
    // Tileable multi-octave value noise used as albedo modulation and bump map (ground detail).
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
    const lat = []; for (let o = 0; o < 5; o++) { const P = 4 << o, t = new Float32Array(P * P); for (let i = 0; i < t.length; i++) t[i] = Math.random(); lat.push([P, t]); }
    const sm = (t) => t * t * (3 - 2 * t);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0, amp = 0.5, norm = 0;
      for (const [P, t] of lat) {
        const fx = x / N * P, fy = y / N * P, ix = Math.floor(fx), iy = Math.floor(fy), u = sm(fx - ix), w = sm(fy - iy);
        const a0 = t[(iy % P) * P + (ix % P)], b0 = t[(iy % P) * P + ((ix + 1) % P)], c0 = t[((iy + 1) % P) * P + (ix % P)], d0 = t[((iy + 1) % P) * P + ((ix + 1) % P)];
        v += amp * ((a0 + (b0 - a0) * u) * (1 - w) + (c0 + (d0 - c0) * u) * w); norm += amp; amp *= 0.55;
      }
      v = v / norm; const g8 = 150 + 105 * v + (Math.random() - 0.5) * 14, o = (y * N + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = g8; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(500, 500); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }

  terrainH(x, z) {
    const N = SEG + 1;
    const fx = clamp((x + HALF) / CELL, 0, SEG - 0.001), fz = clamp((z + HALF) / CELL, 0, SEG - 0.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, g = this.hgrid;
    return lerp(lerp(g[j * N + i], g[j * N + i + 1], u), lerp(g[(j + 1) * N + i], g[(j + 1) * N + i + 1], u), v);
  }
  /** Highest drivable surface at or below hint+1. */
  heightAt(x, z, hint = 0) {
    let y = this.terrainH(x, z);
    // bridge deck over the river
    if (x > -1620 && x < -1480 && Math.abs(z) < 9 && 0 <= hint + 1 && 0 > y) y = 0;
    // parking garage ramp / level 1
    if (x > 154 && x < 168 && z > 132 && z < 170) { const r = 4.5 * (z - 132) / 38; if (r <= hint + 1 && r > y) y = r; }
    else if (((x > 170 && x < 210 && z > 130 && z < 170) || (x > 150 && x < 210 && z > 170 && z < 190)) && 4.5 <= hint + 1 && 4.5 > y) y = 4.5;
    return y;
  }
  surfaceAt(x, z, out = {}) {
    const rd = this.roadDist(x, z);
    out.road = rd < 0.5 || this.zoneDist(x, z) < 0.01;
    out.mu = out.road ? 1 : lerp(0.58, 0.62, this.desertAmt(x, z));
    return out;
  }
  inTunnel(x, z) { return x > 1360 && x < 1740 && Math.abs(z) < 10; }

  /* ---------- roads ---------- */
  roadTex(type) {
    const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#2b2d31'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 3500; i++) { const v = 30 + Math.random() * 40; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 10, W, 6); g.fillRect(0, H - 16, W, 6);
    if (type === 'highway') {
      g.fillStyle = '#e2b800'; g.fillRect(0, H / 2 - 7, W, 4); g.fillRect(0, H / 2 + 3, W, 4);
      g.fillStyle = '#e8e8e8'; for (const y of [H * 0.25, H * 0.75]) for (const x of [0, 256]) g.fillRect(x, y - 2, 96, 5);
    } else { g.fillStyle = '#e2b800'; for (const x of [0, 256]) g.fillRect(x, H / 2 - 2, 128, 5); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  buildRoads() {
    const tex = { highway: this.roadTex('highway'), other: this.roadTex('street') };
    this.roadMats = [];
    this.roads.forEach((r, i) => {
      const L = r.a1 - r.a0, t = r.type === 'highway' ? tex.highway : tex.other;
      const mat = new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.6, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 - i * 0.01, polygonOffsetUnits: -2 });
      this.wrapWet(mat); this.roadMats.push(mat);
      const geo = new THREE.PlaneGeometry(L, r.w); geo.rotateX(-Math.PI / 2);
      const uv = geo.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setX(k, uv.getX(k) * L / 16);
      if (r.axis === 'z') geo.rotateY(Math.PI / 2);
      const m = new THREE.Mesh(geo, mat); m.receiveShadow = true;
      if (r.axis === 'x') m.position.set((r.a0 + r.a1) / 2, 0.06, r.c); else m.position.set(r.c, 0.06, (r.a0 + r.a1) / 2);
      this.scene.add(m);
    });
  }

  /* ---------- helpers ---------- */
  addCollider(x0, x1, z0, z1, y0, y1) { this.colliders.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, yMin: y0, yMax: y1, q: 0 }); }
  box(x, y0, z, w, h, d, mat, collide = true) {
    const m = new THREE.Mesh(this.unit || (this.unit = new THREE.BoxGeometry(1, 1, 1)), mat);
    m.scale.set(w, h, d); m.position.set(x, y0 + h / 2, z); m.castShadow = m.receiveShadow = true; this.scene.add(m);
    if (collide) this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, y0, y0 + h);
    return m;
  }
  mat(color, rough = 0.85, metal = 0) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }
  windowMat(kind = 'city') {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62 });
    this.nightU = this.nightU || { value: 0 };
    const house = kind === 'house';
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = this.nightU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vON; flat varying vec3 vC;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 wp4 = modelMatrix * instanceMatrix * vec4(transformed, 1.0); vWP = wp4.xyz; vON = objectNormal; vC = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vON; flat varying vec3 vC; uniform float uNight;')
        .replace('#include <color_fragment>', `#include <color_fragment>
        float side = step(abs(vON.y), 0.5); float topf = step(0.5, vON.y);
        float along = abs(vON.x) > 0.5 ? vWP.z : vWP.x;
        float s1 = fract(sin(dot(vC.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float s2 = fract(s1 * 7.31), s3 = fract(s1 * 13.7 + 0.3);
        float cw = mix(2.8, 4.6, s2), fh = mix(3.1, 4.0, s3);
        vec2 cell = vec2(along / cw, vWP.y / fh); vec2 fc = fract(cell); vec2 id = floor(cell);
        float curtain = ${house ? '0.0' : 'step(0.72, s1)'}, brick = 1.0 - step(0.22, s1);
        float fx = mix(0.58, 0.92, curtain) * (1.0 - 0.15 * brick), fy = mix(0.6, 0.8, curtain) * (1.0 - 0.12 * brick);
        vec2 fw = fwidth(cell); float aa = 1.0 - smoothstep(0.07, 0.3, max(fw.x, fw.y)); fw = max(fw, vec2(0.03));
        float bx0 = (1.0 - fx) * 0.5, by0 = (1.0 - fy) * 0.5;
        float wx = smoothstep(bx0 - fw.x, bx0 + fw.x, fc.x) * (1.0 - smoothstep(1.0 - bx0 - fw.x, 1.0 - bx0 + fw.x, fc.x));
        float wy = smoothstep(by0 - fw.y, by0 + fw.y, fc.y) * (1.0 - smoothstep(1.0 - by0 - fw.y, 1.0 - by0 + fw.y, fc.y));
        float win = mix(fx * fy, wx * wy, aa) * side * smoothstep(${house ? '0.7' : '4.3'}, ${house ? '1.3' : '4.9'}, vWP.y);
        float sfx = fract(along / 5.0), sfw = max(fwidth(along / 5.0), 0.02), sa = 1.0 - smoothstep(0.08, 0.3, sfw);
        float shopX = mix(0.88, smoothstep(0.06 - sfw, 0.06 + sfw, sfx) * (1.0 - smoothstep(0.94 - sfw, 0.94 + sfw, sfx)), sa);
        float shop = ${house ? '0.0' : '1.0'} * side * shopX * smoothstep(0.1, 0.25, vWP.y) * (1.0 - smoothstep(3.3, 3.5, vWP.y));
        float glassM = max(win, shop);
        float hh = fract(sin(dot(id + floor(vC.xz * 0.37) * 7.0, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 glassCol = mix(vec3(0.05, 0.08, 0.12), vec3(0.03, 0.14, 0.18), curtain);
        diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, glassM * 0.92);
        diffuseColor.rgb *= mix(0.74, 1.0, smoothstep(0.0, 16.0, vWP.y));
        diffuseColor.rgb *= mix(1.0, 0.55, topf);
        diffuseColor.rgb *= mix(1.0, 0.93 + 0.14 * fract(sin(id.y * 3.1 + s1 * 9.0) * 437.5), aa);
        float lit = (win * mix(0.45, step(0.55, hh), aa) + shop * mix(0.5, step(0.25, fract(hh * 3.7 + s1)), sa)) * uNight;`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += mix(vec3(1.0, 0.8, 0.48), vec3(0.65, 0.82, 1.0), step(0.86, hh)) * lit * (0.45 + 0.5 * hh) * (1.0 + shop * 0.3);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.05, glassM);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.75, glassM);');
    };
    return m;
  }
  instanced(geo, mat, items, cast = true) {
    const im = new THREE.InstancedMesh(geo, mat, items.length), o = new THREE.Object3D(), c = new THREE.Color();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z); o.scale.set(it.sx, it.sy, it.sz); o.rotation.set(0, it.ry || 0, 0); o.updateMatrix();
      im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(it.color));
    });
    im.castShadow = cast; im.receiveShadow = true; im.frustumCulled = false; this.scene.add(im); return im;
  }

  /* ---------- city, residential, towns ---------- */
  buildCity() {
    const plaza = new THREE.Mesh(new THREE.PlaneGeometry(1080, 1080).rotateX(-Math.PI / 2), this.mat(0x6d6f6c, 0.95));
    plaza.position.y = 0.02; plaza.receiveShadow = true; this.scene.add(plaza);
    const wm = this.windowMat(), bx = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.bx = bx; this.wm = wm;
    const items = [], rng = this.rng;
    const pal = [0x9a9ea4, 0xb4ab9b, 0x7d8794, 0xa8b2b8, 0xc2baa8, 0x8a8f86, 0xb9a48a];
    const reserved = new Set(['180,180', '-180,180', '-180,-180']);
    const slabs = [], trees = [], treeTrunks = [];
    // one building made of stacked, set-back tiers with cornices, rooftop plant and an antenna on the tallest
    const tower = (cx, cz, w, d, h, col) => {
      const tiers = h < 32 ? [[1, 1, h]] : h < 70 ? [[1, 1, 12 + rng() * 6], [0.8, 0.8, h]] : [[1, 1, 12 + rng() * 8], [0.82, 0.82, h * 0.74], [0.56, 0.56, h]];
      let y = 0;
      tiers.forEach(([fw, fd, top], i) => {
        const hgt = top - y, tw = w * fw, td = d * fd;
        items.push({ x: cx, y, z: cz, sx: tw, sy: hgt, sz: td, color: i === 0 ? col : col });
        items.push({ x: cx, y: top, z: cz, sx: tw + 0.7, sy: 0.55, sz: td + 0.7, color: 0xcfcdc6 });            // cornice / parapet
        if (i === tiers.length - 1) {
          for (let k = 0; k < 3; k++) items.push({ x: cx + (rng() - 0.5) * tw * 0.6, y: top + 0.55, z: cz + (rng() - 0.5) * td * 0.6, sx: 2 + rng() * 3, sy: 1.4 + rng() * 1.6, sz: 2 + rng() * 2, color: 0x7b7f84 });
          if (h > 90) items.push({ x: cx, y: top + 0.55, z: cz, sx: 0.5, sy: 18 + rng() * 14, sz: 0.5, color: 0xb0b4b8 });
        }
        y = top;
      });
      this.addCollider(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, 0, h);
      this.buildings.push({ cx, cz, w, d, h });
    };
    for (let ix = -4; ix < 4; ix++) for (let iz = -4; iz < 4; iz++) {
      const cx = ix * 120 + 60, cz = iz * 120 + 60;
      slabs.push({ x: cx, y: 0, z: cz, sx: 108, sy: 0.12, sz: 108, color: 0x9a9a95 });
      // street trees along the sidewalks
      for (let k = -1; k <= 1; k++) for (const [ex, ez] of [[50, k * 32], [-50, k * 32], [k * 32, 50], [k * 32, -50]]) {
        const tx = cx + ex, tz = cz + ez, s = 0.7 + rng() * 0.35;
        if (this.roadDist(tx, tz) < 7) continue;
        trees.push({ x: tx, y: 4.2 * s, z: tz, sx: s, sy: s, sz: s, color: [0x3f7d2e, 0x4c8b34, 0x2f6a28][(rng() * 3) | 0] });
        treeTrunks.push({ x: tx, y: 0, z: tz, sx: s, sy: s, sz: s, color: 0x5a3f2a });
      }
      if (reserved.has(`${cx},${cz}`)) continue;
      const d = Math.hypot(cx, cz), tall = lerp(150, 20, smoothstep(0, 520, d));
      if (d < 260) {                                         // downtown: two big plots
        for (const a of [-1, 1]) tower(cx + a * 25, cz, 40 + rng() * 6, 78 + rng() * 10, tall * (0.45 + rng() * 0.75), pal[(rng() * pal.length) | 0]);
      } else {                                               // outer blocks: four smaller buildings
        for (const a of [-1, 1]) for (const b of [-1, 1]) tower(cx + a * 25, cz + b * 25, 32 + rng() * 6, 32 + rng() * 6, tall * (0.4 + rng() * 0.9), pal[(rng() * pal.length) | 0]);
      }
    }
    this.instanced(bx, wm, items);
    const flat = this.mat(0xffffff, 0.92);
    this.instanced(bx, flat, slabs, false);
    const leafMat = this.mat(0xffffff, 0.9); this.swayMat(leafMat);
    this.instanced(new THREE.IcosahedronGeometry(2.4, 1), leafMat, trees, false);
    this.instanced(new THREE.CylinderGeometry(0.18, 0.26, 4, 6).translate(0, 2, 0), leafMat, treeTrunks, false);
    // parking garage + dealership
    const conc = this.mat(0x8a8a86, 0.9);
    this.box(180, 4.5, 160, 40, 0.5, 40, conc, false); this.box(180, 9, 160, 60, 0.5, 60, conc, false);
    for (const [px, pz] of [[150, 130], [210, 130], [150, 190], [210, 190], [180, 160]]) this.box(px, 0, pz, 1.2, 9, 1.2, conc);
    for (const [x, z, w, d] of [[150, 160, 0.4, 60], [210, 160, 0.4, 60], [180, 190, 60, 0.4], [190, 130, 40, 0.4]]) this.box(x, 5, z, w, 1, d, conc, true);
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(14, 0.4, Math.hypot(38, 4.5)), conc);
    ramp.position.set(161, 2.25, 151); ramp.rotation.x = -Math.atan2(4.5, 38); ramp.receiveShadow = true; this.scene.add(ramp);
    this.box(-180, 0, 205, 34, 6, 20, this.mat(0x1b3a5c, 0.3, 0.4));
    const mk = new THREE.Mesh(new THREE.RingGeometry(3, 4, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2aa0ff }));
    mk.position.set(-180, 0.12, 130); this.scene.add(mk);
    // residential houses: gable roofs, chimneys, porches
    const houses = [], roofs = [], extras = [];
    const gableShape = new THREE.Shape(); gableShape.moveTo(-0.5, 0); gableShape.lineTo(0.5, 0); gableShape.lineTo(0, 1); gableShape.closePath();
    const gable = new THREE.ExtrudeGeometry(gableShape, { depth: 1, bevelEnabled: false }).translate(0, 0, -0.5).rotateY(Math.PI / 2);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 5; j++) for (let k = 0; k < 4; k++) {
      const x = -950 + i * 100 + (k % 2 ? 22 : -22), z = 350 + j * 100 + (k > 1 ? 22 : -22);
      if (this.roadDist(x, z) < 10) continue;
      const w = 9 + rng() * 3, d = 8 + rng() * 2, h = 4.6 + rng() * 1.4, rh = 2.6 + rng() * 1.2;
      const col = [0xe8dcc5, 0xcfd8dc, 0xd9b99b, 0xb7c4a3, 0xe2c9c0][(rng() * 5) | 0], roof = [0x7a3b2a, 0x4a4f57, 0x5a3f33, 0x6b4a3a][(rng() * 4) | 0];
      houses.push({ x, y: 0, z, sx: w, sy: h, sz: d, color: col });
      roofs.push({ x, y: h, z, sx: w + 1.2, sy: rh, sz: d + 1.2, color: roof });
      extras.push({ x: x + w * 0.25, y: h + rh * 0.35, z, sx: 0.9, sy: 2.6, sz: 0.9, color: 0x8a4a3a });             // chimney
      extras.push({ x, y: 0, z: z + d / 2 + 1.2, sx: 4, sy: 0.35, sz: 2.4, color: 0xbdb8ae });                      // porch slab
      extras.push({ x, y: 2.7, z: z + d / 2 + 1.3, sx: 4.4, sy: 0.25, sz: 2.8, color: roof });                       // porch roof
      for (const s of [-1, 1]) extras.push({ x: x + s * 1.9, y: 0.35, z: z + d / 2 + 2.3, sx: 0.2, sy: 2.4, sz: 0.2, color: 0xf2f0ea });
      this.addCollider(x - w / 2, x + w / 2, z - d / 2, z + d / 2, 0, h);
    }
    this.instanced(this.bx, this.windowMat('house'), houses);
    this.instanced(gable, this.mat(0xffffff, 0.8), roofs);
    this.instanced(this.bx, this.mat(0xffffff, 0.85), extras);
    // small towns: shops along the highway, with awnings, signs and rooftop units
    const shops = [], shopExtras = [];
    const AW = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x8e44ad];
    const town = (x0, x1, z0, along) => {
      for (let x = x0; x < x1; x += 42) for (const s of [-1, 1]) {
        const px = along === 'x' ? x : s * 30, pz = along === 'x' ? s * 30 : x;
        const w = 16, d = 12, h = 5 + rng() * 6;
        if (this.sites.some(([sx, sz]) => Math.abs(sx - px) < 30 && Math.abs(sz - pz) < 30)) continue;
        if (this.poiSites.some(([bx, bz]) => Math.abs(bx - px) < 30 && Math.abs(bz - pz) < 30)) continue;
        if (this.roadDist(px, pz) < 14) continue;
        const col = [0xcbb89b, 0xa9b7c0, 0xc9a38c, 0xd9cfb5][(rng() * 4) | 0], aw = AW[(rng() * AW.length) | 0];
        const sw = along === 'x' ? w : d, sd = along === 'x' ? d : w;     // footprint along x / z
        shops.push({ x: px, y: 0, z: pz, sx: sw, sy: h, sz: sd, color: col });
        shops.push({ x: px, y: h, z: pz, sx: sw + 0.6, sy: 0.5, sz: sd + 0.6, color: 0xd8d4c8 });
        const fx = along === 'x' ? 0 : -s, fz = along === 'x' ? -s : 0;     // faces the road
        shopExtras.push({ x: px + fx * (sd / 2 + 1.0), y: 3.5, z: pz + fz * (sd / 2 + 1.0), sx: along === 'x' ? sw * 0.9 : 2.2, sy: 0.25, sz: along === 'x' ? 2.2 : sw * 0.9, color: aw });
        shopExtras.push({ x: px + fx * (sd / 2 + 0.2), y: h * 0.72, z: pz + fz * (sd / 2 + 0.2), sx: along === 'x' ? sw * 0.5 : 0.25, sy: 1.0, sz: along === 'x' ? 0.25 : sw * 0.5, color: aw });
        shopExtras.push({ x: px + 2, y: h + 0.5, z: pz - 1, sx: 2.6, sy: 1.5, sz: 2, color: 0x7b7f84 });
        this.addCollider(px - sw / 2, px + sw / 2, pz - sd / 2, pz + sd / 2, 0, h);
      }
    };
    town(2220, 2780, 0, 'x'); town(-2630, -2270, 0, 'z');
    for (let z = 1020; z < 1280; z += 40) for (const s of [-1, 1]) {
      const px = 3000 + s * 22, h = 4; shops.push({ x: px, y: 0, z, sx: 14, sy: h, sz: 14, color: 0xc8a97a });
      shops.push({ x: px, y: h, z, sx: 14.6, sy: 0.4, sz: 14.6, color: 0xb59468 });
      this.addCollider(px - 7, px + 7, z - 7, z + 7, 0, h);
    }
    this.instanced(this.bx, this.wm, shops);
    this.instanced(this.bx, this.mat(0xffffff, 0.7), shopExtras);
  }

  /* ---------- gas stations ---------- */
  buildStations() {
    const rng = this.rng, conc = this.mat(0xcfcfcf, 0.8), red = this.mat(0xd22030, 0.5);
    for (const [sx, sz] of this.sites) {
      const price = +(2.1 + rng() * 0.6).toFixed(2);
      this.box(sx, 5, sz, 16, 0.6, 9, red, false);
      for (const dx of [-7, 7]) for (const dz of [-3.5, 3.5]) this.box(sx + dx, 0, sz + dz, 0.5, 5, 0.5, conc);
      const pumps = [];
      for (const dx of [-4, 4]) { this.box(sx + dx, 0, sz, 0.8, 1.5, 0.6, this.mat(0x222a33, 0.4)); this.box(sx + dx, 1.0, sz, 0.5, 0.3, 0.65, new THREE.MeshBasicMaterial({ color: 0x66ff99 }), false); pumps.push({ x: sx + dx, z: sz }); }
      const dir = sz < 0 ? -1 : 1;
      this.box(sx, 0, sz + dir * 15, 14, 4, 8, this.mat(0xe6e2d8, 0.7));
      const sign = new THREE.Mesh(new THREE.BoxGeometry(5, 3, 0.3), new THREE.MeshBasicMaterial({ map: this.signTex(price) }));
      sign.position.set(sx - 12, 11, sz + dir * 4); this.scene.add(sign);
      this.box(sx - 12, 0, sz + dir * 4, 0.5, 9.5, 0.5, conc);
      this.stations.push({ x: sx, z: sz, pumps, price });
    }
  }
  /* ---------- cafés, diners & marts (rob / delivery jobs) ---------- */
  buildPOIs() {
    const NAMES = [['Bean There Café', 'cafe'], ['Dusty Diner', 'diner'], ['Mile Nine Café', 'cafe'], ['Roadhouse Grill', 'diner'], ['Sunrise Bakery', 'cafe'],
      ['Quick Stop Mart', 'mart'], ['Cactus Café', 'cafe'], ['Harbor Diner', 'diner'], ['Night Owl Mart', 'mart']];
    const COL = { cafe: 0x35d07f, diner: 0xffa63d, mart: 0x6ab7ff }, WALL = { cafe: 0xd9c3a0, diner: 0xc9d4d8, mart: 0xb9c7dd };
    this.pois = [];
    this.poiSites.forEach(([bx, bz, rx, rz], i) => {
      const [name, type] = NAMES[i % NAMES.length];
      const alongZ = Math.abs(rz - bz) > Math.abs(rx - bx), dirx = Math.sign(rx - bx), dirz = Math.sign(rz - bz);
      const w = alongZ ? 14 : 8, d = alongZ ? 8 : 14;
      this.box(bx, 0, bz, w, 4.5, d, this.mat(WALL[type], 0.8));
      const dm = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 2.2 : 0.12, 2.5, alongZ ? 0.12 : 2.2), this.mat(0x1d2a33, 0.1, 0.7)); dm.position.set(bx + dirx * 4.05, 1.25, bz + dirz * 4.05); this.scene.add(dm);
      const awn = this.box(bx + dirx * (d / 2 + 0.6), 3.0, bz + dirz * (d / 2 + 0.6), alongZ ? w : 1.6, 0.3, alongZ ? 1.6 : d, this.mat(COL[type], 0.6), false);
      void awn;
      const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
      g.fillStyle = '#' + COL[type].toString(16).padStart(6, '0'); g.fillRect(0, 0, 256, 64); g.fillStyle = '#111'; g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 128, 34);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
      sign.position.set(bx + dirx * (d / 2 + 0.2), 5.3, bz + dirz * (d / 2 + 0.2)); sign.rotation.y = alongZ ? 0 : Math.PI / 2; this.scene.add(sign);
      const ring = new THREE.Mesh(new THREE.RingGeometry(3, 3.8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: COL[type] }));
      ring.position.set(rx, 0.12, rz); this.scene.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 70, 14, 1, true), new THREE.MeshBasicMaterial({ color: COL[type], transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(rx, 35, rz); this.scene.add(beam);
      this.pois.push({ id: i, name, type, x: rx, z: rz, bx, bz, cool: 0, beam, door: { x: bx + dirx * 5.6, z: bz + dirz * 5.6, nx: dirx, nz: dirz }, color: '#' + COL[type].toString(16).padStart(6, '0') });
    });
  }
  /* ---------- houses for sale / villas ---------- */
  buildProperties() {
    const T = [
      { name: 'Starter Shack', owner: 'Mr. Okoye', price: 6000, tier: 1, sc: 0.75, color: 0xb5a48a, desc: 'A tiny one-room place by the old road. Everyone starts somewhere.' },
      { name: 'Maple Cottage', owner: 'Mrs. Lindqvist', price: 28000, tier: 2, sc: 0.95, color: 0xe3d5b8, desc: 'A cosy cottage with a lovely garden and lots of light.' },
      { name: 'Desert Ranch', owner: 'Rancher Dale', price: 65000, tier: 3, sc: 1.15, color: 0xd3b48a, desc: 'Wide open desert views, a big porch, and not a neighbour for miles.' },
      { name: 'Mountain Lodge', owner: 'Old Man Brandt', price: 140000, tier: 4, sc: 1.35, color: 0x7b5a3c, desc: 'A timber lodge up in the mountain pass. Fresh air and total privacy.' },
      { name: 'Sky Villa', owner: 'Ms. Valdez', price: 320000, tier: 5, sc: 1.7, color: 0xf2f2f0, desc: 'The finest villa near the airport. Modern, huge, and very expensive.' },
    ];
    const unit = new THREE.BoxGeometry(1, 1, 1), cone = new THREE.ConeGeometry(0.7071, 1, 4).rotateY(Math.PI / 4);
    const label = (text, color) => {
      const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
      g.fillStyle = color; g.fillRect(0, 0, 512, 128); g.fillStyle = '#111'; g.font = 'bold 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 66);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false })); sp.scale.set(7, 1.75, 1); return sp;
    };
    this.properties = [];
    T.forEach((P, i) => {
      const [bx, bz, rx, rz] = this.propSites[i];
      Object.assign(P, { id: i, bx, bz, x: rx, z: rz });
      const dirx = Math.sign(rx - bx), dirz = Math.sign(rz - bz), alongZ = Math.abs(rz - bz) > Math.abs(rx - bx);
      const W = 12 * P.sc, D = 9 * P.sc, H = 5.5 * P.sc;
      const g = new THREE.Group(); g.position.set(bx, 0, bz); g.rotation.y = Math.atan2(dirx, dirz); this.scene.add(g);
      const add = (geo, mat, x, y, z, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
      const wall = this.mat(P.color, 0.85), dark = this.mat(0x1d2430, 0.3, 0.4), glassM = this.mat(0x7fb3d9, 0.1, 0.6);
      add(unit, wall, 0, H / 2, 0, W, H, D);
      add(cone, this.mat(0x6b3a2a, 0.8), 0, H + 1.25 * P.sc, 0, W * 1.12, 2.5 * P.sc, D * 1.12);
      add(unit, dark, 0, 1.1, D / 2 + 0.03, 1.3, 2.2, 0.1);
      for (const x of [-W * 0.3, W * 0.3]) add(unit, glassM, x, H * 0.55, D / 2 + 0.03, 1.6, 1.4, 0.1);
      const parts = {
        garage: new THREE.Group(), pool: new THREE.Group(), solar: new THREE.Group(), security: new THREE.Group(), workshop: new THREE.Group(),
      };
      for (const k in parts) { parts[k].visible = false; g.add(parts[k]); }
      const addTo = (grp, geo, mat, x, y, z, sx, sy, sz) => { const m = add(geo, mat, x, y, z, sx, sy, sz); g.remove(m); grp.add(m); return m; };
      addTo(parts.garage, unit, wall, W / 2 + 3.6, 2.1, 0, 6.5, 4.2, D * 0.95);
      addTo(parts.garage, unit, this.mat(0x55606e, 0.5, 0.5), W / 2 + 3.6, 1.6, D * 0.475 + 0.05, 5, 3.2, 0.1);
      addTo(parts.pool, unit, this.mat(0xcfd6d8, 0.8), 0, 0.05, -(D / 2 + 6), 11, 0.1, 6.4);
      addTo(parts.pool, unit, new THREE.MeshStandardMaterial({ color: 0x2aa8d8, roughness: 0.05, metalness: 0.2, emissive: 0x0a4a66, emissiveIntensity: 0.4 }), 0, 0.12, -(D / 2 + 6), 10, 0.06, 5.4);
      for (const x of [-W * 0.28, 0, W * 0.28]) { const pn = addTo(parts.solar, unit, this.mat(0x16264a, 0.3, 0.7), x, H + 1.0 * P.sc, D * 0.18, W * 0.24, 0.1, 2.2); pn.rotation.x = 0.5; }
      for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) { addTo(parts.security, unit, this.mat(0x222222), x, H - 0.4, D / 2 + 0.2, 0.3, 0.25, 0.5); addTo(parts.security, unit, new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff2020, emissiveIntensity: 2 }), x, H - 0.4, D / 2 + 0.5, 0.1, 0.1, 0.05); }
      addTo(parts.workshop, unit, this.mat(0x8a929a, 0.7), -(W / 2 + 3.6), 1.7, -D * 0.1, 6, 3.4, 6);
      addTo(parts.workshop, unit, this.mat(0xff7a00, 0.5), -(W / 2 + 3.6), 3.4, -D * 0.1 + 3.02, 6.2, 0.5, 0.1);
      // owner NPC
      const human = createHuman({ female: i % 2 === 1, hairStyle: i % 2 ? 'long' : i === 0 ? 'bald' : 'short', longSleeve: true, shorts: false, skirt: false, build: 1 });
      const npc = human.group; npc.position.set(2.2 * P.sc, 0, D / 2 + 2.4); g.add(npc); P.human = human;
      const sale = label(`FOR SALE · ${P.name}`, '#ffe14d'), homeL = label(`HOME · ${P.name}`, '#7be07b');
      sale.position.set(0, H + 3.6 * P.sc, D / 2 + 1); homeL.position.copy(sale.position); homeL.visible = false; g.add(sale, homeL);
      const [cw, cd] = alongZ ? [W, D] : [D, W];
      this.addCollider(bx - cw / 2, bx + cw / 2, bz - cd / 2, bz + cd / 2, 0, H + 3);
      const ring = new THREE.Mesh(new THREE.RingGeometry(3, 3.8, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      ring.position.set(rx, 0.12, rz); this.scene.add(ring);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 70, 14, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      beam.position.set(rx, 35, rz); this.scene.add(beam);
      P.door = { x: bx + dirx * (D / 2 + 1.6), z: bz + dirz * (D / 2 + 1.6), nx: dirx, nz: dirz };
      Object.assign(P, { parts, npc, sale, homeL, ring, beam });
      this.properties.push(P);
    });
  }
  applyHomes(save) {
    for (const P of this.properties) {
      const h = save.homes?.[P.id], owned = !!h;
      P.npc.visible = !owned; P.sale.visible = !owned; P.homeL.visible = owned;
      P.ring.material.color.set(owned ? 0xffd60a : 0xffffff); P.beam.material.color.set(owned ? 0xffd60a : 0xffffff);
      for (const k in P.parts) P.parts[k].visible = !!h?.upgrades?.[k];
    }
  }
  nearEntrance(x, z) { return this.extras.nearEntrance(x, z); }
  /** A property-like object for an apartment you own (used by the home menu). */
  aptProp(idx, save) {
    const b = this.buildings[idx], h = save?.homes?.[1000 + idx], a = h?.upgrades?._apt;
    return { id: 1000 + idx, kind: 'apt', tier: 2, name: (a ? a.unit + ', floor ' + a.floor + ' - ' : '') + b.name, owner: 'Reception', x: b.door.x, z: b.door.z, bx: b.cx, bz: b.cz };
  }
  nearPoiDoor(x, z, r = 3.4) { for (const P of this.pois) if (Math.hypot(x - P.door.x, z - P.door.z) < r) return P; return null; }
  nearPropDoor(x, z, r = 3.4) { for (const P of this.properties) if (Math.hypot(x - P.door.x, z - P.door.z) < r) return P; return null; }
  nearProperty(x, z, r = 6) { for (const P of this.properties) if (Math.hypot(x - P.x, z - P.z) < r) return P; return null; }

  /* ---------- road graph + GPS routing ---------- */
  buildGraph() {
    this.roadNodes = this.roads.map((r) => {
      const pts = new Set([r.a0, r.a1]);
      for (const o of this.roads) if (o.axis !== r.axis && o.c >= r.a0 && o.c <= r.a1 && r.c >= o.a0 && r.c <= o.a1) pts.add(o.c);
      return [...pts];
    });
  }
  /** Shortest drivable route as a polyline of {x,z}. Always returns at least start and end. */
  route(x0, z0, x1, z1) {
    const roads = this.roads, pos = (r, s) => (r.axis === 'x' ? [s, r.c] : [r.c, s]);
    const snap = (x, z) => {
      let bi = 0, bd = 1e9, bs = 0;
      roads.forEach((r, i) => { const [p, q] = r.axis === 'x' ? [x, z] : [z, x], s = clamp(p, r.a0, r.a1), d = Math.hypot(p - s, q - r.c); if (d < bd) { bd = d; bi = i; bs = s; } });
      return { i: bi, s: bs };
    };
    const A = snap(x0, z0), B = snap(x1, z1), nodes = new Map();
    const getN = (x, z) => { const k = Math.round(x * 2) + ',' + Math.round(z * 2); let n = nodes.get(k); if (!n) nodes.set(k, n = { x, z, e: [], d: Infinity, prev: null, done: false }); return n; };
    roads.forEach((r, i) => {
      const pts = [...this.roadNodes[i]]; if (A.i === i) pts.push(A.s); if (B.i === i) pts.push(B.s); pts.sort((a, b) => a - b);
      for (let k = 0; k < pts.length - 1; k++) {
        const len = pts[k + 1] - pts[k]; if (len < 0.01) continue;
        const na = getN(...pos(r, pts[k])), nb = getN(...pos(r, pts[k + 1]));
        na.e.push([nb, len]); nb.e.push([na, len]);
      }
    });
    const start = getN(...pos(roads[A.i], A.s)), goal = getN(...pos(roads[B.i], B.s));
    start.d = 0; const open = [start];
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (open[i].d < open[bi].d) bi = i;
      const n = open.splice(bi, 1)[0]; if (n.done) continue; n.done = true; if (n === goal) break;
      for (const [m, w] of n.e) if (!m.done && n.d + w < m.d) { m.d = n.d + w; m.prev = n; open.push(m); }
    }
    const pts = [];
    if (goal.d < Infinity) for (let n = goal; n; n = n.prev) pts.push({ x: n.x, z: n.z });
    pts.reverse();
    return [{ x: x0, z: z0 }, ...pts, { x: x1, z: z1 }];
  }

  /* ---------- shader helpers ---------- */
  waterNormals() {
    const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d'), img = g.createImageData(N, N);
    const waves = []; for (let k = 0; k < 9; k++) waves.push({ fx: 1 + ((Math.random() * 6) | 0), fy: 1 + ((Math.random() * 6) | 0), a: 0.5 / (1 + k * 0.5), p: Math.random() * 6.28 });
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let dx = 0, dy = 0;
      for (const w of waves) { const ph = 2 * Math.PI * (w.fx * x + w.fy * y) / N + w.p, cs = Math.cos(ph) * w.a * 2 * Math.PI / N; dx += cs * w.fx; dy += cs * w.fy; }
      const nx = -dx * 14, ny = -dy * 14, l = Math.hypot(nx, ny, 1), o = (y * N + x) * 4;
      img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  /** Wet-road shader: puddles with sky reflections, darkened and glossy when it rains. */
  wrapWet(mat) {
    this.wetU = this.wetU || { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWet = this.wetU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform float uWet;\nfloat hsh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}\nfloat vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hsh(i),hsh(i+vec2(1,0)),u.x),mix(hsh(i+vec2(0,1)),hsh(i+vec2(1,1)),u.x),u.y);}')
        .replace('#include <color_fragment>', '#include <color_fragment>\nfloat pn = vn(vWP.xz * 0.22) * 0.6 + vn(vWP.xz * 0.85) * 0.4; float pud = smoothstep(0.5, 0.62, pn) * uWet; diffuseColor.rgb *= mix(1.0, 0.5, uWet);')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(mix(roughnessFactor, 0.42, uWet * 0.75), 0.04, pud);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, pud);');
    };
  }
  /** Wind sway for trees / cacti (instanced). */
  swayMat(mat) {
    this.timeU = this.timeU || { value: 0 }; this.windU = this.windU || { value: 0.5 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.timeU; sh.uniforms.uWind = this.windU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat swp = sin(uTime * 1.7 + instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.23) * 0.035 * uWind * max(position.y, 0.0);\ntransformed.x += swp; transformed.z += swp * 0.6;\n#endif');
    };
  }

  signTex(price) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 150; const g = c.getContext('2d');
    g.fillStyle = '#d22030'; g.fillRect(0, 0, 256, 150); g.fillStyle = '#fff'; g.font = 'bold 54px Arial'; g.textAlign = 'center';
    g.fillText('VYT FUEL', 128, 70); g.fillStyle = '#ffe14d'; g.font = 'bold 48px Arial'; g.fillText(`$${price.toFixed(2)}/L`, 128, 130);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  nearestStation(x, z, maxD = 7) {
    let best = null, bd = maxD;
    for (const s of this.stations) for (const p of s.pumps) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = s; } }
    return best;
  }

  /* ---------- tunnel, bridge, airport ---------- */
  buildLandmarks() {
    const conc = this.mat(0x9a9a96, 0.9);
    // tunnel
    this.box(1550, 8, 0, 380, 3, 30, conc, false);
    this.box(1550, 0, 12.5, 380, 8, 3, conc); this.box(1550, 0, -12.5, 380, 8, 3, conc);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.mat(0x4f6b3a, 1));
    dome.scale.set(180, 30, 110); dome.position.set(1550, 0, 0); dome.castShadow = dome.receiveShadow = true; this.scene.add(dome);
    // bridge
    const steel = this.mat(0x8a949c, 0.5, 0.6);
    for (const z of [-9.3, 9.3]) this.box(-1550, 0, z, 140, 1.1, 0.3, steel);
    for (const x of [-1600, -1500]) for (const z of [-11, 11]) this.box(x, 0, z, 1.5, 40, 1.5, steel, false);
    for (const x of [-1585, -1550, -1515]) this.box(x, -9, 0, 3, 9, 14, conc, false);
    // airport
    const rw = new THREE.Mesh(new THREE.PlaneGeometry(900, 45).rotateX(-Math.PI / 2), this.mat(0x2a2b2e, 0.95));
    rw.position.set(-2500, 0.07, 1500); rw.receiveShadow = true; this.scene.add(rw);
    for (let x = -2940; x < -2060; x += 40) { const s = new THREE.Mesh(new THREE.PlaneGeometry(20, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xeeeeee })); s.position.set(x, 0.09, 1500); this.scene.add(s); }
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(400, 37).rotateX(-Math.PI / 2), this.mat(0x777977, 0.95));
    apron.position.set(-2450, 0.07, 1458); this.scene.add(apron);
    this.box(-2340, 0, 1415, 180, 14, 40, this.mat(0x7ea4bf, 0.2, 0.5));
    this.box(-2800, 0, 1415, 200, 14, 40, this.mat(0xb0b4b8, 0.6));
    this.box(-2300, 0, 1380, 8, 34, 8, conc); this.box(-2300, 34, 1380, 16, 5, 16, this.mat(0x4d7fa6, 0.2, 0.5), false);
    for (const x of [-2420, -2380, -2340]) {
      const p = new THREE.Group(), body = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 20, 6, 12).rotateZ(Math.PI / 2), this.mat(0xeeeeee, 0.4));
      const wing = new THREE.Mesh(new THREE.BoxGeometry(5, 0.25, 26), this.mat(0xdddddd, 0.4)); const tail = new THREE.Mesh(new THREE.BoxGeometry(2.5, 5, 0.3), this.mat(0xd22030, 0.4)); tail.position.set(-9, 3, 0);
      p.add(body, wing, tail); p.position.set(x, 2.6, 1455); p.castShadow = true; this.scene.add(p);
    }
  }

  /* ---------- trees, cacti, rocks ---------- */
  buildNature() {
    const rng = this.rng, pine = [], leaf = [], trunk = [], rock = [], cactus = [];
    for (let n = 0; n < 9000 && pine.length + leaf.length + cactus.length < 3600; n++) {
      const x = (rng() - 0.5) * 7800, z = (rng() - 0.5) * 7800;
      if (this.roadDist(x, z) < 30 || this.zoneDist(x, z) < 1.3 || Math.abs(x + 1550) < 140 && true) continue;
      const h = this.terrainH(x, z), dd = this.desertAmt(x, z), f = fbm(x * 0.003, z * 0.003, 9);
      if (dd > 0.5) { if (rng() < 0.25) cactus.push({ x, y: h, z, sx: 1, sy: 2 + rng() * 2, sz: 1, color: 0x3f7a3a }); else if (rng() < 0.2) rock.push({ x, y: h, z, sx: 1 + rng() * 3, sy: 1 + rng() * 2, sz: 1 + rng() * 3, color: 0x9a7f5c }); continue; }
      if (h > 330) continue;
      if (h > 50 && f > 0.35 && rng() < 0.7) { const s = 0.8 + rng() * 0.9; pine.push({ x, y: h + 3 * s, z, sx: s, sy: s, sz: s, color: 0x1f4a2a }); trunk.push({ x, y: h, z, sx: s, sy: s, sz: s, color: 0x4a3322 }); }
      else if (f > 0.5 && rng() < 0.5) { const s = 0.8 + rng() * 0.8; leaf.push({ x, y: h + 5 * s, z, sx: s, sy: s, sz: s, color: [0x3b7a2c, 0x4a8a30, 0x2f6a28][(rng() * 3) | 0] }); trunk.push({ x, y: h, z, sx: s, sy: s, sz: s, color: 0x5a3f2a }); if (this.roadDist(x, z) < 300) this.addCollider(x - 0.4, x + 0.4, z - 0.4, z + 0.4, h - 1, h + 8); }
      else if (rng() < 0.05) rock.push({ x, y: h, z, sx: 1 + rng() * 3, sy: 1 + rng() * 2, sz: 1 + rng() * 3, color: 0x6b6a66 });
    }
    const m = this.mat(0xffffff, 0.9); this.swayMat(m);
    this.instanced(new THREE.ConeGeometry(2.2, 9, 7), m, pine, false);
    this.instanced(new THREE.IcosahedronGeometry(3, 1), m, leaf, false);
    this.instanced(new THREE.CylinderGeometry(0.25, 0.35, 5, 6).translate(0, 2.5, 0), m, trunk, false);
    this.instanced(new THREE.DodecahedronGeometry(1, 0), m, rock, false);
    this.instanced(new THREE.CylinderGeometry(0.4, 0.5, 1, 8).translate(0, 0.5, 0), m, cactus, false);
  }

  /* ---------- collision hash ---------- */
  buildHash() {
    const C = 40;
    this.colliders.forEach((c, i) => {
      for (let ix = Math.floor(c.minX / C); ix <= Math.floor(c.maxX / C); ix++) for (let iz = Math.floor(c.minZ / C); iz <= Math.floor(c.maxZ / C); iz++) {
        const k = ix * 100003 + iz; let a = this.hash.get(k); if (!a) this.hash.set(k, a = []); a.push(i);
      }
    });
  }
  queryColliders(x, z, r, y) {
    const C = 40, out = []; this.qid++;
    for (let ix = Math.floor((x - r) / C); ix <= Math.floor((x + r) / C); ix++) for (let iz = Math.floor((z - r) / C); iz <= Math.floor((z + r) / C); iz++) {
      const a = this.hash.get(ix * 100003 + iz); if (!a) continue;
      for (const i of a) { const c = this.colliders[i]; if (c.q === this.qid) continue; c.q = this.qid; if (y + 0.8 > c.yMin && y - 0.4 < c.yMax) out.push(c); }
    }
    return out;
  }

  buildMinimap() {
    const S = 2048, k = S / 8000, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const R = 512, tc = document.createElement('canvas'); tc.width = tc.height = R; const tg = tc.getContext('2d'), img = tg.createImageData(R, R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
      const x = -4000 + (i + 0.5) * 8000 / R, z = -4000 + (j + 0.5) * 8000 / R, h = this.terrainH(x, z);
      const sh = clamp(0.95 - ((this.terrainH(x + 30, z) - this.terrainH(x - 30, z)) * 0.6 + (this.terrainH(x, z + 30) - this.terrainH(x, z - 30)) * 0.6) * 0.012, 0.45, 1.25);
      const dd = this.desertAmt(x, z); let r = lerp(72, 196, dd), gg = lerp(108, 166, dd), b = lerp(62, 104, dd);
      if (h > 140) { const t = clamp((h - 140) / 120, 0, 1); r = lerp(r, 112, t); gg = lerp(gg, 108, t); b = lerp(b, 102, t); }
      if (h > 330) { r = gg = b = 235; }
      if (h < -2) { r = 58; gg = 112; b = 160; }
      const o = (j * R + i) * 4; img.data[o] = clamp(r * sh, 0, 255); img.data[o + 1] = clamp(gg * sh, 0, 255); img.data[o + 2] = clamp(b * sh, 0, 255); img.data[o + 3] = 255;
    }
    tg.putImageData(img, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(tc, 0, 0, S, S);
    g.fillStyle = 'rgba(110,110,110,0.85)'; g.fillRect((-540 + 4000) * k, (-540 + 4000) * k, 1080 * k, 1080 * k);
    for (const r of this.roads) { g.strokeStyle = r.type === 'highway' ? '#f4d35e' : '#ddd'; g.lineWidth = Math.max(2, r.w * k * 1.4); g.beginPath();
      if (r.axis === 'x') { g.moveTo((r.a0 + 4000) * k, (r.c + 4000) * k); g.lineTo((r.a1 + 4000) * k, (r.c + 4000) * k); } else { g.moveTo((r.c + 4000) * k, (r.a0 + 4000) * k); g.lineTo((r.c + 4000) * k, (r.a1 + 4000) * k); } g.stroke(); }
    for (const s of this.stations) { g.fillStyle = '#ff7a00'; g.beginPath(); g.arc((s.x + 4000) * k, (s.z + 4000) * k, 7, 0, 7); g.fill(); }
    for (const q of this.pois) { g.fillStyle = q.color; g.fillRect((q.x + 4000) * k - 6, (q.z + 4000) * k - 6, 12, 12); }
    g.fillStyle = '#2aa0ff'; g.beginPath(); g.arc((-180 + 4000) * k, (130 + 4000) * k, 8, 0, 7); g.fill();
    this.minimap = c; this.mmScale = k;
  }

  update(dt, env, camPos) {
    this.nightU.value = env.night;
    if (camPos) for (const P of this.properties) if (P.npc.visible && Math.hypot(P.x - camPos.x, P.z - camPos.z) < 90) P.human.pose(this.timeU.value * 1.4 + P.id * 2, 0, 'idle');
    if (this.extras && camPos) this.extras.update(dt, env, camPos);
    this.lampMat.emissiveIntensity = env.night * 4;
    this.wetU.value = env.wetness;
    this.timeU.value += dt; this.windU.value = 0.4 + env.cur.wind;
    if (this.water) {
      this.water.visible = camPos ? Math.abs(camPos.x + 1550) < 650 : true;
      this.water.material.uniforms.time.value += dt * 0.5;
      if (env.sunDir) this.water.material.uniforms.sunDirection.value.copy(env.sunDir);
    }
  }
}

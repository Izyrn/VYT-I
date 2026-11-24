import * as THREE from 'three';
import { createCarMesh } from './carmodel.js';
import { createHuman } from './human.js';

const ORIGIN_X = 12000;         // interiors live far outside the map; the world is hidden while you are inside
const box = new THREE.BoxGeometry(1, 1, 1);
const FLOOR_H = 3.6;

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function labelPlane(text, w, h, bg, fg) {
  const t = canvasTex(256, Math.round(256 * h / w), (g, W, H) => { g.fillStyle = bg; g.fillRect(0, 0, W, H); g.fillStyle = fg; g.font = 'bold ' + Math.round(H * 0.5) + 'px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + 2); });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
}
function makePerson(shirtColor) {
  const g = new THREE.Group();
  const shirt = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.8 }), pants = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.8 }), skin = new THREE.MeshStandardMaterial({ color: 0xcf9d78, roughness: 0.7 });
  const mk = (geo, m, x, y, z, sx, sy, sz) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); g.add(o); };
  mk(box, shirt, 0, 1.25, 0, 0.5, 0.62, 0.26); mk(box, pants, 0, 0.5, 0, 0.36, 0.95, 0.22);
  mk(new THREE.SphereGeometry(0.15, 12, 10), skin, 0, 1.73, 0, 1, 1, 1);
  mk(new THREE.SphereGeometry(0.155, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a1c12 }), 0, 1.74, 0, 1, 1, 1);
  mk(box, shirt, -0.32, 1.25, 0.05, 0.11, 0.6, 0.11); mk(box, shirt, 0.32, 1.25, 0.05, 0.11, 0.6, 0.11);
  return g;
}

/**
 * Walk-in building interiors: lobby with reception and elevators, corridors with apartment doors,
 * and your own apartment. First-person; the outside world is hidden while you are inside.
 */
export class Interiors {
  constructor(scene, world, env, hooks) {
    this.scene = scene; this.world = world; this.env = env; this.h = hooks;       // hooks: { foot, person, toast, menus, save, fade, onEnter, onExit }
    this.group = new THREE.Group(); this.group.position.set(ORIGIN_X, 0, 0); this.group.visible = false; scene.add(this.group);
    this.room = new THREE.Group(); this.group.add(this.room);
    this.active = false; this.place = null; this.b = null; this.floor = 1; this.floorY = 0;
    this.colliders = []; this.items = []; this.doors = []; this.hidden = [];
    const wall = new THREE.MeshStandardMaterial({ color: 0xe8e2d4, roughness: 0.9 });
    this.M = {
      wall, ceiling: new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.95 }),
      marble: new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, W, H) => { for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = (x + y) % 2 ? 214 : 186; g.fillStyle = 'rgb(' + v + ',' + (v - 4) + ',' + (v - 10) + ')'; g.fillRect(x * W / 8, y * H / 8, W / 8, H / 8); } }, [4, 4]), roughness: 0.18, metalness: 0.1 }),
      carpet: new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, W, H) => { g.fillStyle = '#4c3f5e'; g.fillRect(0, 0, W, H); for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(255,255,255,' + Math.random() * 0.06 + ')'; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); } }, [8, 8]), roughness: 1 }),
      wood: new THREE.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.55 }), floorWood: new THREE.MeshStandardMaterial({ color: 0x9a7b55, roughness: 0.5 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xaeb4ba, roughness: 0.25, metalness: 0.9 }), dark: new THREE.MeshStandardMaterial({ color: 0x1b1f24, roughness: 0.6 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x9fc4dd, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.18, depthWrite: false }),
      sofa: new THREE.MeshStandardMaterial({ color: 0x2f4f6a, roughness: 0.9 }), sofa2: new THREE.MeshStandardMaterial({ color: 0x7a3b3b, roughness: 0.9 }),
      plant: new THREE.MeshStandardMaterial({ color: 0x2f7a35, roughness: 0.9 }), pot: new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.8 }),
      panel: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 0.7 }), screen: new THREE.MeshStandardMaterial({ color: 0x0a0f1a, emissive: 0x2a6fd0, emissiveIntensity: 1.2 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf5f5f2, roughness: 0.6 }), rug: new THREE.MeshStandardMaterial({ color: 0x8a3f3f, roughness: 1 }),
    };
    this.buildBackdrop(); this.buildCountry();
  }

  /* ---------- skyline seen through the windows ---------- */
  buildBackdrop() {
    const W = this.world, g = new THREE.Group(); this.backdrop = g; g.visible = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3e4348, roughness: 1 }));
    ground.position.y = -0.05; g.add(ground);
    const items = [], rnd = (a, b) => a + Math.random() * (b - a), n = 170, o = new THREE.Object3D(), pal = [0x9a9ea4, 0xb4ab9b, 0x7d8794, 0xa8b2b8, 0xc2baa8];
    const im = new THREE.InstancedMesh(W.bx, W.wm, n), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, r = rnd(110, 520), w = rnd(22, 48), d = rnd(22, 48), h = rnd(28, 40 + 190 * Math.random() ** 2);
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.scale.set(w, h, d); o.rotation.set(0, 0, 0); o.updateMatrix(); im.setMatrixAt(i, o.matrix); im.setColorAt(i, c.set(pal[i % pal.length]));
    }
    im.frustumCulled = false; g.add(im); ground.receiveShadow = true; this.group.add(g);
  }

  /* ---------- builders ---------- */
  B(x, y0, z, w, h, d, mat, col = true) {
    const m = new THREE.Mesh(box, mat); m.scale.set(w, h, d); m.position.set(x, y0 + h / 2 + this.floorY, z); this.room.add(m);
    if (mat !== this.M.glass && mat !== this.M.panel) { m.castShadow = true; m.receiveShadow = true; }
    if (col) this.colliders.push({ minX: ORIGIN_X + x - w / 2, maxX: ORIGIN_X + x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
    return m;
  }
  clear() {
    while (this.room.children.length) this.room.remove(this.room.children[0]);
    this.colliders = []; this.items = []; this.doors = [];
  }
  item(x, z, r, label, fn) { this.items.push({ x: ORIGIN_X + x, z, r, label, fn }); }
  setLights(pts, intensity = 40) {
    const ex = this.world.extras; ex.override = pts.length > 0;
    ex.lights.forEach((l, i) => { const p = pts[i]; if (p) { l.position.set(ORIGIN_X + p[0], p[1] + this.floorY, p[2]); l.userData.fixed = intensity; } else { l.userData.fixed = 0; l.position.set(0, -50, 0); } });
  }
  placeFoot(x, z, yaw) { const f = this.h.foot; f.x = ORIGIN_X + x; f.z = z; f.y = this.floorY; f.yaw = yaw; f.v = 0; }
  elevatorDoor(x, z, facing) {            // sliding double doors; open when the player is close
    const l = this.B(x - 0.62, 0, z, 1.2, 2.8, 0.08, this.M.metal, false), r = this.B(x + 0.62, 0, z, 1.2, 2.8, 0.08, this.M.metal, false);
    this.B(x, 0, z - facing * 0.18, 3, 3.3, 0.3, this.M.dark, false);
    this.B(x + 1.9, 1.2, z + facing * 0.05, 0.25, 0.5, 0.06, this.M.panel, false);
    this.doors.push({ l, r, x, z, ox: l.position.x, orx: r.position.x, open: 0 });
  }
  plant(x, z) { this.B(x, 0, z, 0.5, 0.5, 0.5, this.M.pot); const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), this.M.plant); m.position.set(x, 1.1 + this.floorY, z); this.room.add(m); }
  sofa(x, z, ry, mat) {
    const g = new THREE.Group(); g.position.set(x, this.floorY, z); g.rotation.y = ry; this.room.add(g);
    const add = (w, h, d, px, py, pz) => { const m = new THREE.Mesh(box, mat || this.M.sofa); m.scale.set(w, h, d); m.position.set(px, py, pz); g.add(m); };
    add(2.2, 0.45, 0.95, 0, 0.3, 0); add(2.2, 0.55, 0.22, 0, 0.75, -0.4); add(0.22, 0.35, 0.95, -1.1, 0.55, 0); add(0.22, 0.35, 0.95, 1.1, 0.55, 0);
    const half = Math.abs(Math.cos(ry)) > 0.5 ? [1.2, 0.6] : [0.6, 1.2];
    this.colliders.push({ minX: ORIGIN_X + x - (Math.abs(Math.cos(ry)) > 0.5 ? 1.15 : 0.55), maxX: ORIGIN_X + x + (Math.abs(Math.cos(ry)) > 0.5 ? 1.15 : 0.55), minZ: z - (Math.abs(Math.cos(ry)) > 0.5 ? 0.55 : 1.15), maxZ: z + (Math.abs(Math.cos(ry)) > 0.5 ? 0.55 : 1.15) }); void half;
  }
  shell(W, D, H, floorMat, openings = {}) {                     // floor, ceiling and four walls (openings: front/back gap [x0,x1,top])
    this.B(0, -0.12, 0, W + 0.4, 0.12, D + 0.4, floorMat, false);
    this.B(0, H, 0, W + 0.4, 0.15, D + 0.4, this.M.ceiling, false);
    this.B(-W / 2 - 0.1, 0, 0, 0.2, H, D + 0.4, this.M.wall); this.B(W / 2 + 0.1, 0, 0, 0.2, H, D + 0.4, this.M.wall);
    const wall = (z, gap) => {
      if (!gap) { this.B(0, 0, z, W + 0.4, H, 0.2, this.M.wall); return; }
      const [x0, x1, top] = gap;
      this.B((-W / 2 + x0) / 2 - 0.1, 0, z, x0 + W / 2 + 0.2, H, 0.2, this.M.wall); this.B((x1 + W / 2) / 2 + 0.1, 0, z, W / 2 - x1 + 0.2, H, 0.2, this.M.wall);
      this.B((x0 + x1) / 2, top, z, x1 - x0, H - top, 0.2, this.M.wall, false);
      this.colliders.push({ minX: ORIGIN_X + x0, maxX: ORIGIN_X + x1, minZ: z - 0.12, maxZ: z + 0.12 });
    };
    wall(-D / 2 - 0.1, openings.back); wall(D / 2 + 0.1, openings.front);
  }
  ceilingPanels(W, D, H, nx, nz) {
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) this.B(-W / 2 + (i + 0.5) * W / nx, H - 0.06, -D / 2 + (j + 0.5) * D / nz, Math.min(2.6, W / nx * 0.6), 0.06, 0.7, this.M.panel, false);
  }

  /* ---------- rooms ---------- */
  buildLobby(b) {
    this.clear(); this.place = 'lobby'; this.floor = 1; this.floorY = 0; this.setBackdrop('city');
    const W = 24, D = 18, H = 4.6, M = this.M;
    this.shell(W, D, H, M.marble, { front: [-3, 3, 3.3] });
    this.B(0, 0, D / 2 + 0.12, 6, 3.3, 0.06, M.glass, false);
    for (const x of [-3, 3]) this.B(x, 0, D / 2 + 0.1, 0.18, 3.4, 0.3, M.metal, false);
    const sign = labelPlane(b.name, 6.5, 1.2, '#1c1f24', '#e8c766'); sign.position.set(0, 3.4 + this.floorY, -D / 2 + 0.02); this.room.add(sign);
    // reception desk and receptionist
    this.B(-6, 0, -3, 6, 1.1, 1.2, M.wood); this.B(-6, 1.1, -3, 6.3, 0.08, 1.5, M.metal, false);
    const rs = labelPlane('RECEPTION', 2.6, 0.5, '#2a2f36', '#ffffff'); rs.position.set(-6, 0.65 + this.floorY, -2.38); this.room.add(rs);
    const rec = createHuman({ female: true, shirt: 0x8a2f4a, pants: 0x23262e, hairStyle: 'bun', longSleeve: false, skirt: false, shorts: false }); rec.group.position.set(-6, this.floorY, -4.3); this.room.add(rec.group); this.npc = rec.group; this.npcH = rec;
    this.item(-6, -0.7, 2.8, 'talk to reception', () => this.h.menus.reception(b));
    // elevators
    for (const ex of [4, 8]) { this.elevatorDoor(ex, -D / 2 + 0.2, 1); this.item(ex, -D / 2 + 2.2, 2.2, 'call the elevator', () => this.openElevator()); }
    // decor
    this.sofa(8, 4.5, Math.PI, M.sofa); this.sofa(-8, 5.5, 0, M.sofa2); this.plant(-11, -7.5); this.plant(11, 7.5); this.plant(-11, 7.5); this.plant(11, -7.5);
    this.B(-4, 0, 4, 0.8, H, 0.8, M.white); this.B(4, 0, 4, 0.8, H, 0.8, M.white);
    this.ceilingPanels(W, D, H, 4, 3);
    this.B(0, 0.01, 1.5, 9, 0.02, 5, M.rug, false);
    this.item(0, 7.6, 2.2, 'leave the building', () => this.exit());
    this.setLights([[-6, 3.8, -2], [6, 3.8, -2], [0, 3.8, 5]], 70);
    this.placeFoot(0, 7.0, Math.PI);
  }
  buildCorridor(b, floor) {
    this.clear(); this.place = 'corridor'; this.setBackdrop('city'); this.floor = floor; this.floorY = (floor - 1) * FLOOR_H;
    const W = 3.4, D = 30, H = 3.2, M = this.M, own = this.h.save.homes[1000 + b.id]?.upgrades?._apt;
    this.shell(W, D, H, M.carpet, { back: [-1.3, 1.3, 2.6], front: [-1.2, 1.2, 2.3] });
    this.B(0, 0, -D / 2 - 0.05, 3, 2.8, 0.1, M.metal, false);            // (decorative back of the shaft)
    this.elevatorDoor(0, -D / 2 + 0.2, 1);
    this.item(0, -D / 2 + 2.0, 2.0, 'call the elevator', () => this.openElevator());
    this.B(0, 0, D / 2 + 0.12, 2.4, 2.3, 0.06, M.glass, false);
    const ownSlot = b.id % 8;
    for (let k = 0; k < 8; k++) {
      const side = k < 4 ? -1 : 1, zd = -9 + (k % 4) * 6, isOwn = own && own.floor === floor && k === ownSlot, num = floor + String.fromCharCode(65 + k);
      this.B(side * (W / 2 - 0.02), 0, zd, 0.14, 2.2, 1.1, isOwn ? M.panel : M.wood, false);
      this.B(side * (W / 2 - 0.1), 1.0, zd + 0.42, 0.08, 0.08, 0.08, M.metal, false);
      const lb = labelPlane(isOwn ? 'YOUR HOME' : num, 0.9, 0.28, isOwn ? '#1f7a3a' : '#222', '#fff'); lb.position.set(side * (W / 2 - 0.1), 2.45 + this.floorY, zd); lb.rotation.y = -side * Math.PI / 2; this.room.add(lb);
      this.item(side * 1.0, zd, 1.5, isOwn ? 'enter your apartment' : 'door ' + num + ' (residents only)', () => (isOwn ? this.enterApartment(b, own) : this.h.toast('Locked. Residents only.')));
    }
    for (let z = -12; z <= 12; z += 6) this.B(0, H - 0.06, z, 0.7, 0.06, 1.2, M.panel, false);
    this.setLights([[0, 3, -9], [0, 3, 0], [0, 3, 9]], 16);
    this.placeFoot(0, -D / 2 + 3, 0);
    if (!own) this.h.toast('Floor ' + floor + ' - the apartment doors are locked to non-residents');
  }
  buildApartment(b, apt) {
    this.clear(); this.place = 'apt'; this.setBackdrop('city'); this.floor = apt.floor; this.floorY = (apt.floor - 1) * FLOOR_H;
    const dims = { Studio: [7, 6, 3], '1-bedroom': [9, 7, 3], '2-bedroom': [11, 8, 3], Penthouse: [14, 10, 3.4] }[apt.unit] || [9, 7, 3];
    const [W, D, H] = dims, M = this.M;
    this.shell(W, D, H, M.floorWood, { back: [-W / 2 + 0.7, W / 2 - 0.7, H] });
    this.B(0, 0, -D / 2 - 0.1, W - 1.4, 0.9, 0.12, M.wall, false);
    this.B(0, 0.9, -D / 2 - 0.06, W - 1.4, H - 0.9, 0.04, M.glass, false);
    for (let x = -W / 2 + 0.7; x <= W / 2 - 0.7 + 0.01; x += (W - 1.4) / 4) this.B(x, 0.9, -D / 2 - 0.08, 0.06, H - 0.9, 0.08, M.dark, false);
    // bed
    this.B(-W / 2 + 1.3, 0, -D / 2 + 1.6, 2.0, 0.5, 1.7, M.white); this.B(-W / 2 + 1.3, 0.5, -D / 2 + 1.6, 1.9, 0.18, 1.6, M.sofa2, false); this.B(-W / 2 + 0.3, 0, -D / 2 + 1.6, 0.2, 1.1, 1.9, M.wood, false);
    this.B(-W / 2 + 0.7, 0.55, -D / 2 + 1.0, 0.5, 0.15, 0.35, M.white, false); this.B(-W / 2 + 0.7, 0.55, -D / 2 + 2.2, 0.5, 0.15, 0.35, M.white, false);
    this.item(-W / 2 + 2.2, -D / 2 + 1.6, 2.2, 'sleep until 08:00', () => this.h.sleep());
    // living area: sofa facing the TV
    this.sofa(W / 2 - 3.4, 0.4, Math.PI / 2, M.sofa);
    this.B(W / 2 - 0.35, 0, 0.4, 0.5, 0.5, 2.2, M.wood); const tv = this.B(W / 2 - 0.2, 0.9, 0.4, 0.1, 0.9, 1.6, M.screen, false); void tv;
    this.B(W / 2 - 2.0, 0, 0.4, 0.9, 0.4, 1.4, M.wood, false);
    this.B(W / 2 - 2.4, 0.01, 0.4, 3.6, 0.02, 2.8, M.rug, false);
    // kitchen counter + island
    this.B(-W / 2 + 0.5, 0, D / 2 - 2.6, 0.9, 0.95, 3.2, M.white); this.B(-W / 2 + 0.5, 0.95, D / 2 - 2.6, 1.0, 0.06, 3.3, M.metal, false);
    this.B(-1, 0, D / 2 - 2.4, 1.8, 0.95, 0.8, M.white); this.B(-1, 0.95, D / 2 - 2.4, 1.9, 0.06, 0.9, M.metal, false);
    // desk with laptop near the window
    this.B(0.6, 0, -D / 2 + 0.9, 1.6, 0.75, 0.7, M.wood); this.B(0.6, 0.75, -D / 2 + 0.85, 0.4, 0.02, 0.3, M.dark, false); this.B(0.6, 0.77, -D / 2 + 0.7, 0.4, 0.28, 0.02, M.screen, false);
    this.item(0.6, -D / 2 + 2.0, 2.0, 'use your laptop (bank, cars, real estate, upgrades)', () => this.h.menus.home(this.world.aptProp(b.id, this.h.save)));
    this.plant(W / 2 - 0.7, -D / 2 + 0.8); this.plant(-W / 2 + 0.7, D / 2 - 0.8);
    this.B(W / 2 - 2.0, 0, D / 2 - 0.4, 1.6, 2.2, 0.6, M.wood); this.item(W / 2 - 2.0, D / 2 - 1.5, 1.9, 'change clothes (wardrobe)', () => this.h.menus.wardrobe('home'));
    this.ceilingPanels(W, D, H, 3, 2);
    // front door
    const dx = -W / 2 + 1.3; this.B(dx, 0, D / 2 + 0.1, 1.2, 2.2, 0.08, M.wood, false);
    this.item(dx, D / 2 - 1.1, 1.8, 'leave the apartment', () => this.buildCorridorAt(b, apt.floor));
    this.setLights([[0, H - 0.3, -D / 4], [W / 4, H - 0.3, D / 4], [-W / 4, H - 0.3, D / 4]], 22);
    this.placeFoot(dx, D / 2 - 1.5, Math.PI);
  }
  buildCorridorAt(b, floor) { this.fade(() => { this.buildCorridor(b, floor); }); }
  enterApartment(b, apt) { this.fade(() => this.buildApartment(b, apt)); }

  /* ---------- houses and villas ---------- */
  buildCountry() {
    const g = new THREE.Group(); g.visible = false; this.country = g;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4f7d3c, roughness: 1 }));
    ground.position.y = -0.05; ground.receiveShadow = true; g.add(ground);
    const hillMat = [new THREE.MeshStandardMaterial({ color: 0x5b8a45, roughness: 1 }), new THREE.MeshStandardMaterial({ color: 0x7a7a70, roughness: 1 })];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * 6.283 + Math.random() * 0.3, r = 320 + Math.random() * 380, s = 90 + Math.random() * 150;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 18, 10), hillMat[i % 5 === 0 ? 1 : 0]); m.scale.set(s, s * 0.4, s); m.position.set(Math.cos(a) * r, -s * 0.05, Math.sin(a) * r); g.add(m);
    }
    const n = 320, pine = new THREE.InstancedMesh(new THREE.ConeGeometry(2.2, 9, 7).translate(0, 5.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), n), o = new THREE.Object3D(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, r = 30 + Math.random() * 260, s = 0.8 + Math.random() * 1.1;
      o.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); o.scale.set(s, s, s); o.updateMatrix(); pine.setMatrixAt(i, o.matrix); pine.setColorAt(i, c.set([0x1f4a2a, 0x2c5e30, 0x3b7a2c][i % 3]));
    }
    pine.frustumCulled = false; pine.castShadow = true; g.add(pine);
    this.group.add(g);
  }
  setBackdrop(kind) { this.backdrop.visible = kind === 'city'; this.country.visible = kind === 'country'; }

  buildHouse(prop) {
    this.clear(); this.place = 'house'; this.floorY = 0; this.setBackdrop('country');
    const sc = prop.sc || 1, ups = this.h.save.homes[prop.id]?.upgrades || {}, M = this.M;
    const W = 9 + 5 * sc, D = 8 + 3.5 * sc, H = 3.1 + 0.25 * sc, dx = -W / 2 + 1.5;
    this.shell(W, D, H, M.floorWood, { back: [-W / 2 + 0.8, W / 2 - 0.8, H], front: [dx - 0.7, dx + 0.7, 2.3] });
    this.B(0, 0, -D / 2 - 0.1, W - 1.6, 0.9, 0.12, M.wall, false); this.B(0, 0.9, -D / 2 - 0.06, W - 1.6, H - 0.9, 0.04, M.glass, false);
    for (let x = -W / 2 + 0.8; x <= W / 2 - 0.79; x += (W - 1.6) / 5) this.B(x, 0.9, -D / 2 - 0.08, 0.06, H - 0.9, 0.08, M.dark, false);
    // front door + exit
    this.B(dx, 0, D / 2 + 0.1, 1.2, 2.2, 0.08, M.wood, false);
    this.item(dx, D / 2 - 1.2, 1.8, 'leave the house', () => this.exit());
    // bedroom corner
    this.B(-W / 2 + 1.3, 0, -D / 2 + 1.6, 2.0, 0.5, 1.7, M.white); this.B(-W / 2 + 1.3, 0.5, -D / 2 + 1.6, 1.9, 0.18, 1.6, M.sofa2, false); this.B(-W / 2 + 0.3, 0, -D / 2 + 1.6, 0.2, 1.1, 1.9, M.wood, false);
    this.B(-W / 2 + 0.7, 0.55, -D / 2 + 1.0, 0.5, 0.15, 0.35, M.white, false); this.B(-W / 2 + 0.7, 0.55, -D / 2 + 2.2, 0.5, 0.15, 0.35, M.white, false);
    this.B(-W / 2 + 0.45, 0, -D / 2 + 3.6, 0.7, 2.0, 1.4, M.wood);
    this.item(-W / 2 + 2.3, -D / 2 + 1.6, 2.2, 'sleep until 08:00', () => this.h.sleep());
    // living area
    this.sofa(W / 2 - 3.6, -0.5, Math.PI / 2, M.sofa);
    this.B(W / 2 - 0.35, 0, -0.5, 0.5, 0.5, 2.4, M.wood); this.B(W / 2 - 0.2, 0.9, -0.5, 0.1, 0.9, 1.7, M.screen, false);
    this.B(W / 2 - 2.5, 0.01, -0.5, 3.8, 0.02, 3.0, M.rug, false);
    this.B(W / 2 - 2.2, 0, -0.5, 0.9, 0.4, 1.4, M.wood, false);
    // kitchen + dining
    this.B(W / 2 - 0.5, 0, D / 2 - 2.6, 0.9, 0.95, 3.4, M.white); this.B(W / 2 - 0.5, 0.95, D / 2 - 2.6, 1.0, 0.06, 3.5, M.metal, false);
    this.B(W / 2 - 2.6, 0, D / 2 - 2.4, 1.8, 0.95, 0.8, M.white); this.B(W / 2 - 2.6, 0.95, D / 2 - 2.4, 1.9, 0.06, 0.9, M.metal, false);
    this.B(0, 0, D / 2 - 2.8, 2.0, 0.75, 1.0, M.wood);
    for (const cx of [-0.7, 0.7]) for (const cz of [-0.75, 0.75]) this.B(cx, 0, D / 2 - 2.8 + cz, 0.4, 0.5, 0.4, M.wood, false);
    // desk with laptop (home menu)
    this.B(-W / 2 + 4.6, 0, -D / 2 + 0.9, 1.7, 0.75, 0.7, M.wood); this.B(-W / 2 + 4.6, 0.77, -D / 2 + 0.7, 0.4, 0.28, 0.02, M.screen, false);
    this.item(-W / 2 + 4.6, -D / 2 + 2.0, 2.0, 'use your laptop (bank, cars, real estate, upgrades)', () => this.h.menus.home(prop));
    if (sc >= 1.3) { this.B(0, 0, -D / 2 + 2.4, 1.6, 0.9, 1.0, M.dark); this.B(-0.6, 0.9, -D / 2 + 2.4, 1.2, 0.1, 0.9, M.white, false); }   // piano in the big houses
    if (sc >= 1.1) this.B(-W / 2 + 0.3, 0, 1.2, 0.5, 1.2, 2.4, M.dark, false);                                                           // fireplace
    this.plant(W / 2 - 0.7, -D / 2 + 0.8); this.plant(-W / 2 + 0.7, D / 2 - 0.9);
    this.item(-W / 2 + 1.8, -D / 2 + 3.6, 1.8, 'change clothes (wardrobe)', () => this.h.menus.wardrobe('home'));
    // pool outside the big window
    if (ups.pool) { this.B(0, -0.04, -D / 2 - 5, W - 1.4, 0.06, 5.2, M.panel, false); const w = this.B(0, 0.0, -D / 2 - 5, W - 2, 0.05, 4.4, M.glass, false); w.material = new THREE.MeshStandardMaterial({ color: 0x2aa8d8, roughness: 0.05, emissive: 0x0a4a66, emissiveIntensity: 0.5 }); }
    // garage door (if built)
    if (ups.garage) { this.B(W / 2 + 0.01, 0, D / 2 - 6.0, 0.08, 2.2, 2.0, M.metal, false); this.item(W / 2 - 1.2, D / 2 - 6.0, 1.9, 'go to the garage', () => this.fade(() => this.buildGarage(prop))); }
    if (ups.security) this.B(dx + 1.2, 1.6, D / 2 - 0.2, 0.3, 0.2, 0.06, M.screen, false);
    this.ceilingPanels(W, D, H, 3, 2);
    this.setLights([[0, H - 0.3, -D / 4], [W / 4, H - 0.3, D / 4], [-W / 4, H - 0.3, D / 4]], 22 + sc * 4);
    this.placeFoot(dx, D / 2 - 1.5, Math.PI);
  }
  buildGarage(prop) {
    this.clear(); this.place = 'garage'; this.floorY = 0; this.setBackdrop('country');
    const ups = this.h.save.homes[prop.id]?.upgrades || {}, M = this.M, W = 8, D = 9, H = 3.2;
    this.shell(W, D, H, M.marble);
    this.B(0, 0, -D / 2 - 0.02, W - 0.6, 2.8, 0.1, M.metal, false);            // roll-up door at the back
    for (let y = 0.4; y < 2.8; y += 0.4) this.B(0, y, -D / 2 + 0.06, W - 0.6, 0.03, 0.04, M.dark, false);
    const { def, paint } = this.h.carDef(), m = createCarMesh(def, { paintColor: paint });
    m.driver.visible = false; m.cockpitGroup.visible = false;
    for (const w of m.wheels) w.steer.position.set(w.lx, -0.5 + def.wr, w.lz);
    m.root.position.set(0, 0.5, -0.5); m.root.rotation.set(0, Math.PI, 0); this.room.add(m.root);
    this.colliders.push({ minX: ORIGIN_X - 1.2, maxX: ORIGIN_X + 1.2, minZ: -2.9, maxZ: 1.9 });
    this.item(0, 2.6, 2.4, 'check your car (repairs, tuning, fuel)', () => { this.h.menus.home(prop, ups.workshop ? 'workshop' : 'garage'); });
    if (ups.workshop) {
      this.B(-W / 2 + 0.6, 0, -1, 0.9, 1.0, 3.2, M.wood); this.B(-W / 2 + 0.3, 1.4, -1, 0.1, 1.2, 3.0, M.dark, false);
      for (let i = 0; i < 4; i++) this.B(-W / 2 + 0.38, 1.5 + (i % 2) * 0.5, -2 + i * 0.8, 0.06, 0.25, 0.5, M.metal, false);
      this.B(W / 2 - 0.7, 0, 2.5, 0.9, 0.5, 0.9, M.dark); this.B(W / 2 - 0.7, 0.5, 2.5, 0.8, 0.3, 0.8, M.dark);
    }
    this.item(-W / 2 + 1.4, D / 2 - 1.0, 1.8, 'back into the house', () => this.fade(() => this.buildHouse(prop)));
    this.B(-W / 2 + 1.4, 0, D / 2 + 0.1, 1.2, 2.2, 0.08, M.wood, false);
    this.ceilingPanels(W, D, H, 2, 2);
    this.setLights([[0, H - 0.3, -2], [0, H - 0.3, 2]], 30);
    this.placeFoot(-W / 2 + 1.4, D / 2 - 1.6, Math.PI);
  }
  enterHouse(prop) {
    if (this.active) return;
    this.b = { id: -1, name: prop.name }; this.prop = prop; this.exitInfo = { x: prop.door.x, z: prop.door.z, yaw: Math.atan2(prop.door.nx, prop.door.nz) };
    this.fade(() => { this.active = true; this.hideWorld(); this.group.visible = true; this.buildHouse(prop); this.h.person.g.visible = false; this.h.onEnter?.(); });
  }

  /* ---------- cafes, diners and marts ---------- */
  buildShop(poi) {
    this.clear(); this.place = 'shop'; this.floorY = 0; this.setBackdrop('country');
    const M = this.M, W = 14, D = 10, H = 3.6, dx = -W / 2 + 2.2;
    this.shell(W, D, H, M.marble, { front: [dx - 0.7, dx + 0.7, 2.3] });
    this.B(dx, 0, D / 2 + 0.1, 1.2, 2.2, 0.08, M.glass, false);
    const sign = labelPlane(poi.name, 6, 1.0, poi.color, '#111111'); sign.position.set(0, 2.85 + this.floorY, -D / 2 + 0.02); this.room.add(sign);
    // counter + clerk
    this.B(W / 2 - 3.6, 0, -D / 2 + 1.9, 5.4, 1.0, 0.9, M.wood); this.B(W / 2 - 3.6, 1.0, -D / 2 + 1.9, 5.6, 0.06, 1.05, M.metal, false);
    this.B(W / 2 - 2.2, 1.06, -D / 2 + 1.9, 0.4, 0.3, 0.35, M.dark, false);
    const clerk = createHuman({ female: poi.id % 2 === 0, shirt: 0x2a6a4a, pants: 0x23262e, hairStyle: 'short', longSleeve: false, shorts: false, skirt: false });
    clerk.group.position.set(W / 2 - 3.6, this.floorY, -D / 2 + 0.75); this.room.add(clerk.group); this.npc = clerk.group; this.npcH = clerk;
    // shelves along the back wall
    const goods = [M.sofa2, M.panel, M.plant, M.sofa];
    for (let i = 0; i < 3; i++) { this.B(-W / 2 + 1.4 + i * 2.2, 0, -D / 2 + 0.5, 1.8, 2.0, 0.5, M.metal); for (let k = 0; k < 4; k++) this.B(-W / 2 + 1.4 + i * 2.2 + (k - 1.5) * 0.4, 0.5 + (k % 2) * 0.8, -D / 2 + 0.78, 0.3, 0.35, 0.15, goods[(k + i) % 4], false); }
    this.B(W / 2 - 0.5, 0, 1.2, 0.8, 2.2, 2.2, M.dark); this.B(W / 2 - 0.88, 0.2, 1.2, 0.04, 1.9, 2.0, M.glass, false);
    if (poi.type === 'mart') {
      this.B(-W / 2 + 0.8, 0, 2.2, 0.5, 1.7, 3.0, M.metal);
      const cols = [0x3f6fb5, 0xb03a3a, 0x3d7a4a, 0xe2b93a, 0x6a4a8f]; for (let k = 0; k < 5; k++) this.B(-W / 2 + 1.1, 0.9 + (k % 2) * 0.4, 1.0 + k * 0.5, 0.1, 0.5, 0.4, new THREE.MeshStandardMaterial({ color: cols[k], roughness: 0.9 }), false);
      this.item(-W / 2 + 2.0, 2.2, 2.2, 'browse the clothes rack', () => this.h.menus.wardrobe('shop'));
    } else {
      for (const [tx, tz, who] of [[-1.5, 1.2, true], [2.0, 2.6, false], [-4.2, 3.4, true]]) {
        this.B(tx, 0, tz, 1.0, 0.75, 1.0, M.wood); this.B(tx - 0.85, 0, tz, 0.45, 0.45, 0.45, M.dark, false); this.B(tx + 0.85, 0, tz, 0.45, 0.45, 0.45, M.dark, false);
        if (who) { const p = createHuman({}); p.group.position.set(tx - 0.85, 0.45 - p.hipY, tz); p.group.rotation.y = Math.PI / 2; p.pose(0, 0, 'sit'); this.room.add(p.group); }
      }
    }
    this.item(W / 2 - 3.6, -D / 2 + 3.0, 2.6, 'order food and drinks', () => this.h.menus.food(poi));
    this.item(W / 2 - 6.4, -D / 2 + 2.2, 1.9, 'rob the register', () => this.h.jobs.robInside(poi));
    this.item(dx, D / 2 - 1.2, 1.8, 'leave', () => this.exit());
    this.ceilingPanels(W, D, H, 3, 2);
    this.setLights([[0, H - 0.3, -D / 4], [W / 4, H - 0.3, D / 4], [-W / 4, H - 0.3, D / 4]], 24);
    this.placeFoot(dx, D / 2 - 1.5, Math.PI);
  }
  enterShop(poi) {
    if (this.active) return;
    this.b = { id: -1, name: poi.name }; this.exitInfo = { x: poi.door.x, z: poi.door.z, yaw: Math.atan2(poi.door.nx, poi.door.nz) };
    this.fade(() => { this.active = true; this.hideWorld(); this.group.visible = true; this.buildShop(poi); this.h.person.g.visible = false; this.h.onEnter?.(); });
  }

  /* ---------- flow ---------- */
  fade(fn) { this.h.fade(fn); }
  openElevator() {
    const b = this.b, floors = Math.max(3, Math.floor(b.h / FLOOR_H));
    this.h.menus.elevator(b, floors, this.floor, (f) => { this.h.toast('Going to floor ' + f + '...'); this.fade(() => (f === 1 ? this.buildLobby(b) : this.buildCorridor(b, f))); });
  }
  enterLobby(b) {
    if (this.active) return;
    this.b = b; this.exitInfo = { x: b.door.x, z: b.door.z, yaw: Math.atan2(b.door.nx, b.door.nz) };
    this.fade(() => {
      this.active = true; this.hideWorld(); this.group.visible = true; this.buildLobby(b);
      this.h.person.g.visible = false; this.h.onEnter?.();
    });
  }
  exit() {
    if (!this.active) return;
    this.fade(() => {
      const f = this.h.foot, e = this.exitInfo;
      this.active = false; this.group.visible = false; this.restoreWorld(); this.clear(); this.setLights([]);
      f.x = e.x; f.z = e.z; f.y = this.world.heightAt(f.x, f.z, 3); f.yaw = e.yaw; f.v = 0;
      this.h.person.g.visible = true; this.h.onExit?.();
    });
  }
  hideWorld() {
    this.hidden = [];
    for (const c of this.scene.children) {
      if (c === this.group || c.isLight || c === this.env.sky || c === this.env.stars) continue;
      if (c.visible) { c.visible = false; this.hidden.push(c); }
    }
  }
  restoreWorld() { for (const c of this.hidden) c.visible = true; this.hidden = []; }

  /* ---------- per-frame ---------- */
  nearest(foot) {
    let best = null, bd = 1e9;
    for (const it of this.items) { const d = Math.hypot(foot.x - it.x, foot.z - it.z); if (d < it.r && d < bd) { bd = d; best = it; } }
    return best;
  }
  collide(foot) {
    for (const c of this.colliders) {
      const qx = Math.max(c.minX, Math.min(foot.x, c.maxX)), qz = Math.max(c.minZ, Math.min(foot.z, c.maxZ));
      const dx = foot.x - qx, dz = foot.z - qz, d = Math.hypot(dx, dz);
      if (d < 0.4 && d > 1e-4) { foot.x += dx / d * (0.4 - d); foot.z += dz / d * (0.4 - d); }
      else if (d <= 1e-4) { const l = foot.x - c.minX, r = c.maxX - foot.x, t = foot.z - c.minZ, bt = c.maxZ - foot.z, m = Math.min(l, r, t, bt); if (m === l) foot.x = c.minX - 0.41; else if (m === r) foot.x = c.maxX + 0.41; else if (m === t) foot.z = c.minZ - 0.41; else foot.z = c.maxZ + 0.41; }
    }
  }
  update(dt, foot) {
    if (!this.active) return;
    for (const d of this.doors) {
      const near = Math.hypot(foot.x - (ORIGIN_X + d.x), foot.z - d.z) < 4.2 ? 1 : 0;
      d.open += (near - d.open) * Math.min(1, dt * 4);
      d.l.position.x = d.ox - d.open * 0.62; d.r.position.x = d.orx + d.open * 0.62;
    }
    this.clockT = (this.clockT || 0) + dt; if (this.npcH && this.place === 'lobby') this.npcH.pose(this.clockT * 1.3, 0, 'idle');
    if (this.npc) this.npc.rotation.y = Math.atan2(foot.x - ORIGIN_X - this.npc.position.x, foot.z - this.npc.position.z) * 0.6;
  }
}

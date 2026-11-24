import * as THREE from 'three';
import { World } from './world.js';
import { Vehicle, Fx, carById, Skids } from './car.js';
import { Windshield } from './windshield.js';
import { Environment } from './environment.js';
import { GameAudio } from './audio.js';
import { Traffic } from './traffic.js';
import { Jobs } from './jobs.js';
import { Police } from './police.js';
import { Menus } from './menus.js';
import { createPost } from './post.js';
import { Assist } from './assist.js';
import { Interiors } from './interior.js';
import { offersFor } from './extras.js';
import { createHuman } from './human.js';
import { Progress, SHIRTS, PANTS, SHOES, HAIRS } from './progress.js';
import { Events } from './events.js';
import { Flight } from './flight.js';
import { Garage } from './garage.js';
import { clamp, lerp, wrapPi } from './util.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => '$' + Math.round(n).toLocaleString();
let toastT = 0, lastToast = '';
function toast(m) { lastToast = m; const el = $('msg'); el.textContent = m; el.style.opacity = 1; clearTimeout(toastT); toastT = setTimeout(() => (el.style.opacity = 0), 2600); }

const settings = Object.assign({ volume: 0.7, music: 0.6, fov: 62, mph: false, fps: false, mirrors: true, shake: true, wipers: 'auto' }, (() => { try { return JSON.parse(localStorage.getItem('vyt1.settings')) || {}; } catch { return {}; } })());
function saveSettings() { localStorage.setItem('vyt1.settings', JSON.stringify(settings)); applySettings(); }
function applySettings() {
  if (audio) audio.master.gain.value = settings.volume;
  $('fps').style.display = settings.fps ? 'block' : 'none';
}
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 12000);
const post = createPost(renderer, scene, camera);

/* ---------------- quality presets (mid-range friendly) ---------------- */
const QUALITY = [
  { name: 'Low', pr: 0.75, shadow: 1024, traffic: 14, peds: 20, msaa: 0 },
  { name: 'Medium', pr: 1, shadow: 2048, traffic: 26, peds: 40, msaa: 2 },
  { name: 'High', pr: Math.min(window.devicePixelRatio, 1.5), shadow: 4096, traffic: 40, peds: 60, msaa: 4 },
];
let qi = +(localStorage.getItem('vyt1.q') ?? 1);
function applyQuality(silent) {
  const q = QUALITY[qi];
  renderer.setPixelRatio(q.pr); renderer.setSize(innerWidth, innerHeight, false);
  post.setQuality(q);
  env.sun.shadow.mapSize.set(q.shadow, q.shadow); env.sun.shadow.map?.dispose(); env.sun.shadow.map = null;
  traffic?.setCount(q.traffic); traffic?.setPedCount(q.peds);
  localStorage.setItem('vyt1.q', qi); if (!silent) toast(`Quality: ${q.name}`);
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); post.resize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

/* ---------------- game objects ---------------- */
const env = new Environment(scene, renderer, camera);
const world = new World(scene);
const fx = new Fx(scene);
const car = new Vehicle(scene, fx);
const traffic = new Traffic(scene, world, car);
env.onThunder = (d) => audio?.thunder(d);
let audio = null;
const skids = new Skids(scene);
const wind = new Windshield($('wind'));
addEventListener('resize', () => wind.resize());

/* ---------------- save / economy ---------------- */
// Saves live in a local SQLite database (electron/db.js -> vyt1.db). Older localStorage saves are migrated once.
const hasDb = !!window.vytdb;
const legacy = (() => { try { return JSON.parse(localStorage.getItem('vyt1.save')); } catch { return null; } })();
const save = (hasDb ? await window.vytdb.load() : null) || legacy || { money: 3000, owned: ['swift'], current: 'swift', cars: {} };
if (hasDb && legacy) localStorage.removeItem('vyt1.save');
save.homes ??= {}; save.home ??= null;
if (save.money === 2500 && save.owned.length === 1 && !Object.keys(save.homes).length) save.money = 3000; // old default start
function persist() {
  save.cars[car.def.id] = { fuel: car.fuel, damage: { ...car.damage }, up: { ...car.up }, paint: car.paint };
  const snapshot = JSON.parse(JSON.stringify(save));
  if (hasDb) window.vytdb.save(snapshot, lastToast); else localStorage.setItem('vyt1.save', JSON.stringify(snapshot));
}
setInterval(persist, 8000);
car.setModel(carById(save.current), save.cars[save.current]);
/** Every player gets a free starter studio in the tower nearest to the default spawn. */
(function grantStarterApartment() {
  if (Object.values(save.homes).some((h) => h.upgrades?._apt?.starter)) return;
  let best = null, bd = 1e9;
  for (const b of world.buildings) { const d = Math.hypot(b.door.x - world.spawn.x, b.door.z - world.spawn.z); if (b.h >= 24 && d < bd && !save.homes[1000 + b.id]) { bd = d; best = b; } }
  if (!best) return;
  const o = offersFor(best)[0];
  save.homes[1000 + best.id] = { upgrades: { _apt: { unit: o.name, floor: o.floor, building: best.name, idx: best.id, starter: true } }, last: Date.now() };
})();
{
  const k = (f) => Object.keys(save.homes).find((id) => f(save.homes[id]));
  const chosen = k((h) => h.upgrades?._spawn), starter = k((h) => h.upgrades?._apt?.starter);
  save.home = +(chosen ?? starter ?? save.home);
}
{
  const home = save.home != null && save.home < 1000 ? world.properties[save.home] : null;
  if (save.home >= 1000 && world.buildings[save.home - 1000]) { const bd = world.buildings[save.home - 1000].door; snapCarToRoad(bd.x, bd.z); }
  else if (home) car.place(home.x, home.z, Math.atan2(Math.sign(home.x - home.bx), Math.sign(home.z - home.bz)));
  else car.place(world.spawn.x, world.spawn.z, world.spawn.yaw);
  car.s.y = world.heightAt(car.s.x, car.s.z, 5) + 0.7;
}
world.applyHomes(save);

const flight = new Flight(scene, world, { toast, crash: (m) => flightCrash(m) });
const jobs = new Jobs(world, car, save, toast);
const progress = new Progress(save, toast);
jobs.progress = progress;
const events = new Events(scene, world, car, progress, { toast, persist: () => persist() });
jobs.events = events;
const securityOn = () => Object.values(save.homes).some((h) => h.upgrades?.security);
const police = new Police(scene, world, car, {
  toast,
  busted() {
    const fine = Math.min(save.money, Math.max(300, Math.round(save.money * 0.3) * (securityOn() ? 0.5 : 1)));
    save.money -= fine; police.clear(); car.s.vx = car.s.vz = 0;
    toast(`BUSTED! You were fined ${fmt(fine)}`);
  },
});
jobs.onCrime = (n) => police.addWanted(n);
traffic.extraVehicles = () => {
  const out = police.cars.map((c) => ({ x: c.x, z: c.z, yaw: c.yaw, hl: 2.3, hw: 0.95, vx: Math.sin(c.yaw) * c.v, vz: Math.cos(c.yaw) * c.v }));
  const tk = assist.job && assist.job.truck && assist.job.state !== 'dispatch' ? assist.job : null;
  if (tk) out.push({ x: tk.x, z: tk.z, yaw: tk.yaw, hl: 3.2, hw: 1.15, vx: Math.sin(tk.yaw) * tk.v, vz: Math.cos(tk.yaw) * tk.v });
  return out;
};
traffic.walker = () => (onFoot && !interiors.active ? foot : null);
traffic.onCrime = (n) => police.addWanted(n);

/* ---------------- on foot (G = get out / get in) ---------------- */
let me = car.s;                       // whoever the player currently is (car or pedestrian)
let onFoot = false;
const foot = { x: 0, z: 0, y: 0, yaw: 0, walkT: 0, v: 0 };
jobs.who = () => me; police.who = () => me;
const humanPlayer = createHuman({ female: false, shirt: 0x3f6fb5, pants: 0x2a2f3a, shoes: 0xf0f0f0, hairStyle: 'short', hair: 0x2a1c12, skin: 0xd2a07a, height: 1.76, longSleeve: false, shorts: false, build: 1 });
humanPlayer.group.visible = false; scene.add(humanPlayer.group);
const person = { g: humanPlayer.group, h: humanPlayer };
function flightBoard() { flight.board(); onFoot = false; me = flight.s; person.g.visible = false; }
function flightExit() {
  if (!flight.onGround || flight.s.v > 3) return toast('Land and stop the plane first');
  const sp = flight.exitSpot(); flight.active = false; foot.x = sp.x; foot.z = sp.z; foot.y = world.heightAt(sp.x, sp.z, flight.s.y); foot.yaw = flight.s.yaw;
  onFoot = true; me = foot; person.g.visible = true; toast('You climbed out of the plane');
}
function flightCrash(msg) {
  const fee = Math.min(save.money, 500); save.money -= fee; flight.active = false; flight.reset();
  foot.x = flight.park.x + 8; foot.z = flight.park.z; foot.y = world.heightAt(foot.x, foot.z, 5); onFoot = true; me = foot; person.g.visible = true;
  toast(msg + '. Recovery fee $' + fee + ' - the plane is back at the airport.');
}
function exitCar() {
  if (car.speed > 3) return toast('Stop the car first');
  const a = car.s, side = car.def.W / 2 + 1.1;
  foot.x = a.x + Math.cos(a.yaw) * side; foot.z = a.z - Math.sin(a.yaw) * side; foot.yaw = a.yaw; foot.y = world.heightAt(foot.x, foot.z, a.y);
  if (car.def.boat && world.terrainH(foot.x, foot.z) < -1.5) return toast('You cannot get out in the middle of the river - drive up to the bank first');
  if (car.engine.state !== 'off') car.toggleIgnition();
  onFoot = true; me = foot; person.g.visible = true; car.model.driver.visible = false;
  toast('You got out. WASD to walk, Shift to run, G near the car to get back in');
}
function enterCar() {
  if (Math.hypot(foot.x - car.s.x, foot.z - car.s.z) > 5) return toast('You are too far from your car');
  onFoot = false; me = car.s; person.g.visible = false; toast('Back in the car - press I to start the engine');
}
function updateFoot(dt) {
  const turn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const move = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  foot.yaw += turn * 2.3 * dt;
  const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const target = (move > 0 ? (run ? 6 : 2.6) : move < 0 ? -1.4 : 0) * (progress.m.hunger < 15 ? 0.8 : 1);
  foot.v += (target - foot.v) * Math.min(1, dt * 9);
  const nx = foot.x + Math.sin(foot.yaw) * foot.v * dt, nz = foot.z + Math.cos(foot.yaw) * foot.v * dt;
  if (interiors.active) { foot.x = nx; foot.z = nz; interiors.collide(foot); }
  else if (garage.active || (world.terrainH(nx, nz) > -2.2 && Math.abs(nx) < 3950 && Math.abs(nz) < 3950)) { foot.x = nx; foot.z = nz; }
  for (const c of world.queryColliders(foot.x, foot.z, 0.6, foot.y)) {   // slide around walls and cars of the world
    const qx = clamp(foot.x, c.minX, c.maxX), qz = clamp(foot.z, c.minZ, c.maxZ);
    let dx = foot.x - qx, dz = foot.z - qz, d = Math.hypot(dx, dz);
    if (d < 0.38 && d > 1e-4) { foot.x += (dx / d) * (0.38 - d); foot.z += (dz / d) * (0.38 - d); }
    else if (d <= 1e-4) foot.z += 0.5;
  }
  { // keep out of the parked car
    const a = car.s, dx = foot.x - a.x, dz = foot.z - a.z, lf = dx * Math.sin(a.yaw) + dz * Math.cos(a.yaw), ll = dx * Math.cos(a.yaw) - dz * Math.sin(a.yaw);
    const hl = car.def.len / 2 + 0.3, hw = car.def.W / 2 + 0.3;
    if (Math.abs(lf) < hl && Math.abs(ll) < hw) {
      if (hl - Math.abs(lf) < hw - Math.abs(ll)) { const k = Math.sign(lf || 1) * hl - lf; foot.x += Math.sin(a.yaw) * k; foot.z += Math.cos(a.yaw) * k; }
      else { const k = Math.sign(ll || 1) * hw - ll; foot.x += Math.cos(a.yaw) * k; foot.z -= Math.sin(a.yaw) * k; }
    }
  }
  const gy = interiors.active ? interiors.floorY : world.heightAt(foot.x, foot.z, foot.y + 0.5); foot.y += (gy - foot.y) * Math.min(1, dt * 14);
  const fv = Math.abs(foot.v); foot.walkT += fv > 0.15 ? fv * dt * 2.9 : dt * 1.4;
  person.h.pose(foot.walkT, fv, fv > 0.15 ? 'walk' : 'idle');
  person.g.position.set(foot.x, foot.y, foot.z); person.g.rotation.y = foot.yaw;
}

/** Put the car on the nearest road lane to a point, facing along the road. */
function snapCarToRoad(x, z) {
  let best = null, bd = 1e9;
  for (const r of world.roads) {
    const [p, q] = r.axis === 'x' ? [x, z] : [z, x], pp = clamp(p, r.a0, r.a1), d = Math.hypot(p - pp, q - r.c);
    if (d < bd) { bd = d; best = { r, pp }; }
  }
  const { r, pp } = best;
  if (r.axis === 'x') car.place(pp, r.c + 4.5, Math.PI / 2); else car.place(r.c - 4.5, pp, 0);
  car.s.y = world.heightAt(car.s.x, car.s.z, 5) + 0.7; car.s.vx = car.s.vz = 0;
}
function homeSpot() {
  if (save.home == null || !save.homes[save.home]) return null;
  return save.home >= 1000 ? world.aptProp(save.home - 1000, save) : world.properties[save.home];
}
const assist = new Assist(scene, world, car, save, {
  toast, persist: () => persist(),
  towTo(dest) {
    if (garage.active) garage.close();
    const h = dest === 'home' ? homeSpot() : null;
    if (h && h.kind === 'apt') snapCarToRoad(h.x, h.z);
    else if (h) car.place(h.x, h.z, Math.atan2(Math.sign(h.x - h.bx), Math.sign(h.z - h.bz)));
    else car.place(world.dealership.x, world.dealership.z + 4, Math.PI);
    car.s.y = world.heightAt(car.s.x, car.s.z, 5) + 0.7; car.s.vx = car.s.vz = 0;
    if (onFoot) { foot.x = car.s.x + Math.cos(car.s.yaw) * 2.6; foot.z = car.s.z - Math.sin(car.s.yaw) * 2.6; foot.y = world.heightAt(foot.x, foot.z, car.s.y); }
  },
});

let started = false, paused = false, shopOpen = false, mapOpen = false, camMode = 0;
function applyOutfit() {
  const o = save.meta.outfit, old = person.g, vis = old.visible, pos = old.position.clone(), ry = old.rotation.y;
  scene.remove(old);
  const h = createHuman({ female: false, shirt: SHIRTS[o.shirt], pants: PANTS[o.pants], shoes: SHOES[o.shoes], hairStyle: HAIRS[o.hair], hair: 0x2a1c12, skin: 0xd2a07a, height: 1.76, longSleeve: false, shorts: false, build: 1 });
  h.group.visible = vis; h.group.position.copy(pos); h.group.rotation.y = ry; scene.add(h.group); person.g = h.group; person.h = h;
}
function passOut() {
  if (garage.active) garage.close();
  if (interiors.active) interiors.exit();
  const fee = Math.min(save.money, 150); save.money -= fee; progress.m.hunger = Math.max(progress.m.hunger, 40); progress.m.energy = Math.max(progress.m.energy, 40);
  const hm = homeSpot();
  if (hm) { if (hm.kind === 'apt') snapCarToRoad(hm.x, hm.z); else car.place(hm.x, hm.z, Math.atan2(Math.sign(hm.x - hm.bx), Math.sign(hm.z - hm.bz))); car.s.y = world.heightAt(car.s.x, car.s.z, 5) + 0.7; car.s.vx = car.s.vz = 0; }
  if (onFoot) { foot.x = car.s.x + 2.6; foot.z = car.s.z; foot.y = world.heightAt(foot.x, foot.z, car.s.y); }
  toast('You passed out and woke up at home. Hospital fee: $' + fee);
}
const menus = new Menus({ save, car, world, env, police, persist, toast, assist, homeSpot, jobs, progress, events, swapVehicle, onOutfit: () => applyOutfit(), where: () => me, openMap: () => toggleMap(true),
  onChange: () => world.applyHomes(save), onOpen: () => { shopOpen = true; }, onClose: () => { shopOpen = false; } });
applyQuality(true);
applyOutfit();

/* ---------------- building interiors (lobby, elevators, apartments) ---------------- */
const interiors = new Interiors(scene, world, env, {
  foot, person, toast, menus, save, jobs,
  carDef: () => ({ def: car.def, paint: car.paint }),
  fade(fn) { const f = $('fade'); f.style.opacity = 1; setTimeout(() => { fn(); setTimeout(() => (f.style.opacity = 0), 60); }, 430); },
  sleep() { env.time = 8; progress.m.energy = 100; toast('You slept well. It is 08:00.'); persist(); },
  onEnter() { me = foot; $('mini').style.display = 'none'; $('gauges').style.display = 'none'; $('mapbtn').style.display = 'none'; },
  onExit() { $('mini').style.display = ''; $('gauges').style.display = ''; $('mapbtn').style.display = ''; },
});

const garage = new Garage(scene, world, env, {
  car, toast, keep: () => [car.holder, person.g],
  fade(fn) { const f = $('fade'); f.style.opacity = 1; setTimeout(() => { fn(); setTimeout(() => (f.style.opacity = 0), 60); }, 430); },
});
function nearRamp(maxD) {
  if (car.def.boat) return null;
  for (const b of world.buildings) { const r = b.ramp, dx = car.s.x - r.x, dz = car.s.z - r.z; if (dx * dx + dz * dz < maxD * maxD) return { b, r }; }
  return null;
}

/* ---------------- input ---------------- */
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  if (!started) return;
  if (shopOpen) { if (e.code === 'Escape' || (e.code === 'KeyP' && menus.state?.type === 'phone')) menus.close(); return; }
  if (mapOpen) { if (e.code === 'Escape' || e.code === 'KeyM') toggleMap(false); return; }
  if (interiors.active && !['Escape', 'KeyF', 'KeyP', 'KeyY'].includes(e.code)) return;
  if (flight.active && !['Escape', 'KeyG', 'KeyM', 'KeyP', 'KeyY', 'KeyC', 'KeyF', 'F2', 'F3', 'F4'].includes(e.code)) return;
  if (onFoot && !['KeyM', 'KeyR', 'KeyJ', 'KeyK', 'KeyY', 'KeyP', 'Escape', 'KeyG', 'KeyF', 'F2', 'F3', 'F4'].includes(e.code)) return;
  switch (e.code) {
    case 'KeyG': if (flight.active) flightExit(); else onFoot ? enterCar() : exitCar(); break;
    case 'KeyY': menus.phone('services'); break;
    case 'KeyP': menus.phone(); break;
    case 'KeyN': if (audio) toast('Radio: ' + audio.radio.nextStation()); break;
    case 'KeyU': settings.wipers = settings.wipers === 'auto' ? 'on' : settings.wipers === 'on' ? 'off' : 'auto'; saveSettings(); toast('Wipers: ' + settings.wipers); break;
    case 'KeyM': toggleMap(true); break;
    case 'KeyR': jobs.startRob(); break;
    case 'KeyJ': jobs.startJob(); break;
    case 'KeyK': jobs.cancelJob(); break;
    case 'Escape': paused = !paused; $('overlay').style.display = paused ? 'flex' : 'none'; $('start').textContent = 'RESUME'; break;
    case 'KeyI': car.toggleIgnition(); break;
    case 'KeyT': car.toggleAuto(); toast(car.auto ? 'Automatic transmission' : 'Manual transmission'); break;
    case 'KeyQ': car.shiftDown(); break;
    case 'KeyE': car.shiftUp(); break;
    case 'KeyL': car.lights.head = !car.lights.head; break;
    case 'KeyZ': car.setIndicator(1); break;
    case 'KeyX': car.setIndicator(2); break;
    case 'KeyV': car.setIndicator(3); break;
    case 'KeyH': audio?.event('horn'); break;
    case 'KeyC': camMode = (camMode + 1) % 3; break;
    case 'F2': e.preventDefault(); qi = (qi + 1) % QUALITY.length; applyQuality(); break;
    case 'F3': e.preventDefault(); env.cycleWeather(); toast(`Weather: ${env.weatherName}`); break;
    case 'F4': e.preventDefault(); env.time = (env.time + 1) % 24; break;
    case 'Backspace': e.preventDefault(); resetCar(); break;
    case 'KeyF': tryInteract(); break;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
function placeOnRiver() {
  const z = clamp(me.z, -3500, 3500), x = -1550 + Math.sin(z * 0.002) * 60;
  car.place(x, z, 0); car.s.y = -2.5; car.s.vx = car.s.vz = 0;
}
function swapVehicle(id) {
  if (garage.active && carById(id).boat) garage.close();
  persist(); const wasBoat = car.def.boat, def = carById(id); save.current = id; car.setModel(def, save.cars[id]); car.s.vx = car.s.vz = 0;
  if (def.boat) { placeOnRiver(); toast('Your boat is waiting on the river'); }
  else if (wasBoat) { car.place(world.dealership.x, world.dealership.z + 4, Math.PI); car.s.y = world.heightAt(car.s.x, car.s.z, 5) + 0.7; toast('Your ' + def.name + ' is waiting at VYT Auto'); }
  if (onFoot) { foot.x = car.s.x + 2.6; foot.z = car.s.z; foot.y = world.heightAt(foot.x, foot.z, car.s.y); }
}
function resetCar() {
  if (garage.active) garage.close();
  if (car.def.boat) return placeOnRiver();
  let best = null, bd = 1e9;
  for (const r of world.roads) {
    const [p, q] = r.axis === 'x' ? [car.s.x, car.s.z] : [car.s.z, car.s.x];
    const pp = clamp(p, r.a0, r.a1), d = Math.hypot(p - pp, q - r.c);
    if (d < bd) { bd = d; best = { r, pp }; }
  }
  const { r, pp } = best;
  if (r.axis === 'x') car.place(pp, r.c + 4.5, Math.PI / 2); else car.place(r.c - 4.5, pp, 0);
  car.s.y = world.heightAt(car.s.x, car.s.z, 5) + 0.7;
}
$('newgame').onclick = async () => {
  if (!confirm('Start a brand new game? This erases your money, cars, houses and history.')) return;
  if (hasDb) await window.vytdb.reset();
  localStorage.removeItem('vyt1.save'); location.href = location.pathname;
};
$('start').onclick = () => {
  started = true; paused = false; $('overlay').style.display = 'none';
  $('start').blur(); if (!audio) audio = new GameAudio(); audio.ctx.resume(); applySettings();
  if (car.engine.state === 'off') { car.toggleIgnition(); toast('Starting engine... then W to drive'); }
  const starter = Object.entries(save.homes).find(([, h]) => h.upgrades?._apt?.starter && !h.upgrades._apt.welcomed);
  if (starter) { const a = starter[1].upgrades._apt; a.welcomed = true; { const b = world.buildings[a.idx]; if (b) { jobs.waypoint = { x: b.door.x, z: b.door.z }; routeT = 0; } } setTimeout(() => toast('Welcome! You have a free starter apartment: ' + a.unit + ', floor ' + a.floor + ', ' + a.building + '. Get out (G), walk to its door and press F.'), 2800); persist(); }
};

/* ---------------- GPS route ---------------- */
let route = null, routeT = 0;
function updateRoute(dt) {
  routeT -= dt;
  if (routeT > 0) return;
  routeT = 2;
  const tg = jobs.target();
  if (!tg) { route = null; return; }
  const pts = world.route(me.x, me.z, tg.x, tg.z);
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
  route = { pts, len, color: tg.color, name: tg.name };
}

/* ---------------- HUD ---------------- */
const dials = $('dials').getContext('2d'), mini = $('mini').getContext('2d');
function dial(cx, cy, r, v, max, label, unit, major, redFrom) {
  const g = dials, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.save(); g.translate(cx, cy);
  g.fillStyle = 'rgba(10,14,20,0.78)'; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill();
  g.strokeStyle = '#fff5'; g.lineWidth = 2; g.stroke();
  for (let i = 0; i <= max / major * 2; i++) {
    const val = i * major / 2, a = a0 + (a1 - a0) * val / max, big = i % 2 === 0;
    g.strokeStyle = redFrom && val >= redFrom ? '#ff3b30' : '#fff'; g.lineWidth = big ? 3 : 1.5;
    g.beginPath(); g.moveTo(Math.cos(a) * (r - (big ? 16 : 10)), Math.sin(a) * (r - (big ? 16 : 10))); g.lineTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4)); g.stroke();
    if (big) { g.fillStyle = '#fff'; g.font = '13px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label === 'RPM' ? val / 1000 : val, Math.cos(a) * (r - 30), Math.sin(a) * (r - 30)); }
  }
  const a = a0 + (a1 - a0) * clamp(v / max, 0, 1);
  g.strokeStyle = '#ff9f0a'; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * (r - 14), Math.sin(a) * (r - 14)); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
  g.textAlign = 'center'; g.font = 'bold 12px Segoe UI'; g.fillText(unit, 0, r * 0.5);
  g.restore();
}
const planeAudio = { engine: { state: 'running', rpm: 0, crank: 0 }, def: { cyl: 6, redline: 3600 }, ctrl: { throttle: 0 }, t: { slip: 0, wheelspin: 0, locked: false, grounded: 0 }, speed: 0 };
function drawHud() {
  $('gauges').style.display = flight.active || interiors.active ? 'none' : '';
  const g = dials, v = car;
  g.clearRect(0, 0, 520, 260);
  const U = settings.mph ? 2.237 : 3.6;
  dial(130, 130, 120, v.speed * U, settings.mph ? 160 : 260, 'KPH', settings.mph ? 'mph' : 'km/h', 20);
  dial(390, 130, 120, v.engine.rpm, Math.ceil(v.def.redline / 1000) * 1000 + 1000, 'RPM', 'x1000', 1000, v.def.redline);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 34px Segoe UI'; g.fillText(Math.round(v.speed * U), 130, 170);
  const gl = v.gear < 0 ? 'R' : v.gear === 0 ? 'N' : v.gear;
  g.font = 'bold 40px Segoe UI'; g.fillStyle = '#ffd60a'; g.fillText(gl, 390, 165);
  g.font = '12px Segoe UI'; g.fillStyle = '#fff'; g.fillText(v.auto ? 'AUTO' : 'MANUAL', 390, 195);
  const f = v.fuel / v.def.tank; g.fillStyle = '#0008'; g.fillRect(190, 228, 140, 14);
  g.fillStyle = f < 0.15 ? (Math.floor(performance.now() / 400) % 2 ? '#ff3b30' : '#661a16') : '#30d158'; g.fillRect(190, 228, 140 * f, 14);
  g.fillStyle = '#fff'; g.font = '12px Segoe UI'; g.fillText(`FUEL ${v.fuel.toFixed(1)} L`, 260, 215);
  const L = v.lights;
  g.font = 'bold 20px Segoe UI';
  g.fillStyle = L.blink && (L.ind === 1 || L.ind === 3) ? '#ff9f0a' : '#333'; g.fillText('◀', 205, 25);
  g.fillStyle = L.blink && (L.ind === 2 || L.ind === 3) ? '#ff9f0a' : '#333'; g.fillText('▶', 315, 25);
  g.fillStyle = L.head ? '#64d2ff' : '#333'; g.fillText('☀', 260, 25);
  g.font = '12px Segoe UI'; g.fillStyle = v.damageTotal > 0.3 ? '#ff453a' : '#fff'; g.fillText(`DAMAGE ${Math.round(v.damageTotal * 100)}%`, 260, 50);
  g.fillStyle = v.engine.state === 'running' ? '#30d158' : '#888'; g.fillText(v.engine.state === 'running' ? 'ENGINE ON' : v.engine.state === 'starting' ? 'STARTING…' : 'ENGINE OFF (I)', 260, 66);

  let info = `${fmt(save.money)}<br>${env.clock} · ${env.weatherName}<br>${car.def.name}`;
  if (police.wanted) info += `<br><span style="color:${Math.floor(performance.now() / 300) % 2 ? '#ff453a' : '#4d8dff'};font-size:22px">${police.stars}</span>`;
  info += jobs.hudLines().map((l) => `<br><span style="color:#ffd60a">${l}</span>`).join('');
  { const st = assist.status(), pg = assist.progress(); if (st) info += '<br><span style="color:#ffb300">' + st + (pg != null ? ' ' + Math.round(pg * 100) + '%' : '') + '</span>'; }
  info += '<br><span style="opacity:.85">LVL ' + progress.level + ' ' + progress.title + ' · 🍔 <span style="color:' + (progress.m.hunger < 20 ? '#ff453a' : '#fff') + '">' + Math.round(progress.m.hunger) + '%</span> ⚡ <span style="color:' + (progress.m.energy < 20 ? '#ff453a' : '#fff') + '">' + Math.round(progress.m.energy) + '%</span></span>';
  for (const l of events.hudLines()) info += '<br><span style="color:#ff4fd8">' + l + '</span>';
  if (flight.active) info += '<br><span style="color:#7fd1ff">✈ ' + Math.round(flight.speedKph) + ' km/h · ALT ' + Math.round(flight.alt) + ' m · THR ' + Math.round(flight.s.thr * 100) + '% · ' + (flight.onGround ? 'on ground' : (flight.s.v < 32 ? 'STALL WARNING' : 'flying')) + '</span>';
  if (route) info += `<br><span style="color:#64d2ff">GPS ${(route.len / 1000).toFixed(1)} km · ETA ${Math.max(1, Math.round(route.len / 16 / 60))} min</span>`;
  $('info').innerHTML = info;
  drawMinimap();
}

const MINI_SPAN = 700;
function drawMinimap() {
  const m = mini, S = 200, span = MINI_SPAN * world.mmScale, sc = S / MINI_SPAN, v = car;
  m.save(); m.clearRect(0, 0, S, S); m.beginPath(); m.arc(100, 100, 100, 0, 7); m.clip();
  m.translate(100, 100); m.rotate(Math.PI + me.yaw);
  const px = (me.x + 4000) * world.mmScale, pz = (me.z + 4000) * world.mmScale;
  m.drawImage(world.minimap, px - span / 2, pz - span / 2, span, span, -100, -100, S, S);
  const rel = (x, z) => [(x - me.x) * sc, (z - me.z) * sc];
  if (route) {
    m.strokeStyle = '#ffffffcc'; m.lineWidth = 6; m.lineJoin = 'round'; m.beginPath();
    route.pts.forEach((p, i) => { const [x, z] = rel(p.x, p.z); i ? m.lineTo(x, z) : m.moveTo(x, z); }); m.stroke();
    m.strokeStyle = route.color; m.lineWidth = 3.5; m.stroke();
  }
  for (const P of world.properties) { const [x, z] = rel(P.x, P.z); if (Math.hypot(x, z) < 130) { m.fillStyle = save.homes[P.id] ? '#ffd60a' : '#fff'; m.fillRect(x - 4, z - 4, 8, 8); } }
  for (const k of Object.keys(save.homes)) if (+k >= 1000 && world.buildings[k - 1000]) { const d = world.buildings[k - 1000].door, [x, z] = rel(d.x, d.z); if (Math.hypot(x, z) < 130) { m.fillStyle = '#ffd60a'; m.beginPath(); m.moveTo(x, z - 6); m.lineTo(x + 5, z + 4); m.lineTo(x - 5, z + 4); m.fill(); } }
  for (const c of police.cars) { const [x, z] = rel(c.x, c.z); m.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#ff3b30' : '#2e6bff'; m.beginPath(); m.arc(x, z, 5, 0, 7); m.fill(); }
  const tg = jobs.target();
  if (tg) {
    let [ox, oz] = rel(tg.x, tg.z); const dd = Math.hypot(ox, oz);
    if (dd > 88) { ox *= 88 / dd; oz *= 88 / dd; }
    m.fillStyle = tg.color; m.strokeStyle = '#000'; m.lineWidth = 2; m.beginPath(); m.arc(ox, oz, 6, 0, 7); m.fill(); m.stroke();
  }
  m.restore();
  m.fillStyle = '#fff'; m.beginPath(); m.moveTo(100, 88); m.lineTo(108, 108); m.lineTo(92, 108); m.fill();
}

/* ---------------- interaction ---------------- */
let refuelAcc = 0;
function nearDealer() { return Math.hypot(me.x - world.dealership.x, me.z - world.dealership.z) < 9 && car.speed < 3; }
function interact(dt) {
  const pr = $('prompt'); pr.textContent = '';
  if (!started || paused || shopOpen || mapOpen) return;
  if (interiors.active) { const it = interiors.nearest(foot); pr.textContent = it ? 'Press F: ' + it.label : ''; return; }
  const st = world.nearestStation(me.x, me.z);
  if (st && car.speed < 2 && (!onFoot || world.nearestStation(car.s.x, car.s.z, 9))) {
    const full = car.fuel >= car.def.tank - 0.01;
    if (car.engine.state !== 'off') pr.textContent = 'Turn off the engine (I) to refuel';
    else if (full) pr.textContent = 'Tank full';
    else {
      pr.textContent = `Hold F to refuel · $${st.price.toFixed(2)}/L`;
      if (keys.has('KeyF')) {
        const dl = Math.min(0.9 * dt, car.def.tank - car.fuel), cost = dl * st.price;
        if (save.money >= cost) { car.fuel += dl; save.money -= cost; refuelAcc += dl; if (refuelAcc > 0.4) { refuelAcc = 0; audio?.event('pump'); } }
        else pr.textContent = 'Not enough money';
      }
    }
  }
  if (nearDealer()) pr.textContent = 'Press F: VYT Auto - buy cars, upgrades, paint, repair & refuel';
  if (onFoot && flight.near(foot.x, foot.z)) pr.textContent = 'Press F: fly the plane';
  const shopD = world.nearPoiDoor(me.x, me.z);
  if (shopD) pr.textContent = onFoot ? 'Press F: go inside - ' + shopD.name : shopD.name + ' - get out of the car (G) to go inside';
  const ent = world.nearEntrance(me.x, me.z);
  if (ent) {
    const own = save.homes[1000 + ent.id];
    pr.textContent = !onFoot ? ent.name + ' - get out of the car (G) to go inside'
      : own ? 'Press F: go inside - ' + ent.name + ' (your apartment is upstairs)' : 'Press F: enter ' + ent.name + ' (lobby, reception, elevators)';
  }
  const pdoor = world.nearPropDoor(me.x, me.z);
  if (pdoor) pr.textContent = save.homes[pdoor.id] ? (onFoot ? 'Press F: go inside your home - ' + pdoor.name : pdoor.name + ' - get out of the car (G) to go inside') : (onFoot ? 'Press F: talk to ' + pdoor.owner + ' about ' + pdoor.name + ' (' + fmt(pdoor.price) + ')' : '');
  const prop = world.nearProperty(me.x, me.z);
  if (prop && car.speed < 3 && !pdoor) pr.textContent = save.homes[prop.id] ? `Press F: enter your home - ${prop.name}` : `Press F: talk to ${prop.owner} about ${prop.name} (${fmt(prop.price)})`;
  const poi = jobs.nearPoi();
  if (poi && car.speed < 3) {
    if (jobs.rob) pr.textContent = `ROBBING ${poi.name}... ${Math.round(jobs.rob.t / 7 * 100)}%`;
    else pr.textContent = `${poi.name}  ·  R: rob  ·  J: take a delivery job${jobs.cooling(poi) ? '  (recently robbed)' : ''}`;
  }
}
function tryInteract() {
  if (interiors.active) { const it = interiors.nearest(foot); if (it) it.fn(); return; }
  if (onFoot && flight.near(foot.x, foot.z)) return flightBoard();
  if (car.speed > 3) return;
  if (onFoot && Math.hypot(car.s.x - me.x, car.s.z - me.z) > 40 && (nearDealer() || world.nearProperty(me.x, me.z))) return toast('Bring your car along first - garage and shop services work on your current car');
  if (nearDealer()) return menus.dealer();
  const sd = world.nearPoiDoor(me.x, me.z);
  if (sd) { if (!onFoot) return toast('Get out of the car (G) to go inside'); return interiors.enterShop(sd); }
  const pd = world.nearPropDoor(me.x, me.z);
  if (pd) { if (!save.homes[pd.id]) return menus.talk(pd); if (!onFoot) return toast('Get out of the car (G) to go inside'); return interiors.enterHouse(pd); }
  const ent = world.nearEntrance(me.x, me.z);
  if (ent) { if (!onFoot) return toast('Get out of the car (G) to go inside'); return interiors.enterLobby(ent); }
  const prop = world.nearProperty(me.x, me.z);
  if (prop) return save.homes[prop.id] ? menus.home(prop) : menus.talk(prop);
}

/* ---------------- camera ---------------- */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(); let camYaw = 0, shake = 0;
function updateCamera(dt) {
  const s = car.s, m = car.model, sp = car.speed;
  if (flight.active) {
    const fs = flight.s, fx = Math.sin(fs.yaw) * Math.cos(fs.pitch), fz = Math.cos(fs.yaw) * Math.cos(fs.pitch);
    camPos.set(fs.x - fx * 17, fs.y + 5.5 - Math.sin(fs.pitch) * 8, fs.z - fz * 17);
    camera.position.lerp(camPos, 1 - Math.exp(-6 * dt)); camera.lookAt(fs.x + fx * 12, fs.y + Math.sin(fs.pitch) * 10, fs.z + fz * 12);
    camera.fov = lerp(camera.fov, settings.fov + 8, 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix(); m.cockpitGroup.visible = false; m.driver.visible = false; return;
  }
  if (interiors.active) {
    camera.position.set(foot.x, foot.y + 1.62, foot.z);
    camera.lookAt(foot.x + Math.sin(foot.yaw) * 5, foot.y + 1.5, foot.z + Math.cos(foot.yaw) * 5);
    camera.fov = lerp(camera.fov, 70, 1 - Math.exp(-4 * dt)); camera.updateProjectionMatrix();
    m.cockpitGroup.visible = false; m.driver.visible = false;
    return;
  }
  if (onFoot) {
    camYaw += wrapPi(foot.yaw - camYaw) * (1 - Math.exp(-4 * dt));
    camPos.set(foot.x - Math.sin(camYaw) * 4.2, foot.y + 2.2, foot.z - Math.cos(camYaw) * 4.2);
    camPos.y = Math.max(camPos.y, world.heightAt(camPos.x, camPos.z, foot.y + 2) + 0.6);
    camera.position.lerp(camPos, 1 - Math.exp(-12 * dt));
    camera.lookAt(foot.x + Math.sin(foot.yaw) * 2, foot.y + 1.4, foot.z + Math.cos(foot.yaw) * 2);
    camera.fov = lerp(camera.fov, 62, 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix();
    m.cockpitGroup.visible = false; m.driver.visible = false;
    return;
  }
  camera.fov = lerp(camera.fov, settings.fov + Math.min(sp, 70) * 0.25, 1 - Math.exp(-3 * dt)); camera.updateProjectionMatrix();
  shake = Math.max(0, shake - dt * 3);
  if (car.t.impact > 0) { shake = Math.min(1, shake + car.t.impact * 0.06); car.t.impact = 0; }
  const sh = settings.shake ? shake * 0.25 + (sp > 30 ? (sp - 30) * 0.0006 : 0) : 0;
  if (camMode === 0) {
    camYaw += wrapPi(s.yaw - camYaw) * (1 - Math.exp(-5 * dt));
    const dist = garage.active ? 3.6 + car.def.len * 0.25 : 6.8 + car.def.len * 0.3;
    camPos.set(s.x - Math.sin(camYaw) * dist, s.y + (garage.active ? 1.35 : 2.3), s.z - Math.cos(camYaw) * dist);
    camPos.y = Math.max(camPos.y, world.heightAt(camPos.x, camPos.z, s.y + 3) + 0.8);
    camera.position.copy(camPos);
    camLook.set(s.x + Math.sin(s.yaw) * 4, s.y + 1.0, s.z + Math.cos(s.yaw) * 4);
    camera.lookAt(camLook);
  } else {
    const e = camMode === 1 ? m.eye : new THREE.Vector3(0, m.eye.y + 0.1, car.def.len * 0.18);
    m.body.updateWorldMatrix(true, false);
    camera.position.copy(m.body.localToWorld(e.clone()));
    const q = m.body.getWorldQuaternion(new THREE.Quaternion());
    camera.up.set(0, 1, 0).applyQuaternion(q);
    camera.lookAt(camera.position.clone().add(new THREE.Vector3(0, 0, 1).applyQuaternion(q).multiplyScalar(10)));
    camera.up.set(0, 1, 0);
  }
  camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh;
  m.cockpitGroup.visible = camMode === 1;
  m.driver.visible = camMode !== 1;
}

/* ---------------- full map: zoom, pan, layers, GPS route ---------------- */
const mapC = $('mapc'), mg = mapC.getContext('2d');
const mv = { cx: 0, cz: 0, zoom: 1, drag: null, moved: false };
const layer = (id) => $(id).checked;
function mapScale() { return (mapC.width / 8000) * mv.zoom; }
function clampView() { const half = 4000 / mv.zoom; mv.cx = clamp(mv.cx, -4000 + half, 4000 - half); mv.cz = clamp(mv.cz, -4000 + half, 4000 - half); }
function toggleMap(open) {
  mapOpen = open; $('map').style.display = open ? 'flex' : 'none';
  if (open) { mv.cx = me.x; mv.cz = me.z; mv.zoom = Math.max(mv.zoom, 2); clampView(); drawMap(); }
}
$('mapbtn').onclick = () => { if (started && !shopOpen && !interiors.active) toggleMap(!mapOpen); };
$('phonebtn').onclick = () => { if (started && !paused && !mapOpen && !shopOpen) menus.phone(); };
$('mapclose').onclick = () => toggleMap(false);
$('mapclear').onclick = () => { jobs.waypoint = null; routeT = 0; updateRoute(0); drawMap(); };
$('mapcenter').onclick = () => { mv.cx = me.x; mv.cz = me.z; clampView(); drawMap(); };
for (const id of ['lf', 'lj', 'lh', 'lp']) $(id).onchange = drawMap;
const mpos = (e) => { const r = mapC.getBoundingClientRect(); return [(e.clientX - r.left) * mapC.width / r.width, (e.clientY - r.top) * mapC.height / r.height]; };
const toWorld = (sx, sy) => [mv.cx + (sx - mapC.width / 2) / mapScale(), mv.cz + (sy - mapC.height / 2) / mapScale()];
mapC.addEventListener('wheel', (e) => {
  e.preventDefault();
  const [sx, sy] = mpos(e), [wx, wz] = toWorld(sx, sy);
  mv.zoom = clamp(mv.zoom * (e.deltaY < 0 ? 1.25 : 0.8), 1, 12);
  mv.cx = wx - (sx - mapC.width / 2) / mapScale(); mv.cz = wz - (sy - mapC.height / 2) / mapScale(); clampView(); drawMap();
}, { passive: false });
mapC.addEventListener('mousedown', (e) => { mv.drag = mpos(e); mv.moved = false; });
addEventListener('mousemove', (e) => {
  if (!mv.drag) return;
  const [sx, sy] = mpos(e), dx = sx - mv.drag[0], dy = sy - mv.drag[1];
  if (Math.abs(dx) + Math.abs(dy) > 3) mv.moved = true;
  if (mv.moved) { mv.cx -= dx / mapScale(); mv.cz -= dy / mapScale(); mv.drag = [sx, sy]; clampView(); drawMap(); }
});
addEventListener('mouseup', (e) => {
  if (mv.drag && !mv.moved && e.target === mapC) { const [x, z] = toWorld(...mpos(e)); jobs.waypoint = { x, z }; routeT = 0; updateRoute(0); toast('Waypoint set'); drawMap(); }
  mv.drag = null;
});
mapC.addEventListener('contextmenu', (e) => { e.preventDefault(); jobs.waypoint = null; routeT = 0; updateRoute(0); drawMap(); });

function drawMap() {
  const W = mapC.width, sc = mapScale(), k = world.minimap.width / 8000, half = 4000 / mv.zoom;
  const S = (x, z) => [(x - mv.cx) * sc + W / 2, (z - mv.cz) * sc + W / 2];
  mg.clearRect(0, 0, W, W);
  mg.imageSmoothingEnabled = true;
  mg.drawImage(world.minimap, (mv.cx - half + 4000) * k, (mv.cz - half + 4000) * k, 2 * half * k, 2 * half * k, 0, 0, W, W);
  const r = 4 + mv.zoom * 1.2, labels = mv.zoom >= 2.2;
  mg.font = '13px Segoe UI'; mg.textBaseline = 'middle'; mg.lineJoin = 'round';
  const text = (t, x, y) => { mg.lineWidth = 3; mg.strokeStyle = '#000c'; mg.strokeText(t, x, y); mg.fillStyle = '#fff'; mg.fillText(t, x, y); };
  if (route) {
    mg.strokeStyle = '#000a'; mg.lineWidth = 9; mg.beginPath(); route.pts.forEach((p, i) => { const [x, y] = S(p.x, p.z); i ? mg.lineTo(x, y) : mg.moveTo(x, y); }); mg.stroke();
    mg.strokeStyle = route.color; mg.lineWidth = 5; mg.stroke();
  }
  if (layer('lf')) for (const l of world.parking.lots) { const [x, y] = S(l.x, l.z); mg.fillStyle = '#1b5fb8'; mg.fillRect(x - r, y - r, 2 * r, 2 * r); mg.strokeStyle = '#fff'; mg.lineWidth = 1.5; mg.strokeRect(x - r, y - r, 2 * r, 2 * r); mg.fillStyle = '#fff'; mg.font = 'bold ' + Math.round(r * 1.6) + 'px Arial'; mg.textAlign = 'center'; mg.fillText('P', x, y + r * 0.6); mg.textAlign = 'start'; if (labels) text(l.name, x + r + 3, y); }
  if (layer('lf')) for (const st of world.stations) { const [x, y] = S(st.x, st.z); mg.fillStyle = '#ff7a00'; mg.beginPath(); mg.arc(x, y, r, 0, 7); mg.fill(); mg.strokeStyle = '#000'; mg.lineWidth = 1.5; mg.stroke(); if (labels) text('Fuel', x + r + 3, y); }
  if (layer('lj')) for (const p of world.pois) { const [x, y] = S(p.x, p.z); mg.fillStyle = p.color; mg.fillRect(x - r, y - r, 2 * r, 2 * r); mg.strokeStyle = '#000'; mg.lineWidth = 1.5; mg.strokeRect(x - r, y - r, 2 * r, 2 * r); if (labels) text(p.name, x + r + 3, y); }
  if (layer('lh')) for (const P of world.properties) {
    const [x, y] = S(P.x, P.z), own = !!save.homes[P.id];
    mg.fillStyle = own ? '#ffd60a' : '#fff'; mg.strokeStyle = '#000'; mg.lineWidth = 1.5;
    mg.beginPath(); mg.moveTo(x, y - r * 1.5); mg.lineTo(x + r * 1.3, y); mg.lineTo(x + r * 0.8, y); mg.lineTo(x + r * 0.8, y + r); mg.lineTo(x - r * 0.8, y + r); mg.lineTo(x - r * 0.8, y); mg.lineTo(x - r * 1.3, y); mg.closePath(); mg.fill(); mg.stroke();
    if (labels || mv.zoom > 1.2) text(`${P.name}${own ? ' (yours)' : ` - ${fmt(P.price)}`}`, x + r * 1.6, y);
  }
  if (layer('lh')) for (const k of Object.keys(save.homes)) if (+k >= 1000 && world.buildings[k - 1000]) {
    const b = world.buildings[k - 1000], a = save.homes[k].upgrades._apt, [x, y] = S(b.door.x, b.door.z);
    mg.fillStyle = '#ffd60a'; mg.strokeStyle = '#000'; mg.lineWidth = 1.5; mg.beginPath(); mg.moveTo(x, y - r * 1.5); mg.lineTo(x + r * 1.3, y + r * 0.6); mg.lineTo(x - r * 1.3, y + r * 0.6); mg.closePath(); mg.fill(); mg.stroke();
    text((a ? a.unit + ' - ' : '') + b.name + ' (yours)', x + r * 1.6, y);
  }
  { const [x, y] = S(world.dealership.x, world.dealership.z); mg.fillStyle = '#2aa0ff'; mg.beginPath(); mg.arc(x, y, r + 1, 0, 7); mg.fill(); mg.stroke(); text('VYT Auto', x + r + 4, y); }
  if (layer('lp')) for (const c of police.cars) { const [x, y] = S(c.x, c.z); mg.fillStyle = Math.floor(performance.now() / 250) % 2 ? '#ff3b30' : '#2e6bff'; mg.beginPath(); mg.arc(x, y, r, 0, 7); mg.fill(); }
  const tg = jobs.target();
  if (tg) { const [x, y] = S(tg.x, tg.z); mg.fillStyle = tg.color; mg.strokeStyle = '#000'; mg.lineWidth = 2; mg.beginPath(); mg.arc(x, y, r + 3, 0, 7); mg.fill(); mg.stroke(); text(tg.name, x + r + 6, y); }
  const [px, py] = S(me.x, me.z);
  mg.save(); mg.translate(px, py); mg.rotate(Math.PI - me.yaw); mg.fillStyle = '#fff'; mg.strokeStyle = '#000'; mg.lineWidth = 2;
  mg.beginPath(); mg.moveTo(0, -13); mg.lineTo(9, 11); mg.lineTo(-9, 11); mg.closePath(); mg.fill(); mg.stroke(); mg.restore();
  // scale bar
  const barM = mv.zoom >= 6 ? 200 : mv.zoom >= 2.5 ? 500 : 1000, bw = barM * sc;
  mg.fillStyle = '#fff'; mg.fillRect(20, W - 30, bw, 4); text(`${barM >= 1000 ? barM / 1000 + ' km' : barM + ' m'}`, 20, W - 42);
  $('mapinfo').textContent = route ? `GPS: ${route.name} · ${(route.len / 1000).toFixed(1)} km · ETA ${Math.max(1, Math.round(route.len / 16 / 60))} min` : 'Click the map to set a waypoint · scroll = zoom · drag = pan · right-click = clear';
}
setInterval(() => { if (mapOpen) drawMap(); }, 400);

/* ---------------- rear-view mirror ---------------- */
const mirrorRT = new THREE.WebGLRenderTarget(512, 160), mirrorCam = new THREE.PerspectiveCamera(52, 512 / 160, 0.4, 3000);
const mirrorScene = new THREE.Scene(), mirrorOrtho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
{ const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: mirrorRT.texture })); q.scale.x = -1; mirrorScene.add(q); }
function renderMirror() {
  const on = settings.mirrors && started && !paused && camMode >= 1 && !onFoot && !interiors.active && !shopOpen && !mapOpen;
  $('mirror').style.display = on ? 'block' : 'none';
  if (!on) return;
  const s = car.s, back = -car.def.len * 0.18;
  mirrorCam.position.set(s.x + Math.sin(s.yaw) * back, s.y + car.def.hgt * 0.55, s.z + Math.cos(s.yaw) * back);
  mirrorCam.lookAt(s.x - Math.sin(s.yaw) * 60, s.y + 0.6, s.z - Math.cos(s.yaw) * 60);
  car.model.root.visible = false;
  const au = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
  renderer.setRenderTarget(mirrorRT); renderer.clear(); renderer.render(scene, mirrorCam); renderer.setRenderTarget(null);
  renderer.shadowMap.autoUpdate = au; car.model.root.visible = true;
  const size = renderer.getSize(new THREE.Vector2()), w = Math.round(size.x * 0.28), h = Math.round(w * 160 / 512);
  const x = Math.round((size.x - w) / 2), y = Math.round(size.y - h - size.y * 0.02);
  renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.setScissorTest(true); renderer.autoClear = false;
  renderer.render(mirrorScene, mirrorOrtho);
  renderer.setScissorTest(false); renderer.setViewport(0, 0, size.x, size.y); renderer.autoClear = true;
}
let fpsT = 0, fpsN = 0;
function fpsTick(now) { fpsN++; if (now - fpsT > 500) { if (settings.fps) $('fps').textContent = Math.round(fpsN * 1000 / (now - fpsT)) + ' FPS'; fpsT = now; fpsN = 0; } }

/* ---------------- settings panel ---------------- */
{
  const el = (id) => $(id), set = (id, v, type) => { el(id)[type] = v; };
  set('s_vol', settings.volume, 'value'); set('s_mus', settings.music, 'value'); set('s_fov', settings.fov, 'value'); set('s_qual', qi, 'value');
  set('s_units', settings.mph ? 'mph' : 'kmh', 'value'); set('s_wip', settings.wipers, 'value');
  set('s_mir', settings.mirrors, 'checked'); set('s_shake', settings.shake, 'checked'); set('s_fps', settings.fps, 'checked');
  const on = (id, fn) => { el(id).oninput = el(id).onchange = fn; };
  on('s_vol', () => { settings.volume = +el('s_vol').value; saveSettings(); }); on('s_mus', () => { settings.music = +el('s_mus').value; saveSettings(); });
  on('s_fov', () => { settings.fov = +el('s_fov').value; saveSettings(); });
  on('s_qual', () => { qi = +el('s_qual').value; applyQuality(); });
  on('s_units', () => { settings.mph = el('s_units').value === 'mph'; saveSettings(); }); on('s_wip', () => { settings.wipers = el('s_wip').value; saveSettings(); });
  on('s_mir', () => { settings.mirrors = el('s_mir').checked; saveSettings(); }); on('s_shake', () => { settings.shake = el('s_shake').checked; saveSettings(); });
  on('s_fps', () => { settings.fps = el('s_fps').checked; saveSettings(); });
  $('setbtn').onclick = () => { const p = $('settings'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; };
  applySettings();
}

/* ---------------- main loop ---------------- */
let last = performance.now(), steerIn = 0, tunnelF = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05); last = now;
  if (started && !paused && !shopOpen && !mapOpen) {
    const c = car.ctrl;
    c.throttle = keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0;
    if (c.throttle && car.engine.state === 'off' && !car._warned) { car._warned = true; toast('Engine is off - press I to start it'); setTimeout(() => (car._warned = false), 3000); }
    c.brake = keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0;
    c.handbrake = keys.has('Space');
    const raw = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    steerIn += clamp(raw - steerIn, -dt * 5, dt * 5) * (raw === 0 ? 1.6 : 1); c.steer = steerIn;
    if (onFoot || flight.active) { c.throttle = 0; c.brake = 1; c.handbrake = true; c.steer = 0; }
    if (onFoot) updateFoot(dt);
    flight.update(dt, keys);
    car.update(dt, world);
    if (!onFoot && !interiors.active) skids.update(car);
    if (!interiors.active && !garage.active) { traffic.update(dt, env); jobs.update(dt); police.update(dt); assist.update(dt); } else if (interiors.active) interiors.update(dt, foot);
    if (progress.tick(dt)) passOut();
    if (!onFoot && !interiors.active && !flight.active) {
      const pk = garage.active ? garage.update(dt, car) : world.parking.update(dt, car);
      if (!garage.active && car.speed > 1.5) { const rp = nearRamp(3); if (rp) { const fx = Math.sin(car.s.yaw), fz = Math.cos(car.s.yaw); if (fx * -rp.r.nx + fz * -rp.r.nz > 0.5) garage.enter(rp.b); } }
      if (pk) { if (pk.perfect) { save.money += 25; progress.award(12, 'perfect park'); toast('PERFECT PARK! +$25 - ' + pk.lot); } else { progress.award(4, 'parked'); toast('Parked in ' + pk.lot + ' (centre and straighten up for a perfect park)'); } }
    }
    if (!onFoot && !interiors.active && !garage.active) events.update(dt);
    updateRoute(dt);
    for (const e of car.events.splice(0)) { audio?.event(e); if (e === 'nofuel') toast('Out of fuel! Press Y to call roadside assistance'); if (e === 'started') toast('Engine started'); if (e === 'stall') toast('Engine stalled'); }
  }
  fx.update(dt);
  wind.update(dt, env.cur.rain, started && camMode === 1 && !onFoot && !interiors.active, settings.wipers);
  const tun = (interiors.active || garage.active || world.inTunnel(me.x, me.z)) ? 1 : 0; tunnelF = lerp(tunnelF, tun, 1 - Math.exp(-4 * dt));
  env.update(dt, new THREE.Vector3(me.x, me.y, me.z), camera.position);
  env.hemi.intensity *= 1 - 0.9 * tunnelF; scene.environmentIntensity *= 1 - 0.9 * tunnelF;
  if (interiors.active) { env.moon.intensity = 0; env.flash = 0; }
  world.update(dt, env, camera.position);
  car.night = env.night;
  interact(dt);
  if (started && !paused && !shopOpen && !mapOpen && !$('prompt').textContent) {
    if (onFoot && Math.hypot(foot.x - car.s.x, foot.z - car.s.z) < 5) $('prompt').textContent = 'Press G to get in your car';
    else if (onFoot && garage.active) $('prompt').textContent = 'Your car is down here - get in (G) and drive out through the green EXIT';
    else if (!onFoot && !garage.active && car.speed < 12 && nearRamp(14)) $('prompt').textContent = 'Drive into the ramp to park underground';
    else if (!onFoot && car.speed < 1) $('prompt').textContent = world.parking.lotAt(car.s.x, car.s.z) ? 'Parked? Press G to get out' : 'Press G to get out of the car';
    else if (!onFoot && world.parking.lotAt(car.s.x, car.s.z)) $('prompt').textContent = 'Parking lot - pull into a free bay and stop';
  }
  updateCamera(dt);
  if (flight.active) { const p = planeAudio, s = flight.s; p.engine.rpm = 900 + s.thr * 2400; p.ctrl.throttle = s.thr; p.t.grounded = flight.onGround ? 1 : 0; p.speed = s.v; audio?.update(p, env, false); }
  else audio?.update(car, env, camMode === 1);
  audio?.radio.setLevel(!onFoot && !interiors.active, settings.music);
  audio?.siren(police.cars.length ? police.nearest : Infinity);
  drawHud();
  const gu = post.grade.uniforms, lowSun = clamp(1 - Math.abs(env.sunDir.y) / 0.4, 0, 1) * (1 - env.night * 0.8);
  gu.uTime.value = now * 0.001; gu.uSpeed.value = onFoot ? 0 : clamp((car.speed * 3.6 - 90) / 150, 0, 1);
  gu.uHi.value.set(1 + 0.12 * lowSun, 1 - 0.03 * lowSun, 1 - 0.18 * lowSun); gu.uLo.value.set(1 - 0.1 * env.night, 1 - 0.03 * env.night, 1 + 0.14 * env.night);
  gu.uSat.value = 1.14 - 0.28 * env.cur.cloud * (1 - env.night); gu.uVig.value = 0.34 + 0.12 * env.night + Math.max(0, (25 - progress.m.energy) * 0.012);
  post.bloom.threshold = lerp(2.2, 0.85, env.night); post.bloom.strength = 0.26 + 0.2 * env.night + 0.12 * env.cur.rain;
  post.render(dt);
  renderMirror(); fpsTick(now);
}
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
requestAnimationFrame(frame);
window.addEventListener('error', (e) => console.error('ERR', e.message, e.filename, e.lineno));

/* ---------------- automated self-tests (electron . --smoke, AUTO=1|2|3) ---------------- */
window.__vyt = { car, world, save, jobs, police, menus, traffic };
const auto = new URLSearchParams(location.search).get('auto');
if (auto) $('start').disabled = false;
renderer.compile(scene, camera);
requestAnimationFrame(() => requestAnimationFrame(() => { $('start').disabled = false; $('start').textContent = 'DRIVE'; }));
if (auto) {
  setTimeout(() => {
    $('start').click();
    if (auto === '1') setTimeout(() => keys.add('KeyW'), 2500);
    if (auto === '3') {
      // buy the cheapest house, upgrade the car, wanted level + police
      const P = world.properties[0]; car.place(P.x, P.z, 0); car.s.y = 1; save.money = 500000;
      menus.talk(P); menus.click({ target: { closest: () => ({ dataset: { m: 'buyprop' }, disabled: false }) } });
      menus.click({ target: { closest: () => ({ dataset: { m: 'villa', v: 'garage' }, disabled: false }) } });
      menus.click({ target: { closest: () => ({ dataset: { m: 'villa', v: 'pool' }, disabled: false }) } });
      menus.close();
      police.addWanted(2);
      jobs.waypoint = { x: 2000, z: 0 }; routeT = 0;
      setInterval(() => console.log('TEST3', 'shop', $('shop').style.display, 'open', menus.isOpen, 'homes', JSON.stringify(save.homes), 'wanted', police.wanted, 'pcars', police.cars.length, 'route', route ? route.pts.length + 'pts ' + route.len.toFixed(0) + 'm' : 'none'), 2000);
    }
  }, 1500);
}

if (auto === '4') setTimeout(() => {
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' }));
  setTimeout(() => { keys.add('KeyW'); keys.add('ShiftLeft'); }, 800);
  setInterval(() => console.log('TEST4', 'onFoot', onFoot, 'foot', foot.x.toFixed(1), foot.z.toFixed(1), 'car', car.s.x.toFixed(1), car.s.z.toFixed(1), 'engine', car.engine.state), 1500);
  setTimeout(() => { keys.delete('KeyW'); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })); console.log('TEST4 enter attempt -> onFoot', onFoot); }, 9000);
}, 3500);

if (auto === '5') setTimeout(() => {   // dusk city drive, lights on
  env.time = 19.2; env.autoWeather = false; car.lights.head = true; car.place(-250, 4.5, Math.PI / 2); car.s.y = 1;
  setTimeout(() => keys.add('KeyW'), 1500);
}, 2500);

console.log('LOADED ms', Math.round(performance.now()));
if (location.search.includes('nograin')) setInterval(() => { post.grade.uniforms.uGrain.value = 0; post.grade.uniforms.uCA.value = 0; }, 100);
if (location.search.includes('noshadow')) env.sun.castShadow = false;

if (auto === '7') setTimeout(() => {   // apartments + roadside assistance self-test
  save.money = 900000;
  const b = world.buildings[5];
  car.place(b.door.x + b.door.nx * 6, b.door.z + b.door.nz * 6, 0); car.s.y = 1;
  setTimeout(() => {
    exitCar(); foot.x = b.door.x; foot.z = b.door.z;
    console.log('TEST7 entrance near:', world.nearEntrance(foot.x, foot.z)?.name, 'buildings', world.buildings.length, 'lamps', world.extras.spots.length);
    menus.reception(b);
    menus.click({ target: { closest: () => ({ dataset: { m: 'aptbuy', v: 'one' }, disabled: false }) } });
    console.log('TEST7 apt', JSON.stringify(save.homes[1000 + b.id]), 'home', save.home, 'money', Math.round(save.money));
    menus.close();
    car.damage.engine = 0.9; car.damage.front = 0.6; assist.request('repair');
    setInterval(() => console.log('TEST7 assist', assist.status(), 'dmg', car.damageTotal.toFixed(2), 'money', Math.round(save.money)), 2500);
  }, 1500);
}, 2500);

if (auto === '8' || auto === '9') setTimeout(() => {   // interior self-test: lobby (8) / own apartment (9)
  save.money = 900000;
  const b = world.buildings[5];
  car.place(b.door.x + b.door.nx * 6, b.door.z + b.door.nz * 6, 0); car.s.y = 1;
  setTimeout(() => {
    exitCar(); foot.x = b.door.x; foot.z = b.door.z;
    console.log('TEST8 entrance:', world.nearEntrance(foot.x, foot.z)?.name, 'buildings', world.buildings.length, 'lamps', world.extras.spots.length);
    interiors.enterLobby(b);
    setTimeout(() => {
      console.log('TEST8 inside', interiors.active, 'place', interiors.place, 'items', interiors.items.map((i) => i.label).join(' | '));
      if (auto === '9') {
        menus.reception(b); menus.click({ target: { closest: () => ({ dataset: { m: 'aptbuy', v: 'two' }, disabled: false }) } }); menus.close();
        interiors.buildCorridor(b, 6); console.log('TEST9 corridor items', interiors.items.length);
        const apt = save.homes[1000 + b.id].upgrades._apt; interiors.buildApartment(b, apt); console.log('TEST9 apt', JSON.stringify(apt), 'items', interiors.items.map((i) => i.label).join(' | '));
      }
    }, 1500);
  }, 1500);
}, 2500);

if (auto === '10') setTimeout(() => {   // pedestrian brain self-test: stand in the city and watch people
  $('start').click(); car.place(0, 4.5, Math.PI / 2); car.s.y = 1; car.engine.state = 'off';
  setInterval(() => {
    const ps = traffic.peds.filter((p) => p.placed && p.down <= 0);
    let minD = 99, waiting = 0, crossing = 0, down = traffic.peds.filter((p) => p.down > 0).length;
    ps.forEach((a, i) => { if (a.wait > 0) waiting++; if (traffic.onCarriageway(a.x, a.z, null)) crossing++; for (let j = i + 1; j < ps.length; j++) minD = Math.min(minD, Math.hypot(a.x - ps[j].x, a.z - ps[j].z)); });
    console.log('TEST10 peds', ps.length, 'waiting', waiting, 'crossing', crossing, 'downed', down, 'minPairDist', minD.toFixed(2), 'cars', traffic.cars.filter((c) => c.placed).length, 'home', save.home);
  }, 3000);
}, 2500);

if (auto === '11' || auto === '12') setTimeout(() => {   // house / garage interior self-test
  save.money = 900000;
  const P = world.properties[2];
  save.homes[2] = { upgrades: { garage: true, pool: true, workshop: true, security: true }, last: Date.now() }; world.applyHomes(save);
  car.place(P.door.x + P.door.nx * 8, P.door.z + P.door.nz * 8, 0); car.s.y = 1;
  setTimeout(() => {
    exitCar(); foot.x = P.door.x; foot.z = P.door.z;
    console.log('TEST11 door near:', world.nearPropDoor(foot.x, foot.z)?.name, 'price studio', JSON.stringify(offersFor(world.buildings[3]).map((o) => o.price)));
    interiors.enterHouse(P);
    setTimeout(() => { console.log('TEST11 inside', interiors.active, interiors.place, interiors.items.map((i) => i.label).join(' | ')); if (auto === '12') { interiors.buildGarage(P); console.log('TEST12 garage', interiors.items.map((i) => i.label).join(' | ')); } }, 1500);
  }, 1500);
}, 2500);

if (auto === '13') setTimeout(() => {   // phone + laptop self-test
  $('start').click();
  setTimeout(() => {
    menus.phone(); console.log('TEST13 phone home ok', $('shopbox').innerText.replace(/\n/g, ' | ').slice(0, 120));
    menus.click({ target: { closest: () => ({ dataset: { m: 'app', v: 'maps' }, disabled: false }) } }); console.log('TEST13 maps', $('shopbox').innerText.replace(/\n/g, ' | ').slice(0, 160));
    menus.click({ target: { closest: () => ({ dataset: { m: 'nav', v: '0' }, disabled: false }) } }); console.log('TEST13 waypoint', JSON.stringify(jobs.waypoint));
    menus.phone('services'); console.log('TEST13 services', $('shopbox').innerText.replace(/\n/g, ' | ').slice(0, 200));
    menus.close(); menus.home(world.aptProp(Object.keys(save.homes).map(Number).find((k) => k >= 1000) - 1000, save)); console.log('TEST13 laptop', $('shopbox').innerText.replace(/\n/g, ' | ').slice(0, 160));
    console.log('TEST13 spawn home', save.home, 'car', car.s.x.toFixed(0), car.s.z.toFixed(0), 'starter', JSON.stringify(Object.values(save.homes).map((h) => h.upgrades?._apt?.building)));
  }, 2500);
}, 2000);

if (auto === '14') setTimeout(() => {   // human close-up: get out of the car and walk
  $('start').click(); car.place(-200, 4.5, Math.PI / 2); car.s.y = 1; car.engine.state = 'off';
  setTimeout(() => { exitCar(); setTimeout(() => { keys.add('KeyW'); }, 1500); setTimeout(() => keys.delete('KeyW'), 4200); }, 1500);
}, 2000);

if (auto === '15') setTimeout(() => {   // cockpit view in the rain: mirror, wipers, skid marks, radio
  $('start').click(); car.place(-200, 4.5, Math.PI / 2); car.s.y = 1; camMode = 1; env.autoWeather = false; env.setWeather('rain'); env.wetness = 1; env.cur.rain = 0.8; env.cur.cloud = 0.9;
  setTimeout(() => { keys.add('KeyW'); }, 2500);
  setTimeout(() => { keys.add('Space'); keys.add('KeyA'); }, 6500);
  setTimeout(() => { keys.delete('Space'); keys.delete('KeyA'); }, 8000);
  console.log('TEST15 radio', audio ? audio.radio.nextStation() : 'no audio yet');
}, 2000);

if (auto === '16') setTimeout(() => {   // events self-test: race + taxi + progression
  $('start').click(); save.money = 1000; car.engine.state = 'off';
  const R = events.races[0]; console.log('TEST16 races', events.races.map((r) => r.id + ':' + r.cps.length + 'cp/' + Math.round(r.len) + 'm/par' + r.par).join(' '));
  events.start('race', 'downtown'); car.place(R.start.x, R.start.z, 0); car.s.y = 1;
  let step = 0;
  const iv = setInterval(() => {
    const a = events.active; if (!a) { clearInterval(iv); console.log('TEST16 race finished: money', Math.round(save.money), 'xp', Math.round(progress.m.xp), 'level', progress.level); startTaxi(); return; }
    console.log('TEST16', a.phase, a.cp, events.hudLines()[0]);
    if (a.phase === 'run') { const cp = R.cps[a.cp]; car.place(cp.x, cp.z, 0); car.s.y = 1; }
  }, 1200);
  function startTaxi() {
    events.start('taxi'); let n = 0;
    const iv2 = setInterval(() => {
      const f = events.fare; console.log('TEST16 taxi', events.hudLines()[0], f ? f.phase : 'none');
      if (f && f.phase === 'pickup') { car.place(f.x, f.z, 0); car.s.y = 1; car.s.vx = car.s.vz = 0; }
      else if (f && f.phase === 'ride') { car.place(f.dx, f.dz, 0); car.s.y = 1; car.s.vx = car.s.vz = 0; }
      if (++n > 12 || (events.active && events.active.fares >= 1)) { clearInterval(iv2); console.log('TEST16 taxi done: fares', events.active?.fares, 'money', Math.round(save.money), 'xp', Math.round(progress.m.xp)); }
    }, 1500);
  }
}, 2000);

if (auto === '17') setTimeout(() => {   // shop interior + food + wardrobe
  $('start').click(); save.money = 500; progress.m.hunger = 20; progress.m.energy = 30;
  const poi = world.pois[1]; car.place(poi.door.x + poi.door.nx * 7, poi.door.z + poi.door.nz * 7, 0); car.s.y = 1;
  setTimeout(() => {
    exitCar(); foot.x = poi.door.x; foot.z = poi.door.z;
    console.log('TEST17 poi door near:', world.nearPoiDoor(foot.x, foot.z)?.name, poi.type);
    interiors.enterShop(poi);
    setTimeout(() => {
      console.log('TEST17 shop items', interiors.items.map((i) => i.label).join(' | '));
      menus.food(poi); menus.click({ target: { closest: () => ({ dataset: { m: 'eat', v: '0' }, disabled: false }) } });
      console.log('TEST17 after eating hunger', Math.round(progress.m.hunger), 'energy', Math.round(progress.m.energy), 'money', Math.round(save.money));
      menus.wardrobe('shop'); menus.click({ target: { closest: () => ({ dataset: { m: 'wbuy', v: 'shirt:2' }, disabled: false }) } });
      console.log('TEST17 outfit', JSON.stringify(save.meta.outfit), 'owned shirts', JSON.stringify(save.meta.owned.shirt)); menus.close();
    }, 1500);
  }, 1500);
}, 2500);

if (auto === '18' || auto === '19') setTimeout(() => {   // motorcycle (18) / boat (19) self-test
  $('start').click(); save.owned.push('ghost', 'wavecrest', 'vento', 'kodiak', 'courier');
  if (auto === '18') { car.place(-200, 4.5, Math.PI / 2); car.s.y = 1; swapVehicle('ghost'); car.toggleIgnition(); setTimeout(() => keys.add('KeyW'), 2500); setTimeout(() => keys.add('KeyA'), 6000); camMode = 0; }
  else { me = car.s; car.place(-1500, 0, 0); swapVehicle('wavecrest'); car.toggleIgnition(); setTimeout(() => keys.add('KeyW'), 3000); }
  setInterval(() => console.log('TEST18', car.def.name, 'kph', (car.speed * 3.6).toFixed(0), 'pos', car.s.x.toFixed(0), car.s.z.toFixed(0), 'y', car.s.y.toFixed(2), 'lean', (car.lean || 0).toFixed(2)), 3000);
}, 2000);

if (auto === '20') setTimeout(() => {   // plane self-test: board and take off
  $('start').click(); foot.x = flight.s.x + 4; foot.z = flight.s.z; onFoot = true; me = foot;
  console.log('TEST20 near', flight.near(foot.x, foot.z));
  flightBoard(); flight.s.yaw = Math.PI / 2; flight.s.z = 1500;
  keys.add('ShiftLeft'); setTimeout(() => keys.add('KeyS'), 9000);
  const iv = setInterval(() => console.log('TEST20 plane kph', Math.round(flight.speedKph), 'alt', Math.round(flight.alt), 'ground', flight.onGround, 'x', Math.round(flight.s.x), 'thr', flight.s.thr.toFixed(2)), 2500);
  setTimeout(() => { clearInterval(iv); flight.s.thr = 1; }, 40000);
}, 2000);

if (auto === '21') setTimeout(() => {   // parking lot self-test
  $('start').click(); car.engine.state = 'off';
  const lots = world.parking.lots, free = world.parking.bays.filter((b) => !b.occupied);
  console.log('TEST21 lots', lots.length, 'bays', world.parking.bays.length, 'free', free.length, 'parked cars', world.parking.bays.length - free.length);
  const b = free.find((x) => x.lot === 0 && x.row === 1) || free[0];
  car.place(b.x, b.z - 12, b.yaw); car.s.y = 1; camMode = 0;
  setTimeout(() => { car.place(b.x, b.z, b.yaw); car.s.y = 0.7; car.s.vx = car.s.vz = 0; }, 3000);
  setTimeout(() => console.log('TEST21 near lot', world.parking.lotAt(car.s.x, car.s.z)?.name, 'money', Math.round(save.money), 'xp', Math.round(progress.m.xp)), 8000);
}, 2000);

if (auto === '22' || auto === '23') setTimeout(() => {   // underground garage (22) / villa driveway + ramp from outside (23)
  $('start').click(); car.engine.state = 'off';
  if (auto === '22') {
    const b = world.buildings[40]; car.place(b.ramp.x + b.ramp.nx * 8, b.ramp.z + b.ramp.nz * 8, Math.atan2(-b.ramp.nx, -b.ramp.nz)); car.s.y = 1;
    car.toggleIgnition();
    console.log('TEST22 ramp', JSON.stringify(b.ramp), 'building', b.name);
    setTimeout(() => keys.add('KeyW'), 2500);
    setInterval(() => { console.log('TEST22 dbg', car.engine.state, 'gear', car.gear, 'thr', car.ctrl.throttle, 'drive', Math.round(car.driveReq || 0), 'grounded', car.t.grounded.toFixed(2), 'mu', car.surface.mu, 'y', car.s.y.toFixed(2)); console.log('TEST22 garage', garage.active, 'x', Math.round(car.s.x), 'z', Math.round(car.s.z), 'kph', Math.round(car.speed * 3.6), 'colliders', garage.colliders.length, 'bays', garage.bays.length); }, 3000);
    setTimeout(() => { keys.delete('KeyW'); keys.add('KeyA'); }, 9000); setTimeout(() => { keys.delete('KeyA'); keys.add('KeyW'); }, 10000); setTimeout(() => keys.delete('KeyW'), 12500);
  } else {
    const P = world.properties[2]; const lot = world.parking.lots.find((l) => l.name.includes(P.name)); console.log('TEST23 villa lot', lot ? lot.name + ' bays' : 'none', world.parking.bays.filter((b) => lot && b.lot === lot.id).length);
    car.place(lot.x - 18, lot.z + 14, Math.PI * 0.75); car.s.y = 1;
    setTimeout(() => { camMode = 0; }, 100);
  }
}, 2000);

if (auto === '24') setTimeout(() => {   // look at a parking lot
  $('start').click(); car.engine.state = 'off'; const l = world.parking.lots[0];
  car.place(l.x - 16, l.z, Math.PI / 2); car.s.y = 1; camMode = 0; env.time = 13;
}, 2000);

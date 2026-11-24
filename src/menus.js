import { CARS, carById } from './car.js';
import { offersFor } from './extras.js';
import { FOOD, SHIRTS, SHIRT_NAMES, PANTS, PANTS_NAMES, SHOES, SHOE_NAMES, HAIRS, HAIR_NAMES, PRICES } from './progress.js';

const fmt = (n) => '$' + Math.round(n).toLocaleString();
const UPG = {
  engine: { name: 'Engine tune', base: [4000, 9000, 16000], desc: '+10% torque per level' },
  tires: { name: 'Sport tyres', base: [2500, 6000, 11000], desc: '+6% grip per level' },
  brakes: { name: 'Brakes', base: [2000, 5000], desc: '+8% braking per level' },
};
export const VILLA = {
  garage: { name: 'Garage', cost: 10000, desc: 'Park and swap between all your cars at home.' },
  workshop: { name: 'Workshop', cost: 25000, req: 'garage', desc: 'Tune your car at home and get 50% off repairs.' },
  pool: { name: 'Swimming pool', cost: 18000, desc: 'A pool out back. Pure luxury.' },
  security: { name: 'Security system', cost: 12000, desc: 'Cameras and alarms: police fines are halved.' },
  solar: { name: 'Solar panels', cost: 9000, desc: 'Earns passive income - collect it at home.' },
};
const PAINTS = [0xd8d8d2, 0x233a63, 0xb3202a, 0x3d4a35, 0x111111, 0xe3b505, 0x6a1b9a, 0xff6b00];
const SOLAR_RATE = 120 / 60000, SOLAR_CAP = 1440; // $120 per real minute, up to 12 minutes banked

export class Menus {
  constructor(ctx) {
    Object.assign(this, ctx); // save, car, world, env, police, persist, toast, onChange, onOpen, onClose
    this.box = document.getElementById('shopbox'); this.wrap = document.getElementById('shop');
    this.state = null; this.isOpen = false;
    this.box.addEventListener('click', (e) => this.click(e));
  }
  show() { this.wrap.style.display = 'flex'; if (!this.isOpen) { this.isOpen = true; this.onOpen?.(); } this.render(); }
  close() { this.wrap.style.display = 'none'; this.isOpen = false; this.state = null; this.onClose?.(); }

  reception(b) { this.state = { type: 'reception', b, offers: offersFor(b), haggled: false, mult: 1, line: null }; this.show(); }
  assistMenu() { this.state = { type: 'assist' }; this.show(); }

  tReception() {
    const s = this.state, b = s.b, money = this.save.money, mine = this.save.homes[1000 + b.id]?.upgrades?._apt;
    if (mine) return '<p style="max-width:600px;line-height:1.5">"Welcome back! Your ' + mine.unit + ' is on floor ' + mine.floor + '. Take the elevator any time."</p><div style="margin-top:12px">' + this.btn('close', 'Thanks') + '</div>';
    const rows = s.offers.map((o) => {
      const price = Math.round(o.price * s.mult / 100) * 100;
      return this.row('<b>' + o.name + '</b> - floor ' + o.floor + '<br><small>Move in right away. Sleep, hide out, garage and security upgrades.</small>', this.btn('aptbuy', 'Buy ' + fmt(price), money >= price, o.key));
    }).join('');
    const line = s.line || 'Good day and welcome to ' + b.name + '! I am the receptionist. We have these apartments available right now.';
    return '<p style="max-width:600px;line-height:1.5">"' + line + '"</p>' + rows + '<div style="display:flex;gap:10px;margin-top:12px">' + this.btn('ahaggle', 'Ask for a discount', !s.haggled) + this.btn('close', 'Leave') + '</div>';
  }
  tAssist() {
    const A = this.assist, car = this.car, st = A.status();
    const hint = car.engine.state === 'off' && car.fuel <= 0.01 ? 'You are out of fuel.' : car.damageTotal > 0.5 ? 'Your car is badly damaged.' : 'Call a service vehicle to your location.';
    let out = '<p style="margin:6px 0">' + hint + ' Help drives out to you along the road.</p>';
    if (st) return out + this.row('<b>' + st + '</b>', this.btn('ascancel', 'Cancel call'));
    const can = A.cool <= 0;
    out += this.row('<b>Mechanic</b> - repairs the car on the spot<br><small>Damage ' + Math.round(car.damageTotal * 100) + '%</small>', this.btn('asv', 'Call ' + fmt(A.quote('repair')), can && car.damageTotal > 0.01 && this.save.money >= A.quote('repair'), 'repair'));
    out += this.row('<b>Fuel delivery</b> - 15 litres brought to you<br><small>Tank ' + car.fuel.toFixed(1) + ' / ' + car.def.tank + ' L</small>', this.btn('asv', 'Call ' + fmt(A.quote('fuel')), can && this.save.money >= A.quote('fuel'), 'fuel'));
    out += this.row('<b>Tow to VYT Auto</b> - take the car to the dealership', this.btn('asv', 'Call ' + fmt(A.quote('tow')), can && this.save.money >= A.quote('tow'), 'tow:dealer'));
    const home = this.homeSpot ? this.homeSpot() : null;
    if (home) out += this.row('<b>Tow home</b> - ' + home.name, this.btn('asv', 'Call ' + fmt(A.quote('tow')), can && this.save.money >= A.quote('tow'), 'tow:home'));
    if (!can) out += '<p><small>Dispatch is busy for ' + Math.ceil(A.cool) + ' s.</small></p>';
    return out;
  }

  elevator(b, floors, current, go) { this.state = { type: 'elevator', b, floors, current, go }; this.show(); }
  tElevator() {
    const s = this.state, own = this.save.homes[1000 + s.b.id]?.upgrades?._apt;
    let out = '<p style="margin:6px 0">You are on floor ' + s.current + '. Choose a floor.' + (own ? ' <b style="color:#30d158">Your apartment is on floor ' + own.floor + '.</b>' : '') + '</p><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:6px">';
    for (let f = 1; f <= s.floors; f++) {
      const mine = own && own.floor === f, cur = f === s.current;
      out += '<button class="btn" data-m="floor" data-v="' + f + '" ' + (cur ? 'disabled' : '') + ' style="font-size:15px;padding:8px 0;' + (mine ? 'background:#30d158;' : '') + (cur ? 'opacity:.35;' : '') + '">' + (f === 1 ? 'Lobby' : f) + '</button>';
    }
    return out + '</div>';
  }
  /* ---------- phone (anywhere) ---------- */
  phone(app = null) { this.state = { type: 'phone', app }; if (app === 'bank') this.loadBank(); this.show(); }
  loadBank() { const s = this.state; this.persist(); this.bank = null; window.vytdb?.recent(14).then((r) => { this.bank = r; if (this.state === s) this.render(); }); }
  tPhone() {
    const s = this.state, A = this.assist;
    const apps = [['services', '🚑', 'Services'], ['maps', '📍', 'Maps'], ['bank', '🏦', 'Bank'], ['jobs', '📦', 'Jobs'], ['events', '🏁', 'Events'], ['profile', '👤', 'Profile'], ['garage', '🚗', 'Garage']];
    if (!s.app) {
      const sts = A.status();
      return '<div style="max-width:420px;margin:0 auto"><p style="text-align:center;opacity:.8;margin:4px 0">' + this.env.clock + (sts ? ' · ' + sts : '') + '</p><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">'
        + apps.map(([k, ic, l]) => '<button class="btn" data-m="app" data-v="' + k + '" style="font-size:20px;padding:22px 0;background:#2b3a55;color:#fff;border-radius:18px">' + ic + '<br>' + l + '</button>').join('') + '</div></div>';
    }
    let body = '';
    if (s.app === 'services') body = this.tAssist();
    else if (s.app === 'bank') body = this.tBank();
    else if (s.app === 'maps') body = this.tMaps();
    else if (s.app === 'jobs') body = this.tJobs();
    else if (s.app === 'events') body = this.tEvents();
    else if (s.app === 'profile') body = this.tProfile();
    else if (s.app === 'garage') body = this.tGarageApp();
    return '<div style="margin-bottom:8px">' + this.btn('phonehome', '◀ Home screen') + '</div>' + body;
  }
  tMaps() {
    const W = this.world, me = this.where(), pts = [];
    let st = null, bd = 1e9; for (const x of W.stations) { const d = Math.hypot(x.x - me.x, x.z - me.z); if (d < bd) { bd = d; st = x; } }
    if (st) pts.push({ n: 'Nearest fuel station', x: st.x, z: st.z, d: bd });
    const lot = W.parking.nearest(me.x, me.z); pts.push({ n: 'Nearest parking: ' + lot.name, x: lot.x, z: lot.z, d: Math.hypot(lot.x - me.x, lot.z - me.z) });
    pts.push({ n: 'VYT Auto (dealership)', x: W.dealership.x, z: W.dealership.z, d: Math.hypot(W.dealership.x - me.x, W.dealership.z - me.z) });
    const home = this.homeSpot ? this.homeSpot() : null;
    if (home) pts.push({ n: 'Home - ' + home.name, x: home.x, z: home.z, d: Math.hypot(home.x - me.x, home.z - me.z) });
    let poi = null; bd = 1e9; for (const p of W.pois) { const d = Math.hypot(p.x - me.x, p.z - me.z); if (d < bd) { bd = d; poi = p; } }
    if (poi) pts.push({ n: 'Nearest cafe/diner: ' + poi.name, x: poi.x, z: poi.z, d: bd });
    for (const p of W.properties) if (!this.save.homes[p.id]) pts.push({ n: p.name + ' (for sale ' + fmt(p.price) + ')', x: p.x, z: p.z, d: Math.hypot(p.x - me.x, p.z - me.z) });
    this.state.pts = pts;
    return pts.map((p, i) => this.row('<b>' + p.n + '</b><br><small>' + (p.d / 1000).toFixed(2) + ' km away</small>', this.btn('nav', 'Navigate', true, i))).join('')
      + '<div style="margin-top:10px">' + this.btn('openmap', 'Open the full map') + ' ' + this.btn('clearnav', 'Clear GPS') + '</div>';
  }
  tJobs() {
    const J = this.jobs, lines = J.hudLines();
    let out = '<p>' + (lines.length ? '<b style="color:#ffd60a">' + lines.join('<br>') + '</b>' : 'No active delivery. Park in the circle at any cafe or diner and press J to take one.') + '</p>';
    if (J.job) out += this.btn('canceljob', 'Cancel delivery');
    out += '<p><small>Wanted level: ' + (this.police.wanted ? '★'.repeat(this.police.wanted) : 'none') + '</small></p>';
    return out;
  }
  tGarageApp() {
    return '<p style="margin:6px 0">Switch vehicle - a valet brings it to you; boats are launched on the river.</p>' + CARS.filter((c) => this.save.owned.includes(c.id)).map((c) => this.row('<b>' + c.name + '</b>' + (c.boat ? ' (boat)' : c.bike ? ' (motorcycle)' : ''), this.save.current === c.id ? '<b>Current</b>' : this.btn('drive', 'Switch', true, c.id))).join('');
  }
  tCarsOnline() { return '<p style="margin:6px 0">Order a car online - it is delivered to the VYT Auto lot. Switch cars with Drive.</p>' + this.tCars(); }
  tMarket() {
    const rows = this.world.properties.map((p) => {
      const own = !!this.save.homes[p.id];
      return this.row('<b>' + p.name + '</b> - ' + (own ? '<span style="color:#30d158">yours</span>' : fmt(p.price)) + '<br><small>' + p.desc + '</small>', own ? '' : this.btn('navp', 'Set GPS', true, p.id));
    }).join('');
    return '<p style="margin:6px 0">Apartments: <b>$5,000 - $6,000</b> at the reception of any city tower. Houses and villas are bought from their owners in person.</p>' + rows;
  }

  food(poi) { this.state = { type: 'food', poi }; this.show(); }
  wardrobe(mode) { this.state = { type: 'wardrobe', mode, cat: 'shirt' }; this.show(); }
  tFood() {
    const s = this.state, list = FOOD[s.poi.type] || FOOD.mart, m = this.save.meta;
    return '<p style="margin:6px 0">Hunger <b>' + Math.round(m.hunger) + '%</b> · Energy <b>' + Math.round(m.energy) + '%</b></p>'
      + list.map(([n, p, h, e], i) => this.row('<b>' + n + '</b><br><small>+' + h + ' food, +' + e + ' energy</small>', this.btn('eat', 'Buy ' + fmt(p), this.save.money >= p, i))).join('');
  }
  tWardrobe() {
    const s = this.state, m = this.save.meta, cats = [['shirt', 'Shirts', SHIRTS, SHIRT_NAMES], ['pants', 'Trousers', PANTS, PANTS_NAMES], ['shoes', 'Shoes', SHOES, SHOE_NAMES], ['hair', 'Hair', HAIRS, HAIR_NAMES]];
    const cur = cats.find((c) => c[0] === s.cat), tabs = '<div style="display:flex;gap:8px;margin:6px 0">' + cats.map((c) => '<button class="btn" data-m="wcat" data-v="' + c[0] + '" style="font-size:14px;padding:5px 12px;' + (c[0] === s.cat ? '' : 'opacity:.55') + '">' + c[1] + '</button>').join('') + '</div>';
    const rows = cur[2].map((val, i) => {
      const owned = m.owned[cur[0]].includes(i), wearing = m.outfit[cur[0]] === i, price = PRICES[cur[0]];
      const sw = typeof val === 'number' ? '<span style="display:inline-block;width:18px;height:18px;border-radius:4px;vertical-align:middle;margin-right:8px;background:#' + val.toString(16).padStart(6, '0') + '"></span>' : '';
      const act = wearing ? '<b>Wearing</b>' : owned ? this.btn('wear', 'Wear', true, cur[0] + ':' + i) : s.mode === 'shop' ? this.btn('wbuy', 'Buy ' + fmt(price), this.save.money >= price, cur[0] + ':' + i) : '<small>not owned</small>';
      return this.row(sw + cur[3][i], act);
    }).join('');
    return (s.mode === 'shop' ? '<p style="margin:6px 0">Clothes shop - everything you buy is yours to wear at home too.</p>' : '<p style="margin:6px 0">Your wardrobe.</p>') + tabs + rows;
  }
  tEvents() {
    const E = this.events, t = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); let out = '';
    if (E.active) out += this.row('<b>Active:</b> ' + (E.hudLines()[0] || ''), this.btn('evcancel', 'Cancel event'));
    out += '<p style="margin:6px 0"><small>Races: gold under 90% of par, silver under par, bronze under 125%. Prizes get a +' + Math.round((this.progress.bonus - 1) * 100) + '% level bonus.</small></p>';
    for (const r of E.races) out += this.row('<b>' + r.name + '</b> (' + r.tier + ') · ' + (r.len / 1000).toFixed(1) + ' km · par ' + t(r.par) + '<br><small>prize up to ' + fmt(r.reward * 1.5) + '</small>', this.btn('evstart', 'Race', !E.active, 'race:' + r.id));
    out += this.row('<b>Drift challenge</b> - airport runway, 60 seconds<br><small>score 1500 / 4000 / 9000 for bronze / silver / gold</small>', this.btn('evstart', 'Start', !E.active, 'drift:x'));
    out += this.row('<b>Taxi shift</b> - pick up passengers around the map<br><small>smooth driving earns tips</small>', this.btn('evstart', 'Go on shift', !E.active, 'taxi:x'));
    return out;
  }
  tProfile() {
    const P = this.progress, m = this.save.meta, st = m.stats, bar = (v, c) => '<div style="background:#333;border-radius:4px;height:10px;width:220px;display:inline-block;vertical-align:middle"><div style="background:' + c + ';height:10px;border-radius:4px;width:' + Math.max(0, Math.min(100, v)) + '%"></div></div>';
    return '<h3 style="margin:6px 0">Level ' + P.level + ' - ' + P.title + '</h3><div>XP ' + Math.round(m.xp) + ' / ' + P.nextXp + ' ' + bar(P.xpFrac * 100, '#ffd60a') + '</div>'
      + '<p>Job and race pay bonus: <b>+' + Math.round((P.bonus - 1) * 100) + '%</b></p>'
      + '<div>Hunger ' + bar(m.hunger, m.hunger < 20 ? '#ff453a' : '#30d158') + ' ' + Math.round(m.hunger) + '%</div><div>Energy ' + bar(m.energy, m.energy < 20 ? '#ff453a' : '#64d2ff') + ' ' + Math.round(m.energy) + '%</div>'
      + '<p><small>Deliveries ' + st.deliveries + ' · Races won ' + st.races + ' · Drift medals ' + st.drifts + ' · Taxi fares ' + st.taxi + ' · Robberies ' + st.robberies + '</small></p>';
  }

  dealer() { this.state = { type: 'dealer', tab: 'cars' }; this.show(); }
  talk(prop) { this.state = { type: 'talk', prop, price: prop.price, haggled: false, line: null }; this.show(); }
  home(prop, tab = 'home') { this.state = { type: 'home', prop, tab }; this.show(); }

  btn(act, label, ok = true, v = '') { return `<button class="btn" data-m="${act}" data-v="${v}" ${ok ? '' : 'disabled style="opacity:.4"'}>${label}</button>`; }
  row(left, right) { return `<div class="row"><div>${left}</div><div>${right}</div></div>`; }
  factor() { return Math.min(2.5, Math.max(0.5, this.car.def.price / 25000)); }
  repairCost(half) { return Math.round(this.car.damageTotal * Math.max(800, this.car.def.price * 0.25) * (half ? 0.5 : 1)); }
  hasUp(prop, k) { return !!this.save.homes?.[prop.id]?.upgrades?.[k]; }

  render() {
    const s = this.state; if (!s) return;
    const money = this.save.money;
    let title = '', tabs = [], body = '';
    if (s.type === 'dealer') {
      title = 'VYT Auto'; tabs = [['cars', 'Cars'], ['upgrades', 'Upgrades'], ['paint', 'Paint'], ['service', 'Service']];
      body = { cars: () => this.tCars(), upgrades: () => this.tUpgrades(), paint: () => this.tPaint(), service: () => this.tService(false) }[s.tab]();
    } else if (s.type === 'home') {
      title = s.prop.name; tabs = s.prop.kind === 'apt' ? [['home', 'Laptop'], ['cars', 'Cars online'], ['market', 'Real estate'], ['garage', 'Parking'], ['villa', 'Upgrades'], ['bank', 'Bank']] : [['home', 'Laptop'], ['cars', 'Cars online'], ['market', 'Real estate'], ['garage', 'Garage'], ['villa', 'Villa upgrades'], ['workshop', 'Car workshop'], ['bank', 'Bank']];
      body = { home: () => this.tHome(), garage: () => this.tGarage(), villa: () => this.tVilla(), workshop: () => this.tWorkshop(), bank: () => this.tBank(), cars: () => this.tCarsOnline(), market: () => this.tMarket() }[s.tab]();
    } else if (s.type === 'food') {
      title = s.poi.name; body = this.tFood();
    } else if (s.type === 'wardrobe') {
      title = s.mode === 'shop' ? 'Clothes' : 'Wardrobe'; body = this.tWardrobe();
    } else if (s.type === 'phone') {
      title = '📱 Phone'; body = this.tPhone();
    } else if (s.type === 'elevator') {
      title = s.b.name + ' - Elevator'; body = this.tElevator();
    } else if (s.type === 'reception') {
      title = s.b.name + ' - Reception'; body = this.tReception();
    } else if (s.type === 'assist') {
      title = 'Roadside assistance'; body = this.tAssist();
    } else if (s.type === 'talk') {
      const p = s.prop;
      title = `${p.owner} (owner)`;
      body = `<p style="max-width:560px;line-height:1.5">"${s.line || `Hello there! I'm ${p.owner}. ${p.desc} I'm asking <b>${fmt(s.price)}</b> for ${p.name}."`}"</p>
        <div style="display:flex;gap:10px;margin-top:12px">${this.btn('buyprop', `Pay ${fmt(s.price)}`, money >= s.price)}${this.btn('haggle', 'Haggle', !s.haggled)}${this.btn('close', 'Leave')}</div>`;
    }
    const tabHtml = tabs.length ? `<div style="display:flex;gap:8px;margin:8px 0">${tabs.map(([k, l]) => `<button class="btn" data-m="tab" data-v="${k}" style="font-size:15px;padding:6px 14px;${s.tab === k ? '' : 'opacity:.55'}">${l}</button>`).join('')}</div>` : '';
    this.box.innerHTML = `<h2 style="margin:0">${title} <small style="float:right">${fmt(money)}</small></h2>${tabHtml}${body}${s.type === 'talk' || s.type === 'reception' ? '' : `<div style="text-align:right;margin-top:14px">${this.btn('close', 'Close')}</div>`}`;
  }

  /* ---- dealership tabs ---- */
  tCars() {
    return CARS.map((c) => {
      const owned = this.save.owned.includes(c.id), cur = this.save.current === c.id;
      const b = cur ? '<b>Driving</b>' : owned ? this.btn('drive', 'Drive', true, c.id) : this.btn('buy', `Buy ${fmt(c.price)}`, this.save.money >= c.price, c.id);
      return this.row(`<b>${c.name}</b> - ${c.blurb}<br><small>${c.tmax} Nm · ${c.gears.length}-speed · ${c.awd ? 'AWD' : 'RWD/FWD'} · ${c.tank} L tank</small>`, b);
    }).join('');
  }
  tUpgrades() {
    const car = this.car, f = this.factor();
    return `<p style="margin:6px 0">Tuning for your <b>${car.def.name}</b></p>` + Object.entries(UPG).map(([k, u]) => {
      const lvl = car.up[k], max = u.base.length, cost = lvl < max ? Math.round(u.base[lvl] * f) : 0;
      return this.row(`<b>${u.name}</b> ${'■'.repeat(lvl)}${'□'.repeat(max - lvl)}<br><small>${u.desc}</small>`, lvl >= max ? '<b>MAX</b>' : this.btn('upg', `Upgrade ${fmt(cost)}`, this.save.money >= cost, k));
    }).join('');
  }
  tPaint() {
    return `<p>Respray your ${this.car.def.name} - ${fmt(500)}</p><div style="display:flex;gap:10px;flex-wrap:wrap">${PAINTS.map((c) =>
      `<button class="btn" data-m="paint" data-v="${c}" style="width:54px;height:54px;background:#${c.toString(16).padStart(6, '0')};${this.save.money >= 500 ? '' : 'opacity:.4'}"></button>`).join('')}</div>`;
  }
  tService(half) {
    const car = this.car, rc = this.repairCost(half), missing = car.def.tank - car.fuel, fc = missing * 2.4;
    return this.row(`Repair ${car.def.name} (damage ${Math.round(car.damageTotal * 100)}%)${half ? ' - 50% off' : ''}`, this.btn('repair', `Repair ${fmt(rc)}`, rc > 0 && this.save.money >= rc, half ? 'half' : ''))
      + this.row(`Refuel (${car.fuel.toFixed(1)} / ${car.def.tank} L) - $2.40/L`, this.btn('refuel', `Fill up ${fmt(fc)}`, missing > 0.5 && this.save.money >= fc));
  }

  /* ---- home tabs ---- */
  tHome() {
    const p = this.state.prop, h = this.save.homes[p.id];
    let out = this.row('<b>Sleep</b> - skip to 08:00 and save your game', this.btn('sleep', 'Sleep'));
    out += this.row('<b>Lay low</b> - hide inside and lose any wanted level', this.btn('hide', 'Hide out', this.police.wanted > 0));
    if (h.upgrades.solar) {
      const earned = Math.min(SOLAR_CAP, (Date.now() - (h.last || Date.now())) * SOLAR_RATE);
      out += this.row(`<b>Solar income</b> - ${fmt(earned)} waiting`, this.btn('collect', 'Collect', earned >= 1));
    }
    out += this.row('<b>Make this my spawn point</b>', this.save.home === p.id ? '<b>Current</b>' : this.btn('spawn', 'Set'));
    return out;
  }
  tGarage() {
    const p = this.state.prop;
    if (!this.hasUp(p, 'garage')) return '<p>You have no garage yet. Buy one in <b>Villa upgrades</b> to keep and swap all your cars here.</p>';
    return CARS.filter((c) => this.save.owned.includes(c.id)).map((c) => this.row(`<b>${c.name}</b>`, this.save.current === c.id ? '<b>Driving</b>' : this.btn('drive', 'Drive', true, c.id))).join('');
  }
  tVilla() {
    const p = this.state.prop, k2 = 0.6 + 0.2 * p.tier;
    const apt = p.kind === 'apt';
    return Object.entries(VILLA).filter(([k]) => !apt || k === 'garage' || k === 'security').map(([k, u]) => {
      const owned = this.hasUp(p, k), cost = Math.round(u.cost * k2), blocked = u.req && !this.hasUp(p, u.req);
      return this.row(`<b>${u.name}</b><br><small>${u.desc}${blocked ? ` (needs ${VILLA[u.req].name})` : ''}</small>`, owned ? '<b>Installed</b>' : this.btn('villa', `Build ${fmt(cost)}`, !blocked && this.save.money >= cost, k));
    }).join('');
  }
  tBank() {
    const b = this.bank;
    if (!b) return '<p>Loading your account history...</p>';
    const d = (ts) => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const rowsHtml = b.list.map((r) => this.row(
      '<small>' + d(r.ts) + '</small> &nbsp; ' + (r.note || 'Balance change'),
      '<b style="color:' + (r.delta >= 0 ? '#30d158' : '#ff453a') + '">' + (r.delta >= 0 ? '+' : '-') + fmt(Math.abs(r.delta)) + '</b> <small style="opacity:.6">(' + fmt(r.balance) + ')</small>')).join('');
    return '<p>All-time earned <b style="color:#30d158">' + fmt(b.earned) + '</b> · spent <b style="color:#ff453a">' + fmt(b.spent) + '</b> · ' + b.count + ' transactions<br><small>Stored in your local database (vyt1.db)</small></p>' + (rowsHtml || '<p>No transactions yet.</p>');
  }
  tWorkshop() {
    if (!this.hasUp(this.state.prop, 'workshop')) return '<p>Build the <b>Workshop</b> in Villa upgrades to tune and repair your car at home.</p>';
    return this.tUpgrades() + this.tService(true);
  }

  /* ---- clicks ---- */
  click(e) {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const m = b.dataset.m, v = b.dataset.v, s = this.state, sv = this.save, car = this.car;
    if (m === 'close') return this.close();
    if (m === 'tab') { s.tab = v; if (v === 'bank') { this.persist(); this.bank = null; window.vytdb?.recent(14).then((r) => { this.bank = r; if (this.state === s) this.render(); }); } }
    else if (m === 'buy') { const c = carById(v); if (sv.money >= c.price) { sv.money -= c.price; sv.owned.push(v); this.toast(`Bought ${c.name}`); } }
    else if (m === 'drive') { this.swapVehicle(v); }
    else if (m === 'upg') { const u = UPG[v], lvl = car.up[v], cost = Math.round(u.base[lvl] * this.factor()); if (lvl < u.base.length && sv.money >= cost) { sv.money -= cost; car.up[v]++; } }
    else if (m === 'paint') { if (sv.money >= 500) { sv.money -= 500; car.setPaint(+v); } }
    else if (m === 'repair') { const rc = this.repairCost(v === 'half'); if (sv.money >= rc) { sv.money -= rc; car.repair(); } }
    else if (m === 'refuel') { const c = (car.def.tank - car.fuel) * 2.4; if (sv.money >= c) { sv.money -= c; car.fuel = car.def.tank; } }
    else if (m === 'haggle') {
      s.haggled = true;
      if (Math.random() < 0.55) { s.price = Math.round(s.price * 0.9); s.line = `You drive a hard bargain... fine, ${fmt(s.price)}.`; }
      else { s.price = Math.round(s.price * 1.05); s.line = `Ha! Now it's ${fmt(s.price)}. Don't push your luck.`; }
    } else if (m === 'buyprop') {
      if (sv.money >= s.price) {
        sv.money -= s.price; sv.homes[s.prop.id] = { upgrades: {}, last: Date.now() };
        this.toast(`You bought ${s.prop.name}! Welcome home.`);
        this.onChange?.(); this.persist(); this.state = { type: 'home', prop: s.prop, tab: 'home' }; return this.render();
      }
    } else if (m === 'ahaggle') {
      s.haggled = true;
      if (Math.random() < 0.55) { s.mult = 0.92; s.line = 'Alright, I can take eight percent off today.'; }
      else { s.mult = 1.04; s.line = 'Prices just went up four percent. Please do not push your luck.'; }
    } else if (m === 'aptbuy') {
      const o = s.offers.find((x) => x.key === v), price = Math.round(o.price * s.mult / 100) * 100;
      if (sv.money >= price) {
        const id = 1000 + s.b.id;
        sv.money -= price; sv.homes[id] = { upgrades: { _apt: { unit: o.name, floor: o.floor, building: s.b.name, idx: s.b.id } }, last: Date.now() };
        this.toast('You bought the ' + o.name + ' on floor ' + o.floor + ' of ' + s.b.name + '!');
        this.onChange?.(); this.persist(); this.state = { type: 'home', prop: this.world.aptProp(s.b.id, sv), tab: 'home' }; return this.render();
      }
    } else if (m === 'app') { s.app = v; if (v === 'bank') this.loadBank();
    } else if (m === 'phonehome') { s.app = null;
    } else if (m === 'nav') { const p = s.pts?.[+v]; if (p) { this.jobs.waypoint = { x: p.x, z: p.z }; this.toast('GPS set: ' + p.n); this.close(); return; }
    } else if (m === 'navp') { const p = this.world.properties[+v]; this.jobs.waypoint = { x: p.x, z: p.z }; this.toast('GPS set: ' + p.name); this.close(); return;
    } else if (m === 'clearnav') { this.jobs.waypoint = null; this.toast('GPS cleared');
    } else if (m === 'openmap') { this.close(); this.openMap?.(); return;
    } else if (m === 'canceljob') { this.jobs.cancelJob();
    } else if (m === 'eat') { const it = (FOOD[s.poi.type] || FOOD.mart)[+v]; if (it && sv.money >= it[1]) { sv.money -= it[1]; this.progress.eat(it[2], it[3]); this.toast('You had a ' + it[0].toLowerCase() + '.'); }
    } else if (m === 'wcat') { s.cat = v;
    } else if (m === 'wbuy') { const [cat, i] = v.split(':'); if (sv.money >= PRICES[cat] && !sv.meta.owned[cat].includes(+i)) { sv.money -= PRICES[cat]; sv.meta.owned[cat].push(+i); sv.meta.outfit[cat] = +i; this.onOutfit?.(); this.toast('Bought - and you are wearing it'); }
    } else if (m === 'wear') { const [cat, i] = v.split(':'); sv.meta.outfit[cat] = +i; this.onOutfit?.();
    } else if (m === 'evstart') { const [kind, id] = v.split(':'); this.events.start(kind, id); this.close(); return;
    } else if (m === 'evcancel') { this.events.cancel();
    } else if (m === 'floor') {
      const go = s.go; this.close(); go(+v); return;
    } else if (m === 'asv') {
      const [kind, dest] = v.split(':'); this.assist.request(kind, dest || null); this.close(); return;
    } else if (m === 'ascancel') { this.assist.cancel(); } else if (m === 'sleep') { this.env.time = 8; if (this.progress) this.progress.m.energy = 100; this.toast('You slept well. It is 08:00.'); this.persist(); }
    else if (m === 'hide') { this.police.clear(); this.toast('You lay low until the heat dies down.'); }
    else if (m === 'collect') {
      const h = sv.homes[s.prop.id], earned = Math.floor(Math.min(SOLAR_CAP, (Date.now() - (h.last || Date.now())) * SOLAR_RATE));
      sv.money += earned; h.last = Date.now(); this.toast(`Collected ${fmt(earned)}`);
    } else if (m === 'spawn') { for (const k of Object.keys(sv.homes)) delete sv.homes[k].upgrades?._spawn; sv.homes[s.prop.id].upgrades._spawn = true; sv.home = s.prop.id; this.toast('Spawn point set: you will start the game here'); }
    else if (m === 'villa') {
      const u = VILLA[v], cost = Math.round(u.cost * (0.6 + 0.2 * s.prop.tier));
      if (sv.money >= cost) { sv.money -= cost; sv.homes[s.prop.id].upgrades[v] = true; if (v === 'solar') sv.homes[s.prop.id].last = Date.now(); this.onChange?.(); this.toast(`${u.name} built`); }
    }
    this.persist(); this.render();
  }
}

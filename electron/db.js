/** Local SQLite database (sql.js / WebAssembly) stored in the user's app-data folder as vyt1.db. */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let SQL = null, db = null, file = null, timer = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profile   (id INTEGER PRIMARY KEY CHECK (id = 1), money REAL NOT NULL, current_car TEXT NOT NULL, home INTEGER);
CREATE TABLE IF NOT EXISTS owned_cars(car_id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS car_state (car_id TEXT PRIMARY KEY, fuel REAL, damage TEXT, upgrades TEXT, paint INTEGER);
CREATE TABLE IF NOT EXISTS homes     (prop_id INTEGER PRIMARY KEY, upgrades TEXT, last_collect INTEGER);
CREATE TABLE IF NOT EXISTS ledger    (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, delta REAL NOT NULL, balance REAL NOT NULL, note TEXT);
CREATE INDEX IF NOT EXISTS idx_ledger_ts ON ledger(ts);
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);
`;

async function init() {
  const initSqlJs = require('sql.js');
  SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) });
  file = path.join(app.getPath('userData'), 'vyt1.db');
  db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  db.run(SCHEMA);
  flush();
}

function flush() {
  clearTimeout(timer); timer = null;
  if (!db) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, file);
}
const schedule = () => { if (!timer) timer = setTimeout(flush, 600); };
const rows = (sql, p = []) => {
  const st = db.prepare(sql, p), out = [];
  while (st.step()) out.push(st.getAsObject());
  st.free(); return out;
};

function load() {
  const p = rows('SELECT * FROM profile WHERE id = 1')[0];
  if (!p) return null;
  const save = { money: p.money, current: p.current_car, home: p.home, owned: [], cars: {}, homes: {} };
  for (const r of rows('SELECT car_id FROM owned_cars')) save.owned.push(r.car_id);
  for (const r of rows('SELECT * FROM car_state')) save.cars[r.car_id] = { fuel: r.fuel, damage: JSON.parse(r.damage || '{}'), up: JSON.parse(r.upgrades || '{}'), paint: r.paint ?? undefined };
  for (const r of rows('SELECT * FROM homes')) save.homes[r.prop_id] = { upgrades: JSON.parse(r.upgrades || '{}'), last: r.last_collect };
  const mt = rows("SELECT value FROM kv WHERE key = 'meta'")[0]; if (mt) { try { save.meta = JSON.parse(mt.value); } catch { /* ignore */ } }
  return save;
}

function save(s, note) {
  const prev = rows('SELECT money FROM profile WHERE id = 1')[0];
  db.run('BEGIN');
  try {
    db.run('INSERT INTO profile (id, money, current_car, home) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET money = excluded.money, current_car = excluded.current_car, home = excluded.home',
      [s.money, s.current, s.home ?? null]);
    db.run('DELETE FROM owned_cars');
    for (const id of new Set(s.owned)) db.run('INSERT INTO owned_cars (car_id) VALUES (?)', [id]);
    for (const [id, c] of Object.entries(s.cars || {}))
      db.run('INSERT INTO car_state (car_id, fuel, damage, upgrades, paint) VALUES (?, ?, ?, ?, ?) ON CONFLICT(car_id) DO UPDATE SET fuel = excluded.fuel, damage = excluded.damage, upgrades = excluded.upgrades, paint = excluded.paint',
        [id, c.fuel ?? 0, JSON.stringify(c.damage || {}), JSON.stringify(c.up || {}), c.paint ?? null]);
    db.run('DELETE FROM homes');
    for (const [id, h] of Object.entries(s.homes || {})) db.run('INSERT INTO homes (prop_id, upgrades, last_collect) VALUES (?, ?, ?)', [+id, JSON.stringify(h.upgrades || {}), h.last ?? null]);
    db.run("INSERT INTO kv (key, value) VALUES ('meta', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(s.meta || {})]);
    if (prev && Math.abs(s.money - prev.money) >= 0.01) db.run('INSERT INTO ledger (ts, delta, balance, note) VALUES (?, ?, ?, ?)', [Date.now(), s.money - prev.money, s.money, note || '']);
    db.run('COMMIT');
  } catch (e) { db.run('ROLLBACK'); throw e; }
  schedule();
  return true;
}

function recent(n = 12) {
  const list = rows('SELECT ts, delta, balance, note FROM ledger ORDER BY id DESC LIMIT ?', [n]);
  const t = rows('SELECT COALESCE(SUM(CASE WHEN delta > 0 THEN delta END), 0) AS earned, COALESCE(SUM(CASE WHEN delta < 0 THEN -delta END), 0) AS spent, COUNT(*) AS n FROM ledger')[0];
  return { list, earned: t.earned, spent: t.spent, count: t.n };
}

function reset() {
  for (const t of ['profile', 'owned_cars', 'car_state', 'homes', 'ledger', 'kv']) db.run(`DELETE FROM ${t}`);
  flush(); return true;
}

module.exports = { init, load, save, recent, reset, flush, filePath: () => file };

/** Reputation levels, hunger/energy needs and the wardrobe catalogue. */
export const TITLES = ['Rookie', 'Driver', 'Courier', 'Street Racer', 'Pro Driver', 'Road Legend'];
export const levelOf = (xp) => 1 + Math.floor(Math.sqrt(Math.max(0, xp) / 120));
export const levelBase = (l) => 120 * (l - 1) ** 2;

export const SHIRTS = [0x3f6fb5, 0xd9d9d9, 0xb03a3a, 0x3d7a4a, 0xe2b93a, 0x6a4a8f, 0x2b2b2e, 0xd77f9b];
export const SHIRT_NAMES = ['Blue tee', 'White tee', 'Red tee', 'Green tee', 'Yellow tee', 'Purple tee', 'Black tee', 'Pink tee'];
export const PANTS = [0x2a2f3a, 0x3b4252, 0x5a4a3a, 0x1b1b1f, 0x4a5a6a, 0x6a6a70, 0x2f3d2f];
export const PANTS_NAMES = ['Dark jeans', 'Navy trousers', 'Brown chinos', 'Black jeans', 'Blue jeans', 'Grey trousers', 'Olive pants'];
export const SHOES = [0xf0f0f0, 0x161616, 0x5a3a22, 0x2a3a5a, 0xaa2a2a];
export const SHOE_NAMES = ['White sneakers', 'Black shoes', 'Brown boots', 'Navy trainers', 'Red sneakers'];
export const HAIRS = ['short', 'long', 'ponytail', 'bun', 'cap', 'beard', 'bald'];
export const HAIR_NAMES = ['Short hair', 'Long hair', 'Ponytail', 'Bun', 'Cap', 'Short + beard', 'Bald'];
export const PRICES = { shirt: 45, pants: 60, shoes: 50, hair: 30 };

export const FOOD = {   // [name, price, hunger+, energy+]
  cafe: [['Coffee', 4, 8, 15], ['Croissant', 5, 20, 3], ['Sandwich', 9, 35, 5]],
  diner: [['Burger', 12, 45, 5], ['Fries', 5, 20, 0], ['Milkshake', 6, 15, 10]],
  mart: [['Water', 2, 5, 5], ['Energy drink', 4, 0, 35], ['Snack bar', 3, 15, 5]],
};

export function defaultMeta() {
  return { xp: 0, hunger: 100, energy: 100, owned: { shirt: [0], pants: [0], shoes: [0], hair: [0] }, outfit: { shirt: 0, pants: 0, shoes: 0, hair: 0 }, stats: { races: 0, drifts: 0, taxi: 0, deliveries: 0, robberies: 0 } };
}

export class Progress {
  constructor(save, toast) {
    this.save = save; this.toast = toast;
    const d = defaultMeta(); save.meta = Object.assign(d, save.meta || {});
    save.meta.owned = Object.assign(d.owned, save.meta.owned || {}); save.meta.outfit = Object.assign(defaultMeta().outfit, save.meta.outfit || {}); save.meta.stats = Object.assign(defaultMeta().stats, save.meta.stats || {});
    this.low = 0; this.warnT = 0;
  }
  get m() { return this.save.meta; }
  get level() { return levelOf(this.m.xp); }
  get title() { return TITLES[Math.min(TITLES.length - 1, Math.floor((this.level - 1) / 2))]; }
  get bonus() { return Math.min(2, 1 + 0.08 * (this.level - 1)); }
  get xpFrac() { const l = this.level, a = levelBase(l), b = levelBase(l + 1); return (this.m.xp - a) / (b - a); }
  get nextXp() { return levelBase(this.level + 1); }
  award(xp, why = '') {
    const before = this.level; this.m.xp += Math.round(xp);
    this.toast('+' + Math.round(xp) + ' XP' + (why ? ' (' + why + ')' : ''));
    if (this.level > before) setTimeout(() => this.toast('LEVEL UP! You are now level ' + this.level + ' - ' + this.title + '. Job pay +' + Math.round((this.bonus - 1) * 100) + '%'), 1800);
  }
  /** Add money with the level bonus; returns what was paid. */
  pay(n) { const v = Math.round(n * this.bonus); this.save.money += v; return v; }
  eat(hunger, energy) { this.m.hunger = Math.min(100, this.m.hunger + hunger); this.m.energy = Math.min(100, this.m.energy + energy); }
  /** Returns true when the player collapses from exhaustion/hunger. */
  tick(dt) {
    const m = this.m; m.hunger = Math.max(0, m.hunger - dt * 0.03); m.energy = Math.max(0, m.energy - dt * 0.02);
    this.warnT -= dt;
    if ((m.hunger < 15 || m.energy < 15) && this.warnT <= 0) { this.warnT = 60; this.toast(m.hunger < m.energy ? 'You are starving - eat something!' : 'You are exhausted - get some sleep or an energy drink!'); }
    if (m.hunger <= 0 || m.energy <= 0) { this.low += dt; if (this.low > 25) { this.low = 0; return true; } } else this.low = 0;
    return false;
  }
}

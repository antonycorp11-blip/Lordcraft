import { ABILITIES, ITEMS } from '../data/abilities';
import { Entity, NEUTRAL_HOSTILE } from './entity';
import type { Game } from './game';

export const XP_TABLE = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
export const MAX_LEVEL = 10;
const tmp: Entity[] = [];

export function xpValue(e: Entity): number {
  const d = e.udef!;
  if (d.xp) return d.xp;
  if (d.hero) return 100 + e.level * 40;
  return 20 + d.supply * 12;
}

/** Distribui experiência para heróis inimigos próximos da vítima. */
export function grantXp(g: Game, victim: Entity, killer: Entity) {
  const total = xpValue(victim);
  g.spatial.queryRadius(victim.x, victim.y, 12, tmp);
  const heroes = tmp.filter((h) => h.alive && h.isHero && g.isAlly(h.owner, killer.owner) && h.owner < 8);
  if (killer.isHero && killer.alive && !heroes.includes(killer)) heroes.push(killer);
  if (!heroes.length) return;
  const share = total / heroes.length;
  for (const h of heroes) {
    let amt = share;
    // experiência de criaturas neutras diminui com o nível (evita "farm" infinito)
    if (victim.owner === NEUTRAL_HOSTILE) amt *= h.level >= 7 ? 0 : h.level >= 5 ? 0.5 : 1;
    addXp(g, h, amt);
  }
}

export function addXp(g: Game, h: Entity, amt: number) {
  if (h.level >= MAX_LEVEL || amt <= 0) return;
  h.xp += amt;
  while (h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level]) {
    h.level++;
    h.skillPts++;
    g.refreshUnit(h);
    h.hp = Math.min(h.maxHp, h.hp + h.udef!.hero!.hpPerLvl);
    g.emit('levelup', h.x, h.y);
    g.msg(h.owner, `${h.udef!.name} alcançou o nível ${h.level}!`, '#ffd76a');
    if (g.players[h.owner]?.ai) autoLearn(h);
  }
}

export function canLearn(h: Entity, ab: string): boolean {
  if (!h.udef?.hero || h.skillPts <= 0) return false;
  const def = ABILITIES[ab];
  const cur = h.skills[ab] ?? 0;
  if (cur >= def.levels) return false;
  if (def.ultimate) return h.level >= 6;
  // nível de habilidade limitado: 1 no nv1, 2 no nv3, 3 no nv5
  const maxAt = h.level >= 5 ? 3 : h.level >= 3 ? 2 : 1;
  return cur < maxAt;
}

export function learnSkill(g: Game, h: Entity, ab: string): boolean {
  if (!canLearn(h, ab)) return false;
  h.skills[ab] = (h.skills[ab] ?? 0) + 1;
  h.skillPts--;
  return true;
}

export function autoLearn(h: Entity) {
  const abs = h.udef!.hero!.abilities;
  let guard = 10;
  while (h.skillPts > 0 && guard-- > 0) {
    // suprema primeiro, depois alterna entre a ativa principal e a aura
    const order = [abs[3], abs[0], abs[2], abs[1], abs[0], abs[2], abs[1]];
    const pick = order.find((a) => canLearn(h, a));
    if (!pick) break;
    h.skills[pick] = (h.skills[pick] ?? 0) + 1;
    h.skillPts--;
  }
}

export function pickupItem(g: Game, h: Entity, it: Entity) {
  const slot = h.items.indexOf(null);
  if (slot < 0) { g.msg(h.owner, 'Inventário cheio.', '#ff8a6a'); return; }
  h.items[slot] = it.itemId;
  it.alive = false;
  g.removeEntity(it);
  g.refreshUnit(h);
  g.emit('buff', h.x, h.y, { color: '#ffd76a' });
  g.msg(h.owner, `${h.udef!.name} obteve ${ITEMS[it.itemId]?.name ?? it.itemId}.`, '#ffd76a');
}

export function useItem(g: Game, h: Entity, slot: number): boolean {
  const id = h.items[slot];
  if (!id || !h.alive) return false;
  const def = ITEMS[id];
  if (def.kind !== 'consumable') return false;
  if (def.use?.heal) { h.hp = Math.min(h.maxHp, h.hp + def.use.heal); g.emit('heal', h.x, h.y); }
  if (def.use?.mana) { h.mana = Math.min(h.maxMana, h.mana + def.use.mana); g.emit('spell', h.x, h.y, { color: '#7ab8ff' }); }
  if (def.use?.xp) addXp(g, h, def.use.xp);
  h.items[slot] = null;
  return true;
}

export function dropItem(g: Game, h: Entity, slot: number) {
  const id = h.items[slot];
  if (!id) return;
  h.items[slot] = null;
  g.spawnPickup('item', h.x + 0.6, h.y + 0.3, id);
  g.refreshUnit(h);
}

export function nearestShop(g: Game, h: Entity, kind: 'sells' | 'hires', r = 6): Entity | null {
  for (const b of g.buildings) {
    if (!b.alive || !b.bdef![kind]) continue;
    if (g.edgeDist(h.x, h.y, b) <= r) return b;
  }
  return null;
}

export function buyItem(g: Game, h: Entity, item: string): boolean {
  const shop = nearestShop(g, h, 'sells');
  if (!shop || !shop.bdef!.sells!.includes(item)) return false;
  const slot = h.items.indexOf(null);
  if (slot < 0) { g.msg(h.owner, 'Inventário cheio.', '#ff8a6a'); return false; }
  const cost = ITEMS[item].cost;
  if (!g.pay(h.owner, { silver: cost })) { g.msg(h.owner, 'Prata insuficiente.', '#ff8a6a'); return false; }
  h.items[slot] = item;
  g.refreshUnit(h);
  g.emit('buff', h.x, h.y, { color: '#ffd76a' });
  return true;
}

import { RESEARCHES } from '../data/factions';
import { ABILITIES, ITEMS } from '../data/abilities';
import type { ArmorType, DmgType, UnitClass } from '../data/types';
import type { Entity } from './entity';
import type { Game } from './game';

// Tabela de multiplicadores tipo de dano × tipo de armadura.
export const DMG_TABLE: Record<DmgType, Record<ArmorType, number>> = {
  blade: { light: 1.0, medium: 1.5, heavy: 1.0, fortified: 0.7, hero: 1.0, none: 1.0 },
  pierce: { light: 2.0, medium: 0.75, heavy: 0.9, fortified: 0.35, hero: 0.5, none: 1.5 },
  siege: { light: 1.0, medium: 0.5, heavy: 1.0, fortified: 1.5, hero: 0.5, none: 1.5 },
  arcane: { light: 1.25, medium: 0.75, heavy: 2.0, fortified: 0.35, hero: 0.5, none: 1.0 },
  hero: { light: 1.0, medium: 1.0, heavy: 1.0, fortified: 0.5, hero: 1.0, none: 1.0 },
  chaos: { light: 1, medium: 1, heavy: 1, fortified: 1, hero: 1, none: 1 },
};

export interface Mods {
  dmgMul: number; armor: number; hpMul: number; speed: number; range: number; sight: number;
  carry: number; gather: number; mana: number; heal: number;
}
const ZERO: Mods = { dmgMul: 0, armor: 0, hpMul: 0, speed: 0, range: 0, sight: 0, carry: 0, gather: 0, mana: 0, heal: 0 };

/** Modificadores de pesquisa (cache por jogador/tipo). */
export function modsFor(g: Game, owner: number, unitType: string, cls: UnitClass): Mods {
  const p = g.players[owner];
  if (!p) return ZERO;
  const key = owner * 1000 + 0;
  let cache = g.modCache.get(key);
  if (!cache) { cache = new Map(); g.modCache.set(key, cache); }
  let m = cache.get(unitType);
  if (m) return m;
  m = { ...ZERO };
  for (const rid in p.upgrades) {
    const r = RESEARCHES[rid];
    if (!r) continue;
    for (const ef of r.effects) {
      if (ef.cls && !ef.cls.includes(cls)) continue;
      if (ef.units && !ef.units.includes(unitType)) continue;
      if (ef.stat === 'bArmor' || ef.stat === 'bHp') continue;
      switch (ef.stat) {
        case 'dmg': m.dmgMul += ef.mul ?? 0; break;
        case 'armor': m.armor += ef.add ?? 0; break;
        case 'hp': m.hpMul += ef.mul ?? 0; break;
        case 'speed': m.speed += ef.add ?? 0; break;
        case 'range': m.range += ef.add ?? 0; break;
        case 'sight': m.sight += ef.add ?? 0; break;
        case 'carry': m.carry += ef.add ?? 0; break;
        case 'gather': m.gather += ef.mul ?? 0; break;
        case 'mana': m.mana += ef.add ?? 0; break;
        case 'heal': m.heal += ef.mul ?? 0; break;
      }
    }
  }
  cache.set(unitType, m);
  return m;
}

export function buildingMods(g: Game, owner: number): { armor: number; hpMul: number } {
  const p = g.players[owner];
  const out = { armor: 0, hpMul: 0 };
  if (!p) return out;
  for (const rid in p.upgrades) {
    const r = RESEARCHES[rid];
    if (!r) continue;
    for (const ef of r.effects) {
      if (ef.stat === 'bArmor') out.armor += ef.add ?? 0;
      if (ef.stat === 'bHp') out.hpMul += ef.mul ?? 0;
    }
  }
  return out;
}

function itemStat(e: Entity, k: 'dmg' | 'armor' | 'hp' | 'mana' | 'speed' | 'regen'): number {
  if (!e.items.length) return 0;
  let s = 0;
  for (const it of e.items) if (it) s += ITEMS[it]?.stats?.[k] ?? 0;
  return s;
}

export function armorType(e: Entity): ArmorType {
  if (e.kind === 'building') return 'fortified';
  return e.udef?.armorType ?? 'medium';
}

export function getArmor(g: Game, e: Entity): number {
  if (e.kind === 'building') {
    return (e.bdef?.armor ?? 5) + buildingMods(g, e.owner).armor;
  }
  const d = e.udef!;
  let a = d.armor + modsFor(g, e.owner, e.type, d.cls).armor + itemStat(e, 'armor');
  if (d.hero) a += (e.level - 1) * d.hero.armorPerLvl;
  for (const b of e.buffs) if (b.armor) a += b.armor;
  return a;
}

export function dmgMultiplier(g: Game, e: Entity): number {
  let m = 1;
  if (e.udef) m += modsFor(g, e.owner, e.type, e.udef.cls).dmgMul;
  for (const b of e.buffs) if (b.dmgMul) m += b.dmgMul;
  return m;
}

export function rollDamage(g: Game, e: Entity): number {
  const a = e.udef?.attack ?? e.bdef?.attack;
  if (!a) return 0;
  let base = a.dmg[0] + g.rng.next() * (a.dmg[1] - a.dmg[0]);
  if (e.udef?.hero) base += (e.level - 1) * e.udef.hero.dmgPerLvl;
  base += itemStat(e, 'dmg');
  for (const b of e.buffs) if (b.dmgAdd) base += b.dmgAdd;
  return base * dmgMultiplier(g, e);
}

export function getRange(g: Game, e: Entity): number {
  const a = e.udef?.attack ?? e.bdef?.attack;
  if (!a) return 0;
  if (e.udef) return a.range + modsFor(g, e.owner, e.type, e.udef.cls).range;
  return a.range;
}

export function getSpeed(g: Game, e: Entity): number {
  const d = e.udef;
  if (!d) return 0;
  let s = d.speed + modsFor(g, e.owner, e.type, d.cls).speed + itemStat(e, 'speed');
  let mul = 1;
  for (const b of e.buffs) {
    if (b.speedMul) mul += b.speedMul;
    if (b.root || b.stun) return 0;
  }
  return s * Math.max(0.2, mul);
}

export function getAtkMul(e: Entity): number {
  let m = 1;
  for (const b of e.buffs) if (b.atkMul) m += b.atkMul;
  return Math.max(0.3, m);
}

export function getSight(g: Game, e: Entity): number {
  if (e.kind === 'building') return e.built ? e.bdef!.sight : 4;
  const d = e.udef!;
  let s = d.sight + modsFor(g, e.owner, e.type, d.cls).sight;
  if (g.isNight()) s = s * 0.72 + (d.nightSight ?? 0);
  return s;
}

export function getRegen(g: Game, e: Entity): number {
  let r = e.udef?.regen ?? 0.25;
  r += itemStat(e, 'regen');
  for (const b of e.buffs) if (b.regen) r += b.regen;
  return r;
}

export function heroMaxHp(e: Entity): number {
  const d = e.udef!;
  return d.hp + (d.hero ? (e.level - 1) * d.hero.hpPerLvl : 0) + itemStat(e, 'hp');
}
export function heroMaxMana(g: Game, e: Entity): number {
  const d = e.udef!;
  const m = modsFor(g, e.owner, e.type, d.cls).mana;
  return (d.mana ?? 0) + m + (d.hero ? (e.level - 1) * d.hero.manaPerLvl : 0) + itemStat(e, 'mana');
}

export function isStunned(e: Entity): boolean {
  for (const b of e.buffs) if (b.stun) return true;
  return false;
}
export function isRooted(e: Entity): boolean {
  for (const b of e.buffs) if (b.root || b.stun) return true;
  return false;
}

export function skillLevel(e: Entity, ab: string): number {
  if (e.udef?.hero) return e.skills[ab] ?? 0;
  return e.udef?.abilities?.includes(ab) ? 1 : 0;
}

export function abilityParam(ab: string, lvl: number, k: string): number {
  const a = ABILITIES[ab];
  const arr = a?.p[k];
  if (!arr) return 0;
  return arr[Math.max(0, Math.min(arr.length - 1, lvl - 1))];
}

/** "Poder" aproximado de combate de uma entidade (usado pela IA e diagnósticos). */
export function power(e: Entity): number {
  const d = e.udef;
  if (d) {
    const a = d.attack;
    const dps = a ? ((a.dmg[0] + a.dmg[1]) / 2 / a.cd) * (a.splash ? 1.6 : 1) : 4;
    const lvl = d.hero ? 1 + (e.level - 1) * 0.25 : 1;
    return Math.sqrt(Math.max(1, e.hp) * (1 + d.armor * 0.06) * dps) * lvl * (d.cls === 'worker' ? 0.3 : 1);
  }
  if (e.bdef?.attack) {
    const a = e.bdef.attack;
    return Math.sqrt(e.hp * 1.4 * ((a.dmg[0] + a.dmg[1]) / 2 / a.cd));
  }
  return 0;
}

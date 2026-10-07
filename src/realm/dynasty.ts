import { FEMALE_NAMES, MALE_NAMES, TRAITS } from './data';
import { age, chance, houseName, log, nid, pick, remember, roll, rumor, year } from './core';
import type { House, Person, Realm } from './types';

// Dinastias: pessoas nascem, casam, envelhecem e morrem; a casa passa ao herdeiro.

export function newPerson(r: Realm, house: string, female: boolean, born: number, father = 0, mother = 0, name = ''): Person {
  const p: Person = {
    id: nid(r), name: name || pick(r, female ? FEMALE_NAMES : MALE_NAMES), house, female, born,
    alive: true, spouse: 0, father, mother, trait: pick(r, TRAITS),
  };
  r.persons[p.id] = p;
  return p;
}

export function marry(r: Realm, a: Person, b: Person) {
  a.spouse = b.id;
  b.spouse = a.id;
  // a noiva (ou o noivo de uma casa menor) passa a viver na casa do cônjuge que é lorde
  const ha = r.houses[a.house], hb = r.houses[b.house];
  if (hb && hb.lord === b.id) a.house = b.house;
  else if (ha && ha.lord === a.id) b.house = a.house;
  else if (a.female) a.house = b.house; else b.house = a.house;
}

export function family(r: Realm, house: string): Person[] {
  return Object.values(r.persons).filter((p) => p.house === house && p.alive);
}
export function childrenOf(r: Realm, id: number): Person[] {
  return Object.values(r.persons).filter((p) => p.father === id || p.mother === id);
}
export function adult(r: Realm, p: Person): boolean { return p.alive && age(r, p) >= 16; }
/** Membros que podem casar com alguém de fora (solteiros, adultos, não o próprio lorde). */
export function marriageable(r: Realm, house: string): Person[] {
  return family(r, house).filter((p) => adult(r, p) && !p.spouse && age(r, p) <= 45);
}

/** Linha de sucessão: herdeiro designado, filhos (mais velho primeiro), irmãos, jurados. */
export function successionLine(r: Realm, h: House): Person[] {
  const lord = r.persons[h.lord];
  const out: Person[] = [];
  const add = (p?: Person) => { if (p && p.alive && p.id !== h.lord && !out.includes(p)) out.push(p); };
  if (h.id === r.player && r.heir) add(r.persons[r.heir]);
  const kids = childrenOf(r, h.lord).filter((p) => p.alive).sort((a, b) => a.born - b.born);
  kids.filter((k) => k.house === h.id || !k.spouse).forEach(add);
  // netos
  for (const k of childrenOf(r, h.lord)) childrenOf(r, k.id).filter((p) => p.alive).sort((a, b) => a.born - b.born).forEach(add);
  // irmãos
  if (lord) Object.values(r.persons).filter((p) => p.alive && p.id !== lord.id && ((lord.father && p.father === lord.father) || (lord.mother && p.mother === lord.mother))).sort((a, b) => a.born - b.born).forEach(add);
  // cônjuge e heróis jurados
  if (lord?.spouse) add(r.persons[lord.spouse]);
  family(r, h.id).filter((p) => p.sworn).sort((a, b) => a.born - b.born).forEach(add);
  return out;
}

export function initFamily(r: Realm, h: House, lordAge: number, female: boolean, lordName = '') {
  const y = year(r);
  const lord = newPerson(r, h.id, female, y - lordAge, 0, 0, lordName);
  h.lord = lord.id;
  if (lordAge >= 24) {
    const sp = newPerson(r, h.id, !female, y - lordAge + (roll(r) * 8 - 3));
    marry(r, lord, sp);
    const kids = lordAge > 30 ? 1 + Math.floor(roll(r) * 3) : Math.floor(roll(r) * 2);
    for (let k = 0; k < kids; k++) {
      const ka = Math.max(0, lordAge - 20 - k * 3 - Math.floor(roll(r) * 6));
      const kid = newPerson(r, h.id, chance(r, 0.5), y - ka, female ? sp.id : lord.id, female ? lord.id : sp.id);
      if (age(r, kid) >= 22 && chance(r, 0.5)) {
        const sp2 = newPerson(r, h.id, !kid.female, kid.born + roll(r) * 4 - 2);
        marry(r, kid, sp2);
      }
    }
  }
  // um irmão às vezes
  if (chance(r, 0.4)) newPerson(r, h.id, chance(r, 0.5), y - lordAge + 2 + roll(r) * 8);
}

function deathChance(a: number): number {
  if (a < 16) return 0.002;
  if (a < 45) return 0.004;
  if (a < 55) return 0.012;
  if (a < 62) return 0.03;
  if (a < 70) return 0.06;
  return 0.12;
}

export function kill(r: Realm, p: Person, cause: string) {
  if (!p.alive) return;
  p.alive = false;
  p.diedAt = year(r);
  p.cause = cause;
  const sp = p.spouse ? r.persons[p.spouse] : null;
  if (sp) sp.spouse = 0;
  if (r.heir === p.id) r.heir = 0;
  for (const k of Object.keys(r.council) as (keyof Realm['council'])[]) if (r.council[k] === p.id) delete r.council[k];
  const h = Object.values(r.houses).find((x) => x.lord === p.id);
  const mine = p.house === r.player;
  if (mine || h) log(r, `${p.name}, da ${houseName(r, p.house)}, morreu ${cause} aos ${age(r, p)} anos.`, 'dynasty');
  if (h) succeed(r, h);
}

/** O lorde morreu: a casa passa ao próximo da linha ou se extingue. */
export function succeed(r: Realm, h: House) {
  const line = successionLine(r, h);
  const next = line[0];
  if (!next) {
    h.alive = false;
    log(r, `A ${houseName(r, h.id)} chegou ao fim: não restou herdeiro.`, 'dynasty');
    if (h.id === r.player) { r.over = 'extinta'; r.events.push({ id: nid(r), kind: 'gameover', data: { why: 'extinta' }, t: r.time }); return; }
    // a província passa ao suserano (ou ao jogador, se ele for o suserano)
    const heirHouse = h.liege && r.houses[h.liege]?.alive ? h.liege : r.crown;
    const prov = r.provinces[h.province];
    if (prov && heirHouse) {
      prov.owner = heirHouse;
      for (const v of Object.values(r.houses)) if (v.liege === h.id) v.liege = heirHouse;
      log(r, `${prov.name} passou ao domínio da ${houseName(r, heirHouse)}.`, 'politics');
    }
    return;
  }
  next.house = h.id;
  h.lord = next.id;
  if (h.id === r.player) {
    r.heir = 0;
    log(r, `${next.name} herdou a ${houseName(r, h.id)}. Vida longa ao novo senhor!`, 'dynasty');
    r.events.push({ id: nid(r), kind: 'succession', data: { person: next.id }, t: r.time });
    // um herdeiro jovem ou jurado tem menos legitimidade
    const a = age(r, next);
    rumor(r, `Sucessão de ${next.name}`, 0, -6, next.sworn ? -15 : a < 16 ? -10 : -3);
  } else {
    // a opinião sobre o jogador muda um pouco com o novo lorde
    h.op.trust = h.op.trust * 0.7;
    h.op.fear = h.op.fear * 0.8;
  }
}

/** Uma estação passou: nascimentos e mortes. */
export function seasonDynasty(r: Realm) {
  const y = year(r);
  for (const p of Object.values(r.persons)) {
    if (!p.alive) continue;
    const a = age(r, p);
    if (chance(r, deathChance(a))) { kill(r, p, a >= 55 ? 'de velhice' : pick(r, ['de febre', 'num acidente de caça', 'de uma doença súbita'])); continue; }
    // nascimentos: casais em que a mãe tem de 17 a 42 anos
    if (p.female && p.spouse && a >= 17 && a <= 42) {
      const dad = r.persons[p.spouse];
      if (dad?.alive && chance(r, 0.14)) {
        const kid = newPerson(r, p.house, chance(r, 0.5), y, dad.id, p.id);
        if (p.house === r.player) log(r, `Nasceu ${kid.name}, ${kid.female ? 'filha' : 'filho'} de ${dad.name} e ${p.name}.`, 'dynasty');
      }
    }
  }
  // casamentos internos entre casas da IA (mantém o mundo vivo)
  if (chance(r, 0.25)) {
    const hs = Object.values(r.houses).filter((h) => h.alive && h.id !== r.player);
    const a = pick(r, hs), b = pick(r, hs);
    if (a && b && a.id !== b.id) {
      const ma = marriageable(r, a.id).filter((p) => p.id !== a.lord), mb = marriageable(r, b.id).filter((p) => p.id !== b.lord);
      const x = ma[0], y2 = mb.find((p) => p.female !== x?.female);
      if (x && y2) {
        marry(r, x, y2);
        a.rel[b.id] = b.rel[a.id] = 'ally';
        log(r, `${x.name} (${houseName(r, a.id)}) casou-se com ${y2.name} (${houseName(r, b.id)}).`, 'dynasty');
      }
    }
  }
}

/** Um herói treinado passa a ser membro jurado da casa do jogador. */
export function swearHero(r: Realm, heroType: string, title: string): Person {
  const existing = Object.values(r.persons).find((p) => p.alive && p.house === r.player && p.heroType === heroType);
  if (existing) return existing;
  const y = year(r);
  const p = newPerson(r, r.player, false, y - 30 - roll(r) * 8);
  p.sworn = true;
  p.heroType = heroType;
  p.trait = 'leal';
  log(r, `${p.name}, ${title}, jurou lealdade à ${houseName(r, r.player)}.`, 'dynasty');
  return p;
}

/** Valor político de um casamento entre membros de duas casas. */
export function marriageValue(r: Realm, mine: Person, theirs: Person): number {
  const h = r.houses[theirs.house];
  const pl = r.houses[r.player];
  let v = 20;
  if (mine.id === pl.lord) v += 20;                      // casar com o próprio senhor
  if (mine.sworn) v -= 15;                              // herói jurado não é de sangue
  if (theirs.id === h.lord) v -= 30;
  v += (h.op.trust - 10) * 0.3 + h.op.legit * 0.2;
  return v;
}

export { remember };

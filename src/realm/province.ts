import type { Game } from '../sim/game';
import { clamp, chance, houseName, log, nid, player, remember, roll, seasonOf, vassalsOf } from './core';
import type { Budget, House, Province, Realm } from './types';

// A província do jogador é o próprio mapa RTS: casas abrigam civis, civis pagam impostos e
// viram trabalhadores ou soldados (que recebem salário), comida e segurança mudam com o tempo.

export const TAX_RATE = [0.15, 0.25, 0.38];
export const TAX_NAMES = ['Baixos', 'Normais', 'Altos'];
const TAX_CONTENT = [12, 0, -16];
export const WAGE = { worker: 0.25, soldier: 0.2, hero: 2 }; // prata por dia (soldado: por ponto de abastecimento)
export const HOUSING = { hall: 20, house: 8, other: 1 };
const EAT = { civ: 0.04, worker: 0.05, soldier: 0.06 };
const FARM = 0.07;
const GARDEN = 0.32; // grãos por dia de cada casa (a sede vale duas)
const SEASON_FOOD = [1, 1.4, 1.2, 0.3];

export interface ProvinceStats {
  workers: number; soldiers: number; soldierSupply: number; heroes: number; towers: number; camps: number;
  housing: number; gardens: number; foodDay: number; wagesDay: number; taxDay: number; secTarget: number; contentTarget: number;
}

export function emptyBudget(): Budget { return { taxes: 0, sales: 0, tributeIn: 0, salaries: 0, tributeOut: 0, interest: 0, purchases: 0 }; }

export function home(r: Realm): Province { return r.provinces[player(r).province]; }

export function provinceStats(g: Game, r: Realm): ProvinceStats {
  const pid = 0;
  let workers = 0, soldiers = 0, soldierSupply = 0, heroes = 0, towers = 0, housing = 0, gardens = 0;
  for (const u of g.units) {
    if (!u.alive || u.owner !== pid) continue;
    const c = u.udef!.cls;
    if (c === 'worker') workers++;
    else if (c === 'hero') heroes++;
    else if (c !== 'summon') { soldiers++; soldierSupply += u.udef!.supply; }
  }
  for (const b of g.buildings) {
    if (!b.alive || b.owner !== pid || !b.built) continue;
    const cat = b.bdef!.cat;
    if (cat === 'hall') { housing += HOUSING.hall; gardens += 2; }
    else if (cat === 'house') { housing += HOUSING.house; gardens += 1; }
    else housing += HOUSING.other;
    if (b.bdef!.attack) towers++;
  }
  // acampamentos de criaturas perto da sede assustam o povo
  const sx = g.players[0].startX, sy = g.players[0].startY;
  const camps = g.camps.filter((c) => !c.cleared && Math.hypot(c.x - sx, c.y - sy) < 50).length;
  const p = home(r);
  const s = seasonOf(r);
  // hortas das casas e da sede garantem um mínimo de grãos mesmo com poucos civis
  const foodDay = (p.pop * FARM + gardens * GARDEN) * p.prod.food * SEASON_FOOD[s] - p.pop * EAT.civ - workers * EAT.worker - (soldiers + heroes) * EAT.soldier;
  const wagesDay = workers * WAGE.worker + soldierSupply * WAGE.soldier + heroes * WAGE.hero;
  const taxDay = p.pop * TAX_RATE[r.laws.tax] * (0.6 + p.security / 250) * (r.council.tesoureiro ? 1.12 : 1) * (0.7 + p.content / 200);
  const guard = (soldierSupply * 2 + towers * 10 + heroes * 6) / Math.max(10, p.pop) * 30;
  const secTarget = clamp(45 + Math.min(40, guard) - Math.min(20, camps * 4) + (r.council.marechal ? 10 : 0) - (r.raid ? 25 : 0), 0, 100);
  const crowd = p.pop > housing ? Math.min(25, (p.pop - housing) * 2) : 0;
  const contentTarget = clamp(58 + TAX_CONTENT[r.laws.tax] + (p.food <= 0 ? -35 : 0) + (p.security - 50) * 0.25 - crowd + (player(r).title === 'rei' ? 10 : 0), 0, 100);
  return { workers, soldiers, soldierSupply, heroes, towers, camps, housing, gardens, foodDay, wagesDay, taxDay, secTarget, contentTarget };
}

/** Um dia na província do jogador. */
export function dayPlayerProvince(g: Game, r: Realm) {
  const p = home(r);
  const st = provinceStats(g, r);
  const pl = g.players[0];
  p.housing = st.housing;
  // comida
  const before = p.food;
  p.food = Math.max(0, p.food + st.foodDay);
  if (st.foodDay < 0 && before >= 40 && p.food < 40) g.msg(0, 'Os grãos estão acabando! Construa casas (hortas), tenha mais civis ou compre grãos no mercado do Feudo.', '#ff9a6a');
  if (before > 0 && p.food <= 0) g.msg(0, 'Fome no Vale: o povo começa a fugir.', '#ff6a6a');
  // população: cresce com comida e moradia; foge com fome ou superlotação
  const free = st.housing - p.pop;
  if (p.food > 0 && free > 0) {
    let grow = 0.18 * (p.content / 60) + (p.security >= 40 ? 0.12 : 0);
    grow = Math.min(grow, free);
    p.pop += grow;
  } else if (p.food <= 0) {
    p.pop = Math.max(0, p.pop - Math.max(0.3, p.pop * 0.02));
  } else if (free < 0) {
    p.pop = Math.max(0, p.pop - Math.min(-free, 0.25));
  }
  p.security += clamp(st.secTarget - p.security, -2, 2);
  p.content += clamp(st.contentTarget - p.content, -1.5, 1.5);
  // impostos e salários (diários, para a economia parecer viva)
  const tax = st.taxDay;
  pl.res.silver += tax;
  r.budget.taxes += tax;
  const wages = st.wagesDay;
  if (pl.res.silver >= wages) pl.res.silver -= wages;
  else {
    // sem prata para os salários: soldados descontentes, trabalho mais lento
    pl.debt = Math.min(400, pl.debt + wages - pl.res.silver);
    pl.res.silver = 0;
    p.content = Math.max(0, p.content - 0.5);
  }
  r.budget.salaries += wages;
  // a dívida de salário é paga primeiro quando sobra prata
  if (pl.debt > 0 && pl.res.silver > 0) { const pay = Math.min(pl.debt, pl.res.silver); pl.debt -= pay; pl.res.silver -= pay; }
}

/** Civis disponíveis para recrutar. Treinar uma unidade tira um civil da população. */
export function freeCivilians(r: Realm): number {
  return Math.floor(home(r).pop);
}

/** Um dia nas casas da IA: impostos, soldos e crescimento. */
export function dayHouses(r: Realm) {
  for (const h of Object.values(r.houses)) {
    if (!h.alive || h.id === r.player) continue;
    const p = r.provinces[h.province];
    const income = p.pop * 0.1 * p.wealth;
    const upkeep = h.army * 0.0045;
    h.treasury += income - upkeep;
    if (h.treasury < -200) {
      // tesouro negativo: pega empréstimo com a Guilda de Lume (que o jogador pode comprar)
      borrowFromGuild(r, h, 400 + Math.round(roll(r) * 300));
    }
  }
}

export const GUILD = 'guilda';

export function borrowFromGuild(r: Realm, h: House, amount: number) {
  h.treasury += amount;
  r.debts.push({ id: nid(r), debtor: h.id, creditor: GUILD, amount: Math.round(amount * 1.25), due: r.time + 150 * 4, interest: 0.05 });
  log(r, `A ${houseName(r, h.id)} contraiu uma dívida de ${amount} de prata com a Guilda de Lume.`, 'trade');
}

/** Fim de estação nas casas da IA: crescem, recrutam e pagam o suserano. */
export function seasonHouses(r: Realm) {
  for (const h of Object.values(r.houses)) {
    if (!h.alive || h.id === r.player) continue;
    const p = r.provinces[h.province];
    p.pop = Math.min(p.housing, p.pop * (1 + 0.02 + roll(r) * 0.02));
    p.housing = Math.max(p.housing, p.pop * 1.05);
    const spend = { ambicioso: 0.4, cruel: 0.45, honrado: 0.25, mercador: 0.15, cauteloso: 0.25 }[h.personality];
    const cap = 300 + p.pop * 9;
    if (h.treasury > 200 && h.army < cap) {
      const s = Math.min(h.treasury * spend, (cap - h.army) / 0.6);
      h.treasury -= s;
      h.army += s * 0.6;
    }
    // tributo ao suserano (IA para IA é abstrato; ao jogador vira prata de verdade)
    if (h.liege && r.houses[h.liege]?.alive) {
      const t = Math.max(15, Math.round(p.pop * 0.35 * p.wealth));
      const paid = Math.min(t, Math.max(0, h.treasury));
      h.treasury -= paid;
      if (h.liege === r.player) {
        r.budget.tributeIn += paid;
        r.pendingSilver += paid;
        if (paid < t) { remember(r, h.id, 'Cobramos tributo que não podiam pagar', -3); }
        // vassalos rebeldes: confiança muito baixa e medo baixo
        if (h.op.trust < -40 && h.op.fear < 30 && chance(r, 0.35)) rebel(r, h);
      } else r.houses[h.liege].treasury += paid;
    }
  }
  // dívidas vencidas com a guilda: a guilda cobra com juros
  for (const d of r.debts) {
    if (d.creditor !== GUILD) continue;
    const h = r.houses[d.debtor];
    if (!h?.alive) { d.amount = 0; continue; }
    if (r.time >= d.due && h.treasury > d.amount) { h.treasury -= d.amount; d.amount = 0; }
    else if (r.time >= d.due) d.amount = Math.round(d.amount * 1.08);
  }
  r.debts = r.debts.filter((d) => d.amount > 0);
}

export function rebel(r: Realm, h: House) {
  h.liege = r.houses[r.player].liege;
  h.rel[r.player] = 'war';
  r.houses[r.player].rel[h.id] = 'war';
  h.warSince = r.time;
  log(r, `A ${houseName(r, h.id)} rompeu o juramento e se rebelou contra você!`, 'war');
}

export function vassalCount(r: Realm): number { return vassalsOf(r, r.player).length; }

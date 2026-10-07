import type { Game } from '../sim/game';
import { DAY_SECS, SEASON_NAMES, SEASON_SECS } from './data';
import { chance, houseName, log, player, seasonOf, year } from './core';
import { seasonDynasty } from './dynasty';
import { deliverLetters, seasonAIWars, seasonDebts, seasonPolitics } from './letters';
import { dayCaravans, dayMarkets, dayOrders } from './market';
import { dayHouses, dayPlayerProvince, emptyBudget, home, seasonHouses } from './province';
import { checkAssembly } from './titles';
import { dayArmies, raidTick } from './war';
import type { Good, Realm } from './types';

// Relógio do feudo: chamado uma vez por segundo de jogo pela simulação da província.

export function realmSecond(g: Game) {
  const r = g.realm;
  if (!r || r.over === 'extinta' || r.over === 'derrota') return;
  r.time += 1;
  raidTick(g, r);
  if (Math.round(r.time) % DAY_SECS === 0) day(g, r);
  if (r.time >= (r.seasonIndex + 1) * SEASON_SECS) season(g, r);
}

export function stockpile(g: Game, r: Realm) {
  const pl = g.players[0];
  return {
    get: (good: Good) => (good === 'food' ? home(r).food : pl.res[good]),
    take: (good: Good, n: number) => { if (good === 'food') home(r).food -= n; else pl.res[good] -= n; },
    addSilver: (n: number) => { pl.res.silver += n; },
  };
}

function day(g: Game, r: Realm) {
  dayPlayerProvince(g, r);
  dayHouses(r);
  dayMarkets(r);
  dayCaravans(r, (c) => {
    if (c.owner !== r.player) return;
    g.players[0].res.silver += c.silver;
    r.budget.sales += c.silver;
    if (c.silver) g.msg(0, `Caravana voltou com ${c.silver} de prata.`, '#ffd76a');
    else g.msg(0, 'Caravana voltou de mãos vazias.', '#ff9a6a');
  });
  dayOrders(r, stockpile(g, r), (v) => { r.budget.sales += v; });
  deliverLetters(g, r);
  dayArmies(g, r);
  if (r.pendingSilver > 0) { g.players[0].res.silver += r.pendingSilver; r.pendingSilver = 0; }
}

function season(g: Game, r: Realm) {
  r.seasonIndex++;
  const pl = player(r);
  // tributo ao suserano: parte dos impostos da estação
  if (pl.liege && r.houses[pl.liege]?.alive) {
    const rate = pl.title === 'senhor' ? 0.15 : 0.1;
    const due = Math.max(20, Math.round(r.budget.taxes * rate));
    const silver = g.players[0].res;
    const liege = r.houses[pl.liege];
    if (silver.silver >= due) {
      silver.silver -= due;
      r.budget.tributeOut += due;
      liege.treasury += due;
      liege.op.trust = Math.min(100, liege.op.trust + 1.5);
    } else {
      liege.op.trust -= 8;
      r.memories.push({ house: liege.id, t: r.time, text: 'Não pagou o tributo', trust: -8, fear: 0, legit: 0 });
      log(r, `Você não conseguiu pagar o tributo de ${due} de prata à ${houseName(r, liege.id)}.`, 'politics');
    }
  }
  seasonHouses(r);
  seasonDebts(g, r);
  seasonDynasty(r);
  seasonPolitics(g, r);
  seasonAIWars(r);
  checkAssembly(r);
  // revolta por descontentamento
  const hp = home(r);
  if (hp.content < 20 && chance(r, 0.5)) {
    const lost = Math.ceil(hp.pop * 0.12);
    hp.pop -= lost;
    hp.security = Math.max(0, hp.security - 20);
    log(r, `Revolta no Vale! ${lost} civis fugiram e a segurança despencou.`, 'war');
    g.msg(0, 'Revolta camponesa! Baixe os impostos ou alimente seu povo.', '#ff6a6a');
  }
  r.lastBudget = r.budget;
  r.budget = emptyBudget();
  const b = r.lastBudget;
  const net = Math.round(b.taxes + b.sales + b.tributeIn - b.salaries - b.tributeOut - b.interest);
  const s = seasonOf(r);
  log(r, `${SEASON_NAMES[s]} do ano ${Math.floor(year(r))}. Saldo da última estação: ${net >= 0 ? '+' : ''}${net} de prata.`, 'info');
  g.msg(0, `${SEASON_NAMES[s]} do ano ${Math.floor(year(r))} · saldo da estação ${net >= 0 ? '+' : ''}${net} de prata`, net >= 0 ? '#9fe0a0' : '#ff9a6a');
  if (s === 3) g.msg(0, 'Inverno: as colheitas quase param. Guarde ou compre grãos.', '#bcd8ff');
}

/** Texto curto da estação para o HUD. */
export function seasonLabel(r: Realm): string {
  const s = seasonOf(r);
  return `${SEASON_NAMES[s]} · ${Math.floor(year(r))}`;
}

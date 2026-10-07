import type { Game } from '../sim/game';
import { houseName, log, nid, player, remember } from './core';
import { buyCost, ESCORT_COST, price, sellValue, sendCaravan } from './market';
import { GUILD, home } from './province';
import { stockpile } from './tick';
import { GOOD_NAMES, type Good, type Realm } from './types';

// Ações do jogador no mercado e com dívidas (chamadas pela interface do feudo).

export function marketOf(r: Realm) { return home(r).market; }

export function localSell(g: Game, r: Realm, good: Good, qty: number): string {
  const st = stockpile(g, r);
  qty = Math.min(qty, Math.floor(st.get(good)));
  if (qty <= 0) return `Você não tem ${GOOD_NAMES[good].toLowerCase()} para vender.`;
  const m = marketOf(r);
  const v = Math.round(sellValue(m, good, qty) * (r.laws.trade ? 1.08 : 1));
  st.take(good, qty);
  m.stock[good] += qty;
  st.addSilver(v);
  r.budget.sales += v;
  return `Vendeu ${qty} de ${GOOD_NAMES[good].toLowerCase()} por ${v} de prata.`;
}

export function localBuy(g: Game, r: Realm, good: Good, qty: number): string {
  const m = marketOf(r);
  qty = Math.min(qty, Math.floor(m.stock[good]));
  if (qty <= 0) return 'O mercado está sem estoque.';
  const c = buyCost(m, good, qty);
  const pl = g.players[0];
  if (pl.res.silver < c) return `Custa ${c} de prata.`;
  pl.res.silver -= c;
  m.stock[good] -= qty;
  if (good === 'food') home(r).food += qty; else pl.res[good] += qty;
  r.budget.purchases += c;
  return `Comprou ${qty} de ${GOOD_NAMES[good].toLowerCase()} por ${c} de prata.`;
}

export function addOrder(r: Realm, good: Good, qty: number, min: number) {
  r.orders.push({ id: nid(r), good, qty, min });
}

export function playerCaravan(g: Game, r: Realm, dest: string, good: Good, qty: number, escort: number): string {
  const st = stockpile(g, r);
  if (dest === player(r).province) return 'Escolha outro mercado.';
  if (r.caravans.filter((c) => c.owner === r.player).length >= 4) return 'No máximo 4 caravanas ao mesmo tempo.';
  qty = Math.min(qty, Math.floor(st.get(good)));
  if (qty <= 0) return `Sem ${GOOD_NAMES[good].toLowerCase()} para levar.`;
  const pl = g.players[0];
  const cost = ESCORT_COST[escort] ?? 0;
  if (pl.res.silver < cost) return `A escolta custa ${cost} de prata.`;
  const owner = r.houses[r.provinces[dest].owner];
  if (owner && owner.rel[r.player] === 'war') return 'Esse mercado é de uma casa em guerra com você.';
  pl.res.silver -= cost;
  st.take(good, qty);
  sendCaravan(r, r.player, dest, good, qty, escort);
  const est = Math.round(qty * price(r.provinces[dest].market, good) * 0.9);
  return `Caravana partiu com ${qty} de ${GOOD_NAMES[good].toLowerCase()} (venda estimada: ${est} de prata).`;
}

/** Compra a dívida que uma casa tem com a guilda: a casa passa a dever ao jogador. */
export function buyDebt(g: Game, r: Realm, id: number): string {
  const d = r.debts.find((x) => x.id === id && x.creditor === GUILD);
  if (!d) return '';
  const cost = debtPrice(r, d.amount, d.due);
  const pl = g.players[0];
  if (pl.res.silver < cost) return `Custa ${cost} de prata.`;
  pl.res.silver -= cost;
  d.creditor = r.player;
  remember(r, d.debtor, 'Comprou nossa dívida', -6, 8);
  log(r, `Você comprou a dívida de ${d.amount} de prata da ${houseName(r, d.debtor)}. Se não pagarem no prazo, cobre-os.`, 'trade');
  return 'Dívida comprada.';
}

export function debtPrice(r: Realm, amount: number, due: number): number {
  // dívidas vencidas valem menos para a guilda (risco de calote)
  return Math.round(amount * (r.time > due ? 0.55 : 0.75));
}

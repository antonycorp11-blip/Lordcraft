import { BASE_PRICE, DAYS_PER_SEASON } from './data';
import { chance, clamp, houseName, log, nid, remember, roll, route, seasonOf } from './core';
import { GOODS, GOOD_NAMES, type Caravan, type Good, type Market, type Province, type Realm } from './types';

// Mercados por cidade com oferta e procura, ordens de venda e caravanas que percorrem as estradas.

export function initMarket(p: Province): Market {
  const stock = {} as Record<Good, number>, target = {} as Record<Good, number>, base = {} as Record<Good, number>;
  for (const g of GOODS) {
    // muita produção local = muito estoque = preço baixo
    target[g] = Math.round(p.pop * (g === 'aether' ? 0.5 : 1.6));
    stock[g] = Math.round(target[g] * clamp(p.prod[g], 0.3, 2.5));
    base[g] = BASE_PRICE[g] * clamp(1.25 - p.prod[g] * 0.25, 0.6, 1.3) * p.wealth;
  }
  return { stock, target, base };
}

export function price(m: Market, g: Good): number {
  const ratio = (m.target[g] + 10) / (m.stock[g] + 10);
  return Math.round(m.base[g] * clamp(Math.pow(ratio, 0.65), 0.35, 3.2) * 100) / 100;
}
export const SELL_FEE = 0.1;
/** Quanto se recebe vendendo `qty` agora (preço cai a cada unidade vendida). */
export function sellValue(m: Market, g: Good, qty: number): number {
  let s = 0;
  const st = m.stock[g];
  for (let i = 0; i < qty; i += 5) { m.stock[g] = st + i + Math.min(5, qty - i); s += price(m, g) * Math.min(5, qty - i); }
  m.stock[g] = st;
  return Math.floor(s * (1 - SELL_FEE));
}
export function buyCost(m: Market, g: Good, qty: number): number {
  let s = 0;
  const st = m.stock[g];
  for (let i = 0; i < qty; i += 5) { m.stock[g] = Math.max(0, st - i); s += price(m, g) * Math.min(5, qty - i); }
  m.stock[g] = st;
  return Math.ceil(s * 1.08);
}

/** Um dia de mercado: produção e consumo locais aproximam o estoque do alvo. */
export function dayMarkets(r: Realm) {
  const winter = seasonOf(r) === 3, summer = seasonOf(r) === 1;
  for (const p of Object.values(r.provinces)) {
    const m = p.market;
    for (const g of GOODS) {
      let prodMul = p.prod[g];
      if (g === 'food') prodMul *= winter ? 0.4 : summer ? 1.35 : 1;
      const produce = m.target[g] * 0.018 * prodMul;
      const consume = m.target[g] * 0.018 * (g === 'food' && winter ? 1.3 : 1);
      m.stock[g] = Math.max(0, m.stock[g] + produce - consume + (roll(r) - 0.5) * m.target[g] * 0.01);
      // o mercado nunca fica totalmente vazio nem infinito
      m.stock[g] = clamp(m.stock[g], m.target[g] * 0.08, m.target[g] * 4);
    }
    m.target.food = Math.round(p.pop * 1.6);
  }
}

// ----------------------------------------------------------------------
// Caravanas
// ----------------------------------------------------------------------
export const ESCORT_COST = [0, 25, 70];
export const ESCORT_PROTECT = [0, 0.55, 0.85];
const CARAVAN_DAYS_MUL = 1.2;

export function caravanPos(r: Realm, c: Caravan): { x: number; y: number } {
  const a = r.provinces[c.path[c.seg]], b = r.provinces[c.path[Math.min(c.path.length - 1, c.seg + 1)]];
  return { x: a.x + (b.x - a.x) * c.t, y: a.y + (b.y - a.y) * c.t };
}

export function sendCaravan(r: Realm, owner: string, dest: string, good: Good, qty: number, escort: number): Caravan | null {
  const from = r.houses[owner].province;
  const rt = route(r, from, dest);
  if (rt.path.length < 2) return null;
  const c: Caravan = { id: nid(r), owner, path: rt.path, seg: 0, t: 0, good, qty, silver: 0, escort, returning: false, dest };
  r.caravans.push(c);
  return c;
}

/** Avança as caravanas um dia; devolve a prata que chegou em casa (para o jogador). */
export function dayCaravans(r: Realm, onHome: (c: Caravan) => void) {
  for (const c of r.caravans) {
    const a = c.path[c.seg], b = c.path[c.seg + 1];
    const rd = r.roads.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (!rd) { c.qty = 0; c.seg = c.path.length; continue; }
    c.t += 1 / (rd.days * CARAVAN_DAYS_MUL);
    // emboscada: estradas perigosas e terras de inimigos
    const land = r.provinces[b];
    const hostile = land && land.owner !== c.owner && r.houses[land.owner]?.rel[c.owner] === 'war';
    const risk = (rd.danger + (hostile ? 0.18 : 0)) / rd.days * (1 - ESCORT_PROTECT[c.escort]);
    if ((c.qty > 0 || c.silver > 0) && chance(r, risk)) ambush(r, c, hostile ? land.owner : '');
    if (c.t >= 1) {
      c.t = 0;
      c.seg++;
      if (c.seg >= c.path.length - 1) {
        if (!c.returning) {
          // chegou ao mercado de destino: vende e volta
          const m = r.provinces[c.dest].market;
          const pact = c.owner === r.player && r.houses[r.provinces[c.dest].owner]?.pact;
          const v = c.qty <= 0 ? 0 : c.fixedPrice ? Math.round(c.qty * c.fixedPrice) : Math.round(sellValue(m, c.good, c.qty) / (pact ? 1 - SELL_FEE : 1));
          m.stock[c.good] += c.qty;
          c.silver += v;
          if (c.owner === r.player && c.qty > 0) log(r, `Caravana vendeu ${c.qty} de ${GOOD_NAMES[c.good].toLowerCase()} em ${r.provinces[c.dest].name} por ${v} de prata.`, 'trade');
          if (c.qty > 0 && r.provinces[c.dest].owner !== r.player) remember(r, r.provinces[c.dest].owner, 'Comerciou em nossas terras', 2);
          c.qty = 0;
          c.returning = true;
          c.path = c.path.slice().reverse();
          c.seg = 0;
        } else {
          onHome(c);
          c.seg = c.path.length; // remove
        }
      }
    }
  }
  r.caravans = r.caravans.filter((c) => c.seg < c.path.length - 1);
}

function ambush(r: Realm, c: Caravan, by: string) {
  const lostGoods = c.qty, lostSilver = c.silver;
  c.qty = 0;
  c.silver = 0;
  if (c.owner !== r.player) return;
  const where = r.provinces[c.path[Math.min(c.path.length - 1, c.seg + 1)]].name;
  if (by) {
    log(r, `A ${houseName(r, by)} emboscou sua caravana perto de ${where}! Perdidos: ${lostGoods ? lostGoods + ' de ' + GOOD_NAMES[c.good].toLowerCase() : ''}${lostSilver ? ' ' + lostSilver + ' de prata' : ''}.`, 'war');
    r.houses[by].casusBelli = true;
  } else {
    log(r, `Bandoleiros saquearam sua caravana perto de ${where}.${c.escort < 2 ? ' Uma escolta maior teria ajudado.' : ''}`, 'trade');
  }
  // a caravana vazia segue o caminho (para voltar e ser removida)
}

// ----------------------------------------------------------------------
// Ordens de venda no mercado local
// ----------------------------------------------------------------------
export interface Stockpile { get(g: Good): number; take(g: Good, n: number): void; addSilver(n: number): void }

export function dayOrders(r: Realm, st: Stockpile, onSale: (silver: number) => void) {
  const m = r.provinces[r.houses[r.player].province].market;
  for (const o of r.orders) {
    if (o.qty <= 0) continue;
    const pr = price(m, o.good) * (1 - SELL_FEE);
    if (pr < o.min) continue;
    const n = Math.min(o.qty, 10, Math.floor(st.get(o.good)));
    if (n <= 0) continue;
    const v = sellValue(m, o.good, n);
    st.take(o.good, n);
    m.stock[o.good] += n;
    o.qty -= n;
    st.addSilver(v);
    onSale(v);
  }
  r.orders = r.orders.filter((o) => o.qty > 0);
}

export const MARKET_DAY_NOTE = `Preços sobem quando falta mercadoria e caem quando sobra. Cada estação tem ${DAYS_PER_SEASON} dias.`;

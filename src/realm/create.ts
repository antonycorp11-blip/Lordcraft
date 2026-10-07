import { HOUSE_SEEDS, PROVINCE_SEEDS, ROADS } from './data';
import { initFamily } from './dynasty';
import { initMarket } from './market';
import { emptyBudget } from './province';
import type { Crest, House, Province, Realm } from './types';

export interface DynastyOptions { lordName: string; houseName: string; crest: Crest; female: boolean; seed: number }

export function createRealm(o: DynastyOptions): Realm {
  const r: Realm = {
    v: 1, time: 0, rngS: (o.seed ^ 0x51ed27) >>> 0 || 7, nextId: 1, player: 'jogador', crown: 'valcrest',
    houses: {}, provinces: {}, roads: ROADS.map((x) => ({ ...x })), persons: {}, letters: [], caravans: [], armies: [], memories: [],
    debts: [], orders: [], chronicle: [], events: [], budget: emptyBudget(), lastBudget: null, laws: { tax: 1, trade: 0, levy: 0 },
    council: {}, heir: 0, raid: null, assemblyAt: 0, over: '', pendingSilver: 0, seasonIndex: 0,
  };
  for (const s of PROVINCE_SEEDS) {
    const p: Province = {
      ...s, prod: { ...s.prod }, owner: s.owner || r.player, housing: Math.round(s.pop * 1.15), food: s.pop * 4,
      security: 55, content: 60, market: null!,
    };
    p.market = initMarket(p);
    r.provinces[p.id] = p;
  }
  const home = r.provinces.ermo;
  home.pop = 18;
  home.food = 160;
  home.security = 50;
  home.content = 62;
  const pl: House = {
    id: r.player, name: o.houseName || 'Nova', motto: 'Do nada, uma dinastia.', crest: o.crest, personality: 'honrado', lord: 0,
    province: 'ermo', liege: 'morvane', title: 'senhor', treasury: 0, army: 0, alive: true, op: { trust: 0, fear: 0, legit: 0 }, rel: {}, lastLetter: 0,
  };
  r.houses[pl.id] = pl;
  initFamily(r, pl, 26, o.female, o.lordName);
  // o fundador começa solteiro: casar é uma das primeiras jogadas políticas
  for (const p of Object.values(r.persons)) if (p.house === pl.id && p.id !== pl.lord) { delete r.persons[p.id]; }
  r.persons[pl.lord].spouse = 0;
  for (const s of HOUSE_SEEDS) {
    const h: House = {
      id: s.id, name: s.name, motto: s.motto, crest: s.crest, personality: s.personality, lord: 0, province: s.province, liege: s.liege,
      title: s.title, treasury: s.treasury, army: s.army, alive: true,
      op: { trust: s.liege === 'morvane' ? 8 : s.id === 'morvane' ? 12 : 0, fear: 2, legit: 15 }, rel: {}, lastLetter: -200,
    };
    r.houses[h.id] = h;
    initFamily(r, h, s.lordAge, !!s.lordFemale);
  }
  // carta de boas-vindas do suserano
  const ml = r.persons[r.houses.morvane.lord];
  r.letters.push({ id: r.nextId++, from: 'morvane', to: pl.id, kind: 'aviso', sentAt: 0, arriveAt: 0, delivered: true,
    text: `${ml.name} de Morvane saúda a nova Casa ${pl.name}. O Vale do Ermo é seu, como meu vassalo: a cada estação, 15% dos seus impostos vêm para Morvane. ` +
      'Construa casas — colonos chegam, pagam impostos e se tornam soldados. Guarde grãos para o inverno. E lembre-se: em Aldaris, ninguém esquece o que você fez.' });
  // alianças tradicionais entre suserano e vassalos
  for (const h of Object.values(r.houses)) if (h.liege && h.id !== r.player) { h.rel[h.liege] = 'ally'; r.houses[h.liege].rel[h.id] = 'ally'; }
  return r;
}

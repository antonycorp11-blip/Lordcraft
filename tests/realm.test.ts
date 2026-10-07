import { describe, expect, it } from 'vitest';
import { createBattle, createCampaign, battleSurvivors } from '../src/sim/setup';
import { serialize, deserialize } from '../src/sim/save';
import { train } from '../src/sim/commands';
import { sendLetter, answerLetter } from '../src/realm/letters';
import { formArmy, autoResolve, unitPower } from '../src/realm/war';
import { route, avgLegit } from '../src/realm/core';
import { localBuy, localSell, playerCaravan, buyDebt } from '../src/realm/actions';
import { price, sellValue as sellValueOf, buyCost as buyCostOf } from '../src/realm/market';
import { nextStep, advance, votes } from '../src/realm/titles';
import { successionLine, kill } from '../src/realm/dynasty';
import { SEASON_SECS } from '../src/realm/data';
import type { Game } from '../src/sim/game';

const opts = { lordName: 'Aldo', houseName: 'Teste', crest: { c1: '#123', c2: '#eee', pattern: 'fess' as const, charge: '✦' }, female: false, seed: 7, faction: 'valmir' as const };
const run = (g: Game, secs: number) => { for (let i = 0; i < secs * 20; i++) g.update(); };

describe('feudo', () => {
  it('começa em paz, só com o jogador no mapa da província', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    expect(g.mode).toBe('province');
    expect(g.buildings.filter((b) => b.owner === 0).length).toBe(1);
    expect(g.buildings.some((b) => b.owner > 0 && b.owner < 8)).toBe(false);
    expect(Object.values(r.houses).filter((h) => h.rel[r.player] === 'war').length).toBe(0);
    expect(Object.keys(r.houses).length).toBe(8);
    expect(r.houses[r.player].title).toBe('senhor');
    expect(r.persons[r.houses[r.player].lord].name).toBe('Aldo');
  });

  it('o reino anda: dias, estações, impostos, comida e cartas', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    const silver0 = g.players[0].res.silver;
    run(g, SEASON_SECS + 5);
    expect(r.seasonIndex).toBe(1);
    expect(r.lastBudget!.taxes).toBeGreaterThan(10);
    expect(g.players[0].res.silver).toBeGreaterThan(silver0 - 5 + 10);
    expect(g.over).toBe(false);
    // carta com ida e volta
    expect(sendLetter(g, r, 'morvane', 'presente', { silver: 50 })).toContain('Mensageiro');
    const trust0 = r.houses.morvane.op.trust;
    const days = route(r, 'ermo', 'morvane').days;
    run(g, days * 5 * 2 + 10);
    expect(r.houses.morvane.op.trust).toBeGreaterThan(trust0);
    expect(r.letters.some((l) => l.to === r.player && l.kind === 'resposta' && l.delivered)).toBe(true);
  });

  it('treinar consome população e cancelar devolve', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    const hall = g.buildings.find((b) => b.owner === 0)!;
    const pop0 = r.provinces.ermo.pop;
    expect(train(g, 0, hall.id, 'v_lavrador')).toBe(true);
    expect(r.provinces.ermo.pop).toBe(pop0 - 1);
    r.provinces.ermo.pop = 0.5;
    expect(train(g, 0, hall.id, 'v_lavrador')).toBe(false);
  });

  it('mercado: comprar sobe o preço, vender baixa; caravana volta com prata', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    g.players[0].res.silver = 2000;
    g.players[0].res.wood = 500;
    const m = r.provinces.ermo.market;
    const p0 = price(m, 'food');
    localBuy(g, r, 'food', 50);
    expect(price(m, 'food')).toBeGreaterThan(p0);
    const w0 = price(m, 'wood');
    localSell(g, r, 'wood', 100);
    expect(price(m, 'wood')).toBeLessThan(w0);
    const s0 = g.players[0].res.silver;
    expect(playerCaravan(g, r, 'coroa', 'wood', 100, 2)).toContain('partiu');
    run(g, 160);
    expect(r.caravans.length).toBe(0);
    expect(g.players[0].res.silver).toBeGreaterThan(s0); // mesmo pagando salários, a venda rende
  });

  it('exército marcha, guerra resolvida vira vassalagem; título e assembleia', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    const ids: number[] = [];
    for (let i = 0; i < 18; i++) ids.push(g.spawnUnit('v_cavaleiro', 0, 30 + (i % 6), 30 + Math.floor(i / 6)).id);
    r.houses.draven.rel[r.player] = 'war';
    r.houses[r.player].rel.draven = 'war';
    const a = formArmy(g, r, ids, 'pinhal')!;
    expect(a.units.length).toBe(18);
    expect(g.units.filter((u) => u.alive && u.owner === 0 && u.type === 'v_cavaleiro').length).toBe(0);
    for (let i = 0; i < 40 && !a.waiting; i++) run(g, 5);
    expect(a.waiting).toBe(true);
    expect(r.events.some((e) => e.kind === 'battle')).toBe(true);
    const res = autoResolve(r, a);
    expect(res.won).toBe(true);
    expect(r.houses.draven.liege).toBe(r.player);
    // o exército volta e as unidades reaparecem no mapa
    for (let i = 0; i < 60 && r.armies.length; i++) run(g, 5);
    expect(g.units.filter((u) => u.alive && u.owner === 0 && u.type === 'v_cavaleiro').length).toBeGreaterThan(0);
    // título
    const st = nextStep(g, r);
    expect(st.next).toBe('lorde');
    r.provinces.ermo.pop = 50; g.players[0].res.silver = 900;
    for (const h of Object.values(r.houses)) { h.op.legit = 60; h.op.trust = 60; }
    expect(advance(g, r)).toContain('Mensageiro');
    for (let i = 0; i < 30 && r.houses[r.player].title === 'senhor'; i++) run(g, 5);
    expect(r.houses[r.player].title).toBe('lorde');
    expect(votes(r).mine.length).toBeGreaterThan(0);
    expect(avgLegit(r)).toBeGreaterThan(0);
  });

  it('batalha comandada: o atacante entra só com o exército', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    const ids = [g.spawnUnit('v_lanceiro', 0, 30, 30).id, g.spawnUnit('v_besteiro', 0, 31, 30).id];
    const a = formArmy(g, r, ids, 'pinhal')!;
    const b = createBattle(r, a, 'valmir');
    expect(b.game.mode).toBe('battle');
    expect(b.game.units.filter((u) => u.owner === 0 && u.alive).length).toBe(2);
    expect(b.game.buildings.filter((x) => x.owner === 0 && x.alive).length).toBe(0);
    expect(b.game.buildings.filter((x) => x.owner === 1 && x.alive).length).toBeGreaterThan(2);
    for (let i = 0; i < 600 && !b.game.over; i++) b.game.update();
    expect(battleSurvivors(b.game).length).toBeLessThanOrEqual(2);
  });

  it('dívida comprada pode virar vassalagem; sucessão funciona', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    const h = r.houses.ostrel;
    h.treasury = -500;
    run(g, 6);
    const d = r.debts.find((x) => x.debtor === 'ostrel')!;
    expect(d).toBeTruthy();
    g.players[0].res.silver = 5000;
    expect(buyDebt(g, r, d.id)).toContain('comprada');
    expect(d.creditor).toBe(r.player);
    // sucessão: o lorde do jogador sem herdeiros = fim da dinastia
    const pl = r.houses[r.player];
    expect(successionLine(r, pl).length).toBe(0);
    kill(r, r.persons[pl.lord], 'em teste');
    expect(r.over).toBe('extinta');
  });

  it('salva e carrega o feudo', () => {
    const { game: g } = createCampaign(opts);
    run(g, 30);
    sendLetter(g, g.realm!, 'velsa', 'comercio');
    const data = serialize(g, []);
    const g2 = deserialize(JSON.parse(JSON.stringify(data)));
    expect(g2.mode).toBe('province');
    expect(g2.realm!.time).toBe(g.realm!.time);
    expect(g2.realm!.letters.length).toBe(g.realm!.letters.length);
    run(g2, 10);
    expect(g2.realm!.time).toBeGreaterThan(g.realm!.time);
  });

  it('uma campanha longa roda sem quebrar e o mundo reage', () => {
    const { game: g } = createCampaign({ ...opts, seed: 99 });
    const r = g.realm!;
    for (let s = 0; s < 10; s++) {
      run(g, SEASON_SECS);
      // responde cartas aleatoriamente para exercitar os caminhos
      for (const l of r.letters) if (l.ask && !l.answered && l.delivered) answerLetter(g, r, l.id, l.id % 2 === 0);
    }
    expect(r.seasonIndex).toBe(10);
    expect(r.chronicle.length).toBeGreaterThan(10);
    expect(r.letters.filter((l) => l.to === r.player).length).toBeGreaterThan(0);
    expect(unitPower('v_lanceiro')).toBeGreaterThan(30);
  });
});

describe('mercado sem lucro instantâneo', () => {
  it('vender e recomprar a mesma quantidade sempre dá prejuízo', () => {
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    for (const good of ['food', 'wood', 'aether'] as const) {
      for (const stock of [5, 40, 400]) {
        r.provinces.ermo.market.stock[good] = stock;
        for (const q of [5, 10, 50]) {
          const m = r.provinces.ermo.market;
          const st = m.stock[good];
          const gain = sellValueOf(m, good, q);
          m.stock[good] = st + q;
          const cost = buyCostOf(m, good, q);
          m.stock[good] = st;
          expect(cost, `${good} ${stock} ${q}`).toBeGreaterThan(gain);
        }
      }
    }
  });
});

describe('hierarquia sem ciclos', () => {
  it('conquistar o suserano do suserano não cria ciclo', async () => {
    const { subjugate } = await import('../src/realm/war');
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    // jogador (vassalo de Morvane, vassala de Valcrest) toma Valcrest sendo só Lorde
    r.houses[r.player].title = 'lorde';
    subjugate(r, r.houses.valcrest, r.houses[r.player]);
    for (const h of Object.values(r.houses)) {
      let x = h.liege, n = 0;
      while (x && n < 12) { expect(x, `ciclo em ${h.id}`).not.toBe(h.id); x = r.houses[x]?.liege ?? null; n++; }
      expect(n).toBeLessThan(12);
    }
    expect(r.houses.valcrest.liege).toBe(r.player);
  });
});

describe('economia que não morre', () => {
  it('mina esgotada vira veio esgotado e, escavada, rende para sempre', async () => {
    const { depleteResource } = await import('../src/sim/units');
    const { issueGather } = await import('../src/sim/commands');
    const { game: g } = createCampaign(opts);
    const m = g.resources.find((r) => r.kind === 'mine')!;
    depleteResource(g, m);
    expect(m.alive).toBe(true);
    expect(m.exhausted).toBe(true);
    m.deep = true; m.exhausted = false; m.amount = 1e9;
    const ws = g.units.filter((u) => u.owner === 0 && u.isWorker).map((u) => u.id);
    issueGather(g, 0, ws, m);
    const s0 = g.players[0].stats.gathered.silver;
    run(g, 90);
    expect(g.players[0].stats.gathered.silver).toBeGreaterThan(s0 + 100);
    expect(m.amount).toBeGreaterThan(1e8);
  });

  it('árvore derrubada volta a crescer depois de alguns minutos', () => {
    const { game: g } = createCampaign(opts);
    const w = g.world;
    let i = -1;
    for (let k = 0; k < w.tree.length; k++) if (w.tree[k] && !g.units.some((u) => Math.abs(u.x - (k % w.w)) < 3 && Math.abs(u.y - Math.floor(k / w.w)) < 3)) { i = k; break; }
    w.removeTree(i);
    expect(w.tree[i]).toBe(0);
    run(g, 600);
    expect(w.tree[i]).toBeGreaterThan(0);
  });

  it('sem prata o soldo não vira dívida: soldados desertam e voltam a ser civis; dispensar devolve à população', async () => {
    const { dismiss } = await import('../src/realm/province');
    const { game: g } = createCampaign(opts);
    const r = g.realm!;
    const sx = g.players[0].startX, sy = g.players[0].startY;
    const ids = Array.from({ length: 10 }, (_, k) => g.spawnUnit('v_lanceiro', 0, sx + 8 + (k % 5), sy + 8 + Math.floor(k / 5)).id);
    for (const u of g.units) if (u.owner === 0 && u.isWorker) u.order = null; // ninguém minerando
    g.players[0].res.silver = 0;
    const pop0 = r.provinces.ermo.pop;
    run(g, 5 * 8);
    const left = ids.filter((id) => g.ents.get(id)?.alive).length;
    expect(left).toBeLessThan(10);
    expect(g.players[0].debt).toBe(0);
    expect(r.provinces.ermo.pop).toBeGreaterThan(pop0);
    const n = dismiss(g, r, ids.filter((id) => g.ents.get(id)?.alive));
    expect(n).toBe(left);
    expect(g.units.filter((u) => u.alive && u.type === 'v_lanceiro').length).toBe(0);
  });
});

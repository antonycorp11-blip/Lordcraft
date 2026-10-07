// Robô que joga ~40 min de campanha pelos mesmos comandos do jogo e confere invariantes:
// posições, recursos, opiniões, hierarquia sem ciclos, salvamento, trabalhadores presos, invasores.
import { expect, it } from 'vitest';
import { createCampaign } from '../src/sim/setup';
import { issueBuild, issueGather, train, issueSmart, upgrade } from '../src/sim/commands';
import { canPlaceAt } from '../src/sim/units';
import { sendLetter, answerLetter } from '../src/realm/letters';
import { formArmy, autoResolve } from '../src/realm/war';
import { serialize, deserialize } from '../src/sim/save';
import { BUILDINGS } from '../src/data/factions';
import type { Game } from '../src/sim/game';

const problems = new Map<string, number>();
const bad = (k: string) => problems.set(k, (problems.get(k) ?? 0) + 1);

function findSpot(g: Game, type: string, cx: number, cy: number): [number, number] | null {
  const size = BUILDINGS[type].size;
  for (let r = 4; r < 30; r++) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2;
    const tx = Math.round(cx + Math.cos(a) * r - size / 2), ty = Math.round(cy + Math.sin(a) * r - size / 2);
    if (canPlaceAt(g, 0, type, tx, ty).ok) return [tx, ty];
  }
  return null;
}

function check(g: Game, tag: string) {
  const ids = new Set<number>();
  for (const u of g.units) {
    if (ids.has(u.id)) bad('id duplicado'); ids.add(u.id);
    if (!u.alive) continue;
    if (!Number.isFinite(u.x) || !Number.isFinite(u.y) || !Number.isFinite(u.hp)) bad('NaN em unidade ' + u.type);
    if (u.x < 0 || u.y < 0 || u.x > g.world.w || u.y > g.world.h) bad('unidade fora do mapa');
    if (u.anim === 'work' && !u.order && !u.inside) bad('pose de trabalho sem ordem');
    if (u.hp > u.maxHp + 0.01) bad('hp acima do máximo ' + u.type);
    if (!u.air && !u.inside && !g.world.freeAt(u.x, u.y) && g.world.inside(Math.floor(u.x), Math.floor(u.y))) bad('unidade dentro de bloqueio ' + u.type);
  }
  const p = g.players[0];
  for (const k of ['silver', 'wood', 'aether'] as const) if (!(p.res[k] >= -0.01) || !Number.isFinite(p.res[k])) bad(`recurso ${k} inválido (${p.res[k]})`);
  const r = g.realm!;
  const hp = r.provinces[r.houses[r.player].province];
  if (!(hp.pop >= -0.01)) bad('população negativa ' + hp.pop);
  if (!(hp.food >= 0)) bad('comida negativa');
  for (const h of Object.values(r.houses)) {
    for (const k of ['trust', 'fear', 'legit'] as const) if (!Number.isFinite(h.op[k])) bad('opinião NaN ' + h.id);
    if (!Number.isFinite(h.army) || h.army < 0) bad('exército inválido ' + h.id + ' ' + h.army);
    if (!Number.isFinite(h.treasury)) bad('tesouro NaN ' + h.id);
    if (h.liege === h.id) bad('casa vassala de si mesma ' + h.id);
    // ciclo de suserania
    let x = h.liege, n = 0;
    while (x && n < 12) { if (x === h.id) { bad('ciclo de suserania ' + h.id); break; } x = r.houses[x]?.liege ?? null; n++; }
  }
  for (const m of Object.values(r.provinces)) for (const k of ['food', 'wood', 'aether'] as const) if (!Number.isFinite(m.market.stock[k]) || m.market.stock[k] < 0) bad('estoque inválido');
  if (p.supplyUsed > p.supplyCap + 40) bad('abastecimento estourado');
  void tag;
}

it('auditoria da campanha', () => {
  const { game: g } = createCampaign({ lordName: 'Aldo', houseName: 'Teste', crest: { c1: '#123', c2: '#eee', pattern: 'fess', charge: '✦' }, female: false, seed: 11, faction: 'valmir' });
  const r = g.realm!;
  const p = g.players[0];
  const hall = () => g.buildings.find((b) => b.owner === 0 && b.alive && b.bdef!.cat === 'hall');
  let lastWorkerPos = new Map<number, [number, number, number]>();
  const log: string[] = [];
  for (let sec = 0; sec < 2400; sec++) {
    for (let k = 0; k < 20; k++) g.update();
    if (g.over) { log.push(`fim de jogo em ${sec}s (derrota=${p.defeated})`); break; }
    if (sec % 3 === 0) check(g, String(sec));
    const H = hall();
    const ws = g.units.filter((u) => u.alive && u.owner === 0 && u.isWorker);
    // economia: trabalhadores, casas, quartel, madeira
    if (sec % 5 === 0 && H) {
      if (ws.length < 14 && H.bqueue.length < 2) train(g, 0, H.id, 'v_lavrador');
      const houses = g.buildings.filter((b) => b.owner === 0 && b.alive && b.type === 'v_casa').length;
      const idle = ws.filter((u) => !u.order && !u.inside);
      const want = houses < 6 && p.res.silver > 120 && p.res.wood > 30 ? 'v_casa'
        : !g.buildings.some((b) => b.owner === 0 && b.type === 'v_quartel') && p.res.silver > 200 && p.res.wood > 70 ? 'v_quartel'
        : !g.buildings.some((b) => b.owner === 0 && b.type === 'v_serraria') && p.res.silver > 140 ? 'v_serraria' : '';
      const building = g.units.some((u) => u.owner === 0 && u.order?.t === 'build');
      if (want && !building) {
        const spot = findSpot(g, want, H.cx, H.cy);
        const w = idle[0] ?? ws.find((u) => !u.inside);
        if (spot && w) issueBuild(g, 0, w.id, want, spot[0], spot[1]);
      }
      // ociosos vão para a madeira
      for (const u of idle) {
        let best = -1, bd = 1e9;
        for (let y = Math.max(0, Math.floor(u.y) - 25); y < Math.min(g.world.h, u.y + 25); y++)
          for (let x = Math.max(0, Math.floor(u.x) - 25); x < Math.min(g.world.w, u.x + 25); x++) {
            const i = g.world.idx(x, y);
            if (g.world.tree[i]) { const d = Math.hypot(x - u.x, y - u.y); if (d < bd) { bd = d; best = i; } }
          }
        if (best >= 0) issueGather(g, 0, [u.id], null, best);
      }
    }
    // tropas
    const q = g.buildings.find((b) => b.owner === 0 && b.alive && b.built && b.type === 'v_quartel');
    if (q && sec % 7 === 0 && q.bqueue.length < 2) train(g, 0, q.id, sec % 21 === 0 ? 'v_besteiro' : 'v_lanceiro');
    if (sec === 900 && H) upgrade(g, 0, H.id);
    // trabalhadores presos: com ordem e parados no mesmo lugar por muito tempo
    if (sec % 30 === 0) {
      const now = new Map<number, [number, number, number]>();
      for (const u of ws) {
        const prev = lastWorkerPos.get(u.id);
        now.set(u.id, [u.x, u.y, sec]);
        if (prev && u.order && !u.inside && Math.hypot(prev[0] - u.x, prev[1] - u.y) < 0.05 && u.anim !== 'work' && u.order.t !== 'gather') bad(`trabalhador parado com ordem ${u.order.t}`);
      }
      lastWorkerPos = now;
    }
    // política e guerra
    if (sec === 200) sendLetter(g, r, 'morvane', 'presente', { silver: 100 });
    if (sec === 400) sendLetter(g, r, 'velsa', 'comercio');
    if (sec % 60 === 0) for (const l of r.letters) if (l.ask && !l.answered && l.delivered) answerLetter(g, r, l.id, l.kind !== 'vassalagem');
    if (sec === 1500) {
      r.houses.draven.rel[r.player] = 'war'; r.houses[r.player].rel.draven = 'war';
      const army = g.units.filter((u) => u.alive && u.owner === 0 && !u.isWorker).map((u) => u.id);
      if (army.length) formArmy(g, r, army, 'pinhal');
    }
    const waiting = r.armies.find((a) => a.owner === r.player && a.waiting);
    if (waiting) log.push('batalha: ' + autoResolve(r, waiting).text);
    // salvar e carregar no meio
    if (sec === 1200) {
      const d = serialize(g, []);
      const g2 = deserialize(JSON.parse(JSON.stringify(d)));
      if (g2.units.length !== g.units.filter((u) => !u.removed).length && Math.abs(g2.units.length - g.units.length) > 3) bad('save perdeu unidades');
      if (!g2.realm || g2.realm.time !== r.time) bad('save perdeu o reino');
    }
    // raiders: devem atacar
    if (r.raid && sec % 10 === 0) {
      const ru = r.raid.units.map((id) => g.ents.get(id)).filter((e) => e?.alive);
      if (ru.length && ru.every((e) => !e!.order && !e!.targetId)) bad('invasores parados sem ordem');
    }
    // soldados ociosos se defendem: reúne perto da sede
    if (sec % 20 === 0 && H) {
      const army = g.units.filter((u) => u.alive && u.owner === 0 && !u.isWorker && !u.order).map((u) => u.id);
      if (army.length && r.raid) {
        const t = g.ents.get(r.raid.units.find((id) => g.ents.get(id)?.alive) ?? 0);
        if (t) issueSmart(g, 0, army, t.x, t.y, t);
      }
    }
  }
  const st = r.provinces.ermo;
  log.push(`fim: ano ${(312 + r.time / 600).toFixed(1)} pop ${st.pop.toFixed(1)} comida ${st.food.toFixed(0)} seg ${st.security.toFixed(0)} cont ${st.content.toFixed(0)} prata ${p.res.silver.toFixed(0)} madeira ${p.res.wood.toFixed(0)}`);
  log.push(`unidades: ${g.units.filter((u) => u.alive && u.owner === 0).length}, prédios: ${g.buildings.filter((b) => b.alive && b.owner === 0).map((b) => b.type + (b.built ? '' : '*')).join(',')}`);
  log.push(`título ${r.houses[r.player].title}, vassalos ${Object.values(r.houses).filter((h) => h.liege === r.player).map((h) => h.id)}`);
  log.push('crônica: ' + r.chronicle.slice(-12).map((c) => c.text).join(' | '));
  log.push('mensagens: ' + [...new Set(g.messages.filter((m) => m.owner === 0).map((m) => m.text))].slice(-25).join(' | '));
  void log;
  expect([...problems]).toEqual([]);
  expect(r.provinces.ermo.pop).toBeGreaterThan(20); // a colônia não pode morrer de fome jogando normalmente
});

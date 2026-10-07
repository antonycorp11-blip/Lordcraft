import { BUILDINGS, FACTIONS, RESEARCHES, UNITS } from '../data/factions';
import { ABILITIES } from '../data/abilities';
import type { UnitClass } from '../data/types';
import { Entity, type GroupMove, type Order } from './entity';
import type { Game } from './game';
import { setOrder, canPlaceAt } from './units';
import { canCast } from './abilities';
import { canAttackTarget } from './combat';
import { learnSkill, useItem, buyItem, nearestShop } from './heroes';
import { exitPoint } from './buildings';

// API de comandos — usada igualmente pela interface do jogador e pela IA.

export type Formation = 'line' | 'block' | 'column' | 'loose';

const RANK: Record<UnitClass, number> = {
  melee: 0, cavalry: 0, summon: 0, creep: 0, hero: 1, ranged: 2, air: 2, caster: 3, siege: 4, worker: 4,
};

function own(g: Game, owner: number, ids: number[]): Entity[] {
  const out: Entity[] = [];
  for (const id of ids) {
    const e = g.ents.get(id);
    if (e && e.alive && e.owner === owner && e.kind === 'unit') out.push(e);
  }
  return out;
}

function refundPending(g: Game, e: Entity) {
  const all = [e.order, ...e.queue];
  for (const o of all) if (o && o.t === 'build' && o.paid && !o.site) g.refund(e.owner, BUILDINGS[o.type].cost);
}

export function order(g: Game, e: Entity, o: Order, queue: boolean) {
  if (!queue) refundPending(g, e);
  if (!queue && e.inside && o.t !== 'gather') {
    // sai da mina assim que terminar a viagem atual
    e.queue = [o];
    return;
  }
  setOrder(e, o, queue);
}

/** Calcula posições em formação, ordenando por função e minimizando cruzamentos. */
export function formationSlots(g: Game, units: Entity[], x: number, y: number, kind: Formation): Map<number, [number, number]> {
  const out = new Map<number, [number, number]>();
  const n = units.length;
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= n; cy /= n;
  let dx = x - cx, dy = y - cy;
  const dl = Math.hypot(dx, dy);
  if (dl < 0.5) { dx = 0; dy = 1; } else { dx /= dl; dy /= dl; }
  const px = -dy, py = dx;
  let maxR = 0;
  for (const u of units) maxR = Math.max(maxR, u.radius);
  const spacing = Math.max(1.0, maxR * 2 + 0.3) * (kind === 'loose' ? 1.5 : 1);
  const cols = kind === 'line' ? Math.max(2, Math.ceil(Math.sqrt(n * 2.6)))
    : kind === 'column' ? Math.max(2, Math.ceil(Math.sqrt(n / 2.6)))
    : Math.max(1, Math.ceil(Math.sqrt(n)));
  const sorted = [...units].sort((a, b) => {
    const ra = RANK[a.udef!.cls] ?? 2, rb = RANK[b.udef!.cls] ?? 2;
    if (ra !== rb) return ra - rb;
    return (a.x * px + a.y * py) - (b.x * px + b.y * py);
  });
  const rows = Math.ceil(n / cols);
  for (let r = 0; r < rows; r++) {
    const row = sorted.slice(r * cols, r * cols + cols).sort((a, b) => (a.x * px + a.y * py) - (b.x * px + b.y * py));
    for (let c = 0; c < row.length; c++) {
      const lat = (c - (row.length - 1) / 2) * spacing;
      const dep = ((rows - 1) / 2 - r) * spacing;
      let sx = x + px * lat + dx * dep, sy = y + py * lat + dy * dep;
      const u = row[c];
      if (!u.air && !g.world.freeAt(sx, sy)) {
        const nf = g.world.nearestFree(sx, sy, 3);
        if (nf) { sx = nf[0] + 0.5; sy = nf[1] + 0.5; } else { sx = x; sy = y; }
      }
      out.set(u.id, [sx, sy]);
    }
  }
  return out;
}

export function issueMove(
  g: Game, owner: number, ids: number[], x: number, y: number,
  opts: { attack?: boolean; queue?: boolean; formation?: Formation; patrol?: boolean; guard?: boolean } = {},
) {
  const units = own(g, owner, ids).filter((u) => u.udef!.speed > 0 || opts.guard);
  if (!units.length) return;
  const queue = !!opts.queue;
  const form = opts.formation ?? 'block';
  const slots = units.length > 1 ? formationSlots(g, units, x, y, form) : new Map([[units[0].id, [x, y] as [number, number]]]);
  let gm: GroupMove | undefined;
  if (units.length > 1) {
    let sp = Infinity;
    if (form !== 'loose') for (const u of units) sp = Math.min(sp, u.udef!.speed);
    gm = { id: g.groupSeq++, gx: x, gy: y, speed: sp, size: units.length, useField: units.length >= 10 };
  }
  for (const u of units) {
    const [sx, sy] = slots.get(u.id)!;
    let o: Order;
    if (opts.patrol) o = { t: 'patrol', x: sx, y: sy, x2: u.x, y2: u.y };
    else if (opts.guard) o = { t: 'guard', x: sx, y: sy, r: 7 };
    else o = opts.attack ? { t: 'amove', x: sx, y: sy, g: gm } : { t: 'move', x: sx, y: sy, g: gm };
    order(g, u, o, queue);
  }
  g.emit(opts.attack ? 'aorder' : 'order', x, y, { owner });
}

export function issueAttack(g: Game, owner: number, ids: number[], targetId: number, queue = false) {
  const t = g.ents.get(targetId);
  if (!t) return;
  for (const u of own(g, owner, ids)) {
    if (canAttackTarget(g, u, t, true)) order(g, u, { t: 'attack', target: targetId }, queue);
    else if (u.udef!.speed > 0) order(g, u, { t: 'move', x: t.cx + (Math.random() - 0.5) * 2, y: t.cy + (Math.random() - 0.5) * 2 }, queue);
  }
  g.emit('aorder', t.cx, t.cy, { owner });
}

export function issueStop(g: Game, owner: number, ids: number[]) {
  for (const u of own(g, owner, ids)) order(g, u, { t: 'stop' }, false);
}
export function issueHold(g: Game, owner: number, ids: number[], queue = false) {
  for (const u of own(g, owner, ids)) order(g, u, { t: 'hold' }, queue);
}
export function issueFollow(g: Game, owner: number, ids: number[], targetId: number, queue = false) {
  for (const u of own(g, owner, ids)) if (u.id !== targetId) order(g, u, { t: 'follow', target: targetId }, queue);
}

export function issueRetreat(g: Game, owner: number, ids: number[]) {
  const units = own(g, owner, ids);
  if (!units.length) return;
  let cx = 0, cy = 0;
  for (const u of units) { cx += u.x; cy += u.y; }
  cx /= units.length; cy /= units.length;
  let best: Entity | null = null, bd = Infinity;
  for (const b of g.buildings) {
    if (b.owner !== owner || !b.alive || b.bdef!.cat !== 'hall') continue;
    const d = Math.hypot(b.cx - cx, b.cy - cy);
    if (d < bd) { bd = d; best = b; }
  }
  if (!best) return;
  const slots = formationSlots(g, units, best.cx, best.ty + best.size + 3, 'block');
  for (const u of units) {
    const [sx, sy] = slots.get(u.id)!;
    order(g, u, { t: 'retreat', x: sx, y: sy }, false);
  }
}

export function issueGather(g: Game, owner: number, ids: number[], target: Entity | null, tile = -1, queue = false) {
  for (const u of own(g, owner, ids)) {
    if (!u.isWorker) continue;
    if (target && target.kind === 'crystal' && target.extractor) continue;
    order(g, u, { t: 'gather', target: target?.id ?? 0, tile: target ? undefined : tile }, queue);
  }
}

export function issueReturn(g: Game, owner: number, ids: number[]) {
  for (const u of own(g, owner, ids)) if (u.isWorker && u.carry) order(g, u, { t: 'return' }, false);
}

export function issueBuild(g: Game, owner: number, workerId: number, type: string, tx: number, ty: number, queue = false): boolean {
  const u = own(g, owner, [workerId])[0];
  const d = BUILDINGS[type];
  if (!u || !d || !u.udef!.builds?.includes(type)) return false;
  if (!g.meetsReq(owner, d.requires)) { g.msg(owner, 'Requisitos não atendidos.', '#ff8a6a'); return false; }
  const ok = canPlaceAt(g, owner, type, tx, ty, u.id);
  if (!ok.ok) { g.msg(owner, `Não é possível construir: ${ok.reason}`, '#ff8a6a'); return false; }
  if (!g.pay(owner, d.cost)) { g.msg(owner, 'Recursos insuficientes.', '#ff8a6a'); return false; }
  order(g, u, { t: 'build', type, tx, ty, paid: true }, queue);
  return true;
}

export function issueRepair(g: Game, owner: number, ids: number[], targetId: number, queue = false) {
  const t = g.ents.get(targetId);
  if (!t) return;
  for (const u of own(g, owner, ids)) if (u.isWorker) order(g, u, { t: 'repair', target: targetId }, queue);
}

export function issueCast(g: Game, owner: number, ids: number[], ab: string, targetId?: number, x?: number, y?: number) {
  const def = ABILITIES[ab];
  const units = own(g, owner, ids).filter((u) => canCast(g, u, ab).ok);
  if (!units.length) return false;
  // usa o lançador mais próximo do alvo
  const tx = x ?? (targetId ? g.ents.get(targetId)?.cx : undefined);
  const ty = y ?? (targetId ? g.ents.get(targetId)?.cy : undefined);
  let caster = units[0];
  if (tx !== undefined && ty !== undefined) {
    let bd = Infinity;
    for (const u of units) { const d = Math.hypot(u.x - tx, u.y - ty); if (d < bd) { bd = d; caster = u; } }
  }
  if (def.target === 'none') order(g, caster, { t: 'cast', ability: ab }, false);
  else order(g, caster, { t: 'cast', ability: ab, target: targetId, x, y }, false);
  return true;
}

export function toggleAutocast(g: Game, owner: number, ids: number[], ab: string) {
  const units = own(g, owner, ids).filter((u) => u.udef!.abilities?.includes(ab));
  const on = !units.every((u) => u.autocast[ab]);
  for (const u of units) u.autocast[ab] = on;
}

/** Comando contextual (clique direito). */
export function issueSmart(g: Game, owner: number, ids: number[], x: number, y: number, target: Entity | null, queue = false, formation: Formation = 'block') {
  const units = own(g, owner, ids);
  if (!units.length) return;
  const workers = units.filter((u) => u.isWorker);
  const others = units.filter((u) => !u.isWorker);
  if (target && target.alive) {
    if (target.kind === 'mine' || target.kind === 'crystal') {
      if (workers.length) issueGather(g, owner, workers.map((u) => u.id), target, -1, queue);
      if (others.length) issueMove(g, owner, others.map((u) => u.id), target.cx, target.cy + target.size, { queue, formation });
      g.emit('order', target.cx, target.cy, { owner });
      return;
    }
    if (target.kind === 'item') {
      const hero = units.find((u) => u.isHero);
      if (hero) { order(g, hero, { t: 'pickup', target: target.id }, queue); return; }
    }
    if (target.kind === 'unit' || target.kind === 'building') {
      if (g.isEnemy(owner, target.owner)) {
        issueAttack(g, owner, units.map((u) => u.id), target.id, queue);
        return;
      }
      if (target.kind === 'building' && g.isAlly(owner, target.owner) && (target.hp < target.maxHp || !target.built) && workers.length) {
        issueRepair(g, owner, workers.map((u) => u.id), target.id, queue);
        if (others.length) issueMove(g, owner, others.map((u) => u.id), target.cx, target.ty + target.size + 1.5, { queue, formation });
        return;
      }
      if (target.kind === 'building' && target.owner === owner && target.built && workers.some((w) => w.carry) && target.bdef!.dropoff) {
        for (const w of workers) if (w.carry) order(g, w, { t: 'return' }, queue);
        return;
      }
      if (target.kind === 'unit' && target.owner === owner && target.udef!.mech && workers.length && target.hp < target.maxHp && g.players[owner].faction === 'durn') {
        issueRepair(g, owner, workers.map((u) => u.id), target.id, queue);
        return;
      }
      if (target.kind === 'unit' && g.isAlly(owner, target.owner)) {
        issueFollow(g, owner, units.map((u) => u.id), target.id, queue);
        return;
      }
    }
  }
  // árvore?
  const tx = Math.floor(x), ty = Math.floor(y);
  if (workers.length && g.world.inside(tx, ty) && g.world.tree[g.world.idx(tx, ty)]) {
    issueGather(g, owner, workers.map((u) => u.id), null, g.world.idx(tx, ty), queue);
    if (others.length) issueMove(g, owner, others.map((u) => u.id), x, y, { queue, formation });
    g.emit('order', x, y, { owner });
    return;
  }
  issueMove(g, owner, units.map((u) => u.id), x, y, { queue, formation });
}

// ---------------------------------------------------------------------------
// Produção
// ---------------------------------------------------------------------------
function ownB(g: Game, owner: number, id: number): Entity | null {
  const b = g.ents.get(id);
  return b && b.alive && b.owner === owner && b.kind === 'building' ? b : null;
}

export function canTrain(g: Game, owner: number, b: Entity, unit: string): { ok: boolean; reason: string } {
  const d = UNITS[unit];
  if (!b.built || b.upgrading) return { ok: false, reason: 'Edifício ocupado' };
  if (!b.bdef!.trains?.includes(unit)) return { ok: false, reason: '' };
  if (!g.meetsReq(owner, d.requires)) return { ok: false, reason: 'Requer: ' + g.missingReqs(owner, d.requires).join(', ') };
  if (d.cls === 'hero') {
    const p = g.players[owner];
    const queued = g.buildings.some((x) => x.owner === owner && x.bqueue.some((q) => UNITS[q.id]?.cls === 'hero' || q.kind === 'revive'));
    if (p.heroCount > 0 || queued || [...g.heroRecords.values()].some((r) => r.owner === owner)) return { ok: false, reason: 'Herói já convocado' };
  }
  if (b.bqueue.length >= 7) return { ok: false, reason: 'Fila cheia' };
  if (g.realm && owner === 0) {
    // no feudo cada recruta sai da população civil da província
    if (d.cls !== 'hero' && g.realm.provinces[g.realm.houses[g.realm.player].province].pop < 1) return { ok: false, reason: 'Sem civis livres: construa casas e espere a população crescer' };
    if (d.cls === 'hero' && g.realm.armies.some((a) => a.owner === g.realm!.player && a.units.some((u) => u.hero))) return { ok: false, reason: 'Herói já convocado' };
  }
  if (!g.canAfford(owner, d.cost)) return { ok: false, reason: 'Recursos insuficientes' };
  return { ok: true, reason: '' };
}

export function train(g: Game, owner: number, bId: number, unit: string): boolean {
  const b = ownB(g, owner, bId);
  if (!b) return false;
  const c = canTrain(g, owner, b, unit);
  if (!c.ok) { if (c.reason) g.msg(owner, c.reason, '#ff8a6a'); return false; }
  const d = UNITS[unit];
  g.pay(owner, d.cost);
  const mul = FACTIONS[g.players[owner].faction].trainMul;
  b.bqueue.push({ kind: 'unit', id: unit, t: 0, total: d.time * mul, cost: d.cost });
  if (g.realm && owner === 0 && d.cls !== 'hero') g.realm.provinces[g.realm.houses[g.realm.player].province].pop -= 1;
  return true;
}

export function researchQueued(g: Game, owner: number, rid: string): boolean {
  return g.buildings.some((b) => b.owner === owner && b.alive && b.bqueue.some((q) => q.kind === 'research' && q.id === rid));
}

export function canResearch(g: Game, owner: number, b: Entity, rid: string): { ok: boolean; reason: string } {
  const r = RESEARCHES[rid];
  const p = g.players[owner];
  if (!b.built || b.upgrading) return { ok: false, reason: 'Edifício ocupado' };
  if (p.upgrades[rid]) return { ok: false, reason: 'Já pesquisado' };
  if (researchQueued(g, owner, rid)) return { ok: false, reason: 'Em pesquisa' };
  if (!g.meetsReq(owner, r.requires)) return { ok: false, reason: 'Requer: ' + g.missingReqs(owner, r.requires).map((x) => RESEARCHES[x]?.name ?? x).join(', ') };
  if (b.bqueue.length >= 7) return { ok: false, reason: 'Fila cheia' };
  if (!g.canAfford(owner, r.cost)) return { ok: false, reason: 'Recursos insuficientes' };
  return { ok: true, reason: '' };
}

export function research(g: Game, owner: number, bId: number, rid: string): boolean {
  const b = ownB(g, owner, bId);
  if (!b) return false;
  const c = canResearch(g, owner, b, rid);
  if (!c.ok) { g.msg(owner, c.reason, '#ff8a6a'); return false; }
  const r = RESEARCHES[rid];
  g.pay(owner, r.cost);
  b.bqueue.push({ kind: 'research', id: rid, t: 0, total: r.time, cost: r.cost });
  return true;
}

export function canUpgrade(g: Game, owner: number, b: Entity): { ok: boolean; reason: string } {
  const to = b.bdef!.upgradesTo;
  if (!to) return { ok: false, reason: '' };
  if (!b.built || b.upgrading) return { ok: false, reason: 'Em evolução' };
  if (b.bqueue.length) return { ok: false, reason: 'Fila de produção ocupada' };
  const nd = BUILDINGS[to];
  if (nd.tier === 3 && !g.buildings.some((x) => x.owner === owner && x.alive && x.built && x.bdef!.cat !== 'hall' && x.bdef!.cat !== 'house' && x.bdef!.requires?.includes('tier2')))
    return { ok: false, reason: 'Requer um edifício de nível 2' };
  if (!g.canAfford(owner, nd.cost)) return { ok: false, reason: 'Recursos insuficientes' };
  return { ok: true, reason: '' };
}

export function upgrade(g: Game, owner: number, bId: number): boolean {
  const b = ownB(g, owner, bId);
  if (!b) return false;
  const c = canUpgrade(g, owner, b);
  if (!c.ok) { if (c.reason) g.msg(owner, c.reason, '#ff8a6a'); return false; }
  const nd = BUILDINGS[b.bdef!.upgradesTo!];
  g.pay(owner, nd.cost);
  b.upgrading = true;
  b.bqueue.push({ kind: 'upgrade', id: nd.id, t: 0, total: nd.time, cost: nd.cost });
  return true;
}

export function reviveCost(level: number, type: string) {
  const c = UNITS[type].cost;
  const f = 0.4 + level * 0.08;
  return { silver: Math.round((c.silver ?? 0) * f), wood: Math.round((c.wood ?? 0) * f) };
}

export function revive(g: Game, owner: number, bId: number, heroId: number): boolean {
  const b = ownB(g, owner, bId);
  const rec = g.heroRecords.get(heroId);
  if (!b || !rec || rec.owner !== owner || !b.bdef!.heroRevive || !b.built || b.upgrading) return false;
  if (b.bqueue.some((q) => q.kind === 'revive' && q.heroId === heroId)) return false;
  if (g.buildings.some((x) => x.owner === owner && x.bqueue.some((q) => q.kind === 'revive' && q.heroId === heroId))) return false;
  const cost = reviveCost(rec.level, rec.type);
  if (!g.pay(owner, cost)) { g.msg(owner, 'Recursos insuficientes.', '#ff8a6a'); return false; }
  b.bqueue.push({ kind: 'revive', id: rec.type, t: 0, total: 25 + rec.level * 4, cost, heroId });
  return true;
}

export function cancelQueue(g: Game, owner: number, bId: number, index: number) {
  const b = ownB(g, owner, bId);
  if (!b || index < 0 || index >= b.bqueue.length) return;
  const q = b.bqueue.splice(index, 1)[0];
  g.refund(owner, q.cost);
  if (g.realm && owner === 0 && q.kind === 'unit' && UNITS[q.id]?.cls !== 'hero') g.realm.provinces[g.realm.houses[g.realm.player].province].pop += 1;
  if (q.kind === 'upgrade') b.upgrading = false;
  g.recomputeSupply();
}

export function cancelConstruction(g: Game, owner: number, bId: number) {
  const b = ownB(g, owner, bId);
  if (!b || b.built) return;
  g.refund(owner, b.bdef!.cost, 0.75);
  b.alive = false;
  b.dying = 0.01;
  g.world.setBuilding(b.tx, b.ty, b.size, b.id, false);
  for (const r of g.resources) if (r.extractor === b.id) r.extractor = 0;
  for (const u of g.units) if (u.order?.t === 'build' && u.order.site === b.id) setOrder(u, { t: 'stop' }, false);
  g.emit('smoke', b.cx, b.cy, { a: b.size });
}

export function setRally(g: Game, owner: number, bIds: number[], x: number, y: number, targetId = 0) {
  for (const id of bIds) {
    const b = ownB(g, owner, id);
    if (b) b.rally = { x, y, target: targetId || undefined };
  }
}

export function learn(g: Game, owner: number, heroId: number, ab: string) {
  const h = g.ents.get(heroId);
  if (h && h.owner === owner && h.alive) learnSkill(g, h, ab);
}

export function useHeroItem(g: Game, owner: number, heroId: number, slot: number) {
  const h = g.ents.get(heroId);
  if (h && h.owner === owner) useItem(g, h, slot);
}

export function buyHeroItem(g: Game, owner: number, heroId: number, item: string) {
  const h = g.ents.get(heroId);
  if (h && h.owner === owner && h.alive) buyItem(g, h, item);
}

export function hire(g: Game, owner: number, campId: number, unit: string): boolean {
  const camp = g.ents.get(campId);
  if (!camp || !camp.bdef?.hires?.includes(unit)) return false;
  const near = g.units.some((u) => u.owner === owner && u.alive && g.edgeDist(u.x, u.y, camp) < 7);
  if (!near) { g.msg(owner, 'Leve uma unidade até o acampamento para contratar.', '#ff8a6a'); return false; }
  const d = UNITS[unit];
  if (g.supplyFree(owner) < d.supply) { g.msg(owner, 'Abastecimento insuficiente.', '#ff8a6a'); return false; }
  if (!g.pay(owner, d.cost)) { g.msg(owner, 'Prata insuficiente.', '#ff8a6a'); return false; }
  const [x, y] = exitPoint(g, camp, camp.cx, camp.ty + camp.size + 2);
  const u = g.spawnUnit(unit, owner, x, y);
  g.emit('summon', u.x, u.y);
  g.recomputeSupply();
  return true;
}

export { nearestShop };

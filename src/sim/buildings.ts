import { BUILDINGS, FACTIONS, RESEARCHES, UNITS } from '../data/factions';
import { Entity } from './entity';
import type { Game } from './game';
import { buildingAttack } from './combat';
import { setOrder, depleteResource } from './units';
import { autoLearn } from './heroes';
import { swearHero } from '../realm/dynasty';

export function updateBuilding(g: Game, b: Entity, dt: number) {
  const d = b.bdef!;
  const p = g.players[b.owner];
  if (!b.built) {
    const grow = !p || FACTIONS[p.faction].builderMode === 'grow';
    let rate = 0;
    if (grow) rate = 1;
    else if (b.builders > 0) rate = p.faction === 'valmir' || p.faction === 'salinos' ? 1 + 0.6 * (b.builders - 1) : 1;
    b.buildersLast = b.builders;
    b.builders = 0;
    if (rate > 0) {
      const dp = (dt / d.time) * rate;
      b.progress = Math.min(1, b.progress + dp);
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * dp);
    }
    if (b.progress >= 1) {
      b.built = true;
      g.recomputeSupply();
      if (p) {
        p.stats.buildingsBuilt++;
        g.alert(b.owner, b.cx, b.cy, `${d.name} concluído(a).`, 'build');
      }
      g.emit('build', b.cx, b.cy, { a: b.size });
    }
    return;
  }
  if (d.regen && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + d.regen * dt);
  if (d.attack) buildingAttack(g, b, dt);
  if (!p) return;
  if (d.aetherPerMin) p.aetherAcc += (d.aetherPerMin / 60) * dt * (g.isNight() ? 2 : 1);
  if (d.cat === 'extractor') {
    const c = g.resources.find((r) => r.extractor === b.id && r.alive);
    if (c) {
      const amt = 0.6 * dt;
      c.amount -= amt;
      c.hp = c.amount;
      p.aetherAcc += amt;
      if (c.amount <= 0) depleteResource(g, c);
    }
  }
  processQueue(g, b, dt);
}

function processQueue(g: Game, b: Entity, dt: number) {
  if (!b.bqueue.length) return;
  const p = g.players[b.owner];
  const slots = b.bdef!.parallel ?? 1;
  const mul = p.debt > 0 ? 0.6 : 1;
  const done: number[] = [];
  for (let k = 0; k < Math.min(slots, b.bqueue.length); k++) {
    const q = b.bqueue[k];
    if (q.t === 0 && q.kind === 'unit') {
      const sup = UNITS[q.id].supply;
      if (sup > 0 && g.supplyFree(b.owner) < sup) continue; // bloqueado por abastecimento
      p.supplyUsed += sup;
    }
    q.t += dt * mul;
    if (q.t >= q.total) done.push(k);
  }
  for (let i = done.length - 1; i >= 0; i--) {
    const q = b.bqueue.splice(done[i], 1)[0];
    completeItem(g, b, q);
  }
}

function completeItem(g: Game, b: Entity, q: Entity['bqueue'][number]) {
  const p = g.players[b.owner];
  if (q.kind === 'unit' || q.kind === 'revive') {
    const [x, y] = exitPoint(g, b, b.rally?.x ?? b.cx, b.rally?.y ?? b.ty + b.size + 2);
    let u: Entity;
    if (q.kind === 'revive' && q.heroId) {
      const rec = g.heroRecords.get(q.heroId);
      u = g.spawnUnit(rec?.type ?? q.id, b.owner, x, y);
      if (rec) {
        u.level = rec.level; u.xp = rec.xp; u.skills = { ...rec.skills }; u.items = [...rec.items]; u.skillPts = rec.skillPts;
        g.heroRecords.delete(q.heroId);
        const realm = g.realm;
        if (realm && b.owner === 0) u.personId = Object.values(realm.persons).find((x) => x.alive && x.house === realm.player && x.heroType === u.type)?.id ?? 0;
        g.refreshUnit(u);
        u.hp = u.maxHp; u.mana = u.maxMana;
      }
      g.alert(b.owner, x, y, `${u.udef!.name} retornou!`, 'hero');
    } else {
      u = g.spawnUnit(q.id, b.owner, x, y);
      p.stats.trained++;
      if (u.isHero) {
        if (p.ai) autoLearn(u);
        if (g.realm && b.owner === 0) {
          const person = swearHero(g.realm, u.type, u.udef!.hero?.title ?? 'herói');
          u.personId = person.id;
          g.alert(b.owner, x, y, `${person.name}, ${u.udef!.name}, jurou lealdade à sua casa!`, 'hero');
        } else g.alert(b.owner, x, y, `${u.udef!.name} juntou-se ao seu reino!`, 'hero');
      }
    }
    g.emit('summon', u.x, u.y);
    if (b.rally) {
      const t = b.rally.target ? g.ents.get(b.rally.target) : undefined;
      if (u.isWorker && t && (t.kind === 'mine' || t.kind === 'crystal')) setOrder(u, { t: 'gather', target: t.id }, false);
      else if (u.isWorker && g.world.inside(Math.floor(b.rally.x), Math.floor(b.rally.y)) && g.world.tree[g.world.idx(Math.floor(b.rally.x), Math.floor(b.rally.y))])
        setOrder(u, { t: 'gather', target: 0, tile: g.world.idx(Math.floor(b.rally.x), Math.floor(b.rally.y)) }, false);
      else setOrder(u, { t: 'move', x: b.rally.x + (g.rng.next() - 0.5) * 1.5, y: b.rally.y + (g.rng.next() - 0.5) * 1.5 }, false);
    }
    g.recomputeSupply();
  } else if (q.kind === 'research') {
    p.upgrades[q.id] = 1;
    g.refreshStats(b.owner);
    g.alert(b.owner, b.cx, b.cy, `Pesquisa concluída: ${RESEARCHES[q.id].name}.`, 'research');
  } else if (q.kind === 'upgrade') {
    const nd = BUILDINGS[q.id];
    const ratio = b.hp / b.maxHp;
    b.type = q.id;
    b.bdef = nd;
    b.upgrading = false;
    g.refreshStats(b.owner);
    b.maxHp = nd.hp;
    g.refreshStats(b.owner);
    b.hp = b.maxHp * ratio;
    g.recomputeSupply();
    g.alert(b.owner, b.cx, b.cy, `${nd.name} concluído(a)! Novas tecnologias disponíveis.`, 'build');
    g.emit('levelup', b.cx, b.cy);
  }
}

/** Ponto livre no perímetro do edifício mais próximo do destino. */
export function exitPoint(g: Game, b: Entity, tx: number, ty: number): [number, number] {
  let best: [number, number] | null = null, bd = Infinity;
  for (let r = 1; r <= 4 && !best; r++) {
    for (let y = b.ty - r; y < b.ty + b.size + r; y++)
      for (let x = b.tx - r; x < b.tx + b.size + r; x++) {
        if (x > b.tx - r && x < b.tx + b.size + r - 1 && y > b.ty - r && y < b.ty + b.size + r - 1) continue;
        if (!g.world.free(x, y)) continue;
        const d = (x + 0.5 - tx) ** 2 + (y + 0.5 - ty) ** 2;
        if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
      }
  }
  return best ?? [b.cx, b.ty + b.size + 0.5];
}

import { BUILDINGS, FACTIONS } from '../data/factions';
import type { ResKey } from '../data/types';
import { Entity, NEUTRAL_HOSTILE, type Order } from './entity';
import type { Game } from './game';
import { acquireTarget, fight, canAttackTarget, performSwing } from './combat';
import { getAtkMul, getRegen, getSpeed, isStunned, modsFor, isRooted } from './stats';
import { tickBuffs, tryAutocast, castUpdate } from './abilities';
import { pickupItem } from './heroes';

const tmp: Entity[] = [];

// ============================================================================
// Atualização por unidade
// ============================================================================
export function updateUnit(g: Game, e: Entity, dt: number) {
  const d = e.udef!;
  if (e.timedLife > 0) {
    e.timedLife -= dt;
    if (e.timedLife <= 0) { g.kill(e, null); return; }
  }
  tickBuffs(g, e, dt);
  if (!e.alive) return;

  // regeneração
  if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + getRegen(g, e) * dt);
  if (e.maxMana > 0 && e.mana < e.maxMana) e.mana = Math.min(e.maxMana, e.mana + (d.manaRegen ?? 0.6) * dt);
  if (e.atkCd > 0) e.atkCd -= dt;
  for (const k in e.cds) if (e.cds[k] > 0) e.cds[k] -= dt;
  e.animT += dt;

  if (e.inside) { gatherUpdate(g, e, dt); return; }

  if (isStunned(e)) { e.vx = e.vy = 0; e.swingT = -1; e.anim = 'idle'; return; }

  // golpe em andamento
  if (e.swingT >= 0) {
    e.swingT -= dt;
    e.vx = e.vy = 0;
    if (e.swingT < 0) performSwing(g, e);
    else { applyPush(g, e, dt); return; }
  }

  if ((g.tick + e.id) % 10 === 0) tryAutocast(g, e);

  if (!e.order && e.queue.length) nextOrder(e);
  // a pose de trabalho só vale enquanto a ordem a renova a cada passo (obra pronta = para de martelar)
  if (e.anim === 'work') e.anim = 'idle';
  const o = e.order;
  let desired = false;
  if (!o) desired = idleBehavior(g, e);
  else {
    switch (o.t) {
      case 'move': case 'retreat': desired = moveOrder(g, e, o); break;
      case 'amove': desired = amoveOrder(g, e, o); break;
      case 'attack': {
        const t = g.ents.get(o.target);
        if (!t || !t.alive || !canAttackTarget(g, e, t, true)) { e.targetId = 0; nextOrder(e); break; }
        e.targetId = t.id;
        desired = fight(g, e, t, true, true);
        break;
      }
      case 'hold': {
        e.vx = e.vy = 0;
        holdBehavior(g, e);
        break;
      }
      case 'stop': e.targetId = 0; e.path = null; nextOrder(e); e.idleX = e.x; e.idleY = e.y; break;
      case 'patrol': desired = patrolOrder(g, e, o); break;
      case 'guard': desired = guardOrder(g, e, o); break;
      case 'follow': {
        const t = g.ents.get(o.target);
        if (!t || !t.alive) { nextOrder(e); break; }
        if (Math.hypot(t.x - e.x, t.y - e.y) > 2.2 + t.radius) desired = seek(g, e, t.x, t.y, 1.5, null) === false;
        else { e.vx = e.vy = 0; }
        break;
      }
      case 'gather': case 'return': desired = gatherUpdate(g, e, dt); break;
      case 'build': desired = buildUpdate(g, e, o); break;
      case 'repair': desired = repairUpdate(g, e, o, dt); break;
      case 'cast': desired = castUpdate(g, e, o); break;
      case 'pickup': {
        const it = g.ents.get(o.target);
        if (!it || !it.alive || !e.isHero) { nextOrder(e); break; }
        if (Math.hypot(it.x - e.x, it.y - e.y) < 0.9) { pickupItem(g, e, it); nextOrder(e); }
        else desired = !seek(g, e, it.x, it.y, 0.5, null);
        break;
      }
      default: nextOrder(e);
    }
  }
  if (!desired) { e.vx *= 0.5; e.vy *= 0.5; if (Math.abs(e.vx) < 0.02) e.vx = 0; if (Math.abs(e.vy) < 0.02) e.vy = 0; }
  integrate(g, e, dt);
}

export function nextOrder(e: Entity) {
  e.order = e.queue.shift() ?? null;
  e.sub = 0;
  e.subT = 0;
  e.path = null;
  e.hasSlot = false;
  e.passive = e.order?.t === 'retreat' || e.order?.t === 'move';
  e.stuckT = 0;
  e.bestDist = Infinity;
  if (!e.order) {
    e.idleX = e.x; e.idleY = e.y;
    e.targetId = 0;
    e.passive = false;
  }
}

export function setOrder(e: Entity, o: Order, queue: boolean) {
  if (queue && (e.order || e.queue.length)) { e.queue.push(o); return; }
  e.queue = [];
  if (e.inside && o.t !== 'gather') { /* sai da mina ao terminar */ }
  e.queue.push(o);
  e.order = null;
  e.targetId = 0;
  e.explicitTarget = false;
  nextOrder(e);
}

// ============================================================================
// Movimento
// ============================================================================

/**
 * Persegue um ponto ou retângulo-objetivo. Retorna true quando chegou.
 * Usa linha direta quando possível; caso contrário A* com cache.
 */
export function seek(
  g: Game, e: Entity, gx: number, gy: number, arrive: number,
  rect: [number, number, number, number] | null, speedCap = Infinity,
): boolean {
  const dist = Math.hypot(gx - e.x, gy - e.y);
  if (rect) {
    const inX = e.x >= rect[0] - 0.05 && e.x <= rect[2] + 1.05, inY = e.y >= rect[1] - 0.05 && e.y <= rect[3] + 1.05;
    if (inX && inY) { e.vx = e.vy = 0; return true; }
  } else if (dist <= arrive) { e.vx = e.vy = 0; return true; }

  let tx = gx, ty = gy;
  if (!e.air) {
    const direct = dist < 14 && g.world.lineFree(e.x, e.y, gx, gy, Math.min(0.4, e.radius * 0.8)) && (!rect || dist < 6);
    if (!direct) {
      const key = rect ? rect.join(',') : `${Math.floor(gx)},${Math.floor(gy)}`;
      if (!e.path || e.pathKey !== key || e.repathT <= 0) {
        e.path = rect
          ? g.path.find(e.x, e.y, rect[0], rect[1], rect[2], rect[3])
          : g.path.find(e.x, e.y, Math.floor(gx), Math.floor(gy), Math.floor(gx), Math.floor(gy));
        e.pathI = 0;
        e.pathKey = key;
        e.repathT = 4 + (e.id % 10) * 0.1;
      }
      e.repathT -= g.dt;
      while (e.path && e.pathI < e.path.length) {
        const p = e.path[e.pathI];
        if (Math.hypot(p.x - e.x, p.y - e.y) < 0.5) e.pathI++;
        else break;
      }
      if (e.path && e.pathI < e.path.length) {
        // atalho: se o próximo ponto já é visível pule
        if (e.pathI + 1 < e.path.length) {
          const n = e.path[e.pathI + 1];
          if ((g.tick + e.id) % 6 === 0 && g.world.lineFree(e.x, e.y, n.x, n.y, 0.3)) e.pathI++;
        }
        tx = e.path[e.pathI].x;
        ty = e.path[e.pathI].y;
      } else if (rect) {
        // caminho terminou (objetivo inalcançável ou já adjacente)
        e.vx = e.vy = 0;
        return trackStuck(g, e, dist, true);
      }
    }
  }
  steerTo(g, e, tx, ty, speedCap);
  return trackStuck(g, e, dist, false);
}

function trackStuck(g: Game, e: Entity, dist: number, ended: boolean): boolean {
  if (dist < e.bestDist - 0.25) { e.bestDist = dist; e.stuckT = 0; return false; }
  e.stuckT += g.dt;
  if (e.stuckT > 1.2 && e.path) { e.repathT = 0; }
  if (e.stuckT > 2.5) {
    // aceitável: perto o bastante em meio a multidão
    if (dist < 2.5 || ended) { e.stuckT = 0; e.bestDist = Infinity; return true; }
    if (e.stuckT > 6) { e.stuckT = 0; e.bestDist = Infinity; return true; }
  }
  return false;
}

export function steerTo(g: Game, e: Entity, tx: number, ty: number, speedCap = Infinity) {
  const dx = tx - e.x, dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const sp = Math.min(getSpeed(g, e), speedCap);
  e.vx = (dx / d) * sp;
  e.vy = (dy / d) * sp;
}

function fits(g: Game, x: number, y: number, r: number): boolean {
  const w = g.world;
  const rr = Math.min(r, 0.42) * 0.75;
  return w.freeAt(x, y) && w.freeAt(x - rr, y - rr) && w.freeAt(x + rr, y - rr) && w.freeAt(x - rr, y + rr) && w.freeAt(x + rr, y + rr);
}

function applyPush(g: Game, e: Entity, dt: number) {
  if (e.pushX || e.pushY) {
    const nx = e.x + e.pushX, ny = e.y + e.pushY;
    if (e.air || fits(g, nx, ny, e.radius)) { e.x = nx; e.y = ny; }
    e.pushX = e.pushY = 0;
  }
}

function integrate(g: Game, e: Entity, dt: number) {
  let sx = 0, sy = 0;
  const moving = e.vx !== 0 || e.vy !== 0;
  // separação local (evita aglomeração artificial)
  if (e.udef!.speed > 0 || e.pushX || e.pushY) {
    g.spatial.queryRadius(e.x, e.y, e.radius + 1.0, tmp);
    for (let i = 0; i < tmp.length; i++) {
      const n = tmp[i];
      if (n === e || n.air !== e.air) continue;
      let dx = e.x - n.x, dy = e.y - n.y;
      let dd = dx * dx + dy * dy;
      const minD = (e.radius + n.radius) * (e.air ? 1.1 : 0.92);
      if (dd >= minD * minD) continue;
      let d = Math.sqrt(dd);
      if (d < 1e-4) { dx = ((e.id * 7919) % 13) / 13 - 0.5; dy = ((e.id * 104729) % 11) / 11 - 0.5; d = Math.hypot(dx, dy); }
      const ov = (minD - d) / minD;
      const nStill = n.vx === 0 && n.vy === 0;
      if (moving && nStill && n.owner === e.owner && !n.order?.t.startsWith('hold') && n.swingT < 0 && !n.inside) {
        // abre caminho: empurra o vizinho parado
        n.pushX -= (dx / d) * ov * 0.12;
        n.pushY -= (dy / d) * ov * 0.12;
        sx += (dx / d) * ov * 0.25;
        sy += (dy / d) * ov * 0.25;
      } else {
        sx += (dx / d) * ov * 0.6;
        sy += (dy / d) * ov * 0.6;
      }
    }
  }
  let mx = e.vx * dt + sx * 0.12 + e.pushX;
  let my = e.vy * dt + sy * 0.12 + e.pushY;
  e.pushX = e.pushY = 0;
  if (e.udef!.speed === 0) { mx = 0; my = 0; }
  const step = Math.hypot(mx, my);
  const maxStep = 0.45;
  if (step > maxStep) { mx = (mx / step) * maxStep; my = (my / step) * maxStep; }
  if (mx || my) {
    if (e.air) {
      e.x = Math.max(0.5, Math.min(g.world.w - 0.5, e.x + mx));
      e.y = Math.max(0.5, Math.min(g.world.h - 0.5, e.y + my));
    } else {
      const nx = e.x + mx, ny = e.y + my;
      if (fits(g, nx, ny, e.radius)) { e.x = nx; e.y = ny; }
      else if (fits(g, nx, e.y, e.radius)) e.x = nx;
      else if (fits(g, e.x, ny, e.radius)) e.y = ny;
      else if (!g.world.freeAt(e.x, e.y)) {
        const nf = g.world.nearestFree(e.x, e.y, 4);
        if (nf) { e.x = nf[0] + 0.5; e.y = nf[1] + 0.5; }
      }
    }
  }
  if (Math.abs(e.vx) > 0.05) e.facing = e.vx > 0 ? 1 : -1;
  if (moving) e.faceUp = e.vy < -Math.abs(e.vx) * 0.7;
  const spd = Math.hypot(e.vx, e.vy);
  if (e.swingT < 0 && e.anim !== 'work' && e.anim !== 'cast') e.anim = spd > 0.15 ? 'walk' : 'idle';
  else if (e.anim === 'work' && spd > 0.15) e.anim = 'walk';
  if (e.anim === 'attack' && e.animT > 0.6 && e.swingT < 0) e.anim = spd > 0.15 ? 'walk' : 'idle';
  if (e.anim === 'cast' && e.animT > 0.6) e.anim = 'idle';
}

// ============================================================================
// Ordens militares
// ============================================================================
function slotOf(e: Entity, o: { x: number; y: number }): [number, number] {
  return [o.x, o.y];
}

function moveOrder(g: Game, e: Entity, o: Extract<Order, { t: 'move' | 'retreat' }>): boolean {
  const [sx, sy] = slotOf(e, o);
  const gm = o.t === 'move' ? o.g : undefined;
  let arrived = false;
  let cap = Infinity;
  if (gm) {
    // velocidade de grupo com reagrupamento: quem está atrás corre, quem está à frente espera
    const dist = Math.hypot(sx - e.x, sy - e.y);
    cap = gm.speed;
    const anyG = gm as any;
    if (anyG.tick !== g.tick) { anyG.avg = anyG.n ? anyG.sum / anyG.n : dist; anyG.sum = 0; anyG.n = 0; anyG.tick = g.tick; }
    anyG.sum += dist; anyG.n++;
    if (dist > anyG.avg + 3) cap = Infinity;
    else if (dist < anyG.avg - 3) cap = gm.speed * 0.7;
    if (gm.useField && dist > 7) {
      const f = g.path.getField(gm.gx, gm.gy, g.time);
      const ft = f ? g.path.flowTarget(f, e.x, e.y) : null;
      if (ft) { steerTo(g, e, ft.x, ft.y, cap); trackStuck(g, e, dist, false); return true; }
    }
  }
  arrived = seek(g, e, sx, sy, 0.3, null, cap);
  if (arrived) { nextOrder(e); return false; }
  return true;
}

function amoveOrder(g: Game, e: Entity, o: Extract<Order, { t: 'amove' }>): boolean {
  if (e.udef!.attack) {
    let t = e.targetId ? g.ents.get(e.targetId) : undefined;
    if (t && (!t.alive || !canAttackTarget(g, e, t, false) || Math.hypot(t.cx - e.x, t.cy - e.y) > 16)) { t = undefined; e.targetId = 0; }
    if (!t && (g.tick + e.id) % 6 === 0) {
      const nt = acquireTarget(g, e, Math.max(e.udef!.sight * 0.85, 6));
      if (nt) { e.targetId = nt.id; t = nt; e.engageX = e.x; e.engageY = e.y; }
    }
    if (t) return fight(g, e, t, true, false);
  }
  const gm = o.g;
  if (gm && gm.useField && Math.hypot(o.x - e.x, o.y - e.y) > 7) {
    const f = g.path.getField(gm.gx, gm.gy, g.time);
    const ft = f ? g.path.flowTarget(f, e.x, e.y) : null;
    if (ft) { steerTo(g, e, ft.x, ft.y, gm.speed); return true; }
  }
  if (seek(g, e, o.x, o.y, 0.3, null, gm?.speed ?? Infinity)) { nextOrder(e); return false; }
  return true;
}

function patrolOrder(g: Game, e: Entity, o: Extract<Order, { t: 'patrol' }>): boolean {
  const fake = { t: 'amove' as const, x: o.back ? o.x2 : o.x, y: o.back ? o.y2 : o.y };
  if (e.udef!.attack) {
    let t = e.targetId ? g.ents.get(e.targetId) : undefined;
    if (t && (!t.alive || !canAttackTarget(g, e, t, false))) { t = undefined; e.targetId = 0; }
    if (!t && (g.tick + e.id) % 6 === 0) {
      const nt = acquireTarget(g, e, e.udef!.sight * 0.85);
      if (nt) { e.targetId = nt.id; t = nt; }
    }
    if (t) return fight(g, e, t, true, false);
  }
  if (seek(g, e, fake.x, fake.y, 0.5, null)) { o.back = !o.back; e.path = null; e.bestDist = Infinity; }
  return true;
}

function guardOrder(g: Game, e: Entity, o: Extract<Order, { t: 'guard' }>): boolean {
  let t = e.targetId ? g.ents.get(e.targetId) : undefined;
  if (t && (!t.alive || Math.hypot(t.cx - o.x, t.cy - o.y) > o.r + 5)) { t = undefined; e.targetId = 0; }
  if (!t && (g.tick + e.id) % 6 === 0 && e.udef!.attack) {
    const nt = acquireTarget(g, e, e.udef!.sight);
    if (nt && Math.hypot(nt.cx - o.x, nt.cy - o.y) < o.r + 3) { e.targetId = nt.id; t = nt; }
  }
  if (t) return fight(g, e, t, true, false);
  if (Math.hypot(o.x - e.x, o.y - e.y) > 1.5) return !seek(g, e, o.x, o.y, 1.2, null);
  return false;
}

function holdBehavior(g: Game, e: Entity) {
  if (!e.udef!.attack) return;
  let t = e.targetId ? g.ents.get(e.targetId) : undefined;
  if (t && (!t.alive || g.edgeDist(e.x, e.y, t) > (e.udef!.attack.range + e.radius + 0.4))) { t = undefined; e.targetId = 0; }
  if (!t && (g.tick + e.id) % 5 === 0) {
    const nt = acquireTarget(g, e, e.udef!.attack.range + 1);
    if (nt && g.edgeDist(e.x, e.y, nt) <= e.udef!.attack.range + e.radius + 0.3) { e.targetId = nt.id; t = nt; }
  }
  if (t) fight(g, e, t, false, false);
}

function idleBehavior(g: Game, e: Entity): boolean {
  if (e.owner === NEUTRAL_HOSTILE) return creepIdle(g, e);
  const d = e.udef!;
  if (!d.attack || d.cls === 'worker' || e.passive) {
    if (d.cls === 'worker' && e.targetId) {
      const t = g.ents.get(e.targetId);
      if (t && t.alive && Math.hypot(t.cx - e.idleX, t.cy - e.idleY) < 6) return fight(g, e, t, true, false);
      e.targetId = 0;
    }
    return false;
  }
  let t = e.targetId ? g.ents.get(e.targetId) : undefined;
  if (t && (!t.alive || !canAttackTarget(g, e, t, false))) { t = undefined; e.targetId = 0; }
  // perseguição controlada: volta à posição após se afastar demais
  if (t && Math.hypot(e.x - e.idleX, e.y - e.idleY) > 10) {
    e.targetId = 0;
    t = undefined;
    e.order = { t: 'move', x: e.idleX, y: e.idleY };
    e.passive = true;
    return true;
  }
  if (!t && (g.tick + e.id) % 8 === 0) {
    const nt = acquireTarget(g, e, Math.max(d.sight * 0.75, (d.attack.range ?? 0) + 1));
    if (nt) { e.targetId = nt.id; t = nt; }
  }
  if (t) return fight(g, e, t, true, false);
  return false;
}

function creepIdle(g: Game, e: Entity): boolean {
  const leash = 9;
  const dHome = Math.hypot(e.x - e.campX, e.y - e.campY);
  if (e.returning) {
    e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.08 * g.dt);
    if (seek(g, e, e.campX, e.campY, 0.8, null)) e.returning = false;
    return true;
  }
  let t = e.targetId ? g.ents.get(e.targetId) : undefined;
  if (t && (!t.alive || dHome > leash || Math.hypot(t.cx - e.campX, t.cy - e.campY) > leash + 3)) {
    t = undefined; e.targetId = 0; e.returning = true; e.path = null;
    return true;
  }
  if (!t && (g.tick + e.id) % 8 === 0) {
    // criaturas dormem à noite: percepção menor
    const r = g.isNight() ? 2.5 : 4.5;
    const nt = acquireTarget(g, e, r);
    if (nt) {
      e.targetId = nt.id; t = nt;
      // acampamento inteiro reage
      const c = g.camps[e.campId];
      if (c) for (const id of c.units) { const m = g.ents.get(id); if (m && m.alive && !m.targetId) m.targetId = nt.id; }
    }
  }
  if (t) return fight(g, e, t, true, false);
  if (dHome > 1.2) return !seek(g, e, e.campX, e.campY, 1.0, null);
  if (e.hp < e.maxHp) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.01 * g.dt);
  return false;
}

// ============================================================================
// Economia: coleta
// ============================================================================
function resRect(r: Entity): [number, number, number, number] {
  return [r.tx - 1, r.ty - 1, r.tx + r.size, r.ty + r.size];
}

export function carryCap(g: Game, e: Entity, res: ResKey): number {
  const gd = e.udef!.gather!;
  const m = modsFor(g, e.owner, e.type, 'worker');
  return gd.carry[res] + (res === 'aether' ? 0 : m.carry);
}

function findNearestTree(g: Game, x: number, y: number, r: number): number {
  const w = g.world;
  let best = -1, bd = Infinity;
  const cx = Math.floor(x), cy = Math.floor(y);
  for (let yy = cy - r; yy <= cy + r; yy++)
    for (let xx = cx - r; xx <= cx + r; xx++) {
      if (!w.inside(xx, yy)) continue;
      const i = w.idx(xx, yy);
      if (!w.tree[i]) continue;
      // precisa de um vizinho livre
      if (!(w.free(xx + 1, yy) || w.free(xx - 1, yy) || w.free(xx, yy + 1) || w.free(xx, yy - 1))) continue;
      const d = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
  return best;
}

export function findNearestResource(g: Game, kind: 'mine' | 'crystal', x: number, y: number, maxD = 40): Entity | null {
  let best: Entity | null = null, bd = maxD;
  for (const r of g.resources) {
    if (!r.alive || r.kind !== kind || r.amount <= 0 || r.extractor) continue;
    const d = Math.hypot(r.cx - x, r.cy - y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

function gatherUpdate(g: Game, e: Entity, dt: number): boolean {
  const o = e.order;
  const gd = e.udef!.gather;
  if (!gd) { nextOrder(e); return false; }

  // ---- retorno com carga ----
  if (o?.t === 'return' || e.sub === 2) {
    if (!e.carry || e.carryAmt <= 0) {
      e.carry = null; e.carryAmt = 0;
      if (o?.t === 'return') { nextOrder(e); return false; }
      e.sub = 0;
      return false;
    }
    const drop = g.findDropoff(e.owner, e.carry, e.x, e.y);
    if (!drop) { e.vx = e.vy = 0; e.anim = 'idle'; return false; }
    if (seek(g, e, drop.cx, drop.cy, 0, [drop.tx - 1, drop.ty - 1, drop.tx + drop.size, drop.ty + drop.size])) {
      const p = g.players[e.owner];
      p.res[e.carry] += e.carryAmt;
      p.stats.gathered[e.carry] += e.carryAmt;
      g.emit('deposit', drop.cx, drop.cy, { owner: e.owner });
      e.carry = null; e.carryAmt = 0;
      e.path = null; e.bestDist = Infinity;
      if (o?.t === 'return') { nextOrder(e); return false; }
      e.sub = 0;
    }
    return true;
  }
  if (!o || o.t !== 'gather') return false;

  // ---- dentro da mina ----
  if (e.inside) {
    e.subT -= dt;
    if (e.subT <= 0) {
      const m = g.ents.get(e.insideId);
      g.releaseFromMine(e);
      if (m && m.alive) {
        const res: ResKey = m.kind === 'mine' ? 'silver' : 'aether';
        const amt = Math.min(carryCap(g, e, res), m.amount);
        m.amount -= amt;
        m.hp = m.amount;
        e.carry = res; e.carryAmt = amt;
        if (m.amount <= 0) depleteResource(g, m);
        // sai pelo lado mais próximo do depósito
        const drop = g.findDropoff(e.owner, res, m.cx, m.cy);
        const ang = drop ? Math.atan2(drop.cy - m.cy, drop.cx - m.cx) : Math.PI / 2;
        const ex = m.cx + Math.cos(ang) * (m.size / 2 + 0.6), ey = m.cy + Math.sin(ang) * (m.size / 2 + 0.6);
        const nf = g.world.nearestFree(ex, ey, 4);
        if (nf) { e.x = e.px = nf[0] + 0.5; e.y = e.py = nf[1] + 0.5; }
      }
      e.sub = 2;
      e.path = null; e.bestDist = Infinity;
      if (e.queue.length) nextOrder(e);
    }
    return false;
  }

  const target = o.target ? g.ents.get(o.target) : undefined;
  // ---- árvore ----
  if (o.tile !== undefined && o.tile >= 0) {
    const w = g.world;
    if (e.carry && e.carry !== 'wood') { e.sub = 2; return true; }
    if (!w.tree[o.tile]) {
      const tx = o.tile % w.w, ty = Math.floor(o.tile / w.w);
      const nt = findNearestTree(g, tx + 0.5, ty + 0.5, 7);
      if (nt < 0) { if (e.carryAmt > 0) { e.sub = 2; } else nextOrder(e); return false; }
      o.tile = nt; e.path = null; e.bestDist = Infinity;
    }
    const tx = o.tile % w.w, ty = Math.floor(o.tile / w.w);
    if (e.sub === 0) {
      if (seek(g, e, tx + 0.5, ty + 0.5, 0, [tx - 1, ty - 1, tx + 1, ty + 1])) {
        if (Math.hypot(tx + 0.5 - e.x, ty + 0.5 - e.y) > 1.9) {
          // não conseguiu encostar: procura outra árvore
          const nt = findNearestTree(g, e.x, e.y, 5);
          if (nt >= 0 && nt !== o.tile) { o.tile = nt; e.path = null; e.bestDist = Infinity; return true; }
        }
        e.sub = 1; e.subT = 0;
      } else return true;
    }
    if (e.sub === 1) {
      e.vx = e.vy = 0;
      e.anim = 'work';
      e.facing = tx + 0.5 > e.x ? 1 : -1;
      const rate = 1 + modsFor(g, e.owner, e.type, 'worker').gather;
      e.subT += dt * rate;
      if (e.subT >= gd.chopTime) {
        e.subT -= gd.chopTime;
        e.carry = 'wood';
        e.carryAmt++;
        if ((g.tick + e.id) % 3 === 0) g.emit('chop', tx + 0.5, ty + 0.5);
        if (gd.woodMode === 'chop') {
          w.chopTree(o.tile);
          if (w.tree[o.tile] <= 0) { w.tree[o.tile] = 1; w.removeTree(o.tile); g.emit('smoke', tx + 0.5, ty + 0.5); }
        }
        if (e.carryAmt >= carryCap(g, e, 'wood')) { e.sub = 2; e.anim = 'idle'; e.path = null; e.bestDist = Infinity; }
        else if (!w.tree[o.tile]) {
          const nt = findNearestTree(g, e.x, e.y, 4);
          if (nt >= 0) { o.tile = nt; e.sub = 0; e.path = null; e.bestDist = Infinity; }
          else { e.sub = 2; e.path = null; e.bestDist = Infinity; }
        }
      }
    }
    return false;
  }

  // ---- mina / cristal ----
  if (!target || !target.alive || target.amount <= 0) {
    const kind = target?.kind === 'crystal' ? 'crystal' : 'mine';
    const nr = findNearestResource(g, kind, e.x, e.y, 30);
    if (nr) { o.target = nr.id; e.path = null; e.bestDist = Infinity; return true; }
    if (e.carryAmt > 0) e.sub = 2; else nextOrder(e);
    return false;
  }
  if (target.extractor) { nextOrder(e); return false; }
  const res: ResKey = target.kind === 'mine' ? 'silver' : 'aether';
  if (e.carry && (e.carry !== res || e.carryAmt >= carryCap(g, e, res))) { e.sub = 2; return true; }
  if (seek(g, e, target.cx, target.cy, 0, resRect(target))) {
    if (target.workers < 1) {
      e.inside = true;
      e.insideId = target.id;
      target.workers++;
      e.subT = res === 'silver' ? gd.mineTime : gd.crystalTime;
      e.vx = e.vy = 0;
      e.carry = null; e.carryAmt = 0;
    } else {
      e.vx = e.vy = 0;
      e.anim = 'idle';
    }
    return false;
  }
  return true;
}

export function depleteResource(g: Game, r: Entity) {
  if (!r.alive) return;
  r.alive = false;
  r.amount = 0;
  g.world.setRes(r.tx, r.ty, r.size, false);
  r.removed = true;
  g.ents.delete(r.id);
  g.emit('collapse', r.cx, r.cy, { a: r.size });
  for (const u of g.units) {
    if (u.alive && u.order?.t === 'gather' && u.order.target === r.id) {
      for (const p of g.players) if (p && p.id === u.owner) {
        g.alert(p.id, r.cx, r.cy, r.kind === 'mine' ? 'Uma mina de prata se esgotou.' : 'Um cristal de éter se esgotou.', 'info');
        break;
      }
    }
  }
}

// ============================================================================
// Construção e reparo
// ============================================================================
function buildUpdate(g: Game, e: Entity, o: Extract<Order, { t: 'build' }>): boolean {
  const d = BUILDINGS[o.type];
  if (!d) { nextOrder(e); return false; }
  if (!o.site) {
    const rect: [number, number, number, number] = [o.tx - 1, o.ty - 1, o.tx + d.size, o.ty + d.size];
    if (!seek(g, e, o.tx + d.size / 2, o.ty + d.size / 2, 0, rect)) return true;
    const ok = canPlaceAt(g, e.owner, o.type, o.tx, o.ty, e.id);
    if (!ok.ok) {
      if (o.paid) g.refund(e.owner, d.cost);
      g.msg(e.owner, `Não é possível construir: ${ok.reason}`, '#ff8a6a');
      nextOrder(e);
      return false;
    }
    if (!o.paid) {
      if (!g.pay(e.owner, d.cost)) { g.msg(e.owner, 'Recursos insuficientes.', '#ff8a6a'); nextOrder(e); return false; }
      o.paid = true;
    }
    const b = g.placeBuilding(o.type, e.owner, o.tx, o.ty, false);
    o.site = b.id;
    g.emit('build', b.cx, b.cy, { a: b.size });
    if (FACTIONS[g.players[e.owner].faction].builderMode === 'grow') { nextOrder(e); return false; }
  }
  const b = g.ents.get(o.site);
  if (!b || !b.alive || b.built) { nextOrder(e); return false; }
  if (g.edgeDist(e.x, e.y, b) > 1.6) return !seek(g, e, b.cx, b.cy, 0, [b.tx - 1, b.ty - 1, b.tx + b.size, b.ty + b.size]);
  e.vx = e.vy = 0;
  e.anim = 'work';
  e.facing = b.cx > e.x ? 1 : -1;
  b.builders++;
  if ((g.tick + e.id) % 14 === 0) g.emit('spark', e.x + e.facing * 0.4, e.y - 0.3);
  return false;
}

function repairUpdate(g: Game, e: Entity, o: Extract<Order, { t: 'repair' }>, dt: number): boolean {
  const b = g.ents.get(o.target);
  if (!b || !b.alive || b.hp >= b.maxHp) { nextOrder(e); return false; }
  if (!b.built && b.kind === 'building') {
    // ajudar na construção
    if (g.edgeDist(e.x, e.y, b) > 1.6) return !seek(g, e, b.cx, b.cy, 0, [b.tx - 1, b.ty - 1, b.tx + b.size, b.ty + b.size]);
    e.vx = e.vy = 0; e.anim = 'work'; b.builders++;
    return false;
  }
  const rect: [number, number, number, number] | null = b.kind === 'building' ? [b.tx - 1, b.ty - 1, b.tx + b.size, b.ty + b.size] : null;
  if (g.edgeDist(e.x, e.y, b) > 1.6) return !seek(g, e, b.cx, b.cy, 1.0, rect);
  e.vx = e.vy = 0;
  e.anim = 'work';
  e.facing = b.cx > e.x ? 1 : -1;
  const cost = b.bdef?.cost ?? b.udef?.cost ?? {};
  const time = (b.bdef?.time ?? b.udef?.time ?? 30) * 1.5;
  const heal = (b.maxHp / time) * dt;
  const frac = heal / b.maxHp;
  const p = g.players[e.owner];
  const cs = (cost.silver ?? 0) * 0.3 * frac, cw = (cost.wood ?? 0) * 0.3 * frac;
  if (p.res.silver < cs || p.res.wood < cw) { g.msg(e.owner, 'Recursos insuficientes para reparar.', '#ff8a6a'); nextOrder(e); return false; }
  p.res.silver -= cs; p.res.wood -= cw;
  b.hp = Math.min(b.maxHp, b.hp + heal);
  if ((g.tick + e.id) % 14 === 0) g.emit('spark', e.x + e.facing * 0.4, e.y - 0.3);
  return false;
}

export function canPlaceAt(g: Game, owner: number, type: string, tx: number, ty: number, ignoreUnit = 0): { ok: boolean; reason: string } {
  const d = BUILDINGS[type];
  const w = g.world;
  if (d.cat === 'extractor') {
    const c = g.resources.find((r) => r.kind === 'crystal' && r.alive && r.tx === tx && r.ty === ty);
    if (!c) return { ok: false, reason: 'deve ser construído sobre um cristal de éter' };
    if (c.extractor) return { ok: false, reason: 'cristal já possui extrator' };
    return { ok: true, reason: '' };
  }
  const fog = g.fogs[owner];
  for (let y = ty; y < ty + d.size; y++)
    for (let x = tx; x < tx + d.size; x++) {
      if (!w.inside(x, y)) return { ok: false, reason: 'fora do mapa' };
      if (!w.free(x, y)) return { ok: false, reason: 'terreno bloqueado' };
      if (w.ter[w.idx(x, y)] === 6 /* raso */ || w.ter[w.idx(x, y)] === 10) return { ok: false, reason: 'terreno inválido' };
      if (fog && !fog.explored(x, y)) return { ok: false, reason: 'área inexplorada' };
    }
  // centros não podem ficar colados a minas
  if (d.cat === 'hall') {
    for (const r of g.resources) {
      if (!r.alive) continue;
      const dx = Math.max(r.tx - (tx + d.size), 0, tx - (r.tx + r.size));
      const dy = Math.max(r.ty - (ty + d.size), 0, ty - (r.ty + r.size));
      if (Math.max(dx, dy) < 3) return { ok: false, reason: 'muito perto da jazida' };
    }
  }
  // Nenhuma unidade terrestre pode ocupar a fundação (exceto o construtor).
  g.spatial.queryRect(tx - 0.3, ty - 0.3, tx + d.size + 0.3, ty + d.size + 0.3, tmp);
  for (const u of tmp) {
    if (u.id === ignoreUnit || u.air || !u.alive) continue;
    return { ok: false, reason: 'há unidades no local' };
  }
  return { ok: true, reason: '' };
}

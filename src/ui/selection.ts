import { UNITS } from '../data/factions';
import type { Entity } from '../sim/entity';
import type { Session } from './session';

const CLASS_ORDER: Record<string, number> = { hero: 0, cavalry: 1, melee: 2, ranged: 3, caster: 4, air: 5, siege: 6, summon: 7, creep: 8, worker: 9 };
const tmp: Entity[] = [];

export function sortSelection(s: Session, ids: number[]): number[] {
  const g = s.g;
  return ids
    .map((id) => g.ents.get(id))
    .filter((e): e is Entity => !!e && e.alive)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'unit' ? -1 : 1;
      const ca = CLASS_ORDER[a.udef?.cls ?? ''] ?? 10, cb = CLASS_ORDER[b.udef?.cls ?? ''] ?? 10;
      if (ca !== cb) return ca - cb;
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      return a.id - b.id;
    })
    .map((e) => e.id);
}

export function setSelection(s: Session, ids: number[]) {
  s.selection = sortSelection(s, ids);
  const first = s.g.ents.get(s.selection[0]);
  s.subgroup = first?.type ?? '';
  s.r.selected = new Set(s.selection);
  s.dirty = true;
}

export function selected(s: Session): Entity[] {
  const out: Entity[] = [];
  for (const id of s.selection) {
    const e = s.g.ents.get(id);
    if (e && e.alive && (e.owner === s.pid || s.g.canSee(s.pid, e))) out.push(e);
  }
  return out;
}

export function ownSelected(s: Session): Entity[] {
  return selected(s).filter((e) => e.owner === s.pid);
}

export function ownUnitsSelected(s: Session): Entity[] {
  return selected(s).filter((e) => e.owner === s.pid && e.kind === 'unit');
}

/** Entidade sob o ponto (tiles). Unidades são testadas pelo centro visual do corpo. */
export function pickAt(s: Session, wx: number, wy: number, rad = 0.7): Entity | null {
  const g = s.g, fog = g.fogs[s.pid];
  let best: Entity | null = null, bd = Infinity;
  g.spatial.queryRadius(wx, wy + 0.4, rad + 1.2, tmp);
  for (const u of tmp) {
    if (!u.alive || u.inside) continue;
    if (!g.sharesVision(s.pid, u.owner) && !fog.visible(u.x, u.y)) continue;
    const sc = UNITS[u.type].art.scale ?? 1;
    const vy = u.y - (u.air ? 1.3 : 0.45) * sc;
    const d = Math.hypot(u.x - wx, vy - wy) - u.radius * sc;
    if (d < rad && d < bd) { bd = d; best = u; }
  }
  if (best) return best;
  for (const b of g.buildings) {
    if (!b.alive) continue;
    if (wx < b.tx || wx > b.tx + b.size || wy < b.ty - b.size * 0.45 || wy > b.ty + b.size) continue;
    if (!g.sharesVision(s.pid, b.owner) && !fog.rectVisible(b.tx, b.ty, b.size)) continue;
    return b;
  }
  for (const r of g.resources) {
    if (!r.alive || wx < r.tx || wx > r.tx + r.size || wy < r.ty - 0.6 || wy > r.ty + r.size) continue;
    if (!fog.rectExplored(r.tx, r.ty, r.size)) continue;
    return r;
  }
  for (const p of g.pickups) {
    if (!p.alive || Math.hypot(p.x - wx, p.y - 0.2 - wy) > 0.7) continue;
    if (!fog.visible(p.x, p.y)) continue;
    return p;
  }
  return null;
}

export function boxSelect(s: Session, x0: number, y0: number, x1: number, y1: number, add: boolean) {
  const g = s.g;
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const units: number[] = [];
  g.spatial.queryRect(ax - 1, ay - 1, bx + 1, by + 2, tmp);
  for (const u of tmp) {
    if (!u.alive || u.owner !== s.pid || u.inside) continue;
    const vy = u.y - (u.air ? 1.2 : 0.4);
    if (u.x + u.radius >= ax && u.x - u.radius <= bx && vy + 0.5 >= ay && vy - 0.5 <= by) units.push(u.id);
  }
  if (units.length) {
    // seleção de exército prefere combatentes quando há mistura com trabalhadores
    const mil = units.filter((id) => !g.ents.get(id)!.isWorker);
    const pick = mil.length && mil.length < units.length && !add ? mil : units;
    setSelection(s, add ? [...new Set([...s.selection, ...pick])] : pick);
    return;
  }
  const bs: number[] = [];
  for (const b of g.buildings) {
    if (!b.alive || b.owner !== s.pid) continue;
    if (b.tx + b.size >= ax && b.tx <= bx && b.ty + b.size >= ay && b.ty - 1 <= by) bs.push(b.id);
  }
  if (bs.length) setSelection(s, add ? [...new Set([...s.selection, ...bs])] : bs);
  else if (!add) setSelection(s, []);
}

/** Seleciona todas as unidades do mesmo tipo visíveis na tela. */
export function selectSameType(s: Session, type: string, add = false) {
  const g = s.g;
  const [x0, y0, x1, y1] = s.r.cam.viewRect(0);
  const ids: number[] = [];
  for (const e of [...g.units, ...g.buildings]) {
    if (!e.alive || e.owner !== s.pid || e.type !== type || e.inside) continue;
    if (e.cx < x0 || e.cx > x1 || e.cy < y0 || e.cy > y1) continue;
    ids.push(e.id);
  }
  setSelection(s, add ? [...new Set([...s.selection, ...ids])] : ids);
}

export function selectByClass(s: Session, filter: (e: Entity) => boolean, onScreen = false) {
  const g = s.g;
  const [x0, y0, x1, y1] = s.r.cam.viewRect(0);
  const ids = g.units
    .filter((u) => u.alive && u.owner === s.pid && !u.inside && filter(u))
    .filter((u) => !onScreen || (u.x >= x0 && u.x <= x1 && u.y >= y0 && u.y <= y1))
    .map((u) => u.id);
  setSelection(s, ids);
  return ids.length;
}

export function centerOnSelection(s: Session) {
  const es = selected(s);
  if (!es.length) return;
  let x = 0, y = 0;
  for (const e of es) { x += e.cx; y += e.cy; }
  s.r.cam.centerOn(x / es.length, y / es.length);
}

let idleIdx = 0;
export function selectIdleWorker(s: Session) {
  const idle = s.g.units.filter((u) => u.alive && u.owner === s.pid && u.isWorker && !u.order && !u.inside);
  if (!idle.length) return false;
  const w = idle[idleIdx++ % idle.length];
  setSelection(s, [w.id]);
  s.r.cam.centerOn(w.x, w.y);
  return true;
}

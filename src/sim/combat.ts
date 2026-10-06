import type { DmgType, ProjStyle } from '../data/types';
import { Entity, NEUTRAL_HOSTILE } from './entity';
import type { Game } from './game';
import { DMG_TABLE, armorType, getArmor, getAtkMul, getRange, rollDamage, skillLevel, abilityParam } from './stats';
import { seek } from './units';
import { addBuff } from './abilities';

export interface Projectile {
  id: number;
  x: number; y: number; sx: number; sy: number; px: number; py: number;
  tx: number; ty: number;
  target: number;
  speed: number;
  dmg: number;
  dtype: DmgType;
  splash: number;
  owner: number;
  src: number;
  style: ProjStyle;
  homing: boolean;
  arc: number;
  t: number;
  dur: number;
  bonusBuild: number;
  bonusAir: number;
  slow: number;
  spell: boolean;
  maxTargets: number;
  done: boolean;
}

const tmp: Entity[] = [];
const tmp2: Entity[] = [];

export function canAttackTarget(g: Game, e: Entity, t: Entity, explicit: boolean): boolean {
  const a = e.udef?.attack ?? e.bdef?.attack;
  if (!a || !t.alive || t === e) return false;
  if (t.kind !== 'unit' && t.kind !== 'building') return false;
  if (t.inside) return false;
  if (t.bdef?.invulnerable) return false;
  if (t.air && a.targets === 'ground') return false;
  if (!t.air && t.kind === 'unit' && a.targets === 'air') return false;
  if (t.kind === 'building' && a.targets === 'air') return false;
  if (!g.isEnemy(e.owner, t.owner)) return false;
  if (e.owner >= 0 && e.owner < 8 && !g.canSee(e.owner, t)) return false;
  if (explicit && t.owner === e.owner) return false;
  return true;
}

/** Aquisição de alvos com distribuição (evita todos atacarem o mesmo). */
export function acquireTarget(g: Game, e: Entity, radius: number): Entity | null {
  const sx = e.kind === 'unit' ? e.x : e.cx, sy = e.kind === 'unit' ? e.y : e.cy;
  const fog = e.owner >= 0 && e.owner < 8 ? g.fogs[e.owner] : null;
  let best: Entity | null = null, bs = Infinity;
  g.spatial.queryRadius(sx, sy, radius, tmp);
  for (const t of tmp) {
    if (!t.alive || !g.isEnemy(e.owner, t.owner) || !canAttackTarget(g, e, t, false)) continue;
    if (fog && !fog.visible(t.x, t.y)) continue;
    const d = Math.hypot(t.x - sx, t.y - sy);
    let s = d + t.attackers * 0.45;
    if (t.udef?.cls === 'worker') s += 1.5;
    if (t.swingT >= 0 || t.targetId) s -= 1.5; // prioriza quem está lutando
    if (t.isHero) s -= 0.5;
    if (s < bs) { bs = s; best = t; }
  }
  if (best && bs < radius * 0.6) return best;
  g.bspatial.queryRadius(sx, sy, radius + 3, tmp2);
  for (const t of tmp2) {
    if (!t.alive || !g.isEnemy(e.owner, t.owner) || !canAttackTarget(g, e, t, false)) continue;
    if (fog && !fog.rectVisible(t.tx, t.ty, t.size)) continue;
    const d = g.edgeDist(sx, sy, t);
    if (d > radius) continue;
    let s = d + 5 + t.attackers * 0.25;
    if (t.bdef!.attack) s -= 4; // torres primeiro
    if (t.bdef!.cat === 'wall') s += 4;
    if (s < bs) { bs = s; best = t; }
  }
  return best;
}

/**
 * Combate contra um alvo: ataca se no alcance, senão persegue (se permitido).
 * Retorna true se está se movendo.
 */
export function fight(g: Game, e: Entity, t: Entity, canMove: boolean, explicit: boolean): boolean {
  const a = e.udef!.attack;
  if (!a) return false;
  const range = getRange(g, e);
  const dist = g.edgeDist(e.x, e.y, t) - (e.radius * 0.5);
  const inRange = dist <= range + (range < 1.5 ? 0.35 : 0.1);
  if (inRange && (!a.minRange || dist >= a.minRange)) {
    e.vx = e.vy = 0;
    e.path = null;
    e.facing = t.cx > e.x ? 1 : -1;
    e.faceUp = t.cy < e.y - 0.6 && Math.abs(t.cx - e.x) < Math.abs(t.cy - e.y);
    if (e.atkCd <= 0 && e.swingT < 0) {
      e.swingT = a.windup;
      e.swingTarget = t.id;
      e.anim = 'attack';
      e.animT = 0;
    } else if (e.anim === 'walk') e.anim = 'idle';
    return false;
  }
  if (inRange && a.minRange && dist < a.minRange) {
    // muito perto para a artilharia: recua um pouco
    if (!canMove) return false;
    const ang = Math.atan2(e.y - t.cy, e.x - t.cx);
    seek(g, e, e.x + Math.cos(ang) * 2, e.y + Math.sin(ang) * 2, 0.3, null);
    return true;
  }
  if (!canMove) return false;
  if (t.kind === 'building') {
    seek(g, e, t.cx, t.cy, 0, [t.tx - Math.ceil(range), t.ty - Math.ceil(range), t.tx + t.size - 1 + Math.ceil(range), t.ty + t.size - 1 + Math.ceil(range)]);
  } else {
    seek(g, e, t.x, t.y, range * 0.9, null);
  }
  return true;
}

export function performSwing(g: Game, e: Entity) {
  const t = g.ents.get(e.swingTarget);
  const a = e.udef?.attack ?? e.bdef?.attack;
  e.swingT = -1;
  if (!a) return;
  e.atkCd = a.cd / getAtkMul(e);
  if (!t || !t.alive) return;
  const range = e.kind === 'unit' ? getRange(g, e) : a.range + e.size / 2;
  const sx = e.kind === 'unit' ? e.x : e.cx, sy = e.kind === 'unit' ? e.y : e.cy;
  if (g.edgeDist(sx, sy, t) > range + 1.2) return;
  let dmg = rollDamage(g, e);
  if (a.proj) {
    spawnProjectile(g, e, t, dmg, a.type, a.proj, a.projSpeed ?? 14, a.splash ?? 0, a.bonusVsBuild ?? 1, a.bonusVsAir ?? 1);
  } else {
    if (t.kind === 'building' && a.bonusVsBuild) dmg *= a.bonusVsBuild;
    if (a.splash) splashDamage(g, e, t.cx, t.cy, dmg, a.type, a.splash, t.id, 12);
    else applyDamage(g, t, dmg, a.type, e, false);
    g.emit(e.udef?.cls === 'siege' || a.type === 'siege' ? 'hit' : 'slash', (t.cx + e.x) / 2, (t.cy + e.y) / 2 - 0.3, { a: e.facing });
    const steal = skillLevel(e, 'blood_thirst');
    if (steal) e.hp = Math.min(e.maxHp, e.hp + dmg * abilityParam('blood_thirst', steal, 'steal'));
  }
}

export function spawnProjectile(
  g: Game, e: Entity, t: Entity, dmg: number, dtype: DmgType, style: ProjStyle, speed: number, splash: number,
  bonusBuild = 1, bonusAir = 1, spell = false,
) {
  const sx = e.kind === 'unit' ? e.x : e.cx, sy = e.kind === 'unit' ? e.y - 0.6 : e.cy - e.size * 0.6;
  const homing = !splash;
  const tx = t.cx, ty = t.cy - (t.air ? 1.2 : 0.4);
  const dist = Math.hypot(tx - sx, ty - sy);
  const arc = style === 'boulder' || style === 'stone' || style === 'cannon' || style === 'shell' ? Math.min(3.5, dist * 0.35) : style === 'arrow' || style === 'bolt' || style === 'javelin' ? dist * 0.08 : 0;
  g.projectiles.push({
    id: g.nextProjectileId++, x: sx, y: sy, sx, sy, px: sx, py: sy, tx, ty, target: t.id, speed, dmg, dtype, splash, owner: e.owner, src: e.id,
    style, homing, arc, t: 0, dur: Math.max(0.12, dist / speed), bonusBuild, bonusAir,
    slow: skillLevel(e, 'dust') ? abilityParam('dust', 1, 'slow') : 0, spell, maxTargets: 12, done: false,
  });
}

export function spawnSpellProjectile(g: Game, sx: number, sy: number, tx: number, ty: number, owner: number, src: number, dmg: number, splash: number, style: ProjStyle, speed: number, maxTargets: number) {
  const dist = Math.hypot(tx - sx, ty - sy);
  g.projectiles.push({
    id: g.nextProjectileId++, x: sx, y: sy, sx, sy, px: sx, py: sy, tx, ty, target: 0, speed, dmg, dtype: 'arcane', splash, owner, src,
    style, homing: false, arc: Math.min(3, dist * 0.3), t: 0, dur: Math.max(0.15, dist / speed), bonusBuild: 1, bonusAir: 1,
    slow: 0, spell: true, maxTargets, done: false,
  });
}

export function updateProjectiles(g: Game, dt: number) {
  for (const p of g.projectiles) {
    p.px = p.x; p.py = p.y;
    if (p.homing && p.target) {
      const t = g.ents.get(p.target);
      if (t && t.alive) { p.tx = t.cx; p.ty = t.cy - (t.air ? 1.2 : 0.4); }
    }
    p.t += dt;
    const k = Math.min(1, p.t / p.dur);
    p.x = p.sx + (p.tx - p.sx) * k;
    p.y = p.sy + (p.ty - p.sy) * k;
    if (k >= 1) {
      p.done = true;
      const src = g.ents.get(p.src) ?? null;
      if (p.splash > 0) {
        splashDamage(g, src, p.tx, p.ty + 0.4, p.dmg, p.dtype, p.splash, p.target, p.maxTargets, p.owner, p.spell, p.bonusBuild);
        g.emit(p.splash > 1.3 ? 'bigexplode' : 'explode', p.tx, p.ty + 0.4, { a: p.splash });
      } else {
        const t = g.ents.get(p.target);
        if (t && t.alive) {
          let dmg = p.dmg;
          if (t.kind === 'building') dmg *= p.bonusBuild;
          if (t.air) dmg *= p.bonusAir;
          applyDamage(g, t, dmg, p.dtype, src, p.spell, p.owner);
          if (p.slow && t.kind === 'unit') addBuff(t, { id: 'dust', t: 3, speedMul: -p.slow });
          g.emit(p.style === 'orb' || p.style === 'moon' || p.style === 'fire' ? 'spell' : 'hit', p.tx, p.ty, { color: p.style === 'moon' ? '#bfe3ff' : p.style === 'fire' ? '#ff8a3a' : undefined });
          if (src && src.alive) {
            const steal = skillLevel(src, 'blood_thirst');
            if (steal) src.hp = Math.min(src.maxHp, src.hp + dmg * abilityParam('blood_thirst', steal, 'steal'));
          }
        }
      }
    }
  }
  if (g.projectiles.length) g.projectiles = g.projectiles.filter((p) => !p.done);
}

export function splashDamage(
  g: Game, src: Entity | null, x: number, y: number, dmg: number, dtype: DmgType, radius: number,
  primary: number, maxTargets: number, owner = src?.owner ?? -1, spell = false, bonusBuild = 1,
) {
  g.spatial.queryRadius(x, y, radius + 0.5, tmp);
  let n = 0;
  for (const t of tmp) {
    if (!t.alive || t.air || !g.isEnemy(owner, t.owner)) continue;
    const d = Math.hypot(t.x - x, t.y - y);
    if (d > radius + t.radius) continue;
    const f = t.id === primary ? 1 : Math.max(0.35, 1 - d / (radius + t.radius));
    applyDamage(g, t, dmg * f, dtype, src, spell, owner);
    if (++n >= maxTargets) break;
  }
  g.bspatial.queryRadius(x, y, radius + 3, tmp2);
  for (const b of tmp2) {
    if (!b.alive || !g.isEnemy(owner, b.owner)) continue;
    if (g.edgeDist(x, y, b) > radius) continue;
    applyDamage(g, b, dmg * (b.id === primary ? 1 : 0.6) * bonusBuild, dtype, src, spell, owner);
  }
}

export function applyDamage(g: Game, t: Entity, raw: number, dtype: DmgType, src: Entity | null, spell: boolean, ownerOverride?: number) {
  if (!t.alive || t.bdef?.invulnerable) return;
  for (const b of t.buffs) if (b.id === 'invuln') return;
  let dmg: number;
  if (spell) {
    dmg = raw * (t.kind === 'building' ? 0.5 : t.isHero ? 0.75 : 1);
  } else {
    const mult = DMG_TABLE[dtype][armorType(t)];
    const armor = getArmor(g, t);
    const red = armor >= 0 ? (armor * 0.06) / (1 + armor * 0.06) : -(1 - Math.pow(0.94, -armor));
    dmg = raw * mult * (1 - red);
    if (dtype === 'pierce' && skillLevel(t, 'shieldwall')) dmg *= 0.65;
  }
  dmg = Math.max(1, dmg);
  t.hp -= dmg;
  t.lastHitT = g.time;
  const owner = src?.owner ?? ownerOverride ?? -1;
  if (src) t.lastAttacker = src.id;

  // alertas
  if (t.owner >= 0 && t.owner < 8) {
    g.alert(t.owner, t.cx, t.cy, t.kind === 'building' ? `${t.bdef!.name} sob ataque!` : 'Suas tropas estão sob ataque!', 'attack');
  }
  if (t.hp <= 0) { g.kill(t, src); return; }

  // revide e pedido de ajuda
  if (src && src.alive && g.isEnemy(t.owner, owner)) {
    if (t.kind === 'unit' && !t.targetId && !t.passive && t.udef!.attack && (!t.order || t.order.t === 'amove' || t.order.t === 'guard' || t.order.t === 'patrol' || (t.order.t === 'hold'))) {
      if (canAttackTarget(g, t, src, false)) t.targetId = src.id;
    }
    if ((g.tick + t.id) % 4 === 0) callForHelp(g, t, src);
  }
}

function callForHelp(g: Game, t: Entity, src: Entity) {
  g.spatial.queryRadius(t.cx, t.cy, 7, tmp);
  for (const u of tmp) {
    if (u === t || !u.alive || u.targetId || u.passive) continue;
    if (u.owner !== t.owner) continue;
    if (!u.udef!.attack || u.udef!.cls === 'worker') continue;
    if (u.order && u.order.t !== 'amove' && u.order.t !== 'guard' && u.order.t !== 'patrol') continue;
    if (u.owner === NEUTRAL_HOSTILE && u.campId !== t.campId) continue;
    if (canAttackTarget(g, u, src, false)) u.targetId = src.id;
  }
}

/** Ataque de torres/edifícios armados. */
export function buildingAttack(g: Game, b: Entity, dt: number) {
  const a = b.bdef!.attack!;
  if (b.atkCd > 0) b.atkCd -= dt;
  if (b.swingT >= 0) {
    b.swingT -= dt;
    if (b.swingT < 0) performSwing(g, b);
    return;
  }
  let t = b.targetId ? g.ents.get(b.targetId) : undefined;
  if (t && (!t.alive || g.edgeDist(b.cx, b.cy, t) > a.range + b.size / 2 || !canAttackTarget(g, b, t, false))) { t = undefined; b.targetId = 0; }
  if (!t && (g.tick + b.id) % 8 === 0) {
    const nt = acquireTarget(g, b, a.range + b.size / 2);
    if (nt) { b.targetId = nt.id; t = nt; }
  }
  if (t && b.atkCd <= 0) {
    b.swingT = 0.05;
    b.swingTarget = t.id;
  }
}

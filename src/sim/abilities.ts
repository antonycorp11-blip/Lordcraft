import { ABILITIES } from '../data/abilities';
import { Entity, type Buff, type Order } from './entity';
import type { Game } from './game';
import { abilityParam, skillLevel } from './stats';
import { applyDamage, spawnSpellProjectile, splashDamage } from './combat';
import { nextOrder, seek } from './units';

const tmp: Entity[] = [];

export function addBuff(e: Entity, b: Buff) {
  if (b.stun || b.root) for (const x of e.buffs) if (x.noStun) return;
  const ex = e.buffs.find((x) => x.id === b.id);
  if (ex) Object.assign(ex, b, { t: Math.max(ex.t, b.t) });
  else e.buffs.push({ ...b });
}

export function tickBuffs(g: Game, e: Entity, dt: number) {
  if (!e.buffs.length) return;
  let removed = false;
  for (const b of e.buffs) {
    b.t -= dt;
    if (b.dps) {
      const src = b.src ? g.ents.get(b.src) ?? null : null;
      applyDamage(g, e, b.dps * dt, 'arcane', src, true, src?.owner);
      if (!e.alive) return;
    }
    if (b.t <= 0) removed = true;
  }
  if (removed) e.buffs = e.buffs.filter((b) => b.t > 0);
}

/** Auras de heróis e edifícios: aplicadas a cada 0.5s como buffs curtos. */
export function updateAuras(g: Game) {
  for (const s of g.units) {
    if (!s.alive || !s.udef!.hero) continue;
    for (const ab of s.udef!.hero.abilities) {
      const def = ABILITIES[ab];
      if (def.kind !== 'aura') continue;
      const lvl = s.skills[ab] ?? 0;
      if (!lvl) continue;
      applyAura(g, s, ab, lvl, s.x, s.y);
    }
  }
  for (const b of g.buildings) {
    if (!b.alive || !b.built || !b.bdef!.aura) continue;
    applyAura(g, b, b.bdef!.aura.ability, 1, b.cx, b.cy);
  }
}

function applyAura(g: Game, s: Entity, ab: string, lvl: number, x: number, y: number) {
  const r = abilityParam(ab, lvl, 'radius');
  g.spatial.queryRadius(x, y, r, tmp);
  const neutralSpring = ab === 'healing_spring';
  for (const u of tmp) {
    if (!u.alive) continue;
    if (!neutralSpring && !g.isAlly(s.owner, u.owner)) continue;
    if (neutralSpring && (u.owner < 0 || u.owner >= 8)) continue;
    switch (ab) {
      case 'bastion_aura': addBuff(u, { id: 'a_bastion', t: 0.7, armor: abilityParam(ab, lvl, 'armor') }); break;
      case 'war_cry': addBuff(u, { id: 'a_warcry', t: 0.7, dmgMul: abilityParam(ab, lvl, 'dmg') }); break;
      case 'dew_aura': addBuff(u, { id: 'a_dew', t: 0.7, regen: abilityParam(ab, lvl, 'regen') }); break;
      case 'plating_aura': addBuff(u, { id: 'a_plating', t: 0.7, armor: abilityParam(ab, lvl, 'armor'), regen: u.udef!.mech ? abilityParam(ab, lvl, 'regen') : 0 }); break;
      case 'war_drums': addBuff(u, { id: 'a_drums', t: 0.7, atkMul: abilityParam(ab, lvl, 'atk') }); break;
      case 'healing_spring':
        addBuff(u, { id: 'a_spring', t: 0.7, regen: abilityParam(ab, lvl, 'regen') });
        if (u.maxMana) u.mana = Math.min(u.maxMana, u.mana + abilityParam(ab, lvl, 'mregen') * 0.5);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Lançamento
// ---------------------------------------------------------------------------
export function canCast(g: Game, e: Entity, ab: string): { ok: boolean; reason: string } {
  const def = ABILITIES[ab];
  if (!def) return { ok: false, reason: '?' };
  const lvl = skillLevel(e, ab);
  if (!lvl) return { ok: false, reason: 'Habilidade não aprendida' };
  if (def.kind === 'passive' || def.kind === 'aura') return { ok: false, reason: 'Passiva' };
  if ((e.cds[ab] ?? 0) > 0) return { ok: false, reason: 'Recarregando' };
  const mana = def.mana[Math.min(def.mana.length - 1, lvl - 1)];
  if (e.mana < mana) return { ok: false, reason: 'Mana insuficiente' };
  return { ok: true, reason: '' };
}

export function castUpdate(g: Game, e: Entity, o: Extract<Order, { t: 'cast' }>): boolean {
  const def = ABILITIES[o.ability];
  const chk = canCast(g, e, o.ability);
  if (!chk.ok) { nextOrder(e); return false; }
  let tx = o.x ?? e.x, ty = o.y ?? e.y;
  let target: Entity | undefined;
  if (def.target === 'enemy' || def.target === 'ally' || def.target === 'unit') {
    target = o.target ? g.ents.get(o.target) : undefined;
    if (!target || !target.alive) { nextOrder(e); return false; }
    tx = target.cx; ty = target.cy;
  }
  if (def.target !== 'none') {
    const d = target ? g.edgeDist(e.x, e.y, target) : Math.hypot(tx - e.x, ty - e.y);
    if (d > def.range + 0.3) { seek(g, e, tx, ty, def.range * 0.9, null); return true; }
  }
  e.vx = e.vy = 0;
  doCast(g, e, o.ability, target, tx, ty);
  nextOrder(e);
  return false;
}

export function doCast(g: Game, e: Entity, ab: string, target: Entity | undefined, tx: number, ty: number) {
  const def = ABILITIES[ab];
  const lvl = skillLevel(e, ab);
  const P = (k: string) => abilityParam(ab, lvl, k);
  e.mana -= def.mana[Math.min(def.mana.length - 1, lvl - 1)];
  e.cds[ab] = def.cd[Math.min(def.cd.length - 1, lvl - 1)];
  e.anim = 'cast';
  e.animT = 0;
  e.facing = tx >= e.x ? 1 : -1;
  switch (ab) {
    case 'stormhammer':
      if (target) {
        applyDamage(g, target, P('dmg'), 'arcane', e, true);
        if (target.alive) addBuff(target, { id: 'stun', t: P('stun'), stun: true });
        g.emit('spell', target.cx, target.cy - 0.5, { color: '#9fd0ff' });
      }
      break;
    case 'thunderclap':
    case 'seismic_stomp': {
      g.spatial.queryRadius(e.x, e.y, P('radius'), tmp);
      let n = 0;
      for (const u of tmp) {
        if (!u.alive || u.air || !g.isEnemy(e.owner, u.owner)) continue;
        applyDamage(g, u, P('dmg'), 'arcane', e, true);
        if (u.alive) {
          if (ab === 'thunderclap') addBuff(u, { id: 'slow', t: P('dur'), speedMul: -P('slow'), atkMul: -0.3 });
          else addBuff(u, { id: 'stun', t: P('stun'), stun: true });
        }
        if (++n >= P('maxTargets')) break;
      }
      g.emit('stomp', e.x, e.y, { a: P('radius') });
      break;
    }
    case 'avante': {
      g.spatial.queryRadius(e.x, e.y, P('radius'), tmp);
      for (const u of tmp) if (u.alive && g.isAlly(e.owner, u.owner)) {
        addBuff(u, { id: 'avante', t: P('dur'), dmgMul: P('dmg'), speedMul: P('speed') });
        g.emit('buff', u.x, u.y);
      }
      g.emit('stomp', e.x, e.y, { a: P('radius'), color: '#ffd76a' });
      break;
    }
    case 'heal':
      if (target) {
        const mul = 1 + (g.players[e.owner] ? (g.players[e.owner].upgrades['v_r_votos'] ? 0.5 : 0) : 0);
        target.hp = Math.min(target.maxHp, target.hp + P('heal') * mul);
        g.emit('heal', target.cx, target.cy);
      }
      break;
    case 'field_repair':
      if (target) { target.hp = Math.min(target.maxHp, target.hp + P('heal')); g.emit('spark', target.cx, target.cy - 0.4); }
      break;
    case 'bless':
      if (target) { addBuff(target, { id: 'bless', t: P('dur'), armor: P('armor') }); g.emit('buff', target.cx, target.cy); }
      break;
    case 'bloodfury':
      if (target) { addBuff(target, { id: 'bloodfury', t: P('dur'), atkMul: P('atk'), speedMul: P('speed') }); g.emit('buff', target.cx, target.cy, { color: '#ff5a3a' }); }
      break;
    case 'ashveil': {
      g.spatial.queryRadius(tx, ty, P('radius'), tmp);
      for (const u of tmp) if (u.alive && g.isEnemy(e.owner, u.owner)) addBuff(u, { id: 'ashveil', t: P('dur'), armor: -P('armor') });
      g.emit('smoke', tx, ty, { a: P('radius') });
      break;
    }
    case 'ash_avatar':
      addBuff(e, { id: 'avatar', t: P('dur'), armor: P('armor'), dmgAdd: P('dmg'), noStun: true });
      e.buffs = e.buffs.filter((b) => !b.stun && !b.root);
      g.emit('stomp', e.x, e.y, { a: 2, color: '#ff7a2a' });
      break;
    case 'moonbeam':
      if (target) { applyDamage(g, target, P('dmg'), 'arcane', e, true); g.emit('moon', target.cx, target.cy); }
      break;
    case 'roots':
    case 'entangle':
      if (target) {
        addBuff(target, { id: 'root', t: P('dur'), root: true, dps: P('dps'), src: e.id });
        g.emit('root', target.cx, target.cy);
      }
      break;
    case 'starfall':
      g.reveals.push({ owner: e.owner, x: tx, y: ty, r: 4, t: P('dur') });
      scheduleWaves(g, e, tx, ty, P('dur'), P('radius'), P('dmg'), P('maxTargets'), 'moon');
      break;
    case 'barrage':
      g.reveals.push({ owner: e.owner, x: tx, y: ty, r: 4, t: 4 });
      for (let i = 0; i < P('shells'); i++) {
        const a = g.rng.next() * Math.PI * 2, r = g.rng.next() * P('radius');
        const px = tx + Math.cos(a) * r, py = ty + Math.sin(a) * r;
        g.pendingCasts.push({ at: g.time + i * 0.35, kind: 'barrage', x: px, y: py, owner: e.owner, src: e.id, dmg: P('dmg'), radius: 1.8, maxTargets: P('maxTargets') });
      }
      break;
    case 'frag_grenade':
      spawnSpellProjectile(g, e.x, e.y - 0.6, tx, ty, e.owner, e.id, P('dmg'), P('radius'), 'cannon', 12, P('maxTargets'));
      break;
    case 'summon_wolves':
      for (let i = 0; i < P('count'); i++) {
        const w = g.spawnUnit('y_lobo', e.owner, e.x + (i ? 0.8 : -0.8), e.y + 0.6);
        w.timedLife = P('dur');
        g.emit('summon', w.x, w.y);
      }
      break;
    case 'turret': {
      const t = g.spawnUnit('d_torreta', e.owner, tx, ty);
      t.timedLife = P('dur');
      const l = P('lvl');
      t.maxHp = t.hp = 320 + (l - 1) * 140;
      g.emit('summon', t.x, t.y);
      break;
    }
    case 'flare':
      g.reveals.push({ owner: e.owner, x: tx, y: ty, r: P('radius'), t: P('dur') });
      g.emit('star', tx, ty);
      break;
  }
}

function scheduleWaves(g: Game, e: Entity, x: number, y: number, dur: number, radius: number, dmg: number, maxT: number, fx: 'moon') {
  const waves = Math.round(dur);
  for (let i = 0; i < waves; i++) {
    g.pendingCasts.push({
      at: g.time + i,
      kind: 'wave', x, y, dmg, radius, maxTargets: maxT, owner: e.owner, src: e.id,
    });
  }
}

/** Habilidades automáticas (cura, fúria, reparo) — usadas por jogadores e IA. */
export function tryAutocast(g: Game, e: Entity) {
  const abs = e.udef!.abilities;
  if (!abs || e.mana <= 0) return;
  for (const ab of abs) {
    if (!e.autocast[ab]) continue;
    if (!canCast(g, e, ab).ok) continue;
    const def = ABILITIES[ab];
    g.spatial.queryRadius(e.x, e.y, def.range, tmp);
    let best: Entity | null = null, bv = 0;
    for (const u of tmp) {
      if (!u.alive || !g.isAlly(e.owner, u.owner) || u.inside) continue;
      if (ab === 'heal') {
        const miss = u.maxHp - u.hp;
        if (miss > 35 && miss > bv && !u.udef!.mech) { bv = miss; best = u; }
      } else if (ab === 'bloodfury') {
        if (u.udef!.attack && u.udef!.cls !== 'worker' && !u.buffs.some((b) => b.id === 'bloodfury') && (u.targetId || u.swingT >= 0)) { best = u; break; }
      } else if (ab === 'field_repair') {
        const miss = u.maxHp - u.hp;
        if (u.udef!.mech && miss > 30 && miss > bv) { bv = miss; best = u; }
      }
    }
    if (!best && ab === 'field_repair') {
      g.bspatial.queryRadius(e.x, e.y, def.range + 2, tmp);
      for (const b of tmp) if (b.alive && b.built && b.owner === e.owner && b.maxHp - b.hp > 30 && g.edgeDist(e.x, e.y, b) <= def.range) { best = b; break; }
    }
    if (best) { doCast(g, e, ab, best, best.cx, best.cy); return; }
  }
}

export function processPending(g: Game) {
  if (!g.pendingCasts.length) return;
  const due = g.pendingCasts.filter((p) => p.at <= g.time);
  if (!due.length) return;
  g.pendingCasts = g.pendingCasts.filter((p) => p.at > g.time);
  for (const p of due) {
    if (p.kind === 'barrage') spawnSpellProjectile(g, p.x - 3, p.y - 8, p.x, p.y, p.owner, p.src, p.dmg, p.radius, 'shell', 16, p.maxTargets);
    else {
      splashDamage(g, g.ents.get(p.src) ?? null, p.x, p.y, p.dmg, 'arcane', p.radius, 0, p.maxTargets, p.owner, true, 0.5);
      for (let k = 0; k < 4; k++) g.emit('star', p.x + (g.rng.next() - 0.5) * p.radius * 1.6, p.y + (g.rng.next() - 0.5) * p.radius * 1.6);
    }
  }
}

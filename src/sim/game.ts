import { BUILDINGS, FACTIONS, UNITS, satisfies } from '../data/factions';
import { ITEM_DROP_TABLE } from '../data/abilities';
import type { Cost, ResKey } from '../data/types';
import { RES_KEYS } from '../data/types';
import { Rng } from '../core/rng';
import type { Decor } from '../world/mapgen';
import { Pathfinder } from '../world/path';
import { World } from '../world/world';
import { Entity, NEUTRAL_HOSTILE, NEUTRAL_PASSIVE, Player, type Kind } from './entity';
import { Fog, type Viewer } from './fog';
import { SpatialHash } from './spatial';
import { buildingMods, getSight, heroMaxHp, heroMaxMana, modsFor, type Mods } from './stats';
import { updateUnit } from './units';
import { updateProjectiles, type Projectile } from './combat';
import { updateBuilding } from './buildings';
import { updateAuras, processPending } from './abilities';
import { grantXp } from './heroes';
import type { Realm } from '../realm/types';
import { realmSecond } from '../realm/tick';

export type FxKind =
  | 'slash' | 'hit' | 'spark' | 'blood' | 'death' | 'explode' | 'bigexplode' | 'heal' | 'spell' | 'levelup' | 'build'
  | 'collapse' | 'smoke' | 'stomp' | 'moon' | 'star' | 'summon' | 'text' | 'order' | 'aorder' | 'chop' | 'deposit' | 'root' | 'buff';

export interface FxEvent { k: FxKind; x: number; y: number; a?: number; text?: string; owner?: number; color?: string }
export interface Alert { owner: number; x: number; y: number; t: number; text: string; kind: 'attack' | 'info' | 'build' | 'research' | 'hero' }
export interface Camp { id: number; x: number; y: number; level: number; units: number[]; cleared: boolean }

export interface GameSetupPlayer {
  name: string;
  faction: import('../data/types').FactionId;
  ai: boolean;
  team: number;
  personality?: string;
  difficulty?: string;
  color: string;
}

export type Relation = 'war' | 'peace' | 'ally';

export class Game {
  world: World;
  path: Pathfinder;
  players: Player[] = [];
  fogs: Fog[] = [];
  ents = new Map<number, Entity>();
  units: Entity[] = [];
  buildings: Entity[] = [];
  resources: Entity[] = [];
  pickups: Entity[] = [];
  projectiles: Projectile[] = [];
  camps: Camp[] = [];
  decor: Decor[] = [];
  spatial: SpatialHash;
  bspatial: SpatialHash;
  rng: Rng;
  seed: number;
  mapId: string;
  nextId = 1;
  nextProjectileId = 1;
  nextProposalId = 1;
  tick = 0;
  time = 0;
  readonly dt = 0.05;
  dayLength = 420;
  dayOffset = 0.1 * 420;
  fx: FxEvent[] = [];
  alerts: Alert[] = [];
  messages: { text: string; t: number; owner: number; color?: string }[] = [];
  rel: Relation[][] = [];
  truceUntil: number[][] = [];
  reveals: { owner: number; x: number; y: number; r: number; t: number }[] = [];
  pendingCasts: { at: number; kind: 'barrage' | 'wave'; owner: number; src: number; x: number; y: number; dmg: number; radius: number; maxTargets: number }[] = [];
  proposals: import('./diplomacy').Proposal[] = [];
  modCache = new Map<number, Map<string, Mods>>();
  groupSeq = 1;
  over = false;
  winnerTeam = -1;
  ais: { update(g: Game): void; playerId: number }[] = [];
  /** modo feudo: o mapa é a província do jogador e o reino corre por trás */
  realm: Realm | null = null;
  mode: 'skirmish' | 'province' | 'battle' = 'skirmish';
  /** batalha comandada: exército do jogador (0) contra a casa defensora (1) */
  battle: { army: number; province: string; house: string } | null = null;
  perf = { simMs: 0, aiMs: 0, fogMs: 0 };
  ghosts: Map<number, Map<number, { type: string; tx: number; ty: number; size: number; owner: number }>> = new Map();
  heroRecords = new Map<number, { owner: number; type: string; level: number; xp: number; skills: Record<string, number>; items: (string | null)[]; skillPts: number }>();
  private tmp: Entity[] = [];

  constructor(world: World, seed: number, mapId: string) {
    this.world = world;
    this.seed = seed;
    this.mapId = mapId;
    this.rng = new Rng(seed ^ 0x9e3779b9);
    this.path = new Pathfinder(world);
    this.spatial = new SpatialHash(world.w, world.h, 4);
    this.bspatial = new SpatialHash(world.w, world.h, 8);
  }

  // ------------------------------------------------------------------
  // Jogadores e diplomacia
  // ------------------------------------------------------------------
  addPlayer(p: Player) {
    this.players[p.id] = p;
    this.fogs[p.id] = new Fog(this.world.w, this.world.h);
  }

  initRelations() {
    const n = 10;
    this.rel = Array.from({ length: n }, () => Array<Relation>(n).fill('war'));
    this.truceUntil = Array.from({ length: n }, () => Array<number>(n).fill(0));
    for (let a = 0; a < n; a++)
      for (let b = 0; b < n; b++) {
        if (a === b) this.rel[a][b] = 'ally';
        else if (a === NEUTRAL_PASSIVE || b === NEUTRAL_PASSIVE) this.rel[a][b] = 'peace';
        else if (a === NEUTRAL_HOSTILE || b === NEUTRAL_HOSTILE) this.rel[a][b] = 'war';
        else {
          const pa = this.players[a], pb = this.players[b];
          if (pa && pb && pa.team === pb.team && pa.team > 0) this.rel[a][b] = 'ally';
        }
      }
  }

  isEnemy(a: number, b: number): boolean {
    if (a === b) return false;
    return this.rel[a]?.[b] === 'war';
  }
  isAlly(a: number, b: number): boolean {
    return a === b || this.rel[a]?.[b] === 'ally';
  }
  setRelation(a: number, b: number, r: Relation, truceSecs = 0) {
    this.rel[a][b] = r;
    this.rel[b][a] = r;
    this.truceUntil[a][b] = this.truceUntil[b][a] = truceSecs ? this.time + truceSecs : 0;
  }

  // ------------------------------------------------------------------
  // Tempo do dia
  // ------------------------------------------------------------------
  dayPhase(): number {
    return ((this.time + this.dayOffset) % this.dayLength) / this.dayLength;
  }
  isNight(): boolean {
    const p = this.dayPhase();
    return p > 0.68 && p < 0.96;
  }
  /** 0 = dia pleno, 1 = noite plena (transições suaves) */
  darkness(): number {
    const p = this.dayPhase();
    if (p < 0.6) return 0;
    if (p < 0.7) return (p - 0.6) / 0.1;
    if (p < 0.92) return 1;
    if (p < 1) return 1 - (p - 0.92) / 0.08;
    return 0;
  }

  // ------------------------------------------------------------------
  // Criação de entidades
  // ------------------------------------------------------------------
  private add(e: Entity) {
    this.ents.set(e.id, e);
    if (e.kind === 'unit') this.units.push(e);
    else if (e.kind === 'building') { this.buildings.push(e); this.bspatial.insert(e); }
    else if (e.kind === 'mine' || e.kind === 'crystal') this.resources.push(e);
    else this.pickups.push(e);
  }

  spawnUnit(type: string, owner: number, x: number, y: number): Entity {
    const d = UNITS[type];
    if (!d) throw new Error('unidade desconhecida ' + type);
    const e = new Entity(this.nextId++, 'unit', type, owner);
    e.udef = d;
    e.radius = d.radius;
    e.air = !!d.air;
    if (!e.air) {
      const nf = this.world.freeAt(x, y) ? [x, y] : this.world.nearestFree(x, y, 8)?.map((v) => v + 0.5) ?? [x, y];
      x = nf[0]; y = nf[1];
    }
    e.x = e.px = e.idleX = x;
    e.y = e.py = e.idleY = y;
    const m = modsFor(this, owner, type, d.cls);
    e.maxHp = e.hp = d.hp * (1 + m.hpMul);
    e.maxMana = (d.mana ?? 0) + m.mana;
    e.mana = e.maxMana * (d.hero ? 1 : 0.5);
    if (d.hero) { e.items = [null, null, null, null, null, null]; e.skillPts = 1; }
    if (d.timedLife) e.timedLife = d.timedLife;
    for (const ab of d.abilities ?? []) if (ab === 'heal' || ab === 'bloodfury' || ab === 'field_repair') e.autocast[ab] = true;
    this.add(e);
    return e;
  }

  placeBuilding(type: string, owner: number, tx: number, ty: number, built: boolean): Entity {
    const d = BUILDINGS[type];
    const e = new Entity(this.nextId++, 'building', type, owner);
    e.bdef = d;
    e.tx = tx; e.ty = ty; e.size = d.size;
    e.x = e.px = tx + d.size / 2;
    e.y = e.py = ty + d.size / 2;
    e.radius = d.size / 2;
    const bm = buildingMods(this, owner);
    e.maxHp = d.hp * (1 + bm.hpMul);
    e.built = built;
    e.progress = built ? 1 : 0;
    e.hp = built ? e.maxHp : Math.max(1, e.maxHp * 0.1);
    this.world.setBuilding(tx, ty, d.size, e.id, true);
    this.add(e);
    this.pushUnitsOut(tx, ty, d.size);
    if (d.cat === 'extractor') {
      const c = this.resources.find((r) => r.kind === 'crystal' && r.alive && r.tx === tx && r.ty === ty);
      if (c) c.extractor = e.id;
    }
    return e;
  }

  spawnResource(kind: 'mine' | 'crystal', tx: number, ty: number, amount: number): Entity {
    const e = new Entity(this.nextId++, kind, kind, -1);
    e.size = kind === 'mine' ? 3 : 2;
    e.tx = tx; e.ty = ty;
    e.x = e.px = tx + e.size / 2;
    e.y = e.py = ty + e.size / 2;
    e.radius = e.size / 2;
    e.amount = amount;
    e.hp = e.maxHp = amount;
    this.world.setRes(tx, ty, e.size, true);
    this.add(e);
    return e;
  }

  spawnPickup(kind: Kind, x: number, y: number, itemId = '', level = 0): Entity {
    const e = new Entity(this.nextId++, kind, kind === 'item' ? itemId : 'chest', -1);
    e.x = e.px = x; e.y = e.py = y;
    e.itemId = itemId;
    e.chestLevel = level;
    e.radius = 0.3;
    this.add(e);
    return e;
  }

  /** Empurra unidades que ficaram sob a pegada de um edifício novo. */
  pushUnitsOut(tx: number, ty: number, size: number) {
    this.spatial.queryRect(tx - 1, ty - 1, tx + size + 1, ty + size + 1, this.tmp);
    for (const u of this.units) {
      if (u.air || !u.alive || u.inside) continue;
      if (u.x >= tx - 0.3 && u.x <= tx + size + 0.3 && u.y >= ty - 0.3 && u.y <= ty + size + 0.3) {
        const nf = this.world.nearestFree(u.x, u.y, 6);
        if (nf) { u.x = u.px = nf[0] + 0.5; u.y = u.py = nf[1] + 0.5; u.path = null; }
      }
    }
  }

  // ------------------------------------------------------------------
  // Recursos e requisitos
  // ------------------------------------------------------------------
  canAfford(owner: number, c: Cost): boolean {
    const p = this.players[owner];
    if (!p) return false;
    return RES_KEYS.every((k) => (c[k] ?? 0) <= p.res[k] + 1e-6);
  }
  pay(owner: number, c: Cost): boolean {
    if (!this.canAfford(owner, c)) return false;
    const p = this.players[owner];
    for (const k of RES_KEYS) p.res[k] -= c[k] ?? 0;
    return true;
  }
  refund(owner: number, c: Cost, frac = 1) {
    const p = this.players[owner];
    if (!p) return;
    for (const k of RES_KEYS) p.res[k] += Math.floor((c[k] ?? 0) * frac);
  }
  scaledCost(owner: number, c: Cost): Cost {
    return c;
  }

  hasBuilding(owner: number, id: string, builtOnly = true): boolean {
    for (const b of this.buildings) if (b.owner === owner && b.alive && (!builtOnly || b.built) && satisfies(b.type, id)) return true;
    return false;
  }

  meetsReq(owner: number, reqs?: string[]): boolean {
    if (!reqs) return true;
    const p = this.players[owner];
    for (const r of reqs) {
      if (r === 'tier2') { if (p.tier < 2) return false; continue; }
      if (r === 'tier3') { if (p.tier < 3) return false; continue; }
      if (BUILDINGS[r]) { if (!this.hasBuilding(owner, r)) return false; continue; }
      if (!p.upgrades[r]) return false;
    }
    return true;
  }

  missingReqs(owner: number, reqs?: string[]): string[] {
    const out: string[] = [];
    if (!reqs) return out;
    const p = this.players[owner];
    for (const r of reqs) {
      if (r === 'tier2' && p.tier < 2) out.push('Nível 2 do centro');
      else if (r === 'tier3' && p.tier < 3) out.push('Nível 3 do centro');
      else if (BUILDINGS[r] && !this.hasBuilding(owner, r)) out.push(BUILDINGS[r].name);
      else if (!BUILDINGS[r] && r !== 'tier2' && r !== 'tier3' && !p.upgrades[r]) out.push(r);
    }
    return out;
  }

  supplyFree(owner: number): number {
    const p = this.players[owner];
    return p.supplyCap - p.supplyUsed;
  }

  recomputeSupply() {
    for (const p of this.players) {
      if (!p) continue;
      p.supplyUsed = 0;
      p.supplyCap = 0;
      let mil = 0;
      p.heroCount = 0;
      for (const u of this.units) {
        if (u.owner !== p.id || !u.alive) continue;
        p.supplyUsed += u.udef!.supply;
        if (u.udef!.cls !== 'worker') mil += u.udef!.supply;
        if (u.isHero) p.heroCount++;
      }
      let tier = 0;
      for (const b of this.buildings) {
        if (b.owner !== p.id || !b.alive) continue;
        if (b.built) p.supplyCap += b.bdef!.supply ?? 0;
        if (b.built && b.bdef!.cat === 'hall') tier = Math.max(tier, b.bdef!.tier ?? 1);
        for (let k = 0; k < Math.min(b.bqueue.length, b.bdef!.parallel ?? 1); k++) {
          const q = b.bqueue[k];
          if (q.kind === 'unit' && q.t > 0) {
            p.supplyUsed += UNITS[q.id].supply;
            if (UNITS[q.id].cls === 'hero') p.heroCount++;
          }
          if (q.kind === 'revive') p.heroCount++;
        }
      }
      for (const [, hr] of this.heroRecords) if (hr.owner === p.id) p.heroCount++;
      p.tier = Math.max(1, tier);
      // manutenção ("soldo"): exércitos acima de 30 de abastecimento custam prata
      p.upkeep = this.mode === 'skirmish' ? Math.max(0, mil - 30) * 0.7 : 0; // no feudo os soldos são diários
    }
  }

  findDropoff(owner: number, res: ResKey, x: number, y: number): Entity | null {
    let best: Entity | null = null, bd = Infinity;
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.alive || !b.built || !b.bdef!.dropoff?.includes(res)) continue;
      const d = Math.hypot(b.cx - x, b.cy - y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // Eventos
  // ------------------------------------------------------------------
  emit(k: FxKind, x: number, y: number, extra: Partial<FxEvent> = {}) {
    if (this.fx.length > 600) return;
    this.fx.push({ k, x, y, ...extra });
  }
  alert(owner: number, x: number, y: number, text: string, kind: Alert['kind'] = 'attack') {
    if (owner < 0 || owner >= 8) return;
    // limita alertas de ataque por região
    if (kind === 'attack') {
      for (const a of this.alerts)
        if (a.owner === owner && a.kind === 'attack' && this.time - a.t < 12 && Math.hypot(a.x - x, a.y - y) < 14) return;
    }
    this.alerts.push({ owner, x, y, t: this.time, text, kind });
    if (this.alerts.length > 40) this.alerts.shift();
  }
  msg(owner: number, text: string, color?: string) {
    this.messages.push({ text, t: this.time, owner, color });
    if (this.messages.length > 30) this.messages.shift();
  }

  // ------------------------------------------------------------------
  // Morte
  // ------------------------------------------------------------------
  kill(e: Entity, killer: Entity | null) {
    if (!e.alive) return;
    e.alive = false;
    e.hp = 0;
    e.order = null;
    e.queue = [];
    e.path = null;
    e.targetId = 0;
    e.killedBy = killer?.owner ?? -1;
    e.anim = 'die';
    e.animT = 0;
    const p = this.players[e.owner];
    if (e.kind === 'building') {
      e.dying = 2.2;
      this.world.setBuilding(e.tx, e.ty, e.size, e.id, false);
      this.emit('collapse', e.cx, e.cy, { a: e.size });
      if (p) {
        p.stats.buildingsLost++;
        this.alert(e.owner, e.cx, e.cy, `${e.bdef!.name} destruído(a)!`, 'attack');
        for (const q of e.bqueue) if (q.kind === 'revive' && q.heroId) {/* registro permanece */}
      }
      if (killer && this.players[killer.owner]) this.players[killer.owner].stats.razed++;
      if (e.bdef!.cat === 'extractor') {
        for (const r of this.resources) if (r.extractor === e.id) r.extractor = 0;
      }
      this.recomputeSupply();
    } else if (e.kind === 'unit') {
      e.dying = e.isHero ? 2.4 : 1.8;
      if (e.inside) this.releaseFromMine(e);
      this.emit('death', e.x, e.y, { owner: e.owner });
      if (p) p.stats.lost++;
      if (killer && this.players[killer.owner]) this.players[killer.owner].stats.kills++;
      // experiência para heróis inimigos próximos
      if (killer && e.udef!.cls !== 'summon') grantXp(this, e, killer);
      // recompensa por criaturas neutras
      if (e.owner === NEUTRAL_HOSTILE && killer && this.players[killer.owner]) {
        const b = e.udef!.bounty ?? 0;
        this.players[killer.owner].res.silver += b;
        if (b) this.emit('text', e.x, e.y - 1, { text: `+${b}`, color: '#ffd76a' });
      }
      if (e.campId >= 0) this.onCampUnitDeath(e);
      if (e.isHero && p) {
        this.heroRecords.set(e.id, { owner: e.owner, type: e.type, level: e.level, xp: e.xp, skills: { ...e.skills }, items: [...e.items], skillPts: e.skillPts });
        this.alert(e.owner, e.x, e.y, `${e.udef!.name} tombou em batalha!`, 'hero');
      }
    }
  }

  releaseFromMine(e: Entity) {
    const m = this.ents.get(e.insideId);
    if (m) m.workers = Math.max(0, m.workers - 1);
    e.inside = false;
    e.insideId = 0;
  }

  private onCampUnitDeath(e: Entity) {
    const c = this.camps[e.campId];
    if (!c || c.cleared) return;
    const alive = c.units.filter((id) => this.ents.get(id)?.alive);
    if (alive.length === 0) {
      c.cleared = true;
      const table = c.level >= 3 ? ITEM_DROP_TABLE.high : c.level === 2 ? ITEM_DROP_TABLE.mid : ITEM_DROP_TABLE.low;
      this.spawnPickup('item', e.x, e.y, this.rng.pick(table));
      if (c.level >= 4) this.spawnPickup('item', e.x + 0.8, e.y, this.rng.pick(ITEM_DROP_TABLE.high));
    }
  }

  removeEntity(e: Entity) {
    e.removed = true;
    this.ents.delete(e.id);
  }

  // ------------------------------------------------------------------
  // Névoa
  // ------------------------------------------------------------------
  updateFog(pid: number) {
    const fog = this.fogs[pid];
    if (!fog) return;
    const viewers: Viewer[] = [];
    for (const u of this.units) {
      if (!u.alive || u.inside || !this.sharesVision(pid, u.owner)) continue;
      viewers.push({ x: u.x, y: u.y, sight: getSight(this, u), air: u.air });
    }
    for (const b of this.buildings) {
      if (!b.alive || !this.sharesVision(pid, b.owner)) continue;
      viewers.push({ x: b.cx, y: b.cy, sight: getSight(this, b), air: b.bdef!.cat === 'defense' });
    }
    const extra = this.reveals.filter((r) => this.sharesVision(pid, r.owner));
    fog.compute(this.world, viewers, extra);
    // memória de edifícios inimigos vistos (fantasmas)
    let gm = this.ghosts.get(pid);
    if (!gm) { gm = new Map(); this.ghosts.set(pid, gm); }
    for (const b of this.buildings) {
      if (this.sharesVision(pid, b.owner)) continue;
      if (fog.rectVisible(b.tx, b.ty, b.size)) {
        if (b.alive) gm.set(b.id, { type: b.type, tx: b.tx, ty: b.ty, size: b.size, owner: b.owner });
        else gm.delete(b.id);
      }
    }
    for (const [id, gh] of gm) {
      const b = this.ents.get(id);
      if ((!b || !b.alive) && fog.rectVisible(gh.tx, gh.ty, gh.size)) gm.delete(id);
    }
  }

  sharesVision(pid: number, owner: number): boolean {
    return owner === pid || (owner >= 0 && owner < 8 && this.rel[pid]?.[owner] === 'ally');
  }

  /** O jogador "pid" vê esta entidade agora? */
  canSee(pid: number, e: Entity): boolean {
    if (this.sharesVision(pid, e.owner)) return true;
    const fog = this.fogs[pid];
    if (!fog) return true;
    if (e.kind === 'unit') return !e.inside && fog.visible(e.x, e.y);
    if (e.kind === 'building' || e.kind === 'mine' || e.kind === 'crystal') return fog.rectVisible(e.tx, e.ty, e.size);
    return fog.visible(e.x, e.y);
  }

  // ------------------------------------------------------------------
  // Laço principal
  // ------------------------------------------------------------------
  update() {
    const t0 = performance.now();
    const dt = this.dt;
    this.tick++;
    this.time += dt;
    this.path.resetBudget();

    // hash espacial + contagem de atacantes
    this.spatial.clear();
    for (const u of this.units) {
      u.attackers = 0;
      if (u.alive && !u.inside) this.spatial.insert(u);
    }
    for (const b of this.buildings) b.attackers = 0;
    for (const u of this.units) {
      if (u.alive && u.targetId) {
        const t = this.ents.get(u.targetId);
        if (t) t.attackers++;
      }
    }

    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      u.px = u.x; u.py = u.y;
      if (u.alive) updateUnit(this, u, dt);
      else if (u.dying > 0) { u.dying -= dt; u.animT += dt; }
    }
    for (const b of this.buildings) {
      if (b.alive) updateBuilding(this, b, dt);
      else if (b.dying > 0) b.dying -= dt;
    }
    updateProjectiles(this, dt);
    processPending(this);
    if (this.tick % 10 === 0) updateAuras(this);
    if (this.tick % 10 === 5) this.recomputeSupply();
    if (this.tick % 20 === 0) { this.economyTick(); if (this.realm) realmSecond(this); }

    // pickups (baús)
    if (this.tick % 4 === 0) this.updatePickups();

    // revelações temporárias
    if (this.reveals.length) this.reveals = this.reveals.filter((r) => (r.t -= dt) > 0);

    // névoa (escalonada por jogador)
    const tf = performance.now();
    for (const p of this.players) if (p && (this.tick + p.id) % 5 === 0) this.updateFog(p.id);
    this.perf.fogMs = this.perf.fogMs * 0.9 + (performance.now() - tf) * 0.1;

    // IA (escalonada)
    const ta = performance.now();
    for (const ai of this.ais) if (!this.players[ai.playerId].defeated) ai.update(this);
    this.perf.aiMs = this.perf.aiMs * 0.9 + (performance.now() - ta) * 0.1;

    // tréguas expiradas
    if (this.tick % 20 === 0) this.updateDiplomacy();
    if (this.tick % 40 === 0) this.checkVictory();

    // limpeza
    if (this.tick % 10 === 0) this.compact();
    this.perf.simMs = this.perf.simMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private economyTick() {
    // a cada 1s
    for (const p of this.players) {
      if (!p || p.defeated) continue;
      const charge = p.upkeep / 60;
      if (charge > 0) {
        if (p.res.silver >= charge + p.debt) { p.res.silver -= charge + p.debt; p.debt = 0; }
        else { p.debt = Math.min(400, p.debt + charge - p.res.silver); p.res.silver = 0; }
      } else if (p.debt > 0 && p.res.silver > 0) {
        const pay = Math.min(p.debt, p.res.silver);
        p.debt -= pay; p.res.silver -= pay;
      }
      if (p.aetherAcc >= 1) {
        const a = Math.floor(p.aetherAcc);
        p.res.aether += a; p.stats.gathered.aether += a; p.aetherAcc -= a;
      }
    }
  }

  private updatePickups() {
    for (const c of this.pickups) {
      if (!c.alive || c.kind !== 'chest') continue;
      this.spatial.queryRadius(c.x, c.y, 1.1, this.tmp);
      const u = this.tmp.find((t) => t.alive && t.owner >= 0 && t.owner < 8 && !t.air);
      if (u) {
        const p = this.players[u.owner];
        const s = 150 * c.chestLevel, w = 100 * c.chestLevel;
        p.res.silver += s; p.res.wood += w;
        this.emit('text', c.x, c.y - 1, { text: `+${s} prata +${w} madeira`, color: '#ffd76a' });
        this.emit('spell', c.x, c.y);
        this.spawnPickup('item', c.x + 0.6, c.y, this.rng.pick(ITEM_DROP_TABLE.mid));
        c.alive = false;
        this.removeEntity(c);
        this.msg(u.owner, 'Tesouro encontrado nas ruínas!', '#ffd76a');
      }
    }
  }

  private updateDiplomacy() {
    for (let a = 0; a < 8; a++)
      for (let b = a + 1; b < 8; b++) {
        const t = this.truceUntil[a]?.[b];
        if (t && this.time > t && this.rel[a][b] === 'peace') {
          this.setRelation(a, b, 'war');
          if (this.players[a] && this.players[b]) {
            this.msg(a, `A trégua com ${this.players[b].name} terminou.`, '#ff9a6a');
            this.msg(b, `A trégua com ${this.players[a].name} terminou.`, '#ff9a6a');
          }
        }
      }
  }

  checkVictory() {
    if (this.mode === 'province') {
      // a província só se perde quando não resta nenhum edifício
      const p = this.players[0];
      if (!p.defeated && !this.buildings.some((b) => b.owner === 0 && b.alive)) { p.defeated = true; this.over = true; }
      return;
    }
    if (this.mode === 'battle') {
      const att = this.units.some((u) => u.owner === 0 && u.alive);
      const hall = this.buildings.some((b) => b.owner === 1 && b.alive && b.bdef!.cat === 'hall');
      if (!att) { this.players[0].defeated = true; this.over = true; this.winnerTeam = 1; }
      else if (!hall) { this.players[1].defeated = true; this.over = true; this.winnerTeam = 0; }
      return;
    }
    for (const p of this.players) {
      if (!p || p.defeated) continue;
      const hasB = this.buildings.some((b) => b.owner === p.id && b.alive);
      if (!hasB) {
        p.defeated = true;
        for (const u of this.units) if (u.owner === p.id && u.alive) this.kill(u, null);
        for (const q of this.players) if (q && q.id !== p.id) this.msg(q.id, `${p.name} foi derrotado(a)!`, '#ff6a6a');
      }
    }
    const alive = this.players.filter((p) => p && !p.defeated);
    if (alive.length === 0) { this.over = true; return; }
    // todos os sobreviventes aliados entre si?
    const allAllied = alive.every((a) => alive.every((b) => this.isAlly(a.id, b.id)));
    if (allAllied && !this.over) {
      this.over = true;
      this.winnerTeam = alive[0].id;
    }
  }

  private compact() {
    const keep = (e: Entity) => !e.removed && (e.alive || e.dying > 0);
    const before = this.units.length + this.buildings.length;
    for (const e of this.units) if (!e.alive && e.dying <= 0 && !e.removed) this.removeEntity(e);
    for (const e of this.buildings) if (!e.alive && e.dying <= 0 && !e.removed) this.removeEntity(e);
    this.units = this.units.filter(keep);
    this.buildings = this.buildings.filter(keep);
    this.resources = this.resources.filter((r) => !r.removed);
    this.pickups = this.pickups.filter((r) => !r.removed && r.alive);
    if (before !== this.units.length + this.buildings.length) {
      this.bspatial.clear();
      for (const b of this.buildings) if (b.alive) this.bspatial.insert(b);
    }
  }

  rebuildBSpatial() {
    this.bspatial.clear();
    for (const b of this.buildings) if (b.alive) this.bspatial.insert(b);
  }

  // ------------------------------------------------------------------
  // Utilidades de consulta
  // ------------------------------------------------------------------
  /** Distância da borda de "t" até o ponto (para alcance). */
  edgeDist(x: number, y: number, t: Entity): number {
    if (t.kind === 'unit' || t.kind === 'item' || t.kind === 'chest') return Math.max(0, Math.hypot(t.x - x, t.y - y) - t.radius);
    const dx = Math.max(t.tx - x, 0, x - (t.tx + t.size));
    const dy = Math.max(t.ty - y, 0, y - (t.ty + t.size));
    return Math.hypot(dx, dy);
  }

  unitsOf(owner: number): Entity[] {
    return this.units.filter((u) => u.owner === owner && u.alive);
  }
  buildingsOf(owner: number): Entity[] {
    return this.buildings.filter((b) => b.owner === owner && b.alive);
  }

  /** Recalcula vida/mana após pesquisas ou itens. */
  refreshStats(owner: number) {
    this.modCache.delete(owner * 1000);
    const bm = buildingMods(this, owner);
    for (const b of this.buildings) {
      if (b.owner !== owner || !b.alive) continue;
      const nm = b.bdef!.hp * (1 + bm.hpMul);
      if (Math.abs(nm - b.maxHp) > 0.5) { b.hp *= nm / b.maxHp; b.maxHp = nm; }
    }
    for (const u of this.units) {
      if (u.owner !== owner || !u.alive) continue;
      this.refreshUnit(u);
    }
  }
  refreshUnit(u: Entity) {
    const d = u.udef!;
    const m = modsFor(this, u.owner, u.type, d.cls);
    const nm = d.hero ? heroMaxHp(u) : d.hp * (1 + m.hpMul);
    if (Math.abs(nm - u.maxHp) > 0.5) { u.hp = Math.max(1, u.hp + (nm - u.maxHp)); u.maxHp = nm; }
    const mm = d.hero ? heroMaxMana(this, u) : (d.mana ?? 0) + m.mana;
    if (mm !== u.maxMana) { u.mana = Math.min(mm, u.mana + Math.max(0, mm - u.maxMana)); u.maxMana = mm; }
  }

  factionOf(owner: number) {
    return FACTIONS[this.players[owner]?.faction ?? 'valmir'];
  }
}

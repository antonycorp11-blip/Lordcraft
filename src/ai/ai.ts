import { BUILDINGS, FACTIONS, RESEARCHES, UNITS } from '../data/factions';
import type { UnitClass } from '../data/types';
import type { Entity } from '../sim/entity';
import { NEUTRAL_HOSTILE } from '../sim/entity';
import type { Game } from '../sim/game';
import { power } from '../sim/stats';
import {
  issueBuild, issueGather, issueMove, issueRetreat, train, research, upgrade, canTrain, canResearch, canUpgrade, revive,
  issueAttack, setRally,
} from '../sim/commands';
import { canPlaceAt, findNearestResource } from '../sim/units';
import { propose, militaryPower, warsOf } from '../sim/diplomacy';

// ============================================================================
// Inteligência artificial: joga com as mesmas regras e comandos do jogador.
// Economia independente, construção, tecnologia, expansão, exploração e guerra.
// ============================================================================

export type Personality = 'expansionista' | 'agressiva' | 'defensiva' | 'oportunista' | 'equilibrada';
export type Difficulty = 'facil' | 'normal' | 'dificil';
export const PERSONALITIES: Personality[] = ['equilibrada', 'agressiva', 'defensiva', 'expansionista', 'oportunista'];
export const PERSONALITY_NAMES: Record<Personality, string> = {
  equilibrada: 'Equilibrada', agressiva: 'Agressiva', defensiva: 'Defensiva', expansionista: 'Expansionista', oportunista: 'Oportunista',
};

interface Squad {
  id: number;
  units: number[];
  role: 'attack' | 'defend' | 'creep' | 'scout';
  tx: number; ty: number;
  targetOwner: number;
  targetId: number;
  state: 'gather' | 'march' | 'fight' | 'retreat';
  startPower: number;
  t: number;
  lastOrder: number;
}

interface Base { hall: Entity; mine: Entity | null }

const tmpE: Entity[] = [];

export class AIController {
  playerId: number;
  pers: Personality;
  diff: Difficulty;
  squads: Squad[] = [];
  squadSeq = 1;
  timers = { econ: 0, build: 0, mil: 0, strat: 0, squad: 0, diplo: 0, scout: 0 };
  log: string[] = [];
  starts: { x: number; y: number; checked: boolean }[] = [];
  scoutId = 0;
  plan: { type: string; worker: number; t: number } | null = null;
  expanding: { mine: number; t: number } | null = null;
  reserve = { silver: 0, wood: 0, aether: 0 };
  seenAir = 0;
  seenTotal = 0;
  seenTowers = 0;
  attackedAt = -999;
  lastAttackLaunch = -999;
  waves = 0;
  mainEnemy = -1;
  decision = '';
  upgradeWanted = false;
  expandWanted = false;

  constructor(playerId: number, pers: Personality, diff: Difficulty) {
    this.playerId = playerId;
    this.pers = pers;
    this.diff = diff;
  }

  toJSON() {
    const { log, ...rest } = this as any;
    return { ...rest, log: log.slice(-20) };
  }
  static from(o: any): AIController {
    const a = new AIController(o.playerId, o.pers, o.diff);
    Object.assign(a, o);
    return a;
  }

  private note(g: Game, s: string) {
    const m = Math.floor(g.time / 60), sec = Math.floor(g.time % 60);
    this.log.push(`[${m}:${String(sec).padStart(2, '0')}] ${s}`);
    if (this.log.length > 60) this.log.shift();
    this.decision = s;
  }

  get speedMul() { return this.diff === 'facil' ? 2.2 : this.diff === 'dificil' ? 0.7 : 1; }

  update(g: Game) {
    const p = g.players[this.playerId];
    if (p.defeated) return;
    if (!this.starts.length) this.initKnowledge(g);
    const now = g.time;
    const T = this.timers;
    const sm = this.speedMul;
    // espalha o custo entre ticks (cada IA em fase diferente)
    if (now >= T.econ) { T.econ = now + 1.0 * sm; this.economy(g); }
    else if (now >= T.build) { T.build = now + 2.0 * sm; this.buildPlanner(g); this.researchPlanner(g); }
    else if (now >= T.mil) { T.mil = now + 1.5 * sm; this.production(g); }
    else if (now >= T.squad) { T.squad = now + 1.0 * (this.diff === 'facil' ? 2 : 1); this.observe(g); this.squadsUpdate(g); }
    else if (now >= T.strat) { T.strat = now + 4 * sm; this.strategy(g); }
    else if (now >= T.scout) { T.scout = now + 5; this.scouting(g); }
    else if (now >= T.diplo) { T.diplo = now + 45; this.diplomacy(g); }
  }

  // --------------------------------------------------------------------------
  // Conhecimento
  // --------------------------------------------------------------------------
  private initKnowledge(g: Game) {
    const me = g.players[this.playerId];
    for (const p of g.players) {
      if (!p || p.id === this.playerId) continue;
      this.starts.push({ x: p.startX, y: p.startY, checked: false });
    }
    // embaralha determinístico para não visitar todos na mesma ordem
    this.starts.sort((a, b) => Math.hypot(a.x - me.startX, a.y - me.startY) - Math.hypot(b.x - me.startX, b.y - me.startY));
    this.timers.econ = g.time + this.playerId * 0.13;
    this.timers.build = g.time + 0.5 + this.playerId * 0.17;
    this.timers.mil = g.time + 1 + this.playerId * 0.11;
    this.timers.squad = g.time + 1.5;
    this.timers.strat = g.time + 3;
    this.timers.scout = g.time + 50 + this.playerId * 7;
    this.timers.diplo = g.time + 240;
  }

  private observe(g: Game) {
    const fog = g.fogs[this.playerId];
    let air = 0, tot = 0;
    for (const u of g.units) {
      if (!u.alive || !g.isEnemy(this.playerId, u.owner) || u.owner === NEUTRAL_HOSTILE) continue;
      if (!fog.visible(u.x, u.y)) continue;
      if (u.udef!.cls === 'worker') continue;
      tot++;
      if (u.air) air++;
    }
    if (tot > 0) {
      this.seenAir = this.seenAir * 0.8 + air * 0.2;
      this.seenTotal = this.seenTotal * 0.8 + tot * 0.2;
    }
    const gm = g.ghosts.get(this.playerId);
    let towers = 0;
    if (gm) for (const gh of gm.values()) if (BUILDINGS[gh.type]?.attack) towers++;
    this.seenTowers = towers;
    for (const s of this.starts) if (!s.checked && fog.explored(s.x, s.y) && fog.visible(s.x, s.y)) s.checked = true;
  }

  /** Edifícios inimigos conhecidos (memória de névoa). */
  private knownEnemyBuildings(g: Game): { id: number; x: number; y: number; owner: number; type: string }[] {
    const gm = g.ghosts.get(this.playerId);
    const out: { id: number; x: number; y: number; owner: number; type: string }[] = [];
    if (!gm) return out;
    for (const [id, gh] of gm) {
      if (!g.isEnemy(this.playerId, gh.owner) || gh.owner === NEUTRAL_HOSTILE) continue;
      if (g.players[gh.owner]?.defeated) continue;
      out.push({ id, x: gh.tx + gh.size / 2, y: gh.ty + gh.size / 2, owner: gh.owner, type: gh.type });
    }
    return out;
  }

  private bases(g: Game): Base[] {
    const out: Base[] = [];
    for (const b of g.buildings) {
      if (b.owner !== this.playerId || !b.alive || b.bdef!.cat !== 'hall') continue;
      let mine: Entity | null = null, bd = 13;
      for (const r of g.resources) {
        if (!r.alive || r.kind !== 'mine') continue;
        const d = Math.hypot(r.cx - b.cx, r.cy - b.cy);
        if (d < bd) { bd = d; mine = r; }
      }
      out.push({ hall: b, mine });
    }
    return out;
  }

  private mainBase(g: Game): Entity | null {
    let best: Entity | null = null;
    for (const b of g.buildings) if (b.owner === this.playerId && b.alive && b.bdef!.cat === 'hall' && (!best || b.id < best.id)) best = b;
    return best;
  }

  private homePoint(g: Game): [number, number] {
    const h = this.mainBase(g);
    const p = g.players[this.playerId];
    const hx = h?.cx ?? p.startX, hy = h?.cy ?? p.startY;
    const cx = g.world.w / 2, cy = g.world.h / 2;
    const d = Math.hypot(cx - hx, cy - hy) || 1;
    const x = hx + ((cx - hx) / d) * 9, y = hy + ((cy - hy) / d) * 9;
    const nf = g.world.nearestFree(x, y, 6);
    return nf ? [nf[0] + 0.5, nf[1] + 0.5] : [hx, hy + 5];
  }

  // --------------------------------------------------------------------------
  // Economia
  // --------------------------------------------------------------------------
  private economy(g: Game) {
    const pid = this.playerId;
    const p = g.players[pid];
    const f = FACTIONS[p.faction];
    const bases = this.bases(g);
    const workers = g.units.filter((u) => u.owner === pid && u.alive && u.isWorker);
    const silverPer = p.faction === 'durn' ? 4 : 5;
    let silverTarget = 0;
    for (const b of bases) if (b.mine && b.hall.built) silverTarget += silverPer;
    let woodTarget = Math.min(14, 4 + p.tier * 2 + bases.length);
    if (p.res.wood > 500 + p.res.silver) woodTarget = 3;
    const crystals = this.nearCrystals(g, bases);
    const aetherTarget = p.tier >= 2 && p.faction !== 'durn' ? Math.min(4, crystals.length * 2) : 0;
    const desired = silverTarget + woodTarget + aetherTarget + 2;

    // treina trabalhadores
    const queued = g.buildings.reduce((s, b) => s + (b.owner === pid ? b.bqueue.filter((q) => q.id === f.worker).length : 0), 0);
    if (workers.length + queued < Math.min(desired, 70) && p.debt <= 0) {
      for (const b of bases) {
        if (!b.hall.built || b.hall.upgrading || b.hall.bqueue.length >= 2) continue;
        if ((this.upgradeWanted || this.heroWanted(g)) && b.hall.id === this.mainBase(g)?.id && workers.length >= 8) continue;
        if (train(g, pid, b.hall.id, f.worker)) {
          if (b.mine) setRally(g, pid, [b.hall.id], b.mine.cx, b.mine.cy, b.mine.id);
          break;
        }
      }
    }

    // contagem de atribuições
    const onMine = new Map<number, number>();
    let onWood = 0, onAether = 0;
    const idle: Entity[] = [];
    for (const w of workers) {
      if (w.id === this.scoutId) continue;
      const o = w.order;
      if (!o) { idle.push(w); continue; }
      if (o.t === 'gather') {
        if (o.tile !== undefined && o.tile >= 0) onWood++;
        else {
          const r = g.ents.get(o.target);
          if (r?.kind === 'mine') onMine.set(r.id, (onMine.get(r.id) ?? 0) + 1);
          else if (r?.kind === 'crystal') onAether++;
        }
      } else if (o.t === 'stop' || o.t === 'move') { if (!w.queue.length && o.t === 'stop') idle.push(w); }
    }
    // rebalanceia: excesso na mina vai para madeira
    for (const b of bases) {
      if (!b.mine) continue;
      const n = onMine.get(b.mine.id) ?? 0;
      if (n > silverPer + 2) {
        const extra = workers.find((w) => w.order?.t === 'gather' && w.order.target === b.mine!.id && !w.inside && !w.carry);
        if (extra) idle.push(extra);
      }
    }
    for (const w of idle) {
      // prioridade: prata da base mais próxima com déficit
      let job: 'silver' | 'wood' | 'aether' = 'wood';
      let mine: Entity | null = null;
      let bd = Infinity;
      for (const b of bases) {
        if (!b.mine || !b.hall.built) continue;
        const n = onMine.get(b.mine.id) ?? 0;
        if (n >= silverPer) continue;
        const d = Math.hypot(b.mine.cx - w.x, b.mine.cy - w.y);
        if (d < bd) { bd = d; mine = b.mine; }
      }
      if (mine) job = 'silver';
      else if (onAether < aetherTarget && crystals.length) job = 'aether';
      if (job === 'silver' && mine) {
        issueGather(g, pid, [w.id], mine);
        onMine.set(mine.id, (onMine.get(mine.id) ?? 0) + 1);
      } else if (job === 'aether') {
        const c = crystals.sort((a, b) => Math.hypot(a.cx - w.x, a.cy - w.y) - Math.hypot(b.cx - w.x, b.cy - w.y))[0];
        issueGather(g, pid, [w.id], c);
        onAether++;
      } else {
        const tile = this.findWood(g, w, bases);
        if (tile >= 0) { issueGather(g, pid, [w.id], null, tile); onWood++; }
        else if (bases[0]?.mine) issueGather(g, pid, [w.id], bases[0].mine);
      }
    }
  }

  private heroWanted(g: Game): boolean {
    const pid = this.playerId;
    const p = g.players[pid];
    const f = FACTIONS[p.faction];
    if (p.heroCount > 0 || !g.hasBuilding(pid, f.ai.core[0])) return false;
    return true;
  }

  private nearCrystals(g: Game, bases: Base[]): Entity[] {
    return g.resources.filter((r) => r.alive && r.kind === 'crystal' && !r.extractor && bases.some((b) => Math.hypot(r.cx - b.hall.cx, r.cy - b.hall.cy) < 16));
  }

  private findWood(g: Game, w: Entity, bases: Base[]): number {
    const pid = this.playerId;
    const drop = g.findDropoff(pid, 'wood', w.x, w.y) ?? bases[0]?.hall;
    if (!drop) return -1;
    const W = g.world;
    let best = -1, bd = Infinity;
    const cx = Math.floor(drop.cx), cy = Math.floor(drop.cy);
    for (let r = 3; r <= 22 && best < 0; r += 3) {
      for (let y = cy - r; y <= cy + r; y++)
        for (let x = cx - r; x <= cx + r; x++) {
          if (!W.inside(x, y)) continue;
          const i = W.idx(x, y);
          if (!W.tree[i]) continue;
          if (!(W.free(x + 1, y) || W.free(x - 1, y) || W.free(x, y + 1) || W.free(x, y - 1))) continue;
          const d = (x - cx) ** 2 + (y - cy) ** 2 + ((x * 7 + y * 13 + w.id) % 5);
          if (d < bd) { bd = d; best = i; }
        }
    }
    return best;
  }

  // --------------------------------------------------------------------------
  // Construção
  // --------------------------------------------------------------------------
  private countB(g: Game, type: string, includeUnbuilt = true): number {
    let n = 0;
    for (const b of g.buildings) if (b.owner === this.playerId && b.alive && (includeUnbuilt || b.built) && (b.type === type || BUILDINGS[b.type].upgradesTo === undefined && false)) n++;
    return n;
  }
  private countCat(g: Game, cat: string): number {
    let n = 0;
    for (const b of g.buildings) if (b.owner === this.playerId && b.alive && b.bdef!.cat === cat) n++;
    return n;
  }

  private buildPlanner(g: Game) {
    const pid = this.playerId;
    const p = g.players[pid];
    const f = FACTIONS[p.faction];
    this.reserve = { silver: 0, wood: 0, aether: 0 };
    // construção pendente
    if (this.plan) {
      const w = g.ents.get(this.plan.worker);
      if (!w || !w.alive || w.order?.t !== 'build' || w.order.site || g.time - this.plan.t > 60) this.plan = null;
      else return;
    }
    const bases = this.bases(g);
    if (!bases.length) {
      this.tryExpand(g, true);
      return;
    }
    this.upgradeWanted = false;
    const want = this.wantedBuilding(g, bases);
    if (!want) {
      if (this.expandWanted) {
        const hc = BUILDINGS[f.hall].cost;
        this.reserve = { silver: hc.silver ?? 0, wood: hc.wood ?? 0, aether: 0 };
      }
      return;
    }
    if (want === '__upgrade') return;
    const d = BUILDINGS[want];
    if (!g.canAfford(pid, d.cost)) {
      this.reserve = { silver: d.cost.silver ?? 0, wood: d.cost.wood ?? 0, aether: d.cost.aether ?? 0 };
      return;
    }
    const spot = this.findSpot(g, want, bases);
    if (!spot) { this.note(g, `Sem espaço para ${d.name}`); return; }
    const worker = this.pickBuilder(g, spot[0], spot[1]);
    if (!worker) return;
    if (issueBuild(g, pid, worker.id, want, spot[0], spot[1])) {
      this.plan = { type: want, worker: worker.id, t: g.time };
      this.note(g, `Construindo ${d.name}`);
    }
  }

  private wantedBuilding(g: Game, bases: Base[]): string | null {
    const pid = this.playerId;
    const p = g.players[pid];
    const f = FACTIONS[p.faction];
    const has = (id: string) => g.hasBuilding(pid, id, false);
    const unbuiltHouse = g.buildings.some((b) => b.owner === pid && b.alive && !b.built && b.bdef!.cat === 'house');
    const prodCount = this.countCat(g, 'production');
    const margin = 4 + prodCount * 3;
    const workers = g.units.filter((u) => u.owner === pid && u.alive && u.isWorker).length;
    const t = g.time;

    const unbuiltHouses = g.buildings.filter((b) => b.owner === pid && b.alive && !b.built && b.bdef!.cat === 'house').length;
    const free = p.supplyCap - p.supplyUsed;
    // abastecimento crítico
    if (free < 3 && unbuiltHouses === 0) return f.houses;

    const core = f.ai.core;
    const barracks = core[0];
    if (!has(barracks) && workers >= 7) return barracks;
    if (!has(core[1]) && workers >= 9) return core[1];
    if (!has(core[2]) && has(barracks) && t > 150) return core[2];
    if (free < margin && unbuiltHouses < 1 + Math.floor(prodCount / 2)) return f.houses;

    // evolução do centro
    const main = this.mainBase(g)!;
    if (main && main.built && !main.upgrading && main.bdef!.upgradesTo) {
      const nd = BUILDINGS[main.bdef!.upgradesTo];
      const readyT2 = nd.tier === 2 && has(barracks) && workers >= 12 && t > (this.pers === 'agressiva' ? 330 : 260);
      const readyT3 = nd.tier === 3 && t > 720 && this.countTechT2(g) >= 2;
      this.upgradeWanted = readyT2 || readyT3;
      if (this.upgradeWanted && main.bqueue.length) {
        // espera a fila esvaziar e guarda recursos
        this.reserve = { silver: nd.cost.silver ?? 0, wood: nd.cost.wood ?? 0, aether: nd.cost.aether ?? 0 };
        return '__upgrade';
      }
      if ((readyT2 || readyT3) && canUpgrade(g, pid, main).ok) {
        if (g.canAfford(pid, nd.cost)) { upgrade(g, pid, main.id); this.note(g, `Evoluindo para ${nd.name}`); }
        else this.reserve = { silver: nd.cost.silver ?? 0, wood: nd.cost.wood ?? 0, aether: nd.cost.aether ?? 0 };
        return '__upgrade';
      }
    }

    // edifícios tecnológicos
    for (const id of core.slice(3)) {
      const d = BUILDINGS[id];
      if (!has(id) && g.meetsReq(pid, d.requires)) return id;
    }
    // Durn: extrator de éter
    if (p.faction === 'durn' && p.tier >= 2 && this.countB(g, 'd_extrator') < 2) {
      const c = this.nearCrystals(g, bases)[0];
      if (c) return 'd_extrator';
    }
    // Kragg: tambores
    if (p.faction === 'kragg' && p.tier >= 2 && !has('k_tambores')) return 'k_tambores';

    // mais produção conforme a economia
    const incomeBases = bases.filter((b) => b.mine).length;
    const wantProd = 1 + (p.tier >= 2 ? 1 : 0) + Math.max(0, incomeBases - 1) + (this.pers === 'agressiva' ? 1 : 0) + (t > 900 ? 1 : 0);
    if (this.countB(g, barracks) < wantProd && p.res.silver > 350) return barracks;

    // torres
    const towerType = f.buildings.find((b) => BUILDINGS[b].cat === 'defense')!;
    const towers = this.countB(g, towerType);
    const wantTowers = (this.pers === 'defensiva' ? 2 + bases.length * 2 : 0) + (g.time - this.attackedAt < 120 ? bases.length : 0);
    if (towers < Math.min(wantTowers, 10) && t > 200) return towerType;
    return null;
  }

  private countTechT2(g: Game): number {
    return g.buildings.filter((b) => b.owner === this.playerId && b.alive && b.built && b.bdef!.requires?.includes('tier2')).length;
  }

  private pickBuilder(g: Game, x: number, y: number): Entity | null {
    let best: Entity | null = null, bd = Infinity;
    for (const u of g.units) {
      if (u.owner !== this.playerId || !u.alive || !u.isWorker || u.inside || u.id === this.scoutId) continue;
      if (u.order?.t === 'build') continue;
      const wood = u.order?.t === 'gather' && u.order.tile !== undefined;
      const d = Math.hypot(u.x - x, u.y - y) * (wood ? 0.7 : 1) + (u.carry ? 3 : 0);
      if (d < bd) { bd = d; best = u; }
    }
    return best;
  }

  /** Busca em espiral um local válido, mantendo corredores e a trilha da mina livres. */
  findSpot(g: Game, type: string, bases: Base[]): [number, number] | null {
    const d = BUILDINGS[type];
    const pid = this.playerId;
    if (d.cat === 'extractor') {
      const c = this.nearCrystals(g, bases)[0];
      return c ? [c.tx, c.ty] : null;
    }
    const base = d.cat === 'defense'
      ? bases[Math.floor(g.rng.next() * bases.length)]
      : bases[0];
    const hall = base.hall, mine = base.mine;
    const cx = hall.cx, cy = hall.cy;
    const s = d.size;
    const r0 = d.cat === 'defense' ? 5 : 4;
    for (let r = r0; r < 20; r += 1) {
      const steps = Math.max(8, Math.floor(r * 3));
      const off = g.rng.next() * Math.PI * 2;
      for (let k = 0; k < steps; k++) {
        const a = off + (k / steps) * Math.PI * 2;
        const tx = Math.round(cx + Math.cos(a) * r - s / 2), ty = Math.round(cy + Math.sin(a) * r - s / 2);
        if (!canPlaceAt(g, pid, type, tx, ty).ok) continue;
        // margem livre ao redor (evita fechar caminhos)
        let okm = true;
        for (let y = ty - 1; y <= ty + s && okm; y++)
          for (let x = tx - 1; x <= tx + s && okm; x++) {
            if (x >= tx && x < tx + s && y >= ty && y < ty + s) continue;
            const i = g.world.idx(x, y);
            if (!g.world.inside(x, y) || (g.world.block[i] & (1 | 4 | 8))) okm = false;
          }
        if (!okm) continue;
        // não bloquear a trilha mina-centro
        if (mine) {
          const bx = tx + s / 2, by = ty + s / 2;
          if (distToSeg(bx, by, hall.cx, hall.cy, mine.cx, mine.cy) < s / 2 + 2.2) continue;
          if (Math.hypot(bx - mine.cx, by - mine.cy) < s / 2 + 3) continue;
        }
        return [tx, ty];
      }
    }
    return null;
  }

  private researchPlanner(g: Game) {
    const pid = this.playerId;
    const p = g.players[pid];
    if (p.debt > 0 || g.time < 200) return;
    for (const b of g.buildings) {
      if (b.owner !== pid || !b.alive || !b.built || b.bqueue.length || !b.bdef!.researches) continue;
      for (const rid of b.bdef!.researches) {
        if (!canResearch(g, pid, b, rid).ok) continue;
        const r = RESEARCHES[rid];
        if (!this.affordWithReserve(g, r.cost)) continue;
        research(g, pid, b.id, rid);
        this.note(g, `Pesquisando ${r.name}`);
        return;
      }
    }
  }

  private affordWithReserve(g: Game, c: { silver?: number; wood?: number; aether?: number }): boolean {
    const p = g.players[this.playerId];
    return p.res.silver - this.reserve.silver >= (c.silver ?? 0) && p.res.wood - this.reserve.wood >= (c.wood ?? 0) && p.res.aether - this.reserve.aether >= (c.aether ?? 0);
  }

  // --------------------------------------------------------------------------
  // Produção militar
  // --------------------------------------------------------------------------
  private production(g: Game) {
    const pid = this.playerId;
    const p = g.players[pid];
    const f = FACTIONS[p.faction];
    if (p.debt > 0) return;
    // herói
    const hall = this.mainBase(g);
    if (hall && hall.built && !hall.upgrading && g.hasBuilding(pid, f.ai.core[0])) {
      const rec = [...g.heroRecords.entries()].find(([, r]) => r.owner === pid);
      if (rec) revive(g, pid, hall.id, rec[0]);
      else if (canTrain(g, pid, hall, f.hero).ok && hall.bqueue.length < 2) {
        train(g, pid, hall.id, f.hero);
        this.note(g, 'Convocando herói');
      }
    }
    // composição atual
    const counts: Partial<Record<UnitClass, number>> = {};
    let total = 0;
    for (const u of g.units) {
      if (u.owner !== pid || !u.alive) continue;
      const c = u.udef!.cls;
      if (c === 'worker' || c === 'hero' || c === 'summon') continue;
      counts[c] = (counts[c] ?? 0) + 1;
      total++;
    }
    const comp = { ...f.ai.comp };
    const airRatio = this.seenTotal > 0 ? this.seenAir / this.seenTotal : 0;
    if (this.pers === 'defensiva') comp.ranged = (comp.ranged ?? 0) + 0.1;
    if (this.pers === 'agressiva') comp.melee = (comp.melee ?? 0) + 0.1;
    if (this.seenTowers >= 3) comp.siege = (comp.siege ?? 0) + 0.1;
    for (const b of g.buildings) {
      if (b.owner !== pid || !b.alive || !b.built || b.upgrading || !b.bdef!.trains) continue;
      if (b.bdef!.cat === 'hall') continue;
      const slots = (b.bdef!.parallel ?? 1) + 1;
      if (b.bqueue.length >= slots) continue;
      let best: string | null = null, bs = -Infinity;
      for (const uid of b.bdef!.trains) {
        const d = UNITS[uid];
        if (!g.meetsReq(pid, d.requires)) continue;
        const share = total ? (counts[d.cls] ?? 0) / total : 0;
        let score = (comp[d.cls] ?? 0.05) - share;
        if (airRatio > 0.2 && f.ai.antiAir.includes(uid)) score += 0.3 * airRatio * 2;
        if (d.cls === 'siege' && (counts.siege ?? 0) >= 6) score -= 1;
        score += g.rng.next() * 0.05;
        if (score > bs) { bs = score; best = uid; }
      }
      if (!best) continue;
      const d = UNITS[best];
      if (!this.affordWithReserve(g, d.cost)) continue;
      const [rx, ry] = this.homePoint(g);
      if (!b.rally) setRally(g, pid, [b.id], rx, ry);
      train(g, pid, b.id, best);
    }
  }

  // --------------------------------------------------------------------------
  // Estratégia
  // --------------------------------------------------------------------------
  private army(g: Game): Entity[] {
    return g.units.filter((u) => u.owner === this.playerId && u.alive && u.udef!.cls !== 'worker' && u.udef!.speed > 0 && u.id !== this.scoutId);
  }
  private homePool(g: Game): Entity[] {
    const used = new Set<number>();
    for (const s of this.squads) for (const id of s.units) used.add(id);
    return this.army(g).filter((u) => !used.has(u.id));
  }
  private sumPower(us: Entity[]) { return us.reduce((s, u) => s + power(u), 0); }

  private enemyPowerNear(g: Game, x: number, y: number, r: number): { power: number; n: number; cx: number; cy: number; air: number } {
    const fog = g.fogs[this.playerId];
    g.spatial.queryRadius(x, y, r, tmpE);
    let pw = 0, n = 0, cx = 0, cy = 0, air = 0;
    for (const u of tmpE) {
      if (!u.alive || !g.isEnemy(this.playerId, u.owner) || !fog.visible(u.x, u.y)) continue;
      if (u.owner === NEUTRAL_HOSTILE && Math.hypot(u.x - u.campX, u.y - u.campY) < 4) continue;
      pw += power(u); n++; cx += u.x; cy += u.y; if (u.air) air++;
    }
    g.bspatial.queryRadius(x, y, r + 2, tmpE);
    for (const b of tmpE) if (b.alive && b.bdef!.attack && g.isEnemy(this.playerId, b.owner) && fog.rectVisible(b.tx, b.ty, b.size)) pw += power(b);
    return { power: pw, n, cx: n ? cx / n : x, cy: n ? cy / n : y, air };
  }

  private strategy(g: Game) {
    const pid = this.playerId;
    const p = g.players[pid];
    const bases = this.bases(g);
    // 1. ameaças às bases
    let threat: { power: number; cx: number; cy: number; n: number } | null = null;
    for (const b of g.buildings) {
      if (b.owner !== pid || !b.alive) continue;
      if (g.time - b.lastHitT > 8 && b.bdef!.cat !== 'hall') continue;
      const ep = this.enemyPowerNear(g, b.cx, b.cy, 14);
      if (ep.n > 0 && (!threat || ep.power > threat.power)) threat = ep;
    }
    for (const w of g.units) {
      if (w.owner !== pid || !w.alive || !w.isWorker || g.time - w.lastHitT > 4) continue;
      const ep = this.enemyPowerNear(g, w.x, w.y, 10);
      if (ep.n > 0 && (!threat || ep.power > threat.power)) threat = ep;
    }
    const home = this.homePool(g);
    if (threat) {
      this.attackedAt = g.time;
      const defenders = [...home];
      const homePw = this.sumPower(home);
      // chama de volta esquadrões ofensivos se a ameaça for grande
      if (threat.power > homePw * 0.9) {
        for (const s of this.squads) {
          if (s.role === 'attack' && Math.hypot(s.tx - threat.cx, s.ty - threat.cy) > 25) {
            s.role = 'defend'; s.state = 'march';
            this.note(g, 'Recuando exército para defender a base!');
          }
          if (s.role === 'defend' || s.role === 'creep') for (const id of s.units) { const u = g.ents.get(id); if (u?.alive) defenders.push(u); }
        }
        this.squads = this.squads.filter((s) => s.role === 'attack');
      }
      if (defenders.length) {
        issueMove(g, pid, defenders.map((u) => u.id), threat.cx, threat.cy, { attack: true, formation: 'loose' });
        if (g.rng.chance(0.3)) this.note(g, `Defendendo território (${threat.n} invasores)`);
      }
      return;
    } else {
      // tropas da reserva voltam ao ponto de reunião
      const [hx, hy] = this.homePoint(g);
      const stray = home.filter((u) => !u.order && Math.hypot(u.x - hx, u.y - hy) > 14);
      if (stray.length) issueMove(g, pid, stray.map((u) => u.id), hx, hy, { formation: 'block' });
    }

    // 2. expansão
    this.tryExpand(g, false);

    // 3. ataque, ou caça de criaturas neutras
    const homePower = this.sumPower(home);
    const military = home.length;
    const attacking = this.squads.some((s) => s.role === 'attack');
    const minutes = g.time / 60;
    const thresholds: Record<Personality, number> = { agressiva: 8, equilibrada: 13, expansionista: 14, oportunista: 11, defensiva: 22 };
    const minTime: Record<Personality, number> = { agressiva: 4.5, equilibrada: 6.5, expansionista: 8, oportunista: 6, defensiva: 11 };
    let need = thresholds[this.pers] + this.waves * 3;
    if (this.diff === 'facil') need += 6;
    if (this.diff === 'dificil') need -= 2;
    const workers = g.units.filter((u) => u.owner === pid && u.alive && u.isWorker).length;
    const weakEconomy = workers < 8 && minutes > 6;

    if (!attacking && military >= need && minutes >= minTime[this.pers] && !weakEconomy) {
      const target = this.pickTarget(g, homePower);
      if (target) {
        const keepFrac = this.pers === 'defensiva' ? 0.35 : this.pers === 'equilibrada' ? 0.15 : 0.08;
        const sorted = [...home].sort((a, b) => a.id - b.id);
        const keep = Math.floor(sorted.length * keepFrac);
        const go = sorted.slice(keep);
        // exército enorme: ataca por duas frentes
        const second = go.length >= 30 && this.pers !== 'defensiva' ? this.pickTarget(g, homePower * 0.5, target) : null;
        if (second) {
          const half = Math.floor(go.length / 2);
          this.launch(g, go.slice(0, half), target);
          this.launch(g, go.slice(half), second);
          this.note(g, `Ataque em duas frentes contra ${g.players[target.owner].name} e ${g.players[second.owner].name}`);
        } else {
          this.launch(g, go, target);
          this.note(g, `Ataque contra ${g.players[target.owner]?.name ?? '?'} (${go.length} unidades)`);
        }
        this.waves++;
        this.lastAttackLaunch = g.time;
        return;
      } else if (!this.knownEnemyBuildings(g).length && military >= need) {
        // não conhece inimigos: explora locais iniciais com o exército
        const s = this.starts.find((st) => !st.checked) ?? this.starts[Math.floor(g.rng.next() * this.starts.length)];
        if (s) {
          this.launch(g, home, { x: s.x, y: s.y, owner: -1, id: 0 });
          this.note(g, 'Marchando para encontrar inimigos');
        }
        return;
      }
    }

    // reforços para ataques em andamento
    if (attacking && home.length >= 6 && g.time - this.attackedAt > 30) {
      const s = this.squads.find((q) => q.role === 'attack' && q.state !== 'retreat');
      if (s) {
        const send = home.slice(0, Math.floor(home.length * 0.7));
        s.units.push(...send.map((u) => u.id));
        issueMove(g, pid, send.map((u) => u.id), s.tx, s.ty, { attack: true, formation: 'block' });
        this.note(g, `Enviando ${send.length} reforços para a frente`);
      }
    }

    // 4. caça a acampamentos neutros (experiência para o herói, itens, liberar expansões)
    const hero = g.units.find((u) => u.owner === pid && u.alive && u.isHero);
    if (!attacking && !this.squads.some((s) => s.role === 'creep') && home.length >= 4 && minutes > 2.5) {
      const camp = this.pickCamp(g, homePower);
      if (camp) {
        const s = this.newSquad('creep', home, camp.x, camp.y, -1, 0);
        issueMove(g, pid, s.units, camp.x, camp.y, { attack: true, formation: 'loose' });
        this.note(g, `Atacando acampamento neutro (nível ${camp.level})${hero ? ' com o herói' : ''}`);
      }
    }
  }

  private pickCamp(g: Game, pw: number) {
    const fog = g.fogs[this.playerId];
    const h = this.mainBase(g);
    if (!h) return null;
    let best: (typeof g.camps)[number] | null = null, bd = Infinity;
    for (const c of g.camps) {
      if (c.cleared || !fog.explored(c.x, c.y)) continue;
      let cp = 0;
      for (const id of c.units) { const u = g.ents.get(id); if (u?.alive) cp += power(u); }
      if (cp * 1.6 > pw) continue;
      const d = Math.hypot(c.x - h.cx, c.y - h.cy);
      if (d > 60) continue;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  private pickTarget(g: Game, pw: number, exclude?: { owner: number; id: number }): { x: number; y: number; owner: number; id: number } | null {
    const known = this.knownEnemyBuildings(g);
    if (!known.length) return null;
    const h = this.mainBase(g);
    const hx = h?.cx ?? g.players[this.playerId].startX, hy = h?.cy ?? g.players[this.playerId].startY;
    // escolhe inimigo principal conforme a personalidade
    let best: (typeof known)[number] | null = null, bs = Infinity;
    for (const b of known) {
      if (exclude && (b.id === exclude.id || Math.hypot(b.x - (known.find((k) => k.id === exclude.id)?.x ?? -999), b.y - (known.find((k) => k.id === exclude.id)?.y ?? -999)) < 20)) continue;
      const d = Math.hypot(b.x - hx, b.y - hy);
      const def = this.enemyPowerNear(g, b.x, b.y, 12).power;
      const isHall = BUILDINGS[b.type]?.cat === 'hall';
      const enemyPw = militaryPower(g, b.owner);
      let s = d;
      switch (this.pers) {
        case 'agressiva': s = d * 0.8 + (isHall ? -10 : 0); break;
        case 'oportunista': s = d * 0.5 + def * 0.15 + enemyPw * 0.02 - (isHall ? 0 : 8); break;
        case 'expansionista': s = d + (isHall ? 4 : -6); break;
        case 'defensiva': s = d + def * 0.2; break;
        default: s = d + def * 0.08 + (isHall ? -4 : 0);
      }
      if (b.owner === this.mainEnemy) s -= 8;
      if (def > pw * 1.2) s += 200;
      if (g.players[b.owner]?.ai === false && this.diff === 'facil') s += 10;
      if (s < bs) { bs = s; best = b; }
    }
    if (best) this.mainEnemy = best.owner;
    return best;
  }

  private newSquad(role: Squad['role'], units: Entity[], tx: number, ty: number, owner: number, targetId: number): Squad {
    const s: Squad = {
      id: this.squadSeq++, units: units.map((u) => u.id), role, tx, ty, targetOwner: owner, targetId,
      state: 'march', startPower: this.sumPower(units), t: 0, lastOrder: 0,
    };
    this.squads.push(s);
    return s;
  }

  private launch(g: Game, units: Entity[], target: { x: number; y: number; owner: number; id: number }) {
    if (!units.length) return;
    const s = this.newSquad('attack', units, target.x, target.y, target.owner, target.id);
    s.state = 'gather';
    const [hx, hy] = this.homePoint(g);
    issueMove(g, this.playerId, s.units, hx, hy, { formation: 'block' });
    s.lastOrder = g.time;
  }

  private squadsUpdate(g: Game) {
    const pid = this.playerId;
    for (const s of this.squads) {
      s.units = s.units.filter((id) => g.ents.get(id)?.alive);
      s.t += 1;
    }
    this.squads = this.squads.filter((s) => s.units.length > 0);
    for (const s of this.squads) {
      const us = s.units.map((id) => g.ents.get(id)!);
      let cx = 0, cy = 0;
      for (const u of us) { cx += u.x; cy += u.y; }
      cx /= us.length; cy /= us.length;
      const pw = this.sumPower(us);
      const local = this.enemyPowerNear(g, cx, cy, 13);

      // recuo organizado ao perder a batalha
      if (this.diff !== 'facil' && s.role !== 'scout' && s.state !== 'retreat' && pw < s.startPower * 0.45 && local.power > pw * 1.15) {
        s.state = 'retreat';
        issueRetreat(g, pid, s.units);
        this.note(g, 'Batalha perdida — recuando para reorganizar');
        continue;
      }
      if (s.state === 'retreat') {
        const [hx, hy] = this.homePoint(g);
        if (Math.hypot(cx - hx, cy - hy) < 14 || s.t > 60) { s.units = []; }
        continue;
      }
      if (s.state === 'gather') {
        const [hx, hy] = this.homePoint(g);
        const near = us.filter((u) => Math.hypot(u.x - hx, u.y - hy) < 8).length;
        if (near >= us.length * 0.75 || g.time - s.lastOrder > 25) {
          s.state = 'march';
          s.startPower = pw;
          s.lastOrder = 0;
        } else continue;
      }
      if (s.role === 'creep') {
        const camp = g.camps.find((c) => Math.hypot(c.x - s.tx, c.y - s.ty) < 2);
        if (!camp || camp.cleared || s.t > 90) {
          // coleta itens próximos com o herói
          const hero = us.find((u) => u.isHero);
          if (hero && hero.items.includes(null)) {
            const it = g.pickups.find((i) => i.alive && i.kind === 'item' && Math.hypot(i.x - hero.x, i.y - hero.y) < 10);
            if (it) { hero.queue = []; hero.order = { t: 'pickup', target: it.id }; }
          }
          s.units = [];
        } else if (g.time - s.lastOrder > 8) {
          const idle = us.filter((u) => !u.order);
          if (idle.length) issueMove(g, pid, idle.map((u) => u.id), s.tx, s.ty, { attack: true, formation: 'loose' });
          s.lastOrder = g.time;
        }
        continue;
      }
      // ataque / defesa: avanço coeso por etapas
      const dist = Math.hypot(s.tx - cx, s.ty - cy);
      if (s.role === 'attack') {
        const tgt = s.targetId ? g.ents.get(s.targetId) : null;
        const gm = g.ghosts.get(pid);
        const stillKnown = s.targetId ? gm?.has(s.targetId) || (tgt && tgt.alive) : true;
        if (!stillKnown || (tgt && !tgt.alive)) {
          // próximo alvo próximo do mesmo inimigo
          const next = this.knownEnemyBuildings(g).filter((b) => Math.hypot(b.x - cx, b.y - cy) < 30).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy))[0];
          if (next) { s.tx = next.x; s.ty = next.y; s.targetId = next.id; s.targetOwner = next.owner; s.lastOrder = 0; }
          else {
            const t2 = this.pickTarget(g, pw);
            if (t2 && Math.hypot(t2.x - cx, t2.y - cy) < 80 && pw > s.startPower * 0.6) { s.tx = t2.x; s.ty = t2.y; s.targetId = t2.id; s.targetOwner = t2.owner; s.lastOrder = 0; }
            else { s.units = []; this.note(g, 'Ofensiva concluída — retornando'); continue; }
          }
        }
        if (!s.targetId && dist < 6) {
          // destino exploratório alcançado
          s.units = [];
          continue;
        }
      }
      if (g.time - s.lastOrder > 6) {
        s.lastOrder = g.time;
        const spread = us.reduce((m, u) => Math.max(m, Math.hypot(u.x - cx, u.y - cy)), 0);
        if (dist > 16 && spread > 12 && us.length > 5) {
          // reagrupa no centróide antes de continuar
          issueMove(g, pid, s.units, cx, cy, { attack: true, formation: 'block' });
        } else if (dist > 18) {
          const step = Math.min(dist, 16);
          const wx = cx + ((s.tx - cx) / dist) * step, wy = cy + ((s.ty - cy) / dist) * step;
          issueMove(g, pid, s.units, wx, wy, { attack: true, formation: 'line' });
          s.state = 'march';
        } else {
          s.state = 'fight';
          const idle = us.filter((u) => !u.order || u.order.t === 'move');
          const tgt = s.targetId ? g.ents.get(s.targetId) : null;
          if (tgt && tgt.alive && g.canSee(pid, tgt) && local.n === 0) issueAttack(g, pid, idle.map((u) => u.id), tgt.id);
          else issueMove(g, pid, idle.map((u) => u.id), s.tx, s.ty, { attack: true, formation: 'loose' });
        }
      }
    }
    this.squads = this.squads.filter((s) => s.units.length > 0);
  }

  // --------------------------------------------------------------------------
  // Expansão
  // --------------------------------------------------------------------------
  private tryExpand(g: Game, urgent: boolean) {
    const pid = this.playerId;
    const p = g.players[pid];
    const f = FACTIONS[p.faction];
    if (this.expanding) {
      const w = g.ents.get(this.expanding.mine);
      if (!w || g.time - this.expanding.t > 120) this.expanding = null;
      else {
        const pending = g.units.some((u) => u.owner === pid && u.alive && u.order?.t === 'build' && u.order.type === f.hall && !u.order.site);
        if (!pending && g.time - this.expanding.t > 5) this.expanding = null;
        return;
      }
    }
    const bases = this.bases(g);
    const minutes = g.time / 60;
    const main = bases[0];
    const mainLow = main?.mine ? main.mine.amount < 4000 : true;
    let want = urgent || mainLow;
    if (this.pers === 'expansionista' && minutes > 4 && bases.length < 2 + Math.floor(minutes / 6)) want = true;
    if (this.pers !== 'defensiva' && minutes > 9 && bases.length < 2) want = true;
    if (minutes > 16 && bases.length < 3 && this.pers !== 'defensiva') want = true;
    this.expandWanted = want;
    if (!want) return;
    const hallCost = BUILDINGS[f.hall].cost;
    if (!g.canAfford(pid, hallCost)) { this.reserve = { silver: hallCost.silver ?? 0, wood: hallCost.wood ?? 0, aether: 0 }; return; }
    const fog = g.fogs[pid];
    const hx = main?.hall.cx ?? p.startX, hy = main?.hall.cy ?? p.startY;
    // minas exploradas sem centro próximo
    const candidates = g.resources
      .filter((r) => r.alive && r.kind === 'mine' && r.amount > 2500 && fog.explored(r.cx, r.cy))
      .filter((r) => !g.buildings.some((b) => b.alive && b.bdef!.cat === 'hall' && Math.hypot(b.cx - r.cx, b.cy - r.cy) < 12))
      .sort((a, b) => Math.hypot(a.cx - hx, a.cy - hy) - Math.hypot(b.cx - hx, b.cy - hy));
    for (const m of candidates.slice(0, 3)) {
      // guardas neutros?
      const guard = g.camps.find((c) => !c.cleared && Math.hypot(c.x - m.cx, c.y - m.cy) < 10);
      if (guard) {
        if (!this.squads.some((s) => s.role === 'creep')) {
          const home = this.homePool(g);
          let cp = 0;
          for (const id of guard.units) { const u = g.ents.get(id); if (u?.alive) cp += power(u); }
          if (this.sumPower(home) > cp * 1.4) {
            const s = this.newSquad('creep', home, guard.x, guard.y, -1, 0);
            issueMove(g, pid, s.units, guard.x, guard.y, { attack: true, formation: 'loose' });
            this.note(g, 'Limpando guardiões de uma expansão');
          }
        }
        continue;
      }
      // inimigos visíveis perto?
      if (this.enemyPowerNear(g, m.cx, m.cy, 12).n > 2) continue;
      const spot = this.hallSpot(g, m);
      if (!spot) continue;
      const w = this.pickBuilder(g, spot[0], spot[1]);
      if (!w) return;
      if (issueBuild(g, pid, w.id, f.hall, spot[0], spot[1])) {
        this.expanding = { mine: m.id, t: g.time };
        this.note(g, `Expandindo para nova jazida (${Math.round(m.amount)} prata)`);
      }
      return;
    }
  }

  private hallSpot(g: Game, m: Entity): [number, number] | null {
    const f = FACTIONS[g.players[this.playerId].faction];
    let best: [number, number] | null = null, bd = Infinity;
    const cx = g.world.w / 2, cy = g.world.h / 2;
    for (let r = 5; r <= 9; r++)
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2;
        const tx = Math.round(m.cx + Math.cos(ang) * r - 2), ty = Math.round(m.cy + Math.sin(ang) * r - 2);
        if (!canPlaceAt(g, this.playerId, f.hall, tx, ty).ok) continue;
        // prefere o lado oposto à borda do mapa
        const d = r * 2 + Math.hypot(tx + 2 - cx, ty + 2 - cy) * 0.15;
        if (d < bd) { bd = d; best = [tx, ty]; }
      }
    return best;
  }

  // --------------------------------------------------------------------------
  // Exploração
  // --------------------------------------------------------------------------
  private scouting(g: Game) {
    const pid = this.playerId;
    const sc = this.scoutId ? g.ents.get(this.scoutId) : null;
    const target = this.starts.find((s) => !s.checked);
    if (!target) {
      if (sc && sc.alive && sc.isWorker) { sc.order = null; sc.queue = []; }
      this.scoutId = 0;
      return;
    }
    if (sc && sc.alive) {
      if (!sc.order) issueMove(g, pid, [sc.id], target.x, target.y);
      return;
    }
    if (g.time < 60) return;
    // escolhe unidade rápida, senão um trabalhador
    const fast = this.homePool(g).filter((u) => !u.isHero).sort((a, b) => b.udef!.speed - a.udef!.speed)[0];
    const unit = fast ?? g.units.find((u) => u.owner === pid && u.alive && u.isWorker && !u.inside && !u.carry && u.order?.t === 'gather');
    if (!unit) return;
    this.scoutId = unit.id;
    issueMove(g, pid, [unit.id], target.x, target.y);
    this.note(g, 'Enviando batedor para explorar');
  }

  // --------------------------------------------------------------------------
  // Diplomacia
  // --------------------------------------------------------------------------
  private diplomacy(g: Game) {
    const pid = this.playerId;
    const wars = warsOf(g, pid);
    if (wars.length < 2 || this.pers === 'agressiva') return;
    const mine = militaryPower(g, pid);
    // propõe trégua ao inimigo mais forte que não é o alvo principal
    const strongest = wars.map((id) => ({ id, pw: militaryPower(g, id) })).sort((a, b) => b.pw - a.pw)[0];
    if (strongest && strongest.id !== this.mainEnemy && strongest.pw > mine * 1.3) {
      const r = propose(g, pid, strongest.id, 'truce');
      this.note(g, `Propôs trégua a ${g.players[strongest.id].name}: ${r === 'accepted' ? 'aceita' : r === 'pending' ? 'aguardando' : 'recusada'}`);
    }
  }
}

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

void findNearestResource;

import { BUILDINGS, FACTIONS, UNITS } from '../data/factions';
import type { FactionId } from '../data/types';
import { Rng } from '../core/rng';
import { MAPS, generateMap } from '../world/mapgen';
import { Game, type GameSetupPlayer } from './game';
import { NEUTRAL_HOSTILE, NEUTRAL_PASSIVE, PLAYER_COLORS, Player, type Entity } from './entity';
import { createRealm, type DynastyOptions } from '../realm/create';
import { RAIDER, defenderStrength, unitPower } from '../realm/war';
import type { Army, ArmyUnit, Realm } from '../realm/types';
import { AIController, type Difficulty, type Personality } from '../ai/ai';

export interface MatchConfig {
  mapId: string;
  seed: number;
  players: (GameSetupPlayer & { start?: number })[];
  reveal?: boolean;
  startRes?: { silver: number; wood: number; aether: number };
}

export function createGame(cfg: MatchConfig): { game: Game; ais: AIController[] } {
  const tpl = MAPS.find((m) => m.id === cfg.mapId) ?? MAPS[0];
  const rng = new Rng(cfg.seed);
  const nStarts = tpl.starts.length;
  const players = cfg.players.slice(0, nStarts);
  // posições iniciais
  const free = Array.from({ length: nStarts }, (_, i) => i).filter((i) => !players.some((p) => p.start === i));
  for (let i = free.length - 1; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); [free[i], free[j]] = [free[j], free[i]]; }
  const startOf = players.map((p) => (p.start !== undefined && p.start >= 0 && p.start < nStarts ? p.start : free.shift()!));
  const biomes: number[] = [];
  for (let s = 0; s < nStarts; s++) {
    const k = startOf.indexOf(s);
    biomes[s] = k >= 0 ? FACTIONS[players[k].faction].biome : (s + 1) % 4;
  }
  const gen = generateMap(tpl, cfg.seed, biomes);
  const g = new Game(gen.world, cfg.seed, tpl.id);
  g.decor = gen.decor;

  players.forEach((sp, i) => {
    const p = new Player(i, sp.name, sp.color, sp.faction as FactionId, sp.ai, sp.team);
    p.personality = sp.personality ?? 'equilibrada';
    p.difficulty = sp.difficulty ?? 'normal';
    const st = gen.starts[startOf[i]];
    p.startX = st.x; p.startY = st.y;
    if (cfg.startRes) p.res = { ...cfg.startRes };
    g.addPlayer(p);
  });
  g.initRelations();

  for (const m of gen.mines) g.spawnResource('mine', m.x, m.y, m.amount);
  for (const c of gen.crystals) g.spawnResource('crystal', c.x, c.y, c.amount);

  for (const p of g.players) {
    const f = FACTIONS[p.faction];
    const hall = g.placeBuilding(f.hall, p.id, p.startX - 2, p.startY - 2, true);
    // mina mais próxima
    let mine = g.resources[0], bd = Infinity;
    for (const r of g.resources) {
      if (r.kind !== 'mine') continue;
      const d = Math.hypot(r.cx - hall.cx, r.cy - hall.cy);
      if (d < bd) { bd = d; mine = r; }
    }
    for (let k = 0; k < 5; k++) {
      const t = (k + 1) / 6;
      const x = hall.cx + (mine.cx - hall.cx) * t * 0.7 + (k % 2 ? 0.8 : -0.8);
      const y = hall.cy + (mine.cy - hall.cy) * t * 0.7 + 1;
      const w = g.spawnUnit(f.worker, p.id, x, y);
      w.order = { t: 'gather', target: mine.id };
    }
    hall.rally = { x: mine.cx, y: mine.cy, target: mine.id };
  }

  // criaturas neutras
  gen.camps.forEach((c, ci) => {
    const camp = { id: ci, x: c.x, y: c.y, level: c.level, units: [] as number[], cleared: false };
    c.units.forEach((type, k) => {
      const a = (k / c.units.length) * Math.PI * 2;
      const r = c.units.length > 1 ? 1.1 : 0;
      const u = g.spawnUnit(type, NEUTRAL_HOSTILE, c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      u.campId = ci; u.campX = u.x; u.campY = u.y;
      u.facing = Math.cos(a) > 0 ? -1 : 1;
      camp.units.push(u.id);
    });
    g.camps.push(camp);
  });
  for (const n of gen.neutrals) g.placeBuilding(n.type, NEUTRAL_PASSIVE, n.x, n.y, true);
  for (const c of gen.chests) g.spawnPickup('chest', c.x, c.y, '', c.level);

  g.recomputeSupply();
  for (const p of g.players) {
    if (cfg.reveal) g.fogs[p.id].revealAll = true;
    g.updateFog(p.id);
  }
  const ais: AIController[] = [];
  for (const p of g.players) {
    if (!p.ai) continue;
    const ai = new AIController(p.id, (p.personality as Personality) ?? 'equilibrada', (p.difficulty as Difficulty) ?? 'normal');
    ais.push(ai);
  }
  g.ais = ais;
  void UNITS;
  return { game: g, ais };
}

// ---------------------------------------------------------------------------
// Modo feudo: a província do jogador (sem rivais no mapa) e batalhas comandadas
// ---------------------------------------------------------------------------

export function createCampaign(o: DynastyOptions & { faction: FactionId }): { game: Game; ais: AIController[] } {
  const tpl = MAPS[0];
  const { game: g, ais } = createGame({
    mapId: tpl.id, seed: tpl.seed,
    players: [{ name: `Casa ${o.houseName}`, faction: o.faction, color: PLAYER_COLORS[0], ai: false, team: 1, start: 0 }],
  });
  addRaider(g);
  g.mode = 'province';
  g.realm = createRealm(o);
  return { game: g, ais };
}

/** Jogador reservado para tropas invasoras das casas (fica sem edifícios). */
export function addRaider(g: Game) {
  const raider = new Player(RAIDER, 'Invasores', PLAYER_COLORS[1], 'valmir', true, 9);
  raider.raider = true;
  raider.res = { silver: 0, wood: 0, aether: 0 };
  g.addPlayer(raider);
  g.initRelations();
  g.updateFog(RAIDER);
}

function silentRemove(g: Game, e: Entity) {
  if (e.kind === 'building') g.world.setBuilding(e.tx, e.ty, e.size, e.id, false);
  if (e.inside) g.releaseFromMine(e);
  e.alive = false;
  e.dying = 0;
  g.removeEntity(e);
}

function freeArea(g: Game, tx: number, ty: number, size: number): boolean {
  for (let y = ty - 1; y <= ty + size; y++)
    for (let x = tx - 1; x <= tx + size; x++) if (!g.world.inside(x, y) || !g.world.free(x, y)) return false;
  return true;
}

function placeNear(g: Game, type: string, owner: number, cx: number, cy: number, rMin: number, rMax: number): boolean {
  const size = BUILDINGS[type].size;
  for (let k = 0; k < 80; k++) {
    const a = g.rng.next() * Math.PI * 2, d = rMin + g.rng.next() * (rMax - rMin);
    const tx = Math.round(cx + Math.cos(a) * d - size / 2), ty = Math.round(cy + Math.sin(a) * d - size / 2);
    if (freeArea(g, tx, ty, size)) { g.placeBuilding(type, owner, tx, ty, true); return true; }
  }
  return false;
}

/** Batalha no mapa da província atacada: o exército do jogador contra a fortaleza da casa. */
export function createBattle(r: Realm, a: Army, faction: FactionId): { game: Game; ais: AIController[] } {
  const prov = r.provinces[a.target];
  const h = r.houses[prov.owner];
  const tpl = MAPS.find((m) => m.id === prov.mapId) ?? MAPS[2];
  const { game: g, ais } = createGame({
    mapId: tpl.id, seed: tpl.seed,
    players: [
      { name: `Casa ${r.houses[r.player].name}`, faction, color: PLAYER_COLORS[0], ai: false, team: 1, start: 0 },
      { name: `Casa ${h.name}`, faction: 'valmir', color: PLAYER_COLORS[1], ai: true, team: 2, start: 1, personality: 'defensiva', difficulty: 'normal' },
    ],
  });
  g.mode = 'battle';
  g.battle = { army: a.id, province: prov.id, house: h.id };
  const me = g.players[0], foe = g.players[1];
  // o atacante chega só com o exército
  for (const e of [...g.buildings, ...g.units]) if (e.owner === 0) silentRemove(g, e);
  me.res = { silver: 0, wood: 0, aether: 0 };
  a.units.forEach((u, i) => {
    const e = g.spawnUnit(u.type, 0, me.startX + (i % 6) - 2.5, me.startY + Math.floor(i / 6) - 1);
    if (u.hero) {
      e.level = u.hero.level; e.xp = u.hero.xp; e.skills = { ...u.hero.skills }; e.items = [...u.hero.items]; e.skillPts = u.hero.skillPts;
      e.personId = u.hero.person ?? 0;
      g.refreshUnit(e);
    }
    e.hp = e.maxHp * Math.max(0.2, Math.min(1, u.hp ?? 1));
  });
  // defesa: casas, quartel, torres e guarnição conforme a força da casa
  const hall = g.buildings.find((b) => b.owner === 1 && b.alive)!;
  const str = defenderStrength(r, h);
  placeNear(g, 'v_quartel', 1, hall.cx, hall.cy, 6, 9);
  for (let i = 0; i < 2 + Math.min(3, Math.floor(str / 700)); i++) placeNear(g, 'v_casa', 1, hall.cx, hall.cy, 5, 10);
  for (let i = 0; i < 1 + Math.min(3, Math.floor(str / 600)); i++) placeNear(g, 'v_torre', 1, hall.cx, hall.cy, 5, 8);
  let pw = str * 0.7;
  const mix: [string, number][] = [['v_lanceiro', 0.5], ['v_besteiro', 0.35], ['v_cavaleiro', 0.15]];
  let n = 0;
  while (pw > 40 && n < 24) {
    let k = g.rng.next(), type = mix[0][0];
    for (const [t, w] of mix) { if (k < w) { type = t; break; } k -= w; }
    const ang = (n / 8) * Math.PI * 2;
    g.spawnUnit(type, 1, hall.cx + Math.cos(ang) * 4.5, hall.cy + Math.sin(ang) * 4.5);
    pw -= unitPower(type);
    n++;
  }
  foe.res = { silver: Math.round(200 + Math.max(0, h.treasury) * 0.2), wood: 200, aether: 0 };
  g.recomputeSupply();
  for (const p of g.players) g.updateFog(p.id);
  return { game: g, ais };
}

/** Sobreviventes do jogador numa batalha (heróis caídos voltam feridos). */
export function battleSurvivors(g: Game): ArmyUnit[] {
  const out: ArmyUnit[] = [];
  for (const u of g.units) {
    if (!u.alive || u.owner !== 0) continue;
    const a: ArmyUnit = { type: u.type, hp: u.hp / u.maxHp };
    if (u.isHero) a.hero = { level: u.level, xp: u.xp, skills: { ...u.skills }, items: [...u.items], skillPts: u.skillPts, person: u.personId || undefined };
    out.push(a);
  }
  for (const [, rec] of g.heroRecords) if (rec.owner === 0) out.push({ type: rec.type, hp: 0.25, hero: { level: rec.level, xp: rec.xp, skills: rec.skills, items: rec.items, skillPts: rec.skillPts } });
  return out;
}

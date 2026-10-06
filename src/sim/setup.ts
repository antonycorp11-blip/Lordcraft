import { FACTIONS, UNITS } from '../data/factions';
import type { FactionId } from '../data/types';
import { Rng } from '../core/rng';
import { MAPS, generateMap } from '../world/mapgen';
import { Game, type GameSetupPlayer } from './game';
import { NEUTRAL_HOSTILE, NEUTRAL_PASSIVE, Player } from './entity';
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

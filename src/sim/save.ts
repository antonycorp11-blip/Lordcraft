import { BUILDINGS, UNITS } from '../data/factions';
import { World } from '../world/world';
import { Entity, Player } from './entity';
import { Game } from './game';

// Salvamento local: serializa o estado completo da simulação.

function b64(a: ArrayBufferView): string {
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const SKIP = new Set(['udef', 'bdef', 'path', 'pathI', 'pathKey']);

export interface SaveData {
  v: 1;
  meta: { name: string; date: string; time: number; mapId: string; faction: string; dynasty?: string };
  state: any;
  ai: any[];
}

export function serialize(g: Game, aiStates: any[], name = 'Partida'): SaveData {
  const w = g.world;
  const ents: any[] = [];
  for (const e of g.ents.values()) {
    if (e.removed) continue;
    const o: any = {};
    for (const k of Object.keys(e)) if (!SKIP.has(k)) o[k] = (e as any)[k];
    ents.push(o);
  }
  // unidades morrendo/edifícios em colapso não estão em ents, mas não importam
  const state = {
    seed: g.seed, mapId: g.mapId, tick: g.tick, time: g.time, nextId: g.nextId, rngS: g.rng.s, groupSeq: g.groupSeq,
    dayOffset: g.dayOffset, dayLength: g.dayLength, nextProjectileId: g.nextProjectileId, nextProposalId: g.nextProposalId,
    world: {
      w: w.w, h: w.h, ter: b64(w.ter), elev: b64(w.elev), biome: b64(w.biome), block: b64(w.block), cliff: b64(w.cliff),
      tree: b64(w.tree), treeKind: b64(w.treeKind), buildingAt: b64(w.buildingAt), version: w.version,
    },
    players: g.players.map((p) => (p ? { ...p } : null)),
    fogs: g.fogs.map((f) => (f ? b64(f.seen) : null)),
    fogRevealed: g.fogs.map(f => f?.revealAll ?? false),
    ents,
    camps: g.camps,
    decor: g.decor,
    rel: g.rel,
    truceUntil: g.truceUntil,
    heroRecords: [...g.heroRecords.entries()],
    ghosts: [...g.ghosts.entries()].map(([k, m]) => [k, [...m.entries()]]),
    reveals: g.reveals,
    projectiles: g.projectiles,
    over: g.over,
    winnerTeam: g.winnerTeam, pendingCasts: g.pendingCasts, proposals: g.proposals,
    realm: g.realm, mode: g.mode, battle: g.battle,
  };
  const human = g.players.find((p) => p && !p.ai);
  return {
    v: 1,
    meta: { name, date: new Date().toISOString(), time: g.time, mapId: g.mapId, faction: human?.faction ?? '', dynasty: g.realm ? g.realm.houses[g.realm.player].name : undefined },
    state: JSON.parse(JSON.stringify(state, (_key, value) => typeof value === 'number' && !Number.isFinite(value) ? { $number: String(value) } : value)),
    ai: aiStates,
  };
}

export function deserialize(data: SaveData): Game {
  if (data.v !== 1 || !data.state?.world) throw new Error('Formato de salvamento inválido');
  const s = JSON.parse(JSON.stringify(data.state), (_key, value) => value?.$number ? Number(value.$number) : value);
  const w = new World(s.world.w, s.world.h);
  w.ter = unb64(s.world.ter);
  w.elev = unb64(s.world.elev);
  w.biome = unb64(s.world.biome);
  w.block = unb64(s.world.block);
  w.cliff = unb64(s.world.cliff);
  w.tree = new Uint16Array(unb64(s.world.tree).buffer);
  w.treeKind = unb64(s.world.treeKind);
  w.buildingAt = new Int32Array(unb64(s.world.buildingAt).buffer);
  w.version = s.world.version + 1;
  const g = new Game(w, s.seed, s.mapId);
  g.tick = s.tick; g.time = s.time; g.nextId = s.nextId; g.rng.s = s.rngS; g.groupSeq = s.groupSeq; g.dayOffset = s.dayOffset;
  for (const pd of s.players) {
    if (!pd) continue;
    const p = new Player(pd.id, pd.name, pd.color, pd.faction, pd.ai, pd.team);
    Object.assign(p, pd);
    g.addPlayer(p);
  }
  s.fogs.forEach((f: string | null, i: number) => { if (f && g.fogs[i]) { g.fogs[i].seen = unb64(f); g.fogs[i].revealAll = s.fogRevealed?.[i] ?? false; g.fogs[i].version++; } });
  for (const o of s.ents) {
    const e = new Entity(o.id, o.kind, o.type, o.owner);
    Object.assign(e, o);
    if (e.kind === 'unit') e.udef = UNITS[e.type];
    if (e.kind === 'building') e.bdef = BUILDINGS[e.type];
    e.path = null;
    (g as any).add(e);
  }
  g.camps = s.camps;
  g.decor = s.decor;
  g.rel = s.rel;
  g.truceUntil = s.truceUntil;
  g.heroRecords = new Map(s.heroRecords);
  g.ghosts = new Map(s.ghosts.map(([k, arr]: [number, any[]]) => [k, new Map(arr)]));
  g.reveals = s.reveals ?? [];
  g.projectiles = s.projectiles ?? [];
  g.pendingCasts = s.pendingCasts ?? [];
  g.proposals = s.proposals ?? [];
  g.nextProjectileId = s.nextProjectileId ?? Math.max(0, ...g.projectiles.map(p => p.id)) + 1;
  g.nextProposalId = s.nextProposalId ?? Math.max(0, ...g.proposals.map(p => p.id)) + 1;
  g.winnerTeam = s.winnerTeam ?? -1;
  g.dayLength = s.dayLength ?? 420;
  g.over = s.over;
  g.realm = s.realm ?? null;
  g.mode = s.mode ?? 'skirmish';
  g.battle = s.battle ?? null;
  g.rebuildBSpatial();
  for (const u of g.units) if (u.alive && !u.inside) g.spatial.insert(u);
  g.recomputeSupply();
  for (const p of g.players) if (p) g.updateFog(p.id);
  return g;
}

const KEY = 'aldaris.saves';

export function listSaves(): { slot: string; meta: SaveData['meta'] }[] {
  try {
    const idx = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return Object.entries(idx).map(([slot, meta]) => ({ slot, meta: meta as SaveData['meta'] }))
      .sort((a, b) => b.meta.date.localeCompare(a.meta.date));
  } catch { return []; }
}

export function writeSave(slot: string, data: SaveData): boolean {
  try {
    localStorage.setItem(`${KEY}.${slot}`, JSON.stringify(data));
    const idx = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    idx[slot] = data.meta;
    localStorage.setItem(KEY, JSON.stringify(idx));
    return true;
  } catch (err) {
    console.warn('falha ao salvar', err);
    return false;
  }
}

export function readSave(slot: string): SaveData | null {
  try {
    const raw = localStorage.getItem(`${KEY}.${slot}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function deleteSave(slot: string) {
  try {
    localStorage.removeItem(`${KEY}.${slot}`);
    const idx = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    delete idx[slot];
    localStorage.setItem(KEY, JSON.stringify(idx));
  } catch { /* ignora */ }
}

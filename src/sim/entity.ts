import type { BuildingDef, FactionId, ResKey, UnitDef, Cost } from '../data/types';
import type { Pt } from '../world/path';

export type Kind = 'unit' | 'building' | 'mine' | 'crystal' | 'item' | 'chest';

export interface GroupMove {
  id: number;
  gx: number;
  gy: number;
  speed: number;
  size: number;
  useField: boolean;
}

export type Order =
  | { t: 'move'; x: number; y: number; g?: GroupMove }
  | { t: 'amove'; x: number; y: number; g?: GroupMove }
  | { t: 'attack'; target: number }
  | { t: 'hold' }
  | { t: 'stop' }
  | { t: 'patrol'; x: number; y: number; x2: number; y2: number; back?: boolean }
  | { t: 'guard'; x: number; y: number; r: number }
  | { t: 'follow'; target: number }
  | { t: 'gather'; target: number; tile?: number }
  | { t: 'return' }
  | { t: 'build'; type: string; tx: number; ty: number; paid: boolean; site?: number }
  | { t: 'repair'; target: number }
  | { t: 'cast'; ability: string; target?: number; x?: number; y?: number }
  | { t: 'retreat'; x: number; y: number }
  | { t: 'pickup'; target: number }
  | { t: 'shop'; target: number; item: string };

export interface Buff {
  id: string;
  t: number;
  armor?: number;
  dmgMul?: number;
  dmgAdd?: number;
  atkMul?: number;
  speedMul?: number;
  stun?: boolean;
  root?: boolean;
  dps?: number;
  regen?: number;
  noStun?: boolean;
  src?: number;
}

export interface QueueItem {
  kind: 'unit' | 'research' | 'upgrade' | 'revive';
  id: string;
  t: number;
  total: number;
  cost: Cost;
  heroId?: number;
}

export class Entity {
  id: number;
  kind: Kind;
  type: string;
  owner: number;
  x = 0; y = 0; px = 0; py = 0;
  hp = 1; maxHp = 1; mana = 0; maxMana = 0;
  alive = true;
  dying = 0;
  removed = false;
  radius = 0.4;
  air = false;
  udef: UnitDef | null = null;
  bdef: BuildingDef | null = null;

  // ---- unidade ----
  facing = 1;
  faceUp = false;
  vx = 0; vy = 0;
  pushX = 0; pushY = 0;
  order: Order | null = null;
  queue: Order[] = [];
  path: Pt[] | null = null;
  pathI = 0;
  pathKey = '';
  repathT = 0;
  targetId = 0;
  engageX = 0; engageY = 0;
  explicitTarget = false;
  atkCd = 0;
  swingT = -1;
  swingTarget = 0;
  anim: 'idle' | 'walk' | 'attack' | 'work' | 'die' | 'cast' = 'idle';
  animT = 0;
  carry: ResKey | null = null;
  carryAmt = 0;
  sub = 0; // sub-estado da ordem
  subT = 0; // temporizador do sub-estado
  inside = false;
  insideId = 0;
  buffs: Buff[] = [];
  cds: Record<string, number> = {};
  autocast: Record<string, boolean> = {};
  acqT = 0;
  stuckT = 0;
  bestDist = Infinity;
  slotX = 0; slotY = 0; hasSlot = false;
  idleX = 0; idleY = 0;
  passive = false; // recuo: não revida
  timedLife = 0;
  lastHitT = -99;
  lastAttacker = 0;
  attackers = 0;
  regenAcc = 0;
  killedBy = 0;

  // ---- herói ----
  level = 1;
  xp = 0;
  skillPts = 0;
  skills: Record<string, number> = {};
  items: (string | null)[] = [];
  heroDead = false;

  // ---- edifício ----
  tx = 0; ty = 0; size = 1;
  built = true;
  progress = 1;
  builders = 0;
  buildersLast = 0;
  bqueue: QueueItem[] = [];
  rally: { x: number; y: number; target?: number } | null = null;
  upgrading = false;

  // ---- recurso ----
  amount = 0;
  workers = 0; // mineradores dentro
  extractor = 0; // id do extrator sobre o cristal

  // ---- neutros ----
  campId = -1;
  campX = 0; campY = 0;
  returning = false;
  itemId = '';
  chestLevel = 0;

  constructor(id: number, kind: Kind, type: string, owner: number) {
    this.id = id;
    this.kind = kind;
    this.type = type;
    this.owner = owner;
  }

  get isUnit() { return this.kind === 'unit'; }
  get isBuilding() { return this.kind === 'building'; }
  get isHero() { return this.udef?.cls === 'hero'; }
  get isWorker() { return this.udef?.cls === 'worker'; }
  get cx() { return this.kind === 'unit' ? this.x : this.tx + this.size / 2; }
  get cy() { return this.kind === 'unit' ? this.y : this.ty + this.size / 2; }
}

export interface PlayerStats {
  gathered: Record<ResKey, number>;
  trained: number;
  lost: number;
  kills: number;
  buildingsLost: number;
  buildingsBuilt: number;
  razed: number;
}

export class Player {
  id: number;
  name: string;
  color: string;
  faction: FactionId;
  ai: boolean;
  team: number;
  res: Record<ResKey, number> = { silver: 500, wood: 200, aether: 0 };
  supplyUsed = 0;
  supplyCap = 0;
  upgrades: Record<string, number> = {};
  tier = 1;
  defeated = false;
  upkeep = 0; // prata por minuto
  debt = 0;
  aetherAcc = 0;
  heroCount = 0;
  startX = 0; startY = 0;
  personality = 'equilibrada';
  difficulty = 'normal';
  stats: PlayerStats = {
    gathered: { silver: 0, wood: 0, aether: 0 }, trained: 0, lost: 0, kills: 0, buildingsLost: 0, buildingsBuilt: 0, razed: 0,
  };
  constructor(id: number, name: string, color: string, faction: FactionId, ai: boolean, team: number) {
    this.id = id;
    this.name = name;
    this.color = color;
    this.faction = faction;
    this.ai = ai;
    this.team = team;
  }
}

export const NEUTRAL_HOSTILE = 8;
export const NEUTRAL_PASSIVE = 9;
export const PLAYER_COLORS = ['#2f74d8', '#d23b2f', '#22a38a', '#8a4fd1', '#e0b52a', '#e37a1f'];
export const PLAYER_COLOR_NAMES = ['Azul', 'Vermelho', 'Turquesa', 'Púrpura', 'Amarelo', 'Laranja'];

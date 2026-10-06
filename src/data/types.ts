// Tipos de dados puros (configuração). Nenhuma lógica nem DOM aqui.

export type ResKey = 'silver' | 'wood' | 'aether';
export const RES_KEYS: ResKey[] = ['silver', 'wood', 'aether'];
export const RES_NAMES: Record<ResKey, string> = { silver: 'Prata', wood: 'Madeira', aether: 'Éter' };
export type Cost = { silver?: number; wood?: number; aether?: number };

export type FactionId = 'valmir' | 'kragg' | 'veymar' | 'durn' | 'salinos';
export type ArmorType = 'light' | 'medium' | 'heavy' | 'fortified' | 'hero' | 'none';
export type DmgType = 'blade' | 'pierce' | 'siege' | 'arcane' | 'hero' | 'chaos';
export type UnitClass =
  | 'worker' | 'melee' | 'ranged' | 'cavalry' | 'caster' | 'siege' | 'air' | 'hero' | 'summon' | 'creep';
export type ProjStyle =
  | 'arrow' | 'bolt' | 'javelin' | 'stone' | 'boulder' | 'cannon' | 'bullet' | 'orb' | 'moon' | 'fire' | 'spit' | 'shell';

export interface AttackDef {
  dmg: [number, number];
  cd: number;
  range: number;
  type: DmgType;
  proj?: ProjStyle;
  projSpeed?: number;
  splash?: number;
  targets: 'ground' | 'air' | 'both';
  windup: number;
  minRange?: number;
  bonusVsAir?: number;
  bonusVsBuild?: number;
}

export interface GatherDef {
  carry: { silver: number; wood: number; aether: number };
  mineTime: number;      // segundos dentro da mina por viagem
  chopTime: number;      // segundos por unidade de madeira
  crystalTime: number;   // segundos por viagem de éter
  woodMode: 'chop' | 'tap'; // tap = extrai seiva sem derrubar
}

export type BodyKind =
  | 'human' | 'beastman' | 'dwarf' | 'sylvan' | 'spirit' | 'mount' | 'flyer' | 'machine'
  | 'treant' | 'golem' | 'beast' | 'spider' | 'dragon' | 'ogre' | 'turret' | 'moth' | 'vulture' | 'gyro';

export interface UnitArt {
  body: BodyKind;
  gear: string[];
  scale?: number;
}

export interface HeroDef {
  title: string;
  hpPerLvl: number;
  dmgPerLvl: number;
  manaPerLvl: number;
  armorPerLvl: number;
  abilities: string[]; // 3 básicas + 1 suprema
}

export interface UnitDef {
  id: string;
  name: string;
  faction: FactionId | 'neutral';
  cls: UnitClass;
  desc: string;
  cost: Cost;
  supply: number;
  time: number;
  hp: number;
  mana?: number;
  armor: number;
  armorType: ArmorType;
  speed: number;
  sight: number;
  radius: number;
  air?: boolean;
  mech?: boolean;
  attack?: AttackDef;
  gather?: GatherDef;
  builds?: string[];
  abilities?: string[];
  requires?: string[];
  art: UnitArt;
  xp?: number;
  bounty?: number;
  hero?: HeroDef;
  regen?: number;
  manaRegen?: number;
  timedLife?: number;
  nightSight?: number;
}

export type BuildCat =
  | 'hall' | 'house' | 'production' | 'research' | 'economy' | 'defense' | 'special' | 'wall' | 'extractor'
  | 'neutral';

export interface BuildingDef {
  id: string;
  name: string;
  faction: FactionId | 'neutral';
  cat: BuildCat;
  desc: string;
  cost: Cost;
  time: number;
  hp: number;
  armor: number;
  size: number;
  sight: number;
  arch: string;
  supply?: number;
  trains?: string[];
  researches?: string[];
  upgradesTo?: string;
  tier?: number;
  requires?: string[];
  dropoff?: ResKey[];
  attack?: AttackDef;
  parallel?: number;
  aura?: { ability: string; radius: number };
  aetherPerMin?: number;
  regen?: number;
  heroRevive?: boolean;
  invulnerable?: boolean;
  sells?: string[];
  hires?: string[];
}

export type StatKey =
  | 'dmg' | 'armor' | 'hp' | 'speed' | 'range' | 'sight' | 'carry' | 'gather' | 'bArmor' | 'bHp' | 'mana' | 'heal';

export interface Effect {
  stat: StatKey;
  add?: number;
  mul?: number;
  cls?: UnitClass[];
  units?: string[];
}

export interface ResearchDef {
  id: string;
  name: string;
  desc: string;
  cost: Cost;
  time: number;
  requires?: string[];
  effects: Effect[];
  icon: string;
}

export type AbilityKind = 'active' | 'passive' | 'aura' | 'autocast';
export type AbilityTarget = 'none' | 'enemy' | 'ally' | 'point' | 'unit';

export interface AbilityDef {
  id: string;
  name: string;
  desc: string;
  kind: AbilityKind;
  target: AbilityTarget;
  hotkey: string;
  icon: string;
  levels: number;
  ultimate?: boolean;
  range: number;
  mana: number[];
  cd: number[];
  p: Record<string, number[]>; // parâmetros por nível
}

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  kind: 'consumable' | 'passive';
  cost: number;
  icon: string;
  stats?: { dmg?: number; armor?: number; hp?: number; mana?: number; speed?: number; regen?: number };
  use?: { heal?: number; mana?: number; xp?: number };
}

export interface FactionDef {
  /** lema curto mostrado na tela inicial */
  motto?: string;
  id: FactionId;
  name: string;
  people: string;
  desc: string;
  lore: string;
  traits: string[];
  worker: string;
  hall: string;
  hero: string;
  houses: string;
  units: string[];
  buildings: string[];
  researches: string[];
  trainMul: number;
  builderMode: 'build' | 'grow';
  biome: number;
  ai: {
    comp: Partial<Record<UnitClass, number>>;
    antiAir: string[];
    siege: string[];
    core: string[]; // ordem preferencial de edifícios
  };
}

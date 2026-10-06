import { BUILDINGS, UNITS } from '../data/factions';
import type { UnitDef, BuildingDef } from '../data/types';
import { sheetStyleText, spriteSheetFor } from './sprite-anim';

const PORTRAIT_SCALE = 1.7;

// Sprites animados e camadas DOM para seleção, vida e efeitos. As formas em CSS
// ficam como base para silhuetas e estados especiais sem afetar a simulação.

function partsFor(d: UnitDef): string {
  const b = d.art.body;
  const human = `<i class="lg l"></i><i class="lg r"></i><i class="cp"></i><i class="tor"></i><i class="ar b"></i><i class="hd"></i><i class="sd"></i><i class="ar f"><i class="wp"></i></i>`;
  switch (b) {
    case 'human': case 'beastman': case 'dwarf': case 'sylvan': case 'ogre':
      return human;
    case 'mount':
      return `<i class="mt"><i class="ml a"></i><i class="ml b"></i><i class="ml c"></i><i class="ml d"></i><i class="mb"></i><i class="mtl"></i><i class="mh"></i></i>` +
        `<i class="rider"><i class="cp"></i><i class="tor"></i><i class="hd"></i><i class="sd"></i><i class="ar f"><i class="wp"></i></i></i>`;
    case 'flyer': case 'vulture':
      return `<i class="bird"><i class="wg l"></i><i class="bb"></i><i class="bt"></i><i class="bh"></i><i class="wg r"></i></i><i class="rider"><i class="tor"></i><i class="hd"></i><i class="ar f"><i class="wp"></i></i></i>`;
    case 'moth':
      return `<i class="moth"><i class="wg l"></i><i class="wg r"></i><i class="bb"></i><i class="bh"></i></i>`;
    case 'gyro':
      return `<i class="gyro"><i class="rot"></i><i class="cab"></i><i class="pil"></i><i class="tl"></i><i class="gun"></i></i>`;
    case 'spirit':
      return `<i class="wisp"><i class="glow"></i><i class="core"></i><i class="ar f"><i class="wp"></i></i></i>`;
    case 'machine':
      return `<i class="mc"><i class="wh a"></i><i class="frame"></i><i class="arm"></i><i class="load"></i><i class="wh b"></i><i class="crew"></i></i>`;
    case 'treant':
      return `<i class="lg l"></i><i class="lg r"></i><i class="trunk"></i><i class="ar b"></i><i class="crown"></i><i class="ar f"></i><i class="face"></i>`;
    case 'golem':
      return `<i class="lg l"></i><i class="lg r"></i><i class="tor"></i><i class="ar b"></i><i class="hd"></i><i class="ar f"></i><i class="rune"></i>`;
    case 'beast':
      return `<i class="bst"><i class="ml a"></i><i class="ml b"></i><i class="tail"></i><i class="bb"></i><i class="ml c"></i><i class="ml d"></i><i class="bh"></i></i>`;
    case 'spider':
      return `<i class="spd"><i class="sl l1"></i><i class="sl l2"></i><i class="sl r1"></i><i class="sl r2"></i><i class="abd"></i><i class="bb"></i><i class="eyes"></i></i>`;
    case 'dragon':
      return `<i class="drg"><i class="wg l"></i><i class="tail"></i><i class="ml a"></i><i class="ml b"></i><i class="bb"></i><i class="neck"></i><i class="bh"></i><i class="wg r"></i></i>`;
    case 'turret':
      return `<i class="tur"><i class="tri"></i><i class="gun"></i></i>`;
  }
  return human;
}

export function unitHTML(type: string): string {
  const d = UNITS[type];
  // unidades com sprite escondem o boneco em CSS: não criar suas ~9 peças poupa nós no mapa
  const parts = unitClass(type).includes('sprite-u') ? '' : partsFor(d);
  return `<i class="sh"></i><i class="ring"></i><div class="fig"><div class="bob">${parts}</div></div><i class="sprite-figure"></i>${spriteSheetFor(type) ? '<i class="sprite-anim"></i>' : ''}<i class="carry"></i><i class="hp"><b></b></i><i class="mp"><b></b></i><i class="lvl"></i>`;
}

const SPECIAL_SPRITES: Record<string, [string, number]> = {
  c_lobo: ['neutral-common', 0], c_lobo_alfa: ['neutral-common', 0],
  c_saqueador: ['neutral-common', 1], c_batedor: ['neutral-common', 2], c_ogro: ['neutral-common', 3],
  c_aranha: ['neutral-rare', 0], c_golem: ['neutral-rare', 1], c_dragao: ['neutral-rare', 2],
  y_lobo: ['neutral-rare', 3], y_lanterneiro: ['special', 0], y_mariposa: ['special', 1],
  d_golem: ['special', 2], d_torreta: ['special', 3],
};

const unitClassCache = new Map<string, string>();

export function unitClass(type: string): string {
  const cached = unitClassCache.get(type);
  if (cached) return cached;
  const cls = buildUnitClass(type);
  unitClassCache.set(type, cls);
  return cls;
}

function buildUnitClass(type: string): string {
  const d = UNITS[type];
  const f = d.faction === 'neutral' ? 'neutral' : d.faction;
  const gear = d.art.gear.map((g) => 'g-' + g).join(' ');
  const override = SPECIAL_SPRITES[type];
  const sprite = override ? ` sprite-u sp-${override[0]} sp-row-${override[1]}` :
    ['worker', 'melee', 'ranged', 'cavalry', 'caster', 'siege', 'air', 'hero'].includes(d.cls) ? ' sprite-u' : '';
  const anim = spriteSheetFor(type) ? ' sa' : '';
  return `u f-${f} b-${d.art.body} c-${d.cls} t-${d.id} ${gear}${d.air ? ' air' : ''}${d.hero ? ' hero' : ''}${sprite}${anim}`;
}

export function unitScale(type: string): number {
  return UNITS[type].art.scale ?? 1;
}

const ARCH_EXTRAS: Record<string, string> = {
  hall: '<i class="tw l"></i><i class="tw r"></i><i class="x1"></i><i class="x2"></i>',
  house: '<i class="x1"></i>',
  barracks: '<i class="x1"></i><i class="x2"></i>',
  mill: '<i class="x1"></i><i class="x2"></i>',
  forge: '<i class="x1"></i><i class="x2"></i>',
  temple: '<i class="x1"></i><i class="x2"></i>',
  workshop: '<i class="x1"></i><i class="x2"></i>',
  aviary: '<i class="x1"></i><i class="x2"></i>',
  tower: '<i class="x1"></i>',
  wall: '',
  drums: '<i class="x1"></i><i class="x2"></i>',
  extractor: '<i class="x1"></i><i class="x2"></i>',
  market: '<i class="x1"></i><i class="x2"></i>',
  mercs: '<i class="x1"></i><i class="x2"></i>',
  fountain: '<i class="x1"></i>',
};

export function buildingHTML(type: string): string {
  const d = BUILDINGS[type];
  return `<i class="sh"></i><i class="ring"></i><i class="base"></i><div class="st"><i class="wall"><i class="win w1"></i><i class="win w2"></i><i class="door"></i></i><i class="roof"></i>${ARCH_EXTRAS[d.arch] ?? ''}<i class="chim"><i class="smk"></i></i><i class="ban"></i></div><i class="scaf"></i><i class="smoke"><b></b><b></b><b></b><b></b></i><i class="fire f1"></i><i class="fire f2"></i><i class="hp"><b></b></i><i class="prog"><b></b></i>`;
}

export function buildingClass(type: string): string {
  const d: BuildingDef = BUILDINGS[type];
  const f = d.faction === 'neutral' ? 'neutral' : d.faction;
  const tier = d.tier ? ` tier${d.tier}` : '';
  const sprite = d.faction !== 'neutral' && ['hall', 'house', 'barracks', 'mill', 'forge', 'temple', 'workshop', 'tower'].includes(d.arch) ? ' sprite-b' : '';
  return `bd f-${f} a-${d.arch} s${d.size} t-${d.id}${tier}${sprite}`;
}

export function resourceHTML(kind: 'mine' | 'crystal'): string {
  if (kind === 'mine') return `<i class="sh"></i><i class="ring"></i><i class="sprite-prop"></i><i class="mound"></i><i class="cave"></i><i class="ore o1"></i><i class="ore o2"></i><i class="ore o3"></i><i class="beam"></i><i class="hp"><b></b></i>`;
  return `<i class="sh"></i><i class="ring"></i><i class="sprite-prop"></i><i class="cr c1"></i><i class="cr c2"></i><i class="cr c3"></i><i class="cr c4"></i><i class="cglow"></i>`;
}

/** Mini-retrato para a interface (reaproveita o modelo da unidade). */
export function portraitHTML(type: string, color: string): string {
  if (UNITS[type]) {
    const sheet = spriteSheetFor(type);
    if (sheet) {
      // retrato com a arte animada: primeira pose, ampliada, respirando
      const html = unitHTML(type).replace('<i class="sprite-anim"></i>', `<i class="sprite-anim" style="${sheetStyleText(sheet, PORTRAIT_SCALE)}"></i>`);
      return `<div class="${unitClass(type)} sa-still s-idle portrait" style="--tc:${color}">${html}</div>`;
    }
    return `<div class="${unitClass(type)} portrait" style="--tc:${color}">${unitHTML(type)}</div>`;
  }
  if (BUILDINGS[type]) {
    return `<div class="${buildingClass(type)} portrait" style="--tc:${color}">${buildingHTML(type)}</div>`;
  }
  return '';
}

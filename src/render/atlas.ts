import { ATLAS, type AtlasInfo } from './atlas-manifest';

// Folhas de objetos (construções, minas, cristais) geradas por tools/sprites/build_atlas.py.
// Construções: 0-1 obra, 2 pronta, 3 noite, 4-5 dano, 6 destruída, 7 destruída à noite,
// 8-15 animação da construção pronta (bandeiras, fumaça, fogo da forja...).

/** Quanto a célula é maior que a área ocupada (a arte transborda para cima e para os lados). */
const SPREAD = 1.34;

export function buildingAtlas(type: string): AtlasInfo | undefined {
  return ATLAS['b_' + type];
}

export function resourceAtlas(kind: string): AtlasInfo | undefined {
  return ATLAS[kind === 'mine' ? 'r_mine' : 'r_crystal'];
}

export interface BuildingLook { alive: boolean; built: boolean; progress: number; hpRatio: number; night: boolean; id: number }

export function buildingFrame(b: BuildingLook, now: number): number {
  if (!b.alive) return b.night ? 7 : 6;
  if (!b.built) return b.progress < 0.5 ? 0 : 1;
  if (b.hpRatio < 0.3) return 5;
  if (b.hpRatio < 0.6) return 4;
  if (b.night) return 3;
  return 8 + (Math.floor(now / 1000 * 6 + b.id * 0.37) % 8); // 6 quadros por segundo, fora de fase entre prédios
}

/** Mina/cristal: animação de brilho quando cheios; depois estágios de esgotamento. */
export function resourceFrame(kind: string, amount: number, now: number, id: number): number {
  const full = kind === 'mine' ? 8000 : 2000;
  const half = kind === 'mine' ? 3000 : 1000;
  if (amount <= 0) return 3;
  if (amount > full) return 4 + (Math.floor(now / 1000 * 4 + id * 0.41) % 4);
  return amount > half ? 1 : 2;
}

/** Tamanho e âncora do quadro para uma área de `size` tiles de `tile` px. */
export function applyAtlasStyle(el: HTMLElement, a: AtlasInfo, size: number, tile: number) {
  const foot = size * tile;
  const w = foot * SPREAD;
  const s = el.style;
  s.width = `${w}px`;
  s.height = `${w}px`;
  s.left = `${(foot - w) / 2}px`;
  s.top = `${foot - (a.baseline / a.cell) * w}px`; // base da arte na base da área
  s.backgroundImage = `url("${a.url}")`;
  s.backgroundSize = `${a.cols * 100}% ${a.rows * 100}%`;
}

export function atlasPosition(a: AtlasInfo, frame: number): string {
  const col = frame % a.cols, row = Math.floor(frame / a.cols);
  const x = a.cols > 1 ? (col / (a.cols - 1)) * 100 : 0;
  const y = a.rows > 1 ? (row / (a.rows - 1)) * 100 : 0;
  return `${x}% ${y}%`;
}

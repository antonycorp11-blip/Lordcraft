// GERADO por tools/sprites/build_sprites.py — não edite à mão.
// Folhas de animação limpas: uma linha por animação, quadros da esquerda para a direita.

import v_lavradorUrl from '../assets/sprites/v_lavrador.webp';
import v_lanceiroUrl from '../assets/sprites/v_lanceiro.webp';

// Estados da simulação; folhas podem ter variações (walk_n, work_mine, carry, ...).
export type SpriteAnimName = 'idle' | 'walk' | 'attack' | 'work' | 'cast' | 'die';
export interface SpriteAnim { row: number; frames: number; fps: number; loop: boolean }
export interface SpriteSheet {
  url: string; cols: number; rows: number;
  cellW: number; cellH: number; anchorX: number; anchorY: number;
  display: number; // altura da célula na tela, em px (antes do zoom)
  anims: Partial<Record<string, SpriteAnim>>;
}

export const SPRITE_SHEETS: Record<string, SpriteSheet> = {
  v_lavrador: { url: v_lavradorUrl, cols: 8, rows: 13, cellW: 192, cellH: 192, anchorX: 96, anchorY: 182, display: 96.0, anims: { idle_s: { row: 0, frames: 7, fps: 7, loop: true }, idle_e: { row: 1, frames: 7, fps: 7, loop: true }, idle_n: { row: 2, frames: 7, fps: 7, loop: true }, idle_w: { row: 3, frames: 7, fps: 7, loop: true }, walk_s: { row: 4, frames: 8, fps: 11, loop: true }, walk_e: { row: 5, frames: 8, fps: 11, loop: true }, walk_n: { row: 6, frames: 8, fps: 11, loop: true }, walk_w: { row: 7, frames: 8, fps: 11, loop: true }, work_mine: { row: 8, frames: 8, fps: 10, loop: true }, work_chop: { row: 9, frames: 8, fps: 10, loop: true }, work_build: { row: 10, frames: 8, fps: 10, loop: true }, carry: { row: 11, frames: 8, fps: 10, loop: true }, die: { row: 12, frames: 8, fps: 10, loop: false } } },
  v_lanceiro: { url: v_lanceiroUrl, cols: 12, rows: 2, cellW: 256, cellH: 256, anchorX: 128, anchorY: 236, display: 72, anims: { walk: { row: 0, frames: 12, fps: 16, loop: true }, attack: { row: 1, frames: 12, fps: 20, loop: false } } },
};

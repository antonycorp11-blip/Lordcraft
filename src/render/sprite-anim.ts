import type { Entity } from '../sim/entity';
import { SPRITE_SHEETS, type SpriteAnim, type SpriteAnimName, type SpriteSheet } from './sprite-manifest';

// Animações quadro a quadro a partir das folhas em src/assets/sprites (ver tools/sprites).
// O quadro sai do estado da simulação (u.anim / u.animT): nada de timers por unidade.

export function spriteSheetFor(type: string): SpriteSheet | undefined {
  return SPRITE_SHEETS[type];
}

export type SpriteDir = 's' | 'e' | 'n' | 'w';
export type WorkKind = 'mine' | 'chop' | 'build';

/** O que a unidade está fazendo, do ponto de vista da arte. */
export interface SpriteContext {
  state: SpriteAnimName;
  t: number;            // tempo dentro do estado (u.animT)
  dir: SpriteDir;       // direção do movimento (ou a última conhecida)
  facingLeft: boolean;  // para animações de um lado só, que são espelhadas
  work: WorkKind;
  carrying: boolean;    // carregando prata/éter nos braços
  dist?: number;        // distância andada (px do mundo): o passo acompanha o chão, sem patinar
}

/** Px andados por ciclo completo de caminhada (dois passos) num personagem de escala 1. */
export const WALK_CYCLE_PX = 44;

export interface SpriteFrame {
  /** 'anim' = quadro da folha; 'still' = quadro parado (respira via CSS); 'legacy' = sprite antigo */
  mode: 'anim' | 'still' | 'legacy';
  x: number; // posição em px dentro da folha já na escala de exibição
  y: number;
  flip: boolean;  // espelhar horizontalmente
  carry: boolean; // usa a pose de carga (esconde o embrulho desenhado em CSS)
}

interface Choice { anim?: SpriteAnim; flip: boolean; carry?: boolean; byDistance?: boolean }

/** Escolhe a linha da folha. Linhas direcionais (walk_e, idle_n...) nunca são espelhadas. */
function choose(sheet: SpriteSheet, c: SpriteContext): Choice | 'legacy' | null {
  const a = sheet.anims;
  const fl = c.facingLeft;
  const dirAnim = (base: string) => a[`${base}_${c.dir}`];
  switch (c.state) {
    case 'walk':
      if (c.carrying && a.carry) return { anim: a.carry, flip: fl, carry: true, byDistance: true };
      if (dirAnim('walk')) return { anim: dirAnim('walk'), flip: false, byDistance: true };
      if (a.walk) return { anim: a.walk, flip: fl, byDistance: true };
      return null;
    case 'idle':
      if (dirAnim('idle')) return { anim: dirAnim('idle'), flip: false };
      if (a.idle) return { anim: a.idle, flip: fl };
      return null;
    case 'work': {
      const w = a[`work_${c.work}`] ?? a.work ?? a.work_mine ?? a.attack;
      return w ? { anim: w, flip: fl } : 'legacy';
    }
    case 'attack': {
      const w = a.attack ?? a.work_chop ?? a.work_mine;
      return w ? { anim: w, flip: fl } : 'legacy';
    }
    case 'cast': {
      const w = a.cast ?? a.attack;
      return w ? { anim: w, flip: fl } : 'legacy';
    }
    case 'die':
      return a.die ? { anim: a.die, flip: fl } : null;
  }
  return null;
}

export function spriteState(u: Entity): SpriteAnimName {
  if (!u.alive) return 'die';
  return u.anim;
}

export function frameIndex(anim: SpriteAnim, t: number): number {
  const i = Math.floor(Math.max(0, t) * anim.fps);
  return anim.loop ? i % anim.frames : Math.min(anim.frames - 1, i);
}

/** Primeira pose "de pé" da folha, para retratos e quadros parados. */
export function baseAnim(sheet: SpriteSheet, dir: SpriteDir = 's'): SpriteAnim | undefined {
  const a = sheet.anims;
  return a[`idle_${dir}`] ?? a.idle ?? a[`walk_${dir}`] ?? a.walk ?? a.idle_s ?? a.walk_s;
}

export function spriteFrame(sheet: SpriteSheet, c: SpriteContext, scale: number): SpriteFrame {
  const k = (sheet.display / sheet.cellH) * scale;
  const ch = choose(sheet, c);
  if (ch === 'legacy') return { mode: 'legacy', x: 0, y: 0, flip: false, carry: false };
  if (ch?.anim) {
    const i = ch.byDistance && c.dist !== undefined
      ? Math.floor((c.dist / (WALK_CYCLE_PX * scale)) * ch.anim.frames) % ch.anim.frames
      : frameIndex(ch.anim, c.t);
    return { mode: 'anim', x: i * sheet.cellW * k, y: ch.anim.row * sheet.cellH * k, flip: ch.flip, carry: !!ch.carry };
  }
  // parado ou morrendo sem quadros próprios: primeira pose de pé (a queda vem do CSS)
  const base = baseAnim(sheet, c.dir);
  const directional = !!sheet.anims[`idle_${c.dir}`] || !!sheet.anims[`walk_${c.dir}`];
  return { mode: 'still', x: 0, y: (base?.row ?? 0) * sheet.cellH * k, flip: directional ? false : c.facingLeft, carry: false };
}

/** Mesmo estilo de applySheetStyle, como texto (para HTML de retratos). Mostra o 1º quadro. */
export function sheetStyleText(sheet: SpriteSheet, scale: number): string {
  const k = (sheet.display / sheet.cellH) * scale;
  const base = baseAnim(sheet);
  return `width:${sheet.cellW * k}px;height:${sheet.cellH * k}px;left:${-sheet.anchorX * k}px;top:${-sheet.anchorY * k}px;` +
    `transform-origin:${sheet.anchorX * k}px ${sheet.anchorY * k}px;background-image:url('${sheet.url}');` +
    `background-size:${sheet.cols * sheet.cellW * k}px ${sheet.rows * sheet.cellH * k}px;` +
    `background-position:0 ${-(base?.row ?? 0) * sheet.cellH * k}px`;
}

/** Estilo fixo do elemento (tamanho, âncora e folha), aplicado uma vez por vista. */
export function applySheetStyle(el: HTMLElement, sheet: SpriteSheet, scale: number) {
  const k = (sheet.display / sheet.cellH) * scale;
  const s = el.style;
  s.width = `${sheet.cellW * k}px`;
  s.height = `${sheet.cellH * k}px`;
  s.left = `${-sheet.anchorX * k}px`;
  s.top = `${-sheet.anchorY * k}px`;
  s.transformOrigin = `${sheet.anchorX * k}px ${sheet.anchorY * k}px`;
  s.backgroundImage = `url("${sheet.url}")`;
  s.backgroundSize = `${sheet.cols * sheet.cellW * k}px ${sheet.rows * sheet.cellH * k}px`;
}

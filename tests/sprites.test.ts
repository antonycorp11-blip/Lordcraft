import { describe, expect, it } from 'vitest';
import { UNITS } from '../src/data/factions';
import { unitClass, unitHTML } from '../src/render/views';
import { SPRITE_SHEETS } from '../src/render/sprite-manifest';
import { frameIndex, spriteFrame, WALK_CYCLE_PX, type SpriteContext } from '../src/render/sprite-anim';
import { World } from '../src/world/world';

describe('sprites animados', () => {
  it('atribui um atlas e uma figura a toda unidade jogável, convocada ou neutra', () => {
    for (const type of Object.keys(UNITS)) {
      expect(unitClass(type), type).toContain('sprite-u');
      expect(unitHTML(type), type).toContain('sprite-figure');
    }
  });
});

describe('folhas quadro a quadro', () => {
  const lanc = SPRITE_SHEETS.v_lanceiro;
  const lav = SPRITE_SHEETS.v_lavrador;
  const ctx = (state: any, extra: Partial<SpriteContext> = {}): SpriteContext =>
    ({ state, t: 0, dir: 's', facingLeft: false, work: 'mine', carrying: false, ...extra });
  const rowOf = (sheet: typeof lav, name: string) => sheet.anims[name]!.row * sheet.cellH * (sheet.display / sheet.cellH);

  it('toda folha do manifesto pertence a uma unidade e tem animações válidas', () => {
    for (const [key, s] of Object.entries(SPRITE_SHEETS)) {
      expect(UNITS[key], key).toBeTruthy();
      for (const [name, a] of Object.entries(s.anims)) {
        expect(a!.frames, `${key}.${name}`).toBeGreaterThanOrEqual(4);
        expect(a!.row, `${key}.${name}`).toBeLessThan(s.rows);
      }
    }
  });

  it('caminhada repete em ciclo; golpe para no último quadro', () => {
    const walk = lanc.anims.walk!;
    expect(frameIndex(walk, 0)).toBe(0);
    expect(frameIndex(walk, walk.frames / walk.fps)).toBe(0);
    expect(frameIndex(walk, 1.5 / walk.fps)).toBe(1);
    const atk = lanc.anims.attack!;
    expect(frameIndex(atk, 10)).toBe(atk.frames - 1);
  });

  it('lavrador anda e fica parado na direção do movimento, sem espelhar', () => {
    for (const d of ['s', 'e', 'n', 'w'] as const) {
      const w = spriteFrame(lav, ctx('walk', { dir: d, facingLeft: true }), 1);
      expect(w).toMatchObject({ mode: 'anim', flip: false });
      expect(w.y).toBeCloseTo(rowOf(lav, `walk_${d}`));
      expect(spriteFrame(lav, ctx('idle', { dir: d }), 1).y).toBeCloseTo(rowOf(lav, `idle_${d}`));
    }
  });

  it('lavrador carrega minério nos braços e trabalha conforme a ordem', () => {
    const carry = spriteFrame(lav, ctx('walk', { carrying: true, facingLeft: true }), 1);
    expect(carry).toMatchObject({ carry: true, flip: true });
    expect(carry.y).toBeCloseTo(rowOf(lav, 'carry'));
    for (const w of ['mine', 'chop', 'build'] as const) {
      expect(spriteFrame(lav, ctx('work', { work: w }), 1).y).toBeCloseTo(rowOf(lav, `work_${w}`));
    }
    // sem ataque próprio, o lavrador golpeia com o machado
    expect(spriteFrame(lav, ctx('attack'), 1).y).toBeCloseTo(rowOf(lav, 'work_chop'));
    expect(spriteFrame(lav, ctx('die', { t: 99 }), 1).x).toBeCloseTo((lav.anims.die!.frames - 1) * lav.cellW * (lav.display / lav.cellH));
  });

  it('lanceiro (folha de um lado só) espelha para a esquerda e usa o golpe para trabalhar', () => {
    expect(spriteFrame(lanc, ctx('walk', { facingLeft: true }), 1)).toMatchObject({ mode: 'anim', flip: true });
    expect(spriteFrame(lanc, ctx('work'), 1).y).toBeCloseTo(rowOf(lanc, 'attack'));
    // parado sem "idle": primeira pose da caminhada
    expect(spriteFrame(lanc, ctx('idle'), 1)).toMatchObject({ mode: 'still', x: 0 });
  });

  it('o passo avança pela distância andada (pé plantado, sem patinar)', () => {
    const walk = lav.anims.walk_e!;
    const cell = lav.cellW * (lav.display / lav.cellH);
    const at = (dist: number) => spriteFrame(lav, ctx('walk', { dir: 'e', dist, t: 123 }), 1).x / cell;
    expect(at(0)).toBe(0);
    expect(at(WALK_CYCLE_PX / walk.frames * 1.5)).toBe(1);   // 1,5 quadro de distância -> quadro 1
    expect(at(WALK_CYCLE_PX)).toBe(0);                         // um ciclo completo volta ao início
    expect(at(WALK_CYCLE_PX / 2)).toBe(walk.frames / 2);       // meio ciclo -> meio da animação
  });
});

describe('árvores', () => {
  it('cada golpe tira madeira e avisa o desenho; ao acabar, a árvore some', () => {
    const w = new World(4, 4);
    const i = w.idx(1, 1);
    w.setTree(i, 2, 0);
    w.chopTree(i);
    expect(w.tree[i]).toBe(1);
    expect(w.damagedTrees).toEqual([i]);
    w.chopTree(i);
    expect(w.tree[i]).toBe(0);
    expect(w.damagedTrees).toEqual([i]); // no último golpe quem avisa é a remoção
  });
});


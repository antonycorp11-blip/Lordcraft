import { hash2 } from '../core/rng';
import type { Decor } from '../world/mapgen';
import { World, Ter, TER_NAMES } from '../world/world';
import { TILE } from './camera';
import { PAD, paintGround, releaseGround, whenGroundReady, type GroundBlob } from './ground-paint';

// Atlases de terreno e objetos em manchas orgânicas sobrepostas, sem grade
// visível, organizados em blocos com renderização sob demanda.

const CH = 16; // tiles por bloco
const TREE_WOOD = 50; // madeira de uma árvore inteira (mapgen)

/** Estágio de dano pela madeira restante: inteira, cortada, quase caindo. */
function treeStage(wood: number): string {
  const f = wood / TREE_WOOD;
  return f < 0.34 ? ' d2' : f < 0.67 ? ' d1' : '';
}
const CPX = CH * TILE;
const DRAW_ORDER: Record<number, number> = {
  [Ter.Water]: 0, [Ter.Shallow]: 1, [Ter.Sand]: 2, [Ter.Dirt]: 3, [Ter.Grass]: 4, [Ter.Moss]: 4, [Ter.Ash]: 4,
  [Ter.Snow]: 4, [Ter.Road]: 5, [Ter.Bridge]: 6, [Ter.Rock]: 7,
};

interface Chunk {
  cx: number; cy: number;
  built: boolean;
  shown: boolean;
  farShown: boolean;
  ground: HTMLElement;
  objs: HTMLElement;
  far: HTMLElement;
  farDirty: boolean;
  gcv: HTMLCanvasElement | null;   // chão pintado (manchas do atlas)
  blobs: GroundBlob[];
  painted: number;                 // escala em que foi pintado (0 = não pintado)
  lastSeen: number;
}

/** Escalas de pintura do chão: acompanham o zoom para gastar pouca memória de longe. */
const PAINT_STEPS = [0.5, 0.75, 1, 1.25];
const KEEP_HIDDEN = 16; // blocos fora de vista que continuam pintados

export class TerrainView {
  world: World;
  chunks: Chunk[] = [];
  cols: number;
  rows: number;
  treeEls = new Map<number, HTMLElement>();
  decorByChunk = new Map<number, Decor[]>();
  far = false;
  seed: number;
  builtCount = 0;
  private tick = 0;
  private atlasReady = false;

  constructor(world: World, private groundLayer: HTMLElement, private objLayer: HTMLElement, decor: Decor[], seed: number) {
    this.world = world;
    this.seed = seed;
    this.cols = Math.ceil(world.w / CH);
    this.rows = Math.ceil(world.h / CH);
    for (const d of decor) {
      const k = Math.floor(d.x / CH) + Math.floor(d.y / CH) * this.cols;
      if (!this.decorByChunk.has(k)) this.decorByChunk.set(k, []);
      this.decorByChunk.get(k)!.push(d);
    }
    for (let cy = 0; cy < this.rows; cy++)
      for (let cx = 0; cx < this.cols; cx++) {
        const mk = (cls: string) => {
          const el = document.createElement('div');
          el.className = cls;
          el.style.left = cx * CPX + 'px';
          el.style.top = cy * CPX + 'px';
          el.style.display = 'none';
          return el;
        };
        const c: Chunk = { cx, cy, built: false, shown: false, farShown: false, ground: mk('chunk g'), objs: mk('chunk o'), far: mk('chunk f'), farDirty: true, gcv: null, blobs: [], painted: 0, lastSeen: 0 };
        this.chunks.push(c);
        groundLayer.appendChild(c.ground);
        groundLayer.appendChild(c.far);
        objLayer.appendChild(c.objs);
      }
  }

  /** Atualiza blocos visíveis. */
  update(x0: number, y0: number, x1: number, y1: number, far: boolean, zoom = 1) {
    const c0 = Math.max(0, Math.floor(x0 / CH) - 0), c1 = Math.min(this.cols - 1, Math.floor(x1 / CH));
    const r0 = Math.max(0, Math.floor(y0 / CH) - 0), r1 = Math.min(this.rows - 1, Math.floor((y1 + 3) / CH));
    this.far = far;
    this.tick++;
    if (!this.atlasReady) this.atlasReady = whenGroundReady(() => { this.atlasReady = true; });
    const target = Math.min(1.25, zoom * Math.min(2, window.devicePixelRatio || 1));
    const want = PAINT_STEPS.find((p) => p >= target) ?? 1.25;
    let budget = 3; // limita construções por quadro (fluidez da câmera)
    let paintBudget = 1; // um bloco de chão por quadro: pintar dois de uma vez dava trancos no celular
    for (const c of this.chunks) {
      const vis = c.cx >= c0 && c.cx <= c1 && c.cy >= r0 && c.cy <= r1;
      if (vis && !c.built) {
        if (budget <= 0) continue;
        budget--;
        this.build(c);
      }
      if (vis) {
        c.lastSeen = this.tick;
        if (this.atlasReady && c.gcv && c.painted < want && paintBudget > 0) {
          paintBudget--;
          paintGround(c.gcv, c.blobs, CPX, want);
          c.painted = want;
        }
      }
      const showObjs = vis && !far;
      const showFar = vis && far;
      if (vis !== c.shown) { c.ground.style.display = vis ? '' : 'none'; c.shown = vis; }
      if (showObjs !== (c.objs.style.display !== 'none')) c.objs.style.display = showObjs ? '' : 'none';
      if (showFar && c.farDirty) this.buildFar(c);
      if (showFar !== c.farShown) { c.far.style.display = showFar ? '' : 'none'; c.farShown = showFar; }
    }
    // Prepara com antecedência o anel de blocos em volta da tela (1 por quadro, só quando
    // os visíveis já estão prontos): ao mover a câmera, eles não precisam ser montados na hora.
    if (budget === 3 && paintBudget === 1) {
      for (let cy = r0 - 1; cy <= r1 + 1; cy++)
        for (let cx = c0 - 1; cx <= c1 + 1; cx++) {
          if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) continue;
          const c = this.chunks[cx + cy * this.cols];
          c.lastSeen = this.tick;
          if (!c.built) { this.build(c); budget = 0; break; }
          if (this.atlasReady && c.gcv && c.painted < want) { paintGround(c.gcv, c.blobs, CPX, want); c.painted = want; budget = 0; break; }
        }
    }
    this.releaseOldGround();
  }

  /** Mantém pintados só os blocos visíveis e alguns vizinhos recentes. */
  private releaseOldGround() {
    const hidden = this.chunks.filter((c) => c.painted > 0 && c.lastSeen !== this.tick);
    if (hidden.length <= KEEP_HIDDEN) return;
    hidden.sort((a, b) => a.lastSeen - b.lastSeen);
    for (const c of hidden.slice(0, hidden.length - KEEP_HIDDEN)) {
      releaseGround(c.gcv!);
      c.painted = 0;
    }
  }

  private build(c: Chunk) {
    c.built = true;
    this.builtCount++;
    const w = this.world;
    const g: string[] = [];
    const o: string[] = [];
    const tx0 = c.cx * CH, ty0 = c.cy * CH;
    const S = this.seed;
    // ---- manchas de terreno (células 2x2) ----
    const blobs: (GroundBlob & { ord: number })[] = [];
    for (let y = ty0; y < Math.min(w.h, ty0 + CH); y += 2)
      for (let x = tx0; x < Math.min(w.w, tx0 + CH); x += 2) {
        const counts = new Map<number, number>();
        let hi = 0;
        for (let k = 0; k < 4; k++) {
          const xx = x + (k & 1), yy = y + (k >> 1);
          if (!w.inside(xx, yy)) continue;
          const t = w.ter[w.idx(xx, yy)];
          counts.set(t, (counts.get(t) ?? 0) + (t === Ter.Water ? 1.2 : t === Ter.Road || t === Ter.Bridge ? 1.6 : 1));
          hi += w.elev[w.idx(xx, yy)];
        }
        let dom = Ter.Grass, dc = -1;
        for (const [t, n] of counts) if (n > dc) { dc = n; dom = t; }
        if (dom === Ter.Bridge) dom = Ter.Water;
        const h = hash2(x, y, S);
        const jx = (h - 0.5) * 14, jy = (hash2(y, x, S) - 0.5) * 14;
        const lx = (x - tx0 + 1) * TILE + jx, ly = (y - ty0 + 1) * TILE + jy;
        const v = Math.floor(h * 4);
        const rot = Math.floor(hash2(x + 7, y, S) * 360);
        blobs.push({ ord: DRAW_ORDER[dom] ?? 4, ter: TER_NAMES[dom], v, x: lx | 0, y: ly | 0, rot, hi: false });
        if (hi >= 3) blobs.push({ ord: 8, ter: 'hi', v: 0, x: lx | 0, y: ly | 0, rot: 0, hi: true });
      }
    blobs.sort((a, b) => a.ord - b.ord);
    c.blobs = blobs;

    // ---- detalhes por tile ----
    for (let y = ty0; y < Math.min(w.h, ty0 + CH); y++)
      for (let x = tx0; x < Math.min(w.w, tx0 + CH); x++) {
        const i = w.idx(x, y);
        const t = w.ter[i];
        const lx = (x - tx0) * TILE, ly = (y - ty0) * TILE;
        const h = hash2(x * 3, y * 5, S + 1);
        const z = (y + 1) * TILE;
        if (t === Ter.Bridge) g.push(`<i class="brg" style="left:${lx}px;top:${ly}px"></i>`);
        else if (t === Ter.Water && h < 0.16) g.push(`<i class="rp" style="left:${lx + (h * 60) % 16}px;top:${ly + 8}px;animation-delay:-${(h * 37) % 6}s"></i>`);
        else if (t === Ter.Road && h < 0.25) g.push(`<i class="pebble" style="left:${lx + (h * 90) % 20}px;top:${ly + (h * 55) % 20}px"></i>`);
        else if (w.block[i] === 0 && !w.tree[i]) {
          // decoração (arte gerada): arbustos, flores, capim, pedras, troncos, fardos de feno
          if (h < 0.014 && (t === Ter.Grass || t === Ter.Moss || t === Ter.Dirt)) {
            const props = t === Ter.Dirt ? [0, 1, 5, 12] : [2, 3, 4, 2, 3, 0, 1, 5];
            const k = props[Math.floor(hash2(x * 7, y * 11, S + 3) * props.length)];
            o.push(`<i class="prop p${k}" style="left:${lx + (h * 500) % 10 - 4}px;top:${ly - 12}px;z-index:${z}"></i>`);
          } else if (h < 0.09 && (t === Ter.Grass || t === Ter.Moss)) g.push(`<i class="tuft ${t === Ter.Moss ? 'm' : ''} ${h < 0.03 ? 'fl' : ''}" style="left:${lx + (h * 300) % 22}px;top:${ly + (h * 170) % 22}px"></i>`);
          else if (h < 0.05 && t === Ter.Snow) g.push(`<i class="tuft s" style="left:${lx + 8}px;top:${ly + 10}px"></i>`);
          else if (h < 0.06 && t === Ter.Ash) g.push(`<i class="ember" style="left:${lx + 10}px;top:${ly + 12}px;animation-delay:-${(h * 50) % 4}s"></i>`);
          else if (h > 0.985) g.push(`<i class="pebble big" style="left:${lx + 6}px;top:${ly + 10}px"></i>`);
        }
        // penhascos
        if (w.cliff[i]) {
          const south = y + 1 < w.h && w.elev[w.idx(x, y + 1)] === 0;
          const north = y > 0 && w.elev[w.idx(x, y - 1)] === 0;
          o.push(`<i class="cliff ${south ? 'cs' : ''} ${north ? 'cn' : ''} v${Math.floor(h * 3)}" style="left:${lx}px;top:${ly}px;z-index:${z}"></i>`);
        }
        // rocha (montanha)
        if (t === Ter.Rock) {
          const v = Math.floor(h * 4);
          o.push(`<i class="rk v${v}" style="left:${lx - 4}px;top:${ly - 10}px;z-index:${z}"></i>`);
        }
        // árvores
        if (w.tree[i]) {
          const k = w.treeKind[i];
          const v = Math.floor(h * 3);
          const ox = Math.round((hash2(x, y, S + 9) - 0.5) * 8), oy = Math.round((hash2(y, x, S + 9) - 0.5) * 6);
          o.push(`<i class="tr k${k} v${v}${treeStage(w.tree[i])}" data-i="${i}" style="left:${lx + ox - 18}px;top:${ly + oy - 34}px;z-index:${z + oy};animation-delay:${-((i * 0.618) % 1) * 6}s"></i>`);
        }
      }
    // decoração
    for (const d of this.decorByChunk.get(c.cx + c.cy * this.cols) ?? []) {
      o.push(`<i class="dc dc-${d.kind}" style="left:${(d.x - tx0) * TILE}px;top:${(d.y - ty0) * TILE}px;z-index:${(d.y + 1) * TILE}"></i>`);
    }
    c.ground.innerHTML = g.join('');
    // canvas do chão por baixo dos detalhes, com margem para as manchas da borda
    c.gcv = document.createElement('canvas');
    c.gcv.className = 'gcv';
    c.gcv.width = 0;
    c.gcv.style.cssText = `left:${-PAD}px;top:${-PAD}px;width:${CPX + PAD * 2}px;height:${CPX + PAD * 2}px`;
    c.ground.prepend(c.gcv);
    c.painted = 0;
    c.objs.innerHTML = o.join('');
    c.objs.querySelectorAll<HTMLElement>('.tr').forEach((el) => this.treeEls.set(Number(el.dataset.i), el));
  }

  /** Copa de floresta simplificada para zoom distante. */
  private buildFar(c: Chunk) {
    c.farDirty = false;
    const w = this.world;
    const out: string[] = [];
    const tx0 = c.cx * CH, ty0 = c.cy * CH;
    for (let y = ty0; y < Math.min(w.h, ty0 + CH); y += 2)
      for (let x = tx0; x < Math.min(w.w, tx0 + CH); x += 2) {
        let n = 0, kind = 0, rock = 0;
        for (let k = 0; k < 4; k++) {
          const xx = x + (k & 1), yy = y + (k >> 1);
          if (!w.inside(xx, yy)) continue;
          const i = w.idx(xx, yy);
          if (w.tree[i]) { n++; kind = w.treeKind[i]; }
          if (w.ter[i] === Ter.Rock || w.cliff[i]) rock++;
        }
        const lx = (x - tx0) * TILE, ly = (y - ty0) * TILE;
        if (n >= 2) out.push(`<i class="fc k${kind}" style="left:${lx - 6}px;top:${ly - 10}px"></i>`);
        else if (rock >= 2) out.push(`<i class="frk" style="left:${lx - 4}px;top:${ly - 6}px"></i>`);
      }
    c.far.innerHTML = out.join('');
  }

  /** Árvore perdeu madeira: inclina conforme o estágio de dano. */
  onTreeDamaged(i: number) {
    const el = this.treeEls.get(i);
    if (!el) return;
    const stage = treeStage(this.world.tree[i]).trim();
    el.classList.toggle('d1', stage === 'd1');
    el.classList.toggle('d2', stage === 'd2');
  }

  /** Árvores derrubadas: uma cópia tomba e some, e no lugar fica o toco. */
  onTreeRemoved(i: number) {
    const el = this.treeEls.get(i);
    if (el) {
      if (!this.far && el.offsetParent) {
        const fall = el.cloneNode(false) as HTMLElement;
        fall.classList.remove('d1', 'd2');
        fall.classList.add('falling');
        el.after(fall);
        setTimeout(() => fall.remove(), 1100);
      }
      el.classList.remove('d1', 'd2');
      el.classList.add('stump');
      this.treeEls.delete(i);
    }
    const x = i % this.world.w, y = Math.floor(i / this.world.w);
    const c = this.chunks[Math.floor(x / CH) + Math.floor(y / CH) * this.cols];
    if (c) c.farDirty = true;
  }

  /** Árvore sendo trabalhada (balança). */
  shake(i: number) {
    const el = this.treeEls.get(i);
    if (!el) return;
    if ((el as any)._shk && (el as any)._shk > performance.now()) return;
    (el as any)._shk = performance.now() + 320;
    // tremor lateral (translate) para não sobrescrever o tamanho/inclinação da árvore
    el.animate([{ translate: '0 0' }, { translate: '2px 0' }, { translate: '-2px 0' }, { translate: '0 0' }], { duration: 300 });
  }
}

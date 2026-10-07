import { hash2 } from '../core/rng';
import type { Decor } from '../world/mapgen';
import { World, Ter, TER_NAMES } from '../world/world';
import { TILE } from './camera';
import { PAD, paintGround, releaseGround, whenGroundReady, type GroundBlob } from './ground-paint';
import { paintScenery, sceneryReady, treeBox } from './scenery';

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
  private sceneryOk = false;
  /** tocos deixados por árvores derrubadas (só visual) */
  stumps = new Set<number>();
  private decor: Decor[];

  constructor(world: World, private groundLayer: HTMLElement, private objLayer: HTMLElement, decor: Decor[], seed: number) {
    this.decor = decor;
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
    if (!this.sceneryOk) this.sceneryOk = sceneryReady(() => {
      // as imagens do cenário chegaram: repinta o que já estava pintado só com o chão
      this.sceneryOk = true;
      for (const c of this.chunks) c.painted = 0;
    });
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
          this.paint(c, want);
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
          if (this.atlasReady && c.gcv && c.painted < want) { this.paint(c, want); budget = 0; break; }
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

    c.ground.innerHTML = '';
    // canvas do chão por baixo dos detalhes, com margem para as manchas da borda
    c.gcv = document.createElement('canvas');
    c.gcv.className = 'gcv';
    c.gcv.width = 0;
    c.gcv.style.cssText = `left:${-PAD}px;top:${-PAD}px;width:${CPX + PAD * 2}px;height:${CPX + PAD * 2}px`;
    c.ground.prepend(c.gcv);
    c.painted = 0;
    c.objs.innerHTML = '';
  }

  /** Chão + cenário fixo do bloco num só canvas (com o que transborda dos vizinhos). */
  private paint(c: Chunk, scale: number) {
    paintGround(c.gcv!, c.blobs, CPX, scale);
    if (this.sceneryOk) {
      const ctx = c.gcv!.getContext('2d')!;
      ctx.setTransform(scale, 0, 0, scale, (PAD - c.cx * CPX) * scale, (PAD - c.cy * CPX) * scale);
      paintScenery(ctx, this.world, this.seed, this.decor, this.stumps, c.cx * CPX - PAD, c.cy * CPX - PAD, CPX + PAD * 2, CPX + PAD * 2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    c.painted = scale;
  }

  /** Repinta os blocos que mostram a árvore do tile i (o dela e os vizinhos pela margem). */
  private dirtyAround(i: number) {
    const b = treeBox(this.world, i, this.seed);
    const c0 = Math.max(0, Math.floor((b.x - PAD) / CPX)), c1 = Math.min(this.cols - 1, Math.floor((b.x + b.w + PAD) / CPX));
    const r0 = Math.max(0, Math.floor((b.y - PAD) / CPX)), r1 = Math.min(this.rows - 1, Math.floor((b.y + b.h + PAD) / CPX));
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      const c = this.chunks[cx + cy * this.cols];
      if (c.painted > 0) c.painted = 0.01; // menor que qualquer escala: repinta assim que possível
    }
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

  /** Árvore perdeu madeira: o desenho muda de estágio (inteira, cortada, quase caindo). */
  onTreeDamaged(i: number) {
    this.dirtyAround(i);
  }

  /** Árvores derrubadas: uma cópia tomba e some, e no lugar fica o toco. */
  onTreeRemoved(i: number) {
    const b = treeBox(this.world, i, this.seed);
    if (!this.far) {
      const fall = document.createElement('i');
      fall.className = `tr falling k${this.world.treeKind[i] & 3}`;
      fall.style.cssText = `position:absolute;left:${b.x + 4}px;top:${b.y + 8}px;z-index:${b.y + 60}`;
      this.objLayer.appendChild(fall);
      setTimeout(() => fall.remove(), 1100);
    }
    this.stumps.add(i);
    this.dirtyAround(i);
  }

  /** Árvore sendo trabalhada: o cenário é pintado, então não há balanço. */
  shake(_i: number) {}
}
